-- PEP ERP — Migration 001: Accounting core (Release 1 vertical slice)
-- Entities, users/RBAC, financial years & periods, chart of accounts,
-- journals (draft→submitted→approved→posted), immutable ledger, audit chain.
--
-- Defence in depth: every accounting invariant enforced in the domain service
-- is ALSO enforced here, so an application bug, a rogue script or direct SQL
-- cannot produce an unbalanced, back-dated or edited posted record.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ───────────────────────────── Enumerations ─────────────────────────────
CREATE TYPE account_type     AS ENUM ('asset','liability','equity','revenue','expense');
CREATE TYPE normal_side      AS ENUM ('debit','credit');
CREATE TYPE period_status    AS ENUM ('open','locked');
CREATE TYPE journal_status   AS ENUM ('draft','submitted','approved','posted','rejected');
CREATE TYPE journal_type     AS ENUM ('manual','opening_balance','accrual','prepayment','recurring',
                                      'fx_revaluation','tax_adjustment','reversal','correction');
CREATE TYPE cash_flow_class  AS ENUM ('cash','operating','investing','financing','non_cash','none');

-- ───────────────────────────── Entities ─────────────────────────────
CREATE TABLE entities (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                    text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]{2,20}$'),
  legal_name              text NOT NULL,
  trading_name            text,
  registration_no         text,
  tin_encrypted           bytea,                         -- never stored in clear; masked in API
  jurisdiction            char(2) NOT NULL DEFAULT 'GH',
  industry                text,
  reporting_framework     text NOT NULL DEFAULT 'IFRS' CHECK (reporting_framework IN ('IFRS','IFRS_SME')),
  functional_currency     char(3) NOT NULL DEFAULT 'GHS',
  presentation_currency   char(3) NOT NULL DEFAULT 'GHS',
  segregation_enabled     boolean NOT NULL DEFAULT true,  -- preparer may not approve own journal
  retained_earnings_account_id uuid,                      -- FK added once accounts exists
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────────── Users & RBAC ─────────────────────────────
CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL UNIQUE CHECK (email = lower(email)),
  full_name   text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  code        text PRIMARY KEY,
  name        text NOT NULL,
  description text
);

CREATE TABLE role_permissions (
  role_code   text NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  permission  text NOT NULL,
  PRIMARY KEY (role_code, permission)
);

CREATE TABLE user_entity_roles (
  user_id     uuid NOT NULL REFERENCES users(id),
  entity_id   uuid NOT NULL REFERENCES entities(id),
  role_code   text NOT NULL REFERENCES roles(code),
  granted_by  uuid REFERENCES users(id),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, entity_id, role_code)
);

-- ───────────────────────────── Years & periods ─────────────────────────────
CREATE TABLE financial_years (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES entities(id),
  label       text NOT NULL,
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  is_closed   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date > start_date),
  UNIQUE (entity_id, label)
);
-- No overlapping financial years per entity
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE financial_years ADD CONSTRAINT fy_no_overlap
  EXCLUDE USING gist (entity_id WITH =, daterange(start_date, end_date, '[]') WITH &&);

CREATE TABLE accounting_periods (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id          uuid NOT NULL REFERENCES entities(id),
  financial_year_id  uuid NOT NULL REFERENCES financial_years(id),
  period_no          smallint NOT NULL CHECK (period_no BETWEEN 1 AND 16),
  name               text NOT NULL,
  start_date         date NOT NULL,
  end_date           date NOT NULL,
  status             period_status NOT NULL DEFAULT 'open',
  locked_by          uuid REFERENCES users(id),
  locked_at          timestamptz,
  CHECK (end_date >= start_date),
  UNIQUE (financial_year_id, period_no)
);
ALTER TABLE accounting_periods ADD CONSTRAINT period_no_overlap
  EXCLUDE USING gist (entity_id WITH =, daterange(start_date, end_date, '[]') WITH &&);

-- Period must sit inside its financial year and belong to same entity
CREATE FUNCTION trg_period_within_fy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fy financial_years;
BEGIN
  SELECT * INTO fy FROM financial_years WHERE id = NEW.financial_year_id;
  IF fy.entity_id <> NEW.entity_id THEN
    RAISE EXCEPTION 'PERIOD_ENTITY_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.start_date < fy.start_date OR NEW.end_date > fy.end_date THEN
    RAISE EXCEPTION 'PERIOD_OUTSIDE_FINANCIAL_YEAR' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER period_within_fy BEFORE INSERT OR UPDATE ON accounting_periods
  FOR EACH ROW EXECUTE FUNCTION trg_period_within_fy();

