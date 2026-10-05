// End-to-end smoke test against a DEV database (run `npm run db:init` first).
// It creates and removes its own test records.
require('dotenv').config();
const assert = require('assert');
const app = require('../src/app');
const { pool } = require('../src/db');

let base, passed = 0;
const call = async (method, path, body, token) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const ok = (name, cond) => { assert.ok(cond, name); passed++; console.log('  ✓', name); };

(async () => {
  const server = app.listen(0); base = `http://localhost:${server.address().port}/api`;
  const stamp = Date.now() % 100000;

  console.log('Auth');
  let r = await call('POST', '/auth/login', { username: 'admin', password: 'wrong' });
  ok('bad password → 401', r.status === 401);
  r = await call('POST', '/auth/login', { username: 'ADMIN', password: 'admin123' });
  ok('default admin logs in (case-insensitive username)', r.status === 200 && r.body.user.role === 'Administrator');
  const admin = r.body.token;
  ok('contacts without token → 401', (await call('GET', '/contacts')).status === 401);

  r = await call('POST', '/auth/signup', { username: `viewer${stamp}`, password: 'secret1', confirmPassword: 'secret1', role: 'Viewer' });
  ok('signup creates Viewer', r.status === 201 && r.body.user.role === 'Viewer');
  const viewer = r.body.token, viewerId = r.body.user.id;
  r = await call('POST', '/auth/signup', { username: `sneaky${stamp}`, password: 'secret1', confirmPassword: 'secret1', role: 'Administrator' });
  ok('signup cannot self-assign Administrator', r.body.user.role === 'Editor');
  const sneakyId = r.body.user.id;
  r = await call('POST', '/auth/signup', { username: `viewer${stamp}`, password: 'secret1', confirmPassword: 'secret1' });
  ok('duplicate username → 409', r.status === 409);
  r = await call('POST', '/auth/signup', { username: 'ab', password: 'secret1', confirmPassword: 'secret1' });
  ok('short username → 400', r.status === 400);

  console.log('Contacts + role gates');
  const body = { name: `Test Person ${stamp}`, phone: `99${String(stamp).padStart(8, '0')}`, email: `t${stamp}@example.com`, address: 'X', birthday: '2000-01-01', company: '', category: 'Business' };
  ok('viewer cannot create → 403', (await call('POST', '/contacts', body, viewer)).status === 403);
  r = await call('POST', '/contacts', { ...body, phone: '123' }, admin);
  ok('invalid phone → 400', r.status === 400 && r.body.field === 'phone');
  r = await call('POST', '/contacts', { ...body, email: 'nope' }, admin);
  ok('invalid email → 400', r.status === 400 && r.body.field === 'email');
  r = await call('POST', '/contacts', body, admin);
  ok('admin creates contact', r.status === 201 && r.body.category === 'Business' && r.body.company === '—');
  const a = r.body;
  r = await call('POST', '/contacts', { ...body, name: 'Dup Phone', email: `other${stamp}@example.com` }, admin);
  ok('trigger blocks duplicate phone → 409', r.status === 409 && r.body.error === 'DUPLICATE_CONTACT' && r.body.message.includes(a.name));
  r = await call('POST', '/contacts', { ...body, name: 'Dup Mail', phone: `88${String(stamp).padStart(8, '0')}`, email: body.email.toUpperCase() }, admin);
  ok('trigger blocks duplicate e-mail (case-insensitive) → 409', r.status === 409);

  r = await call('PUT', `/contacts/${a.id}`, { ...body, name: `Renamed ${stamp}`, category: 'Family' }, admin);
  ok('update changes name + category', r.status === 200 && r.body.name.startsWith('Renamed') && r.body.category === 'Family');
  r = await call('PATCH', `/contacts/${a.id}/favourite`, null, viewer);
  ok('viewer can toggle favourite', r.status === 200 && r.body.favourite === true);

  r = await call('GET', `/contacts?q=renamed ${stamp}`, null, viewer);
  ok('search finds contact', r.body.length === 1);
  r = await call('GET', '/contacts?category=Academic&sort=name-desc', null, viewer);
  ok('category filter + sort', r.body.length >= 4 && r.body[0].name >= r.body[1].name);
  r = await call('GET', '/contacts?letter=P&favourites=true', null, viewer);
  ok('letter + favourites filter', r.body.some((c) => c.name === 'Priya Menon'));

  console.log('Communication log (weak entity) + merge procedure');
  const b = (await call('POST', '/contacts', { name: `Merge Dup ${stamp}`, phone: `77${String(stamp).padStart(8, '0')}`, email: `dup${stamp}@example.com`, address: 'Dup Street', company: 'DupCo', category: 'Personal' }, admin)).body;
  for (const t of ['Call', 'Message']) await call('POST', `/contacts/${a.id}/communications`, { type: t, notes: 'a-' + t }, admin);
  for (const t of ['Meeting', 'Call', 'Call']) await call('POST', `/contacts/${b.id}/communications`, { type: t, notes: 'b-' + t }, admin);
  r = await call('GET', `/contacts/${b.id}/communications`, null, viewer);
  ok('log_id numbered 1..n per contact', r.body.map((x) => x.logId).sort().join() === '1,2,3');
  r = await call('POST', `/contacts/${a.id}/communications`, { type: 'Email' }, admin);
  ok('invalid comm type → 400', r.status === 400);
  ok('viewer cannot delete → 403', (await call('DELETE', `/contacts/${b.id}`, null, viewer)).status === 403);
  ok('viewer cannot merge → 403', (await call('POST', '/contacts/merge', { keepId: a.id, removeId: b.id }, viewer)).status === 403);
  r = await call('POST', '/contacts/merge', { keepId: a.id, removeId: b.id }, admin);
  ok('merge succeeds; kept record inherits blank company', r.status === 200 && r.body.company === 'DupCo');
  ok('merged record gains the duplicate\'s groups', r.body.groups.includes('Personal') && r.body.groups.includes('Family'));
  r = await call('GET', `/contacts/${a.id}/communications`, null, admin);
  ok('all 5 history entries preserved after merge', r.body.length === 5);
  ok('duplicate row deleted', (await call('GET', `/contacts/${b.id}`, null, admin)).status === 404);
  ok('merge same contact → 400', (await call('POST', '/contacts/merge', { keepId: a.id, removeId: a.id }, admin)).status === 400);

  console.log('Views / stats');
  r = await call('GET', '/stats/frequent?limit=3', null, viewer);
  ok('frequent-contacts view ordered by interactions', r.body[0].interactionCount >= r.body[1].interactionCount);
  r = await call('GET', '/stats/groups', null, viewer);
  ok('group distribution view', r.body.length >= 4);
  r = await call('GET', '/stats/summary', null, viewer);
  ok('summary counts', r.body.total >= 7 && r.body.favourites >= 1);

  console.log('Users + activity log (admin only)');
  ok('viewer cannot list users → 403', (await call('GET', '/users', null, viewer)).status === 403);
  ok('viewer cannot read activity → 403', (await call('GET', '/activity', null, viewer)).status === 403);
  r = await call('POST', '/users', { username: `edit${stamp}`, password: 'secret1', role: 'Editor' }, admin);
  ok('admin creates user', r.status === 201);
  const newId = r.body.id;
  ok('admin promotes user', (await call('PATCH', `/users/${newId}/role`, { role: 'Viewer' }, admin)).body.role === 'Viewer');
  ok('admin removes users', (await call('DELETE', `/users/${newId}`, null, admin)).status === 200);
  await call('DELETE', `/users/${viewerId}`, null, admin); await call('DELETE', `/users/${sneakyId}`, null, admin);
  ok('deleted user\'s token stops working', (await call('GET', '/auth/me', null, viewer)).status === 401);
  r = await call('GET', '/activity', null, admin);
  ok('activity log records LOGIN/ADD/MERGE etc., newest first', r.status === 200 && r.body.some((x) => x.action === 'MERGE') && r.body.some((x) => x.msg.startsWith('LOGIN —')));
  ok('own account cannot be deleted', (await call('DELETE', '/users/1', null, admin)).status === 400);

  console.log('Delete');
  r = await call('DELETE', `/contacts/${a.id}`, null, admin);
  ok('admin deletes contact', r.status === 200);
  const left = await pool.query('SELECT COUNT(*)::int n FROM communication_log WHERE contact_id = $1', [a.id]);
  ok('communication log cascaded on delete', left.rows[0].n === 0);
  ok('bad id → 400', (await call('GET', '/contacts/abc', null, admin)).status === 400);

  console.log(`\nAll ${passed} checks passed.`);
  server.close(); await pool.end();
})().catch(async (e) => { console.error('\nFAILED:', e.message); await pool.end(); process.exit(1); });
