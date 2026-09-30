/* Бэкенд на Supabase. Интерфейс идентичен js/demo.js. Используется только anon key;
   вся авторизация данных — через RLS и RPC-функции (supabase/schema.sql). */
(function () {
  'use strict';
  var U = GC.util;
  var sb = null, me = null, handlers = [], channel = null;

  function emit(ev) { handlers.slice().forEach(function (h) { try { h(ev); } catch (e) { console.error(e); } }); }
  function ok(r) { if (r.error) throw new Error(r.error.message || String(r.error)); return r.data; }
  function emailFor(nick) { return nick.toLowerCase() + '@' + ((window.GC_CONFIG && window.GC_CONFIG.EMAIL_DOMAIN) || 'gc-users.invalid'); }
  function uidOrThrow() { if (!me) throw new Error('not authenticated'); return me.id; }

  function loadMe(userId) {
    return sb.from('profiles').select('*').eq('id', userId).single().then(function (r) { me = ok(r); return me; });
  }
  function subscribe() {
    if (channel) { sb.removeChannel(channel); channel = null; }
    channel = sb.channel('gc-main')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, function (p) { emit({ type: 'message', row: p.new }); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'poll_votes' }, function (p) { emit({ type: 'vote', poll_id: (p.new && p.new.poll_id) || (p.old && p.old.poll_id) }); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lfg_posts' }, function () { emit({ type: 'lfg' }); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_members' }, function () { emit({ type: 'membership' }); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'server_members' }, function () { emit({ type: 'membership' }); })
      .subscribe(function (status) { emit({ type: 'rt-status', status: status }); });
  }

  var api = {
    mode: 'supabase',
    init: function () {
      var cfg = window.GC_CONFIG;
      sb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
      api._sb = sb;
      return sb.auth.getSession().then(function (r) {
        var s = r.data && r.data.session;
        if (!s) return null;
        return loadMe(s.user.id).then(function (u) { subscribe(); return u; }, function () { return null; });
      });
    },
    on: function (h) { handlers.push(h); return function () { handlers = handlers.filter(function (x) { return x !== h; }); }; },
    session: function () { return me; },
    signUp: function (nick, password) {
      nick = U.clean(nick, U.LIMITS.nick);
      if (!U.validNick(nick)) return Promise.reject(new Error('Ник: 3–20 символов, латиница, цифры и _'));
      if (!U.validPassword(password)) return Promise.reject(new Error('Пароль: от 6 до 72 символов'));
      return sb.rpc('nick_available', { p_nick: nick }).then(function (r) {
        if (!ok(r)) throw new Error('Этот ник уже занят');
        return sb.auth.signUp({ email: emailFor(nick), password: password, options: { data: { nick: nick } } });
      }).then(function (r) {
        var d = ok(r);
        if (!d.session) throw new Error('Email not confirmed');
        return loadMe(d.user.id);
      }).then(function (u) { subscribe(); return u; });
    },
    signIn: function (login, password) {
      login = String(login || '').trim();
      var email = login.indexOf('@') > 0 ? login : emailFor(login);
      return sb.auth.signInWithPassword({ email: email, password: password }).then(function (r) {
        var d = ok(r); return loadMe(d.user.id);
      }).then(function (u) { subscribe(); return u; });
    },
    signOut: function () {
      if (channel) { sb.removeChannel(channel); channel = null; }
      me = null; return sb.auth.signOut().then(function () {});
    },

    getProfiles: function (ids) {
      ids = Array.from(new Set(ids)).filter(Boolean);
      if (!ids.length) return Promise.resolve([]);
      return sb.from('profiles').select('*').in('id', ids).then(ok);
    },
    findByNick: function (nick) { return sb.from('profiles').select('*').ilike('nick', String(nick).trim().replace(/[%_\\]/g, '\\$&')).maybeSingle().then(ok); },
    searchProfiles: function (q) {
      q = String(q || '').trim().replace(/[\\%_]/g, '\\$&');
      var qb = sb.from('profiles').select('*').neq('id', uidOrThrow()).limit(20);
      if (q) qb = qb.ilike('nick', '%' + q + '%');
      return qb.order('created_at', { ascending: false }).then(ok);
    },
    updateProfile: function (patch) {
      var L = U.LIMITS, row = {};
      if (patch.avatar_emoji !== undefined) row.avatar_emoji = U.clean(patch.avatar_emoji, 4) || '🎮';
      if (patch.avatar_color !== undefined) row.avatar_color = U.safeColor(patch.avatar_color);
      if (patch.status_game !== undefined) row.status_game = U.clean(patch.status_game, L.status) || null;
      if (patch.bio !== undefined) row.bio = U.clean(patch.bio, L.bio) || null;
      if (patch.games !== undefined) row.games = (patch.games || []).slice(0, L.maxGames).map(function (g) { return { game: U.clean(g.game, L.game), rank: U.clean(g.rank, L.rank) }; }).filter(function (g) { return g.game; });
      return sb.from('profiles').update(row).eq('id', uidOrThrow()).select().single().then(function (r) { me = ok(r); emit({ type: 'profile' }); return me; });
    },

    listChats: function () {
      return sb.rpc('list_my_chats').then(ok).then(function (rows) {
        return api.getProfiles(rows.map(function (r) { return r.peer_id; })).then(function (ps) {
          var by = {}; ps.forEach(function (p) { by[p.id] = p; });
          return rows.map(function (r) {
            return { id: r.id, kind: r.kind, title: r.title, peer: r.kind === 'dm' ? by[r.peer_id] || null : null,
              last: r.last_at ? { body: r.last_body, kind: r.last_kind, sender_id: r.last_sender, created_at: r.last_at } : null, created_at: r.created_at };
          });
        });
      });
    },
    getChat: function (chatId) {
      return sb.from('chats').select('*').eq('id', chatId).single().then(ok).then(function (c) {
        var q = c.kind === 'channel'
          ? sb.from('server_members').select('user_id').eq('server_id', c.server_id)
          : sb.from('chat_members').select('user_id').eq('chat_id', chatId);
        return q.then(ok).then(function (rows) {
          return api.getProfiles(rows.map(function (r) { return r.user_id; })).then(function (ps) {
            var peer = c.kind === 'dm' ? ps.filter(function (p) { return p.id !== me.id; })[0] || null : null;
            return { id: c.id, kind: c.kind, title: c.kind === 'dm' ? (peer && peer.nick) : c.title, owner_id: c.owner_id, server_id: c.server_id, peer: peer, members: ps };
          });
        });
      });
    },
    openDm: function (otherId) { return sb.rpc('open_dm', { other: otherId }).then(ok); },
    createGroup: function (title, nicks) { return sb.rpc('create_group', { p_title: U.clean(title, U.LIMITS.title), p_nicks: (nicks || []).map(function (n) { return U.clean(n, 20); }) }).then(ok); },
    addGroupMember: function (chatId, nick) { return sb.rpc('add_group_member', { p_chat: chatId, p_nick: U.clean(nick, 20) }).then(ok); },
    leaveGroup: function (chatId) { return sb.rpc('leave_group', { p_chat: chatId }).then(function (r) { ok(r); emit({ type: 'membership' }); }); },

    loadMessages: function (chatId, limit) {
      return sb.from('messages').select('*').eq('chat_id', chatId).order('id', { ascending: false }).limit(limit || 60).then(ok).then(function (rows) { return rows.reverse(); });
    },
    sendMessage: function (chatId, body) {
      body = U.clean(body, U.LIMITS.msg, true);
      if (!body) return Promise.reject(new Error('Пустое сообщение'));
      return sb.from('messages').insert({ chat_id: chatId, body: body }).select().single().then(ok);
    },

    listServers: function () {
      return sb.from('servers').select('*').order('created_at').then(ok).then(function (servers) {
        if (!servers.length) return [];
        return sb.from('server_members').select('server_id').in('server_id', servers.map(function (s) { return s.id; })).then(ok).then(function (ms) {
          var n = {}; ms.forEach(function (m) { n[m.server_id] = (n[m.server_id] || 0) + 1; });
          return servers.map(function (s) { return Object.assign({}, s, { members: n[s.id] || 1 }); });
        });
      });
    },
    createServer: function (name, emoji) { return sb.rpc('create_server', { p_name: U.clean(name, U.LIMITS.serverName), p_emoji: U.clean(emoji, 4) }).then(ok).then(function (id) { emit({ type: 'membership' }); return id; }); },
    joinServer: function (code) { return sb.rpc('join_server', { p_code: U.clean(code, 20) }).then(ok).then(function (id) { emit({ type: 'membership' }); return id; }); },
    getServer: function (sid) {
      return Promise.all([
        sb.from('servers').select('*').eq('id', sid).single().then(ok),
        sb.from('chats').select('id,title').eq('server_id', sid).order('created_at').then(ok),
        sb.from('server_members').select('user_id,role').eq('server_id', sid).then(ok)
      ]).then(function (a) {
        return api.getProfiles(a[2].map(function (m) { return m.user_id; })).then(function (ps) {
          var role = {}; a[2].forEach(function (m) { role[m.user_id] = m.role; });
          return { server: a[0], channels: a[1], members: ps.map(function (p) { return Object.assign({ role: role[p.id] }, p); }) };
        });
      });
    },
    createChannel: function (sid, name) { return sb.rpc('create_channel', { p_server: sid, p_name: U.clean(name, U.LIMITS.channel).replace(/\s+/g, '-') }).then(ok); },
    leaveServer: function (sid) { return sb.from('server_members').delete().eq('server_id', sid).eq('user_id', uidOrThrow()).then(function (r) { ok(r); emit({ type: 'membership' }); }); },

    listLfg: function () {
      return sb.from('lfg_posts').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(100).then(ok).then(function (rows) {
        return api.getProfiles(rows.map(function (r) { return r.user_id; })).then(function (ps) {
          var by = {}; ps.forEach(function (p) { by[p.id] = p; });
          return rows.map(function (r) { return Object.assign({}, r, { author: by[r.user_id] || null }); });
        });
      });
    },
    createLfg: function (p) {
      var v = U.validateLfg(p); if (!v.ok) return Promise.reject(new Error(v.errors[0]));
      var row = v.value; ['rank', 'role', 'play_time', 'note'].forEach(function (k) { row[k] = row[k] || null; });
      return sb.from('lfg_posts').insert(row).select().single().then(ok).then(function (r) { emit({ type: 'lfg' }); return r; });
    },
    closeLfg: function (id) { return sb.from('lfg_posts').update({ status: 'closed' }).eq('id', id).then(function (r) { ok(r); emit({ type: 'lfg' }); }); },
    deleteLfg: function (id) { return sb.from('lfg_posts').delete().eq('id', id).then(function (r) { ok(r); emit({ type: 'lfg' }); }); },

    createPoll: function (chatId, question, options) {
      question = U.clean(question, U.LIMITS.pollQ);
      options = (options || []).map(function (o) { return U.clean(o, U.LIMITS.pollOpt); }).filter(Boolean).slice(0, 6);
      if (!question) return Promise.reject(new Error('Введите вопрос'));
      if (options.length < 2) return Promise.reject(new Error('Нужно минимум 2 варианта'));
      return sb.rpc('create_poll', { p_chat: chatId, p_question: question, p_options: options }).then(ok);
    },
    getPoll: function (pid) {
      return Promise.all([
        sb.from('polls').select('*').eq('id', pid).single().then(ok),
        sb.from('poll_options').select('*').eq('poll_id', pid).order('position').then(ok),
        sb.from('poll_votes').select('*').eq('poll_id', pid).then(ok)
      ]).then(function (a) { return { poll: a[0], options: a[1], votes: a[2] }; });
    },
    vote: function (pid, optionId) {
      var id = uidOrThrow();
      return sb.from('poll_votes').upsert({ poll_id: pid, user_id: id, option_id: optionId }, { onConflict: 'poll_id,user_id' }).then(function (r) { ok(r); emit({ type: 'vote', poll_id: pid }); });
    },

    listResults: function (userId) { return sb.from('match_results').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1000).then(ok); },
    addResult: function (game, result) {
      game = U.clean(game, U.LIMITS.game);
      if (!game || (result !== 'win' && result !== 'loss')) return Promise.reject(new Error('Выберите игру и результат'));
      return sb.from('match_results').insert({ game: game, result: result }).then(function (r) { ok(r); emit({ type: 'stats' }); });
    },
    deleteLastResult: function () {
      return sb.from('match_results').select('id').eq('user_id', uidOrThrow()).order('created_at', { ascending: false }).limit(1).then(ok).then(function (rows) {
        if (!rows.length) return;
        return sb.from('match_results').delete().eq('id', rows[0].id).then(function (r) { ok(r); emit({ type: 'stats' }); });
      });
    }
  };

  window.GC = window.GC || {};
  GC.remote = api;
})();
