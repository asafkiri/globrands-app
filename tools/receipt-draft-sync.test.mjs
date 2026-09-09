import test from 'node:test';
import assert from 'node:assert/strict';
import {runtime, supplier as s, fakeCloud} from './receipt-scan-harness.mjs';
const raw=a=>a.run('aiScanResponse?.scan.documents.length || 0');
const plain=v=>JSON.parse(JSON.stringify(v));
const paperRequests=a=>a.requests.filter(r=>r.body&&JSON.parse(r.body).mode!=='analyze').length;
const analyses=a=>a.requests.filter(r=>r.body&&JSON.parse(r.body).mode==='analyze').length;
async function shared() {const cloud=fakeCloud(),a=runtime(s,{cloud});await cloud.tick();await a.scan();assert.equal(await a.run('flushReceiptDraftToCloud()'),true);const b=runtime(s,{cloud});await cloud.tick();return {cloud,a,b};}
const draft=c=>[...c.documents.entries()].find(([k])=>k.endsWith('/drafts/receipt'))?.[1];
function actualFinal(a) {a.run(`runCloudTask=async(label,task)=>{testWrites.push(structuredClone(task));try{await executeCloudTask(task);return true}catch(e){testToasts.push(e.message);return false}}`)}
async function finish(a) {a.run('finishReceipt();aiApplyInvoiceResult();saveReconciledReceipt()');assert.equal(a.run('!!pendingReceipt'),true);await a.run('confirmReceipt()');}

