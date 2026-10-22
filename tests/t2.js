const ROOT = require('path').resolve(__dirname, '..'); // repo folder: src, dist, tests
const { chromium } = require('./pw');
const fs = require('fs'), path = require('path'); const D = require('path').join(__dirname, 'fixtures'); const rd = p => JSON.parse(fs.readFileSync(path.join(D, p)));
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 400, height: 860 }, hasTouch: true, isMobile: true });
  const errs = []; page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  await page.route('**/xlsx.full.min.js', r => r.fulfill({path:require('./pw').XLSX_FILE}).catch(()=>r.abort()));
  await page.goto('http://localhost:8765/index.html'); await page.waitForTimeout(1200);
  await page.evaluate(async ([inv, sup, pay]) => { await ERP_LOCAL.put('invoices/' + inv.id, inv); await ERP_LOCAL.put('suppliers/' + sup.id, sup); await ERP_LOCAL.put('payments/' + pay.id, pay); }, [rd('invoices/PI-2026-0001.json'), rd('suppliers/SUP-001.json'), rd('payments/PAY-MVHWUD41.json')]);
  await page.waitForTimeout(400); console.log('XLSX', await page.evaluate(() => !!window.XLSX));
  await page.click('nav.tabs [data-tab="pricing"]'); await page.waitForTimeout(300);
  await page.fill('#prPct', '25'); await page.click('[data-xprapply="all"]'); await page.waitForTimeout(300);
  await page.screenshot({ path: 'p1.png' }); await page.screenshot({ path: 'p1full.png', fullPage: true });
  await page.click('[data-xprsave="1"]'); await page.waitForTimeout(800);
  console.log('priced', await page.evaluate(() => catalog().filter(p => p.sellBox).length));
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-ximp="1"]')]); await fc.setFiles('prices.csv'); await page.waitForTimeout(600);
  await page.screenshot({ path: 'p2.png', fullPage: true });
  await page.click('[data-ximsave="1"]'); await page.waitForTimeout(800);
  console.log(await page.evaluate(() => catalog().filter(p => /Apidra|Clexane|NovoMix/.test(p.name)).map(p => p.name + ' ' + p.strength?.slice(0,12) + ' ' + p.sellBox + ' ' + p.barcode)));
  console.log(errs.join('\n') || 'no errors'); await b.close();
})();
