// Языки CRM (как на сайте): PL / EN / UA / RU. Интерфейс написан по-русски; для других языков
// тексты на странице подменяются по словарю /i18n/<lang>.json — и то, что рисует интерфейс, и ответы сервера.
export const LANGS = [['pl', 'PL', 'Polski'], ['en', 'EN', 'English'], ['uk', 'UA', 'Українська'], ['ru', 'RU', 'Русский']];
const KEY = 'pc_lang';
const CYR = /[А-Яа-яЁёІіЇїЄєҐґ]/;

export function getLang() {
  try { const l = localStorage.getItem(KEY); if (LANGS.some(([k]) => k === l)) return l; } catch {}
  return 'ru';
}
export function setLang(l) {
  try { localStorage.setItem(KEY, l); } catch {}
  location.reload();
}

let dict = null;
const cache = new Map();
/** Перевод строки: целиком по словарю, иначе — по кускам (слова между числами и значками) */
export function tr(s) {
  if (!dict || !s || !CYR.test(s)) return s;
  if (cache.has(s)) return cache.get(s);
  const lead = s.match(/^\s*/)[0], tail = s.match(/\s*$/)[0];
  const core = s.trim();
  let out = dict[core];
  if (out === undefined) {
    out = core.replace(/[А-Яа-яЁё«„"(][^0-9@#№=<>{}[\]|]*[А-Яа-яЁё»")]|[А-Яа-яЁё]/g, (m) => {
      const t = m.trim();
      if (dict[t] !== undefined) return m.replace(t, dict[t]);
      // «Слово:» / «(слово)» — без крайних знаков
      const bare = t.replace(/^[«"(]+|[»"):.,]+$/g, '');
      if (bare && dict[bare] !== undefined) return m.replace(bare, dict[bare]);
      // по словам: самая длинная известная фраза с начала
      const w = t.split(' '), res = [];
      let hit = false;
      for (let i = 0; i < w.length;) {
        let j = w.length;
        for (; j > i; j--) { const ph = w.slice(i, j).join(' '); if (dict[ph] !== undefined) { res.push(dict[ph]); hit = true; break; } }
        if (j > i) i = j; else res.push(w[i++]);
      }
      return hit ? m.replace(t, res.join(' ')) : m;
    });
  }
  const res = lead + out + tail;
  if (cache.size < 20000) cache.set(s, res);
  return res;
}

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const mine = new WeakMap(); // текст, который поставили мы сами — повторно не переводим
function walk(node) {
  if (node.nodeType === 3) {
    const v = node.data;
    if (mine.get(node) === v || !CYR.test(v) || node.parentElement?.tagName === 'TEXTAREA' || node.parentElement?.closest('[data-no-i18n]')) return;
    const t = tr(v);
    mine.set(node, t);
    if (t !== v) node.data = t;
    return;
  }
  if (node.nodeType !== 1) return;
  const tag = node.tagName;
  if (tag === 'SCRIPT' || tag === 'STYLE' || node.isContentEditable || node.closest?.('[data-no-i18n]')) return;
  for (const a of ATTRS) {
    const v = node.getAttribute(a);
    if (v && CYR.test(v)) { const t = tr(v); if (t !== v) node.setAttribute(a, t); }
  }
  if (tag === 'TEXTAREA') return; // текст, который вводит пользователь, не трогаем
  if ((tag === 'INPUT' && (node.type === 'button' || node.type === 'submit')) && CYR.test(node.value)) node.value = tr(node.value);
  for (let c = node.firstChild; c; c = c.nextSibling) walk(c);
}

export async function initI18n() {
  const lang = getLang();
  document.documentElement.lang = lang === 'uk' ? 'uk' : lang;
  if (lang === 'ru') return lang;
  try { dict = await (await fetch(`/i18n/${lang}.json`, { cache: 'no-cache' })).json(); } catch { dict = null; return lang; }
  const origConfirm = window.confirm.bind(window), origAlert = window.alert.bind(window), origPrompt = window.prompt.bind(window);
  window.confirm = (m) => origConfirm(tr(String(m ?? '')));
  window.alert = (m) => origAlert(tr(String(m ?? '')));
  window.prompt = (m, d) => origPrompt(tr(String(m ?? '')), d);
  const titleFix = () => { if (CYR.test(document.title)) document.title = tr(document.title); };
  walk(document.body); titleFix();
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') walk(m.target);
      else if (m.type === 'attributes') { const v = m.target.getAttribute(m.attributeName); if (v && CYR.test(v)) { const t = tr(v); if (t !== v) m.target.setAttribute(m.attributeName, t); } }
      else m.addedNodes.forEach(walk);
    }
    titleFix();
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  return lang;
}

export function LangSwitch({ html, compact }) {
  const cur = getLang();
  return html`<select class="lang-switch" data-no-i18n aria-label="Language" value=${cur} onChange=${(e) => setLang(e.target.value)}>
    ${LANGS.map(([k, s, name]) => html`<option value=${k}>${compact ? s : `${s} · ${name}`}</option>`)}</select>`;
}
