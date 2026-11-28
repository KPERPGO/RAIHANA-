const ROOT = require('path').resolve(__dirname, '..'); // repo folder: src, dist, tests
// Receipt paper and Zain Cash / Qi card, 20 Nov 2026 (LTH: "Make them both"): Settings picks 58 mm or 80 mm receipt paper;
// Sell takes Zain Cash and Qi card next to cash and card (all of it, or the non-cash part of a split). They stay out of
// the cash box like card, and are shown apart on the receipt, Sell totals, the Cash box, Reports, export and accounts.
const { chromium, XLSX_FILE } = require('./pw');
let fails = 0; const ok = (m, c, x) => { console.log(c ? 'ok  ' : 'FAIL', m, x === undefined ? '' : JSON.stringify(x)); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  const fresh = async (vp = { width: 1280, height: 900 }, ar = false) => {
    const p = await b.newPage({ viewport: vp }); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.errs = errs;
    await p.addInitScript({ path: ROOT + '/tests/fake.js' });
    await p.route('**/xlsx.full.min.js', r => r.fulfill({ path: XLSX_FILE, contentType: 'text/javascript' }));
    await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await p.goto('file://' + ROOT + '/tests/erp-artifact-test.html'); await p.waitForTimeout(800);
    await p.evaluate(async () => {
      Object.assign(__store, {products:{}, sales:{}, moves:{}, customers:{}, custpays:{}, chronic:{}, expenses:{}, closes:{}, counts:{}, staff:{}, shifts:{}, events:{}});
      __seed('suppliers', [{id:'SUP-T', name:'Test supplier', creditDays:30}]);
      __seed('invoices', [{id:'INV-T', supplierId:'SUP-T', invoiceNo:'T1', date:today(), type:'credit', status:'Approved for Posting', printedTotal:20000, lidSeq:2,
        lines:['Beta', 'Gamma'].map((n, i) => ({lid:String(i), desc:n + ' Syrup', name:n, form:'Syrup', qty:20, price:500, value:10000, batch:'B' + i, expiry:'2028-01'}))}]);
      __seed('staff', [{id:'ST-O', name:'Owner', role:'owner', active:true, pinHash: await pinHash('ST-O', '1234')}]);
    });
    await p.waitForTimeout(300);
    await p.evaluate(async () => { for (const p of catalog()) await write('products/' + p.id, {id:p.id, sellBox:5000}); S.staff = E.staff.find(x => x.id === 'ST-O'); S.tab = 'sell'; render(); });
    await p.waitForTimeout(200);
    if (ar) { await p.click('#langBtn'); await p.waitForTimeout(300); }
    return p;
  };
  const fill = (p, n) => p.evaluate(n => { closeSheet(); const x = catalog().find(q => q.name === 'Beta'); S.cart = [{pid:x.id, mode:'box', qty:n, price:5000}]; S.cartMeta = {}; saveCart(); render(); }, n);
  const type = (p, sel, v) => p.evaluate(([sel, v]) => { const el = document.querySelector(sel); el.focus(); el.value = v; el.dispatchEvent(new Event('input', {bubbles:true})); }, [sel, String(v)]);
  const pick = (p, sel, v) => p.evaluate(([sel, v]) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('change', {bubbles:true})); }, [sel, v]);
  const save = async p => { await p.evaluate(() => { window.__n = E.sales.length; document.getElementById('sellForm').requestSubmit(); }); await p.waitForTimeout(300);
    return p.evaluate(() => ({saved: E.sales.length - window.__n, err: document.getElementById('xErr')?.textContent || '', rc: document.getElementById('receipt')?.innerText.replace(/\s+/g, ' '), last: [...E.sales].sort((a, b) => a.at.localeCompare(b.at)).pop()})); };

  // ---- paying by Zain Cash and Qi card
  { const p = await fresh();
    await fill(p, 2); // 10,000
    const chips = await p.evaluate(() => [...document.querySelectorAll('.paykind button')].map(x => x.textContent));
    ok('Payment buttons: All cash, All card, All Zain Cash, All Qi card', ['All cash', 'All card', 'All Zain Cash', 'All Qi card'].every(t => chips.includes(t)), chips);
    await p.click('[data-xpay="zain"]'); await p.waitForTimeout(100);
    let v = await p.evaluate(() => ({via: $('#xVia').value, amt: $('#xCard').value, lab: $('#xCard').parentElement.firstChild.textContent, cashRow: $('#xCashRow').hidden, bill: document.getElementById('billCardRow').innerText, pressed: document.querySelector('[data-xpay="zain"]').getAttribute('aria-pressed')}));
    ok('All Zain Cash: whole total on Zain Cash, no cash box, invoice says Zain Cash', v.via === 'zain' && v.amt === '10000' && v.cashRow && /Zain Cash/.test(v.lab) && /Zain Cash/.test(v.bill) && v.pressed === 'true', v);
    let r = await save(p); const zainId = r.last.id;
    ok('Saved as a Zain Cash sale', r.saved === 1 && r.last.method === 'card' && r.last.via === 'zain', r.last);
    ok('Receipt says Paid by Zain Cash', /Paid by Zain Cash/.test(r.rc), r.rc);

    await fill(p, 3); // 15,000: 5,000 Qi card + 10,000 cash
    await pick(p, '#xVia', 'qi'); await p.waitForTimeout(100); await type(p, '#xCard', 5000); await type(p, '#xGiven', 10000);
    v = await p.evaluate(() => ({lab: $('#xCard').parentElement.firstChild.textContent, cash: $('#xCashPart').value, bill: document.getElementById('billCardRow').innerText}));
    ok('Split with Qi card: label and invoice say Qi card, cash part 10,000', /Qi card amount/.test(v.lab) && v.cash === '10,000' && /Qi card/.test(v.bill), v);
    r = await save(p);
    ok('Saved as split: Qi card 5,000 + cash 10,000', r.saved === 1 && r.last.method === 'split' && r.last.via === 'qi' && r.last.card === 5000 && r.last.cash === 10000, r.last);
    ok('Receipt shows the Qi card part and "cash and Qi card"', /Qi card 5,000/.test(r.rc) && /Paid by cash and Qi card/.test(r.rc), r.rc);

    await fill(p, 2); await p.click('[data-xpay="card"]'); await p.waitForTimeout(100);
    r = await save(p); ok('All card still saves as a plain card sale (no via)', r.saved === 1 && r.last.method === 'card' && r.last.via === undefined && /Paid by card/.test(r.rc), r.last);

    const m = await p.evaluate(() => { const c = cashParts(today(), () => true), st = salesStats('today');
      const je = bkEntries().filter(e => e.src === 'Sale').map(e => e.desc + ' ' + e.lines.map(l => l.acct + ':' + (l.dr || -l.cr)).join(' '));
      return {cash:c.sales, card:c.cardSales, via:c.via, stVia:st.via, stCard:st.card, je}; });
    ok('Cash box counts only real cash (10,000); non-cash 25,000', m.cash === 10000 && m.card === 25000 && m.stCard === 25000, m);
    ok('Totals by kind: card 10,000, Zain Cash 10,000, Qi card 5,000', m.via.card === 10000 && m.via.zain === 10000 && m.via.qi === 5000 && JSON.stringify(m.stVia) === JSON.stringify(m.via), m.via);
    ok('Accounts: Zain Cash and Qi card sales named, debited to 1010 like card', m.je.some(x => /Sale paid by Zain Cash .*1010:10000/.test(x)) && m.je.some(x => /Sale paid by cash and Qi card .*1000:10000.*1010:5000/.test(x)), m.je);
    await p.evaluate(() => { closeSheet(); render(); }); await p.waitForTimeout(100);
    const list = await p.evaluate(() => document.getElementById('view').innerText);
    await p.evaluate(() => { S.tab = 'home'; render(); }); await p.waitForTimeout(100);
    const sell = {list, k: await p.evaluate(() => [...document.querySelectorAll('.kpis .kpi .l')].map(x => x.textContent))};
    ok('Sell totals show Card, Zain Cash and Qi card tiles', ['Card', 'Zain Cash', 'Qi card'].every(t => sell.k.includes(t)), sell.k);
    ok('Receipts list: "Zain Cash" and "Cash 10,000 + Qi card 5,000"', /Zain Cash/.test(sell.list) && /Cash 10,000 \+ Qi card 5,000/.test(sell.list));
    await p.evaluate(() => { S.tab = 'money'; render(); }); await p.waitForTimeout(150);
    const money = await p.evaluate(() => document.getElementById('view').innerText);
    ok('Cash box shows Paid by Zain Cash and by Qi card today (not in the box)', /Paid by Zain Cash today \(not in the box\)\s*10,000/.test(money) && /Paid by Qi card today \(not in the box\)\s*5,000/.test(money) && /Paid by card today/.test(money));
    await p.evaluate(() => { S.tab = 'reports'; S.repM = null; render(); }); await p.waitForTimeout(150);
    const rep = await p.evaluate(() => [...document.querySelectorAll('.repch figure')].find(f => /Sales by payment/.test(f.innerText))?.innerText);
    ok('Reports: Sales by payment has Card, Zain Cash and Qi card', /Card/.test(rep) && /Zain Cash/.test(rep) && /Qi card/.test(rep), rep);
    const xl = await p.evaluate(() => { const s = E.sales.find(x => x.via === 'qi'); return payText(s) + ' | ' + viaName(s); });
    ok('Payment text for split Qi card', xl === 'Cash 10,000 + Qi card 5,000 | Qi card', xl);

    // a return from the Zain Cash sale goes back to Zain Cash
    await p.evaluate(id => { S.tab = 'sell'; render(); returnSheet(id); }, zainId); await p.waitForTimeout(150);
    ok('Return note: refund goes back to the Zain Cash', /back to the customer's Zain Cash/.test(await p.evaluate(() => document.getElementById('sheet').innerText)));
    await p.evaluate(() => { document.querySelector('[data-xrq="0"]').value = 1; document.getElementById('rReason').value = 'test'; document.getElementById('retForm').requestSubmit(); });
    await p.waitForTimeout(250); await p.evaluate(() => { const el = document.getElementById('ownerPin'); if (el){ for (const ch of '1234') el.querySelector(`[data-opin="${ch}"]`).click(); el.querySelector('[data-opinok]')?.click(); } }); await p.waitForTimeout(300);
    const rt = await p.evaluate(() => ({st: salesStats('today').via, cash: cashParts(today(), () => true).sales}));
    ok('After the return: Zain Cash total 5,000, cash box unchanged', rt.st.zain === 5000 && rt.cash === 10000, rt);
    ok('No page errors (payments)', !p.errs.length, p.errs);
    await p.close(); }

  // ---- receipt paper 80 mm / 58 mm
  { const p = await fresh();
    await p.evaluate(() => { S.tab = 'settings'; render(); }); await p.waitForTimeout(150);
    ok('Settings: receipt paper choice, 80 mm by default', await p.evaluate(() => $('#sPaper')?.value === '80' && [...$('#sPaper').options].map(o => o.value).join() === '80,58'));
    const width = async () => { await p.evaluate(() => { window.print = () => {}; const s = E.sales[0]; receiptSheet(s.id); document.querySelector('#sheet [data-xprint]').click(); }); await p.waitForTimeout(100);
      await p.emulateMedia({ media: 'print' }); const w = await p.evaluate(() => ({paper: $('#printArea').dataset.paper, w: $('#printArea #receipt').getBoundingClientRect().width}));
      await p.emulateMedia({ media: 'screen' }); await p.evaluate(() => closeSheet()); return w; };
    await p.evaluate(() => { S.tab = 'sell'; render(); }); await fill(p, 1); await save(p);
    let w = await width(); ok('80 mm paper prints 72 mm wide (~272px)', w.paper === '80' && Math.abs(w.w - 272) < 4, w);
    await p.evaluate(() => { S.tab = 'settings'; render(); }); await p.waitForTimeout(100);
    await p.selectOption('#sPaper', '58'); await p.evaluate(() => document.getElementById('cfgForm').requestSubmit()); await p.waitForTimeout(300);
    ok('Setting saved as 58', await p.evaluate(() => E.cfg.paper === '58'));
    w = await width(); ok('58 mm paper prints 48 mm wide (~181px)', w.paper === '58' && Math.abs(w.w - 181) < 4, w);
    ok('No page errors (paper)', !p.errs.length, p.errs);
    await p.close(); }

  // ---- phone and Arabic
  for (const [vp, ar] of [[{ width: 390, height: 844 }, false], [{ width: 390, height: 844 }, true], [{ width: 1280, height: 900 }, true]]) {
    const tag = `[${vp.width} ${ar ? 'ar' : 'en'}]`, p = await fresh(vp, ar);
    await fill(p, 2); await p.waitForTimeout(100);
    const r = await p.evaluate(() => ({doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, chips: [...document.querySelectorAll('.paykind button')].map(x => x.textContent), via: [...$('#xVia').options].map(o => o.textContent), lab: $('#xVia').parentElement.firstChild.textContent}));
    ok(tag + ' no sideways scroll on Sell', r.doc <= 1, r.doc);
    if (ar) ok(tag + ' Arabic: زين كاش and كي كارد', r.chips.includes('زين كاش بالكامل') && r.chips.includes('كي كارد بالكامل') && r.via.includes('زين كاش') && r.via.includes('كي كارد') && /الجزء غير النقدي/.test(r.lab), r);
    if (ar) { await p.evaluate(() => { S.tab = 'settings'; render(); }); await p.waitForTimeout(150);
      ok(tag + ' Arabic: receipt paper setting translated', await p.evaluate(() => /ورق طابعة الوصل/.test($('#sPaper').parentElement.textContent) && /80 ملم/.test($('#sPaper').options[0].textContent))); }
    ok(tag + ' no page errors', !p.errs.length, p.errs);
    await p.close(); }

  await b.close();
  console.log(fails ? `FAIL ${fails} checks` : 'PASS all payment kind and receipt paper checks'); process.exit(fails ? 1 : 0);
})();
