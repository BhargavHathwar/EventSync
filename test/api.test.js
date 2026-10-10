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

test('Organizer can update individual service budget to satisfy requirements', async () => {
  const org = await login('organizer@demo.com');
  // Create an event with tight catering budget (e.g. 50,000)
  const res = await call('POST', '/api/events', org, {
    name: 'Budget Test Gala', date: '2026-12-25', start_time: '18:00', end_time: '22:00',
    city: 'Bengaluru', attendees: 100, budget: 100000,
    services: [{ category: 'catering', budget: 20000 }]
  });
  assert.equal(res.status, 200);
  const eventId = res.data.id;
  const ev = (await call('GET', `/api/events/${eventId}`, org)).data;
  const catering = svc(ev, 'catering');

  // Check matching: Royal Banquet (quote ~75k) should be excluded due to budget
  const m1 = (await call('GET', `/api/services/${catering.id}/matches`, org)).data;
  const royalEx = m1.excluded.find(x => x.name === 'Royal Banquet');
  assert.ok(royalEx, 'Royal Banquet should be excluded initially due to low budget');
  assert.match(royalEx.reasons.join(' '), /exceeds service budget/);

  // Organizer increases individual service budget to 90,000
  const upd = await call('PUT', `/api/services/${catering.id}`, org, { budget: 90000 });
  assert.equal(upd.status, 200);
  assert.equal(upd.data.budget, 90000);

  // Now Royal Banquet satisfies the budget requirement and is in matches!
  const m2 = (await call('GET', `/api/services/${catering.id}/matches`, org)).data;
  const royalMatch = m2.matches.find(x => x.name === 'Royal Banquet');
  assert.ok(royalMatch, 'Royal Banquet should now be a valid match after budget change');
});

test('Organizer can cancel an event and booked vendors receive cancellation notification', async () => {
  const org = await login('organizer2@demo.com');
  const bass = await login('bassline@demo.com');

  // Find Corporate Annual Day which has bassline confirmed
  const { data: { events } } = await call('GET', '/api/events', org);
  const corp = events.find(e => e.name === 'Corporate Annual Day');
  assert.ok(corp);

  // Cancel the event
  const del = await call('DELETE', `/api/events/${corp.id}`, org);
  assert.equal(del.status, 200);

  // BassLine vendor should have received a cancellation notice
  const notifs = (await call('GET', '/api/notifications', bass)).data;
  assert.ok(notifs.items.some(n => /Corporate Annual Day.*was cancelled/i.test(n.message)));

  // Event should no longer exist
  const check = await call('GET', `/api/events/${corp.id}`, org);
  assert.equal(check.status, 404);
});

test('Vendor matches return a calculated probability score out of 100% based on requirements', async () => {
  const org = await login('organizer@demo.com');
  const { data: { events } } = await call('GET', '/api/events', org);
  const techfest = events.find(e => e.name === 'College Tech Fest');
  const cat = svc(techfest, 'catering');
  const { data } = await call('GET', `/api/services/${cat.id}/matches`, org);

  assert.ok(data.matches.length > 0);
  for (const m of data.matches) {
    assert.equal(typeof m.match_probability, 'number');
    assert.ok(m.match_probability >= 0 && m.match_probability <= 100, 'probability must be 0-100%');
    assert.ok(Array.isArray(m.probability_factors) && m.probability_factors.length > 0);
  }
  // Matches should be sorted primarily by highest probability
  for (let i = 0; i < data.matches.length - 1; i++) {
    assert.ok(data.matches[i].match_probability >= data.matches[i + 1].match_probability);
  }
});

test('Chat and messaging between organizer and vendor', async () => {
  const orgToken = await login('organizer@demo.com');
  const vendorToken = await login('royalbanquet@demo.com');

  // Find user IDs
  const orgMe = (await call('GET', '/api/me', orgToken)).data.user;
  const vendorMe = (await call('GET', '/api/me', vendorToken)).data.user;

  // Initial unread count for vendor should be 0
  const unreadBefore = (await call('GET', '/api/messages/unread/count', vendorToken)).data.unread;

  // Organizer sends a message to the vendor
  const sendRes = await call('POST', '/api/messages', orgToken, {
    receiver_id: vendorMe.id,
    text: 'Hello Royal Banquet, can you provide a customized vegan menu option?'
  });
  assert.equal(sendRes.status, 200);
  assert.equal(sendRes.data.ok, true);
  assert.equal(sendRes.data.message.sender_id, orgMe.id);
  assert.equal(sendRes.data.message.receiver_id, vendorMe.id);
  assert.equal(sendRes.data.message.text, 'Hello Royal Banquet, can you provide a customized vegan menu option?');

  // Vendor's unread count should increase by 1
  const unreadAfter = (await call('GET', '/api/messages/unread/count', vendorToken)).data.unread;
  assert.equal(unreadAfter, unreadBefore + 1);

  // Vendor should have received a notification
  const vendorNotifs = (await call('GET', '/api/notifications', vendorToken)).data.items;
  assert.ok(vendorNotifs.some(n => n.message.includes('customized vegan menu')));

  // Vendor checks conversations list
  const convList = (await call('GET', '/api/conversations', vendorToken)).data.conversations;
  const orgConv = convList.find(c => c.partner_id === orgMe.id);
  assert.ok(orgConv, 'Organizer should appear in vendor conversations list');
  assert.equal(orgConv.unread_count, 1);

  // Vendor reads the messages from the organizer
  const threadRes = await call('GET', `/api/messages/${orgMe.id}`, vendorToken);
  assert.equal(threadRes.status, 200);
  assert.equal(threadRes.data.messages.length, 1);
  assert.equal(threadRes.data.messages[0].is_read, 1, 'Message must be marked read upon fetch');
  assert.equal(threadRes.data.partner.id, orgMe.id);

  // Vendor unread count drops back
  const unreadAfterRead = (await call('GET', '/api/messages/unread/count', vendorToken)).data.unread;
  assert.equal(unreadAfterRead, unreadBefore);

  // Vendor sends reply
  const replyRes = await call('POST', '/api/messages', vendorToken, {
    receiver_id: orgMe.id,
    text: 'Yes absolutely! We can accommodate any dietary restrictions.'
  });
  assert.equal(replyRes.status, 200);

  // Organizer fetches thread and verifies both messages
  const orgThread = (await call('GET', `/api/messages/${vendorMe.id}`, orgToken)).data;
  assert.equal(orgThread.messages.length, 2);
  assert.equal(orgThread.messages[0].sender_id, orgMe.id);
  assert.equal(orgThread.messages[1].sender_id, vendorMe.id);
  assert.match(orgThread.messages[1].text, /accommodate any dietary/);

  // Validation: cannot send empty message
  const emptyRes = await call('POST', '/api/messages', orgToken, {
    receiver_id: vendorMe.id,
    text: '   '
  });
  assert.equal(emptyRes.status, 400);
});


