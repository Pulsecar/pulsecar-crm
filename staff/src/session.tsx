import { createContext, useContext } from 'react';
import type { Me } from './api';

export type Tab = 'schedule' | 'orders' | 'quotes' | 'crm' | 'more';
export type SessionCtx = {
  me: Me;
  reloadMe: () => Promise<void>;
  signOut: () => Promise<void>;
  openOrder: (id: number) => void;
  openCrm: (path?: string) => void;
  go: (t: Tab) => void;
};
export const Session = createContext<SessionCtx | null>(null);
export function useSession() {
  const c = useContext(Session);
  if (!c) throw new Error('no session');
  return c;
}
export const can = (me: Me, perm: string) => !!me.perms[perm];
