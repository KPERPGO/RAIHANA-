// The installed app opens from the copy saved on the phone, even when the internet is weak (connected but not answering),
// and a newly published version is offered with "tap to update" and used from the next open.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { chromium } = require('./pw');
const APP = path.resolve(__dirname, '..', 'dist', 'app'), PORT = 8791;
let mode = 'ok', tag = 'v1', fails = 0; const hung = [];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
http.createServer((req, res) => {
  if (mode === 'weak') return void hung.push(req.socket); // the request is accepted and never answered, like a weak phone signal
  const u = req.url.split('?')[0], f = path.join(APP, u === '/' ? 'index.html' : u);
  if (/^\/stub\./.test(u)){ res.writeHead(200, {'content-type': u.endsWith('.css') ? 'text/css' : 'text/javascript'}); return res.end(''); }
  if (!fs.existsSync(f)){ res.writeHead(404); return res.end(); }
  let body = fs.readFileSync(f).toString().replace('location.protocol === "https:"', 'true')
    .replace(/https:\/\/cdnjs\.cloudflare\.com\/[^"']+/g, '/stub.js').replace(/https:\/\/fonts\.googleapis\.com\/[^"']+/g, '/stub.css'); // localhost: let the worker run as on the real https site
  if (f.endsWith('.html')) body += `<!-- ${tag} -->`;
  const etag = '"' + crypto.createHash('md5').update(body).digest('hex') + '"';
  if (req.headers['if-none-match'] === etag){ res.writeHead(304, {etag}); return res.end(); }
  res.writeHead(200, {'content-type': f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream', 'cache-control': 'max-age=0', etag}); res.end(body);
}).listen(PORT);
setTimeout(() => { console.log('FAIL took too long'); process.exit(1); }, 120000);
(async () => {
  const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage(), errs = []; p.on('pageerror', e => errs.push(e.message));
  const URL = `http://localhost:${PORT}/`, ready = () => p.waitForFunction(() => window.BOOT && BOOT.done && !document.getElementById('boot'), null, { timeout: 15000 });
  const open = async () => { const t = Date.now(); await p.goto(URL, { waitUntil: 'commit', timeout: 15000 }); await ready(); return Date.now() - t; };
  await open(); await p.evaluate(() => Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(r, 10000))])); await p.waitForTimeout(500);
  ok(await p.evaluate(() => !!navigator.serviceWorker.controller) || (await open(), await p.evaluate(() => !!navigator.serviceWorker.controller)), 'the saved copy is in use after the first visit');
  mode = 'weak'; let ms = -1; try { ms = await open(); } catch {} mode = 'ok'; hung.forEach(x => x.destroy()); // the signal comes back
  ok(ms >= 0 && ms < 5000, `opens with a weak signal (${ms} ms)`);
  ok(!(await p.evaluate(() => !!document.getElementById('updBar'))), 'no update offer when nothing changed');
  tag = 'v2'; await open(); await p.waitForFunction(() => !!document.getElementById('updBar'), null, { timeout: 8000 }).catch(() => {});
  ok(await p.evaluate(() => !!document.getElementById('updBar')), 'a newly published version shows "tap to update"');
  await Promise.all([p.waitForNavigation({ timeout: 15000 }), p.click('#updBar')]); await ready();
  ok(await p.evaluate(() => new XMLSerializer().serializeToString(document).includes('<!-- v2 -->')), 'tapping it opens the new version');
  await p.waitForTimeout(800); ok(!(await p.evaluate(() => !!document.getElementById('updBar'))), 'the offer is gone once the new version is open');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  console.log(fails ? 'SOME FAILED' : 'PASS all'); await b.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH', e); process.exit(1); });
