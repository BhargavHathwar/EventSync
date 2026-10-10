# EventSync — Local Event Vendor Coordination
**Team THE LAST COMMIT · Problem Statement 47**

> Every vendor. One event. Perfectly coordinated.

EventSync lets an organizer describe an event once, matches only the vendors who can actually deliver
(right service, city, guest capacity, free on the date, within budget), and tracks every booking
from request to confirmation, including recovery when a vendor cancels.

## Quick Start (Node.js 18+)
```bash
npm install
npm start          # http://localhost:3000   (demo data is created automatically)
npm test           # API tests for edge cases + business invariants
npm run reset      # wipe and re-seed demo data
```

---

## Database Configuration (PostgreSQL & SQLite)

EventSync features a **dual-database architecture** designed for both seamless cloud deployments and friction-free local development:

### 1. PostgreSQL (Recommended for Production & Cloud)
To connect to PostgreSQL (e.g. Supabase, Neon, Railway, Render, AWS RDS, or local Postgres), copy `.env.example` to `.env` and set `DATABASE_URL`:

```bash
cp .env.example .env
```

Configure your connection string in `.env`:
```env
DATABASE_URL=postgresql://user:password@localhost:5432/eventsync
# Optional: for cloud databases requiring SSL (Supabase, Neon, RDS)
DATABASE_SSL=true
```

When `DATABASE_URL` is detected, EventSync automatically:
- Connects using a high-performance `pg` connection pool.
- Initializes the relational PostgreSQL DDL schema with foreign key cascades, partial unique indexes, and `TIMESTAMP WITH TIME ZONE`.
- Manages isolated transactions via Node.js `AsyncLocalStorage` and connection checkout.
- Seeds initial demo accounts and events on first start.

### 2. Zero-Config SQLite (Default / Local Development)
If `DATABASE_URL` is omitted, EventSync automatically falls back to embedded SQLite (`better-sqlite3` in WAL mode at `data/eventsync.db`). No database installation or setup is required, ensuring instant onboarding and 100% green offline `npm test` runs.

---

## Demo Accounts (password `demo123`)
| Role | Email | Notes |
|---|---|---|
| Organizer | organizer@demo.com | "College Tech Fest", 300 guests, nothing booked yet |
| Organizer | organizer2@demo.com | "Corporate Annual Day", same day, overlapping 14:00–20:00 |
| Vendor | royalbanquet@demo.com | Has a pending request from Corporate Day (competing request) |
| Vendor | lenscraft@demo.com / bassline@demo.com | Already confirmed for Corporate Day |
| Vendor | pulsepro@demo.com | Sound vendor, use for the cancellation demo |

Other vendors (`@demo.com`): spiceroute, grandfeast, hometaste, petalpine, stagecraft, mysurumandap, framefocus, candid, sonicwaves.

---

## Demo Script
1. **Unavailable vendor** – Sign in as `organizer@demo.com` → College Tech Fest → *Find vendors* for Photography. LensCraft is listed under "not available" with the reason *Already booked 14:00–20:00*. For catering, Spice Route is excluded (max 250 guests, event has 300).
2. **Competing requests** – Request **Royal Banquet** for catering. Sign in as `royalbanquet@demo.com`: two overlapping requests. Accept one and the other is blocked ("Cannot confirm… overlaps confirmed booking").
3. **Cancellation + replacement** – Sound: request **PulsePro** → vendor accepts → vendor clicks *Cancel booking*. The organizer sees the service turn red ("Needs attention"), gets a notification, and *Find replacement* lists other compatible vendors (PulsePro is not re-offered). The replacement must be requested and accepted; it is never auto-confirmed.
4. **Date change** – *Edit event* and change guests or time: confirmed vendors drop back to "requested" and must re-confirm.

---

## How It Works
Discovery → Selection → Request → Confirmation are four separate steps.

* **Matching engine** (`logic.js → matchVendors`): hard requirements decide eligibility (service, city, max guests, not blocked, no overlapping confirmed booking beyond the vendor's concurrent capacity, quote within the service budget). Preferences (price, rating) only rank vendors that already qualify. Excluded vendors come back with clear reasons.
* **Booking lifecycle**: `requested → accepted | declined | withdrawn`, `accepted → cancelled`. Every change is logged in `booking_history` and creates a notification.
* **Conflict safety**: availability is re-checked inside an atomic database transaction when a vendor accepts. A partial unique index allows only one active request per event service, preventing duplicates at the database level.
* **Availability vs capacity** are separate: `vendor_blocked_dates` (days off), `max_guests` (largest event) and `max_concurrent` (simultaneous events).

---

## Stack & Architecture
- **Backend**: Node.js (>=18) + Express
- **Database**: PostgreSQL (`pg`) with zero-config SQLite (`better-sqlite3`) fallback
- **Frontend**: Vanilla JS single-page frontend (no build step, Three.js 3D visualization, modern dark glassmorphism)
- **Auth**: Role-based token auth with Node `crypto.scrypt` hashing
- **Testing**: Native Node test runner (`node --test test/api.test.js`)

## Layout
```
server.js     REST API endpoints & lifecycle
db.js         Unified PostgreSQL & SQLite database layer
logic.js      Matching engine, hard requirement checks & booking lifecycle
auth.js       Password hashing, session tokens & role authorization
seed.js       Deterministic demo data seeder & database reset utility
public/       Frontend client (index.html, app.js, styles.css, three.min.js)
test/         Automated test suite verifying required edge cases
.env.example  Environment template with database configuration guidance
```
