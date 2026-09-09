import test from 'node:test';
import assert from 'node:assert/strict';
import * as harness from './receipt-scan-harness.mjs';
const {runtime, fixture} = harness;
const supplier = 'yotvata';
const create = options => supplier === 'berman' ? runtime(options) : runtime(supplier, options);
const dataForTest = () => supplier === 'berman' ? fixture() : fixture(supplier);
const json = (r, expression) => JSON.parse(r.run('JSON.stringify(' + expression + ')'));
function plainData() {
  const data=dataForTest();
  const products=[
    {id:'milk',name:'מוצר ראשון',code:'8',barcode:'7290000000008',price:5,listPrice:5,discountPct:0,discountSet:true},
    {id:'coffee',name:'מוצר שני',code:'9',barcode:'7290000000015',price:7,listPrice:7,discountPct:0,discountSet:true},
    {id:'extra',name:'מוצר נוסף',code:'10',barcode:'7290000000022',price:3,listPrice:3,discountPct:0,discountSet:true}];
  const rows=products.slice(0,2).map((p,i)=>({section:'items',code:p.code,itemCode:p.code,supplierItemCode:p.code,
    description:p.name,barcode:p.barcode,barcodeObserved:p.barcode,barcodeReadType:'full',barcodeMatchMethod:'exact_full',
    sourcePage:1,lineNumber:i+1,quantity:i?6:10,unitPriceExVat:p.price,grossLineTotalExVat:p.price*(i?6:10),lineTotalExVat:p.price*(i?6:10),lineDiscountExVat:0,confidence:.99}));
  const doc={noteIndex:0,docDate:'2026-09-09',docNumber:'MANUAL-QTY',invoiceNumber:'MANUAL-QTY',docType:'invoice',pageCount:1,
    subtotalExVat:92,netToChargeExVat:92,totalUnits:16,printedUnits:16,itemsPrintedLines:2,printedLines:2,
    itemsSectionTotalExVat:92,promoDiscountExVat:0,documentDiscountExVat:0,rows,warnings:[],confidence:.99};
  return {...data,products,promos:[],items:rows.map((row,i)=>({productId:products[i].id,name:products[i].name,barcode:products[i].barcode,qty:row.quantity})),
    paper:{...data.paper,scan:{documents:[doc],warnings:[]}}};
}
async function scanned(data=plainData(), counts=null) {
  const r=create({data});await r.scan();
  r.run("receiptDupConfirmed=true; showConfirm=(title,text,label,fn)=>fn();");
  if(counts) {r.context.quantities=counts;r.run('receiptList=structuredClone(quantities);saveReceiptDraft()');}
  return r;
}
function closeNormal(r) {
  // Only the same actions offered by the ordinary receipt flow.
  if(!r.run('!!pendingReceipt')) {
    if(supplier==='berman')r.click('ai-close-receipt');
    else r.click('ai-apply');
  }
  assert.ok(r.run('!!pendingReceipt'),json(r,'aiScanEvaluation && aiScanEvaluation.errors')?.join(';'));
}
const financialFields=['lines','ex','calculatedEx','receivedEx','roundingAdjustment','grossEx','supplierDiscount','supplierPromoItems',
 'supplierPromoMismatchItems','supplierCreditClaim','monthEndPending','promoOnPaper','noteTotal','status','noteParts','unresolvedAmountGap','unresolvedUnitsGap'];
