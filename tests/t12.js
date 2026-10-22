const ROOT = require('path').resolve(__dirname, '..'); // repo folder: src, dist, tests
// pop-ups: centred, and they do not move when content changes inside
const { chromium } = require('./pw');
const fs = require('fs'); const D = require('path').join(__dirname, 'fixtures');
(async () => {
  const b = await chromium.launch();
  for (const [w,h] of [[390,760],[1280,720]]) {
  const page = await b.newPage({ viewport: { width: w, height: h } }); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:8765/index.html'); await page.waitForTimeout(800);
  await page.evaluate(async inv => { await ERP_LOCAL.put('invoices/' + inv.id, inv); }, JSON.parse(fs.readFileSync(D + '/invoices/PI-2026-0001.json'))); await page.waitForTimeout(400);
  const box = () => page.evaluate(() => { const r = document.querySelector('#sheet .panel').getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), Math.round(innerHeight - r.bottom), Math.round(r.left)]; });
  // chronic card: open, pick medicines from the list (re-draws inside)
  await page.click('nav.tabs [data-tab="chronic"]'); await page.waitForTimeout(200);
  await page.click('[data-xchr="__new"]'); await page.waitForTimeout(400); const b0 = await box();
  await page.fill('#cAddQ', 'a'); await page.dispatchEvent('#cAddQ', 'input'); await page.waitForTimeout(300); const b1 = await box();
  const pick = await page.$('[data-xcpick]'); if (pick) { await pick.click(); await page.waitForTimeout(300); } const b2 = await box();
  // stock item card: save re-opens the same sheet
  await page.click('#sheetClose'); await page.click('nav.tabs [data-tab="stock"]'); await page.waitForTimeout(200);
  await page.click('[data-xprod]:not([data-xprod="__new"])'); await page.waitForTimeout(400); await page.evaluate(() => document.querySelector('#sheet .panel').scrollTop = 200); const b3 = await box();
  await page.fill('#pSellBox', '9000'); await page.click('#prodForm button[type=submit]'); await page.waitForTimeout(500);
  const b4 = await box(), st = await page.evaluate(() => [document.querySelector('#sheet .panel').scrollTop, document.getElementById('sheet').classList.contains('stay'), getComputedStyle(document.querySelector('#sheet .panel')).animationName]);
  console.log(w, 'chronic', b0, b1, b2, '| item', b3, b4, st, errs.length ? errs : 'no errors');
  await page.screenshot({path:`sheet-${w}.png`}); await page.close(); }
  await b.close();
})();
