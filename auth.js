const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { pool, withTransaction, logActivity } = require('../db');
const { HttpError, asyncHandler } = require('../httpError');
const { signToken, requireAuth } = require('../middleware/auth');

const publicUser = (u) => ({ id: u.user_id, username: u.username, role: u.role });

// --- tiny in-memory brute-force guard: 8 failed logins / 10 min per ip+username ---
const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000, MAX_FAILS = 8;
function tooMany(key) {
  const rec = attempts.get(key);
  return rec && Date.now() - rec.first < WINDOW_MS && rec.count >= MAX_FAILS;
}
function noteFail(key) {
  const rec = attempts.get(key);
  if (!rec || Date.now() - rec.first >= WINDOW_MS) attempts.set(key, { first: Date.now(), count: 1 });
  else rec.count++;
}

router.post('/login', asyncHandler(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const key = `${req.ip}|${username.toLowerCase()}`;
  if (tooMany(key)) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed attempts. Try again in a few minutes.');

  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  const user = rows[0];
  const ok = user && await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    noteFail(key);
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid username or password. Try again.');
  }
  attempts.delete(key);
  await logActivity(pool, user.user_id, 'LOGIN', `user '${user.username}' logged in.`);
  res.json({ token: signToken(user), user: publicUser(user) });
}));

router.post('/signup', asyncHandler(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const confirm = String(req.body.confirmPassword ?? req.body.password ?? '');
  // Self-registration can only ever produce Editor or Viewer
  const role = req.body.role === 'Viewer' ? 'Viewer' : 'Editor';

  if (username.length < 3) throw new HttpError(400, 'VALIDATION', 'Username must be at least 3 characters.', 'user');
  if (password.length < 6) throw new HttpError(400, 'VALIDATION', 'Password must be at least 6 characters.', 'pass');
  if (password !== confirm) throw new HttpError(400, 'VALIDATION', "Passwords don't match.", 'pass');

  const hash = await bcrypt.hash(password, 10);
  const user = await withTransaction(async (db) => {
    const { rows } = await db.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING *',
      [username, hash, role]
    );
    await logActivity(db, rows[0].user_id, 'USER', `account '${username}' self-registered with role ${role}.`);
    await logActivity(db, rows[0].user_id, 'LOGIN', `user '${username}' logged in.`);
    return rows[0];
  });
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

router.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  await logActivity(pool, req.user.id, 'LOGOUT', `user '${req.user.username}' logged out.`);
  res.json({ ok: true });
}));

module.exports = router;
