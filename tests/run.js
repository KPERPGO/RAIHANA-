const ROOT = require('path').resolve(__dirname, '..'); // repo folder: src, dist, tests
const { chromium } = require('./pw'); const fs=require('fs'); const path=require('path');
const APP='file://'+ROOT + '/tests/erp-artifact-test.html';
const results=[]; const ok=(name,cond,info='')=>{results.push([cond?'PASS':'FAIL',name,info]);};
(async()=>{
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:390,height:844}});
const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'){if(!/ERR_FILE_NOT_FOUND/.test(m.text()))errs.push('console: '+m.text())}});
await p.addInitScript({path:'fake.js'});
await p.route('**/xlsx.full.min.js',r=>r.fulfill({path:require('./pw').XLSX_FILE,contentType:'text/javascript'}));
await p.goto(APP); await p.waitForTimeout(600);
const W=ms=>p.waitForTimeout(ms||120);
const ev=(f,a)=>p.evaluate(f,a);
const setv=async(sel,v)=>{await ev(([s,v])=>{const e=document.querySelector(s); if(!e) throw new Error('missing '+s); e.value=v; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));},[sel,String(v)]);};
const click=async sel=>{await ev(s=>{const e=document.querySelector(s); if(!e) throw new Error('no '+s); e.click();},sel); await W();};
const text=sel=>ev(s=>document.querySelector(s)?.textContent.replace(/\s+/g,' ')||'',sel);
const toastTxt=()=>text('#toast');
const store=()=>ev(()=>window.__store);
const D=(n)=>ev(n=>addDays(today(),n),n);
const T=await D(0);
ok('App loads with fake runtime, not read-only', await ev(()=>S.ready && !S.readOnly && !!S.db));

// ---------- 1 suppliers ----------
await ev(()=>{S.tab='suppliers';render();});
await click('[data-act="newSup"]');
await setv('#sName','Test Drugstore'); await setv('#sAr','مذخر تجريبي'); await setv('#sCred','30'); await setv('#sRet','15');
await click('#addTier'); await ev(()=>{const r=document.querySelector('#tiers [data-tier]');r.querySelector('[data-t="days"]').value='7';r.querySelector('[data-t="pct"]').value='10';});
await click('#supForm button[type=submit]'); await W(200);
let st=await store(); ok('Add supplier saves with credit days, return days, 10% within 7 days', st.suppliers['SUP-001']?.creditDays===30 && st.suppliers['SUP-001']?.discountTiers?.[0]?.pct===0.1, JSON.stringify(st.suppliers['SUP-001']));
await click('[data-act="newSup"]'); await click('#supForm button[type=submit]');
ok('Supplier form requires a name', /Enter the supplier/.test(await text('#supErr')));
await setv('#sName','Al-Rafidain'); await click('#supForm button[type=submit]'); await W(200);

// ---------- 2 invoices ----------
async function addInvoice({sup='SUP-001',no,date,type='credit',total,lines,disc,discMode,prev}){
  await ev(()=>invoiceForm()); await W();
  await ev(([s])=>{document.querySelector('#fSup').value=s;},[sup]);
  await setv('#fNo',no); await setv('#fDate',date); await ev(([t])=>{document.querySelector('#fType').value=t},[type]);
  await setv('#fTotal',total); if(disc!==undefined){await setv('#fDisc',disc); await ev(([m])=>{document.querySelector('#fDiscMode').value=m},[discMode||'IQD']);}
  if(prev!==undefined) await setv('#fPrev',prev);
  for(let k=0;k<lines.length;k++){ if(k>0) await click('#addLine'); const L=lines[k];
    const q=f=>`#lines .lineedit:nth-child(${k+1}) [data-f="${f}"]`;
    for(const [f,v] of Object.entries(L)){ if(f==='cold'){await ev(([s,v])=>{document.querySelector(s).checked=v},[q('cold'),v]);continue;}
      if(['bonusMode','discMode','blisters'].includes(f)){await ev(([s,v])=>{const e=document.querySelector(s);e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}))},[q(f),v]);continue;}
      await setv(q(f),v);} }
  await W(); const live=await text('#liveSum');
  await click('#invForm button[type=submit]'); await W(250);
  return {live, err:await text('#formErr'), toast:await toastTxt()};
}
let r=await addInvoice({no:'A100',date:await D(-3),total:'190,000',lines:[
  {desc:'( براد ) Clexane ** 6000IU 60mg/0.6ml 2 Syringes Sanofi',qty:10,price:10000,value:100000,batch:'B1',expiry:'2027-01'},
  {desc:'Augmentin 1g 14 Tabs GSK',qty:10,price:10000,value:100000,discIn:10,discMode:'%',bonusIn:2,bonusMode:'packs',batch:'B2',expiry:await ev(()=>addDays(today(),40).slice(0,7))}]});
