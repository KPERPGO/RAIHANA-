// loading screen: ring shows, % climbs, then it goes away; record layout shifts after it is gone
const { chromium } = require('./pw');
(async () => {
  const b = await chromium.launch();
  for (const [w,h] of [[390,800],[1280,720]]) {
    const page = await b.newPage({ viewport: { width: w, height: h } }); const errs = []; page.on('pageerror', e => errs.push(e.message));
    const t0 = Date.now(); await page.goto('http://localhost:8765/index.html', {waitUntil:'commit'});
    // a check made while the page is still being replaced can wait for ever on a slow runner: give each one 3 s, then count it as "still loading"
    const within = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timed out')), ms))]);
    const seen = []; for (let i = 0; i < 60; i++){ const r = await within(page.evaluate(() => { const el = document.getElementById('boot'); return el ? document.getElementById('bootPct').textContent : 'gone'; }), 3000).catch(() => 'nav'); seen.push(r); if (r === 'gone') break; if (i === 3) await page.screenshot({path:`boot-${w}.png`, timeout:5000}).catch(() => {}); await page.waitForTimeout(50); }
    const gone = Date.now() - t0;
    // the page may still be swapping documents here; a plain evaluate then never returns, so first wait (and fail clearly) until the app is up
    await page.waitForFunction(() => typeof S !== 'undefined' && S.ready && !document.getElementById('boot'), null, {timeout:60000});
    // after load: count renders during 1s idle and layout shift
    const after = await page.evaluate(() => new Promise(r => { let n = 0; const o = window.render; window.render = render = function(){ n++; return o.apply(this, arguments); }; let cls = 0; new PerformanceObserver(l => l.getEntries().forEach(e => cls += e.value)).observe({type:'layout-shift', buffered:false}); setTimeout(() => r({renders:n, cls, ready:S.ready, tab:S.tab}), 1000); }));
    // tab switching speed
    const sw = await page.evaluate(async () => { const out = []; for (const k of ['sell','stock','pricing','chronic','money','home']){ const t = performance.now(); S.tab = k; render(); out.push(k + ' ' + Math.round(performance.now() - t) + 'ms'); } return out.join(', '); });
    console.log(w, 'boot % seen:', [...new Set(seen)].join(' '), '| gone after', gone, 'ms', JSON.stringify(after), '|', sw, errs.length ? errs : 'no errors');
    await page.close();
  }
  await b.close();
})();
