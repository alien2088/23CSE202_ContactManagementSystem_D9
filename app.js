/* ============================================================================
   CONTACT MANAGEMENT SYSTEM — app.js
   Group D12 · 23CSE111 Object Oriented Programming

   Everything below is plain frontend JS. All data (users, contacts,
   activity logs, favourites) is persisted in the browser's LocalStorage
   so it survives a page refresh. There is no backend / server / database
   of any kind — this is intentional per the project brief.
   ============================================================================ */

/* ---------------------------------------------------------------------------
   1. STORAGE KEYS & LOW-LEVEL HELPERS
   ------------------------------------------------------------------------- */
const STORAGE = {
  users: 'cms_users',
  contacts: 'cms_contacts',
  logs: 'cms_logs',
  session: 'cms_session',
  nextContactId: 'cms_next_contact_id',
};

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.warn('Could not read', key, e);
    return fallback;
  }
}
function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('Could not save', key, e);
  }
}

/* Very small, non-cryptographic string hash used only so we don't store
   passwords as plain text in LocalStorage. This is a classroom project
   with no server, so this is a deterrent, not real security. */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

/* ---------------------------------------------------------------------------
   2. SEED DATA (used only the very first time the app runs — i.e. when
      LocalStorage is empty. After that, everything the user does is
      persisted and reloaded from LocalStorage on every visit.)
   ------------------------------------------------------------------------- */
const SEED_CONTACTS = [
  { id: 1, name: "Alien Lakshmi", phone: "9876543210", email: "alien@gmail.com", address: "Kochi, Kerala", birthday: "2005-03-15", company: "Amrita", category: "Academic", favourite: false },
  { id: 2, name: "Abel Binu Varghese", phone: "9123456789", email: "abel@gmail.com", address: "Trivandrum, Kerala", birthday: "2004-11-20", company: "Amrita", category: "Academic", favourite: false },
  { id: 3, name: "Kasinath V", phone: "9988776655", email: "kasinath@gmail.com", address: "Ernakulam, Kerala", birthday: "2005-07-08", company: "Amrita", category: "Academic", favourite: false },
  { id: 4, name: "Devananda J A", phone: "9445566778", email: "devananda@gmail.com", address: "Kollam, Kerala", birthday: "2005-01-30", company: "Amrita", category: "Academic", favourite: false },
  { id: 5, name: "Priya Menon", phone: "9871234560", email: "priya.menon@techcorp.com", address: "Bengaluru, Karnataka", birthday: "1998-06-12", company: "TechCorp Solutions", category: "Business", favourite: true },
  { id: 6, name: "Rahul Nair", phone: "9345678123", email: "rahul.nair@outlook.com", address: "Chennai, Tamil Nadu", birthday: "1995-09-24", company: "—", category: "Personal", favourite: false },
  { id: 7, name: "Sarath Krishnan", phone: "9012345678", email: "sarath.k@familymail.com", address: "Thrissur, Kerala", birthday: "1970-02-18", company: "—", category: "Family", favourite: false },
];

function seedIfEmpty() {
  if (localStorage.getItem(STORAGE.users) === null) {
    saveJSON(STORAGE.users, [
      { id: 1, username: "admin", passwordHash: simpleHash("admin123"), role: "Administrator" }
    ]);
  }
  if (localStorage.getItem(STORAGE.contacts) === null) {
    saveJSON(STORAGE.contacts, SEED_CONTACTS);
    saveJSON(STORAGE.nextContactId, 8);
  }
  if (localStorage.getItem(STORAGE.logs) === null) {
    saveJSON(STORAGE.logs, [{ ts: nowStamp(), msg: "SYSTEM — drawer initialised with default admin account." }]);
  }
}

/* ---------------------------------------------------------------------------
   3. IN-MEMORY STATE (hydrated from LocalStorage, written back on change)
   ------------------------------------------------------------------------- */
let users = [];
let contacts = [];
let logs = [];
let nextContactId = 1;
let currentUser = null; // { id, username, role }

let activeCategory = "All";
let activeLetter = "All";
let favouritesOnly = false;
let sortMode = "name-asc";
let pendingDelete = null; // { type: 'contact'|'user', id }

const catColors = { Personal: "#2B4A75", Business: "#4A6B94", Family: "#1D2532", Academic: "#6E86A6" };
const roleColors = { Administrator: "#2B4A75", Editor: "#4A6B94", Viewer: "#6E86A6" };
const AVATAR_PALETTE = ["#2B4A75", "#4A6B94", "#6E86A6", "#3A3D46", "#1D3350", "#5b6472"];

function persistUsers() { saveJSON(STORAGE.users, users); }
function persistContacts() { saveJSON(STORAGE.contacts, contacts); }
function persistLogs() { saveJSON(STORAGE.logs, logs); }

function nowStamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function addLog(msg) {
  logs.unshift({ ts: nowStamp(), msg });
  if (logs.length > 300) logs.length = 300;
  persistLogs();
  renderLogBadge();
}

/* ---------------------------------------------------------------------------
   4. VALIDATION HELPERS
   ------------------------------------------------------------------------- */
function isValidPhone(phone) { return /^\d{10}$/.test(phone.trim()); }
function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()); }

function findDuplicateContact(phone, email, excludeId) {
  const p = phone.trim();
  const e = email.trim().toLowerCase();
  return contacts.find(c =>
    c.id !== excludeId && (c.phone === p || c.email.toLowerCase() === e)
  );
}

/* ---------------------------------------------------------------------------
   5. AUTH — sign in, sign up, sign out, session persistence
   ------------------------------------------------------------------------- */
function findUserByUsername(username) {
  const u = username.trim().toLowerCase();
  return users.find(x => x.username.toLowerCase() === u);
}

function attemptLogin(username, password) {
  const user = findUserByUsername(username);
  if (!user || user.passwordHash !== simpleHash(password)) {
    return { ok: false, message: "Invalid username or password. Try again." };
  }
  currentUser = { id: user.id, username: user.username, role: user.role };
  saveJSON(STORAGE.session, currentUser);
  addLog(`LOGIN — user '${user.username}' logged in.`);
  return { ok: true };
}

function attemptSignup(username, password, confirmPassword, role) {
  const uname = username.trim();
  if (uname.length < 3) return { ok: false, field: 'user', message: "Username must be at least 3 characters." };
  if (findUserByUsername(uname)) return { ok: false, field: 'user', message: `'${uname}' is already taken.` };
  if (password.length < 6) return { ok: false, field: 'pass', message: "Password must be at least 6 characters." };
  if (password !== confirmPassword) return { ok: false, field: 'pass', message: "Passwords don't match." };

  const newId = users.length ? Math.max(...users.map(u => u.id)) + 1 : 1;
  const user = { id: newId, username: uname, passwordHash: simpleHash(password), role: role === 'Viewer' ? 'Viewer' : 'Editor' };
  users.push(user);
  persistUsers();
  addLog(`USER — account '${uname}' self-registered with role ${user.role}.`);

  currentUser = { id: user.id, username: user.username, role: user.role };
  saveJSON(STORAGE.session, currentUser);
  addLog(`LOGIN — user '${uname}' logged in.`);
  return { ok: true, role: user.role };
}

function logout() {
  addLog(`LOGOUT — user '${currentUser.username}' logged out.`);
  currentUser = null;
  localStorage.removeItem(STORAGE.session);
  showLoginView();
  showToast("Session ended", "You've been logged out safely.", false);
}

function restoreSession() {
  const session = loadJSON(STORAGE.session, null);
  if (session && findUserByUsername(session.username)) {
    // Re-hydrate role from the users table in case an admin changed it
    const fresh = findUserByUsername(session.username);
    currentUser = { id: fresh.id, username: fresh.username, role: fresh.role };
    return true;
  }
  return false;
}

/* ---------------------------------------------------------------------------
   6. ROLE-BASED ACCESS CONTROL
   ------------------------------------------------------------------------- */
function canEditContacts() {
  return currentUser && (currentUser.role === 'Administrator' || currentUser.role === 'Editor');
}
function isAdmin() {
  return currentUser && currentUser.role === 'Administrator';
}

function applyRoleGates() {
  document.querySelectorAll('[data-role-gate="admin-nav"]').forEach(el => {
    el.classList.toggle('allowed', isAdmin());
  });
  document.querySelectorAll('[data-role-gate="editor-action"]').forEach(el => {
    el.classList.toggle('allowed', canEditContacts());
  });
}

/* ---------------------------------------------------------------------------
   7. VIEW SWITCHING
   ------------------------------------------------------------------------- */
function showLoginView() {
  document.getElementById('appView').style.display = 'none';
  document.getElementById('loginView').style.display = 'flex';
  document.getElementById('loginForm').reset();
  document.getElementById('signupForm').reset();
  document.getElementById('loginError').classList.remove('show-block');
  document.getElementById('loginError').style.display = 'none';
}

function showAppView() {
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('appView').style.display = 'block';
  document.getElementById('currentUserAvatar').textContent = currentUser.username[0].toUpperCase();
  document.getElementById('currentUserName').textContent = currentUser.username;
  document.getElementById('currentUserRole').textContent = currentUser.role;
  applyRoleGates();
  renderAll();
}

/* ---------------------------------------------------------------------------
   8. RENDERING — sidebar, grid, stats, badges
   ------------------------------------------------------------------------- */
