// Accounts (double entry): entries worked out from records, trial balance and balance sheet agree, P&L numbers, manual entry rules, period lock.
const { chromium } = require('./pw');
(async () => {
  const b = await chromium.launch(); let fails = 0; const ok = (c, name, got) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + name + (c ? '' : '  :: ' + JSON.stringify(got))); if (!c) fails++; };
  for (const lang of ['en', 'ar']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 800 } }), page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await ctx.addInitScript(l => { try { if (!sessionStorage.s) { sessionStorage.s = 1; localStorage.setItem('rp.lang', l); } } catch (e) {} }, JSON.stringify(lang));
    await page.goto('http://localhost:8765/index.html'); await page.waitForTimeout(1200);
    await page.click('nav.tabs [data-tab="staff"]'); await page.click('[data-xstaff="__new"]'); await page.fill('#fName', 'Owner'); await page.fill('#fPin', '1234'); await page.click('#staffForm button[type=submit]'); await page.waitForTimeout(700);
    const r = await page.evaluate(() => { const d = today();
      E.sales.push({ id: 'S1', no: 1, date: d, total: 1000, method: 'cash', lines: [{ alloc: [{ q: 1, cost: 600 }] }] }, { id: 'S2', no: 2, date: d, total: 500, method: 'card', lines: [{ alloc: [{ q: 1, cost: 200 }] }] });
      S.invoices.push({ id: 'I1', supplierId: 'SP1', invoiceNo: 'A1', date: d, status: 'Approved for Posting', lines: [], printedTotal: 2000 }, { id: 'I2', supplierId: 'SP1', invoiceNo: 'A2', date: d, status: 'Draft', lines: [], printedTotal: 9999 });
      S.payments.push({ id: 'P1', invoiceId: 'I1', supplierId: 'SP1', amount: 500, date: d, method: 'cash', verified: true });
      E.expenses.push({ id: 'X1', category: 'Rent', amount: 300, date: d, fromCash: true });
      const en = bkEntries(), bal = bkBal(en, null, d), all = en.flatMap(e => e.lines);
      return { eq: en.every(e => Math.round(e.lines.reduce((a, l) => a + l.dr - l.cr, 0)) === 0), cash: bkNet(bal, '1000'), card: bkNet(bal, '1010'), stock: bkNet(bal, '1200'), pay: bkNet(bal, '2000'), sales: bkNet(bal, '4000'), n: en.length, draft: all.some(l => l.cr === 9999) }; });
    ok(r.eq, lang + ' every entry has equal debit and credit', r);
    ok(r.cash === 200 && r.card === 500 && r.stock === 1200 && r.pay === 1500 && r.sales === 1500, lang + ' balances match the records', r);
    ok(!r.draft, lang + ' an unapproved invoice is not posted');
    await page.evaluate(() => { S.tab = 'books'; S.bk.from = today().slice(0, 8) + '01'; render(); }); await page.waitForTimeout(300);
    ok((await page.textContent('main#view')).includes('1,900') === false, lang + ' trial balance screen opens');
    const tb = await page.textContent('table.bk'); ok(/3,?[0-9]{3}/.test(tb), lang + ' trial balance has totals', tb);
    await page.click('[data-xbkview="pl"]'); await page.waitForTimeout(200);
    const pl = await page.textContent('table.bk'); ok(/400/.test(pl) && /800/.test(pl) && /300/.test(pl), lang + ' profit and loss: profit 400, cost 800, rent 300', pl);
    await page.click('[data-xbkview="bs"]'); await page.waitForTimeout(200);
    ok(/1,900/.test(await page.textContent('table.bk')) && !/differ|تختلف/.test(await page.textContent('main#view')), lang + ' balance sheet: assets 1,900 and it balances');
    await page.click('[data-xbkview="man"]'); await page.click('[data-xbkadd="1"]'); await page.waitForTimeout(200);
    await page.fill('#bkDesc', 'Opening cash'); await page.selectOption('#bkA0', '1000'); await page.fill('#bkD0', '5000'); await page.selectOption('#bkA1', '3000'); await page.fill('#bkC1', '4000');
    await page.click('#bkForm button[type=submit]'); await page.waitForTimeout(300);
    ok(await page.evaluate(() => E.journal.length === 0 && $('#bkFErr').textContent.length > 0), lang + ' unequal debit and credit is refused', await page.textContent('#bkFErr'));
    await page.fill('#bkC1', '5000'); await page.click('#bkForm button[type=submit]'); await page.waitForTimeout(400);
    await page.evaluate(() => { const el = document.getElementById('ownerPin'); for (const ch of '1234') el.querySelector(`[data-opin="${ch}"]`).click(); el.querySelector('[data-opinok]')?.click(); }); await page.waitForTimeout(600);
    ok(await page.evaluate(() => E.journal.length === 1 && bkNet(bkBal(bkEntries(), null, today()), '1000') === 5200), lang + ' manual entry saved with the PIN and counted');
    await page.click('[data-xbkview="lock"]'); await page.fill('#bkLockDate', await page.evaluate(() => today())); await page.click('[data-xbklock="1"]'); await page.waitForTimeout(400);
    await page.evaluate(() => { const el = document.getElementById('ownerPin'); for (const ch of '1234') el.querySelector(`[data-opin="${ch}"]`).click(); el.querySelector('[data-opinok]')?.click(); }); await page.waitForTimeout(600);
    ok(await page.evaluate(() => !!E.cfg.lockTo), lang + ' period locked');
    await page.evaluate(() => { E.sales.push({ id: 'S3', no: 3, date: today(), total: 100, method: 'cash', lines: [] }); S.bk.view = 'tb'; render(); }); await page.waitForTimeout(300);
    ok(await page.isVisible('.banner.bad'), lang + ' a change inside the locked period is flagged');
    await page.click('[data-xbkview="man"]'); await page.click('[data-xbkadd="1"]'); await page.fill('#bkDesc', 'x'); await page.selectOption('#bkA0', '1000'); await page.fill('#bkD0', '1'); await page.selectOption('#bkA1', '3000'); await page.fill('#bkC1', '1');
    await page.click('#bkForm button[type=submit]'); await page.waitForTimeout(300);
    ok(await page.evaluate(() => E.journal.length === 1), lang + ' manual entry inside the locked period is refused');
    ok(!errs.length, lang + ' no page errors', errs);
    await ctx.close();
  }
  await b.close(); console.log(fails ? fails + ' FAILED' : 'PASS all accounts checks'); process.exit(fails ? 1 : 0);
})();
