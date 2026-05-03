/**
 * import_leadpool.js — Sweta's Lead Pool (16K) → MongoDB
 * ════════════════════════════════════════════════════════
 * Imports the 16,333-row prospecting database into readable_crm.
 * All leads imported as stage=Identified, owner=Sweta.
 * Deduplicates by email, phone, and LinkedIn URL.
 *
 * HOW TO RUN (from crm-server folder):
 *   node import_leadpool.js path/to/leaddata.csv
 *
 * OPTIONS:
 *   --limit=500     Import only the first N leads (default: all)
 *   --dry-run       Preview without inserting
 */

const { MongoClient } = require('mongodb');
const fs   = require('fs');
const path = require('path');

const MONGO    = 'mongodb+srv://revuser:Rev%402026@cluster0.nbvsbve.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const CSV_PATH = process.argv[2] || path.join(__dirname, 'Sweta Lead Data Priyank copy - Sheet1.csv');
const DRY_RUN  = process.argv.includes('--dry-run');
const LIMIT_ARG = process.argv.find(a => a.startsWith('--limit='));
const MAX_LEADS = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1]) : Infinity;
const BATCH_SIZE = 500; // Insert in batches for performance

// ── HELPERS ───────────────────────────────────────────────────────────────────
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

function cleanPhone(raw) {
  if (!raw || raw === '-') return '';
  return raw.split('/')[0].trim().replace(/^0+/, '');
}

function phoneDigits(raw) {
  return (raw || '').replace(/\D/g,'').slice(-10);
}

function mapCategory(raw) {
  if (!raw) return 'Other';
  const r = raw.toLowerCase();
  if (r.includes('hospital') || r.includes('health') || r.includes('pharma') || r.includes('medical')) return 'Healthcare';
  if (r.includes('bank') || r.includes('financ') || r.includes('insurance') || r.includes('fintech') || r.includes('nbfc')) return 'BFSI / Fintech';
  if (r.includes('software') || r.includes('technology') || r.includes('saas') || r.includes('internet') || r.includes('it ')) return 'IT / SaaS';
  if (r.includes('retail') || r.includes('consumer') || r.includes('fashion') || r.includes('apparel') || r.includes('ecommerce') || r.includes('e-commerce') || r.includes('d2c')) return 'Retail / D2C';
  if (r.includes('manufactur') || r.includes('industrial') || r.includes('engineering')) return 'Manufacturing';
  if (r.includes('educat') || r.includes('learning')) return 'Education';
  if (r.includes('real estate') || r.includes('property')) return 'Real Estate';
  if (r.includes('media') || r.includes('entertainment') || r.includes('publish')) return 'Media & Entertainment';
  return 'Other';
}

