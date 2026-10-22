const ROOT = require('path').resolve(__dirname, '..'); // repo folder: src, dist, tests
// Zero-stock protection: stock never goes below zero, staff can't sell past it, the owner can with the PIN,
// items at zero stay everywhere, restocking reuses the item, and the alerts show in English and Arabic
const { chromium, XLSX_FILE } = require('./pw');
let fails = 0; const ok = (m, c, x) => { console.log(c ? 'ok  ' : 'FAIL', m, x === undefined ? '' : JSON.stringify(x)); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const fresh = async (lang) => {
    const p = await b.newPage({ viewport: { width: 390, height: 844 } }); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.errs = errs;
    await p.addInitScript({ path: ROOT + '/tests/fake.js' });
    await p.route('**/xlsx.full.min.js', r => r.fulfill({ path: XLSX_FILE, contentType: 'text/javascript' }));
    await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await p.goto('file://' + ROOT + '/tests/erp-artifact-test.html'); await p.waitForTimeout(800);
    await p.evaluate(async () => {
      Object.assign(__store, {products:{}, sales:{}, moves:{}, customers:{}, custpays:{}, chronic:{}, expenses:{}, closes:{}, counts:{}, staff:{}, shifts:{}, events:{}});
      __seed('suppliers', [{id:'SUP-T', name:'Test supplier', creditDays:30}]);
      __seed('invoices', [{id:'INV-T', supplierId:'SUP-T', invoiceNo:'T1', date:today(), type:'credit', status:'Approved for Posting', printedTotal:44000, lidSeq:3,
        lines:[{lid:'0', desc:'Alpha 10mg Tablet 10 tab', name:'Alpha', strength:'10mg', form:'Tablet', pack:10, qty:10, price:1000, value:10000, batch:'A1', expiry:'2028-01'},
               {lid:'1', desc:'Beta 20mg Syrup', name:'Beta', strength:'20mg', form:'Syrup', qty:2, price:2000, value:4000, batch:'B1', expiry:'2028-01'},
               {lid:'2', desc:'Gamma 5mg Syrup', name:'Gamma', strength:'5mg', form:'Syrup', qty:3, price:10000, value:30000, batch:'G1', expiry:'2020-01'}]}]);
      __seed('staff', [{id:'ST-O', name:'Owner', role:'owner', active:true, pinHash: await pinHash('ST-O', '1234')}, {id:'ST-C', name:'Cashier', role:'cashier', active:true, perms:['sell','stock']}]);
    });
    await p.waitForTimeout(300);
    await p.evaluate(async () => { for (const p of catalog()) await write('products/' + p.id, {id:p.id, sellBox:5000}); S.staff = E.staff.find(x => x.id === 'ST-C'); render(); });
    if (lang === 'ar') { await p.click('#langBtn'); await p.waitForTimeout(300); }
    await p.waitForTimeout(200); return p;
  };
  const id = (p, name) => p.evaluate(n => catalog().find(x => x.name === n)?.id, name);
  const stock = (p, pid) => p.evaluate(pid => { const x = catalog().find(q => q.id === pid); return x ? stockOf(x, usedMap(true)).good : 'ITEM GONE'; }, pid);
  const as = (p, who) => p.evaluate(w => { S.staff = E.staff.find(x => x.id === w); render(); }, who);
  // fill the open sale and press Save; returns the error text and the number of sales
  const sell = (p, cart) => p.evaluate(async cart => {
    S.tab = 'sell'; render(); S.cart = cart.map(([pid, qty]) => ({pid, mode:'box', qty, price:5000})); S.cartMeta = {}; saveCart(); render();
    document.getElementById('sellForm').requestSubmit(); await new Promise(r => setTimeout(r, 300));
    return {err: document.getElementById('xErr')?.textContent || '', sales: E.sales.filter(s => !s.voided).length, owner: !!document.querySelector('[data-xoversell]'), force: !!document.getElementById('xForce')};
  }, cart);
  const answer = (p, pin) => p.evaluate(async pin => { for (let i = 0; i < 40 && !document.getElementById('ownerPin'); i++) await new Promise(r => setTimeout(r, 25)); const el = document.getElementById('ownerPin'); if (!el) return 'no dialog';
    if (pin === null){ el.querySelector('[data-ocancel]').click(); return 'cancelled'; } for (const ch of pin) el.querySelector(`[data-opin="${ch}"]`).click(); el.querySelector('[data-opinok]')?.click(); await new Promise(r => setTimeout(r, 150)); return 'pin'; }, pin);
  const ownerButton = p => p.evaluate(() => { document.querySelector('[data-xoversell]').click(); });

  { const p = await fresh('en'); const A = await id(p, 'Alpha'), B = await id(p, 'Beta'), G = await id(p, 'Gamma');
    // 1. the final unit sells
    let r = await sell(p, [[B, 2]]); ok('1 sell the last 2 boxes of Beta', r.sales === 1 && !r.err && await stock(p, B) === 0, r);
    // 2. at zero, staff are blocked with the owner's wording, and no "sell anyway" box exists
    r = await sell(p, [[B, 1]]);
    ok('2 sale at zero is blocked with the OUT OF STOCK message', r.sales === 1 && /OUT OF STOCK — Available quantity: 0\. This sale cannot be completed\. Restock the item or remove it from the invoice\./.test(r.err) && !r.force, r);
    ok('2 the blocked attempt is recorded for the owner', await p.evaluate(() => E.events.filter(e => e.type === 'blocked_sale').length) >= 1);
    ok('2 the cart line already warns before saving', await p.evaluate(() => /OUT OF STOCK/.test(document.querySelector('#view').innerText)));
    // 3. oversell: staff blocked; the owner button asks the PIN; Cancel saves nothing; the PIN saves it marked approved
    r = await sell(p, [[A, 11]]); ok('3 overselling Alpha (10 in stock) is blocked', r.sales === 1 && /NOT ENOUGH STOCK — Available quantity: 10 boxes/.test(r.err) && r.owner, r.err);
    await ownerButton(p); ok('3 owner button opens the PIN dialog', await answer(p, null) === 'cancelled'); await p.waitForTimeout(300);
    ok('3 owner pressed Cancel: nothing sold', await p.evaluate(() => E.sales.filter(s => !s.voided).length) === 1 && await stock(p, A) === 100);
    await sell(p, [[A, 11]]); await ownerButton(p); await answer(p, '1234'); await p.waitForTimeout(400);
    const last = await p.evaluate(() => [...E.sales].sort((a, b) => a.at.localeCompare(b.at)).pop());
    ok('3 owner PIN: sale saved, approved by the owner, stock shows −1 box', last.approvedBy === 'ST-O' && await stock(p, A) === -10 && (last.approvedFor || []).some(w => /past the stock/.test(w)), {approvedBy:last.approvedBy, stock: await stock(p, A)});
    await p.evaluate(() => closeSheet());
    // the owner signed in still types the PIN to sell past zero
    await as(p, 'ST-O'); r = await sell(p, [[B, 1]]); ok('3 owner signed in is also stopped first', r.owner && r.sales === 2, r); await ownerButton(p);
    ok('3 owner signed in: PIN still asked', await answer(p, null) === 'cancelled'); await p.waitForTimeout(200); await as(p, 'ST-C');
    // 12. two open sales for the last box on one device: the second is blocked at save time
    await p.evaluate(async () => { const pid = catalog().find(x => x.name === 'Alpha').id; const s = stockOf(catalog().find(x => x.id === pid), usedMap(true)).good; await write('moves/MV-FIX2', {id:'MV-FIX2', pid, key:'adj:' + pid, q:s - 10, per:10, reason:'Count correction (less found)', note:'Stocktaking', date:today(), at:new Date().toISOString(), cost:100, approvedBy:'ST-O'}); });
    await p.waitForTimeout(200); const a0 = await stock(p, A);
    const two = await p.evaluate(async pid => { S.tab = 'sell'; render(); S.tabs = [{n:1, lines:[{pid, mode:'box', qty:1, price:5000}], meta:{}}, {n:2, lines:[{pid, mode:'box', qty:1, price:5000}], meta:{}}]; S.tabAt = 0; saveCart(); render();
      document.getElementById('sellForm').requestSubmit(); await new Promise(r => setTimeout(r, 300)); closeSheet(); S.tabAt = S.tabs.findIndex(t => t.lines.length); render();
      document.getElementById('sellForm').requestSubmit(); await new Promise(r => setTimeout(r, 300)); return document.getElementById('xErr')?.textContent || ''; }, A);
    const a1 = await stock(p, A); ok('12 two open sales for the last box: the first sells, the second is blocked', a0 === 10 && /OUT OF STOCK/.test(two) && a1 === 0, {a0, a1, two:two.slice(0, 60)});
    await p.evaluate(() => closeSheet());
    // 4. items at zero stay: search, Stock "Out of stock" filter, item card, Excel
    const vis = await p.evaluate(async () => { S.tab = 'sell'; S.sellQ = 'Beta'; render(); const sell = /Beta/.test(document.querySelector('#view').innerText); S.sellQ = '';
      S.tab = 'stock'; S.stockF = 'out'; render(); const out = document.querySelector('#view').innerText; S.stockF = 'all';
      const sheets = {}; window.extraSheets((n, rows) => { sheets[n] = rows; }); return {sell, out: /Beta/.test(out) && /Gamma/.test(out), excel: (sheets['Out of stock'] || []).map(r => r.Item), items: catalog().length}; });
    ok('4 zero-stock items stay in Sell search, the Out of stock filter and the Excel list', vis.sell && vis.out && vis.excel.some(n => /Beta/.test(n)) && vis.items === 3, vis);
    // 7. expired batch: not sellable; write-off limited to what the batch has
    r = await sell(p, [[G, 1]]); ok('7 expired Gamma cannot be sold', /OUT OF STOCK/.test(r.err), r.err);
    await p.evaluate(() => closeSheet());
    // 3b/8. write-offs never take a batch below zero (owner signed in, so no PIN dialog is involved)
    await as(p, 'ST-O');
    const wo = async (pid, key, qty) => p.evaluate(async ([pid, key, qty]) => { prodSheet(pid); await new Promise(r => setTimeout(r, 100)); document.getElementById('aKey').value = key; document.getElementById('aReason').value = 'Expired'; document.getElementById('aQty').value = qty;
      document.getElementById('adjForm').requestSubmit(); await new Promise(r => setTimeout(r, 300)); return document.getElementById('aErr')?.textContent || ''; }, [pid, key, qty]);
    const e1 = await wo(G, 'INV-T:2', 4); ok('8 write-off of 4 boxes from a batch with 3 is refused', /Only 3 boxes left in this batch/.test(e1), e1);
    const e2 = await wo(G, 'INV-T:2', 3); ok('8 write-off of the 3 expired boxes works', !e2 && await p.evaluate(() => E.moves.some(m => m.key === 'INV-T:2' && m.q === 3)), e2);
    await p.evaluate(() => closeSheet());
    // 9. return to supplier: no more than the line still has
    const ret = await p.evaluate(() => { const inv = S.invoices.find(i => i.id === 'INV-T'); return {max: ERP_RET_MAX(inv, 1), stop: ERP_RET_GUARD('INV-T', {1:1}), ok: ERP_RET_GUARD('INV-T', {0:0})}; });
    ok('9 return of a sold-out line is refused', ret.max === 0 && /only 0 left from this invoice line/.test(ret.stop) && ret.ok === '', ret);
    // 10/11. invoice edit and receiving can't go below what was sold
    const ed = await p.evaluate(() => { const inv = structuredClone(S.invoices.find(i => i.id === 'INV-T')); inv.lines[1].qty = 1; return ERP_INV_GUARD(inv); });
    ok('10 invoice edit below what was sold is refused', /already sold, written off or returned/.test(ed), ed.slice(0, 120));
    const rc = await p.evaluate(() => ERP_RECV_GUARD(S.invoices.find(i => i.id === 'INV-T'), {1:{qty:1, issue:'OK'}}));
    ok('11 receiving count below what was sold is refused', /already sold or written off/.test(rc), rc);
    // 6. cancelling a sale puts its stock back
    const before = await stock(p, B);
    await p.evaluate(async () => { const s = E.sales.find(x => !x.voided && x.lines.some(l => l.name.startsWith('Beta'))); receiptSheet(s.id); const btn = document.querySelector('[data-xsalevoid]'); btn.click(); document.getElementById('voidReason').value = 'test'; btn.click(); await new Promise(r => setTimeout(r, 400)); });
    ok('6 cancelled sale: Beta back to 2 boxes', before === 0 && await stock(p, B) === 2, [before, await stock(p, B)]);
    await p.evaluate(() => closeSheet());
    // 5. restocking: same words reuse the item; a different spelling asks, and "same item" keeps one item
    const restock = async (no, desc) => p.evaluate(async ([no, desc]) => { invoiceForm(); await new Promise(r => setTimeout(r, 100)); $('#fSup').value = 'SUP-T'; $('#fNo').value = no; $('#fTotal').value = '6000';
      const l = document.querySelector('#lines .lineedit'); l.querySelector('[data-f="desc"]').value = desc; l.querySelector('[data-f="qty"]').value = '3'; l.querySelector('[data-f="price"]').value = '2000'; l.querySelector('[data-f="value"]').value = '6000';
      document.getElementById('invForm').requestSubmit(); await new Promise(r => setTimeout(r, 300)); return {ask:[...document.querySelectorAll('[data-xsame]')].map(x => ({key:x.dataset.xsame, opts:[...x.options].map(o => o.value)})), saved: S.invoices.some(i => i.invoiceNo === no)}; }, [no, desc]);
    let rs = await restock('R1', 'Beta 20mg Syrup');
    await p.waitForTimeout(300); ok('5 restock with the same words: no question, same item, stock 2 + 3', rs.saved && !rs.ask.length && await stock(p, B) === 5 && await p.evaluate(() => catalog().length) === 3, rs);
    await p.evaluate(() => closeSheet());
    rs = await restock('R2', 'Betta 20mg Syrup'); // a typo on the new invoice
    ok('5 a different spelling asks "same item?" before saving', !rs.saved && rs.ask.length === 1 && rs.ask[0].opts.includes(B), rs);
    await p.selectOption(`[data-xsame="${rs.ask[0].key}"]`, B); await p.evaluate(() => document.getElementById('invForm').requestSubmit()); await p.waitForTimeout(500);
    ok('5 "same item" keeps one Beta and adds the stock to it', await p.evaluate(() => S.invoices.some(i => i.invoiceNo === 'R2')) && await stock(p, B) === 8 && await p.evaluate(() => catalog().length) === 3, {stock: await stock(p, B)});
    await p.evaluate(() => closeSheet());
    // item card shows the full stock history
    const hist = await p.evaluate(pid => { prodSheet(pid); const t = document.getElementById('sheet').textContent; closeSheet(); return t; }, B);
    ok('item card: stock history lists came in, sold and cancelled', /Stock history/.test(hist) && /Came in/.test(hist) && /Sold, then cancelled/.test(hist), hist.slice(hist.indexOf('Stock history'), hist.indexOf('Stock history') + 160));
    // 13. alerts
    const al = await p.evaluate(() => { S.tab = 'home'; render(); return {types:[...new Set(stockAlerts().map(a => a.type))], home: /Stock alerts/.test(document.querySelector('#view').textContent)}; });
    ok('13 alerts: out of stock, blocked sales, owner override, expired… on Home', ['out', 'blocked', 'override'].every(t => al.types.includes(t)) && al.home, al);
    await p.evaluate(async () => { await write('meta/erp', {...E.cfg, alertsOff:['blocked']}); });
    await p.waitForTimeout(200); ok('13 an alert type switched off in Settings disappears', !(await p.evaluate(() => stockAlerts().some(a => a.type === 'blocked'))));
    ok('no page errors', !p.errs.length, p.errs); await p.close(); }

  // 13/14 Arabic: the out-of-stock message and the alerts are in Arabic; staff see no override box
  { const p = await fresh('ar'); const B = await id(p, 'Beta');
    await sell(p, [[B, 2]]); await p.evaluate(() => closeSheet()); const r = await sell(p, [[B, 1]]);
    ok('14 Arabic: out-of-stock message', /نفد من المخزون — الكمية المتوفرة: 0\. لا يمكن إكمال هذا البيع\. أعد تزويد المادة أو احذفها من الفاتورة\./.test(r.err) && !/OUT OF STOCK/.test(r.err), r.err);
    ok('14 staff have no "sell anyway" box', !r.force);
    const home = await p.evaluate(() => { S.tab = 'home'; render(); const sec = [...document.querySelectorAll('#view section')].find(s => /تنبيهات المخزون/.test(s.textContent)); return sec ? sec.textContent : [...document.querySelectorAll('#view h2')].map(h => h.textContent).join('|'); });
    ok('13 Arabic: Home alerts translated', home && !/Out of stock|Restock it|Sale blocked|wanted|available|Stock alerts/.test(home), home.slice(0, 200));
    ok('no page errors (Arabic)', !p.errs.length, p.errs); await p.close(); }

  console.log(fails ? `${fails} FAILED` : 'PASS all zero-stock checks'); await b.close(); process.exit(fails ? 1 : 0);
})();
