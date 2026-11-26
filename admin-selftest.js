/* Admin-only photo self-test and one-time, confirmed broadcast. */
(() => {
  const tg = window.Telegram?.WebApp;
  const support = document.querySelector('#support');
  if (!tg?.initData || !support) return;
  const api = 'https://functions.yandexcloud.net/d4e7m8n8n4osqvg417vo';
  async function call(data) {
    const response = await fetch(api, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...data, initData: tg.initData}), signal: AbortSignal.timeout(135000)});
    let result; try { result = await response.json(); } catch (_) { throw new Error('Неверный ответ сервера.'); }
    if (!response.ok) {
      if (response.status === 409 && result.broadcastStatus === 'already_started') throw new Error('Эта рассылка уже запускалась. Повторная отправка заблокирована.');
      if (response.status === 409 && result.broadcastStatus === 'too_many') throw new Error('Больше пяти получателей: нужна расширенная версия. Никому не отправлено.');
      if (response.status === 409 && result.broadcastStatus === 'empty') throw new Error('В базе пока нет получателей.');
      if (response.status === 409 && result.broadcastStatus === 'preview_changed') throw new Error('Текст или число получателей изменились. Проверь заново.');
      if (response.status === 409 && result.broadcastStatus === 'claim_failed') throw new Error('Не удалось проверить запуск. Не повторяй: сначала проверь результат.');
      if (response.status === 503 && result.broadcastStatus === 'database') throw new Error('Не удалось прочитать базу. Проверь настройки YDB и сервисный аккаунт.');
      if (response.status === 403) throw new Error('Доступ отклонён. Проверь пароль и аккаунт Telegram.');
      if (response.status === 502 && Number.isInteger(result.telegramStatus)) throw new Error('Ошибка Telegram: ' + result.telegramStatus + '. Сообщи этот код поддержке.');
      if (response.status === 502 && result.relayStatus === 'network') throw new Error('Нет связи с Cloudflare. Проверь чат перед повтором: сообщение могло прийти.');
      if (response.status === 502 && result.relayStatus === 'telegram_network') throw new Error('Cloudflare не получил ответ Telegram. Проверь чат перед повтором.');
      if (response.status === 502 && result.relayStatus === 'rejected') throw new Error('Ошибка Cloudflare (' + result.relayHttp + '). Проверь настройки посредника.');
      if (response.status === 502 && result.telegramStatus === 'network') { const kinds = { dns: 'DNS', tls: 'TLS', timeout: 'таймаут', connection: 'соединение', other: 'другое' }; throw new Error('Ошибка сети Telegram: ' + (kinds[result.networkKind] || 'неизвестно') + '.'); }
      throw new Error('Не удалось выполнить запрос (' + response.status + ').');
    }
    return result;
  }
  async function init() {
    try {
      const access = await call({action: 'check'});
      if (access.admin !== true || access.testOnly !== true) return;
    } catch (_) { return; }
    const card = document.createElement('div');
    card.className = 'card';
    card.style.marginTop = '20px';
    card.innerHTML = `<h2>Тест рассылки</h2>
      <p>Сначала проверь сообщение с картинкой. Рассылка запускается отдельной кнопкой.</p>
      <label for="broadcast-selftest-text" style="display:block;margin-top:16px">Текст сообщения</label>
      <textarea id="broadcast-selftest-text" maxlength="512" rows="9" style="width:100%;margin-top:8px;padding:12px;border:1px solid #304a5e;border-radius:12px;background:#081a2d;color:#f3f8fb;font:inherit;resize:vertical"></textarea>
      <label for="broadcast-selftest-secret" style="display:block;margin-top:16px">Пароль панели</label>
      <input id="broadcast-selftest-secret" type="password" autocomplete="off" maxlength="256" style="width:100%;margin-top:8px;padding:12px;border:1px solid #304a5e;border-radius:12px;background:#081a2d;color:#f3f8fb;font:inherit">
      <label style="display:flex;gap:8px;align-items:flex-start;margin-top:16px;font-size:13px;color:#b1c5d3"><input type="checkbox" id="broadcast-selftest-confirm">Подтверждаю отправку одного тестового сообщения только себе</label>
      <button type="button" class="primary" id="broadcast-selftest-send">Отправить тест себе</button>
      <p id="broadcast-selftest-result" role="status" aria-live="polite" style="margin-top:12px"></p>
      <hr style="border:0;border-top:1px solid #304a5e;margin:22px 0">
      <h2>Рассылка пользователям</h2>
      <p>Новогодняя картинка и текст выше. Один запуск; сейчас не более 5 пользователей из базы.</p>
      <button type="button" class="primary" id="broadcast-preview">Проверить получателей</button>
      <p id="broadcast-preview-result" role="status" style="margin-top:12px"></p>
      <button type="button" class="primary" id="broadcast-send" hidden>Отправить всем</button>`;
    support.appendChild(card);
    const text = card.querySelector('#broadcast-selftest-text');
    const secret = card.querySelector('#broadcast-selftest-secret');
    const confirm = card.querySelector('#broadcast-selftest-confirm');
    const button = card.querySelector('#broadcast-selftest-send');
    const result = card.querySelector('#broadcast-selftest-result');
    const previewButton = card.querySelector('#broadcast-preview');
    const broadcastButton = card.querySelector('#broadcast-send');
    const broadcastResult = card.querySelector('#broadcast-preview-result');
    let preview = null;
    function clearPreview() { preview = null; broadcastButton.hidden = true; }
    text.addEventListener('input', clearPreview);
    secret.addEventListener('input', clearPreview);
    previewButton.addEventListener('click', async () => {
      clearPreview();
      if (!text.value.trim() || !secret.value) { broadcastResult.textContent='Введи текст и пароль панели.'; return; }
      previewButton.disabled=true; broadcastResult.textContent='Проверяем базу…';
      try { const r=await call({action:'preview_broadcast',text:text.value,secret:secret.value});
        if (r.broadcastStatus!=='ready' || !Number.isInteger(r.count) || r.count<1 || r.count>5 || typeof r.textHash!=='string') throw new Error('Не удалось проверить получателей.');
        preview={count:r.count,textHash:r.textHash}; broadcastButton.hidden=false;
        broadcastResult.textContent='Найдено пользователей в базе: '+r.count+'. Кому бот недоступен, тому сообщение не придёт.';
      } catch(e) { broadcastResult.textContent=e.message||'Ошибка проверки.'; }
      finally {previewButton.disabled=false;}
    });
    broadcastButton.addEventListener('click', async () => {
      if (!preview) return;
      if (!window.confirm('Отправить новогоднюю картинку и текст всем '+preview.count+' пользователям из базы от имени бота? Отменить отправку нельзя.')) return;
      const current=preview; clearPreview(); previewButton.disabled=true; broadcastButton.disabled=true;
      broadcastResult.textContent='Отправляем. Не закрывай окно…';
      try { const r=await call({action:'send_broadcast',text:text.value,secret:secret.value,confirm:true,expectedCount:current.count,textHash:current.textHash});
        if(r.broadcastStatus!=='finished') throw new Error('Результат не подтверждён. Не запускай повторно.');
        broadcastResult.textContent='Отправлено: '+r.sent+' из '+r.total+'. Ошибок доставки: '+r.failed+'. Неизвестный результат: '+r.uncertain+'. Повторная отправка заблокирована.';
        secret.value=''; confirm.checked=false;
      } catch(e) { broadcastResult.textContent=(e.message||'Ошибка отправки.')+' Не запускай повторно до проверки результата.'; }
      finally {previewButton.disabled=false;broadcastButton.disabled=false;}
    });
    text.value = '🎄 Новогодний розыгрыш от KURS VPN!\n\nПосле запуска сервиса каждый, кто купит подписку KURS VPN, автоматически станет участником новогоднего розыгрыша 🎁\n\nПодробности о призах, сроках и выборе победителей расскажем отдельно. Следите за новостями! ✨';
    button.addEventListener('click', async () => {
      if (!confirm.checked) { result.textContent = 'Сначала поставь галочку подтверждения.'; return; }
      if (!text.value.trim() || !secret.value) { result.textContent = 'Введи текст и пароль панели.'; return; }
      button.disabled = true;
      result.textContent = 'Отправляем тест только тебе…';
      try {
        const answer = await call({action:'self_test', text:text.value, secret:secret.value});
        if (answer.testOnly !== true || answer.sentToAdmin !== true) throw new Error('Не удалось подтвердить отправку.');
        secret.value = '';
        confirm.checked = false;
        result.textContent = 'Тест отправлен только тебе в чат с ботом. Другим пользователям ничего не отправлено.';
      } catch (e) { result.textContent = e.message || 'Не удалось отправить тест.'; }
      finally { button.disabled = false; }
    });
  }
  init();
})();