-- ───────────────────────────── Chart of accounts ─────────────────────────────
CREATE TABLE accounts (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id                uuid NOT NULL REFERENCES entities(id),
  code                     text NOT NULL CHECK (code ~ '^[0-9A-Z.-]{1,20}$'),
  name                     text NOT NULL,
  account_type             account_type NOT NULL,
  normal_balance           normal_side NOT NULL,
  parent_id                uuid REFERENCES accounts(id),
  is_postable              boolean NOT NULL DEFAULT true,   -- false = header/summary account
  is_control               boolean NOT NULL DEFAULT false,  -- AR/AP/tax control: subledger-fed only (R3)
  requires_reconciliation  boolean NOT NULL DEFAULT false,
  cash_flow_class          cash_flow_class NOT NULL DEFAULT 'none',
  statement_line_code      text,       -- mapping to reporting template line (R2)
  note_ref                 text,       -- mapping to note workpaper (R2)
  tax_mapping_code         text,       -- mapping to tax workpaper line (R4)
  is_active                boolean NOT NULL DEFAULT true,
  effective_from           date NOT NULL DEFAULT DATE '1900-01-01',
  effective_to             date,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, code),
  UNIQUE (entity_id, id)
);
ALTER TABLE entities ADD CONSTRAINT entities_re_account_fk
  FOREIGN KEY (id, retained_earnings_account_id) REFERENCES accounts(entity_id, id) DEFERRABLE INITIALLY DEFERRED;

-- Parent must be same entity; type cannot change once posted activity exists
CREATE FUNCTION trg_account_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL AND NOT EXISTS
     (SELECT 1 FROM accounts p WHERE p.id = NEW.parent_id AND p.entity_id = NEW.entity_id) THEN
    RAISE EXCEPTION 'ACCOUNT_PARENT_ENTITY_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.account_type <> OLD.account_type OR NEW.normal_balance <> OLD.normal_balance
                           OR NEW.code <> OLD.code OR NEW.entity_id <> OLD.entity_id) THEN
    IF EXISTS (SELECT 1 FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id
               WHERE l.account_id = OLD.id AND j.status = 'posted') THEN
      RAISE EXCEPTION 'ACCOUNT_HAS_POSTED_ACTIVITY: code/type/normal balance are frozen' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ───────────────────────────── Journals ─────────────────────────────
