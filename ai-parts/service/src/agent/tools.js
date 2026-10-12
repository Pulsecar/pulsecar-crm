// Инструменты агента: описания для Claude + обработчики.
import { decodeVin } from '../providers/vin.js';
import { searchHistory } from '../providers/history.js';
import * as ic from '../providers/intercars.js';
import * as pl24 from '../providers/partslink24.js';
import { getIntegration } from '../integrations.js';
import { config } from '../config.js';

const evidenceSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['partslink24', 'history', 'catalog', 'seller', 'forum', 'web', 'knowledge'] },
      title: { type: 'string' },
      url: { type: 'string' },
      detail: { type: 'string', description: 'Что именно подтверждает источник (номер, применимость)' },
    },
    required: ['type', 'detail'],
  },
};

const offerSchema = {
  type: 'object',
  description: 'Конкретное предложение Inter Cars (только из ответа intercars_offers) или null',
  properties: {
    sku: { type: 'string' },
    brand: { type: 'string' },
    articleNumber: { type: 'string' },
    name: { type: 'string' },
    purchaseNet: { type: 'number', description: 'Цена закупки netto из Inter Cars; не указывать, если неизвестна' },
    availability: { type: 'string', description: 'Кратко: где и когда доступно' },
    supplier: { type: 'string', enum: ['intercars', 'profiauto', 'allegro', 'other'] },
  },
  required: ['brand', 'articleNumber'],
};

export const CLIENT_TOOLS = [
  {
    name: 'decode_vin',
    description: 'Расшифровать VIN: валидность, страна сборки, модельный год, данные NHTSA (для авто США/Канады — подробно). Опций комплектации не даёт.',
    input_schema: { type: 'object', properties: { vin: { type: 'string' } }, required: ['vin'] },
  },
  {
    name: 'search_history',
    description: 'Поиск в истории wycen автосервиса: что ставили на этот VIN / мотор / модель, какие номера подтверждены установкой (verified) и какие возвращали (returned).',
    input_schema: {
      type: 'object',
      properties: {
        vin: { type: 'string' },
        engine_code: { type: 'string' },
        make: { type: 'string' },
        model: { type: 'string' },
        year: { type: 'integer' },
        part_query: { type: 'string', description: 'Слова для поиска детали/работы, напр. "колодки тормозные"' },
        oe_number: { type: 'string' },
      },
    },
  },
  {
    name: 'partslink24_lookup',
    description: 'Найти оригинальные (OE) номера в каталоге partslink24 по VIN с учётом заводских опций. Выполняется расширением Chrome в аккаунте менеджера, занимает 1–3 минуты. Передавай сразу ВСЕ детали одним вызовом.',
    input_schema: {
      type: 'object',
      properties: {
        make: { type: 'string' },
        parts: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, hint: { type: 'string', description: 'Где искать в каталоге / уточнение (ось, сторона)' } },
            required: ['name'],
          },
        },
      },
      required: ['parts'],
    },
  },
  {
    name: 'intercars_offers',
    description: 'Найти в Inter Cars товары по номерам (OE-номера и/или номера производителей аналогов) и получить цены закупки и наличие. Поиск идёт по точному номеру — передавай все известные номера (OE и кроссы) с брендом, если известен.',
    input_schema: {
      type: 'object',
      properties: {
        numbers: {
          type: 'array',
          items: { type: 'object', properties: { number: { type: 'string' }, brand: { type: 'string' } }, required: ['number'] },
        },
      },
      required: ['numbers'],
    },
  },
  {
    name: 'intercars_search_text',
    description: 'Запасной поиск в каталоге Inter Cars по словам описания (если номера аналогов неизвестны). Результаты обязательно перепроверить по номерам.',
    input_schema: { type: 'object', properties: { words: { type: 'array', items: { type: 'string' } } }, required: ['words'] },
  },
  {
    name: 'ask_manager',
    description: 'Задать менеджеру ОДИН конкретный вопрос, без ответа на который нельзя точно подобрать деталь. Подбор приостановится до ответа. Используй только когда исчерпаны источники.',
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        options: { type: 'array', items: { type: 'string' }, description: 'Варианты ответа, если есть' },
        why: { type: 'string', description: 'Почему без этого нельзя (для менеджера)' },
        canAskClient: { type: 'boolean', description: 'Можно ли переслать вопрос клиенту (напр. «фото колеса»)' },
      },
      required: ['question', 'why'],
    },
  },
  {
    name: 'submit_result',
    description: 'Финальный результат подбора. Вызывается один раз в конце.',
    input_schema: {
      type: 'object',
      properties: {
        vehicle: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'Напр. "BMW M3 Competition xDrive (G80) 2023, S58, импорт США"' },
            engineCode: { type: 'string' },
            options: { type: 'array', items: { type: 'string' }, description: 'Подтверждённые коды опций/комплектации' },
            northAmericanSpec: { type: 'boolean' },
          },
          required: ['summary'],
        },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              group: { type: 'string', description: 'Группа: тормоза, ГРМ, фильтры, масла и жидкости…' },
              name: { type: 'string' },
              quantity: { type: 'number' },
              unit: { type: 'string', enum: ['шт', 'компл', 'л', 'кг', 'м'] },
              optional: { type: 'boolean', description: 'Ставится по необходимости' },
              oeNumber: { type: 'string' },
              altOeNumbers: { type: 'array', items: { type: 'string' }, description: 'Заменённые/эквивалентные OE-номера' },
              status: { type: 'string', enum: ['confirmed', 'check'] },
              confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              checkReason: { type: 'string', description: 'Если status=check: что именно проверить и как' },
              variants: {
                type: 'array',
                description: 'Если есть неразрешённые варианты детали: каждый вариант с условием применимости',
                items: { type: 'object', properties: { condition: { type: 'string' }, oeNumber: { type: 'string' } }, required: ['condition', 'oeNumber'] },
              },
              orderBoth: { type: 'boolean', description: 'Вариант не определён по VIN: заказать все варианты, лишние вернуть' },
              evidence: evidenceSchema,
              offers: {
                type: 'object',
                properties: { economy: offerSchema, middle: offerSchema, oe: offerSchema },
              },
              chosenLevel: { type: 'string', enum: ['economy', 'middle', 'oe'] },
            },
            required: ['group', 'name', 'quantity', 'unit', 'status', 'confidence', 'evidence'],
          },
        },
        questions: { type: 'array', items: { type: 'string' }, description: 'Что осталось уточнить' },
        notes: { type: 'string', description: 'Короткий комментарий для менеджера' },
      },
      required: ['vehicle', 'items'],
    },
  },
];

