const ROOT = require('path').resolve(__dirname, '..'); // repo folder: src, dist, tests
// Excel/CSV upload: fill a new purchase invoice and a stocktaking count from a file, check nothing is invented or saved early
const { chromium, XLSX_FILE } = require('./pw');
const fs = require('fs'), path = require('path'), XLSX = require(XLSX_FILE.replace(/dist\/xlsx\.full\.min\.js$/, ''));
const D = path.join(__dirname, 'fixtures'), TMP = path.join(__dirname, 'tmp-upload'); fs.mkdirSync(TMP, { recursive: true });
let fails = 0; const ok = (c, m, x) => { console.log(c ? 'ok  ' : 'FAIL', m, x === undefined ? '' : JSON.stringify(x)); if (!c) fails++; };
// an invoice sheet the way a drugstore might send it: Arabic headers, an Excel date, a bonus row, a total row, a blank batch and a bad expiry
const invRows = [['فاتورة مذخر تجريبي'], ['المادة', 'الكمية', 'السعر', 'القيمة', 'الوجبة', 'الصلاحية', 'خصم %'],
  ['Clexane 6000IU 60mg/0.6ml 2 PFS (براد)', 4, 100000, 400000, 'TB900', 46874, ''],
  ['Clexane 6000IU 60mg/0.6ml 2 PFS (براد)', 1, '', '', '', '', ''],
  ['Panadol 500 mg 24 Tabs', 10, 2500, 25000, '', '05/2027', 10],
  ['Brufen 400 mg 30 Tabs', 3, '', 9000, 'B-7', 'soon', ''],
  ['المجموع', '', '', 434000, '', '', '']];
