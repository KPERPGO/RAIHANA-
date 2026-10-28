// Phone bottom bar: Home, POS, Purchasing and Menu (Menu at the right in both languages), Menu opens the screen list upward,
// the bar slides away on scroll down and back on a small scroll up, owner picks the three buttons in Settings, staff only get screens they may open.
const { chromium } = require('./pw');
(async () => {
  const b = await chromium.launch(); let fails = 0; const ok = (c, name, got) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + name + (c ? '' : '  :: ' + JSON.stringify(got))); if (!c) fails++; };
  for (const lang of ['en', 'ar']) {
    const tag = lang;
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }), page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await ctx.addInitScript(l => { try { if (!sessionStorage.s) { sessionStorage.s = 1; localStorage.setItem('rp.lang', l); } } catch (e) {} }, JSON.stringify(lang));
    await page.goto('http://localhost:8765/index.html'); await page.waitForTimeout(1200);
    await page.evaluate(() => { S.tab = 'home'; render(); }); await page.waitForTimeout(200);
    const bar = () => page.$$eval('#botbar button', a => a.map(x => ({ v: x.dataset.xbot || 'menu', t: x.textContent.trim(), x: Math.round(x.getBoundingClientRect().left), cur: x.getAttribute('aria-current') === 'page' })));
    let r = await bar();
    ok(r.map(x => x.v).join() === 'home,sell,grp:purchasing,menu', tag + ' default buttons Home, POS, Purchasing, Menu', r);
    ok(r.every((x, i) => !i || x.x > r[i - 1].x), tag + ' from the left: Home first, Menu at the right', r);
    ok(lang === 'en' ? r[1].t === 'POS' : r[1].t === 'نقطة البيع', tag + ' POS name', r[1]);
    ok(await page.$$eval('#botbar svg.ic', a => a.length) === 4, tag + ' every button has an icon');
    ok(!(await page.isVisible('nav.tabs')), tag + ' no screen list at the top on a phone');
    ok(await page.evaluate(() => { const q = document.querySelector('#botbar').getBoundingClientRect(); return Math.abs(q.bottom - innerHeight) < 1; }), tag + ' bar sits at the bottom');
    // Menu opens the list above the button, a screen closes it
    await page.click('#botbar [data-xbotmenu]'); await page.waitForTimeout(250);
    ok(await page.evaluate(() => { const n = document.querySelector('nav.tabs').getBoundingClientRect(), m = document.querySelector('#botbar [data-xbotmenu]').getBoundingClientRect(); return n.bottom <= m.top + 1 && n.right >= m.right - 12; }), tag + ' Menu opens the list upward from the button');
    ok(await page.$$eval('nav.tabs [data-tab] svg.ic, nav.tabs .ng svg.ic', a => a.length) >= 21, tag + ' every screen and group in the menu has an icon');
    await page.click('nav.tabs .ng[data-grp="finance"]'); await page.waitForTimeout(100);
    await page.click('nav.tabs [data-tab="money"]'); await page.waitForTimeout(250);
    ok(await page.evaluate(() => S.tab === 'money' && !document.body.classList.contains('botmenu')), tag + ' choosing a screen opens it and closes the menu');
    await page.click('#botbar [data-xbotmenu]'); await page.waitForTimeout(150); await page.click('#botdim', { position: { x: 20, y: 200 } }); await page.waitForTimeout(150);
    ok(!(await page.evaluate(() => document.body.classList.contains('botmenu'))), tag + ' tapping outside closes the menu');
    // Purchasing opens Invoices, then the screen last used in that group
    await page.click('#botbar [data-xbot="grp:purchasing"]'); await page.waitForTimeout(200);
    ok(await page.evaluate(() => S.tab === 'invoices'), tag + ' Purchasing opens Invoices');
    await page.evaluate(() => { S.tab = 'suppliers'; render(); }); await page.evaluate(() => { S.tab = 'home'; render(); }); await page.waitForTimeout(100);
    await page.click('#botbar [data-xbot="grp:purchasing"]'); await page.waitForTimeout(200);
    ok(await page.evaluate(() => S.tab === 'suppliers'), tag + ' Purchasing remembers the last screen in the group');
    ok((await bar())[2].cur, tag + ' Purchasing is marked while in that group');
    // scrolling: down shows the bar, a small scroll up hides it, the top of a page shows it
    await page.evaluate(() => { S.tab = 'settings'; render(); }); await page.waitForTimeout(250);
    const scroll = y => page.evaluate(y => { const v = document.getElementById('view'); v.scrollTop = y; v.dispatchEvent(new Event('scroll')); return document.body.classList.contains('bothide'); }, y);
    await scroll(400); ok(await scroll(600), tag + ' scrolling down hides the bar');
    await page.waitForTimeout(350); ok(await page.evaluate(() => document.querySelector('#botbar').getBoundingClientRect().top >= innerHeight - 1), tag + ' hidden bar slid below the screen');
    ok(!(await scroll(570)), tag + ' a small scroll up brings the bar back');
    await scroll(800); ok(!(await scroll(0)), tag + ' top of the page shows the bar');
    // owner picks the buttons in Settings
    await page.evaluate(() => { S.tab = 'settings'; render(); }); await page.waitForTimeout(200);
    await page.selectOption('#sBot0', 'stock'); await page.selectOption('#sBot1', 'sell'); await page.selectOption('#sBot2', 'grp:finance');
    await page.evaluate(() => document.querySelector('#cfgForm button[type=submit]').click()); await page.waitForTimeout(600);
    ok((await bar()).map(x => x.v).join() === 'stock,sell,grp:finance,menu', tag + ' Settings changes the three buttons', await bar());
    // a pharmacist with POS and Stock only gets screens they may open
    await page.evaluate(() => { E.staff.push({ id: 'ST-O', name: 'Boss', role: 'owner', active: true }, { id: 'ST-P', name: 'Ali', role: 'pharmacist', active: true, perms: ['sell', 'stock'] }); S.staff = E.staff.find(x => x.id === 'ST-P'); S.tab = 'sell'; render(); }); await page.waitForTimeout(200);
    r = await bar(); ok(r.map(x => x.v).join() === 'stock,sell,menu', tag + ' staff only see allowed screens', r);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), tag + ' no sideways scroll');
    ok(!errs.length, tag + ' no page errors', errs);
    await ctx.close();
  }
  // iPad keeps the side list (with icons), no bottom bar
  const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } }), page = await ctx.newPage(); await page.goto('http://localhost:8765/index.html'); await page.waitForTimeout(1000);
  // wide screen: ☰ in the top bar; the side list starts hidden, a tap shows it, another tap hides it completely, and it comes back as it was
  ok(!(await page.isVisible('#botbar')) && await page.isVisible('.hmenu') && !(await page.isVisible('nav.tabs')), 'iPad: ☰ in the top bar, side list hidden at start, no bottom bar');
  await page.click('.hmenu'); await page.waitForTimeout(150);
  ok(await page.isVisible('nav.tabs [data-tab="home"] svg.ic') && await page.getAttribute('.hmenu', 'aria-expanded') === 'true', 'iPad: ☰ shows the side list with icons');
  await page.click('nav.tabs .ng[data-grp="finance"]'); await page.waitForTimeout(100);
  await page.click('.hmenu'); await page.waitForTimeout(150);
  ok(await page.evaluate(() => { const n = document.querySelector('nav.tabs').getBoundingClientRect(), v = document.querySelector('.mcol').getBoundingClientRect(); return n.width === 0 && v.left < 1 && v.width >= innerWidth - 1; }), 'iPad: second tap hides the side list completely, the page takes the full width');
  await page.click('.hmenu'); await page.waitForTimeout(150);
  ok(await page.isVisible('nav.tabs [data-tab="money"]'), 'iPad: the list comes back as it was (Finance still open)');
  await page.reload(); await page.waitForTimeout(1000);
  ok(await page.isVisible('nav.tabs [data-tab="home"]'), 'iPad: the choice is kept on this device');
  ok(await page.textContent('nav.tabs .ng[data-grp="sales"] .gl') === 'Sales/POS' && await page.textContent('nav.tabs [data-tab="sell"]') === 'POS', 'iPad: Sales/POS group and POS screen');
  await b.close(); console.log(fails ? fails + ' FAILED' : 'PASS all bottom bar checks'); process.exit(fails ? 1 : 0);
})();
