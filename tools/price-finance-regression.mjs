// Run from any working directory. Compare real full-app final financial state
// against the pre-change main commit; snapshots/audit timestamps are excluded.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const supplier='yotvata', base='e86c423df715fd526bbe8b5b41494a0e54f0b9c6';
const repo=fileURLToPath(new URL('../',import.meta.url));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'paper-price-baseline-'));
const original=path.join(temp,'index.html');fs.writeFileSync(original,execFileSync('git',['show',base+':index.html'],{cwd:repo,maxBuffer:8*1024*1024}));
const key=supplier==='berman'?'BERMAN_TEST_APP':'RECEIPT_TEST_APP';
const fields=['lines','ex','calculatedEx','receivedEx','roundingAdjustment','grossEx','supplierDiscount','supplierPromoItems','supplierPromoMismatchItems','supplierCreditClaim','monthEndPending','promoOnPaper','noteTotal','status','noteParts','unresolvedAmountGap','unresolvedUnitsGap'];
async function run(old,unit,count){
 process.env[key]=old?original:path.join(repo,'index.html');
 const h=await import('./receipt-scan-harness.mjs?'+(old?'old':'new')+'-'+unit+'-'+count);
 const p={id:'milk',name:'מוצר בדיקה',code:'8',barcode:'7290000000008',price:5,listPrice:5,discountPct:0,discountSet:true};
 const row={section:'items',code:'8',itemCode:'8',supplierItemCode:'8',description:p.name,barcode:p.barcode,barcodeObserved:p.barcode,barcodeReadType:'full',barcodeMatchMethod:'exact_full',sourcePage:1,lineNumber:1,quantity:10,unitPriceExVat:unit,grossLineTotalExVat:unit*10,lineTotalExVat:unit*10,lineDiscountExVat:0,confidence:.99};
 const doc={noteIndex:0,docDate:'2026-09-09',docNumber:'BASELINE',invoiceNumber:'BASELINE',docType:'invoice',pageCount:1,subtotalExVat:unit*10,netToChargeExVat:50,totalUnits:10,printedUnits:10,itemsPrintedLines:1,printedLines:1,itemsSectionTotalExVat:unit*10,promoDiscountExVat:0,documentDiscountExVat:0,rows:[row],warnings:[],confidence:.99};
 const data={products:[p],promos:[],items:[{productId:p.id,name:p.name,barcode:p.barcode,qty:count}],paper:{ok:true,serviceVersion:supplier==='tnuva'?10:supplier==='yotvata'?145:4,model:'fixture',scan:{documents:[doc],warnings:[]}}};
 const c=supplier==='berman'?h.runtime({data}):h.runtime(supplier,{data});await c.scan();
 c.run("showConfirm=(title,text,label,fn)=>fn();finishReceipt()");
 if(supplier==='berman'){if(!c.run('!!pendingReceipt'))c.click('ai-close-receipt');}
 else c.run('aiApplyInvoiceResult();saveReconciledReceipt()');
 const pending=JSON.parse(c.run('JSON.stringify(pendingReceipt)'));assert.ok(pending);
 return Object.fromEntries(fields.filter(k=>k in pending).map(k=>[k,pending[k]]));
}
try{
 for(const unit of [5,6])for(const count of [9,10,11]){
  const old=await run(true,unit,count),next=await run(false,unit,count);
  assert.deepEqual(next,old);console.log('PASS',supplier,'printed price',unit,'counted',count,'payable',next.ex,'identical to',base.slice(0,7));
 }
}finally{delete process.env[key];fs.rmSync(temp,{recursive:true,force:true});}
