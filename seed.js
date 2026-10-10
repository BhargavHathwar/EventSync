// Demo data. Runs automatically on first start when the database is empty.
// Re-seed from scratch with:  npm run reset
const { db, resetDatabase } = require('./db');
const { hashPassword } = require('./auth');

const DEMO_PASSWORD = 'demo123';

const VENDORS = [
  // catering
  { email: 'spiceroute@demo.com', name: 'Spice Route Caterers', category: 'catering', areas: 'Bengaluru', max_guests: 250, price: 350, unit: 'per_guest', rating: 4.6, pkg: 'Veg buffet, 3 mains, 2 desserts', desc: 'Popular campus and office caterer.' },
  { email: 'grandfeast@demo.com', name: 'Grand Feast Co.', category: 'catering', areas: 'Bengaluru, Mysuru', max_guests: 800, price: 420, unit: 'per_guest', rating: 4.4, pkg: 'Multi-cuisine buffet with live counters', desc: 'Large-scale catering with 40+ staff.' },
  { email: 'hometaste@demo.com', name: 'Home Taste Kitchen', category: 'catering', areas: 'Bengaluru', max_guests: 120, price: 280, unit: 'per_guest', rating: 4.8, pkg: 'Home-style meals, boxed or buffet', desc: 'Small-batch, highly rated.' },
  { email: 'royalbanquet@demo.com', name: 'Royal Banquet', category: 'catering', areas: 'Bengaluru', max_guests: 500, price: 380, unit: 'per_guest', rating: 4.7, pkg: 'Premium buffet, service staff included', desc: 'Weddings and corporate galas.' },
  // decoration
  { email: 'petalpine@demo.com', name: 'Petal & Pine Decor', category: 'decoration', areas: 'Bengaluru', max_guests: null, price: 45000, unit: 'flat', rating: 4.7, pkg: 'Stage, floral arch, ambient lighting', desc: 'Theme-based decoration.' },
  { email: 'stagecraft@demo.com', name: 'Stagecraft Studio', category: 'decoration', areas: 'Bengaluru', max_guests: null, price: 70000, unit: 'flat', rating: 4.5, pkg: 'Full stage, LED backdrop, truss lighting', desc: 'Large stage and LED setups.' },
  { email: 'mysurumandap@demo.com', name: 'Mysuru Mandap Decor', category: 'decoration', areas: 'Mysuru', max_guests: null, price: 38000, unit: 'flat', rating: 4.3, pkg: 'Traditional mandap and floral decor', desc: 'Traditional decor in Mysuru.' },
  // photography
  { email: 'lenscraft@demo.com', name: 'LensCraft Photography', category: 'photography', areas: 'Bengaluru', max_guests: null, price: 4000, unit: 'per_hour', rating: 4.8, pkg: '2 photographers, edited gallery', desc: 'Event photography team.' },
  { email: 'framefocus@demo.com', name: 'Frame & Focus', category: 'photography', areas: 'Bengaluru', max_guests: null, price: 3200, unit: 'per_hour', rating: 4.3, pkg: '1 photographer, 100 edited photos', desc: 'Budget-friendly coverage.' },
  { email: 'candid@demo.com', name: 'Candid Collective', category: 'photography', areas: 'Bengaluru, Mysuru', max_guests: null, price: 5500, unit: 'per_hour', rating: 4.9, pkg: '2 photographers + videographer', desc: 'Photo and video storytelling.' },
  // sound
  { email: 'bassline@demo.com', name: 'BassLine Audio', category: 'sound', areas: 'Bengaluru', max_guests: 600, price: 30000, unit: 'flat', rating: 4.5, pkg: 'PA system, 4 mics, mixer, 1 technician', desc: 'Reliable PA for mid-size events.' },
  { email: 'sonicwaves@demo.com', name: 'Sonic Waves', category: 'sound', areas: 'Bengaluru', max_guests: 300, price: 22000, unit: 'flat', rating: 4.2, pkg: 'Compact PA, 2 mics', desc: 'Compact setups for smaller halls.' },
  { email: 'pulsepro@demo.com', name: 'PulsePro Sound', category: 'sound', areas: 'Bengaluru, Mysuru', max_guests: 2000, price: 48000, unit: 'flat', rating: 4.7, pkg: 'Line-array system, DJ console, 2 technicians', desc: 'Concert-grade audio.' },
];

