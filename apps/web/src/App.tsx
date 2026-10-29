/**
 * Routes (blueprint § Screen inventory). Entity and period live in the URL so every screen can be
 * bookmarked and shared: /trulander/trial-balance?period=2026-10.
 */
import { lazy, Suspense, useEffect } from 'react';
import { createBrowserRouter, createHashRouter, Navigate, Outlet, RouterProvider, useNavigate } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { ApiError, hasToken } from './api';
import { Alert, Button, Skeleton } from './design/components';
import { Shell } from './shell/Shell';
import SignIn from './shell/SignIn';
import { LegacyPage } from './shell/Legacy';
import { useMe, useSignOut, slug } from './shell/session';
import { WorkspaceProvider, useWorkspace, useWorkspaceState } from './shell/workspace';
import { NAV, canOpen, itemByPath } from './shell/nav';
import { NoAccess, NotFound, Offline } from './modules/system/SystemPages';

// Each module loads only when opened (blueprint § Performance budgets).
const Dashboard = lazy(() => import('./modules/dashboard/Dashboard'));
const Journals = lazy(() => import('./pages/Journals'));
const Ledger = lazy(() => import('./pages/Ledger'));
const TrialBalance = lazy(() => import('./pages/TrialBalance'));
const Accounts = lazy(() => import('./pages/Accounts'));
const Periods = lazy(() => import('./pages/Periods'));
const AuditTrail = lazy(() => import('./pages/AuditTrail'));
const Statements = lazy(() => import('./pages/Statements'));
const UsersAccess = lazy(() => import('./modules/admin/UsersAccess'));
const ApprovalPolicies = lazy(() => import('./modules/admin/ApprovalPolicies'));
const SystemHealth = lazy(() => import('./modules/admin/SystemHealth'));
const YearEndClose = lazy(() => import('./modules/close/YearEndClose'));
const RecurringJournals = lazy(() => import('./modules/recurring/RecurringJournals'));
const Currencies = lazy(() => import('./modules/settings/Currencies'));
const SetPassword = lazy(() => import('./shell/SetPassword'));

function ScreenLoading() {
  return <div className="flex flex-col gap-3" aria-busy="true"><Skeleton className="h-6 w-56" /><Skeleton className="h-4 w-80" /><Skeleton className="mt-4 h-40" /></div>;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, refetchOnWindowFocus: true,
      retry: (n, e) => !(e instanceof ApiError && [401, 403, 404].includes(e.status)) && n < 2,
    },
  },
});

function RequireSession() {
  if (!hasToken()) return <Navigate to="/sign-in" replace />;
  return <Outlet />;
}

/** "/" -> the first entity's first screen the user may open. */
function Home() {
  const { data: me, error } = useMe();
  if (error) return <Navigate to={error instanceof ApiError && error.status === 0 ? '/offline' : '/sign-in'} replace />;
  if (!me) return <FullPageLoading />;
  let remembered: string | null = null;
  try { remembered = sessionStorage.getItem('pep.entity'); } catch { /* storage unavailable */ }
  const ent = me.entities.find((e) => e.code === remembered) ?? me.entities[0];
  if (!ent) return <NoAccess />;
  return <Navigate to={`/${slug(ent.code)}/dashboard`} replace />;
}

function FullPageLoading() {
  return <div className="grid min-h-dvh place-items-center"><div className="w-60"><Skeleton className="mb-2 h-3 w-24" /><Skeleton className="h-3" /></div></div>;
}

function WorkspaceLayout() {
  const { data: me, error } = useMe();
  const state = useWorkspaceState(me);
  const signOut = useSignOut();
  const navigate = useNavigate();
  const doSignOut = () => { signOut(); navigate('/sign-in', { replace: true }); };
  useEffect(() => {
    if (state.status === 'ready') try { sessionStorage.setItem('pep.entity', state.value.entity.code); } catch { /* storage unavailable */ }
  }, [state]);
  if (error) return <Navigate to={error instanceof ApiError && error.status === 0 ? '/offline' : '/sign-in'} replace />;
  if (state.status === 'loading') return <FullPageLoading />;
  if (state.status === 'not-found') return <NotFound />;
  if (state.status === 'error') return (
    <div className="mx-auto mt-24 max-w-[520px] px-4"><Alert tone="loss" icon={<AlertTriangle />}>{state.message}</Alert>
      <Button className="mt-4" onClick={doSignOut}>Back to sign-in</Button></div>
  );
  return (
    <WorkspaceProvider value={state.value}>
      <Shell onSignOut={doSignOut}><Suspense fallback={<ScreenLoading />}><Outlet /></Suspense></Shell>
    </WorkspaceProvider>
  );
}

/** Permission gate per screen: hidden in navigation, and a direct link shows No access. */
function Guard({ path, children }: { path: string; children: React.ReactNode }) {
  const w = useWorkspace();
  const item = itemByPath(path);
  if (item && !canOpen(item, w.perms)) {
    const first = NAV.flatMap((g) => g.items).find((i) => canOpen(i, w.perms));
    if (path === 'dashboard' && first) return <Navigate to={w.to(first.path)} replace />;
    return <NoAccessInline />;
  }
  return <>{children}</>;
}
function NoAccessInline() {
  return <Alert tone="warn" icon={<AlertTriangle />}>Your role in this entity does not include this screen. Ask your controller or administrator if you need it.</Alert>;
}

const g = (path: string, el: React.ReactNode) => ({ path, element: <Guard path={path}>{el}</Guard> });

const routes = [
  { path: '/sign-in', element: <SignIn /> },
  { path: '/set-password', element: <Suspense fallback={null}><SetPassword /></Suspense> },
  { path: '/offline', element: <Offline /> },
  { path: '/403', element: <NoAccess /> },
  { path: '/404', element: <NotFound /> },
  {
    element: <RequireSession />,
    children: [
      { path: '/', element: <Home /> },
      {
        path: '/:entity', element: <WorkspaceLayout />,
        children: [
          { index: true, element: <Navigate to="dashboard" replace /> },
          g('dashboard', <Dashboard />),
          g('journals', <LegacyPage page={Journals} />),
          g('ledger', <LegacyPage page={Ledger} />),
          g('trial-balance', <LegacyPage page={TrialBalance} />),
          g('accounts', <LegacyPage page={Accounts} />),
          g('periods', <LegacyPage page={Periods} />),
          g('statements', <LegacyPage page={Statements} />),
          g('notes', <LegacyPage page={Statements} extra={{ tab: 'notes' }} />),
          g('audit', <LegacyPage page={AuditTrail} />),
          g('users', <UsersAccess />),
          g('approval-policies', <ApprovalPolicies />),
          g('system-health', <SystemHealth />),
          g('year-end-close', <YearEndClose />),
          g('recurring-journals', <RecurringJournals />),
          g('currencies', <Currencies />),
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFound /> },
];

// GitHub Pages cannot rewrite unknown paths to index.html, so staging uses hash URLs (#/trulander/dashboard);
// hosts with rewrites (SiteGround .htaccess) use clean paths.
const router = ((import.meta as any).env?.VITE_ROUTER === 'hash' ? createHashRouter : createBrowserRouter)(routes);

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster position="bottom-right" richColors closeButton toastOptions={{ className: 'font-sans' }} />
    </QueryClientProvider>
  );
}
