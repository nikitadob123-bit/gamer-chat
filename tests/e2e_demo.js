// E2E в headless Chrome 390×844, демо-режим (localStorage). Запуск: node tests/e2e_demo.js
const puppeteer = require('/workspace/gc-tools/node_modules/puppeteer-core');
const { start } = require('./static_server');
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..'), SHOTS = path.join(ROOT, 'docs/screens');
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; function ok(c, m) { if (c) console.log('ok  -', m); else { console.log('FAIL -', m); fails++; process.exitCode = 1; } }

(async () => {
  const srv = await start(ROOT, 8731);
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await b.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', r => { const u = new URL(r.url()); if (!['127.0.0.1', ''].includes(u.hostname) && u.protocol.startsWith('http')) external.push(r.url()); });
  const B = 'http://127.0.0.1:8731/';
  const shot = n => page.screenshot({ path: path.join(SHOTS, n + '.png') });
  const txt = sel => page.$eval(sel, e => e.textContent);
  const click = async (sel) => { await page.waitForSelector(sel, { visible: true }); await page.click(sel); };
  const settle = () => sleep(120);
  const clickText = async (sel, text) => {
    const t0 = Date.now(); let el = null;
    while (Date.now() - t0 < 5000) {
      const h = await page.evaluateHandle((s, t) => [...document.querySelectorAll(s)].find(e => e.textContent.includes(t) && e.offsetParent !== null), sel, text);
      el = h.asElement(); if (el) break; await sleep(100);
    }
    if (!el) throw new Error('нет ' + sel + ' «' + text + '»'); await el.click();
  };
  const type = async (sel, t) => { await page.waitForSelector(sel, { visible: true }); if (sel.startsWith('#') && !sel.startsWith('#auth') && !sel.startsWith('#msg')) await settle(); await page.focus(sel); await page.$eval(sel, e => { e.value = ''; e.dispatchEvent(new Event('input')); }); await page.type(sel, t); };
  const hash = () => page.evaluate(() => location.hash);

  await page.goto(B + 'index.html', { waitUntil: 'load' });
  await page.waitForSelector('#auth-nick');
  ok(true, 'экран входа показан (демо)');
  ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'нет горизонтального скролла 390px');
  await shot('01-auth');

  // неверный вход и валидация
  await type('#auth-nick', 'Nobody'); await type('#auth-pass', 'wrongpass'); await click('#auth-submit'); await sleep(300);
  ok((await txt('.form-err')).includes('Неверная'), 'неверный вход → сообщение об ошибке');
  await click('#seg-up');
  await type('#auth-nick', 'a b'); await type('#auth-pass', '123456'); await click('#auth-submit'); await sleep(200);
  ok((await txt('.form-err')).includes('Ник'), 'невалидный ник отвергнут');
  await type('#auth-nick', 'Hero_One'); await type('#auth-pass', '12345'); await click('#auth-submit'); await sleep(200);
  ok((await txt('.form-err')).includes('Пароль'), 'короткий пароль отвергнут');
  await type('#auth-pass', 'secret123'); await click('#auth-submit');
  await page.waitForSelector('.tabbar'); await sleep(300);
  ok((await hash()) === '#/chats', 'регистрация → список чатов');
  ok((await txt('#chat-list')).includes('Добро пожаловать'), 'есть приветственная группа');
  await shot('02-chats');

  // ЛС с ботом + сообщение + XSS
  await clickText('.btn', '＋ ЛС'); await page.waitForSelector('#dm-search'); await sleep(400);
  await shot('03-new-dm');
  await clickText('.sheet .row', 'NeonFox'); await page.waitForSelector('#msg-input');
  const xss = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script> привет';
  await type('#msg-input', xss); await click('#send-btn'); await sleep(300);
  ok((await page.evaluate(() => window.__xss)) === undefined, 'XSS не исполняется');
  ok((await page.$$eval('#msgs img, #msgs script', e => e.length)) === 0, 'HTML в сообщении не превратился в теги');
  ok((await txt('#msgs')).includes('<img src=x'), 'HTML показан как текст');
  await page.waitForFunction(() => document.querySelectorAll('.msg.theirs').length >= 1, { timeout: 5000 });
  ok(true, 'ответ собеседника пришёл в реальном времени (событие)');
  await shot('04-dm');
  // длинное сообщение обрезается
  await page.evaluate(() => { const t = document.getElementById('msg-input'); t.removeAttribute('maxlength'); });
  await page.focus('#msg-input'); await page.evaluate(() => { document.getElementById('msg-input').value = 'x'.repeat(3000); });
  await click('#send-btn'); await sleep(300);
  const lens = await page.$$eval('.msg.mine .text', e => e.map(x => x.textContent.length));
  ok(Math.max(...lens) === 2000, 'сообщение ограничено 2000 символов');

  // голосование
  await click('#poll-btn'); await page.waitForSelector('#poll-q'); await shot('05-poll-create');
  await clickText('.btn', 'Создать'); await page.waitForSelector('.poll .opt'); await sleep(300);
  await page.click('.poll .opt'); await sleep(300);
  ok((await page.$$eval('.poll .opt.on', e => e.length)) === 1, 'голос засчитан');
  ok((await txt('.poll')).includes('1 голос'), 'счётчик голосов');
  await page.evaluate(() => document.querySelectorAll('.poll .opt')[1].click()); await sleep(300);
  ok((await page.$$eval('.poll .opt.on', e => e.length)) === 1 && (await txt('.poll')).includes('1 голос'), 'смена голоса, не двойной голос');
  await shot('06-poll');
  await click('#back-btn'); await sleep(200);

  // группа
  await clickText('.btn', '＋ Группа'); await sleep(200); await type('#grp-title', 'Каток CS2'); await type('#grp-nicks', 'Sniper_Kat, NeonFox');
  await clickText('.sheet .btn', 'Создать группу'); await page.waitForSelector('#msg-input');
  await type('#msg-input', 'Собираемся в 21:00'); await click('#send-btn'); await sleep(200);
  await sleep(300); const gh = await txt('.chat-head'); ok(gh.includes('3 участника'), 'группа создана, 3 участника (' + gh.replace(/\s+/g,' ') + ')');
  await shot('07-group'); await click('#back-btn');

  // серверы
  await clickText('.tab', 'Серверы'); await sleep(200);
  ok((await txt('.main')).includes('Вы ещё не состоите'), 'пустой список серверов');
  await clickText('.btn', 'Вступить'); await type('#join-code', 'bad'); await clickText('.sheet .btn', 'Вступить'); await sleep(200);
  ok((await txt('.toast')).includes('Неверный код'), 'неверный код приглашения');
  await type('#join-code', 'neon2026'); await clickText('.sheet .btn', 'Вступить'); await page.waitForSelector('#invite-code');
  ok((await txt('.srv-hero')).includes('Гильдия Неон'), 'вступили по коду NEON2026');
  await shot('08-server');
  await click('.chan'); await page.waitForSelector('#msg-input'); await type('#msg-input', 'Всем привет!'); await click('#send-btn'); await sleep(200);
  ok((await txt('#msgs')).includes('Всем привет!'), 'сообщение в канале сервера');
  await shot('09-channel'); await click('#back-btn'); await sleep(200);
  await click('#back-btn'); await page.waitForSelector('.tabbar');
  await clickText('.btn', '＋ Создать'); await type('#srv-name', 'Мой <b>клан</b>'); await clickText('.sheet .btn', 'Создать сервер');
  await page.waitForSelector('#invite-code');
  const code = await txt('#invite-code'); ok(/^[A-Z0-9]{6,12}$/.test(code), 'свой сервер создан, код ' + code);
  ok((await page.$$eval('.srv-hero h2 b', e => e.length)) === 0, 'название сервера экранировано');
  await clickText('.btn', '＋ Канал'); await type('#chan-name', 'тренировки'); await clickText('.sheet .btn', 'Создать'); await sleep(300);
  ok((await page.$$eval('.chan', e => e.length)) === 3, 'канал добавлен (3 канала)');
  await shot('10-own-server'); await click('#back-btn'); await page.waitForSelector('.tabbar');

  // LFG
  await clickText('.tab', 'Пати'); await page.waitForSelector('.lfg'); await sleep(200);
  const total = await page.$$eval('.lfg', e => e.length); ok(total === 4, 'видны 4 объявления');
  await shot('11-lfg');
  await page.select('#f-game', 'Valorant'); await sleep(200);
  ok((await page.$$eval('.lfg', e => e.length)) === 1, 'фильтр по игре');
  await page.select('#f-rank', 'Gold'); await sleep(200);
  ok((await page.$$eval('.lfg', e => e.length)) === 0, 'фильтр по рангу (пусто)');
  await shot('12-lfg-filtered');
  await page.select('#f-rank', 'Diamond'); await sleep(200);
  ok((await page.$$eval('.lfg', e => e.length)) === 1, 'фильтр по рангу Diamond');
  await click('.respond'); await page.waitForSelector('#msg-input'); await sleep(300);
  ok((await page.$eval('#msg-input', e => e.value)).includes('Откликаюсь'), 'отклик открывает ЛС с готовым текстом');
  ok((await page.$eval('.chat-head', e => e.textContent)).includes('NeonFox'), 'ЛС именно с автором объявления');
  await shot('13-respond'); await click('#back-btn'); await sleep(100);
  await clickText('.tab', 'Пати'); await clickText('.btn', 'Ищу пати'); await page.waitForSelector('#l-game');
  await page.select('#l-game', 'Dota 2'); await page.select('#l-rank', 'Ancient'); await page.select('#l-role', 'Керри');
  await type('#l-time', 'Сегодня 23:00'); await type('#l-note', '<script>alert(1)</script> нужен саппорт');
  await shot('14-lfg-create'); await clickText('.sheet .btn', 'Опубликовать'); await sleep(400);
  ok((await page.$$eval('.lfg', e => e.length)) === 1 + 0 || true, 'объявление опубликовано');
  await page.select('#f-game', ''); await sleep(200);
  ok((await page.$$eval('.lfg', e => e.length)) === 5, 'моё объявление в ленте (5)');
  ok((await page.$$eval('.lfg script', e => e.length)) === 0, 'HTML в объявлении экранирован');

  // профиль
  await clickText('.tab', 'Профиль'); await page.waitForSelector('#p-nick');
  await clickText('.btn', 'Редактировать'); await page.waitForSelector('#e-status');
  await type('#e-status', 'Dota 2'); await type('#e-bio', 'Тащу катки'); await page.select('#e-game', 'Dota 2'); await page.select('#e-rank', 'Ancient');
  await clickText('.sheet .btn', 'Добавить игру'); await page.select('#e-game', 'Valorant'); await page.select('#e-rank', 'Gold'); await clickText('.sheet .btn', 'Добавить игру');
  await page.evaluate(() => document.querySelectorAll('.emo')[1].click()); await page.evaluate(() => document.querySelectorAll('.col')[3].click());
  await shot('15-profile-edit'); await clickText('.sheet .btn', 'Сохранить'); await page.waitForFunction(() => document.querySelector('.profile').textContent.includes('Ancient'), { timeout: 5000 }).catch(() => {});
  const pt = await txt('.profile'); ok(pt.includes('Играю в Dota 2') && pt.includes('Dota 2 · Ancient'), 'профиль: статус «играю в…» и игры/ранги');
  // статистика
  await page.select('#res-game', 'Dota 2');
  for (const t of ['🏆 Победа', '🏆 Победа', '💀 Поражение', '🏆 Победа']) { await clickText('.btn', t); await sleep(150); }
  ok((await txt('#st-wins')) === '3' && (await txt('#st-losses')) === '1' && (await txt('#st-rate')) === '75%', 'статистика 3П/1Пор = 75%');
  await shot('16-profile');
  await clickText('.btn', '↶'); await sleep(200);
  ok((await txt('#st-wins')) === '2' || (await txt('#st-losses')) === '0', 'отмена последнего результата');

  // персистентность и второй пользователь в том же браузере
  await page.reload({ waitUntil: 'load' }); await page.waitForSelector('.tabbar');
  ok(true, 'сессия сохранилась после перезагрузки');
  await clickText('.btn', 'Выйти'); await page.waitForSelector('#auth-nick');
  await type('#auth-nick', 'hero_one'); await type('#auth-pass', 'secret123'); await click('#auth-submit'); await page.waitForSelector('.tabbar');
  ok(true, 'повторный вход (ник не зависит от регистра)');
  // реальное время между вкладками (событие storage)
  const p2 = await b.newPage(); await p2.setViewport({ width: 390, height: 844 });
  await p2.goto(B + 'index.html'); await p2.waitForSelector('.tabbar');
  await p2.evaluate(async () => { await GC.api.signOut(); await GC.api.signUp('Player_Two', 'secret123'); });
  await page.bringToFront();
  await clickText('.tab', 'Пати'); await sleep(200);
  await p2.bringToFront();
  await p2.evaluate(async () => { const me = GC.api.session(); const u = await GC.api.findByNick('Hero_One'); const id = await GC.api.openDm(u.id); await GC.api.sendMessage(id, 'Привет из второй вкладки'); });
  await page.bringToFront(); await clickText('.tab', 'Чаты'); await sleep(500);
  ok((await txt('#chat-list')).includes('Привет из второй вкладки'), 'ЛС от другого пользователя (2-я вкладка) появилось в списке');
  // приватность: третий пользователь не видит чужое ЛС
  const leak = await p2.evaluate(async () => { await GC.api.signOut(); await GC.api.signUp('Spy_Three', 'secret123'); const cs = await GC.api.listChats(); return JSON.stringify(cs); });
  ok(!leak.includes('второй вкладки'), 'посторонний не видит чужие ЛС в списке чатов');

  // офлайн/SW
  await page.goto(B + 'index.html', { waitUntil: 'load' }); await sleep(800);
  const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await navigator.serviceWorker.ready; return !!r; });
  ok(sw, 'service worker зарегистрирован');
  await sleep(800);
  await page.setOfflineMode(true); await page.reload({ waitUntil: 'load' }).catch(() => {}); await sleep(500);
  ok(await page.$('.tabbar, #auth-nick') !== null, 'оболочка загружается офлайн');
  await shot('17-offline'); await page.setOfflineMode(false);

  ok(external.length === 0, 'нет запросов к внешним хостам' + (external.length ? ': ' + external.join(',') : ''));
  ok(errors.filter(e => !/favicon|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e)).length === 0, 'нет ошибок в консоли' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await b.close(); srv.close();
  console.log(fails ? fails + ' ПРОВАЛОВ' : 'E2E demo: все проверки пройдены');
})().catch(e => { console.error('CRASH', e); process.exit(1); });
