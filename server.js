/**
 * RevAvenues — Readable.ai Sales CRM Server
 * ==========================================
 * Multi-user CRM with admin + BDR role-based access.
 *
 * HOW TO START:
 *   npm install
 *   node server.js
 *
 * HOW TO SHARE WITH BDRs OVER INTERNET:
 *   1. Install ngrok: https://ngrok.com/download
 *   2. In a new terminal tab: ngrok http 3000
 *   3. Share the https://xxxx.ngrok.io URL with your BDRs
 *
 * DEFAULT LOGINS:
 *   Admin  → priyank   / Admin@2026
 *   BDRs   → anupama   / Bdr@2026
 *            bdr1      / Bdr@2026
 *            bdr2      / Bdr@2026
 *            bdr3      / Bdr@2026
 */

const express = require('express');
const session = require('express-session');
const fs      = require('fs');
const path    = require('path');

const app     = express();
const PORT    = 3000;
const DB_PATH = path.join(__dirname, 'db.json');

// ── MIDDLEWARE ─────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'revavenues-readable-crm-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 10 * 60 * 60 * 1000 }  // 10 hours
}));

// ── DB HELPERS ─────────────────────────────────────────────────────────────────
function readDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}
function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}
function logActivity(db, user, action, leadName, leadCo) {
  db.activity.unshift({
    id: Date.now() + Math.random(),
    userId: user.id,
    userName: user.name,
    action,
    leadName: leadName || '',
    leadCo: leadCo || '',
    timestamp: new Date().toISOString()
  });
  if (db.activity.length > 500) db.activity = db.activity.slice(0, 500);
}

// ── AUTH MIDDLEWARE ────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Please log in' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin')
    return res.status(403).json({ error: 'Admin access required' });
  next();
}

// ── AUTH ROUTES ────────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const db   = readDB();
  const user = db.users.find(u => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });
  req.session.user = { id: user.id, name: user.name, username: user.username, role: user.role };
  logActivity(db, req.session.user, 'Logged in', '', '');
  writeDB(db);
  res.json({ success: true, user: req.session.user });
});

app.post('/api/logout', requireAuth, (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  res.json(req.session.user);
});

// ── LEAD ROUTES ────────────────────────────────────────────────────────────────

// GET all leads (BDRs see only their own)
app.get('/api/leads', requireAuth, (req, res) => {
  const db = readDB();
  const leads = req.session.user.role === 'bdr'
    ? db.leads.filter(l => l.owner === req.session.user.name)
    : db.leads;
  res.json(leads);
});

// POST — add new lead
app.post('/api/leads', requireAuth, (req, res) => {
  const db   = readDB();
  const lead = {
    ...req.body,
    id:    Date.now(),
    stage: req.body.stage || 'Identified',
    src:   req.body.src   || 'Manual Entry',
    owner: req.session.user.role === 'bdr' ? req.session.user.name : (req.body.owner || req.session.user.name)
  };
  db.leads.push(lead);
  logActivity(db, req.session.user, 'Added new lead', lead.name, lead.co);
  writeDB(db);
  res.json(lead);
});

