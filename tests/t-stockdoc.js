const ROOT = require('path').resolve(__dirname, '..'); // repo folder: src, dist, tests
// Stock from a PDF or photo (roadmap phase B, 27 Nov 2026): the supplier's invoice is attached to the invoice form and stays
// in view while the lines are typed by hand. Every save first shows a check screen: nothing is saved and stock does not
// change until Confirm; blank batch, expiry and price stay blank; a qty with no value can be joined to the line above as
// bonus; "براد" without Refrigerated ticked is flagged. Runs on the installed app (real device storage), phone and wide, EN and AR.
const { chromium } = require('./pw');
let fails = 0; const ok = (m, c, x) => { console.log(c ? 'ok  ' : 'FAIL', m, x === undefined ? '' : JSON.stringify(x)); if (!c) fails++; };
const W = (p, ms = 300) => p.waitForTimeout(ms);
(async () => {
  const b = await chromium.launch();
  // a big "phone photo" (PNG) and a one-page PDF made by the browser itself
  const mk = await b.newPage({ viewport: { width: 1500, height: 2600 } });
  await mk.setContent('<body style="margin:0;font:40px sans-serif;background:#fff"><h1>Oceansky test invoice</h1><p>Clexane 6000IU (براد) 4 × 100,000</p></body>');
  const PNG = await mk.screenshot({ fullPage: true }), PDF = await mk.pdf({ width: '210mm', height: '297mm' }); await mk.close();
  for (const [w, h, lang] of [[390, 844, 'en'], [1280, 800, 'ar']]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } }), p = await ctx.newPage(), tag = `[${w} ${lang}]`;
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:8765/index.html'); await W(p, 1200);
    await p.evaluate(() => write('suppliers/SUP-001', { id: 'SUP-001', name: 'Oceansky', nameAr: '', creditDays: 30, discountTiers: [] })); await W(p, 400);
    if (lang === 'ar') { await p.click('#langBtn'); await W(p, 400); }
    const blobs = () => p.evaluate(() => new Promise(res => { const r = indexedDB.open('raihana-erp'); r.onsuccess = () => { const q = r.result.transaction('blobs').objectStore('blobs').getAll(); q.onsuccess = () => { res(q.result.map(x => ({ size: x.size, type: x.type }))); r.result.close(); }; }; }));
    const nb0 = (await blobs()).length;

    // 1. Stock screen: "+ Stock from PDF or photo" opens a new invoice and the file picker
    await p.click('nav.tabs [data-tab="stock"]'); await W(p);
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-xstockdoc]')]);
    ok(tag + ' picker takes PDF and photos, several at once', fc.isMultiple() && /pdf/.test(await fc.element().getAttribute('accept')));
    await fc.setFiles([{ name: 'invoice-p1.png', mimeType: 'image/png', buffer: PNG }, { name: 'invoice-p2.pdf', mimeType: 'application/pdf', buffer: PDF }]); await W(p, 1200);
    await p.click('#invDoc [data-xdocpage="1"]'); await W(p, 500);
    let doc = await p.evaluate(() => ({ pages: document.querySelectorAll('#invDoc [data-xdocpage]').length, iframe: !!document.querySelector('#invDoc iframe[src^="blob:"]'), docs: S.draft.docs?.map(d => d.type), form: !!document.querySelector('#invForm') }));
    ok(tag + ' both files attached, the PDF shows in the form', doc.form && doc.pages === 2 && doc.iframe && doc.docs.join() === 'image/jpeg,application/pdf', doc);
    const bl = await blobs();
    ok(tag + ' both kept on the device; the photo made smaller (JPEG)', bl.length === nb0 + 2 && bl.some(x => x.type === 'image/jpeg' && x.size < PNG.length), { n: bl.length - nb0, png: PNG.length, kept: bl.map(x => x.size) });
    await p.click('#invDoc [data-xdocpage="0"]'); await W(p, 500);
    doc = await p.evaluate(() => { const im = document.querySelector('#invDoc img'); return { src: im?.src.slice(0, 5), w: im?.naturalWidth, sticky: getComputedStyle(document.querySelector('#invDoc')).position }; });
    ok(tag + ' photo page shows and stays in view (sticky)', doc.src === 'blob:' && doc.w > 0 && doc.sticky === 'sticky', doc);
    await p.click('#invDoc [data-xdoczoom="1"]'); await W(p, 100);
    ok(tag + ' zoom makes the photo bigger', await p.evaluate(() => document.querySelector('#invDoc img').getBoundingClientRect().width > document.querySelector('#invDoc .dv').clientWidth));
    if (w >= 1000) { const g = await p.evaluate(() => ({ wide: document.querySelector('#sheet .panel').classList.contains('withdoc'), d: document.querySelector('#invDoc').getBoundingClientRect().toJSON(), f: document.querySelector('#invForm').getBoundingClientRect().toJSON() }));
      ok(tag + ' wide screen: invoice copy beside the form', g.wide && Math.abs(g.d.top - g.f.top) < 400 && (g.d.right <= g.f.left + 2 || g.f.right <= g.d.left + 2), g); }

    // 2. type the lines by hand
    const line = async (k, f, v) => p.fill(`#lines .lineedit:nth-child(${k}) [data-f="${f}"]`, v);
    await p.fill('#fNo', 'OS-777'); await p.fill('#fTotal', '425000');
    await line(1, 'desc', 'Clexane 6000IU 60mg/0.6ml 2 PFS (براد)'); await p.dispatchEvent('#lines .lineedit:nth-child(1) [data-f="desc"]', 'change');
    await line(1, 'qty', '4'); await line(1, 'price', '100000'); await line(1, 'value', '400000'); await line(1, 'batch', 'TB1'); await line(1, 'expiry', '2028-05');
    await p.uncheck('#lines .lineedit:nth-child(1) [data-f="cold"]');
    await p.click('#addLine'); await line(2, 'desc', 'Clexane 6000IU 60mg/0.6ml 2 PFS (براد)'); await line(2, 'qty', '1');
    await p.click('#addLine'); await line(3, 'desc', 'Panadol 500 mg 24 Tabs'); await line(3, 'qty', '10'); await line(3, 'price', '2500'); await line(3, 'value', '25000');
    const n0 = await p.evaluate(() => S.invoices.length);

    // 3. Save shows the check screen; nothing saved yet
    await p.click('#invForm button[type=submit]'); await W(p, 500);
    let rv = await p.evaluate(() => ({ on: !!document.querySelector('#invReview') && getComputedStyle(document.querySelector('#invForm')).display === 'none', doc: !!document.querySelector('#invDoc'), n: S.invoices.length,
      bonus: [...document.querySelectorAll('[data-xrvbonus]')].map(x => x.dataset.xrvbonus), cold: [...document.querySelectorAll('[data-xrvcold]')].map(x => x.dataset.xrvcold), text: document.querySelector('#invReview').innerText }));
    ok(tag + ' Save shows the check screen, with the invoice copy still in view', rv.on && rv.doc, rv.on);
    ok(tag + ' nothing saved before Confirm', rv.n === n0, [n0, rv.n]);
    ok(tag + ' line with qty and no value: offered as bonus for the line above', rv.bonus.join() === '1', rv.bonus);
    ok(tag + ' براد without Refrigerated ticked is flagged', rv.cold.join() === '0', rv.cold);
    ok(tag + ' missing batch and expiry are named, not filled in', lang === 'ar' ? /الوجبة غير مذكورة/.test(rv.text) && /الصلاحية غير مذكورة/.test(rv.text) : /Batch not provided/.test(rv.text) && /Expiry not provided/.test(rv.text), rv.text.slice(0, 300));
    if (lang === 'ar') ok(tag + ' check screen is in Arabic', /راجع قبل الإضافة إلى المخزون/.test(rv.text) && !/Check before adding|Confirm and add/.test(rv.text), rv.text.slice(0, 200));

    // 4. fixes from the check screen go back into the form, then it checks again
    await p.click('[data-xrvbonus="1"]'); await W(p, 400);
    await p.click('[data-xrvcold="0"]'); await W(p, 400);
    rv = await p.evaluate(() => ({ on: !!document.querySelector('#invReview'), lines: document.querySelectorAll('#invReview .rvline').length, cold: document.querySelectorAll('[data-xrvcold]').length, form: readLines().map(l => [l.qty, l.bonus, l.cold]) }));
    ok(tag + ' bonus joined to line 1 and Refrigerated ticked', rv.on && rv.lines === 2 && rv.cold === 0 && JSON.stringify(rv.form) === JSON.stringify([[4, 1, true], [10, null, false]]), rv);
    await p.click('[data-xrvback]'); await W(p, 300);
    ok(tag + ' Back to edit shows the form with everything kept', await p.evaluate(() => !document.querySelector('#invReview') && getComputedStyle(document.querySelector('#invForm')).display !== 'none' && $('#fNo').value === 'OS-777' && document.querySelectorAll('#lines .lineedit').length === 2));
    await p.click('#invForm button[type=submit]'); await W(p, 400);
    // a near match to an item already in stock may ask first (not here: the shop is empty)
    await p.click('[data-xrvok]'); await W(p, 900);
    const saved = await p.evaluate(() => { const i = S.invoices.find(x => x.invoiceNo === 'OS-777'); const cl = catalog().find(x => /Clexane/.test(x.name)); return i && { docs: i.docs?.length, photo: !!i.photo, l: i.lines.map(l => [l.qty, l.bonus ?? null, l.batch, l.expiry, l.cold, l.price ?? null]), open: !document.querySelector('#sheet').hidden, stock: cl ? stockOf(cl, usedMap(true)).good / cl.sub : null }; });
    ok(tag + ' Confirm saves the invoice with both copies', saved && saved.docs === 2 && !saved.open, saved);
    ok(tag + ' blank batch and expiry stay blank', saved && JSON.stringify(saved.l[1]) === JSON.stringify([10, null, '', '', false, 2500]), saved?.l);
    ok(tag + ' stock goes up by paid + bonus (4 + 1 boxes)', saved && saved.stock === 5, saved?.stock);

    // 5. the invoice page shows the copies; editing it checks the change first
    const id = await p.evaluate(() => S.invoices.find(x => x.invoiceNo === 'OS-777').id);
    await p.evaluate(id => invoiceDetail(id), id); await W(p, 300);
    await p.evaluate(() => document.querySelector('details.invdocs')?.setAttribute('open', '')); await W(p, 600);
    const det = await p.evaluate(() => ({ n: document.querySelectorAll('details.invdocs .dv').length, img: document.querySelector('details.invdocs img')?.src.slice(0, 5) }));
    ok(tag + ' invoice page lists both copies', det.n === 2 && det.img === 'blob:', det);
    await p.evaluate(id => invoiceForm(id), id); await W(p, 400);
    ok(tag + ' edit form shows the copies too', await p.evaluate(() => document.querySelectorAll('#invDoc [data-xdocpage]').length === 2));
    await line(1, 'qty', '6'); await p.fill('#fTotal', '625000'); await p.click('#invForm button[type=submit]'); await W(p, 400);
    rv = await p.evaluate(() => ({ t: document.querySelector('#invReview h2')?.textContent, ch: document.querySelector('#invReview .rvline .r .num')?.textContent, n: S.invoices.find(x => x.invoiceNo === 'OS-777').lines[0].qty }));
    ok(tag + ' edit: check screen shows the change (+2) before saving', /Check the changes|راجع التغييرات/.test(rv.t) && rv.ch === '+2' && rv.n === 4, rv);
    await p.click('[data-xrvok]'); await W(p, 800);
    ok(tag + ' edit saved after Confirm', await p.evaluate(() => S.invoices.find(x => x.invoiceNo === 'OS-777').lines[0].qty === 6));

    // 6. removing a copy, and a closed form leaves no wide window behind
    await p.evaluate(id => invoiceForm(id), id); await W(p, 400);
    await p.click('#invDoc [data-xdocdel="0"]'); await W(p, 300);
    ok(tag + ' a copy can be removed from the form', await p.evaluate(() => S.draft.docs.length === 1 && document.querySelectorAll('#invDoc [data-xdocpage]').length === 0 && !!document.querySelector('#invDoc iframe')));
    await p.keyboard.press('Escape'); await W(p, 200); await p.evaluate(() => openSheet('x', '<p>x</p>')); await W(p, 100);
    ok(tag + ' other windows are normal width again', await p.evaluate(() => !document.querySelector('#sheet .panel').classList.contains('withdoc')));
    await p.keyboard.press('Escape');
    ok(tag + ' no page errors', errs.length === 0, errs);
    await ctx.close();
  }
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'PASS all'); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH', e); process.exit(1); });
