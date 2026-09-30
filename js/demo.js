/* Демо-бэкенд на localStorage. Тот же интерфейс, что и у js/remote.js.
   Несколько аккаунтов живут в одном браузере; вкладки синхронизируются через событие storage. */
(function () {
  'use strict';
  var U = GC.util;
  var KEY = 'gc_demo_v1', SKEY = 'gc_demo_session';
  var handlers = [];
  var db = null;

  function uid() { return 'u' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
  function nowIso() { return new Date().toISOString(); }
  function load() {
    if (db) return db;
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = null; }
    if (!db || !db.users) { db = seed(); save(true); }
    return db;
  }
  function save(silent) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* квота */ } }
  function emit(ev) { handlers.slice().forEach(function (h) { try { h(ev); } catch (e) { console.error(e); } }); }
  window.addEventListener('storage', function (e) {
    if (e.key === KEY) { db = null; load(); emit({ type: 'reload' }); }
  });
  function hash(s) {
    var enc = new TextEncoder().encode('gc-demo|' + s);
    if (window.crypto && crypto.subtle) return crypto.subtle.digest('SHA-256', enc).then(function (b) {
      return Array.from(new Uint8Array(b)).map(function (x) { return x.toString(16).padStart(2, '0'); }).join('');
    });
    return Promise.resolve(btoa(s));
  }
  function ago(min) { return new Date(Date.now() - min * 60000).toISOString(); }

  function seed() {
    var d = { users: {}, chats: {}, members: {}, messages: [], servers: {}, smembers: [], polls: {}, options: [], votes: [], lfg: [], results: [], seq: 1 };
    function bot(id, nick, emoji, color, status, games, bio) {
      d.users[id] = { id: id, nick: nick, pass: null, bot: true, avatar_emoji: emoji, avatar_color: color, status_game: status, bio: bio, games: games, created_at: ago(9000) };
    }
    bot('bot_fox', 'NeonFox', '🦊', '#ff2bd6', 'Valorant', [{ game: 'Valorant', rank: 'Diamond' }, { game: 'Apex Legends', rank: 'Platinum' }], 'Дуэлянт. Играю вечером по МСК.');
    bot('bot_kat', 'Sniper_Kat', '🎯', '#22d3ee', 'Counter-Strike 2', [{ game: 'Counter-Strike 2', rank: 'Legendary Eagle' }], 'AWP или никак.');
    bot('bot_ded', 'DotaDed', '💀', '#39ff88', null, [{ game: 'Dota 2', rank: 'Legend' }], 'Позиция 4/5, терплю крипов.');
    bot('bot_pix', 'PixelMage', '🧠', '#ffb020', 'Minecraft', [{ game: 'Minecraft', rank: 'Про' }], 'Строю базы, не мобов.');
    // DM с NeonFox
    function mkMsg(chat, sender, body, min) { d.messages.push({ id: d.seq++, chat_id: chat, sender_id: sender, kind: 'text', body: body, poll_id: null, created_at: ago(min) }); }
    d.chats.c_welcome = { id: 'c_welcome', kind: 'group', title: 'Добро пожаловать 🎮', owner_id: 'bot_fox', server_id: null, created_at: ago(300) };
    d.members.c_welcome = ['bot_fox', 'bot_kat', 'bot_ded'];
    mkMsg('c_welcome', 'bot_fox', 'Привет! Это демо-чат. Здесь всё хранится только в вашем браузере.', 120);
    mkMsg('c_welcome', 'bot_kat', 'Попробуйте создать голосование «когда играем» через кнопку 📊', 110);
    mkMsg('c_welcome', 'bot_ded', 'gg wp', 100);
    // Сервер
    d.servers.s_neon = { id: 's_neon', name: 'Гильдия Неон', emoji: '🌌', owner_id: 'bot_fox', invite_code: 'NEON2026', created_at: ago(5000) };
    d.smembers.push({ server_id: 's_neon', user_id: 'bot_fox', role: 'owner' }, { server_id: 's_neon', user_id: 'bot_kat', role: 'member' }, { server_id: 's_neon', user_id: 'bot_ded', role: 'member' });
    d.chats.c_neon1 = { id: 'c_neon1', kind: 'channel', title: 'общий', owner_id: 'bot_fox', server_id: 's_neon', created_at: ago(5000) };
    d.chats.c_neon2 = { id: 'c_neon2', kind: 'channel', title: 'игры', owner_id: 'bot_fox', server_id: 's_neon', created_at: ago(5000) };
    mkMsg('c_neon1', 'bot_fox', 'Добро пожаловать в Гильдию Неон! Код-приглашение: NEON2026', 400);
    mkMsg('c_neon1', 'bot_ded', 'Кто сегодня в пати на вечер?', 35);
    mkMsg('c_neon2', 'bot_kat', 'Пятничные катки в CS2 — пишите сюда', 200);
    // LFG
    function lfg(u, game, rank, role, time, slots, note, min) { d.lfg.push({ id: 'l' + d.seq++, user_id: u, game: game, rank: rank, role: role, play_time: time, slots: slots, note: note, status: 'open', created_at: ago(min) }); }
    lfg('bot_fox', 'Valorant', 'Diamond', 'Дуэлянт', 'Сегодня 21:00–00:00', 2, 'Нужны контроллер и сентинел, без токсиков', 15);
    lfg('bot_kat', 'Counter-Strike 2', 'Legendary Eagle', 'Снайпер', 'Завтра вечером', 3, 'Premier, есть микрофон', 45);
    lfg('bot_ded', 'Dota 2', 'Legend', 'Поддержка', 'Сегодня после 22:00', 1, 'Ищу керри в паке на ранкед', 90);
    lfg('bot_pix', 'Minecraft', 'Про', 'Любая', 'Выходные', 4, 'Сервер на выживание, билдим замок', 600);
    return d;
  }

  var me = null;
  function pub(u) { if (!u) return null; var o = {}; for (var k in u) if (k !== 'pass') o[k] = u[k]; return o; }
  function curId() { return me ? me.id : null; }
  function requireMe() { if (!me) throw new Error('not authenticated'); return me.id; }
  function isMember(chatId, uidv) {
    var c = load().chats[chatId]; if (!c) return false;
    if (c.kind === 'channel') return load().smembers.some(function (m) { return m.server_id === c.server_id && m.user_id === uidv; });
    return (load().members[chatId] || []).indexOf(uidv) >= 0;
  }
  function need(chatId) { if (!isMember(chatId, requireMe())) throw new Error('no access'); }

  var api = {
    mode: 'demo',
    init: function () {
      load();
      var s = localStorage.getItem(SKEY);
      me = s && load().users[s] ? load().users[s] : null;
      return Promise.resolve(pub(me));
    },
    on: function (h) { handlers.push(h); return function () { handlers = handlers.filter(function (x) { return x !== h; }); }; },
    session: function () { return pub(me); },
    signUp: function (nick, password, email) {
      nick = U.clean(nick, U.LIMITS.nick);
      if (!U.validNick(nick)) return Promise.reject(new Error('Ник: 3–20 символов, латиница, цифры и _'));
      if (!U.validPassword(password)) return Promise.reject(new Error('Пароль: от 6 до 72 символов'));
      var d = load();
      if (Object.keys(d.users).some(function (k) { return d.users[k].nick.toLowerCase() === nick.toLowerCase(); })) return Promise.reject(new Error('Этот ник уже занят'));
      return hash(password).then(function (h) {
        var id = uid();
        d.users[id] = { id: id, nick: nick, pass: h, avatar_emoji: U.EMOJIS[Math.floor(Math.random() * U.EMOJIS.length)], avatar_color: U.COLORS[Math.floor(Math.random() * U.COLORS.length)], status_game: null, bio: null, games: [], created_at: nowIso() };
        // автоматически добавляем в приветственный чат
        d.members.c_welcome.push(id);
        save(); me = d.users[id]; localStorage.setItem(SKEY, id);
        return pub(me);
      });
    },
    signIn: function (login, password) {
      var d = load(); login = String(login || '').trim().toLowerCase();
      var u = Object.keys(d.users).map(function (k) { return d.users[k]; }).filter(function (x) { return !x.bot && x.nick.toLowerCase() === login; })[0];
      return hash(password || '').then(function (h) {
        if (!u || u.pass !== h) throw new Error('Неверная почта или пароль');
        me = u; localStorage.setItem(SKEY, u.id); return pub(u);
      });
    },
    signOut: function () { me = null; localStorage.removeItem(SKEY); return Promise.resolve(); },
    resetDemo: function () { localStorage.removeItem(KEY); localStorage.removeItem(SKEY); db = null; me = null; },

    getProfiles: function (ids) { var d = load(); return Promise.resolve(ids.map(function (i) { return pub(d.users[i]); }).filter(Boolean)); },
    findByNick: function (nick) {
      var d = load(); nick = String(nick || '').trim().toLowerCase();
      return Promise.resolve(pub(Object.keys(d.users).map(function (k) { return d.users[k]; }).filter(function (u) { return u.nick.toLowerCase() === nick; })[0] || null));
    },
    searchProfiles: function (q) {
      var d = load(); q = String(q || '').trim().toLowerCase();
      return Promise.resolve(Object.keys(d.users).map(function (k) { return d.users[k]; }).filter(function (u) { return u.id !== curId() && (!q || u.nick.toLowerCase().indexOf(q) >= 0); }).slice(0, 20).map(pub));
    },
    updateProfile: function (patch) {
      var id = requireMe(), u = load().users[id], L = U.LIMITS;
      if (patch.avatar_emoji !== undefined) u.avatar_emoji = U.clean(patch.avatar_emoji, 4) || '🎮';
      if (patch.avatar_color !== undefined) u.avatar_color = U.safeColor(patch.avatar_color);
      if (patch.status_game !== undefined) u.status_game = U.clean(patch.status_game, L.status) || null;
      if (patch.bio !== undefined) u.bio = U.clean(patch.bio, L.bio) || null;
      if (patch.games !== undefined) u.games = (patch.games || []).slice(0, L.maxGames).map(function (g) { return { game: U.clean(g.game, L.game), rank: U.clean(g.rank, L.rank) }; }).filter(function (g) { return g.game; });
      save(); me = u; emit({ type: 'profile' });
      return Promise.resolve(pub(u));
    },

    listChats: function () {
      var id = requireMe(), d = load();
      var out = Object.keys(d.chats).map(function (k) { return d.chats[k]; }).filter(function (c) { return (c.kind === 'dm' || c.kind === 'group') && (d.members[c.id] || []).indexOf(id) >= 0; }).map(function (c) {
        var last = null;
        for (var i = d.messages.length - 1; i >= 0; i--) if (d.messages[i].chat_id === c.id) { last = d.messages[i]; break; }
        var peer = c.kind === 'dm' ? d.members[c.id].filter(function (x) { return x !== id; })[0] : null;
        return { id: c.id, kind: c.kind, title: c.title, peer: pub(d.users[peer]), last: last && { body: last.body, kind: last.kind, sender_id: last.sender_id, created_at: last.created_at }, created_at: c.created_at };
      });
      out.sort(function (a, b) { return String((b.last || b).created_at).localeCompare(String((a.last || a).created_at)); });
      return Promise.resolve(out);
    },
    getChat: function (chatId) {
      need(chatId); var d = load(), c = d.chats[chatId];
      var mem = c.kind === 'channel' ? d.smembers.filter(function (m) { return m.server_id === c.server_id; }).map(function (m) { return m.user_id; }) : d.members[chatId];
      var peer = c.kind === 'dm' ? mem.filter(function (x) { return x !== curId(); })[0] : null;
      return Promise.resolve({ id: c.id, kind: c.kind, title: c.kind === 'dm' ? (d.users[peer] || {}).nick : c.title, owner_id: c.owner_id, server_id: c.server_id, peer: pub(d.users[peer]), members: mem.map(function (i) { return pub(d.users[i]); }) });
    },
    openDm: function (otherId) {
      var id = requireMe(), d = load();
      if (!d.users[otherId] || otherId === id) return Promise.reject(new Error('bad peer'));
      var key = U.dmKey(id, otherId), found = Object.keys(d.chats).filter(function (k) { return d.chats[k].dm_key === key; })[0];
      if (!found) {
        found = 'c' + uid(); d.chats[found] = { id: found, kind: 'dm', dm_key: key, owner_id: id, title: null, server_id: null, created_at: nowIso() };
        d.members[found] = [id, otherId]; save(); emit({ type: 'membership' });
      }
      return Promise.resolve(found);
    },
    createGroup: function (title, nicks) {
      var id = requireMe(), d = load(); title = U.clean(title, U.LIMITS.title);
      if (!title) return Promise.reject(new Error('Введите название группы'));
      var cid = 'c' + uid(); d.chats[cid] = { id: cid, kind: 'group', title: title, owner_id: id, server_id: null, created_at: nowIso() };
      var mem = [id];
      (nicks || []).slice(0, 30).forEach(function (n) {
        n = String(n).trim().toLowerCase();
        Object.keys(d.users).forEach(function (k) { if (d.users[k].nick.toLowerCase() === n && mem.indexOf(k) < 0) mem.push(k); });
      });
      d.members[cid] = mem; save(); emit({ type: 'membership' });
      return Promise.resolve(cid);
    },
    addGroupMember: function (chatId, nick) {
      var id = requireMe(), d = load(), c = d.chats[chatId];
      if (!c || c.kind !== 'group' || c.owner_id !== id) return Promise.reject(new Error('Это может делать только владелец'));
      var u = Object.keys(d.users).map(function (k) { return d.users[k]; }).filter(function (x) { return x.nick.toLowerCase() === String(nick).trim().toLowerCase(); })[0];
      if (!u) return Promise.reject(new Error('Игрок с таким ником не найден'));
      if (d.members[chatId].indexOf(u.id) < 0) d.members[chatId].push(u.id);
      save(); emit({ type: 'membership' }); return Promise.resolve(u.id);
    },
    leaveGroup: function (chatId) {
      var id = requireMe(), d = load();
      if (d.chats[chatId] && d.chats[chatId].kind === 'group') d.members[chatId] = d.members[chatId].filter(function (x) { return x !== id; });
      save(); emit({ type: 'membership' }); return Promise.resolve();
    },

    loadMessages: function (chatId, limit) {
      need(chatId); var d = load();
      var list = d.messages.filter(function (m) { return m.chat_id === chatId; }).slice(-(limit || 60));
      return Promise.resolve(list.map(function (m) { return Object.assign({}, m); }));
    },
    sendMessage: function (chatId, body) {
      var id = requireMe(); need(chatId);
      body = U.clean(body, U.LIMITS.msg, true);
      if (!body) return Promise.reject(new Error('Пустое сообщение'));
      var d = load(), m = { id: d.seq++, chat_id: chatId, sender_id: id, kind: 'text', body: body, poll_id: null, created_at: nowIso() };
      d.messages.push(m); save(); emit({ type: 'message', row: m });
      botReply(chatId, body);
      return Promise.resolve(m);
    },

    // --- серверы ---
    listServers: function () {
      var id = requireMe(), d = load();
      return Promise.resolve(d.smembers.filter(function (m) { return m.user_id === id; }).map(function (m) {
        var s = d.servers[m.server_id]; return Object.assign({}, s, { members: d.smembers.filter(function (x) { return x.server_id === s.id; }).length });
      }));
    },
    createServer: function (name, emoji) {
      var id = requireMe(), d = load(); name = U.clean(name, U.LIMITS.serverName);
      if (name.length < 2) return Promise.reject(new Error('Название: от 2 символов'));
      var sid = 's' + uid();
      d.servers[sid] = { id: sid, name: name, emoji: U.clean(emoji, 4) || '🛡️', owner_id: id, invite_code: Math.random().toString(36).slice(2, 12).toUpperCase(), created_at: nowIso() };
      d.smembers.push({ server_id: sid, user_id: id, role: 'owner' });
      ['общий', 'игры'].forEach(function (t) { var cid = 'c' + uid(); d.chats[cid] = { id: cid, kind: 'channel', title: t, owner_id: id, server_id: sid, created_at: nowIso() }; });
      save(); emit({ type: 'membership' }); return Promise.resolve(sid);
    },
    joinServer: function (code) {
      var id = requireMe(), d = load(); code = String(code || '').trim().toUpperCase();
      var s = Object.keys(d.servers).map(function (k) { return d.servers[k]; }).filter(function (x) { return x.invite_code === code; })[0];
      if (!s) return Promise.reject(new Error('Неверный код приглашения'));
      if (!d.smembers.some(function (m) { return m.server_id === s.id && m.user_id === id; })) d.smembers.push({ server_id: s.id, user_id: id, role: 'member' });
      save(); emit({ type: 'membership' }); return Promise.resolve(s.id);
    },
    getServer: function (sid) {
      var id = requireMe(), d = load();
      if (!d.smembers.some(function (m) { return m.server_id === sid && m.user_id === id; })) return Promise.reject(new Error('no access'));
      var s = d.servers[sid];
      return Promise.resolve({
        server: Object.assign({}, s),
        channels: Object.keys(d.chats).map(function (k) { return d.chats[k]; }).filter(function (c) { return c.server_id === sid; }).map(function (c) { return { id: c.id, title: c.title }; }),
        members: d.smembers.filter(function (m) { return m.server_id === sid; }).map(function (m) { return Object.assign({ role: m.role }, pub(d.users[m.user_id])); })
      });
    },
    createChannel: function (sid, name) {
      var id = requireMe(), d = load(), s = d.servers[sid];
      if (!s || s.owner_id !== id) return Promise.reject(new Error('Это может делать только владелец'));
      name = U.clean(name, U.LIMITS.channel).toLowerCase().replace(/\s+/g, '-');
      if (!name) return Promise.reject(new Error('Введите название канала'));
      var cid = 'c' + uid(); d.chats[cid] = { id: cid, kind: 'channel', title: name, owner_id: id, server_id: sid, created_at: nowIso() };
      save(); emit({ type: 'membership' }); return Promise.resolve(cid);
    },
    leaveServer: function (sid) {
      var id = requireMe(), d = load(), s = d.servers[sid];
      if (s && s.owner_id !== id) d.smembers = d.smembers.filter(function (m) { return !(m.server_id === sid && m.user_id === id); });
      save(); emit({ type: 'membership' }); return Promise.resolve();
    },

    // --- LFG ---
    listLfg: function () {
      var d = load();
      return Promise.resolve(d.lfg.map(function (p) { return Object.assign({}, p, { author: pub(d.users[p.user_id]) }); }));
    },
    createLfg: function (p) {
      var id = requireMe(), d = load(), v = U.validateLfg(p);
      if (!v.ok) return Promise.reject(new Error(v.errors[0]));
      if (d.lfg.filter(function (x) { return x.user_id === id && x.status === 'open'; }).length >= 5) return Promise.reject(new Error('Слишком много открытых объявлений (максимум 5)'));
      var row = Object.assign({ id: 'l' + d.seq++, user_id: id, status: 'open', created_at: nowIso() }, v.value);
      row.rank = row.rank || null; row.role = row.role || null; row.play_time = row.play_time || null; row.note = row.note || null;
      d.lfg.push(row); save(); emit({ type: 'lfg' }); return Promise.resolve(row);
    },
    closeLfg: function (lid) { var d = load(), id = requireMe(); d.lfg.forEach(function (p) { if (p.id === lid && p.user_id === id) p.status = 'closed'; }); save(); emit({ type: 'lfg' }); return Promise.resolve(); },
    deleteLfg: function (lid) { var d = load(), id = requireMe(); d.lfg = d.lfg.filter(function (p) { return !(p.id === lid && p.user_id === id); }); save(); emit({ type: 'lfg' }); return Promise.resolve(); },

    // --- голосования ---
    createPoll: function (chatId, question, options) {
      var id = requireMe(); need(chatId); var d = load();
      question = U.clean(question, U.LIMITS.pollQ);
      options = (options || []).map(function (o) { return U.clean(o, U.LIMITS.pollOpt); }).filter(Boolean).slice(0, 6);
      if (!question) return Promise.reject(new Error('Введите вопрос'));
      if (options.length < 2) return Promise.reject(new Error('Нужно минимум 2 варианта'));
      var pid = 'p' + uid(); d.polls[pid] = { id: pid, chat_id: chatId, creator_id: id, question: question, created_at: nowIso() };
      options.forEach(function (o, i) { d.options.push({ id: pid + '_' + i, poll_id: pid, label: o, position: i }); });
      var m = { id: d.seq++, chat_id: chatId, sender_id: id, kind: 'poll', body: question, poll_id: pid, created_at: nowIso() };
      d.messages.push(m); save(); emit({ type: 'message', row: m }); return Promise.resolve(pid);
    },
    getPoll: function (pid) {
      var d = load(), p = d.polls[pid]; if (!p) return Promise.reject(new Error('no poll'));
      need(p.chat_id);
      return Promise.resolve({ poll: Object.assign({}, p),
        options: d.options.filter(function (o) { return o.poll_id === pid; }).sort(function (a, b) { return a.position - b.position; }),
        votes: d.votes.filter(function (v) { return v.poll_id === pid; }).map(function (v) { return Object.assign({}, v); }) });
    },
    vote: function (pid, optionId) {
      var id = requireMe(), d = load(), p = d.polls[pid]; if (!p) return Promise.reject(new Error('no poll'));
      need(p.chat_id);
      if (!d.options.some(function (o) { return o.id === optionId && o.poll_id === pid; })) return Promise.reject(new Error('bad option'));
      var v = d.votes.filter(function (x) { return x.poll_id === pid && x.user_id === id; })[0];
      if (v) v.option_id = optionId; else d.votes.push({ poll_id: pid, user_id: id, option_id: optionId });
      save(); emit({ type: 'vote', poll_id: pid }); return Promise.resolve();
    },

    // --- статистика ---
    listResults: function (userId) { var d = load(); return Promise.resolve(d.results.filter(function (r) { return r.user_id === userId; }).map(function (r) { return Object.assign({}, r); })); },
    addResult: function (game, result) {
      var id = requireMe(), d = load(); game = U.clean(game, U.LIMITS.game);
      if (!game || (result !== 'win' && result !== 'loss')) return Promise.reject(new Error('Выберите игру и результат'));
      d.results.push({ id: d.seq++, user_id: id, game: game, result: result, created_at: nowIso() }); save(); emit({ type: 'stats' }); return Promise.resolve();
    },
    deleteLastResult: function () {
      var id = requireMe(), d = load();
      for (var i = d.results.length - 1; i >= 0; i--) if (d.results[i].user_id === id) { d.results.splice(i, 1); break; }
      save(); emit({ type: 'stats' }); return Promise.resolve();
    }
  };

  // простые ответы ботов в личке — чтобы показать «реальное время» без сервера
  var REPLIES = ['Го катку? 🔥', 'Я за, скину инвайт через 5 минут', 'gg, хорошо сыграли', 'Сегодня вечером смогу после 21:00', 'Ща зайду в лобби 🎮', 'Неплохой ранг! Играем вдвоём?', 'Принято 👍'];
  function botReply(chatId, body) {
    var d = load(), c = d.chats[chatId]; if (!c || c.kind !== 'dm') return;
    var peerId = d.members[chatId].filter(function (x) { return x !== curId(); })[0], peer = d.users[peerId];
    if (!peer || !peer.bot) return;
    setTimeout(function () {
      var d2 = load();
      var m = { id: d2.seq++, chat_id: chatId, sender_id: peerId, kind: 'text', body: REPLIES[Math.floor(Math.random() * REPLIES.length)], poll_id: null, created_at: nowIso() };
      d2.messages.push(m); save(); emit({ type: 'message', row: m });
    }, 1200);
  }

  window.GC = window.GC || {};
  GC.demo = api;
})();
