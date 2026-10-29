-- =============================================================================
-- Seed: Trulander JSF Limited (first entity of the group platform)
-- Assumes a 31 December year-end (PENDING CEO confirmation).
-- Safe to re-run.
-- =============================================================================
do $$
declare v_entity uuid;
begin
  insert into ledger.entities(code, legal_name, functional_currency, fy_start_month, reporting_framework)
  values ('TRULANDER', 'Trulander JSF Limited', 'GHS', 1, 'IFRS')
  on conflict (code) do nothing;

  select id into v_entity from ledger.entities where code = 'TRULANDER';

  perform ledger.install_coa_ghana_real_estate(v_entity);
  perform ledger.create_fiscal_year(v_entity, date '2026-01-01');   -- comparative year
  perform ledger.create_fiscal_year(v_entity, date '2027-01-01');   -- go-live year
  perform ledger.install_posting_rules_real_estate(v_entity, date '2026-01-01');
end $$;
