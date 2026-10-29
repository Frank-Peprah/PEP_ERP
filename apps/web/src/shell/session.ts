import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, hasToken, setToken } from '../api';
import { signOutSupabase } from '../lib/auth';

export interface Me {
  user: { id: string; email: string; fullName: string; method?: 'supabase' | 'dev'; mfa?: boolean };
  entities: { id: string; code: string; legal_name: string; functional_currency: string; roles: string[] }[];
}

/** Signed-in user and the entities they hold a role in. */
export function useMe() {
  return useQuery<Me>({ queryKey: ['me'], queryFn: () => api('/me'), enabled: hasToken(), staleTime: 5 * 60_000, retry: false });
}

export function useSignOut() {
  const qc = useQueryClient();
  return () => {
    void signOutSupabase();
    setToken(null);
    try { sessionStorage.removeItem('pep.entity'); } catch { /* storage unavailable */ }
    qc.clear();
  };
}

/** Entity code in URLs: lower-case, e.g. /trulander/dashboard. */
export const slug = (code: string) => code.toLowerCase();
