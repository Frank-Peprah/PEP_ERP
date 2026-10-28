import { Fragment, useEffect, useMemo, useState } from 'react';
import { api, money } from '../api';
import { can, downloadCsv, E, Icon, useApi, useApp } from '../ui';

const TABS = [
  ['sfp', 'Financial position'], ['pl', 'Profit or loss & OCI'], ['soce', 'Changes in equity'],
  ['cf', 'Cash flows'], ['notes', 'Notes'], ['checks', 'Checks & exceptions'],
] as const;
type Tab = (typeof TABS)[number][0];

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', under_review: 'Under review', approved: 'Approved', final: 'Final', rejected: 'Rejected', superseded: 'Superseded', preview: 'Live preview',
};
const RunBadge = ({ s }: { s: string }) => <span className={`badge b-${s}`}>{STATUS_LABEL[s] ?? s}</span>;
const STEPS = ['draft', 'under_review', 'approved', 'final'];

// ───────────────────────────── Statement tables ─────────────────────────────
function Head({ pack }: { pack: any }) {
  const cmp = pack.meta.comparative;
  return (
    <thead><tr><th>{pack.meta.entity.currency}</th><th style={{ width: 60 }}>Note</th>
      <th className="num">{pack.meta.periodName}{pack.meta.isYearEnd ? '' : ' YTD'}</th>
      {cmp && <th className="num">{cmp.label}{cmp.source === 'approved_snapshot' ? ' (final)' : ''}</th>}</tr></thead>
  );
}
const Row = ({ label, note, cur, cmp, hasCmp, cls }: { label: string; note?: number | null; cur: string | null; cmp: string | null; hasCmp: boolean; cls?: string }) => (
  <tr className={cls}><td>{label}</td><td className="mono">{note ?? ''}</td><td className="num">{money(cur)}</td>{hasCmp && <td className="num">{money(cmp)}</td>}</tr>
);

function SFP({ pack }: { pack: any }) {
  const has = !!pack.meta.comparative;
  const T = pack.sfp.totals;
  const sides: [string, string, string][] = [['asset', 'Assets', 'assets'], ['equity', 'Equity', 'equity'], ['liability', 'Liabilities', 'liabilities']];
  return (
    <table className="t fs"><Head pack={pack} /><tbody>
      {sides.map(([side, label, key]) => {
        const secs = pack.sfp.sections.filter((s: any) => s.side === side);
        if (!secs.length) return null;
        return (
          <Fragment key={side}>
            <tr className="grp"><td colSpan={has ? 4 : 3}>{label}</td></tr>
            {secs.map((s: any) => (
              <Fragment key={s.key}>
                {secs.length > 1 && <tr className="sec"><td colSpan={has ? 4 : 3}>{s.label}</td></tr>}
                {s.lines.map((l: any) => <Row key={l.code} label={l.label} note={l.note} cur={l.current} cmp={l.comparative} hasCmp={has} cls={l.code.startsWith('__') ? 'warnrow' : ''} />)}
                {secs.length > 1 && <Row label={`Total ${s.label.toLowerCase()}`} cur={s.total.current} cmp={s.total.comparative} hasCmp={has} cls="sub" />}
              </Fragment>
            ))}
            <Row label={`Total ${label.toLowerCase()}`} cur={T.current[key]} cmp={T.comparative?.[key] ?? null} hasCmp={has} cls="tot" />
          </Fragment>
        );
      })}
      <Row label="Total equity and liabilities" cur={T.current.equityAndLiabilities} cmp={T.comparative?.equityAndLiabilities ?? null} hasCmp={has} cls="grand" />
    </tbody></table>
  );
}

