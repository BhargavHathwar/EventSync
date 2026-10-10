// EventSync - business rules: matching engine, conflict checks, booking lifecycle.
const { db } = require('./db');

class HttpError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

const ACTIVE = ['requested', 'accepted'];

// ---------- helpers ----------
function hoursBetween(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return Math.max(0, (eh * 60 + em - (sh * 60 + sm)) / 60);
}

function quoteFor(vendor, event) {
  if (vendor.price_unit === 'per_guest') return vendor.price * event.attendees;
  if (vendor.price_unit === 'per_hour') return vendor.price * hoursBetween(event.start_time, event.end_time);
  return vendor.price;
}

function inr(n) {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

// Confirmed (accepted) bookings of a vendor overlapping the event's time window.
function overlappingAccepted(vendorId, event, excludeBookingId = 0) {
  return db.prepare(`
    SELECT b.id, e.name AS event_name, e.start_time, e.end_time
    FROM bookings b
    JOIN event_services es ON es.id = b.event_service_id
    JOIN events e ON e.id = es.event_id
    WHERE b.vendor_id = ? AND b.status = 'accepted' AND b.id != ?
      AND e.date = ? AND e.start_time < ? AND ? < e.end_time
  `).all(vendorId, excludeBookingId, event.date, event.end_time, event.start_time);
}

function pendingOverlapCount(vendorId, event, excludeEventId) {
  return db.prepare(`
    SELECT COUNT(*) AS c
    FROM bookings b
    JOIN event_services es ON es.id = b.event_service_id
    JOIN events e ON e.id = es.event_id
    WHERE b.vendor_id = ? AND b.status = 'requested' AND e.id != ?
      AND e.date = ? AND e.start_time < ? AND ? < e.end_time
  `).get(vendorId, excludeEventId, event.date, event.end_time, event.start_time).c;
}

function isBlocked(vendorId, date) {
  return db.prepare('SELECT reason FROM vendor_blocked_dates WHERE vendor_id = ? AND date = ?').get(vendorId, date);
}

// Hard-requirement check shared by matching, booking creation and acceptance.
// Returns { failures: [..] } - an empty list means the vendor can serve the event.
function checkHardRequirements(vendor, event, service, { excludeBookingId = 0, checkBudget = true } = {}) {
  const failures = [];

  if (vendor.category !== service.category) {
    failures.push({ code: 'service', message: `Offers ${vendor.category}, not ${service.category}` });
  }

  const areas = vendor.service_areas.split(',').map(a => a.trim().toLowerCase());
  if (!areas.includes(event.city.trim().toLowerCase())) {
    failures.push({ code: 'location', message: `Does not serve ${event.city} (serves ${vendor.service_areas})` });
  }

  if (vendor.max_guests && event.attendees > vendor.max_guests) {
    failures.push({ code: 'capacity', message: `Max ${vendor.max_guests} guests, event has ${event.attendees}` });
  }

  const blocked = isBlocked(vendor.id, event.date);
  if (blocked) {
    failures.push({ code: 'unavailable', message: `Marked unavailable on ${event.date}${blocked.reason ? ' (' + blocked.reason + ')' : ''}` });
  }

  const clashes = overlappingAccepted(vendor.id, event, excludeBookingId);
  if (clashes.length >= vendor.max_concurrent) {
    const c = clashes[0];
    failures.push({ code: 'booked', message: `Already booked ${c.start_time}–${c.end_time} on ${event.date}` });
  }

  const quote = quoteFor(vendor, event);
  if (checkBudget && service.budget && quote > service.budget) {
    failures.push({ code: 'budget', message: `Quote ${inr(quote)} exceeds service budget ${inr(service.budget)}` });
  }

  return { failures, quote };
}

// ---------- matching engine ----------
function matchVendors(serviceId) {
  const service = db.prepare('SELECT * FROM event_services WHERE id = ?').get(serviceId);
  if (!service) throw new HttpError(404, 'Service not found');
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(service.event_id);
  const vendors = db.prepare('SELECT * FROM vendors WHERE category = ?').all(service.category);

  const history = db.prepare('SELECT vendor_id, status FROM bookings WHERE event_service_id = ?').all(serviceId);
  const activeVendor = history.find(h => ACTIVE.includes(h.status));

  const matches = [];
  const excluded = [];

  for (const v of vendors) {
    const { failures, quote } = checkHardRequirements(v, event, service);
    const prev = history.filter(h => h.vendor_id === v.id && ['declined', 'cancelled'].includes(h.status));
    if (prev.length) {
      failures.push({ code: 'previous', message: `Already ${prev[prev.length - 1].status} this service` });
    }
    if (activeVendor && activeVendor.vendor_id === v.id) {
      failures.push({ code: 'active', message: `Request already ${activeVendor.status}` });
    }

    const card = {
      vendor_id: v.id, name: v.name, description: v.description, package: v.package,
      rating: v.rating, price: v.price, price_unit: v.price_unit, quote,
      max_guests: v.max_guests, service_areas: v.service_areas,
      competing_requests: pendingOverlapCount(v.id, event, event.id),
    };

    if (failures.length) excluded.push({ ...card, reasons: failures.map(f => f.message) });
    else {
      const reasons = [
        `Offers ${service.category}`,
        `Serves ${event.city}`,
        `Free on ${event.date} ${event.start_time}–${event.end_time}`,
        v.max_guests ? `Handles up to ${v.max_guests} guests (need ${event.attendees})` : 'No guest limit',
      ];
      if (service.budget) reasons.push(`Quote ${inr(quote)} within budget ${inr(service.budget)}`);
      matches.push({ ...card, reasons });
    }
  }

  // Preferences only rank vendors that already satisfy every hard requirement.
  matches.sort((a, b) => a.quote - b.quote || b.rating - a.rating);
  return { service, event, matches, excluded };
}

// ---------- status computation ----------
function serviceStatus(serviceId) {
  const latest = db.prepare('SELECT * FROM bookings WHERE event_service_id = ? ORDER BY id DESC LIMIT 1').get(serviceId);
  if (!latest) return { status: 'unassigned', label: 'No vendor selected', booking: null };
  if (latest.status === 'requested') return { status: 'pending', label: 'Awaiting vendor response', booking: latest };
  if (latest.status === 'accepted') return { status: 'confirmed', label: 'Confirmed', booking: latest };
  const labels = { declined: 'Vendor declined', cancelled: 'Vendor cancelled', withdrawn: 'Request withdrawn' };
  return { status: 'attention', label: labels[latest.status], booking: latest };
}

function eventSummary(eventId) {
  const services = db.prepare('SELECT * FROM event_services WHERE event_id = ? ORDER BY id').all(eventId);
  const detail = services.map(s => ({ ...s, ...serviceStatus(s.id) }));
  const confirmed = detail.filter(s => s.status === 'confirmed').length;
  const attention = detail.filter(s => s.status === 'attention').length;
  let overall = 'in_progress';
  if (detail.length && confirmed === detail.length) overall = 'ready';
  else if (attention) overall = 'at_risk';
  return { services: detail, total: detail.length, confirmed, attention, overall };
}

// ---------- notifications / history ----------
function notify(userId, message) {
  db.prepare('INSERT INTO notifications (user_id, message) VALUES (?, ?)').run(userId, message);
}

function addHistory(bookingId, actor, action, note = '') {
  db.prepare('INSERT INTO booking_history (booking_id, actor, action, note) VALUES (?,?,?,?)').run(bookingId, actor, action, note);
}

function loadBookingContext(bookingId) {
  return db.prepare(`
    SELECT b.*, v.user_id AS vendor_user_id, v.name AS vendor_name, v.max_concurrent, v.max_guests,
           v.category, v.service_areas, v.id AS vid,
           es.id AS service_id, es.budget AS service_budget, es.category AS service_category,
           e.id AS event_id, e.name AS event_name, e.date, e.start_time, e.end_time, e.city,
           e.attendees, e.organizer_id
    FROM bookings b
    JOIN vendors v ON v.id = b.vendor_id
    JOIN event_services es ON es.id = b.event_service_id
    JOIN events e ON e.id = es.event_id
    WHERE b.id = ?
  `).get(bookingId);
}

// ---------- booking lifecycle (each one is a single atomic transaction) ----------

// Organizer selects a vendor -> creates a REQUEST (not a confirmation).
const createBooking = db.transaction((serviceId, vendorId, organizerId, message) => {
  const service = db.prepare('SELECT * FROM event_services WHERE id = ?').get(serviceId);
  if (!service) throw new HttpError(404, 'Service not found');
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(service.event_id);
  if (event.organizer_id !== organizerId) throw new HttpError(403, 'Not your event');
  const vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(vendorId);
  if (!vendor) throw new HttpError(404, 'Vendor not found');

  const existing = db.prepare("SELECT id FROM bookings WHERE event_service_id = ? AND status IN ('requested','accepted')").get(serviceId);
  if (existing) throw new HttpError(409, 'This service already has an active booking request. Withdraw or cancel it first.');

  const prev = db.prepare("SELECT status FROM bookings WHERE event_service_id = ? AND vendor_id = ? AND status IN ('declined','cancelled')").get(serviceId, vendorId);
  if (prev) throw new HttpError(409, `${vendor.name} already ${prev.status} this service. Choose another vendor.`);

  const { failures, quote } = checkHardRequirements(vendor, event, service);
  if (failures.length) throw new HttpError(409, 'Vendor no longer meets the requirements', { reasons: failures.map(f => f.message) });

  const info = db.prepare("INSERT INTO bookings (event_service_id, vendor_id, status, quoted_price, message) VALUES (?,?,'requested',?,?)")
    .run(serviceId, vendorId, quote, message || '');
  addHistory(info.lastInsertRowid, 'organizer', 'requested', `Quote ${inr(quote)}`);
  notify(vendor.user_id, `New booking request: ${event.name} (${service.category}) on ${event.date}`);
  return info.lastInsertRowid;
});

// Vendor accepts -> availability is RE-CHECKED inside the transaction before confirming.
const acceptBooking = db.transaction((bookingId, vendorUserId) => {
  const b = loadBookingContext(bookingId);
  if (!b || b.vendor_user_id !== vendorUserId) throw new HttpError(404, 'Booking not found');
  if (b.status !== 'requested') throw new HttpError(409, `Booking is already ${b.status}`);

  const vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(b.vid);
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(b.event_id);
  const service = db.prepare('SELECT * FROM event_services WHERE id = ?').get(b.service_id);
  const { failures } = checkHardRequirements(vendor, event, service, { excludeBookingId: b.id, checkBudget: false });
  if (failures.length) {
    throw new HttpError(409, 'Cannot confirm: ' + failures[0].message, { reasons: failures.map(f => f.message) });
  }

  db.prepare("UPDATE bookings SET status='accepted', updated_at=datetime('now') WHERE id = ?").run(b.id);
  addHistory(b.id, 'vendor', 'accepted', 'Availability re-checked at confirmation');
  notify(b.organizer_id, `${b.vendor_name} confirmed ${b.service_category} for ${b.event_name}`);
});

const declineBooking = db.transaction((bookingId, vendorUserId, reason) => {
  const b = loadBookingContext(bookingId);
  if (!b || b.vendor_user_id !== vendorUserId) throw new HttpError(404, 'Booking not found');
  if (b.status !== 'requested') throw new HttpError(409, `Booking is already ${b.status}`);
  db.prepare("UPDATE bookings SET status='declined', updated_at=datetime('now') WHERE id = ?").run(b.id);
  addHistory(b.id, 'vendor', 'declined', reason || '');
  notify(b.organizer_id, `${b.vendor_name} declined ${b.service_category} for ${b.event_name}. Pick another vendor.`);
});

// Cancel works for both sides:
//  organizer: requested -> withdrawn, accepted -> cancelled
//  vendor   : accepted  -> cancelled
const cancelBooking = db.transaction((bookingId, user, reason) => {
  const b = loadBookingContext(bookingId);
  if (!b) throw new HttpError(404, 'Booking not found');
  const isOrganizer = user.role === 'organizer' && b.organizer_id === user.id;
  const isVendor = user.role === 'vendor' && b.vendor_user_id === user.id;
  if (!isOrganizer && !isVendor) throw new HttpError(404, 'Booking not found');
  if (!ACTIVE.includes(b.status)) throw new HttpError(409, `Booking is already ${b.status}`);
  if (isVendor && b.status !== 'accepted') throw new HttpError(409, 'Use decline for pending requests');

  const next = b.status === 'requested' ? 'withdrawn' : 'cancelled';
  db.prepare("UPDATE bookings SET status=?, updated_at=datetime('now') WHERE id = ?").run(next, b.id);
  addHistory(b.id, user.role, next, reason || '');
  if (isVendor) {
    notify(b.organizer_id, `⚠ ${b.vendor_name} cancelled ${b.service_category} for ${b.event_name}. Find a replacement.`);
  } else {
    notify(b.vendor_user_id, `${b.event_name} ${next === 'withdrawn' ? 'withdrew the request' : 'cancelled the booking'} (${b.service_category}, ${b.date})`);
  }
  return next;
});

// When date/time/attendees/city change, confirmed bookings must be re-confirmed.
const updateEvent = db.transaction((eventId, organizerId, f) => {
  const old = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!old || old.organizer_id !== organizerId) throw new HttpError(404, 'Event not found');
  db.prepare(`UPDATE events SET name=?, date=?, start_time=?, end_time=?, city=?, venue=?, attendees=?, budget=? WHERE id=?`)
    .run(f.name, f.date, f.start_time, f.end_time, f.city, f.venue, f.attendees, f.budget, eventId);

  const changed = ['date', 'start_time', 'end_time', 'city', 'attendees'].some(k => String(old[k]) !== String(f[k]));
  let reconfirm = 0;
  if (changed) {
    const rows = db.prepare(`
      SELECT b.id, v.user_id FROM bookings b
      JOIN event_services es ON es.id = b.event_service_id
      JOIN vendors v ON v.id = b.vendor_id
      WHERE es.event_id = ? AND b.status IN ('requested','accepted')`).all(eventId);
    for (const r of rows) {
      const b = db.prepare('SELECT status FROM bookings WHERE id = ?').get(r.id);
      if (b.status === 'accepted') {
        db.prepare("UPDATE bookings SET status='requested', updated_at=datetime('now') WHERE id = ?").run(r.id);
        addHistory(r.id, 'system', 'reconfirmation_required', 'Event details changed');
        reconfirm++;
      }
      notify(r.user_id, `${f.name} changed its details. Please review and ${b.status === 'accepted' ? 're-confirm' : 'respond to'} the booking.`);
    }
  }
  return { reconfirm };
});

module.exports = {
  HttpError, ACTIVE, quoteFor, hoursBetween, inr,
  checkHardRequirements, overlappingAccepted, matchVendors, serviceStatus, eventSummary,
  notify, addHistory, loadBookingContext,
  createBooking, acceptBooking, declineBooking, cancelBooking, updateEvent,
};
