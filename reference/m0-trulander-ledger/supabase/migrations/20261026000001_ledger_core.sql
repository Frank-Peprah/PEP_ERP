-- =============================================================================
-- Trulander Ledger — M0 Ledger Core
-- Immutable, multi-entity, double-entry general ledger.
--
-- Design rules (non-negotiable):
--   1. Journals are append-only. No UPDATE or DELETE on posted journals/lines.
--      Corrections are made by reversal (ledger.reverse_journal).
--   2. Every journal balances (sum debits = sum credits) — enforced at commit
--      by a deferred constraint trigger, so direct INSERTs cannot bypass it.
--   3. Postings only into OPEN periods of the journal's entity.
--   4. Modules never write journals directly: they record a business event,
--      and ledger.post_event() applies the effective posting rule.
--   5. Every journal carries a gapless, per-entity journal number.
-- =============================================================================

create schema if not exists ledger;

-- -----------------------------------------------------------------------------
-- Enumerations
-- -----------------------------------------------------------------------------
create type ledger.account_type   as enum ('asset','liability','equity','income','expense');
create type ledger.balance_side   as enum ('debit','credit');
create type ledger.period_status  as enum ('open','soft_closed','closed');
create type ledger.party_kind     as enum ('customer','landowner','agent','vendor','employee','related_party','other');
create type ledger.parcel_class   as enum ('inventory','investment_property','ppe','held_for_client');
create type ledger.member_role    as enum ('viewer','preparer','approver','admin');

-- -----------------------------------------------------------------------------
-- Entities (group companies) and membership
-- -----------------------------------------------------------------------------
create table ledger.entities (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique check (code ~ '^[A-Z0-9_]{2,16}$'),
  legal_name           text not null,
  tin                  text,
  functional_currency  char(3) not null default 'GHS',
  fy_start_month       smallint not null default 1 check (fy_start_month between 1 and 12),
  reporting_framework  text not null default 'IFRS' check (reporting_framework in ('IFRS','IFRS_SMES')),
  created_at           timestamptz not null default now()
);

create table ledger.entity_members (
  entity_id  uuid not null references ledger.entities(id),
  user_id    uuid not null,
  role       ledger.member_role not null,
  created_at timestamptz not null default now(),
  primary key (entity_id, user_id)
);

-- -----------------------------------------------------------------------------
-- Chart of accounts
-- -----------------------------------------------------------------------------
create table ledger.accounts (
  id              uuid primary key default gen_random_uuid(),
  entity_id       uuid not null references ledger.entities(id),
  code            text not null check (code ~ '^[0-9]{3,8}$'),
  name            text not null,
  account_type    ledger.account_type not null,
  normal_balance  ledger.balance_side not null,
  parent_id       uuid references ledger.accounts(id),
  is_postable     boolean not null default true,   -- false = header/summary account
  is_active       boolean not null default true,
  is_control      boolean not null default false,  -- subledger control (AR, AP, inventory)
  ifrs_line       text,                            -- mapping to FS line item
  created_at      timestamptz not null default now(),
  unique (entity_id, code)
);
create index on ledger.accounts (entity_id, parent_id);

-- -----------------------------------------------------------------------------
-- Fiscal periods
-- -----------------------------------------------------------------------------
create table ledger.fiscal_periods (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid not null references ledger.entities(id),
  period_start  date not null,
  period_end    date not null,
  status        ledger.period_status not null default 'open',
  closed_at     timestamptz,
  closed_by     uuid,
  check (period_end >= period_start),
  unique (entity_id, period_start)
);
-- No overlapping periods per entity
create extension if not exists btree_gist;
alter table ledger.fiscal_periods
  add constraint fiscal_periods_no_overlap
  exclude using gist (entity_id with =, daterange(period_start, period_end, '[]') with &&);

