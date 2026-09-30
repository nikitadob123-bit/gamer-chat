const assert = require('assert');
const U = require('../js/util.js');
let n = 0; function t(name, fn) { try { fn(); n++; console.log('ok  -', name); } catch (e) { console.error('FAIL -', name, '\n', e.message); process.exitCode = 1; } }

t('esc экранирует HTML', () => {
  assert.strictEqual(U.esc('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'.replace('src=x', 'src=x'));
  assert.ok(!/[<>"']/.test(U.esc(`<script>'"&</script>`)));
});
t('clean: длина, управляющие символы, пробелы', () => {
  assert.strictEqual(U.clean('  a \u0000 b\t\tc  ', 50), 'a b c');
  assert.strictEqual(U.clean('x'.repeat(5000), 2000).length, 2000);
  assert.strictEqual(Array.from(U.clean('😀'.repeat(30), 10)).length, 10);
  assert.strictEqual(U.clean('a\r\nb\n\n\n\n\nc', 100, true), 'a\nb\n\n\nc');
  assert.strictEqual(U.clean(null, 5), '');
});
t('валидация ника', () => {
  ['abc', 'Neon_Fox9', 'a'.repeat(20)].forEach(n => assert.ok(U.validNick(n), n));
  ['ab', 'a'.repeat(21), 'ник', 'a b', 'a@b', '<x>', '', null].forEach(n => assert.ok(!U.validNick(n), String(n)));
});
t('валидация пароля/цвета/email', () => {
  assert.ok(U.validPassword('123456')); assert.ok(!U.validPassword('12345')); assert.ok(!U.validPassword('x'.repeat(73)));
  assert.ok(U.validColor('#aabbcc')); assert.ok(!U.validColor('red;background:url(x)')); assert.strictEqual(U.safeColor('javascript:1'), '#7c4dff');
  assert.ok(U.validEmail('a@b.co')); assert.ok(!U.validEmail('a@b'));
});
t('dmKey симметричен', () => assert.strictEqual(U.dmKey('b', 'a'), U.dmKey('a', 'b')));
t('validateLfg', () => {
  assert.ok(U.validateLfg({ game: 'Dota 2', slots: 2 }).ok);
  assert.ok(!U.validateLfg({ game: '', slots: 2 }).ok);
  assert.ok(!U.validateLfg({ game: 'X', slots: 0 }).ok);
  assert.ok(!U.validateLfg({ game: 'X', slots: 10 }).ok);
  assert.strictEqual(U.validateLfg({ game: 'X', slots: 1, note: 'n'.repeat(999) }).value.note.length, 200);
});
t('filterLfg по игре/рангу/статусу', () => {
  const P = [
    { id: 1, game: 'Valorant', rank: 'Gold', slots: 1, status: 'open', created_at: '2026-01-01' },
    { id: 2, game: 'Valorant', rank: 'Diamond', slots: 2, status: 'open', created_at: '2026-01-03' },
    { id: 3, game: 'Dota 2', rank: 'Gold', slots: 1, status: 'open', created_at: '2026-01-02' },
    { id: 4, game: 'Valorant', rank: 'Gold', slots: 1, status: 'closed', created_at: '2026-01-04' }];
  assert.deepStrictEqual(U.filterLfg(P, {}).map(p => p.id), [2, 3, 1]);
  assert.deepStrictEqual(U.filterLfg(P, { game: 'Valorant' }).map(p => p.id), [2, 1]);
  assert.deepStrictEqual(U.filterLfg(P, { game: 'valorant', rank: 'Gold' }).map(p => p.id), [1]);
});
t('computeStats', () => {
  const R = [{ game: 'A', result: 'win', created_at: '3' }, { game: 'A', result: 'win', created_at: '2' }, { game: 'B', result: 'loss', created_at: '1' }, { game: 'A', result: 'loss', created_at: '0' }];
  const s = U.computeStats(R);
  assert.strictEqual(s.total.wins, 2); assert.strictEqual(s.total.losses, 2); assert.strictEqual(s.total.rate, 50); assert.strictEqual(s.total.streak, 2);
  assert.strictEqual(s.byGame[0].game, 'A'); assert.strictEqual(s.byGame[0].rate, 67);
  assert.strictEqual(U.computeStats([]).total.rate, 0);
});
t('tallyPoll', () => {
  const o = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const r = U.tallyPoll(o, [{ option_id: 'a' }, { option_id: 'b' }, { option_id: 'b' }, { option_id: 'zzz' }]);
  assert.deepStrictEqual(r.counts, { a: 1, b: 2, c: 0 }); assert.strictEqual(r.total, 3); assert.deepStrictEqual(r.leaders, ['b']);
  assert.deepStrictEqual(U.tallyPoll(o, []).leaders, []);
});
t('plural', () => {
  assert.strictEqual(U.plural(1, 'голос', 'голоса', 'голосов'), 'голос'); assert.strictEqual(U.plural(3, 'голос', 'голоса', 'голосов'), 'голоса');
  assert.strictEqual(U.plural(5, 'голос', 'голоса', 'голосов'), 'голосов'); assert.strictEqual(U.plural(11, 'голос', 'голоса', 'голосов'), 'голосов');
  assert.strictEqual(U.plural(21, 'голос', 'голоса', 'голосов'), 'голос'); assert.strictEqual(U.plural(112, 'голос', 'голоса', 'голосов'), 'голосов');
});
t('fmtTime', () => {
  const now = new Date(2026, 8, 30, 12, 0);
  assert.strictEqual(U.fmtTime(new Date(2026, 8, 30, 9, 5).toISOString(), now), '09:05');
  assert.strictEqual(U.fmtTime(new Date(2026, 8, 29, 9, 5).toISOString(), now), 'вчера');
  assert.strictEqual(U.fmtTime(new Date(2026, 8, 1, 9, 5).toISOString(), now), '01.09');
});
t('mapError по-русски', () => {
  assert.strictEqual(U.mapError('Invalid login credentials'), 'Неверная почта или пароль');
  assert.strictEqual(U.mapError('invalid invite code'), 'Неверный код приглашения');
  assert.ok(/^Ошибка: /.test(U.mapError('weird')));
});
t('справочники игр', () => {
  assert.ok(U.GAME_NAMES.length >= 10); U.GAME_NAMES.forEach(g => assert.ok(U.ranksFor(g).length > 0 && g.length <= U.LIMITS.game));
  U.GAME_NAMES.forEach(g => U.ranksFor(g).forEach(r => assert.ok(r.length <= U.LIMITS.rank)));
});
console.log(n + ' тестов пройдено');
