require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { HttpError } = require('./httpError');
const { pool } = require('./db');

const app = express();
app.disable('x-powered-by');

const origins = (process.env.CORS_ORIGINS || 'https://alien2088.github.io').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || origins.includes(origin)),
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));
app.use(express.json({ limit: '100kb' }));

const { activity, stats, groups } = require('./routes/misc');
app.get('/api/health', async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
});
app.use('/api/auth', require('./routes/auth'));
app.use('/api/contacts', require('./routes/contacts'));
app.use('/api/users', require('./routes/users'));
app.use('/api/activity', activity);
app.use('/api/stats', stats);
app.use('/api/groups', groups);

// Optionally serve the existing frontend files (and ONLY those) from the repo root
if (process.env.SERVE_FRONTEND === 'true') {
  const root = path.join(__dirname, '..', '..');
  app.get('/', (_q, r) => r.sendFile(path.join(root, 'index.html')));
  for (const f of ['app.js', 'api.js', 'config.js', 'styles.css']) app.get('/' + f, (_q, r) => r.sendFile(path.join(root, f)));
}

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'No such endpoint.')));

// Central error handler — maps PostgreSQL errors to friendly HTTP responses
app.use((err, _req, res, _next) => {
  let { status = 500, code = 'SERVER_ERROR', message = 'Something went wrong.', field } = err;

  if (err.code === 'CD001') {                         // trigger: duplicate phone / e-mail
    const who = String(err.message).replace(/^DUPLICATE_CONTACT:/, '');
    status = 409; code = 'DUPLICATE_CONTACT'; message = `${who} already uses this phone number or email.`;
  } else if (err.code === 'CD002') { status = 400; code = 'MERGE_SAME_CONTACT'; message = 'Choose two different contacts to merge.'; }
  else if (err.code === 'CD003') { status = 404; code = 'NOT_FOUND'; message = 'Contact not found.'; }
  else if (err.code === '23505') {                    // unique violation
    status = 409;
    if (/username/.test(err.constraint || '')) { code = 'USERNAME_TAKEN'; field = 'user'; message = 'That username is already taken.'; }
    else if (/group_name/.test(err.constraint || '')) { code = 'GROUP_EXISTS'; message = 'That group already exists.'; }
    else { code = 'CONFLICT'; message = 'That record already exists.'; }
  } else if (err.code === '23514') { status = 400; code = 'VALIDATION'; message = 'A value failed a database check.'; }
  else if (err.type === 'entity.parse.failed') { status = 400; code = 'BAD_JSON'; message = 'Malformed JSON body.'; }
  else if (!(err instanceof HttpError)) { console.error(err); status = 500; code = 'SERVER_ERROR'; message = 'Something went wrong.'; }

  res.status(status).json({ error: code, message, ...(field ? { field } : {}) });
});

module.exports = app;
