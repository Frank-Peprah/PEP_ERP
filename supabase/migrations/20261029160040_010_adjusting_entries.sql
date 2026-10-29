-- PEP ERP — Migration 010 (Blueprint Phase 1): adjusting entries and the adjusted trial balance.
-- A journal is flagged as an adjusting entry when it is prepared (accruals, prepayments, depreciation,
-- tax and audit adjustments). The adjusted trial balance shows, per account: unadjusted balance,
-- adjustments in the reporting window, adjusted balance. The flag is frozen once the journal leaves
-- draft, and a reversal carries the flag of the journal it reverses.

ALTER TABLE journal_entries ADD COLUMN is_adjustment boolean NOT NULL DEFAULT false;

-- Fields the core immutability trigger (migration 001) predates: frozen once the journal leaves draft.
CREATE FUNCTION trg_journal_late_fields_frozen() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status <> 'draft' AND (NEW.is_adjustment IS DISTINCT FROM OLD.is_adjustment
       OR NEW.closes_financial_year_id IS DISTINCT FROM OLD.closes_financial_year_id) THEN
    RAISE EXCEPTION 'JOURNAL_CONTENT_FROZEN: return to draft to edit' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_late_fields_frozen BEFORE UPDATE OF is_adjustment, closes_financial_year_id ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION trg_journal_late_fields_frozen();

-- Expose the flag on the ledger view (columns appended; grants are kept on replace).
CREATE OR REPLACE VIEW ledger_postings WITH (security_invoker = true) AS
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
       j.reverses_journal_id,
       j.is_adjustment
FROM journal_lines l
JOIN journal_entries j ON j.id = l.journal_id AND j.status = 'posted'
JOIN accounts a ON a.id = l.account_id;
