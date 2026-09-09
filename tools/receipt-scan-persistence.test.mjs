import test from 'node:test';
import assert from 'node:assert/strict';
import {runtime, fixture, supplier, fakeCloud} from './receipt-scan-harness.mjs';
const suppliers=[supplier];
const scanCount=c=>c.requests.filter(r=>r.url.endsWith('/scan')).length;
const raw=c=>c.run('aiScanResponse && aiScanResponse.scan.documents.length');
const reload=(s,c)=>runtime(s,{storage:c.storage});
const pause=()=>new Promise(r=>setImmediate(r));
for(const s of suppliers) {
  test(s+': HEALTHY initial scan -> count -> reload -> finish retains shortage and requests no new OCR',async()=>{
    const a=runtime(s);await a.scan();assert.equal(scanCount(a),1);
    const b=reload(s,a);assert.equal(b.run('receiptPaperScanState'),'ok');
    b.run('finishReceipt()');assert.equal(b.run('currentView'),'reconcile');
    assert.equal(b.run('aiScanReused'),true);assert.equal(b.run('aiScanEvaluation.errors.length'),0);
    assert.equal(b.run('aiScanEvaluation.findings.some(f=>f.type==="shortage"&&f.productId==="milk"&&f.qty===1)'),true);
    assert.match(b.node('app').innerHTML,/חסר 1/);assert.equal(scanCount(b),0);
  });
  test(s+': HEALTHY quantity changes recompute findings from same saved paper',async()=>{
    const a=runtime(s);await a.scan();const b=reload(s,a);
    b.run('receiptList[0].qty=11;saveReceiptDraft();finishReceipt()');
    assert.equal(b.run('aiScanEvaluation.findings.some(f=>f.type==="surplus"&&f.qty===1)'),true);
    assert.equal(scanCount(b),0);
  });
  test(s+': HEALTHY matching money with a different product still exposes shortage and surplus after reload',async()=>{
    const a=runtime(s);await a.scan();a.run("receiptList=[{productId:'coffee',name:'קפה בדיקה',qty:10}];saveReceiptDraft()");
    const b=reload(s,a);b.run('finishReceipt()');
    assert.equal(b.run('aiScanEvaluation.findings.some(f=>f.type==="shortage"&&f.productId==="milk")'),true);
    assert.equal(b.run('aiScanEvaluation.findings.some(f=>f.type==="surplus"&&f.productId==="coffee")'),true);
    assert.equal(scanCount(b),0);
  });
  test(s+': HEALTHY multiple documents retain original page counts and evaluate after reload',async()=>{
    const a=runtime(s);await a.scan(2);a.run(`
      aiScanDocuments[0].pages.push({...aiScanDocuments[0].pages[0]});
      aiScanResponse.scan.documents[0].pageCount=2;
      if(aiScanResponse.scan.documents[0].__tnuvaPaper) aiScanResponse.scan.documents[0].__tnuvaPaper.pageCount=2;
      saveReceiptDraft();`);
    const b=reload(s,a);assert.deepEqual(Array.from(b.run('aiScanDocuments.map(d=>d.restoredPageCount)')),[2,1]);
    b.run('finishReceipt()');assert.equal(b.run('aiScanReused'),true);
    assert.equal(b.run('aiScanEvaluation.errors.some(e=>e.includes("מספר העמודים"))'),false);
    assert.equal(scanCount(b),0);
  });
  test(s+': HEALTHY partial two-document failure retains first result and retries only the missing document',async()=>{
    const a=runtime(s);let calls=0;const original=a.context.fetch;
    a.context.fetch=async(...args)=>{if(args[0].endsWith('/scan')&&++calls===2)throw Error('network failure');return original(...args)};
    await a.scan(2);assert.equal(raw(a),1);assert.equal(a.run('receiptPaperScanState'),'failed');
    const b=reload(s,a);b.run("aiScanDocuments[1].pages=[{dataUrl:'data:image/jpeg;base64,YQ==',orientationConfirmed:true}]");
    await b.run(s+'StartPaperScan()');assert.equal(scanCount(b),1);assert.equal(raw(b),2);
    assert.equal(b.run('receiptPaperScanState'),'ok');
  });
  test(s+': HEALTHY cancellation rejects a late response',async()=>{
    const a=runtime(s);let release;const original=a.context.fetch;
    a.context.fetch=(url,options)=>url.endsWith('/scan')?new Promise(r=>{release=()=>original(url,options).then(r)}):original(url,options);
    const running=a.scan();await pause();a.run(`${s}ResetPhotoReceipt();aiScanResponse=null;aiScanDocuments=[];`);
    release();await running;assert.equal(raw(a),null);assert.equal(a.run('receiptPaperScanState'),'');
  });
  test(s+': HEALTHY reload during pending scan reports interruption and sends nothing automatically',async()=>{
    const a=runtime(s);a.run(`receiptOpened=true;receiptPaperScanState='running';
      aiScanDocuments=[{amount:null,units:null,pages:[{dataUrl:'data:image/jpeg;base64,YQ=='}]}];saveReceiptDraft()`);
    const b=reload(s,a);assert.equal(b.run('receiptPaperScanState'),'interrupted');assert.equal(scanCount(b),0);
  });
  test(s+': HEALTHY failed final write keeps draft and parsed result',async()=>{
    const cloud=fakeCloud(),a=runtime(s,{cloud});await cloud.tick();await a.scan();a.run('finishReceipt();aiApplyInvoiceResult();saveReconciledReceipt();runCloudTask=async()=>false');
    assert.equal(a.run('!!pendingReceipt'),true);await a.run('confirmReceipt()');
    assert.equal(raw(a),1);assert.equal(raw(reload(s,a)),1);
  });
  test(s+': HEALTHY legacy manual receipt without scan retains manual completion',()=>{
    const a=runtime(s);a.run(`receiptEntryMode='manual';receiptAnchorSource='manual';receiptOpened=true;
      receiptList=[{productId:'milk',name:'חלב בדיקה',qty:10}];receiptNotes=[{amount:50,units:10,lines:1}];recomputeNoteTotal();saveReceiptDraft()`);
    const b=reload(s,a);b.run('finishReceipt()');assert.equal(b.run('receiptEntryMode'),'manual');assert.equal(scanCount(b),0);
  });
  test(s+': removed photo remains invalid after reload',async()=>{
    const a=runtime(s);await a.scan();a.run('finishReceipt()');assert.match(a.node('app').innerHTML,/data-role="ai-edit-images"/);a.click('ai-edit-images');a.click('ai-remove-page',null,{doc:'0',page:'0'});
    assert.equal(raw(a),null);const b=reload(s,a);assert.equal(raw(b),null);
    assert.equal(b.run(s+'CachedDoc(aiScanDocuments[0])'),false);
    assert.equal(b.run('receiptPaperScanState'),'failed');
    b.run('finishReceipt()');assert.equal(b.run('aiScanEvaluation'),null);
  });
  test(s+': editing one document keeps the other result and only the changed document needs OCR',async()=>{
    const a=runtime(s);await a.scan(2);a.run('finishReceipt()');a.click('ai-edit-images');a.click('ai-remove-page',null,{doc:'1',page:'0'});
    assert.equal(a.run(s+'CachedDoc(aiScanDocuments[0])'),true);
    a.click('rc-recon-cancel');a.click('rc-plus','milk');const b=reload(s,a);
    assert.equal(raw(b),1);assert.equal(b.run(s+'CachedDoc(aiScanDocuments[0])'),true);
    assert.equal(b.run('receiptPaperScanState'),'failed');assert.equal(b.run(s+'PhotoReady()'),false);
    b.run("aiScanDocuments[1].pages=[{dataUrl:'data:image/jpeg;base64,YQ==',orientationConfirmed:true}]");
    await b.run(s+'StartPaperScan()');assert.equal(scanCount(b),1);assert.equal(raw(b),2);
  });
  test(s+': removed document stays removed and remaining anchors are recomputed',async()=>{
    const a=runtime(s);await a.scan(2);a.click('rc-notes-edit');a.click('rc-photo-capture');a.click('rc-photo-remove-doc',null,{doc:'0'});
    assert.equal(a.run('aiScanDocuments.length'),1);const b=reload(s,a);
    assert.equal(b.run('aiScanDocuments.length'),1);assert.equal(raw(b),1);
    assert.equal(b.run('receiptNoteTotal'),50);assert.equal(b.run('receiptPaperScanState'),'ok');
  });
  test(s+': added unfinished document survives reload',async()=>{
    const a=runtime(s);await a.scan();a.click('rc-notes-edit');a.click('rc-photo-capture');a.click('rc-photo-add-doc');
    assert.equal(a.run('aiScanDocuments.length'),2);const b=reload(s,a);
    assert.equal(b.run('aiScanDocuments.length'),2);assert.equal(raw(b),1);
    assert.equal(b.run('receiptPaperScanState'),'failed');
  });
  test(s+': storage fallback warns immediately and preserves counted quantities',async()=>{
    const a=runtime(s);await a.scan();a.context.persist=(k,v)=>a.storage.set(k,v);a.toasts.length=0;
    a.run(`localStorage.setItem=(k,v)=>{if(JSON.parse(v).aiScan)throw Error('QuotaExceededError');persist(k,v)};saveReceiptDraft()`);
    assert.equal(a.toasts.length,1);assert.match(a.toasts[0],/אין מקום לפענוח/);const b=reload(s,a);assert.equal(raw(b),null);
    assert.equal(b.run('receiptList.length'),1);assert.equal(b.run('receiptPaperScanState'),'failed');
    b.run('finishReceipt()');assert.match(b.toasts.at(-1),/השלם צילום/);
  });
  test(s+': complete storage failure warns without claiming that recent changes are saved',async()=>{
    const a=runtime(s);await a.scan();a.toasts.length=0;
    a.run(`localStorage.setItem=()=>{throw Error('QuotaExceededError')};receiptList[0].qty=12;saveReceiptDraft()`);
    assert.equal(a.toasts.length,1);const b=reload(s,a);
    assert.equal(b.run('receiptList[0].qty'),9);
  });
  test(s+': legacy manual confirmation metadata is persisted',async()=>{
    const a=runtime(s);await a.scan();a.run(`Object.assign(aiScanResponse.scan.documents[0].rows[0],{
      description:'משקה בדיקה',barcode:null,barcodeObserved:null,barcodeReadType:'unreadable',barcodeMatchMethod:'suggested_name_multiple',
      catalogCandidateHintIds:['milk','coffee'],barcodeSuggestedCandidates:[{productId:'milk',barcode:'7290000000008'},{productId:'coffee',barcode:'7290000000015'}]});
      saveReceiptDraft();finishReceipt()`);
    assert.equal(a.run('aiConfirmNameCandidate(0,0,"milk")'),true);
    assert.equal(a.run('aiScanResponse.scan.documents[0].rows[0].barcodeMatchMethod'),'user_confirmed');
    const b=reload(s,a);assert.equal(b.run('aiScanResponse.scan.documents[0].rows[0].barcodeMatchMethod'),'user_confirmed');
    assert.equal(b.run('aiConfirmedMappingsAudit().length'),1);
    b.run('finishReceipt()');assert.equal(b.run('app.innerHTML.includes(\"data-role=\\\"ai-confirm-name-candidate\\\"\")'),false);
  });
  test(s+': successful final write retains the complete parsed source',async()=>{
    const cloud=fakeCloud(),a=runtime(s,{cloud});await cloud.tick();await a.scan();a.run('finishReceipt();aiApplyInvoiceResult();saveReconciledReceipt()');await a.run('confirmReceipt()');
    const d=a.writes[0].data;assert.ok(d.scanAudit);assert.ok(d.aiAudit);assert.ok(d.aiAudit.findings.length);
    assert.ok(d.paperScan);a.context.packed=d.paperScan;
    assert.equal((await a.run('unpackReceiptValue(packed)')).scan.documents[0].rows[0].quantity,10);
    assert.equal(typeof d.aiAudit.documents[0].rows,'number');assert.equal(raw(reload(s,a)),null);
  });
  test(s+': active scan and count resume on another device without another OCR request',async()=>{
    const cloud=fakeCloud(),a=runtime(s,{cloud});await cloud.tick();await a.scan();
    assert.equal(await a.run('flushReceiptDraftToCloud()'),true);
    const otherDevice=runtime(s,{cloud});await cloud.tick();assert.equal(raw(otherDevice),1);
    assert.equal(otherDevice.run('receiptList[0].qty'),9);otherDevice.run('finishReceipt()');
    assert.equal(otherDevice.run('aiScanEvaluation.findings.some(f=>f.type==="shortage"&&f.qty===1)'),true);assert.equal(scanCount(otherDevice),0);
  });
  test(s+': unchanged discrepancies reuse text analysis without resending photos',async()=>{
    const a=runtime(s);await a.scan();a.run('aiRunAnalyzer=auditOriginalAnalyzer;finishReceipt()');await pause();
    a.click('rc-recon-cancel');a.run('finishReceipt()');await pause();
    const uploads=a.requests.filter(r=>r.body&&JSON.parse(r.body).mode!=='analyze');
    const analyses=a.requests.filter(r=>r.body&&JSON.parse(r.body).mode==='analyze');
    assert.equal(uploads.length,1);assert.equal(analyses.length,s==='tnuva'?1:0);
  });
}
