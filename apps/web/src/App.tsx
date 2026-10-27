import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, hasToken, setToken } from './api';
import { AppCtx, Icon, Logo, type Ctx, type Entity } from './ui';
import Dashboard from './pages/Dashboard';
import Journals from './pages/Journals';
import Ledger from './pages/Ledger';
import TrialBalance from './pages/TrialBalance';
import Accounts from './pages/Accounts';
import Periods from './pages/Periods';
import AuditTrail from './pages/AuditTrail';

const NAV: { group: string; items: { id: string; label: string; icon: string; perm?: string; soon?: string }[] }[] = [
  { group: 'Overview', items: [{ id: 'dashboard', label: 'Dashboard', icon: 'dash', perm: 'reports.read' }] },
  { group: 'Accounting core', items: [
    { id: 'journals', label: 'Journal Entries', icon: 'journal', perm: 'journal.read' },
    { id: 'ledger', label: 'General Ledger', icon: 'ledger', perm: 'ledger.read' },
    { id: 'tb', label: 'Trial Balance', icon: 'tb', perm: 'reports.read' },
    { id: 'accounts', label: 'Chart of Accounts', icon: 'coa', perm: 'coa.read' },
    { id: 'periods', label: 'Periods & Close', icon: 'period', perm: 'entity.read' },
  ] },
  { group: 'Reporting', items: [
    { id: 'fs', label: 'Financial Statements', icon: 'fs', soon: 'R2' },
    { id: 'notes', label: 'Notes to Accounts', icon: 'notes', soon: 'R2' },
  ] },
  { group: 'Operations', items: [
    { id: 'ar', label: 'Receivables', icon: 'ar', soon: 'R3' }, { id: 'ap', label: 'Payables', icon: 'ap', soon: 'R3' },
    { id: 'bank', label: 'Banking', icon: 'bank', soon: 'R3' }, { id: 'fa', label: 'Fixed Assets', icon: 'fa', soon: 'R3' },
    { id: 'inv', label: 'Inventory', icon: 'inv', soon: 'R3' },
  ] },
  { group: 'Compliance & assurance', items: [
    { id: 'tax', label: 'Tax & GRA', icon: 'tax', soon: 'R4' },
    { id: 'audit', label: 'Audit Trail', icon: 'audit', perm: 'audit.read' },
    { id: 'ai', label: 'AI Controller', icon: 'spark', soon: 'R5' },
  ] },
];

