const ROOT = require('path').resolve(__dirname, '..'); // repo folder: src, dist, tests
// Cloud sync between two devices against a fake Supabase that behaves like src/supabase-setup.sql:
// server-counted versions, first save wins, the loser is kept in conflicts, only listed members may use it
const http = require('http');
const { chromium } = require('./pw');
let fails = 0; const ok = (c, m, x) => { console.log(c ? 'ok  ' : 'FAIL', m, x === undefined ? '' : JSON.stringify(x)); if (!c) fails++; };
const docs = new Map(), conflicts = []; let ver = 0; const members = ['boss@x.com'];
const server = http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS'){ res.writeHead(204, cors); return res.end(); }
  let body = ''; req.on('data', d => body += d); req.on('end', () => {
    const url = new URL(req.url, 'http://x'), send = (code, o) => { res.writeHead(code, cors); res.end(JSON.stringify(o)); };
    if (url.pathname === '/auth/v1/token'){ const { email } = JSON.parse(body || '{}'); return email ? send(200, { access_token: 't:' + email, refresh_token: 'r', expires_in: 3600, user: { id: 'u-' + email, user_metadata: {} } }) : send(400, { error_description: 'bad' }); }
    const who = (req.headers.authorization || '').replace('Bearer t:', '');
    if (url.pathname === '/rest/v1/rpc/erp_push'){
      if (!members.includes(who)) return send(403, { message: 'Not a pharmacy member' });
      const out = [];
      for (const r of JSON.parse(body).rows){
        const cur = docs.get(r.path), same = cur && JSON.stringify(cur.data) === JSON.stringify(r.data);
        if (same) out.push({ path: r.path, ok: true, ver: cur.ver });
        else if (!cur || cur.ver === r.base){ const v = ++ver; docs.set(r.path, { data: r.data, ver: v }); out.push({ path: r.path, ok: true, ver: v }); }
        else { conflicts.push({ path: r.path, mine: r.data, theirs: cur.data }); out.push({ path: r.path, ok: false, ver: cur.ver, data: cur.data }); }
      }
      return send(200, out);
    }
    if (url.pathname === '/rest/v1/erp_docs'){
      if (!members.includes(who)) return send(200, []);
      const gt = +(url.searchParams.get('ver') || 'gt.0').replace('gt.', '');
      return send(200, [...docs].map(([path, d]) => ({ path, data: d.data, ver: d.ver })).filter(x => x.ver > gt).sort((a, b) => a.ver - b.ver).slice(0, 500));
    }
    send(404, {});
  });
}).listen(8766);
(async () => {
  const b = await chromium.launch(), URL_ = 'http://localhost:8766';
  const dev = async () => { const c = await b.newContext({ viewport: { width: 390, height: 800 } }), p = await c.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(800); return p; };
  const run = async (p) => { await p.evaluate(async () => { while (ERP_SYNC.busy) await new Promise(r => setTimeout(r, 50)); await ERP_SYNC.run(); }); await p.waitForTimeout(400); }; // a background sync may be running: wait for it, then sync
  const A = await dev(), B = await dev();
  const put = (p, path, v) => p.evaluate(([a, c]) => ERP_LOCAL.put(a, c), [path, v]);
  const get = (p, path) => p.evaluate(async path => { const all = await ERP_LOCAL.all(); return (all.find(([k]) => k === path) || [])[1]; }, path);
  const login = (p, e) => p.evaluate(e => ERP_SYNC.login('http://localhost:8766', 'anon', e, 'pw'), e);

  await put(A, 'customers/C1', { name: 'Start' }); await login(A, 'boss@x.com'); await run(A);
  ok(docs.get('customers/C1')?.ver === 1, 'A: a record made before connecting is uploaded when joining', [...docs.keys()]);
  await put(B, 'expenses/E9', { amount: 5 }); await login(B, 'boss@x.com'); await run(B);
  ok((await get(B, 'customers/C1'))?.name === 'Start' && docs.has('expenses/E9'), 'B: gets A\'s record and uploads its own on joining');
  ok((await get(B, 'customers/C1')).__ver === undefined && docs.get('customers/C1').data.__ver === undefined, 'versions are kept out of the records the app sees and out of the cloud data');
  // both edit the same record while apart; A reaches the server first
  await put(A, 'customers/C1', { name: 'A-edit' }); await put(B, 'customers/C1', { name: 'B-edit' });
  await run(A); await run(B);
  ok((await get(B, 'customers/C1'))?.name === 'A-edit', 'B: the first save wins and B now shows it', await get(B, 'customers/C1'));
  ok(conflicts.length === 1 && conflicts[0].mine.name === 'B-edit', 'B\'s change is kept in the cloud conflicts, not thrown away', conflicts);
  ok((await B.evaluate(() => ERP_SYNC.status.conflicts)) === 1 && !await B.evaluate(() => ERP_SYNC.pending()), 'B is told about it and has nothing stuck waiting');
  await B.click('nav.tabs [data-tab="settings"], #menuBtn').catch(() => {}); await B.evaluate(() => { S.tab = 'settings'; render(); }); await B.waitForTimeout(300);
  ok(await B.evaluate(() => /another device saved the same record first/.test(document.body.innerText)), 'B: Settings shows the notice');
  await B.click('[data-xclearconf="1"]'); await B.waitForTimeout(200);
  ok(await B.evaluate(() => !ERP_SYNC.status.conflicts), 'B: the notice can be dismissed');
  // later edits carry on from the new version with no false conflict
  await put(B, 'customers/C1', { name: 'B-again' }); await run(B); await run(A);
  ok(conflicts.length === 1 && (await get(A, 'customers/C1'))?.name === 'B-again', 'a later edit by B goes through and reaches A', conflicts.length);
  // a signed-in person who is not on the pharmacy list
  const Cc = await dev(); await put(Cc, 'customers/X', { name: 'x' }); await login(Cc, 'stranger@x.com'); await run(Cc);
  ok(/not on the pharmacy list/.test(await Cc.evaluate(() => ERP_SYNC.status.msg || '')) && !docs.has('customers/X'), 'a person not on the list is refused and nothing is written', await Cc.evaluate(() => ERP_SYNC.status));
  // offline work waits and goes up later
  await A.context().setOffline(true); await put(A, 'customers/C2', { name: 'offline' }); await A.waitForTimeout(300);
  ok((await A.evaluate(() => ERP_SYNC.pending())) >= 1 && !docs.has('customers/C2'), 'A offline: change waits on the device');
  await A.context().setOffline(false); await run(A);
  ok(docs.has('customers/C2') && !await A.evaluate(() => ERP_SYNC.pending()), 'A back online: it uploads');
  for (const p of [A, B, Cc]) ok(!p.errs.length, 'no page errors', p.errs);
  await b.close(); server.close();
  console.log(fails ? `${fails} FAILED` : 'PASS all sync checks'); process.exit(fails ? 1 : 0);
})();