// PUT — update lead
app.put('/api/leads/:id', requireAuth, (req, res) => {
  const db  = readDB();
  const idx = db.leads.findIndex(l => String(l.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Lead not found' });

  const old = db.leads[idx];
  // BDRs can only update their own leads
  if (req.session.user.role === 'bdr' && old.owner !== req.session.user.name)
    return res.status(403).json({ error: 'You can only update your own leads' });

  const updated = { ...old, ...req.body, id: old.id };
  db.leads[idx] = updated;

  // Describe what changed for the activity log
  let action = 'Updated lead';
  if (old.stage !== updated.stage)   action = `Stage: ${old.stage} → ${updated.stage}`;
  else if (old.lc !== updated.lc)    action = `Logged call on ${updated.lc}`;
  else if (old.nc !== updated.nc)    action = `Set next call ${updated.nc}`;
  else if (old.notes !== updated.notes) action = 'Updated notes';

  logActivity(db, req.session.user, action, updated.name, updated.co);
  writeDB(db);
  res.json(updated);
});

// DELETE — admin only
app.delete('/api/leads/:id', requireAdmin, (req, res) => {
  const db   = readDB();
  const lead = db.leads.find(l => String(l.id) === String(req.params.id));
  db.leads   = db.leads.filter(l => String(l.id) !== String(req.params.id));
  if (lead) logActivity(db, req.session.user, 'Deleted lead', lead.name, lead.co);
  writeDB(db);
  res.json({ success: true });
});

// ── ACTIVITY & STATS ───────────────────────────────────────────────────────────

// GET recent activity (admin: all, BDR: own only)
app.get('/api/activity', requireAuth, (req, res) => {
  const db    = readDB();
  const limit = parseInt(req.query.limit) || 60;
  const list  = req.session.user.role === 'bdr'
    ? db.activity.filter(a => a.userId === req.session.user.id)
    : db.activity;
  res.json(list.slice(0, limit));
});

// GET per-BDR stats — admin only
app.get('/api/bdr-stats', requireAdmin, (req, res) => {
  const db    = readDB();
  const today = new Date().toISOString().split('T')[0];
  const bdrs  = db.users.filter(u => u.role === 'bdr');

  const stats = bdrs.map(u => {
    const myLeads    = db.leads.filter(l => l.owner === u.name);
    const actToday   = db.activity.filter(a => a.userId === u.id && a.timestamp.startsWith(today) && a.action !== 'Logged in');
    const overdue    = myLeads.filter(l => l.nc && l.nc < today && !['Closed Won','Closed Lost'].includes(l.stage));
    const advanced   = myLeads.filter(l => ['Demo Booked','Demo Done','Proposal Sent','Negotiation','Closed Won'].includes(l.stage));
    const lastAction = db.activity.find(a => a.userId === u.id && a.action !== 'Logged in');
    return {
      id:          u.id,
      name:        u.name,
      username:    u.username,
      total:       myLeads.length,
      actionsToday:actToday.length,
      overdue:     overdue.length,
      advanced:    advanced.length,
      closedWon:   myLeads.filter(l => l.stage === 'Closed Won').length,
      lastActive:  lastAction ? lastAction.timestamp : null
    };
  });
  res.json(stats);
});

// GET users list — admin only
app.get('/api/users', requireAdmin, (req, res) => {
  const db = readDB();
  res.json(db.users.map(u => ({ id: u.id, name: u.name, username: u.username, role: u.role })));
});

// ── CHANGE PASSWORD ────────────────────────────────────────────────────────────
app.post('/api/change-password', requireAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const db  = readDB();
  const idx = db.users.findIndex(u => u.id === req.session.user.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  if (db.users[idx].password !== oldPassword) return res.status(401).json({ error: 'Current password is incorrect' });
  db.users[idx].password = newPassword;
  writeDB(db);
  res.json({ success: true });
});

// ── FALLBACK ───────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ── START ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  const line = '═'.repeat(56);
  console.log(`\n${line}`);
  console.log(`  ✅  RevAvenues CRM — Readable.ai Sales Command Center`);
  console.log(`${line}`);
  console.log(`  🌐  Local URL:   http://localhost:${PORT}`);
  console.log(`  👤  Admin login: priyank   / Admin@2026`);
  console.log(`  👥  BDR logins:  anupama   / Bdr@2026`);
  console.log(`                   bdr1      / Bdr@2026`);
  console.log(`                   bdr2      / Bdr@2026`);
  console.log(`                   bdr3      / Bdr@2026`);
  console.log(`${line}`);
  console.log(`  📡  To share with remote BDRs:`);
  console.log(`      1. Install ngrok: https://ngrok.com/download`);
  console.log(`      2. Run in a new tab: ngrok http ${PORT}`);
  console.log(`      3. Share the https://xxxx.ngrok-free.app URL`);
  console.log(`${line}\n`);
});
