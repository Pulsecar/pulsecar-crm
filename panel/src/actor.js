// Кто сейчас меняет данные (для журнала изменений): свой для каждого запроса
import { AsyncLocalStorage } from 'node:async_hooks';
export const actorStore = new AsyncLocalStorage();
/** SQL-функции audit_actor(), audit_actor_id(), audit_source() — регистрируются сразу при открытии базы, до триггеров */
export function registerActorFunctions(db) {
  db.function('audit_actor', { deterministic: false }, () => actorStore.getStore()?.name ?? null);
  db.function('audit_actor_id', { deterministic: false }, () => actorStore.getStore()?.id ?? null);
  db.function('audit_source', { deterministic: false }, () => actorStore.getStore()?.source ?? 'system');
}
