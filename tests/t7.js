const ROOT = require('path').resolve(__dirname, '..'); // repo folder: src, dist, tests
const { chromium } = require('./pw');
const fs = require('fs'); const path = require('path');
const D = require('path').join(__dirname, 'fixtures');
const rd = p => JSON.parse(fs.readFileSync(path.join(D, p)));
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 400, height: 860 }, hasTouch: true, isMobile: true });
  const errs = []; page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  await page.goto('http://localhost:8765/index.html'); await page.waitForTimeout(1500);
  await page.evaluate(async ([inv, sup, pay]) => { await ERP_LOCAL.put('invoices/' + inv.id, inv); await ERP_LOCAL.put('suppliers/' + sup.id, sup); await ERP_LOCAL.put('payments/' + pay.id, pay); }, [rd('invoices/PI-2026-0001.json'), rd('suppliers/SUP-001.json'), rd('payments/PAY-MVHWUD41.json')]);
  await page.waitForTimeout(600);
  const ok = (name, cond, info) => console.log((cond ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
  // the owner's formulas, worked examples and round trips
  const F = await page.evaluate(() => { const P = PRICING, out = {};
    out.ex = [P.fromMarkup(10000, 25), P.markupPct(12500, 10000), P.fromMargin(10000, 20), P.marginPct(12500, 10000), P.fromMarkup(10000, 0.25 * 100), P.fromMargin(10000, 100), P.fromMarkup(0, 20), P.markupPct(5000, 0), P.round(12437.4, 250), P.round(12437.6, 1)];
    let worst = 0; for (let i = 0; i < 2000; i++){ const cp = 1 + Math.random() * 500000, m = Math.random() * 95; worst = Math.max(worst, Math.abs(P.marginPct(P.fromMargin(cp, m), cp) - m), Math.abs(P.markupPct(P.fromMarkup(cp, m * 3), cp) - m * 3)); }
    out.worst = worst; return out; });
  ok('worked examples', JSON.stringify(F.ex) === JSON.stringify([12500, 25, 12500, 20, 12500, null, null, null, 12500, 12438]), F.ex);
  ok('round trips exact', F.worst < 1e-9, F.worst);
  // pricing: markup and margin
  await page.click('nav.tabs [data-tab="pricing"]'); await page.waitForTimeout(300);
  const P = await page.evaluate(() => { const p = catalog().find(x => isNum(lastCostBox(x)) && x.sub > 1); return {id:p.id, cost:lastCostBox(p), sub:p.sub, mid:p.midName}; });
  await page.click('[data-xprmode="margin"]'); await page.waitForTimeout(200);
  await page.fill('#prPct', '20'); await page.dispatchEvent('#prPct', 'input');
  await page.selectOption('#prRound', '1'); await page.click(`[data-xprck="${P.id}"]`); await page.click('[data-xprapply="sel"]'); await page.waitForTimeout(300);
  let e = await page.evaluate(id => S.pr.edits[id], P.id);
  ok('margin 20% price = cost/0.8', e.box === Math.round(P.cost / 0.8), [e.box, P.cost]);
  ok('smaller units use the same formula', e.sub === Math.max(1, Math.round(P.cost / P.sub / 0.8)), [e.sub, P.cost / P.sub]);
  const rowTxt = await page.evaluate(id => document.querySelector(`[data-xprm="${id}"]`).textContent, P.id);
  ok('row shows markup and margin', /Markup 25%/.test(rowTxt) && /Margin 20%/.test(rowTxt), rowTxt);
  await page.click('[data-xprmode="markup"]'); await page.waitForTimeout(200); await page.click('[data-xprapply="sel"]'); await page.waitForTimeout(300);
  e = await page.evaluate(id => S.pr.edits[id], P.id);
  ok('markup 20% price = cost*1.2', e.box === Math.round(P.cost * 1.2), [e.box]);
  await page.click('[data-xprmode="margin"]'); await page.fill('#prPct', '100'); await page.dispatchEvent('#prPct', 'input'); await page.click('[data-xprapply="sel"]'); await page.waitForTimeout(200);
  ok('margin 100% blocked', (await page.evaluate(id => S.pr.edits[id].box, P.id)) === e.box);
  await page.click('[data-xprsave]'); await page.waitForTimeout(600);
  // sale with awkward numbers
  await page.click('nav.tabs [data-tab="sell"]'); await page.waitForTimeout(300);
  await page.evaluate(id => { S.cart = [{pid:id, mode:"sub", qty:3, price:1333.4}, {pid:id, mode:"sub", qty:1, price:999.5}]; S.cartMeta.disc = 99.6; saveCart(); render(); }, P.id);
  await page.waitForTimeout(300);
  const shown = await page.evaluate(() => document.querySelector('#sellForm .r.big .num').textContent);
  await page.click('#sellForm button[type=submit]'); await page.waitForTimeout(800); console.log('xErr', await page.evaluate(() => $('#xErr')?.textContent, P.id), await page.evaluate(() => JSON.stringify(S.cart))); await page.click('#sheetClose');
  const s1 = await page.evaluate(() => E.sales[E.sales.length - 1]);
  const linesSum = s1.lines.reduce((a, l) => a + l.total, 0);
  ok('line totals whole IQD', s1.lines.every(l => Number.isInteger(l.total) && Number.isInteger(l.price)), s1.lines.map(l => [l.qty, l.price, l.total]));
  ok('subtotal = sum of lines', s1.subtotal === linesSum && s1.total === s1.subtotal - s1.discount && Number.isInteger(s1.discount), [s1.subtotal, s1.discount, s1.total]);
  ok('screen total = saved total', shown.replace(/[^\d]/g, '') === String(s1.total), [shown, s1.total]);
  ok('batch costs exact', s1.lines.every(l => l.alloc.every(a => a.cost === null || Math.abs(a.cost * 100 - Math.round(a.cost * 100)) >= 0 )));
  // forced sale beyond stock has a cost
  const st0 = await page.evaluate(id => { const p = catalog().find(x => x.id === id); return stockOf(p, usedMap()).good; }, P.id);
  await page.evaluate(([id, q]) => { S.cart = [{pid:id, mode:"sub", qty:q + 2, price:2000}]; S.cartMeta.disc = 0; saveCart(); render(); }, [P.id, st0]);
  await page.waitForTimeout(300); await page.click('#sellForm button[type=submit]'); await page.waitForTimeout(500); await page.click('[data-xoversell]'); await page.waitForTimeout(800); await page.click('#sheetClose'); // no owner account here, so the owner button needs no PIN
  const s2 = await page.evaluate(() => E.sales[E.sales.length - 1]);
  const adj = s2.lines[0].alloc.find(a => a.key.startsWith('adj:'));
  ok('short-stock part has a cost', adj && adj.cost > 0, adj);
  // count: found extra stock raises value
  const v0 = await page.evaluate(id => stockOf(catalog().find(x => x.id === id), usedMap()).value, P.id);
  ok('value 0 when sold out', Math.abs(v0) < 1e-6, v0);
  await page.evaluate(async id => { const p = catalog().find(x => x.id === id); await write("moves/MVT1", {id:"MVT1", pid:id, key:"adj:" + id, q:-12, per:p.sub, reason:"Count correction (more found)", note:"t", date:today(), at:nowIso(), cost:subCostNow(p)}); }, P.id);
  await page.waitForTimeout(400);
  const v1 = await page.evaluate(id => { const p = catalog().find(x => x.id === id), s = stockOf(p, usedMap()); return [s.good, s.value, subCostNow(p)]; }, P.id);
  ok('found stock adds value', Math.abs(v1[1] - 10 * v1[2]) < 0.01 && v1[0] === 10, v1);
  // money: expense decimals, profit consistency
  await page.evaluate(async () => { S.tab = "money"; render(); }); await page.waitForTimeout(300);
  await page.click('[data-xexp]'); await page.waitForTimeout(200); await page.fill('#eAmt', '1500.7'); await page.click('#expForm button[type=submit]'); await page.waitForTimeout(500);
  const M = await page.evaluate(() => { const m = monthMoney(ym()), st = salesStats("month"), dc = dayCash(today()); return {m, st:{total:st.total, profit:st.profit}, dc, exp:E.expenses.map(x=>x.amount)}; });
  ok('expense saved whole', M.exp[0] === 1501, M.exp);
  ok('sales match dashboard and month', M.m.sales === M.st.total && Math.abs(M.m.gross - M.st.profit) < 1e-6, [M.m.sales, M.st.total]);
  ok('net = gross - expenses - stock change', Math.abs(M.m.net - (M.m.gross - M.m.expenses - M.m.writeoff)) < 1e-6 && M.m.writeoff < 0, [M.m.net, M.m.writeoff]);
  ok('cash box', M.dc.expected === M.dc.sales + M.dc.cin - M.dc.sup - M.dc.exp, M.dc);
  // stock value matches Excel
  const xs = await page.evaluate(() => { const used = usedMap(); return catalog().reduce((a,p) => a + stockOf(p, used).value, 0); });
  ok('stock value finite', isFinite(xs) && xs > 0, Math.round(xs));
  // margin text in Arabic
  await page.evaluate(() => { S.tab = "pricing"; render(); }); await page.click('#langBtn'); await page.waitForTimeout(500);
  const arTxt = await page.evaluate(id => document.querySelector(`[data-xprm="${id}"]`).textContent, P.id);
  ok('arabic markup/margin', /نسبة/.test(arTxt) && /هامش/.test(arTxt), arTxt);
  await page.screenshot({path:'p-ar.png'}); await page.click('#langBtn'); await page.waitForTimeout(300); await page.screenshot({path:'p-en.png'});
  console.log(errs.length ? errs : 'no errors');
  await b.close();
})();
