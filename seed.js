// Inserts the default admin account + the sample contacts the frontend used to ship with.
// Safe to re-run: does nothing if a users table already has rows.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool, withTransaction, logActivity } = require('../src/db');

const SEED_CONTACTS = [
  ['Alien Lakshmi', '9876543210', 'alien@gmail.com', 'Kochi, Kerala', '2005-03-15', 'Amrita', 'Academic', false],
  ['Abel Binu Varghese', '9123456789', 'abel@gmail.com', 'Trivandrum, Kerala', '2004-11-20', 'Amrita', 'Academic', false],
  ['Kasinath V', '9988776655', 'kasinath@gmail.com', 'Ernakulam, Kerala', '2005-07-08', 'Amrita', 'Academic', false],
  ['Devananda J A', '9445566778', 'devananda@gmail.com', 'Kollam, Kerala', '2005-01-30', 'Amrita', 'Academic', false],
  ['Priya Menon', '9871234560', 'priya.menon@techcorp.com', 'Bengaluru, Karnataka', '1998-06-12', 'TechCorp Solutions', 'Business', true],
  ['Rahul Nair', '9345678123', 'rahul.nair@outlook.com', 'Chennai, Tamil Nadu', '1995-09-24', null, 'Personal', false],
  ['Sarath Krishnan', '9012345678', 'sarath.k@familymail.com', 'Thrissur, Kerala', '1970-02-18', null, 'Family', false],
];

async function seed() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n > 0) { console.log('Users already exist — seed skipped.'); return; }

  await withTransaction(async (db) => {
    const hash = await bcrypt.hash('admin123', 10);
    const admin = (await db.query(
      "INSERT INTO users (username, password_hash, role) VALUES ('admin', $1, 'Administrator') RETURNING user_id", [hash])).rows[0].user_id;
    await logActivity(db, admin, 'SYSTEM', 'drawer initialised with default admin account.');

    for (const [name, phone, email, address, bday, company, category, fav] of SEED_CONTACTS) {
      const id = (await db.query(
        `INSERT INTO contacts (name, phone, email, address, birthday, company, is_favourite, user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING contact_id`,
        [name, phone, email, address, bday, company, fav, admin])).rows[0].contact_id;
      await db.query(
        'INSERT INTO contact_group (contact_id, group_id) SELECT $1, group_id FROM groups WHERE group_name = $2', [id, category]);
    }
    // a little communication history so the "frequent contacts" view has data
    const pid = (await db.query("SELECT contact_id FROM contacts WHERE name = 'Priya Menon'")).rows[0].contact_id;
    for (const [type, notes] of [['Call', 'Project kickoff'], ['Meeting', 'Quarterly review'], ['Message', 'Sent proposal']]) {
      await db.query('INSERT INTO communication_log (contact_id, log_id, type, notes, logged_by) VALUES ($1, 0, $2, $3, $4)', [pid, type, notes, admin]);
    }
  });
  console.log("Seeded: admin / admin123 + 7 sample contacts. Change the admin password after first login!");
}

if (require.main === module) seed().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
module.exports = seed;
