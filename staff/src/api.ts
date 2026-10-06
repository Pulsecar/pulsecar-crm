import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Application from 'expo-application';

/** Адрес CRM. Все запросы — только по HTTPS к серверу CRM сервиса. */
// (веб-сборка — только для предпросмотра и скриншотов магазинов: тот же сервер, что и страница)
export const PANEL = Platform.OS === 'web' && typeof location !== 'undefined' && location.hostname === 'localhost' ? location.origin : 'https://panel.pulsecar.tech';
const API = PANEL + '/crm-api';
const KEY = 'pc_crm_token';

let token: string | null = null;
let onExpired: () => void = () => {};
export const setExpiredHandler = (fn: () => void) => { onExpired = fn; };

const web = Platform.OS === 'web';
export async function loadToken() {
  token = web ? sessionStorage.getItem(KEY) : await SecureStore.getItemAsync(KEY).catch(() => null);
  return token;
}
async function saveToken(t: string | null) {
  token = t;
  if (web) { if (t) sessionStorage.setItem(KEY, t); else sessionStorage.removeItem(KEY); return; }
  // ключ устройства — в Keychain / Keystore, только на этом телефоне
  if (t) await SecureStore.setItemAsync(KEY, t, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  else await SecureStore.deleteItemAsync(KEY).catch(() => {});
}

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: any; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  let body: any;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.body); }
  let r: Response;
  try {
    r = await fetch(API + path, { method: opts.method || (body ? 'POST' : 'GET'), headers, body });
  } catch {
    throw new ApiError('offline', 0);
  }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && token && !path.startsWith('/mobile/login')) { await saveToken(null); onExpired(); }
  if (!r.ok) throw new ApiError(j.error || 'HTTP ' + r.status, r.status);
  return j as T;
}

export async function login(loginName: string, password: string) {
  const j = await api<{ token: string }>('/mobile/login', {
    body: { login: loginName, password, platform: Platform.OS, device: [Device.manufacturer, Device.modelName].filter(Boolean).join(' '), app_version: Application.nativeApplicationVersion },
  });
  await saveToken(j.token);
}
export async function logout() {
  try { await api('/mobile/logout', { method: 'POST' }); } catch {}
  await saveToken(null);
}
export const authHeader = (): Record<string, string> => (token ? { Authorization: 'Bearer ' + token } : {});
export const fileUrl = (id: number) => `${API}/files/${id}`;

// ── Типы данных CRM (только то, что использует приложение) ──
export type Status = { id: number; name: string; color: string | null; is_final: number; scope: string | null; pos: number };
export type Station = { id: number; name: string; parallel?: number };
export type Me = {
  user: { id: number; name: string; role: 'admin' | 'staff' | 'mechanic'; login: string };
  perms: Record<string, boolean>;
  branch: { code: string; name: string };
  statuses: Status[];
  stations: Station[];
};
export type OrderRow = {
  id: number; kind: 'order' | 'quote'; number: string; created_at: string; status_id: number; status_name: string | null; status_color: string | null;
  customer_name: string | null; plate: string | null; make: string | null; model: string | null; total: number | null; last_comment: string | null; planned_at: string | null;
};
export type Item = { id: number; kind: 'labor' | 'part'; name: string; qty: number; unit?: string; price: number | null; discount: number | null; done: number; mechanic_name: string | null; task_id?: number | null };
export type Comment = { id: number; at: string; staff: string | null; text: string | null };
export type OrderFile = { id: number; name: string; mime: string; created_at: string; staff: string | null };
export type Order = OrderRow & {
  customer: { id: number; name: string; company?: string | null; kind?: string; phone: string | null } | null;
  car: { make: string | null; model: string | null; plate: string | null; vin: string | null; year?: number | null } | null;
  mileage: number | null; complaint: string | null; mechanic_note: string | null; paid: number | null; media_done: number;
  items: Item[]; comments: Comment[]; files: OrderFile[];
  appointments: { id: number; start_at: string | null; duration_min: number; station_name: string | null }[];
};
export type Appt = {
  id: number; start_at: string; duration_min: number; station_id: number; status: string; title: string | null; note: string | null;
  customer_name: string | null; contact_name?: string | null; make: string | null; model: string | null; plate: string | null;
  order_id: number | null; order_number: string | null; order_kind: string | null; status_name: string | null; status_color: string | null; mechanic_name: string | null;
  jobs?: { name: string; done?: number }[];
};
