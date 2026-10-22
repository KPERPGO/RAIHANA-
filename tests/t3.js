const ROOT = require('path').resolve(__dirname, '..'); // repo folder: src, dist, tests
const { chromium } = require('./pw');
const fs = require('fs'), path = require('path'); const D = require('path').join(__dirname, 'fixtures'); const rd = p => JSON.parse(fs.readFileSync(path.join(D, p)));
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  const errs = []; page.on('pageerror', e => errs.push('PAGEERR ' + e.stack));
  await page.route('**/xlsx.full.min.js', r => r.fulfill({path: require('./pw').XLSX_FILE}));
  await page.goto('http://localhost:8765/index.html'); await page.waitForTimeout(1200);
  await page.evaluate(async ([inv, sup, pay]) => { await ERP_LOCAL.put('invoices/' + inv.id, inv); await ERP_LOCAL.put('suppliers/' + sup.id, sup); await ERP_LOCAL.put('payments/' + pay.id, pay); }, [rd('invoices/PI-2026-0001.json'), rd('suppliers/SUP-001.json'), rd('payments/PAY-MVHWUD41.json')]);
  await page.waitForTimeout(400);
  // nav stays visible after scrolling long home
  await page.mouse.wheel(0, 3000); await page.waitForTimeout(300);
  const navBox = async () => page.evaluate(() => { const r = document.querySelector('nav.tabs').getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), innerHeight, document.documentElement.scrollHeight]; });
  console.log('nav after scroll', await navBox()); await page.screenshot({ path: 's0-scrolled.png' });
  // owner setup
  await page.click('nav.tabs [data-tab="staff"]'); await page.waitForTimeout(300); console.log('btn', await page.evaluate(() => { let n=0; const o=window.render; window.render=render=function(){n++;return o.apply(this,arguments)}; return new Promise(r=>setTimeout(()=>r([n, document.querySelectorAll('[data-xstaff]').length, document.querySelector('[data-xstaff]')?.outerHTML.slice(0,120)]),1000)); }));
  await page.click('[data-xstaff="__new"]'); await page.fill('#fName', 'Owner'); await page.fill('#fPin', '1234'); await page.selectOption('#fPay', 'monthly'); await page.fill('#fRate', '1000000'); await page.click('#staffForm button[type=submit]'); await page.waitForTimeout(800); await page.screenshot({path:'s0b.png'}); console.log('after owner', await page.evaluate(() => [S.staff?.name, E.staff.length, E.shifts.length, !!document.getElementById('lockScreen'), document.querySelector('#fErr')?.textContent]));
  await page.click('[data-xstaff="__new"]'); await page.fill('#fName', 'Ahmed'); await page.fill('#fPin', '5555'); await page.fill('#fRate', '5000'); await page.click('#staffForm button[type=submit]'); await page.waitForTimeout(800);
  await page.screenshot({ path: 's1-staff.png' });
  await page.click('[data-xendshift="1"]'); await page.click('[data-xendshift="1"]'); await page.waitForTimeout(600);
  await page.screenshot({ path: 's2-lock.png' });
  await page.locator('[data-xlocksel]').filter({hasText:'Ahmed'}).click(); await page.waitForTimeout(200);
  for (const k of '5554') await page.click(`[data-xpin="${k}"]`); await page.click('[data-xpinok="1"]'); await page.waitForTimeout(500);
  console.log('wrong pin err', await page.evaluate(() => document.querySelector('#lockErr')?.textContent));
  for (const k of '5555') await page.click(`[data-xpin="${k}"]`); await page.click('[data-xpinok="1"]'); await page.waitForTimeout(800);
  await page.screenshot({ path: 's3-pharm.png' });
  console.log('visible tabs', await page.evaluate(() => [...document.querySelectorAll('nav.tabs [data-tab]')].filter(b => !b.hidden).map(b => b.dataset.tab).join(',')));
  // sell as Ahmed
  await page.click('nav.tabs [data-tab="sell"]'); await page.waitForTimeout(300);
  const st = await page.evaluate(() => catalog().find(p => /Sterogyl/.test(p.name)).id);
  // the item needs a set price: staff selling an item with no price need the owner's PIN (audit P-01)
  await page.evaluate(async id => { await write('products/' + id, {...(E.prods.find(m => m.id === id) || {}), id, sellBox:7500}); }, st); await page.waitForTimeout(200);
  await page.fill('#sellQ', 'stero'); await page.waitForTimeout(200); await page.click(`[data-xadd="${st}"]`); await page.fill('[data-xp="0"]', '7500'); await page.dispatchEvent('[data-xp="0"]', 'change'); await page.waitForTimeout(200);
  await page.click('#sellForm button[type=submit]'); await page.waitForTimeout(700); await page.screenshot({ path: 's4-receipt.png' }); await page.click('#sheetClose');
  await page.mouse.wheel(0, 3000); await page.waitForTimeout(300); console.log('nav sell scrolled', await navBox()); await page.screenshot({ path: 's5-sell.png' });
  console.log('sale staff', await page.evaluate(() => E.sales.map(s => s.staffName + ' ' + hm(s.at))));
  await page.click('[data-xlock="1"]'); await page.waitForTimeout(300);
  await page.locator('[data-xlocksel]').filter({hasText:'Owner'}).click(); for (const k of '1234') await page.click(`[data-xpin="${k}"]`); await page.click('[data-xpinok="1"]'); await page.waitForTimeout(700);
  await page.click('nav.tabs [data-tab="staff"]'); await page.waitForTimeout(300); await page.screenshot({ path: 's6-staff.png' });
  await page.locator('[data-xstaff]').filter({hasText:'Ahmed'}).click(); await page.waitForTimeout(300); await page.screenshot({ path: 's7-ahmed.png', fullPage: true });
  const vis = () => page.evaluate(() => [...document.querySelectorAll('nav.tabs [data-tab]')].filter(b => !b.hidden).map(b => b.dataset.tab).join(',') + ' addBtn:' + (getComputedStyle(document.getElementById('addBtn')).display !== 'none') + ' tab:' + S.tab);
  await page.evaluate(() => { document.querySelector('[data-fperm="newinv"]').checked = false; document.querySelector('[data-fperm="stock"]').checked = true; });
  await page.click('#staffForm button[type=submit]'); await page.waitForTimeout(600);
  console.log('ahmed perms', await page.evaluate(() => E.staff.find(x => x.name === 'Ahmed').perms));
  await page.click('[data-xlock="1"]'); await page.waitForTimeout(300);
  await page.locator('[data-xlocksel]').filter({hasText:'Ahmed'}).click(); for (const k of '5555') await page.click(`[data-xpin="${k}"]`); await page.click('[data-xpinok="1"]'); await page.waitForTimeout(800);
  console.log('ahmed now', await vis());
  await page.evaluate(() => { S.tab = 'money'; render(); }); await page.waitForTimeout(200); console.log('forced money ->', await page.evaluate(() => S.tab));
  await page.click('.navmenu'); await page.waitForTimeout(300); console.log('menu hides list', await page.evaluate(() => document.body.classList.contains('navshut'))); await page.click('.navmenu'); await page.screenshot({path:'s8-ahmed-menu.png'});

  console.log(errs.join('\n') || 'no errors'); await b.close();
})();
