/**
 * App shell: navy sidebar (desktop), top bar with search, entity and period context, work badge
 * and user menu; bottom bar plus slide-in menu on phones. Layout follows the reference design.
 */
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { DropdownMenu, Dialog, Tooltip } from 'radix-ui';
import { useQuery } from '@tanstack/react-query';
import { Bell, Building, CalendarDays, Check, ChevronDown, ChevronRight, Lock, LogOut, Menu, MoreHorizontal, Search, X } from 'lucide-react';
import { api } from '../api';
import { cn } from '../design/cn';
import { Kbd } from '../design/components';
import { Logo } from './Logo';
import { NAV, canOpen, type NavItem } from './nav';
import { useWorkspace, ym } from './workspace';
import { slug } from './session';
// The palette (and its search library) loads on first use, keeping the shell inside its size budget.
const CommandPalette = lazy(() => import('./CommandPalette').then((m) => ({ default: m.CommandPalette })));
import { plural } from '../lib/format';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function SideItem({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const w = useWorkspace();
  if (item.phase) {
    return (
      <Tooltip.Root delayDuration={400}>
        <Tooltip.Trigger asChild>
          <span aria-disabled="true" className="flex items-center gap-3 rounded-[9px] px-3 py-2 text-[13.5px] font-medium text-[#c7d2ea]/45">
            <item.icon className="size-[17px] shrink-0" aria-hidden /><span className="truncate">{item.label}</span>
            <span className="ml-auto rounded-[5px] bg-white/8 px-1.5 py-0.5 text-[9.5px] font-semibold text-[#9fb0d6]" aria-label={`Phase ${item.phase}`}>P{item.phase}</span>
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal><Tooltip.Content side="right" sideOffset={8} className="pop-in z-50 rounded-md bg-navy-950 px-2.5 py-1.5 text-[12px] text-white">Ships in Phase {item.phase} of the roadmap</Tooltip.Content></Tooltip.Portal>
      </Tooltip.Root>
    );
  }
  return (
    <NavLink to={w.to(item.path)} onClick={onNavigate}
      className={({ isActive }) => cn('pressable flex items-center gap-3 rounded-[9px] px-3 py-2 text-[13.5px] font-medium',
        isActive ? 'bg-action-600 text-white shadow-[0_6px_18px_rgb(37_99_235/0.35)]' : 'text-[#c7d2ea] [@media(hover:hover)]:hover:bg-white/6 [@media(hover:hover)]:hover:text-white')}>
      <item.icon className="size-[17px] shrink-0" aria-hidden />{item.label}
    </NavLink>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const w = useWorkspace();
  return (
    <>
      <Link to={w.to('dashboard')} onClick={onNavigate} className="flex items-center gap-2.5 px-2 pb-5 text-white">
        <Logo /><span><b className="block text-[18px] font-extrabold tracking-[-0.01em]">PEP Accounting</b>
          <small className="block text-[8.5px] font-semibold tracking-[0.16em] text-[#8ea0c8]">ACCOUNTING · COMPLIANCE · INSIGHT</small></span>
      </Link>
      <nav aria-label="Main" className="flex flex-col gap-0.5">
        {NAV.map((g) => {
          const items = g.items.filter((i) => i.phase || !i.perm || w.perms.has(i.perm));
          if (!items.length) return null;
          return (
            <div key={g.group}>
              <div className="px-3 pb-1.5 pt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6f82ae]">{g.group}</div>
              {items.map((i) => <SideItem key={i.id} item={i} onNavigate={onNavigate} />)}
            </div>
          );
        })}
      </nav>
    </>
  );
}

function EntitySwitcher({ className }: { className?: string }) {
  const w = useWorkspace();
  const navigate = useNavigate();
  const loc = useLocation();
  const section = loc.pathname.split('/')[2] ?? 'dashboard';
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className={cn("pressable flex h-10 max-w-[260px] min-w-0 items-center gap-2 rounded-[10px] border border-line bg-surface px-3 text-[13px] font-semibold hover-lift", className)} aria-label="Switch entity" title={w.entity.legal_name}>
        <Building className="size-4 shrink-0 text-muted" aria-hidden /><span className="truncate">{w.entity.legal_name}</span><ChevronDown className="size-4 shrink-0 text-muted" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content sideOffset={6} align="end" className="pop-in z-50 min-w-[260px] rounded-xl border border-line bg-surface p-1.5 shadow-[var(--shadow-overlay)]">
          <DropdownMenu.Label className="px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">Entities you can access</DropdownMenu.Label>
          {w.entities.map((e) => (
            <DropdownMenu.Item key={e.id} onSelect={() => navigate(`/${slug(e.code)}/${section}`)}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] outline-none data-[highlighted]:bg-action-50">
              <span className="flex-1"><b className="block font-semibold">{e.legal_name}</b><small className="text-muted">{e.functional_currency} · {e.roles.join(', ')}</small></span>
              {e.id === w.entity.id && <Check className="size-4 text-action-600" aria-label="Current" />}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function PeriodSwitcher() {
  const w = useWorkspace();
  if (!w.period) return null;
  const byFy = w.periods.reduce<Record<string, typeof w.periods>>((m, p) => ((m[p.fy] ??= []).push(p), m), {});
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="pressable flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] border border-line bg-surface px-3 text-[13px] font-semibold hover-lift" aria-label={`Period: ${w.period.name}`}>
        <CalendarDays className="size-4 text-muted" aria-hidden />{w.period.name}
        {w.period.status === 'locked' && <Lock className="size-3.5 text-muted" aria-label="Locked" />}<ChevronDown className="size-4 text-muted" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content sideOffset={6} align="end" className="pop-in z-50 max-h-[60vh] w-[220px] overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-[var(--shadow-overlay)]">
          {Object.entries(byFy).map(([fy, ps]) => (
            <DropdownMenu.Group key={fy}>
              <DropdownMenu.Label className="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">FY{fy}</DropdownMenu.Label>
              {ps.map((p) => (
                <DropdownMenu.Item key={p.id} onSelect={() => w.setPeriod(ym(p.start_date))}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] outline-none data-[highlighted]:bg-action-50">
                  <span className="flex-1">{p.name}</span>
                  {p.status === 'locked' ? <span className="inline-flex items-center gap-1 text-[11px] text-muted"><Lock className="size-3" aria-hidden />Locked</span> : null}
                  {p.id === w.period!.id && <Check className="size-4 text-action-600" aria-label="Selected" />}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Group>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function useDashboardData() {
  const w = useWorkspace();
  return useQuery<any>({
    queryKey: ['dashboard', w.entity.id, w.period?.id],
    enabled: w.perms.has('reports.read'),
    queryFn: () => api(`/entities/${w.entity.id}/dashboard${w.period ? `?periodId=${w.period.id}` : ''}`),
    staleTime: 30_000,
  });
}

function WorkBell() {
  const w = useWorkspace();
  const { data } = useDashboardData();
  const tasks: any[] = data?.tasks ?? [];
  const total = tasks.reduce((s, t) => s + t.count, 0);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="pressable relative grid size-10 place-items-center rounded-[10px] text-ink-2 hover-row" aria-label={total ? `${plural(total, 'item', 'items')} need attention` : 'Nothing needs attention'}>
        <Bell className="size-[19px]" aria-hidden />
        {total > 0 && <span className="num absolute right-1 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-loss-600 px-1 text-[10px] font-bold text-white">{total > 9 ? '9+' : total}</span>}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content sideOffset={6} align="end" className="pop-in z-50 w-[320px] rounded-xl border border-line bg-surface p-1.5 shadow-[var(--shadow-overlay)]">
          <DropdownMenu.Label className="px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">Needs your attention</DropdownMenu.Label>
          {tasks.length === 0 && <p className="px-2.5 pb-3 pt-1 text-[13px] text-muted">Nothing is waiting for you in {w.entity.legal_name}.</p>}
          {tasks.map((t) => (
            <DropdownMenu.Item key={t.key} asChild className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] outline-none data-[highlighted]:bg-action-50">
              <Link to={w.to(t.to.split('?')[0], Object.fromEntries(new URLSearchParams(t.to.split('?')[1] ?? '')))}>
                <span className="num min-w-6 font-bold">{t.count}</span><span className="flex-1">{t.label}</span><ChevronRight className="size-4 text-muted" aria-hidden />
              </Link>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function UserMenu({ onSignOut }: { onSignOut: () => void }) {
  const w = useWorkspace();
  const initials = w.user.fullName.replace(/\(.*\)/, '').trim().split(/\s+/).map((s) => s[0]).slice(0, 2).join('');
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="pressable flex items-center gap-2.5 rounded-[10px] py-1 pl-1 pr-2 hover-row" aria-label="Account menu">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-navy-800 text-[13px] font-bold text-gold-500">{initials}</span>
        <span className="hidden text-left xl:block"><b className="block max-w-[160px] truncate text-[13px] font-semibold">{w.user.fullName}</b>
          <small className="block text-[11px] capitalize text-muted">{w.entity.roles.join(', ').replace(/_/g, ' ')}</small></span>
        <ChevronDown className="hidden size-4 text-muted xl:block" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content sideOffset={6} align="end" className="pop-in z-50 min-w-[220px] rounded-xl border border-line bg-surface p-1.5 shadow-[var(--shadow-overlay)]">
          <div className="px-2.5 py-2"><b className="block text-[13px]">{w.user.fullName}</b><small className="text-muted">{w.user.email}</small></div>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item onSelect={onSignOut} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] outline-none data-[highlighted]:bg-action-50">
            <LogOut className="size-4 text-muted" aria-hidden />Sign out or switch user
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

const BOTTOM: { label: string; path: string; params?: Record<string, string>; perm: string }[] = [
  { label: 'Dashboard', path: 'dashboard', perm: 'reports.read' },
  { label: 'Approvals', path: 'journals', params: { status: 'submitted' }, perm: 'journal.read' },
  { label: 'Statements', path: 'statements', perm: 'reports.read' },
];

export function Shell({ children, onSignOut }: { children: ReactNode; onSignOut: () => void }) {
  const w = useWorkspace();
  const loc = useLocation();
  const [cmd, setCmd] = useState(false);
  const [menu, setMenu] = useState(false);
  const [cmdLoaded, setCmdLoaded] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdLoaded(true); setCmd((o) => !o); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const section = loc.pathname.split('/')[2];
  const icons = Object.fromEntries(NAV.flatMap((g) => g.items).map((i) => [i.path, i.icon]));

  return (
    <Tooltip.Provider>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">Skip to content</a>
      <div className="min-h-dvh lg:grid lg:grid-cols-[256px_minmax(0,1fr)]">
        <aside className="no-print sticky top-0 hidden h-dvh overflow-y-auto bg-gradient-to-b from-navy-900 to-navy-950 px-3.5 py-5 lg:block">
          <SidebarContent />
        </aside>

        <div className="flex min-w-0 flex-col">
          <header className="no-print sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-line bg-surface/95 px-3 backdrop-blur sm:gap-3 sm:px-6">
            <button className="pressable grid size-10 place-items-center rounded-[10px] text-ink-2 lg:hidden" onClick={() => setMenu(true)} aria-label="Open menu"><Menu className="size-5" /></button>
            <button onClick={() => { setCmdLoaded(true); setCmd(true); }} className="pressable flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-[10px] border border-line bg-canvas px-3 text-left text-[13px] text-muted hover-lift sm:max-w-[440px] sm:flex-[1_1_440px]" aria-label="Search and commands">
              <Search className="size-4 shrink-0" aria-hidden /><span className="truncate">Search accounts, journals, screens…</span>
              <span className="ml-auto hidden sm:block"><Kbd>{isMac ? '⌘K' : 'Ctrl K'}</Kbd></span>
            </button>
            <div className="hidden flex-1 sm:block" />
            <div className="hidden md:block"><EntitySwitcher /></div>
            <div className="hidden sm:block"><PeriodSwitcher /></div>
            <WorkBell />
            <UserMenu onSignOut={onSignOut} />
          </header>

          {/* Phone: context row under the top bar */}
          <div className="no-print flex gap-2 border-b border-line bg-surface px-3 py-2 sm:hidden"><EntitySwitcher className="max-w-none flex-1" /><PeriodSwitcher /></div>
          <div className="no-print hidden border-b border-line bg-surface px-6 py-2 sm:block md:hidden"><EntitySwitcher /></div>

          {w.period?.status === 'locked' && (
            <div role="status" className="no-print flex items-center gap-2 border-b border-line bg-[#eef1f6] px-6 py-2 text-[12.5px] text-ink-2">
              <Lock className="size-3.5" aria-hidden />{w.period.name} is locked. Figures are final for this period; posting into it is refused.
            </div>
          )}

          <main id="main" className="mx-auto w-full max-w-[1480px] flex-1 px-4 pb-28 pt-6 sm:px-6 lg:pb-12">{children}</main>
        </div>
      </div>

      {/* Phone bottom bar */}
      <nav aria-label="Quick" className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
        {BOTTOM.filter((b) => w.perms.has(b.perm)).map((b) => {
          const Icon = icons[b.path];
          const active = section === b.path && (!b.params || new URLSearchParams(loc.search).get('status') === b.params.status);
          return (
            <Link key={b.label} to={w.to(b.path, b.params)} className={cn('pressable flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold', active ? 'text-action-600' : 'text-muted')}>
              {Icon && <Icon className="size-5" aria-hidden />}{b.label}
            </Link>
          );
        })}
        <button onClick={() => setMenu(true)} className="pressable flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold text-muted"><MoreHorizontal className="size-5" aria-hidden />More</button>
      </nav>

      {/* Phone / tablet slide-in menu */}
      <Dialog.Root open={menu} onOpenChange={setMenu}>
        <Dialog.Portal>
          <Dialog.Overlay className="scrim fixed inset-0 z-40 bg-navy-950/45 lg:hidden" />
          <Dialog.Content aria-describedby={undefined} className="sheet fixed inset-y-0 left-0 z-50 w-[84vw] max-w-[300px] overflow-y-auto bg-gradient-to-b from-navy-900 to-navy-950 px-3.5 pb-[calc(20px+env(safe-area-inset-bottom))] pt-[calc(20px+env(safe-area-inset-top))] lg:hidden">
            <Dialog.Title className="sr-only">Menu</Dialog.Title>
            <Dialog.Close className="pressable absolute right-3 top-4 grid size-9 place-items-center rounded-lg text-[#c7d2ea]" aria-label="Close menu"><X className="size-5" /></Dialog.Close>
            <SidebarContent onNavigate={() => setMenu(false)} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {cmdLoaded && <Suspense fallback={null}><CommandPalette open={cmd} onOpenChange={setCmd} onSignOut={onSignOut} /></Suspense>}
    </Tooltip.Provider>
  );
}

export { canOpen };
