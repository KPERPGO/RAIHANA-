const ROOT = require('path').resolve(__dirname, '..'); // repo folder: src, dist, tests
// Pricing screen opens smoothly: one draw, no layout jumps, nothing re-drawn while idle
const { chromium } = require('./pw');
const fs = require('fs'); const D = require('path').join(__dirname, 'fixtures');
(async () => {
  const b = await chromium.launch(); let bad = 0;
  for (const [w, h] of [[390, 844], [1280, 720]]) for (const lang of ['en', 'ar']) {
    const p = await b.newPage({ viewport: { width: w, height: h } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript({ path: 'fake.js' }); await p.goto('file://' + ROOT + '/tests/erp-artifact-test.html'); await p.waitForTimeout(600);
    await p.evaluate(inv => __seed('invoices', [inv]), JSON.parse(fs.readFileSync(D + '/invoices/PI-2026-0001.json'))); await p.waitForTimeout(300);
    if (lang === 'ar') { await p.click('#langBtn'); await p.waitForTimeout(300); }
    const r = await p.evaluate(() => new Promise(res => {
      let shift = 0, renders = 0, mut = 0; const o = window.render; window.render = render = function(){ renders++; return o.apply(this, arguments); };
      new PerformanceObserver(l => l.getEntries().forEach(e => { if (!e.hadRecentInput) shift += e.value; })).observe({type:'layout-shift'});
      const t0 = performance.now(); document.querySelector('nav.tabs [data-tab="pricing"]').click(); const tDraw = performance.now() - t0;
      const mo = new MutationObserver(ms => mut += ms.length); setTimeout(() => mo.observe(document.getElementById('view'), {subtree:true, childList:true, characterData:true}), 700);
      const rows0 = document.querySelectorAll('table.prt tbody tr').length; const kpi = () => [...document.querySelectorAll('.kpi .v.num')].map(e => e.textContent).join('|'); const k0 = kpi(); setTimeout(() => { window.__k1 = kpi() === k0; }, 1500);
      setTimeout(() => res({tDraw:Math.round(tDraw), renders, shift:+shift.toFixed(4), idleChanges:mut, rows:rows0, steadyFromFirstFrame:window.__k1}), 1600); }));
    const vis = await p.evaluate(() => [...document.querySelectorAll(".kpi .v.num")].map(e => e.textContent).join("|")); await p.waitForTimeout(700); const vis2 = await p.evaluate(() => [...document.querySelectorAll(".kpi .v.num")].map(e => e.textContent).join("|")); r.numbersSteady = vis === vis2; r.anim = await p.evaluate(() => getComputedStyle(document.querySelector("#view > *")).animationName);
    const ok = r.steadyFromFirstFrame && r.numbersSteady && r.anim === "none" && r.renders <= 1 && r.shift < 0.02 && r.idleChanges === 0 && r.tDraw < 120 && !errs.length;
    if (!ok) bad++; console.log(ok ? 'PASS' : 'FAIL', w, lang, JSON.stringify(r), errs);
    await p.close();
  }
  console.log(bad ? `${bad} FAILED` : 'PASS pricing opens smoothly'); await b.close(); process.exit(bad ? 1 : 0);
})();
