// Цикл агента: Claude + инструменты. Поддерживает паузу на вопрос менеджеру и продолжение.
import { llmFor } from './llm.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { CLIENT_TOOLS, serverTools, runClientTool } from './tools.js';
import { getRules, clientPrice } from '../rules.js';
import { config } from '../config.js';
import { bumpUsage } from '../db.js';
import { getIntegration } from '../integrations.js';
import { quotePrices } from '../providers/intercars.js';

const LEVEL_LABEL = { economy: 'Эконом', middle: 'Средний', oe: 'OE' };

export function buildInitialMessage(input) {
  const v = input.vehicle || {};
  return `Подбор запчастей для wyceny ${input.wycenaId || ''}.

Авто (из wyceny):
- VIN: ${v.vin || 'нет'}
- Марка/модель: ${[v.make, v.model].filter(Boolean).join(' ') || 'нет'}
- Двигатель: ${v.engine || 'нет'}
- Год: ${v.year || 'нет'}
- Пробег: ${v.mileage || 'нет'}

Что нужно (текст менеджера):
${input.text}

Уровень запчастей: ${LEVEL_LABEL[input.level] || input.level || 'по умолчанию'}
Срочность: ${input.urgency || 'не важно'}
${input.note ? 'Комментарий менеджера: ' + input.note : ''}
${input.pastedCatalogText ? 'Менеджер вставил текст из каталога (partslink24/HaynesPro), используй как источник:\n' + input.pastedCatalogText.slice(0, 15000) : ''}
${input.knownOptions?.length ? 'Известные коды опций/комплектации: ' + input.knownOptions.join(', ') : ''}`;
}

function summarizeServerTool(block) {
  if (block.name === 'web_search') return `Ищу в интернете: ${block.input?.query || ''}`;
  if (block.name === 'web_fetch') return `Читаю страницу: ${block.input?.url || ''}`;
  return `Инструмент: ${block.name}`;
}

const MAX_TOOL_RESULT = 60000;

export async function runAgent({ workshopId, jobId, input, messages = [], pending = null, answer = null, step = () => {}, fetchImpl = fetch }) {
  const { client, model } = llmFor(workshopId);
  const rules = getRules(workshopId);
  const system = buildSystemPrompt(rules);
  const tools = [...CLIENT_TOOLS.filter((t) => t.name !== 'ask_manager' || rules.askManager), ...serverTools(workshopId)];
  const usage = { input: 0, output: 0, webSearches: 0 };

  if (!messages.length) messages.push({ role: 'user', content: buildInitialMessage(input) });
  if (pending) {
    // продолжение после ответа менеджера
    messages.push({
      role: 'user',
      content: [...(pending.otherResults || []), { type: 'tool_result', tool_use_id: pending.toolUseId, content: `Ответ менеджера: ${answer}` }],
    });
  }

  let nudged = false;
  const ctx = { workshopId, jobId, input, step, fetchImpl };

  try {
    for (let turn = 0; turn < config.agent.maxTurns; turn++) {
      const resp = await client.messages.create({ model, max_tokens: 16000, system, tools, messages });
      usage.input += resp.usage?.input_tokens || 0;
      usage.output += resp.usage?.output_tokens || 0;
      usage.webSearches += resp.usage?.server_tool_use?.web_search_requests || 0;
      messages.push({ role: 'assistant', content: resp.content });

      for (const b of resp.content) if (b.type === 'server_tool_use') step(summarizeServerTool(b));

      if (resp.stop_reason === 'pause_turn') continue;

      const toolUses = resp.content.filter((b) => b.type === 'tool_use');
      if (!toolUses.length) {
        if (nudged) throw new Error('Агент завершил работу без результата');
        nudged = true;
        messages.push({ role: 'user', content: 'Заверши подбор: вызови submit_result с результатом (даже частичным, со статусами check).' });
        continue;
      }

      const results = [];
      let ask = null;
      for (const tu of toolUses) {
        if (tu.name === 'submit_result') {
          await enrichIcPrices(workshopId, tu.input, ctx.fetchImpl);
          const result = postProcess(tu.input, rules, input.level || rules.defaultLevel);
          return { status: 'done', result, messages, usage };
        }
        if (tu.name === 'ask_manager') {
          ask = tu;
          continue;
        }
        let out;
        try {
          out = await runClientTool(tu.name, tu.input || {}, ctx);
        } catch (e) {
          out = { error: String(e.message || e) };
        }
        let content = JSON.stringify(out);
        if (content.length > MAX_TOOL_RESULT) content = content.slice(0, MAX_TOOL_RESULT) + '…(обрезано)';
        results.push({ type: 'tool_result', tool_use_id: tu.id, content });
      }

      if (ask) {
        step('Нужен ответ менеджера: ' + ask.input.question);
        return {
          status: 'needs_input',
          question: ask.input,
          pending: { toolUseId: ask.id, otherResults: results },
          messages,
          usage,
        };
      }
      messages.push({ role: 'user', content: results });
    }
    throw new Error('Превышен лимит шагов агента');
  } finally {
    bumpUsage(workshopId, { inputTokens: usage.input, outputTokens: usage.output, webSearches: usage.webSearches });
  }
}

