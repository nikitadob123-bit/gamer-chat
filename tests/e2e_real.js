// E2E против РЕАЛЬНОГО Supabase-проекта (URL/anon key берутся из js/config.js). Тестовые пользователи создаются и удаляются.
// Очистка требует access token (env SBP_TOKEN_FILE) и ref проекта; без них пользователи остаются — удалите по префиксу ника.
const puppeteer = require('/workspace/gc-tools/node_modules/puppeteer-core');
const { start } = require('./static_server');
const path = require('path'), fs = require('fs'), https = require('https');
const ROOT = path.join(__dirname, '..'), SHOTS = path.join(ROOT, 'docs/screens');
const cfg = Function('var window={};' + fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8') + ';return window.GC_CONFIG')();
const REF = new URL(cfg.SUPABASE_URL).hostname.split('.')[0];
const LIVE = process.argv[2] || null;      // если передан URL — тестируем боевой сайт, иначе локальную копию
const RUN = Math.random().toString(36).slice(2, 6);
const PFX = 'gt' + RUN; const nick = s => PFX + '_' + s;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; function ok(c, m) { if (c) console.log('ok  -', m); else { console.log('FAIL -', m); fails++; process.exitCode = 1; } }

function sql(query) {
  const tok = fs.readFileSync(process.env.SBP_TOKEN_FILE, 'utf8').trim();
  return new Promise((res, rej) => {
    const r = https.request({ host: 'api.supabase.com', path: `/v1/projects/${REF}/database/query`, method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' } }, x => { let b = ''; x.on('data', d => b += d); x.on('end', () => res(b)); });
    r.on('error', rej); r.end(JSON.stringify({ query }));
  });
}
(async () => {
  const srv = LIVE ? null : await start(ROOT, 8750);
  const BASE = LIVE || 'http://127.0.0.1:8750/index.html';
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  try {
    async function user() {
      const ctx = await b.createBrowserContext(); const p = await ctx.newPage();
      await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      p.errs = []; p.ws = []; p.ext = [];
      p.on('pageerror', e => p.errs.push(e.message));
      p.on('request', r => { const u = new URL(r.url()); if (u.protocol.startsWith('http') && !/supabase\.co$/.test(u.hostname) && u.origin !== new URL(BASE).origin) p.ext.push(r.url()); });
      const cdp = await p.createCDPSession(); await cdp.send('Network.enable');
      cdp.on('Network.webSocketCreated', e => p.ws.push(e.url));
      await p.goto(BASE); await p.waitForSelector('#auth-nick'); return p;
    }
    async function clickText(p, sel, text) { const t0 = Date.now(); while (Date.now() - t0 < 8000) { const h = await p.evaluateHandle((s, t) => [...document.querySelectorAll(s)].find(e => e.textContent.includes(t) && e.offsetParent !== null), sel, text); if (h.asElement()) return h.asElement().click(); await sleep(100); } throw new Error('нет ' + text); }
    async function register(p, n) { await p.click('#seg-up'); await p.type('#auth-nick', n); await p.type('#auth-pass', 'secret123'); await p.click('#auth-submit'); await p.waitForSelector('.tabbar', { timeout: 20000 }); }
    const go = (p, h) => p.evaluate(x => { location.hash = x; }, h);

    const A = await user(), B = await user(), C = await user();
    ok(await A.evaluate(() => GC.api.mode) === 'supabase', 'клиент в режиме Supabase (' + (LIVE ? 'боевой URL' : 'локальная копия') + ')');
    await register(A, nick('alice')); await register(B, nick('bob')); await register(C, nick('carol'));
    ok(true, 'регистрация трёх пользователей на реальном Supabase Auth (ник → синтетический email → профиль через триггер)');
    const dup = await user(); await dup.click('#seg-up'); await dup.type('#auth-nick', nick('ALICE')); await dup.type('#auth-pass', 'secret123'); await dup.click('#auth-submit'); await sleep(1500);
    ok((await dup.$eval('.form-err', e => e.textContent)).includes('занят'), 'дубликат ника (другой регистр) отвергнут'); await dup.close();
    await A.evaluate(() => GC.api.signOut()); await A.reload(); await A.waitForSelector('#auth-nick');
    await A.type('#auth-nick', nick('alice')); await A.type('#auth-pass', 'wrongwrong'); await A.click('#auth-submit'); await sleep(1500);
    ok((await A.$eval('.form-err', e => e.textContent)).includes('Неверная'), 'неверный пароль отвергнут');
    await A.$eval('#auth-pass', e => e.value = ''); await A.type('#auth-pass', 'secret123'); await A.click('#auth-submit'); await A.waitForSelector('.tabbar');
    ok(true, 'вход по нику и паролю');
    await A.reload(); await A.waitForSelector('.tabbar', { timeout: 15000 }); ok(true, 'сессия сохраняется после перезагрузки');

    // Realtime подключён?
    for (const p of [A, B]) await p.waitForFunction(() => { const c = document.querySelector('.chip.live'); return c && c.classList.contains('on'); }, { timeout: 15000 }).catch(() => { });
    ok((await A.$eval('.chip.live', e => e.textContent)) === 'ONLINE' && (await B.$eval('.chip.live', e => e.textContent)) === 'ONLINE', 'Realtime-канал SUBSCRIBED у обоих (индикатор ONLINE)');
    ok(A.ws.some(u => u.startsWith('wss://') && u.includes('supabase.co/realtime')), 'открыт WebSocket к wss://…supabase.co/realtime');

    // ЛС Alice → Bob
    await go(A, '#/chats'); await sleep(300);
    await clickText(A, '.btn', '＋ ЛС'); await A.waitForSelector('#dm-search'); await A.type('#dm-search', nick('bob')); await sleep(1500);
    await clickText(A, '.sheet .row', nick('bob')); await A.waitForSelector('#msg-input'); await sleep(800);
    // Bob открывает чат заранее (ждёт сообщение в открытом окне — проверка Realtime, а не опроса)
    await go(B, '#/chats'); await sleep(1200);
    await A.type('#msg-input', 'Секрет Alice→Bob <b>x</b>'); await A.click('#send-btn');
    const t0 = Date.now();
    await B.waitForFunction(() => document.querySelector('#chat-list') && document.querySelector('#chat-list').textContent.includes('Секрет Alice'), { timeout: 15000 });
    const dtList = Date.now() - t0;
    ok(dtList < 3500, 'Bob получил ЛС в списке чатов по Realtime за ' + dtList + ' мс (резервный опрос = 4 с)');
    ok((await A.$$eval('#msgs b', e => e.length)) === 0, 'HTML экранирован');
    await A.screenshot({ path: path.join(SHOTS, '40-real-alice-dm.png') });
    await clickText(B, '.chat-row', nick('alice')); await B.waitForSelector('#msg-input'); await sleep(1000);
    const t1 = Date.now(); await B.type('#msg-input', 'Ответ Bob'); await B.click('#send-btn');
    await A.waitForFunction(() => document.querySelector('#msgs') && document.querySelector('#msgs').textContent.includes('Ответ Bob'), { timeout: 15000 });
    const dt = Date.now() - t1; ok(dt < 3500, 'Alice получила ответ в открытом чате по Realtime за ' + dt + ' мс (включая набор текста и отправку)');
    await B.screenshot({ path: path.join(SHOTS, '41-real-bob-dm.png') });

    // Приватность (Carol = третий)
    const chatId = await A.evaluate(async (n) => (await GC.api.listChats()).find(c => c.peer && c.peer.nick === n).id, nick('bob'));
    const res = await C.evaluate(async (id) => {
      const sb = GC.api._sb, o = {};
      o.msgs = (await sb.from('messages').select('*')).data.length;
      o.byId = (await sb.from('messages').select('*').eq('chat_id', id)).data.length;
      o.chats = (await sb.from('chats').select('*')).data.length;
      o.members = (await sb.from('chat_members').select('*').eq('chat_id', id)).data.length;
      o.list = (await sb.rpc('list_my_chats')).data.length;
      o.write = (await sb.from('messages').insert({ chat_id: id, body: 'вторжение' })).error?.code || 'NO ERROR';
      o.spoof = (await sb.from('messages').insert({ chat_id: id, body: 'x', sender_id: '00000000-0000-0000-0000-000000000000' })).error?.code || 'NO ERROR';
      o.join = (await sb.from('chat_members').insert({ chat_id: id, user_id: GC.api.session().id })).error?.code || 'NO ERROR';
      const other = (await sb.from('profiles').select('id').neq('id', GC.api.session().id).limit(1)).data[0];
      o.hack = (await sb.from('profiles').update({ bio: 'hacked' }).eq('id', other.id).select()).data.length;
      o.dmOpenOthers = (await sb.rpc('open_dm', { other: other.id })).error ? 'err' : 'ok'; // открыть СВОЙ ЛС — допустимо
      return o;
    }, chatId);
    ok(res.msgs === 0 && res.byId === 0 && res.chats === 0 && res.members === 0 && res.list === 0, 'RLS (реальный проект): Carol не видит чужие ЛС/чаты/участников/сообщения');
    ok(res.write !== 'NO ERROR' && res.spoof !== 'NO ERROR' && res.join !== 'NO ERROR', 'RLS: запись в чужой чат / подмена sender_id / самовступление отвергнуты (' + [res.write, res.spoof, res.join] + ')');
    ok(res.hack === 0, 'RLS: чужой профиль изменить нельзя');
    // Carol не получает чужие сообщения по Realtime
    await C.evaluate(() => { window.__rt = []; GC.api._sb.channel('spy').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, p => window.__rt.push(p.new.body)).subscribe(); });
    await sleep(2500);
    await A.type('#msg-input', 'Ещё одно секретное'); await A.click('#send-btn'); await sleep(3500);
    ok((await C.evaluate(() => window.__rt.length)) === 0, 'Realtime: Carol не получает события чужих сообщений');
    // anon без входа
    const anon = await C.evaluate(async (u, k) => {
      const out = {};
      for (const t of ['messages', 'profiles', 'chats', 'servers', 'lfg_posts', 'match_results', 'polls']) { const r = await fetch(u + '/rest/v1/' + t + '?select=*', { headers: { apikey: k, Authorization: 'Bearer ' + k } }); out[t] = r.status + ':' + (await r.text()).slice(0, 40); }
      const rp = await fetch(u + '/rest/v1/rpc/open_dm', { method: 'POST', headers: { apikey: k, Authorization: 'Bearer ' + k, 'Content-Type': 'application/json' }, body: '{"other":"00000000-0000-0000-0000-000000000000"}' });
      out.rpc = rp.status; return out;
    }, cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    ok(Object.keys(anon).filter(k => k !== 'rpc').every(k => /^(401|403)/.test(anon[k]) || /^200:\[\]/.test(anon[k])) && !Object.values(anon).some(v => String(v).includes('Секрет')), 'anon key без входа ничего не читает: ' + JSON.stringify(anon).slice(0, 200));
    ok([401, 403, 404].includes(anon.rpc), 'anon не вызывает open_dm (HTTP ' + anon.rpc + ')');

    // Сервер по коду
    await go(A, '#/servers'); await sleep(500); await clickText(A, '.btn', '＋ Создать'); await A.waitForSelector('#srv-name'); await sleep(200); await A.type('#srv-name', 'Гильдия ' + RUN); await clickText(A, '.sheet .btn', 'Создать сервер');
    await A.waitForSelector('#invite-code', { timeout: 10000 }); const code = await A.$eval('#invite-code', e => e.textContent); ok(/^[A-Z0-9]{10}$/.test(code), 'сервер создан, код ' + code);
    await A.screenshot({ path: path.join(SHOTS, '42-real-server.png') });
    ok((await C.evaluate(async () => (await GC.api._sb.from('servers').select('*')).data.length)) === 0, 'RLS: сервер не виден не-участнику');
    await go(B, '#/servers'); await sleep(500); await clickText(B, '.btn', 'Вступить'); await B.waitForSelector('#join-code'); await sleep(200); await B.type('#join-code', code.toLowerCase()); await clickText(B, '.sheet .btn', 'Вступить');
    await B.waitForSelector('#invite-code'); ok((await B.$eval('.srv-hero', e => e.textContent)).includes('Гильдия ' + RUN), 'Bob вступил по коду');
    await B.click('.chan'); await B.waitForSelector('#msg-input'); await sleep(1000);
    await A.evaluate(() => { location.hash = '#/servers'; }); await sleep(500); await clickText(A, '.row[data-server]', 'Гильдия'); await A.waitForSelector('.chan'); await A.click('.chan'); await A.waitForSelector('#msg-input'); await sleep(1000);
    await B.type('#msg-input', 'Bob в канале'); await B.click('#send-btn');
    await A.waitForFunction(() => document.querySelector('#msgs').textContent.includes('Bob в канале'), { timeout: 10000 }); ok(true, 'сообщение в канале сервера дошло до владельца (Realtime)');
    ok((await C.evaluate(async () => (await GC.api._sb.from('messages').select('*')).data.length)) === 0, 'RLS: сообщения канала не видны не-участнику');
    await B.screenshot({ path: path.join(SHOTS, '43-real-channel.png') });

    // Опрос в ЛС A↔B
    await go(A, '#/chats'); await sleep(500); await clickText(A, '.chat-row', nick('bob')); await A.waitForSelector('#poll-btn'); await sleep(800);
    await go(B, '#/chats'); await sleep(500); await clickText(B, '.chat-row', nick('alice')); await B.waitForSelector('#poll-btn'); await sleep(800);
    await A.click('#poll-btn'); await A.waitForSelector('#poll-q'); await sleep(200); await clickText(A, '.sheet .btn', 'Создать');
    await B.waitForSelector('.poll .opt', { timeout: 10000 }); ok(true, 'опрос появился у Bob (Realtime)');
    await A.waitForSelector('.poll .opt'); await sleep(500); await A.click('.poll .opt'); await sleep(1200);
    await B.evaluate(() => document.querySelectorAll('.poll .opt')[1].click());
    await A.waitForFunction(() => document.querySelector('.poll').textContent.includes('2 голоса'), { timeout: 10000 });
    ok(true, 'голоса синхронизируются: 2 голоса (Realtime)'); await B.screenshot({ path: path.join(SHOTS, '44-real-poll.png') });
    ok((await C.evaluate(async () => (await GC.api._sb.from('poll_votes').select('*')).data.length)) === 0, 'RLS: голоса не видны постороннему');

    // LFG
    await go(A, '#/lfg'); await sleep(500); await clickText(A, '.btn', 'Ищу пати'); await A.waitForSelector('#l-game'); await sleep(200);
    await A.select('#l-game', 'Valorant'); await A.select('#l-rank', 'Gold'); await A.type('#l-time', 'Сегодня 22:00'); await clickText(A, '.sheet .btn', 'Опубликовать');
    await go(B, '#/lfg'); await B.waitForSelector('.lfg', { timeout: 10000 }); await B.select('#f-game', 'Valorant'); await sleep(300);
    ok((await B.$$eval('.lfg', e => e.length)) === 1, 'Bob видит объявление Alice; фильтр по игре'); await B.select('#f-rank', 'Diamond'); await sleep(200);
    ok((await B.$$eval('.lfg', e => e.length)) === 0, 'фильтр по рангу скрывает несоответствующие'); await B.select('#f-rank', '');  await sleep(200);
    await B.click('.respond'); await B.waitForSelector('#msg-input'); await B.waitForFunction(() => document.querySelector('#msg-input').value.includes('Откликаюсь'), { timeout: 10000 }).catch(() => {}); await sleep(300);
    ok((await B.$eval('.chat-head', e => e.textContent)).includes(nick('alice')) && (await B.$eval('#msg-input', e => e.value)).includes('Откликаюсь'), 'Откликнуться → ЛС с автором и готовый текст');
    await B.screenshot({ path: path.join(SHOTS, '45-real-lfg-respond.png') });
    // статистика
    await go(A, '#/me'); await A.waitForSelector('#res-game'); await clickText(A, '.btn', '🏆 Победа'); await sleep(700); await clickText(A, '.btn', '🏆 Победа'); await sleep(700); await clickText(A, '.btn', '💀 Поражение'); await sleep(900);
    ok((await A.$eval('#st-rate', e => e.textContent)) === '67%', 'статистика в БД: 2П/1Пор = 67%');
    // лимит длины на сервере
    ok(await A.evaluate(async (id) => (await GC.api._sb.from('messages').insert({ chat_id: id, body: 'x'.repeat(2001) })).error?.code, chatId) === '23514', 'БД отвергает сообщение >2000 символов');
    // профиль
    await A.evaluate(async () => { await GC.api.updateProfile({ status_game: 'Valorant', games: [{ game: 'Valorant', rank: 'Gold' }] }); });
    ok((await B.evaluate(async (n) => (await GC.api.findByNick(n)).status_game, nick('alice'))) === 'Valorant', 'статус «играю в…» сохранён и виден другому игроку');
    const errs = [A, B, C].flatMap(p => p.errs), ext = [A, B, C].flatMap(p => p.ext);
    ok(errs.length === 0, 'нет JS-ошибок' + (errs[0] ? ': ' + errs[0] : '')); ok(ext.length === 0, 'нет запросов к сторонним хостам' + (ext[0] ? ': ' + ext[0] : ''));
  } catch (e) { console.error('CRASH', e.message); fails++; process.exitCode = 1; }
  await b.close(); if (srv) srv.close();
  // очистка
  if (process.env.SBP_TOKEN_FILE) {
    const r = await sql(`delete from public.servers where owner_id in (select id from auth.users where email like 'gt${RUN}\\_%'); delete from auth.users where email like 'gt${RUN}\\_%' returning 1;`);
    const left = await sql(`select (select count(*) from auth.users where email like 'gt${RUN}\\_%') u, (select count(*) from public.profiles where nick like 'gt${RUN}\\_%') p, (select count(*) from public.chats where id not in (select chat_id from public.chat_members) and kind<>'channel') c`);
    console.log('cleanup:', r.slice(0, 60), left); ok(/"u":0,"p":0/.test(left), 'тестовые данные удалены');
  }
  console.log(fails ? fails + ' ПРОВАЛОВ' : 'E2E real Supabase: все проверки пройдены'); process.exit(fails ? 1 : 0);
})();