st=await store(); let A=Object.values(st.invoices).find(i=>i.invoiceNo==='A100');
ok('Add invoice: saved with Processing ID and toast', !!A && /Saved PI-/.test(r.toast), r.err+' '+r.toast);
ok('Line discount % applied: total 190,000 after 10% on line 2', A && Math.round(await ev(i=>calc(i).total,A))===190000, r.live);
ok('Status Awaiting Approval when totals match', A?.status==='Awaiting Approval', A?.status);
ok('Bonus packs stored', A?.lines?.[1]?.bonus===2);
ok('Refrigerated detected from (براد)', await ev(i=>attrs(i.lines[0]).fridge,A));
ok('Name/dose/form parsed from description', await ev(i=>{const a=attrs(i.lines[0]);return a.name==='Clexane'&&a.form==='Prefilled syringe'},A), JSON.stringify(await ev(i=>attrs(i.lines[0]),A)));
ok('Debt is automatic: new unapproved invoice counts in what you owe', Math.round(await ev(()=>balance('SUP-001').bal))===190000);
ok('Live form summary shows the difference from printed', /Difference from printed\s*0 IQD/.test(r.live), r.live);

r=await addInvoice({no:'A100',date:await D(-3),total:'190000',lines:[{desc:'x',qty:1,price:190000,value:190000}]});
ok('Duplicate invoice number blocked', /already in the app/.test(r.err), r.err);
await ev(()=>closeSheet());
r=await addInvoice({no:'A101',date:await D(-1),total:'50000',lines:[{desc:'Panadol 500 mg 24 Tabs',qty:5,price:9000,value:45000}]});
st=await store(); let B=Object.values(st.invoices).find(i=>i.invoiceNo==='A101');
ok('Mismatched total gives Validation Required', B?.status==='Validation Required', B?.status);
r=await addInvoice({no:'A102',date:await D(5),total:'1000',lines:[{desc:'x',qty:1,price:1000,value:1000}]});
ok('Future date rejected', /not in the future/.test(r.err), r.err); await ev(()=>closeSheet());
r=await addInvoice({no:'A103',date:await D(-1),total:'1000',lines:[{desc:'x',qty:1,price:1000,value:1000,expiry:'01/2028'}]});
ok('Bad expiry format rejected', /YYYY-MM/.test(r.err), r.err); await ev(()=>closeSheet());
r=await addInvoice({no:'A104',date:await D(-2),total:'90000',disc:10,discMode:'%',lines:[{desc:'Brufen 400 mg 20 Tabs',qty:10,price:10000,value:100000}]});
st=await store(); let C=Object.values(st.invoices).find(i=>i.invoiceNo==='A104');
ok('Invoice discount % gives 90,000 and matches printed', C && Math.round(await ev(i=>calc(i).total,C))===90000 && C.status==='Awaiting Approval', C?.status);
r=await addInvoice({no:'A105',date:await D(-1),total:'20000',lines:[{desc:'Bonus pct item',qty:20,price:1000,value:20000,bonusIn:10,bonusMode:'%'}]});
st=await store(); let E=Object.values(st.invoices).find(i=>i.invoiceNo==='A105');
ok('Bonus % converts to packs (10% of 20 = 2)', E?.lines?.[0]?.bonus===2, JSON.stringify(E?.lines?.[0]));
// new supplier from invoice form
await ev(()=>invoiceForm()); await ev(()=>{const s=document.querySelector('#fSup');s.value='__new';s.dispatchEvent(new Event('change',{bubbles:true}))});
ok('New supplier field appears', await ev(()=>!document.querySelector('#newSupWrap').hidden));
await setv('#fNewSup','Pioneer'); await setv('#fNo','P1'); await setv('#fDate',T); await setv('#fTotal','5000');
await setv('#lines .lineedit [data-f="desc"]','Item'); await setv('#lines .lineedit [data-f="qty"]','1'); await setv('#lines .lineedit [data-f="price"]','5000'); await setv('#lines .lineedit [data-f="value"]','5000');
await click('#invForm button[type=submit]'); await W(250);
st=await store(); ok('New supplier created from invoice form', Object.values(st.suppliers).some(s=>s.name==='Pioneer') && Object.values(st.invoices).some(i=>i.invoiceNo==='P1'));