function PL({ pack }: { pack: any }) {
  const has = !!pack.meta.comparative;
  return (
    <table className="t fs"><Head pack={pack} /><tbody>
      {pack.pl.lines.map((l: any) => <Row key={l.key} label={l.label} note={l.note} cur={l.current} cmp={l.comparative} hasCmp={has}
        cls={l.key === 'profit' ? 'grand' : l.kind === 'subtotal' ? 'sub' : l.key.startsWith('__') ? 'warnrow' : ''} />)}
      <tr className="grp"><td colSpan={has ? 4 : 3}>Other comprehensive income</td></tr>
      <Row label="Other comprehensive income for the period" cur={pack.pl.oci.current} cmp={pack.pl.oci.comparative} hasCmp={has} />
      <Row label="Total comprehensive income for the period" cur={pack.pl.tci.current} cmp={pack.pl.tci.comparative} hasCmp={has} cls="grand" />
    </tbody></table>
  );
}

function SOCE({ pack }: { pack: any }) {
  if (!pack.soce) return <div className="empty">No equity lines in this template.</div>;
  const block = (title: string, cols: { code: string; label: string }[], rows: any[]) => (
    <div style={{ marginBottom: 22 }}>
      <div className="sec-title">{title}</div>
      <table className="t fs"><thead><tr><th>{pack.meta.entity.currency}</th>{cols.map((c) => <th key={c.code} className="num">{c.label}</th>)}<th className="num">Total equity</th></tr></thead>
        <tbody>{rows.map((r: any) => (
          <tr key={r.key} className={r.key === 'closing' ? 'grand' : r.key === 'opening' ? 'sub' : ''}><td>{r.label}</td>
            {r.values.map((v: string, i: number) => <td key={i} className="num">{money(v)}</td>)}<td className="num">{money(r.total)}</td></tr>))}</tbody></table>
    </div>
  );
  const label = (code: string) => pack.soce.columns.find((c: any) => c.code === code)?.label ?? code;
  return (
    <>
      {block(`${pack.meta.periodName} (FY${pack.meta.financialYear}${pack.meta.isYearEnd ? '' : ', year to date'})`, pack.soce.columns, pack.soce.current)}
      {pack.soce.comparative && block(`${pack.meta.comparative.label} — comparative`, pack.soce.comparative.columns.map((c: string) => ({ code: c, label: label(c) })), pack.soce.comparative.rows)}
    </>
  );
}

function CF({ pack }: { pack: any }) {
  const has = !!pack.meta.comparative;
  return (
    <table className="t fs"><Head pack={pack} /><tbody>
      {pack.cf.sections.map((s: any) => (
        <Fragment key={s.key}>
          <tr className="grp"><td colSpan={has ? 4 : 3}>{s.label}</td></tr>
          {s.lines.map((l: any) => <Row key={l.key} label={l.label} cur={l.current} cmp={l.comparative} hasCmp={has} />)}
          <Row label={`Net cash from ${s.key} activities`} cur={s.total.current} cmp={s.total.comparative} hasCmp={has} cls="sub" />
        </Fragment>
      ))}
      <Row label="Net increase/(decrease) in cash and cash equivalents" cur={pack.cf.net.current} cmp={pack.cf.net.comparative} hasCmp={has} cls="tot" />
      <Row label="Cash and cash equivalents at start of period" cur={pack.cf.opening.current} cmp={pack.cf.opening.comparative} hasCmp={has} />
      <Row label="Cash and cash equivalents at end of period" cur={pack.cf.closing.current} cmp={pack.cf.closing.comparative} hasCmp={has} cls="grand" />
    </tbody></table>
  );
}

