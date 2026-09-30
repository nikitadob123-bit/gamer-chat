// Смоук боевого URL: загрузка, демо-режим, регистрация, SW, отсутствие внешних запросов. Запуск: node tests/smoke_live.js [url]
const puppeteer = require('/workspace/gc-tools/node_modules/puppeteer-core');
const URL_ = process.argv[2] || 'https://nikitadob123-bit.github.io/gamer-chat/';
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage(); await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const ext = [], errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('request', r => { const u = new URL(r.url()); if (u.origin !== new URL(URL_).origin && u.protocol.startsWith('http')) ext.push(r.url()); });
  const resp = await p.goto(URL_, { waitUntil: 'load' }); console.log('HTTP', resp.status());
  await p.waitForSelector('#auth-nick');
  await p.click('#seg-up'); await p.type('#auth-nick', 'Live_Check'); await p.type('#auth-pass', 'secret123'); await p.click('#auth-submit'); await p.waitForSelector('.tabbar');
  await new Promise(r => setTimeout(r, 1500));
  console.log('SW:', await p.evaluate(async () => !!(await navigator.serviceWorker.ready).active));
  await p.screenshot({ path: '/workspace/gamer-chat/docs/screens/30-live.png' });
  console.log('external requests:', ext.length, ext.join(','), '| errors:', errs.length);
  await b.close();
})();