// ---------- 3 approval & MyPharma ----------
await ev(id=>invoiceDetail(id),A.id); await W();
ok('Invoice detail opens', /Amount due \(after discount\)/.test(await text('#sheetBody')));
await setv('#apBy',''); await click(`[data-approve="${A.id}"]`);
ok('Approve needs a name', /who approved/.test(await text('#detErr')));
await setv('#apBy','Owner'); await click(`[data-approve="${A.id}"]`); await W(200);
st=await store(); ok('Approve sets Approved for Posting with name and time', st.invoices[A.id].status==='Approved for Posting' && st.invoices[A.id].approvedBy==='Owner');
await ev(id=>invoiceDetail(id),A.id); await W(); await setv('#mRef',''); await click(`[data-posted="${A.id}"]`);
ok('Posted needs a MyPharma number', /MyPharma gave it/.test(await text('#detErr')));
await setv('#mRef','MP-555'); await click(`[data-posted="${A.id}"]`); await W(200);
st=await store(); ok('Save MyPharma number sets Posted to Mercato', st.invoices[A.id].status==='Posted to Mercato' && st.invoices[A.id].mercatoRef==='MP-555');
await ev(id=>invoiceDetail(id),A.id); await W(); await click(`[data-recon="${A.id}"]`); await W(200);
st=await store(); ok('Checked against MyPharma sets Reconciled', st.invoices[A.id].status==='Reconciled');
await ev(id=>invoiceDetail(id),B.id); await W();
ok('Approve disabled while totals do not match', await ev(id=>document.querySelector(`[data-approve="${id}"]`).disabled,B.id));
await click(`[data-hold="${B.id}"]`); await W(200); st=await store(); ok('Put on hold', st.invoices[B.id].status==='On Hold');
await ev(id=>invoiceDetail(id),B.id); await W(); await click(`[data-hold="${B.id}"]`); await W(200); st=await store(); ok('Release hold returns to Validation Required', st.invoices[B.id].status==='Validation Required');
// fix B by editing (not booked, no reason needed)
await ev(id=>invoiceForm(id),B.id); await W(); await setv('#fTotal','45000'); await click('#invForm button[type=submit]'); await W(250);
st=await store(); ok('Editing a fixed total moves it to Awaiting Approval', st.invoices[B.id].status==='Awaiting Approval', st.invoices[B.id].status);

// ---------- 4 payments ----------
await ev(()=>{S.tab='invoices';S.filter='all';render();}); await W();
await click(`[data-markpaid="${A.id}"]`); await W();
ok('Mark paid opens with outstanding filled', +(await ev(()=>document.querySelector('#pAmt').value))===171000 || +(await ev(()=>document.querySelector('#pAmt').value))===190000, await ev(()=>document.querySelector('#pAmt').value));
await setv('#pDisc',''); await ev(()=>{document.querySelector('#pDiscMode').value='%';}); await setv('#pDisc','10');
ok('10% discount recalculates the amount to pay to 171,000', +(await ev(()=>document.querySelector('#pAmt').value))===171000, await ev(()=>document.querySelector('#pAmt').value)+' | '+await text('#paySum'));
await setv('#pRec','R-1'); await click('#payForm button[type=submit]'); await W(250);
st=await store(); let P1=Object.values(st.payments).find(x=>x.invoiceId===A.id);
ok('Payment saved: 171,000 cash + 19,000 discount, verified', P1 && P1.amount===171000 && P1.discount===19000 && P1.verified, JSON.stringify(P1));
ok('Invoice now Paid, outstanding 0', await ev(id=>{const i=S.invoices.find(x=>x.id===id);const c=calc(i);return c.payStatus==='Paid'&&Math.abs(c.outstanding)<1},A.id));
await ev(()=>{S.tab='invoices';render();}); await click(`[data-markpaid="${A.id}"]`);
ok('Mark paid again says already paid', /Already paid/.test(await toastTxt()));
// paid numbers everywhere
const paidCheck=await ev(id=>{const out={};const g=(t)=>{const m=[...t.matchAll(/(Paid before discount|Paid after discount \(cash\)|Total paid before discount|Total paid after discount \(cash\))\s*([\d,]+)/g)].map(x=>x[1]+'='+x[2]);return m};
 invoiceDetail(id); out.inv=g(document.querySelector('#sheetBody').textContent.replace(/\s+/g,' ')); closeSheet();
 S.tab='payments';render(); out.pay=g(document.querySelector('#view').textContent.replace(/\s+/g,' '));
 S.tab='suppliers';S.supOpen='SUP-001';render(); out.sup=g(document.querySelector('#view').textContent.replace(/\s+/g,' '));
 return out;},A.id);
