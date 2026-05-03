/**
 * import_followup.js — Sweta's Follow-up Sheet → MongoDB
 * ═══════════════════════════════════════════════════════
 * Imports 314 follow-up leads into readable_crm.
 * Maps Hot Prospect → CRM stage, deduplicates by email/phone.
 *
 * HOW TO RUN (from crm-server folder):
 *   node import_followup.js path/to/followup.csv
 */

const { MongoClient } = require('mongodb');
const fs   = require('fs');
const path = require('path');

const MONGO    = 'mongodb+srv://revuser:Rev%402026@cluster0.nbvsbve.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const CSV_PATH = process.argv[2] || path.join(__dirname, 'Sweta Follow up sheet Priyank Copy - Sheet1.csv');

// ── HELPERS ──────────────────────────────────────────────────────────────────
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const allRows = parseAllRows(content);
  if (allRows.length < 2) return [];
  const headers = allRows[0].map(h => h.trim());
  return allRows.slice(1)
    .filter(r => r.some(v => v.trim()))
    .map(values => {
      const row = {};
      headers.forEach((h, i) => { row[h] = (values[i] || '').trim(); });
      return row;
    });
}

// Proper character-by-character CSV parser — handles multiline quoted fields
function parseAllRows(content) {
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === '"') {
      if (inQ && content[i+1] === '"') { cell += '"'; i++; }
      else { inQ = !inQ; }
    } else if (c === ',' && !inQ) {
      row.push(cell); cell = '';
    } else if ((c === '\n' || c === '\r') && !inQ) {
      if (c === '\r' && content[i+1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(v => v)) rows.push(row);
      row = [];
    } else {
      cell += c;
    }
  }
  if (cell || row.length) { row.push(cell); if (row.some(v => v)) rows.push(row); }
  return rows;
}

function mapHotToStage(hot) {
  if (!hot) return 'Demo Done';
  const h = hot.toLowerCase().trim();
  if (h.includes('integrat')) return 'Closed Won';
  if (h === 'hot')             return 'Negotiation';
  if (h === 'warm')            return 'Proposal Sent';
  if (h === 'dead')            return 'Closed Lost';
  return 'Demo Done'; // Cold or anything else → Demo Done
}

function mapOwner(contactPerson) {
  if (!contactPerson) return 'Sweta';
  const cp = contactPerson.toLowerCase();
  if (cp.includes('sweta'))  return 'Sweta';
  if (cp.includes('anupama')) return 'Anupama';
  return contactPerson.trim() || 'Sweta';
}

function parseDate(raw) {
  if (!raw) return '';
  // Handle DD/MM/YYYY or DD/MM/YY
  const parts = raw.trim().split('/');
  if (parts.length === 3) {
    let [d, m, y] = parts;
    if (y.length === 2) y = '20' + y;
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  return '';
}

function cleanPhone(raw) {
  if (!raw) return '';
  // Take first number if multiple are listed
  return raw.split('/')[0].trim();
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(58));
  console.log('  Sweta Follow-up Sheet → MongoDB Import');
  console.log('═'.repeat(58));

  if (!fs.existsSync(CSV_PATH)) {
    console.error(`❌  CSV not found: ${CSV_PATH}`);
    console.error('    Usage: node import_followup.js "path/to/followup.csv"');
    process.exit(1);
  }

  const rows = parseCSV(CSV_PATH).filter(r => r['Company'] && r['Company'].trim());
  console.log(`📋  Found ${rows.length} rows in CSV\n`);

  const client = new MongoClient(MONGO);
  await client.connect();
  console.log('✅  Connected to MongoDB Atlas\n');

  const db    = client.db('readable_crm');
  const leads = db.collection('leads');

  // Load existing leads for dedup
  const existing = new Set();
  for (const doc of await leads.find({}, { projection: { email:1, phone:1 } }).toArray()) {
    if (doc.email) existing.add(doc.email.toLowerCase().trim());
    if (doc.phone) existing.add(cleanPhone(doc.phone).replace(/\D/g,'').slice(-10));
  }
  console.log(`📊  ${existing.size} existing leads loaded for dedup check\n`);

  let nextId   = (await leads.countDocuments({})) + 200; // start after existing IDs
  let inserted = 0;
  let skipped  = 0;
  let duped    = 0;

  for (const r of rows) {
    const company = r['Company']?.trim();
    const name    = r['POC Name']?.trim();
    if (!company) continue;

    const email = (r['POC Email ID'] || '').trim().toLowerCase();
    const phone = cleanPhone(r['Contact Number'] || '');
    const phoneDigits = phone.replace(/\D/g,'').slice(-10);

    // Dedup check
    if (email && existing.has(email)) { duped++; continue; }
    if (phoneDigits.length >= 10 && existing.has(phoneDigits)) { duped++; continue; }

    const hot   = (r['Hot Prospect'] || '').trim();
    const stage = mapHotToStage(hot);
    const owner = mapOwner(r['Contact Person'] || '');

    // Build notes from Status/Remarks + platform + integration info
    let notes = (r['Status/ Remarks'] || '').replace(/\n/g, ' ').trim();
    if (r['Platform']) notes = `Platform: ${r['Platform']}. ` + notes;
    if (r['Integration Done'] === 'Yes') notes = '[Integration Done] ' + notes;

    const lead = {
      id:      nextId++,
      name:    name || company,
      co:      company,
      desg:    (r['POC Designation'] || '').trim(),
      ind:     (r['Category'] || '').trim() || 'Other',
      email:   email,
      phone:   phone,
      li:      '',
      src:     'Follow-up Sheet',
      stage:   stage,
      hot:     hot || '',
      lc:      parseDate(r['Demo Date'] || ''),
      nc:      (r['NFUD'] || '').trim(),
      owner:   owner,
      notes:   notes,
      platform:          (r['Platform'] || '').trim(),
      integrationDone:   (r['Integration Done'] || '').trim(),
      websiteRelevance:  (r['Website Relevance'] || '').trim(),
      imported:          new Date().toISOString().split('T')[0],
      importedFrom:      'sweta_followup_sheet'
    };

    await leads.insertOne(lead);
    if (email)        existing.add(email);
    if (phoneDigits.length >= 10) existing.add(phoneDigits);
    nextId++;
    inserted++;

    console.log(`  ✓ [${stage}] ${name||company} @ ${company} → ${owner}`);
  }

  await client.close();

  console.log('\n' + '═'.repeat(58));
  console.log(`  ✅  Done!`);
  console.log(`  📥  Inserted : ${inserted} leads`);
  console.log(`  🔁  Skipped  : ${duped} duplicates`);
  console.log(`  ⚠️   Errors   : ${skipped}`);
  console.log(`\n  🎉  Refresh the CRM — Sweta's follow-ups are live!\n`);
  console.log('═'.repeat(58) + '\n');
}

main().catch(err => {
  console.error('❌  Error:', err.message);
  process.exit(1);
});
