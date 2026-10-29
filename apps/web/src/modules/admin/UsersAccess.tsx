/**
 * S04 Users & access (Blueprint M0). Who can open this entity, with which roles, whether they can sign in,
 * and invitations. Inviting needs users.manage; nobody can invite themselves or change their own roles
 * (enforced by the API and a database check, shown here as guidance only).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, Mail, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { api } from '../../api';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Skeleton } from '../../design/components';
import { dateLabel, plural } from '../../lib/format';
import { useWorkspace } from '../../shell/workspace';

type UserRow = { id: string; email: string; full_name: string; is_active: boolean; can_sign_in: boolean; roles: string[];
  invitation: { status: 'sent' | 'accepted' | 'revoked'; sent_at: string; accepted_at: string | null } | null };
type Role = { code: string; name: string; description: string | null; permissions: string[] };

const field = 'h-10 w-full rounded-[var(--radius-control)] border border-line px-3 text-[13.5px] outline-none focus:border-action-600 focus:ring-3 focus:ring-action-50';

function InviteForm({ roles, canSend, onDone }: { roles: Role[]; canSend: boolean; onDone: (msg: string) => void }) {
  const w = useWorkspace();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const m = useMutation({
    mutationFn: () => api(`/entities/${w.entity.id}/users/invite`, { method: 'POST', body: { email, fullName: name, roles: picked } }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['users', w.entity.id] });
      setEmail(''); setName(''); setPicked([]);
      onDone(r.status === 'invitation_sent' ? `Invitation e-mailed to ${email}.`
        : r.status === 'link_on_next_sign_in' ? `${email} already has a sign-in; they get access the next time they sign in.`
        : r.status === 'roles_updated' ? `Roles updated for ${email}.`
        : `${name} was added. E-mail invitations are not configured on this server, so share sign-in instructions directly.`);
    },
  });
  const assignable = roles.filter((r) => r.code !== 'system_admin');
  return (
    <form className="grid gap-4 p-5 pt-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-ink-2">Full name
          <input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" className={field} /></label>
        <label className="flex flex-col gap-1.5 text-[12px] font-semibold text-ink-2">Work e-mail
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" className={field} /></label>
      </div>
      <fieldset>
        <legend className="mb-2 text-[12px] font-semibold text-ink-2">Roles in {w.entity.legal_name}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {assignable.map((r) => (
            <label key={r.code} className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line p-3 has-[:checked]:border-action-600 has-[:checked]:bg-action-50">
              <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--color-action-600)]" checked={picked.includes(r.code)}
                onChange={(e) => setPicked((p) => e.target.checked ? [...p, r.code] : p.filter((x) => x !== r.code))} />
              <span className="min-w-0"><b className="block text-[13px] font-semibold">{r.name}</b>
                <small className="block text-[11.5px] text-muted">{r.description}</small></span>
            </label>
          ))}
        </div>
      </fieldset>
      {m.error && <Alert tone="loss">{(m.error as Error).message}</Alert>}
      {!canSend && <Alert tone="action">This server is not configured to send invitation e-mails. The person is still added with their roles.</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={m.isPending || !email || !name || !picked.length}>
          <UserPlus aria-hidden />{m.isPending ? 'Sending…' : 'Send invitation'}</Button>
        <small className="text-[12px] text-muted">They set a password and two-step verification before they can see any figures.</small>
      </div>
    </form>
  );
}

export default function UsersAccess() {
  const w = useWorkspace();
  const [notice, setNotice] = useState('');
  const canManage = w.perms.has('users.manage');
  const users = useQuery<{ users: UserRow[]; canSendInvites: boolean }>({ queryKey: ['users', w.entity.id], queryFn: () => api(`/entities/${w.entity.id}/users`) });
  const roles = useQuery<Role[]>({ queryKey: ['roles'], queryFn: () => api('/roles'), staleTime: 10 * 60_000 });
  const roleName = (c: string) => roles.data?.find((r) => r.code === c)?.name ?? c;

  return (
    <div className="grid min-w-0 gap-5">
      <header>
        <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">Users & access</h1>
        <p className="mt-1 max-w-[65ch] text-[13.5px] text-muted">Who can open {w.entity.legal_name}, what each role allows, and invitations. Every change is recorded in the audit trail.</p>
      </header>
      {notice && <Alert tone="gain" icon={<CheckCircle2 />}>{notice}</Alert>}
      {canManage && roles.data && (
        <Card aria-labelledby="invite-h" className="min-w-0">
          <CardHeader id="invite-h" title="Invite a person" />
          <InviteForm roles={roles.data} canSend={!!users.data?.canSendInvites} onDone={setNotice} />
        </Card>
      )}
      <Card aria-labelledby="users-h" className="min-w-0">
        <CardHeader id="users-h" title={users.data ? `${plural(users.data.users.length, 'person', 'people')} with access` : 'People with access'} />
        {users.isLoading ? <div className="grid gap-2 p-5"><Skeleton /><Skeleton /><Skeleton /></div>
          : users.error ? <div className="p-5"><Alert tone="loss">{(users.error as Error).message}</Alert></div>
          : !users.data?.users.length ? <EmptyState icon={<Users />} title="No one has access yet" />
          : (
            <div className="overflow-x-auto p-2 pt-3" tabIndex={0} role="region" aria-label="People with access (scrolls sideways on small screens)">
              <table className="w-full min-w-[640px] text-left text-[13px]">
                <thead className="text-[11.5px] uppercase tracking-[0.06em] text-muted">
                  <tr><th className="px-3 py-2 font-semibold">Person</th><th className="px-3 py-2 font-semibold">Roles</th><th className="px-3 py-2 font-semibold">Sign-in</th><th className="px-3 py-2 font-semibold">Invitation</th></tr>
                </thead>
                <tbody>
                  {users.data.users.map((u) => (
                    <tr key={u.id} className="border-t border-line">
                      <td className="px-3 py-3"><b className="block font-semibold">{u.full_name}</b><small className="text-muted">{u.email}</small></td>
                      <td className="px-3 py-3"><div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r}>{roleName(r)}</Badge>)}</div></td>
                      <td className="px-3 py-3">{u.can_sign_in
                        ? <Badge tone="gain"><ShieldCheck aria-hidden />Linked</Badge>
                        : <Badge tone="warn"><Clock aria-hidden />Not yet</Badge>}</td>
                      <td className="px-3 py-3 text-muted">{!u.invitation ? '—'
                        : u.invitation.status === 'accepted' ? `Accepted ${dateLabel((u.invitation.accepted_at ?? u.invitation.sent_at).slice(0, 10))}`
                        : u.invitation.status === 'sent' ? <span className="inline-flex items-center gap-1"><Mail className="size-3.5" aria-hidden />Sent {dateLabel(u.invitation.sent_at.slice(0, 10))}</span>
                        : 'Revoked'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>
    </div>
  );
}