function Notes({ pack }: { pack: any }) {
  const has = !!pack.meta.comparative;
  return (
    <div className="notes">
      {pack.notes.map((n: any) => (
        <div key={n.no} className="note" id={`note-${n.no}`}>
          <h4>{n.no}. {n.title} {n.status === 'template' && <span className="badge b-warn">Template wording — review</span>}
            {n.kind === 'breakdown' && <span className={`badge ${n.castsToStatement ? 'b-posted' : 'b-rejected'}`}>{n.castsToStatement ? 'Casts to statement' : 'Does not cast'}</span>}</h4>
          {n.kind === 'narrative' ? <p>{n.text}</p> : (
            <table className="t fs"><thead><tr><th style={{ width: 80 }}>Account</th><th>Description</th><th className="num">Current</th>{has && <th className="num">Comparative</th>}</tr></thead>
              <tbody>{n.lines.map((l: any, i: number) => (
                <tr key={i}><td className="code">{l.code}</td><td>{l.name}</td><td className="num">{money(l.current)}</td>{has && <td className="num">{money(l.comparative)}</td>}</tr>))}
                <tr className="tot"><td colSpan={2}>Total — agrees to statement line</td><td className="num">{money(n.total)}</td>{has && <td className="num">{money(n.lineComparative)}</td>}</tr>
              </tbody></table>)}
        </div>
      ))}
    </div>
  );
}

function Checks({ pack, exceptions }: { pack: any; exceptions: any[] }) {
  const blocking = exceptions.filter((e) => e.severity === 'blocking');
  return (
    <>
      <div className="checks">{pack.checks.map((ck: any) => (
        <div key={ck.code} className={`check ${ck.passed ? 'ok' : 'bad'}`}><Icon n={ck.passed ? 'check' : 'x'} size={16} /><div><b>{ck.label}</b><small>{ck.detail}</small></div></div>))}</div>
      <h4 style={{ margin: '20px 0 8px' }}>Exceptions — {blocking.length} blocking, {exceptions.length - blocking.length} warning</h4>
      {!exceptions.length && <div className="alert ok">No exceptions.</div>}
      {exceptions.map((x, i) => (
        <div key={i} className={`alert ${x.severity === 'blocking' ? 'block' : 'warn'}`}><Icon n="alert" size={15} />
          <span><b>{x.code.replace(/_/g, ' ')}</b>{x.accountCode ? ` · ${x.accountCode}` : ''} — {x.message}</span></div>))}
      <div className="sub" style={{ marginTop: 14 }}>Blocking exceptions prevent finalisation. Warnings must be reviewed but do not block. Materiality threshold: {money(pack.meta.materiality)}.</div>
    </>
  );
}

// ───────────────────────────── Exports ─────────────────────────────
function rowsFor(pack: any, tab: Tab): (string | null)[][] {
  const has = !!pack.meta.comparative;
  const r = (label: string, cur: string | null, cmp: string | null, note?: number | null) => has ? [label, note ? String(note) : '', cur, cmp] : [label, note ? String(note) : '', cur];
  if (tab === 'sfp') return pack.sfp.sections.flatMap((s: any) => [[s.label.toUpperCase()], ...s.lines.map((l: any) => r(l.label, l.current, l.comparative, l.note)), r(`Total ${s.label.toLowerCase()}`, s.total.current, s.total.comparative)])
    .concat([r('Total assets', pack.sfp.totals.current.assets, pack.sfp.totals.comparative?.assets ?? null), r('Total equity and liabilities', pack.sfp.totals.current.equityAndLiabilities, pack.sfp.totals.comparative?.equityAndLiabilities ?? null)]);
  if (tab === 'pl') return [...pack.pl.lines.map((l: any) => r(l.label, l.current, l.comparative, l.note)), r('Other comprehensive income', pack.pl.oci.current, pack.pl.oci.comparative), r('Total comprehensive income', pack.pl.tci.current, pack.pl.tci.comparative)];
  if (tab === 'cf') return [...pack.cf.sections.flatMap((s: any) => [[s.label.toUpperCase()], ...s.lines.map((l: any) => r(l.label, l.current, l.comparative)), r(`Net cash from ${s.key} activities`, s.total.current, s.total.comparative)]),
    r('Net increase/(decrease) in cash', pack.cf.net.current, pack.cf.net.comparative), r('Cash at start', pack.cf.opening.current, pack.cf.opening.comparative), r('Cash at end', pack.cf.closing.current, pack.cf.closing.comparative)];
  if (tab === 'soce' && pack.soce) return [['', ...pack.soce.columns.map((c: any) => c.label), 'Total'], ...pack.soce.current.map((x: any) => [x.label, ...x.values, x.total])];
  if (tab === 'notes') return pack.notes.flatMap((n: any) => n.kind === 'narrative' ? [[`${n.no}. ${n.title}`], [n.text], []] : [[`${n.no}. ${n.title}`], ...n.lines.map((l: any) => [l.code, l.name, l.current, l.comparative]), ['', 'Total', n.total, n.lineComparative], []]);
  return pack.checks.map((c: any) => [c.label, c.passed ? 'PASS' : 'FAIL', c.detail]);
}
const SHEETS: [Tab, string][] = [['sfp', 'Financial position'], ['pl', 'Profit or loss'], ['soce', 'Changes in equity'], ['cf', 'Cash flows'], ['notes', 'Notes'], ['checks', 'Checks']];

