// Run with: npm test
// Verifies the three edge cases from the problem statement plus duplicate/date-change handling.
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'eventsync-')), 'test.db');

const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server');

let base;
let server;
test.before(async () => {
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://localhost:${server.address().port}`;
});
test.after(() => server.close());

async function call(method, url, token, body) {
  const r = await fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json() };
}
async function login(email) {
  const r = await call('POST', '/api/auth/login', null, { email, password: 'demo123' });
  assert.equal(r.status, 200);
  return r.data.token;
}
const svc = (ev, cat) => ev.summary.services.find(s => s.category === cat);

test('Case 1: vendor unavailable on event date is excluded with a reason', async () => {
  const org = await login('organizer@demo.com');
  const { data: { events } } = await call('GET', '/api/events', org);
  const techfest = events.find(e => e.name === 'College Tech Fest');
  const photo = svc(techfest, 'photography');
  const { data } = await call('GET', `/api/services/${photo.id}/matches`, org);

  assert.ok(!data.matches.some(m => m.name === 'LensCraft Photography'), 'booked vendor must not be bookable');
  const ex = data.excluded.find(m => m.name === 'LensCraft Photography');
  assert.match(ex.reasons.join(' '), /Already booked/);
  assert.ok(data.matches.length > 0, 'other photographers still offered');

  // capacity: Spice Route (max 250) excluded for a 300-guest event
  const cat = svc(techfest, 'catering');
  const m = (await call('GET', `/api/services/${cat.id}/matches`, org)).data;
  assert.match(m.excluded.find(x => x.name === 'Spice Route Caterers').reasons.join(' '), /Max 250 guests/);
});

test('Case 2: two organizers competing for one vendor - second confirmation is rejected', async () => {
  const org = await login('organizer@demo.com');
  const royal = await login('royalbanquet@demo.com');

  const { data: { events } } = await call('GET', '/api/events', org);
  const techfest = events.find(e => e.name === 'College Tech Fest');
  const cat = svc(techfest, 'catering');
  const matches = (await call('GET', `/api/services/${cat.id}/matches`, org)).data.matches;
  const rb = matches.find(m => m.name === 'Royal Banquet');
  assert.ok(rb, 'Royal Banquet is a valid match');
  assert.equal(rb.competing_requests, 1, 'competing pending request is surfaced');

  // Tech Fest also requests Royal Banquet (pending is not confirmed, so this is allowed)
  const req = await call('POST', `/api/services/${cat.id}/bookings`, org, { vendor_id: rb.vendor_id });
  assert.equal(req.status, 200);

  const { data: { bookings } } = await call('GET', '/api/vendor/bookings', royal);
  const corp = bookings.find(b => b.event_name === 'Corporate Annual Day');
  const tech = bookings.find(b => b.event_name === 'College Tech Fest');
  assert.equal(bookings.length, 2);

  // vendor accepts the first one
  assert.equal((await call('POST', `/api/bookings/${corp.id}/accept`, royal)).status, 200);
  // the overlapping second one is now flagged and cannot be confirmed
  const after = (await call('GET', '/api/vendor/bookings', royal)).data.bookings.find(b => b.id === tech.id);
  assert.ok(after.conflict.length > 0);
  const second = await call('POST', `/api/bookings/${tech.id}/accept`, royal);
  assert.equal(second.status, 409);
  assert.match(second.data.error, /Already booked/);
});

test('Case 3: vendor cancels after confirmation -> attention state, replacement flow', async () => {
  const org = await login('organizer@demo.com');
  const sonic = await login('pulsepro@demo.com');
  const { data: { events } } = await call('GET', '/api/events', org);
  const techfest = events.find(e => e.name === 'College Tech Fest');
  const sound = svc(techfest, 'sound');

  const matches = (await call('GET', `/api/services/${sound.id}/matches`, org)).data.matches;
  const pulse = matches.find(m => m.name === 'PulsePro Sound');
  // BassLine is booked by the other event -> excluded
  assert.ok(!matches.some(m => m.name === 'BassLine Audio'));

  // duplicate protection
  const r1 = await call('POST', `/api/services/${sound.id}/bookings`, org, { vendor_id: pulse.vendor_id });
  assert.equal(r1.status, 200);
  const dup = await call('POST', `/api/services/${sound.id}/bookings`, org, { vendor_id: pulse.vendor_id });
  assert.equal(dup.status, 409);

  assert.equal((await call('POST', `/api/bookings/${r1.data.id}/accept`, sonic)).status, 200);
  let ev = (await call('GET', `/api/events/${techfest.id}`, org)).data;
  assert.equal(svc(ev, 'sound').status, 'confirmed');

  // vendor cancels
  assert.equal((await call('POST', `/api/bookings/${r1.data.id}/cancel`, sonic, { reason: 'Equipment failure' })).status, 200);
  ev = (await call('GET', `/api/events/${techfest.id}`, org)).data;
  assert.equal(svc(ev, 'sound').status, 'attention');
  assert.equal(ev.summary.overall, 'at_risk');

  // cancelled vendor not offered again; others are
  const again = (await call('GET', `/api/services/${sound.id}/matches`, org)).data;
  assert.ok(!again.matches.some(m => m.name === 'PulsePro Sound'));
  assert.match(again.excluded.find(m => m.name === 'PulsePro Sound').reasons.join(' '), /cancelled/);

  // organizer notified
  const notes = (await call('GET', '/api/notifications', org)).data;
  assert.ok(notes.items.some(n => /cancelled/.test(n.message)));

  // replacement requires a NEW request + vendor acceptance (not auto-confirmed)
  const repl = again.matches[0];
  const r2 = await call('POST', `/api/services/${sound.id}/bookings`, org, { vendor_id: repl.vendor_id });
  assert.equal(r2.status, 200);
  ev = (await call('GET', `/api/events/${techfest.id}`, org)).data;
  assert.equal(svc(ev, 'sound').status, 'pending');
});

test('Editing event details forces confirmed bookings to be re-confirmed', async () => {
  const org = await login('organizer2@demo.com');
  const bass = await login('bassline@demo.com');
  const { data: { events } } = await call('GET', '/api/events', org);
  const corp = events.find(e => e.name === 'Corporate Annual Day');
  const detail = (await call('GET', `/api/events/${corp.id}`, org)).data;
  assert.equal(svc(detail, 'sound').status, 'confirmed');

  const e = detail.event;
  const upd = await call('PUT', `/api/events/${corp.id}`, org, { ...e, attendees: 250 });
  assert.equal(upd.status, 200);
  assert.ok(upd.data.reconfirm >= 1);
  const after = (await call('GET', `/api/events/${corp.id}`, org)).data;
  assert.equal(svc(after, 'sound').status, 'pending');
  assert.ok((await call('GET', '/api/notifications', bass)).data.items.length > 0);
});

test('Validation and role protection', async () => {
  const org = await login('organizer@demo.com');
  const bad = await call('POST', '/api/events', org, { name: 'x', date: '2020-01-01', start_time: '10:00', end_time: '12:00', city: 'Bengaluru', attendees: 10, services: [{ category: 'sound' }] });
  assert.equal(bad.status, 400);
  const vendorOnly = await call('GET', '/api/vendor/bookings', org);
  assert.equal(vendorOnly.status, 403);
  assert.equal((await call('GET', '/api/events')).status, 401);
});
