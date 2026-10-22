const ROOT = require('path').resolve(__dirname, '..'); // repo folder: src, dist, tests
const { chromium } = require('./pw');
const fs = require('fs'); const path = require('path');
const D = require('path').join(__dirname, 'fixtures');
const rd = p => JSON.parse(fs.readFileSync(path.join(D, p)));
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 400, height: 860 }, hasTouch: true, isMobile: true });
  const errs = []; page.on('pageerror', e => errs.push('PAGEERR ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  await page.goto('http://localhost:8765/index.html'); await page.waitForTimeout(1500);
  console.log('mode', await page.evaluate(() => window.ERP_MODE));
  await page.evaluate(async ([inv, sup, pay]) => { await ERP_LOCAL.put('invoices/' + inv.id, inv); await ERP_LOCAL.put('suppliers/' + sup.id, sup); await ERP_LOCAL.put('payments/' + pay.id, pay); }, [rd('invoices/PI-2026-0001.json'), rd('suppliers/SUP-001.json'), rd('payments/PAY-MVHWUD41.json')]);
  await page.waitForTimeout(500);
  const shot = async n => page.screenshot({ path: n + '.png', fullPage: false });
  const tab = async t => { await page.click(`nav.tabs [data-tab="${t}"]`); await page.waitForTimeout(400); };
  await shot('01-home');
  await tab('stock'); await shot('02-stock');
  // set price on Sterogyl
  const ids = await page.evaluate(() => catalog().map(p => [p.id, p.name, p.sub]));
  console.log(ids.length, 'products'); const st = ids.find(x => /Sterogyl/.test(x[1])); const hp = ids.find(x => /Hema/.test(x[1]));
  await page.click(`[data-xprod="${st[0]}"]`); await page.waitForTimeout(300);
  await page.fill('#pSellBox', '7500'); await page.fill('#pBar', '6281234567890'); await page.click('#prodForm button[type=submit]'); await page.waitForTimeout(500);
  await shot('03-product');
  await page.click('#sheetClose');
  await page.click(`[data-xprod="${hp[0]}"]`); await page.waitForTimeout(300);
  console.log('hema default levels', await page.evaluate(id => levelText(catalog().find(x => x.id === id)), hp[0]));
  await page.selectOption('#pMidName', 'strip'); await page.fill('#pMidCount', '3'); await page.selectOption('#pSubName', 'tablet'); await page.fill('#pSubCount', '10'); await page.fill('#pSellMid', '14000'); await page.fill('#pSellBox', '40000'); await page.fill('#pMin', '2'); await page.click('#prodForm button[type=submit]'); await page.waitForTimeout(500);
  await page.click('#sheetClose');
  // sell
  await tab('sell'); await page.fill('#sellQ', '6281234567890'); await page.press('#sellQ', 'Enter'); await page.waitForTimeout(300);
  await page.fill('#sellQ', 'hema'); await page.waitForTimeout(300); await page.click(`[data-xadd="${hp[0]}"]`); await page.waitForTimeout(300);
  await page.selectOption('[data-xmode="1"]', 'mid'); await page.waitForTimeout(300);
  await page.fill('[data-xq="0"]', '2'); await page.dispatchEvent('[data-xq="0"]', 'change'); await page.waitForTimeout(300);
  await shot('04-cart');
  await page.click('#sellForm button[type=submit]'); await page.waitForTimeout(700); await shot('05-receipt');
  await page.click('#sheetClose');
  // debt sale new customer
  await page.fill('#sellQ', 'hema'); await page.waitForTimeout(200); await page.click(`[data-xadd="${hp[0]}"]`); await page.waitForTimeout(200);
  await page.selectOption('#xMethod', 'debt'); await page.waitForTimeout(200); await page.selectOption('#xCust', '__new'); await page.waitForTimeout(200);
  await page.selectOption('[data-xmode="0"]', 'mid'); await page.waitForTimeout(200); await page.fill('#xCName', 'Test Customer'); await page.click('#sellForm button[type=submit]'); await page.waitForTimeout(700); console.log('xErr', await page.evaluate(() => document.querySelector('#xErr')?.textContent)); if (await page.isVisible('#sheetClose')) await page.click('#sheetClose');
  await page.click('[data-xnewtab="1"]'); await page.waitForTimeout(200); await page.click(`.quick [data-xadd="${st[0]}"]`); await page.waitForTimeout(200);
  await page.click('[data-xnewtab="1"]'); await page.waitForTimeout(200); await page.click(`.quick [data-xadd="${st[0]}"]`); await page.click('[data-xstep="0"][data-d="1"]'); await page.waitForTimeout(200);
  console.log('tabs', await page.evaluate(() => S.tabs.map(t => t.n + ':' + t.lines.map(l => l.qty).join(','))));
  await page.click('[data-xtab="0"]'); await page.waitForTimeout(200); await shot('05b-tabs'); await page.screenshot({ path: '05c-sell-full.png', fullPage: true });
  // chronic
  await tab('chronic'); await page.click('[data-xchr="__new"]'); await page.waitForTimeout(300);
  await page.fill('#cName', 'Abu Ali'); await page.fill('#cDay', String(new Date().getDate() + 2 > 28 ? 1 : new Date().getDate() + 2));
  await page.fill('#cAddQ', 'Hema'); await page.waitForTimeout(200); await shot('06a-picker'); await page.click(`[data-xcpick="${hp[0]}"]`); await page.fill('[data-xcq="0"]', '3');
  await page.fill('#cAddQ', ''); await page.type('#cAddQ', 'novo'); await page.waitForTimeout(200); await page.locator('[data-xcpick]').filter({hasText:/Novo ?Mix/}).click(); await page.fill('[data-xcq="1"]', '2');
  await page.click('#chrForm button[type=submit]'); await page.waitForTimeout(600); await shot('06-chronic-card'); await page.click('#sheetClose'); await page.waitForTimeout(300);
  await shot('07-chronic'); await page.screenshot({ path: '07b-chronic-full.png', fullPage: true });
  // stocktaking
  await tab('stock'); await page.click('[data-xcount="1"]'); await page.waitForTimeout(300);
  await page.fill(`[data-ctb="${st[0]}"]`, '10'); await page.waitForTimeout(100); await shot('08-count');
  await page.click('[data-xctsave="1"]'); await page.waitForTimeout(800);
  console.log('after count Sterogyl', await page.evaluate(id => { const p = catalog().find(x => x.id === id); return qtyText(p, stockOf(p, usedMap()).good); }, st[0]));
  console.log('Hema', await page.evaluate(id => { const p = catalog().find(x => x.id === id); return qtyText(p, stockOf(p, usedMap()).good); }, hp[0]));
  // money
  await tab('money'); await page.click('[data-xexp="1"]'); await page.waitForTimeout(200); await page.selectOption('#eCat', 'Generator'); await page.fill('#eAmt', '25000'); await page.click('#expForm button[type=submit]'); await page.waitForTimeout(500);
  await page.screenshot({ path: '09-money.png', fullPage: true });
  await tab('customers'); await shot('10-customers');
  await tab('home'); await page.screenshot({ path: '11-home-full.png', fullPage: true });
  await tab('invoices'); await shot('12-invoices');
  await tab('settings'); await page.screenshot({ path: '13-settings.png', fullPage: true });
  await tab('reports'); await shot('14-reports');
  // arabic
  await page.click('#langBtn'); await page.waitForTimeout(500); await tab('chronic'); await shot('15-ar-chronic'); await tab('sell'); await shot('16-ar-sell');
  // reload persistence
  await page.reload(); await page.waitForTimeout(1500);
  console.log('after reload sales', await page.evaluate(() => E.sales.length), 'chronic', await page.evaluate(() => E.chronic.length));
  console.log('dirty', await page.evaluate(() => ERP_SYNC.pending()));
  await page.setViewportSize({ width: 1280, height: 800 }); await page.evaluate(() => { S.tab = 'stock'; render(); }); await page.waitForTimeout(300); await shot('17-desktop');
  console.log(errs.join('\n') || 'no errors');
  await b.close();
})();