-- -----------------------------------------------------------------------------
-- Shared master data: parties and parcels
-- -----------------------------------------------------------------------------
create table ledger.parties (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid not null references ledger.entities(id),
  kind        ledger.party_kind not null,
  name        text not null,
  tin         text,
  phone       text,
  email       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index on ledger.parties (entity_id, kind);

create table ledger.parcels (
  id              uuid primary key default gen_random_uuid(),
  entity_id       uuid not null references ledger.entities(id),
  code            text not null,
  description     text,
  location        text,
  size_acres      numeric(12,4),
  classification  ledger.parcel_class not null default 'inventory',
  status          text not null default 'available'
                  check (status in ('available','reserved','under_contract','sold','withdrawn')),
  created_at      timestamptz not null default now(),
  unique (entity_id, code)
);

-- -----------------------------------------------------------------------------
-- Business events (the only way modules talk to the ledger)
-- -----------------------------------------------------------------------------
create table ledger.business_events (
  id           uuid primary key default gen_random_uuid(),
  entity_id    uuid not null references ledger.entities(id),
  module       text not null,          -- e.g. 'sales', 'payables', 'mandate'
  event_type   text not null,          -- e.g. 'sales.deposit_received'
  source_ref   text not null,          -- source document id (receipt no, contract no)
  occurred_on  date not null,
  payload      jsonb not null,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  unique (entity_id, event_type, source_ref)   -- idempotency: one event per source doc
);

-- -----------------------------------------------------------------------------
-- Posting rules: event_type -> journal template, versioned by effective date
-- -----------------------------------------------------------------------------
create table ledger.posting_rules (
  id              uuid primary key default gen_random_uuid(),
  entity_id       uuid not null references ledger.entities(id),
  event_type      text not null,
  effective_from  date not null,
  description     text not null,
  created_at      timestamptz not null default now(),
  unique (entity_id, event_type, effective_from)
);

create table ledger.posting_rule_lines (
  rule_id       uuid not null references ledger.posting_rules(id),
  line_no       smallint not null,
  account_code  text not null,
  side          ledger.balance_side not null,
  amount_path   text[] not null,        -- JSON path into event payload, e.g. '{amount}'
  party_path    text[],                 -- optional: payload path to party uuid
  parcel_path   text[],                 -- optional: payload path to parcel uuid
  memo          text,
  primary key (rule_id, line_no)
);

-- -----------------------------------------------------------------------------
-- Journals (append-only)
-- -----------------------------------------------------------------------------
create table ledger.journal_counters (
  entity_id  uuid primary key references ledger.entities(id),
  last_no    bigint not null default 0
);

create table ledger.journals (
  id                   uuid primary key default gen_random_uuid(),
  entity_id            uuid not null references ledger.entities(id),
  journal_no           bigint not null,
  journal_date         date not null,
  period_id            uuid not null references ledger.fiscal_periods(id),
  description          text not null,
  source               text not null default 'manual'
                       check (source in ('manual','event','reversal','opening_balance','system')),
  event_id             uuid unique references ledger.business_events(id),
  reverses_journal_id  uuid unique references ledger.journals(id),  -- unique: reverse once only
  created_by           uuid,
  created_at           timestamptz not null default now(),
  unique (entity_id, journal_no)
);
create index on ledger.journals (entity_id, journal_date);

create table ledger.journal_lines (
  id            uuid primary key default gen_random_uuid(),
  journal_id    uuid not null references ledger.journals(id),
  line_no       smallint not null,
  account_id    uuid not null references ledger.accounts(id),
  debit         numeric(20,2) not null default 0 check (debit  >= 0),
  credit        numeric(20,2) not null default 0 check (credit >= 0),
  txn_currency  char(3),
  txn_amount    numeric(20,2),
  fx_rate       numeric(18,8),
  party_id      uuid references ledger.parties(id),
  parcel_id     uuid references ledger.parcels(id),
  memo          text,
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0)),
  unique (journal_id, line_no)
);
create index on ledger.journal_lines (account_id);
create index on ledger.journal_lines (party_id)  where party_id  is not null;
create index on ledger.journal_lines (parcel_id) where parcel_id is not null;

-- -----------------------------------------------------------------------------
-- Audit log (append-only)
-- -----------------------------------------------------------------------------
create table ledger.audit_log (
  id          bigserial primary key,
  entity_id   uuid,
  actor       uuid,
  action      text not null,
  object_type text not null,
  object_id   uuid,
  detail      jsonb,
  at          timestamptz not null default now()
);

