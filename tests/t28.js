// Automatic dose lines from the FDA label (fake local FDA service, made-up medicines and text, never real dosing).
const http = require('http');
const { chromium } = require('./pw');
const mk = (name, pharm, dosing) => ({ set_id: 'set-' + name, effective_time: '20240101', openfda: { generic_name: [name.toUpperCase()], brand_name: ['Brand' + name], pharm_class_epc: [pharm] }, dosage_and_administration: [dosing], contraindications: ['Test contra.'] });
const LABELS = { amoxtest: mk('amoxtest', 'Penicillin-class Antibacterial [EPC]', 'Adults: 500 mg every 8 hours. Children: 25 to 45 mg/kg/day in divided doses every 12 hours. Infants: 10 mg/kg every 6 hours.'),
  paintest: mk('paintest', 'Nonsteroidal Anti-inflammatory Drug [EPC]', 'Children: 10 mg/kg every 6 hours.'), nodose: mk('nodose', 'Azole Antifungal [EPC]', 'Adults: 200 mg once daily.') };
(async () => {
  const srv = http.createServer((req, res) => { res.setHeader('Access-Control-Allow-Origin', '*'); const q = decodeURIComponent(req.url).toLowerCase(); const k = Object.keys(LABELS).find(n => q.includes('"' + n + '"'));
    if (k) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ results: [LABELS[k]] })); } else { res.statusCode = 404; res.end('{}'); } }).listen(8767);
  const b = await chromium.launch(); let fails = 0; const ok = (c, name, got) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + name + (c ? '' : '  :: ' + JSON.stringify(got))); if (!c) fails++; };
  for (const lang of ['en', 'ar']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 800 } }), page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await ctx.addInitScript(l => { window.ERP_FDA = 'http://localhost:8767'; try { if (!sessionStorage.s) { sessionStorage.s = 1; localStorage.setItem('rp.lang', l); } } catch (e) {} }, JSON.stringify(lang));
    await page.goto('http://localhost:8765/index.html'); await page.waitForTimeout(1200);
    await page.click('nav.tabs [data-tab="staff"]'); await page.click('[data-xstaff="__new"]'); await page.fill('#fName', 'Owner'); await page.fill('#fPin', '1234'); await page.click('#staffForm button[type=submit]'); await page.waitForTimeout(700);
    await page.evaluate(() => { S.tab = 'dose'; render(); }); await page.waitForTimeout(300);
    await page.fill('#dsKg', '10'); await page.fill('#dsFda', 'AmoxTest'); await page.click('[data-xfdago="1"]'); await page.waitForTimeout(1200);
    const lines = await page.$$('#doseAuto [data-xdline]'); ok(lines.length === 2, lang + ' two mg per kg lines found (the adult line is ignored)', lines.length);
    let t = await page.textContent('#autoRes');
    ok(/250 (to|إلى) 450/.test(t) && /125 (to|إلى) 225/.test(t), lang + ' 10 kg: 250 to 450 mg a day, 125 to 225 each time (every 12 hours)', t);
    await page.click('[data-xdline="1"]'); await page.waitForTimeout(300); t = await page.textContent('#autoRes');
    ok(/100 mg/.test(t) && /400 mg/.test(t), lang + ' second line: 100 mg each time, 400 mg a day', t);
    await page.fill('#dsKg', '20'); await page.waitForTimeout(300); ok(/200 mg/.test(await page.textContent('#autoRes')), lang + ' weight change recalculates');
    ok(/Test contra/.test(await page.textContent('#doseAuto')) && await page.locator('#doseAuto a[href*="dailymed"]').count() > 0, lang + ' label alerts and source link shown too');
    await page.fill('#dsFda', 'PainTest'); await page.click('[data-xfdago="1"]'); await page.waitForTimeout(1200);
    ok(await page.locator('#doseAuto [data-xdline]').count() === 0 && /does not use|لا تستعمله/.test(await page.textContent('#doseAuto')), lang + ' a non-antimicrobial is refused', await page.textContent('#doseAuto'));
    await page.fill('#dsFda', 'NoDose'); await page.click('[data-xfdago="1"]'); await page.waitForTimeout(1200);
    ok(/no dose in mg per kg|لا تذكر جرعة/.test(await page.textContent('#doseAuto')), lang + ' label with no mg per kg says so');
    await page.fill('#dsFda', 'Zzzz'); await page.click('[data-xfdago="1"]'); await page.waitForTimeout(1200);
    ok(/No FDA label was found|لم تُوجد/.test(await page.textContent('#doseAuto')), lang + ' unknown medicine: no label found');
    await ctx.setOffline(true); await page.fill('#dsFda', 'AmoxTest'); await page.click('[data-xfdago="1"]'); await page.waitForTimeout(600);
    ok(await page.locator('#doseAuto [data-xdline]').count() === 2, lang + ' offline: saved label still gives the doses');
    await ctx.setOffline(false);
    ok(!errs.length, lang + ' no page errors', errs);
    await ctx.close();
  }
  await b.close(); srv.close(); console.log(fails ? fails + ' FAILED' : 'PASS all automatic dose checks'); process.exit(fails ? 1 : 0);
})();
