/** Z01 Not found, Z02 No access, Z03 Offline — each with a way back. */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { CloudOff, Compass, ShieldAlert, RefreshCw } from 'lucide-react';
import { API_BASE, apiFetch } from '../../api';
import { Button, buttonStyles } from '../../design/components';
import { Logo } from '../../shell/Logo';

function Frame({ icon, title, children, actions }: { icon: React.ReactNode; title: string; children: React.ReactNode; actions: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4">
      <div className="w-full max-w-[460px] text-center">
        <div className="mb-8 flex items-center justify-center gap-2.5"><Logo /><b className="text-[17px] font-extrabold">PEP Accounting</b></div>
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-navy-50 text-navy-800 [&_svg]:size-6">{icon}</div>
        <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">{title}</h1>
        <p className="mx-auto mt-2 max-w-[48ch] text-[14px] text-muted">{children}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">{actions}</div>
      </div>
    </main>
  );
}

export function NotFound() {
  const navigate = useNavigate();
  return (
    <Frame icon={<Compass />} title="Page not found" actions={<><Button onClick={() => navigate(-1)}>Go back</Button><Link to="/" className={buttonStyles({ variant: 'primary' })}>Open dashboard</Link></>}>
      The link may be mistyped, or the page may have moved. Nothing has been changed.
    </Frame>
  );
}

export function NoAccess() {
  return (
    <Frame icon={<ShieldAlert />} title="You don't have access to this" actions={<Link to="/" className={buttonStyles({ variant: 'primary' })}>Open dashboard</Link>}>
      Your role in this entity does not include this screen. Ask your controller or administrator if you need it.
    </Frame>
  );
}

export function Offline() {
  const [state, setState] = useState<'checking' | 'up' | 'down'>('checking');
  const check = () => {
    setState('checking');
    apiFetch(`${API_BASE}/api/health`).then((r) => setState(r.ok ? 'up' : 'down')).catch(() => setState('down'));
  };
  useEffect(check, []);
  return (
    <Frame icon={<CloudOff />} title={state === 'up' ? 'Service is reachable again' : "Can't reach PEP Accounting"}
      actions={<><Button onClick={check} disabled={state === 'checking'}><RefreshCw />{state === 'checking' ? 'Checking…' : 'Check again'}</Button>
        <Link to="/" className={buttonStyles({ variant: 'primary' })}>Open dashboard</Link></>}>
      {state === 'up' ? 'The connection is working. You can carry on where you left off.'
        : 'Check your internet connection. Nothing you were editing has been posted; changes are only saved when the server confirms them.'}
    </Frame>
  );
}
