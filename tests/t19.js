// Cash count at every shift start and end: expected drawer, counted cash, difference saved and shown to the owner.
const { chromium } = require('./pw');
(async () => {
  const b = await chromium.launch(); let fails = 0; const ok = (c, name, got) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + name + (c ? '' : '  :: ' + JSON.stringify(got))); if (!c) fails++; };
  for (const lang of ['en', 'ar']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 800 } }), page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto('http://localhost:8765/index.html'); await page.waitForTimeout(900);
    if (lang === 'ar') { await page.click('#langBtn'); await page.waitForTimeout(200); }
    const sh = () => page.evaluate(() => JSON.parse(JSON.stringify(curShift() || E.shifts.at(-1))));
    // first owner starts a shift without a count, so the staff bar offers "Count cash"
    await page.click('nav.tabs [data-tab="staff"]'); await page.click('[data-xstaff="__new"]'); await page.fill('#fName', 'Owner'); await page.fill('#fPin', '1234'); await page.click('#staffForm button[type=submit]'); await page.waitForTimeout(700);
    ok(await page.isVisible('[data-xcountopen="1"]'), lang + ' Count cash button shows until the start count is saved');
    await page.click('[data-xcountopen="1"]'); await page.waitForTimeout(200);
    await page.click('[data-xcashcount="open"]'); ok(/\S/.test(await page.textContent('#ccErr')), lang + ' empty count is refused');
    await page.fill('#ccAmt', '50,000'); await page.click('[data-xcashcount="open"]'); await page.waitForTimeout(400);
    let s = await sh(); ok(s.openCount === 50000 && s.openExpected === null, lang + ' start count saved (50,000)', s);
    ok(!(await page.isVisible('[data-xcountopen="1"]')), lang + ' Count cash button gone after counting');
    // a cash sale of 7,000 and a 2,000 expense from the drawer during the shift; a debt sale does not count
    await page.evaluate(async () => { const at = nowIso(), d = today();
      await write('sales/ST-S1', {id:'ST-S1', no:'1', date:d, at, method:'cash', total:7000, subtotal:7000, discount:0, lines:[]});
      await write('sales/ST-S2', {id:'ST-S2', no:'2', date:d, at, method:'debt', total:3000, subtotal:3000, discount:0, lines:[]});
      await write('expenses/ST-E1', {id:'ST-E1', date:d, at, amount:2000, what:'Generator', fromCash:true}); });
    await page.waitForTimeout(300);
    await page.click('[data-xendshift="1"]'); await page.click('[data-xendshift="1"]'); await page.waitForTimeout(300);
    const sheet = await page.textContent('#sheetBody');
    ok(/55,000/.test(sheet), lang + ' end count expects 50,000 + 7,000 − 2,000 = 55,000', sheet);
    await page.fill('#ccAmt', '54000'); await page.waitForTimeout(100);
    ok(/1,000/.test(await page.textContent('#ccDiff')), lang + ' live difference shows short 1,000', await page.textContent('#ccDiff'));
    await page.click('[data-xcashcount="end"]'); await page.waitForTimeout(600);
    s = await page.evaluate(() => JSON.parse(JSON.stringify(E.shifts.find(x => x.end))));
    ok(s && s.closeCount === 54000 && s.closeExpected === 55000 && s.closeDiff === -1000, lang + ' end count saved with difference −1,000', s);
    ok(await page.isVisible('#lockScreen'), lang + ' shift ended, lock screen shows');
    // next shift: the start count is checked against the last end count
    await page.locator('[data-xlocksel]').first().click(); for (const k of '1234') await page.click(`[data-xpin="${k}"]`); await page.click('[data-xpinok="1"]'); await page.waitForTimeout(800);
    ok(/54,000/.test(await page.textContent('#sheetBody')), lang + ' new shift asks for a count and expects 54,000');
    await page.fill('#ccAmt', '54000'); await page.click('[data-xcashcount="open"]'); await page.waitForTimeout(400);
    s = await sh(); ok(s.openCount === 54000 && s.openDiff === 0, lang + ' matching start count saved with difference 0', s);
    // owner sees the mismatch on Staff
    await page.click('nav.tabs [data-tab="staff"]'); await page.waitForTimeout(200);
    const v = await page.textContent('#view'); ok(lang === 'en' ? /1 cash count did not match/.test(v) : /عدّ نقد غير مطابق/.test(v), lang + ' Staff screen warns about the mismatch');
    ok(!errs.length, lang + ' no page errors', errs);
    await ctx.close();
  }
  console.log(fails ? `${fails} FAILED` : 'PASS all cash count checks'); await b.close(); process.exit(fails ? 1 : 0);
})();
