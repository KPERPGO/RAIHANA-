const ROOT = require('path').resolve(__dirname, '..'); // repo folder: src, dist, tests
// Sell as a till (POS), 23 Oct 2026: phone = inputs on top and the invoice under them; iPad and PC = invoice on the left,
// inputs on the right (also in Arabic); invoice box darker than the cards in light mode and lighter in dark mode;
// split payment between cash and card; square quick buttons that fit; weekly best sellers + owner's pinned items.
const { chromium, XLSX_FILE } = require('./pw');
let fails = 0; const ok = (m, c, x) => { console.log(c ? 'ok  ' : 'FAIL', m, x === undefined ? '' : JSON.stringify(x)); if (!c) fails++; };
const SHOTS = process.env.SHOTS; // folder for screenshots, when set
(async () => {
  const b = await chromium.launch();
  const fresh = async (vp = { width: 1280, height: 900 }, opts = {}) => {
    const p = await b.newPage({ viewport: vp, colorScheme: opts.dark ? 'dark' : 'light' }); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.errs = errs;
    await p.addInitScript({ path: ROOT + '/tests/fake.js' });
    await p.route('**/xlsx.full.min.js', r => r.fulfill({ path: XLSX_FILE, contentType: 'text/javascript' }));
    await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await p.goto('file://' + ROOT + '/tests/erp-artifact-test.html'); await p.waitForTimeout(800);
    await p.evaluate(async () => {
      Object.assign(__store, {products:{}, sales:{}, moves:{}, customers:{}, custpays:{}, chronic:{}, expenses:{}, closes:{}, counts:{}, staff:{}, shifts:{}, events:{}});
      __seed('suppliers', [{id:'SUP-T', name:'Test supplier', creditDays:30}]);
      const names = ['Alpha','Beta','Delta','Omega','Panadol Extra','Strepsils','Vitamin C','Zinc','Otrivin','Gaviscon','Brufen','Voltaren','Daktarin','Fucidin','Cetal','Rennie','Imodium','Claritine'];
      __seed('invoices', [{id:'INV-T', supplierId:'SUP-T', invoiceNo:'T1', date:today(), type:'credit', status:'Approved for Posting', printedTotal:names.length * 10000, lidSeq:names.length,
        lines:names.map((n, i) => ({lid:String(i), desc:n + ' Syrup', name:n, form:'Syrup', qty:20, price:500, value:10000, batch:'B' + i, expiry:'2028-01'}))}]);
      __seed('staff', [{id:'ST-O', name:'Owner', role:'owner', active:true, pinHash: await pinHash('ST-O', '1234')}]);
    });
    await p.waitForTimeout(300);
    await p.evaluate(async () => { for (const p of catalog()) await write('products/' + p.id, {id:p.id, sellBox:5000}); S.staff = E.staff.find(x => x.id === 'ST-O'); S.tab = 'sell'; render(); });
    await p.waitForTimeout(200);
    if (opts.ar) { await p.click('#langBtn'); await p.waitForTimeout(300); }
    return p;
  };
  const fill = (p, n = 3) => p.evaluate(n => { closeSheet(); const x = catalog().find(q => q.name === 'Beta'); S.cart = [{pid:x.id, mode:'box', qty:n, price:5000}]; S.cartMeta = {}; saveCart(); render(); }, n);
  const type = (p, sel, v) => p.evaluate(([sel, v]) => { const el = document.querySelector(sel); el.focus(); el.value = v; el.dispatchEvent(new Event('input', {bubbles:true})); }, [sel, String(v)]);
  const save = async p => { await p.evaluate(() => { window.__n = E.sales.length; document.getElementById('sellForm').requestSubmit(); }); await p.waitForTimeout(300);
    return p.evaluate(() => ({saved: E.sales.length - window.__n, err: document.getElementById('xErr')?.textContent || '', last: [...E.sales].sort((a, b) => a.at.localeCompare(b.at)).pop()})); };
  const box = (p, sel) => p.evaluate(sel => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r && {l:r.left, r:r.right, t:r.top, b:r.bottom, w:r.width, h:r.height}; }, sel);
  const pin = (p, n) => p.evaluate(async n => { for (const x of catalog().slice(0, n)) await write('products/' + x.id, {id:x.id, sellBox:5000, quick:true}); render(); }, n);
  const layout = async (p, name) => {
    await fill(p); await p.waitForTimeout(150);
    const L = await p.evaluate(() => { const v = document.getElementById('view'), q = [...document.querySelectorAll('.quick button')].map(e => e.getBoundingClientRect()), inn = document.querySelector('.posin').getBoundingClientRect();
      return {overflow: v.scrollWidth - v.clientWidth, doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, n:q.length,
        square: q.every(r => Math.abs(r.width - r.height) < 2), inside: q.every(r => r.left >= inn.left - 1 && r.right <= inn.right + 1), minW: Math.min(...q.map(r => r.width))}; });
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
    return {...L, inn: await box(p, '.posin'), bill: await box(p, '.posbill')};
  };

  // ---- layout on each screen size
  for (const [name, vp, side] of [['phone', {width:390, height:844}, false], ['ipad-portrait', {width:820, height:1180}, true], ['ipad-landscape', {width:1180, height:820}, true], ['pc', {width:1440, height:900}, true]]) {
    const p = await fresh(vp); await pin(p, 14); const L = await layout(p, 'pos-' + name);
    ok(`${name}: nothing wider than the screen`, L.overflow <= 0 && L.doc <= 0, [L.overflow, L.doc]);
    ok(`${name}: 12 square quick buttons inside the inputs part`, L.n === 12 && L.square && L.inside && L.minW >= 56, L);
    if (side) ok(`${name}: invoice on the left, inputs on the right`, L.bill.r <= L.inn.l + 1 && L.bill.t < L.inn.b, [L.bill, L.inn]);
    else ok(`${name}: inputs on top, invoice under them`, L.inn.b <= L.bill.t + 1, [L.inn, L.bill]);
    ok(`${name}: no page errors`, !p.errs.length, p.errs);
    await p.close();
  }
  { const p = await fresh({width:1280, height:900}, {ar:true}); await pin(p, 12); const L = await layout(p, 'pos-pc-ar');
    ok('Arabic PC: inputs stay on the right, invoice on the left', L.bill.r <= L.inn.l + 1, [L.bill, L.inn]);
    const t = await p.evaluate(() => document.querySelector('.pos').innerText);
    ok('Arabic: payment words translated', ['نقد بالكامل', 'بطاقة بالكامل', 'مبلغ البطاقة', 'الجزء النقدي'].every(w => t.includes(w)), t.slice(0, 400));
    ok('Arabic: no page errors', !p.errs.length, p.errs); await p.close(); }

  // ---- invoice box contrast
  const lum = c => { const m = c.match(/[\d.]+/g).map(Number).slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
  for (const dark of [false, true]) {
    const p = await fresh({width:1280, height:900}, {dark}); await pin(p, 12); await layout(p, dark ? 'pos-pc-dark' : 'pos-pc-light');
    const c = await p.evaluate(() => ({inv: getComputedStyle(document.querySelector('.posbill')).backgroundColor, card: getComputedStyle(document.querySelector('.paybox')).backgroundColor}));
    ok(dark ? 'Dark: invoice box lighter than the cards' : 'Light: invoice box darker than the cards', dark ? lum(c.inv) > lum(c.card) : lum(c.inv) < lum(c.card), c);
    await p.close();
  }

  // ---- split payment
  { const p = await fresh();
    await fill(p, 3); // 15,000
    let v = await p.evaluate(() => ({cashPart: $('#xCashPart').value, card: $('#xCard').value, bill: $('#billCash').textContent}));
    ok('Default: the whole total is cash, card empty', v.cashPart === '15,000' && v.card === '' && /15,000/.test(v.bill), v);
    await type(p, '#xCard', 10000); await type(p, '#xGiven', 6000);
    v = await p.evaluate(() => ({cashPart: $('#xCashPart').value, change: $('#xChange').value, billCard: $('#billCard').textContent, cardRow: !$('#billCardRow').hidden, focus: document.activeElement?.id}));
    ok('Card 10,000 typed: cash part 5,000, change from 6,000 is 1,000, invoice shows both, keyboard stays', v.cashPart === '5,000' && v.change === '1,000' && /10,000/.test(v.billCard) && v.cardRow && v.focus === 'xGiven', v);
    let r = await save(p);
    ok('Split sale saved with card and cash parts', r.saved === 1 && r.last.method === 'split' && r.last.card === 10000 && r.last.cash === 5000 && r.last.given === 6000 && r.last.change === 1000, r.last);
    const m = await p.evaluate(() => { const c = cashParts(today(), () => true), st = salesStats('today'), en = bkEntries().find(e => e.src === 'Sale');
      return {cash:c.sales, card:c.cardSales, stCash:st.cash, stCard:st.card, je: en.lines.map(l => l.acct + ':' + (l.dr || -l.cr)).join(' '), rc: document.getElementById('receipt')?.innerText.replace(/\s+/g, ' ')}; });
    ok('Cash box counts only the cash part; card part on its own', m.cash === 5000 && m.card === 10000 && m.stCash === 5000 && m.stCard === 10000, m);
    ok('Accounts: cash 1000 and card 1010 debited separately', /1000:5000/.test(m.je) && /1010:10000/.test(m.je) && /4000:-15000/.test(m.je), m.je);
    ok('Receipt shows the card part, cash and change', /Card 10,000/.test(m.rc) && /Cash 6,000/.test(m.rc) && /Change 1,000/.test(m.rc) && /cash and card/.test(m.rc), m.rc);
    // a return from a split receipt: the owner picks card or cash
    await p.evaluate(id => { closeSheet(); returnSheet(id); }, r.last.id); await p.waitForTimeout(150);
    ok('Return from a split receipt asks cash or card', await p.evaluate(() => !!document.getElementById('rBy')));
    await p.evaluate(() => { document.querySelector('[data-xrq="0"]').value = 1; document.getElementById('rReason').value = 'test'; document.getElementById('rBy').value = 'card'; document.getElementById('retForm').requestSubmit(); });
    await p.waitForTimeout(250); await p.evaluate(() => { const el = document.getElementById('ownerPin'); if (el){ for (const ch of '1234') el.querySelector(`[data-opin="${ch}"]`).click(); el.querySelector('[data-opinok]')?.click(); } }); await p.waitForTimeout(400);
    const rt = await p.evaluate(() => ({mv: E.moves.filter(x => x.saleId).map(x => x.refundBy), cash: cashParts(today(), () => true).sales, card: salesStats('today').card}));
    ok('Refund by card: cash box unchanged, card total lower', rt.mv.length && rt.mv.every(x => x === 'card') && rt.cash === 5000 && rt.card === 5000, rt);
    // all card, all cash, too much on card, cash below the cash part
    await fill(p, 2); await p.click('[data-xpay="card"]'); await p.waitForTimeout(100);
    ok('All card: card = total, no cash received box', await p.evaluate(() => $('#xCard').value === '10000' && $('#xCashRow').hidden));
    r = await save(p); ok('All card saved as a card sale', r.saved === 1 && r.last.method === 'card' && r.last.card === undefined && r.last.given === undefined, r.last);
    await fill(p, 2); await type(p, '#xCard', 20000);
    ok('Card more than the total is shown at once', /more than the total/.test(await p.evaluate(() => $('#xCardErr').textContent)));
    r = await save(p); ok('Card more than the total is refused', r.saved === 0 && /more than the total/.test(r.err), r.err);
    await p.click('[data-xpay="cash"]'); await p.waitForTimeout(100);
    ok('All cash clears the card amount', await p.evaluate(() => $('#xCard').value === '' && $('#xCashPart').value === '10,000'));
    await type(p, '#xCard', 4000); await type(p, '#xGiven', 5000);
    r = await save(p); ok('Cash received below the cash part is refused', r.saved === 0 && /less than the cash part/.test(r.err), r.err);
    ok('Receipts list says how it was paid', await p.evaluate(() => /Cash 5,000 \+ card 10,000/.test(document.querySelector('#view').innerText)));
    ok('No page errors (payment)', !p.errs.length, p.errs);
    await p.close(); }

  // ---- quick buttons: pinned first, best sellers frozen for the week, owner settings
  { const p = await fresh();
    const q = () => p.evaluate(() => [...document.querySelectorAll('.quick button b')].map(e => e.textContent));
    await p.evaluate(async () => {
      const id = n => catalog().find(x => x.name === n).id, ws = periodRange('week')[0];
      const sale = (n, d, k) => write('sales/S' + n + k + d, {id:'S' + n + k + d, no:'x', date:d, at:d + 'T10:00:00.000Z', lines:[{pid:id(n), qty:1, total:5000, alloc:[]}], total:5000, method:'cash'});
      for (let k = 0; k < 3; k++) await sale('Delta', addDays(ws, -2), k);   // last week: Delta on 3 receipts, Zinc on 1
      await sale('Zinc', addDays(ws, -3), 0);
      for (let k = 0; k < 6; k++) await sale('Cetal', today(), k);          // this week: Cetal sells a lot, but the buttons wait for next week
      await write('products/' + id('Omega'), {id:id('Omega'), sellBox:5000, quick:true});
      S.cart = []; render(); });
    await p.waitForTimeout(200);
    let names = await q();
    ok('Pinned first, then last week\'s best sellers; this week\'s sales wait', names.join() === 'Omega,Delta,Zinc', names);
    await p.evaluate(async () => { await write('meta/erp', {...E.cfg, quickEvery:'pinned'}); }); await p.waitForTimeout(250); await p.evaluate(() => render());
    names = await q(); ok('Owner choice "only my pinned items"', names.join() === 'Omega', names);
    await p.evaluate(async () => { const id = n => catalog().find(x => x.name === n).id;
      for (const n of ['Alpha','Beta','Delta','Zinc','Cetal','Rennie','Imodium','Claritine','Brufen','Fucidin']) await write('products/' + id(n), {id:id(n), sellBox:5000, quick:true});
      await write('meta/erp', {...E.cfg, quickEvery:'week', quickN:8}); render(); }); await p.waitForTimeout(150);
    names = await q(); ok('Owner can show 8 buttons; pinned items in name order', names.length === 8 && names[0] === 'Alpha' && names[1] === 'Beta', names);
    // Settings shows the choices
    await p.evaluate(() => { S.tab = 'settings'; render(); });
    const st = await p.evaluate(() => ({n: $('#sQuickN')?.value, e: $('#sQuickEvery')?.value}));
    ok('Settings: quick button count and refresh choice', st.n === '8' && st.e === 'week', st);
    await p.evaluate(() => { $('#sQuickN').value = '16'; $('#sQuickEvery').value = 'day'; $('#cfgForm').requestSubmit(); }); await p.waitForTimeout(250);
    ok('Settings saved', await p.evaluate(() => E.cfg.quickN === 16 && E.cfg.quickEvery === 'day'));
    ok('No page errors (quick buttons)', !p.errs.length, p.errs);
    await p.close(); }

  // ---- 16 buttons still fit on a phone
  { const p = await fresh({width:360, height:740}); await p.evaluate(async () => { await write('meta/erp', {...E.cfg, quickN:16}); }); await pin(p, 18);
    const L = await layout(p, 'pos-phone-16');
    ok('16 buttons on a small phone: square, inside, nothing off the edge', L.n === 16 && L.square && L.inside && L.overflow <= 0, L);
    await p.close(); }
  await b.close();
  console.log(fails ? `FAIL ${fails} checks` : 'PASS all till checks'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