const allPaid=[...paidCheck.inv,...paidCheck.pay,...paidCheck.sup].filter(x=>!/=0$/.test(x)).join(' ');
ok('Paid before (190,000) and after (171,000) match in invoice, payments, supplier', !/=(?!190,000|171,000)/.test(allPaid.replace(/(before discount=190,000|\(cash\)=171,000)/g,'')) , JSON.stringify(paidCheck));
// partial payment + overpay
await ev(id=>paymentForm(id),C.id); await W(); await setv('#pDisc',''); await setv('#pAmt','50000'); await ev(()=>document.querySelector('#pVer').checked=true); await click('#payForm button[type=submit]'); await W(250);
ok('Partial payment: invoice Partly paid, 40,000 left', await ev(id=>{const c=calc(S.invoices.find(x=>x.id===id));return c.payStatus==='Partly paid'&&Math.round(c.outstanding)===40000},C.id), await text('#payErr')+' | '+JSON.stringify(await ev(id=>{const c=calc(S.invoices.find(x=>x.id===id));return [c.payStatus,c.outstanding,S.saving,document.querySelector('#sheetTitle').textContent,Object.keys(window.__store.payments).length,document.querySelector('#toast').textContent]},C.id)));
await ev(id=>paymentForm(id),C.id); await W(); await setv('#pDisc',''); await setv('#pAmt','60000'); await click('#payForm button[type=submit]'); await W(150);
ok('Overpay blocked', /more than the/.test(await text('#payErr')), await text('#payErr')); await ev(()=>closeSheet());
// unverified payment
await ev(id=>paymentForm(id),E.id); await W(); await setv('#pDisc',''); await setv('#pAmt','20000'); await ev(()=>document.querySelector('#pVer').checked=false); await click('#payForm button[type=submit]'); await W(250);
ok('Unverified payment does not reduce the debt', await ev(id=>Math.round(calc(S.invoices.find(x=>x.id===id)).outstanding)===20000,E.id));
await ev(id=>paymentForm(id),E.id); await W();
ok('Second payment blocked while one is unverified', /unverified payment/.test(await text('#paySum')), await text('#paySum')); await ev(()=>closeSheet());
let PU=Object.values(await ev(()=>window.__store.payments)).find(x=>x.invoiceId===E.id);
await ev(id=>paymentDetail(id),PU.id); await W(); await click(`[data-payver="${PU.id}"]`); await W(250);
ok('Verifying the receipt makes it count', await ev(id=>calc(S.invoices.find(x=>x.id===id)).payStatus==='Paid',E.id));
// edit payment needs reason
await ev(([inv,pid])=>paymentForm(inv,false,pid),[A.id,P1.id]); await W(); await setv('#pRec','R-1b'); await click('#payForm button[type=submit]'); await W(150);
ok('Editing a payment needs a reason', /reason/.test(await text('#payErr')));
await setv('#pReason','receipt number typo'); await click('#payForm button[type=submit]'); await W(250);
st=await store(); ok('Payment edit saved with history', st.payments[P1.id].receiptNo==='R-1b' && st.payments[P1.id].history?.length===1);
// mark debt -> void
await ev(()=>{S.tab='invoices';render();}); await click(`[data-markdebt="${A.id}"]`); await W();
const dp=await ev(()=>document.querySelector('[data-delpay]')?.dataset.delpay);
if(dp){await click(`[data-delpay="${dp}"]`); await click(`[data-delpay="${dp}"]`); await W(400);}
st=await store(); ok('Mark as debt cancels the payment (kept, marked voided)', st.payments[P1.id]?.voided===true);
ok('Invoice is debt again after cancelling', await ev(id=>Math.round(calc(S.invoices.find(x=>x.id===id)).outstanding)===190000,A.id));
await ev(()=>closeSheet());
// pay again with IQD discount
await ev(id=>paymentForm(id,true),A.id); await W(); await ev(()=>{document.querySelector('#pDiscMode').value='IQD'}); await setv('#pDisc','19000');
ok('IQD discount recalculates amount to 171,000', +(await ev(()=>document.querySelector('#pAmt').value))===171000);
await setv('#pDate',await D(-1)); await click('#payForm button[type=submit]'); await W(250);

