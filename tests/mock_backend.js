// Локальный стенд, эмулирующий Supabase: минимальный GoTrue (signup/token/logout) + прокси /rest/v1 → настоящий PostgREST + Postgres со schema.sql.
// Realtime (WebSocket) НЕ эмулируется. Используется только для теста remote.js и RLS «через клиент».
const http = require('http'), crypto = require('crypto'), { spawn, execFileSync } = require('child_process');
const SECRET = 'test-secret-test-secret-test-secret-123456';
const b64 = b => Buffer.from(b).toString('base64url');
function jwt(payload) { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64(JSON.stringify(payload)); return h + '.' + p + '.' + crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest('base64url'); }
const ANON = jwt({ role: 'anon', iss: 'mock', exp: 4102444800 });
function psql(sql) { return execFileSync('sudo', ['-n', '-u', 'postgres', 'psql', '-At', '-d', 'gc_test', '-c', sql]).toString().trim(); }

exports.ANON = ANON;
exports.start = function (port, pgrstPort, pgrstBin) {
  const pg = spawn(pgrstBin, [], { env: Object.assign({}, process.env, { PGRST_DB_URI: 'postgres://authenticator:authpw@127.0.0.1/gc_test', PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: SECRET, PGRST_SERVER_PORT: String(pgrstPort), PGRST_SERVER_HOST: '127.0.0.1' }), stdio: 'ignore' });
  const users = {}; // email -> {id,pass}
  function session(u) {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const access = jwt({ sub: u.id, role: 'authenticated', aud: 'authenticated', email: u.email, exp, iss: 'mock' });
    return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: crypto.randomUUID(), user: { id: u.id, aud: 'authenticated', email: u.email, user_metadata: u.meta, app_metadata: {}, created_at: new Date().toISOString() } };
  }
  const srv = http.createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': '*' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
      const body = Buffer.concat(chunks), u = new URL(req.url, 'http://x');
      const json = (code, o) => { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, cors)); res.end(JSON.stringify(o)); };
      if (u.pathname === '/auth/v1/signup') {
        const d = JSON.parse(body.toString() || '{}'); const email = String(d.email).toLowerCase();
        if (users[email]) return json(422, { code: 'user_already_exists', msg: 'User already registered' });
        const id = crypto.randomUUID(), meta = d.data || {};
        try { psql(`insert into auth.users(id,email,raw_user_meta_data) values ('${id}','${email.replace(/'/g, "''")}','${JSON.stringify(meta).replace(/'/g, "''")}')`); }
        catch (e) { return json(500, { code: 'unexpected_failure', msg: 'Database error saving new user' }); }
        users[email] = { id, email, pass: d.password, meta }; return json(200, session(users[email]));
      }
      if (u.pathname === '/auth/v1/token') {
        const d = JSON.parse(body.toString() || '{}'); const us = users[String(d.email).toLowerCase()];
        if (!us || us.pass !== d.password) return json(400, { code: 'invalid_credentials', msg: 'Invalid login credentials', error_description: 'Invalid login credentials' });
        return json(200, session(us));
      }
      if (u.pathname === '/auth/v1/logout') { res.writeHead(204, cors); return res.end(); }
      if (u.pathname.startsWith('/rest/v1/')) {
        const p = http.request({ host: '127.0.0.1', port: pgrstPort, path: u.pathname.replace('/rest/v1', '') + u.search, method: req.method, headers: Object.assign({}, req.headers, { host: '127.0.0.1:' + pgrstPort }) }, r => {
          const hh = {}; Object.keys(r.headers).forEach(k => { if (!/^access-control/i.test(k)) hh[k] = r.headers[k]; }); res.writeHead(r.statusCode, Object.assign(hh, cors)); r.pipe(res);
        }); p.on('error', e => json(502, { message: String(e) })); p.end(body); return;
      }
      json(404, { message: 'not found' });
    });
  }).listen(port, '127.0.0.1');
  return new Promise(r => setTimeout(() => r({ close() { srv.close(); pg.kill(); } }), 1500));
};
