/* YooKassa test store only. Test payments never activate VPN access. */
(() => {
  const api = 'https://functions.yandexcloud.net/d4e3uc0h5tp7rci8pnh1';
  const plans = { '1 месяц — 249 ₽': 'month', '3 месяца — 599 ₽': 'quarter', '1 год — 1 799 ₽': 'year' };
  const container = document.querySelector('#subscription .plans');
  if (!container) return;
  const block = document.createElement('div');
  block.className = 'card';
  block.style.marginTop = '20px';
  block.innerHTML = '<h2>Тест оплаты — без денег</h2><p>Выберите тариф выше. Тестовая оплата не списывает деньги и не активирует VPN или подписку.</p><button type="button" class="primary" id="yk-test-create">Проверить тестовую оплату</button><button type="button" class="back" id="yk-test-status" style="margin-top:12px">Проверить результат оплаты</button><p id="yk-test-message" role="status" aria-live="polite"></p>';
  container.insertAdjacentElement('afterend', block);
  const create = block.querySelector('#yk-test-create');
  const check = block.querySelector('#yk-test-status');
  const message = block.querySelector('#yk-test-message');
  const tg = window.Telegram?.WebApp;
  const uid = tg?.initDataUnsafe?.user?.id;
  const key = 'kurs_yookassa_test_' + String(uid || 'none');
  let state = null;
  try { state = JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) {}
  function save() { try { localStorage.setItem(key, JSON.stringify(state)); } catch (_) {} }
  function text(s) { message.textContent = s; }
  function auth() { if (!tg?.initData || !uid) { text('Откройте мини-приложение через бота @kursvpn_bot в Telegram.'); return false; } return true; }
  async function request(data) {
    const r = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, initData: tg.initData }), signal: AbortSignal.timeout(25000) });
    let payload; try { payload = await r.json(); } catch (_) { throw new Error('Ответ сервера не распознан.'); }
    if (!r.ok) { if (r.status === 401) throw new Error('Не удалось подтвердить Telegram. Закройте и заново откройте мини-приложение.'); throw new Error('Ошибка тестовой оплаты (' + r.status + '). Попробуйте позже.'); }
    if (payload.test !== true) throw new Error('Получен некорректный ответ тестовой оплаты.');
    return payload;
  }
  function setBusy(v) { create.disabled = v; check.disabled = v; }
  create.addEventListener('click', async () => {
    if (!auth()) return;
    const selected = document.querySelector('.plan[aria-pressed="true"]');
    const plan = plans[selected?.dataset.plan];
    if (!plan) { text('Сначала выберите тариф выше.'); return; }
    if (!state || state.plan !== plan || state.paymentId) {
      if (!crypto.randomUUID) { text('Ваш браузер не поддерживает безопасное создание платежа.'); return; }
      state = { plan, requestId: crypto.randomUUID() }; save();
    }
    setBusy(true); text('Создаём тестовый платёж…');
    try {
      const result = await request({ action: 'create', plan: state.plan, requestId: state.requestId });
      const target = new URL(result.confirmationUrl);
      if (target.protocol !== 'https:' || !['yoomoney.ru', 'yookassa.ru'].includes(target.hostname) || typeof result.paymentId !== 'string') throw new Error('Некорректная ссылка тестовой оплаты.');
      state.paymentId = result.paymentId; save();
      text('Откроется тестовая страница ЮKassa. После оплаты вернитесь сюда и нажмите «Проверить результат оплаты».');
      if (tg?.openLink) tg.openLink(target.href); else window.open(target.href, '_blank', 'noopener,noreferrer');
    } catch (e) { text(e.message || 'Не удалось создать тестовый платёж. Попробуйте ещё раз.'); }
    finally { setBusy(false); }
  });
  check.addEventListener('click', async () => {
    if (!auth()) return;
    if (!state?.paymentId) { text('Сначала создайте тестовый платёж на этом устройстве.'); return; }
    setBusy(true); text('Проверяем тестовый платёж…');
    try {
      const result = await request({ action: 'status', paymentId: state.paymentId });
      if (result.status === 'succeeded') text('Тестовый платёж успешен! Деньги не списаны, подписка и VPN не активированы.');
      else if (result.status === 'canceled') text('Тестовый платёж отменён.');
      else text('Тестовый платёж ещё не завершён. Завершите его на странице ЮKassa и проверьте снова.');
    } catch (e) { text(e.message || 'Не удалось проверить платёж.'); }
    finally { setBusy(false); }
  });
})();