async function seedIfEmpty() {
  const cnt = await db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (Number(cnt?.c || 0) > 0) return false;
  const pw = hashPassword(DEMO_PASSWORD);

  const insUser = db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)');
  const insVendor = db.prepare(`INSERT INTO vendors
    (user_id,name,category,description,package,service_areas,max_guests,max_concurrent,price,price_unit,rating)
    VALUES (?,?,?,?,?,?,?,1,?,?,?)`);

  const vendorIds = {};
  for (const v of VENDORS) {
    const uRes = await insUser.run(v.name, v.email, pw, 'vendor');
    const uid = uRes.lastInsertRowid;
    const vRes = await insVendor.run(uid, v.name, v.category, v.desc, v.pkg, v.areas, v.max_guests, v.price, v.unit, v.rating);
    vendorIds[v.email] = vRes.lastInsertRowid;
  }

  const org1 = (await insUser.run('Bhargav (Tech Fest Organizer)', 'organizer@demo.com', pw, 'organizer')).lastInsertRowid;
  const org2 = (await insUser.run('Priya (Corporate Events)', 'organizer2@demo.com', pw, 'organizer')).lastInsertRowid;

  const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const eventDate = day(30);

  const insEvent = db.prepare('INSERT INTO events (organizer_id,name,date,start_time,end_time,city,venue,attendees,budget) VALUES (?,?,?,?,?,?,?,?,?)');
  const insSvc = db.prepare('INSERT INTO event_services (event_id,category,budget) VALUES (?,?,?)');
  const insBooking = db.prepare('INSERT INTO bookings (event_service_id,vendor_id,status,quoted_price) VALUES (?,?,?,?)');
  const insHist = db.prepare('INSERT INTO booking_history (booking_id,actor,action,note) VALUES (?,?,?,?)');

  // Organizer 1: College Tech Fest (fresh, nothing booked) - 300 attendees
  const techfest = (await insEvent.run(org1, 'College Tech Fest', eventDate, '10:00', '18:00', 'Bengaluru', 'Main Auditorium', 300, 280000)).lastInsertRowid;
  await insSvc.run(techfest, 'catering', 120000);
  await insSvc.run(techfest, 'decoration', 50000);
  await insSvc.run(techfest, 'photography', 40000);
  await insSvc.run(techfest, 'sound', 55000);

  // Organizer 2: Corporate Annual Day on the SAME day, overlapping 14:00-20:00.
  // It already holds confirmed bookings (-> vendors become "unavailable" for Tech Fest)
  // and a pending request that competes with Tech Fest for the same caterer.
  const corp = (await insEvent.run(org2, 'Corporate Annual Day', eventDate, '14:00', '20:00', 'Bengaluru', 'Convention Hall', 200, 300000)).lastInsertRowid;
  const cCat = (await insSvc.run(corp, 'catering', 120000)).lastInsertRowid;
  const cPho = (await insSvc.run(corp, 'photography', 50000)).lastInsertRowid;
  const cSnd = (await insSvc.run(corp, 'sound', 40000)).lastInsertRowid;

  const b1 = (await insBooking.run(cPho, vendorIds['lenscraft@demo.com'], 'accepted', 24000)).lastInsertRowid;
  await insHist.run(b1, 'organizer', 'requested', '');
  await insHist.run(b1, 'vendor', 'accepted', '');

  const b2 = (await insBooking.run(cSnd, vendorIds['bassline@demo.com'], 'accepted', 30000)).lastInsertRowid;
  await insHist.run(b2, 'organizer', 'requested', '');
  await insHist.run(b2, 'vendor', 'accepted', '');

  const b3 = (await insBooking.run(cCat, vendorIds['royalbanquet@demo.com'], 'requested', 76000)).lastInsertRowid;
  await insHist.run(b3, 'organizer', 'requested', '');

  return true;
}

module.exports = { seedIfEmpty, DEMO_PASSWORD };

if (require.main === module) {
  (async () => {
    if (process.argv.includes('--reset')) await resetDatabase();
    const seeded = await seedIfEmpty();
    console.log(seeded ? 'Demo data created.' : 'Database already has data (use --reset to recreate).');
  })().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
