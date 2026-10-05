// Перенос Motowarsztat → Pulsecar CRM. Выполняется во вкладке app.motowarsztat.pl (вход уже выполнен).
// Только ЧТЕНИЕ из Motowarsztat (GET к их API) и отправка пакетов в CRM: POST https://panel.pulsecar.tech/mw-import/<раздел>.
// Запуск: window.__mwRun('<ключ импорта из CRM>')  → ход переноса в window.__mwLog
(() => {
  const CRM = 'https://panel.pulsecar.tech/mw-import/';
  const ORDER = ['workers', 'scheduler-workplaces', 'clients', 'vehicles', 'products', 'job-templates', 'repair-orders', 'quotations', 'sale-documents', 'pro-forma-documents',
    'cash-box-documents', 'sms-messages', 'warehouse-documents', 'repair-order-dates'];
  const TARGET = { 'scheduler-workplaces': 'workplaces', products: 'products', 'pro-forma-documents': 'sale-documents' };
  const SOURCE = { products: 'warehouse-products', 'repair-order-dates': 'repair-orders' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function get(path) {
    for (let a = 0; a < 4; a++) {
      const r = await fetch('/api-v2/' + path, { headers: { Accept: 'application/ld+json' } });
      if (r.ok) return r.json();
      await sleep(1500 * (a + 1));
    }
    throw new Error('MW ' + path);
  }
  async function send(entity, items, token) {
    for (let a = 0; a < 4; a++) {
      try {
        const r = await fetch(CRM + entity, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Import-Token': token }, body: JSON.stringify({ items }) });
        const j = await r.json();
        if (r.ok) return j;
        if (r.status === 401) throw Object.assign(new Error(j.error), { fatal: true });
      } catch (e) { if (e.fatal) throw e; }
      await sleep(2000 * (a + 1));
    }
    throw new Error('CRM ' + entity);
  }
  window.__mwRun = async (token, only) => {
    const log = (window.__mwLog = { started: new Date().toISOString(), done: false, steps: {} });
    try {
      for (const e of ORDER) {
        if (only ? !only.includes(e) : e === 'repair-order-dates') continue; // «только даты» — по отдельному запросу
        const src = SOURCE[e] || e, dst = TARGET[e] || e;
        const st = (log.steps[e] = { total: null, sent: 0, created: 0, updated: 0, skipped: 0, failed: 0, errors: [] });
        const per = ['repair-orders', 'repair-order-dates', 'quotations', 'sale-documents', 'warehouse-documents'].includes(e) ? 50 : 100;
        for (let page = 1; ; page++) {
          const j = await get(`${src}?page=${page}&itemsPerPage=${per}&order[id]=asc`);
          const items = j['hydra:member'] || [];
          st.total = j['hydra:totalItems'] ?? st.total;
          if (!items.length) break;
          // Pro forma — отдельная нумерация id в MW: свой префикс, тип «proforma»
          const batch = e === 'pro-forma-documents' ? items.map((x) => ({ ...x, id: 'pf' + x.id, type: 'proforma', payments: [] })) : items;
          const r = await send(dst, batch, token);
          st.sent += items.length; st.created += r.created; st.updated += r.updated; st.skipped += r.skipped; st.failed += r.failed;
          if (r.errors?.length && st.errors.length < 10) st.errors.push(...r.errors.slice(0, 10 - st.errors.length));
          if (items.length < per) break;
          await sleep(150);
        }
      }
    } catch (e) { log.error = String(e.message || e); }
    log.done = true; log.finished = new Date().toISOString();
    return log;
  };
})();
