// EventSync - Unified Database Layer
// Supports PostgreSQL (via pg and DATABASE_URL) with zero-config SQLite fallback (better-sqlite3).
require('dotenv').config();
const { AsyncLocalStorage } = require('async_hooks');
const fs = require('fs');
const path = require('path');

const CATEGORIES = ['catering', 'decoration', 'photography', 'sound'];
const isPostgres = Boolean(process.env.DATABASE_URL);

// AsyncLocalStorage tracks active transaction clients across async execution contexts
const txStorage = new AsyncLocalStorage();

// Simple promise-chaining mutex for serial transaction guarantees in SQLite
class Mutex {
  constructor() {
    this._queue = Promise.resolve();
  }
  run(fn) {
    const next = this._queue.then(fn, fn);
    this._queue = next.catch(() => {});
    return next;
  }
}
const sqliteTxMutex = new Mutex();

// SQLite DDL Schema
const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('organizer','vendor')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS event_services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('catering','decoration','photography','sound')),
  budget REAL,
  notes TEXT DEFAULT '',
  UNIQUE (event_id, category)
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_service_id INTEGER NOT NULL REFERENCES event_services(id) ON DELETE CASCADE,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('requested','accepted','declined','cancelled','withdrawn')),
  quoted_price REAL NOT NULL,
  message TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_booking_per_service
  ON bookings(event_service_id) WHERE status IN ('requested','accepted');

CREATE INDEX IF NOT EXISTS idx_bookings_vendor ON bookings(vendor_id, status);

CREATE TABLE IF NOT EXISTS booking_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  note TEXT DEFAULT '',
  at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_id, receiver_id);
`;

// PostgreSQL DDL Schema
const PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('organizer','vendor')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vendors (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('catering','decoration','photography','sound')),
  description TEXT DEFAULT '',
  package TEXT DEFAULT '',
  service_areas TEXT NOT NULL,
  max_guests INTEGER,
  max_concurrent INTEGER NOT NULL DEFAULT 1,
  price DOUBLE PRECISION NOT NULL,
  price_unit TEXT NOT NULL CHECK (price_unit IN ('flat','per_guest','per_hour')),
  rating DOUBLE PRECISION NOT NULL DEFAULT 4.0
);

CREATE TABLE IF NOT EXISTS vendor_blocked_dates (
  id SERIAL PRIMARY KEY,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  reason TEXT DEFAULT '',
  UNIQUE (vendor_id, date)
);

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  organizer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  city TEXT NOT NULL,
  venue TEXT DEFAULT '',
  attendees INTEGER NOT NULL,
  budget DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS event_services (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('catering','decoration','photography','sound')),
  budget DOUBLE PRECISION,
  notes TEXT DEFAULT '',
  UNIQUE (event_id, category)
);

CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  event_service_id INTEGER NOT NULL REFERENCES event_services(id) ON DELETE CASCADE,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('requested','accepted','declined','cancelled','withdrawn')),
  quoted_price DOUBLE PRECISION NOT NULL,
  message TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_booking_per_service
  ON bookings(event_service_id) WHERE status IN ('requested','accepted');

CREATE INDEX IF NOT EXISTS idx_bookings_vendor ON bookings(vendor_id, status);

CREATE TABLE IF NOT EXISTS booking_history (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  note TEXT DEFAULT '',
  at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_id, receiver_id);
`;

function normalizeParams(args) {
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return args;
}

function convertSqlToPg(sql) {
  let paramIndex = 1;
  // Replace ? with $1, $2, ...
  let converted = sql.replace(/\?/g, () => `$${paramIndex++}`);
  // Replace SQLite datetime('now') with CURRENT_TIMESTAMP if present
  converted = converted.replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
  // Auto-append RETURNING id for INSERT statements targeting tables with auto-increment IDs
  if (/^\s*INSERT\s+INTO\s+(?!sessions\b)/i.test(converted) && !/\bRETURNING\b/i.test(converted)) {
    converted += ' RETURNING id';
  }
  return converted;
}

let dbInstance;
let pgPool;
let sqliteDb;

