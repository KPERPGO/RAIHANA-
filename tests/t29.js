// General dose engine: the calculation (pure checks) and the whole calculator flow against local stand-ins for RxNorm and openFDA.
// Every medicine, rule and number is made up (testamycin, ...). The expected numbers are plain arithmetic on those made-up rules.
const { chromium } = require('./pw');
const fake = require('./fakedrug');
(async () => {
  const F = fake.start(8768);
  const b = await chromium.launch(); let fails = 0; const ok = (c, name, got) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + name + (c ? '' : '  :: ' + JSON.stringify(got))); if (!c) fails++; };
  const ctx = await b.newContext({ viewport: { width: 390, height: 800 } }), page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await ctx.addInitScript(() => { window.ERP_FDA = 'http://localhost:8768'; window.ERP_RXNAV = 'http://localhost:8768/REST'; });
  await page.goto('http://localhost:8765/index.html'); await page.waitForTimeout(1200);
  const pin = async () => { await page.waitForSelector('#ownerPin', { timeout: 3000 }); await page.evaluate(() => { const el = document.getElementById('ownerPin'); for (const ch of '1234') el.querySelector(`[data-opin="${ch}"]`).click(); el.querySelector('[data-opinok]')?.click(); }); await page.waitForTimeout(700); };
  await page.click('nav.tabs [data-tab="staff"]'); await page.click('[data-xstaff="__new"]'); await page.fill('#fName', 'Owner'); await page.fill('#fPin', '1234'); await page.click('#staffForm button[type=submit]'); await page.waitForTimeout(700);

  /* ---- 1. the calculation itself ---- */
  const R = await page.evaluate(() => {
    const base = { status: 'approved', approvedBy: 'x', ingredients: ['testamycin'], indication: 'Test', group: 'Child', route: 'oral', basis: 'perkg', unit: 'mg', per: 'dose', doseMin: 10, doseMax: 15, dosesPerDay: 3, srcName: 's', srcRef: 'r', srcDate: '2024' };
    const med = { ings: ['testamycin'], status: 'verified', route: 'oral', form: 'Oral Suspension', strengths: [{ amt: 50, unit: 'mg', ml: 1 }] };
    const pt = (o) => ({ y: '', m: '', kg: '', cm: '', sex: '', scr: '', scrU: 'mgdl', ...o });
    const run = (r, m, p) => { const c = doseRun({ ...base, ...r }, m === undefined ? med : m, pt(p)); return { state: c.state, missing: c.missing, blocks: c.blocks, warns: c.warns, res: c.res, steps: c.steps }; };
    const tab = { ...med, form: 'Oral Tablet', strengths: [{ amt: 500, unit: 'mg', ml: null }] };
    return {
      perkg: run({}, undefined, { kg: '12.5' }),
      perday: run({ per: 'day', doseMin: 30, doseMax: 45 }, undefined, { kg: '10' }),
      single: run({ maxSingle: 150 }, undefined, { kg: '20' }),
      daykg: run({ maxDayKg: 40 }, undefined, { kg: '10' }),
      dayfix: run({ basis: 'fixed', doseMin: 500, doseMax: 500, maxDay: 1000 }, undefined, {}),
      fixed: run({ basis: 'fixed', doseMin: 100, doseMax: 100, dosesPerDay: 2 }, undefined, {}),
      m2: run({ basis: 'perm2', doseMin: 100, doseMax: 100, dosesPerDay: 1 }, undefined, { kg: '25', cm: '100' }),
      load: run({ loadMin: 20, loadMax: 20 }, undefined, { kg: '10' }),
      mlstep: run({ mlStep: 0.5 }, undefined, { kg: '12.5' }),
      halves: run({ basis: 'fixed', doseMin: 250, doseMax: 500, tabStep: 0.5 }, tab, {}),
      whole: run({ basis: 'fixed', doseMin: 250, doseMax: 400, tabStep: 1 }, tab, {}),
      nosplit: run({ basis: 'fixed', doseMin: 250, doseMax: 250 }, tab, {}),
      renal: run({ basis: 'fixed', doseMin: 500, doseMax: 500, dosesPerDay: 2, group: 'Adult', renal: [{ min: 30, max: 60, factor: 0.5 }, { max: 30, avoid: true }] }, undefined, { y: '60', kg: '70', sex: 'female', scr: '1.2' }),
      renalU: run({ basis: 'fixed', doseMin: 500, doseMax: 500, dosesPerDay: 2, renal: [{ min: 30, max: 60, factor: 0.5 }] }, undefined, { y: '60', kg: '70', sex: 'female', scr: '106.08', scrU: 'umol' }),
      renalAvoid: run({ basis: 'fixed', doseMin: 500, doseMax: 500, dosesPerDay: 2, renal: [{ max: 30, avoid: true }] }, undefined, { y: '60', kg: '70', sex: 'female', scr: '3' }),
      renalChild: run({ basis: 'fixed', doseMin: 500, doseMax: 500, dosesPerDay: 2, renal: [{ max: 30, avoid: true }] }, undefined, { y: '10', kg: '30', sex: 'male', scr: '0.5' }),
      renalMissing: run({ basis: 'fixed', doseMin: 500, doseMax: 500, renal: [{ max: 30, avoid: true }] }, undefined, { y: '60', kg: '70' }),
      noweight: run({}, undefined, {}),
      silly: run({}, undefined, { kg: '500' }),
      oldage: run({ ageMax: 24 }, undefined, { y: '3', kg: '14' }),
      draft: run({ status: 'draft' }, undefined, { kg: '10' }),
      withdrawn: run({ status: 'withdrawn' }, undefined, { kg: '10' }),
      probable: run({}, { ...med, status: 'probable' }, { kg: '10' }),
      confirmed: run({}, { ...med, status: 'confirmed' }, { kg: '10' }),
      route: run({}, { ...med, route: 'injection' }, { kg: '10' }),
      noroute: run({}, { ...med, route: '' }, { kg: '10' }),
      form: run({ forms: 'suspension' }, tab, { kg: '10' }),
      release: run({ release: 'immediate' }, { ...tab, release: 'extended' }, { kg: '10' }),
      concSame: run({ concAmt: 250, concMl: 5 }, undefined, { kg: '10' }),
      concDiff: run({ concAmt: 125, concMl: 5 }, undefined, { kg: '10' }),
      tiny: run({ doseMin: 0.1, doseMax: 0.1, dosesPerDay: 1 }, undefined, { kg: '3' }),
      mcg: run({ basis: 'fixed', unit: 'mcg', doseMin: 500, doseMax: 500, dosesPerDay: 1 }, { ...med, strengths: [{ amt: 0.25, unit: 'mg', ml: 1 }] }, {}),
      units: run({ basis: 'fixed', unit: 'units', doseMin: 500, doseMax: 500, dosesPerDay: 1 }, undefined, {}),
      combo: run({ ingredients: ['testamycin', 'testalanate'], doseOf: 'testamycin', per: 'day', doseMin: 45, doseMax: 45, dosesPerDay: 2 }, { ...med, ings: ['testalanate', 'testamycin'], strengths: [{ amt: 11.4, unit: 'mg', ml: 1 }, { amt: 80, unit: 'mg', ml: 1 }] }, { kg: '10' }),
      comboOnSingle: run({ ingredients: ['testamycin', 'testalanate'], doseOf: 'testamycin' }, undefined, { kg: '10' }),
      legacy: (() => { const c = doseRun({ drug: 'Testdrug', class: 'Antibiotic', basis: 'perkg', doseMin: 10, doseMax: 15, dosesPerDay: 3, mgPer5ml: 120, status: 'approved', approvedBy: 'x' }, { ings: ['testdrug'], status: 'confirmed', route: '' }, pt({ kg: '10' })); return { state: c.state, res: c.res }; })(),
      strength: [parseStrength('250 mg/5 mL', 1), parseStrength('400 mg + 57 mg / 5 mL', 2), parseStrength('500mg', 1), parseStrength('banana', 1), parseStrength('250 mg', 2)],
      alias: [ingKey(splitIngs('Paracetamol')), ingKey(splitIngs('Co-amoxiclav')), ingKey(splitIngs('amoxicillin and clavulanate'))]
    };
  });
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  ok(R.perkg.state === 'ok' && near(R.perkg.res.each[0], 125) && near(R.perkg.res.each[1], 187.5) && near(R.perkg.res.day[1], 562.5), 'weight-based dose each time and per day', R.perkg.res);
  ok(near(R.perkg.res.vol.exact[0], 2.5) && near(R.perkg.res.vol.exact[1], 3.75), 'liquid volume from the product strength (50 mg/mL)', R.perkg.res.vol);
  ok(near(R.perday.res.day[0], 300) && near(R.perday.res.each[0], 100) && near(R.perday.res.each[1], 150), 'a daily total is divided, not used as one dose', R.perday.res);
  ok(near(R.single.res.each[1], 150) && R.single.res.capped.includes('single') && near(R.single.res.day[1], 450), 'largest single dose limits each dose and the day', R.single.res);
  ok(near(R.daykg.res.day[1], 400) && near(R.daykg.res.each[1], 400 / 3), 'most per day per kg limits the day and each dose', R.daykg.res);
  ok(near(R.dayfix.res.day[1], 1000) && near(R.dayfix.res.each[1], 1000 / 3), 'most per day (fixed) limits each dose too', R.dayfix.res);
  ok(R.fixed.state === 'ok' && !R.fixed.missing.length && near(R.fixed.res.each[0], 100) && near(R.fixed.res.day[0], 200), 'fixed dose needs no age or weight', R.fixed);
  ok(near(R.m2.res.each[0], 100 * Math.sqrt(2500 / 3600)), 'body surface area (Mosteller) dose', R.m2.res);
  ok(near(R.load.res.load[0], 200) && near(R.load.res.each[0], 100), 'loading dose shown apart from the maintenance dose', R.load.res);
  ok(near(R.mlstep.res.vol.round[0], 2.5) && near(R.mlstep.res.vol.round[1], 3.5), 'liquid rounded to the rule step, inside the range', R.mlstep.res.vol);
  ok(near(R.halves.res.tabs.round[0], 0.5) && near(R.halves.res.tabs.round[1], 1), 'tablets in halves when the rule allows', R.halves.res.tabs);
  ok(!R.whole.res.tabs.round && R.whole.warns.some(w => /No whole tablet/.test(w)), 'no whole tablet fits: says so instead of a fraction', R.whole);
  ok(R.nosplit.warns.some(w => /does not say whether this tablet can be split/.test(w)), 'tablet split not stated: warns', R.nosplit.warns);
  ok(R.renal.state === 'ok' && near(R.renal.res.crcl, (140 - 60) * 70 / (72 * 1.2) * 0.85) && near(R.renal.res.each[0], 250), 'kidney band: Cockcroft-Gault clearance and half dose', R.renal.res);
  ok(near(R.renalU.res.crcl, R.renal.res.crcl) && near(R.renalU.res.each[0], 250), 'creatinine in µmol/L gives the same clearance', R.renalU.res);
  ok(R.renalAvoid.state === 'blocked' && /do not use/.test(R.renalAvoid.blocks.join()), 'kidney band "do not use" blocks', R.renalAvoid);
  ok(R.renalChild.state === 'blocked' && /only for adults/.test(R.renalChild.blocks.join()), 'kidney formula is not used for a child', R.renalChild);
  ok(R.renalMissing.state === 'missing' && R.renalMissing.missing.includes('Sex') && R.renalMissing.missing.includes('Serum creatinine'), 'kidney rule asks for sex and creatinine', R.renalMissing);
  ok(R.noweight.state === 'missing' && R.noweight.missing.includes('Weight (kg)') && !R.noweight.res, 'missing weight: no dose, asks for it', R.noweight);
  ok(R.silly.state === 'blocked' && /not possible/.test(R.silly.blocks.join()), 'impossible weight blocks', R.silly);
  ok(R.oldage.state === 'blocked' && /outside this rule/.test(R.oldage.blocks.join()), 'age outside the rule blocks', R.oldage);
  ok(R.draft.state === 'blocked' && R.withdrawn.state === 'blocked' && !R.draft.res, 'draft and withdrawn rules are never used', [R.draft.blocks, R.withdrawn.blocks]);
  ok(R.probable.state === 'blocked' && R.confirmed.state === 'ok', 'a probable medicine needs confirming first', R.probable.blocks);
  ok(R.route.state === 'blocked' && /route/.test(R.route.blocks.join()), 'route mismatch blocks', R.route.blocks);
  ok(R.noroute.state === 'missing' && R.noroute.missing.includes('Route of the product'), 'unknown route is asked for, not assumed', R.noroute);
  ok(R.form.state === 'blocked' && R.release.state === 'blocked', 'form and release mismatches block', [R.form.blocks, R.release.blocks]);
  ok(R.concSame.state === 'ok' && R.concDiff.state === 'blocked', 'rule and product concentrations must agree', [R.concSame.state, R.concDiff.blocks]);
  ok(R.tiny.res.each[0] === 0.3, 'decimal: 0.1 × 3 is exactly 0.3', R.tiny.res.each);
  ok(near(R.mcg.res.vol.exact[0], 2), 'unit conversion: 500 mcg at 0.25 mg/mL is 2 mL', R.mcg.res.vol);
  ok(!R.units.res.vol && R.units.warns.some(w => /cannot be worked out/.test(w)), 'units cannot be turned into mg: says so', R.units.warns);
  ok(R.combo.state === 'ok' && near(R.combo.res.each[0], 225) && near(R.combo.res.vol.exact[0], 225 / 80), 'combination: dose of the named ingredient and its strength', R.combo.res);
  ok(R.comboOnSingle.state === 'blocked', 'a combination rule is not used for a single-ingredient product', R.comboOnSingle.blocks);
  ok(R.legacy.state === 'ok' && near(R.legacy.res.each[0], 100) && near(R.legacy.res.vol.exact[0], 100 / 120 * 5), 'rules made before the engine still work', R.legacy);
  ok(JSON.stringify(R.strength[0]) === JSON.stringify([{ amt: 250, unit: 'mg', ml: 5 }]) && R.strength[1].length === 2 && R.strength[2][0].ml === null && R.strength[3] === null && R.strength[4] === null, 'strength text is read, or refused when unclear', R.strength);
  ok(R.alias.join('|') === 'acetaminophen|amoxicillin + clavulanate|amoxicillin + clavulanate', 'international names and combinations normalised', R.alias);

  /* ---- 2. owner adds and approves a rule (no class needed), then the calculator flow ---- */
  await page.evaluate(() => { S.tab = 'dose'; render(); }); await page.waitForTimeout(300);
  await page.click('[data-xdedit="__new"]'); await page.waitForTimeout(200);
  const fill = async (o) => { for (const [k, v] of Object.entries(o)) { const sel = '#dr_' + k; if (await page.$eval(sel, e => e.tagName) === 'SELECT') await page.selectOption(sel, v); else await page.fill(sel, v); } };
  await fill({ drug: 'Testamycin', ingredients: 'testamycin', indication: 'Test infection', group: 'Child', doseMin: '10', doseMax: '15', dosesPerDay: '3', srcName: 'Test label', srcRef: 'https://example.org/label', srcDate: '2024-01' });
  await page.click('#doseForm button[type=submit]'); await page.waitForTimeout(200);
  ok(await page.evaluate(() => E.doserules.length === 0) && /route/.test(await page.textContent('#drErr')), 'a rule without route or source organisation is refused', await page.textContent('#drErr'));
  await fill({ route: 'oral', srcOrg: 'Other' }); await page.click('#doseForm button[type=submit]'); await page.waitForTimeout(500);
  const rid = await page.evaluate(() => E.doserules[0]?.id);
  ok(await page.evaluate(() => E.doserules.length === 1 && E.doserules[0].status === 'draft' && E.doserules[0].ver === 1 && !E.doserules[0].class), 'any-class rule saved as draft version 1');
  await page.click(`[data-xdedit="${rid}"]`); await page.waitForTimeout(200); await page.click('[data-xdappr]'); await pin();
  ok(await page.evaluate(() => E.doserules[0].status === 'approved' && !!E.doserules[0].approvedBy), 'owner approves with the PIN');

  await page.fill('#dsQ', 'testamycin'); await page.waitForTimeout(200);
  ok(await page.locator('#dsCands [data-xdcand^="l:"]').count() >= 1 && !(await page.$('#dsMed')), 'local match listed, nothing chosen automatically');
  await page.click('[data-xrxgo="1"]'); await page.waitForTimeout(1500);
  const rxn = await page.$$eval('#dsCands [data-xdcand^="r:"] .t', a => a.map(x => x.textContent));
  ok(rxn.includes('testamycine') && rxn.includes('testamycin 50 MG/ML Oral Suspension [Testabrand]') && rxn.length >= 5, 'RxNorm search lists ingredients, products and look-alikes', rxn);
  ok(/Several medicines match/.test(await page.textContent('#dsCands')) && !(await page.$('#dsMed')), 'similar names: the pharmacist must choose');
  const brandIdx = rxn.indexOf('testamycin 50 MG/ML Oral Suspension [Testabrand]');
  await page.click(`[data-xdcand="r:${brandIdx}"]`); await page.waitForTimeout(1200);
  let med = await page.evaluate(() => S.dose.med);
  ok(med.status === 'verified' && med.ings.join() === 'testamycin' && med.route === 'oral' && med.form === 'Oral Suspension' && med.strengths[0].amt === 50 && med.brands.includes('Testabrand'), 'brand resolved to its ingredient, strength, form and route', med);
  ok(/IMAGINARY AGENTS/.test(await page.textContent('#dsMed')), 'ATC class shown as information');
  await page.click(`[data-xdrule="${rid}"]`); await page.waitForTimeout(200);
  ok(await page.isVisible('#dsKg') && !(await page.isVisible('#dsY')), 'only the fields the rule needs are asked (weight, not age)');
  await page.fill('#dsKg', '12.5'); await page.waitForTimeout(300);
  let out = await page.textContent('#doseOut');
  ok(/125 to 187\.5 mg/.test(out) && /2\.5 to 3\.75 mL/.test(out) && /Ready/.test(out) && /How it was worked out/.test(out), 'result with volume, steps and Ready state', out);
  ok(/Test label/.test(out) && /v1/.test(out), 'source and rule version shown', out);
  await page.waitForTimeout(2200);
  const log1 = await page.evaluate(async () => ({ n: E.doselog.length, rec: E.doselog[0]?.rec, intact: E.doselog[0] ? await logIntact(E.doselog[0]) : false }));
  ok(log1.n === 1 && log1.rec.ruleVer === 1 && log1.rec.med.rxcui === '900011' && log1.rec.inputs.kg === 12.5 && log1.intact && !('patientName' in log1.rec), 'calculation recorded with rule version, product and inputs, checksum intact', log1);
  await page.waitForTimeout(1800); ok(await page.evaluate(() => E.doselog.length) === 1, 'the same calculation is recorded once');

  // inventory has nothing in it so far: add a stocked item, use it, then remove it: the rule keeps working
  ok(await page.evaluate(() => catalog().length === 0), 'calculation worked with an empty stock');
  await page.evaluate(async () => { await write('products/P-T1', { id: 'P-T1', name: 'Testa syrup', strength: '250 mg/5 ml', form: 'Syrup', sci: 'Testamycin' }); });
  await page.click('[data-xdmedclear="1"]'); await page.fill('#dsQ', 'testa syrup'); await page.waitForTimeout(300);
  await page.click('#dsCands [data-xdcand="l:0"]'); await page.waitForTimeout(300);
  ok(/Probable match/.test(await page.textContent('#dsMed')), 'a stock item is a probable match until confirmed');
  await page.click(`[data-xdrule="${rid}"]`); await page.fill('#dsKg', '12.5'); await page.waitForTimeout(300);
  ok(/Blocked/.test(await page.textContent('#doseOut')) && !/187\.5 mg/.test(await page.textContent('#doseOut')), 'not confirmed: no dose');
  await page.click('#dsConfirm'); await page.waitForTimeout(300); out = await page.textContent('#doseOut');
  ok(/125 to 187\.5 mg/.test(out) && /2\.5 to 3\.75 mL/.test(out), 'confirmed stock item: same dose, volume from the stock strength', out);
  ok(await page.evaluate(() => catalog().length === 1 && E.moves.length === 0 && E.sales.length === 0), 'the calculator did not change stock');
  await page.evaluate(() => { E.prods = []; clearMemo(); });
  await page.click('[data-xdmedclear="1"]'); await page.fill('#dsQ', 'testamycin'); await page.waitForTimeout(300);
  ok(!/Testa syrup/.test(await page.textContent('#dsCands')) && /Your dose rules/.test(await page.textContent('#dsCands')), 'stock item gone, the medicine is still found from the rules');

  // typed by hand
  await page.fill('#dsQ', 'zzlocal'); await page.waitForTimeout(200); await page.click('[data-xdmanual="1"]'); await page.waitForTimeout(200);
  ok(/Unverified manual entry/.test(await page.textContent('#dsMed')) && !(await page.$('#dsConfirm')), 'manual entry starts unverified with no confirm box');
  await page.fill('#dsMIng', 'unknownium'); await page.dispatchEvent('#dsMIng', 'change'); await page.waitForTimeout(200);
  ok(/not in RxNorm/.test(await page.textContent('#dsMed')) && /No approved dose rule/.test(await page.textContent('#dsRules')), 'unknown ingredient stays unverified, no rule');
  await page.fill('#dsMIng', 'Testamycin'); await page.dispatchEvent('#dsMIng', 'change'); await page.waitForTimeout(200);
  ok(/Probable match/.test(await page.textContent('#dsMed')), 'known ingredient typed by hand: probable match');
  await page.click('#dsConfirm'); await page.click(`[data-xdrule="${rid}"]`); await page.fill('#dsKg', '10'); await page.waitForTimeout(300);
  ok(/Route of the product/.test(await page.textContent('#doseOut')), 'manual entry: the route is asked for');
  await page.selectOption('#dsMRoute', 'oral'); await page.waitForTimeout(300);
  ok(/100 to 150 mg/.test(await page.textContent('#doseOut')), 'manual entry confirmed with route: dose worked out', await page.textContent('#doseOut'));

  // a medicine with no rule
  await page.click('[data-xdmedclear="1"]'); await page.fill('#dsQ', 'testamycine'); await page.click('[data-xrxgo="1"]'); await page.waitForTimeout(1200);
  await page.click('#dsCands [data-xdcand^="r:"]'); await page.waitForTimeout(800);
  ok(/Manual clinical review is required/.test(await page.textContent('#dsRules')) && await page.isVisible('[data-xdedit="__new"][data-ings]'), 'identified but no rule: review message and Add a rule');

  // label sentences are drafts only, whatever the class
  await page.click('[data-xdmedclear="1"]'); await page.fill('#dsQ', 'testamycin'); await page.click('[data-xrxgo="1"]'); await page.waitForTimeout(800);
  await page.click(`[data-xdcand="r:${brandIdx}"]`); await page.waitForTimeout(1500);
  const lab = await page.textContent('#doseLabel');
  ok(/not approved/.test(lab) && await page.locator('#doseLabel [data-xdlinedraft]').count() === 3 && /Imaginary Class/.test(lab) && /Test boxed warning/.test(lab), 'FDA label: alerts plus 3 unapproved dose sentences, any class', lab.slice(0, 300));
  ok(await page.evaluate(() => { const r = E.doserules.find(x => x.id === 'FDA-testamycin'); return r && r.status === 'extracted' && !doseRules().includes(r); }), 'saved label sentences are not a usable rule');
  await page.click('#doseLabel [data-xdlinedraft="1"]'); await page.waitForTimeout(300);
  const pre = await page.evaluate(() => ({ min: $('#dr_doseMin').value, max: $('#dr_doseMax').value, per: $('#dr_per').value, n: $('#dr_dosesPerDay').value, org: $('#dr_srcOrg').value, basis: $('#dr_basis').value }));
  ok(pre.min === '25' && pre.max === '45' && pre.per === 'day' && pre.n === '2' && pre.org === 'FDA' && pre.basis === 'perkg' && /Read from the FDA label/.test(await page.textContent('#sheet')), 'a label sentence opens a prefilled draft for checking', pre);
  await page.evaluate(() => closeSheet()); await page.click('#doseLabel [data-xdlinedraft="0"]'); await page.waitForTimeout(300);
  const pre0 = await page.evaluate(() => ({ min: $('#dr_doseMin').value, per: $('#dr_per').value, n: $('#dr_dosesPerDay').value, basis: $('#dr_basis').value }));
  ok(pre0.min === '500' && pre0.per === 'dose' && pre0.n === '3' && pre0.basis === 'fixed', 'a fixed adult dose sentence is offered too (not only mg per kg)', pre0);
  await page.evaluate(() => closeSheet());

  // versions, rollback, duplicate and withdrawal
  await page.click(`[data-xdedit="${rid}"]`); await page.waitForTimeout(200); await page.fill('#dr_doseMax', '20'); await page.click('#doseForm button[type=submit]'); await page.waitForTimeout(500);
  let rr = await page.evaluate(id => E.doserules.find(x => x.id === id), rid);
  ok(rr.ver === 2 && rr.status === 'draft' && rr.versions.length === 1 && rr.versions[0].doseMax === 15 && rr.versions[0].status === 'approved', 'editing keeps version 1 and makes version 2 a draft', rr);
  ok(await page.evaluate(() => { S.dose.rid = ''; return !rulesForMed(S.dose.med).some(ruleUsable); }), 'the changed rule is not used until approved again');
  await page.click(`[data-xdedit="${rid}"]`); await page.waitForTimeout(200); await page.click('[data-xdappr]'); await pin();
  await page.click(`[data-xdedit="${rid}"]`); await page.waitForTimeout(200); await page.click('[data-xdroll][data-ver="1"]'); await pin();
  rr = await page.evaluate(id => E.doserules.find(x => x.id === id), rid);
  ok(rr.ver === 3 && rr.status === 'draft' && rr.doseMax === 15 && rr.restoredFrom === 1 && rr.versions.length === 2, 'rollback restores version 1 as draft version 3', rr);
  await page.click(`[data-xdedit="${rid}"]`); await page.waitForTimeout(200); await page.click('[data-xdappr]'); await pin();
  await page.click('[data-xdedit="__new"]'); await page.waitForTimeout(200);
  await fill({ drug: 'Testamycin', ingredients: 'testamycin', indication: 'test infection', group: 'child', route: 'oral', doseMin: '5', doseMax: '6', dosesPerDay: '2', srcOrg: 'Other', srcName: 'x', srcRef: 'y', srcDate: '2024' });
  await page.click('#doseForm button[type=submit]'); await page.waitForTimeout(300);
  ok(/overlaps an existing rule/.test(await page.textContent('#drErr')), 'duplicate rule refused', await page.textContent('#drErr'));
  await page.evaluate(() => closeSheet());
  await page.click(`[data-xdedit="${rid}"]`); await page.waitForTimeout(200); await page.click('[data-xdwd]'); await page.waitForTimeout(200);
  ok(await page.evaluate(id => E.doserules.find(x => x.id === id).status, rid) === 'approved', 'withdrawing needs a reason');
  await page.fill('#dr_wdWhy', 'Test withdrawal'); await page.click('[data-xdwd]'); await pin();
  rr = await page.evaluate(id => E.doserules.find(x => x.id === id), rid);
  ok(rr.status === 'withdrawn' && rr.withdrawnReason === 'Test withdrawal' && await page.locator('[data-xdlog]').count() >= 1 && /one rule/.test(await page.textContent('main')), 'withdrawn with reason; its calculations are listed', rr.status);
  const histOk = await page.evaluate(async () => { const x = E.doselog[0]; return x.rec.ruleVer === 1 && await logIntact(x); });
  ok(histOk, 'earlier calculations keep their rule version and stay intact');
  await page.evaluate(async () => { const x = E.doselog[0]; await write('doselog/' + x.id, { rec: { ...x.rec, result: { each: [999, 999] } } }, true); });
  ok(await page.evaluate(async () => !(await logIntact(E.doselog.find(x => x.rec.result?.each?.[0] === 999)))), 'a changed record is detected by its checksum');

  // permission: staff without owner rights cannot edit rules or see the record, and can ask for a rule
  await page.evaluate(() => { window._own = S.staff; S.staff = { id: 'ST-P', name: 'Pharm', role: 'pharmacist', perms: ['dose'] }; S.tab = 'dose'; render(); });
  ok(!(await page.$('[data-xdedit="__new"]')) && !/Calculation record/.test(await page.textContent('main')), 'non-owner: no rule editing and no record');
  await page.fill('#dsQ', 'testamycine'); await page.click('[data-xrxgo="1"]'); await page.waitForTimeout(800); await page.click('#dsCands [data-xdcand^="r:"]'); await page.waitForTimeout(600);
  await page.click('[data-xdask="1"]'); await page.waitForTimeout(400);
  ok(await page.evaluate(() => E.doserules.some(r => r.status === 'requested' && r.ingredients.join() === 'testamycine')), 'non-owner can ask the owner for a rule');
  await page.evaluate(() => { S.staff = window._own; S.dose.med = null; render(); });

  /* ---- 3. outages, timeouts and offline ---- */
  F.mode.down = true; await page.fill('#dsQ', 'testabrand'); await page.click('[data-xrxgo="1"]'); await page.waitForTimeout(2500);
  ok(/RxNorm did not answer/.test(await page.textContent('#dsCands')) && await page.evaluate(() => extLog().some(x => !x.ok)), 'service down: clear message, failure logged');
  F.mode.down = false; F.mode.slow = true; await page.fill('#dsQ', 'zzslow'); await page.click('[data-xrxgo="1"]'); await page.waitForTimeout(11500);
  ok(/timed out/.test(await page.textContent('#dsCands')), 'service too slow: stops after 10 seconds and says so', await page.textContent('#dsCands'));
  F.mode.slow = false;
  await ctx.setOffline(true); await page.fill('#dsQ', 'testamycin'); await page.click('[data-xrxgo="1"]'); await page.waitForTimeout(500);
  ok(await page.locator('#dsCands [data-xdcand^="r:"]').count() >= 5, 'offline: saved RxNorm results still listed');
  await page.click(`[data-xdcand="r:${brandIdx}"]`); await page.waitForTimeout(500);
  ok(/Offline/.test(await page.textContent('#doseOut')) && (await page.evaluate(() => S.dose.med.status)) === 'verified', 'offline: saved product details used and offline state shown');
  ok(/Manual clinical review/.test(await page.textContent('#dsRules')), 'offline: the withdrawn rule is not used');
  await ctx.setOffline(false);

  // Arabic
  await page.evaluate(() => { setLang('ar'); S.tab = 'dose'; render(); }); await page.waitForTimeout(400);
  const ar = await page.textContent('main');
  ok(/حاسبة الجرعات/.test(ar) && /سجل الحسابات/.test(ar) && /ابحث في RxNorm/.test(ar), 'Arabic screen', ar.slice(0, 200));
  ok(!errs.length, 'no page errors', errs);
  await b.close(); F.close(); console.log(fails ? fails + ' FAILED' : 'PASS all dose engine checks'); process.exit(fails ? 1 : 0);
})();
