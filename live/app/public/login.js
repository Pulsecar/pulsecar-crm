(() => {
  const e = new URLSearchParams(location.search).get('e');
  const el = document.getElementById('err');
  if (e === '1') el.textContent = 'Nieprawidłowe hasło';
  if (e === 'limit') el.textContent = 'Zbyt wiele prób. Spróbuj ponownie za 15 minut.';
})();
