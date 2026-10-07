// Режим предпросмотра (AI_PARTS_MOCK=1, только локально): показывает, как выглядит и работает подбор, на вымышленных данных.
// Claude и Inter Cars не вызываются. Номера деталей — условные, для демонстрации интерфейса.
import { one, run, withDb, curDb } from '../db.js';
import { round2 } from '../util.js';
import { recalc } from '../orders.js';
import { addAiLine } from './index.js';
import { STEPS } from './pipeline.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const v = (brand, article, net, avail, when, sku) => ({ brand, article, sku: sku || article.replace(/\W/g, ''), priceNet: net, sellNet: round2(net * 1.4), sellGross: round2(net * 1.4 * 1.23), availability: avail, delivery: when, supplier: 'Inter Cars' });

const DEMO = [
  { group_key: 'timing_kit', title: 'Zestaw paska rozrządu', qty: 1, oe: [{ number: '04E 198 119 A', source: 'история выцен' }],
    variants: { eco: v('SKF', 'VKMA 01121', 318.4, 6, 'сегодня 15:00'), mid: v('INA', '530 0640 10', 389.9, 4, 'сегодня 15:00'), oe: v('VAG', '04E198119A', 702.1, 1, 'завтра 9:00') } },
  { group_key: 'water_pump', title: 'Pompa wody', qty: 1, oe: [{ number: '04E 121 600 AL', source: 'каталог' }],
    variants: { eco: v('Hepu', 'P546', 152.3, 3, 'сегодня 15:00'), mid: v('Graf', 'PA1393', 201.5, 2, 'сегодня 15:00'), oe: v('VAG', '04E121600AL', 488.0, 0, 'через 2–3 дня') },
    confidence: 'check', reason: 'В этом двигателе помпа стоит в корпусе термостата и не входит в комплект ГРМ — проверьте, какая версия на авто (VIN это не различает).' },
  { group_key: 'engine_oil', title: 'Olej silnikowy 5W-30 VW 504.00', qty: 4, unit: 'l', qty_note: 'объём по двигателю 1.4 TSI: 4,0 л', oe: [],
    variants: { eco: v('Comma', 'XFLL1L', 24.9, 40, 'сегодня 15:00'), mid: v('Castrol', 'EDGE 5W30 LL', 39.8, 25, 'сегодня 15:00'), oe: v('VAG', 'GS55545M2EUR', 47.2, 12, 'сегодня 15:00') } },
  { group_key: 'oil_filter', title: 'Filtr oleju', qty: 1, oe: [{ number: '04E 115 561 H', source: 'история выцен' }],
    variants: { eco: v('Filtron', 'OE 688/4', 17.3, 20, 'сегодня 15:00'), mid: v('MANN-FILTER', 'W 712/95', 24.6, 14, 'сегодня 15:00'), oe: v('VAG', '04E115561H', 41.9, 5, 'сегодня 15:00') } },
  { group_key: 'spark_plug', title: 'Świeca zapłonowa', qty: 4, qty_note: '4 цилиндра', oe: [{ number: '04E 905 612 C', source: 'история выцен' }],
    variants: { eco: v('Bosch', 'FR7NII33X', 21.5, 30, 'сегодня 15:00'), mid: v('NGK', 'PLZKAR6A-11', 33.9, 16, 'сегодня 15:00'), oe: v('VAG', '04E905612C', 52.4, 8, 'завтра 9:00') } },
];

export async function mockPick(jobId) {
  const d = curDb();
  const step = (key, state, info) => withDb(d, () => {
    const j = one('SELECT steps FROM ai_jobs WHERE id = ?', jobId);
    const steps = JSON.parse(j.steps).map((s) => (s.key === key ? { ...s, state, info } : s));
    run('UPDATE ai_jobs SET steps = ? WHERE id = ?', JSON.stringify(steps), jobId);
  });
  const info = { vin: 'VW Golf VII · 1.4 TSI (EA211) · бензин · 2016', history: 'похожих выцен/заказов: 7', parse: 'комплект ГРМ, помпа, масло, масляный фильтр, свечи — 5 поз.',
    prices: 'проверено артикулов: 32, найдено в Inter Cars: 15, с ценой: 15', add: '' };
  withDb(d, () => run("UPDATE ai_jobs SET status = 'running', started_at = datetime('now') WHERE id = ?", jobId));
  for (const [key] of STEPS) {
    if (withDb(d, () => one('SELECT status FROM ai_jobs WHERE id = ?', jobId).status) === 'cancelled') return;
    step(key, 'run');
    await sleep(key === 'prices' ? 2200 : 1200);
    if (key === 'add') {
      const r = withDb(d, () => {
        const job = one('SELECT * FROM ai_jobs WHERE id = ?', jobId);
        const level = JSON.parse(job.request).level || 'mid';
        let added = 0, check = 0;
        for (const l of DEMO) {
          const id = addAiLine(jobId, job.order_id, { ...l, chosen: level });
          if (id) { added++; if (l.confidence === 'check') check++; }
        }
        recalc(job.order_id);
        run("UPDATE ai_jobs SET status = 'done', added = ?, to_check = ?, finished_at = datetime('now') WHERE id = ?", added, check, jobId);
        return { added, check };
      });
      step(key, 'ok', r.added ? `добавлено ${r.added}, проверить ${r.check}` : 'новых позиций нет — всё уже в выцене');
    } else step(key, 'ok', info[key]);
  }
}
