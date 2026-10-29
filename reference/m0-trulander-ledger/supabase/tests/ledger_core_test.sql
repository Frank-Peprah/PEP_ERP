-- =============================================================================
-- Ledger Core test suite — run against a database with migrations + seed applied.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/ledger_core_test.sql
-- Everything runs inside a transaction that is rolled back: no residue.
-- =============================================================================
\set QUIET on
begin;

create temp table _results(test text, passed boolean, note text);

create or replace function pg_temp.expect_error(p_test text, p_sql text, p_like text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    insert into _results values (p_test, false, 'expected an error, none raised');
  exception when others then
    insert into _results values (p_test, sqlerrm ilike p_like, sqlerrm);
  end;
end $$;

create or replace function pg_temp.expect(p_test text, p_cond boolean, p_note text default null)
returns void language plpgsql as $$
begin
  insert into _results values (p_test, coalesce(p_cond, false), p_note);
end $$;

do $$
declare
  e        uuid := (select id from ledger.entities where code = 'TRULANDER');
  cust     uuid;
  owner    uuid;
  plot     uuid;
  j1       uuid;
  j2       uuid;
  j3       uuid;
  n_before bigint;
  v_tb     record;
begin
  -- Fixtures
  insert into ledger.parties(entity_id, kind, name) values (e, 'customer',  'Test Buyer')    returning id into cust;
  insert into ledger.parties(entity_id, kind, name) values (e, 'landowner', 'Test Landowner') returning id into owner;
  insert into ledger.parcels(entity_id, code, location, size_acres) values (e, 'TST-001', 'Oyibi', 0.16) returning id into plot;

  perform pg_temp.expect('seed: chart of accounts installed',
    (select count(*) from ledger.accounts where entity_id = e) >= 80);
  perform pg_temp.expect('seed: 24 monthly periods',
    (select count(*) from ledger.fiscal_periods where entity_id = e) = 24);
  perform pg_temp.expect('seed: 7 posting rules',
    (select count(*) from ledger.posting_rules where entity_id = e) = 7);

  -- 1. Balanced manual journal posts
  j1 := ledger.post_journal(e, date '2026-03-15', 'Capital injection',
        '[{"account":"1110","debit":500000},{"account":"3100","credit":500000}]');
  perform pg_temp.expect('post: balanced journal accepted', j1 is not null);
  perform pg_temp.expect('post: journal numbered 1', (select journal_no from ledger.journals where id = j1) = 1);

  -- 2. Unbalanced journal rejected
  perform pg_temp.expect_error('post: unbalanced journal rejected',
    format($q$select ledger.post_journal(%L, date '2026-03-15', 'bad',
      '[{"account":"1110","debit":100},{"account":"3100","credit":90}]')$q$, e),
    '%balance%');

  -- 3. Single-line journal rejected
  perform pg_temp.expect_error('post: single-line journal rejected',
    format($q$select ledger.post_journal(%L, date '2026-03-15', 'bad',
      '[{"account":"1110","debit":100}]')$q$, e),
    '%at least two lines%');

  -- 4. Header account rejected
  perform pg_temp.expect_error('post: header account rejected',
    format($q$select ledger.post_journal(%L, date '2026-03-15', 'bad',
      '[{"account":"1100","debit":100},{"account":"3100","credit":100}]')$q$, e),
    '%header account%');

  -- 5. Unknown account rejected
  perform pg_temp.expect_error('post: unknown account rejected',
    format($q$select ledger.post_journal(%L, date '2026-03-15', 'bad',
      '[{"account":"9999","debit":100},{"account":"3100","credit":100}]')$q$, e),
    '%unknown account%');

  -- 6. No period defined rejected
  perform pg_temp.expect_error('post: date with no period rejected',
    format($q$select ledger.post_journal(%L, date '2030-01-01', 'bad',
      '[{"account":"1110","debit":100},{"account":"3100","credit":100}]')$q$, e),
    '%No fiscal period%');

  -- 7. Immutability: UPDATE and DELETE blocked
  perform pg_temp.expect_error('immutable: update journal blocked',
    format($q$update ledger.journals set description = 'x' where id = %L$q$, j1), '%append-only%');
  perform pg_temp.expect_error('immutable: update line blocked',
    format($q$update ledger.journal_lines set debit = 1 where journal_id = %L$q$, j1), '%append-only%');
  perform pg_temp.expect_error('immutable: delete line blocked',
    format($q$delete from ledger.journal_lines where journal_id = %L$q$, j1), '%append-only%');

  -- 8. Direct insert bypassing post_journal still balance-checked
  perform pg_temp.expect_error('integrity: direct unbalanced insert blocked',
    format($q$
      with j as (insert into ledger.journals(entity_id, journal_no, journal_date, period_id, description)
                 values (%1$L, 9999, date '2026-03-20', ledger.period_for(%1$L, date '2026-03-20'), 'sneaky')
                 returning id)
      insert into ledger.journal_lines(journal_id, line_no, account_id, debit)
      select j.id, 1, a.id, 100 from j, ledger.accounts a where a.entity_id = %1$L and a.code = '1110';
      set constraints all immediate
    $q$, e), '%line%');
  set constraints all deferred;

  -- 9. Reversal
  j2 := ledger.reverse_journal(j1, date '2026-03-31', 'Test reversal');
  perform pg_temp.expect('reverse: reversal posted', j2 is not null);
  perform pg_temp.expect('reverse: nets to zero on 1110',
    (select sum(debit) - sum(credit) from ledger.v_journal_detail
      where entity_id = e and account_code = '1110' and journal_id in (j1, j2)) = 0);
  perform pg_temp.expect_error('reverse: double reversal blocked',
    format($q$select ledger.reverse_journal(%L, date '2026-03-31', 'again')$q$, j1), '%already been reversed%');
  perform pg_temp.expect_error('reverse: reversing a reversal blocked',
    format($q$select ledger.reverse_journal(%L, date '2026-03-31', 'again')$q$, j2), '%itself a reversal%');

  -- 10. Closed period blocks posting
  perform ledger.set_period_status(ledger.period_for(e, date '2026-01-15'), 'closed');
  perform pg_temp.expect_error('period: posting to closed period blocked',
    format($q$select ledger.post_journal(%L, date '2026-01-15', 'late',
      '[{"account":"1110","debit":100},{"account":"3100","credit":100}]')$q$, e),
    '%closed%');

  -- 11. Event-driven posting: own-land sale lifecycle
  perform ledger.record_event(e, 'inventory', 'inventory.land_cost_incurred', 'INV-ACQ-001', date '2026-04-01',
    jsonb_build_object('parcel_id', plot, 'acquisition', 40000, 'survey', 3000, 'title', 2000,
                       'infrastructure', 0, 'total', 45000));
  perform ledger.record_event(e, 'sales', 'sales.deposit_received', 'RCPT-0001', date '2026-05-02',
    jsonb_build_object('customer_id', cust, 'parcel_id', plot, 'amount', 30000));
  j3 := ledger.record_event(e, 'sales', 'sales.control_transferred', 'C-0001', date '2026-06-30',
    jsonb_build_object('customer_id', cust, 'parcel_id', plot, 'consideration', 120000,
                       'deposits_applied', 30000, 'receivable', 90000, 'cost_of_land', 40000));
  perform pg_temp.expect('event: revenue recognised on transfer of control',
    (select credit from ledger.v_journal_detail where journal_id = j3 and account_code = '4100') = 120000);
  perform pg_temp.expect('event: zero-amount rule line skipped',
    not exists (select 1 from ledger.v_journal_detail v join ledger.journals j on j.id = v.journal_id
                 join ledger.business_events b on b.id = j.event_id
                where b.source_ref = 'INV-ACQ-001' and v.account_code = '1340'));

  -- Idempotency: same source document returns the same journal, no new posting
  n_before := (select count(*) from ledger.journals where entity_id = e);
  perform pg_temp.expect('event: idempotent re-post returns same journal',
    ledger.record_event(e, 'sales', 'sales.control_transferred', 'C-0001', date '2026-06-30',
      jsonb_build_object('customer_id', cust, 'parcel_id', plot, 'consideration', 120000,
                         'deposits_applied', 30000, 'receivable', 90000, 'cost_of_land', 40000)) = j3);
  perform pg_temp.expect('event: no duplicate journal created',
    (select count(*) from ledger.journals where entity_id = e) = n_before);

  -- Inconsistent payload (does not balance) rejected
  perform pg_temp.expect_error('event: unbalanced payload rejected',
    format($q$select ledger.record_event(%L, 'sales', 'sales.control_transferred', 'C-BAD', date '2026-06-30',
      jsonb_build_object('customer_id', %L::uuid, 'parcel_id', %L::uuid, 'consideration', 100,
                         'deposits_applied', 30, 'receivable', 60, 'cost_of_land', 0))$q$, e, cust, plot),
    '%balance%');

  -- 12. Mandate (agency) sale: client money in and out, commission only in revenue
  perform ledger.record_event(e, 'mandate', 'mandate.buyer_funds_received', 'MND-RCPT-01', date '2026-07-10',
    jsonb_build_object('landowner_id', owner, 'parcel_id', plot, 'amount', 200000));
  perform ledger.record_event(e, 'mandate', 'mandate.sale_settled', 'MND-SET-01', date '2026-07-20',
    jsonb_build_object('landowner_id', owner, 'parcel_id', plot, 'gross_proceeds', 200000,
                       'commission', 10000, 'net_to_landowner', 190000));
  perform pg_temp.expect('mandate: escrow fully cleared',
    (select sum(debit) - sum(credit) from ledger.v_journal_detail where entity_id = e and account_code = '1150') = 0);
  perform pg_temp.expect('mandate: client money liability cleared',
    (select sum(credit) - sum(debit) from ledger.v_journal_detail where entity_id = e and account_code = '2300') = 0);
  perform pg_temp.expect('mandate: only commission hits revenue',
    (select sum(credit) from ledger.v_journal_detail where entity_id = e and account_code = '4200') = 10000);

  -- 13. Trial balance balances
  select sum(debit) as dr, sum(credit) as cr into v_tb from ledger.trial_balance(e, date '2026-12-31');
  perform pg_temp.expect('report: trial balance balances', v_tb.dr = v_tb.cr,
    format('Dr %s / Cr %s', v_tb.dr, v_tb.cr));

  -- 14. Parcel subledger ties to inventory movement: 45,000 capitalised - 40,000 relieved
  perform pg_temp.expect('report: parcel inventory balance = 5,000',
    (select sum(debit) - sum(credit) from ledger.v_parcel_ledger
      where parcel_code = 'TST-001' and account_code like '13%') = 5000);

  -- 15. Gapless numbering
  perform pg_temp.expect('numbering: gapless journal numbers',
    (select max(journal_no) = count(*) from ledger.journals where entity_id = e));

  -- 16. Audit log written for every journal
  perform pg_temp.expect('audit: one audit row per journal',
    (select count(*) from ledger.audit_log where object_type = 'journal')
      = (select count(*) from ledger.journals));
end $$;

\set QUIET off
\pset footer off
select case when passed then 'PASS' else 'FAIL' end as result, test, note from _results order by passed, test;
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed from _results;

do $$ begin
  if exists (select 1 from _results where not passed) then
    raise exception 'Ledger Core tests FAILED';
  end if;
end $$;

rollback;
