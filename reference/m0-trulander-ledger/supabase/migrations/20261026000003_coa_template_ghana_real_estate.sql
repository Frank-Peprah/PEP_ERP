-- =============================================================================
-- Trulander Ledger — Chart of accounts template: Ghana real estate / land marketplace
-- Reusable for any group entity: select ledger.install_coa_ghana_real_estate(<entity_id>);
--
-- Policy positions encoded here (see docs/ACCOUNTING_POLICIES.md — PENDING CEO sign-off):
--   * Land held for sale            -> inventory (IAS 2), cost built up by component
--   * Land held for appreciation    -> investment property (IAS 40)
--   * Deposits before transfer of control -> contract liabilities (IFRS 15)
--   * Mandate (agency) sales        -> net commission revenue; vendor funds are client money
--   * Incremental commissions       -> capitalised contract costs (IFRS 15.91)
-- =============================================================================

create or replace function ledger.install_coa_ghana_real_estate(p_entity uuid)
returns int language plpgsql security definer set search_path = ledger, public as $$
declare
  r record;
  v_count int := 0;
begin
  perform ledger.assert_role(p_entity, array['admin']::ledger.member_role[]);

  for r in
    select * from (values
    -- code,  name,                                                   type,        normal,   parent, postable, control, ifrs_line
    ('1000','ASSETS',                                                 'asset',     'debit',  null,  false, false, null),
    ('1100','Cash and cash equivalents',                              'asset',     'debit',  '1000',false, false, 'Cash and cash equivalents'),
    ('1110','Bank – GHS operating account',                           'asset',     'debit',  '1100',true,  false, 'Cash and cash equivalents'),
    ('1120','Bank – USD account',                                     'asset',     'debit',  '1100',true,  false, 'Cash and cash equivalents'),
    ('1130','Mobile money wallet',                                    'asset',     'debit',  '1100',true,  false, 'Cash and cash equivalents'),
    ('1140','Petty cash',                                             'asset',     'debit',  '1100',true,  false, 'Cash and cash equivalents'),
    ('1150','Client money – segregated escrow account',               'asset',     'debit',  '1100',true,  false, 'Client money held'),
    ('1200','Receivables',                                            'asset',     'debit',  '1000',false, false, 'Trade and other receivables'),
    ('1210','Trade receivables – land sales',                         'asset',     'debit',  '1200',true,  true,  'Trade and other receivables'),
    ('1215','Instalment receivables – land sales',                    'asset',     'debit',  '1200',true,  true,  'Trade and other receivables'),
    ('1220','Commission receivable – mandate sales',                  'asset',     'debit',  '1200',true,  true,  'Trade and other receivables'),
    ('1230','Allowance for expected credit losses',                   'asset',     'credit', '1200',true,  false, 'Trade and other receivables'),
    ('1240','Staff advances',                                         'asset',     'debit',  '1200',true,  false, 'Trade and other receivables'),
    ('1250','Prepayments',                                            'asset',     'debit',  '1200',true,  false, 'Trade and other receivables'),
    ('1260','Withholding tax credits receivable',                     'asset',     'debit',  '1200',true,  false, 'Current tax assets'),
    ('1270','VAT input recoverable',                                  'asset',     'debit',  '1200',true,  false, 'Trade and other receivables'),
    ('1280','Intercompany receivables',                               'asset',     'debit',  '1200',true,  true,  'Amounts due from related parties'),
    ('1300','Land inventory (IAS 2)',                                 'asset',     'debit',  '1000',false, false, 'Inventories – land held for sale'),
    ('1310','Land – acquisition cost',                                'asset',     'debit',  '1300',true,  true,  'Inventories – land held for sale'),
    ('1320','Land – survey, demarcation and site plans',              'asset',     'debit',  '1300',true,  true,  'Inventories – land held for sale'),
    ('1330','Land – title regularisation and litigation costs',       'asset',     'debit',  '1300',true,  true,  'Inventories – land held for sale'),
    ('1340','Land – infrastructure and site development',             'asset',     'debit',  '1300',true,  true,  'Inventories – land held for sale'),
    ('1350','Land – capitalised borrowing costs (IAS 23)',            'asset',     'debit',  '1300',true,  true,  'Inventories – land held for sale'),
    ('1360','Land – write-down to net realisable value',              'asset',     'credit', '1300',true,  false, 'Inventories – land held for sale'),
    ('1400','Contract costs (IFRS 15)',                               'asset',     'debit',  '1000',false, false, 'Contract costs'),
    ('1410','Capitalised costs of obtaining contracts',               'asset',     'debit',  '1400',true,  false, 'Contract costs'),
    ('1500','Investment property (IAS 40)',                           'asset',     'debit',  '1000',false, false, 'Investment property'),
    ('1510','Investment property – land at cost/fair value',          'asset',     'debit',  '1500',true,  false, 'Investment property'),
    ('1600','Property, plant and equipment',                          'asset',     'debit',  '1000',false, false, 'Property, plant and equipment'),
    ('1610','Motor vehicles – cost',                                  'asset',     'debit',  '1600',true,  false, 'Property, plant and equipment'),
    ('1615','Motor vehicles – accumulated depreciation',              'asset',     'credit', '1600',true,  false, 'Property, plant and equipment'),
    ('1620','Office and IT equipment – cost',                         'asset',     'debit',  '1600',true,  false, 'Property, plant and equipment'),
    ('1625','Office and IT equipment – accumulated depreciation',     'asset',     'credit', '1600',true,  false, 'Property, plant and equipment'),
    ('1630','Furniture and fittings – cost',                          'asset',     'debit',  '1600',true,  false, 'Property, plant and equipment'),
    ('1635','Furniture and fittings – accumulated depreciation',      'asset',     'credit', '1600',true,  false, 'Property, plant and equipment'),

    ('2000','LIABILITIES',                                            'liability', 'credit', null,  false, false, null),
    ('2100','Trade and other payables',                               'liability', 'credit', '2000',false, false, 'Trade and other payables'),
    ('2110','Trade payables',                                         'liability', 'credit', '2100',true,  true,  'Trade and other payables'),
    ('2120','Landowner payables – acquisitions',                      'liability', 'credit', '2100',true,  true,  'Trade and other payables'),
    ('2130','Agent commissions payable',                              'liability', 'credit', '2100',true,  true,  'Trade and other payables'),
    ('2140','Accrued expenses',                                       'liability', 'credit', '2100',true,  false, 'Trade and other payables'),
    ('2150','Intercompany payables',                                  'liability', 'credit', '2100',true,  true,  'Amounts due to related parties'),
    ('2200','Contract liabilities (IFRS 15)',                         'liability', 'credit', '2000',false, false, 'Contract liabilities'),
    ('2210','Customer deposits – land sales',                         'liability', 'credit', '2200',true,  true,  'Contract liabilities'),
    ('2220','Instalments received before transfer of control',        'liability', 'credit', '2200',true,  true,  'Contract liabilities'),
    ('2300','Client money held for landowners (mandate sales)',       'liability', 'credit', '2000',true,  true,  'Client money held'),
    ('2400','Statutory liabilities',                                  'liability', 'credit', '2000',false, false, 'Current tax and statutory liabilities'),
    ('2410','VAT and levies output',                                  'liability', 'credit', '2400',true,  false, 'Current tax and statutory liabilities'),
    ('2420','Withholding tax payable',                                'liability', 'credit', '2400',true,  false, 'Current tax and statutory liabilities'),
    ('2430','PAYE payable',                                           'liability', 'credit', '2400',true,  false, 'Current tax and statutory liabilities'),
    ('2440','SSNIT payable (Tier 1 and Tier 2)',                      'liability', 'credit', '2400',true,  false, 'Current tax and statutory liabilities'),
    ('2450','Corporate income tax payable',                           'liability', 'credit', '2400',true,  false, 'Current tax liabilities'),
    ('2460','Stamp duty payable',                                     'liability', 'credit', '2400',true,  false, 'Current tax and statutory liabilities'),
    ('2500','Borrowings',                                             'liability', 'credit', '2000',false, false, 'Borrowings'),
    ('2510','Bank loans',                                             'liability', 'credit', '2500',true,  false, 'Borrowings'),
    ('2520','Directors'' current accounts',                           'liability', 'credit', '2500',true,  false, 'Amounts due to related parties'),
    ('2600','Deferred tax liability',                                 'liability', 'credit', '2000',true,  false, 'Deferred tax'),
    ('2990','Suspense – opening balance differences (clear in 60 days)','liability','credit','2000',true,  false, 'Trade and other payables'),

    ('3000','EQUITY',                                                 'equity',    'credit', null,  false, false, null),
    ('3100','Stated capital',                                         'equity',    'credit', '3000',true,  false, 'Stated capital'),
    ('3200','Retained earnings',                                      'equity',    'credit', '3000',true,  false, 'Retained earnings'),
    ('3300','Revaluation and other reserves',                         'equity',    'credit', '3000',true,  false, 'Other reserves'),

    ('4000','INCOME',                                                 'income',    'credit', null,  false, false, null),
    ('4100','Revenue – land sales (principal)',                       'income',    'credit', '4000',true,  false, 'Revenue'),
    ('4200','Commission income – mandate sales (agent)',              'income',    'credit', '4000',true,  false, 'Revenue'),
    ('4300','Advisory, valuation and pricing fees',                   'income',    'credit', '4000',true,  false, 'Revenue'),
    ('4400','Finance income – significant financing component',       'income',    'credit', '4000',true,  false, 'Finance income'),
    ('4500','Other income',                                           'income',    'credit', '4000',true,  false, 'Other income'),
    ('4600','Fair value gains on investment property',                'income',    'credit', '4000',true,  false, 'Other income'),

    ('5000','COST OF SALES',                                          'expense',   'debit',  null,  false, false, null),
    ('5100','Cost of land sold',                                      'expense',   'debit',  '5000',true,  false, 'Cost of sales'),
    ('5200','Amortisation of capitalised contract costs',             'expense',   'debit',  '5000',true,  false, 'Cost of sales'),
    ('5300','Direct sales commissions (expensed)',                    'expense',   'debit',  '5000',true,  false, 'Cost of sales'),
    ('5400','Inventory write-down to NRV',                            'expense',   'debit',  '5000',true,  false, 'Cost of sales'),

    ('6000','OPERATING EXPENSES',                                     'expense',   'debit',  null,  false, false, null),
    ('6100','Salaries and wages',                                     'expense',   'debit',  '6000',true,  false, 'Staff costs'),
    ('6110','Employer SSNIT contributions',                           'expense',   'debit',  '6000',true,  false, 'Staff costs'),
    ('6200','Rent and occupancy',                                     'expense',   'debit',  '6000',true,  false, 'Administrative expenses'),
    ('6300','Marketing and advertising',                              'expense',   'debit',  '6000',true,  false, 'Selling and marketing expenses'),
    ('6400','Professional and legal fees',                            'expense',   'debit',  '6000',true,  false, 'Administrative expenses'),
    ('6500','Transport and site visits',                              'expense',   'debit',  '6000',true,  false, 'Administrative expenses'),
    ('6600','Utilities and communication',                            'expense',   'debit',  '6000',true,  false, 'Administrative expenses'),
    ('6700','Depreciation',                                           'expense',   'debit',  '6000',true,  false, 'Depreciation'),
    ('6800','Bank charges and mobile money fees',                     'expense',   'debit',  '6000',true,  false, 'Administrative expenses'),
    ('6900','Expected credit loss expense',                           'expense',   'debit',  '6000',true,  false, 'Impairment losses on receivables'),

    ('7000','FINANCE COSTS',                                          'expense',   'debit',  null,  false, false, null),
    ('7100','Interest expense',                                       'expense',   'debit',  '7000',true,  false, 'Finance costs'),
    ('7200','Foreign exchange losses/(gains)',                        'expense',   'debit',  '7000',true,  false, 'Finance costs'),

    ('8000','TAXATION',                                               'expense',   'debit',  null,  false, false, null),
    ('8100','Current income tax expense',                             'expense',   'debit',  '8000',true,  false, 'Income tax expense'),
    ('8200','Deferred tax expense',                                   'expense',   'debit',  '8000',true,  false, 'Income tax expense')
    ) as t(code, name, atype, normal, parent_code, postable, control, ifrs_line)
    order by code
  loop
    insert into ledger.accounts(entity_id, code, name, account_type, normal_balance,
                                parent_id, is_postable, is_control, ifrs_line)
    values (p_entity, r.code, r.name, r.atype::ledger.account_type, r.normal::ledger.balance_side,
            (select id from ledger.accounts where entity_id = p_entity and code = r.parent_code),
            r.postable, r.control, r.ifrs_line)
    on conflict (entity_id, code) do nothing;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- -----------------------------------------------------------------------------
