const { pool, logActivity } = require('../db');
const { HttpError, asyncHandler } = require('../httpError');
const { requireAuth, adminOnly } = require('../middleware/auth');

const activity = require('express').Router();
activity.use(requireAuth, adminOnly);
// Newest first, same {ts, msg} shape the frontend's Activity log modal renders
activity.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 300, 1000);
  const { rows } = await pool.query(
    `SELECT a.activity_id AS id, a.action_type AS action,
            to_char(a."timestamp", 'DD-MM-YYYY HH24:MI:SS') AS ts,
            a.action_type || ' — ' || a.description AS msg,
            u.username
       FROM activity_log a LEFT JOIN users u ON u.user_id = a.user_id
      ORDER BY a."timestamp" DESC, a.activity_id DESC LIMIT $1`, [limit]);
  res.json(rows);
}));

const stats = require('express').Router();
stats.use(requireAuth);
stats.get('/summary', asyncHandler(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT (SELECT COUNT(*) FROM contacts)::int AS total,
           (SELECT COUNT(DISTINCT group_id) FROM contact_group)::int AS categories,
           (SELECT COUNT(DISTINCT company) FROM contacts WHERE COALESCE(company,'') NOT IN ('', '—'))::int AS companies,
           (SELECT COUNT(*) FROM contacts WHERE is_favourite)::int AS favourites`);
  res.json(rows[0]);
}));
stats.get('/frequent', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT contact_id AS id, name, phone::text AS phone, interaction_count::int AS "interactionCount", last_contacted AS "lastContacted"
       FROM v_frequent_contacts LIMIT $1`, [Math.min(Number(req.query.limit) || 10, 100)]);
  res.json(rows);
}));
stats.get('/groups', asyncHandler(async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT group_id AS id, group_name AS name, contact_count::int AS "contactCount" FROM v_group_distribution');
  res.json(rows);
}));

const groups = require('express').Router();
groups.use(requireAuth);
groups.get('/', asyncHandler(async (_req, res) => {
  const { rows } = await pool.query('SELECT group_id AS id, group_name AS name FROM groups ORDER BY group_id');
  res.json(rows);
}));
// Administrators can define custom labels
groups.post('/', adminOnly, asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (name.length < 2 || name.length > 30) throw new HttpError(400, 'VALIDATION', 'Group name must be 2–30 characters.', 'name');
  const { rows } = await pool.query('INSERT INTO groups (group_name) VALUES ($1) RETURNING group_id AS id, group_name AS name', [name]);
  await logActivity(pool, req.user.id, 'GROUP', `group '${name}' created by '${req.user.username}'.`);
  res.status(201).json(rows[0]);
}));

module.exports = { activity, stats, groups };
