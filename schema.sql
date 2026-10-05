-- =====================================================================
-- 23CSE202 DBMS — Group D9 — Contact Management System
-- PostgreSQL physical schema for the relational design in the
-- Database Design Document:
--   USERS, CONTACTS, GROUPS, CONTACT_GROUP, COMMUNICATION_LOG, ACTIVITY_LOG
-- Target: PostgreSQL 13+
-- Usage:  createdb cms_d9 && psql -d cms_d9 -f db/schema.sql
-- =====================================================================

DROP TABLE IF EXISTS activity_log, communication_log, contact_group, contacts, groups, users CASCADE;
DROP TYPE  IF EXISTS user_role, comm_type CASCADE;
DROP VIEW  IF EXISTS v_frequent_contacts, v_group_distribution;

CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive text (usernames, e-mails)

CREATE TYPE user_role AS ENUM ('Administrator', 'Editor', 'Viewer');
CREATE TYPE comm_type AS ENUM ('Call', 'Message', 'Meeting');

-- ---------------------------------------------------------------------
-- USERS (user_id, username, password_hash, role, created_at)
-- ---------------------------------------------------------------------
CREATE TABLE users (
  user_id        SERIAL PRIMARY KEY,
  username       CITEXT       NOT NULL UNIQUE,
  password_hash  VARCHAR(100) NOT NULL,                 -- bcrypt hash, never plain text
  role           user_role    NOT NULL DEFAULT 'Viewer',
  created_at     TIMESTAMP    NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_users_username_len CHECK (char_length(username) >= 3)
);

