const ROOT = require('path').resolve(__dirname, '..'); // repo folder: src, dist, tests
const { chromium, devices } = require('./pw');
const fs = require('fs'), path = require('path'); const D = require('path').join(__dirname, 'fixtures'); const rd = p => JSON.parse(fs.readFileSync(path.join(D, p)));
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 13'] }); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:8765/frame-test.html'); await page.waitForTimeout(1500);
  const fr = page.frame({url: /index.html/});
  await fr.evaluate(async ([inv, sup, pay]) => { await ERP_LOCAL.put('invoices/' + inv.id, inv); await ERP_LOCAL.put('suppliers/' + sup.id, sup); await ERP_LOCAL.put('payments/' + pay.id, pay); }, [rd('invoices/PI-2026-0001.json'), rd('suppliers/SUP-001.json'), rd('payments/PAY-MVHWUD41.json')]);
  await page.waitForTimeout(500);
  const vh = page.viewportSize().height;
  for (const tab of ['home','sell','stock','pricing','chronic','invoices','items','payments','suppliers','customers','money','reports','staff','settings']){
    await fr.evaluate(t => { S.tab = t; render(); }, tab); await page.waitForTimeout(250);
    await page.mouse.move(200, 400); await page.mouse.wheel(0, 4000); await page.waitForTimeout(250);
    const r = await fr.evaluate(() => { const n = document.querySelector('nav.tabs').getBoundingClientRect(), h = document.querySelector('header.top').getBoundingClientRect(); return [Math.round(h.top), Math.round(n.top), Math.round(n.bottom), innerHeight, document.documentElement.scrollHeight, scrollY]; });
    console.log(tab.padEnd(10), r.join(' '), r[2] <= vh && r[0] >= 0 ? 'OK' : 'HIDDEN');
  }
  await fr.evaluate(() => { S.tab = 'sell'; render(); }); await page.waitForTimeout(200); await page.screenshot({path:'f1.png'});
  await fr.click('.navmenu'); await page.waitForTimeout(300); await page.screenshot({path:'f2.png'});
  console.log(errs.join('\n') || 'no errors'); await b.close();
})();