if (isPostgres) {
  const { Pool, types } = require('pg');
  // Parse int8 (BIGINT / COUNT) to JS integer to maintain type parity with SQLite
  types.setTypeParser(20, val => (val === null ? null : parseInt(val, 10)));
  // Parse float4 / float8
  types.setTypeParser(700, val => (val === null ? null : parseFloat(val)));
  types.setTypeParser(701, val => (val === null ? null : parseFloat(val)));

  const poolConfig = {
    connectionString: process.env.DATABASE_URL,
  };
  // Configure SSL if specified or in production / remote connection
  if (process.env.DATABASE_SSL === 'true' || (process.env.DATABASE_SSL !== 'false' && (process.env.NODE_ENV === 'production' || /sslmode=require/i.test(process.env.DATABASE_URL)))) {
    poolConfig.ssl = { rejectUnauthorized: false };
  }
  pgPool = new Pool(poolConfig);

  dbInstance = {
    isPostgres: true,
    async get(sql, ...args) {
      const params = normalizeParams(args);
      const runner = txStorage.getStore() || pgPool;
      const pgSql = convertSqlToPg(sql);
      const res = await runner.query(pgSql, params);
      return res.rows[0] || null;
    },
    async all(sql, ...args) {
      const params = normalizeParams(args);
      const runner = txStorage.getStore() || pgPool;
      const pgSql = convertSqlToPg(sql);
      const res = await runner.query(pgSql, params);
      return res.rows;
    },
    async run(sql, ...args) {
      const params = normalizeParams(args);
      const runner = txStorage.getStore() || pgPool;
      const pgSql = convertSqlToPg(sql);
      const res = await runner.query(pgSql, params);
      return {
        changes: res.rowCount,
        lastInsertRowid: res.rows?.[0]?.id ?? null,
      };
    },
    prepare(sql) {
      return {
        get: (...args) => dbInstance.get(sql, ...args),
        all: (...args) => dbInstance.all(sql, ...args),
        run: (...args) => dbInstance.run(sql, ...args),
      };
    },
    transaction(fn) {
      return async (...args) => {
        const existingClient = txStorage.getStore();
        if (existingClient) {
          return await fn(...args);
        }
        const client = await pgPool.connect();
        try {
          await client.query('BEGIN');
          const result = await txStorage.run(client, async () => {
            return await fn(...args);
          });
          await client.query('COMMIT');
          return result;
        } catch (err) {
          try { await client.query('ROLLBACK'); } catch (_) {}
          throw err;
        } finally {
          client.release();
        }
      };
    },
    async exec(sql) {
      const runner = txStorage.getStore() || pgPool;
      await runner.query(sql);
    },
    async close() {
      await pgPool.end();
    },
  };
} else {
  // SQLite Fallback
  const Database = require('better-sqlite3');
  const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'eventsync.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  sqliteDb = new Database(dbPath);
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');

  // Sync schema execution on load for instant readiness
  sqliteDb.exec(SQLITE_SCHEMA);

  dbInstance = {
    isPostgres: false,
    async get(sql, ...args) {
      const params = normalizeParams(args);
      return sqliteDb.prepare(sql).get(...params) || null;
    },
    async all(sql, ...args) {
      const params = normalizeParams(args);
      return sqliteDb.prepare(sql).all(...params);
    },
    async run(sql, ...args) {
      const params = normalizeParams(args);
      const res = sqliteDb.prepare(sql).run(...params);
      return {
        changes: res.changes,
        lastInsertRowid: res.lastInsertRowid,
      };
    },
    prepare(sql) {
      return {
        get: (...args) => dbInstance.get(sql, ...args),
        all: (...args) => dbInstance.all(sql, ...args),
        run: (...args) => dbInstance.run(sql, ...args),
      };
    },
    transaction(fn) {
      return async (...args) => {
        const existingTx = txStorage.getStore();
        if (existingTx) {
          return await fn(...args);
        }
        return await sqliteTxMutex.run(async () => {
          sqliteDb.exec('BEGIN IMMEDIATE');
          try {
            const result = await txStorage.run(true, async () => {
              return await fn(...args);
            });
            sqliteDb.exec('COMMIT');
            return result;
          } catch (err) {
            try { sqliteDb.exec('ROLLBACK'); } catch (_) {}
            throw err;
          }
        });
      };
    },
    async exec(sql) {
      sqliteDb.exec(sql);
    },
    async close() {
      sqliteDb.close();
    },
  };
}

let initPromise = null;
async function initDatabase() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (isPostgres) {
      await dbInstance.exec(PG_SCHEMA);
    } else {
      sqliteDb.exec(SQLITE_SCHEMA);
    }
  })();
  return initPromise;
}

async function resetDatabase() {
  const tables = [
    'messages', 'notifications', 'booking_history', 'bookings',
    'event_services', 'events', 'vendor_blocked_dates',
    'vendors', 'sessions', 'users'
  ];
  if (isPostgres) {
    for (const t of tables) {
      await dbInstance.exec(`DROP TABLE IF EXISTS ${t} CASCADE`);
    }
    await dbInstance.exec(PG_SCHEMA);
  } else {
    sqliteDb.pragma('foreign_keys = OFF');
    for (const t of tables) {
      sqliteDb.exec(`DROP TABLE IF EXISTS ${t}`);
    }
    sqliteDb.pragma('foreign_keys = ON');
    sqliteDb.exec(SQLITE_SCHEMA);
  }
}

module.exports = {
  db: dbInstance,
  CATEGORIES,
  initDatabase,
  resetDatabase,
  isPostgres,
  convertSqlToPg,
};