function parseAddedDate(raw) {
  if (!raw || raw === '-') return '';
  // Formats: "15 Jul", "22 Aug" — assume 2024/2025
  const months = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
  const parts = raw.trim().split(' ');
  if (parts.length >= 2) {
    const day = parts[0].padStart(2,'0');
    const mon = months[parts[1]];
    if (mon) return `2024-${mon}-${day}`; // assume 2024
  }
  return '';
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(62));
  console.log('  Sweta Lead Pool (16K) → MongoDB Import');
  if (DRY_RUN) console.log('  ⚠️  DRY RUN — no data will be inserted');
  console.log('═'.repeat(62));

  if (!fs.existsSync(CSV_PATH)) {
    console.error(`❌  CSV not found: ${CSV_PATH}`);
    console.error('    Usage: node import_leadpool.js "path/to/leaddata.csv"');
    process.exit(1);
  }

  // Read and parse CSV (skip first 2 header rows, row 3 is actual headers)
  console.log('📂  Reading CSV file…');
  const text    = fs.readFileSync(CSV_PATH, 'utf8');
  const allRows = parseAllRows(text);

  // Row index 2 (0-based) = actual headers
  const headers = allRows[2].map(h => h.trim());
  console.log(`📋  Headers found: ${headers.slice(0,8).join(', ')}…`);

  const dataRows = [];
  for (let i = 3; i < allRows.length; i++) {
    const values = allRows[i];
    if (!values[1]?.trim()) continue; // skip if no company name
    const row = {};
    headers.forEach((h, idx) => { row[h] = (values[idx] || '').trim(); });
    dataRows.push(row);
    if (dataRows.length >= MAX_LEADS) break;
  }
  console.log(`📊  ${dataRows.length} data rows to process\n`);

  if (DRY_RUN) {
    console.log('Sample rows:');
    dataRows.slice(0,3).forEach(r => {
      console.log(`  • ${r['POC Name']} @ ${r['Company Name']} | ${r['POC Email']} | ${r['POC Number']}`);
    });
    console.log('\n✅  Dry run complete. Remove --dry-run to import.\n');
    return;
  }

  const client = new MongoClient(MONGO);
  await client.connect();
  console.log('✅  Connected to MongoDB Atlas\n');

  const db    = client.db('readable_crm');
  const leads = db.collection('leads');

  // Load existing for dedup
  console.log('🔍  Loading existing leads for dedup…');
  const existEmails  = new Set();
  const existPhones  = new Set();
  const existLI      = new Set();
  for (const doc of await leads.find({}, { projection: { email:1, phone:1, li:1 } }).toArray()) {
    if (doc.email) existEmails.add(doc.email.toLowerCase().trim());
    const pd = phoneDigits(doc.phone);
    if (pd.length >= 10) existPhones.add(pd);
    if (doc.li) existLI.add(doc.li.toLowerCase().trim());
  }
  console.log(`📋  ${existEmails.size} existing emails, ${existPhones.size} phones, ${existLI.size} LinkedIn URLs\n`);

  let nextId   = Date.now();
  let inserted = 0;
  let duped    = 0;
  let batch    = [];
  const today  = new Date().toISOString().split('T')[0];

  for (const r of dataRows) {
    const company = (r['Company Name'] || '').trim();
    const name    = (r['POC Name']     || '').trim();
    if (!company && !name) continue;

    const email  = (r['POC Email'] || '').trim().toLowerCase();
    const phone  = cleanPhone(r['POC Number'] || '');
    const li     = (r['POC LinkedIn'] || '').trim().toLowerCase();
    const pd     = phoneDigits(phone);

    // Dedup
    if (email && existEmails.has(email))        { duped++; continue; }
    if (pd.length >= 10 && existPhones.has(pd)) { duped++; continue; }
    if (li && existLI.has(li))                  { duped++; continue; }

    const lead = {
      id:           nextId++,
      name:         name || company,
      co:           company,
      desg:         (r['POC Designation'] || '').trim(),
      ind:          mapCategory(r['Category'] || ''),
      email:        email,
      phone:        phone,
      li:           r['POC LinkedIn']?.trim() || '',
      website:      (r['Website'] || '').trim(),
      city:         (r['City'] || '').trim(),
      state:        (r['State'] || '').trim(),
      emailAlt:     (r['Email - Alternate'] || '').trim(),
      phoneAlt:     (r['Number - Alternate'] || '').trim(),
      src:          'Lead Pool (Sweta)',
      stage:        'Identified',
      hot:          '',
      lc:           '',
      nc:           '',
      owner:        'Sweta',
      notes:        '',
      addedDate:    parseAddedDate(r['Data Added date'] || ''),
      imported:     today,
      importedFrom: 'sweta_lead_pool'
    };

    batch.push(lead);

    // Track in dedup sets
    if (email)          existEmails.add(email);
    if (pd.length >= 10) existPhones.add(pd);
    if (li)             existLI.add(li);

    // Batch insert
    if (batch.length >= BATCH_SIZE) {
      await leads.insertMany(batch, { ordered: false });
      inserted += batch.length;
      console.log(`  ✅  Inserted batch — ${inserted} total so far (${duped} dupes skipped)`);
      batch = [];
    }
  }

  // Insert remaining
  if (batch.length > 0) {
    await leads.insertMany(batch, { ordered: false });
    inserted += batch.length;
  }

  await client.close();

  console.log('\n' + '═'.repeat(62));
  console.log(`  ✅  Import Complete!`);
  console.log(`  📥  Inserted    : ${inserted} leads`);
  console.log(`  🔁  Duplicates  : ${duped} skipped`);
  console.log(`  👤  Owner       : Sweta`);
  console.log(`  📍  Stage       : Identified (all)`);
  console.log(`\n  🎉  Refresh the CRM — Sweta's lead pool is live!\n`);
  console.log('═'.repeat(62) + '\n');
}

main().catch(err => {
  console.error('❌  Error:', err.message);
  process.exit(1);
});
