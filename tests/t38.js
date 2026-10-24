const ROOT = require('path').resolve(__dirname, '..'); // repo folder: src, dist, tests
// Charts on the finance screens, 24 Oct 2026 (LTH: "put charts in the finance to make the reports visual"):
// Cash box shows the last 6 months (sales and net profit, a loss hangs under the zero line), sales each day and expenses
// by type; Accounts shows where the sales money went (P&L) and own vs owe (balance sheet). Phone and PC, Arabic, dark,
// hover or tap shows the numbers, a tap on a month opens that month, and the bars match the sums the screen already shows.
const { chromium, XLSX_FILE } = require('./pw');
let fails = 0; const ok = (m, c, x) => { console.log(c ? 'ok  ' : 'FAIL', m, x === undefined ? '' : JSON.stringify(x)); if (!c) fails++; };
const SHOTS = process.env.SHOTS;
(async () => {
  const b = await chromium.launch();
  const fresh = async (vp, opts = {}) => {
    const p = await b.newPage({ viewport: vp, colorScheme: opts.dark ? 'dark' : 'light', hasTouch: !!opts.touch }); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.errs = errs;
    await p.addInitScript({ path: ROOT + '/tests/fake.js' });
    await p.route('**/xlsx.full.min.js', r => r.fulfill({ path: XLSX_FILE, contentType: 'text/javascript' }));
    await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await p.goto('file://' + ROOT + '/tests/erp-artifact-test.html'); await p.waitForTimeout(800);
    await p.evaluate(async () => {
      Object.assign(__store, {products:{}, sales:{}, moves:{}, customers:{}, custpays:{}, chronic:{}, expenses:{}, closes:{}, counts:{}, staff:{}, shifts:{}, events:{}, journal:{}});
      const mon = k => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - k); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
      window.__mon = mon;
      const sales = [], exps = [];
      // this month: 3 sales on day 1 and one on day 2; last month: one sale and a big expense (a loss); 2 months ago: one sale
      for (const [m, day, total, i] of [[0, '01', 100000, 1], [0, '01', 50000, 2], [0, '01', 50000, 3], [0, '02', 40000, 4], [1, '05', 30000, 5], [2, '10', 80000, 6]])
        sales.push({id:'S' + i, no:i, date:mon(m) + '-' + day, at:mon(m) + '-' + day + 'T10:00:00.000Z', total, method:'cash', lines:[]});
      exps.push({id:'X1', date:mon(0) + '-01', category:'Generator', amount:20000}, {id:'X2', date:mon(0) + '-02', category:'Rent', amount:60000}, {id:'X3', date:mon(1) + '-06', category:'Rent', amount:90000});
      __seed('sales', sales); __seed('expenses', exps);
      __seed('staff', [{id:'ST-O', name:'Owner', role:'owner', active:true, pinHash: await pinHash('ST-O', '1234')}]);
    });
    await p.waitForTimeout(300);
    await p.evaluate(() => { S.staff = E.staff.find(x => x.id === 'ST-O'); S.moneyM = __mon(0); S.tab = 'money'; render(); });
    await p.waitForTimeout(200);
    if (opts.ar) { await p.click('#langBtn'); await p.waitForTimeout(300); }
    return p;
  };
  const read = p => p.evaluate(() => {
    const figs = [...document.querySelectorAll('#view figure.ch')], view = document.getElementById('view');
    return {titles: figs.map(f => f.querySelector('figcaption').textContent), cols: figs.map(f => f.querySelectorAll('.chcol').length),
      overflow: Math.max(view.scrollWidth - view.clientWidth, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      wide: figs.some(f => f.getBoundingClientRect().right > innerWidth + 1 || f.getBoundingClientRect().left < -1)};
  });

  for (const [name, vp, opts] of [['phone', {width:390, height:844}, {touch:true}], ['pc', {width:1440, height:900}, {}], ['phone-ar-dark', {width:390, height:844}, {ar:true, dark:true, touch:true}]]) {
    const p = await fresh(vp, opts); const r = await read(p);
    if (!opts.ar) ok(`${name}: Cash box has the 6 months, each day and expenses charts`, r.titles.join('|') === 'Last 6 months|Sales each day|Expenses by type', r.titles);
    else ok(`${name}: chart titles in Arabic`, ['آخر 6 أشهر', 'المبيعات كل يوم', 'المصاريف حسب النوع'].every(t => r.titles.includes(t)), r.titles);
    ok(`${name}: 6 month columns and one column a day`, r.cols[0] === 6 && r.cols[1] >= 28 && r.cols[1] <= 31, r.cols);
    ok(`${name}: nothing wider than the screen`, r.overflow <= 0 && !r.wide, r);
    if (SHOTS) { await p.evaluate(() => document.querySelector('figure.ch').scrollIntoView({block:'start'})); await p.hover('figure.ch .chcol:nth-child(6)'); await p.waitForTimeout(150); await p.screenshot({ path: `${SHOTS}/charts-${name}.png` });
      await p.evaluate(() => document.querySelectorAll('figure.ch')[2].scrollIntoView({block:'end'})); await p.screenshot({ path: `${SHOTS}/charts-${name}-2.png` }); }
    ok(`${name}: no page errors`, !p.errs.length, p.errs); await p.close();
  }

  { const p = await fresh({width:1280, height:900});
    // the bars follow the month sums: this month sales 240,000 and net 160,000 (no cost on these sales); last month 30,000 sales and a 60,000 loss
    const v = await p.evaluate(() => { const c = [...document.querySelectorAll('figure.ch')[0].querySelectorAll('.chcol')], h = el => el.getBoundingClientRect().height;
      const bars = c.map(x => [...x.querySelectorAll('.chup .chb')].map(h).concat([...x.querySelectorAll('.chdn .chb')].map(h)));
      return {bars, mm: [monthMoney(__mon(0)), monthMoney(__mon(1))].map(m => [m.sales, m.net]), on: c.findIndex(x => x.classList.contains('on'))}; });
    ok('month sums as expected', JSON.stringify(v.mm) === JSON.stringify([[240000, 160000], [30000, -60000]]), v.mm);
    const [up0, up1, , dn1] = v.bars[5], [lup0, lup1, , ldn1] = v.bars[4];
    ok('this month: net profit bar is 2/3 of the sales bar', Math.abs(up1 / up0 - 160 / 240) < 0.03, v.bars[5]);
    ok('last month: the loss hangs under the zero line, no profit bar above', lup1 === 0 && ldn1 > 0 && lup0 > 0, v.bars[4]);
    ok('the chosen month is marked', v.on === 5, v.on);
    // hover shows the numbers
    await p.hover('figure.ch .chcol:nth-child(6)'); await p.waitForTimeout(100);
    const tip = await p.evaluate(() => { const t = document.querySelector('figure.ch .chtip'), r = t.getBoundingClientRect(), f = t.closest('figure').getBoundingClientRect(); return {hidden:t.hidden, text:t.innerText.replace(/\s+/g, ' '), inside: r.left >= f.left - 1 && r.right <= f.right + 1}; });
    ok('hover a month: tip shows sales and net profit', !tip.hidden && /Sales 240,000 IQD/.test(tip.text) && /Net profit 160,000 IQD/.test(tip.text) && tip.inside, tip);
    await p.hover('figure.ch .chcol:nth-child(5)'); await p.waitForTimeout(100);
    ok('a loss month says Net loss', /Net loss −60,000 IQD/.test(await p.evaluate(() => document.querySelector('figure.ch .chtip').innerText.replace(/\s+/g, ' '))));
    await p.mouse.move(5, 5); await p.waitForTimeout(100);
    ok('moving away hides the tip', await p.evaluate(() => document.querySelector('figure.ch .chtip').hidden));
    // each day: day 1 has 3 receipts and 200,000
    await p.hover('figure.ch:nth-of-type(2) .chcol:nth-child(1)'); await p.waitForTimeout(100);
    const dt = await p.evaluate(() => document.querySelectorAll('figure.ch')[1].querySelector('.chtip').innerText.replace(/\s+/g, ' '));
    ok('day 1: 200,000 from 3 receipts', /Sales 200,000 IQD/.test(dt) && /Receipts 3/.test(dt), dt);
    // expenses by type: rent first, written amounts
    const ex = await p.evaluate(() => [...document.querySelectorAll('figure.ch')[2].querySelectorAll('.chrow')].map(r => r.innerText.replace(/\s+/g, ' ')));
    ok('expenses by type: Rent 60,000 then Generator 20,000', ex.length === 2 && /Rent.*60,000/.test(ex[0]) && /Generator.*20,000/.test(ex[1]), ex);
    // tap a month opens it
    await p.click('figure.ch .chcol:nth-child(5)'); await p.waitForTimeout(200);
    const m = await p.evaluate(() => ({m: S.moneyM, want: __mon(1), input: document.getElementById('moneyM').value, net: [...document.querySelectorAll('.sum .r.big')].map(x => x.innerText).join('|')}));
    ok('tap a month: that month opens below', m.m === m.want && m.input === m.want && /−?60,000|-60,000/.test(m.net), m);
    // a month with nothing: no empty chart boxes
    await p.evaluate(() => { S.moneyM = '2020-01'; render(); }); await p.waitForTimeout(100);
    ok('an old month with no data shows no charts', await p.evaluate(() => document.querySelectorAll('#view figure.ch').length === 0));
    // Accounts
    await p.evaluate(() => { S.tab = 'books'; S.bk.view = 'pl'; S.bk.from = __mon(2) + '-01'; S.bk.to = today(); render(); }); await p.waitForTimeout(200);
    const pl = await p.evaluate(() => { const f = document.querySelector('#view figure.ch'); return f && {t:f.querySelector('figcaption').textContent, rows:[...f.querySelectorAll('.chrow')].map(r => r.innerText.replace(/\s+/g, ' '))}; });
    ok('Profit and loss: chart of where the sales money went', pl && pl.t === 'Where the sales money went' && /^Sales 350,000/.test(pl.rows[0]) && pl.rows.some(r => /^Expenses 170,000/.test(r)) && /^Net profit 180,000/.test(pl.rows.at(-1)), pl);
    await p.evaluate(() => { S.bk.view = 'bs'; render(); }); await p.waitForTimeout(200);
    const bs = await p.evaluate(() => { const f = document.querySelector('#view figure.ch'); return f && [...f.querySelectorAll('.chrow')].map(r => r.innerText.replace(/\s+/g, ' ')); });
    if (SHOTS) { await p.evaluate(() => document.querySelector('#view figure.ch').scrollIntoView({block:'end'})); await p.screenshot({ path: `${SHOTS}/charts-bs.png` }); }
    ok('Balance sheet: own and owe chart shows the cash box', bs && bs.some(r => /^Cash box 180,000/.test(r)), bs);
    ok('no page errors', !p.errs.length, p.errs); await p.close(); }

  { const p = await fresh({width:390, height:844}, {touch:true});
    await p.tap('figure.ch:nth-of-type(2) .chcol:nth-child(2)'); await p.waitForTimeout(150);
    const t = await p.evaluate(() => { const t = document.querySelectorAll('figure.ch')[1].querySelector('.chtip'); return {hidden:t.hidden, text:t.innerText.replace(/\s+/g, ' ')}; });
    ok('phone: tap a day shows its numbers', !t.hidden && /Sales 40,000 IQD/.test(t.text), t);
    const colours = await p.evaluate(() => [...document.querySelectorAll('figure.ch')[0].querySelectorAll('.chcol:nth-child(6) .chup .chb')].map(b => getComputedStyle(b).backgroundColor));
    ok('phone: sales and profit bars have different colours', colours.length === 2 && colours[0] !== colours[1], colours);
    ok('no page errors', !p.errs.length, p.errs); await p.close(); }

  await b.close();
  console.log(fails ? `${fails} FAILED` : 'PASS all finance chart checks'); process.exit(fails ? 1 : 0);
})();