function finance(r){const p=JSON.parse(JSON.stringify(json(r,'pendingReceipt'),(key,value)=>key==='recordedAt'?undefined:value));return Object.fromEntries(financialFields.filter(k=>k in p).map(k=>[k,p[k]]));}
for(const [name,short,over,extra] of [['all match',0,0,0],['shortage',2,0,0],['surplus',0,3,0],['shortage and surplus',2,3,0],['unlisted surplus',2,0,4],['whole product missing',10,0,0],['all goods missing',10,-6,0]]) {
  test(supplier+': '+name+' has the identical ordinary final receipt',async()=>{
    const data=plainData();data.items[0].qty-=short;data.items[1].qty+=over;
    if(extra)data.items.push({productId:'extra',name:'מוצר נוסף',barcode:'7290000000022',qty:extra});
    const normal=await scanned(data);normal.run('finishReceipt()');closeNormal(normal);
    const manual=await scanned(data,[]), requests=manual.requests.length, paper=json(manual,'aiScanResponse.scan');
    manual.run('startReceiptQuantityReview(false)');assert.ok(manual.run('!!receiptQuantityReview'));
    manual.context.expected=data.items;
    manual.run(`receiptQuantityReview.rows.forEach(row=>{const item=expected.find(i=>i.productId===row.productId);const d=item.qty-row.paperQty;
      row.kind=d<0?'shortage':d>0?'surplus':'match';row.difference=String(Math.abs(d));});
      expected.filter(item=>!receiptQuantityReview.rows.some(r=>r.productId===item.productId)).forEach(item=>receiptQuantityReview.rows.push({...item,paperQty:0,kind:'surplus',difference:String(item.qty)}));`);
    assert.equal(manual.run('commitReceiptQuantityReview()'),true);closeNormal(manual);
    assert.deepEqual(finance(manual),finance(normal));assert.deepEqual(json(manual,'aiScanResponse.scan'),paper);
    assert.equal(manual.requests.length,requests);assert.equal(manual.run('receiptQuantityCheckAudit().method'),'manual');
    assert.equal(manual.run('receiptList.find(l=>l.productId==="milk").qty'),10-short);
  });
}
test(supplier+': all-match action replaces counts only after confirmation and never doubles them',async()=>{
 const r=await scanned();r.run('showConfirm=(...args)=>{globalThis.pendingChoice=args[3]};startReceiptQuantityReview(true)');
 assert.equal(r.run('receiptQuantityReview'),null);assert.equal(r.run('typeof pendingChoice'),'function');
 r.run('pendingChoice()');closeNormal(r);const first=json(r,'receiptList');
 r.run('showConfirm=(a,b,c,fn)=>fn();startReceiptQuantityReview(true)');closeNormal(r);
 assert.deepEqual(json(r,'receiptList'),first);assert.equal(first[0].qty,10);
});
test(supplier+': invalid shortages and quantities cannot modify the physical basket',async()=>{
 const r=await scanned(plainData(),[]);r.run('startReceiptQuantityReview(false);receiptQuantityReview.rows[0].kind="shortage"');
 for(const bad of ['11','-1','1.5','','abc','9007199254740992','0']){
  r.context.bad=bad;r.run('receiptQuantityReview.rows[0].difference=bad');assert.equal(r.run('commitReceiptQuantityReview()'),false);assert.deepEqual(json(r,'receiptList'),[]);
 }
});
test(supplier+': unfinished manual differences survive a reload without applying or rereading',async()=>{
 const data=plainData(),a=await scanned(data,[]);
 a.run('startReceiptQuantityReview(false);receiptQuantityReview.rows[0].kind="shortage";receiptQuantityReview.rows[0].difference="2";saveReceiptDraft();closeReceiptQuantityReview()');
 const b=create({data,storage:a.storage});b.run('currentView="receiving";mainMode="receiving";showConfirm=(a,b,c,fn)=>fn();startReceiptQuantityReview(false)');
 assert.equal(b.run('receiptQuantityReview.rows[0].difference'),'2');assert.deepEqual(json(b,'receiptList'),[]);
 assert.equal(b.run('commitReceiptQuantityReview()'),true);closeNormal(b);assert.equal(b.run('receiptList[0].qty'),8);assert.equal(b.requests.length,0);
});
test(supplier+': changed paper or physical counts invalidate a pending manual confirmation',async()=>{
 for(const mutation of ['receiptList.push({productId:"extra",name:"מוצר נוסף",qty:1})','aiScanResponse.scan.documents[0].rows[0].quantity=11']){
  const r=await scanned(plainData(),[]);r.run('startReceiptQuantityReview(false)');r.run(mutation);const before=json(r,'receiptList');
  assert.equal(r.run('commitReceiptQuantityReview()'),false);assert.deepEqual(json(r,'receiptList'),before);
 }
});
test(supplier+': incomplete or unmapped paper never bulk-confirms products',async()=>{
 for(const mutation of ['receiptPaperScanState="running"','receiptPaperScanState="failed"','aiScanResponse.scan.documents=[]','products=[]']){
  const r=await scanned(plainData(),[]);r.run(mutation);r.run('startReceiptQuantityReview(true)');assert.deepEqual(json(r,'receiptList'),[]);assert.equal(r.run('receiptQuantityReview'),null);
 }
});
test(supplier+': real price differences remain visible and financial handling is identical',async()=>{
 const normal=await scanned(),manual=await scanned(plainData(),[]);
 for(const r of [normal,manual])r.run('products[0].price=4;products[0].listPrice=4');
 normal.run('finishReceipt()');closeNormal(normal);
 manual.run('startReceiptQuantityReview(true)');closeNormal(manual);
 assert.deepEqual(finance(manual),finance(normal));
 assert.ok(json(manual,'receiptPriceAudit().rows').some(r=>r.result==='difference'));
 assert.ok(manual.run('!!pendingReceipt.supplierCreditClaim || pendingReceipt.status === "open"'));
});
test(supplier+': final ordinary save records manual provenance and clears review with the draft',async()=>{
 const cloud=supplier==='berman'?null:harness.fakeCloud();
 const r=create({data:plainData(),cloud});if(cloud)await cloud.tick();await r.scan();
 r.run('receiptList=[];receiptDupConfirmed=true;showConfirm=(a,b,c,fn)=>fn();startReceiptQuantityReview(true)');closeNormal(r);
 await r.run('confirmReceipt()');const saved=r.writes.find(w=>w.op==='set' && w.path.includes('receipts'));
 assert.ok(saved);assert.equal(saved.data.quantityCheck.method,'manual');assert.equal(r.run('receiptQuantityReview'),null);
 assert.equal(saved.data.items.find(i=>i.productId==='milk').qty,10);
});
test(supplier+': manual photo entry uses the same OCR while leaving the barcode camera closed',async()=>{
 const data=plainData(),r=create({data});
 r.run('globalThis.cameraOpens=0;openReceivingScanner=()=>cameraOpens++');
 if(supplier==='berman') {
  r.run('bermanSeedPhotoFirstScan(1);aiScanDocuments[0].pages=[{dataUrl:"data:image/jpeg;base64,Zml4dHVyZQ==",orientationConfirmed:true}]');
  r.click('rc-open-photo-quantity');
  // The ordinary Berman click starts the background task without awaiting it.
  for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));
 } else {
  r.run('aiScanDocuments=[{noteIndex:0,pages:[{dataUrl:"data:image/jpeg;base64,Zml4dHVyZQ==",orientationConfirmed:true}]}]');
  await r.run(supplier+'StartPaperScan({manualQuantities:true})');
 }
 assert.equal(r.run('cameraOpens'),0);assert.equal(r.run('receiptPaperScanState'),'ok');assert.ok(r.run('receiptQuantityButtonsHtml().includes("rc-quantity-all")'));
 assert.equal(r.requests.filter(q=>q.url.endsWith('/scan')&&JSON.parse(q.body).mode!=='analyze').length,1);
});
test(supplier+': exception controls show actual quantities and add products absent from the paper',async()=>{
 const r=await scanned(plainData(),[]);r.click('rc-quantity-differences');
 r.events.get('receiptQuantityRows:change')({target:{dataset:{quantityKind:'0'},value:'shortage'}});
 r.events.get('receiptQuantityRows:input')({target:{dataset:{quantityDifference:'0'},value:'2'}});
 assert.match(r.node('quantityReviewSummary_0').textContent,/בתעודה: 10 · התקבלו: 8 · חוסר: 2/);
 r.events.get('receiptQuantitySearch:input')({target:{value:'מוצר נוסף'}});
 assert.match(r.node('receiptQuantityExtras').innerHTML,/data-quantity-add="extra"/);
 const button={dataset:{quantityAdd:'extra'}};
 r.events.get('receiptQuantityExtras:click')({target:{closest:()=>button}});
 r.events.get('receiptQuantityRows:input')({target:{dataset:{quantityDifference:'2'},value:'4'}});
 r.events.get('receiptQuantityConfirm:click')();closeNormal(r);
 assert.equal(r.run('receiptList.find(l=>l.productId==="extra").qty'),4);
 assert.equal(r.run('receiptList.find(l=>l.productId==="milk").qty'),8);
});
test(supplier+': multiple papers aggregate quantities once and keep their original source',async()=>{
 const data=plainData(),r=create({data});
 if(supplier==='berman'){
  r.run('receiptOpened=true;bermanSeedPhotoFirstScan(2);aiScanDocuments.forEach(d=>d.pages=[{dataUrl:"data:image/jpeg;base64,Zml4dHVyZQ==",orientationConfirmed:true}])');
  await r.run('bermanRunPaperScanInBackground()');
 }else await r.scan(2);
 r.run('receiptList=[];receiptDupConfirmed=true;showConfirm=(a,b,c,fn)=>fn()');
 const paper=json(r,'aiScanResponse.scan');r.run('startReceiptQuantityReview(true)');closeNormal(r);
 assert.equal(r.run('receiptList.find(l=>l.productId==="milk").qty'),20);
 assert.equal(r.run('receiptList.find(l=>l.productId==="coffee").qty'),12);
 assert.equal(r.run('pendingReceipt.noteParts.length'),2);assert.deepEqual(json(r,'aiScanResponse.scan'),paper);
});
if(supplier!=='berman')test(supplier+': unfinished differences follow the existing cloud draft to another device',async()=>{
 const cloud=harness.fakeCloud(),data=plainData(),a=create({data,cloud});await cloud.tick();await a.scan();
 a.run('receiptList=[];startReceiptQuantityReview(false);receiptQuantityReview.rows[0].kind="shortage";receiptQuantityReview.rows[0].difference="2";saveReceiptDraft()');
 assert.equal(await a.run('flushReceiptDraftToCloud()'),true);await cloud.tick();
 const b=create({data,cloud});await cloud.tick();b.run('startReceiptQuantityReview(false)');
 assert.equal(b.run('receiptQuantityReview.rows[0].difference'),'2');assert.equal(b.run('commitReceiptQuantityReview()'),true);closeNormal(b);
 assert.equal(b.run('receiptList[0].qty'),8);assert.equal(b.requests.length,0);
});
if(supplier==='berman')test('berman: existing promotion-on-paper handling is retained in manual checking',async()=>{
 const data=dataForTest(),normal=await scanned(data),manual=await scanned(data,[]);
 normal.run('finishReceipt()');closeNormal(normal);
 manual.run('startReceiptQuantityReview(false)');manual.context.expected=data.items;
 manual.run(`receiptQuantityReview.rows.forEach(row=>{const d=expected.find(i=>i.productId===row.productId).qty-row.paperQty;
 row.kind=d<0?'shortage':d>0?'surplus':'match';row.difference=String(Math.abs(d));});commitReceiptQuantityReview()`);closeNormal(manual);
 assert.deepEqual(finance(manual),finance(normal));
});
