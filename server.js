/**
 * RevAvenues — Readable.ai Sales CRM Server
 * ==========================================
 * Multi-user CRM with admin + BDR role-based access.
 * Uses MongoDB Atlas for persistent cloud storage.
 *
 * ENVIRONMENT VARIABLES (set in Render dashboard):
 *   MONGODB_URI   — your MongoDB Atlas connection string
 *   SESSION_SECRET — any long random string (optional, has default)
 *   PORT          — set automatically by Render
 *
 * LOCAL DEVELOPMENT:
 *   1. npm install
 *   2. Create .env file with: MONGODB_URI=your_atlas_connection_string
 *      OR just set MONGODB_URI in your terminal before running
 *   3. node server.js
 *
 * DEFAULT LOGINS:
 *   Admin  → priyank   / Admin@2026
 *   BDRs   → anupama   / Bdr@2026
 *            bdr1      / Bdr@2026
 *            bdr2      / Bdr@2026
 *            bdr3      / Bdr@2026
 */

const express   = require('express');
const session   = require('express-session');
const { MongoClient, ObjectId } = require('mongodb');
const path      = require('path');

const app    = express();
const PORT   = process.env.PORT || 3000;
const MONGO  = process.env.MONGODB_URI || '';
const SECRET = process.env.SESSION_SECRET || 'revavenues-readable-crm-2026';

if (!MONGO) {
  console.error('\n❌  MONGODB_URI environment variable is not set.');
  console.error('    Set it in your terminal: export MONGODB_URI="mongodb+srv://..."');
  console.error('    Or add it in the Render dashboard under Environment Variables.\n');
  process.exit(1);
}

// ── MONGODB CONNECTION ─────────────────────────────────────────────────────────
let db;
const client = new MongoClient(MONGO);

async function connectDB() {
  await client.connect();
  db = client.db('readable_crm');
  console.log('✅  Connected to MongoDB Atlas');
  await seedInitialData();
}

// ── SEED INITIAL DATA (runs only if collections are empty) ────────────────────
async function seedInitialData() {
  const userCount = await db.collection('users').countDocuments();
  if (userCount === 0) {
    await db.collection('users').insertMany([
      {id:'admin',  name:'Priyank',  username:'priyank',  password:'Admin@2026', role:'admin'},
      {id:'anupama',name:'Anupama',  username:'anupama',  password:'Bdr@2026',   role:'bdr'},
      {id:'bdr1',   name:'BDR 1',    username:'bdr1',     password:'Bdr@2026',   role:'bdr'},
      {id:'bdr2',   name:'BDR 2',    username:'bdr2',     password:'Bdr@2026',   role:'bdr'},
      {id:'bdr3',   name:'BDR 3',    username:'bdr3',     password:'Bdr@2026',   role:'bdr'}
    ]);
    console.log('✅  Default users created');
  }

  const leadCount = await db.collection('leads').countDocuments();
  if (leadCount === 0) {
    await db.collection('leads').insertMany([
      {id:1, name:'Arjun Mehta',    co:'ICICI Bank',           desg:'Head of Digital Innovation', ind:'BFSI / Fintech',   email:'arjun.m@icici.com',          phone:'+91 98200 11111', li:'linkedin.com/in/arjunmehta',    src:'LinkedIn Outreach',          stage:'Contacted',      lc:'2026-04-22', nc:'2026-05-02', owner:'Anupama',  notes:"Concerned about ICICI's visibility in AI search vs HDFC and Axis."},
      {id:2, name:'Priya Kapoor',   co:'Meesho',               desg:'Chief Marketing Officer',    ind:'Retail / D2C',     email:'priya.k@meesho.com',         phone:'+91 98100 22222', li:'linkedin.com/in/priyakapoor',   src:'Cold Email',                 stage:'Discovery Done', lc:'2026-04-25', nc:'2026-04-30', owner:'BDR 1',    notes:'Organic traffic down 20% YoY. Ready for demo.'},
      {id:3, name:'Siddharth Rao',  co:'Mphasis',              desg:'AI Implementation Lead',     ind:'IT / SaaS',        email:'sid.rao@mphasis.com',        phone:'+91 99000 33333', li:'linkedin.com/in/sidrao',        src:'RevAvenues.ai Marketplace',  stage:'Demo Booked',    lc:'2026-04-20', nc:'2026-05-05', owner:'Anupama',  notes:'Demo May 5. Wants live AI visibility audit vs TCS/Infosys.'},
      {id:4, name:'Neha Joshi',     co:'Marico',               desg:'Innovation Head',            ind:'Retail / D2C',     email:'neha.j@marico.com',          phone:'+91 97300 44444', li:'linkedin.com/in/nehajoshi',     src:'LinkedIn Outreach',          stage:'Identified',     lc:'',           nc:'2026-05-01', owner:'BDR 2',    notes:'Posted on LinkedIn about AI changing consumer discovery.'},
      {id:5, name:'Vikram Singh',   co:'Max Life Insurance',   desg:'Chief Digital Officer',      ind:'BFSI / Fintech',   email:'vikram.s@maxlife.com',       phone:'+91 96100 55555', li:'linkedin.com/in/vikrams',       src:'Referral',                   stage:'Proposal Sent',  lc:'2026-04-28', nc:'2026-05-03', owner:'Anupama',  notes:'Proposal sent. Key concern: proving AI citations lead to leads.'},
      {id:6, name:'Deepika Anand',  co:'Godrej Properties',    desg:'Head of Digital Marketing',  ind:'Other',            email:'deepika.a@godrej.com',       phone:'+91 98500 66666', li:'linkedin.com/in/deepikaanand',  src:'LinkedIn Outreach',          stage:'Contacted',      lc:'2026-04-18', nc:'2026-04-30', owner:'BDR 3',    notes:'Responded to LinkedIn DM warmly.'},
      {id:7, name:'Rohit Nair',     co:'Lenskart',             desg:'Founder & CEO',              ind:'Retail / D2C',     email:'rohit@lenskart.com',         phone:'+91 95500 77777', li:'linkedin.com/in/rohitnair',     src:'Event / Conference',         stage:'Demo Done',      lc:'2026-04-26', nc:'2026-05-02', owner:'Anupama',  notes:'Demo went well. Wants proposal for full AI visibility program.'},
      {id:8, name:'Aisha Khan',     co:'Pristyn Care',         desg:'Head of Marketing',          ind:'Healthcare',       email:'aisha.k@pristyncare.com',    phone:'+91 94400 88888', li:'linkedin.com/in/aishakhan',     src:'Cold Email',                 stage:'Identified',     lc:'',           nc:'2026-05-03', owner:'BDR 1',    notes:'Big opportunity for AI recommendation for elective surgery queries.'},
      {id:9, name:'Kartik Bhatia',  co:'Angel One',            desg:'Head of Innovation',         ind:'BFSI / Fintech',   email:'kartik.b@angelone.in',       phone:'+91 93300 99999', li:'linkedin.com/in/kartikbhatia',  src:'LinkedIn Outreach',          stage:'Contacted',      lc:'2026-04-24', nc:'2026-05-04', owner:'BDR 2',    notes:'Zerodha and Groww dominating AI search. Strong pain point.'},
      {id:10,name:'Sneha Tiwari',   co:'Tata Communications',  desg:'AI Implementation Head',     ind:'IT / SaaS',        email:'sneha.t@tatacommunications.com', phone:'+91 92200 10000', li:'linkedin.com/in/snehatiwari', src:'RevAvenues.ai Marketplace', stage:'Negotiation',    lc:'2026-04-29', nc:'2026-05-01', owner:'Anupama',  notes:'Negotiating enterprise scope. Loop in Priyank for final sign-off.'}
    ]);
    console.log('✅  Sample leads seeded');
  }
}