test(s+': compressed multi-document source round-trips without truncation or images',async()=>{
 const a=runtime(s);await a.scan(4);const source=plain(a.run('receiptDraftPayload(true)'));
 for(const d of source.aiScan.scan.documents)d.rows=Array.from({length:1000},()=>structuredClone(d.rows[0]));
 a.context.value=source;const packed=await a.run('packReceiptValue(value)');assert.equal(packed.encoding,'gzip-base64');assert.ok(packed.data.length<850000);
 a.context.packed=packed;assert.deepEqual(plain(await a.run('unpackReceiptValue(packed)')),source);assert.doesNotMatch(JSON.stringify(source),/data:image|Zml4dHVyZQ==/);
});
test(s+': a failed image preparation retains the prior valid paper on screen and after reload',async()=>{
 const a=runtime(s);await a.scan();a.run('aiCompressInvoiceImage=async()=>{throw Error("image_too_large")}');await a.run('aiAddInvoiceFiles(0,[{}])');
 assert.equal(raw(a),1);assert.equal(a.run(s+'CachedDoc(aiScanDocuments[0])'),true);assert.equal(raw(runtime(s,{storage:a.storage})),1);assert.match(a.run('aiScanError'),/גדולה מדי/);
});
test(s+': cancel during image preparation cannot populate a new draft with old photos',async()=>{
 const a=runtime(s);await a.scan();let release;a.context.aiCompressInvoiceImage=()=>new Promise(r=>release=r);
 const work=a.run('aiAddInvoiceFiles(0,[{}])');a.run(`${s}ResetPhotoReceipt();aiScanDocuments=[];aiScanResponse=null;aiScanBusy=false;saveReceiptDraft()`);release({dataUrl:'old',orientationConfirmed:false});await work;
 assert.equal(a.run('aiScanDocuments.length'),0);assert.equal(raw(a),0);assert.equal(raw(runtime(s,{storage:a.storage})),0);
});
test(s+': serialization preserves source identity used by existing product confirmation dialogs',async()=>{
 const a=runtime(s);await a.scan();assert.equal(a.run('const identity=aiScanResponse;saveReceiptDraft();identity===aiScanResponse'),true);
});
test(s+': quota-reduced draft recovers the complete source from its own acknowledged cloud version',async()=>{
 const {cloud,a}=await shared();a.context.persist=(k,v)=>a.storage.set(k,v);
 a.run(`localStorage.setItem=(k,v)=>{if(JSON.parse(v).aiScan)throw Error('QuotaExceededError');persist(k,v)};saveReceiptDraft()`);
 const b=runtime(s,{storage:a.storage,cloud});assert.equal(raw(b),0);await cloud.tick();assert.equal(raw(b),1);assert.equal(b.run('receiptPaperScanState'),'ok');b.run('finishReceipt()');assert.match(b.node('app').innerHTML,/חסר 1/);assert.equal(paperRequests(b),0);
});
test(s+': offline edits retain scan locally and publish on reconnect without OCR',async()=>{
 const {cloud,a}=await shared();a.context.navigator.onLine=false;a.run('receiptList[0].qty=12;saveReceiptDraft()');assert.equal(await a.run('flushReceiptDraftToCloud()'),false);
 const b=runtime(s,{storage:a.storage,cloud});await cloud.tick();assert.equal(b.run('receiptList[0].qty'),12);assert.equal(raw(b),1);assert.equal(await b.run('flushReceiptDraftToCloud()'),true);await cloud.tick();assert.equal(paperRequests(b),0);
});
for(const keepLocal of [true,false]) test(s+': concurrent edits preserve both versions when choosing '+(keepLocal?'local':'cloud'),async()=>{
 const {cloud,a,b}=await shared();a.run('receiptList[0].qty=10;saveReceiptDraft()');b.run('receiptList[0].qty=12;saveReceiptDraft()');assert.equal(await a.run('flushReceiptDraftToCloud()'),true);await cloud.tick();
 assert.equal(await b.run('flushReceiptDraftToCloud()'),false);assert.equal(b.run('receiptList[0].qty'),12);assert.equal(b.run('!!receiptSyncConflict'),true);assert.match(b.node('rcDraftStatus').innerHTML,/מכשיר אחר/);
 await b.run(`resolveReceiptDraftConflict(${keepLocal})`);await cloud.tick();assert.equal(b.run('receiptList[0].qty'),keepLocal?12:10);assert.equal(raw(b),1);
 const backups=[...cloud.documents.entries()].filter(([key])=>key.includes('receipt_backup_'));assert.equal(backups.length,1);b.context.backup=backups[0][1].content;
 assert.equal((await b.run('unpackReceiptValue(backup)')).items[0].qty,keepLocal?10:12);
});
test(s+': an edit while an incoming draft is decompressing is never overwritten',async()=>{
 const {cloud,a,b}=await shared();const original=b.run('unpackReceiptValue');let release;b.context.unpackReceiptValue=value=>new Promise(r=>release=()=>original(value).then(r));
 a.run('receiptList[0].qty=10;saveReceiptDraft()');await a.run('flushReceiptDraftToCloud()');await cloud.tick();assert.equal(typeof release,'function');
 b.run('receiptList[0].qty=13;saveReceiptDraft()');release();await cloud.tick();assert.equal(b.run('receiptList[0].qty'),13);assert.equal(b.run('!!receiptSyncConflict'),true);
});
test(s+': final receipt and empty draft commit together, with full source; second device cannot resurrect it',async()=>{
 const {cloud,a,b}=await shared();actualFinal(a);await finish(a);await cloud.tick();
 assert.equal(draft(cloud).active,false);assert.equal(raw(a),0);assert.equal(raw(b),0);assert.equal(b.run('receiptList.length'),0);
 const receipts=[...cloud.documents.entries()].filter(([k])=>k.includes('/receipts/'));assert.equal(receipts.length,1);assert.ok(receipts[0][1].paperScan);
 assert.equal(await b.run('flushReceiptDraftToCloud()'),true);assert.equal(draft(cloud).active,false);
 // Retrying the identical acknowledged operation cannot create a second receipt.
 a.context.task=a.writes[0];await a.run('executeCloudTask(task)');assert.equal([...cloud.documents.keys()].filter(k=>k.includes('/receipts/')).length,1);
});
test(s+': stale completion cannot discard changes from the other device',async()=>{
 const {cloud,a,b}=await shared();a.run('finishReceipt();aiApplyInvoiceResult();saveReconciledReceipt()');
 b.run('receiptList[0].qty=11;saveReceiptDraft()');await b.run('flushReceiptDraftToCloud()');await cloud.tick();actualFinal(a);await a.run('confirmReceipt()');
 assert.equal([...cloud.documents.keys()].filter(k=>k.includes('/receipts/')).length,0);assert.equal(a.run('receiptList[0].qty'),11);assert.equal(draft(cloud).active,true);
});
test(s+': final transaction failure keeps all data and retry saves once',async()=>{
 const {cloud,a}=await shared();actualFinal(a);const original=a.context.runTransaction;
 a.run('finishReceipt();aiApplyInvoiceResult();saveReconciledReceipt()');await a.run('flushReceiptDraftToCloud()');a.context.runTransaction=async()=>{throw Error('permission-denied')};await a.run('confirmReceipt()');
 assert.equal(raw(a),1);assert.equal(draft(cloud).active,true);assert.equal(a.run('!!pendingReceipt'),true);a.context.runTransaction=original;await a.run('confirmReceipt()');await cloud.tick();
 assert.equal(draft(cloud).active,false);assert.equal([...cloud.documents.keys()].filter(k=>k.includes('/receipts/')).length,1);
});
test(s+': unchanged analyzer input is cached across reload; quantity change requires fresh analysis',async()=>{
 const a=runtime(s);await a.scan();a.run('finishReceipt();aiRunAnalyzer=auditOriginalAnalyzer');await a.run('aiRunAnalyzer()');assert.equal(analyses(a),1);
 const b=runtime(s,{storage:a.storage});b.run('finishReceipt();aiRunAnalyzer=auditOriginalAnalyzer');await b.run('aiRunAnalyzer()');assert.equal(analyses(b),0);
 b.click('rc-recon-cancel');b.run('receiptList[0].qty=12;saveReceiptDraft();finishReceipt()');await b.run('aiRunAnalyzer()');assert.equal(analyses(b),1);assert.equal(paperRequests(b),0);
});

