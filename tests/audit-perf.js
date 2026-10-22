const ROOT = require('path').resolve(__dirname, '..'); // repo folder: src, dist, tests
// Performance probe: synthetic data only, local Chromium, fake runtime. Measures time to draw main screens.
const { chromium } = require('./pw');
const SP = ROOT + '';
(async () => {
  const b = await chromium.launch();
  for (const [nInv, nSales] of [[50, 2000], [300, 20000], [600, 60000]]) {
    const p = await b.newPage({ viewport: { width: 390, height: 844 } });
    await p.addInitScript({ path: SP + '/tests/fake.js' });
    await p.route('**/xlsx.full.min.js', r => r.fulfill({ body: '', contentType: 'text/javascript' }));
    await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await p.goto('file://' + SP + '/dist/erp-artifact.html'); await p.waitForTimeout(800);
    const r = await p.evaluate(async ([nInv, nSales]) => {
      const inv = [], names = 800;
      for (let i = 0; i < nInv; i++) inv.push({id:'I' + i, supplierId:'S1', invoiceNo:'N' + i, date:'2026-0' + (1 + i % 9) + '-10', status:'Approved for Posting', printedTotal:0, type:'credit',
        lines:Array.from({length:20}, (_, k) => ({desc:`Drug${(i * 20 + k) % names} ${10 + k}mg Tablet 20 tab`, name:'Drug' + ((i * 20 + k) % names), strength:(10 + k) + 'mg', form:'Tablet', pack:20, qty:10, price:1000, value:10000, batch:'B' + i, expiry:'2028-01'}))});
      __store.suppliers = {S1:{id:'S1', name:'Sup'}}; inv.forEach(x => __store.invoices[x.id] = x);
      __store.payments = {}; for (let i = 0; i < nInv; i++) __store.payments['P' + i] = {id:'P' + i, supplierId:'S1', invoiceId:'I' + i, amount:1000, verified:true, date:'2026-09-01'};
      ['suppliers','invoices','payments'].forEach(c => __seed(c, []));
      await new Promise(r => setTimeout(r, 500));
      const cat = catalog(); const sales = {};
      for (let i = 0; i < nSales; i++){ const pr = cat[i % cat.length], k = pr.lines[0]; sales['SL' + i] = {id:'SL' + i, no:'x', date:'2026-10-' + String(1 + i % 22).padStart(2,'0'), at:'2026-10-10T10:00:00Z', method:'cash', total:1500, lines:[{pid:pr.id, name:pr.name, qty:1, total:1500, alloc:[{key:k.inv.id + ':' + k.k, q:1, per:pr.sub, cost:50}]}]}; }
      __store.sales = sales; __seed('sales', []); await new Promise(r => setTimeout(r, 800));
      const t = {}; for (const tab of ['home','sell','stock','pricing','money','invoices','reports']){ S.tab = tab; const a = performance.now(); try { render(); } catch(e){ t[tab] = 'ERR ' + e.message; continue; } t[tab] = Math.round(performance.now() - a); }
      const a = performance.now(); clearMemo(); catalog(); const tc = Math.round(performance.now() - a);
      const json = JSON.stringify({i:__store.invoices, s:__store.sales}).length;
      return {products:cat.length, invoiceLines:nInv * 20, sales:Object.keys(__store.sales).length, msPerScreen:t, catalogBuildMs:tc, dataMB:(json / 1e6).toFixed(1), heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null};
    }, [nInv, nSales]);
    console.log(JSON.stringify(r));
    await p.close();
  }
  await b.close();
})().catch(e => { console.log('CRASH', e); process.exit(1); });