// ── MIDDLEWARE ─────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 10 * 60 * 60 * 1000 }   // 10 hours
}));

// ── HELPERS ────────────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Please log in' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin')
    return res.status(403).json({ error: 'Admin access required' });
  next();
}
async function logActivity(user, action, leadName = '', leadCo = '') {
  await db.collection('activity').insertOne({
    userId:    user.id,
    userName:  user.name,
    action,
    leadName,
    leadCo,
    timestamp: new Date().toISOString()
  });
}

// ── AUTH ───────────────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await db.collection('users').findOne({ username, password });
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });
  req.session.user = { id: user.id, name: user.name, username: user.username, role: user.role };
  await logActivity(req.session.user, 'Logged in');
  res.json({ success: true, user: req.session.user });
});

app.post('/api/logout', requireAuth, async (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  res.json(req.session.user);
});

app.post('/api/change-password', requireAuth, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const user = await db.collection('users').findOne({ id: req.session.user.id });
  if (!user || user.password !== oldPassword)
    return res.status(401).json({ error: 'Current password is incorrect' });
  await db.collection('users').updateOne({ id: req.session.user.id }, { $set: { password: newPassword } });
  res.json({ success: true });
});

// ── LEADS ──────────────────────────────────────────────────────────────────────
app.get('/api/leads', requireAuth, async (req, res) => {
  const query = req.session.user.role === 'bdr' ? { owner: req.session.user.name } : {};
  const leads = await db.collection('leads').find(query, { projection: { _id: 0 } }).toArray();
  res.json(leads);
});

app.post('/api/leads', requireAuth, async (req, res) => {
  const lead = {
    ...req.body,
    id:    Date.now(),
    stage: req.body.stage || 'Identified',
    src:   req.body.src   || 'Manual Entry',
    owner: req.session.user.role === 'bdr'
             ? req.session.user.name
             : (req.body.owner || req.session.user.name)
  };
  await db.collection('leads').insertOne(lead);
  await logActivity(req.session.user, 'Added new lead', lead.name, lead.co);
  res.json(lead);
});

