// Runs the entire application against the real Firebase SDK and a local emulator.
// RECEIPT_FIREBASE_TEST_DEPS=/path/with/node_modules FIRESTORE_EMULATOR_HOST=127.0.0.1:8787 node --test tools/receipt-firestore.integration.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {runtime,supplier as s} from './receipt-scan-harness.mjs';
const require=createRequire(path.join(process.env.RECEIPT_FIREBASE_TEST_DEPS || process.cwd(),'package.json'));
const {initializeApp,deleteApp}=require('firebase/app');
const sdk=require('firebase/firestore');
const emulator=process.env.FIRESTORE_EMULATOR_HOST;
if(!emulator||!/^127\.0\.0\.1:\d+$/.test(emulator))throw Error('A local FIRESTORE_EMULATOR_HOST is required; live Firebase is never used.');
const wait=async condition=>{for(let i=0;i<400;i++){if(condition())return;await new Promise(r=>setTimeout(r,25));}throw Error('Emulator state did not settle');};
function firestoreBoundary(){
 const clients=new Map(),unsubscribers=[],prefix='integration_'+s+'_'+Date.now()+'_'+Math.random().toString(36).slice(2);
 const client=context=>{if(!clients.has(context)){const app=initializeApp({projectId:'demo-receipt-scan',apiKey:'emulator-only'},prefix+'_'+clients.size);const db=sdk.initializeFirestore(app,{experimentalForceLongPolling:true});const [host,port]=emulator.split(':');sdk.connectFirestoreEmulator(db,host,Number(port));clients.set(context,{app,db});}return clients.get(context).db;};
 const ref=(context,key)=>sdk.doc(client(context),'runs',prefix,...key.split('/'));
 return {
  async transaction(fn,context){return sdk.runTransaction(client(context),tx=>fn({get:key=>tx.get(ref(context,key)),set:(key,value)=>tx.set(ref(context,key),structuredClone(value))}));},
  subscribe(key,listener,context){const off=sdk.onSnapshot(ref(context,key),{includeMetadataChanges:true},listener);unsubscribers.push(off);return off;},
  read:async(context,key)=>(await sdk.getDocFromServer(ref(context,key))).data(),
  query:async(context,key)=>(await sdk.getDocsFromServer(sdk.collection(client(context),'runs',prefix,...key.split('/')))).docs.map(d=>({id:d.id,...d.data()})),
  async close(){for(const off of unsubscribers)off();for(const {app,db} of clients.values()){await sdk.terminate(db);await deleteApp(app);}}
 };
}
const raw=a=>a.run('aiScanResponse?.scan.documents.length || 0');
const location=(a,name,id)=>a.run(`dataPath('${name}','${id}').join('/')`);
const enableFinal=a=>a.run(`runCloudTask=async(label,task)=>{testWrites.push(structuredClone(task));try{await executeCloudTask(task);return true}catch(e){testToasts.push(e.message);return false}}`);
test(s+': real Firestore transactions preserve source across devices and atomically finalize',async()=>{
 const cloud=firestoreBoundary();try{
 const a=runtime(s,{cloud});await wait(()=>a.run('receiptCloudReady'));await a.scan(2);assert.equal(await a.run('flushReceiptDraftToCloud()'),true,a.run('receiptSyncError'));
 const b=runtime(s,{cloud});await wait(()=>raw(b)===2);assert.equal(b.run('receiptList[0].qty'),9);b.run('finishReceipt()');assert.match(b.node('app').innerHTML,/חסר 11/);assert.equal(b.requests.filter(r=>r.body).length,0);
 enableFinal(b);b.run('aiApplyInvoiceResult();saveReconciledReceipt()');assert.ok(b.run('pendingReceipt'));await b.run('confirmReceipt()');
 assert.equal(raw(b),0,b.toasts.join('\n'));await wait(()=>raw(a)===0);
 const d=await cloud.read(a.context,location(a,'drafts','receipt'));assert.equal(d.active,false);
 const receipts=await cloud.query(a.context,a.run("dataPath('receipts','').slice(0,-1).join('/')"));assert.equal(receipts.length,1);a.context.packed=receipts[0].paperScan;
 assert.equal((await a.run('unpackReceiptValue(packed)')).scan.documents.length,2);
 b.context.task=b.writes[0];await b.run('executeCloudTask(task)');assert.equal((await cloud.query(a.context,a.run("dataPath('receipts','').slice(0,-1).join('/')"))).length,1);
 }finally{await cloud.close();}
});
test(s+': real Firestore concurrent transactions prevent silent overwrite and archive the losing version',async()=>{
 const cloud=firestoreBoundary();try{
 const a=runtime(s,{cloud});await wait(()=>a.run('receiptCloudReady'));await a.scan();assert.equal(await a.run('flushReceiptDraftToCloud()'),true);
 const b=runtime(s,{cloud});await wait(()=>raw(b)===1);
 a.run('receiptList[0].qty=12;saveReceiptDraft()');b.run('receiptList[0].qty=13;saveReceiptDraft()');
 const results=await Promise.all([a.run('flushReceiptDraftToCloud()'),b.run('flushReceiptDraftToCloud()')]);assert.equal(results.filter(Boolean).length,1);
 const losing=results[0]?b:a,winningQty=results[0]?12:13,localQty=results[0]?13:12;await wait(()=>losing.run('!!receiptSyncConflict'));
 assert.equal(losing.run('receiptList[0].qty'),localQty);await losing.run('resolveReceiptDraftConflict(true)');assert.equal(losing.run('receiptList[0].qty'),localQty);assert.equal(raw(losing),1);
 const docs=await cloud.query(losing.context,losing.run("dataPath('drafts','').slice(0,-1).join('/')"));const backup=docs.find(d=>d.id.startsWith('receipt_backup_'));assert.ok(backup);
 losing.context.packed=backup.content;assert.equal((await losing.run('unpackReceiptValue(packed)')).items[0].qty,winningQty);
 }finally{await cloud.close();}
});
