-- =============================================================================
-- Trulander Ledger — M0 security
-- Row-level security: users see only entities they are members of.
-- Writes are only possible through SECURITY DEFINER functions, which enforce
-- role checks (preparer / approver / admin) and the posting invariants.
-- =============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'entities','entity_members','accounts','fiscal_periods','parties','parcels',
    'business_events','posting_rules','posting_rule_lines','journal_counters',
    'journals','journal_lines','audit_log']
  loop
    -- ENABLE (not FORCE): the table owner, which runs the SECURITY DEFINER
    -- posting functions, must bypass RLS; everyone else is filtered.
    execute format('alter table ledger.%I enable row level security', t);
  end loop;
end $$;

-- Membership test used by every policy
create or replace function ledger.is_member(p_entity uuid) returns boolean
language sql stable security definer set search_path = ledger, public as $$
  select exists (select 1 from ledger.entity_members
                  where entity_id = p_entity and user_id = ledger.current_user_id())
$$;

create policy entities_read       on ledger.entities         for select using (ledger.is_member(id));
create policy members_read        on ledger.entity_members   for select using (ledger.is_member(entity_id));
create policy accounts_read       on ledger.accounts         for select using (ledger.is_member(entity_id));
create policy periods_read        on ledger.fiscal_periods   for select using (ledger.is_member(entity_id));
create policy parties_read        on ledger.parties          for select using (ledger.is_member(entity_id));
create policy parcels_read        on ledger.parcels          for select using (ledger.is_member(entity_id));
create policy events_read         on ledger.business_events  for select using (ledger.is_member(entity_id));
create policy rules_read          on ledger.posting_rules    for select using (ledger.is_member(entity_id));
create policy rule_lines_read     on ledger.posting_rule_lines for select
  using (exists (select 1 from ledger.posting_rules r where r.id = rule_id and ledger.is_member(r.entity_id)));
create policy journals_read       on ledger.journals         for select using (ledger.is_member(entity_id));
create policy journal_lines_read  on ledger.journal_lines    for select
  using (exists (select 1 from ledger.journals j where j.id = journal_id and ledger.is_member(j.entity_id)));
create policy audit_read          on ledger.audit_log        for select using (ledger.is_member(entity_id));

-- Views run with the caller's privileges so RLS applies through them
alter view ledger.v_journal_detail set (security_invoker = true);
alter view ledger.v_trial_balance  set (security_invoker = true);
alter view ledger.v_parcel_ledger  set (security_invoker = true);

-- Function execution: nobody by default; authenticated users only (Supabase)
revoke all on all functions in schema ledger from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant usage on schema ledger to authenticated;
    grant select on all tables in schema ledger to authenticated;
    grant execute on function
      ledger.post_journal(uuid, date, text, jsonb, text, uuid, uuid),
      ledger.reverse_journal(uuid, date, text),
      ledger.record_event(uuid, text, text, text, date, jsonb),
      ledger.set_period_status(uuid, ledger.period_status),
      ledger.create_fiscal_year(uuid, date),
      ledger.trial_balance(uuid, date),
      ledger.is_member(uuid),
      ledger.current_user_id()
    to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on schema ledger from anon;
  end if;
end $$;
