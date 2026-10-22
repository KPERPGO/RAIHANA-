// Forgotten shifts: hours never pass 24 a day, an open old shift counts only 14 hours, the owner closes them in one place and hours are recounted.
const { chromium } = require('./pw');
(async () => {
  const b = await chromium.launch(); let fails = 0; const ok = (c, name, got) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + name + (c ? '' : '  :: ' + JSON.stringify(got))); if (!c) fails++; };
  for (const lang of ['en', 'ar']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 800 } }), page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await ctx.addInitScript(l => { try { if (!sessionStorage.s) { sessionStorage.s = 1; localStorage.setItem('rp.lang', l); } } catch (e) {} }, JSON.stringify(lang));
    await page.goto('http://localhost:8765/index.html'); await page.waitForTimeout(1200);
    await page.click('nav.tabs [data-tab="staff"]'); await page.click('[data-xstaff="__new"]'); await page.fill('#fName', 'Owner'); await page.fill('#fPin', '1234'); await page.click('#staffForm button[type=submit]'); await page.waitForTimeout(700);
    // the same person has two shifts open on two devices, started 3 and 2.5 hours before the 14-hour limit passed
    const hrs = await page.evaluate(async () => { const st = E.staff[0], n = Date.now(), H = 36e5;
      await write('shifts/T-A', {id:'T-A', staffId:st.id, staffName:st.name, start:new Date(n - 40 * H).toISOString(), end:null, device:'D1'});
      await write('shifts/T-B', {id:'T-B', staffId:st.id, staffName:st.name, start:new Date(n - 39 * H).toISOString(), end:null, device:'D2'});
      const m = ym(new Date(n - 40 * H).toISOString().slice(0, 10)); return {tot: monthWork(st.id, m).hours, one: shiftHours(E.shifts.find(x => x.id === 'T-A')), m}; });
    ok(Math.abs(hrs.one - 14) < 0.01, lang + ' an old open shift counts only 14 hours', hrs);
    ok(hrs.tot > 14.9 && hrs.tot < 15.1, lang + ' overlapping shifts are counted once (about 15h, not 28h)', hrs);
    await page.evaluate(() => { S.tab = 'staff'; render(); }); await page.waitForTimeout(300);
    ok(await page.isVisible('[data-xfixlate="1"]'), lang + ' owner sees Close them now');
    if (lang === 'ar') ok(/14 ساعة/.test(await page.textContent('.banner.bad')), 'ar banner is in Arabic', await page.textContent('.banner.bad'));
    await page.click('[data-xfixlate="1"]'); await page.waitForTimeout(200);
    ok(await page.locator('[data-xfixend]').count() === 2, lang + ' sheet lists both forgotten shifts');
    await page.click('[data-xfixall="1"]'); await page.waitForTimeout(500);
    const after = await page.evaluate(() => ({open: E.shifts.filter(x => !x.end && x.id.startsWith('T-')).length, a: E.shifts.find(x => x.id === 'T-A').end, fb: E.shifts.find(x => x.id === 'T-A').fixedBy}));
    ok(after.open === 0 && after.a && after.fb, lang + ' both closed by the owner and marked as fixed', after);
    const h2 = await page.evaluate(() => monthWork(E.staff[0].id, ym(new Date(Date.now() - 40 * 36e5).toISOString().slice(0, 10))).hours);
    ok(h2 > 7.9 && h2 < 9.1, lang + ' hours recounted from the real ends (8h and 8h overlapping = 9h)', h2);
    ok(!errs.length, lang + ' no page errors', errs);
    await ctx.close();
  }
  await b.close(); console.log(fails ? fails + ' FAILED' : 'PASS all forgotten-shift checks'); process.exit(fails ? 1 : 0);
})();
