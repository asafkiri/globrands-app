import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as harness from './receipt-scan-harness.mjs';
const supplier = 'yotvata';
const create = data => supplier === 'berman' ? harness.runtime({data}) : harness.runtime(supplier,{data});
const reload = (c,data) => supplier === 'berman' ? harness.runtime({storage:c.storage,data}) : harness.runtime(supplier,{storage:c.storage,data});
const report = c => JSON.parse(c.run('JSON.stringify(receiptPriceAudit())'));
const requests = c => c.requests.filter(r => r.body).length;
const view = c => { c.run('renderReceiving()'); return c.node('app').innerHTML; };
const evidence = [];
function fixture({unit=5,qty=10,base=5,discount=0,promo=null,date='2026-09-09',summary=0,rows=null,pages=1}={}) {
 const products=[{id:'milk',name:'מוצר בדיקה',code:'8',barcode:'7290000000008',price:base*(1-discount/100),listPrice:base,discountPct:discount,discountSet:true},
 {id:'coffee',name:'מוצר שני',code:'15',barcode:'7290000000015',price:5,listPrice:5,discountPct:0,discountSet:true}];
 const r={section:'items',code:'8',itemCode:'8',supplierItemCode:'8',description:'מוצר בדיקה',barcode:'7290000000008',barcodeObserved:'7290000000008',barcodeReadType:'full',barcodeMatchMethod:'exact_full',sourcePage:1,lineNumber:1,quantity:qty,unitPriceExVat:unit,grossLineTotalExVat:unit*qty,lineTotalExVat:unit*qty,lineDiscountExVat:0,confidence:.99};
 rows=rows||[r]; const sum=rows.reduce((n,r)=>n+r.lineTotalExVat,0), units=rows.reduce((n,r)=>n+r.quantity,0);
 const doc={noteIndex:0,docNumber:'INV-100',invoiceNumber:'INV-100',docType:'invoice',pageCount:pages,rows,confidence:.99,
   subtotalExVat:sum-summary,itemsSectionTotalExVat:sum,itemsPrintedLines:rows.length,printedLines:rows.length,
   printedUnits:units,totalUnits:units,netToChargeExVat:sum-summary,promoDiscountExVat:summary,documentDiscountExVat:summary,warnings:[]};
 if(supplier!=='yotvata')doc.docDate=date;
 return {products,promos:promo?[{id:'p1',name:'מבצע בדיקה',productIds:['milk'],pct:20,start:'2026-09-01',end:'2026-09-30',minQty:1,...promo}]:[],items:[],paper:{ok:true,serviceVersion:supplier==='tnuva'?10:supplier==='yotvata'?145:4,model:'fixture',requestId:'price-fixture',scan:{warnings:[],documents:[doc]}},date};
}
async function scan(c,data,{documents=1,pages=1,completeDate=true}={}) {
 c.run(`currentView='receiving';mainMode='receiving';receiptOpened=true;receiptList=[];receiptDupConfirmed=true;scanPurpose='receiving';
   aiScanDocuments=Array.from({length:${documents}},(_,i)=>({noteIndex:i,amount:null,units:null,lines:null,pages:Array.from({length:${pages}},()=>({dataUrl:'data:image/jpeg;base64,Zml4dHVyZQ==',orientationConfirmed:true}))}));`);
 // Use the real background pipeline, adapter, save, render and real analyzer.
 c.run("if(typeof auditOriginalAnalyzer!=='undefined') aiRunAnalyzer=auditOriginalAnalyzer");
 await c.run(supplier==='berman'?'bermanRunPaperScanInBackground()':supplier+'StartPaperScan()');
 if(supplier==='yotvata' && completeDate && data.date) for(let i=0;i<documents;i++)c.run(`priceAuditSetDate(${i},${JSON.stringify(data.date)})`);
 return view(c);
}
function record(name,c,html){evidence.push({scenario:name,scannedProducts:c.run('receiptList.length'),report:report(c),screenText:html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(),additionalAIRequests:requests(c)-c.expectedUploads});}
for(const [name,unit,expected] of [['matching price',5,'match'],['price difference before first counted item',6,'difference']]) test(supplier+': '+name,async()=>{
 const data=fixture({unit}),c=create(data);c.expectedUploads=1;const html=await scan(c,data);
 assert.equal(c.run('receiptList.length'),0);assert.equal(report(c).rows[0].result,expected);assert.equal(requests(c),1);
 assert.match(html,expected==='match'?/המחירים שנבדקו תואמים/:/המחיר בתעודה שונה מהמחיר שבמאגר/);
 assert.match(html,/מחיר יחידה מודפס: <b>₪[56]\.00/);
 if(expected==='difference'){assert.match(html,/הפרש ליחידה: <b>₪1\.00/);assert.match(html,/הפרש לשורה: <b>₪10\.00/);assert.match(c.node('scanPriceNotice').textContent,/שונה/);}
 assert.equal(report(c).rows.some(r=>['shortage','surplus'].includes(r.result)),false);record(name,c,html);
});
test(supplier+': source overwrite cannot compare catalog to itself',async()=>{
 const data=fixture({unit:6}),c=create(data);await scan(c,data);
 c.run('aiScanResponse.scan.documents[0].rows[0].unitPriceExVat=5;aiScanResponse.scan.documents[0].rows[0].lineTotalExVat=50;saveReceiptDraft()');
 assert.notEqual(report(c).rows[0].result,'match');assert.equal(report(c).rows[0].originalUnitPrice,6);
 if(supplier!=='berman')assert.equal(report(c).rows[0].capability,'source_changed');
 else {assert.equal(report(c).rows[0].result,'difference');assert.equal(report(c).rows[0].adaptedUnitPrice,5);}
 assert.doesNotMatch(view(c),/המחירים שנבדקו תואמים/);assert.equal(requests(c),1);
});
test(supplier+': count, exit, refresh and finish retain one source row and original price',async()=>{
 const data=fixture({unit:6}),c=create(data);await scan(c,data);const id=report(c).rows[0].id;
 c.run("receiptList=[{productId:'milk',name:'מוצר בדיקה',barcode:'7290000000008',qty:9}];saveReceiptDraft()");
 const b=reload(c,data);b.run("currentView='receiving';mainMode='receiving'");assert.equal(report(b).rows[0].id,id);assert.equal(report(b).rows[0].originalUnitPrice,6);
 b.run('receiptList[0].qty=10;saveReceiptDraft();finishReceipt()');
 assert.equal(report(b).rows[0].result,'difference');assert.equal((b.node('app').innerHTML.match(/data-price-row=/g)||[]).length,1);assert.equal(requests(b),0);
 b.run("currentView='receiving';receiptList[0].qty=8;saveReceiptDraft();renderReceiving()");
 assert.equal(report(b).rows[0].expectedOptions[0].lineDifference,10);assert.equal(requests(b),0);
});
test(supplier+': catalog price and promotion changes immediately invalidate old result',async()=>{
 const data=fixture({unit:6}),c=create(data);await scan(c,data);
 c.run("products[0].price=6;products[0].listPrice=6;renderReceiving()");assert.equal(report(c).rows[0].result,'match');
 c.run("products[0].price=5;products[0].listPrice=5;renderReceiving()");assert.equal(report(c).rows[0].result,'difference');
 c.run(`promos=[{id:'new',productIds:['milk'],start:'2026-09-01',end:'2026-09-30',pct:20,fixedPrice:${supplier==='berman'?6:0}}];renderReceiving()`);
 assert.equal(report(c).rows[0].promo.id,'new');assert.equal(requests(c),1);
});
for(const type of ['missing catalog price','uncertain product','missing paper price','missing page','missing document','unknown unit']) test(supplier+': '+type+' is visible, never green',async()=>{
 const data=fixture();
 if(type==='missing catalog price'){data.products[0].price=null;data.products[0].listPrice=null;}
 if(type==='uncertain product'){const r=data.paper.scan.documents[0].rows[0];Object.assign(r,{code:'99999',itemCode:'99999',barcode:null,barcodeObserved:null,barcodeReadType:'unreadable',barcodeMatchMethod:null});}
 if(type==='missing paper price'){const r=data.paper.scan.documents[0].rows[0];r.unitPriceExVat=null;r.lineTotalExVat=null;r.grossLineTotalExVat=null;}
 if(type==='missing page')data.paper.scan.documents[0].pageCount=2;
 if(type==='unknown unit')data.paper.scan.documents[0].rows[0].unitOfMeasure='carton';
 const c=create(data);await scan(c,data);
 if(type==='missing document')c.run("aiScanDocuments.push({noteIndex:1,pages:[],restoredPageCount:1,savedPageCount:1,scanResult:null});saveReceiptDraft()");
 const html=view(c);assert.doesNotMatch(html,/המחירים שנבדקו תואמים/);assert.equal(report(c).complete,false);
 assert.ok(report(c).rows.some(r=>r.capability!=='checkable'));assert.equal(requests(c),1);
});
test(supplier+': multiple documents/pages and repeated product rows keep distinct findings',async()=>{
 const data=fixture({unit:6,pages:2});const raw=data.paper.scan.documents[0];raw.rows.push({...raw.rows[0],lineNumber:2,sourcePage:2});
 raw.subtotalExVat=raw.netToChargeExVat=raw.itemsSectionTotalExVat=120;raw.printedUnits=raw.totalUnits=20;raw.printedLines=raw.itemsPrintedLines=2;
 const c=create(data);await scan(c,data,{documents:2,pages:2});assert.equal(report(c).rows.length,4);assert.equal(new Set(report(c).rows.map(r=>r.id)).size,4);
 assert.ok(report(c).rows.every(r=>r.result==='difference'));assert.equal(requests(c),2);
 const b=reload(c,data);assert.equal(report(b).rows.length,4);assert.equal(requests(b),0);assert.equal((view(b).match(/data-price-row=/g)||[]).length,4);
});
test(supplier+': explicit document date selects active vs expired promotion, locally',async()=>{
 const data=fixture({unit:4,promo:supplier==='berman'?{fixedPrice:4}:{}}),c=create(data);await scan(c,data);
 assert.equal(report(c).rows[0].result,'match');c.run("priceAuditSetDate(0,'2026-10-01')");
 assert.equal(report(c).rows[0].promo,null);assert.equal(report(c).rows[0].result,'difference');assert.equal(requests(c),1);
});
test(supplier+': quantity promotion uses paper basket, never counted basket',async()=>{
 const data=fixture({unit:4,qty:10,promo:{minQty:10,...(supplier==='berman'?{fixedPrice:4}:{})}}),c=create(data);await scan(c,data);
 assert.equal(report(c).rows[0].result,'match');c.run("receiptList=[{productId:'milk',qty:1}];saveReceiptDraft();renderReceiving()");assert.equal(report(c).rows[0].result,'match');
 c.run('promos[0].minQty=11;renderReceiving()');assert.equal(report(c).rows[0].result,'difference');assert.equal(requests(c),1);
});
if(supplier!=='berman'){
 test(supplier+': one attributable summary discount derives charge once and labels it',async()=>{
  const data=fixture({unit:5,summary:10,promo:{}}),c=create(data);c.expectedUploads=1;const html=await scan(c,data);
  const r=report(c).rows[0];assert.equal(r.originalUnitPrice,5);assert.equal(r.chargedUnitPrice,4);assert.equal(r.result,'match');assert.match(html,/פחות הנחת סיכום ₪10\.00/);assert.equal(requests(c),1);record('summary discount',c,html);
 });
 test(supplier+': general discount without provable row allocation stays incomplete',async()=>{
  const data=fixture({summary:10,promo:{productIds:['milk','coffee']}}),d=data.paper.scan.documents[0];d.rows.push({...d.rows[0],code:'15',itemCode:'15',barcode:'7290000000015',barcodeObserved:'7290000000015',lineNumber:2});
  d.subtotalExVat=90;d.itemsSectionTotalExVat=100;d.printedLines=d.itemsPrintedLines=2;d.printedUnits=20;
  const c=create(data);await scan(c,data);assert.equal(report(c).complete,false);assert.match(view(c),/אין מספיק ראיות לשיוך/);assert.equal(requests(c),1);
 });
}
if(supplier==='yotvata'){
 test('yotvata: missing date falls back to today, flagged as assumed, and is correctable',async()=>{
  const data=fixture({unit:6}),c=create(data);let html=await scan(c,data,{completeDate:false});
  // The service returns no document date. The row is still evaluated, but the
  // assumption must be visible everywhere the verdict is shown.
  assert.match(html,/data-role="price-doc-date"/);
  let r=report(c).rows[0];
  assert.equal(r.result,'difference');
  assert.equal(r.dateAssumed,true);
  assert.equal(r.date,c.run('todayStr()'));
  assert.equal(report(c).documents[0].dateAssumed,true);
  assert.match(html,/משוער/);
  assert.match(html,/תאריך התעודה לא נקרא בפענוח/);
  // An assumed date must never be hidden behind a collapsed summary: it is the
  // summary line itself, so only the explanation and the field fold away.
  assert.match(html,/<summary[^>]*>(?:(?!<\/summary>)[\s\S])*תאריך משוער/);
  assert.doesNotMatch(html,/<summary[^>]*>תאריך התעודה: /);
  // Supplying the real date clears the assumption and every marker with it.
  await c.events.get('app:change')({target:{dataset:{role:'price-doc-date',doc:'0'},value:'2026-09-09'}});
  html=view(c); r=report(c).rows[0];
  assert.equal(r.result,'difference');
  assert.equal(r.dateAssumed,false);
  assert.equal(r.date,'2026-09-09');
  assert.doesNotMatch(html,/תאריך התעודה לא נקרא בפענוח/);
  assert.equal(c.run('receiptList.length'),0);assert.equal(requests(c),1);
 });
 test('yotvata: an assumed date never reads as a clean pass',async()=>{
  const data=fixture({unit:5}),c=create(data);const html=await scan(c,data,{completeDate:false});
  const r=report(c).rows[0];
  assert.equal(r.result,'match');
  assert.equal(r.dateAssumed,true);
  // headline must carry the caveat rather than a bare "prices match"
  assert.match(html,/המחירים שנבדקו תואמים · לפי תאריך משוער/);
  assert.equal(requests(c),1);
 });
 test('yotvata: row discount and summary already included are not applied twice',async()=>{
  const data=fixture({promo:{},summary:10}),d=data.paper.scan.documents[0];Object.assign(d.rows[0],{lineTotalExVat:40,lineDiscountExVat:10});
  const c=create(data);await scan(c,data);assert.equal(report(c).rows[0].chargedUnitPrice,4);assert.equal(report(c).rows[0].result,'match');assert.match(view(c),/לא הופחתה שוב/);assert.equal(requests(c),1);
 });
}
if(supplier==='berman'){
 for(const [unit,form] of [[10,'מחיר מלא'],[6,'מבצע חודשי'],[8,'הנחה קבועה'],[7,null],[4.8,null]])test('berman: active monthly promotion price '+unit,async()=>{
  const data=fixture({unit,base:10,discount:20,promo:{fixedPrice:6}}),c=create(data);c.expectedUploads=1;const html=await scan(c,data);const r=report(c).rows[0];
  assert.equal(r.originalUnitPrice,unit);assert.equal(r.adaptedUnitPrice,8);assert.equal(r.expectedOptions.length,3);assert.equal(r.result,form?'match':'difference');
  if(form)assert.deepEqual(r.matchedForms,[form]);else assert.match(html,/הפרש לשורה/);
  assert.match(html,/זיהוי המחיר אינו אישור שהתקבל זיכוי/);assert.equal(c.run('receiptPromoOnPaper.length'),0);assert.equal(requests(c),1);record('monthly price '+unit,c,html);
 });
 test('berman: matching forms at same price do not invent applied discount',async()=>{
  const data=fixture({unit:8,base:10,discount:20,promo:{fixedPrice:8}}),c=create(data);await scan(c,data);assert.equal(report(c).rows[0].matchedForms.length,2);assert.match(view(c),/לא ניתן לדעת איזו הנחה יושמה/);
 });
 test('berman: regular discount alone does not grant monthly exception',async()=>{
  const data=fixture({unit:8,base:10,discount:20}),c=create(data);await scan(c,data);assert.equal(report(c).rows[0].expectedOptions.length,1);assert.equal(report(c).rows[0].result,'difference');assert.equal(report(c).rows[0].monthlyStatus,null);
 });
 test('berman: mixed forms on same invoice and across invoices are per occurrence',async()=>{
  const data=fixture({unit:10,base:10,discount:20,promo:{fixedPrice:6}}),d=data.paper.scan.documents[0];
  d.rows.push({...d.rows[0],unitPriceExVat:6,lineTotalExVat:60,lineNumber:2},{...d.rows[0],unitPriceExVat:8,lineTotalExVat:80,lineNumber:3});
  d.printedLines=3;d.totalUnits=30;d.netToChargeExVat=240;const c=create(data);await scan(c,data,{documents:2});assert.equal(report(c).rows.length,6);assert.ok(report(c).rows.every(r=>r.result==='match'));assert.equal(new Set(report(c).rows.map(r=>r.id)).size,6);assert.equal(requests(c),2);
 });
}
test.after(()=>{if(process.env.PRICE_AUDIT_EVIDENCE)fs.writeFileSync(process.env.PRICE_AUDIT_EVIDENCE,JSON.stringify(evidence,null,2));});
for(const [label,unit,count] of [['shortage only',5,9],['price only',6,10],['price and shortage',6,9]]) test(supplier+': '+label+' survives summary and final save without duplicate money',async()=>{
 const data=fixture({unit}),c=create(data);
 // Berman has no printed row total; its existing charge gate is independent of
 // the printed-list review. Use the ordinary net charge for this finish fixture.
 if(supplier==='berman')data.paper.scan.documents[0].netToChargeExVat=50;
 await scan(c,data);const before=report(c);const uploadCount=requests(c);
 assert.equal(before.rows[0].result,unit===5?'match':'difference');
 c.run(`receiptList=[{productId:'milk',name:'מוצר בדיקה',barcode:'7290000000008',qty:${count}}];saveReceiptDraft();
   aiRunAnalyzer=async()=>{}; showConfirm=(title,text,label,fn)=>fn(); finishReceipt();`);
 if(supplier==='berman'){
   if(!c.run('!!pendingReceipt')) c.click('ai-close-receipt');
 }else c.run('aiApplyInvoiceResult();saveReconciledReceipt()');
 assert.ok(c.run('!!pendingReceipt'));const savedPending=JSON.parse(c.run('JSON.stringify(pendingReceipt)'));
 assert.equal((c.node('rsBody').innerHTML.match(/data-price-row=/g)||[]).length,1);
 assert.equal(report(c).rows[0].originalUnitPrice,unit);assert.equal(report(c).rows[0].quantity,10);
 assert.equal(savedPending.lines[0].qty,count);assert.equal(savedPending.lines[0].noteQty??count,10);
 assert.equal(Object.hasOwn(savedPending,'priceAuditAmount'),false);
 c.expectedUploads=uploadCount;record(label+' final summary',c,c.node('rsBody').innerHTML);
 // Complete through actual persistence API; two dairy apps require a synced
 // draft, covered independently by their existing transaction integration suite.
 if(supplier!=='berman')c.run('flushReceiptDraftToCloud=async()=>{receiptSync.dirty=false;return true;}');
 await c.run('confirmReceipt()');
 const saved=c.writes.find(w=>w.path?.includes('receipts'))?.data;assert.ok(saved);
 assert.equal(saved.priceAudit.rows.length,1);assert.equal(saved.priceAudit.rows[0].originalUnitPrice,unit);
 assert.equal(saved.totalExVat,savedPending.ex);assert.equal(saved.supplierDiscount,savedPending.supplierDiscount||0);
 assert.equal(c.run('aiScanResponse'),null);assert.equal(requests(c),uploadCount);
 assert.equal(report(reload(c,data)).state,'empty');
});
test(supplier+': save failure suspends review until persistence succeeds',async()=>{
 const data=fixture({unit:6}),c=create(data);await scan(c,data);
 const set=c.context.localStorage.setItem;c.context.localStorage.setItem=()=>{throw Error('full storage')};
 c.run('saveReceiptDraft()');assert.equal(report(c).state,'unsaved');assert.doesNotMatch(view(c),/המחירים שנבדקו תואמים/);
 c.context.localStorage.setItem=set;c.run('saveReceiptDraft()');assert.equal(report(c).rows[0].result,'difference');assert.equal(requests(c),1);
});
test(supplier+': catalog update refreshes price view while physical quantity input keeps focus',async()=>{
 const data=fixture({unit:6}),c=create(data);await scan(c,data);
 const active={tagName:'INPUT',value:'7',selectionStart:1};c.context.document.activeElement=active;c.node('app').contains=()=>true;
 c.run("products[0].price=6;products[0].listPrice=6;rerender()");
 assert.match(c.node('rcPriceAudit').innerHTML,/המחירים שנבדקו תואמים/);assert.equal(active.value,'7');assert.equal(active.selectionStart,1);assert.equal(requests(c),1);
});
test(supplier+': accepted identity correction rechecks saved original paper locally',async()=>{
 const data=fixture({unit:6}),c=create(data);await scan(c,data);
 c.run("Object.assign(aiScanResponse.scan.documents[0].rows[0],{barcode:null,barcodeObserved:null,barcodeReadType:'unreadable',barcodeMatchMethod:'suggested_name_multiple',catalogCandidateHintIds:['milk','coffee'],barcodeSuggestedCandidates:[{productId:'milk',barcode:'7290000000008'},{productId:'coffee',barcode:'7290000000015'}]});saveReceiptDraft()");
 assert.equal(report(c).rows[0].capability,'unidentified');
 assert.equal(c.run('aiConfirmNameCandidate(0,0,"milk")'),true);assert.equal(report(c).rows[0].originalUnitPrice,6);assert.equal(report(c).rows[0].result,'difference');assert.equal(requests(c),1);
});
test(supplier+': each document retains its own promotion date within one receipt',async()=>{
 const data=fixture({unit:4,promo:supplier==='berman'?{fixedPrice:4}:{}}),c=create(data);let calls=0;const original=c.context.fetch;
 c.context.fetch=async(url,options)=>{const response=await original(url,options);if(String(url).endsWith('/scan')){const payload=await response.json();++calls; if(supplier!=='yotvata')payload.scan.documents[0].docDate=calls===1?'2026-09-09':'2026-08-31';return {...response,json:async()=>payload};}return response;};
 await scan(c,data,{documents:2,completeDate:false}); if(supplier==='yotvata')c.run("priceAuditSetDate(0,'2026-09-09');priceAuditSetDate(1,'2026-08-31')");const rows=report(c).rows;
 assert.equal(rows[0].date,'2026-09-09');assert.equal(rows[0].result,'match');assert.equal(rows[1].date,'2026-08-31');assert.equal(rows[1].result,'difference');assert.equal(requests(c),2);
});

