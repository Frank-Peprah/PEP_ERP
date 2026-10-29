-- PEP ERP — Migration 009 (Blueprint Phase 1, decision D4 default: closing journal).
-- Year-end close: one closing journal per financial year transfers the year's profit or loss from
-- the income and expense accounts to retained earnings, dated the last day of the year, through
-- the normal draft → submitted → approved → posted workflow (segregation of duties applies).
-- Then the year is marked closed and every period in it is locked.
--   • Reports of performance (P&L, cash flow, dashboards) exclude the closing journal;
--     positions (balances, SFP, TB after close) include it. See ACCOUNTING_RULES.md.
--   • At most one live closing journal per year (DB unique index); reversing it frees the year.
--   • A year can be marked closed only when its closing journal is posted and all periods are locked.

ALTER TABLE financial_years
  ADD COLUMN closed_at          timestamptz,
  ADD COLUMN closed_by          uuid REFERENCES users(id),
  ADD COLUMN closing_journal_id uuid REFERENCES journal_entries(id);

ALTER TABLE journal_entries ADD COLUMN closes_financial_year_id uuid REFERENCES financial_years(id);
ALTER TABLE journal_entries ADD CONSTRAINT closing_journal_marks_year
  CHECK ((journal_type = 'year_end_close') = (closes_financial_year_id IS NOT NULL));
CREATE UNIQUE INDEX one_live_close_per_year ON journal_entries (closes_financial_year_id)
  WHERE closes_financial_year_id IS NOT NULL AND status <> 'rejected' AND reversed_by_journal_id IS NULL;

-- Closing journal must sit on the last day of the year it closes, in the same entity.
CREATE FUNCTION trg_close_journal_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE fy record;
BEGIN
  IF NEW.closes_financial_year_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO fy FROM financial_years WHERE id = NEW.closes_financial_year_id;
  IF fy.entity_id <> NEW.entity_id OR NEW.journal_date <> fy.end_date THEN
    RAISE EXCEPTION 'CLOSING_JOURNAL_DATE: a closing journal must be dated % (last day of %)', fy.end_date, fy.label USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER close_journal_guard BEFORE INSERT OR UPDATE OF journal_date, closes_financial_year_id ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION trg_close_journal_guard();

-- A year is closed only with a posted, unreversed closing journal and every period locked.
CREATE FUNCTION trg_fy_close_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE j record; open_periods int;
BEGIN
  IF NEW.is_closed AND NOT OLD.is_closed THEN
    SELECT * INTO j FROM journal_entries WHERE id = NEW.closing_journal_id;
    IF j.id IS NULL OR j.status <> 'posted' OR j.reversed_by_journal_id IS NOT NULL OR j.closes_financial_year_id <> NEW.id THEN
      RAISE EXCEPTION 'YEAR_NOT_CLOSABLE: post the closing journal for % first', NEW.label USING ERRCODE = 'P0001';
    END IF;
    SELECT count(*) INTO open_periods FROM accounting_periods WHERE financial_year_id = NEW.id AND status <> 'locked';
    IF open_periods > 0 THEN
      RAISE EXCEPTION 'YEAR_NOT_CLOSABLE: % period(s) of % are still open', open_periods, NEW.label USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fy_close_guard BEFORE UPDATE OF is_closed ON financial_years
  FOR EACH ROW EXECUTE FUNCTION trg_fy_close_guard();

INSERT INTO role_permissions (role_code, permission) VALUES ('controller', 'year.close');
