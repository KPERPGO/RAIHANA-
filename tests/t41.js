// Cloud sign-in that stays signed in, and a loud, easy way back when the cloud signs a device out.
// The fake Supabase rotates refresh tokens like the real one: each refresh token works once, and using an old one again
// ends the session (as Supabase's reuse detection does). Changing the password ends every session.
const http = require('http');
const { chromium } = require('./pw');
let fails = 0; const ok = (c, m, x) => { console.log(c ? 'ok  ' : 'FAIL', m, x === undefined ? '' : JSON.stringify(x)); if (!c) fails++; };
const docs = new Map(); let ver = 0, password = 'pw1', n = 0, refreshCalls = 0, revoked = false;
const live = new Set(), used = new Set(), access = new Set();
const server = http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS'){ res.writeHead(204, cors); return res.end(); }
  let body = ''; req.on('data', d => body += d); req.on('end', () => {
    const url = new URL(req.url, 'http://x'), send = (code, o) => { res.writeHead(code, cors); res.end(JSON.stringify(o)); };
    const session = () => { const a = 'a' + (++n), r = 'r' + n; access.add(a); live.add(r); return { access_token: a, refresh_token: r, expires_in: 3600, user: { id: 'u1', user_metadata: {} } }; };
    if (url.pathname === '/auth/v1/token'){
      const j = JSON.parse(body || '{}');
      if (url.searchParams.get('grant_type') === 'password') return j.password === password ? send(200, session()) : send(400, { error_description: 'Invalid login credentials' });
      refreshCalls++;
      if (live.has(j.refresh_token)){ live.delete(j.refresh_token); used.add(j.refresh_token); return send(200, session()); }
      if (used.has(j.refresh_token)){ revoked = true; live.clear(); access.clear(); } // reuse of a spent token: the whole session ends
      return send(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
    }
    const tok = (req.headers.authorization || '').replace('Bearer ', '');
    if (!access.has(tok)) return send(401, { message: 'JWT expired' });
    if (url.pathname === '/rest/v1/rpc/erp_push'){
      const out = []; for (const r of JSON.parse(body).rows){ const v = ++ver; docs.set(r.path, { data: r.data, ver: v }); out.push({ path: r.path, ok: true, ver: v }); }
      return send(200, out);
    }
    if (url.pathname === '/rest/v1/erp_docs'){ const gt = +(url.searchParams.get('ver') || 'gt.0').replace('gt.', ''); return send(200, [...docs].map(([path, d]) => ({ path, data: d.data, ver: d.ver })).filter(x => x.ver > gt).sort((a, b) => a.ver - b.ver)); }
    send(404, {});
  });
}).listen(8767);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 800 } });
  const tab = async () => { const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(800); return p; };
  const run = p => p.evaluate(async () => { while (ERP_SYNC.busy) await new Promise(r => setTimeout(r, 50)); await ERP_SYNC.run(); });
  const expire = p => p.evaluate(() => { const c = JSON.parse(localStorage.getItem('erp.sync')); c.exp = Date.now() - 1000; localStorage.setItem('erp.sync', JSON.stringify(c)); });
  const put = (p, path, v) => p.evaluate(([a, c]) => ERP_LOCAL.put(a, c), [path, v]);
  const A = await tab();
  await put(A, 'customers/C1', { name: 'one' });
  await A.evaluate(() => ERP_SYNC.login('http://localhost:8767', 'anon', 'boss@x.com', 'pw1')); await A.waitForTimeout(300); await run(A);
  ok(docs.has('customers/C1') && (await A.evaluate(() => ERP_SYNC.status.state)) === 'ok', 'connected and uploaded');
  ok(!!(await A.evaluate(() => ERP_SYNC.lastOk())), 'the last good sync time is kept');

  // an hour later: the token refreshes and the new one is saved
  await expire(A); await run(A);
  ok(refreshCalls === 1 && (await A.evaluate(() => JSON.parse(localStorage.getItem('erp.sync')).refresh)) !== 'r1' && !revoked, 'the sign-in refreshes and the new token is saved', refreshCalls);

  // two open tabs of the app reach the refresh time together: only one refresh, nobody reuses a spent token
  const B = await tab(); await run(B); await expire(A); refreshCalls = 0;
  await Promise.all([A.evaluate(() => ERP_SYNC.run()), B.evaluate(() => ERP_SYNC.run())]);
  await run(A); await run(B);
  ok(refreshCalls === 1 && !revoked, 'two tabs: one refresh, the session stays alive', { refreshCalls, revoked });
  await expire(A); await run(B); await run(A);
  ok(!revoked && (await A.evaluate(() => ERP_SYNC.status.state)) === 'ok' && (await B.evaluate(() => ERP_SYNC.status.state)) === 'ok', 'later refreshes from either tab still work', { revoked });

  // a sync that started before another tab refreshed must not write the old token back
  await expire(A); const slowB = B.evaluate(() => ERP_SYNC.run()); await A.evaluate(() => ERP_SYNC.run()); await slowB; await expire(A); await run(A);
  ok(!revoked, 'a slower tab does not put the spent token back');
  await B.close();

  // the password is changed in Supabase: every session ends
  password = 'pw2'; live.clear(); access.clear();
  await put(A, 'customers/C2', { name: 'made while signed out' }); await A.waitForTimeout(200); await expire(A); await run(A);
  ok(await A.evaluate(() => ERP_SYNC.signedOut() && ERP_SYNC.status.state === 'signedout'), 'the device knows it was signed out', await A.evaluate(() => ERP_SYNC.status));
  ok((await A.evaluate(() => ERP_SYNC.pending())) >= 1 && !docs.has('customers/C2'), 'the change made meanwhile waits on the device');
  const callsBefore = refreshCalls; await run(A); await run(A);
  ok(refreshCalls === callsBefore, 'it stops asking the cloud with a dead sign-in');
  // the warning shows on Sell, the cashier's screen, not only in Settings
  await A.evaluate(() => { S.tab = 'sell'; render(); }); await A.waitForTimeout(200);
  ok(await A.evaluate(() => /Cloud sync stopped/.test(document.querySelector('#syncCard')?.innerText || '')), 'Sell shows the signed-out warning');
  await A.click('#syncCard [data-tab="settings"]'); await A.waitForTimeout(300);
  ok(await A.evaluate(() => S.tab === 'settings' && !!document.querySelector('#reloginForm') && !document.querySelector('#syncForm')), 'the button opens Settings with a password-only sign-in');
  ok(await A.evaluate(() => /boss@x\.com/.test(document.querySelector('#reloginForm').innerText)), 'the email is already filled in');
  await A.fill('#zPass', 'pw1'); await A.click('#reloginForm button[type=submit]'); await A.waitForTimeout(400);
  const zerr = await A.textContent('#zErr').catch(() => 'no field'); ok(/Wrong email or password/.test(zerr) && await A.evaluate(() => ERP_SYNC.signedOut()), 'a wrong password says so and stays signed out', zerr);
  await A.fill('#zPass', 'pw2'); await A.click('#reloginForm button[type=submit]'); await A.waitForTimeout(400); await run(A);
  ok(docs.get('customers/C2')?.data?.name === 'made while signed out' && !(await A.evaluate(() => ERP_SYNC.pending())), 'after signing in again the waiting change uploads');
  ok(await A.evaluate(() => !ERP_SYNC.signedOut() && ERP_SYNC.status.state === 'ok' && !document.querySelector('#reloginForm')), 'back to normal: no warning, no password form');
  ok(await A.evaluate(() => JSON.parse(localStorage.getItem('erp.sync')).url === 'http://localhost:8767'), 'the Project URL and key were kept, nothing to retype');
  await A.evaluate(() => { S.tab = 'sell'; render(); }); await A.waitForTimeout(200);
  ok(await A.evaluate(() => !document.querySelector('#syncCard')), 'Sell has no warning once syncing works');

  // a short cloud hiccup does not shout; only a long one does
  await A.evaluate(() => { ERP_SYNC.set({state: 'error', msg: 'Cloud refused the changes (500).'}); render(); });
  ok(await A.evaluate(() => !document.querySelector('#syncCard')), 'a fresh error does not show the warning');
  await A.evaluate(() => { ERP_SYNC.status.okAt = new Date(Date.now() - 7 * 3600e3).toISOString(); render(); });
  ok(await A.evaluate(() => /not working/.test(document.querySelector('#syncCard')?.innerText || '')), 'an error lasting over 6 hours shows the warning');
  // Arabic
  await A.evaluate(() => { ERP_SYNC.set({state: 'signedout'}); const c = JSON.parse(localStorage.getItem('erp.sync')); c.signedOut = true; localStorage.setItem('erp.sync', JSON.stringify(c)); S.lang = 'ar'; render(); });
  ok(await A.evaluate(() => /توقفت المزامنة السحابية/.test(document.querySelector('#syncCard')?.innerText || '') && !/change\(s\)/.test(document.querySelector('#syncCard').innerText)), 'the warning is in Arabic', await A.evaluate(() => document.querySelector('#syncCard')?.innerText));
  ok(!A.errs.length, 'no page errors', A.errs);
  await b.close(); server.close();
  console.log(fails ? `${fails} FAILED` : 'PASS all sign-in checks'); process.exit(fails ? 1 : 0);
})();
