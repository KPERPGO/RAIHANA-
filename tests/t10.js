// Owner's case: a pharmacist was added first and is logged in; adding an owner must switch to the owner with all screens
const { chromium } = require('./pw');
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 390, height: 800 } }); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:8765/index.html'); await page.waitForTimeout(900);
  await page.click('nav.tabs [data-tab="staff"]'); await page.click('[data-xstaff="__new"]'); await page.fill('#fName', 'Ali'); await page.selectOption('#fRole', 'pharmacist'); await page.fill('#fPin', '1111');
  await page.click('#staffForm button[type=submit]'); await page.waitForTimeout(400);
  console.log('pharmacist first blocked:', await page.evaluate(() => $('#fErr').textContent));
  // old data: pharmacist made before this fix, logged in
  await page.evaluate(async () => { const d = {id:'ST-A', name:'Ali', role:'pharmacist', active:true, pinHash:'x'}; await write('staff/ST-A', d); S.staff = d; const sh = {id:'SH-A', staffId:'ST-A', start:nowIso(), end:null}; await write('shifts/SH-A', sh); S.session = {staffId:'ST-A', shiftId:'SH-A'}; closeSheet(); render(); });
  await page.waitForTimeout(400);
  console.log('no owner -> tabs', await page.evaluate(() => [...document.querySelectorAll('nav.tabs [data-tab]')].filter(b => !b.hidden).length), 'banner', await page.evaluate(() => { S.tab = 'staff'; render(); return /no owner yet/.test(document.body.textContent); }));
  await page.click('[data-xstaff="__new"]'); await page.waitForTimeout(200); console.log('new form role', await page.$eval('#fRole', x => x.value));
  await page.fill('#fName', 'Owner'); await page.fill('#fPin', '2468'); await page.click('#staffForm button[type=submit]'); await page.waitForTimeout(700);
  console.log('after owner', await page.evaluate(() => [S.staff.name, S.staff.role, [...document.querySelectorAll('nav.tabs [data-tab]')].filter(b => !b.hidden).length, !!E.shifts.find(x => x.id === 'SH-A').end]));
  // choose account: lock, list shows both, pick Ali -> Ali sees only Sell
  await page.click('[data-xlock="1"]'); await page.waitForTimeout(300);
  console.log('accounts on lock screen', await page.$$eval('[data-xlocksel]', x => x.map(b => b.textContent.trim()).join(' | ')));
  console.log(errs.length ? errs : 'no errors'); await b.close();
})();
