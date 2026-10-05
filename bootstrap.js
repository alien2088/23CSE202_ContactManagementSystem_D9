// On first start against an EMPTY database, create the schema and seed data.
// Lets the API deploy to hosts with no shell access. Never touches an existing database.
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

module.exports = async function bootstrap() {
  const { rows } = await pool.query("SELECT to_regclass('public.users') AS t");
  if (rows[0].t) return;
  console.log('Empty database detected — creating schema…');
  await pool.query(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  await require('../scripts/seed')();
};
