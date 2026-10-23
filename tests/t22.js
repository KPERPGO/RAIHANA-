// Dose calculator: owner adds a rule with its source, only an approved rule is used, results and warnings, Arabic. Uses a made-up drug and source, never real dosing.
const { chromium } = require('./pw');
(async () => {
  const b = await chromium.launch(); let fails = 0; const ok = (c, name, got) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + name + (c ? '' : '  :: ' + JSON.stringify(got))); if (!c) fails++; };
  for (const lang of ['en', 'ar']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 800 } }), page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await ctx.addInitScript(l => { try { if (!sessionStorage.s) { sessionStorage.s = 1; localStorage.setItem('rp.lang', l); } } catch (e) {} }, JSON.stringify(lang));
    await page.goto('http://localhost:8765/index.html'); await page.waitForTimeout(1200);
    await page.click('nav.tabs [data-tab="staff"]'); await page.click('[data-xstaff="__new"]'); await page.fill('#fName', 'Owner'); await page.fill('#fPin', '1234'); await page.click('#staffForm button[type=submit]'); await page.waitForTimeout(700);
    await page.evaluate(() => { S.tab = 'dose'; render(); }); await page.waitForTimeout(300);
    ok(await page.isVisible('[data-xdedit="__new"]') && !(await page.isVisible('#dsRule')), lang + ' no approved rule yet, owner can add one');
    await page.click('[data-xdedit="__new"]'); await page.waitForTimeout(200);
    await page.fill('#dr_drug', 'Testdrug'); await page.fill('#dr_group', 'Child');
    await page.click('#doseForm button[type=submit]'); ok(await page.evaluate(() => E.doserules.length === 0), lang + ' a rule with no source or dose is not saved');
    await page.fill('#dr_kgMin', '5'); await page.fill('#dr_kgMax', '30'); await page.fill('#dr_doseMin', '10'); await page.fill('#dr_doseMax', '15'); await page.fill('#dr_dosesPerDay', '3'); await page.fill('#dr_maxDayKg', '75'); await page.fill('#dr_mgPer5ml', '120');
    await page.fill('#dr_srcName', 'Test source'); await page.fill('#dr_srcRef', 'Test label'); await page.fill('#dr_srcDate', '2024-01');
    await page.click('#doseForm button[type=submit]'); await page.waitForTimeout(500);
    ok(await page.evaluate(() => E.doserules.length === 1 && E.doserules[0].status === 'draft'), lang + ' rule saved as a draft');
    ok(!(await page.isVisible('#dsRule')), lang + ' a draft is not offered in the calculator');
    await page.click('[data-xdedit]:not([data-xdedit="__new"])'); await page.waitForTimeout(200); await page.click('[data-xdappr]'); await page.waitForTimeout(300);
    await page.evaluate(() => { const el = document.getElementById('ownerPin'); for (const ch of '1234') el.querySelector(`[data-opin="${ch}"]`).click(); el.querySelector('[data-opinok]')?.click(); }); await page.waitForTimeout(500);
    ok(await page.evaluate(() => E.doserules[0].status === 'approved' && E.doserules[0].approvedBy), lang + ' owner approves with the PIN');
    ok(await page.isVisible('#dsRule'), lang + ' approved rule appears in the calculator');
    await page.fill('#dsY', '2'); await page.fill('#dsKg', '10'); await page.waitForTimeout(200);
    const t = await page.textContent('#doseOut');
    ok((lang === 'en' ? /100 to 150 mg/ : /100 إلى 150 mg/).test(t) && /450/.test(t), lang + ' 10 kg: 100 to 150 mg each time, at most 450 mg a day', t);
    ok((lang === 'en' ? /4\.2 to 6\.3 mL/ : /4\.2 إلى 6\.3 mL/).test(t), lang + ' liquid volume 4.2 to 6.3 mL', t);
    ok(/Test label/.test(t) && /2024-01/.test(t), lang + ' source is shown', t);
    await page.fill('#dsKg', '50'); await page.waitForTimeout(200);
    ok(/Do not use|لا تستعمل/.test(await page.textContent('#doseOut')), lang + ' weight outside the rule: refused', await page.textContent('#doseOut'));
    await page.fill('#dsKg', '10'); await page.check('#dsRenal'); await page.waitForTimeout(200);
    ok(/Check the full label|راجع النشرة/.test(await page.textContent('#doseOut')), lang + ' kidney problem with no advice in the rule: warns', await page.textContent('#doseOut'));
    await page.fill('#dsKg', ''); await page.waitForTimeout(200);
    ok(/weight|الوزن/.test(await page.textContent('#doseOut')), lang + ' no weight: asks for it');
    await page.evaluate(() => { S.tab = 'sell'; render(); }); await page.waitForTimeout(300);
    ok(await page.isVisible('[data-xdosepop="1"]'), lang + ' Sell has a Dose button');
    await page.click('[data-xdosepop="1"]'); await page.waitForTimeout(300);
    ok(await page.isVisible('#sheet #dsKg'), lang + ' Dose pops up over the Sell screen');
    await page.fill('#dsKg', '10'); await page.waitForTimeout(200);
    ok(/100 (to|إلى) 150/.test(await page.textContent('#sheet #doseOut')), lang + ' the pop-up calculates', await page.textContent('#sheet #doseOut'));
    await page.click('#sheetClose');
    ok(!errs.length, lang + ' no page errors', errs);
    await ctx.close();
  }
  await b.close(); console.log(fails ? fails + ' FAILED' : 'PASS all dose checks'); process.exit(fails ? 1 : 0);
})();