-- =============================================================================
-- Helper: current user (works in Supabase; null in plain Postgres)
-- =============================================================================
create or replace function ledger.current_user_id() returns uuid
language plpgsql stable as $$
begin
  return coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
exception when others then
  return null;
end $$;

create or replace function ledger.assert_role(p_entity uuid, p_roles ledger.member_role[])
returns void language plpgsql stable as $$
declare v_uid uuid := ledger.current_user_id();
begin
  -- Direct DB sessions (migrations, service role, tests) have no JWT user.
  if v_uid is null then return; end if;
  if not exists (select 1 from ledger.entity_members
                 where entity_id = p_entity and user_id = v_uid and role = any(p_roles)) then
    raise exception 'User % lacks role % on entity %', v_uid, p_roles, p_entity
      using errcode = '42501';
  end if;
end $$;

-- =============================================================================
-- Immutability triggers
-- =============================================================================
create or replace function ledger.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% on ledger.% is not permitted: the ledger is append-only. Use ledger.reverse_journal().',
    tg_op, tg_table_name using errcode = '55000';
end $$;

create trigger journals_immutable      before update or delete on ledger.journals
  for each row execute function ledger.forbid_mutation();
create trigger journal_lines_immutable before update or delete on ledger.journal_lines
  for each row execute function ledger.forbid_mutation();
create trigger audit_log_immutable     before update or delete on ledger.audit_log
  for each row execute function ledger.forbid_mutation();
create trigger events_immutable        before update or delete on ledger.business_events
  for each row execute function ledger.forbid_mutation();

-- Journal header must fall in an OPEN period of the same entity
create or replace function ledger.check_journal_period() returns trigger
language plpgsql as $$
declare p record;
begin
  select * into p from ledger.fiscal_periods where id = new.period_id;
  if p.entity_id <> new.entity_id then
    raise exception 'Period % does not belong to entity %', new.period_id, new.entity_id;
  end if;
  if new.journal_date not between p.period_start and p.period_end then
    raise exception 'Journal date % outside period % – %', new.journal_date, p.period_start, p.period_end;
  end if;
  if p.status <> 'open' then
    raise exception 'Period % – % is %; posting refused', p.period_start, p.period_end, p.status
      using errcode = '55000';
  end if;
  return new;
end $$;

create trigger journals_period_check before insert on ledger.journals
  for each row execute function ledger.check_journal_period();

-- Line account must be postable, active and belong to the journal's entity
create or replace function ledger.check_line_account() returns trigger
language plpgsql as $$
declare a record; v_entity uuid;
begin
  select entity_id into v_entity from ledger.journals where id = new.journal_id;
  select * into a from ledger.accounts where id = new.account_id;
  if a.entity_id <> v_entity then
    raise exception 'Account % belongs to a different entity', a.code;
  end if;
  if not a.is_postable then
    raise exception 'Account % (%) is a header account and cannot be posted to', a.code, a.name;
  end if;
  if not a.is_active then
    raise exception 'Account % (%) is inactive', a.code, a.name;
  end if;
  return new;
end $$;

create trigger journal_lines_account_check before insert on ledger.journal_lines
  for each row execute function ledger.check_line_account();

-- Balance check at COMMIT (deferred) — cannot be bypassed by direct inserts
create or replace function ledger.check_journal_balanced() returns trigger
language plpgsql as $$
declare v_dr numeric; v_cr numeric; v_n int;
begin
  select coalesce(sum(debit),0), coalesce(sum(credit),0), count(*)
    into v_dr, v_cr, v_n
    from ledger.journal_lines where journal_id = new.journal_id;
  if v_n < 2 then
    raise exception 'Journal % has fewer than 2 lines', new.journal_id using errcode = '23514';
  end if;
  if v_dr <> v_cr then
    raise exception 'Journal % does not balance: debits % ≠ credits %', new.journal_id, v_dr, v_cr
      using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger journal_lines_balanced
  after insert on ledger.journal_lines
  deferrable initially deferred
  for each row execute function ledger.check_journal_balanced();

