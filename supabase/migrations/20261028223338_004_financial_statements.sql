-- PEP ERP — Migration 004: Release 2 — Financial Reporting & Assurance Engine
-- Versioned report templates, immutable statement runs with a controlled
-- draft → under_review → approved → final workflow, entity materiality.
--
-- Controls enforced here (in addition to the service layer):
--   * A statement pack's figures are frozen at generation: never updated, never deleted.
--   * content_hash is computed by the database from the stored pack.
--   * A final run requires zero blocking exceptions and an approver who did not generate it.
--   * Final, superseded and rejected runs are immutable; one final run per entity and period end.
--   * Templates are append-only: a change is a new version, so approved packs stay reproducible.

ALTER TABLE entities ADD COLUMN materiality_threshold numeric(20,2) NOT NULL DEFAULT 0
  CHECK (materiality_threshold >= 0);

-- ───────────────────────────── Report templates ─────────────────────────────
CREATE TABLE report_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL,
  version     integer NOT NULL CHECK (version > 0),
  framework   text NOT NULL CHECK (framework IN ('IFRS','IFRS_SME')),
  name        text NOT NULL,
  definition  jsonb NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version)
);

CREATE FUNCTION trg_template_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'TEMPLATE_DELETE_FORBIDDEN: deactivate instead' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.definition IS DISTINCT FROM OLD.definition OR NEW.code IS DISTINCT FROM OLD.code
     OR NEW.version IS DISTINCT FROM OLD.version OR NEW.framework IS DISTINCT FROM OLD.framework THEN
    RAISE EXCEPTION 'TEMPLATE_IMMUTABLE: publish a new version instead' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER template_append_only BEFORE UPDATE OR DELETE ON report_templates
  FOR EACH ROW EXECUTE FUNCTION trg_template_append_only();

-- ───────────────────────────── Statement runs ─────────────────────────────
CREATE TYPE statement_status AS ENUM ('draft','under_review','approved','final','rejected','superseded');

CREATE TABLE financial_statement_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id           uuid NOT NULL REFERENCES entities(id),
  run_no              integer NOT NULL CHECK (run_no > 0),
  period_id           uuid NOT NULL REFERENCES accounting_periods(id),
  period_end          date NOT NULL,
  fy_label            text NOT NULL,
  template_id         uuid NOT NULL REFERENCES report_templates(id),
  status              statement_status NOT NULL DEFAULT 'draft',
  pack                jsonb NOT NULL,
  exceptions          jsonb NOT NULL DEFAULT '[]'::jsonb,
  blocking_count      integer NOT NULL CHECK (blocking_count >= 0),
  source_fingerprint  text NOT NULL,
  content_hash        text NOT NULL,
  generated_by        uuid NOT NULL REFERENCES users(id),
  generated_at        timestamptz NOT NULL DEFAULT now(),
  submitted_by        uuid REFERENCES users(id),
  submitted_at        timestamptz,
  approved_by         uuid REFERENCES users(id),
  approved_at         timestamptz,
  finalized_by        uuid REFERENCES users(id),
  finalized_at        timestamptz,
  rejected_by         uuid REFERENCES users(id),
  rejected_at         timestamptz,
  rejection_reason    text,
  supersedes_run_id   uuid REFERENCES financial_statement_runs(id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, run_no),
  CHECK (status <> 'final' OR (blocking_count = 0 AND approved_by IS NOT NULL AND finalized_by IS NOT NULL
                               AND approved_by <> generated_by AND finalized_by <> generated_by))
);
CREATE UNIQUE INDEX one_final_run_per_period ON financial_statement_runs (entity_id, period_end) WHERE status = 'final';
CREATE INDEX fsr_entity_period ON financial_statement_runs (entity_id, period_end, run_no DESC);

CREATE FUNCTION trg_statement_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'STATEMENT_RUN_DELETE_FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'STATEMENT_RUN_MUST_START_AS_DRAFT' USING ERRCODE = 'P0001';
    END IF;
    NEW.content_hash := encode(digest(NEW.pack::text, 'sha256'), 'hex');
    RETURN NEW;
  END IF;
  -- UPDATE
  IF OLD.status IN ('final','superseded','rejected') THEN
    RAISE EXCEPTION 'STATEMENT_RUN_IMMUTABLE: run is %', OLD.status USING ERRCODE = 'P0001';
  END IF;
  IF NEW.pack IS DISTINCT FROM OLD.pack OR NEW.exceptions IS DISTINCT FROM OLD.exceptions
     OR NEW.blocking_count IS DISTINCT FROM OLD.blocking_count OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR NEW.source_fingerprint IS DISTINCT FROM OLD.source_fingerprint OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
     OR NEW.period_id IS DISTINCT FROM OLD.period_id OR NEW.period_end IS DISTINCT FROM OLD.period_end
     OR NEW.template_id IS DISTINCT FROM OLD.template_id OR NEW.run_no IS DISTINCT FROM OLD.run_no
     OR NEW.generated_by IS DISTINCT FROM OLD.generated_by OR NEW.generated_at IS DISTINCT FROM OLD.generated_at THEN
    RAISE EXCEPTION 'STATEMENT_CONTENT_IMMUTABLE: regenerate to produce a new run' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'draft'        AND NEW.status IN ('under_review','rejected','superseded')) OR
       (OLD.status = 'under_review' AND NEW.status IN ('approved','draft','rejected','superseded')) OR
       (OLD.status = 'approved'     AND NEW.status IN ('final','draft','rejected','superseded'))) THEN
    RAISE EXCEPTION 'INVALID_STATUS_TRANSITION: % -> %', OLD.status, NEW.status USING ERRCODE = 'P0001';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER statement_run_guard BEFORE INSERT OR UPDATE OR DELETE ON financial_statement_runs
  FOR EACH ROW EXECUTE FUNCTION trg_statement_run_guard();

