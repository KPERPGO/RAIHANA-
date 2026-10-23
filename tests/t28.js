// Dose sentences read from the FDA label (fake local FDA service, made-up medicines and text, never real dosing).
// They are only ever unapproved drafts: shown with their sentence, saved once (constant), never used to work out a dose, any medicine class.
const http = require('http');
const { chromium } = require('./pw');
const mk = (name, pharm, dosing, date) => ({ set_id: 'set-' + name, effective_time: date || '20240101', openfda: { generic_name: [name.toUpperCase()], brand_name: ['Brand' + name], pharm_class_epc: [pharm] }, dosage_and_administration: [dosing], contraindications: ['Test contra.'] });
const AMOX = 'Adults: 500 mg every 8 hours. Children: 25 to 45 mg/kg/day in divided doses every 12 hours. Infants: 10 mg/kg every 6 hours.';
const LABELS = { amoxtest: mk('amoxtest', 'Penicillin-class Antibacterial [EPC]', AMOX), paintest: mk('paintest', 'Nonsteroidal Anti-inflammatory Drug [EPC]', 'Children: 10 mg/kg every 6 hours.'), nodose: mk('nodose', 'Azole Antifungal [EPC]', 'Take as directed.') };
(async () => {
  const srv = http.createServer((req, res) => { res.setHeader('Access-Control-Allow-Origin', '*'); const q = decodeURIComponent(req.url).toLowerCase(); const k = Object.keys(LABELS).find(n => q.includes('"' + n + '"'));
    if (k) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ results: [LABELS[k]] })); } else { res.statusCode = 404; res.end('{}'); } }).listen(8767);
  const b = await chromium.launch(); let fails = 0; const ok = (c, name, got) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + name + (c ? '' : '  :: ' + JSON.stringify(got))); if (!c) fails++; };
  for (const lang of ['en', 'ar']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 800 } }), page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await ctx.addInitScript(l => { window.ERP_FDA = 'http://localhost:8767'; window.ERP_RXNAV = 'http://localhost:9/REST'; try { if (!sessionStorage.s) { sessionStorage.s = 1; localStorage.setItem('rp.lang', l); } } catch (e) {} }, JSON.stringify(lang));
    await page.goto('http://localhost:8765/index.html'); await page.waitForTimeout(1200);
    await page.click('nav.tabs [data-tab="staff"]'); await page.click('[data-xstaff="__new"]'); await page.fill('#fName', 'Owner'); await page.fill('#fPin', '1234'); await page.click('#staffForm button[type=submit]'); await page.waitForTimeout(700);
    await page.evaluate(() => { S.tab = 'dose'; render(); }); await page.waitForTimeout(300);
    // a medicine typed by hand, confirmed: the label is looked up by its ingredient
    const open = async (ing) => { await page.evaluate(() => { S.dose.med = null; render(); }); await page.fill('#dsQ', ing); await page.click('[data-xdmanual="1"]'); await page.waitForTimeout(150);
      await page.fill('#dsMIng', ing); await page.dispatchEvent('#dsMIng', 'change'); await page.waitForTimeout(1200); };
    await open('AmoxTest');
    let t = await page.textContent('#doseLabel');
    ok(await page.locator('#doseLabel [data-xdlinedraft]').count() === 3 && /not approved|غير معتمدة/.test(t), lang + ' three dose sentences listed as not approved (adult fixed dose included)', t.slice(0, 200));
    ok(!/250 (to|إلى) 450/.test(await page.textContent('main')), lang + ' no dose is worked out from label text');
    ok(await page.evaluate(() => { const r = E.doserules.find(x => x.id === 'FDA-amoxtest'); return r && r.status === 'extracted' && r.lines.length === 3 && !doseRules().includes(r); }), lang + ' the sentences are saved once as extracted, not as a rule');
    ok(/Test contra/.test(t) && await page.locator('#doseLabel a[href*="dailymed"]').count() > 0, lang + ' label alerts and source link shown too');
    await open('PainTest');
    ok(await page.locator('#doseLabel [data-xdlinedraft]').count() === 1 && /Nonsteroidal/.test(await page.textContent('#doseLabel')), lang + ' a medicine outside the old four classes is not refused');
    await open('NoDose');
    ok(/no dose sentence|لا تحتوي النشرة/.test(await page.textContent('#doseLabel')), lang + ' label with no readable dose says so', await page.textContent('#doseLabel'));
    await open('Zzzz');
    ok(/No FDA label was found|لم تُوجد/.test(await page.textContent('#doseLabel')), lang + ' unknown medicine: no label found');
    // constant: a changed FDA label does not change the saved sentences until the owner accepts it
    LABELS.amoxtest = mk('amoxtest', 'Penicillin-class Antibacterial [EPC]', 'Children: 99 mg/kg every 8 hours.', '20250101');
    await open('AmoxTest');
    ok(await page.locator('#doseLabel [data-xdlinedraft]').count() === 3 && /20240101/.test(await page.textContent('#doseLabel')), lang + ' saved sentences do not change by themselves');
    await page.click('[data-xfdacheck="amoxtest"]'); await page.waitForTimeout(1000);
    ok(await page.locator('[data-xfdanew="amoxtest"]').count() === 1 && await page.locator('#doseLabel [data-xdlinedraft]').count() === 3, lang + ' a newer label is offered, sentences still unchanged');
    await page.click('[data-xfdanew="amoxtest"]'); await page.waitForTimeout(400);
    await page.evaluate(() => { const el = document.getElementById('ownerPin'); for (const ch of '1234') el.querySelector(`[data-opin="${ch}"]`).click(); el.querySelector('[data-opinok]')?.click(); }); await page.waitForTimeout(900);
    ok(await page.locator('#doseLabel [data-xdlinedraft]').count() === 1 && /99/.test(await page.textContent('#doseLabel')), lang + ' after the owner accepts with the PIN, the new sentences are saved');
    LABELS.amoxtest = mk('amoxtest', 'Penicillin-class Antibacterial [EPC]', AMOX);
    await ctx.setOffline(true); await open('AmoxTest');
    ok(await page.locator('#doseLabel [data-xdlinedraft]').count() === 1 && /Offline|بلا اتصال/.test(await page.textContent('#doseLabel')), lang + ' offline: the saved label and sentences still show');
    await ctx.setOffline(false);
    // an old automatic rule saved as "approved" before the engine is not used for a dose
    await page.evaluate(async () => { await write('doserules/FDA-oldtest', { id: 'FDA-oldtest', auto: true, drug: 'oldtest', class: 'Antibiotic', lines: [{ text: 'x', lo: 10, hi: 10, per: 'dose', n: 2 }], status: 'approved', deleted: false }); });
    ok(await page.evaluate(() => !doseRules().some(r => r.id === 'FDA-oldtest') && localCands('oldtest').every(c => c.kind !== 'rule')), lang + ' old automatic "approved" sentences are not treated as approved rules');
    ok(!errs.length, lang + ' no page errors', errs);
    await ctx.close();
  }
  await b.close(); srv.close(); console.log(fails ? fails + ' FAILED' : 'PASS all automatic dose checks'); process.exit(fails ? 1 : 0);
})();
