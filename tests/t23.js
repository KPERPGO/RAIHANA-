// FDA label alerts in the dose calculator, against a local fake of the openFDA service (made-up drug and text, never real dosing).
const http = require('http');
const { chromium } = require('./pw');
const LABEL = { set_id: 'abc-123', effective_time: '20240101', openfda: { generic_name: ['TESTDRUG'], brand_name: ['Testbrand'] }, dosage_and_administration: ['Test dosing text.'],
  boxed_warning: ['WARNING: test boxed text about liver.'], contraindications: ['Do not use in test allergy.'], pregnancy: ['Test pregnancy text.'], pediatric_use: ['Test children text.'], geriatric_use: ['Test elderly text.'], warnings: ['Test warnings text.'] };
(async () => {
  let hits = 0;
  const srv = http.createServer((req, res) => { res.setHeader('Access-Control-Allow-Origin', '*'); hits++;
    if (/TESTDRUG/i.test(decodeURIComponent(req.url))) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ results: [LABEL] })); }
    else { res.statusCode = 404; res.end('{"error":{"code":"NOT_FOUND"}}'); } }).listen(8766);
  const b = await chromium.launch(); let fails = 0; const ok = (c, name, got) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + name + (c ? '' : '  :: ' + JSON.stringify(got))); if (!c) fails++; };
  const ctx = await b.newContext({ viewport: { width: 390, height: 800 } }), page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await ctx.addInitScript(() => { window.ERP_FDA = 'http://localhost:8766'; });
  await page.goto('http://localhost:8765/index.html'); await page.waitForTimeout(1200);
  await page.click('nav.tabs [data-tab="staff"]'); await page.click('[data-xstaff="__new"]'); await page.fill('#fName', 'Owner'); await page.fill('#fPin', '1234'); await page.click('#staffForm button[type=submit]'); await page.waitForTimeout(700);
  await page.evaluate(async () => { const base = { class: 'Antibiotic', basis: 'perkg', doseMin: 10, doseMax: 15, dosesPerDay: 3, srcName: 'Test source', srcRef: 'Test label', srcDate: '2024-01', status: 'approved', approvedBy: 'x', deleted: false };
    await write('doserules/DR1', { ...base, id: 'DR1', drug: 'Testdrug', group: 'Child' }); await write('doserules/DR2', { ...base, id: 'DR2', drug: 'Nolabel', group: 'Adult' }); S.tab = 'dose'; render(); });
  await page.waitForTimeout(1200);
  await page.selectOption('#dsRule', 'DR1'); await page.fill('#dsKg', '10'); await page.fill('#dsY', '2'); await page.waitForTimeout(1200);
  let t = await page.textContent('#doseLabel');
  ok(/Boxed warning/.test(t) && /test boxed text/.test(t), 'boxed warning shown as an alert', t);
  ok(/test allergy/.test(t), 'contraindications shown', t);
  ok(/Dosing in the FDA label/.test(t) && /Test dosing text/.test(t), 'FDA dosing section shown from the label', t);
  ok(/Test children text/.test(t) && !/Test elderly text/.test(t), 'child section for a 2 year old, no elderly section', t);
  ok(!/Test pregnancy text/.test(t), 'pregnancy section hidden until ticked');
  await page.check('#dsPreg'); await page.waitForTimeout(200);
  ok(/Test pregnancy text/.test(await page.textContent('#doseLabel')), 'pregnancy section appears when ticked');
  await page.fill('#dsY', '70'); await page.waitForTimeout(200);
  ok(/Test elderly text/.test(await page.textContent('#doseLabel')), 'elderly section for a 70 year old');
  const href = await page.getAttribute('#doseLabel a', 'href');
  ok(/dailymed\.nlm\.nih\.gov.*abc-123/.test(href || ''), 'Open the source links to DailyMed', href);
  ok(/uptodate\.com.*testdrug/i.test(await page.getAttribute('#doseLabel a[href*="uptodate"]', 'href')), 'UpToDate search link');
  ok(await page.evaluate(() => !!lsGet('erp.labels', {}).testdrug?.found), 'label saved for offline');
  await ctx.setOffline(true); await page.selectOption('#dsRule', 'DR2'); await page.selectOption('#dsRule', 'DR1'); await page.waitForTimeout(500);
  t = await page.textContent('#doseLabel');
  ok(/test boxed text/.test(t) && /Offline/.test(t), 'offline: saved label still shows with an offline note', t);
  await ctx.setOffline(false);
  await page.selectOption('#dsRule', 'DR2'); await page.waitForTimeout(1500);
  ok(/No FDA label was found/.test(await page.textContent('#doseLabel')), 'unknown medicine: says no label was found', await page.textContent('#doseLabel'));
  await page.evaluate(() => { S.lang = 'ar'; render(); }); await page.waitForTimeout(600);
  await page.evaluate(() => { S.dose.rid = 'DR1'; render(); }); await page.waitForTimeout(800);
  ok(/تحذير الإطار الأسود/.test(await page.textContent('#doseLabel')) && /افتح المصدر/.test(await page.textContent('#doseLabel')), 'Arabic labels', await page.textContent('#doseLabel'));
  ok(errs.length === 0, 'no page errors', errs);
  await b.close(); srv.close(); console.log(fails ? 'FAILED ' + fails : 'PASS all'); process.exit(fails ? 1 : 0);
})();
