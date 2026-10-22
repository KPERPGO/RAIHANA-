// Guided start: first-use tour (once), one dismissible tip per screen, the day's steps for the person on shift. English and Arabic.
const { chromium } = require('./pw');
(async () => {
  const b = await chromium.launch(); let fails = 0; const ok = (c, name, got) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + name + (c ? '' : '  :: ' + JSON.stringify(got))); if (!c) fails++; };
  for (const lang of ['en', 'ar']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 800 } }), page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await ctx.addInitScript(LANG => { try { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('rp.lang', LANG); localStorage.setItem('erp.tourDone', 'false'); } } catch (e) {} }, JSON.stringify(lang)); // this test wants the tour
    await page.goto('http://localhost:8765/index.html'); await page.waitForTimeout(1500);
    const T = (en, ar) => lang === 'en' ? en : ar;
    ok(await page.isVisible('#sheet'), lang + ' tour opens on first use');
    ok(new RegExp(T('Welcome to Raihana', 'أهلاً بك في ريحانة')).test(await page.textContent('#sheetTitle')), lang + ' tour step 1 title', await page.textContent('#sheetTitle'));
    await page.click('[data-xtour="1"]'); await page.click('[data-xtour="2"]'); await page.click('[data-xtour="3"]'); await page.waitForTimeout(200);
    ok(/4 \/ 4/.test(await page.textContent('#sheetBody')) && await page.isVisible('[data-xtour="done"]'), lang + ' last step has Start working');
    await page.click('[data-xtour="done"]'); await page.waitForTimeout(200);
    ok(!(await page.isVisible('#sheet')), lang + ' tour closes');
    await page.reload(); await page.waitForTimeout(1500);
    ok(!(await page.isVisible('#sheet')), lang + ' tour does not come back');
    // tip on Sell, dismissed once, stays dismissed
    await page.evaluate(() => { S.tab = 'sell'; render(); }); await page.waitForTimeout(300);
    ok(await page.isVisible('#tipCard'), lang + ' tip shows on Sell');
    if (lang === 'ar') ok(/اضغط على الدواء/.test(await page.textContent('#tipCard')), 'ar tip is in Arabic', await page.textContent('#tipCard'));
    await page.click('[data-xhint="sell"]'); await page.evaluate(() => render()); await page.waitForTimeout(200);
    ok(!(await page.isVisible('#tipCard')), lang + ' dismissed tip stays away');
    // owner on shift: the day's steps card on Sell
    await page.click('nav.tabs [data-tab="staff"]'); await page.click('[data-xstaff="__new"]'); await page.fill('#fName', 'Owner'); await page.fill('#fPin', '1234'); await page.click('#staffForm button[type=submit]'); await page.waitForTimeout(700);
    await page.evaluate(() => { S.tab = 'sell'; render(); }); await page.waitForTimeout(300);
    ok(await page.isVisible('#dayCard') && await page.isVisible('[data-xgd="open"]'), lang + ' day card asks for the start count');
    await page.click('[data-xgd="open"]'); await page.fill('#ccAmt', '10000'); await page.click('[data-xcashcount="open"]'); await page.waitForTimeout(400);
    ok(!(await page.isVisible('[data-xgd="open"]')), lang + ' start step ticked after counting');
    await page.click('[data-xgd="end"]'); await page.waitForTimeout(200);
    ok(await page.isVisible('[data-xcashcount="end"]'), lang + ' End of the day opens the closing count');
    await page.click('#sheetClose');
    // Settings can bring the tour back
    await page.evaluate(() => { S.tab = 'settings'; render(); }); await page.waitForTimeout(300);
    await page.click('[data-xguide="1"]'); await page.waitForTimeout(900);
    ok(await page.isVisible('#sheet'), lang + ' Settings shows the tour again');
    ok(!errs.length, lang + ' no page errors', errs);
    await ctx.close();
  }
  await b.close(); console.log(fails ? fails + ' FAILED' : 'PASS all guide checks'); process.exit(fails ? 1 : 0);
})();