// Цены Inter Cars из API по SKU предложений: закупка и рекомендуемая цена IC (модель их не всегда передаёт)
export async function enrichIcPrices(workshopId, raw, fetchImpl) {
  const offers = (raw?.items || []).flatMap((it) => Object.values(it.offers || {})).filter((o) => o && o.sku && (!o.supplier || o.supplier === 'intercars'));
  if (!offers.length) return;
  try {
    const it = getIntegration(workshopId, 'intercars');
    if (!it.enabled) return;
    const prices = await quotePrices(workshopId, it.values, [...new Set(offers.map((o) => o.sku))], fetchImpl);
    for (const o of offers) {
      const p = prices.find((x) => x.sku === o.sku);
      if (!p) continue;
      if (p.purchaseNet !== null && p.purchaseNet !== undefined) o.purchaseNet = p.purchaseNet;
      if (p.listNet) o.listNet = p.listNet;
    }
  } catch { /* без цен IC — останется наценка на закупку */ }
}

// Цены клиенту по правилам наценки, выбор уровня, нормализация.
export function postProcess(raw, rules, wantedLevel) {
  const items = (raw.items || []).map((it, i) => {
    const offers = {};
    for (const lvl of ['economy', 'middle', 'oe']) {
      const o = it.offers?.[lvl];
      if (!o || !o.articleNumber) continue;
      const blacklisted = (rules.blacklistBrands || []).some((b) => String(o.brand || '').toLowerCase() === String(b).toLowerCase());
      if (blacklisted) continue;
      offers[lvl] = { ...o, client: clientPrice(rules, o.purchaseNet, lvl, it.group, o.listNet) };
    }
    let chosen = it.chosenLevel && offers[it.chosenLevel] ? it.chosenLevel : null;
    if (!chosen) chosen = offers[wantedLevel] ? wantedLevel : ['middle', 'economy', 'oe'].find((l) => offers[l]) || null;
    return {
      id: `ai-${i + 1}`,
      ...it,
      offers,
      chosenLevel: chosen,
      // Неподтверждённую позицию нельзя заказывать — CRM должна это соблюдать.
      orderable: (it.status === 'confirmed' || !!it.orderBoth) && !!chosen,
    };
  });
  return {
    vehicle: raw.vehicle,
    items,
    questions: raw.questions || [],
    notes: raw.notes || '',
    totals: totals(items),
  };
}

function totals(items) {
  let purchase = 0;
  let net = 0;
  let gross = 0;
  for (const it of items) {
    if (it.optional) continue;
    const o = it.offers?.[it.chosenLevel];
    if (!o) continue;
    const q = Number(it.quantity || 1);
    purchase += (o.purchaseNet || 0) * q;
    net += (o.client?.net || 0) * q;
    gross += (o.client?.gross || 0) * q;
  }
  const r = (x) => Math.round(x * 100) / 100;
  return { purchaseNet: r(purchase), clientNet: r(net), clientGross: r(gross) };
}
