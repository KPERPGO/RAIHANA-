const ROOT = require('path').resolve(__dirname, '..'); // repo folder: src, dist, tests
// Realistic day at the pharmacy, in claude.ai mode (fake runtime): invoice -> stock -> sales at each level -> profit,
// returns, stocktake, chronic alerts, customer debt, cash close, shifts/salary, backup/restore, Excel, Arabic.
const { chromium } = require('./pw');
const fs = require('fs');
const X = require('./pw').XLSX_FILE;
const res = []; const ok = (n, c, i) => res.push([c ? 'PASS' : 'FAIL', n, i === undefined ? '' : JSON.stringify(i)]);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript({ path: 'fake.js' }); await p.route('**/xlsx.full.min.js', r => r.fulfill({ path: X, contentType: 'text/javascript' }));
  await p.goto('file://' + ROOT + '/tests/erp-artifact-test.html'); await p.waitForTimeout(800);
  const ev = (f, a) => p.evaluate(f, a), W = ms => p.waitForTimeout(ms || 150);
  const setv = (sel, v) => ev(([s, v]) => { const e = document.querySelector(s); if (!e) throw new Error('missing ' + s); e.value = v; e.dispatchEvent(new Event('input', {bubbles:true})); e.dispatchEvent(new Event('change', {bubbles:true})); }, [sel, String(v)]);
  const click = async sel => { await ev(s => { const e = document.querySelector(s); if (!e) throw new Error('no ' + s); e.click(); }, sel); await W(); };
  const submit = async sel => { await ev(s => document.querySelector(s).requestSubmit(), sel); await W(250); };
  ok('ERP loads in claude.ai mode', await ev(() => S.ready && !!S.db && window.ERP_MODE !== 'device' && !document.getElementById('boot')));
  // ---- purchase invoice: Panadol 10 boxes paid + 2 bonus, 1000 per box, 10% line discount; box = 3 strips x 10 tablets
  await ev(() => { __seed('suppliers', [{id:'SUP-1', name:'Test Drugstore', creditDays:30}]);
    __seed('invoices', [{id:'INV-1', supplierId:'SUP-1', invoiceNo:'A1', date:today(), type:'credit', status:'Approved', printedTotal:39000, receivedAt:today(),
      lines:[{desc:'Panadol 500mg Tablet 30 tab (3 blisters)', name:'Panadol', strength:'500mg', form:'Tablet', pack:30, blisters:3, qty:10, bonus:2, price:1000, discPct:10, value:9000, batch:'B1', expiry:'2028-01'},
             {desc:'Augmentin 1g Tablet 14 tab', name:'Augmentin', strength:'1g', form:'Tablet', pack:14, qty:5, price:6000, value:30000, batch:'C1', expiry:'2027-06'}]}]); });
  await W(300);
  const P = await ev(() => { const c = catalog(); const pa = c.find(x => /Panadol/.test(x.name)), au = c.find(x => /Augmentin/.test(x.name)); return {pa:pa?.id, au:au?.id, paLv:pa && levelText(pa), paCost: pa && lastCostBox(pa), auCost: au && lastCostBox(au), paStock: pa && stockOf(pa, usedMap()).good}; });
  ok('Invoice makes 2 items', !!P.pa && !!P.au, P);
  ok('Panadol packaging read from invoice', P.paLv === '1 box = 3 strips × 10 tablets', P.paLv);
  // cost per box with bonus: 9000 net / 12 boxes = 750 (the invoice total 9000+30000 has no invoice-level discount)
  ok('Cost per box includes discount and bonus', Math.abs(P.paCost - 750) < 1e-6, P.paCost);
  ok('Stock = (10 paid + 2 bonus) × 30 tablets', P.paStock === 360, P.paStock);
  // ---- prices by margin 25% for Panadol box, strip and tablet
  await ev(([id]) => { S.tab = 'pricing'; render(); }, [P.pa]); await W();
  await click('[data-xprmode="margin"]'); await setv('#prPct', 25); await setv('#prRound', 1);
  await ev(id => { S.pr.sel = [id]; }, P.pa); await click('[data-xprapply="sel"]'); await click('[data-xprsave]'); await W(300);
  const pr = await ev(id => { const x = catalog().find(y => y.id === id); return [x.sellBox, x.sellMid, x.sellSub]; }, P.pa);
  ok('Margin 25%: box 750÷0.75=1000, strip 250÷0.75=333, tablet 25÷0.75=33', pr.join() === '1000,333,33', pr);
  // ---- sales: 1 box + 2 strips + 5 tablets, cash
  await ev(() => { S.tab = 'sell'; render(); }); await W();
  await ev(id => { S.cart = [{pid:id, mode:'box', qty:1, price:1000}, {pid:id, mode:'mid', qty:2, price:333}, {pid:id, mode:'sub', qty:5, price:100}]; S.cartMeta = {}; saveCart(); render(); }, P.pa); await W();
  await setv('#xGiven', 5000); const change = await ev(() => $('#xChange').value);
  ok('Change shown for cash 5,000 − 2,166', change === '2,834', change);
  await submit('#sellForm'); await click('#sheetClose');
  const s1 = await ev(() => { const s = E.sales.at(-1); return {total:s.total, units:s.lines.reduce((a,l) => a + l.alloc.reduce((b,x) => b + x.q, 0), 0), cost:saleCost(s)}; });
  ok('Sale total 1000 + 666 + 500 = 2,166', s1.total === 2166, s1);
  ok('Tablets taken = 30 + 20 + 5 = 55', s1.units === 55, s1);
  ok('Cost of sale = 55 × 25 = 1,375', Math.abs(s1.cost - 1375) < 1e-6, s1);
  ok('Stock now 305 tablets', await ev(id => stockOf(catalog().find(x => x.id === id), usedMap()).good, P.pa) === 305);
  // ---- debt sale to a new customer, then partial payment, then cancel the sale
  await ev(async () => { await write('meta/erp', {...E.cfg, debtOn:true}); }); await W(); // debt selling is off unless switched on
  await ev(id => { S.cart = [{pid:id, mode:'box', qty:2, price:1000}]; S.cartMeta = {method:'debt', customerId:'__new', newName:'Abu Ali'}; saveCart(); render(); }, P.pa); await W();
  await setv('#xCName', 'Abu Ali'); await submit('#sellForm'); await click('#sheetClose');
  let cu = await ev(() => { const c = E.customers.find(x => x.name === 'Abu Ali'); return c && {id:c.id, ...custBalance(c.id)}; });
  ok('Debt sale makes customer owing 2,000', cu && cu.bal === 2000, cu);
  await ev(id => custSheet(id), cu.id); await W(); await setv('#cpAmt', 1500); await submit('#cpForm');
  cu = await ev(id => custBalance(id), cu.id); ok('Customer paid 1,500, still owes 500', cu.bal === 500, cu);
  const debtSale = await ev(() => E.sales.find(s => s.method === 'debt').id);
  await ev(id => receiptSheet(id, E.sales.find(s => s.id === id)), debtSale); await W();
  await click(`[data-xsalevoid="${debtSale}"]`); await setv('#voidReason', 'Customer changed mind'); await click(`[data-xsalevoid="${debtSale}"]`); await W(300);
  cu = await ev(() => custBalance(E.customers.find(x => x.name === 'Abu Ali').id));
  ok('Cancelled debt sale: customer now has 1,500 credit', cu.bal === -1500, cu);
  ok('Cancelled sale puts stock back (305)', await ev(id => stockOf(catalog().find(x => x.id === id), usedMap()).good, P.pa) === 305);
  // ---- write-off 1 expired box of Augmentin, stocktake finds 1 Panadol strip more
  await ev(id => prodSheet(id), P.au); await W(); await setv('#aQty', 1); await setv('#aReason', 'Expired'); await submit('#adjForm');
  const au = await ev(id => { const x = catalog().find(y => y.id === id); return stockOf(x, usedMap()).good; }, P.au);
  ok('Write-off: Augmentin 5 → 4 boxes', au === 4 * (await ev(id => catalog().find(y => y.id === id).sub, P.au)), au);
  const mm = await ev(() => monthMoney(ym()));
  ok('Write-off counted at cost (1 box 6,000) in month', Math.abs(mm.writeoff - 6000) < 1e-9, mm.writeoff);
  // ---- chronic card needing 20 boxes of Augmentin (only 4) -> shortage alert, give -> sale -> given
  await ev(() => { S.tab = 'chronic'; render(); }); await W(); await click('[data-xchr="__new"]');
  await setv('#cName', 'Um Hassan'); await setv('#cDay', +new Date().getDate()); await setv('#cAddQ', 'augm'); await W();
  await click(`[data-xcpick="${P.au}"]`); await setv('[data-xcq="0"]', 20); await submit('#chrForm'); await W(300);
  const need = await ev(() => chronicNeeds(ALERT_DAYS()).map(n => [n.p.name, n.q, n.have, n.short]));
  ok('Chronic shortage: needs 20 boxes, short 16', need.length === 1 && need[0][3] === 16 * (await ev(id => catalog().find(y => y.id === id).sub, P.au)), need);
  const ch = await ev(() => E.chronic[0].id);
  await ev(id => { closeSheet(); giveChronic(id); }, ch); await W();
  const cart = await ev(() => [S.cart.length, S.cartMeta.chronicId, S.tab]);
  ok('Give fills a sale tab for the patient', cart[0] === 1 && cart[1] === ch && cart[2] === 'sell', cart);
  await ev(() => { S.cart[0].qty = 2; S.cart[0].price = 7000; saveCart(); render(); }); await W(); await submit('#sellForm'); await click('#sheetClose');
  const given = await ev(id => [!!E.chronic.find(c => c.id === id).given[ym()], chrDate(E.chronic.find(c => c.id === id)).slice(0, 7)], ch);
  ok('Sale marks card given; next pickup is next month', given[0] && given[1] !== await ev(() => ym()), given);
  // ---- expenses and cash close
  await ev(() => { S.tab = 'money'; render(); }); await W();
  await click('[data-xexp]'); await setv('#eAmt', 25000); await setv('#eCat', 'Generator'); await submit('#expForm');
  await click('[data-xexp]'); await setv('#eAmt', 100000); await ev(() => { document.getElementById('eCash').checked = false; }); await submit('#expForm');
  const dc = await ev(() => dayCash(today()));
  // cash: sale 2,166 + chronic sale 14,000 (cash) + customer paid 1,500 - expense 25,000 from box = -7,334
  ok('Cash box: sales 16,166 + debt paid 1,500 − box expense 25,000', dc.sales === 16166 && dc.cin === 1500 && dc.exp === 25000 && dc.expected === -7334, dc);
  await setv('#clAmt', -7834); await submit('#closeForm');
  ok('Day close records 500 short', await ev(() => E.closes[0]?.diff) === -500);
  const m2 = await ev(() => monthMoney(ym()));
  ok('Month: expenses 125,000 both kinds', m2.expenses === 125000, m2.expenses);
  ok('Month: net = sales − cost − expenses − write-off', Math.abs(m2.net - (m2.sales - m2.cost - m2.expenses - m2.writeoff)) < 1e-6 && m2.sales === 16166, m2);
  const st = await ev(() => salesStats('today'));
  ok('Sales dashboard today = month sales (same day)', st.total === m2.sales && Math.abs(st.profit - m2.gross) < 1e-6, [st.total, st.profit]);
  // ---- staff: owner, pharmacist with monthly prorated salary, fixed shift
  await ev(async () => { await write('staff/ST-O', {id:'ST-O', name:'Owner', role:'owner', active:true}); await write('staff/ST-P', {id:'ST-P', name:'Ali', role:'pharmacist', active:true, payType:'monthly', rate:600000, expHours:200, prorate:true});
    const st = new Date(); st.setHours(8, 0, 0, 0); const en = new Date(st); en.setHours(14, 30); await write('shifts/SH-1', {id:'SH-1', staffId:'ST-P', start:st.toISOString(), end:en.toISOString()}); });
  await W(300);
  const wk = await ev(() => monthWork('ST-P', ym()));
  ok('Shift 08:00–14:30 = 6.5 h, salary 600,000 × 6.5/200 = 19,500', Math.abs(wk.hours - 6.5) < 1e-9 && wk.pay === 19500, [wk.hours, wk.pay]);
  // ---- Excel: all sheets and the sales sheet adds up
  await ev(() => { S.tab = 'settings'; S.staff = E.staff.find(x => x.id === 'ST-O'); render(); }); await W();
  const before = await ev(() => __saved.length); await ev(() => document.querySelector('[data-act="export"]')?.click()); await W(1200);
  const xl = await ev(async () => { const f = __saved.at(-1); if (!f || !/xlsx/.test(f.name)) return null; const wb = XLSX.read(new Uint8Array(await f.blob.arrayBuffer()), {type:'array'}); const sales = XLSX.utils.sheet_to_json(wb.Sheets['Sales'] || {});
    const uniq = {}; sales.forEach(r => { if (!r.Cancelled) uniq[r.Receipt] = r['Receipt total (IQD)']; }); return {sheets:wb.SheetNames, total:Object.values(uniq).reduce((a, v) => a + v, 0), lines:sales.filter(r => !r.Cancelled).reduce((a, r) => a + r['Line total (IQD)'], 0)}; });
  ok('Excel has ERP sheets', xl && ['Stock','Sales','Customers','Chronic cards','Expenses'].every(n => xl.sheets.includes(n)), xl && xl.sheets);
  ok('Excel sales total = app month sales', xl && xl.total === m2.sales, xl);
  // ---- backup and restore into an empty app
  await click('[data-xbackup]'); await W(500);
  const bk = await ev(async () => { const f = __saved.at(-1); return f && /json/.test(f.name) ? JSON.parse(await f.blob.text()) : null; });
  const counts = bk && Object.fromEntries(Object.entries(bk.collections).map(([k, v]) => [k, (v || []).length]));
  ok('Backup holds every collection', bk && ['invoices','sales','customers','custpays','chronic','expenses','closes','moves','products','staff','shifts'].every(k => counts[k] > 0 || ['moves'].includes(k)), counts);
  const p2 = await b.newPage(); await p2.addInitScript({ path: 'fake.js' }); await p2.goto('file://' + ROOT + '/tests/erp-artifact-test.html'); await p2.waitForTimeout(700);
  const after = await p2.evaluate(async j => { await restoreFile(new File([JSON.stringify(j)], 'b.json')); document.querySelector('[data-xrestore]').click(); await new Promise(r => setTimeout(r, 400)); return {sales:E.sales.length, money:monthMoney(ym()).sales, bal:custBalance(E.customers[0]?.id).bal, stock:catalog().map(x => stockOf(x, usedMap()).good).join()}; }, bk);
  const now = await ev(() => ({sales:E.sales.length, money:monthMoney(ym()).sales, bal:custBalance(E.customers[0]?.id).bal, stock:catalog().map(x => stockOf(x, usedMap()).good).join()}));
  ok('Restore gives the same sales, money, debts and stock', JSON.stringify(after) === JSON.stringify(now), [after, now]);
  // ---- Arabic: English left on ERP screens
  await ev(() => { if (S.lang !== 'ar') document.getElementById('langBtn').click(); }); await W(300);
  const left = {};
  for (const tab of ['home','sell','stock','pricing','chronic','customers','money','staff','settings']) { await ev(t => { S.tab = t; render(); }, tab); await W(250);
    left[tab] = await ev(() => { const out = new Set(); const w = document.createTreeWalker(document.getElementById('view'), NodeFilter.SHOW_TEXT); while (w.nextNode()) { const n = w.currentNode, t = n.nodeValue.trim(), el = n.parentElement; if (!t || el.closest('.num,[data-keep],script,style') || !/[A-Za-z]{3,}/.test(t)) continue; if (/Panadol|Augmentin|Test Drugstore|Abu Ali|Um Hassan|Owner|Ali|IQD|Excel|PIN|Supabase|MyPharma|xlsx|Google Drive|Safari|Chrome|Edge|claude.ai|SUP-|INV|B1|C1|A1|Raihana/.test(t) && t.replace(/Panadol|Augmentin|Test Drugstore|Abu Ali|Um Hassan|Owner|Ali|IQD|Excel|PIN|Supabase|MyPharma|xlsx|Google|Drive|Safari|Chrome|Edge|claude|ai|Raihana|Pharmacy|\d+|[^A-Za-z]/g, '').length < 4) continue; out.add(t); } return [...out]; }); }
  const nLeft = Object.values(left).reduce((a, v) => a + v.length, 0);
  ok('Arabic: no English left on ERP screens', nLeft === 0, left);
  ok('No script errors', errs.length === 0, errs.slice(0, 5));
  await b.close();
  for (const r of res) console.log(r[0], '-', r[1], r[0] === 'FAIL' ? ' :: ' + r[2] : '');
  console.log(`\n${res.filter(r => r[0] === 'PASS').length}/${res.length} passed`);
})().catch(e => { console.log('CRASH', e.message); for (const r of res) console.log(r[0], '-', r[1], r[0] === 'FAIL' ? ' :: ' + r[2] : ''); });
