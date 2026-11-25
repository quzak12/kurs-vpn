'use strict';

(() => {
  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  const backend = window.KURS_BACKEND_URL;
  if (!backend) return;

  let api;
  try {
    api = new URL(backend);
    if (api.protocol !== 'https:' || api.username || api.password || api.pathname !== '/' || api.search || api.hash) throw new Error('Invalid API origin');
  } catch {
    set('account-note', 'Адрес сервера настроен неверно. Обратитесь в поддержку.');
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

  const note = document.getElementById('account-note');
  const retry = document.createElement('button');
  retry.className = 'back';
  retry.type = 'button';
  retry.textContent = 'Повторить проверку ↻';
  retry.hidden = true;
  note?.insertAdjacentElement('afterend', retry);
  let loading = false;

  async function loadAccount() {
    if (loading) return;
    loading = true;
    retry.hidden = true;
    set('subscription-status', 'Проверяем подписку…');
    set('home-status', 'Проверяем…');
    set('account-note', 'Проверяем данные аккаунта.');
    set('subscription-date', 'Дата не задана');
    set('subscription-time', 'Время не задано');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(new URL('/api/me', api), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: tg.initData }),
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = new Error('Account request failed');
        error.status = response.status;
        throw error;
      }
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
    } catch (error) {
      let detail;
      if (error?.status === 401) {
        detail = 'Ошибка авторизации Telegram (401). Закройте Mini App и откройте его заново через бота.';
      } else if (error?.status === 403) {
        detail = 'Доступ к серверу запрещён (403). Обратитесь в поддержку.';
      } else if (error?.status) {
        detail = `Сервер вернул ошибку (${error.status}). Попробуйте позже.`;
      } else if (error?.name === 'AbortError') {
        detail = 'Сервер не ответил вовремя. Проверьте соединение и повторите.';
      } else {
        detail = 'Не удалось связаться с сервером. Проверьте соединение и повторите.';
      }
      set('subscription-status', 'Не удалось проверить подписку');
      set('subscription-description', detail);
      set('home-status', 'Ошибка');
      set('home-title', 'Не удалось проверить подписку');
      set('home-description', detail);
      set('account-note', detail);
      retry.hidden = false;
    } finally {
      clearTimeout(timer);
      loading = false;
    }
  }
  retry.addEventListener('click', loadAccount);
  loadAccount();
})();