-- Pin search_path (pgcrypto may live in another schema on hosted Postgres).
DO $$
DECLARE ext_schema text;
BEGIN
  SELECT n.nspname INTO ext_schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pgcrypto';
  EXECUTE format('ALTER FUNCTION trg_statement_run_guard() SET search_path = public, %I', ext_schema);
  ALTER FUNCTION trg_template_append_only() SET search_path = public;
END $$;

ALTER TABLE report_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_statement_runs ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON report_templates, financial_statement_runs FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- ───────────────────────────── Permissions ─────────────────────────────
INSERT INTO role_permissions (role_code, permission) VALUES
  ('accountant', 'statements.prepare'), ('finance_admin', 'statements.prepare'), ('controller', 'statements.prepare'),
  ('controller', 'statements.approve'), ('controller', 'statements.finalize');

-- ───────────────────────────── Template v1 ─────────────────────────────
-- Line catalogue for IFRS general-purpose statements (expenses by function).
-- Wording is PEP's own; no IFRS text is reproduced.
INSERT INTO report_templates (code, version, framework, name, definition) VALUES ('IFRS_GENERAL', 1, 'IFRS',
'IFRS general-purpose statements — expenses by function', $json$
{
  "sfp": [
    { "key": "nca", "label": "Non-current assets", "side": "asset", "lines": [
      { "code": "SFP_PPE", "label": "Property, plant and equipment" },
      { "code": "SFP_INVEST_PROP", "label": "Investment property" },
      { "code": "SFP_INTANGIBLES", "label": "Intangible assets" },
      { "code": "SFP_ROU", "label": "Right-of-use assets" } ] },
    { "key": "ca", "label": "Current assets", "side": "asset", "lines": [
      { "code": "SFP_INVENTORY", "label": "Inventories" },
      { "code": "SFP_RECEIVABLES", "label": "Trade and other receivables" },
      { "code": "SFP_PREPAYMENTS", "label": "Prepayments" },
      { "code": "SFP_CASH", "label": "Cash and cash equivalents" } ] },
    { "key": "eq", "label": "Equity", "side": "equity", "lines": [
      { "code": "EQ_CAPITAL", "label": "Stated capital" },
      { "code": "EQ_OTHER_RESERVES", "label": "Other reserves" },
      { "code": "EQ_RETAINED", "label": "Retained earnings", "includesProfit": true } ] },
    { "key": "ncl", "label": "Non-current liabilities", "side": "liability", "lines": [
      { "code": "SFP_BORROWINGS", "label": "Borrowings" },
      { "code": "SFP_LEASE_LIAB", "label": "Lease liabilities" } ] },
    { "key": "cl", "label": "Current liabilities", "side": "liability", "lines": [
      { "code": "SFP_PAYABLES", "label": "Trade and other payables" },
      { "code": "SFP_ACCRUALS", "label": "Accruals" },
      { "code": "SFP_CONTRACT_LIAB", "label": "Contract liabilities" },
      { "code": "SFP_TAX_PAYABLE", "label": "Current tax payable" },
      { "code": "SFP_BORROWINGS_CURRENT", "label": "Borrowings — current portion" } ] }
  ],
  "pl": [
    { "code": "PL_REVENUE", "label": "Revenue" },
    { "code": "PL_COST_OF_SALES", "label": "Cost of sales" },
    { "subtotal": "gross_profit", "label": "Gross profit" },
    { "code": "PL_OTHER_INCOME", "label": "Other income" },
    { "code": "PL_SELLING_EXP", "label": "Selling and marketing expenses" },
    { "code": "PL_ADMIN_EXP", "label": "Administrative expenses" },
    { "code": "PL_OTHER_EXP", "label": "Other expenses" },
    { "subtotal": "operating_profit", "label": "Operating profit" },
    { "code": "PL_FINANCE_INCOME", "label": "Finance income" },
    { "code": "PL_FINANCE_COST", "label": "Finance costs" },
    { "subtotal": "profit_before_tax", "label": "Profit before tax" },
    { "code": "PL_TAX", "label": "Income tax expense" },
    { "subtotal": "profit", "label": "Profit for the period" }
  ],
  "oci": [
    { "code": "OCI_ITEMS", "label": "Other comprehensive income for the period" }
  ]
}
$json$::jsonb);
