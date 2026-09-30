// E2E клиента (js/remote.js) против ЛОКАЛЬНОГО стенда: настоящий Postgres со supabase/schema.sql + PostgREST + мок GoTrue.
// Это НЕ настоящий Supabase; Realtime (WebSocket) не проверяется — работает резервный опрос.
const puppeteer = require('/workspace/gc-tools/node_modules/puppeteer-core');
const { start } = require('./static_server'); const mock = require('./mock_backend');
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..'), SHOTS = path.join(ROOT, 'docs/screens');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; function ok(c, m) { if (c) console.log('ok  -', m); else { console.log('FAIL -', m); fails++; process.exitCode = 1; } }
(async () => {
  const api = await mock.start(8741, 8742, '/workspace/gc-tools/postgrest');
  const srv = await start(ROOT, 8740, { config: { SUPABASE_URL: 'http://127.0.0.1:8741', SUPABASE_ANON_KEY: mock.ANON }, csp: "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:8741 ws://127.0.0.1:8741" });
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  async function user() {
    const ctx = await b.createBrowserContext(); const p = await ctx.newPage();
    await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
    await p.goto('http://127.0.0.1:8740/index.html'); await p.waitForSelector('#auth-nick'); return p;
  }
  async function clickText(p, sel, text) { const t0 = Date.now(); while (Date.now() - t0 < 5000) { const h = await p.evaluateHandle((s, t) => [...document.querySelectorAll(s)].find(e => e.textContent.includes(t) && e.offsetParent !== null), sel, text); if (h.asElement()) return h.asElement().click(); await sleep(100); } throw new Error('нет ' + text); }
  async function register(p, nick) { await p.click('#seg-up'); await p.type('#auth-nick', nick); await p.type('#auth-pass', 'secret123'); await p.click('#auth-submit'); await p.waitForSelector('.tabbar'); }
  const A = await user(), B = await user(), C = await user();
  ok(await A.evaluate(() => GC.api.mode) === 'supabase', 'клиент в режиме Supabase (remote.js)');
  await register(A, 'Alice_A'); await register(B, 'Bob_B'); await register(C, 'Carol_C');
  ok(true, 'регистрация трёх пользователей (ник → синтетический email → профиль через триггер)');
  // дубль ника
  const D = await user(); await D.click('#seg-up'); await D.type('#auth-nick', 'alice_a'); await D.type('#auth-pass', 'secret123'); await D.click('#auth-submit'); await sleep(800);
  ok((await D.$eval('.form-err', e => e.textContent)).includes('занят'), 'дубликат ника (без учёта регистра) отвергнут'); await D.close();
  // неверный пароль
  await A.evaluate(() => GC.api.signOut()); await A.reload(); await A.waitForSelector('#auth-nick');
  await A.type('#auth-nick', 'Alice_A'); await A.type('#auth-pass', 'wrongwrong'); await A.click('#auth-submit'); await sleep(700);
  ok((await A.$eval('.form-err', e => e.textContent)).includes('Неверная'), 'неверный пароль отвергнут');
  await A.$eval('#auth-pass', e => e.value = ''); await A.type('#auth-pass', 'secret123'); await A.click('#auth-submit'); await A.waitForSelector('.tabbar');
  ok(true, 'вход по нику и паролю');

  // Alice → ЛС Bob
  await clickText(A, '.btn', '＋ ЛС'); await A.waitForSelector('#dm-search'); await A.type('#dm-search', 'Bob'); await sleep(900);
  await clickText(A, '.sheet .row', 'Bob_B'); await A.waitForSelector('#msg-input');
  await A.type('#msg-input', 'Привет, Bob! Секретное ЛС <b>1</b>'); await A.click('#send-btn'); await sleep(800);
  ok((await A.$eval('#msgs', e => e.textContent)).includes('Секретное ЛС'), 'Alice отправила сообщение');
  ok((await A.$$eval('#msgs b', e => e.length)) === 0, 'HTML экранирован');
  await A.screenshot({ path: path.join(SHOTS, '20-remote-alice-dm.png') });
  // Bob получает (резервный опрос ≤ 4 с; websocket в стенде не эмулируется)
  const t0 = Date.now(); await sleep(500);
  await B.waitForFunction(() => document.querySelector('#chat-list') && document.querySelector('#chat-list').textContent.includes('Секретное ЛС'), { timeout: 12000 });
  ok(true, 'Bob увидел входящее ЛС в списке чатов за ' + (Date.now() - t0) + ' мс (опрос)');
  await clickText(B, '.chat-row', 'Alice_A'); await B.waitForSelector('#msg-input'); await sleep(500);
  await B.type('#msg-input', 'Привет, Alice!'); await B.click('#send-btn');
  await A.waitForFunction(() => document.querySelector('#msgs') && document.querySelector('#msgs').textContent.includes('Привет, Alice!'), { timeout: 12000 });
  ok(true, 'Alice получила ответ Bob в открытом чате');
  await B.screenshot({ path: path.join(SHOTS, '21-remote-bob-dm.png') });

  // RLS через клиент: Carol
  const res = await C.evaluate(async () => {
    const sb = GC.api._sb, out = {};
    out.msgs = (await sb.from('messages').select('*')).data.length;
    out.chats = (await sb.from('chats').select('*')).data.length;
    out.members = (await sb.from('chat_members').select('*')).data.length;
    out.list = (await sb.rpc('list_my_chats')).data.length;
    const me = GC.api.session(); const a = (await sb.from('profiles').select('id').eq('nick', 'Alice_A').single()).data;
    const dm = await sb.rpc('open_dm', { other: a.id }); out.dmId = dm.data; // собственный ЛС Carol↔Alice (допустимо), к чату Alice↔Bob отношения не имеет
    const all = (await sb.from('chats').select('id,dm_key')).data; out.ownChats = all.length;
    out.spoof = (await sb.from('messages').insert({ chat_id: dm.data, body: 'x', sender_id: a.id })).error?.message || 'NO ERROR';
    out.profileHack = (await sb.from('profiles').update({ nick: 'Hacked' }).eq('id', a.id).select()).data.length;
    out.pollLeak = (await sb.from('polls').select('*')).data.length;
    return out;
  });
  ok(res.msgs === 0 && res.chats === 0 && res.members === 0 && res.list === 0, 'RLS: Carol не видит чужие ЛС/чаты/участников (messages=0, chats=0)');
  ok(res.spoof !== 'NO ERROR', 'RLS: подмена sender_id отвергнута (' + res.spoof.slice(0, 60) + ')');
  ok(res.profileHack === 0, 'RLS: чужой профиль изменить нельзя');
  // прямые запросы по REST с anon-ключом без входа
  const anon = await C.evaluate(async (key) => { const r = await fetch('http://127.0.0.1:8741/rest/v1/messages?select=*', { headers: { apikey: key, Authorization: 'Bearer ' + key } }); return [r.status, (await r.text()).slice(0, 80)]; }, mock.ANON);
  ok(anon[0] === 401 || anon[0] === 403, 'anon-ключ без входа не читает messages (HTTP ' + anon[0] + ')');
  // Carol пытается читать чат Alice↔Bob по id
  const aliceChatId = await A.evaluate(async () => (await GC.api.listChats()).find(c => c.peer && c.peer.nick === 'Bob_B').id);
  const steal = await C.evaluate(async (id) => { const sb = GC.api._sb; const m = await sb.from('messages').select('*').eq('chat_id', id); const w = await sb.from('messages').insert({ chat_id: id, body: 'вторжение' }); return [m.data.length, w.error ? w.error.code : 'NO ERROR']; }, aliceChatId);
  ok(steal[0] === 0 && steal[1] !== 'NO ERROR', 'RLS: по известному chat_id Carol не читает и не пишет (' + steal[1] + ')');

  await A.evaluate(() => { location.hash = '#/chats'; }); await B.evaluate(() => { location.hash = '#/chats'; }); await sleep(400);
  // сервер: Alice создаёт, Bob вступает по коду, Carol не видит
  await clickText(A, '.tab', 'Серверы'); await clickText(A, '.btn', '＋ Создать'); await A.waitForSelector('#srv-name'); await sleep(150); await A.type('#srv-name', 'Гильдия Тест'); await clickText(A, '.sheet .btn', 'Создать сервер');
  await A.waitForSelector('#invite-code'); const code = await A.$eval('#invite-code', e => e.textContent); ok(code.length === 10, 'сервер создан, код ' + code);
  await A.screenshot({ path: path.join(SHOTS, '22-remote-server.png') });
  const carolSees = await C.evaluate(async () => (await GC.api._sb.from('servers').select('*')).data.length); ok(carolSees === 0, 'RLS: чужой сервер не виден без вступления');
  await clickText(B, '.tab', 'Серверы'); await clickText(B, '.btn', 'Вступить'); await B.waitForSelector('#join-code'); await sleep(150); await B.type('#join-code', code.toLowerCase()); await clickText(B, '.sheet .btn', 'Вступить');
  await B.waitForSelector('#invite-code'); ok((await B.$eval('.srv-hero', e => e.textContent)).includes('Гильдия Тест'), 'Bob вступил по коду-приглашению');
  await B.click('.chan'); await B.waitForSelector('#msg-input'); await sleep(400); await B.type('#msg-input', 'Bob в канале'); await B.click('#send-btn'); await sleep(600);
  const carolMsgs = await C.evaluate(async () => (await GC.api._sb.from('messages').select('*')).data.length); ok(carolMsgs === 0, 'RLS: сообщения канала не видны не-участнику');
  // голосование
  await A.evaluate(() => { location.hash = '#/chats'; }); await sleep(500); await clickText(A, '.chat-row', 'Bob_B'); await A.waitForSelector('#poll-btn'); await sleep(400);
  await A.click('#poll-btn'); await A.waitForSelector('#poll-q'); await sleep(200); await clickText(A, '.sheet .btn', 'Создать'); await A.waitForSelector('.poll .opt');
  await A.click('.poll .opt'); await sleep(600);
  ok((await A.$$eval('.poll .opt.on', e => e.length)) === 1, 'голос Alice сохранён в БД');
  await B.evaluate(() => { location.hash = '#/chats'; }); await sleep(300);
  await clickText(B, '.chat-row', 'Alice_A'); await B.waitForSelector('.poll .opt', { timeout: 10000 }); await sleep(500);
  await B.evaluate(() => document.querySelectorAll('.poll .opt')[1].click()); await sleep(800);
  ok((await B.$eval('.poll', e => e.textContent)).includes('2 голоса'), 'Bob проголосовал; итог 2 голоса');
  await B.screenshot({ path: path.join(SHOTS, '23-remote-poll.png') });
  // LFG
  await A.evaluate(() => { location.hash = '#/lfg'; }); await sleep(400); await clickText(A, '.btn', 'Ищу пати'); await A.waitForSelector('#l-game'); await sleep(150);
  await A.select('#l-game', 'Valorant'); await A.select('#l-rank', 'Gold'); await A.type('#l-time', 'Сегодня 22:00'); await clickText(A, '.sheet .btn', 'Опубликовать'); await sleep(800);
  await B.evaluate(() => { location.hash = '#/lfg'; }); await B.waitForSelector('.lfg', { timeout: 8000 }); await sleep(300);
  await B.select('#f-game', 'Valorant'); await sleep(200); ok((await B.$$eval('.lfg', e => e.length)) === 1, 'Bob видит объявление Alice, фильтр по игре работает');
  await B.click('.respond'); await B.waitForSelector('#msg-input'); await sleep(600);
  ok((await B.$eval('.chat-head', e => e.textContent)).includes('Alice_A') && (await B.$eval('#msg-input', e => e.value)).includes('Откликаюсь'), 'Откликнуться → ЛС с Alice и готовый текст');
  await B.screenshot({ path: path.join(SHOTS, '24-remote-lfg-respond.png') });
  // статистика
  await A.evaluate(() => { location.hash = '#/me'; }); await A.waitForSelector('#res-game'); await clickText(A, '.btn', '🏆 Победа'); await sleep(400); await clickText(A, '.btn', '🏆 Победа'); await sleep(400); await clickText(A, '.btn', '💀 Поражение'); await sleep(600);
  ok((await A.$eval('#st-rate', e => e.textContent)) === '67%', 'статистика в БД: 2П/1Пор = 67%');
  // лимит длины на уровне БД
  const big = await A.evaluate(async (id) => (await GC.api._sb.from('messages').insert({ chat_id: id, body: 'x'.repeat(2001) })).error?.code || 'NO ERROR', aliceChatId);
  ok(big === '23514', 'БД отвергает сообщение >2000 символов (check_violation)');
  const errs = [A, B, C].flatMap(p => p.errs); ok(errs.length === 0, 'нет JS-ошибок' + (errs.length ? ': ' + errs[0] : ''));
  await b.close(); srv.close(); api.close();
  console.log(fails ? fails + ' ПРОВАЛОВ' : 'E2E remote(local stand): все проверки пройдены'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
