const ROOT = require('path').resolve(__dirname, '..'); // repo folder: src, dist, tests
// Phase A (27 Nov 2026): safe saves, no duplicate sales, a clear saving / saved / not saved label, sync that survives a
// weak or dropped internet, two devices changing the same record, and speed with a big stock list and many sales.
// Installed-app mode (device storage) against a fake Supabase that behaves like src/supabase-setup.sql.
const http = require('http');
const { chromium } = require('./pw');
let fails = 0; const ok = (m, c, x) => { console.log(c ? 'ok  ' : 'FAIL', m, x === undefined ? '' : JSON.stringify(x)); if (!c) fails++; };
const docs = new Map(), conflicts = []; let ver = 0, mode = 'normal', pushes = 0;
const server = http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS'){ res.writeHead(204, cors); return res.end(); }
  let body = ''; req.on('data', d => body += d); req.on('end', () => {
    const url = new URL(req.url, 'http://x'), send = (code, o) => { res.writeHead(code, cors); res.end(JSON.stringify(o)); };
    if (url.pathname === '/auth/v1/token') return send(200, { access_token: 't', refresh_token: 'r', expires_in: 3600, user: { id: 'u1', user_metadata: {} } });
    if (mode === 'hang') return; // connected, but the answer never comes
    if (mode === 'down'){ req.socket.destroy(); return; }
    if (url.pathname === '/rest/v1/rpc/erp_push'){
      pushes++; const out = [];
      for (const r of JSON.parse(body).rows){
        const cur = docs.get(r.path), same = cur && JSON.stringify(cur.data) === JSON.stringify(r.data);
        if (same) out.push({ path: r.path, ok: true, ver: cur.ver });
        else if (!cur || cur.ver === r.base){ const v = ++ver; docs.set(r.path, { data: r.data, ver: v }); out.push({ path: r.path, ok: true, ver: v }); }
        else { conflicts.push({ path: r.path, mine: r.data, theirs: cur.data }); out.push({ path: r.path, ok: false, ver: cur.ver, data: cur.data }); }
      }
      if (mode === 'lose-answer'){ mode = 'normal'; req.socket.destroy(); return; } // saved in the cloud, but the phone never hears back
      return send(200, out);
    }
    if (url.pathname === '/rest/v1/erp_docs'){
      const gt = +(url.searchParams.get('ver') || 'gt.0').replace('gt.', '');
      return send(200, [...docs].map(([path, d]) => ({ path, data: d.data, ver: d.ver })).filter(x => x.ver > gt).sort((a, b) => a.ver - b.ver).slice(0, 500));
    }
    send(404, {});
  });
}).listen(8767);

