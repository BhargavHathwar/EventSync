const express = require('express');
const path = require('path');
const { db, initDatabase, CATEGORIES } = require('./db');
const L = require('./logic');
const { hashPassword, verifyPassword, createSession, requireAuth } = require('./auth');
const { seedIfEmpty } = require('./seed');

const { HttpError } = L;
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure database and initial demo data are ready before any HTTP handler executes
let readyPromise = null;
function ensureReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await initDatabase();
      await seedIfEmpty();
    })();
  }
  return readyPromise;
}

app.use(async (req, res, next) => {
  try {
    await ensureReady();
    next();
  } catch (err) {
    next(err);
  }
});

const h = fn => (req, res, next) => { try { Promise.resolve(fn(req, res)).catch(next); } catch (e) { next(e); } };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);

// Registration validation rules (enforced on the server; the browser mirrors them for convenience)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME_RE = /^[A-Za-z][A-Za-z .'-]{1,59}$/;
// At least 8 characters, with at least one letter and one number
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

function parseEvent(b, { requireFuture }) {
  const f = {
    name: String(b.name || '').trim(), date: String(b.date || ''), start_time: String(b.start_time || ''),
    end_time: String(b.end_time || ''), city: String(b.city || '').trim(), venue: String(b.venue || '').trim(),
    attendees: parseInt(b.attendees, 10), budget: Number(b.budget || 0),
  };
  if (!f.name) throw new HttpError(400, 'Event name is required');
  if (!DATE_RE.test(f.date)) throw new HttpError(400, 'Choose a valid event date');
  if (requireFuture && f.date < today()) throw new HttpError(400, 'Event date cannot be in the past');
  if (!TIME_RE.test(f.start_time) || !TIME_RE.test(f.end_time)) throw new HttpError(400, 'Start and end time are required');
  if (f.end_time <= f.start_time) throw new HttpError(400, 'End time must be after start time');
  if (!f.city) throw new HttpError(400, 'City is required so we can match local vendors');
  if (!Number.isInteger(f.attendees) || f.attendees < 1) throw new HttpError(400, 'Attendees must be at least 1');
  if (!(f.budget >= 0)) throw new HttpError(400, 'Budget must be a positive number');
  return f;
}

function parseVendorProfile(v) {
  const p = {
    name: String(v.name || '').trim(), category: v.category, description: String(v.description || '').trim(),
    package: String(v.package || '').trim(), service_areas: String(v.service_areas || '').trim(),
    max_guests: v.max_guests === '' || v.max_guests == null ? null : parseInt(v.max_guests, 10),
    max_concurrent: parseInt(v.max_concurrent || 1, 10), price: Number(v.price), price_unit: v.price_unit,
  };
  if (!p.name) throw new HttpError(400, 'Business name is required');
  if (!CATEGORIES.includes(p.category)) throw new HttpError(400, 'Choose a service category');
  if (!p.service_areas) throw new HttpError(400, 'Add at least one service area (city)');
  if (!(p.price > 0)) throw new HttpError(400, 'Price must be greater than 0');
  if (!['flat', 'per_guest', 'per_hour'].includes(p.price_unit)) throw new HttpError(400, 'Choose a pricing unit');
  if (p.max_guests !== null && !(p.max_guests > 0)) throw new HttpError(400, 'Max guests must be positive');
  if (!(p.max_concurrent >= 1)) throw new HttpError(400, 'Concurrent events must be at least 1');
  return p;
}