-- Every journal must have lines (catch header-only inserts)
create or replace function ledger.check_journal_has_lines() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from ledger.journal_lines where journal_id = new.id) then
    raise exception 'Journal % has no lines', new.id using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger journals_have_lines
  after insert on ledger.journals
  deferrable initially deferred
  for each row execute function ledger.check_journal_has_lines();

-- =============================================================================
-- Posting engine
-- =============================================================================

-- Next gapless journal number for an entity (row-locked)
create or replace function ledger.next_journal_no(p_entity uuid) returns bigint
language plpgsql as $$
declare v bigint;
begin
  insert into ledger.journal_counters(entity_id, last_no) values (p_entity, 0)
    on conflict (entity_id) do nothing;
  update ledger.journal_counters set last_no = last_no + 1
    where entity_id = p_entity returning last_no into v;
  return v;
end $$;

-- Find the period containing a date
create or replace function ledger.period_for(p_entity uuid, p_date date) returns uuid
language sql stable as $$
  select id from ledger.fiscal_periods
   where entity_id = p_entity and p_date between period_start and period_end
$$;

/*
  ledger.post_journal
  p_lines: jsonb array of objects:
    { "account": "1110", "debit": 100.00 }            -- account by code
    { "account": "2210", "credit": 100.00, "party_id": "...", "parcel_id": "...",
      "memo": "...", "txn_currency": "USD", "txn_amount": 10, "fx_rate": 10.0 }
*/
create or replace function ledger.post_journal(
  p_entity        uuid,
  p_date          date,
  p_description   text,
  p_lines         jsonb,
  p_source        text default 'manual',
  p_event_id      uuid default null,
  p_reverses      uuid default null
) returns uuid
language plpgsql security definer set search_path = ledger, public as $$
declare
  v_period  uuid;
  v_id      uuid := gen_random_uuid();
  v_line    jsonb;
  v_n       int := 0;
  v_acct    uuid;
  v_dr      numeric(20,2);
  v_cr      numeric(20,2);
begin
  perform ledger.assert_role(p_entity, array['preparer','approver','admin']::ledger.member_role[]);

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'A journal needs at least two lines' using errcode = '23514';
  end if;

  v_period := ledger.period_for(p_entity, p_date);
  if v_period is null then
    raise exception 'No fiscal period defined for % on entity %', p_date, p_entity;
  end if;

  insert into ledger.journals(id, entity_id, journal_no, journal_date, period_id, description,
                              source, event_id, reverses_journal_id, created_by)
  values (v_id, p_entity, ledger.next_journal_no(p_entity), p_date, v_period, p_description,
          p_source, p_event_id, p_reverses, ledger.current_user_id());

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_n := v_n + 1;
    select id into v_acct from ledger.accounts
      where entity_id = p_entity and code = v_line->>'account';
    if v_acct is null then
      raise exception 'Line %: unknown account code % for entity', v_n, v_line->>'account';
    end if;
    v_dr := round(coalesce((v_line->>'debit')::numeric, 0), 2);
    v_cr := round(coalesce((v_line->>'credit')::numeric, 0), 2);
    if v_dr = 0 and v_cr = 0 then
      continue;  -- zero lines are dropped (e.g. optional rule lines with nil amounts)
    end if;
    insert into ledger.journal_lines(journal_id, line_no, account_id, debit, credit,
                                     txn_currency, txn_amount, fx_rate,
                                     party_id, parcel_id, memo)
    values (v_id, v_n, v_acct, v_dr, v_cr,
            v_line->>'txn_currency', (v_line->>'txn_amount')::numeric, (v_line->>'fx_rate')::numeric,
            (v_line->>'party_id')::uuid, (v_line->>'parcel_id')::uuid, v_line->>'memo');
  end loop;

  -- Fail fast (the deferred trigger re-checks at commit)
  if (select sum(debit) - sum(credit) from ledger.journal_lines where journal_id = v_id) <> 0 then
    raise exception 'Journal does not balance' using errcode = '23514';
  end if;

  insert into ledger.audit_log(entity_id, actor, action, object_type, object_id, detail)
  values (p_entity, ledger.current_user_id(), 'post', 'journal', v_id,
          jsonb_build_object('source', p_source, 'date', p_date, 'description', p_description));

  return v_id;
