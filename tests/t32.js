// Layout tidy-up: Home quick buttons (by permission, each opens its job), short pages no longer stretch buttons and labels, menu group lines.
const { chromium } = require('./pw');
(async () => {
  const b = await chromium.launch(); let fails = 0; const ok = (c, name, got) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + name + (c ? '' : '  :: ' + JSON.stringify(got))); if (!c) fails++; };
  for (const lang of ['en', 'ar']) for (const vp of [{ width: 1180, height: 820 }, { width: 390, height: 844 }]) {
    const tag = lang + ' ' + vp.width;
    const ctx = await b.newContext({ viewport: vp }), page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await ctx.addInitScript(l => { try { if (!sessionStorage.s) { sessionStorage.s = 1; localStorage.setItem('rp.lang', l); } } catch (e) {} }, JSON.stringify(lang));
    await page.goto('http://localhost:8765/index.html'); await page.waitForTimeout(1200);
    await page.click('nav.tabs [data-tab="staff"]'); await page.click('[data-xstaff="__new"]'); await page.fill('#fName', 'Owner'); await page.fill('#fPin', '1234'); await page.click('#staffForm button[type=submit]'); await page.waitForTimeout(700);
    await page.evaluate(() => { S.tab = 'home'; render(); }); await page.waitForTimeout(300);
    const qa = await page.$$eval('.quickacts button', a => a.length); ok(qa === 6, tag + ' owner has 6 quick buttons', qa);
    ok(await page.evaluate(() => { const q = document.querySelector('.quickacts').getBoundingClientRect().top; return [...document.querySelectorAll('main#view > *')].every(x => x === document.querySelector('.quickacts') || x.getBoundingClientRect().height === 0 || x.getBoundingClientRect().top >= q - 1 || x.classList.contains('tipcard') || /day/.test(x.className)); }), tag + ' quick buttons sit above the figures');
    await page.click('.quickacts [data-xrepgo="stock-low"]'); await page.waitForTimeout(300);
    ok(await page.evaluate(() => S.tab === 'stock' && S.stockF === 'low'), tag + ' Low stock opens Stock on the low filter');
    await page.evaluate(() => { S.tab = 'home'; render(); }); await page.waitForTimeout(200);
    await page.click('.quickacts [data-xcount="1"]'); await page.waitForTimeout(300);
    ok(await page.isVisible('#sheet'), tag + ' Stocktaking opens');
    await page.evaluate(() => { closeSheet(); S.tab = 'home'; render(); }); await page.waitForTimeout(200);
    await page.click('.quickacts [data-act="newInv"]'); await page.waitForTimeout(300);
    ok(await page.isVisible('#sheet'), tag + ' + Invoice opens the invoice form');
    await page.evaluate(() => closeSheet());
    // short pages: buttons and labels keep their own height
    for (const t of ['invoices', 'items', 'reports']) {
      await page.evaluate(t => { S.tab = t; render(); }, t); await page.waitForTimeout(250);
      const h = await page.$$eval('main .chips button, main label', a => Math.max(...a.map(x => x.getBoundingClientRect().height)));
      ok(h < 80, tag + ' ' + t + ': no stretched buttons or labels', h);
    }
    if (vp.width > 760) { const seps = await page.$$eval('nav.tabs .tl button.gsep', a => a.map(x => x.dataset.tab)); ok(seps.join() === 'pricing,reports', tag + ' Pricing and Reports start with a group line', seps); }
    // a pharmacist allowed Home and Sell only: Sell and Find
    await page.evaluate(() => { E.staff.push({ id: 'ST-P', name: 'Ali', role: 'pharmacist', active: true, perms: ['home', 'sell'] }); S.staff = E.staff.find(x => x.id === 'ST-P'); S.tab = 'home'; render(); });
    await page.waitForTimeout(250);
    const q2 = await page.$$eval('.quickacts button', a => a.map(x => x.dataset.tab || Object.keys(x.dataset)[0]));
    ok(q2.join() === 'sell,xfind', tag + ' pharmacist sees only Sell and Find', q2);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), tag + ' no sideways scroll');
    ok(!errs.length, tag + ' no page errors', errs);
    await ctx.close();
  }
  await b.close(); console.log(fails ? fails + ' FAILED' : 'PASS all layout checks'); process.exit(fails ? 1 : 0);
})();