// ---------------- auth ----------------
app.post('/api/auth/register', h(async (req, res) => {
  const { name, email, password, confirmPassword, role } = req.body;

  if (!name || !email || !password || !confirmPassword) throw new HttpError(400, 'All fields are required');

  const cleanName = String(name).trim();
  const cleanEmail = String(email).trim().toLowerCase();

  if (!NAME_RE.test(cleanName)) throw new HttpError(400, 'Name must start with a letter and use only letters, spaces, dots, apostrophes or hyphens');
  if (!EMAIL_RE.test(cleanEmail)) throw new HttpError(400, 'Enter a valid email address, such as name@example.com');
  if (!PASSWORD_RE.test(String(password))) throw new HttpError(400, 'Password must be at least 8 characters and include a letter and a number');
  if (password !== confirmPassword) throw new HttpError(400, 'Passwords do not match');
  if (!['organizer', 'vendor'].includes(role)) throw new HttpError(400, 'Choose organizer or vendor');
  if (await db.prepare('SELECT 1 FROM users WHERE email = ?').get(cleanEmail)) throw new HttpError(409, 'An account with this email already exists');

  const profile = role === 'vendor' ? parseVendorProfile({ ...req.body.vendor, name: req.body.vendor?.name || cleanName }) : null;
  const uid = await db.transaction(async () => {
    const uRes = await db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)')
      .run(cleanName, cleanEmail, hashPassword(password), role);
    const newUid = uRes.lastInsertRowid;
    if (profile) {
      await db.prepare(`INSERT INTO vendors (user_id,name,category,description,package,service_areas,max_guests,max_concurrent,price,price_unit)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(newUid, profile.name, profile.category, profile.description, profile.package,
        profile.service_areas, profile.max_guests, profile.max_concurrent, profile.price, profile.price_unit);
    }
    return newUid;
  })();
  const token = await createSession(uid);
  res.json({ token, user: { id: uid, name: cleanName, email: cleanEmail, role } });
}));

app.post('/api/auth/login', h(async (req, res) => {
  const { email, password } = req.body;
  const u = await db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase());
  if (!u || !verifyPassword(String(password || ''), u.password_hash)) throw new HttpError(401, 'Incorrect email or password');
  const token = await createSession(u.id);
  res.json({ token, user: { id: u.id, name: u.name, email: u.email, role: u.role } });
}));

app.post('/api/auth/logout', requireAuth(), h(async (req, res) => {
  await db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  res.json({ ok: true });
}));

app.get('/api/me', requireAuth(), h((req, res) => res.json({ user: req.user })));
app.get('/api/meta', h((req, res) => res.json({ categories: CATEGORIES })));

// ---------------- notifications ----------------
app.get('/api/notifications', requireAuth(), h(async (req, res) => {
  const items = await db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30').all(req.user.id);
  res.json({ items, unread: items.filter(i => !i.is_read).length });
}));
app.post('/api/notifications/read', requireAuth(), h(async (req, res) => {
  await db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
}));

// ---------------- organizer: events ----------------
app.get('/api/events', requireAuth('organizer'), h(async (req, res) => {
  const events = await db.prepare('SELECT * FROM events WHERE organizer_id = ? ORDER BY date, id').all(req.user.id);
  const withSummary = await Promise.all(events.map(async e => ({ ...e, summary: await L.eventSummary(e.id) })));
  res.json({ events: withSummary });
}));

app.post('/api/events', requireAuth('organizer'), h(async (req, res) => {
  const f = parseEvent(req.body, { requireFuture: true });
  const services = Array.isArray(req.body.services) ? req.body.services : [];
  if (!services.length) throw new HttpError(400, 'Select at least one required service');
  for (const s of services) if (!CATEGORIES.includes(s.category)) throw new HttpError(400, 'Unknown service category');
  if (new Set(services.map(s => s.category)).size !== services.length) throw new HttpError(400, 'Each service can only be added once');

  const id = await db.transaction(async () => {
    const eRes = await db.prepare('INSERT INTO events (organizer_id,name,date,start_time,end_time,city,venue,attendees,budget) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(req.user.id, f.name, f.date, f.start_time, f.end_time, f.city, f.venue, f.attendees, f.budget);
    const eid = eRes.lastInsertRowid;
    const ins = db.prepare('INSERT INTO event_services (event_id,category,budget,notes) VALUES (?,?,?,?)');
    for (const s of services) await ins.run(eid, s.category, s.budget ? Number(s.budget) : null, s.notes || '');
    return eid;
  })();
  res.json({ id });
}));

async function ownedEvent(req) {
  const e = await db.prepare('SELECT * FROM events WHERE id = ? AND organizer_id = ?').get(req.params.id, req.user.id);
  if (!e) throw new HttpError(404, 'Event not found');
  return e;
}

app.get('/api/events/:id', requireAuth('organizer'), h(async (req, res) => {
  const event = await ownedEvent(req);
  const summary = await L.eventSummary(event.id);
  for (const s of summary.services) {
    s.bookings = await db.prepare(`
      SELECT b.*, v.name AS vendor_name, v.rating FROM bookings b JOIN vendors v ON v.id = b.vendor_id
      WHERE b.event_service_id = ? ORDER BY b.id DESC`).all(s.id);
    for (const b of s.bookings) {
      b.history = await db.prepare('SELECT actor, action, note, at FROM booking_history WHERE booking_id = ? ORDER BY id').all(b.id);
    }
  }
  res.json({ event, summary });
}));

app.put('/api/events/:id', requireAuth('organizer'), h(async (req, res) => {
  await ownedEvent(req);
  const f = parseEvent(req.body, { requireFuture: false });
  res.json(await L.updateEvent(Number(req.params.id), req.user.id, f));
}));

app.post('/api/events/:id/services', requireAuth('organizer'), h(async (req, res) => {
  const event = await ownedEvent(req);
  const { category, budget } = req.body;
  if (!CATEGORIES.includes(category)) throw new HttpError(400, 'Unknown service category');
  if (await db.prepare('SELECT 1 FROM event_services WHERE event_id = ? AND category = ?').get(event.id, category)) {
    throw new HttpError(409, 'This event already has that service');
  }
  const resRow = await db.prepare('INSERT INTO event_services (event_id,category,budget) VALUES (?,?,?)')
    .run(event.id, category, budget ? Number(budget) : null);
  res.json({ id: resRow.lastInsertRowid });
}));

// ---------------- organizer: matching + booking requests ----------------
async function ownedService(req) {
  const s = await db.prepare(`SELECT es.* FROM event_services es JOIN events e ON e.id = es.event_id
    WHERE es.id = ? AND e.organizer_id = ?`).get(req.params.id, req.user.id);
  if (!s) throw new HttpError(404, 'Service not found');
  return s;
}

app.get('/api/services/:id/matches', requireAuth('organizer'), h(async (req, res) => {
  await ownedService(req);
  const { matches, excluded, event, service } = await L.matchVendors(Number(req.params.id));
  res.json({ service, event, matches, excluded });
}));

app.post('/api/services/:id/bookings', requireAuth('organizer'), h(async (req, res) => {
  await ownedService(req);
  const vendorId = parseInt(req.body.vendor_id, 10);
  if (!vendorId) throw new HttpError(400, 'Choose a vendor');
  const id = await L.createBooking(Number(req.params.id), vendorId, req.user.id, req.body.message);
  res.json({ id });
}));

// ---------------- booking actions ----------------
app.post('/api/bookings/:id/accept', requireAuth('vendor'), h(async (req, res) => {
  await L.acceptBooking(Number(req.params.id), req.user.id);
  res.json({ ok: true });
}));
app.post('/api/bookings/:id/decline', requireAuth('vendor'), h(async (req, res) => {
  await L.declineBooking(Number(req.params.id), req.user.id, req.body.reason);
  res.json({ ok: true });
}));
app.post('/api/bookings/:id/cancel', requireAuth(), h(async (req, res) => {
  res.json({ status: await L.cancelBooking(Number(req.params.id), req.user, req.body.reason) });
}));

// ---------------- vendor ----------------
async function myVendor(req) {
  const v = await db.prepare('SELECT * FROM vendors WHERE user_id = ?').get(req.user.id);
  if (!v) throw new HttpError(404, 'Vendor profile not found');
  return v;
}

app.get('/api/vendor/profile', requireAuth('vendor'), h(async (req, res) => res.json({ vendor: await myVendor(req) })));
app.put('/api/vendor/profile', requireAuth('vendor'), h(async (req, res) => {
  const v = await myVendor(req);
  const p = parseVendorProfile(req.body);
  await db.prepare(`UPDATE vendors SET name=?,category=?,description=?,package=?,service_areas=?,max_guests=?,max_concurrent=?,price=?,price_unit=? WHERE id=?`)
    .run(p.name, p.category, p.description, p.package, p.service_areas, p.max_guests, p.max_concurrent, p.price, p.price_unit, v.id);
  res.json({ ok: true });
}));

app.get('/api/vendor/bookings', requireAuth('vendor'), h(async (req, res) => {
  const v = await myVendor(req);
  const rows = await db.prepare(`
    SELECT b.*, es.category, e.id AS event_id, e.name AS event_name, e.date, e.start_time, e.end_time,
           e.city, e.venue, e.attendees, u.name AS organizer_name
    FROM bookings b
    JOIN event_services es ON es.id = b.event_service_id
    JOIN events e ON e.id = es.event_id
    JOIN users u ON u.id = e.organizer_id
    WHERE b.vendor_id = ? ORDER BY e.date, e.start_time, b.id`).all(v.id);
  for (const b of rows) {
    if (b.status === 'requested') {
      const ev = { date: b.date, start_time: b.start_time, end_time: b.end_time };
      const clashes = await L.overlappingAccepted(v.id, ev, b.id);
      const blocked = await db.prepare('SELECT reason FROM vendor_blocked_dates WHERE vendor_id=? AND date=?').get(v.id, b.date);
      const issues = [];
      if (blocked) issues.push(`You marked ${b.date} as unavailable`);
      if (clashes.length >= v.max_concurrent) issues.push(`Overlaps confirmed booking "${clashes[0].event_name}" (${clashes[0].start_time}–${clashes[0].end_time})`);
      if (v.max_guests && b.attendees > v.max_guests) issues.push(`Exceeds your ${v.max_guests}-guest limit`);
      b.conflict = issues;
    }
  }
  res.json({ vendor: v, bookings: rows });
}));

app.get('/api/vendor/blocked', requireAuth('vendor'), h(async (req, res) => {
  const v = await myVendor(req);
  res.json({ dates: await db.prepare('SELECT * FROM vendor_blocked_dates WHERE vendor_id = ? ORDER BY date').all(v.id) });
}));
app.post('/api/vendor/blocked', requireAuth('vendor'), h(async (req, res) => {
  const v = await myVendor(req);
  if (!DATE_RE.test(req.body.date || '')) throw new HttpError(400, 'Choose a valid date');
  const clash = await db.prepare(`SELECT e.name FROM bookings b JOIN event_services es ON es.id = b.event_service_id
    JOIN events e ON e.id = es.event_id WHERE b.vendor_id = ? AND b.status = 'accepted' AND e.date = ?`).get(v.id, req.body.date);
  if (clash) throw new HttpError(409, `You already have a confirmed booking that day (${clash.name}). Cancel it first.`);
  await db.prepare('INSERT INTO vendor_blocked_dates (vendor_id,date,reason) VALUES (?,?,?) ON CONFLICT (vendor_id, date) DO UPDATE SET reason = EXCLUDED.reason')
    .run(v.id, req.body.date, req.body.reason || '');
  res.json({ ok: true });
}));
app.delete('/api/vendor/blocked/:id', requireAuth('vendor'), h(async (req, res) => {
  const v = await myVendor(req);
  await db.prepare('DELETE FROM vendor_blocked_dates WHERE id = ? AND vendor_id = ?').run(req.params.id, v.id);
  res.json({ ok: true });
}));

// ---------------- errors ----------------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.data || {}) });
  if (String(err.code || '').startsWith('SQLITE_CONSTRAINT') || err.code === '23505' || err.code === '23503') {
    return res.status(409).json({ error: 'That conflicts with an existing record (possible duplicate request).' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  ensureReady().then(() => {
    app.listen(PORT, () => console.log(`EventSync running (${db.isPostgres ? 'PostgreSQL' : 'SQLite'}) → http://localhost:${PORT}`));
  }).catch(err => {
    console.error('Fatal startup error:', err);
    process.exit(1);
  });
}
module.exports = app;