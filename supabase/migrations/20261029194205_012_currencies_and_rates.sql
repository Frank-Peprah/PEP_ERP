-- PEP ERP — Migration 012 (Blueprint Phase 1, decision D5): currencies and exchange rates.
-- Trulander transacts only in GHS today, but every entity can enable foreign currencies later without a
-- schema change. Foreign-currency journals already store transaction amounts and functional (GHS) amounts
-- (migration 001); this adds the controls around them:
--   • an entity may only post in its functional currency or a currency it has enabled;
--   • exchange rates (functional units per one foreign unit) are recorded per entity, date and source
--     (Bank of Ghana reference by default; a bank or manual rate needs a reason) and never edited;
--   • fx_rate_on() returns the rate in force for a date: the latest rate on or before it, latest entry wins.
-- IAS 21 revaluation and realised/unrealised FX gains are built when an entity first enables a currency.

ALTER TABLE entities ADD COLUMN enabled_currencies char(3)[] NOT NULL DEFAULT '{}'
  CHECK (array_position(enabled_currencies, NULL) IS NULL);

CREATE TYPE fx_rate_source AS ENUM ('bog_reference', 'bank', 'manual');

CREATE TABLE exchange_rates (
  id              bigserial PRIMARY KEY,
  entity_id       uuid NOT NULL REFERENCES entities(id),
  currency        char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  rate_date       date NOT NULL,
  rate            numeric(18,8) NOT NULL CHECK (rate > 0),
  source          fx_rate_source NOT NULL DEFAULT 'bog_reference',
  reason          text,
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (source = 'bog_reference' OR length(trim(coalesce(reason, ''))) > 0)
);
CREATE INDEX exchange_rates_lookup ON exchange_rates (entity_id, currency, rate_date DESC, id DESC);

-- Rates are evidence: corrections are new rows, never edits or deletions.
CREATE FUNCTION trg_exchange_rates_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'RATE_IMMUTABLE: exchange rates are never changed; record a new rate with a reason' USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER exchange_rates_append_only BEFORE UPDATE OR DELETE ON exchange_rates
  FOR EACH ROW EXECUTE FUNCTION trg_exchange_rates_append_only();

-- Rate in force for a date (NULL when none recorded).
CREATE FUNCTION fx_rate_on(p_entity uuid, p_currency char(3), p_date date) RETURNS numeric
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT rate FROM exchange_rates
   WHERE entity_id = p_entity AND currency = p_currency AND rate_date <= p_date
   ORDER BY rate_date DESC, id DESC LIMIT 1
$$;

-- Journals may only use the functional currency or an enabled one.
CREATE FUNCTION trg_journal_currency_enabled() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE e record;
BEGIN
  SELECT functional_currency, enabled_currencies INTO e FROM entities WHERE id = NEW.entity_id;
  IF NEW.currency <> e.functional_currency AND NOT (NEW.currency = ANY (e.enabled_currencies)) THEN
    RAISE EXCEPTION 'CURRENCY_NOT_ENABLED: % is not enabled for this entity', NEW.currency USING ERRCODE = 'P0001';
  END IF;
  IF NEW.currency = e.functional_currency AND NEW.fx_rate <> 1 THEN
    RAISE EXCEPTION 'INVALID_FX_RATE: the rate must be 1 for the functional currency' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_currency_enabled BEFORE INSERT OR UPDATE OF currency, fx_rate ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION trg_journal_currency_enabled();

INSERT INTO role_permissions (role_code, permission) VALUES ('controller', 'currencies.manage');

ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON exchange_rates TO pep_app;                      -- append-only
GRANT USAGE, SELECT ON SEQUENCE exchange_rates_id_seq TO pep_app;
GRANT EXECUTE ON FUNCTION fx_rate_on(uuid, char, date) TO pep_app;
CREATE POLICY pep_app_all ON exchange_rates FOR ALL TO pep_app USING (true) WITH CHECK (true);
GRANT SELECT ON exchange_rates TO authenticated;
CREATE POLICY auth_read ON exchange_rates FOR SELECT TO authenticated
  USING (entity_id = ANY ((SELECT private.entities_with('entity.read'))::uuid[]));
