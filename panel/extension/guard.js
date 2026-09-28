// Pulsecar: клавиши, нажатые в окне Pulsecar, не должны доходить до горячих клавиш сайта поставщика
// (Inter Cars по Enter/цифрам перезагружает список или кладёт товар в корзину). Запускается до скриптов сайта.
(() => {
  if (window.__pulsecarGuard) return;
  window.__pulsecarGuard = true;
  const ours = (e) => (e.composedPath ? e.composedPath() : []).some((n) => n && n.classList && n.classList.contains('pulsecar-host'));
  const stop = (e) => { if (ours(e)) e.stopImmediatePropagation(); };
  for (const t of ['keydown', 'keyup', 'keypress']) window.addEventListener(t, stop, true);
  // отправка форм сайта из-за Enter в нашем окне
  window.addEventListener('submit', (e) => { if (ours(e)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
})();
