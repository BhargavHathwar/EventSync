# EventSync — Local Event Vendor Coordination
**Team THE LAST COMMIT · Problem Statement 47**

> Every vendor. One event. Perfectly coordinated.

EventSync lets an organizer describe an event once, matches only the vendors who can actually deliver
(right service, city, guest capacity, free on the date, within budget), and tracks every booking
from request to confirmation, including recovery when a vendor cancels.

## Run it (Node.js 18+)
```bash
npm install
npm start          # http://localhost:3000   (demo data is created automatically)
npm test           # API tests for the 3 required edge cases + more
npm run reset      # wipe and re-seed demo data
```

## Demo accounts (password `demo123`)
| Role | Email | Notes |
|---|---|---|
| Organizer | organizer@demo.com | "College Tech Fest", 300 guests, nothing booked yet |
| Organizer | organizer2@demo.com | "Corporate Annual Day", same day, overlapping 14:00–20:00 |
| Vendor | royalbanquet@demo.com | Has a pending request from Corporate Day (competing request) |
| Vendor | lenscraft@demo.com / bassline@demo.com | Already confirmed for Corporate Day |
| Vendor | pulsepro@demo.com | Sound vendor, use for the cancellation demo |

Other vendors (`@demo.com`): spiceroute, grandfeast, hometaste, petalpine, stagecraft, mysurumandap, framefocus, candid, sonicwaves.

## Demo script
1. **Unavailable vendor** – Sign in as `organizer@demo.com` → College Tech Fest → *Find vendors* for Photography. LensCraft is listed under "not available" with the reason *Already booked 14:00–20:00*. For catering, Spice Route is excluded (max 250 guests, event has 300).
2. **Competing requests** – Request **Royal Banquet** for catering. Sign in as `royalbanquet@demo.com`: two overlapping requests. Accept one and the other is blocked ("Cannot confirm… overlaps confirmed booking").
3. **Cancellation + replacement** – Sound: request **PulsePro** → vendor accepts → vendor clicks *Cancel booking*. The organizer sees the service turn red ("Needs attention"), gets a notification, and *Find replacement* lists other compatible vendors (PulsePro is not re-offered). The replacement must be requested and accepted; it is never auto-confirmed.
4. **Date change** – *Edit event* and change guests or time: confirmed vendors drop back to "requested" and must re-confirm.

## How it works
Discovery → Selection → Request → Confirmation are four separate steps.

* **Matching engine** (`logic.js → matchVendors`): hard requirements decide eligibility (service, city, max guests, not blocked, no overlapping confirmed booking beyond the vendor's concurrent capacity, quote within the service budget). Preferences (price, rating) only rank vendors that already qualify. Excluded vendors come back with reasons.
* **Booking lifecycle**: `requested → accepted | declined | withdrawn`, `accepted → cancelled`. Every change is logged in `booking_history` and creates a notification.
* **Conflict safety**: availability is re-checked inside a database transaction when a vendor accepts (better-sqlite3 is synchronous, so check-and-update is atomic). A partial unique index allows only one active request per event service, blocking duplicates at the database level.
* **Availability vs capacity** are separate: `vendor_blocked_dates` (days off), `max_guests` (largest event) and `max_concurrent` (simultaneous events).

## Stack
Node.js + Express · SQLite (better-sqlite3) · vanilla JS single-page frontend (no build step) · role-based token auth (scrypt hashing). Matching is deterministic rule-based logic; no AI/ML is needed.

## Layout
```
server.js  REST API            logic.js  matching + booking rules
db.js      schema              auth.js   sessions / roles
seed.js    demo data           public/   frontend (index.html, app.js, styles.css)
test/      API tests
```

## Prototype limits
No payments, chat, email/SMS delivery (notifications are in-app), reviews, identity verification or request expiry. One time window per event (no multi-day events). Sessions do not expire. For production: PostgreSQL (`SELECT … FOR UPDATE` for the same atomic confirmation) and HTTPS.