const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(invRows), 'Invoice');
const INV_FILE = path.join(TMP, 'invoice.xlsx'); XLSX.writeFile(wb, INV_FILE);
(async () => {
  const b = await chromium.launch();
  for (const [w, h, lang] of [[390, 844, 'en'], [1280, 800, 'ar']]) {
    const p = await b.newPage({ viewport: { width: w, height: h } }); const errs = []; p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
    await p.route('**/xlsx.full.min.js', r => r.fulfill({ path: XLSX_FILE, contentType: 'text/javascript' }));
    await p.addInitScript({ path: path.join(__dirname, 'fake.js') }); await p.goto('file://' + ROOT + '/tests/erp-artifact-test.html'); await p.waitForTimeout(700);
    const rd = f => JSON.parse(fs.readFileSync(path.join(D, f)));
    await p.evaluate(([i, s]) => { __seed('suppliers', [s]); __seed('invoices', [i]); }, [rd('invoices/PI-2026-0001.json'), rd('suppliers/SUP-001.json')]); await p.waitForTimeout(400);
    if (lang === 'ar') { await p.click('#langBtn'); await p.waitForTimeout(300); }
    const tag = `[${w} ${lang}]`;

    // ---- invoice from a file ----
    await p.click('#addBtn'); await p.waitForTimeout(300); await p.fill('#fNo', 'X-77');
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-xinvfile="1"]')]); await fc.setFiles(INV_FILE); await p.waitForTimeout(500);
    const sheet = await p.evaluate(() => ({ title: document.querySelector('#sheet h2, #sheet .hd, #sheet [id$=Title]')?.textContent, n: S.invImp?.lines.length, merged: S.invImp?.merged, skipped: S.invImp?.skipped, flags: S.invImp?.flags, text: document.querySelector('#sheet').innerText }));
    ok(sheet.n === 3 && sheet.merged === 1 && sheet.skipped >= 1, tag + ' invoice file: 3 lines, bonus row joined, total row left out', { n: sheet.n, merged: sheet.merged, skipped: sheet.skipped });
    ok(sheet.flags.some(f => /expiry "soon"/.test(f)), tag + ' bad expiry is flagged, not guessed', sheet.flags);
    const writes0 = await p.evaluate(() => __writes);
    await p.click('[data-xiifill="1"]'); await p.waitForTimeout(400);
    const form = await p.evaluate(() => ({ no: $('#fNo').value, lines: readLines().map(l => ({ desc: l.desc, qty: l.qty, bonus: l.bonus, price: l.price, value: l.value, batch: l.batch, expiry: l.expiry, cold: l.cold, discPct: l.discPct })), banner: document.querySelector('#sheet .banner')?.innerText, writes: __writes }));
    ok(form.no === 'X-77', tag + ' invoice number typed before the upload is kept', form.no);
    ok(form.lines.length === 3, tag + ' the empty starting line is replaced by the file lines', form.lines.length);
    const [l1, l2, l3] = form.lines;
    ok(l1.qty === 4 && l1.bonus === 1 && l1.price === 100000 && l1.batch === 'TB900' && l1.expiry === '2028-05' && l1.cold, tag + ' line 1: bonus joined, Excel date read as 2028-05, refrigerated from (براد)', l1);
    ok(l2.expiry === '2027-05' && l2.batch === '' && l2.discPct === 10 && !l2.cold, tag + ' line 2: 05/2027 read, blank batch stays blank, 10% discount', l2);
    ok(l3.price === null && l3.expiry === '' && l3.value === 9000, tag + ' line 3: no price and bad expiry stay blank', l3);
    ok(form.writes === writes0, tag + ' nothing saved before Save invoice', [writes0, form.writes]);
    ok(lang === 'ar' ? !/Filled from the file|Check every line/.test(form.banner) : /invoice\.xlsx/.test(form.banner), tag + ' banner names the file' + (lang === 'ar' ? ' in Arabic' : ''), form.banner);
    await p.fill('#fTotal', '433000'); await p.click('#invForm button[type=submit]'); await p.waitForTimeout(700);
    const saved = await p.evaluate(() => S.invoices.find(i => i.invoiceNo === 'X-77'));
    ok(saved && saved.lines.length === 3 && saved.lines[1].batch === '' && saved.lines[2].price == null && saved.extraction?.source === 'file', tag + ' invoice saved with the file lines as checked', saved && { lines: saved.lines.length, src: saved.extraction?.source });
    if (await p.evaluate(() => !document.querySelector('#sheet').hidden)) { await p.keyboard.press('Escape'); await p.waitForTimeout(200); }

    // ---- stocktaking count from a file ----
    const cat = await p.evaluate(() => catalog().map(x => ({ id: x.id, name: pname(x), sub: x.sub })));
    const a = cat[0], bb = cat[1], words = a.name.split(' ');
    const csv = ['Item,Barcode,Count,Loose', `"${a.name}",,2,`, `"${a.name}",,1,3`, `"${bb.name.split(' ').slice(0, -1).join(' ')} extra",,5,`, '"Not a real medicine",,4,', `"${words[0]} zz",,,`].join('\n');
    const CT_FILE = path.join(TMP, 'count.csv'); fs.writeFileSync(CT_FILE, csv);
    await p.click('nav.tabs [data-tab="stock"]'); await p.waitForTimeout(300); await p.click('[data-xcount="1"]'); await p.waitForTimeout(300);
    const [fc2] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-xctfile="1"]')]); await fc2.setFiles(CT_FILE); await p.waitForTimeout(500);
    const ci = await p.evaluate(() => ({ out: S.ctImp.out.map(o => ({ how: o.how, use: o.use, ok: o.ok })), text: document.querySelector('#sheet').innerText }));
    ok(ci.out.filter(o => o.use).length === 2 && ci.out.some(o => o.how === 'check' && !o.use) && ci.out.some(o => !o.pid && !o.use), tag + ' count file: exact names ticked, close match left for checking, unknown skipped', ci.out);
    ok(lang !== 'ar' || !/ column|Put \d|Back to/.test(ci.text), tag + ' count sheet in Arabic', lang === 'ar' ? ci.text.slice(0, 200) : undefined);
    const w1 = await p.evaluate(() => __writes);
    await p.click('[data-xcifill="1"]'); await p.waitForTimeout(400);
    const cnt = await p.evaluate(id => ({ c: S.count.counts[id], n: Object.keys(S.count.counts).length, sheet: !!document.querySelector('[data-xctsave]'), writes: __writes }), a.id);
    ok(cnt.c === 3 * a.sub + 3 && cnt.n === 1 && cnt.sheet && cnt.writes === w1, tag + ' two rows of the same item add up (2 + 1 boxes + 3 loose), count sheet open, nothing saved yet', { got: cnt.c, want: 3 * a.sub + 3, n: cnt.n });
    await p.click('[data-xctsave="1"]'); await p.waitForTimeout(800);
    const st = await p.evaluate(() => ({ counts: Object.keys(__store.counts || {}).length, moves: Object.keys(__store.moves || {}).length }));
    ok(st.counts === 1, tag + ' saving the count still goes through the normal stocktaking save', st);
    ok(!errs.length, tag + ' no page errors', errs);
    await p.close();
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fails ? `${fails} FAILED` : 'PASS all upload checks'); await b.close(); process.exit(fails ? 1 : 0);
})();