function headerRows(pack: any, status: string, run: any) {
  return [
    [pack.meta.entity.legalName], [`Period ended ${pack.meta.periodEnd} (FY${pack.meta.financialYear})`],
    [`Status: ${STATUS_LABEL[status]}${run ? ` · Run #${run.run_no} · SHA-256 ${run.content_hash}` : ''}`],
    [pack.meta.disclaimer], [],
  ];
}
function downloadExcel(pack: any, status: string, run: any) {
  const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cell = (v: string | null) => v !== null && /^-?\d+(\.\d+)?$/.test(v) ? `<Cell ss:StyleID="n"><Data ss:Type="Number">${v}</Data></Cell>` : `<Cell><Data ss:Type="String">${esc(v)}</Data></Cell>`;
  const cmpLabel = pack.meta.comparative ? pack.meta.comparative.label : null;
  const sheets = SHEETS.map(([tab, name]) => {
    const head = ['sfp', 'pl', 'cf'].includes(tab) ? [['', 'Note', pack.meta.periodName, ...(cmpLabel ? [cmpLabel] : [])]] : [];
    const rows = [...headerRows(pack, status, run), ...head, ...rowsFor(pack, tab)];
    return `<Worksheet ss:Name="${esc(name)}"><Table><Column ss:Width="300"/><Column ss:Width="60"/><Column ss:Width="110"/><Column ss:Width="110"/>${rows.map((r) => `<Row>${r.map(cell).join('')}</Row>`).join('')}</Table></Worksheet>`;
  }).join('');
  const xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="n"><NumberFormat ss:Format="#,##0.00;(#,##0.00)"/></Style></Styles>${sheets}</Workbook>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([xml], { type: 'application/vnd.ms-excel' }));
  a.download = `FS_${pack.meta.entity.code}_${pack.meta.periodEnd}_${run ? `run${run.run_no}` : 'preview'}.xls`; a.click();
}

