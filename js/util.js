/* Чистая логика без DOM — тестируется в node (tests/logic.test.js). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.GC = root.GC || {}; root.GC.util = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LIMITS = { nick: 20, nickMin: 3, msg: 2000, title: 40, bio: 140, status: 40, game: 40, rank: 40,
    role: 40, playTime: 60, note: 200, pollQ: 120, pollOpt: 60, channel: 30, serverName: 40, maxGames: 12, maxSlots: 9 };

  var GAMES = {
    'Counter-Strike 2': ['Silver', 'Gold Nova', 'Master Guardian', 'Legendary Eagle', 'Supreme', 'Global Elite', 'Premier 10k+'],
    'Dota 2': ['Herald', 'Guardian', 'Crusader', 'Archon', 'Legend', 'Ancient', 'Divine', 'Immortal'],
    'Valorant': ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant', 'Immortal', 'Radiant'],
    'League of Legends': ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Emerald', 'Diamond', 'Master+'],
    'Apex Legends': ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Predator'],
    'Overwatch 2': ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster', 'Champion'],
    'Rocket League': ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Champion', 'Grand Champion', 'SSL'],
    'Mobile Legends': ['Warrior', 'Elite', 'Master', 'Grandmaster', 'Epic', 'Legend', 'Mythic'],
    'Fortnite': ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Elite', 'Champion', 'Unreal'],
    'PUBG': ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Crown', 'Ace', 'Conqueror'],
    'Standoff 2': ['Bronze', 'Silver', 'Gold', 'Phoenix', 'Ranger', 'Champion', 'Master', 'Elite', 'Legend'],
    'Brawl Stars': ['Бронза', 'Серебро', 'Золото', 'Алмаз', 'Мифик', 'Легенда', 'Мастер'],
    'Minecraft': ['Новичок', 'Опытный', 'Про'],
    'Genshin Impact': ['AR 1–30', 'AR 30–45', 'AR 45–55', 'AR 55+'],
    'World of Tanks': ['Новичок', 'Опытный', 'Статист', 'Про']
  };
  var GAME_NAMES = Object.keys(GAMES);
  var ROLES = ['Любая', 'Лидер', 'Дамагер', 'Поддержка', 'Танк', 'Снайпер', 'Лесник', 'Керри', 'Саппорт'];
  var EMOJIS = ['🎮', '🦊', '🐺', '🐉', '👾', '🤖', '🦁', '🐼', '🔥', '⚡', '💀', '🎯', '🛡️', '🚀', '🧠', '😎'];
  var COLORS = ['#7c4dff', '#ff2bd6', '#22d3ee', '#39ff88', '#ffb020', '#ff4d6d', '#4d8dff', '#b6ff3b'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"'`\/]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;', '/': '&#47;' }[c];
    });
  }
  // убираем управляющие символы, схлопываем пробелы (для однострочных полей), обрезаем по длине
  function clean(s, max, multiline) {
    s = String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '');
    s = multiline ? s.replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n') : s.replace(/\s+/g, ' ');
    s = s.trim();
    return max ? Array.from(s).slice(0, max).join('') : s;
  }
  function validNick(n) { return typeof n === 'string' && /^[A-Za-z0-9_]{3,20}$/.test(n); }
  function validEmail(e) { return typeof e === 'string' && e.length <= 254 && /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/.test(e); }
  function validPassword(p) { return typeof p === 'string' && p.length >= 6 && p.length <= 72; }
  function validColor(c) { return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c); }
  function safeColor(c) { return validColor(c) ? c : '#7c4dff'; }
  function dmKey(a, b) { return a < b ? a + ':' + b : b + ':' + a; }
  function ranksFor(game) { return GAMES[game] ? GAMES[game].slice() : []; }

  function validateLfg(p) {
    var errs = [];
    var o = {
      game: clean(p.game, LIMITS.game), rank: clean(p.rank, LIMITS.rank), role: clean(p.role, LIMITS.role),
      play_time: clean(p.play_time, LIMITS.playTime), note: clean(p.note, LIMITS.note),
      slots: parseInt(p.slots, 10)
    };
    if (!o.game) errs.push('Укажите игру');
    if (!(o.slots >= 1 && o.slots <= LIMITS.maxSlots)) errs.push('Слотов должно быть от 1 до ' + LIMITS.maxSlots);
    return { ok: errs.length === 0, errors: errs, value: o };
  }
  function filterLfg(posts, f) {
    f = f || {};
    var game = (f.game || '').toLowerCase(), rank = (f.rank || '').toLowerCase();
    return posts.filter(function (p) {
      if (p.status && p.status !== 'open') return false;
      if (game && String(p.game).toLowerCase() !== game) return false;
      if (rank && String(p.rank || '').toLowerCase() !== rank) return false;
      if (f.onlyFree && !(p.slots > 0)) return false;
      return true;
    }).sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  }
  function computeStats(results) {
    var total = { wins: 0, losses: 0, games: 0, rate: 0 }, by = {};
    (results || []).forEach(function (r) {
      var g = by[r.game] || (by[r.game] = { game: r.game, wins: 0, losses: 0, games: 0, rate: 0 });
      if (r.result === 'win') { g.wins++; total.wins++; } else { g.losses++; total.losses++; }
      g.games++; total.games++;
    });
    function rate(x) { x.rate = x.games ? Math.round(x.wins * 100 / x.games) : 0; }
    rate(total);
    var list = Object.keys(by).map(function (k) { rate(by[k]); return by[k]; }).sort(function (a, b) { return b.games - a.games; });
    // текущая серия побед
    var streak = 0, sorted = (results || []).slice().sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
    for (var i = 0; i < sorted.length && sorted[i].result === 'win'; i++) streak++;
    total.streak = streak;
    return { total: total, byGame: list };
  }
  function tallyPoll(options, votes) {
    var counts = {}, total = 0;
    options.forEach(function (o) { counts[o.id] = 0; });
    votes.forEach(function (v) { if (counts[v.option_id] !== undefined) { counts[v.option_id]++; total++; } });
    var max = 0; options.forEach(function (o) { if (counts[o.id] > max) max = counts[o.id]; });
    return { counts: counts, total: total, leaders: max ? options.filter(function (o) { return counts[o.id] === max; }).map(function (o) { return o.id; }) : [] };
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtTime(iso, now) {
    var d = new Date(iso); if (isNaN(d)) return '';
    now = now || new Date();
    if (d.toDateString() === now.toDateString()) return pad(d.getHours()) + ':' + pad(d.getMinutes());
    var y = new Date(now); y.setDate(y.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'вчера';
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1);
  }
  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }
  function mapError(msg) {
    msg = String(msg || '');
    var m = [
      [/Invalid login credentials/i, 'Неверная почта или пароль'],
      [/already registered|already been registered|user_already_exists/i, 'Эта почта уже зарегистрирована'],
      [/profiles_nick_lower_uq|duplicate key.*nick/i, 'Этот ник уже занят'],
      [/Database error saving new user/i, 'Не удалось создать профиль: ник занят или содержит недопустимые символы'],
      [/invalid invite code/i, 'Неверный код приглашения'],
      [/no such user/i, 'Игрок с таким ником не найден'],
      [/too many open lfg/i, 'Слишком много открытых объявлений (максимум 5)'],
      [/too many servers/i, 'Слишком много серверов (максимум 10)'],
      [/too many channels/i, 'Слишком много каналов (максимум 20)'],
      [/group is full/i, 'Группа заполнена'],
      [/only (group|server) owner/i, 'Это может делать только владелец'],
      [/Email not confirmed/i, 'Подтвердите почту по ссылке из письма'],
      [/rate limit|too many requests|over_email_send_rate_limit/i, 'Слишком много попыток, подождите минуту'],
      [/Failed to fetch|NetworkError|Load failed/i, 'Нет соединения с сервером'],
      [/Password should be at least/i, 'Пароль слишком короткий (минимум 6 символов)'],
      [/Email address .* is invalid|Unable to validate email/i, 'Некорректная почта']
    ];
    for (var i = 0; i < m.length; i++) if (m[i][0].test(msg)) return m[i][1];
    return 'Ошибка: ' + clean(msg, 120);
  }

  return { LIMITS: LIMITS, GAMES: GAMES, GAME_NAMES: GAME_NAMES, ROLES: ROLES, EMOJIS: EMOJIS, COLORS: COLORS,
    esc: esc, clean: clean, validNick: validNick, validEmail: validEmail, validPassword: validPassword,
    validColor: validColor, safeColor: safeColor, dmKey: dmKey, ranksFor: ranksFor, validateLfg: validateLfg,
    filterLfg: filterLfg, computeStats: computeStats, tallyPoll: tallyPoll, fmtTime: fmtTime, plural: plural, mapError: mapError };
});