function renderAll() {
  renderCategoryList();
  renderAZRail();
  renderGrid();
  renderStats();
  renderUserBadge();
  renderLogBadge();
}

function renderCategoryList() {
  const cats = ["All", ...new Set(contacts.map(c => c.category))];
  const list = document.getElementById('catList');
  list.innerHTML = cats.map(cat => {
    const count = cat === "All" ? contacts.length : contacts.filter(c => c.category === cat).length;
    const color = cat === "All" ? "#9AA0AE" : catColors[cat] || "#9AA0AE";
    return `<li><button class="cat-btn ${activeCategory === cat ? 'active' : ''}" data-action="set-category" data-value="${escapeHtml(cat)}">
      <span style="display:flex;align-items:center;"><span class="cat-dot" style="background:${color}"></span>${escapeHtml(cat)}</span>
      <span class="cat-count">${count}</span>
    </button></li>`;
  }).join('');
}

function renderAZRail() {
  const present = new Set(contacts.map(c => c.name[0].toUpperCase()));
  const rail = document.getElementById('azRail');
  let html = `<button class="az-btn ${activeLetter === 'All' ? 'active' : ''}" data-action="set-letter" data-value="All" style="width:auto;padding:0 8px;">All</button>`;
  for (let i = 65; i <= 90; i++) {
    const L = String.fromCharCode(i);
    const has = present.has(L);
    html += `<button class="az-btn ${activeLetter === L ? 'active' : ''}" ${has ? '' : 'disabled'} data-action="set-letter" data-value="${L}">${L}</button>`;
  }
  rail.innerHTML = html;
}

