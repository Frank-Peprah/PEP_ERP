-- PEP ERP — Migration 011 (Blueprint Phase 1): recurring and auto-reversing journals.
--   • Auto-reversing: a journal may carry auto_reverse_date. When it is posted, the system posts the
--     reversal dated auto_reverse_date in the same transaction (the original's approval covers it), so a
--     month-end accrual can never be left un-reversed.
--   • Recurring: a template (lines, frequency, start/end) generates draft journals for each due date.
--     Each run date produces at most one journal per template (unique index), so generation is idempotent.
--     Generated drafts go through the normal approval workflow.

-- ── Auto-reversing journals ─────────────────────────────────────────────────────
ALTER TABLE journal_entries ADD COLUMN auto_reverse_date date;
ALTER TABLE journal_entries ADD CONSTRAINT auto_reverse_after_journal
  CHECK (auto_reverse_date IS NULL OR auto_reverse_date > journal_date);
ALTER TABLE journal_entries ADD CONSTRAINT auto_reverse_allowed_types
  CHECK (auto_reverse_date IS NULL OR journal_type NOT IN ('reversal', 'year_end_close', 'opening_balance'));

-- Extend the late-fields freeze (migration 010) to auto_reverse_date.
CREATE OR REPLACE FUNCTION trg_journal_late_fields_frozen() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status <> 'draft' AND (NEW.is_adjustment IS DISTINCT FROM OLD.is_adjustment
       OR NEW.closes_financial_year_id IS DISTINCT FROM OLD.closes_financial_year_id
       OR NEW.auto_reverse_date IS DISTINCT FROM OLD.auto_reverse_date) THEN
    RAISE EXCEPTION 'JOURNAL_CONTENT_FROZEN: return to draft to edit' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER journal_late_fields_frozen BEFORE UPDATE OF is_adjustment, closes_financial_year_id, auto_reverse_date ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION trg_journal_late_fields_frozen();

-- ── Recurring journal templates ─────────────────────────────────────────────────
CREATE TYPE recurrence_frequency AS ENUM ('monthly', 'quarterly', 'semiannually', 'annually');
CREATE TYPE recurring_status     AS ENUM ('active', 'paused', 'ended');

CREATE TABLE recurring_journals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id        uuid NOT NULL REFERENCES entities(id),
  name             text NOT NULL CHECK (length(trim(name)) > 0),
  description      text NOT NULL CHECK (length(trim(description)) > 0),
  reference        text,
  journal_type     journal_type NOT NULL DEFAULT 'recurring'
                   CHECK (journal_type IN ('manual', 'accrual', 'prepayment', 'recurring')),
  is_adjustment    boolean NOT NULL DEFAULT false,
  auto_reverse     boolean NOT NULL DEFAULT false,      -- reverse on the first day of the next period
  frequency        recurrence_frequency NOT NULL DEFAULT 'monthly',
  month_end        boolean NOT NULL DEFAULT false,      -- dated the last day of each month instead of the start day
  start_date       date NOT NULL,
  end_date         date CHECK (end_date IS NULL OR end_date >= start_date),
  runs_generated   int  NOT NULL DEFAULT 0 CHECK (runs_generated >= 0),
  next_run_date    date,                                -- NULL once ended
  status           recurring_status NOT NULL DEFAULT 'active',
  lines            jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) >= 2),
  created_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          int NOT NULL DEFAULT 1,
  UNIQUE (entity_id, name)
);
CREATE INDEX recurring_due ON recurring_journals (entity_id, next_run_date) WHERE status = 'active';

ALTER TABLE journal_entries
  ADD COLUMN recurring_journal_id uuid REFERENCES recurring_journals(id),
  ADD COLUMN recurring_run_date   date;
ALTER TABLE journal_entries ADD CONSTRAINT recurring_fields_together
  CHECK ((recurring_journal_id IS NULL) = (recurring_run_date IS NULL));
CREATE UNIQUE INDEX one_journal_per_recurring_run ON journal_entries (recurring_journal_id, recurring_run_date)
  WHERE recurring_journal_id IS NOT NULL;

ALTER TABLE recurring_journals ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON recurring_journals TO pep_app;          -- templates are paused/ended, never deleted
CREATE POLICY pep_app_all ON recurring_journals FOR ALL TO pep_app USING (true) WITH CHECK (true);
GRANT SELECT ON recurring_journals TO authenticated;
CREATE POLICY auth_read ON recurring_journals FOR SELECT TO authenticated
  USING (entity_id = ANY ((SELECT private.entities_with('journal.read'))::uuid[]));