// ---------- 5 edit approved/paid invoice ----------
await ev(id=>invoiceForm(id),A.id); await W(); await setv('#fDate',await D(-4));
await click('#invForm button[type=submit]'); await W(150);
ok('Editing a paid/approved invoice asks for a reason', /reason/.test(await text('#formErr')), await text('#formErr')+' | '+await text('#sheetTitle')+' | '+await toastTxt()+' | '+JSON.stringify(await ev(id=>{const i=S.invoices.find(x=>x.id===id);return [i.status,i.notes]},A.id)));
await setv('#fReason','note added'); await click('#invForm button[type=submit]'); await W(250);
st=await store(); ok('Same amount keeps approval status, change logged', st.invoices[A.id].status==='Reconciled' && (st.invoices[A.id].history||[]).some(h=>h.reason==='note added'), st.invoices[A.id].status);
await ev(id=>invoiceForm(id),A.id); await W(); await setv('#fTotal','180000'); await setv('#lines .lineedit:nth-child(1) [data-f="price"]','9000'); await setv('#lines .lineedit:nth-child(1) [data-f="value"]','90000'); await setv('#fReason','supplier credit'); await click('#invForm button[type=submit]'); await W(250);
st=await store(); ok('Changing the amount of an approved invoice sends it back to approval and flags MyPharma', st.invoices[A.id].status==='Awaiting Approval' && /MyPharma/.test(st.invoices[A.id].notes||''), st.invoices[A.id].status+' '+st.invoices[A.id].notes);
ok('Paid invoice that now costs less shows supplier owes you 10,000', await ev(id=>Math.round(calc(S.invoices.find(x=>x.id===id)).outstanding)===-10000,A.id), await ev(id=>calc(S.invoices.find(x=>x.id===id)).outstanding,A.id));

// ---------- 6 returns ----------
await ev(id=>creditForm({supplierId:'SUP-001',invoiceId:id}),C.id); await W();
ok('Return picker lists the invoice items', /Brufen/.test(await text('#cPick')));
await ev(()=>crSetQty(0,2)); await W();
const cAmt=+(await ev(()=>document.querySelector('#cAmt').value));
ok('Picking 2 units fills the amount (2 × 9,000 = 18,000)', cAmt===18000, cAmt);
await ev(()=>document.querySelector('#cVer').checked=true); await click('#crForm button[type=submit]'); await W(250);
ok('Confirmed return lowers the debt', await ev(id=>Math.round(calc(S.invoices.find(x=>x.id===id)).outstanding)===22000,C.id), await ev(id=>calc(S.invoices.find(x=>x.id===id)).outstanding,C.id));
await ev(id=>creditForm({supplierId:'SUP-001',invoiceId:id}),C.id); await W();
ok('Already returned units are taken off the picker max (10-2=8)', await ev(()=>document.querySelector('[data-cq="0"]').dataset.max)==='8');
await ev(()=>closeSheet());

