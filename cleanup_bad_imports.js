/**
 * cleanup_bad_imports.js
 * Removes all leads imported from Sweta's sheets so we can re-import cleanly.
 * Run: node cleanup_bad_imports.js
 */
const { MongoClient } = require('mongodb');
const MONGO = 'mongodb+srv://revuser:Rev%402026@cluster0.nbvsbve.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';

async function main() {
  const client = new MongoClient(MONGO);
  await client.connect();
  const leads = client.db('readable_crm').collection('leads');

  const before = await leads.countDocuments({});
  const r = await leads.deleteMany({
    importedFrom: { $in: ['sweta_followup_sheet', 'sweta_lead_pool'] }
  });
  const after = await leads.countDocuments({});

  console.log(`\n✅  Removed ${r.deletedCount} bad imports`);
  console.log(`📊  Leads before: ${before} → after: ${after}\n`);
  await client.close();
}
main().catch(console.error);
