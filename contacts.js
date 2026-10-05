const router = require('express').Router();
const { pool, withTransaction, logActivity } = require('../db');
const { HttpError, asyncHandler } = require('../httpError');
const { requireAuth, canEdit } = require('../middleware/auth');

router.use(requireAuth);
router.param('id', (_req, _res, next, v) => (/^\d+$/.test(v) ? next() : next(new HttpError(400, 'VALIDATION', 'Invalid id.'))));

const rec = (id) => `REC-${String(id).padStart(4, '0')}`;
const isValidPhone = (p) => /^\d{10}$/.test(p);
const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Shape matches what the frontend already renders (id, favourite, category, '—' for blank company)
const CONTACT_SELECT = `
  SELECT c.contact_id AS id,
         c.name,
         c.phone::text  AS phone,
         c.email::text  AS email,
         COALESCE(c.address, '') AS address,
         to_char(c.birthday, 'YYYY-MM-DD') AS birthday,
         COALESCE(NULLIF(c.company, ''), '—') AS company,
         c.is_favourite AS favourite,
         c.user_id      AS "addedBy",
         (SELECT g.group_name FROM contact_group cg JOIN groups g USING (group_id)
           WHERE cg.contact_id = c.contact_id ORDER BY g.group_id LIMIT 1) AS category,
         COALESCE((SELECT array_agg(g.group_name ORDER BY g.group_id)
                     FROM contact_group cg JOIN groups g USING (group_id)
                    WHERE cg.contact_id = c.contact_id), '{}') AS groups
    FROM contacts c`;

async function getContact(db, id) {
  const { rows } = await db.query(`${CONTACT_SELECT} WHERE c.contact_id = $1`, [id]);
  return rows[0];
}

/** Validate + normalise the body used by create / update. */
function parseContactBody(b) {
  const data = {
    name: String(b.name || '').trim(),
    phone: String(b.phone || '').trim(),
    email: String(b.email || '').trim(),
    address: String(b.address || '').trim() || null,
    birthday: b.birthday ? String(b.birthday) : null,
    company: ['', '—'].includes(String(b.company || '').trim()) ? null : String(b.company).trim(),
    groups: Array.isArray(b.groups) && b.groups.length ? b.groups.map(String) : (b.category ? [String(b.category)] : []),
  };
  if (!data.name) throw new HttpError(400, 'VALIDATION', 'Name is required.', 'name');
  if (!isValidPhone(data.phone)) throw new HttpError(400, 'VALIDATION', 'Enter a valid 10-digit phone number.', 'phone');
  if (!isValidEmail(data.email)) throw new HttpError(400, 'VALIDATION', 'Enter a valid email address.', 'email');
  if (data.birthday && !/^\d{4}-\d{2}-\d{2}$/.test(data.birthday)) throw new HttpError(400, 'VALIDATION', 'Birthday must be YYYY-MM-DD.', 'birthday');
  if (!data.groups.length) throw new HttpError(400, 'VALIDATION', 'Choose a category.', 'category');
  return data;
}

/** Replace a contact's group memberships (M:N bridge table). */
async function setGroups(db, contactId, groupNames) {
  const { rows } = await db.query('SELECT group_id, group_name FROM groups WHERE group_name = ANY($1)', [groupNames]);
  if (rows.length !== new Set(groupNames).size) throw new HttpError(400, 'VALIDATION', 'Unknown category.', 'category');
  await db.query('DELETE FROM contact_group WHERE contact_id = $1', [contactId]);
  await db.query(
    'INSERT INTO contact_group (contact_id, group_id) SELECT $1, UNNEST($2::int[])',
    [contactId, rows.map((r) => r.group_id)]
  );
}

// ---------------------------------------------------------------- LIST / SEARCH
// GET /api/contacts?q=&category=&letter=&favourites=true&sort=name-asc|name-desc|recent|company
router.get('/', asyncHandler(async (req, res) => {
  const { q, category, letter, favourites, sort } = req.query;
  const where = [], params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.split('$$').join('$' + params.length)); };

  if (category && category !== 'All') add(`EXISTS (SELECT 1 FROM contact_group cg JOIN groups g USING (group_id)
                                                    WHERE cg.contact_id = c.contact_id AND g.group_name = $$)`, category);
  if (letter && letter !== 'All') add('UPPER(LEFT(c.name, 1)) = $$', String(letter).toUpperCase());
  if (favourites === 'true') where.push('c.is_favourite');
  if (q && String(q).trim()) {
    add(`(c.name ILIKE $$ OR c.phone ILIKE $$ OR c.email::text ILIKE $$ OR c.company ILIKE $$ OR c.address ILIKE $$
          OR EXISTS (SELECT 1 FROM contact_group cg JOIN groups g USING (group_id)
                      WHERE cg.contact_id = c.contact_id AND g.group_name ILIKE $$))`, `%${String(q).trim()}%`);
  }
  const order = {
    'name-desc': 'LOWER(c.name) DESC',
    company: "LOWER(COALESCE(c.company, '')) ASC, LOWER(c.name)",
    recent: 'c.contact_id DESC',
  }[sort] || 'LOWER(c.name) ASC';

  const sql = `${CONTACT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}`;
  const { rows } = await pool.query(sql, params);
  res.json(rows);
}));