// ───────────────────────────── Page ─────────────────────────────
export default function Statements() {
  const c = useApp();
  const { data: fys } = useApi<any[]>(`${E(c)}/periods`);
  const periods = useMemo(() => (fys ?? []).flatMap((f) => f.periods.map((p: any) => ({ ...p, fy: f.label }))).reverse(), [fys]);
  const [periodId, setPeriodId] = useState('');
  const [tab, setTab] = useState<Tab>((c.params.tab as Tab) ?? 'sfp');
  const [runId, setRunId] = useState<string | null>(c.params.runId ?? null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [askReason, setAskReason] = useState<null | 'return' | 'reject'>(null);
  const { data: runs, setData: setRuns } = useApi<any[]>(`${E(c)}/statement-runs`, [c.refreshKey]);
  const { data: run, setData: setRun, error: runErr } = useApi<any>(runId ? `${E(c)}/statement-runs/${runId}` : null, [c.refreshKey]);

  // Default period: last locked period, else current.
  useEffect(() => {
    if (periodId || !periods.length) return;
    const today = new Date().toISOString().slice(0, 10);
    const cur = periods.find((p) => p.start_date <= today && p.end_date >= today) ?? periods[0];
    setPeriodId(cur.id);
  }, [periods]);
  const { data: preview, error: prevErr, loading: prevLoading } = useApi<any>(!runId && periodId ? `${E(c)}/statement-preview?periodId=${periodId}` : null, [c.refreshKey]);

  const pack = runId ? run?.pack : preview;
  const exceptions: any[] = runId ? run?.exceptions ?? [] : [];
  const status = runId ? run?.status ?? 'draft' : 'preview';
  const previewExceptions: any[] = preview?.exceptions ?? [];
  const blocking = (runId ? exceptions : previewExceptions).filter((e: any) => e.severity === 'blocking').length;

  const reload = async () => {
    setRuns(await api(`${E(c)}/statement-runs`));
    if (runId) setRun(await api(`${E(c)}/statement-runs/${runId}`));
  };
  const generate = async () => {
    setBusy(true);
    try {
      const r = await api(`${E(c)}/statement-runs`, { method: 'POST', body: { periodId } });
      c.toast(`Statement run #${r.run_no} generated (${r.blocking_count} blocking exception${r.blocking_count === 1 ? '' : 's'})`);
      setRunId(r.id); await reload(); setRun(r);
    } catch (e: any) { c.toast(e.message, true); } finally { setBusy(false); }
  };
  const doAction = async (action: string, withReason?: string) => {
    setBusy(true);
    try {
      const r = await api(`${E(c)}/statement-runs/${runId}/${action}`, { method: 'POST', body: withReason ? { reason: withReason } : undefined });
      setRun(r); await reload(); c.toast(`Run #${r.run_no} is now ${STATUS_LABEL[r.status].toLowerCase()}`);
      setAskReason(null); setReason('');
    } catch (e: any) { c.toast(e.message, true); } finally { setBusy(false); }
  };

  const mine = run && run.generated_by === c.user.id;
  const actions: { key: string; label: string; cls?: string; show: boolean; title?: string }[] = run ? [
    { key: 'submit', label: 'Submit for review', cls: 'primary', show: run.status === 'draft' && can(c, 'statements.prepare') },
    { key: 'approve', label: 'Approve', cls: 'green', show: run.status === 'under_review' && can(c, 'statements.approve'), title: mine ? 'You prepared this run — segregation of duties will block approval' : '' },
    { key: 'finalize', label: 'Finalise', cls: 'gold', show: run.status === 'approved' && can(c, 'statements.finalize') },
    { key: 'return', label: 'Return to preparer', show: ['under_review', 'approved'].includes(run.status) && can(c, 'statements.approve') },
    { key: 'reject', label: run.status === 'draft' && mine ? 'Withdraw' : 'Reject', cls: 'danger', show: ['draft', 'under_review', 'approved'].includes(run.status) && (can(c, 'statements.approve') || (run.status === 'draft' && mine)) },
  ] : [];

  const selectedPeriod = periods.find((p) => p.id === periodId);
  const exportCsv = () => pack && downloadCsv(`FS_${pack.meta.entity.code}_${pack.meta.periodEnd}_${tab}.csv`,
    ['Line', 'Note', pack.meta.periodName, ...(pack.meta.comparative ? [pack.meta.comparative.label] : [])], rowsFor(pack, tab),
    headerRows(pack, status, run).map((r) => r.join(' ')).filter(Boolean));

  return (
    <>
      <div className="page-head no-print">
        <div><h1>{tab === 'notes' ? 'Notes to the financial statements' : 'Financial statements'}</h1>
          <div className="sub">IFRS-based statement pack from posted ledger lines, with comparatives, notes and cross-checks. Draft → review → approval → final.</div></div>
        <div className="row">
          <button className="btn" onClick={() => window.print()} disabled={!pack}><Icon n="download" size={15} />Print / PDF</button>
          <button className="btn" onClick={() => pack && downloadExcel(pack, status, run)} disabled={!pack}><Icon n="download" size={15} />Excel</button>
          <button className="btn" onClick={exportCsv} disabled={!pack}><Icon n="download" size={15} />CSV (this tab)</button>
        </div>
      </div>

      <div className="fs-layout">
        <div className="no-print">
          <div className="card" style={{ marginBottom: 14 }}><div className="card-b">
            <label className="field">Statement date (period end)
              <select className="input" value={periodId} onChange={(e) => { setPeriodId(e.target.value); setRunId(null); }}>
                {periods.map((p) => <option key={p.id} value={p.id}>{p.name} (FY{p.fy}) {p.status === 'locked' ? '🔒' : ''}</option>)}
              </select></label>
            <div className="row" style={{ marginTop: 10 }}>
              <button className={`btn sm ${!runId ? 'primary' : ''}`} onClick={() => setRunId(null)}>Live preview</button>
              {can(c, 'statements.prepare') && <button className="btn sm gold" onClick={generate} disabled={busy || !periodId}><Icon n="plus" size={13} />Generate run</button>}
            </div>
            {selectedPeriod && selectedPeriod.status !== 'locked' && <div className="sub" style={{ fontSize: 11.5, marginTop: 8 }}>This period is open: a run can be reviewed but not finalised until every period to {selectedPeriod.name} is locked.</div>}
          </div></div>
          <div className="card"><div className="card-h"><h3>Statement runs</h3><span className="sub">{runs?.length ?? 0}</span></div>
            <div className="card-b runs">
              {!runs?.length && <div className="sub">No runs yet. Generate one to freeze a pack for review.</div>}
              {runs?.map((r) => (
                <button key={r.id} className={`run ${runId === r.id ? 'on' : ''}`} onClick={() => { setRunId(r.id); setPeriodId(r.period_id); }}>
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}><b>#{r.run_no} · {r.period_end}</b><RunBadge s={r.status} /></div>
                  <small>{r.generated_by_name} · {new Date(r.generated_at).toLocaleDateString()} · {r.blocking_count ? `${r.blocking_count} blocking` : 'no blocking'}</small>
                </button>))}
            </div></div>
        </div>

        <div className="fs-main">
          {(prevErr || runErr) && <div className="alert block">{prevErr || runErr}</div>}
          {!pack && !prevErr && !runErr && <div className="empty">{prevLoading ? 'Computing statements…' : 'Select a period.'}</div>}
          {pack && (
            <>
              <div className="card no-print" style={{ marginBottom: 14 }}><div className="card-b">
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div className="row" style={{ alignItems: 'center', gap: 8 }}><RunBadge s={status} />
                      <b>{run ? `Run #${run.run_no}` : 'Live preview — not saved'}</b>
                      <span className="sub" style={{ margin: 0 }}>{pack.meta.entity.legalName} · {pack.meta.periodName} · {pack.meta.template.code} v{pack.meta.template.version}</span></div>
                    {run && <div className="sub mono" style={{ fontSize: 11 }}>SHA-256 {run.content_hash}</div>}
                    {pack.meta.comparative && <div className="sub" style={{ fontSize: 12 }}>Comparatives: {pack.meta.comparative.label} — {pack.meta.comparative.source === 'approved_snapshot' ? `final run #${pack.meta.comparative.runNo} (frozen)`
                      : pack.meta.comparative.source === 'snapshot_and_ledger' ? `position from final run #${pack.meta.comparative.runNo}; performance for the same months (to ${pack.meta.comparative.plPeriodEnd}) from the ledger`
                      : 'recomputed from the ledger (no final run yet)'}</div>}
                  </div>
                  <span className={`badge ${blocking ? 'b-rejected' : 'b-posted'}`} style={{ padding: '6px 11px' }}><Icon n={blocking ? 'alert' : 'check'} size={13} />{blocking ? `${blocking} blocking` : 'No blocking exceptions'}</span>
                </div>
                {run && (
                  <>
                    <div className="timeline" style={{ marginTop: 14 }}>
                      {STEPS.map((s, i) => <div key={s} className={`st ${STEPS.indexOf(run.status) >= i ? 'done' : ''}`}>{STATUS_LABEL[s]}<br />
                        <small>{s === 'draft' ? run.generated_by_name : s === 'under_review' ? run.submitted_by_name ?? '' : s === 'approved' ? run.approved_by_name ?? '' : run.finalized_by_name ?? ''}</small></div>)}
                    </div>
                    {['rejected', 'superseded'].includes(run.status) && <div className="alert warn">{run.status === 'rejected' ? `Rejected by ${run.rejected_by_name}: ${run.rejection_reason}` : 'Superseded by a later run for the same date.'}</div>}
                    <div className="row">
                      {actions.filter((a) => a.show).map((a) => (
                        <button key={a.key} className={`btn ${a.cls ?? ''}`} title={a.title} disabled={busy}
                          onClick={() => (a.key === 'return' || (a.key === 'reject')) ? setAskReason(a.key as any) : doAction(a.key)}>{a.label}</button>))}
                    </div>
                    {askReason && (
                      <form className="row" style={{ marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); doAction(askReason, reason.trim()); }}>
                        <label className="field" style={{ flex: 1 }}>Reason to {askReason}<input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></label>
                        <button className="btn primary" disabled={!reason.trim() || busy}>Confirm</button><button type="button" className="btn" onClick={() => setAskReason(null)}>Cancel</button>
                      </form>)}
                  </>
                )}
              </div></div>

              <div className="chips no-print" style={{ marginBottom: 12 }}>
                {TABS.map(([k, l]) => <button key={k} className={`chip ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}{k === 'checks' && blocking ? ` (${blocking})` : ''}</button>)}
              </div>

              <div className="card no-print"><div className="card-b statement">
                {status !== 'final' && <div className="watermark">DRAFT</div>}
                <div className="st-head"><b>{pack.meta.entity.legalName}</b><span>{TABS.find((t) => t[0] === tab)![1]} {tab === 'sfp' ? 'as at' : pack.meta.isYearEnd ? 'for the year ended' : 'for the period ended'} {pack.meta.periodEnd}</span></div>
                {tab === 'sfp' && <SFP pack={pack} />}
                {tab === 'pl' && <PL pack={pack} />}
                {tab === 'soce' && <SOCE pack={pack} />}
                {tab === 'cf' && <CF pack={pack} />}
                {tab === 'notes' && <Notes pack={pack} />}
                {tab === 'checks' && <Checks pack={pack} exceptions={runId ? exceptions : previewExceptions} />}
                <div className="disclaimer">{pack.meta.disclaimer} Source: {pack.meta.source}.</div>
              </div></div>

              {/* Print version: every statement, one after another. */}
              <div className="print-only">
                {(['sfp', 'pl', 'soce', 'cf', 'notes'] as Tab[]).map((t) => (
                  <section key={t} className="print-page">
                    {status !== 'final' && <div className="print-mark">DRAFT — NOT FINAL</div>}
                    <div className="st-head"><b>{pack.meta.entity.legalName}</b><span>{TABS.find((x) => x[0] === t)![1]} — {t === 'sfp' ? 'as at' : pack.meta.isYearEnd ? 'year ended' : 'period ended'} {pack.meta.periodEnd}</span>
                      <small>{run ? `Run #${run.run_no} · ${STATUS_LABEL[status]} · SHA-256 ${run.content_hash.slice(0, 16)}…` : 'Live preview — not saved'}</small></div>
                    {t === 'sfp' && <SFP pack={pack} />}{t === 'pl' && <PL pack={pack} />}{t === 'soce' && <SOCE pack={pack} />}{t === 'cf' && <CF pack={pack} />}{t === 'notes' && <Notes pack={pack} />}
                    <div className="disclaimer">{pack.meta.disclaimer}</div>
                  </section>))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
