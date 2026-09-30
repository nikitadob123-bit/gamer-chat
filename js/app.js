/* Gamer Chat — UI. Без сборки, без innerHTML с данными: весь контент строится через DOM API (textContent) → XSS исключён. */
(function () {
  'use strict';
  var U = GC.util, api = null, me = null;
  var $app = document.getElementById('app');
  var cache = {};          // кеш профилей id → profile
  var view = null;         // текущий вид { onEvent, destroy }
  var prefill = {};        // chatId → текст для поля ввода (отклик на объявление)
  var lfgFilter = { game: '', rank: '' };
  var rtStatus = '';

  /* ---------- DOM-хелпер ---------- */
  function h(tag, props) {
    var el = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') Object.keys(v).forEach(function (s) { el.style[s] = v[s]; });
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'href' || k === 'src') { /* внешние ссылки/ресурсы запрещены */ }
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { add(el, x); });
    else el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function errText(e) { var m = (e && e.message) || String(e); return /[А-Яа-яЁё]/.test(m) ? m : U.mapError(m); }

  function toast(msg, kind) {
    var t = h('div', { class: 'toast ' + (kind || ''), role: 'status', text: msg });
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('out'); }, 2600);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3000);
  }
  function guard(p) { return p.catch(function (e) { toast(errText(e), 'err'); throw e; }); }

  function avatar(u, size) {
    u = u || {};
    return h('div', { class: 'avatar ' + (size || ''), style: { background: 'linear-gradient(135deg,' + U.safeColor(u.avatar_color) + ',#0b0b1a)', boxShadow: '0 0 0 2px ' + U.safeColor(u.avatar_color) + '55' }, 'aria-hidden': 'true' },
      h('span', { text: u.avatar_emoji || '🎮' }));
  }
  function setProfiles(list) { (list || []).forEach(function (p) { if (p) cache[p.id] = p; }); }
  function ensureProfiles(ids) {
    var miss = ids.filter(function (i) { return i && !cache[i]; });
    if (!miss.length) return Promise.resolve();
    return api.getProfiles(miss).then(setProfiles);
  }

  /* ---------- Листы (модальные) ---------- */
  function sheet(title, body, opts) {
    opts = opts || {};
    var back = h('div', { class: 'sheet-back' });
    var box = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    function close() { if (back.parentNode) back.parentNode.removeChild(back); if (opts.onClose) opts.onClose(); }
    box.appendChild(h('div', { class: 'sheet-head' }, h('h3', { text: title }), h('button', { class: 'icon-btn', 'aria-label': 'Закрыть', text: '✕', onclick: close })));
    box.appendChild(body);
    back.appendChild(box);
    back.addEventListener('click', function (e) { if (e.target === back) close(); });
    document.body.appendChild(back);
    var f = box.querySelector('input,textarea,select'); if (f && !opts.noFocus) setTimeout(function () { try { f.focus(); } catch (e) { } }, 50);
    return close;
  }
  function field(label, input, hint) {
    return h('label', { class: 'field' }, h('span', { class: 'lbl', text: label }), input, hint ? h('span', { class: 'hint', text: hint }) : null);
  }
  function select(options, value, onchange, placeholder) {
    var s = h('select', { class: 'inp', onchange: onchange });
    if (placeholder != null) s.appendChild(h('option', { value: '', text: placeholder }));
    options.forEach(function (o) { s.appendChild(h('option', { value: o, text: o })); });
    s.value = value || '';
    return s;
  }
  function btn(text, cls, fn) { return h('button', { class: 'btn ' + (cls || ''), type: 'button', onclick: fn, text: text }); }

  /* ---------- Роутинг ---------- */
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  function route() {
    if (view && view.destroy) view.destroy();
    view = null;
    if (!me) { renderAuth(); return; }
    var p = (location.hash || '#/chats').replace(/^#\/?/, '').split('/');
    var name = p[0] || 'chats';
    if (name === 'chat') return renderChat(p[1], p[2] === 's' ? '#/server/' + p[3] : '#/chats');
    if (name === 'server') return renderServer(p[1]);
    if (name === 'user') return renderUser(p[1]);
    if (['chats', 'servers', 'lfg', 'me'].indexOf(name) < 0) name = 'chats';
    shell(name);
  }
  var TABS = [['chats', '💬', 'Чаты'], ['servers', '🛡️', 'Серверы'], ['lfg', '🎯', 'Пати'], ['me', '👤', 'Профиль']];
  function shell(active) {
    clear($app);
    var main = h('main', { class: 'main' });
    var top = h('header', { class: 'topbar' },
      h('div', { class: 'brand' }, h('span', { class: 'logo', text: '◆' }), h('span', { text: 'GAMER CHAT' })),
      api.mode === 'demo' ? h('span', { class: 'chip demo', text: 'ДЕМО', title: 'Данные хранятся только в этом браузере' }) : h('span', { class: 'chip live' + (rtStatus === 'SUBSCRIBED' ? ' on' : ''), text: rtStatus === 'SUBSCRIBED' ? 'ONLINE' : '···' }));
    var nav = h('nav', { class: 'tabbar', 'aria-label': 'Разделы' }, TABS.map(function (t) {
      return h('a', { class: 'tab' + (t[0] === active ? ' on' : ''), href: null, 'data-tab': t[0], role: 'button', tabindex: '0', onclick: function () { go('#/' + t[0]); } },
        h('span', { class: 'ti', text: t[1] }), h('span', { class: 'tl', text: t[2] }));
    }));
    $app.appendChild(top); $app.appendChild(main); $app.appendChild(nav);
    var fn = { chats: tabChats, servers: tabServers, lfg: tabLfg, me: tabMe }[active];
    view = fn(main) || {};
  }

  /* ---------- Вход / регистрация ---------- */
  function renderAuth() {
    clear($app);
    var mode = 'in';
    var nick = h('input', { class: 'inp', id: 'auth-nick', autocomplete: 'username', maxlength: '20', placeholder: 'Например, NeonFox', autocapitalize: 'off', spellcheck: 'false' });
    var pass = h('input', { class: 'inp', id: 'auth-pass', type: 'password', autocomplete: 'current-password', maxlength: '72', placeholder: 'Минимум 6 символов' });
    var err = h('div', { class: 'form-err', role: 'alert' });
    var submit = h('button', { class: 'btn primary wide', id: 'auth-submit', type: 'submit', text: 'Войти' });
    var tIn = h('button', { type: 'button', class: 'seg on', id: 'seg-in', text: 'Вход' });
    var tUp = h('button', { type: 'button', class: 'seg', id: 'seg-up', text: 'Регистрация' });
    function setMode(m) {
      mode = m; tIn.classList.toggle('on', m === 'in'); tUp.classList.toggle('on', m === 'up');
      submit.textContent = m === 'in' ? 'Войти' : 'Создать аккаунт'; err.textContent = '';
      pass.setAttribute('autocomplete', m === 'in' ? 'current-password' : 'new-password');
    }
    tIn.onclick = function () { setMode('in'); }; tUp.onclick = function () { setMode('up'); };
    var form = h('form', { class: 'auth-card', onsubmit: function (e) {
      e.preventDefault(); err.textContent = ''; submit.disabled = true;
      var p = mode === 'in' ? api.signIn(nick.value, pass.value) : api.signUp(nick.value, pass.value);
      p.then(function (u) { me = u; setProfiles([u]); go('#/chats'); route(); })
        .catch(function (ex) { err.textContent = errText(ex); })
        .then(function () { submit.disabled = false; });
    } },
      h('div', { class: 'seg-row' }, tIn, tUp),
      field('Ник', nick, mode === 'up' ? '' : ''), field('Пароль', pass),
      err, submit,
      h('p', { class: 'muted small', text: 'Ник: 3–20 символов, латиница, цифры и _. Почта не нужна.' }),
      api.mode === 'demo' ? h('p', { class: 'demo-note', text: '🧪 Демо-режим: аккаунты и чаты хранятся только в вашем браузере. Внутри есть боты NeonFox, Sniper_Kat, DotaDed и PixelMage.' }) : null);
    $app.appendChild(h('div', { class: 'auth' },
      h('div', { class: 'hero' }, h('div', { class: 'hero-logo', text: '◆' }), h('h1', { text: 'GAMER CHAT' }), h('p', { text: 'Мессенджер для геймеров: чаты, серверы, поиск тиммейтов' })),
      form));
  }

  /* ---------- Вкладка «Чаты» ---------- */
  function previewOf(c) {
    if (!c.last) return 'Нет сообщений';
    var t = c.last.kind === 'poll' ? '📊 ' + c.last.body : c.last.body;
    return (c.last.sender_id === me.id ? 'Вы: ' : '') + t.replace(/\s+/g, ' ');
  }
  function tabChats(main) {
    var list = h('div', { class: 'list', id: 'chat-list' });
    main.appendChild(h('div', { class: 'section-head' }, h('h2', { text: 'Чаты' }), h('div', { class: 'row-gap' },
      btn('＋ ЛС', 'sm', openNewDm), btn('＋ Группа', 'sm', openNewGroup))));
    main.appendChild(list);
    function refresh() {
      guard(api.listChats()).then(function (chats) {
        setProfiles(chats.map(function (c) { return c.peer; }));
        clear(list);
        if (!chats.length) list.appendChild(h('div', { class: 'empty' }, h('div', { class: 'big', text: '💬' }), h('p', { text: 'Пока нет чатов. Найдите игрока в «Пати» или нажмите «＋ ЛС».' })));
        chats.forEach(function (c) {
          var title = c.kind === 'dm' ? (c.peer ? c.peer.nick : 'Игрок') : c.title;
          var av = c.kind === 'dm' ? avatar(c.peer) : h('div', { class: 'avatar group' }, h('span', { text: '👥' }));
          list.appendChild(h('div', { class: 'row chat-row', role: 'button', tabindex: '0', 'data-chat': c.id, onclick: function () { go('#/chat/' + c.id); } },
            av, h('div', { class: 'grow' },
              h('div', { class: 'r1' }, h('span', { class: 'name', text: title }), h('span', { class: 'time', text: c.last ? U.fmtTime(c.last.created_at) : '' })),
              h('div', { class: 'r2 ' + (c.last ? '' : 'muted'), text: previewOf(c) }))));
        });
      });
    }
    refresh();
    return { onEvent: function (ev) { if (ev.type === 'message' || ev.type === 'membership' || ev.type === 'reload' || ev.type === 'tick') refresh(); } };
  }
  function openNewDm() {
    var q = h('input', { class: 'inp', id: 'dm-search', placeholder: 'Поиск по нику', maxlength: '20' });
    var res = h('div', { class: 'list' });
    function search() {
      guard(api.searchProfiles(q.value)).then(function (ps) {
        setProfiles(ps); clear(res);
        if (!ps.length) res.appendChild(h('div', { class: 'empty small', text: 'Никого не найдено' }));
        ps.forEach(function (p) {
          res.appendChild(h('div', { class: 'row', role: 'button', tabindex: '0', 'data-nick': p.nick, onclick: function () { close(); guard(api.openDm(p.id)).then(function (id) { go('#/chat/' + id); }); } },
            avatar(p), h('div', { class: 'grow' }, h('div', { class: 'name', text: p.nick }), h('div', { class: 'muted small', text: p.status_game ? '🎮 ' + p.status_game : (p.bio || '') }))));
        });
      });
    }
    var timer; q.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(search, 250); });
    var close = sheet('Новый личный чат', h('div', { class: 'sheet-body' }, q, res));
    search();
  }
  function openNewGroup() {
    var title = h('input', { class: 'inp', id: 'grp-title', maxlength: String(U.LIMITS.title), placeholder: 'Название группы' });
    var nicks = h('input', { class: 'inp', id: 'grp-nicks', placeholder: 'Ники через запятую (необязательно)' });
    var close = sheet('Новая группа', h('div', { class: 'sheet-body' }, field('Название', title), field('Участники', nicks, 'Добавить можно и позже'),
      btn('Создать группу', 'primary wide', function () {
        guard(api.createGroup(title.value, nicks.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean))).then(function (id) { close(); go('#/chat/' + id); });
      })));
  }

  /* ---------- Экран чата ---------- */
  function renderChat(chatId, backHash) {
    clear($app);
    var info = null, msgs = [], seen = {}, pollCards = {};
    var listEl = h('div', { class: 'msgs', id: 'msgs', role: 'log', 'aria-live': 'polite' });
    var titleEl = h('div', { class: 'name', text: '…' }), subEl = h('div', { class: 'muted small', text: '' });
    var avBox = h('div', {});
    var ta = h('textarea', { class: 'composer-inp', id: 'msg-input', rows: '1', maxlength: String(U.LIMITS.msg), placeholder: 'Сообщение…', 'aria-label': 'Сообщение' });
    ta.addEventListener('input', function () { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 110) + 'px'; });
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    var sendBtn = h('button', { class: 'send-btn', id: 'send-btn', type: 'button', 'aria-label': 'Отправить', onclick: send, text: '➤' });
    var pollBtn = h('button', { class: 'icon-btn', id: 'poll-btn', type: 'button', 'aria-label': 'Голосование «Когда играем?»', text: '📊', onclick: function () { openPollSheet(chatId); } });
    var head = h('header', { class: 'topbar chat-head' },
      h('button', { class: 'icon-btn', id: 'back-btn', 'aria-label': 'Назад', text: '‹', onclick: function () { go(backHash); } }),
      avBox, h('div', { class: 'grow', onclick: function () { if (info) openInfo(); } }, titleEl, subEl));
    $app.appendChild(head); $app.appendChild(listEl);
    $app.appendChild(h('div', { class: 'composer' }, pollBtn, ta, sendBtn));

    function nearBottom() { return listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 120; }
    function toBottom() { listEl.scrollTop = listEl.scrollHeight; }
    function senderOf(id) { return cache[id] || { nick: 'игрок', avatar_color: '#7c4dff', avatar_emoji: '🎮' }; }

    function renderMsg(m, prev) {
      var mine = m.sender_id === me.id, s = senderOf(m.sender_id);
      var showName = !mine && info && info.kind !== 'dm' && (!prev || prev.sender_id !== m.sender_id);
      var body;
      if (m.kind === 'poll') body = pollCard(m);
      else body = h('div', { class: 'text', text: m.body });
      var row = h('div', { class: 'msg ' + (mine ? 'mine' : 'theirs'), 'data-id': String(m.id) },
        (!mine && info && info.kind !== 'dm') ? h('div', { class: 'mav', onclick: function () { go('#/user/' + m.sender_id); } }, (!prev || prev.sender_id !== m.sender_id) ? avatar(s, 'xs') : null) : null,
        h('div', { class: 'bubble' }, showName ? h('div', { class: 'sender', style: { color: U.safeColor(s.avatar_color) }, text: s.nick }) : null, body,
          h('div', { class: 'mtime', text: U.fmtTime(m.created_at) })));
      return row;
    }
    function pollCard(m) {
      var box = h('div', { class: 'poll', 'data-poll': m.poll_id });
      function draw() {
        guard(api.getPoll(m.poll_id)).then(function (d) {
          return ensureProfiles(d.votes.map(function (v) { return v.user_id; })).then(function () {
            var t = U.tallyPoll(d.options, d.votes), mine = d.votes.filter(function (v) { return v.user_id === me.id; })[0];
            clear(box);
            box.appendChild(h('div', { class: 'poll-q', text: '📊 ' + d.poll.question }));
            d.options.forEach(function (o) {
              var pct = t.total ? Math.round(t.counts[o.id] * 100 / t.total) : 0;
              var on = mine && mine.option_id === o.id;
              box.appendChild(h('button', { type: 'button', class: 'opt' + (on ? ' on' : '') + (t.leaders.indexOf(o.id) >= 0 ? ' lead' : ''), 'data-opt': o.id, onclick: function () { guard(api.vote(m.poll_id, o.id)); } },
                h('span', { class: 'bar', style: { width: pct + '%' } }),
                h('span', { class: 'olabel', text: (on ? '✔ ' : '') + o.label }),
                h('span', { class: 'ocount', text: String(t.counts[o.id]) })));
            });
            box.appendChild(h('div', { class: 'muted small', text: t.total + ' ' + U.plural(t.total, 'голос', 'голоса', 'голосов') + (t.total && t.leaders.length === 1 ? ' · лидирует: ' + d.options.filter(function (o) { return o.id === t.leaders[0]; })[0].label : '') }));
          });
        }).catch(function () { });
      }
      pollCards[m.poll_id] = draw; draw();
      return box;
    }
    function append(m) {
      if (seen[m.id]) return; seen[m.id] = true;
      var stick = nearBottom() || m.sender_id === me.id;
      var prev = msgs[msgs.length - 1]; msgs.push(m);
      listEl.appendChild(renderMsg(m, prev));
      if (stick) toBottom();
    }
    function send() {
      var t = ta.value; if (!t.trim()) return;
      ta.value = ''; ta.style.height = 'auto';
      api.sendMessage(chatId, t).then(function (m) { if (m) append(m); }).catch(function (e) { ta.value = t; toast(errText(e), 'err'); });
    }
    function openInfo() {
      var b = h('div', { class: 'sheet-body' });
      b.appendChild(h('div', { class: 'muted small', text: info.kind === 'group' ? 'Участники группы' : (info.kind === 'channel' ? 'Участники сервера' : 'Профиль') }));
      info.members.forEach(function (p) {
        b.appendChild(h('div', { class: 'row', role: 'button', tabindex: '0', onclick: function () { close(); go('#/user/' + p.id); } }, avatar(p), h('div', { class: 'grow' }, h('div', { class: 'name', text: p.nick + (p.id === info.owner_id ? ' 👑' : '') }), h('div', { class: 'muted small', text: p.status_game ? '🎮 ' + p.status_game : '' }))));
      });
      if (info.kind === 'group') {
        if (info.owner_id === me.id) {
          var n = h('input', { class: 'inp', id: 'add-nick', placeholder: 'Ник игрока', maxlength: '20' });
          b.appendChild(h('div', { class: 'inline' }, n, btn('Добавить', 'sm', function () { guard(api.addGroupMember(chatId, n.value)).then(function () { close(); toast('Игрок добавлен'); loadInfo(); }); })));
        }
        b.appendChild(btn('Покинуть группу', 'danger wide', function () { guard(api.leaveGroup(chatId)).then(function () { close(); go('#/chats'); }); }));
      }
      var close = sheet(info.kind === 'dm' ? info.title : info.title, b);
    }
    function loadInfo() {
      return guard(api.getChat(chatId)).then(function (c) {
        info = c; setProfiles(c.members);
        titleEl.textContent = c.kind === 'channel' ? '# ' + c.title : c.title;
        subEl.textContent = c.kind === 'dm' ? (c.peer && c.peer.status_game ? '🎮 играет в ' + c.peer.status_game : 'личный чат') : c.members.length + ' ' + U.plural(c.members.length, 'участник', 'участника', 'участников');
        clear(avBox); avBox.appendChild(c.kind === 'dm' ? avatar(c.peer, 'sm') : h('div', { class: 'avatar sm group' }, h('span', { text: c.kind === 'channel' ? '#' : '👥' })));
      });
    }
    loadInfo().then(function () { return guard(api.loadMessages(chatId, 100)); }).then(function (rows) {
      return ensureProfiles(rows.map(function (r) { return r.sender_id; })).then(function () {
        rows.forEach(append); toBottom();
        if (prefill[chatId]) { ta.value = prefill[chatId]; delete prefill[chatId]; ta.dispatchEvent(new Event('input')); }
      });
    }).catch(function () { go('#/chats'); });

    view = {
      onEvent: function (ev) {
        if (ev.type === 'message' && ev.row.chat_id === chatId) ensureProfiles([ev.row.sender_id]).then(function () { append(ev.row); });
        if (ev.type === 'vote' && pollCards[ev.poll_id]) pollCards[ev.poll_id]();
        if (ev.type === 'tick') {
          api.loadMessages(chatId, 30).then(function (rows) { return ensureProfiles(rows.map(function (r) { return r.sender_id; })).then(function () { rows.forEach(append); }); }).catch(function () { });
          Object.keys(pollCards).forEach(function (k) { pollCards[k](); });
        }
        if (ev.type === 'reload') route();
      }
    };
  }
  var WHEN = ['Сегодня 20:00', 'Сегодня 22:00', 'Завтра 20:00', 'Завтра 22:00', 'В выходные'];
  function openPollSheet(chatId) {
    var q = h('input', { class: 'inp', id: 'poll-q', maxlength: String(U.LIMITS.pollQ), value: 'Когда играем?' });
    var opts = [], wrap = h('div', { class: 'opts' });
    function addOpt(v) {
      if (opts.length >= 6) return;
      var i = h('input', { class: 'inp poll-opt', maxlength: String(U.LIMITS.pollOpt), placeholder: 'Вариант ' + (opts.length + 1), value: v || '' });
      opts.push(i); wrap.appendChild(i);
    }
    addOpt(WHEN[0]); addOpt(WHEN[2]);
    var chips = h('div', { class: 'chips' }, WHEN.map(function (w) { return h('button', { type: 'button', class: 'chip-btn', text: w, onclick: function () { var e = opts.filter(function (o) { return !o.value; })[0]; if (e) e.value = w; else addOpt(w); } }); }));
    var close = sheet('Когда играем?', h('div', { class: 'sheet-body' }, field('Вопрос', q), h('div', { class: 'lbl', text: 'Варианты (2–6)' }), wrap, chips,
      h('div', { class: 'inline' }, btn('＋ Вариант', 'sm', function () { addOpt(''); }), btn('Создать', 'primary', function () {
        guard(api.createPoll(chatId, q.value, opts.map(function (o) { return o.value; }))).then(function () { close(); });
      }))));
  }

  /* ---------- Серверы ---------- */
  function tabServers(main) {
    var list = h('div', { class: 'list' });
    main.appendChild(h('div', { class: 'section-head' }, h('h2', { text: 'Серверы' }), h('div', { class: 'row-gap' }, btn('＋ Создать', 'sm', openCreateServer), btn('Вступить', 'sm', openJoinServer))));
    main.appendChild(list);
    function refresh() {
      guard(api.listServers()).then(function (ss) {
        clear(list);
        if (!ss.length) list.appendChild(h('div', { class: 'empty' }, h('div', { class: 'big', text: '🛡️' }), h('p', { text: 'Вы ещё не состоите ни в одном сервере. Создайте свой или вступите по коду.' }), h('p', { class: 'muted small', text: api.mode === 'demo' ? 'Код для демо: NEON2026' : '' })));
        ss.forEach(function (s) {
          list.appendChild(h('div', { class: 'row', role: 'button', tabindex: '0', 'data-server': s.id, onclick: function () { go('#/server/' + s.id); } },
            h('div', { class: 'avatar sq' }, h('span', { text: s.emoji })), h('div', { class: 'grow' }, h('div', { class: 'name', text: s.name }), h('div', { class: 'muted small', text: s.members + ' ' + U.plural(s.members, 'участник', 'участника', 'участников') })),
            s.owner_id === me.id ? h('span', { class: 'chip', text: '👑' }) : null));
        });
      });
    }
    refresh();
    return { onEvent: function (ev) { if (ev.type === 'membership' || ev.type === 'reload' || ev.type === 'tick') refresh(); } };
  }
  function openCreateServer() {
    var name = h('input', { class: 'inp', id: 'srv-name', maxlength: String(U.LIMITS.serverName), placeholder: 'Название сервера' });
    var emoji = '🛡️', picks = h('div', { class: 'emoji-grid' });
    ['🛡️', '⚔️', '🌌', '🔥', '👾', '🐉', '🎯', '🏆', '🚀', '💎'].forEach(function (e) {
      var b = h('button', { type: 'button', class: 'emo' + (e === emoji ? ' on' : ''), text: e, onclick: function () { emoji = e; Array.prototype.forEach.call(picks.children, function (c) { c.classList.toggle('on', c === b); }); } });
      picks.appendChild(b);
    });
    var close = sheet('Новый сервер', h('div', { class: 'sheet-body' }, field('Название', name), h('div', { class: 'lbl', text: 'Значок' }), picks,
      btn('Создать сервер', 'primary wide', function () { guard(api.createServer(name.value, emoji)).then(function (id) { close(); go('#/server/' + id); }); })));
  }
  function openJoinServer() {
    var code = h('input', { class: 'inp', id: 'join-code', maxlength: '20', placeholder: 'Код приглашения', autocapitalize: 'characters' });
    var close = sheet('Вступить на сервер', h('div', { class: 'sheet-body' }, field('Код-приглашение', code), btn('Вступить', 'primary wide', function () {
      guard(api.joinServer(code.value)).then(function (id) { close(); go('#/server/' + id); });
    })));
  }
  function renderServer(sid) {
    clear($app);
    var body = h('main', { class: 'main' });
    $app.appendChild(h('header', { class: 'topbar' }, h('button', { class: 'icon-btn', id: 'back-btn', 'aria-label': 'Назад', text: '‹', onclick: function () { go('#/servers'); } }), h('div', { class: 'grow name', text: 'Сервер' })));
    $app.appendChild(body);
    function refresh() {
      guard(api.getServer(sid)).then(function (d) {
        setProfiles(d.members); clear(body);
        var s = d.server, owner = s.owner_id === me.id;
        body.appendChild(h('div', { class: 'srv-hero' }, h('div', { class: 'avatar sq lg' }, h('span', { text: s.emoji })), h('h2', { text: s.name }),
          h('div', { class: 'invite' }, h('span', { class: 'muted small', text: 'Код приглашения' }), h('code', { id: 'invite-code', text: s.invite_code }),
            btn('Копировать', 'sm', function () { try { navigator.clipboard.writeText(s.invite_code).then(function () { toast('Код скопирован'); }, function () { toast(s.invite_code); }); } catch (e) { toast(s.invite_code); } }))));
        body.appendChild(h('div', { class: 'section-head' }, h('h3', { text: 'Каналы' }), owner ? btn('＋ Канал', 'sm', function () {
          var n = h('input', { class: 'inp', id: 'chan-name', maxlength: String(U.LIMITS.channel), placeholder: 'например, тренировки' });
          var close = sheet('Новый канал', h('div', { class: 'sheet-body' }, field('Название', n), btn('Создать', 'primary wide', function () { guard(api.createChannel(sid, n.value)).then(function () { close(); refresh(); }); })));
        }) : null));
        var cl = h('div', { class: 'list' });
        d.channels.forEach(function (c) {
          cl.appendChild(h('div', { class: 'row chan', role: 'button', tabindex: '0', 'data-chan': c.title, onclick: function () { go('#/chat/' + c.id + '/s/' + sid); } }, h('span', { class: 'hash', text: '#' }), h('div', { class: 'grow name', text: c.title })));
        });
        body.appendChild(cl);
        body.appendChild(h('div', { class: 'section-head' }, h('h3', { text: 'Участники · ' + d.members.length })));
        var ml = h('div', { class: 'list' });
        d.members.forEach(function (p) {
          ml.appendChild(h('div', { class: 'row', role: 'button', tabindex: '0', onclick: function () { go('#/user/' + p.id); } }, avatar(p, 'sm'), h('div', { class: 'grow' }, h('div', { class: 'name', text: p.nick + (p.role === 'owner' ? ' 👑' : '') }), h('div', { class: 'muted small', text: p.status_game ? '🎮 ' + p.status_game : '' }))));
        });
        body.appendChild(ml);
        if (!owner) body.appendChild(btn('Покинуть сервер', 'danger wide', function () { guard(api.leaveServer(sid)).then(function () { go('#/servers'); }); }));
      }).catch(function () { go('#/servers'); });
    }
    refresh();
    view = { onEvent: function (ev) { if (ev.type === 'membership' || ev.type === 'reload') refresh(); } };
  }

  /* ---------- Поиск тиммейтов ---------- */
  function tabLfg(main) {
    var list = h('div', { class: 'list cards' });
    var gsel = select(U.GAME_NAMES, lfgFilter.game, function () { lfgFilter.game = gsel.value; lfgFilter.rank = ''; fillRanks(); draw(); }, 'Все игры');
    gsel.id = 'f-game';
    var rsel = h('select', { class: 'inp', id: 'f-rank', onchange: function () { lfgFilter.rank = rsel.value; draw(); } });
    function fillRanks() {
      clear(rsel); rsel.appendChild(h('option', { value: '', text: 'Любой ранг' }));
      U.ranksFor(lfgFilter.game).forEach(function (r) { rsel.appendChild(h('option', { value: r, text: r })); });
      rsel.value = lfgFilter.rank; rsel.disabled = !lfgFilter.game;
    }
    fillRanks();
    main.appendChild(h('div', { class: 'section-head' }, h('h2', { text: 'Поиск тиммейтов' }), btn('＋ Ищу пати', 'sm primary', openCreateLfg)));
    main.appendChild(h('div', { class: 'filters' }, gsel, rsel));
    main.appendChild(list);
    var posts = [];
    function draw() {
      var f = U.filterLfg(posts, { game: lfgFilter.game, rank: lfgFilter.rank });
      clear(list);
      if (!f.length) list.appendChild(h('div', { class: 'empty' }, h('div', { class: 'big', text: '🎯' }), h('p', { text: 'Объявлений нет. Создайте своё — тиммейты найдутся!' })));
      f.forEach(function (p) {
        var a = p.author || { nick: 'игрок' }, own = p.user_id === me.id;
        list.appendChild(h('article', { class: 'card lfg', 'data-lfg': p.id },
          h('div', { class: 'card-top' }, avatar(a, 'sm'), h('div', { class: 'grow' }, h('div', { class: 'name', text: a.nick, onclick: function () { go('#/user/' + p.user_id); } }), h('div', { class: 'muted small', text: U.fmtTime(p.created_at) })),
            h('span', { class: 'slots', text: p.slots + ' ' + U.plural(p.slots, 'слот', 'слота', 'слотов') })),
          h('h3', { class: 'game', text: p.game }),
          h('div', { class: 'tags' }, p.rank ? h('span', { class: 'tag', text: '🏅 ' + p.rank }) : null, p.role ? h('span', { class: 'tag', text: '🎭 ' + p.role }) : null, p.play_time ? h('span', { class: 'tag', text: '🕘 ' + p.play_time }) : null),
          p.note ? h('p', { class: 'note', text: p.note }) : null,
          own ? h('div', { class: 'inline' }, btn('Закрыть набор', 'sm', function () { guard(api.closeLfg(p.id)); }), btn('Удалить', 'sm danger', function () { guard(api.deleteLfg(p.id)); }))
            : btn('Откликнуться', 'primary wide respond', function () {
              guard(api.openDm(p.user_id)).then(function (cid) {
                prefill[cid] = 'Привет! Откликаюсь на твоё объявление: ' + p.game + (p.rank ? ' (' + p.rank + ')' : '') + '. Го играть?';
                go('#/chat/' + cid);
              });
            })));
      });
    }
    function refresh() { guard(api.listLfg()).then(function (r) { posts = r; setProfiles(r.map(function (x) { return x.author; })); draw(); }); }
    refresh();
    return { onEvent: function (ev) { if (ev.type === 'lfg' || ev.type === 'reload' || ev.type === 'tick') refresh(); } };
  }
  function openCreateLfg() {
    var st = { game: U.GAME_NAMES[0], rank: '', role: 'Любая', slots: 2 };
    var rsel = h('select', { class: 'inp', id: 'l-rank' });
    function fillRanks() { clear(rsel); rsel.appendChild(h('option', { value: '', text: 'Любой' })); U.ranksFor(st.game).forEach(function (r) { rsel.appendChild(h('option', { value: r, text: r })); }); rsel.value = ''; }
    var gsel = select(U.GAME_NAMES, st.game, function () { st.game = gsel.value; fillRanks(); }); gsel.id = 'l-game';
    fillRanks();
    var role = select(U.ROLES, st.role, function () { st.role = role.value; }); role.id = 'l-role';
    var time = h('input', { class: 'inp', id: 'l-time', maxlength: String(U.LIMITS.playTime), placeholder: 'Например, сегодня 21:00' });
    var chips = h('div', { class: 'chips' }, ['Сегодня вечером', 'Завтра вечером', 'Сейчас', 'В выходные'].map(function (w) { return h('button', { type: 'button', class: 'chip-btn', text: w, onclick: function () { time.value = w; } }); }));
    var note = h('textarea', { class: 'inp', id: 'l-note', maxlength: String(U.LIMITS.note), rows: '2', placeholder: 'Пара слов о том, кого ищете' });
    var slotsEl = h('span', { class: 'slots-val', id: 'l-slots', text: String(st.slots) });
    function step(d) { st.slots = Math.max(1, Math.min(U.LIMITS.maxSlots, st.slots + d)); slotsEl.textContent = st.slots; }
    var close = sheet('Ищу пати', h('div', { class: 'sheet-body' }, field('Игра', gsel), field('Ваш ранг', rsel), field('Роль', role), field('Когда', time), chips,
      h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Сколько игроков ищете' }), h('div', { class: 'stepper' }, btn('−', 'sm', function () { step(-1); }), slotsEl, btn('+', 'sm', function () { step(1); }))),
      field('Заметка', note),
      btn('Опубликовать', 'primary wide', function () {
        guard(api.createLfg({ game: gsel.value, rank: rsel.value, role: role.value === 'Любая' ? '' : role.value, play_time: time.value, slots: st.slots, note: note.value })).then(function () { close(); toast('Объявление опубликовано'); });
      })), { noFocus: true });
  }

  /* ---------- Профиль ---------- */
  function statsBlock(results) {
    var s = U.computeStats(results), box = h('div', { class: 'stats' });
    box.appendChild(h('div', { class: 'stat-tiles' },
      h('div', { class: 'tile' }, h('div', { class: 'v', id: 'st-wins', text: String(s.total.wins) }), h('div', { class: 'k', text: 'Побед' })),
      h('div', { class: 'tile' }, h('div', { class: 'v', id: 'st-losses', text: String(s.total.losses) }), h('div', { class: 'k', text: 'Поражений' })),
      h('div', { class: 'tile acc' }, h('div', { class: 'v', id: 'st-rate', text: s.total.rate + '%' }), h('div', { class: 'k', text: 'Винрейт' })),
      h('div', { class: 'tile' }, h('div', { class: 'v', text: '🔥' + s.total.streak }), h('div', { class: 'k', text: 'Серия' }))));
    s.byGame.forEach(function (g) {
      box.appendChild(h('div', { class: 'gstat' }, h('div', { class: 'gline' }, h('span', { text: g.game }), h('span', { class: 'muted', text: g.wins + 'П / ' + g.losses + 'Пор · ' + g.rate + '%' })),
        h('div', { class: 'meter' }, h('span', { style: { width: g.rate + '%' } }))));
    });
    return box;
  }
  function gamesBlock(p) {
    var box = h('div', { class: 'tags' });
    (p.games || []).forEach(function (g) { box.appendChild(h('span', { class: 'tag', text: '🎮 ' + g.game + (g.rank ? ' · ' + g.rank : '') })); });
    if (!(p.games || []).length) box.appendChild(h('span', { class: 'muted small', text: 'Игры не указаны' }));
    return box;
  }
  function tabMe(main) {
    var box = h('div', { class: 'profile' });
    main.appendChild(box);
    function draw() {
      guard(api.listResults(me.id)).then(function (results) {
        clear(box);
        box.appendChild(h('div', { class: 'p-hero' }, avatar(me, 'lg'), h('h2', { id: 'p-nick', text: me.nick }),
          me.status_game ? h('div', { class: 'playing', text: '🎮 Играю в ' + me.status_game }) : h('div', { class: 'muted small', text: 'Статус не задан' }),
          me.bio ? h('p', { class: 'bio', text: me.bio }) : null,
          btn('✏️ Редактировать', 'sm', openEditProfile)));
        box.appendChild(h('div', { class: 'section-head' }, h('h3', { text: 'Мои игры и ранги' })));
        box.appendChild(gamesBlock(me));
        box.appendChild(h('div', { class: 'section-head' }, h('h3', { text: 'Статистика побед' })));
        box.appendChild(statsBlock(results));
        var gs = (me.games || []).map(function (g) { return g.game; }); U.GAME_NAMES.forEach(function (g) { if (gs.indexOf(g) < 0) gs.push(g); });
        var gsel = select(gs, gs[0], function () { }); gsel.id = 'res-game';
        box.appendChild(h('div', { class: 'res-form' }, gsel, h('div', { class: 'inline' },
          btn('🏆 Победа', 'win', function () { guard(api.addResult(gsel.value, 'win')); }), btn('💀 Поражение', 'loss', function () { guard(api.addResult(gsel.value, 'loss')); }),
          btn('↶', 'sm', function () { guard(api.deleteLastResult()); }))));
        box.appendChild(btn('Выйти', 'danger wide', function () { api.signOut().then(function () { me = null; cache = {}; route(); }); }));
        if (api.mode === 'demo') box.appendChild(btn('Сбросить демо-данные', 'wide ghost', function () { if (confirm('Удалить все демо-данные?')) { api.resetDemo(); me = null; cache = {}; location.hash = ''; location.reload(); } }));
      });
    }
    draw();
    return { onEvent: function (ev) { if (ev.type === 'stats' || ev.type === 'profile' || ev.type === 'reload') draw(); } };
  }
  function openEditProfile() {
    var st = { emoji: me.avatar_emoji, color: me.avatar_color, games: (me.games || []).slice() };
    var status = h('input', { class: 'inp', id: 'e-status', maxlength: String(U.LIMITS.status), value: me.status_game || '', placeholder: 'Во что играете сейчас?' });
    var bio = h('textarea', { class: 'inp', id: 'e-bio', maxlength: String(U.LIMITS.bio), rows: '2', placeholder: 'О себе' }); bio.value = me.bio || '';
    var preview = h('div', {});
    function drawPrev() { clear(preview); preview.appendChild(avatar({ avatar_emoji: st.emoji, avatar_color: st.color }, 'lg')); }
    drawPrev();
    var emo = h('div', { class: 'emoji-grid' }), col = h('div', { class: 'color-grid' });
    U.EMOJIS.forEach(function (e) { var b = h('button', { type: 'button', class: 'emo' + (e === st.emoji ? ' on' : ''), text: e, onclick: function () { st.emoji = e; Array.prototype.forEach.call(emo.children, function (c) { c.classList.toggle('on', c === b); }); drawPrev(); } }); emo.appendChild(b); });
    U.COLORS.forEach(function (c) { var b = h('button', { type: 'button', class: 'col' + (c === st.color ? ' on' : ''), 'aria-label': 'Цвет ' + c, style: { background: c }, onclick: function () { st.color = c; Array.prototype.forEach.call(col.children, function (x) { x.classList.toggle('on', x === b); }); drawPrev(); } }); col.appendChild(b); });
    var gl = h('div', { class: 'tags' });
    function drawGames() {
      clear(gl);
      st.games.forEach(function (g, i) { gl.appendChild(h('span', { class: 'tag rm', text: g.game + (g.rank ? ' · ' + g.rank : '') + '  ✕', onclick: function () { st.games.splice(i, 1); drawGames(); } })); });
    }
    drawGames();
    var rsel = h('select', { class: 'inp', id: 'e-rank' });
    function fillR() { clear(rsel); rsel.appendChild(h('option', { value: '', text: 'Без ранга' })); U.ranksFor(gsel.value).forEach(function (r) { rsel.appendChild(h('option', { value: r, text: r })); }); }
    var gsel = select(U.GAME_NAMES, U.GAME_NAMES[0], function () { fillR(); }); gsel.id = 'e-game'; fillR();
    var close = sheet('Редактировать профиль', h('div', { class: 'sheet-body scroll' }, h('div', { class: 'center' }, preview), h('div', { class: 'lbl', text: 'Аватар' }), emo, h('div', { class: 'lbl', text: 'Цвет' }), col,
      field('Играю в…', status), field('О себе', bio), h('div', { class: 'lbl', text: 'Игры и ранги' }), gl,
      h('div', { class: 'inline' }, gsel, rsel), btn('＋ Добавить игру', 'sm', function () {
        if (st.games.length >= U.LIMITS.maxGames) return toast('Максимум ' + U.LIMITS.maxGames + ' игр', 'err');
        if (st.games.some(function (g) { return g.game === gsel.value; })) st.games = st.games.filter(function (g) { return g.game !== gsel.value; });
        st.games.push({ game: gsel.value, rank: rsel.value }); drawGames();
      }),
      btn('Сохранить', 'primary wide', function () {
        guard(api.updateProfile({ avatar_emoji: st.emoji, avatar_color: st.color, status_game: status.value, bio: bio.value, games: st.games })).then(function (u) { me = u; cache[u.id] = u; close(); toast('Профиль сохранён'); });
      })), { noFocus: true });
  }
  function renderUser(uid) {
    if (uid === me.id) return go('#/me');
    clear($app);
    var body = h('main', { class: 'main profile' });
    $app.appendChild(h('header', { class: 'topbar' }, h('button', { class: 'icon-btn', id: 'back-btn', 'aria-label': 'Назад', text: '‹', onclick: function () { history.back(); } }), h('div', { class: 'grow name', text: 'Профиль игрока' })));
    $app.appendChild(body);
    Promise.all([api.getProfiles([uid]), api.listResults(uid)]).then(function (a) {
      var p = a[0][0]; if (!p) return go('#/chats');
      body.appendChild(h('div', { class: 'p-hero' }, avatar(p, 'lg'), h('h2', { text: p.nick }), p.status_game ? h('div', { class: 'playing', text: '🎮 Играет в ' + p.status_game }) : null, p.bio ? h('p', { class: 'bio', text: p.bio }) : null,
        btn('💬 Написать', 'primary', function () { guard(api.openDm(p.id)).then(function (id) { go('#/chat/' + id); }); })));
      body.appendChild(h('div', { class: 'section-head' }, h('h3', { text: 'Игры и ранги' }))); body.appendChild(gamesBlock(p));
      body.appendChild(h('div', { class: 'section-head' }, h('h3', { text: 'Статистика' }))); body.appendChild(statsBlock(a[1]));
    }).catch(function (e) { toast(errText(e), 'err'); });
  }

  /* ---------- Запуск ---------- */
  function onEvent(ev) {
    if (ev.type === 'rt-status') { rtStatus = ev.status; var c = document.querySelector('.chip.live'); if (c) { c.classList.toggle('on', ev.status === 'SUBSCRIBED'); c.textContent = ev.status === 'SUBSCRIBED' ? 'ONLINE' : '···'; } return; }
    if (ev.type === 'profile' || ev.type === 'reload') { var fresh = api.session(); if (fresh) { me = fresh; cache[fresh.id] = fresh; } }
    if (view && view.onEvent) view.onEvent(ev);
  }
  function pickBackend() {
    var cfg = window.GC_CONFIG || {}, forceDemo = /[?&]demo=1/.test(location.search);
    if (!forceDemo && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase && GC.remote) return GC.remote;
    return GC.demo;
  }
  window.addEventListener('unhandledrejection', function (e) { e.preventDefault(); });
  var lastTick = 0;
  function startFallbackPoll() {
    // если Realtime не подключён (блокировка WebSocket, сбой) — мягко опрашиваем активный экран каждые 4 с
    setInterval(function () {
      if (api.mode !== 'supabase' || rtStatus === 'SUBSCRIBED' || !me || document.hidden) return;
      if (view && view.onEvent) view.onEvent({ type: 'tick' });
    }, 4000);
  }
  function start() {
    api = pickBackend(); GC.api = api;
    api.on(onEvent);
    api.init().then(function (u) { me = u; if (u) setProfiles([u]); route(); }, function (e) { console.error(e); route(); });
    window.addEventListener('hashchange', route);
    startFallbackPoll();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(function () { });
  }
  GC.ui = { start: start };
  start();
})();
