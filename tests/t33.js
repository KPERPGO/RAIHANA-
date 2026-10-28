// Menu group headings: all closed at start, a tap shows the group's screens and a second tap hides them, at most two open, the screen in use always shows.
const { chromium } = require('./pw');
(async () => {
  const b = await chromium.launch(); let fails = 0; const ok = (c, name, got) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + name + (c ? '' : '  :: ' + JSON.stringify(got))); if (!c) fails++; };
  for (const lang of ['en', 'ar']) for (const vp of [{ width: 1180, height: 820 }, { width: 390, height: 844 }]) {
    const tag = lang + ' ' + vp.width;
    const ctx = await b.newContext({ viewport: vp }), page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await ctx.addInitScript(l => { try { if (!sessionStorage.s) { sessionStorage.s = 1; localStorage.setItem('rp.lang', l); } } catch (e) {} }, JSON.stringify(lang));
    await page.goto('http://localhost:8765/index.html'); await page.waitForTimeout(1200);
    await page.evaluate(() => { S.tab = 'home'; render(); }); await page.waitForTimeout(200);
    await page.evaluate(() => { const m = document.querySelector('#botbar [data-xbotmenu]'), h = document.querySelector('.hmenu'); if (m && m.offsetParent) m.click(); else if (h && h.offsetParent && document.body.classList.contains('navshut')) h.click(); }); // open the menu: above the phone bottom bar, or ☰ in the top bar on wide screens
    const shown = () => page.$$eval('nav.tabs .tl [data-tab]', a => a.filter(x => x.offsetParent !== null).map(x => x.dataset.tab));
    const open = () => page.$$eval('nav.tabs .ng[aria-expanded="true"]', a => a.map(x => x.dataset.grp));
    ok((await open()).length === 0, tag + ' all groups closed at start', await open());
    ok((await shown()).join() === 'home,pricing,reports', tag + ' only screens without a heading show', await shown());
    await page.click('nav.tabs .ng[data-grp="finance"]'); await page.waitForTimeout(100);
    ok((await shown()).includes('money'), tag + ' tap shows the group', await shown());
    await page.click('nav.tabs .ng[data-grp="finance"]'); await page.waitForTimeout(100);
    ok(!(await shown()).includes('money'), tag + ' second tap hides it', await shown());
    for (const g of ['patients', 'purchasing', 'admin']) { await page.click(`nav.tabs .ng[data-grp="${g}"]`); await page.waitForTimeout(80); }
    ok((await open()).join() === 'purchasing,admin', tag + ' at most two open, the oldest closes', await open());
    ok(!(await shown()).includes('customers') && (await shown()).includes('invoices') && (await shown()).includes('settings'), tag + ' screens match the open groups', await shown());
    await page.click('nav.tabs [data-tab="items"]'); await page.waitForTimeout(150);
    for (const g of ['purchasing', 'admin']) { await page.click(`nav.tabs .ng[data-grp="${g}"]`); await page.waitForTimeout(80); }
    ok((await open()).length === 0 && (await shown()).includes('items') && !(await shown()).includes('invoices'), tag + ' the screen in use stays in the menu', await shown());
    await page.focus('nav.tabs .ng[data-grp="patients"]'); await page.keyboard.press('Enter'); await page.waitForTimeout(80);
    ok((await open()).join() === 'patients', tag + ' keyboard Enter opens a group', await open());
    if (lang === 'ar') ok(await page.$eval('nav.tabs .ng[data-grp="patients"]', x => /المرضى/.test(x.textContent)), tag + ' headings in Arabic');
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), tag + ' no sideways scroll');
    ok(!errs.length, tag + ' no page errors', errs);
    await ctx.close();
  }
  await b.close(); console.log(fails ? fails + ' FAILED' : 'PASS all menu group checks'); process.exit(fails ? 1 : 0);
})();