end $$;

-- Reverse a journal (the only correction mechanism)
create or replace function ledger.reverse_journal(
  p_journal  uuid,
  p_date     date,
  p_reason   text
) returns uuid
language plpgsql security definer set search_path = ledger, public as $$
declare j record; v_lines jsonb; v_new uuid;
begin
  select * into j from ledger.journals where id = p_journal;
  if j is null then raise exception 'Journal % not found', p_journal; end if;
  perform ledger.assert_role(j.entity_id, array['approver','admin']::ledger.member_role[]);
  if exists (select 1 from ledger.journals where reverses_journal_id = p_journal) then
    raise exception 'Journal % has already been reversed', j.journal_no using errcode = '23505';
  end if;
  if j.reverses_journal_id is not null then
    raise exception 'Journal % is itself a reversal; post a new journal instead', j.journal_no;
  end if;

  select jsonb_agg(jsonb_build_object(
           'account', a.code, 'debit', l.credit, 'credit', l.debit,
           'party_id', l.party_id, 'parcel_id', l.parcel_id,
           'txn_currency', l.txn_currency,
           'txn_amount', case when l.txn_amount is null then null else -l.txn_amount end,
           'fx_rate', l.fx_rate, 'memo', l.memo) order by l.line_no)
    into v_lines
    from ledger.journal_lines l join ledger.accounts a on a.id = l.account_id
   where l.journal_id = p_journal;

  v_new := ledger.post_journal(j.entity_id, p_date,
             format('Reversal of J%s: %s', j.journal_no, p_reason),
             v_lines, 'reversal', null, p_journal);
  return v_new;
end $$;

-- Record a business event and post it through the effective rule (idempotent)
create or replace function ledger.record_event(
  p_entity      uuid,
  p_module      text,
  p_event_type  text,
  p_source_ref  text,
  p_occurred_on date,
  p_payload     jsonb
) returns uuid  -- returns journal id
language plpgsql security definer set search_path = ledger, public as $$
declare
  v_event   uuid;
  v_rule    record;
  v_lines   jsonb := '[]'::jsonb;
  r         record;
  v_amt     numeric;
  v_journal uuid;