CREATE TABLE journal_entries (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id              uuid NOT NULL REFERENCES entities(id),
  draft_no               bigserial,
  journal_no             text,                         -- gapless, assigned at posting
  journal_type           journal_type NOT NULL DEFAULT 'manual',
  journal_date           date NOT NULL,
  period_id              uuid NOT NULL REFERENCES accounting_periods(id),
  source                 text NOT NULL DEFAULT 'manual',
  reference              text,
  description            text NOT NULL CHECK (length(trim(description)) > 0),
  currency               char(3) NOT NULL,
  fx_rate                numeric(18,8) NOT NULL DEFAULT 1 CHECK (fx_rate > 0),
  status                 journal_status NOT NULL DEFAULT 'draft',
  prepared_by            uuid NOT NULL REFERENCES users(id),
  submitted_at           timestamptz,
  approved_by            uuid REFERENCES users(id),
  approved_at            timestamptz,
  posted_by              uuid REFERENCES users(id),
  posted_at              timestamptz,
  rejected_by            uuid REFERENCES users(id),
  rejected_at            timestamptz,
  rejection_reason       text,
  reverses_journal_id    uuid REFERENCES journal_entries(id),
  reversed_by_journal_id uuid REFERENCES journal_entries(id),
  idempotency_key        text,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, journal_no),
  UNIQUE (entity_id, idempotency_key),
  CHECK (status <> 'posted' OR (journal_no IS NOT NULL AND posted_by IS NOT NULL AND posted_at IS NOT NULL
                                AND approved_by IS NOT NULL))
);
-- A journal can be reversed at most once (rejected reversal drafts don't count)
CREATE UNIQUE INDEX one_live_reversal_per_journal ON journal_entries (reverses_journal_id)
  WHERE reverses_journal_id IS NOT NULL AND status <> 'rejected';
CREATE INDEX je_entity_status ON journal_entries (entity_id, status, journal_date);

CREATE TABLE journal_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id          uuid NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
  line_no             integer NOT NULL CHECK (line_no > 0),
  account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  description         text,
  -- transaction-currency amounts (as entered)
  txn_debit           numeric(20,2) NOT NULL DEFAULT 0 CHECK (txn_debit  >= 0),
  txn_credit          numeric(20,2) NOT NULL DEFAULT 0 CHECK (txn_credit >= 0),
  -- functional-currency amounts (authoritative for ledger & TB)
  debit               numeric(20,2) NOT NULL DEFAULT 0 CHECK (debit  >= 0),
  credit              numeric(20,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  counterparty        text,
  dimension_values    jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_document_ref text,
  UNIQUE (journal_id, line_no),
  CHECK (NOT (debit > 0 AND credit > 0)),
  CHECK (NOT (txn_debit > 0 AND txn_credit > 0)),
  CHECK (debit + credit > 0)
);
CREATE INDEX jl_account ON journal_lines (account_id);

CREATE TRIGGER account_guard BEFORE INSERT OR UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION trg_account_guard();

-- Per-entity gapless posting sequence
CREATE TABLE journal_sequences (
  entity_id  uuid NOT NULL REFERENCES entities(id),
  fy_label   text NOT NULL,
  last_no    bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (entity_id, fy_label)
);

-- ── Control 1: lines are frozen unless parent journal is draft ──
CREATE FUNCTION trg_lines_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st journal_status; jid uuid;
BEGIN
  jid := COALESCE(NEW.journal_id, OLD.journal_id);
  SELECT status INTO st FROM journal_entries WHERE id = jid;
  IF st <> 'draft' THEN
    RAISE EXCEPTION 'JOURNAL_LINES_IMMUTABLE: journal is %', st USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.journal_id <> OLD.journal_id THEN
    RAISE EXCEPTION 'JOURNAL_LINE_REPARENT_FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER lines_frozen BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION trg_lines_frozen();

-- ── Control 2: journal header lifecycle, posting validation, immutability ──
CREATE FUNCTION trg_journal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p accounting_periods;
  dr numeric; cr numeric; tdr numeric; tcr numeric; n int; bad int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'JOURNAL_DELETE_FORBIDDEN: only drafts can be deleted (status %)', OLD.status USING ERRCODE='P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Posted journals: the ONLY permitted change is linking the reversal, once.
    IF OLD.status = 'posted' THEN
      IF OLD.reversed_by_journal_id IS NULL AND NEW.reversed_by_journal_id IS NOT NULL
         AND (to_jsonb(NEW) - 'reversed_by_journal_id' - 'updated_at' - 'version')
           = (to_jsonb(OLD) - 'reversed_by_journal_id' - 'updated_at' - 'version') THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'POSTED_JOURNAL_IMMUTABLE' USING ERRCODE = 'P0001';
    END IF;
    IF OLD.status = 'rejected' THEN
      RAISE EXCEPTION 'REJECTED_JOURNAL_IMMUTABLE' USING ERRCODE = 'P0001';
    END IF;
    -- Allowed transitions
    IF NEW.status <> OLD.status AND NOT (
         (OLD.status = 'draft'     AND NEW.status IN ('submitted','rejected')) OR
         (OLD.status = 'submitted' AND NEW.status IN ('approved','draft','rejected')) OR
         (OLD.status = 'approved'  AND NEW.status IN ('posted','draft','rejected'))) THEN
      RAISE EXCEPTION 'INVALID_STATUS_TRANSITION: % -> %', OLD.status, NEW.status USING ERRCODE='P0001';
    END IF;
    -- Once submitted, content is frozen; only workflow fields may move.
    IF OLD.status <> 'draft' AND (
         NEW.journal_date IS DISTINCT FROM OLD.journal_date OR NEW.period_id IS DISTINCT FROM OLD.period_id OR
         NEW.description IS DISTINCT FROM OLD.description OR NEW.reference IS DISTINCT FROM OLD.reference OR
         NEW.currency IS DISTINCT FROM OLD.currency OR NEW.fx_rate IS DISTINCT FROM OLD.fx_rate OR
         NEW.journal_type IS DISTINCT FROM OLD.journal_type OR NEW.prepared_by IS DISTINCT FROM OLD.prepared_by OR
         NEW.reverses_journal_id IS DISTINCT FROM OLD.reverses_journal_id) THEN
      RAISE EXCEPTION 'JOURNAL_CONTENT_FROZEN: return to draft to edit' USING ERRCODE='P0001';
    END IF;
    IF NEW.entity_id <> OLD.entity_id THEN
      RAISE EXCEPTION 'JOURNAL_ENTITY_CHANGE_FORBIDDEN' USING ERRCODE='P0001';
    END IF;
    NEW.updated_at := now();
    NEW.version := OLD.version + 1;
  END IF;

  -- Period must belong to entity and contain the journal date
  SELECT * INTO p FROM accounting_periods WHERE id = NEW.period_id;
  IF p.entity_id <> NEW.entity_id OR NEW.journal_date NOT BETWEEN p.start_date AND p.end_date THEN
    RAISE EXCEPTION 'JOURNAL_DATE_NOT_IN_PERIOD' USING ERRCODE='P0001';
  END IF;

  -- Validation at the moment of posting
  IF NEW.status = 'posted' AND (TG_OP = 'INSERT' OR OLD.status <> 'posted') THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'JOURNAL_MUST_BE_POSTED_VIA_WORKFLOW' USING ERRCODE='P0001';
    END IF;
    IF p.status <> 'open' THEN
      RAISE EXCEPTION 'PERIOD_LOCKED: % is %', p.name, p.status USING ERRCODE='P0001';
    END IF;
    SELECT COALESCE(sum(debit),0), COALESCE(sum(credit),0),
           COALESCE(sum(txn_debit),0), COALESCE(sum(txn_credit),0), count(*)
      INTO dr, cr, tdr, tcr, n
      FROM journal_lines WHERE journal_id = NEW.id;
    IF n < 2 THEN
      RAISE EXCEPTION 'JOURNAL_NEEDS_TWO_LINES' USING ERRCODE='P0001';
    END IF;
    IF dr <> cr OR dr = 0 THEN
      RAISE EXCEPTION 'JOURNAL_UNBALANCED: debit % credit %', dr, cr USING ERRCODE='P0001';
    END IF;
    IF tdr <> tcr THEN
      RAISE EXCEPTION 'JOURNAL_UNBALANCED_TXN_CURRENCY: debit % credit %', tdr, tcr USING ERRCODE='P0001';
    END IF;
    SELECT count(*) INTO bad FROM journal_lines l JOIN accounts a ON a.id = l.account_id
     WHERE l.journal_id = NEW.id AND (a.entity_id <> NEW.entity_id OR NOT a.is_active OR NOT a.is_postable
           OR NEW.journal_date < a.effective_from OR (a.effective_to IS NOT NULL AND NEW.journal_date > a.effective_to));
    IF bad > 0 THEN
      RAISE EXCEPTION 'JOURNAL_INVALID_ACCOUNT: % line(s) use inactive, header or foreign accounts', bad USING ERRCODE='P0001';
    END IF;
    IF NEW.approved_by IS NULL THEN
      RAISE EXCEPTION 'JOURNAL_NOT_APPROVED' USING ERRCODE='P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION trg_journal_guard();

-- Locking a period with unposted-but-approved journals is allowed (they simply
-- cannot post); re-opening is a controlled, audited action in the service layer.

-- ───────────────────────────── Ledger view ─────────────────────────────
-- Posted journal lines ARE the ledger. No separate mutable balance table.
CREATE VIEW ledger_postings AS
SELECT l.id            AS line_id,
       j.entity_id,
       j.id            AS journal_id,
       j.journal_no,
       j.journal_type,
       j.journal_date,
       j.period_id,
       j.reference,
       j.description   AS journal_description,
       l.line_no,
       l.account_id,
       a.code          AS account_code,
       a.name          AS account_name,
       a.account_type,
       a.normal_balance,
       l.description   AS line_description,
       l.debit,
       l.credit,
       l.debit - l.credit AS net,
       j.currency,
       j.fx_rate,
       l.txn_debit,
       l.txn_credit,
       l.counterparty,
       l.dimension_values,
       l.source_document_ref,
       j.posted_at,
       j.reverses_journal_id
FROM journal_lines l
JOIN journal_entries j ON j.id = l.journal_id AND j.status = 'posted'
JOIN accounts a ON a.id = l.account_id;

-- ───────────────────────────── Audit log (append-only, hash-chained) ─────────────────────────────
CREATE TABLE audit_events (
  id          bigserial PRIMARY KEY,
  entity_id   uuid REFERENCES entities(id),
  actor_id    uuid REFERENCES users(id),
  action      text NOT NULL,
  object_type text NOT NULL,
  object_id   text,
  before      jsonb,
  after       jsonb,
  reason      text,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  prev_hash   text,
  hash        text NOT NULL
);
CREATE INDEX audit_entity_time ON audit_events (entity_id, occurred_at);

CREATE FUNCTION trg_audit_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE last text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit_events_chain'));
  SELECT hash INTO last FROM audit_events ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := COALESCE(last, 'GENESIS');
  NEW.hash := encode(digest(
      NEW.prev_hash || '|' || COALESCE(NEW.entity_id::text,'') || '|' || COALESCE(NEW.actor_id::text,'') || '|' ||
      NEW.action || '|' || NEW.object_type || '|' || COALESCE(NEW.object_id,'') || '|' ||
      COALESCE(NEW.before::text,'') || '|' || COALESCE(NEW.after::text,'') || '|' ||
      COALESCE(NEW.reason,'') || '|' || to_char(NEW.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),
    'sha256'), 'hex');
  RETURN NEW;
END $$;
CREATE TRIGGER audit_chain BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION trg_audit_chain();

CREATE FUNCTION trg_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_LOG_APPEND_ONLY' USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION trg_audit_append_only();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION trg_audit_append_only();

-- Verify the chain: returns first broken event id, or NULL if intact.
CREATE FUNCTION verify_audit_chain() RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE r audit_events; prev text := 'GENESIS'; h text;
BEGIN
  FOR r IN SELECT * FROM audit_events ORDER BY id LOOP
    h := encode(digest(
      prev || '|' || COALESCE(r.entity_id::text,'') || '|' || COALESCE(r.actor_id::text,'') || '|' ||
      r.action || '|' || r.object_type || '|' || COALESCE(r.object_id,'') || '|' ||
      COALESCE(r.before::text,'') || '|' || COALESCE(r.after::text,'') || '|' ||
      COALESCE(r.reason,'') || '|' || to_char(r.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),
      'sha256'), 'hex');
    IF r.prev_hash <> prev OR r.hash <> h THEN RETURN r.id; END IF;
    prev := r.hash;
  END LOOP;
  RETURN NULL;
END $$;

-- ───────────────────────────── Reference data: roles ─────────────────────────────
INSERT INTO roles (code, name, description) VALUES
 ('system_admin',   'System Administrator',     'Users and configuration; NO financial approval authority'),
 ('finance_admin',  'Finance Administrator',    'Entity, periods and chart of accounts'),
 ('preparer',       'Journal Preparer',         'Create and submit journals'),
 ('approver',       'Journal Approver',         'Approve and post journals'),
 ('accountant',     'Accountant',               'Prepare journals and run reports'),
 ('controller',     'Financial Controller/CFO', 'Approve/post, lock and reopen periods'),
 ('auditor',        'Auditor / Read-only',      'Read-only access to ledger, journals and audit trail'),
 ('board_viewer',   'Management/Board Viewer',  'Read-only reports');

INSERT INTO role_permissions (role_code, permission)
SELECT r, p FROM (VALUES
 ('system_admin','users.manage'), ('system_admin','entity.read'), ('system_admin','audit.read'),
 ('finance_admin','entity.read'), ('finance_admin','entity.configure'), ('finance_admin','periods.manage'),
 ('finance_admin','coa.manage'), ('finance_admin','coa.read'), ('finance_admin','reports.read'),
 ('preparer','entity.read'), ('preparer','coa.read'), ('preparer','journal.prepare'), ('preparer','journal.read'),
 ('accountant','entity.read'), ('accountant','coa.read'), ('accountant','journal.prepare'), ('accountant','journal.read'),
 ('accountant','ledger.read'), ('accountant','reports.read'),
 ('approver','entity.read'), ('approver','coa.read'), ('approver','journal.read'), ('approver','journal.approve'),
 ('approver','journal.post'), ('approver','ledger.read'), ('approver','reports.read'),
 ('controller','entity.read'), ('controller','entity.configure'), ('controller','coa.read'), ('controller','coa.manage'),
 ('controller','journal.read'), ('controller','journal.prepare'), ('controller','journal.approve'), ('controller','journal.post'),
 ('controller','ledger.read'), ('controller','reports.read'), ('controller','periods.manage'), ('controller','periods.lock'),
 ('controller','periods.reopen'), ('controller','audit.read'),
 ('auditor','entity.read'), ('auditor','coa.read'), ('auditor','journal.read'), ('auditor','ledger.read'),
 ('auditor','reports.read'), ('auditor','audit.read'),
 ('board_viewer','entity.read'), ('board_viewer','reports.read')
) v(r, p);