-- Posting rules template: the events Sales, Mandate and Payables modules emit
-- -----------------------------------------------------------------------------
create or replace function ledger.install_posting_rules_real_estate(p_entity uuid, p_effective date)
returns int language plpgsql security definer set search_path = ledger, public as $$
declare v_rule uuid; v_n int := 0;
begin
  perform ledger.assert_role(p_entity, array['admin']::ledger.member_role[]);

  -- Helper: create rule header, return id
  -- 1. Customer deposit received before transfer of control (contract liability)
  insert into ledger.posting_rules(entity_id, event_type, effective_from, description)
  values (p_entity, 'sales.deposit_received', p_effective, 'Customer deposit received')
  on conflict do nothing returning id into v_rule;
  if v_rule is not null then
    insert into ledger.posting_rule_lines values
      (v_rule, 1, '1110', 'debit',  '{amount}', '{customer_id}', '{parcel_id}', 'Deposit banked'),
      (v_rule, 2, '2210', 'credit', '{amount}', '{customer_id}', '{parcel_id}', 'Contract liability');
    v_n := v_n + 1;
  end if;

  -- 2. Transfer of control (indenture executed / possession) — recognise revenue
  --    payload: consideration = deposits_applied + receivable; cost_of_land
  insert into ledger.posting_rules(entity_id, event_type, effective_from, description)
  values (p_entity, 'sales.control_transferred', p_effective, 'Land sale – transfer of control, revenue recognised')
  on conflict do nothing returning id into v_rule;
  if v_rule is not null then
    insert into ledger.posting_rule_lines values
      (v_rule, 1, '2210', 'debit',  '{deposits_applied}', '{customer_id}', '{parcel_id}', 'Deposits applied'),
      (v_rule, 2, '1215', 'debit',  '{receivable}',       '{customer_id}', '{parcel_id}', 'Balance due under instalment plan'),
      (v_rule, 3, '4100', 'credit', '{consideration}',    '{customer_id}', '{parcel_id}', 'Revenue – land sale'),
      (v_rule, 4, '5100', 'debit',  '{cost_of_land}',     null,            '{parcel_id}', 'Cost of land sold'),
      (v_rule, 5, '1310', 'credit', '{cost_of_land}',     null,            '{parcel_id}', 'Relieve land inventory');
    v_n := v_n + 1;
  end if;

  -- 3. Instalment received after transfer of control
  insert into ledger.posting_rules(entity_id, event_type, effective_from, description)
  values (p_entity, 'sales.instalment_received', p_effective, 'Instalment received')
  on conflict do nothing returning id into v_rule;
  if v_rule is not null then
    insert into ledger.posting_rule_lines values
      (v_rule, 1, '1110', 'debit',  '{amount}', '{customer_id}', '{parcel_id}', 'Instalment banked'),
      (v_rule, 2, '1215', 'credit', '{amount}', '{customer_id}', '{parcel_id}', 'Instalment receivable settled');
    v_n := v_n + 1;
  end if;

  -- 4. Mandate (agency) sale: buyer funds received into escrow on behalf of landowner
  insert into ledger.posting_rules(entity_id, event_type, effective_from, description)
  values (p_entity, 'mandate.buyer_funds_received', p_effective, 'Mandate sale – buyer funds held for landowner')
  on conflict do nothing returning id into v_rule;
  if v_rule is not null then
    insert into ledger.posting_rule_lines values
      (v_rule, 1, '1150', 'debit',  '{amount}', '{landowner_id}', '{parcel_id}', 'Client money received'),
      (v_rule, 2, '2300', 'credit', '{amount}', '{landowner_id}', '{parcel_id}', 'Held for landowner');
    v_n := v_n + 1;
  end if;

  -- 5. Mandate sale completed: commission earned, net proceeds paid to landowner
  insert into ledger.posting_rules(entity_id, event_type, effective_from, description)
  values (p_entity, 'mandate.sale_settled', p_effective, 'Mandate sale settled – commission earned, landowner paid')
  on conflict do nothing returning id into v_rule;
  if v_rule is not null then
    insert into ledger.posting_rule_lines values
      (v_rule, 1, '2300', 'debit',  '{gross_proceeds}', '{landowner_id}', '{parcel_id}', 'Release client money'),
      (v_rule, 2, '4200', 'credit', '{commission}',     '{landowner_id}', '{parcel_id}', 'Commission earned (agent)'),
      (v_rule, 3, '1150', 'credit', '{net_to_landowner}','{landowner_id}','{parcel_id}', 'Net proceeds paid to landowner'),
      (v_rule, 4, '1110', 'debit',  '{commission}',     null,             null,          'Commission transferred to operating account'),
      (v_rule, 5, '1150', 'credit', '{commission}',     null,             null,          'Commission transferred out of escrow');
    v_n := v_n + 1;
  end if;

  -- 6. Land acquisition cost incurred (supplier invoice / landowner payment)
  insert into ledger.posting_rules(entity_id, event_type, effective_from, description)
  values (p_entity, 'inventory.land_cost_incurred', p_effective, 'Land cost capitalised')
  on conflict do nothing returning id into v_rule;
  if v_rule is not null then
    insert into ledger.posting_rule_lines values
      (v_rule, 1, '1310', 'debit',  '{acquisition}',    null,        '{parcel_id}', 'Acquisition cost'),
      (v_rule, 2, '1320', 'debit',  '{survey}',         null,        '{parcel_id}', 'Survey and demarcation'),
      (v_rule, 3, '1330', 'debit',  '{title}',          null,        '{parcel_id}', 'Title regularisation / litigation'),
      (v_rule, 4, '1340', 'debit',  '{infrastructure}', null,        '{parcel_id}', 'Site development'),
      (v_rule, 5, '2110', 'credit', '{total}',          '{vendor_id}','{parcel_id}', 'Payable to supplier / landowner');
    v_n := v_n + 1;
  end if;

  -- 7. Agent commission on own-land sale (incremental cost of obtaining contract)
  insert into ledger.posting_rules(entity_id, event_type, effective_from, description)
  values (p_entity, 'sales.commission_incurred', p_effective, 'Sales agent commission capitalised (IFRS 15.91)')
  on conflict do nothing returning id into v_rule;
  if v_rule is not null then
    insert into ledger.posting_rule_lines values
      (v_rule, 1, '1410', 'debit',  '{amount}', '{agent_id}', '{parcel_id}', 'Capitalised contract cost'),
      (v_rule, 2, '2130', 'credit', '{amount}', '{agent_id}', '{parcel_id}', 'Commission payable');
    v_n := v_n + 1;
  end if;

  return v_n;
end $$;

revoke all on function ledger.install_coa_ghana_real_estate(uuid) from public;
revoke all on function ledger.install_posting_rules_real_estate(uuid, date) from public;
