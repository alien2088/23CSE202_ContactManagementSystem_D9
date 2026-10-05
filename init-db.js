// Creates all tables / triggers / procedure / views from db/schema.sql, then seeds.
// WARNING: schema.sql drops and recreates the tables.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db');
const seed = require('./seed');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Schema created.');
  await seed();
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
