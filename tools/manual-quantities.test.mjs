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

// Counting with the scanner is the ordinary path, so the manual shortcut asks for
// one line of the receiving screen until it is wanted — and stays where the user
// left it when the background scan refreshes the screen underneath.
test(supplier+': the manual quantity choice is folded and remembers how it was left',async()=>{
 const r=await scanned();
 assert.match(r.run('receiptQuantityButtonsHtml()'),/<details data-quantity-picker class=/);
 r.click('rc-quantity-toggle');
 assert.equal(r.run('receiptQuantityPickerOpen'),true);
 assert.match(r.run('receiptQuantityButtonsHtml()'),/<details data-quantity-picker open class=/);
 r.run('refreshScanHost()');
 // Berman rebuilds the whole screen where the others patch the host in place.
 assert.match(r.node('rcQuantityOptions').innerHTML || r.node('app').innerHTML,/<details data-quantity-picker open class=/);
 r.click('rc-quantity-toggle');
 assert.match(r.run('receiptQuantityButtonsHtml()'),/<details data-quantity-picker class=/);
 // Folding changes nothing about the choice itself.
 assert.ok(r.run('receiptQuantityButtonsHtml().includes("rc-quantity-all")'));
 assert.ok(r.run('receiptQuantityButtonsHtml().includes("rc-quantity-differences")'));
 r.click('rc-quantity-differences');
 assert.ok(r.run('!!receiptQuantityReview'));
});

// Confirming the quantities by hand and then being asked "everything matches —
// continue?" is the same question twice. It is answered automatically only when
// the comparison has nothing left to decide.
test(supplier+': a clean manual confirmation closes without asking the same question twice',async()=>{
 const r=await scanned(plainData(),[]);
 r.run('startReceiptQuantityReview(false)');
 r.run("receiptQuantityReview.rows.forEach(x=>{x.kind='match';x.difference='0'})");
 assert.equal(r.run('commitReceiptQuantityReview()'),true);
 assert.equal(r.run('!!pendingReceipt'),true);
 // Whatever the quantities say, none of these is ever skipped.
 assert.equal(r.run("aiScanAllGood({valid:true,findings:[{type:'price'}],residuals:[],barcodeSuggestions:[]})"),false);
 assert.equal(r.run("aiScanAllGood({valid:true,findings:[{type:'promo_missing'}],residuals:[],barcodeSuggestions:[]})"),false);
 assert.equal(r.run("aiScanAllGood({valid:true,findings:[],residuals:[{}],barcodeSuggestions:[]})"),false);
 assert.equal(r.run("aiScanAllGood({valid:true,findings:[],residuals:[],barcodeSuggestions:[{unknownProduct:true}]})"),false);
 assert.equal(r.run("aiScanAllGood({valid:false,findings:[],residuals:[],barcodeSuggestions:[]})"),false);
});
test(supplier+': a declared shortage still stops on the comparison screen',async()=>{
 const r=await scanned(plainData(),[]);
 r.run('startReceiptQuantityReview(false)');
 r.run("receiptQuantityReview.rows.forEach((x,i)=>{x.kind=i?'match':'shortage';x.difference=i?'0':'2'})");
 assert.equal(r.run('commitReceiptQuantityReview()'),true);
 assert.equal(r.run('!!pendingReceipt'),false);
 assert.equal(r.run('currentView'),'reconcile');
});