export function serverTools(workshopId) {
  const web = getIntegration(workshopId, 'web_research');
  if (!web.enabled) return [];
  const blocked = (web.values.blocked_domains || '').split(',').map((s) => s.trim()).filter(Boolean);
  const search = { type: 'web_search_20250305', name: 'web_search', max_uses: config.agent.maxWebSearches };
  const fetchT = { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: config.agent.maxWebFetches, max_content_tokens: 20000 };
  if (blocked.length) {
    search.blocked_domains = blocked;
    fetchT.blocked_domains = blocked;
  }
  return [search, fetchT];
}

// Обработчики клиентских инструментов. ctx: { workshopId, jobId, step(text), input, fetchImpl }
export async function runClientTool(name, args, ctx) {
  switch (name) {
    case 'decode_vin': {
      ctx.step(`Расшифровываю VIN ${args.vin}`);
      const nhtsa = getIntegration(ctx.workshopId, 'nhtsa');
      return decodeVin(args.vin || ctx.input.vehicle?.vin, { nhtsaEnabled: nhtsa.enabled, fetchImpl: ctx.fetchImpl });
    }
    case 'search_history': {
      ctx.step(`Ищу в истории wycen${args.part_query ? ': ' + args.part_query : ''}`);
      return searchHistory(ctx.workshopId, args);
    }
    case 'partslink24_lookup': {
      const it = getIntegration(ctx.workshopId, 'partslink24');
      if (!it.enabled) return { ok: false, error: 'partslink24 выключен в «Интеграциях»' };
      const vin = ctx.input.vehicle?.vin;
      ctx.step(`partslink24: ищу оригинальные номера (${(args.parts || []).length} поз.) — работает расширение у менеджера`);
      const id = pl24.createTask(ctx.workshopId, ctx.jobId, { vin, make: args.make || ctx.input.vehicle?.make, parts: args.parts || [] });
      const r = await pl24.waitForTask(id, config.agent.pl24WaitSeconds, (s) => {
        if (s === 'taken') ctx.step('partslink24: расширение начало поиск');
      });
      if (r.status === 'done') {
        ctx.step(`partslink24: найдено строк — ${(r.result?.rows || []).length}`);
        return { ok: true, ...r.result };
      }
      ctx.step('partslink24: не получилось — продолжаю по другим источникам');
      return { ok: false, status: r.status, ...(r.result || {}) };
    }
    case 'intercars_offers': {
      const it = getIntegration(ctx.workshopId, 'intercars');
      ctx.step(`Inter Cars: проверяю ${(args.numbers || []).length} номер(ов), цены и наличие`);
      if (!it.enabled) return { error: 'Inter Cars выключен в «Интеграциях»' };
      return ic.offersForNumbers(ctx.workshopId, it.values, args.numbers || [], ctx.fetchImpl);
    }
    case 'intercars_search_text': {
      ctx.step(`Inter Cars: поиск по описанию «${(args.words || []).join(' ')}»`);
      return { results: ic.searchCatalogText(ctx.workshopId, args.words || []) };
    }
    default:
      return { error: 'Неизвестный инструмент ' + name };
  }
}
