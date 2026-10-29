import {
  LayoutDashboard, NotebookPen, BookOpenText, Scale, ListTree, CalendarCheck2, FileSpreadsheet, FileText,
  BarChart3, HandCoins, Receipt, Landmark, Building2, Boxes, Percent, ShieldCheck, Sparkles, Settings, type LucideIcon,
} from 'lucide-react';

/** One navigation model drives the sidebar, the phone menu, the command palette and breadcrumbs. */
export interface NavItem {
  id: string; label: string; icon: LucideIcon; path: string; perm?: string;
  /** Phase in which the screen ships; absent = available now. */
  phase?: number; keywords?: string;
}
export interface NavGroup { group: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  { group: 'Overview', items: [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: 'dashboard', perm: 'reports.read', keywords: 'home kpi overview' },
  ] },
  { group: 'Accounting', items: [
    { id: 'journals', label: 'Journal Entries', icon: NotebookPen, path: 'journals', perm: 'journal.read', keywords: 'jv post approve' },
    { id: 'ledger', label: 'General Ledger', icon: BookOpenText, path: 'ledger', perm: 'ledger.read', keywords: 'account history' },
    { id: 'tb', label: 'Trial Balance', icon: Scale, path: 'trial-balance', perm: 'reports.read', keywords: 'tb balances' },
    { id: 'accounts', label: 'Chart of Accounts', icon: ListTree, path: 'accounts', perm: 'coa.read', keywords: 'coa mapping' },
    { id: 'periods', label: 'Periods & Close', icon: CalendarCheck2, path: 'periods', perm: 'entity.read', keywords: 'lock close month' },
  ] },
  { group: 'Reporting', items: [
    { id: 'fs', label: 'Financial Statements', icon: FileSpreadsheet, path: 'statements', perm: 'reports.read', keywords: 'ifrs sfp profit loss cash flow' },
    { id: 'notes', label: 'Notes to Accounts', icon: FileText, path: 'notes', perm: 'reports.read', keywords: 'disclosures' },
    { id: 'reports', label: 'Reports & Analytics', icon: BarChart3, path: 'reports', perm: 'reports.read', phase: 1 },
  ] },
  { group: 'Operations', items: [
    { id: 'ar', label: 'Receivables', icon: HandCoins, path: 'invoices', phase: 3 },
    { id: 'ap', label: 'Payables', icon: Receipt, path: 'bills', phase: 3 },
    { id: 'bank', label: 'Banking', icon: Landmark, path: 'banking', phase: 4 },
    { id: 'fa', label: 'Fixed Assets', icon: Building2, path: 'assets', phase: 4 },
    { id: 'inv', label: 'Inventory', icon: Boxes, path: 'inventory', phase: 4 },
  ] },
  { group: 'Compliance', items: [
    { id: 'tax', label: 'Tax & GRA', icon: Percent, path: 'tax', phase: 5 },
    { id: 'audit', label: 'Audit Room', icon: ShieldCheck, path: 'audit', perm: 'audit.read', keywords: 'audit trail hash chain' },
    { id: 'ai', label: 'AI Controller', icon: Sparkles, path: 'ai', phase: 5 },
  ] },
  { group: 'Administration', items: [
    { id: 'settings', label: 'Settings', icon: Settings, path: 'settings', phase: 2 },
  ] },
];

export const ALL_ITEMS = NAV.flatMap((g) => g.items);
export const itemByPath = (path: string) => ALL_ITEMS.find((i) => i.path === path);
export const canOpen = (i: NavItem, perms: Set<string>) => !i.phase && (!i.perm || perms.has(i.perm));
