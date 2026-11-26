/* Displays verified subscription state only. No payments or card data. */
(() => {
  const button = document.getElementById('manage-open');
  if (!button) return;
  const plans = {month:'1 месяц', quarter:'3 месяца', year:'1 год'};
  let actual = null, test = null;
  const set = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = value; };
  function update() {
    const realActive = actual?.active === true;
    const testActive = test?.active === true;
    button.hidden = !realActive && !testActive;
    if (button.hidden) return;
    const current = realActive ? actual : test;
    const isTest = !realActive;
    button.querySelector('span:first-child').textContent = isTest ? '⚙  Управлять тестовой подпиской' : '⚙  Управлять подпиской';
    set('manage-mode', isTest ? 'Тестовый режим: реальная подписка и VPN не активируются.' : 'Информация о вашем доступе');
    set('manage-badge', isTest ? 'Тестовая подписка' : 'Подписка активна');
    set('manage-current', isTest ? (plans[current.plan] || 'Тариф не определён') : (plans[current.plan] || 'Тариф пока не указан'));
    const date = current.expiresAt ? new Date(current.expiresAt) : null;
    set('manage-expires', date && !Number.isNaN(date.getTime()) ? 'Действует до ' + date.toLocaleString('ru-RU', {year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}) : 'Дата окончания не указана');
  }
  window.addEventListener('kurs:account-subscription', e => { actual = e.detail; update(); });
  window.addEventListener('kurs:test-subscription', e => { test = e.detail; update(); });
})();