// ---------- 7 receiving ----------
await ev(id=>recvSheet(id),B.id); await W();
await ev(()=>{const el=document.querySelector('#rcForm [data-rl="0"] [data-r="qty"]');el.value='3';el.dispatchEvent(new Event('input',{bubbles:true}));const s=document.querySelector('#rcForm [data-rl="0"] [data-r="issue"]');s.value='Short';s.dispatchEvent(new Event('change',{bubbles:true}))});
await click('#rcForm button[type=submit]'); await W(300);
st=await store(); ok('Receiving with a shortage saves discrepancy', st.invoices[B.id].receiving==='discrepancy', st.invoices[B.id].receiving);
ok('Shortage opens a return pre-filled with the missing value (2 × 9,000)', await ev(()=>document.querySelector('#cAmt')?.value)==='18000', await ev(()=>document.querySelector('#cAmt')?.value));
await ev(()=>closeSheet());
await ev(id=>invoiceDetail(id),C.id); await W(); await click(`[data-recv="complete"][data-id="${C.id}"]`); await W(200);
st=await store(); ok('All received as invoiced', st.invoices[C.id].receiving==='complete');

// ---------- 8 cash due & late alerts ----------
r=await addInvoice({no:'CASH1',date:await D(-10),type:'cash',total:'10000',lines:[{desc:'Cash item',qty:1,price:10000,value:10000}]});
r=await addInvoice({no:'OLD1',date:await D(-40),type:'credit',total:'7000',lines:[{desc:'Old item',qty:1,price:7000,value:7000}]});
const lt=await ev(()=>({cash:calc(S.invoices.find(i=>i.invoiceNo==='CASH1')), old:calc(S.invoices.find(i=>i.invoiceNo==='OLD1')), cash2:S.invoices.find(i=>i.invoiceNo==='CASH1')}));
ok('Cash invoice due within 7 days', lt.cash.due===await ev(d=>addDays(d,7),lt.cash2.date), lt.cash.due);
ok('Cash unpaid > 7 days flagged late', lt.cash.stale===true);
ok('Credit unpaid > 30 days flagged late', lt.old.stale===true);
await ev(()=>{S.tab='home';render();});
ok('Late invoices badge on the Invoices tab', /2/.test(await text('nav.tabs [data-tab="invoices"] .tabbadge')), await text('nav.tabs [data-tab="invoices"]'));
await ev(()=>{S.tab='invoices';S.filter='old';render();});
ok('Late filter shows them', (await ev(()=>document.querySelectorAll('#view .list .inv, #view .list > .row').length))>=2);

// ---------- 9 supplier totals & debt ----------
const bal=await ev(()=>{const t=supTotals('SUP-001');const out=S.invoices.filter(i=>i.supplierId==='SUP-001').reduce((a,i)=>a+calc(i).outstanding,0);return {bal:Math.round(t.b.bal),out:Math.round(out),youOwe:Math.round(t.youOwe)}});
ok('Supplier debt = sum of unpaid invoices minus overpaid ones', bal.bal===bal.out, JSON.stringify(bal));
await ev(()=>{S.tab='home';render();}); await W(900);
const home=await ev(()=>{const t=document.querySelector('#view').textContent.replace(/\s+/g,' ');return t});
const allOut=await ev(()=>Math.round(S.suppliers.reduce((a,s)=>a+balance(s.id).bal,0)).toLocaleString('en-US'));
ok('Home "Owed to suppliers" equals unpaid invoices', home.includes('Owed to suppliers (unpaid invoices after discount)'+allOut), allOut+' | '+home.slice(0,200));
// opening balance excluded / verified
await ev(()=>supplierForm('SUP-002')); await W(); await setv('#sOpen','1000000'); await ev(()=>{document.querySelector('#sOpenV').checked=true;document.querySelector('#sOpenX').checked=false}); await click('#supForm button[type=submit]'); await W(250);
ok('Verified opening balance counts', await ev(()=>balance('SUP-002').bal)===1000000);
await ev(()=>supplierForm('SUP-002')); await W(); await ev(()=>{document.querySelector('#sOpenX').checked=true}); await click('#supForm button[type=submit]'); await W(250);
ok('Left-out opening balance does not count', await ev(()=>balance('SUP-002').bal)===0);

// ---------- 10 item discounts ----------
const idd=await ev(id=>{const i=S.invoices.find(x=>x.id===id);const d=itemDiscounts(i);const c=calc(i);return {...d.t,expect:Math.round(c.total-d.payDisc)}},A.id);
ok('Discount item by item: net = invoice total − payment discount', idd.net===idd.expect, JSON.stringify(idd));
const idc=await ev(id=>{const i=S.invoices.find(x=>x.id===id);return itemDiscounts(i).t},C.id);
ok('Discount item by item includes the invoice-level 10% (Brufen 100,000 → 90,000)', idc.net===90000 && idc.disc===10000, JSON.stringify(idc));

