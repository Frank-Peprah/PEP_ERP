-- PEP ERP — portable DEMO seed (pure SQL, runs on any migrated PEP database, incl. hosted staging).
-- Mirrors database/seeds/seed.ts. Every journal goes draft → submitted → approved → posted through
-- UPDATEs, so all database controls validate the data. ILLUSTRATIVE DATA — not real books. No tax rates.

-- ── helpers (session-scoped) ──
CREATE OR REPLACE FUNCTION pg_temp.audit(e uuid, actor uuid, act text, otype text, oid text, aft jsonb, rsn text DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO audit_events (entity_id, actor_id, action, object_type, object_id, after, reason) VALUES (e, actor, act, otype, oid, aft, rsn);
$$;

CREATE OR REPLACE FUNCTION pg_temp.uid(mail text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM users WHERE email = mail $$;

-- Create a journal and walk it through the workflow. lines: [["1100","100.00",null,"desc"], ...]
CREATE OR REPLACE FUNCTION pg_temp.jv(ent uuid, preparer uuid, approver uuid, d date, descr text, ln jsonb,
                                     ref text DEFAULT NULL, stop_at text DEFAULT 'posted', jtype journal_type DEFAULT 'manual',
                                     reverses uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE jid uuid; per uuid; fy text; n bigint; x jsonb; i int := 0;
BEGIN
  SELECT p.id, f.label INTO per, fy FROM accounting_periods p JOIN financial_years f ON f.id = p.financial_year_id
   WHERE p.entity_id = ent AND d BETWEEN p.start_date AND p.end_date;
  INSERT INTO journal_entries (entity_id, journal_type, journal_date, period_id, reference, description, currency, prepared_by, reverses_journal_id, source)
  VALUES (ent, jtype, d, per, ref, CASE WHEN jtype = 'reversal' THEN descr ELSE '[DEMO] ' || descr END, 'GHS', preparer, reverses,
          CASE WHEN jtype = 'reversal' THEN 'reversal' ELSE 'manual' END)
  RETURNING id INTO jid;
  FOR x IN SELECT * FROM jsonb_array_elements(ln) LOOP
    i := i + 1;
    INSERT INTO journal_lines (journal_id, line_no, account_id, description, txn_debit, txn_credit, debit, credit)
    SELECT jid, i, a.id, x->>3, COALESCE((x->>1)::numeric, 0), COALESCE((x->>2)::numeric, 0),
           COALESCE((x->>1)::numeric, 0), COALESCE((x->>2)::numeric, 0)
      FROM accounts a WHERE a.entity_id = ent AND a.code = x->>0;
  END LOOP;
  PERFORM pg_temp.audit(ent, preparer, CASE WHEN jtype = 'reversal' THEN 'journal.reversal_created' ELSE 'journal.create' END,
                        'journal', jid::text, jsonb_build_object('journal_date', d, 'lines', i));
  IF stop_at = 'draft' THEN RETURN jid; END IF;
  UPDATE journal_entries SET status = 'submitted', submitted_at = now() WHERE id = jid;
  PERFORM pg_temp.audit(ent, preparer, 'journal.submit', 'journal', jid::text, jsonb_build_object('status', 'submitted'));
  IF stop_at = 'submitted' THEN RETURN jid; END IF;
  UPDATE journal_entries SET status = 'approved', approved_by = approver, approved_at = now() WHERE id = jid;
  PERFORM pg_temp.audit(ent, approver, 'journal.approve', 'journal', jid::text, jsonb_build_object('status', 'approved'));
  INSERT INTO journal_sequences (entity_id, fy_label, last_no) VALUES (ent, fy, 1)
  ON CONFLICT (entity_id, fy_label) DO UPDATE SET last_no = journal_sequences.last_no + 1 RETURNING last_no INTO n;
  UPDATE journal_entries SET status = 'posted', journal_no = 'JV-' || fy || '-' || lpad(n::text, 6, '0'), posted_by = approver, posted_at = now()
   WHERE id = jid;
  PERFORM pg_temp.audit(ent, approver, 'journal.post', 'journal', jid::text,
                        jsonb_build_object('status', 'posted', 'journal_no', 'JV-' || fy || '-' || lpad(n::text, 6, '0')));
  IF reverses IS NOT NULL THEN
    UPDATE journal_entries SET reversed_by_journal_id = jid WHERE id = reverses;
    PERFORM pg_temp.audit(ent, approver, 'journal.reversed', 'journal', reverses::text, jsonb_build_object('reversed_by', jid));
  END IF;
  RETURN jid;
END $$;

DO $seed$
DECLARE
  t uuid; l uuid; e uuid; u_frank uuid; u_ama uuid; u_kofi uuid; u_aud uuid; u_adm uuid; u_esi uuid;
  fy uuid; i int; k int; m text; s numeric; cost numeric; last date; wrong uuid; rev uuid; parent uuid; r record;
  sales numeric[] := ARRAY[210000,185000,240000,262000,198000,305000,288000,276000,331000,296000];
BEGIN
  IF EXISTS (SELECT 1 FROM entities) THEN RAISE EXCEPTION 'SEED_REFUSED: database already contains entities'; END IF;

  INSERT INTO users (email, full_name) VALUES
    ('frank@pep.local','Frank Adu-Peprah'), ('ama@pep.local','Ama Owusu (Preparer)'), ('kofi@pep.local','Kofi Mensah (Approver)'),
    ('auditor@pep.local','External Auditor (Read-only)'), ('admin@pep.local','System Administrator'), ('esi@pep.local','Esi Boateng (Landbank Accountant)');
  u_frank := pg_temp.uid('frank@pep.local'); u_ama := pg_temp.uid('ama@pep.local'); u_kofi := pg_temp.uid('kofi@pep.local');
  u_aud := pg_temp.uid('auditor@pep.local'); u_adm := pg_temp.uid('admin@pep.local'); u_esi := pg_temp.uid('esi@pep.local');

  INSERT INTO entities (code, legal_name, trading_name, industry) VALUES ('TRULANDER','Trulander JSF Limited','Trulander','Real estate — land marketplace') RETURNING id INTO t;
  INSERT INTO entities (code, legal_name, trading_name, industry) VALUES ('PEPLANDBANK','Pep Landbank Ltd','Landbank Ghana','Proptech') RETURNING id INTO l;

  INSERT INTO user_entity_roles (user_id, entity_id, role_code, granted_by) VALUES
    (u_frank,t,'controller',u_adm), (u_frank,l,'controller',u_adm), (u_ama,t,'preparer',u_adm), (u_ama,t,'accountant',u_adm),
    (u_kofi,t,'approver',u_adm), (u_aud,t,'auditor',u_adm), (u_adm,t,'system_admin',u_adm), (u_esi,l,'accountant',u_adm), (u_esi,l,'preparer',u_adm);

  FOREACH e IN ARRAY ARRAY[t, l] LOOP
    FOR k IN 2025..2026 LOOP
      INSERT INTO financial_years (entity_id, label, start_date, end_date) VALUES (e, k::text, make_date(k,1,1), make_date(k,12,31)) RETURNING id INTO fy;
      FOR i IN 1..12 LOOP
        INSERT INTO accounting_periods (entity_id, financial_year_id, period_no, name, start_date, end_date)
        VALUES (e, fy, i, to_char(make_date(k,i,1),'Mon YYYY'), make_date(k,i,1), (make_date(k,i,1) + interval '1 month - 1 day')::date);
      END LOOP;
      PERFORM pg_temp.audit(e, u_frank, 'fy.create', 'financial_year', fy::text, jsonb_build_object('label', k));
    END LOOP;

    FOR r IN SELECT * FROM (VALUES
      ('1000','Assets','asset',NULL,false,'debit',false,'none',NULL),
      ('1100','Cash at bank — current account','asset','1000',true,'debit',true,'cash','SFP_CASH'),
      ('1110','Mobile money merchant wallet','asset','1000',true,'debit',true,'cash','SFP_CASH'),
      ('1120','Petty cash','asset','1000',true,'debit',false,'cash','SFP_CASH'),
      ('1200','Trade receivables — plot buyers','asset','1000',true,'debit',true,'operating','SFP_RECEIVABLES'),
      ('1300','Land held for resale (inventory)','asset','1000',true,'debit',false,'operating','SFP_INVENTORY'),
      ('1310','Land development costs','asset','1000',true,'debit',false,'operating','SFP_INVENTORY'),
      ('1400','Prepayments','asset','1000',true,'debit',false,'operating','SFP_PREPAYMENTS'),
      ('1500','Motor vehicles — cost','asset','1000',true,'debit',false,'investing','SFP_PPE'),
      ('1510','Motor vehicles — accumulated depreciation','asset','1000',true,'credit',false,'non_cash','SFP_PPE'),
      ('1600','Office equipment — cost','asset','1000',true,'debit',false,'investing','SFP_PPE'),
      ('2000','Liabilities','liability',NULL,false,'credit',false,'none',NULL),
      ('2100','Trade payables — landowners','liability','2000',true,'credit',true,'operating','SFP_PAYABLES'),
      ('2110','Customer deposits (contract liabilities)','liability','2000',true,'credit',false,'operating','SFP_CONTRACT_LIAB'),
      ('2200','Accruals','liability','2000',true,'credit',false,'operating','SFP_ACCRUALS'),
      ('2300','Commissions payable — agents','liability','2000',true,'credit',false,'operating','SFP_PAYABLES'),
      ('2400','Director''s loan','liability','2000',true,'credit',false,'financing','SFP_BORROWINGS'),
      ('3000','Equity','equity',NULL,false,'credit',false,'none',NULL),
      ('3100','Stated capital','equity','3000',true,'credit',false,'financing','EQ_CAPITAL'),
      ('3200','Retained earnings','equity','3000',true,'credit',false,'none','EQ_RETAINED'),
      ('4000','Revenue','revenue',NULL,false,'credit',false,'none',NULL),
      ('4100','Revenue — plot sales','revenue','4000',true,'credit',false,'none','PL_REVENUE'),
      ('4200','Revenue — documentation & processing fees','revenue','4000',true,'credit',false,'none','PL_REVENUE'),
      ('4300','Revenue — site inspection fees','revenue','4000',true,'credit',false,'none','PL_REVENUE'),
      ('5000','Cost of sales','expense',NULL,false,'debit',false,'none',NULL),
      ('5100','Cost of land sold','expense','5000',true,'debit',false,'none','PL_COST_OF_SALES'),
      ('5200','Sales commissions — agents','expense','5000',true,'debit',false,'none','PL_COST_OF_SALES'),
      ('6000','Operating expenses','expense',NULL,false,'debit',false,'none',NULL),
      ('6100','Salaries and wages','expense','6000',true,'debit',false,'none','PL_ADMIN_EXP'),
      ('6200','Office rent','expense','6000',true,'debit',false,'none','PL_ADMIN_EXP'),
      ('6300','Marketing and advertising','expense','6000',true,'debit',false,'none','PL_SELLING_EXP'),
      ('6400','Survey, legal and title fees','expense','6000',true,'debit',false,'none','PL_ADMIN_EXP'),
      ('6500','Fuel and transport','expense','6000',true,'debit',false,'none','PL_ADMIN_EXP'),
      ('6600','Depreciation','expense','6000',true,'debit',false,'none','PL_ADMIN_EXP'),
      ('6700','Bank and MoMo charges','expense','6000',true,'debit',false,'none','PL_ADMIN_EXP'),
      ('6900','Suspense — unallocated','expense','6000',true,'debit',true,'none',NULL)
    ) v(code,name,typ,par,postable,nb,recon,cf,line) LOOP
      SELECT id INTO parent FROM accounts WHERE entity_id = e AND code = r.par;
      INSERT INTO accounts (entity_id, code, name, account_type, normal_balance, parent_id, is_postable, requires_reconciliation, cash_flow_class, statement_line_code)
      VALUES (e, r.code, r.name, r.typ::account_type, r.nb::normal_side, parent, r.postable, r.recon, r.cf::cash_flow_class, r.line);
    END LOOP;
    UPDATE entities SET retained_earnings_account_id = (SELECT id FROM accounts WHERE entity_id = e AND code = '3200') WHERE id = e;
  END LOOP;

  -- ── Trulander FY2025 ──
  PERFORM pg_temp.jv(t,u_ama,u_kofi,'2025-01-02','Opening balances — stated capital injected','[["1100","850000.00",null],["3100",null,"850000.00"]]','OB-2025');
  PERFORM pg_temp.jv(t,u_ama,u_kofi,'2025-02-10','Acquisition of 40 acres at Dawhenya (land held for resale)','[["1300","620000.00",null],["1100",null,"420000.00"],["2100",null,"200000.00"]]','DEED-0041');
  PERFORM pg_temp.jv(t,u_ama,u_kofi,'2025-06-30','H1 plot sales — 18 plots','[["1100","540000.00",null],["4100",null,"540000.00"]]','SALES-H1');
  PERFORM pg_temp.jv(t,u_ama,u_kofi,'2025-06-30','Cost of 18 plots sold','[["5100","279000.00",null],["1300",null,"279000.00"]]');
  PERFORM pg_temp.jv(t,u_ama,u_kofi,'2025-12-31','FY2025 operating costs','[["6100","96000.00",null],["6200","36000.00",null],["6300","22500.00",null],["1100",null,"154500.00"]]');

  -- ── Trulander FY2026 ──
  PERFORM pg_temp.jv(t,u_ama,u_kofi,'2026-01-06','Acquisition of 60 acres at Ningo (land held for resale)','[["1300","960000.00",null],["1100",null,"360000.00"],["2400",null,"600000.00"]]','DEED-0058');
  PERFORM pg_temp.jv(t,u_ama,u_kofi,'2026-06-02','Acquisition of 25 acres at Prampram (land held for resale)','[["1300","410000.00",null],["1100",null,"410000.00"]]','DEED-0063');
  FOR i IN 1..10 LOOP
    m := lpad(i::text, 2, '0'); s := sales[i]; cost := round(s * 0.47);
    last := LEAST((make_date(2026,i,1) + interval '1 month - 1 day')::date, DATE '2026-10-27');
    PERFORM pg_temp.jv(t,u_ama,u_kofi,make_date(2026,i,15),'Plot sales — '||m||'/2026',
      jsonb_build_array(jsonb_build_array('1100',to_char(s*0.8,'FM999999990.00'),null), jsonb_build_array('1110',to_char(s*0.2,'FM999999990.00'),null), jsonb_build_array('4100',null,to_char(s,'FM999999990.00'))),'SALES-2026'||m);
    PERFORM pg_temp.jv(t,u_ama,u_kofi,make_date(2026,i,15),'Cost of plots sold — '||m||'/2026',
      jsonb_build_array(jsonb_build_array('5100',to_char(cost,'FM999999990.00'),null), jsonb_build_array('1300',null,to_char(cost,'FM999999990.00'))));
    PERFORM pg_temp.jv(t,u_ama,u_kofi,make_date(2026,i,15),'Documentation fees — '||m||'/2026',
      jsonb_build_array(jsonb_build_array('1110',to_char(s*0.03,'FM999999990.00'),null), jsonb_build_array('4200',null,to_char(s*0.03,'FM999999990.00'))));
    PERFORM pg_temp.jv(t,u_ama,u_kofi,last,'Agent commissions accrued — '||m||'/2026',
      jsonb_build_array(jsonb_build_array('5200',to_char(s*0.05,'FM999999990.00'),null), jsonb_build_array('2300',null,to_char(s*0.05,'FM999999990.00'))));
    PERFORM pg_temp.jv(t,u_ama,u_kofi,last,'Payroll — '||m||'/2026','[["6100","24500.00",null],["1100",null,"24500.00"]]');
    PERFORM pg_temp.jv(t,u_ama,u_kofi,make_date(2026,i,5),'Office rent — '||m||'/2026','[["6200","3500.00",null],["1100",null,"3500.00"]]');
    PERFORM pg_temp.jv(t,u_ama,u_kofi,make_date(2026,i,20),'Marketing — '||m||'/2026',
      jsonb_build_array(jsonb_build_array('6300',to_char(4200+(i-1)*350,'FM999999990.00'),null), jsonb_build_array('1110',null,to_char(4200+(i-1)*350,'FM999999990.00'))));
  END LOOP;
  PERFORM pg_temp.jv(t,u_ama,u_kofi,'2026-03-12','Land development — access road grading','[["1310","145000.00",null],["1100",null,"145000.00"]]','INV-RD-2201');
  PERFORM pg_temp.jv(t,u_ama,u_kofi,'2026-04-03','Settlement of Dawhenya landowner balance','[["2100","200000.00",null],["1100",null,"200000.00"]]');
  PERFORM pg_temp.jv(t,u_ama,u_kofi,'2026-05-18','Acquisition of pickup vehicle','[["1500","185000.00",null],["1100",null,"185000.00"]]','VEH-01');

  -- Error and correction: misposted, reversed through approval, re-posted correctly
  wrong := pg_temp.jv(t,u_ama,u_kofi,'2026-09-08','Survey fees — Prampram site (posted to marketing in error)','[["6300","18000.00",null],["1100",null,"18000.00"]]','SRV-0907');
  rev := pg_temp.jv(t,u_ama,u_kofi,'2026-09-08','Reversal of '||(SELECT journal_no FROM journal_entries WHERE id = wrong)||': Misclassified — survey fees are not marketing',
                   '[["6300",null,"18000.00"],["1100","18000.00",null]]',(SELECT journal_no FROM journal_entries WHERE id = wrong),'posted','reversal',wrong);
  PERFORM pg_temp.jv(t,u_ama,u_kofi,'2026-09-08','Survey fees — Prampram site (corrected)','[["6400","18000.00",null],["1100",null,"18000.00"]]','SRV-0907');
  PERFORM pg_temp.jv(t,u_ama,u_kofi,'2026-10-21','Unidentified MoMo receipt pending allocation','[["1110","7500.00",null],["6900",null,"7500.00"]]');

  -- Approval queue
  PERFORM pg_temp.jv(t,u_ama,u_kofi,'2026-10-24','Accrual — October electricity and water','[["6200","2850.00",null],["2200",null,"2850.00"]]',NULL,'submitted');
  PERFORM pg_temp.jv(t,u_ama,u_kofi,'2026-10-25','Prepaid site security — Q4','[["1400","12000.00",null],["1100",null,"12000.00"]]',NULL,'submitted');
  PERFORM pg_temp.jv(t,u_ama,u_kofi,'2026-10-26','Customer deposit — Plot 14, Royal Palm Enclave','[["1100","25000.00",null],["2110",null,"25000.00"]]',NULL,'draft');

  -- Lock FY2025 and Jan–Aug 2026 for Trulander
  FOR r IN SELECT id FROM accounting_periods WHERE entity_id = t AND end_date <= DATE '2026-08-31' ORDER BY start_date LOOP
    UPDATE accounting_periods SET status = 'locked', locked_by = u_frank, locked_at = now() WHERE id = r.id;
    PERFORM pg_temp.audit(t, u_frank, 'period.lock', 'period', r.id::text, jsonb_build_object('status','locked'));
  END LOOP;

  -- Pep Landbank
  PERFORM pg_temp.jv(l,u_esi,u_frank,'2026-07-01','Opening capital — Pep Landbank','[["1100","300000.00",null],["3100",null,"300000.00"]]');
END $seed$;
