// EventSync - database layer (SQLite via better-sqlite3).
// better-sqlite3 is synchronous, so a db.transaction() block is fully atomic:
// no other request can interleave between the availability check and the status update.
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'eventsync.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const CATEGORIES = ['catering', 'decoration', 'photography', 'sound'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('organizer','vendor')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One vendor profile per vendor user.
-- max_guests      : largest event size the vendor can serve (NULL = no limit)
-- max_concurrent  : how many overlapping events they can serve at once (their capacity)
CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('catering','decoration','photography','sound')),
  description TEXT DEFAULT '',
  package TEXT DEFAULT '',
  service_areas TEXT NOT NULL,
  max_guests INTEGER,
  max_concurrent INTEGER NOT NULL DEFAULT 1,
  price REAL NOT NULL,
  price_unit TEXT NOT NULL CHECK (price_unit IN ('flat','per_guest','per_hour')),
  rating REAL NOT NULL DEFAULT 4.0
);

-- Whole days the vendor has marked as unavailable.
CREATE TABLE IF NOT EXISTS vendor_blocked_dates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  reason TEXT DEFAULT '',
  UNIQUE (vendor_id, date)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organizer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  city TEXT NOT NULL,
  venue TEXT DEFAULT '',
  attendees INTEGER NOT NULL,
  budget REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per service an event needs (catering, sound, ...).
CREATE TABLE IF NOT EXISTS event_services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('catering','decoration','photography','sound')),
  budget REAL,
  notes TEXT DEFAULT '',
  UNIQUE (event_id, category)
);

-- A booking is a request from an event service to one vendor.
-- requested -> accepted | declined | withdrawn ; accepted -> cancelled
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_service_id INTEGER NOT NULL REFERENCES event_services(id) ON DELETE CASCADE,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('requested','accepted','declined','cancelled','withdrawn')),
  quoted_price REAL NOT NULL,
  message TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Database-level guard against duplicate requests: a service can only have
-- ONE active (requested/accepted) booking at any time.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_booking_per_service
  ON bookings(event_service_id) WHERE status IN ('requested','accepted');

CREATE INDEX IF NOT EXISTS idx_bookings_vendor ON bookings(vendor_id, status);

CREATE TABLE IF NOT EXISTS booking_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  note TEXT DEFAULT '',
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

db.exec(SCHEMA);

function resetDatabase() {
  db.pragma('foreign_keys = OFF');
  for (const t of ['notifications', 'booking_history', 'bookings', 'event_services', 'events',
    'vendor_blocked_dates', 'vendors', 'sessions', 'users']) {
    db.exec(`DROP TABLE IF EXISTS ${t}`);
  }
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
}

module.exports = { db, CATEGORIES, resetDatabase };
