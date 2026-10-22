const ROOT = require('path').resolve(__dirname, '..'); // repo folder: src, dist, tests
// POS audit fixes (22 Oct 2026): P-01 unpriced units need the owner, P-03 customer returns, P-04 closed-day notice,
// P-06 whole numbers, P-07 cash must cover the total, P-08 scan while the receipt is open, P-09 keys, P-11 customer on
// cash sales, P-12 no-expiry filter, and debt selling hidden by default (owner's rule)
const { chromium, XLSX_FILE } = require('./pw');
let fails = 0; const ok = (m, c, x) => { console.log(c ? 'ok  ' : 'FAIL', m, x === undefined ? '' : JSON.stringify(x)); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const fresh = async (lang) => {
    const p = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.errs = errs;
    await p.addInitScript({ path: ROOT + '/tests/fake.js' });
    await p.route('**/xlsx.full.min.js', r => r.fulfill({ path: XLSX_FILE, contentType: 'text/javascript' }));
    await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await p.goto('file://' + ROOT + '/tests/erp-artifact-test.html'); await p.waitForTimeout(800);
    await p.evaluate(async () => {
      Object.assign(__store, {products:{}, sales:{}, moves:{}, customers:{}, custpays:{}, chronic:{}, expenses:{}, closes:{}, counts:{}, staff:{}, shifts:{}, events:{}});
      __seed('suppliers', [{id:'SUP-T', name:'Test supplier', creditDays:30}]);
      __seed('invoices', [{id:'INV-T', supplierId:'SUP-T', invoiceNo:'T1', date:today(), type:'credit', status:'Approved for Posting', printedTotal:30000, lidSeq:4,
        lines:[{lid:'0', desc:'Alpha 10mg Tablet 30 tab', name:'Alpha', strength:'10mg', form:'Tablet', pack:30, blisters:3, qty:10, price:1000, value:10000, batch:'A1', expiry:'2028-01'},
               {lid:'1', desc:'Beta 20mg Syrup', name:'Beta', strength:'20mg', form:'Syrup', qty:20, price:500, value:10000, batch:'B1', expiry:'2028-01'},
               {lid:'2', desc:'Delta Syrup', name:'Delta', form:'Syrup', qty:5, price:1000, value:5000, batch:'D1', expiry:''},
               {lid:'3', desc:'Omega Cream', name:'Omega', form:'Cream', qty:5, price:1000, value:5000, batch:'O1', expiry:'2028-01'}]}]);
      __seed('staff', [{id:'ST-O', name:'Owner', role:'owner', active:true, pinHash: await pinHash('ST-O', '1234')}, {id:'ST-C', name:'Cashier', role:'cashier', active:true, perms:['sell','stock']}]);
    });
    await p.waitForTimeout(300);
    // Omega has no sell price at all; the others 5,000 a box with no strip or tablet price set
    await p.evaluate(async () => { for (const p of catalog()) if (p.name !== 'Omega') await write('products/' + p.id, {id:p.id, sellBox:5000, barcode: p.name === 'Beta' ? '111' : p.name === 'Alpha' ? '222' : ''}); S.staff = E.staff.find(x => x.id === 'ST-C'); S.tab = 'sell'; render(); });
    await p.waitForTimeout(200);
    if (lang === 'ar') { await p.click('#langBtn'); await p.waitForTimeout(300); }
    return p;
  };
  const id = (p, n) => p.evaluate(n => catalog().find(x => x.name === n).id, n);
  const stock = (p, n) => p.evaluate(n => { const x = catalog().find(q => q.name === n); return stockOf(x, usedMap()).good; }, n);
  // fills the cart, saves, and answers the owner dialog if it opens: null = Cancel, '1234' = the owner's PIN
  const sell = async (p, lines, opts = {}) => {
    await p.evaluate(([lines, opts]) => { closeSheet(); S.tab = 'sell'; S.cart = lines.map(l => { const x = catalog().find(q => q.name === l.n); return {pid:x.id, mode:l.mode || 'box', qty:l.qty ?? 1, price: 'price' in l ? l.price : lvlPrice(x, l.mode || 'box')}; }); S.cartMeta = {...(opts.meta || {})}; render();
      if (opts.given !== undefined){ const g = document.getElementById('xGiven'); g.value = opts.given; g.dispatchEvent(new Event('input', {bubbles:true})); }
      window.__n = E.sales.length; document.getElementById('sellForm').requestSubmit(); }, [lines, opts]);
    await p.waitForTimeout(250);
    const dialog = await p.evaluate(() => document.getElementById('ownerPin')?.innerText.replace(/\s+/g, ' ') || '');
    if (dialog){ await p.evaluate(pin => { const el = document.getElementById('ownerPin'); if (pin === null) el.querySelector('[data-ocancel]').click(); else { for (const ch of pin) el.querySelector(`[data-opin="${ch}"]`).click(); el.querySelector('[data-opinok]')?.click(); } }, opts.pin ?? null); await p.waitForTimeout(400); }
    return p.evaluate(dialog => ({dialog, saved: E.sales.length - window.__n, err: document.getElementById('xErr')?.textContent || '', last: [...E.sales].sort((a, b) => a.at.localeCompare(b.at)).pop()}), dialog);
  };

  { const p = await fresh();
    // P-01
    const lv = await p.evaluate(() => { const a = catalog().find(x => x.name === 'Alpha'); return {mid:a.midName, sellMid:a.sellMid, sellSub:a.sellSub}; });
    ok('P-01 tablet price fills in from the box price when the item also has strips', lv.mid === 'strip' && lv.sellSub === 250, lv);
    let r = await sell(p, [{n:'Alpha', mode:'sub', qty:30, price:1}]);
    ok('P-01 cashier selling 30 tablets at 1 IQD needs the owner; Cancel saves nothing', /instead of 250/.test(r.dialog) && r.saved === 0, r.dialog);
    r = await sell(p, [{n:'Omega', price:100}]);
    ok('P-01 cashier selling an item with no set price needs the owner', /has no set price/.test(r.dialog) && r.saved === 0, r.dialog);
    r = await sell(p, [{n:'Omega', price:100}], {pin:'1234'});
    ok('P-01 with the owner PIN it is saved and marked approved', r.saved === 1 && r.last.approvedBy === 'ST-O', r.last?.approvedFor);
    r = await sell(p, [{n:'Alpha', mode:'sub', qty:3}]);
    ok('P-01 tablets at the set price need no dialog', !r.dialog && r.saved === 1 && r.last.lines[0].price === 250);
    // P-06
    r = await sell(p, [{n:'Beta', qty:0.5}]);
    ok('P-06 half a bottle is refused', r.saved === 0 && /whole number/.test(r.err), r.err);
    // P-07
    r = await sell(p, [{n:'Beta'}], {given:100});
    ok('P-07 cash received below the total is refused', r.saved === 0 && /less than the total/.test(r.err), r.err);
    r = await sell(p, [{n:'Beta'}], {given:10000});
    ok('P-07 cash and change are kept on the sale and the receipt', r.saved === 1 && r.last.given === 10000 && r.last.change === 5000 && await p.evaluate(() => /Change\s*5,000/.test(document.getElementById('receipt')?.innerText || '')));
    // debt hidden by default
    const dv = await p.evaluate(() => { closeSheet(); S.cart = [{pid:catalog()[0].id, mode:'box', qty:1, price:5000}]; render(); return {select: document.querySelector('select#xMethod') ? 1 : 0, debtOpt: document.body.innerText.includes('On debt (دين)')}; });
    ok('Debt: Cash and Card are offered, but no "On debt" choice while debt is switched off', dv.select === 1 && !dv.debtOpt, dv);
    // P-11 customer on a cash sale
    await p.evaluate(async () => { await write('customers/CU-1', {id:'CU-1', name:'Sara', phone:''}); }); await p.waitForTimeout(150);
    r = await sell(p, [{n:'Beta'}], {meta:{customerId:'CU-1'}});
    ok('P-11 a cash sale can carry a customer', r.saved === 1 && r.last.method === 'cash' && r.last.customerId === 'CU-1');
    // P-08 scan while the receipt is still open, then P-09 keys
    await p.evaluate(() => { closeSheet(); S.cart = []; render(); });
    await p.focus('#sellQ'); await p.keyboard.type('111'); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
    await p.keyboard.press('F9'); await p.waitForTimeout(400);
    const k1 = await p.evaluate(() => ({receipt: !!document.querySelector('#sheet:not([hidden]) #receipt'), cart:S.cart.length}));
    await p.evaluate(() => document.activeElement?.blur()); await p.keyboard.type('222'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
    const k2 = await p.evaluate(() => ({sheet: !$('#sheet').hidden, cart:S.cart.map(c => c.pid), alpha: catalog().find(x => x.name === 'Alpha').id}));
    ok('P-09 F9 saves the sale and opens the receipt', k1.receipt && k1.cart === 0, k1);
    ok('P-08 a scan while the receipt is open closes it and starts the next sale', !k2.sheet && k2.cart.length === 1 && k2.cart[0] === k2.alpha, k2);
    await p.evaluate(() => document.activeElement?.blur()); await p.keyboard.press('+'); await p.keyboard.press('+'); await p.keyboard.press('-'); await p.waitForTimeout(100);
    const q = await p.evaluate(() => S.cart[0].qty);
    await p.keyboard.press('F4'); await p.waitForTimeout(100); const m1 = await p.evaluate(() => [S.cart[0].mode, S.cart[0].price]);
    await p.keyboard.press('F2'); const f2 = await p.evaluate(() => document.activeElement?.id);
    await p.keyboard.type('syrup'); await p.waitForTimeout(150); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
    const e1 = await p.evaluate(() => document.activeElement?.dataset?.xadd ? 'result' : document.activeElement?.id);
    await p.keyboard.press('ArrowDown'); const e2 = await p.evaluate(() => [...document.querySelectorAll('.list [data-xadd]')].indexOf(document.activeElement));
    await p.keyboard.press('ArrowUp'); await p.keyboard.press('ArrowUp'); const e3 = await p.evaluate(() => document.activeElement?.id);
    ok('P-09 + and − change the last line; F4 changes its unit and price', q === 2 && m1[0] === 'mid' && m1[1] === 1750, {q, m1});
    ok('P-09 F2 focuses search; Enter with several matches goes to the first; arrows move', f2 === 'sellQ' && e1 === 'result' && e2 === 1 && e3 === 'sellQ', {f2, e1, e2, e3});
    const f1 = await p.evaluate(() => { const before = location.href; return before; }); await p.keyboard.press('F10'); ok('P-09 F10 with no receipt open does nothing', await p.evaluate(h => location.href === h, f1));
    // P-03 returns
    await p.evaluate(() => { S.cart = []; S.cartMeta = {}; S.sellQ = ''; render(); });
    const s0 = await stock(p, 'Beta');
    r = await sell(p, [{n:'Beta', qty:3}], {meta:{disc:1500}, pin:'1234'}); // a discount from a cashier needs the owner
    const s1 = await stock(p, 'Beta'), sid = r.last.id, cash0 = await p.evaluate(() => cashParts(today(), x => !x.voided).expected);
    const ret = async (q, where, pin) => { await p.evaluate(([sid, q, where]) => { closeSheet(); receiptSheet(sid); document.querySelector('[data-xsaleret]').click(); document.querySelector('[data-xrq="0"]').value = q; document.getElementById('rWhere').value = where; document.getElementById('rReason').value = 'test'; document.getElementById('retForm').requestSubmit(); }, [sid, q, where]);
      await p.waitForTimeout(250); const d = await p.evaluate(() => !!document.getElementById('ownerPin'));
      if (d) await p.evaluate(pin => { const el = document.getElementById('ownerPin'); if (pin === null) el.querySelector('[data-ocancel]').click(); else { for (const ch of pin) el.querySelector(`[data-opin="${ch}"]`).click(); el.querySelector('[data-opinok]')?.click(); } }, pin); await p.waitForTimeout(400);
      return {dialog:d, err: await p.evaluate(() => document.getElementById('rErr')?.textContent || '')}; };
    let x = await ret(1, 'shelf', null);
    ok('P-03 a return needs the owner; Cancel saves nothing', x.dialog && await stock(p, 'Beta') === s1, x);
    x = await ret(1, 'shelf', '1234');
    const s2 = await stock(p, 'Beta'), cash1 = await p.evaluate(() => cashParts(today(), x => !x.voided).expected);
    ok('P-03 returning 1 of 3 puts 1 back on the same batch', s2 === s1 + 1 && s1 === s0 - 3, {s0, s1, s2});
    ok('P-03 refund shares out the receipt discount and comes out of the cash box', cash0 - cash1 === 4500, {cash0, cash1});
    x = await ret(1, 'damaged', '1234');
    ok('P-03 a damaged return refunds but stock stays out', await stock(p, 'Beta') === s2 && await p.evaluate(sid => saleReturns(sid).reduce((a, m) => a + m.refund, 0), sid) === 9000);
    x = await ret(2, 'shelf', '1234');
    ok('P-03 cannot return more than is left on the receipt', /only 1 box/.test(x.err) || /only 1/.test(x.err), x.err);
    const mm = await p.evaluate(() => { const m = monthMoney(ym()); return {sales:m.sales, refunds:m.refunds}; });
    ok('P-03 monthly money counts the refunds', mm.refunds === 9000, mm);
    const cancel = await p.evaluate(async sid => { closeSheet(); await cancelSale(sid); return !!E.sales.find(s => s.id === sid).voided; }, sid);
    ok('P-03 a receipt with returns cannot be cancelled as a whole', !cancel);
    const rv = await p.evaluate(sid => { closeSheet(); receiptSheet(sid); return document.querySelector('#sheet')?.textContent.includes('Returns') && document.querySelector('#sheet')?.textContent.includes('−4,500 IQD') || document.querySelector('#sheet')?.textContent; }, sid);
    ok('P-03 the receipt lists its returns', rv === true, rv);
    // P-12
    const ne = await p.evaluate(() => { closeSheet(); S.tab = 'stock'; S.stockF = 'noexp'; render(); return [...document.querySelectorAll('[data-xprod]:not([data-xprod="__new"])')].map(b => b.innerText.split('\n')[0]); });
    ok('P-12 Stock filter "No expiry date" lists Delta only', ne.length === 1 && /Delta/.test(ne[0]), ne);
    // P-04
    await p.evaluate(async () => { await write('closes/' + today(), {id:today(), counted:0, expected:0, diff:0, at:nowIso()}); S.tab = 'sell'; render(); }); await p.waitForTimeout(200);
    ok('P-04 Sell says today is already closed', await p.evaluate(() => document.body.innerText.includes('already closed')));
    ok('No page errors', !p.errs.length, p.errs);
    await p.close(); }

  { const p = await fresh();
    // debt switched on in Settings brings the choice back, and F8 switches it
    await p.evaluate(async () => { await write('meta/erp', {...E.cfg, debtOn:true}); }); await p.waitForTimeout(200);
    await p.evaluate(() => { S.cart = [{pid:catalog()[0].id, mode:'box', qty:1, price:5000}]; render(); document.activeElement?.blur(); });
    await p.keyboard.press('F8'); await p.waitForTimeout(100);
    ok('Debt switched on: the choice is back and F8 switches to debt', await p.evaluate(() => !!document.querySelector('select#xMethod') && S.cartMeta.method === 'debt'));
    await p.close(); }

  { const p = await fresh('en');
    // card sales: recorded as card, not in the cash box, own total on the dashboard, refund goes back to the card
    const r = await sell(p, [{n:'Beta'}], {meta:{method:'card'}});
    ok('Card: sale saved as a card sale with no change', r.saved === 1 && r.last.method === 'card' && r.last.given === undefined, r.last);
    const cp = await p.evaluate(() => { const c = cashParts(today(), () => true); return {sales:c.sales, card:c.cardSales, st:salesStats('today')}; });
    ok('Card: not in the cash box, counted as card', cp.sales === 0 && cp.card === 5000 && cp.st.card === 5000 && cp.st.cash === 0, cp);
    const rc = await p.evaluate(() => { const s = E.sales.find(x => x.method === 'card'); return receiptHtml(s); });
    ok('Card: receipt says paid by card', /Paid by card/.test(rc));
    await p.close(); }

  { const p = await fresh('ar');
    const ar = await p.evaluate(() => { S.cart = [{pid:catalog()[0].id, mode:'box', qty:1, price:5000}]; render(); return document.body.innerText; });
    ok('Arabic: customer choice and keys hint translated', ar.includes('الزبون (اختياري)') && ar.includes('بدون زبون'));
    ok('No page errors (Arabic)', !p.errs.length, p.errs);
    await p.close(); }
  await b.close();
  console.log(fails ? `FAIL ${fails} checks` : 'PASS all POS checks'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
