const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { pool, withTransaction, logActivity } = require('../db');
const { HttpError, asyncHandler } = require('../httpError');
const { requireAuth, adminOnly } = require('../middleware/auth');

router.use(requireAuth, adminOnly);   // Manage Users is admin-only
router.param('id', (_req, _res, next, v) => (/^\d+$/.test(v) ? next() : next(new HttpError(400, 'VALIDATION', 'Invalid id.'))));

const ROLES = ['Administrator', 'Editor', 'Viewer'];
const out = (u) => ({ id: u.user_id, username: u.username, role: u.role, createdAt: u.created_at });

router.get('/', asyncHandler(async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM users ORDER BY user_id');
  res.json(rows.map(out));
}));

router.post('/', asyncHandler(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const role = req.body.role;
  if (username.length < 3) throw new HttpError(400, 'VALIDATION', 'Username must be at least 3 characters.', 'user');
  if (password.length < 6) throw new HttpError(400, 'VALIDATION', 'Password must be at least 6 characters.', 'pass');
  if (!ROLES.includes(role)) throw new HttpError(400, 'VALIDATION', 'Invalid role.', 'role');
  const hash = await bcrypt.hash(password, 10);
  const user = await withTransaction(async (db) => {
    const { rows } = await db.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1,$2,$3) RETURNING *', [username, hash, role]);
    await logActivity(db, req.user.id, 'USER', `account '${username}' created with role ${role} by '${req.user.username}'.`);
    return rows[0];
  });
  res.status(201).json(out(user));
}));

// Promote / demote
router.patch('/:id/role', asyncHandler(async (req, res) => {
  const id = Number(req.params.id), role = req.body.role;
  if (!ROLES.includes(role)) throw new HttpError(400, 'VALIDATION', 'Invalid role.', 'role');
  if (id === req.user.id) throw new HttpError(400, 'VALIDATION', "You can't change your own role.");
  const { rows } = await pool.query('UPDATE users SET role = $1 WHERE user_id = $2 RETURNING *', [role, id]);
  if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'User not found.');
  await logActivity(pool, req.user.id, 'USER', `account '${rows[0].username}' changed to ${role} by '${req.user.username}'.`);
  res.json(out(rows[0]));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw new HttpError(400, 'VALIDATION', "You can't remove your own account.");
  await withTransaction(async (db) => {
    const { rows } = await db.query('DELETE FROM users WHERE user_id = $1 RETURNING username', [id]);
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'User not found.');
    await logActivity(db, req.user.id, 'USER', `account '${rows[0].username}' removed by '${req.user.username}'.`);
  });
  res.json({ ok: true });
}));

module.exports = router;