begin
  perform ledger.assert_role(p_entity, array['preparer','approver','admin']::ledger.member_role[]);

  -- Idempotency: same source document posted twice returns the original journal
  select j.id into v_journal
    from ledger.business_events e join ledger.journals j on j.event_id = e.id
   where e.entity_id = p_entity and e.event_type = p_event_type and e.source_ref = p_source_ref;
  if v_journal is not null then return v_journal; end if;

  select * into v_rule from ledger.posting_rules
   where entity_id = p_entity and event_type = p_event_type and effective_from <= p_occurred_on
   order by effective_from desc limit 1;
  if v_rule is null then
    raise exception 'No posting rule for event % effective %', p_event_type, p_occurred_on;
  end if;

  insert into ledger.business_events(entity_id, module, event_type, source_ref, occurred_on, payload, created_by)
  values (p_entity, p_module, p_event_type, p_source_ref, p_occurred_on, p_payload, ledger.current_user_id())
  returning id into v_event;

  for r in select * from ledger.posting_rule_lines where rule_id = v_rule.id order by line_no loop
    v_amt := nullif(p_payload #>> r.amount_path, '')::numeric;
    if v_amt is null or v_amt = 0 then continue; end if;
    if v_amt < 0 then
      raise exception 'Negative amount at % in event %', r.amount_path, p_event_type;
    end if;
    v_lines := v_lines || jsonb_build_object(
      'account',  r.account_code,
      'debit',    case when r.side = 'debit'  then v_amt else 0 end,
      'credit',   case when r.side = 'credit' then v_amt else 0 end,
      'party_id', case when r.party_path  is not null then p_payload #>> r.party_path  end,
      'parcel_id',case when r.parcel_path is not null then p_payload #>> r.parcel_path end,
      'memo',     coalesce(r.memo, v_rule.description));
  end loop;

  v_journal := ledger.post_journal(p_entity, p_occurred_on,
                 format('%s [%s]', v_rule.description, p_source_ref),
                 v_lines, 'event', v_event, null);
  return v_journal;
end $$;

-- Period control
create or replace function ledger.set_period_status(p_period uuid, p_status ledger.period_status)
returns void language plpgsql security definer set search_path = ledger, public as $$
declare p record;
begin
  select * into p from ledger.fiscal_periods where id = p_period;
  perform ledger.assert_role(p.entity_id, array['approver','admin']::ledger.member_role[]);
  if p.status = 'closed' and p_status <> 'closed' then
    perform ledger.assert_role(p.entity_id, array['admin']::ledger.member_role[]);
  end if;
  update ledger.fiscal_periods
     set status = p_status,
         closed_at = case when p_status = 'closed' then now() end,
         closed_by = case when p_status = 'closed' then ledger.current_user_id() end
   where id = p_period;
  insert into ledger.audit_log(entity_id, actor, action, object_type, object_id, detail)
  values (p.entity_id, ledger.current_user_id(), 'period_status', 'fiscal_period', p_period,
          jsonb_build_object('from', p.status, 'to', p_status));
end $$;

-- Generate 12 monthly periods for a fiscal year
create or replace function ledger.create_fiscal_year(p_entity uuid, p_year_start date)
returns int language plpgsql security definer set search_path = ledger, public as $$
declare i int;
begin
  perform ledger.assert_role(p_entity, array['admin']::ledger.member_role[]);
  for i in 0..11 loop
    insert into ledger.fiscal_periods(entity_id, period_start, period_end)
    values (p_entity,
            (p_year_start + make_interval(months => i))::date,
            (p_year_start + make_interval(months => i + 1) - interval '1 day')::date)
    on conflict do nothing;
  end loop;
  return 12;
end $$;

-- =============================================================================
-- Reporting views
-- =============================================================================
create or replace view ledger.v_journal_detail as
select j.entity_id, j.journal_no, j.journal_date, j.description, j.source,
       l.line_no, a.code as account_code, a.name as account_name, a.account_type,
       l.debit, l.credit, l.party_id, l.parcel_id, l.memo, j.id as journal_id
  from ledger.journals j
  join ledger.journal_lines l on l.journal_id = j.id
  join ledger.accounts a on a.id = l.account_id;

create or replace view ledger.v_trial_balance as
select a.entity_id, a.code, a.name, a.account_type, a.normal_balance,
       coalesce(sum(l.debit),0)  as total_debit,
       coalesce(sum(l.credit),0) as total_credit,
       coalesce(sum(l.debit),0) - coalesce(sum(l.credit),0) as net_debit
  from ledger.accounts a
  left join ledger.journal_lines l on l.account_id = a.id
 where a.is_postable
 group by a.entity_id, a.id, a.code, a.name, a.account_type, a.normal_balance;

-- Trial balance as at a date (function, so it can be filtered efficiently)
create or replace function ledger.trial_balance(p_entity uuid, p_as_at date)
returns table(code text, name text, account_type ledger.account_type,
              debit numeric, credit numeric)
language sql stable as $$
  select a.code, a.name, a.account_type,
         greatest(sum(l.debit) - sum(l.credit), 0),
         greatest(sum(l.credit) - sum(l.debit), 0)
    from ledger.journal_lines l
    join ledger.journals j on j.id = l.journal_id
    join ledger.accounts a on a.id = l.account_id
   where j.entity_id = p_entity and j.journal_date <= p_as_at
   group by a.code, a.name, a.account_type
  having sum(l.debit) <> sum(l.credit)
   order by a.code
$$;

-- Parcel subledger: everything posted against a parcel
create or replace view ledger.v_parcel_ledger as
select p.entity_id, p.code as parcel_code, p.classification, p.status,
       a.code as account_code, a.name as account_name,
       sum(l.debit) as debit, sum(l.credit) as credit
  from ledger.parcels p
  join ledger.journal_lines l on l.parcel_id = p.id
  join ledger.accounts a on a.id = l.account_id
 group by p.entity_id, p.code, p.classification, p.status, a.code, a.name;
