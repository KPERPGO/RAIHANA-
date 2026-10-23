// One open shift per account: logging in on another device carries on the open shift, duplicates are voided, ending closes everything.
const { chromium } = require('./pw');
(async () => {
  const b = await chromium.launch(); let fails = 0; const ok = (c, name, got) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + name + (c ? '' : '  :: ' + JSON.stringify(got))); if (!c) fails++; };
  const ctx = await b.newContext({ viewport: { width: 390, height: 800 } }), page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:8765/index.html'); await page.waitForTimeout(1200);
  await page.click('nav.tabs [data-tab="staff"]'); await page.click('[data-xstaff="__new"]'); await page.fill('#fName', 'Owner'); await page.fill('#fPin', '1234'); await page.click('#staffForm button[type=submit]'); await page.waitForTimeout(700);
  const open = () => page.evaluate(() => E.shifts.filter(x => x.staffId === E.staff[0].id && !x.end && !x.voided).length);
  ok(await open() === 1, 'first sign-in: one open shift');
  await page.evaluate(async () => { const st = E.staff[0], n = Date.now(); await write('shifts/T-B', {id:'T-B', staffId:st.id, staffName:st.name, start:new Date(n - 36e5).toISOString(), end:null, device:'OTHER'}); });
  ok(await open() === 2, 'a second device left another shift open');
  await page.evaluate(async () => { await endShift(false); }); await page.waitForTimeout(500);
  ok(await open() === 0, 'ending the shift closes every open shift of that person', await open());
  await page.evaluate(async () => { const st = E.staff[0], n = Date.now();
    await write('shifts/T-C', {id:'T-C', staffId:st.id, staffName:st.name, start:new Date(n - 2 * 36e5).toISOString(), end:null, device:'D1'});
    await write('shifts/T-D', {id:'T-D', staffId:st.id, staffName:st.name, start:new Date(n - 36e5).toISOString(), end:null, device:'D2'});
    S.lockSel = st.id; S.lockPin = '1234'; await tryLogin(); });
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => ({open: E.shifts.filter(x => !x.end && !x.voided).map(x => x.id), sess: S.session.shiftId, dup: E.shifts.find(x => x.id === 'T-D').voided}));
  ok(r.open.length === 1 && r.open[0] === 'T-C' && r.sess === 'T-C' && r.dup, 'signing in carries on the earliest open shift and voids the duplicate', r);
  ok(!errs.length, 'no page errors', errs);
  await b.close(); console.log(fails ? fails + ' FAILED' : 'PASS all one-shift checks'); process.exit(fails ? 1 : 0);
})();
