/* Admin-only self-test and explicitly confirmed broadcasts. */
(() => {
  const tg = window.Telegram?.WebApp;
  const support = document.querySelector('#support');
  if (!tg?.initData || !support) return;
  const api = 'https://functions.yandexcloud.net/d4e7m8n8n4osqvg417vo';
  async function call(data) {
    const response = await fetch(api, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...data, initData: tg.initData}), signal: AbortSignal.timeout(30000)});
    let result; try { result = await response.json(); } catch (_) { throw new Error('Неверный ответ сервера.'); }
    if (!response.ok) {
      if (response.status === 409 && result.broadcastStatus === 'too_many') throw new Error('Больше 50 пользователей. Нужна версия для большой аудитории.');
      if (response.status === 409 && result.broadcastStatus === 'empty') throw new Error('В базе нет получателей.');
      if (response.status === 409 && result.broadcastStatus === 'preview_changed') throw new Error('Текст или число получателей изменились. Проверь заново.');
      if (response.status === 409 && result.broadcastStatus === 'claim_failed') throw new Error('Не удалось подтвердить шаг. Проверь статус и продолжи позже.');
      if (response.status === 404 && result.broadcastStatus === 'not_found') throw new Error('Рассылка не найдена. Никакой новый запуск не начат.');
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
      <p>Тест с картинкой получишь только ты. Для рассылки есть отдельная кнопка ниже.</p>
      <label for="broadcast-selftest-text" style="display:block;margin-top:16px">Текст сообщения</label>
      <textarea id="broadcast-selftest-text" maxlength="512" rows="9" style="width:100%;margin-top:8px;padding:12px;border:1px solid #304a5e;border-radius:12px;background:#081a2d;color:#f3f8fb;font:inherit;resize:vertical"></textarea>
      <label for="broadcast-selftest-secret" style="display:block;margin-top:16px">Пароль панели</label>
      <input id="broadcast-selftest-secret" type="password" autocomplete="off" maxlength="256" style="width:100%;margin-top:8px;padding:12px;border:1px solid #304a5e;border-radius:12px;background:#081a2d;color:#f3f8fb;font:inherit">
      <label style="display:flex;gap:8px;align-items:flex-start;margin-top:16px;font-size:13px;color:#b1c5d3"><input type="checkbox" id="broadcast-selftest-confirm">Подтверждаю отправку одного тестового сообщения только себе</label>
      <button type="button" class="primary" id="broadcast-selftest-send">Отправить тест себе</button>
      <p id="broadcast-selftest-result" role="status" aria-live="polite" style="margin-top:12px"></p>
      <hr style="border:0;border-top:1px solid #304a5e;margin:22px 0">
      <h2>Рассылка пользователям</h2>
      <p>Картинка и текст выше. До 50 пользователей из базы. Каждый запуск может отправить сообщение повторно.</p>
      <button type="button" class="primary" id="broadcast-preview">Проверить получателей</button>
      <p id="broadcast-progress" role="status" aria-live="polite" style="margin-top:12px"></p>
      <button type="button" class="primary" id="broadcast-start" hidden>Отправить всем</button>
      <button type="button" class="primary" id="broadcast-resume" hidden>Проверить и продолжить последнюю рассылку</button>`;
    support.appendChild(card);
    const text = card.querySelector('#broadcast-selftest-text');
    const secret = card.querySelector('#broadcast-selftest-secret');
    const confirm = card.querySelector('#broadcast-selftest-confirm');
    const button = card.querySelector('#broadcast-selftest-send');
    const result = card.querySelector('#broadcast-selftest-result');
    const previewButton = card.querySelector('#broadcast-preview');
    const startButton = card.querySelector('#broadcast-start');
    const resumeButton = card.querySelector('#broadcast-resume');
    const progress = card.querySelector('#broadcast-progress');
    const storageKey = 'kurs-broadcast-last-run-v2';
    let preview = null, runId = '';
    try { runId = localStorage.getItem(storageKey) || ''; } catch (_) {}
    if (!/^[a-f0-9]{32}$/.test(runId)) runId='';
    resumeButton.hidden = !runId;
    function clearPreview() { preview=null; startButton.hidden=true; }
    text.addEventListener('input',clearPreview);
    secret.addEventListener('input',clearPreview);
    function setBusy(busy) { previewButton.disabled=busy; startButton.disabled=busy; resumeButton.disabled=busy; button.disabled=busy; text.disabled=busy; secret.disabled=busy; }
    function showProgress(r) {
      if (r.broadcastStatus!=='progress' || !['total','sent','failed','uncertain','remaining'].every(k=>Number.isInteger(r[k]) && r[k]>=0)) throw new Error('Неверный ответ сервера.');
      progress.textContent='Отправлено: '+r.sent+' из '+r.total+'. Ошибок: '+r.failed+'. В процессе или неизвестно: '+r.uncertain+'. Осталось: '+r.remaining+'.';
    }
    async function continueRun() {
      let r=await call({action:'broadcast_status',runId,secret:secret.value});
      showProgress(r);
      while(r.remaining>0) {
        r=await call({action:'broadcast_step',runId,secret:secret.value});
        showProgress(r);
      }
      resumeButton.hidden=false;
      if(r.uncertain) progress.textContent+=' Проверь неизвестный результат, прежде чем начинать новую рассылку.';
      else progress.textContent+=' Рассылка завершена.';
    }
    previewButton.addEventListener('click',async()=>{
      clearPreview();
      if(!text.value.trim() || !secret.value){progress.textContent='Введи текст и пароль панели.';return;}
      setBusy(true);progress.textContent='Проверяем базу…';
      try {const r=await call({action:'preview_broadcast',text:text.value,secret:secret.value});
        if(r.broadcastStatus!=='ready'||!Number.isInteger(r.count)||r.count<1||r.count>50||typeof r.textHash!=='string') throw new Error('Не удалось проверить получателей.');
        preview={count:r.count,textHash:r.textHash};startButton.hidden=false;
        progress.textContent='Найдено в базе: '+r.count+'. При повторном запуске они могут получить это сообщение ещё раз.';
      } catch(e){progress.textContent=e.message||'Ошибка проверки.';}finally{setBusy(false);}
    });
    startButton.addEventListener('click',async()=>{
      if(!preview)return;
      if(!window.confirm('Отправить картинку и текст '+preview.count+' пользователям из базы? При повторном запуске они могут получить сообщение ещё раз.'))return;
      const p=preview;clearPreview();setBusy(true);
      try {
        const bytes=new Uint8Array(16);window.crypto.getRandomValues(bytes);runId=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
        try{localStorage.setItem(storageKey,runId);}catch(_){}
        resumeButton.hidden=false;progress.textContent='Создаём рассылку…';
        await call({action:'create_broadcast',runId,text:text.value,secret:secret.value,confirm:true,expectedCount:p.count,textHash:p.textHash});
        await continueRun();
      } catch(e){progress.textContent=(e.message||'Ошибка.')+' Проверь статус последней рассылки перед новым запуском.';}
      finally{setBusy(false);}
    });
    resumeButton.addEventListener('click',async()=>{
      if(!runId||!secret.value){progress.textContent='Введи пароль панели.';return;}
      clearPreview();setBusy(true);progress.textContent='Проверяем сохранённый статус…';
      try{await continueRun();}catch(e){progress.textContent=(e.message||'Ошибка.')+' Не начинай новую рассылку, пока не проверишь результат.';}
      finally{setBusy(false);}
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