-- ---------------------------------------------------------------------
-- CONTACTS (contact_id, name, phone, email, address, birthday, company,
--           is_favourite, user_id -> USERS)
-- ---------------------------------------------------------------------
CREATE TABLE contacts (
  contact_id    SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  phone         CHAR(10)     NOT NULL,
  email         CITEXT       NOT NULL,
  address       VARCHAR(255),
  birthday      DATE,
  company       VARCHAR(100),
  is_favourite  BOOLEAN      NOT NULL DEFAULT FALSE,
  user_id       INT REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE,  -- who added it
  created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_contacts_phone CHECK (phone ~ '^[0-9]{10}$'),
  CONSTRAINT chk_contacts_email CHECK (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);
-- Indexes on frequently searched columns (search / sort / filter)
CREATE INDEX idx_contacts_name    ON contacts (LOWER(name));
CREATE INDEX idx_contacts_phone   ON contacts (phone);
CREATE INDEX idx_contacts_email   ON contacts (email);
CREATE INDEX idx_contacts_company ON contacts (company);

-- ---------------------------------------------------------------------
-- GROUPS (group_id, group_name)       -- categories
-- ---------------------------------------------------------------------
CREATE TABLE groups (
  group_id    SERIAL PRIMARY KEY,
  group_name  VARCHAR(30) NOT NULL UNIQUE
);
INSERT INTO groups (group_name) VALUES ('Personal'), ('Business'), ('Family'), ('Academic');

-- ---------------------------------------------------------------------
-- CONTACT_GROUP (contact_id, group_id)  — M:N bridge for BELONGS_TO
-- ---------------------------------------------------------------------
CREATE TABLE contact_group (
  contact_id INT NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE ON UPDATE CASCADE,
  group_id   INT NOT NULL REFERENCES groups(group_id)      ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY (contact_id, group_id)
);
CREATE INDEX idx_cg_group ON contact_group (group_id);

-- ---------------------------------------------------------------------
-- COMMUNICATION_LOG (contact_id, log_id, type, log_datetime, notes, logged_by)
-- Weak entity: PK = (contact_id, log_id); log_id is the partial key,
-- numbered 1,2,3… separately for every contact (trigger below).
-- ---------------------------------------------------------------------
CREATE TABLE communication_log (
  contact_id    INT       NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE ON UPDATE CASCADE,
  log_id        INT       NOT NULL,
  type          comm_type NOT NULL,
  log_datetime  TIMESTAMP NOT NULL DEFAULT NOW(),
  notes         VARCHAR(500),
  logged_by     INT REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE,
  PRIMARY KEY (contact_id, log_id)
);
CREATE INDEX idx_comm_datetime ON communication_log (log_datetime);

-- ---------------------------------------------------------------------
-- ACTIVITY_LOG (activity_id, user_id, action_type, description, timestamp)
-- user_id is SET NULL when a user is removed so the audit trail survives.
-- ---------------------------------------------------------------------
CREATE TABLE activity_log (
  activity_id  SERIAL PRIMARY KEY,
  user_id      INT REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE,
  action_type  VARCHAR(20)  NOT NULL,
  description  VARCHAR(500) NOT NULL,
  "timestamp"  TIMESTAMP    NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_activity_ts ON activity_log ("timestamp" DESC);

-- =====================================================================
-- TRIGGERS
-- =====================================================================

-- Business rule: detect duplicate contacts (same phone OR same e-mail)
-- BEFORE insert / update. Raises SQLSTATE 'CD001' with the clashing name.
CREATE OR REPLACE FUNCTION fn_prevent_duplicate_contact() RETURNS trigger AS $$
DECLARE
  v_dup_name TEXT;
BEGIN
  SELECT name INTO v_dup_name
    FROM contacts
   WHERE (TG_OP = 'INSERT' OR contact_id <> NEW.contact_id)
     AND (phone = NEW.phone OR email = NEW.email)     -- email is CITEXT => case-insensitive
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'DUPLICATE_CONTACT:%', v_dup_name USING ERRCODE = 'CD001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_contacts_prevent_duplicate
BEFORE INSERT OR UPDATE OF phone, email ON contacts
FOR EACH ROW EXECUTE FUNCTION fn_prevent_duplicate_contact();

-- Keep contacts.updated_at fresh
CREATE OR REPLACE FUNCTION fn_touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_contacts_touch
BEFORE UPDATE ON contacts
FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

-- Weak-entity partial key: number log entries 1,2,3… per contact.
CREATE OR REPLACE FUNCTION fn_assign_comm_log_id() RETURNS trigger AS $$
BEGIN
  IF NEW.log_id IS NULL OR NEW.log_id = 0 THEN
    PERFORM 1 FROM contacts WHERE contact_id = NEW.contact_id FOR UPDATE;  -- serialise per contact
    SELECT COALESCE(MAX(log_id), 0) + 1 INTO NEW.log_id
      FROM communication_log WHERE contact_id = NEW.contact_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_comm_assign_log_id
BEFORE INSERT ON communication_log
FOR EACH ROW EXECUTE FUNCTION fn_assign_comm_log_id();

-- =====================================================================
-- STORED PROCEDURE: safely merge two duplicate contacts
-- Moves every communication-log entry and group membership of
-- p_remove_id onto p_keep_id, fills blank fields on the kept record,
-- deletes the duplicate and writes an audit entry. Runs atomically.
-- =====================================================================
CREATE OR REPLACE PROCEDURE sp_merge_contacts(p_keep_id INT, p_remove_id INT, p_user_id INT)
LANGUAGE plpgsql AS $$
DECLARE
  v_keep    contacts%ROWTYPE;
  v_remove  contacts%ROWTYPE;
  v_offset  INT;
  v_moved   INT;
BEGIN
  IF p_keep_id = p_remove_id THEN
    RAISE EXCEPTION 'MERGE_SAME_CONTACT' USING ERRCODE = 'CD002';
  END IF;

  SELECT * INTO v_keep   FROM contacts WHERE contact_id = p_keep_id   FOR UPDATE;
  SELECT * INTO v_remove FROM contacts WHERE contact_id = p_remove_id FOR UPDATE;
  IF v_keep.contact_id IS NULL OR v_remove.contact_id IS NULL THEN
    RAISE EXCEPTION 'CONTACT_NOT_FOUND' USING ERRCODE = 'CD003';
  END IF;

  -- 1. Move the duplicate's communication history (re-numbered after the kept contact's)
  SELECT COALESCE(MAX(log_id), 0) INTO v_offset FROM communication_log WHERE contact_id = p_keep_id;
  INSERT INTO communication_log (contact_id, log_id, type, log_datetime, notes, logged_by)
    SELECT p_keep_id,
           v_offset + ROW_NUMBER() OVER (ORDER BY log_datetime, log_id),
           type, log_datetime, notes, logged_by
      FROM communication_log WHERE contact_id = p_remove_id;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  -- 2. Union of group memberships
  INSERT INTO contact_group (contact_id, group_id)
    SELECT p_keep_id, group_id FROM contact_group WHERE contact_id = p_remove_id
  ON CONFLICT DO NOTHING;

  -- 3. Delete the duplicate (cascades its old log rows / memberships)
  DELETE FROM contacts WHERE contact_id = p_remove_id;

  -- 4. Fill blanks on the surviving record
  UPDATE contacts
     SET address      = COALESCE(NULLIF(address, ''), v_remove.address),
         birthday     = COALESCE(birthday, v_remove.birthday),
         company      = COALESCE(NULLIF(company, ''), v_remove.company),
         is_favourite = is_favourite OR v_remove.is_favourite
   WHERE contact_id = p_keep_id;

  -- 5. Audit trail
  INSERT INTO activity_log (user_id, action_type, description)
  VALUES (p_user_id, 'MERGE',
          format('record REC-%s (''%s'') merged into REC-%s (''%s''); %s communication log entries preserved.',
                 LPAD(p_remove_id::text, 4, '0'), v_remove.name,
                 LPAD(p_keep_id::text, 4, '0'),   v_keep.name, v_moved));
END;
$$;

-- =====================================================================
-- VIEWS
-- =====================================================================

-- Most frequently contacted individuals
CREATE OR REPLACE VIEW v_frequent_contacts AS
SELECT c.contact_id, c.name, c.phone,
       COUNT(l.log_id)     AS interaction_count,
       MAX(l.log_datetime) AS last_contacted
  FROM contacts c
  LEFT JOIN communication_log l ON l.contact_id = c.contact_id
 GROUP BY c.contact_id, c.name, c.phone
 ORDER BY interaction_count DESC, last_contacted DESC NULLS LAST;

-- Group-wise distribution of contacts
CREATE OR REPLACE VIEW v_group_distribution AS
SELECT g.group_id, g.group_name, COUNT(cg.contact_id) AS contact_count
  FROM groups g
  LEFT JOIN contact_group cg ON cg.group_id = g.group_id
 GROUP BY g.group_id, g.group_name
 ORDER BY contact_count DESC, g.group_name;