(async () => {
  const b = await chromium.launch(), CLOUD = 'http://localhost:8767';
  const dev = async (w = 390) => { const c = await b.newContext({ viewport: { width: w, height: 844 } }), p = await c.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
    await p.route('**/xlsx.full.min.js', r => r.fulfill({ body: '', contentType: 'text/javascript' }));
    await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await p.goto('http://localhost:8765/index.html'); await p.waitForFunction(() => typeof S !== 'undefined' && S.ready && S.db); await p.waitForTimeout(400); return p; };
  const idle = p => p.evaluate(async () => { while (ERP_SYNC.busy) await new Promise(r => setTimeout(r, 50)); });
  const sync = async p => { await idle(p); await p.evaluate(() => ERP_SYNC.run()); await idle(p); await p.waitForTimeout(200); };
  const disk = (p, prefix) => p.evaluate(prefix => new Promise(res => { const r = indexedDB.open('raihana-erp'); r.onsuccess = () => { const out = []; const c = r.result.transaction('docs').objectStore('docs').openCursor();
    c.onsuccess = () => { const x = c.result; if (x){ if (String(x.key).startsWith(prefix) && !x.value.__deleted) out.push(x.value); x.continue(); } else { r.result.close(); res(out); } }; }; }), prefix);
  const label = p => p.evaluate(() => { const el = document.getElementById('saveDot'); return el && !el.hidden ? el.className + ':' + el.textContent : ''; });
  const day = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
  const seed = p => p.evaluate(async day => {
    await write('suppliers/SUP-T', {id:'SUP-T', name:'Test supplier', creditDays:30});
    await write('invoices/INV-T', {id:'INV-T', pid:'INV-T', supplierId:'SUP-T', invoiceNo:'T1', date:day, type:'credit', status:'Approved for Posting', printedTotal:20000, lidSeq:2,
      lines:[{lid:'0', desc:'Alpha 10mg Tablet 30 tab', name:'Alpha', strength:'10mg', form:'Tablet', pack:30, blisters:3, qty:10, price:1000, value:10000, batch:'A1', expiry:'2028-01'},
             {lid:'1', desc:'Beta 20mg Syrup', name:'Beta', strength:'20mg', form:'Syrup', qty:20, price:500, value:10000, batch:'B1', expiry:'2028-01'}]});
    for (const x of catalog()) await write('products/' + x.id, {id:x.id, sellBox:5000});
  }, day);
  const cartOf = (p, lines) => p.evaluate(lines => { closeSheet(); S.tab = 'sell'; S.cart = lines.map(l => { const x = catalog().find(q => q.name === l.n); return {pid:x.id, mode:'box', qty:l.qty || 1, price:lvlPrice(x, 'box')}; }); saveCart(); render(); }, lines);
  const stock = (p, n) => p.evaluate(n => { const x = catalog().find(q => q.name === n); return stockOf(x, usedMap()).good; }, n);

  const A = await dev(); await seed(A);
  ok('setup: two items in stock with prices', await A.evaluate(() => catalog().length === 2 && catalog().every(x => x.sellBox === 5000)));

  // 1. double tap on Save: one sale, not two
  await cartOf(A, [{n:'Alpha'}]);
  await A.evaluate(() => { const f = document.getElementById('sellForm'); f.requestSubmit(); f.requestSubmit(); f.requestSubmit(); });
  await A.waitForTimeout(600);
  ok('three quick taps on Save make one sale', (await disk(A, 'sales/')).length === 1, (await disk(A, 'sales/')).length);
  ok('the label says saved', /good:Saved/.test(await label(A)), await label(A));
  await A.evaluate(() => closeSheet());

  // 2. a save that fails on the device: nothing half-saved, the label says so, the bill stays, and Save again saves it once
  await cartOf(A, [{n:'Alpha'}, {n:'Beta'}]);
  await A.evaluate(() => { window.__put = IDBObjectStore.prototype.put; let n = 0; IDBObjectStore.prototype.put = function(){ throw new DOMException('lost', 'UnknownError'); };
    document.getElementById('sellForm').requestSubmit(); });
  await A.waitForTimeout(600);
  const failed = await A.evaluate(() => ({err: document.getElementById('xErr')?.textContent || '', cart: S.cart.length, id: S.cartMeta.saleId}));
  ok('failed save: a clear message on the bill', /Couldn't save on this device/.test(failed.err), failed);
  ok('failed save: the bill is still there to try again', failed.cart === 2 && !!failed.id);
  ok('failed save: label says "Not saved"', /^bad:Not saved/.test(await label(A)), await label(A));
  ok('failed save: no sale on the device', (await disk(A, 'sales/')).length === 1);
  await A.evaluate(() => { IDBObjectStore.prototype.put = __put; }); await A.waitForTimeout(4200); // the earlier "Saved" has gone
  await A.evaluate(() => closeSheet()); await A.click('#saveDot'); await A.waitForTimeout(200);
  ok('tapping the label tells why and clears it', /Couldn't save on this device/.test(await A.evaluate(() => document.getElementById('toast').textContent)) && !(await label(A)));
  await A.evaluate(() => document.getElementById('sellForm').requestSubmit()); await A.waitForTimeout(600);
  const sales = await disk(A, 'sales/');
  ok('Save again: the sale is saved once, with the receipt number it got at the first try', sales.length === 2 && sales.some(s => s.id === failed.id), sales.map(s => s.id));
  ok('stock went down once for each sale', await stock(A, 'Alpha') === 240 && await stock(A, 'Beta') === 19, [await stock(A, 'Alpha'), await stock(A, 'Beta')]);
  await A.evaluate(() => closeSheet());

  // 3. the app closed right after saving, before the bill was cleared: reopening it does not sell it again
  await cartOf(A, [{n:'Beta'}]);
  const sid = await A.evaluate(async () => { S.cartMeta.saleId = 'SL-AGAIN'; saveCart(); await write('sales/SL-AGAIN', {id:'SL-AGAIN', no:'x', date:today(), at:nowIso(), lines:[], subtotal:0, discount:0, total:0, method:'cash'}); return S.cartMeta.saleId; });
  await A.evaluate(() => document.getElementById('sellForm').requestSubmit()); await A.waitForTimeout(500);
  ok('a bill that was already saved is not saved twice', (await disk(A, 'sales/')).length === 3 && /already saved/.test(await A.evaluate(() => document.getElementById('toast').textContent)) && !(await A.evaluate(() => S.cartMeta.saleId)), sid);
  await A.evaluate(() => closeSheet());

  // 4. a return with two batch lines, and a stocktake: all lines or none
  const retBefore = (await disk(A, 'moves/')).length;
  const r4 = await A.evaluate(async () => { const put = IDBObjectStore.prototype.put; let n = 0; IDBObjectStore.prototype.put = function(...a){ if (++n >= 2) throw new DOMException('lost', 'UnknownError'); return put.apply(this, a); }; // the 2nd record fails, also when tried again
    try { await writeMany([{path:'moves/MV-X1', data:{id:'MV-X1', pid:'x', key:'adj:x', q:1, per:1, reason:'t'}}, {path:'moves/MV-X2', data:{id:'MV-X2', pid:'x', key:'adj:x', q:1, per:1, reason:'t'}}]); return 'saved'; }
    catch(e){ return e.message; } finally { IDBObjectStore.prototype.put = put; } });
  ok('records saved together: a failure keeps none of them', /Couldn't save/.test(r4) && (await disk(A, 'moves/')).length === retBefore && !(await A.evaluate(() => E.moves.some(m => m.id === 'MV-X1'))), r4);
  ok('and none waits for the cloud', await A.evaluate(() => !JSON.parse(localStorage.getItem('erp.dirty') || '[]').some(p => p.startsWith('moves/MV-X'))));
  await A.evaluate(() => { S.count = {started:nowIso(), counts:{[catalog().find(x => x.name === 'Alpha').id]:200, [catalog().find(x => x.name === 'Beta').id]:100}}; lsSet('erp.count', S.count); });
  await A.evaluate(() => { const put = IDBObjectStore.prototype.put; let n = 0; window.__put2 = put; IDBObjectStore.prototype.put = function(...a){ if (++n >= 2) throw new DOMException('lost', 'UnknownError'); return put.apply(this, a); }; });
  await A.evaluate(() => { const bt = document.createElement('button'); document.body.appendChild(bt); const e = document.createElement('p'); e.id = 'ctErr'; document.body.appendChild(e); window.__ct = ctSave(bt); });
  await A.waitForTimeout(300);
  await A.evaluate(() => { IDBObjectStore.prototype.put = __put2; });
  ok('failed stocktake corrects nothing', await stock(A, 'Alpha') === 240 && (await disk(A, 'counts/')).length === 0, await stock(A, 'Alpha'));
  await A.evaluate(async () => { const bt = document.createElement('button'); await ctSave(bt); });
  ok('stocktake saved again: counted once', await stock(A, 'Alpha') === 200 && await stock(A, 'Beta') === 100 && (await disk(A, 'counts/')).length === 1, [await stock(A, 'Alpha'), await stock(A, 'Beta')]);
  await A.evaluate(() => closeSheet());

  // 5. busy counter: 40 sales one after another, every one kept, every receipt number different
  const t0 = Date.now();
  for (let i = 0; i < 40; i++){ await cartOf(A, [{n:'Beta'}]); await A.evaluate(() => document.getElementById('sellForm').requestSubmit()); await A.waitForFunction(n => E.sales.length >= n, 4 + i, {timeout: 5000}); await A.evaluate(() => closeSheet()); }
  const all = await disk(A, 'sales/');
  ok('40 quick sales: all saved', all.length === 43, all.length);
  ok('40 quick sales: receipt numbers all different', new Set(all.map(s => s.no)).size === all.length);
  ok('40 quick sales take under 20 s here', Date.now() - t0 < 20000, Date.now() - t0);

  // 6. cloud: joins, then the internet drops in different ways
  await A.evaluate(u => ERP_SYNC.login(u, 'anon', 'boss@x.com', 'pw'), CLOUD); await sync(A);
  ok('cloud: everything uploads', docs.size >= 50 && !(await A.evaluate(() => ERP_SYNC.pending())), docs.size);
  mode = 'hang'; await A.evaluate(() => { ERP_SYNC.timeoutMs = 1500; }); await A.evaluate(() => write('customers/CU-H', {id:'CU-H', name:'Hang'})); await A.waitForTimeout(400);
  await A.evaluate(() => ERP_SYNC.run()); await idle(A);
  const st = await A.evaluate(() => ERP_SYNC.status);
  ok('no answer from the cloud: gives up after the time limit, not stuck', st.state === 'error' && /did not answer in time/.test(st.msg) && !(await A.evaluate(() => ERP_SYNC.busy)), st);
  await A.evaluate(() => { ERP_SYNC.lastOkSave = ERP_SYNC.status.okAt; ERP_SYNC.status = {...ERP_SYNC.status, state:'error'}; SAVE.last = null; SAVE.show(); });
  ok('the label shows what has not reached the cloud yet', /^wait:1 not uploaded yet/.test(await label(A)), await label(A));
  mode = 'normal'; await A.waitForFunction(() => ERP_SYNC.status.state === 'ok', null, {timeout: 9000}).catch(() => {});
  ok('the internet comes back: it tries again by itself within seconds and uploads', docs.has('customers/CU-H') && !(await A.evaluate(() => ERP_SYNC.pending())), await A.evaluate(() => ERP_SYNC.status));
  ok('label clears once everything is in the cloud', !(await label(A)), await label(A));
  mode = 'lose-answer'; const c0 = conflicts.length; await A.evaluate(() => write('customers/CU-L', {id:'CU-L', name:'Lost answer'})); await A.waitForTimeout(100);
  await A.evaluate(() => ERP_SYNC.run()); await idle(A); await sync(A);
  ok('the cloud saved it but the answer was lost: sending again is accepted, no conflict, no copy', docs.has('customers/CU-L') && conflicts.length === c0 && !(await A.evaluate(() => ERP_SYNC.pending())), conflicts.length - c0);

  // 7. two devices change the same record while apart
  const B = await dev(); await B.evaluate(u => ERP_SYNC.login(u, 'anon', 'boss@x.com', 'pw'), CLOUD); await sync(B);
  ok('second device gets everything', (await disk(B, 'sales/')).length === 43 && await stock(B, 'Beta') === await stock(A, 'Beta'), await stock(B, 'Beta'));
  const pid = await A.evaluate(() => catalog().find(x => x.name === 'Alpha').id);
  await A.evaluate(pid => write('products/' + pid, {sellBox:6000}, true), pid);
  await B.evaluate(pid => write('products/' + pid, {shelf:'B2'}, true), pid);
  await sync(A); await sync(B); await sync(A);
  const pa = await A.evaluate(pid => E.prods.find(x => x.id === pid), pid), pb = await B.evaluate(pid => E.prods.find(x => x.id === pid), pid);
  ok('different fields of one record: both changes are kept on both devices', pa.sellBox === 6000 && pa.shelf === 'B2' && pb.sellBox === 6000 && pb.shelf === 'B2', [pa, pb]);
  ok('and it is not counted as a conflict', !(await B.evaluate(() => ERP_SYNC.status.conflicts)));
  await A.evaluate(pid => write('products/' + pid, {sellBox:7000}, true), pid);
  await B.evaluate(pid => write('products/' + pid, {sellBox:6500}, true), pid);
  await sync(A); await sync(B); await sync(A);
  const qa = await A.evaluate(pid => E.prods.find(x => x.id === pid).sellBox, pid), qb = await B.evaluate(pid => E.prods.find(x => x.id === pid).sellBox, pid);
  ok('the same field on both: the first save wins on both devices, the other is kept in the cloud', qa === 7000 && qb === 7000 && conflicts.some(c => c.mine.sellBox === 6500), [qa, qb]);
  ok('and the second device is told', (await B.evaluate(() => ERP_SYNC.status.conflicts)) === 1);
  // both sell at the same time while offline
  await A.context().setOffline(true); await B.context().setOffline(true);
  for (const P of [A, B]){ await cartOf(P, [{n:'Beta'}]); await P.evaluate(() => document.getElementById('sellForm').requestSubmit()); await P.waitForTimeout(400); await P.evaluate(() => closeSheet()); }
  ok('offline: each sale is saved on its device and waits', (await A.evaluate(() => ERP_SYNC.pending())) >= 1 && (await B.evaluate(() => ERP_SYNC.pending())) >= 1);
  await A.context().setOffline(false); await B.context().setOffline(false); await sync(A); await sync(B); await sync(A);
  const sa = await disk(A, 'sales/'), sb = await disk(B, 'sales/');
  ok('back online: both sales on both devices, none lost or doubled', sa.length === 45 && sb.length === 45 && new Set(sa.map(s => s.no)).size === 45, [sa.length, sb.length]);
  ok('stock the same on both devices', await stock(A, 'Beta') === await stock(B, 'Beta'), [await stock(A, 'Beta'), await stock(B, 'Beta')]);

  // 8. big pharmacy: 3,000 items, 20,000 sales on the phone. Opening and screens stay quick
  const C = await dev();
  await C.evaluate(async () => {
    const lines = Array.from({length:3000}, (_, k) => ({lid:String(k), desc:`Drug${k} ${10 + k % 40}mg Tablet 20 tab`, name:'Drug' + k, strength:(10 + k % 40) + 'mg', form:'Tablet', pack:20, qty:50, price:1000, value:50000, batch:'B' + k, expiry:'2029-01'}));
    const ops = [{path:'suppliers/S1', data:{id:'S1', name:'Sup'}}];
    for (let i = 0; i < 30; i++) ops.push({path:'invoices/I' + i, data:{id:'I' + i, pid:'I' + i, supplierId:'S1', invoiceNo:'N' + i, date:'2026-10-01', status:'Approved for Posting', type:'credit', printedTotal:0, lidSeq:100, lines:lines.slice(i * 100, i * 100 + 100).map((l, j) => ({...l, lid:String(j)}))}});
    await writeMany(ops);
    const cat = catalog(), s = [];
    for (let i = 0; i < 20000; i++){ const pr = cat[i % cat.length]; s.push({path:'sales/SL' + i, data:{id:'SL' + i, no:'N' + i, date:'2026-11-' + String(1 + i % 26).padStart(2, '0'), at:'2026-11-10T10:00:00Z', method:'cash', total:1000, subtotal:1000, discount:0,
      lines:[{pid:pr.id, name:pr.name, mode:'box', unit:'box', per:20, qty:1, price:1000, total:1000, alloc:[{key:pr.lines[0].inv.id + ':' + pr.lines[0].l.lid, batch:'', expiry:'', q:20, per:20, cost:50}]}]}}); }
    for (let i = 0; i < s.length; i += 2000) await writeMany(s.slice(i, i + 2000));
  });
  ok('big data: 3,000 items and 20,000 sales saved', await C.evaluate(() => catalog().length === 3000 && E.sales.length === 20000), await C.evaluate(() => [catalog().length, E.sales.length]));
  const t1 = Date.now(); await C.reload(); await C.waitForFunction(() => typeof S !== 'undefined' && S.ready && E.sales.length === 20000, null, {timeout: 30000}); const openMs = Date.now() - t1;
  ok('big data: the app opens with everything in under 8 s here', openMs < 8000, openMs);
  const times = await C.evaluate(() => { const t = {}; for (const tab of ['home', 'sell', 'stock', 'money', 'reports']){ S.tab = tab; const a = performance.now(); render(); t[tab] = Math.round(performance.now() - a); } return t; });
  ok('big data: each main screen draws in under 1.5 s here', Object.values(times).every(v => v < 1500), times);
  const keyMs = await C.evaluate(() => { S.tab = 'sell'; render(); const a = performance.now(); for (let i = 0; i < 5; i++){ S.sellQ = 'Drug12' + i; render(); } return Math.round((performance.now() - a) / 5); });
  ok('big data: typing in the Sell search redraws in under 400 ms', keyMs < 400, keyMs);

  // 9. Arabic: the label is translated
  await A.evaluate(() => { S.lang = 'ar'; SAVE.last = {ok:true, at:Date.now()}; SAVE.show(); });
  ok('Arabic: the saved label is in Arabic', /تم الحفظ|محفوظ/.test(await label(A)), await label(A));
  await A.evaluate(() => { SAVE.last = {ok:false, msg:'x', at:Date.now()}; SAVE.show(); });
  ok('Arabic: the not-saved label is in Arabic', /لم يُحفظ/.test(await label(A)), await label(A));

  for (const P of [A, B, C]) ok('no page errors', !P.errs.length, P.errs);
  await b.close(); server.close();
  console.log(fails ? `${fails} FAILED` : 'PASS all reliability checks'); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH', e); process.exit(1); });
