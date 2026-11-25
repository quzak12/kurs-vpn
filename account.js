'use strict';

(() => {
  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  const backend = window.KURS_BACKEND_URL;
  if (!backend) return; // Preserve the demo while no backend is configured.

  let api;
  try {
    api = new URL(backend);
    if (api.protocol !== 'https:' || api.username || api.password || api.pathname !== '/' || api.search || api.hash) throw new Error('Invalid API origin');
  } catch {
    set('account-note', 'Кабинет временно недоступен. Обратитесь в поддержку.');
    set('subscription-status', 'Статус недоступен');
    set('home-status', 'Нет связи');
    return;
  }

  const tg = window.Telegram?.WebApp;
  if (!tg?.initData) {
    set('subscription-status', 'Нужен вход через Telegram');
    set('subscription-description', 'Откройте приложение через бота @kursvpn_bot.');
    set('home-status', 'Нужен вход');
    set('account-note', 'Откройте приложение через бота @kursvpn_bot, чтобы проверить подписку.');
    return;
  }

  set('subscription-status', 'Проверяем подписку…');
  set('home-status', 'Проверяем…');
  set('account-note', 'Проверяем данные аккаунта.');

  async function loadAccount() {
    try {
      const response = await fetch(new URL('/api/me', api), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: tg.initData }),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Unable to verify account');
      const account = await response.json();
      if (typeof account?.subscription?.active !== 'boolean') throw new Error('Invalid response');
      const active = account.subscription.active;
      set('subscription-status', active ? 'Подписка активна' : 'Подписка не активна');
      set('home-status', active ? 'Активна' : 'Не активна');
      set('home-title', active ? 'Подписка активна' : 'Подписка пока не активна');
      set('home-description', 'VPN-сервер и персональные ссылки пока не подключены.');
      set('subscription-description', 'VPN-сервер и персональные ссылки пока не подключены.');
      const expiry = account.subscription.expiresAt ? new Date(account.subscription.expiresAt) : null;
      if (expiry && !Number.isNaN(expiry.getTime())) {
        set('subscription-date', expiry.toLocaleDateString('ru-RU'));
        set('subscription-time', expiry.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
      }
      set('account-note', 'Статус относится к вашему аккаунту Telegram. Дата и время показаны в часовом поясе устройства.');
    } catch {
      set('subscription-status', 'Не удалось проверить подписку');
      set('subscription-description', 'Попробуйте позже или обратитесь в поддержку.');
      set('home-status', 'Нет связи');
      set('home-title', 'Не удалось проверить подписку');
      set('home-description', 'Попробуйте позже или обратитесь в поддержку.');
      set('account-note', 'Не удалось получить данные кабинета.');
    }
  }
  loadAccount();
})();
