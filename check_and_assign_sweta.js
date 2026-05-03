/**
 * check_and_assign_sweta.js
 * ─────────────────────────────────────────────────────────────
 * 1. Reports current state of RocketReach leads in MongoDB
 * 2. Assigns all unowned RocketReach leads to Sweta
 *
 * Run from crm-server folder:
 *   node check_and_assign_sweta.js
 */

const { MongoClient } = require('mongodb');

const MONGO = 'mongodb+srv://revuser:Rev%402026@cluster0.nbvsbve.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';

async function main() {
  console.log('\n' + '═'.repeat(56));
  console.log('  RevAvenues CRM — RocketReach → Sweta Assignment Check');
  console.log('═'.repeat(56));

  const client = new MongoClient(MONGO);
  await client.connect();
  console.log('✅  Connected to MongoDB Atlas\n');

  const db    = client.db('readable_crm');
  const leads = db.collection('leads');

  // ── CURRENT STATE ──────────────────────────────────────────
  const total        = await leads.countDocuments({});
  const rrTotal      = await leads.countDocuments({ src: 'RocketReach' });
  const rrSweta      = await leads.countDocuments({ src: 'RocketReach', owner: 'Sweta' });
  const rrBdr1       = await leads.countDocuments({ src: 'RocketReach', owner: 'BDR 1' });
  const rrUnassigned = await leads.countDocuments({ src: 'RocketReach', owner: '' });

  console.log('📊  Current State:');
  console.log(`    Total leads in DB        : ${total}`);
  console.log(`    RocketReach leads        : ${rrTotal}`);
  console.log(`    → Already assigned Sweta : ${rrSweta}`);
  console.log(`    → Still named "BDR 1"   : ${rrBdr1}`);
  console.log(`    → Unassigned (empty)     : ${rrUnassigned}`);

  // Full owner breakdown
  const allLeads = await leads.find({}, { projection: { owner: 1 } }).toArray();
  const ownerMap = {};
  for (const l of allLeads) {
    const o = l.owner || '(empty)';
    ownerMap[o] = (ownerMap[o] || 0) + 1;
  }
  console.log('\n👥  Owner breakdown:', ownerMap);

  // ── FIX: assign unowned RocketReach leads to Sweta ────────
  const needsAssignment = rrUnassigned + rrBdr1;

  if (needsAssignment === 0) {
    console.log('\n✅  All RocketReach leads are already assigned to Sweta. Nothing to do!\n');
  } else {
    console.log(`\n🔧  Assigning ${needsAssignment} leads to Sweta...`);

    let updated = 0;

    // Fix empty-owner RocketReach leads
    if (rrUnassigned > 0) {
      const r1 = await leads.updateMany(
        { src: 'RocketReach', owner: '' },
        { $set: { owner: 'Sweta' } }
      );
      console.log(`    ✓ ${r1.modifiedCount} unassigned leads → Sweta`);
      updated += r1.modifiedCount;
    }

    // Fix any still labelled "BDR 1"
    if (rrBdr1 > 0) {
      const r2 = await leads.updateMany(
        { src: 'RocketReach', owner: 'BDR 1' },
        { $set: { owner: 'Sweta' } }
      );
      console.log(`    ✓ ${r2.modifiedCount} "BDR 1" leads → Sweta`);
      updated += r2.modifiedCount;
    }

    // Verify
    const verify = await leads.countDocuments({ src: 'RocketReach', owner: 'Sweta' });
    console.log(`\n✅  Done! Sweta now owns ${verify} RocketReach leads.`);
  }

  console.log('\n' + '═'.repeat(56) + '\n');
  await client.close();
}

main().catch(err => {
  console.error('❌  Error:', err.message);
  process.exit(1);
});