// ---------------------------------------------------------------- MERGE DUPLICATES (stored procedure)
router.post('/merge', canEdit, asyncHandler(async (req, res) => {
  const keepId = Number(req.body.keepId), removeId = Number(req.body.removeId);
  if (!Number.isInteger(keepId) || !Number.isInteger(removeId)) throw new HttpError(400, 'VALIDATION', 'keepId and removeId are required.');
  await pool.query('CALL sp_merge_contacts($1, $2, $3)', [keepId, removeId, req.user.id]);
  res.json(await getContact(pool, keepId));
}));

// ---------------------------------------------------------------- READ ONE
router.get('/:id', asyncHandler(async (req, res) => {
  const c = await getContact(pool, req.params.id);
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Contact not found.');
  res.json(c);
}));

// ---------------------------------------------------------------- CREATE
router.post('/', canEdit, asyncHandler(async (req, res) => {
  const d = parseContactBody(req.body);
  const contact = await withTransaction(async (db) => {
    // The BEFORE INSERT trigger rejects duplicate phone / e-mail
    const { rows } = await db.query(
      `INSERT INTO contacts (name, phone, email, address, birthday, company, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING contact_id`,
      [d.name, d.phone, d.email, d.address, d.birthday, d.company, req.user.id]
    );
    const id = rows[0].contact_id;
    await setGroups(db, id, d.groups);
    await logActivity(db, req.user.id, 'ADD', `record ${rec(id)} ('${d.name}') created by '${req.user.username}'.`);
    return getContact(db, id);
  });
  res.status(201).json(contact);
}));

// ---------------------------------------------------------------- UPDATE
router.put('/:id', canEdit, asyncHandler(async (req, res) => {
  const d = parseContactBody(req.body);
  const id = Number(req.params.id);
  const contact = await withTransaction(async (db) => {
    const r = await db.query(
      `UPDATE contacts SET name=$1, phone=$2, email=$3, address=$4, birthday=$5, company=$6
        WHERE contact_id=$7 RETURNING contact_id`,
      [d.name, d.phone, d.email, d.address, d.birthday, d.company, id]
    );
    if (!r.rowCount) throw new HttpError(404, 'NOT_FOUND', 'Contact not found.');
    await setGroups(db, id, d.groups);
    await logActivity(db, req.user.id, 'UPDATE', `record ${rec(id)} ('${d.name}') edited by '${req.user.username}'.`);
    return getContact(db, id);
  });
  res.json(contact);
}));

// ---------------------------------------------------------------- FAVOURITE (any signed-in role, as in the UI)
router.patch('/:id/favourite', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await pool.query(
    'UPDATE contacts SET is_favourite = NOT is_favourite WHERE contact_id = $1 RETURNING name, is_favourite', [id]);
  if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Contact not found.');
  await logActivity(pool, req.user.id, 'FAVOURITE',
    `record ${rec(id)} ('${rows[0].name}') ${rows[0].is_favourite ? 'marked' : 'unmarked'} as favourite.`);
  res.json(await getContact(pool, id));
}));

// ---------------------------------------------------------------- DELETE
router.delete('/:id', canEdit, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  await withTransaction(async (db) => {
    const { rows } = await db.query('DELETE FROM contacts WHERE contact_id = $1 RETURNING name', [id]); // cascades groups + comm log
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Contact not found.');
    await logActivity(db, req.user.id, 'DELETE', `record ${rec(id)} ('${rows[0].name}') removed by '${req.user.username}'.`);
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- COMMUNICATION LOG (weak entity)
router.get('/:id/communications', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT l.log_id AS "logId", l.type, l.log_datetime AS "datetime", l.notes, u.username AS "loggedBy"
       FROM communication_log l LEFT JOIN users u ON u.user_id = l.logged_by
      WHERE l.contact_id = $1 ORDER BY l.log_datetime DESC, l.log_id DESC`, [req.params.id]);
  res.json(rows);
}));

router.post('/:id/communications', canEdit, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const type = String(req.body.type || '');
  if (!['Call', 'Message', 'Meeting'].includes(type)) throw new HttpError(400, 'VALIDATION', 'Type must be Call, Message or Meeting.', 'type');
  const notes = String(req.body.notes || '').trim().slice(0, 500) || null;
  const when = req.body.datetime ? new Date(req.body.datetime) : new Date();
  if (isNaN(when)) throw new HttpError(400, 'VALIDATION', 'Invalid date/time.', 'datetime');

  const entry = await withTransaction(async (db) => {
    const c = await db.query('SELECT name FROM contacts WHERE contact_id = $1', [id]);
    if (!c.rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Contact not found.');
    // log_id left as 0 -> trigger numbers it per contact
    const { rows } = await db.query(
      `INSERT INTO communication_log (contact_id, log_id, type, log_datetime, notes, logged_by)
       VALUES ($1, 0, $2, $3, $4, $5) RETURNING log_id AS "logId", type, log_datetime AS "datetime", notes`,
      [id, type, when, notes, req.user.id]);
    await logActivity(db, req.user.id, 'COMM', `${type} logged against ${rec(id)} ('${c.rows[0].name}') by '${req.user.username}'.`);
    return { ...rows[0], loggedBy: req.user.username };
  });
  res.status(201).json(entry);
}));

module.exports = router;
