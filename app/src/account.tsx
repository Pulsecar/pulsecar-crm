import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { API_URL } from './config';
import { DEMO_ME, DEMO_SESSION } from './demo';

// ── Типы ответа сервера ────────────────────────────────────────────────────
export type Item = { name: string; kind: string | null; qty: number | null; price: number | null };
export type Visit = { orderNo: string; date: string | null; mileage: number | null; total: number | null; items: Item[]; active?: boolean; status?: string | null; statusColor?: string | null;
  due?: number; payLink?: string | null; cardUrl?: string | null };
export type Quote = { no: string; date: string; total: number; accepted: boolean; car: string | null; plate: string | null; cardUrl: string | null; items: Item[] };
export type StorageItem = { no: string; kind: string; description: string | null; qty: number | null; since: string; until: string | null; car: string | null; plate: string | null; due: number; paid: number };
export type Car = {
  id: number; plate: string | null; vin: string | null; make: string | null; model: string | null; year: string | null;
  lastMileage: number | null; visits: Visit[];
};
export type Tier = { id: string; name: string; rate: number };
export type Tx = { type: 'earn' | 'redeem' | 'bonus' | 'adjust'; points: number; amount: number | null; orderNo: string | null; date: string; note: string | null };
export type Me = {
  serverTime: number;
  customer: { name: string | null; phone: string; email: string | null; cardNo: string; since: string | null };
  loyalty: {
    name: string; balance: number; valuePln: number; spend12m: number; tier: Tier;
    next: (Tier & { from: number; remaining: number }) | null;
    rules: { tiers: (Tier & { from: number })[]; pointValuePln: number; minRedeem: number; maxRedeemShare: number; welcomeBonus: number };
  };
  cars: Car[];
  otherVisits: Visit[];
  activeOrders?: Visit[];
  appointments?: { start: string | null; status: string; title: string | null }[];
  quotes?: Quote[];
  storage?: StorageItem[];
  transactions: Tx[];
};
export type Session = { token: string; qrSecret: string; cardNo: string; demo?: boolean };

// ── Хранилище: Keychain/Keystore на телефоне, localStorage в браузере ──────
const store = {
  async get(k: string) {
    try {
      if (Platform.OS === 'web') return globalThis.localStorage?.getItem(k) ?? null;
      return await SecureStore.getItemAsync(k);
    } catch { return null; }
  },
  async set(k: string, v: string | null) {
    try {
      if (Platform.OS === 'web') {
        if (v === null) globalThis.localStorage?.removeItem(k); else globalThis.localStorage?.setItem(k, v);
        return;
      }
      if (v === null) await SecureStore.deleteItemAsync(k); else await SecureStore.setItemAsync(k, v);
    } catch {}
  },
};

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function call<T>(path: string, opts: { body?: object; token?: string } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(API_URL + '/api' + path, {
      method: opts.body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(r.status, j.error || String(r.status));
    return j as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, 'network');
  } finally {
    clearTimeout(timer);
  }
}

type Ctx = {
  ready: boolean;
  session: Session | null;
  me: Me | null;
  loading: boolean;
  clockOffset: number; // серверное время − время телефона, мс
  requestCode: (phone: string, lang: string) => Promise<void>;
  verify: (phone: string, code: string) => Promise<void>;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  startDemo: () => void;
  sendBooking: (b: Record<string, string>) => Promise<void>;
};
const AccountContext = createContext<Ctx>(null as unknown as Ctx);
export const useAccount = () => useContext(AccountContext);

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(false);
  const [clockOffset, setOffset] = useState(0);

  const saveMe = useCallback((m: Me | null) => {
    setMe(m);
    if (m) setOffset(m.serverTime - Date.now());
    store.set('pc.me', m ? JSON.stringify(m) : null);
  }, []);

  const clear = useCallback(async () => {
    setSession(null);
    setMe(null);
    await store.set('pc.session', null);
    await store.set('pc.me', null);
  }, []);

  const load = useCallback(async (s: Session) => {
    if (s.demo) { setMe({ ...DEMO_ME, serverTime: Date.now() }); return; }
    setLoading(true);
    try {
      saveMe(await call<Me>('/me', { token: s.token }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) await clear();
      // без сети остаются сохранённые данные, QR работает офлайн
    } finally {
      setLoading(false);
    }
  }, [saveMe, clear]);

  useEffect(() => {
    (async () => {
      const raw = await store.get('pc.session');
      const cached = await store.get('pc.me');
      if (raw) {
        const s = JSON.parse(raw) as Session;
        setSession(s);
        if (cached) setMe(JSON.parse(cached));
        load(s);
      }
      setReady(true);
    })();
  }, [load]);

  const value = useMemo<Ctx>(() => ({
    ready, session, me, loading, clockOffset,
    requestCode: async (phone, lang) => { await call('/auth/request', { body: { phone, lang } }); },
    verify: async (phone, code) => {
      const s = await call<Session>('/auth/verify', { body: { phone, code, device: Platform.OS } });
      await store.set('pc.session', JSON.stringify(s));
      setSession(s);
      await load(s);
    },
    refresh: async () => { if (session) await load(session); },
    logout: async () => {
      if (session && !session.demo) await call('/auth/logout', { body: {}, token: session.token }).catch(() => {});
      await clear();
    },
    deleteAccount: async () => {
      if (session && !session.demo) await call('/me/delete', { body: {}, token: session.token });
      await clear();
    },
    startDemo: () => { setSession(DEMO_SESSION); setMe({ ...DEMO_ME, serverTime: Date.now() }); },
    // заявка попадает в терминарз CRM («Не распределено»)
    sendBooking: async (b) => {
      if (session?.demo) return;
      await call('/bookings', { body: b, token: session?.token });
    },
  }), [ready, session, me, loading, clockOffset, load, clear]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
