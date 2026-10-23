// Reorder list, all-keys sheet, activity log, stock-loss reasons in profit and loss.
const { chromium } = require('./pw');
(async () => {
  const b = await chromium.launch(); let fails = 0; const ok = (c, name, got) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + name + (c ? '' : '  :: ' + JSON.stringify(got))); if (!c) fails++; };
  for (const lang of ['en', 'ar']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 800 } }), page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await ctx.addInitScript(l => { try { if (!sessionStorage.s) { sessionStorage.s = 1; localStorage.setItem('rp.lang', l); } } catch (e) {} }, JSON.stringify(lang));
    await page.goto('http://localhost:8765/index.html'); await page.waitForTimeout(1200);
    await page.click('nav.tabs [data-tab="staff"]'); await page.click('[data-xstaff="__new"]'); await page.fill('#fName', 'Owner'); await page.fill('#fPin', '1234'); await page.click('#staffForm button[type=submit]'); await page.waitForTimeout(700);
    ok(/Shift started|بدء دوام/.test(await page.textContent('main#view')), lang + ' activity log lists the shift start');
    await page.evaluate(() => { S.suppliers.push({ id: 'SUP-T', name: 'Test supplier', creditDays: 30 });
      S.invoices.push({ id: 'INV-T', supplierId: 'SUP-T', invoiceNo: 'T1', date: today(), type: 'credit', status: 'Approved for Posting', printedTotal: 30000, lidSeq: 1, lines: [{ lid: '0', desc: 'Gamma 5mg Syrup', name: 'Gamma', strength: '5mg', form: 'Syrup', qty: 3, price: 10000, value: 30000, batch: 'G1', expiry: '2020-01' }] });
      S.tab = 'stock'; render(); }); await page.waitForTimeout(400);
    await page.click('[data-xreorder="1"]'); await page.waitForTimeout(300);
    const t = await page.textContent('#sheetBody'); ok(/Gamma/.test(t) && /Test supplier/.test(t), lang + ' reorder list shows the expired-out item under its supplier', t);
    ok(/1 /.test(t), lang + ' suggests at least one box');
    await page.evaluate(() => { closeSheet(); S.tab = 'sell'; render(); }); await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('[data-xkeys="1"]').click()); await page.waitForTimeout(200);
    ok(/F9/.test(await page.textContent('#sheetBody')) && /Ctrl\+K/.test(await page.textContent('#sheetBody')), lang + ' all-keys sheet opens from Sell');
    await page.evaluate(() => closeSheet()); await page.keyboard.press('Control+/'); await page.waitForTimeout(200);
    ok(await page.isVisible('#sheetBody'), lang + ' Ctrl+/ opens the keys');
    await page.evaluate(() => { closeSheet(); E.moves.push({ id: 'M1', key: 'adj:x', q: 2, reason: 'Expired', date: today(), cost: 500 }); S.tab = 'books'; S.bk.view = 'pl'; S.bk.from = today().slice(0, 8) + '01'; render(); }); await page.waitForTimeout(300);
    const pl = await page.textContent('table.bk'); ok(/Expired/.test(pl) && /1,000/.test(pl), lang + ' profit and loss lists the stock loss by reason', pl);
    ok(!errs.length, lang + ' no page errors', errs);
    await ctx.close();
  }
  await b.close(); console.log(fails ? fails + ' FAILED' : 'PASS all stage 3 checks'); process.exit(fails ? 1 : 0);
})();
