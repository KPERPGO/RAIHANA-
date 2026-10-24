const ROOT = require('path').resolve(__dirname, '..'); // repo folder: src, dist, tests
// Stock-out prevention (23 Oct 2026): use per day/week/month and a safe level per item, low/fast/stagnant flags,
// the shortage list that drops restocked items, the start-of-shift list (sell first + shortage), and the same-medicine
// offer at the till (nearest expiry of the same scientific name, dose and form, unless the customer asked for the brand)
const { chromium, XLSX_FILE } = require('./pw');
let fails = 0; const ok = (m, c, x) => { console.log(c ? 'ok  ' : 'FAIL', m, x === undefined ? '' : JSON.stringify(x)); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript({ path: ROOT + '/tests/fake.js' });
  await p.route('**/xlsx.full.min.js', r => r.fulfill({ path: XLSX_FILE, contentType: 'text/javascript' }));
  await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  await p.goto('file://' + ROOT + '/tests/erp-artifact-test.html'); await p.waitForTimeout(800);
  await p.evaluate(async () => {
    Object.assign(__store, {products:{}, sales:{}, moves:{}, customers:{}, custpays:{}, chronic:{}, expenses:{}, closes:{}, counts:{}, staff:{}, shifts:{}, events:{}});
    const t = today(), d = k => addDays(t, -k), soon = (() => { const x = new Date(); x.setMonth(x.getMonth() + 2); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; })();
    window.__soon = soon;
    __seed('suppliers', [{id:'SUP-T', name:'Test supplier', creditDays:30}]);
    const L = (lid, name, strength, form, qty, expiry, sci) => ({lid, desc:`${name} ${strength} ${form} 10 tab`, name, strength, form, pack:10, qty, price:1000, value:qty * 1000, batch:'B' + lid, expiry});
    __seed('invoices', [
      {id:'INV-OLD', supplierId:'SUP-T', invoiceNo:'OLD', date:d(80), type:'credit', status:'Approved for Posting', lidSeq:1, lines:[L('0', 'Dusty', '5mg', 'Tablet', 3, '2029-01')]},
      {id:'INV-A', supplierId:'SUP-T', invoiceNo:'A', date:d(40), type:'credit', status:'Approved for Posting', lidSeq:5, lines:[
        L('0', 'Fasty', '20mg', 'Tablet', 28, '2029-01'), L('1', 'Alpha', '500mg', 'Tablet', 10, '2028-01'), L('2', 'Beta', '500mg', 'Tablet', 4, soon),
        L('3', 'Gamma', '1000mg', 'Tablet', 4, soon), L('4', 'Zero', '1mg', 'Tablet', 1, '2029-01')]}]);
    const sales = [];
    for (let i = 0; i < 12; i++) sales.push({id:'S' + i, no:i + 1, date:d(i * 2), at:d(i * 2) + 'T10:00:00.000Z', total:2000, lines:[{pid:'', name:'Fasty', alloc:[{key:'INV-A:0', q:20, per:10, cost:100}]}]});
    sales.push({id:'SZ', no:99, date:d(1), at:d(1) + 'T09:00:00.000Z', total:1000, lines:[{pid:'', name:'Zero', alloc:[{key:'INV-A:4', q:10, per:10, cost:100}]}]});
    window.__sales = sales;
  });
  await p.waitForTimeout(300);
  // the line pids are the catalogue ids; scientific names go on the items
  await p.evaluate(async () => { const id = n => catalog().find(x => x.name === n).id;
    __seed('sales', __sales.map(s => ({...s, lines:s.lines.map(l => ({...l, pid:id(l.name)}))})));
    for (const [n, sci] of [['Alpha', 'Paracetamol'], ['Beta', 'paracetamol'], ['Gamma', 'Paracetamol']]) await write('products/' + id(n), {id:id(n), sci, sellBox:5000});
    render(); });
  await p.waitForTimeout(300);
  const U = n => p.evaluate(n => { const x = catalog().find(q => q.name === n); const s = stockOf(x, usedMap()), u = usageOf(x, s); return {...u, good:s.good, lv:stockLevel(x, s, u), sub:x.sub}; }, n);

  // 1. averages and the safe level for a fast mover: 12 sales of 2 boxes in 41 days here
  let f = await U('Fasty'); const day = 240 / 41;
  ok('1 per day is units sold ÷ days here', Math.abs(f.day - day) < 1e-9 && Math.abs(f.week - day * 7) < 1e-9 && Math.abs(f.month - day * 30) < 1e-9, f);
  ok('1 safe level = per day × 7 days, rounded up to whole boxes (5 boxes)', f.safe === 50 && !f.own, f.safe);
  ok('1 fast-moving (sold on 12 of the last 30 days... at least 10) and low (40 left < 50)', f.fast && f.lv === 'low' && f.good === 40, {fast:f.fast, lv:f.lv, days30:f.days30});
  // 2. stagnant: in stock 80 days, never sold
  const dusty = await U('Dusty'); ok('2 never-sold item here 80 days is stagnant, not low', dusty.stagnant && dusty.lv === '' && dusty.idle === 80, dusty);
  // 3. the zero item stays in the catalogue and is on the shortage list as out
  const zero = await U('Zero'); ok('3 item sold to zero stays in the catalogue, marked out', zero.good === 0 && zero.lv === 'out');
  let rows = await p.evaluate(() => reorderRows().map(r => ({n:r.p.name, boxes:r.boxes, out:r.out})));
  const fr = rows.find(r => r.n === 'Fasty');
  ok('3 shortage list has Fasty (14 boxes: 30 days of sales minus 40 units) and Zero (out)', fr && fr.boxes === Math.ceil((day * 30 - 40) / 10) && rows.some(r => r.n === 'Zero' && r.out) && !rows.some(r => r.n === 'Dusty'), rows);
  // 4. alerts: fast-moving low, stagnant
  const al = await p.evaluate(() => stockAlerts().map(a => a.type + ':' + a.name + ':' + a.what));
  ok('4 alerts show low fast-moving and stagnant stock', al.some(a => /^low:Fasty.*fast-moving/.test(a)) && al.some(a => /^stagnant:Dusty/.test(a)) && al.some(a => /^out:Zero/.test(a)), al);
  // 5. Stock screen chips and pills
  await p.evaluate(() => { S.tab = 'stock'; S.stockF = 'fast'; render(); });
  let v = await p.evaluate(() => document.querySelector('#view').innerText);
  ok('5 Stock: Fast-moving filter lists Fasty only', /Fasty/.test(v) && !/Dusty/.test(v) && /Fast-moving · 1/.test(v) && /Stagnant · 1/.test(v));
  await p.evaluate(() => { S.stockF = 'stagnant'; render(); }); v = await p.evaluate(() => document.querySelector('#view').innerText);
  ok('5 Stock: Stagnant filter lists Dusty', /Dusty/.test(v) && !/Fasty/.test(v));
  // 6. item card shows the averages
  await p.evaluate(() => { S.stockF = 'all'; render(); prodSheet(catalog().find(x => x.name === 'Fasty').id); });
  v = await p.evaluate(() => document.querySelector('#pUsage')?.innerText || '');
  ok('6 item card: per day, week, month, safe level and fast-moving', /Sold per day/.test(v) && /Per week/.test(v) && /Per month/.test(v) && /Safe level \(worked out\)/.test(v) && /Fast-moving/.test(v), v);
  await p.evaluate(() => closeSheet());
  // 7. an owner minimum wins; settings change the safe level
  await p.evaluate(async () => { const x = catalog().find(q => q.name === 'Fasty'); await write('products/' + x.id, {id:x.id, min:2}); }); await p.waitForTimeout(100);
  f = await U('Fasty'); ok('7 "Alert when below" 2 boxes wins: 40 units is not low', f.safe === 20 && f.own && f.lv === '', f.safe);
  await p.evaluate(async () => { const x = catalog().find(q => q.name === 'Fasty'); await write('products/' + x.id, {id:x.id, min:null}); await write('meta/erp', {...E.cfg, fcLead:10, fcSafety:4}); }); await p.waitForTimeout(100);
  f = await U('Fasty'); ok('7 settings: 14 days of cover → safe level 9 boxes', f.safe === Math.ceil(day * 14 / 10) * 10, f.safe);
  await p.evaluate(async () => { await write('meta/erp', {...E.cfg, fcLead:2, fcSafety:5}); }); await p.waitForTimeout(100);
  // 8. restocking drops the item from the list by itself
  await p.evaluate(() => __seed('invoices', [{id:'INV-R', supplierId:'SUP-T', invoiceNo:'R', date:today(), type:'credit', status:'Approved for Posting', lidSeq:1, lines:[{lid:'0', desc:'Zero 1mg Tablet 10 tab', name:'Zero', strength:'1mg', form:'Tablet', pack:10, qty:5, price:1000, value:5000, batch:'R0', expiry:'2029-06'}]}]));
  await p.waitForTimeout(200);
  rows = await p.evaluate(() => reorderRows().map(r => r.p.name));
  ok('8 Zero restocked: it leaves the shortage list, Fasty stays', !rows.includes('Zero') && rows.includes('Fasty'), rows);

  // 9. the till: same scientific name, dose and form with a sooner expiry is offered first
  const sheetTitle = () => p.evaluate(() => $('#sheet').hidden ? '' : $('#sheetTitle').textContent);
  const cartIds = () => p.evaluate(() => S.cart.map(c => catalog().find(x => x.id === c.pid).name));
  await p.evaluate(() => { S.tab = 'sell'; S.cart = []; saveCart(); render(); addToCart(catalog().find(x => x.name === 'Alpha').id); });
  ok('9 adding Alpha offers Beta (same paracetamol 500mg tablet, expires sooner)', await sheetTitle() === 'Same medicine, sell first' && await p.evaluate(() => /Beta/.test($('#sheetBody').innerText) && /expires/.test($('#sheetBody').innerText)));
  await p.click(`[data-xsooner="${await p.evaluate(() => catalog().find(x => x.name === 'Beta').id)}"]`);
  ok('9 "Sell Beta": Beta goes in the cart', JSON.stringify(await cartIds()) === '["Beta"]' && await sheetTitle() === '');
  await p.evaluate(() => { S.cart = []; saveCart(); render(); addToCart(catalog().find(x => x.name === 'Alpha').id); });
  await p.click(`[data-xsooner="${await p.evaluate(() => catalog().find(x => x.name === 'Alpha').id)}"]`);
  ok('9 "The customer asked for Alpha": Alpha goes in the cart', JSON.stringify(await cartIds()) === '["Alpha"]');
  await p.evaluate(() => addToCart(catalog().find(x => x.name === 'Alpha').id));
  ok('9 adding Alpha again only adds one more, no question', await sheetTitle() === '' && await p.evaluate(() => S.cart[0].qty) === 2);
  await p.evaluate(() => { S.cart = []; saveCart(); addToCart(catalog().find(x => x.name === 'Gamma').id); });
  ok('9 a different dose (1000mg) is never offered', await sheetTitle() === '' && JSON.stringify(await cartIds()) === '["Gamma"]');
  await p.evaluate(() => { S.cart = []; saveCart(); addToCart(catalog().find(x => x.name === 'Beta').id); });
  ok('9 Beta itself expires first: no question', await sheetTitle() === '' && JSON.stringify(await cartIds()) === '["Beta"]');
  await p.evaluate(() => { S.cart = []; saveCart(); render(); });

  // 10. start of shift: the list shows once per shift, with sell-first batches and the shortage list for the owner
  await p.evaluate(async () => {
    __seed('staff', [{id:'ST-O', name:'Owner', role:'owner', active:true, pinHash: await pinHash('ST-O', '1234')}, {id:'ST-C', name:'Cashier', role:'cashier', active:true, perms:['sell']}]);
    await new Promise(r => setTimeout(r, 100));
    __seed('shifts', [{id:'SH-1', staffId:'ST-O', staffName:'Owner', start:nowIso(), end:null, openCount:0}, {id:'SH-2', staffId:'ST-C', staffName:'Cashier', start:nowIso(), end:null, openCount:0}]);
    await new Promise(r => setTimeout(r, 100));
    lsSet('erp.startAuto', true); S.session = {staffId:'ST-O', shiftId:'SH-1'}; S.staff = E.staff.find(x => x.id === 'ST-O'); closeSheet(); render(); });
  await p.waitForTimeout(1600);
  ok('10 owner shift start: "Start of shift" opens by itself', await sheetTitle() === 'Start of shift');
  v = await p.evaluate(() => ({near: $('#stNear')?.innerText || '', short: $('#stShort')?.innerText || ''}));
  ok('10 it lists the batches to sell first (Beta, Gamma) and the shortage list (Fasty)', /Beta/.test(v.near) && /Gamma/.test(v.near) && !/Alpha/.test(v.near) && /Fasty/.test(v.short), v);
  await p.click('[data-xstartok]'); await p.evaluate(() => render()); await p.waitForTimeout(1600);
  ok('10 once per shift: not shown again', await sheetTitle() === '');
  v = await p.evaluate(() => $('#dayCard')?.innerText || '');
  ok('10 Home keeps a reminder line with the list', /expire within 3 months: sell them first/.test(v), v);
  // cashier without the Stock screen: sell-first only
  await p.evaluate(() => { S.session = {staffId:'ST-C', shiftId:'SH-2'}; S.staff = E.staff.find(x => x.id === 'ST-C'); render(); });
  await p.waitForTimeout(1600);
  v = await p.evaluate(() => ({t: $('#sheet').hidden ? '' : $('#sheetTitle').textContent, near: !!$('#stNear'), short: !!$('#stShort')}));
  ok('10 cashier shift start: sell-first list only, no shortage list', v.t === 'Start of shift' && v.near && !v.short, v);
  await p.evaluate(() => closeSheet());
  // phone notification text
  const note = await p.evaluate(() => { S.staff = E.staff.find(x => x.id === 'ST-O'); return phoneSummary(); });
  ok('10 phone notification text names what to order and what to sell first', note && /to order/.test(note.body) && /Fasty 20mg x 14/.test(note.body) && /to sell first/.test(note.body), note);
  // 11. Arabic
  await p.click('#langBtn'); await p.waitForTimeout(300);
  await p.evaluate(() => startSheet()); await p.waitForTimeout(200);
  v = await p.evaluate(() => $('#sheet').innerText);
  ok('11 Arabic start-of-shift list', /بيع هذه أولاً/.test(v) && /قائمة النواقص/.test(v) && !/Sell these first|Today's shortage list|Copy the list/.test(v), v.slice(0, 300));
  await p.evaluate(() => { closeSheet(); prodSheet(catalog().find(x => x.name === 'Fasty').id); }); await p.waitForTimeout(150);
  v = await p.evaluate(() => $('#pUsage').innerText);
  ok('11 Arabic item card averages', /المبيعات والمخزون الآمن/.test(v) && !/Sold per day|Per week|Safe level/.test(v), v);
  await p.evaluate(() => { closeSheet(); S.cart = []; addToCart(catalog().find(x => x.name === 'Alpha').id); }); await p.waitForTimeout(150);
  v = await p.evaluate(() => $('#sheet').innerText);
  ok('11 Arabic same-medicine question', /نفس الدواء/.test(v) && !/Same scientific name|The customer asked for/.test(v), v);
  await p.evaluate(() => { closeSheet(); S.tab = 'stock'; render(); }); await p.waitForTimeout(150);
  v = await p.evaluate(() => document.querySelector('#view').innerText);
  ok('11 Arabic Stock chips', /سريع الحركة/.test(v) && /راكد/.test(v) && !/Fast-moving|Stagnant/.test(v));
  await p.evaluate(() => { S.tab = 'settings'; render(); }); await p.waitForTimeout(150);
  v = await p.evaluate(() => document.querySelector('#view').innerText);
  ok('11 Arabic settings', /المخزون الآمن وقائمة النواقص/.test(v) && !/Days the supplier takes to deliver|Extra safety days/.test(v));

  ok('no page errors', !errs.length, errs);
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'PASS all stock-out checks'); process.exit(fails ? 1 : 0);
})();
