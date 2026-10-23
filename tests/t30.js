// Find (Ctrl+K): screens plus medicines, barcodes, customers, suppliers, invoices and receipts, only from screens the person may open.
const { chromium } = require('./pw');
(async () => {
  const b = await chromium.launch(); let fails = 0; const ok = (c, name, got) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + name + (c ? '' : '  :: ' + JSON.stringify(got))); if (!c) fails++; };
  for (const lang of ['en', 'ar']) {
    const ctx = await b.newContext({ viewport: { width: 1024, height: 768 } }), page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await ctx.addInitScript(l => { try { if (!sessionStorage.s) { sessionStorage.s = 1; localStorage.setItem('rp.lang', l); } } catch (e) {} }, JSON.stringify(lang));
    await page.goto('http://localhost:8765/index.html'); await page.waitForTimeout(1200);
    await page.click('nav.tabs [data-tab="staff"]'); await page.click('[data-xstaff="__new"]'); await page.fill('#fName', 'Owner'); await page.fill('#fPin', '1234'); await page.click('#staffForm button[type=submit]'); await page.waitForTimeout(700);
    await page.evaluate(() => {
      S.suppliers.push({ id: 'SUP-T', name: 'Oceanic Test' });
      S.invoices.push({ id: 'INV-T', supplierId: 'SUP-T', invoiceNo: 'T-4471', date: today(), type: 'credit', status: 'Approved for Posting', printedTotal: 30000, lidSeq: 1, lines: [{ lid: '0', desc: 'Gamma 5mg Syrup', name: 'Gamma', strength: '5mg', form: 'Syrup', qty: 3, price: 10000, value: 30000, batch: 'G1', expiry: '2099-01' }] });
      E.customers.push({ id: 'CU-T', name: 'Zainab Kareem', phone: '0770 555 1234' });
      E.sales.push({ id: 'SL-T', no: '261023-ABC-007', date: today(), at: nowIso(), total: 5000, lines: [] });
      clearMemo(); render(); });
    await page.waitForTimeout(300);
    const find = async q => { await page.evaluate(() => closeSheet()); await page.keyboard.press('Control+k'); await page.waitForTimeout(200); await page.fill('#finderQ', q); await page.waitForTimeout(200);
      return page.$$eval('#finderList .row', a => a.map(x => ({ t: x.querySelector('.t').textContent, attrs: [...x.attributes].map(y => y.name + '="' + y.value + '"').join(' ') }))); };
    let r = await find('gamma'); ok(r.some(x => /Gamma/.test(x.t) && /data-xprod/.test(x.attrs)), lang + ' finds a medicine by name', r);
    r = await find('zainab'); ok(r.some(x => x.t === 'Zainab Kareem' && /data-xcust="CU-T"/.test(x.attrs)), lang + ' finds a customer by name (name not translated)', r);
    r = await find('5551234'); ok(r.some(x => x.t === 'Zainab Kareem'), lang + ' finds a customer by phone digits', r);
    r = await find('oceanic'); ok(r.some(x => /data-open="sup:SUP-T"/.test(x.attrs)), lang + ' finds a supplier', r);
    r = await find('4471'); ok(r.some(x => /data-open="INV-T"/.test(x.attrs)), lang + ' finds an invoice by number', r);
    r = await find('ABC-007'); ok(r.some(x => /data-xsale="SL-T"/.test(x.attrs)), lang + ' finds a receipt by number', r);
    await page.click('#finderList [data-xsale="SL-T"]'); await page.waitForTimeout(300);
    ok(/261023-ABC-007/.test(await page.textContent('#sheetBody')), lang + ' a receipt hit opens the receipt');
    r = await find(lang === 'en' ? 'cash b' : 'صندوق'); ok(r.some(x => /data-xfindgo="money"/.test(x.attrs)), lang + ' still finds screens', r);
    r = await find('x'); ok(r.every(x => /data-xfindgo/.test(x.attrs)), lang + ' one letter searches screens only', r);
    // a pharmacist with Sell only: medicines go to Sell, no customers, suppliers or invoices
    await page.evaluate(() => { closeSheet(); E.staff.push({ id: 'ST-P', name: 'Ali', role: 'pharmacist', active: true, perms: ['sell'] }); S.staff = E.staff.find(x => x.id === 'ST-P'); S.tab = 'sell'; render(); });
    r = await find('gamma'); ok(r.some(x => /data-xfindsell="Gamma"/.test(x.attrs)) && !r.some(x => /data-xprod/.test(x.attrs)), lang + ' Sell-only: a medicine opens Sell, not the item card', r);
    r = await find('zainab'); ok(!r.length || r.every(x => !/xcust/.test(x.attrs)), lang + ' Sell-only: customers are not shown', r);
    r = await find('oceanic'); ok(!r.some(x => /sup:/.test(x.attrs)), lang + ' Sell-only: suppliers are not shown', r);
    r = await find('4471'); ok(!r.some(x => /INV-T/.test(x.attrs)), lang + ' Sell-only: invoices are not shown', r);
    r = await find('gamma'); await page.click('#finderList [data-xfindsell]'); await page.waitForTimeout(300);
    ok(await page.evaluate(() => S.tab === 'sell' && S.sellQ === 'Gamma'), lang + ' the medicine is typed into the Sell search');
    ok(!errs.length, lang + ' no page errors', errs);
    await ctx.close();
  }
  await b.close(); console.log(fails ? fails + ' FAILED' : 'PASS all find checks'); process.exit(fails ? 1 : 0);
})();
