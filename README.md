# CMS D9 — Backend (PostgreSQL + Express)

REST API for the 23CSE202 Contact Management System. It implements the relational design
from the Database Design Document: `users`, `contacts`, `groups`, `contact_group` (M:N),
`communication_log` (weak entity, PK = `contact_id, log_id`) and `activity_log`.

## Quick start (local development only — see "Deploying from GitHub" below)
```bash
cd backend
npm install
cp .env.example .env          # edit DATABASE_URL and JWT_SECRET
createdb cms_d9               # or create the DB in pgAdmin
npm run db:init               # runs db/schema.sql, then seeds admin/admin123 + 7 sample contacts
npm start                     # http://localhost:4000  (also serves the frontend if SERVE_FRONTEND=true)
npm test                      # 41-check end-to-end smoke test (use a dev DB)
```
Open http://localhost:4000 — log in with **admin / admin123**.

## What lives in the database (DBMS concepts)
| Concept | Where |
|---|---|
| Duplicate detection **trigger** (phone or e-mail) | `trg_contacts_prevent_duplicate` → `fn_prevent_duplicate_contact()` |
| Weak-entity key numbering **trigger** | `trg_comm_assign_log_id` (log_id restarts at 1 per contact) |
| **Stored procedure** merging duplicates, keeping history | `CALL sp_merge_contacts(keep, remove, user)` |
| **Views** | `v_frequent_contacts`, `v_group_distribution` |
| **Indexes** | name (`LOWER(name)`), phone, email, company, activity timestamp |
| Constraints | 10-digit phone CHECK, e-mail CHECK, UNIQUE username/group, FK actions (CASCADE / SET NULL) |
| Case-insensitive username & e-mail | `CITEXT` |
| Role-based access | enforced in the API (`Administrator` / `Editor` / `Viewer`) |

## API
All routes are under `/api`; send `Authorization: Bearer <token>` (except login/signup).

| Method & path | Who | Purpose |
|---|---|---|
| POST `/auth/login`, `/auth/signup` | public | Sign in / register (signup → Editor or Viewer only) |
| GET `/auth/me`, POST `/auth/logout` | any | Session check / logout log entry |
| GET `/contacts?q=&category=&letter=&favourites=&sort=` | any | Search, filter, sort |
| GET `/contacts/:id` | any | One contact |
| POST `/contacts`, PUT `/contacts/:id`, DELETE `/contacts/:id` | Editor+ | CRUD (duplicates → 409) |
| PATCH `/contacts/:id/favourite` | any | Toggle favourite |
| POST `/contacts/merge` `{keepId, removeId}` | Editor+ | Runs `sp_merge_contacts` |
| GET/POST `/contacts/:id/communications` | read: any, write: Editor+ | Calls / messages / meetings |
| GET `/users`, POST `/users`, PATCH `/users/:id/role`, DELETE `/users/:id` | Admin | Manage users |
| GET `/activity` | Admin | Activity log, newest first |
| GET `/stats/summary`, `/stats/frequent`, `/stats/groups` | any | Dashboard cards + the two views |
| GET/POST `/groups` | read: any, create: Admin | Categories / custom labels |

## Deploying from GitHub (no localhost)
GitHub Pages can only serve static files, so the site stays on Pages and the API runs on Render, deployed from this same repo:
1. Push everything to `alien2088/23CSE202_ContactManagementSystem_D9`.
2. Render dashboard → **New → Blueprint** → select the repo. `render.yaml` creates the API **and** a free PostgreSQL database.
3. On first start the API creates the tables, trigger, procedure and views and seeds `admin / admin123` automatically.
4. If your service URL differs from `https://cms-d9-api.onrender.com`, edit `config.js` and push.
5. Your Pages site (`https://alien2088.github.io/23CSE202_ContactManagementSystem_D9/`) now talks to the hosted API. The Render URL also serves the full app.

Free-tier note: the API sleeps after inactivity, so the first request can take ~30–60 s. Open the site once before a demo.

## Security notes
Passwords are hashed with bcrypt (the old `simpleHash` is gone); roles are re-read from the DB on every
request; all SQL is parameterised; login attempts are rate-limited per IP+username.
Change the seeded admin password after first login.