const settleScan = async () => { for(let i=0;i<16;i++)await new Promise(resolve=>setImmediate(resolve)); };
function enterPhotoScreen(r) {
 r.run(`currentView='receiving';mainMode='receiving';receiptList=[];receiptOpened=false;
 globalThis.cameraOpens=0;openReceivingScanner=()=>cameraOpens++;`);
 if(supplier==='berman')r.run('bermanSeedPhotoFirstScan(1)');
 else r.run('aiScanDocuments=[{noteIndex:0,amount:null,units:null,pages:[]}]');
 r.run(`aiScanDocuments[0].pages=[{dataUrl:'data:image/jpeg;base64,Zml4dHVyZQ==',orientationConfirmed:true}];renderReceiving()`);
}
const photoRole = manual => supplier==='berman' ? (manual?'rc-open-photo-quantity':'rc-open-photo') : (manual?'rc-photo-quantity':'rc-photo-start');
function assertManualScreen(r) {
 const html=r.node('app').innerHTML;
 assert.match(html,/data-manual-receiving/);
 assert.doesNotMatch(html,/data-role="rc-scan"|data-role="rc-crates"|id="rcDigits"|id="rcListEl"|id="rcTotals"|אפשר לסרוק מוצרים|סרוק את הסחורה|אין פריטים עדיין/);
 return html;
}
test(supplier+': the two photo buttons show distinct screens during and after the identical OCR request',async()=>{
 const requests=[];
 for(const manual of [false,true]) {
  const r=create({data:plainData()});enterPhotoScreen(r);
  let release;const pending=new Promise(resolve=>release=resolve),fetch=r.context.fetch;
  r.context.fetch=async(url,options)=>{if(String(url).endsWith('/scan'))await pending;return fetch(url,options);};
  r.click(photoRole(manual));await settleScan();
  assert.equal(r.run('receiptPaperScanState'),'running');
  if(manual){assertManualScreen(r);assert.equal(r.run('cameraOpens'),0);}
  else{assert.doesNotMatch(r.node('app').innerHTML,/data-manual-receiving/);assert.match(r.node('app').innerHTML,/data-role="rc-scan"/);assert.equal(r.run('cameraOpens'),1);}
  if(manual) {
   const restored=create({data:plainData(),storage:r.storage});
   restored.run("currentView='receiving';mainMode='receiving';renderReceiving()");
   const recovery=assertManualScreen(restored);
   assert.match(recovery,/צריך להשלים את פענוח התעודה/);
   assert.doesNotMatch(recovery,/data-role="rc-quantity-all"/);
   assert.equal(restored.requests.length,0);
  }
  release();await settleScan();
  assert.equal(r.run('receiptPaperScanState'),'ok');assert.deepEqual(json(r,'receiptList'),[]);
  if(manual){const html=assertManualScreen(r);assert.match(html,/data-role="rc-quantity-all"/);assert.match(html,/data-role="rc-quantity-differences"/);assert.match(html,/data-price-audit/);assert.doesNotMatch(html,/data-quantity-picker/);}
  else assert.match(r.node('app').innerHTML,/data-role="rc-scan"/);
  requests.push(r.requests.filter(x=>x.url.endsWith('/scan')).map(x=>JSON.parse(x.body)));
 }
 assert.equal(requests[0].length,1);assert.deepEqual(requests[1],requests[0]);
});
test(supplier+': manual screen and unfinished differences survive reload and returning from review',async()=>{
 const data=plainData(),a=create({data});enterPhotoScreen(a);a.click(photoRole(true));await settleScan();
 a.click('rc-quantity-differences');
 a.run(`receiptQuantityReview.rows[0].kind='shortage';receiptQuantityReview.rows[0].difference='2';saveReceiptDraft();closeReceiptQuantityReview();renderReceiving()`);
 assertManualScreen(a);
 const b=create({data,storage:a.storage});b.run("currentView='receiving';mainMode='receiving';renderReceiving()");
 assertManualScreen(b);assert.equal(b.run('receiptQuantityReview.rows[0].difference'),'2');assert.equal(b.requests.length,0);
 b.click('rc-quantity-differences');b.run('receiptDupConfirmed=true;showConfirm=(a,b,c,fn)=>fn()');
 assert.equal(b.run('commitReceiptQuantityReview()'),true);assert.equal(b.run('receiptList[0].qty'),8);
 b.run("setView('receiving')");assertManualScreen(b);assert.equal(b.requests.length,0);
});
test(supplier+': manual scan failure and an interrupted reload offer photo recovery without a scanner screen',async()=>{
 const data=plainData();data.paper={ok:false,error:'invalid_model_output'};
 const a=create({data});enterPhotoScreen(a);a.click(photoRole(true));await settleScan();
 assert.equal(a.run('receiptPaperScanState'),'failed');const html=assertManualScreen(a);
 assert.match(html,/צריך להשלים את פענוח התעודה/);assert.doesNotMatch(html,/data-role="rc-quantity-all"/);
 const repair=supplier==='berman'?'rc-paper-rescan':'rc-photo-repair';assert.ok(html.includes('data-role="'+repair+'"'));
 const b=create({data,storage:a.storage});b.run("currentView='receiving';mainMode='receiving';renderReceiving()");
 assertManualScreen(b);assert.ok(b.node('app').innerHTML.includes('data-role="'+repair+'"'));
 b.click(repair);assert.ok(b.node('app').innerHTML.includes('data-role="'+photoRole(true)+'"'));
});
test(supplier+': switching back to scanning preserves the paper, entered differences and existing quantities',async()=>{
 const r=await scanned(plainData(),[]);r.click('rc-quantity-differences');
 r.run(`receiptQuantityReview.rows[0].kind='shortage';receiptQuantityReview.rows[0].difference='2';saveReceiptDraft();closeReceiptQuantityReview()`);
 const paper=json(r,'aiScanResponse'),before=r.requests.length;
 r.click('rc-count-by-scan');assert.equal(r.run('receiptCountingMode'),'scan');
 assert.doesNotMatch(r.node('app').innerHTML,/data-manual-receiving/);assert.match(r.node('app').innerHTML,/data-role="rc-scan"/);
 assert.deepEqual(json(r,'aiScanResponse'),paper);assert.equal(r.run('receiptQuantityReview.rows[0].difference'),'2');assert.deepEqual(json(r,'receiptList'),[]);
 r.click('rc-quantity-differences');r.run('closeReceiptQuantityReview();renderReceiving()');assertManualScreen(r);
 assert.equal(r.run('receiptQuantityReview.rows[0].difference'),'2');assert.equal(r.requests.length,before);
});
if(supplier!=='berman')test(supplier+': chosen manual screen follows the draft to another device before any count is entered',async()=>{
 const cloud=harness.fakeCloud(),data=plainData(),a=create({data,cloud});await cloud.tick();enterPhotoScreen(a);
 a.click(photoRole(true));await settleScan();assert.equal(await a.run('flushReceiptDraftToCloud()'),true);await cloud.tick();
 const b=create({data,cloud});await cloud.tick();b.run('renderReceiving()');assertManualScreen(b);
 assert.deepEqual(json(b,'receiptList'),[]);assert.equal(b.requests.length,0);
});
test(supplier+': cancelling the manual receipt resets the next receipt to the normal counting method',async()=>{
 const r=create({data:plainData()});enterPhotoScreen(r);r.click(photoRole(true));await settleScan();
 r.run('showConfirm=(a,b,c,fn)=>fn()');r.click('rc-cancel');assert.equal(r.run('receiptCountingMode'),'scan');assert.deepEqual(json(r,'receiptList'),[]);
});