function getFiltered() {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  let list = contacts.filter(c => {
    if (activeCategory !== "All" && c.category !== activeCategory) return false;
    if (activeLetter !== "All" && c.name[0].toUpperCase() !== activeLetter) return false;
    if (favouritesOnly && !c.favourite) return false;
    if (q) {
      const haystack = [c.name, c.phone, c.email, c.company, c.address, c.category].join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  switch (sortMode) {
    case 'name-desc': list.sort((a, b) => b.name.localeCompare(a.name)); break;
    case 'company': list.sort((a, b) => (a.company || '').localeCompare(b.company || '')); break;
    case 'recent': list.sort((a, b) => b.id - a.id); break;
    case 'name-asc':
    default: list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return list;
}

function avatarColorFor(name) {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return AVATAR_PALETTE[sum % AVATAR_PALETTE.length];
}
function initialsFor(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function starIconSVG(filled) {
  return `<svg viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
}

function renderGrid() {
  const filtered = getFiltered();
  const grid = document.getElementById('cardGrid');
  document.getElementById('shownCount').textContent = filtered.length;
  document.getElementById('totalCount').textContent = contacts.length;

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v5"/></svg>
      <h3>No cards match</h3>
      <p>Try a different search term, category, or letter — or file a new contact.</p>
    </div>`;
    return;
  }

  const canEdit = canEditContacts();

  grid.innerHTML = filtered.map(c => {
    const color = catColors[c.category] || "#9AA0AE";
    const avColor = avatarColorFor(c.name);
    return `
    <div class="rcard" data-letter="${c.name[0].toUpperCase()}" data-action="open-detail" data-id="${c.id}">
      <button class="fav-btn ${c.favourite ? 'active' : ''}" data-action="toggle-fav" data-id="${c.id}" title="Toggle favourite">
        ${starIconSVG(c.favourite)}
      </button>
      <div class="rcard-head">
        <div class="avatar-circle" style="background:${avColor}">${initialsFor(c.name)}</div>
        <div class="rcard-head-text">
          <div class="rcard-id">REC-${String(c.id).padStart(4, '0')}</div>
          <div class="rcard-name">${escapeHtml(c.name)}</div>
        </div>
      </div>
      <div class="rcard-company">${escapeHtml(c.company || '—')}</div>
      <div class="rcard-line"></div>
      <div class="rcard-row"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>${escapeHtml(c.phone)}</div>
      <div class="rcard-row"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4V4z"/><path d="M4 6l8 7 8-7"/></svg>${escapeHtml(c.email)}</div>
      <div class="rcard-foot">
        <span class="badge" style="background:${color}22; color:${color};">${escapeHtml(c.category)}</span>
        <div class="rcard-actions">
          ${canEdit ? `
          <button class="icon-btn" title="Edit" data-action="edit-contact" data-id="${c.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
          <button class="icon-btn danger" title="Delete" data-action="delete-contact" data-id="${c.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6"/></svg>
          </button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderStats() {
  document.getElementById('statTotal').textContent = contacts.length;
  document.getElementById('statCats').textContent = new Set(contacts.map(c => c.category)).size;
  document.getElementById('statCompanies').textContent = new Set(contacts.map(c => c.company).filter(x => x && x !== '—')).size;
  document.getElementById('statFav').textContent = contacts.filter(c => c.favourite).length;
}

function renderUserBadge() {
  const el = document.getElementById('userCountBadge');
  if (el) el.textContent = users.length;
}
function renderLogBadge() {
  const el = document.getElementById('logCountBadge');
  if (el) el.textContent = logs.length;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function formatDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* ---------------------------------------------------------------------------
   9. DETAIL PANEL
   ------------------------------------------------------------------------- */
function openDetail(id) {
  const c = contacts.find(x => x.id === id);
  if (!c) return;
  const color = catColors[c.category] || "#9AA0AE";
  const avColor = avatarColorFor(c.name);
  const canEdit = canEditContacts();
  const panel = document.getElementById('detailPanel');
  panel.innerHTML = `
    <div class="detail-head">
      <button class="detail-close" data-action="close-overlays">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        Close drawer
      </button>
    </div>
    <div class="detail-card" data-letter="${c.name[0].toUpperCase()}">
      <div style="display:flex; align-items:center; gap:12px; margin-bottom:14px;">
        <div class="avatar-circle" style="background:${avColor}; width:46px; height:46px; font-size:16px;">${initialsFor(c.name)}</div>
        <div>
          <div class="detail-id">RECORD REC-${String(c.id).padStart(4, '0')} · <span style="color:${color}">${escapeHtml(c.category)}</span></div>
        </div>
      </div>
      <div class="detail-name">${escapeHtml(c.name)}</div>
      <div class="detail-company">${escapeHtml(c.company || '—')}</div>
      <button class="detail-fav-btn ${c.favourite ? 'active' : ''}" data-action="toggle-fav" data-id="${c.id}">
        ${starIconSVG(c.favourite)} ${c.favourite ? 'Favourited' : 'Add to favourites'}
      </button>
      <div class="detail-field" style="margin-top:18px;"><div class="dl">Phone</div><div class="dv">${escapeHtml(c.phone)}</div></div>
      <div class="detail-field"><div class="dl">Email</div><div class="dv">${escapeHtml(c.email)}</div></div>
      <div class="detail-field"><div class="dl">Address</div><div class="dv">${escapeHtml(c.address || '—')}</div></div>
      <div class="detail-field"><div class="dl">Birthday</div><div class="dv">${c.birthday ? formatDate(c.birthday) : '—'}</div></div>
    </div>
    ${canEdit ? `
    <div class="detail-actions">
      <button class="btn btn-edit" data-action="edit-contact" data-id="${c.id}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        Edit card
      </button>
      <button class="btn btn-del" data-action="delete-contact" data-id="${c.id}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6"/></svg>
        Delete
      </button>
    </div>` : ''}
    <div class="log-strip">
      <div class="ll">Record notes</div>
      <div class="log-item">Filed under "${escapeHtml(c.category)}" category</div>
      <div class="log-item">Record ID stamped REC-${String(c.id).padStart(4, '0')}</div>
    </div>
  `;
  document.getElementById('overlay').classList.add('show');
  panel.classList.add('show');
}

function closeAllOverlays() {
  document.getElementById('overlay').classList.remove('show');
  document.getElementById('detailPanel').classList.remove('show');
  closeFormModal();
  closeConfirmModal();
  document.getElementById('usersModal').classList.remove('show');
  document.getElementById('logsModal').classList.remove('show');
}

/* ---------------------------------------------------------------------------
   10. ADD / EDIT CONTACT MODAL
   ------------------------------------------------------------------------- */
function clearFieldErrors() {
  document.querySelectorAll('#contactForm .field').forEach(f => f.classList.remove('has-error'));
  document.querySelectorAll('#contactForm .field-error').forEach(e => e.classList.remove('show'));
}

function openAddModal() {
  if (!canEditContacts()) return;
  document.getElementById('contactForm').reset();
  clearFieldErrors();
  document.getElementById('f_id').value = '';
  document.getElementById('formModalTitle').textContent = 'Add contact';
  document.getElementById('formModalSub').textContent = 'New card will be filed alphabetically';
  document.getElementById('formSubmitBtn').textContent = 'Save contact';
  document.getElementById('overlay').classList.add('show');
  document.getElementById('formModal').classList.add('show');
}

function openEditModal(id) {
  if (!canEditContacts()) return;
  const c = contacts.find(x => x.id === id);
  if (!c) return;
  clearFieldErrors();
  document.getElementById('f_id').value = c.id;
  document.getElementById('f_name').value = c.name;
  document.getElementById('f_phone').value = c.phone;
  document.getElementById('f_email').value = c.email;
  document.getElementById('f_address').value = c.address || '';
  document.getElementById('f_birthday').value = c.birthday || '';
  document.getElementById('f_company').value = c.company === '—' ? '' : (c.company || '');
  document.getElementById('f_category').value = c.category;
  document.getElementById('formModalTitle').textContent = 'Edit contact';
  document.getElementById('formModalSub').textContent = `Editing REC-${String(c.id).padStart(4, '0')} — leave fields as-is to keep current values`;
  document.getElementById('formSubmitBtn').textContent = 'Update contact';
  document.getElementById('detailPanel').classList.remove('show');
  document.getElementById('overlay').classList.add('show');
  document.getElementById('formModal').classList.add('show');
}

function closeFormModal() {
  document.getElementById('formModal').classList.remove('show');
  if (!document.getElementById('detailPanel').classList.contains('show') && !document.getElementById('confirmModal').classList.contains('show')) {
    document.getElementById('overlay').classList.remove('show');
  }
}

function saveContact(e) {
  e.preventDefault();
  if (!canEditContacts()) return false;
  clearFieldErrors();

  const id = document.getElementById('f_id').value;
  const data = {
    name: document.getElementById('f_name').value.trim(),
    phone: document.getElementById('f_phone').value.trim(),
    email: document.getElementById('f_email').value.trim(),
    address: document.getElementById('f_address').value.trim(),
    birthday: document.getElementById('f_birthday').value,
    company: document.getElementById('f_company').value.trim() || '—',
    category: document.getElementById('f_category').value,
  };

  let hasError = false;
  if (!isValidPhone(data.phone)) {
    document.getElementById('f_phone').closest('.field').classList.add('has-error');
    document.getElementById('f_phone_err').classList.add('show');
    hasError = true;
  }
  if (!isValidEmail(data.email)) {
    document.getElementById('f_email').closest('.field').classList.add('has-error');
    document.getElementById('f_email_err').classList.add('show');
    hasError = true;
  }
  if (hasError) return false;

  const dup = findDuplicateContact(data.phone, data.email, id ? Number(id) : null);
  if (dup) {
    showToast("Duplicate contact", `${dup.name} already uses this phone number or email.`, true);
    return false;
  }

  if (id) {
    const c = contacts.find(x => x.id === Number(id));
    Object.assign(c, data);
    persistContacts();
    addLog(`UPDATE — record REC-${String(c.id).padStart(4, '0')} ('${c.name}') edited by '${currentUser.username}'.`);
    showToast("Contact updated", `${data.name}'s card has been refiled.`, false);
  } else {
    const c = { id: nextContactId++, favourite: false, ...data };
    saveJSON(STORAGE.nextContactId, nextContactId);
    contacts.push(c);
    persistContacts();
    addLog(`ADD — record REC-${String(c.id).padStart(4, '0')} ('${c.name}') created by '${currentUser.username}'.`);
    showToast("Contact added", `${data.name} was saved to file with ID REC-${String(c.id).padStart(4, '0')}.`, false);
  }

  closeFormModal();
  document.getElementById('overlay').classList.remove('show');
  renderAll();
  return false;
}

function toggleFavourite(id) {
  const c = contacts.find(x => x.id === id);
  if (!c) return;
  c.favourite = !c.favourite;
  persistContacts();
  addLog(`FAVOURITE — record REC-${String(c.id).padStart(4, '0')} ('${c.name}') ${c.favourite ? 'marked' : 'unmarked'} as favourite.`);
  renderGrid();
  renderStats();
  if (document.getElementById('detailPanel').classList.contains('show')) openDetail(id);
}

/* ---------------------------------------------------------------------------
   11. DELETE (contact or user) — shared confirm modal
   ------------------------------------------------------------------------- */
function openConfirmModal(type, id) {
  if (type === 'contact') {
    const c = contacts.find(x => x.id === id);
    if (!c) return;
    pendingDelete = { type, id };
    document.getElementById('confirmTitle').textContent = 'Delete this contact?';
    document.getElementById('confirmSub').innerHTML = `This will permanently remove <b id="confirmName" style="color:var(--card);">${escapeHtml(c.name)}</b> from the file. This can't be undone.`;
    document.getElementById('confirmOkBtn').textContent = 'Delete contact';
  } else if (type === 'user') {
    const u = users.find(x => x.id === id);
    if (!u) return;
    pendingDelete = { type, id };
    document.getElementById('confirmTitle').textContent = 'Remove this user?';
    document.getElementById('confirmSub').innerHTML = `<b style="color:var(--card);">${escapeHtml(u.username)}</b> will no longer be able to sign in. This can't be undone.`;
    document.getElementById('confirmOkBtn').textContent = 'Remove user';
  }
  document.getElementById('overlay').classList.add('show');
  document.getElementById('confirmModal').classList.add('show');
}
function closeConfirmModal() {
  document.getElementById('confirmModal').classList.remove('show');
  pendingDelete = null;
  if (!document.getElementById('detailPanel').classList.contains('show') && !document.getElementById('formModal').classList.contains('show') && !document.getElementById('usersModal').classList.contains('show')) {
    document.getElementById('overlay').classList.remove('show');
  }
}
function confirmPendingDelete() {
  if (!pendingDelete) return;
  if (pendingDelete.type === 'contact') {
    const c = contacts.find(x => x.id === pendingDelete.id);
    if (!c) return;
    contacts = contacts.filter(x => x.id !== pendingDelete.id);
    persistContacts();
    addLog(`DELETE — record REC-${String(c.id).padStart(4, '0')} ('${c.name}') removed by '${currentUser.username}'.`);
    closeConfirmModal();
    document.getElementById('overlay').classList.remove('show');
    document.getElementById('detailPanel').classList.remove('show');
    showToast("Contact deleted", `${c.name} was removed from the file.`, true);
    renderAll();
  } else if (pendingDelete.type === 'user') {
    const u = users.find(x => x.id === pendingDelete.id);
    if (!u) return;
    users = users.filter(x => x.id !== pendingDelete.id);
    persistUsers();
    addLog(`USER — account '${u.username}' removed by '${currentUser.username}'.`);
    closeConfirmModal();
    renderUserList();
    renderUserBadge();
    showToast("User removed", `${u.username}'s access has been revoked.`, true);
    if (!document.getElementById('formModal').classList.contains('show') && !document.getElementById('detailPanel').classList.contains('show')) {
      // keep users modal + overlay open since we were managing users
      document.getElementById('overlay').classList.add('show');
      document.getElementById('usersModal').classList.add('show');
    }
  }
}

/* ---------------------------------------------------------------------------
   12. MANAGE USERS (Administrator only)
   ------------------------------------------------------------------------- */
function renderUserList() {
  const wrap = document.getElementById('userList');
  wrap.innerHTML = users.map(u => {
    const color = roleColors[u.role] || "#9AA0AE";
    const isSelf = currentUser && u.id === currentUser.id;
    return `
    <div style="display:flex; align-items:center; justify-content:space-between; background:rgba(255,255,255,0.03); border:1px solid var(--ink-line); border-radius:6px; padding:11px 14px;">
      <div style="display:flex; align-items:center; gap:10px;">
        <div class="user-avatar" style="background:${color};">${u.username[0].toUpperCase()}</div>
        <div>
          <div style="font-size:13.5px; color:var(--card); font-weight:500;">${escapeHtml(u.username)}${isSelf ? ' <span style="color:var(--muted-2); font-weight:400;">(you)</span>' : ''}</div>
          <div class="badge" style="background:${color}22; color:${color}; margin-top:3px; display:inline-block;">${u.role}</div>
        </div>
      </div>
      ${isSelf ? '' : `<button class="icon-btn danger" title="Remove user" data-action="delete-user" data-id="${u.id}" style="border-color:var(--ink-line-strong);">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke="var(--muted)"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6"/></svg>
      </button>`}
    </div>`;
  }).join('');
}

function openUsersModal() {
  if (!isAdmin()) return;
  renderUserList();
  document.getElementById('userForm').reset();
  document.getElementById('overlay').classList.add('show');
  document.getElementById('usersModal').classList.add('show');
}
function closeUsersModal() {
  document.getElementById('usersModal').classList.remove('show');
  if (!document.getElementById('detailPanel').classList.contains('show') && !document.getElementById('formModal').classList.contains('show') && !document.getElementById('confirmModal').classList.contains('show')) {
    document.getElementById('overlay').classList.remove('show');
  }
}
function addUserFromModal(e) {
  e.preventDefault();
  if (!isAdmin()) return false;
  const username = document.getElementById('u_username').value.trim();
  const password = document.getElementById('u_password').value.trim();
  const role = document.getElementById('u_role').value;
  if (!username || !password) return false;
  if (findUserByUsername(username)) {
    showToast("Username taken", `'${username}' already exists — choose another.`, true);
    return false;
  }
  const newId = users.length ? Math.max(...users.map(u => u.id)) + 1 : 1;
  users.push({ id: newId, username, passwordHash: simpleHash(password), role });
  persistUsers();
  addLog(`USER — account '${username}' created with role ${role} by '${currentUser.username}'.`);
  document.getElementById('userForm').reset();
  renderUserList();
  renderUserBadge();
  showToast("User added", `${username} can now sign in as ${role}.`, false);
  return false;
}

/* ---------------------------------------------------------------------------
   13. ACTIVITY LOG MODAL
   ------------------------------------------------------------------------- */
function openLogsModal() {
  if (!isAdmin()) return;
  const list = document.getElementById('logModalList');
  if (logs.length === 0) {
    list.innerHTML = `<div class="empty-mini">No activity recorded yet.</div>`;
  } else {
    list.innerHTML = logs.map(l => `
      <div class="log-modal-item">
        <div class="lmi-msg">${escapeHtml(l.msg)}</div>
        <div class="lmi-ts">${escapeHtml(l.ts)}</div>
      </div>
    `).join('');
  }
  document.getElementById('overlay').classList.add('show');
  document.getElementById('logsModal').classList.add('show');
}
function closeLogsModal() {
  document.getElementById('logsModal').classList.remove('show');
  document.getElementById('overlay').classList.remove('show');
}

/* ---------------------------------------------------------------------------
   14. TOASTS
   ------------------------------------------------------------------------- */
function showToast(title, sub, danger) {
  const wrap = document.getElementById('toastWrap');
  const t = document.createElement('div');
  t.className = 'toast' + (danger ? ' danger' : '');
  t.innerHTML = `<div><div style="font-weight:600;">${escapeHtml(title)}</div><div style="color:var(--muted);font-size:11.5px;margin-top:2px;">${escapeHtml(sub)}</div></div>`;
  wrap.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0'; t.style.transform = 'translateY(8px)'; t.style.transition = 'all .2s ease';
    setTimeout(() => t.remove(), 200);
  }, 3200);
}

/* ---------------------------------------------------------------------------
   15. MOBILE SIDEBAR TOGGLE
   ------------------------------------------------------------------------- */
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarBackdrop').classList.toggle('show');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarBackdrop').classList.remove('show');
}

/* ---------------------------------------------------------------------------
   16. EVENT WIRING (DOMContentLoaded) — everything uses addEventListener,
       no inline onclick attributes anywhere in the HTML.
   ------------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  seedIfEmpty();
  users = loadJSON(STORAGE.users, []);
  contacts = loadJSON(STORAGE.contacts, []);
  logs = loadJSON(STORAGE.logs, []);
  nextContactId = loadJSON(STORAGE.nextContactId, 1);

  // ---- Fake short loading delay so the loading state is visible, then
  // decide whether to show the app (existing session) or the login view.
  setTimeout(() => {
    document.getElementById('loadingOverlay').style.opacity = '0';
    setTimeout(() => { document.getElementById('loadingOverlay').style.display = 'none'; }, 250);

    if (restoreSession()) {
      showAppView();
    } else {
      showLoginView();
    }
  }, 450);

  /* ---- Auth tab switching ---- */
  document.getElementById('tabSignIn').addEventListener('click', () => {
    document.getElementById('tabSignIn').classList.add('active');
    document.getElementById('tabSignUp').classList.remove('active');
    document.getElementById('panelSignIn').classList.add('active');
    document.getElementById('panelSignUp').classList.remove('active');
  });
  document.getElementById('tabSignUp').addEventListener('click', () => {
    document.getElementById('tabSignUp').classList.add('active');
    document.getElementById('tabSignIn').classList.remove('active');
    document.getElementById('panelSignUp').classList.add('active');
    document.getElementById('panelSignIn').classList.remove('active');
  });

  /* ---- Sign in ---- */
  document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const u = document.getElementById('loginUser').value;
    const p = document.getElementById('loginPass').value;
    const err = document.getElementById('loginError');
    const btn = document.getElementById('loginSubmitBtn');
    const originalLabel = btn.textContent;
    btn.innerHTML = '<span class="btn-spinner"></span>Signing in…';
    btn.disabled = true;
    setTimeout(() => {
      const result = attemptLogin(u, p);
      btn.textContent = originalLabel;
      btn.disabled = false;
      if (result.ok) {
        err.style.display = 'none';
        showAppView();
      } else {
        err.textContent = result.message;
        err.style.display = 'block';
      }
    }, 350);
  });

  /* ---- Sign up ---- */
  document.getElementById('signupForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const uname = document.getElementById('signupUser').value;
    const pass = document.getElementById('signupPass').value;
    const pass2 = document.getElementById('signupPass2').value;
    const role = document.getElementById('signupRole').value;
    const err = document.getElementById('signupError');
    const result = attemptSignup(uname, pass, pass2, role);
    if (result.ok) {
      err.style.display = 'none';
      showAppView();
      showToast("Welcome!", `Your ${result.role || ''} account is ready.`, false);
    } else {
      err.textContent = result.message;
      err.style.display = 'block';
    }
  });

  /* ---- Logout ---- */
  document.getElementById('logoutBtn').addEventListener('click', logout);

  /* ---- Search / sort / favourites filter ---- */
  document.getElementById('searchInput').addEventListener('input', renderGrid);
  document.getElementById('sortSelect').addEventListener('change', (e) => {
    sortMode = e.target.value;
    renderGrid();
  });
  document.getElementById('favFilterBtn').addEventListener('click', (e) => {
    favouritesOnly = !favouritesOnly;
    e.currentTarget.classList.toggle('active', favouritesOnly);
    renderGrid();
  });

  /* ---- Add contact / form modal ---- */
  document.getElementById('addContactBtn').addEventListener('click', openAddModal);
  document.getElementById('contactForm').addEventListener('submit', saveContact);
  document.getElementById('formCancelBtn').addEventListener('click', closeFormModal);
  document.getElementById('formModalCloseBtn').addEventListener('click', closeFormModal);
  document.getElementById('formModalBackdrop').addEventListener('click', closeFormModal);

  /* ---- Confirm modal ---- */
  document.getElementById('confirmCancelBtn').addEventListener('click', closeConfirmModal);
  document.getElementById('confirmModalBackdrop').addEventListener('click', closeConfirmModal);
  document.getElementById('confirmOkBtn').addEventListener('click', confirmPendingDelete);

  /* ---- Manage users modal ---- */
  document.getElementById('manageUsersBtn').addEventListener('click', openUsersModal);
  document.getElementById('usersModalCloseBtn').addEventListener('click', closeUsersModal);
  document.getElementById('usersModalCloseBtn2').addEventListener('click', closeUsersModal);
  document.getElementById('usersModalBackdrop').addEventListener('click', closeUsersModal);
  document.getElementById('userForm').addEventListener('submit', addUserFromModal);

  /* ---- Activity log modal ---- */
  document.getElementById('activityLogBtn').addEventListener('click', openLogsModal);
  document.getElementById('logsModalCloseBtn').addEventListener('click', closeLogsModal);
  document.getElementById('logsModalBackdrop').addEventListener('click', closeLogsModal);

  /* ---- Overlay click closes everything ---- */
  document.getElementById('overlay').addEventListener('click', closeAllOverlays);

  /* ---- Mobile sidebar ---- */
  document.getElementById('sidebarToggle').addEventListener('click', toggleSidebar);
  document.getElementById('sidebarBackdrop').addEventListener('click', closeSidebar);

  /* ---- Escape key closes overlays / sidebar ---- */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeAllOverlays(); closeSidebar(); }
  });

  /* ---- Delegated clicks: sidebar category / A-Z rail ---- */
  document.getElementById('catList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="set-category"]');
    if (!btn) return;
    activeCategory = btn.dataset.value;
    renderCategoryList();
    renderGrid();
  });
  document.getElementById('azRail').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="set-letter"]');
    if (!btn || btn.disabled) return;
    activeLetter = btn.dataset.value;
    renderAZRail();
    renderGrid();
  });

  /* ---- Delegated clicks: card grid (open / edit / delete / favourite) ---- */
  document.getElementById('cardGrid').addEventListener('click', (e) => {
    const favBtn = e.target.closest('[data-action="toggle-fav"]');
    if (favBtn) { e.stopPropagation(); toggleFavourite(Number(favBtn.dataset.id)); return; }
    const editBtn = e.target.closest('[data-action="edit-contact"]');
    if (editBtn) { e.stopPropagation(); openEditModal(Number(editBtn.dataset.id)); return; }
    const delBtn = e.target.closest('[data-action="delete-contact"]');
    if (delBtn) { e.stopPropagation(); openConfirmModal('contact', Number(delBtn.dataset.id)); return; }
    const card = e.target.closest('[data-action="open-detail"]');
    if (card) { openDetail(Number(card.dataset.id)); }
  });

  /* ---- Delegated clicks: detail panel (dynamically rendered) ---- */
  document.getElementById('detailPanel').addEventListener('click', (e) => {
    const closeBtn = e.target.closest('[data-action="close-overlays"]');
    if (closeBtn) { closeAllOverlays(); return; }
    const favBtn = e.target.closest('[data-action="toggle-fav"]');
    if (favBtn) { toggleFavourite(Number(favBtn.dataset.id)); return; }
    const editBtn = e.target.closest('[data-action="edit-contact"]');
    if (editBtn) { openEditModal(Number(editBtn.dataset.id)); return; }
    const delBtn = e.target.closest('[data-action="delete-contact"]');
    if (delBtn) { openConfirmModal('contact', Number(delBtn.dataset.id)); return; }
  });

  /* ---- Delegated clicks: user list (delete user) ---- */
  document.getElementById('userList').addEventListener('click', (e) => {
    const delBtn = e.target.closest('[data-action="delete-user"]');
    if (delBtn) openConfirmModal('user', Number(delBtn.dataset.id));
  });
});