function Login({ onDone }: { onDone: () => void }) {
  const [users, setUsers] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [code, setCode] = useState(() => { try { return sessionStorage.getItem('pep.access') ?? ''; } catch { return ''; } });
  const loadUsers = (c: string) => {
    fetch('/api/dev/users', { headers: c ? { 'x-access-code': c } : {} }).then(async (r) => {
      const j = await r.json();
      if (r.status === 401 && j?.error?.code === 'ACCESS_CODE_REQUIRED') { setNeedCode(true); setUsers([]); if (c) setErr('That access code is not correct.'); return; }
      if (!r.ok) { setErr(j?.error?.message ?? 'Could not load users'); return; }
      setErr(''); setUsers(j);
      try { if (c) sessionStorage.setItem('pep.access', c); } catch { /* storage unavailable */ }
    }).catch((e) => setErr(e.message));
  };
  useEffect(() => { loadUsers(code); }, []);
  const login = async (email: string) => {
    try { const r = await api('/auth/dev-login', { method: 'POST', body: { email, accessCode: code || undefined } }); setToken(r.token); onDone(); }
    catch (e: any) { setErr(e.message); }
  };
  return (
    <div className="login">
      <div className="hero">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><Logo /><b style={{ fontSize: 22 }}>PEP ERP</b></div>
        <h2>Your Numbers.<br />Your Compliance.<br /><em>Your Control.</em></h2>
        <p>Double-entry accounting with database-enforced controls: balanced posting, immutable ledger, segregation of duties and a hash-chained audit trail — the foundation for IFRS reporting and Ghana tax preparation.</p>
      </div>
      <div className="panel">
        <div className="box">
          <h3 style={{ margin: 0, fontSize: 18 }}>Sign in — {needCode ? 'staging' : 'development'}</h3>
          <p className="sub">Choose a demo user. Each role sees different permissions, so you can test segregation of duties end to end.</p>
          {needCode && (
            <form className="row" style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); loadUsers(code.trim()); }}>
              <label className="field" style={{ flex: 1 }}>Staging access code
                <input id="access-code" className="input" type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} /></label>
              <button className="btn primary" type="submit" disabled={!code.trim()}>Unlock</button>
            </form>
          )}
          {err && <div className="alert block" style={{ marginTop: 12 }}>{err}</div>}
          <div className="user-pick">
            {users.map((u) => (
              <button key={u.email} onClick={() => login(u.email)}>
                <span className="avatar">{u.full_name.split(' ').map((s: string) => s[0]).slice(0, 2).join('')}</span>
                <span><b style={{ fontSize: 13.5 }}>{u.full_name}</b><small>{u.email} · {u.roles}</small></span>
              </button>
            ))}
          </div>
          <p className="sub" style={{ fontSize: 11.5, marginTop: 16 }}>Demo data only. Real accounts with MFA replace this sign-in before any live books are loaded.</p>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(hasToken());
  const [me, setMe] = useState<{ user: Ctx['user']; entities: Entity[] } | null>(null);
  const [entityId, setEntityId] = useState<string | null>(sessionStorage.getItem('pep.entity'));
  const [entity, setEntity] = useState<any>(null);
  const [page, setPage] = useState('dashboard');
  const [params, setParams] = useState<Record<string, string>>({});
  const [toastMsg, setToastMsg] = useState<{ m: string; err?: boolean } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!authed) return;
    api('/me').then((m) => {
      setMe(m);
      const ok = m.entities.find((e: Entity) => e.id === entityId) ?? m.entities[0];
      setEntityId(ok?.id ?? null);
    }).catch(() => { setToken(null); setAuthed(false); });
  }, [authed]);

  useEffect(() => {
    if (!entityId) return;
    sessionStorage.setItem('pep.entity', entityId);
    api(`/entities/${entityId}`).then((e) => {
      setEntity(e);
      const perms = new Set<string>(e.permissions);
      if (!perms.has('reports.read') && page === 'dashboard') setPage(perms.has('journal.read') ? 'journals' : 'periods');
    });
  }, [entityId]);

  const toast = useCallback((m: string, err?: boolean) => { setToastMsg({ m, err }); setTimeout(() => setToastMsg(null), err ? 6000 : 3200); }, []);
  const go = useCallback((p: string, pr: Record<string, string> = {}) => { setPage(p); setParams(pr); window.scrollTo(0, 0); }, []);

  const ctx: Ctx | null = useMemo(() => me && entity ? {
    user: me.user, entity, perms: new Set(entity.permissions), go, params, toast, refreshKey, bump: () => setRefreshKey((k) => k + 1),
  } : null, [me, entity, params, refreshKey]);

  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  if (!ctx) return <div className="empty">Loading…</div>;

  const initials = ctx.user.fullName.split(' ').map((s) => s[0]).slice(0, 2).join('');
  const Page = { dashboard: Dashboard, journals: Journals, ledger: Ledger, tb: TrialBalance, accounts: Accounts, periods: Periods, audit: AuditTrail }[page] ?? Dashboard;

  return (
    <AppCtx.Provider value={ctx}>
      <div className="shell">
        <aside className="side">
          <div className="brand"><Logo /><div><b>PEP ERP</b><small>ACCOUNTING · COMPLIANCE · INSIGHT</small></div></div>
          <nav className="nav">
            {NAV.map((g) => (
              <div key={g.group}>
                <div className="nav-group">{g.group}</div>
                {g.items.filter((i) => i.soon || !i.perm || ctx.perms.has(i.perm)).map((i) => (
                  <a key={i.id} className={`${page === i.id ? 'active' : ''} ${i.soon ? 'soon' : ''}`}
                     title={i.soon ? `Planned for Release ${i.soon.slice(1)}` : ''}
                     onClick={() => !i.soon && go(i.id)}>
                    <Icon n={i.icon} />{i.label}{i.soon && <span className="tag">{i.soon}</span>}
                  </a>
                ))}
              </div>
            ))}
          </nav>
        </aside>
        <main className="main">
          <div className="top">
            <div className="search"><Icon n="search" size={15} />Search accounts, journals… <span className="mono" style={{ marginLeft: 'auto', fontSize: 11 }}>R2</span></div>
            <div className="spacer" />
            <select className="pill-select" value={entityId ?? ''} onChange={(e) => { setEntityId(e.target.value); go('dashboard'); }}>
              {me!.entities.map((e) => <option key={e.id} value={e.id}>{e.legal_name}</option>)}
            </select>
            <span className="badge b-open">{ctx.entity.functional_currency} · {ctx.entity.reporting_framework}</span>
            <div className="who">
              <span className="avatar">{initials}</span>
              <div><b>{ctx.user.fullName}</b><small>{ctx.entity.roles.join(', ')}</small></div>
              <button className="btn sm" onClick={() => { setToken(null); setAuthed(false); setMe(null); setEntity(null); }}>Switch user</button>
            </div>
          </div>
          <div className="page"><Page key={`${page}-${entityId}`} /></div>
        </main>
      </div>
      {toastMsg && <div className={`toast ${toastMsg.err ? 'err' : ''}`}>{toastMsg.m}</div>}
    </AppCtx.Provider>
  );
}