// ---------- 11 reports ----------
for(const k of ['pay','expiry','prices','month','statement']){ await ev(k=>{S.tab='reports';S.rep=k;render();},k); await W(80); }
await ev(()=>{S.tab='reports';S.rep='pay';S.payScope='all';render();});
ok('Pay plan lists unpaid invoices', (await text('#view')).includes('A101'));
await ev(()=>{S.rep='expiry';S.expMonths=3;render();});
ok('Expiry report shows Augmentin (expires in ~40 days)', (await text('#view')).includes('Augmentin'), (await text('#view')).slice(0,300));
r=await addInvoice({sup:'SUP-002',no:'R1',date:T,total:'110000',lines:[{desc:'Clexane ** 6000IU 60mg/0.6ml 2 Syringes Sanofi',qty:10,price:11000,value:110000}]});
await ev(()=>{S.tab='reports';S.rep='prices';render();});
ok('Price change report catches Clexane 10,000 → 11,000', /Clexane[\s\S]*9,000 → 11,000/.test(await text('#view')), (await text('#view')).slice(0,300));
await ev(()=>{S.rep='month';render();});
ok('Monthly report renders purchases', /Purchases/.test(await text('#view')));
await ev(()=>statementSheet('SUP-001')); await W(); await setv('#stAmt',String(await ev(()=>Math.round(balance('SUP-001').bal)))); await ev(()=>stmtRefresh());
ok('Statement check matches your records', /Matches/.test(await text('#stBody')), await text('#stBody'));
await ev(()=>closeSheet());

// ---------- 12 items tab ----------
await ev(()=>{S.tab='items';S.q='';render();});
ok('Items tab lists products', /Clexane/.test(await text('#view')));
await setv('#itemQ','brufen'); await W(150);
ok('Items search filters', (await text('#view')).includes('Brufen') && !(await text('#view')).includes('Augmentin'));
await setv('#itemQ',''); await ev(()=>{S.fridgeOnly=true;render();});
ok('Refrigerated only filter', (await text('#view')).includes('Clexane') && !(await text('#view')).includes('Brufen'));
await ev(()=>{S.fridgeOnly=false;render();});

// ---------- 13 exports & backup ----------
await ev(()=>{S.tab='home';render();});
await ev(()=>exportXlsx(document.createElement('button'))); await W(500);
await ev(()=>exportMonth(document.createElement('button'))); await W(500);
const saved=await ev(()=>window.__saved.map(s=>s.name+':'+s.size));
ok('Excel export and monthly report download', saved.length>=2 && saved.every(s=>+s.split(':')[1]>3000), saved.join(', '));
st=await store(); ok('Backup is recorded after export', !!st.meta.backup?.lastAt);
const sheets=await ev(async()=>{const wb=XLSX.read(await window.__saved[0].blob.arrayBuffer());return wb.SheetNames});
ok('Excel has all sheets', ['Purchase Invoices','Payments','Suppliers'].every(n=>sheets.includes(n)), sheets.join(', '));

// ---------- 14 scan (fake reading) ----------
await ev(()=>{window.__extraction={supplierName:'Test Drugstore',invoiceNo:'S900',date:today(),type:'credit',printedTotal:20000,lines:[{no:'1',desc:'( براد ) Insulin X 100IU/ml 1 Vial',qty:2,price:10000,value:20000,batch:'Z1',expiry:'2027-05',fridge:true}],uncertain:['Line 1 batch unclear']};});
const scanOk=await ev(async()=>{ if(!S.sample) return 'no sample'; const f=new File([new Uint8Array([255,216,255,224])],'x.jpg',{type:'image/jpeg'}); await scanPhoto(f); await new Promise(r=>setTimeout(r,300)); return document.querySelector('#sheetTitle').textContent+' | '+(document.querySelector('#fNo')?.value||'');});
ok('Photo scan fills the invoice form for checking (fake reader)', /Check scanned invoice \| S900/.test(scanOk), scanOk);
ok('Scan flags are shown before saving', /Line 1 batch unclear/.test(await text('#sheetBody')));
await ev(()=>closeSheet());

