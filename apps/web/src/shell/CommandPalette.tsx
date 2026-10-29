/**
 * Command palette (Ctrl+K / Cmd+K). Opened hundreds of times a day, so it has no open/close
 * animation (motion rule: never animate keyboard-initiated actions).
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Command } from 'cmdk';
import { Dialog } from 'radix-ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowRightLeft, BookOpenText, CornerDownLeft, LogOut, NotebookPen, Plus, Search } from 'lucide-react';
import { api } from '../api';
import { NAV, canOpen } from './nav';
import { useWorkspace } from './workspace';
import { slug } from './session';

const itemCls = 'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] text-ink data-[selected=true]:bg-action-50 data-[selected=true]:text-action-600 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted data-[selected=true]:[&_svg]:text-action-600';
const groupCls = '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.12em] [&_[cmdk-group-heading]]:text-muted';

export function CommandPalette({ open, onOpenChange, onSignOut }: { open: boolean; onOpenChange: (o: boolean) => void; onSignOut: () => void }) {
  const w = useWorkspace();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const accounts = useQuery<any[]>({
    queryKey: ['accounts', w.entity.id], enabled: open && w.perms.has('coa.read'),
    queryFn: () => api(`/entities/${w.entity.id}/accounts`), staleTime: 60_000,
  });
  const journals = useQuery<any[]>({
    queryKey: ['journals-palette', w.entity.id], enabled: open && w.perms.has('journal.read'),
    queryFn: () => api(`/entities/${w.entity.id}/journals?limit=200`), staleTime: 30_000,
  });
  const go = (href: string) => { onOpenChange(false); setQ(''); navigate(href); };
  const screens = useMemo(() => NAV.flatMap((g) => g.items.filter((i) => canOpen(i, w.perms)).map((i) => ({ ...i, group: g.group }))), [w.perms]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-navy-950/40" />
        <Dialog.Content aria-describedby={undefined}
          className="fixed inset-x-0 top-0 z-50 mx-auto h-dvh w-full overflow-hidden bg-surface shadow-[var(--shadow-overlay)] md:top-[12vh] md:h-auto md:max-w-[620px] md:rounded-[var(--radius-dialog)]">
          <Dialog.Title className="sr-only">Search and commands</Dialog.Title>
          <Command label="Search and commands" className="flex h-full flex-col">
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="size-4 text-muted" aria-hidden />
              <Command.Input value={q} onValueChange={setQ} placeholder="Search screens, accounts, journals or actions"
                className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted" />
              <button className="pressable rounded-md px-2 py-1 text-[12px] font-semibold text-muted md:hidden" onClick={() => onOpenChange(false)}>Close</button>
            </div>
            <Command.List className="max-h-none flex-1 overflow-y-auto p-2 md:max-h-[56vh]">
              <Command.Empty className="px-3 py-8 text-center text-[13px] text-muted">Nothing matches “{q}”.</Command.Empty>
              <Command.Group heading="Go to" className={groupCls}>
                {screens.map((s) => (
                  <Command.Item key={s.id} value={`${s.label} ${s.group} ${s.keywords ?? ''}`} onSelect={() => go(w.to(s.path))} className={itemCls}>
                    <s.icon aria-hidden />{s.label}<span className="ml-auto text-[11.5px] text-muted">{s.group}</span>
                  </Command.Item>
                ))}
              </Command.Group>
              {w.perms.has('journal.prepare') && (
                <Command.Group heading="Actions" className={groupCls}>
                  <Command.Item value="new journal entry create" onSelect={() => go(w.to('journals', { new: '1' }))} className={itemCls}><Plus aria-hidden />New journal entry</Command.Item>
                </Command.Group>
              )}
              {w.entities.length > 1 && (
                <Command.Group heading="Switch entity" className={groupCls}>
                  {w.entities.filter((e) => e.id !== w.entity.id).map((e) => (
                    <Command.Item key={e.id} value={`switch entity ${e.legal_name} ${e.code}`} onSelect={() => go(`/${slug(e.code)}/dashboard`)} className={itemCls}>
                      <ArrowRightLeft aria-hidden />{e.legal_name}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {q.length >= 2 && (accounts.data?.length ?? 0) > 0 && (
                <Command.Group heading="Accounts" className={groupCls}>
                  {accounts.data!.filter((a) => a.is_postable).slice(0, 400).map((a) => (
                    <Command.Item key={a.id} value={`${a.code} ${a.name} account`} onSelect={() => go(w.to('ledger', { accountId: a.id }))} className={itemCls}>
                      <BookOpenText aria-hidden /><span className="num w-12 text-muted">{a.code}</span>{a.name}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {q.length >= 2 && (journals.data?.length ?? 0) > 0 && (
                <Command.Group heading="Journals" className={groupCls}>
                  {journals.data!.map((j) => (
                    <Command.Item key={j.id} value={`${j.journal_no ?? `draft ${j.draft_no}`} ${j.description} ${j.reference ?? ''} journal`} onSelect={() => go(w.to('journals', { journalId: j.id }))} className={itemCls}>
                      <NotebookPen aria-hidden /><span className="num text-muted">{j.journal_no ?? `Draft ${j.draft_no}`}</span><span className="truncate">{j.description}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              <Command.Group heading="Session" className={groupCls}>
                <Command.Item value="sign out switch user" onSelect={() => { onOpenChange(false); onSignOut(); }} className={itemCls}><LogOut aria-hidden />Sign out</Command.Item>
              </Command.Group>
            </Command.List>
            <div className="hidden items-center gap-4 border-t border-line px-4 py-2.5 text-[11.5px] text-muted md:flex">
              <span className="inline-flex items-center gap-1.5"><CornerDownLeft className="size-3.5" aria-hidden />open</span>
              <span>↑ ↓ move</span><span>Esc close</span>
            </div>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