app.put('/api/leads/:id', requireAuth, async (req, res) => {
  const lead = await db.collection('leads').findOne({ id: Number(req.params.id) || req.params.id });
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  if (req.session.user.role === 'bdr' && lead.owner !== req.session.user.name)
    return res.status(403).json({ error: 'You can only update your own leads' });

  const updated = { ...lead, ...req.body, id: lead.id };
  delete updated._id;
  await db.collection('leads').replaceOne({ id: lead.id }, updated);

  let action = 'Updated lead';
  if (lead.stage !== updated.stage)   action = `Stage: ${lead.stage} → ${updated.stage}`;
  else if (lead.lc !== updated.lc)    action = `Logged call on ${updated.lc}`;
  else if (lead.nc !== updated.nc)    action = `Set next call ${updated.nc}`;
  else if (lead.owner !== updated.owner) action = `Reassigned to ${updated.owner}`;
  else if (lead.notes !== updated.notes) action = 'Updated notes';

  await logActivity(req.session.user, action, updated.name, updated.co);
  res.json(updated);
});

app.delete('/api/leads/:id', requireAdmin, async (req, res) => {
  const id   = Number(req.params.id) || req.params.id;
  const lead = await db.collection('leads').findOne({ id });
  await db.collection('leads').deleteOne({ id });
  if (lead) await logActivity(req.session.user, 'Deleted lead', lead.name, lead.co);
  res.json({ success: true });
});

// ── ACTIVITY & STATS ───────────────────────────────────────────────────────────
app.get('/api/activity', requireAuth, async (req, res) => {
  const limit = parseInt(req.query.limit) || 60;
  const query = req.session.user.role === 'bdr' ? { userId: req.session.user.id } : {};
  const list  = await db.collection('activity')
    .find(query, { projection: { _id: 0 } })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();
  res.json(list);
});

app.get('/api/bdr-stats', requireAdmin, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const bdrs  = await db.collection('users').find({ role: 'bdr' }, { projection: { _id: 0 } }).toArray();
  const leads = await db.collection('leads').find({}, { projection: { _id: 0 } }).toArray();

  const stats = await Promise.all(bdrs.map(async u => {
    const myLeads   = leads.filter(l => l.owner === u.name);
    const actToday  = await db.collection('activity').countDocuments({
      userId: u.id, timestamp: { $gte: today }, action: { $ne: 'Logged in' }
    });
    const overdue   = myLeads.filter(l => l.nc && l.nc < today && !['Closed Won','Closed Lost'].includes(l.stage));
    const advanced  = myLeads.filter(l => ['Demo Booked','Demo Done','Proposal Sent','Negotiation','Closed Won'].includes(l.stage));
    const lastAct   = await db.collection('activity').findOne(
      { userId: u.id, action: { $ne: 'Logged in' } },
      { sort: { timestamp: -1 }, projection: { _id: 0 } }
    );
    return {
      id: u.id, name: u.name, username: u.username,
      total:        myLeads.length,
      actionsToday: actToday,
      overdue:      overdue.length,
      advanced:     advanced.length,
      closedWon:    myLeads.filter(l => l.stage === 'Closed Won').length,
      lastActive:   lastAct ? lastAct.timestamp : null
    };
  }));
  res.json(stats);
});

app.get('/api/users', requireAdmin, async (req, res) => {
  const users = await db.collection('users').find({}, { projection: { _id: 0, password: 0 } }).toArray();
  res.json(users);
});

// PUT /api/users/:id — admin updates a BDR's name, username, or password
app.put('/api/users/:id', requireAdmin, async (req, res) => {
  const { name, username, password } = req.body;
  const user = await db.collection('users').findOne({ id: req.params.id });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const oldName = user.name;
  const updates = {};
  if (name)     updates.name     = name;
  if (username) updates.username = username;
  if (password) updates.password = password;

  await db.collection('users').updateOne({ id: req.params.id }, { $set: updates });

  // If name changed, update all leads owned by this BDR
  if (name && name !== oldName) {
    const result = await db.collection('leads').updateMany({ owner: oldName }, { $set: { owner: name } });
    await logActivity(req.session.user, `Renamed ${oldName} → ${name} (${result.modifiedCount} leads updated)`);
  }

  res.json({ success: true });
});

// ── FALLBACK ───────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ── START ──────────────────────────────────────────────────────────────────────
connectDB().then(() => {
  app.listen(PORT, () => {
    const line = '═'.repeat(58);
    console.log(`\n${line}`);
    console.log(`  ✅  RevAvenues CRM — Readable.ai Sales Command Center`);
    console.log(`${line}`);
    console.log(`  🌐  URL:         http://localhost:${PORT}`);
    console.log(`  👤  Admin:       priyank   / Admin@2026`);
    console.log(`  👥  BDRs:        anupama   / Bdr@2026`);
    console.log(`                   bdr1–bdr3 / Bdr@2026`);
    console.log(`${line}\n`);
  });
}).catch(err => {
  console.error('❌  Failed to connect to MongoDB:', err.message);
  process.exit(1);
});