// ---------- 15 read-only ----------
await ev(()=>{window.__readonly=true;});
await ev(id=>paymentForm(id),B.id); await W(); await click('#payForm button[type=submit]'); await W(250);
ok('Saving error is shown when not allowed', /permission|Couldn't/.test(await text('#payErr')), await text('#payErr'));
await ev(()=>{closeSheet();window.__readonly=false;S.readOnly=false;});

// ---------- 16 views, Arabic, dark, phone width ----------
const tabs=['home','invoices','items','payments','suppliers','reports'];
let wide=[];
for(const lang of ['en','ar']){ if(lang==='ar') await ev(()=>setLang('ar')); for(const t of tabs){ await ev(t=>{S.tab=t;S.filter='all';render();},t); await W(80); const w=await ev(()=>document.documentElement.scrollWidth); if(w>392) wide.push(lang+':'+t+':'+w);} }
ok('No sideways scrolling on a 390px phone (English and Arabic, all tabs)', wide.length===0, wide.join(' '));
const arTxt=await text('nav.tabs');
ok('Arabic labels on tabs', /الرئيسية|الفواتير/.test(arTxt), arTxt);
await ev(id=>invoiceDetail(id),A.id); await W(200);
const untrans=await ev(()=>{const out=new Set();const w=document.createTreeWalker(document.querySelector('#sheetBody'),NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){const t=n.textContent.trim();if(/^[A-Za-z][A-Za-z ()]{3,}$/.test(t)&&!n.parentElement.closest('table,td,.num,code'))out.add(t)}return [...out].slice(0,30)});
ok('Arabic: invoice screen fully translated', untrans.length===0, untrans.join(' | '));
await ev(()=>closeSheet());
const scr=async(fn,label)=>{await ev(fn,label); await W(250); return (await ev(()=>{const out=new Set();const root=document.querySelector('#sheet').hidden?document.querySelector('#view'):document.querySelector('#sheetBody');const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){const t=n.textContent.trim();if(/[A-Za-z]{3,}/.test(t)&&!/[\u0600-\u06FF]/.test(t)&&!/^[A-Z]{2,}[-\d]/.test(t)&&!n.parentElement.closest('td,.num,code,option,textarea,.ar')&&!/Test Drugstore|Al-Rafidain|Pioneer|MyPharma|IQD|Owner|Excel|Clexane|Brufen|Augmentin|Panadol|PI-|PAY-|CR-|SUP-/.test(t))out.add(t)}return [...out].slice(0,12)})).map(x=>label+': '+x);};
let miss=[];
miss.push(...await scr(id=>paymentForm(id),B.id)); await ev(()=>closeSheet());
miss.push(...await scr(()=>supplierForm('SUP-001'),'supplier')); await ev(()=>closeSheet());
miss.push(...await scr(id=>creditForm({supplierId:'SUP-001',invoiceId:id}),C.id)); await ev(()=>closeSheet());
miss.push(...await scr(id=>recvSheet(id),C.id)); await ev(()=>closeSheet());
miss.push(...await scr(id=>invoiceForm(id),C.id)); await ev(()=>closeSheet());
for(const k of ['pay','expiry','prices','month']) miss.push(...await scr(k=>{S.tab='reports';S.rep=k;render();},k));
miss.push(...await scr(()=>statementSheet('SUP-001'),'statement')); await ev(()=>closeSheet());
for(const t of tabs) miss.push(...await scr(t=>{S.tab=t;render();},t));
ok('Arabic: forms, reports and tabs translated', miss.length===0, miss.join(' | '));

ok('No script errors during the whole run', errs.length===0, errs.slice(0,5).join(' || '));
await b.close();
const fails=results.filter(r=>r[0]==='FAIL');
for(const r of results) console.log(r[0],'-',r[1],r[0]==='FAIL'?' :: '+r[2]:'');
console.log(`\n${results.length-fails.length}/${results.length} passed`);
})().catch(e=>{console.log('CRASH',e.message);console.log(results.filter(r=>r[0]==='FAIL').map(r=>r.join(' :: ')).join('\n'));process.exit(1)});