test(s+': actual review-screen rescan after changing a photo rebuilds paper anchors and visible findings',async()=>{
 const a=runtime(s);await a.scan(2);a.run('finishReceipt()');a.click('ai-edit-images');a.click('ai-remove-page',null,{doc:'1',page:'0'});
 a.run("aiScanDocuments[1].pages=[{dataUrl:'data:image/jpeg;base64,YQ==',orientationConfirmed:true}]");
 const previous=paperRequests(a);await a.run('aiRunInvoiceScan()');assert.equal(paperRequests(a),previous+1);assert.equal(raw(a),2);
 assert.equal(a.run('receiptNoteTotal'),100);assert.equal(a.run('receiptPaperScanState'),'ok');assert.equal(a.run('aiScanEvaluation.errors.length'),0);assert.match(a.node('app').innerHTML,/חסר 11/);
});
test(s+': review of fully cached documents after reload continues without a new upload',async()=>{
 const a=runtime(s);await a.scan();const b=runtime(s,{storage:a.storage});b.run('finishReceipt()');b.click('ai-edit-images');
 assert.match(b.node('app').innerHTML,/המשך עם הפענוח השמור/);b.context.fetch=async()=>{throw Error('offline; cached reuse must not touch network')};await b.run('aiRunInvoiceScan()');assert.equal(paperRequests(b),0);assert.equal(b.run('aiScanEvaluation.errors.length'),0);
});

test(s+': comparison failure retains paper and a later retry renders findings without OCR',async()=>{
 const a=runtime(s);await a.scan();const original=a.run('aiEvaluateInvoiceScan');a.context.aiEvaluateInvoiceScan=()=>{throw Error('comparison failure')};
 a.run('finishReceipt()');assert.equal(raw(a),1);assert.equal(a.run('aiScanEvaluation'),null);assert.match(a.node('app').innerHTML,/הפענוח נשמר/);
 a.context.aiEvaluateInvoiceScan=original;a.click('rc-recon-cancel');a.run('finishReceipt()');assert.match(a.node('app').innerHTML,/חסר 1/);assert.equal(paperRequests(a),1);
});
test(s+': a late analyzer response cannot replace a cancelled draft or its new evaluation',async()=>{
 const a=runtime(s);await a.scan();a.run('finishReceipt();aiRunAnalyzer=auditOriginalAnalyzer');const original=a.context.fetch;let release;
 a.context.fetch=(url,options)=>options?.body&&JSON.parse(options.body).mode==='analyze'?new Promise(r=>release=()=>original(url,options).then(r)):original(url,options);
 const work=a.run('aiRunAnalyzer()');await new Promise(r=>setImmediate(r));a.run(`${s}ResetPhotoReceipt();aiScanResponse=null;aiScanEvaluation=null;aiAnalyzeBusy=false;aiScanDocuments=[];receiptList=[];receiptNotes=[];receiptDraftId=null;saveReceiptDraft()`);
 release();await work;assert.equal(a.run('receiptAnalysisCache'),null);assert.equal(a.run('aiAnalyzeResult'),null);assert.equal(raw(a),0);
});
for(const noDoc of [false,true]) test(s+': '+(noDoc?'no-document':'manual')+' receiving still completes without OCR',async()=>{
 const cloud=fakeCloud(),a=runtime(s,{cloud});await cloud.tick();actualFinal(a);
 a.run(`receiptEntryMode='manual';receiptAnchorSource='manual';receiptOpened=true;receiptNoDoc=${noDoc};receiptDupConfirmed=true;
 receiptList=[{productId:'milk',name:'חלב בדיקה',qty:10}];receiptNotes=${noDoc?'[]':'[{amount:50,units:10,lines:1}]'};recomputeNoteTotal();saveReceiptDraft();finishReceipt()`);
 assert.ok(a.run('pendingReceipt'));await a.run('confirmReceipt()');assert.equal(a.run('receiptList.length'),0,a.toasts.join('\n'));assert.equal(paperRequests(a),0);assert.equal(draft(cloud).active,false);
 const saved=[...cloud.documents.entries()].find(([k])=>k.includes('/receipts/'))[1];assert.equal(saved.paperScan,null);assert.equal(saved.noDoc,noDoc);
});
