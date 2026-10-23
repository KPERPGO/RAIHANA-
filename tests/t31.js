// Reports index: every link opens an existing report with the right view or filter, and only links to screens the person may open.
const { chromium } = require('./pw');
(async () => {
  const b = await chromium.launch(); let fails = 0; const ok = (c, name, got) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + name + (c ? '' : '  :: ' + JSON.stringify(got))); if (!c) fails++; };
  for (const lang of ['en', 'ar']) for (const vp of [{ width: 1180, height: 820 }, { width: 390, height: 844 }]) {
    const tag = lang + ' ' + vp.width;
    const ctx = await b.newContext({ viewport: vp }), page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await ctx.addInitScript(l => { try { if (!sessionStorage.s) { sessionStorage.s = 1; localStorage.setItem('rp.lang', l); } } catch (e) {} }, JSON.stringify(lang));
    await page.goto('http://localhost:8765/index.html'); await page.waitForTimeout(1200);
    await page.click('nav.tabs [data-tab="staff"]'); await page.click('[data-xstaff="__new"]'); await page.fill('#fName', 'Owner'); await page.fill('#fPin', '1234'); await page.click('#staffForm button[type=submit]'); await page.waitForTimeout(700);
    await page.evaluate(() => { S.tab = 'reports'; render(); }); await page.waitForTimeout(300);
    const links = await page.$$eval('[data-xrepgo]', a => a.map(x => x.dataset.xrepgo));
    ok(links.length === 16, tag + ' owner sees all 16 report links', links);
    ok(await page.isVisible('[data-rep="pay"]'), tag + ' supplier reports still on the same screen');
    const go = async k => { await page.evaluate(() => { closeSheet(); S.tab = 'reports'; render(); }); await page.waitForTimeout(150); await page.click(`[data-xrepgo="${k}"]`); await page.waitForTimeout(300); return page.evaluate(() => ({ tab: S.tab, sf: S.stockF, bk: S.bk.view, pf: S.pr.f, per: S.sellPeriod, sheet: !document.getElementById('sheet').hidden })); };
    let r = await go('pl'); ok(r.tab === 'books' && r.bk === 'pl', tag + ' Profit and loss opens Accounts on P&L', r);
    r = await go('bs'); ok(r.tab === 'books' && r.bk === 'bs', tag + ' Balance sheet opens Accounts on balance sheet', r);
    r = await go('stock-expired'); ok(r.tab === 'stock' && r.sf === 'expired', tag + ' Expired stock opens Stock filtered', r);
    r = await go('below-cost'); ok(r.tab === 'pricing' && r.pf === 'below', tag + ' Below cost opens Pricing filtered', r);
    r = await go('sales-month'); ok(r.tab === 'sell' && r.per === 'month', tag + ' Sales this month opens Sell on this month', r);
    r = await go('reorder'); ok(r.tab === 'stock' && r.sheet, tag + ' Reorder list opens', r);
    r = await go('money'); ok(r.tab === 'money', tag + ' Cash box report opens', r);
    // a pharmacist allowed Reports and Stock only sees the stock links
    await page.evaluate(() => { closeSheet(); E.staff.push({ id: 'ST-P', name: 'Ali', role: 'pharmacist', active: true, perms: ['reports', 'stock'] }); S.staff = E.staff.find(x => x.id === 'ST-P'); S.tab = 'reports'; render(); });
    await page.waitForTimeout(200);
    const l2 = await page.$$eval('[data-xrepgo]', a => a.map(x => x.dataset.xrepgo));
    ok(l2.length && l2.every(k => k.startsWith('stock') || k === 'reorder'), tag + ' pharmacist sees only stock reports', l2);
    if (lang === 'ar') ok(/كل التقارير/.test(await page.textContent('main#view')), tag + ' heading in Arabic');
    const wide = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1); ok(wide, tag + ' no sideways scroll');
    ok(!errs.length, tag + ' no page errors', errs);
    await ctx.close();
  }
  await b.close(); console.log(fails ? fails + ' FAILED' : 'PASS all reports index checks'); process.exit(fails ? 1 : 0);
})();
