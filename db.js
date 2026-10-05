require('dotenv').config();
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || 'postgres://cms:cms@localhost:5432/cms_d9';
// Managed hosts (Render, Neon, Supabase…) require TLS; local Postgres doesn't.
const isLocalDb = /@(localhost|127\.0\.0\.1)/.test(connectionString);
const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_SSL === 'false' || isLocalDb ? false : { rejectUnauthorized: false },
});

/** Run fn(client) inside a transaction; commits on success, rolls back on error. */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Write one row to ACTIVITY_LOG (pass a client to join a transaction). */
function logActivity(db, userId, actionType, description) {
  return db.query(
    'INSERT INTO activity_log (user_id, action_type, description) VALUES ($1, $2, $3)',
    [userId, actionType, description]
  );
}

module.exports = { pool, withTransaction, logActivity };