test(supplier+': carton promotion requires an explicit unit conversion',async()=>{
 const data=fixture({unit:4,qty:12,promo:{minQty:1,minUnit:'carton',cartonSize:12,...(supplier==='berman'?{fixedPrice:4}:{})}}),c=create(data);await scan(c,data);
 assert.equal(report(c).rows[0].result,'match');c.run('promos[0].cartonSize=null;renderReceiving()');
 assert.equal(report(c).rows[0].capability,'partial');assert.match(view(c),/חסר מספר יחידות בארגז/);assert.equal(requests(c),1);
});

// A verdict the review reached replaces the old alert; a row it could not check
// is not a verdict. Hiding the finding behind such a row dropped a real price
// warning and put nothing in its place.
test(supplier+': a row the review cannot check keeps the existing price warning',async()=>{
 const data=fixture({unit:6}),c=create(data);await scan(c,data);
 assert.equal(report(c).rows[0].result,'difference');
 assert.equal(c.run("priceAuditLegacyVisible({type:'price',productId:'milk'})"),false);
 c.run("products[0].price=0;products[0].listPrice=0;renderReceiving()");
 assert.equal(report(c).rows[0].capability,'missing_catalog_price');assert.equal(report(c).rows[0].result,null);
 assert.equal(c.run("priceAuditLegacyVisible({type:'price',productId:'milk'})"),true);
 assert.match(c.run("aiActionableFindingsHtml([{type:'price',productId:'milk',name:'מוצר בדיקה',text:'מחיר שונה: מוצר בדיקה'}])"),/מחיר שונה/);
 assert.equal(requests(c),1);
});
// The banner used to vanish for every product the moment the review produced a
// single row, including products the review never looked at.
test(supplier+': the promotion-mismatch banner is filtered per product, not switched off',async()=>{
 const data=fixture({unit:6}),c=create(data);await scan(c,data);
 const mismatch=[{productId:'milk',name:'מוצר בדיקה'},{productId:'coffee',name:'מוצר שני'}];
 const banner=()=>{c.run('presentReconcileSummary([],0,false,'+JSON.stringify({supplierPromoMismatchItems:mismatch})+')');
  return (c.node('rsBody').innerHTML.match(/מבצע שמוגדר במערכת לא הופיע[\s\S]*?<\/div><\/div>/)||[''])[0];};
 const judged=banner();assert.match(judged,/מוצר שני/);assert.doesNotMatch(judged,/מוצר בדיקה/);
 c.run("products[0].price=0;products[0].listPrice=0;renderReceiving()");
 assert.equal(report(c).rows[0].capability,'missing_catalog_price');
 assert.match(banner(),/מוצר בדיקה/);assert.equal(requests(c),1);
});
// The promotion ran on the day the document was issued and expired since. Judged
// by today, the expected price is rebuilt on a promotion that was not in force —
// and the credit demanded from the supplier is built on that price.
test(supplier+': an expired promotion is judged by the document date in both engines',async()=>{
 const day=n=>new Date(Date.now()+n*864e5).toISOString().slice(0,10),docDay=day(-40);
 const data=fixture({unit:5,date:docDay,promo:{start:day(-60),end:day(-30)}}),c=create(data);await scan(c,data);
 assert.equal(report(c).documents[0].date,docDay);assert.equal(c.run('priceAuditPromoDay()'),docDay);
 assert.equal(c.run('promoActive(promos[0],priceAuditPromoDay())'),true);
 assert.equal(c.run('promoActive(promos[0],activeReceiptDate())'),false);
 const priced=JSON.parse(c.run('JSON.stringify(aiEvaluateInvoiceScan(aiScanResponse).findings||[])')).filter(f=>f.productId==='milk'&&f.expectedPrice!=null);
 assert.ok(priced.length,'the comparison engine has to price the document');
 priced.forEach(f=>assert.equal(f.expectedPrice,4));
 assert.equal(requests(c),1);
});

// The receiving screen opened with a full page of notices before the first
// product could be scanned. A review with nothing to act on folds into its own
// summary line; a priced gap, or a row that could not be checked, stays open.
test(supplier+': a clean review folds into one line and a finding keeps it open',async()=>{
 const clean=fixture({unit:5}),c=create(clean);const quiet=await scan(c,clean);
 assert.match(quiet,/<details data-price-panel>/);
 assert.match(quiet,/המחירים שנבדקו תואמים/);
 assert.match(quiet,new RegExp('<summary[^>]*>(?:(?!</summary>)[\\s\\S])*'+report(c).rows.length+' שורות'));
 const gapData=fixture({unit:6}),g=create(gapData);const gap=await scan(g,gapData);
 assert.match(gap,/<details data-price-panel open>/);
 assert.match(gap,/המחיר בתעודה שונה מהמחיר שבמאגר/);
 g.run("products[0].price=0;products[0].listPrice=0;renderReceiving()");
 assert.equal(report(g).rows[0].capability,'missing_catalog_price');
 assert.match(view(g),/<details data-price-panel open>/);
 assert.equal(requests(c),1);assert.equal(requests(g),1);
});
