const ROOT = require('path').resolve(__dirname, '..'); // repo folder: src, dist, tests
// Reports overview, 30 Oct 2026 (LTH: "make table and charts in reports page"): month picker, totals, a 12-month chart,
// top items, sales by payment and by staff, a month-by-month table and a top-items table. Phone and PC, English and Arabic.
// The figures must match monthMoney(), the same sums the Cash box shows; staff without the Money screen see no profit.
const { chromium, XLSX_FILE } = require('./pw');
let fails = 0; const ok = (m, c, x) => { console.log(c ? 'ok  ' : 'FAIL', m, x === undefined ? '' : JSON.stringify(x)); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  for (const [w, h, lang] of [[390, 800, 'en'], [1280, 800, 'en'], [390, 800, 'ar']]) {
    const tag = `${w} ${lang}`, p = await b.newPage({ viewport: { width: w, height: h } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript({ path: ROOT + '/tests/fake.js' });
    await p.route('**/xlsx.full.min.js', r => r.fulfill({ path: XLSX_FILE, contentType: 'text/javascript' }));
    await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await p.goto('file://' + ROOT + '/tests/erp-artifact-test.html'); await p.waitForTimeout(800);
    await p.evaluate(async () => {
      Object.assign(__store, {products:{}, sales:{}, moves:{}, customers:{}, custpays:{}, chronic:{}, expenses:{}, closes:{}, counts:{}, staff:{}, shifts:{}, events:{}, journal:{}});
      const mon = k => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - k); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }; window.__mon = mon;
      const ln = (pid, name, qty, total, cost) => ({pid, name, qty, per:1, total, alloc:[{q:qty, cost}]});
      __seed('sales', [
        {id:'S1', no:1, date:mon(0) + '-01', at:mon(0) + '-01T10:00:00.000Z', total:30000, method:'cash', staffName:'Owner', lines:[ln('P1', 'Panadol', 3, 30000, 6000)]},
        {id:'S2', no:2, date:mon(0) + '-02', at:mon(0) + '-02T10:00:00.000Z', total:20000, method:'card', staffName:'Ali', lines:[ln('P2', 'Augmentin', 1, 20000, 12000)]},
        {id:'S3', no:3, date:mon(0) + '-02', at:mon(0) + '-02T11:00:00.000Z', total:10000, method:'cash', staffName:'Ali', lines:[ln('P1', 'Panadol', 1, 10000, 6000)]},
        {id:'S4', no:4, date:mon(1) + '-05', at:mon(1) + '-05T10:00:00.000Z', total:50000, method:'cash', staffName:'Owner', lines:[ln('P2', 'Augmentin', 2, 50000, 12000)]}]);
      __seed('expenses', [{id:'X1', date:mon(0) + '-01', category:'Rent', amount:5000}]);
      __seed('staff', [{id:'ST-O', name:'Owner', role:'owner', active:true, pinHash: await pinHash('ST-O', '1234')}, {id:'ST-A', name:'Ali', role:'pharmacist', active:true, perms:['sell', 'reports'], pinHash: await pinHash('ST-A', '5555')}]);
    });
    await p.waitForTimeout(300);
    await p.evaluate(lang => { S.staff = E.staff.find(x => x.id === 'ST-O'); if (lang === 'ar' && S.lang !== 'ar') document.getElementById('langBtn').click(); S.repM = null; S.tab = 'reports'; render(); }, lang);
    await p.waitForTimeout(300);
    const r = await p.evaluate(() => { const v = document.getElementById('view'), mm = monthMoney(S.repM), tabs = [...v.querySelectorAll('table.rep')];
      return {mm, figs:[...v.querySelectorAll('.repch figure figcaption')].map(x => x.textContent), cols:v.querySelectorAll('.repch .chcol').length,
        tables:tabs.map(t => [...t.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.textContent.trim()))), kpis:[...v.querySelectorAll('.kpis .v')].map(x => x.textContent),
        wide: document.documentElement.scrollWidth <= innerWidth + 1}; });
    ok(tag + ' month figures: sales 60,000, cost 36,000, expenses 5,000, net 19,000', r.mm.sales === 60000 && r.mm.cost === 36000 && r.mm.net === 19000, r.mm);
    ok(tag + ' five charts (12 months, top items, payment, staff, expenses)', r.figs.length === 5, r.figs);
    ok(tag + ' 12 month columns', r.cols === 12, r.cols);
    ok(tag + ' two tables: month by month and top items', r.tables.length === 2, r.tables.length);
    const mt = r.tables[0] || [], it = r.tables[1] || [];
    ok(tag + ' month table: this month row, last month row, total row', mt.length === 4 && /60,000/.test(mt[1].join('|')) && /50,000/.test(mt[2].join('|')) && /110,000/.test(mt[3].join('|')) && /45,000/.test(mt[3].join('|')), mt);
    ok(tag + ' month table margin 31.7%', /31\.7%/.test(mt[1]?.join('|')), mt[1]);
    ok(tag + ' top items: Panadol 40,000 first, 4 units, profit 16,000', /Panadol/.test(it[1]?.[0]) && it[1][1] === '4' && /40,000/.test(it[1][2]) && /16,000/.test(it[1][3]), it);
    ok(tag + ' totals: sales, receipts 3, average 20,000, net profit 19,000', r.kpis.length === 4 && /60,000/.test(r.kpis[0]) && /3/.test(r.kpis[1]) && /20,000/.test(r.kpis[2]) && /19,000/.test(r.kpis[3]), r.kpis);
    ok(tag + ' no sideways page scroll', r.wide);
    // a tap on last month in the table opens it
    await p.click('table.rep [data-xrepm]:nth-of-type(1) >> nth=1'); await p.waitForTimeout(200);
    ok(tag + ' tapping last month opens it', await p.evaluate(() => S.repM === __mon(1)), await p.evaluate(() => S.repM));
    if (lang === 'ar') { const left = await p.evaluate(() => [...document.querySelectorAll('#view .repch figcaption, #view table.rep th, #view h3, #view .kpis .l')].map(x => x.textContent.trim()).filter(t => /[A-Za-z]{3,}/.test(t)));
      ok(tag + ' Arabic: chart titles, headings and table heads translated', !left.length, left); }
    // staff with Reports but not Money: no profit anywhere
    await p.evaluate(() => { S.staff = E.staff.find(x => x.id === 'ST-A'); S.repM = __mon(0); render(); }); await p.waitForTimeout(200);
    const st = await p.evaluate(() => ({tab:S.tab, heads:[...document.querySelectorAll('#view table.rep th')].map(x => x.textContent), kpis:document.querySelectorAll('#view .kpis .kpi').length, ser:[...document.querySelectorAll('#view .repch .chleg')].length}));
    ok(tag + ' pharmacist sees no profit or cost columns', st.tab === 'reports' && !st.heads.some(h => /Profit|Cost|Margin|ربح|كلفة|هامش/.test(h)) && st.kpis === 3, st);
    ok(tag + ' no page errors', !errs.length, errs);
    if (process.env.SHOTS) { await p.evaluate(() => { S.staff = E.staff.find(x => x.id === 'ST-O'); render(); }); await p.screenshot({ path: `${process.env.SHOTS}/rep-${w}-${lang}.png`, fullPage: true }); }
    await p.close();
  }
  console.log(fails ? `${fails} FAILED` : 'PASS all reports overview checks'); await b.close(); process.exit(fails ? 1 : 0);
})();
