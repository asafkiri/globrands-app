// Full app replay with synthetic supplier response; no production/AI connection.
// node tools/early-price-preview.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
const supplier='yotvata';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const moduleSource=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import[\s\S]*?from "https:\/\/www\.gstatic\.com\/firebasejs\/[^"\n]+";\n/gm,'');
const product={id:'milk',name:'מוצר בדיקה',barcode:'7290000000008',code:'8',price:5,listPrice:5,discountPct:0,discountSet:true};
const row={code:'8',itemCode:'8',section:'items',supplierItemCode:'8',description:'מוצר בדיקה',barcode:product.barcode,barcodeObserved:product.barcode,barcodeReadType:'full',barcodeMatchMethod:'exact_full',quantity:10,unitPriceExVat:6,lineTotalExVat:60,grossLineTotalExVat:60,lineDiscountExVat:0,sourcePage:1,lineNumber:1,confidence:.99};
const paper={ok:true,serviceVersion:supplier==='tnuva'?10:supplier==='yotvata'?145:4,model:'fixture',requestId:'preview',scan:{warnings:[],documents:[{noteIndex:0,docNumber:'INV-100',invoiceNumber:'INV-100',...(supplier==='yotvata'?{}:{docDate:'2026-09-09'}),docType:'invoice',pageCount:1,rows:[row],subtotalExVat:60,itemsSectionTotalExVat:60,netToChargeExVat:60,itemsPrintedLines:1,printedLines:1,printedUnits:10,totalUnits:10,promoDiscountExVat:0,documentDiscountExVat:0,warnings:[],confidence:.99}]}};
const setup=`const initializeApp=()=>({}),getAuth=()=>({currentUser:{getIdToken:async()=>'local-test'}}),initializeFirestore=()=>({}),getFirestore=()=>({}),persistentLocalCache=()=>({}),persistentMultipleTabManager=()=>({}),signInAnonymously=async()=>({}),onAuthStateChanged=()=>{};`;
const replay=`
products=${JSON.stringify([product])};promos=[];currentView='receiving';mainMode='receiving';
openReceivingScanner=()=>{scanPurpose='receiving';const m=$('scanModal');m.classList.remove('hidden');m.classList.add('flex');refreshPriceScannerNotice();};
if(typeof scheduleReceiptDraftSync==='function')scheduleReceiptDraftSync=()=>{};
runCloudTask=async(label,task)=>{$('priceReplaySaved').textContent=JSON.stringify(task.data);return true;};
let previewRequests=Number(localStorage.getItem('price-preview-count')||0);
window.fetch=async(url,options)=>{
 if(String(url).endsWith('/health'))return {ok:true,json:async()=>({ok:true,keyConfigured:true,serviceVersion:${supplier==='tnuva'?10:145},photoFirst:true})};
 if(String(url)===AI_SCAN_WORKER_URL){previewRequests++;localStorage.setItem('price-preview-count',String(previewRequests));$('priceReplayRequests').textContent=previewRequests;return {ok:true,status:200,json:async()=>(${JSON.stringify(paper)})};}
 throw Error('External network disabled in local fixture replay');
};
function priceReplayState(){ $('priceReplayCount').textContent=receiptList.reduce((n,r)=>n+r.qty,0);$('priceReplayRequests').textContent=previewRequests; }
$('priceReplayStart').onclick=async()=>{
 receiptList=[];receiptNotes=[];receiptOpened=true;receiptEntryMode='photo';receiptAnchorSource=null;receiptNoDoc=false;receiptAttachTarget=null;receiptDupConfirmed=true;
 aiScanDocuments=[{noteIndex:0,amount:null,units:null,lines:null,pages:[{dataUrl:'data:image/jpeg;base64,Zml4dHVyZQ==',orientationConfirmed:true}]}];
 await ${supplier==='berman'?'bermanRunPaperScanInBackground()':supplier+'StartPaperScan()'};
 renderReceiving();priceReplayState();
};
$('priceReplayCountMatch').onclick=()=>{receiptList=[{productId:'milk',name:'מוצר בדיקה',barcode:'7290000000008',qty:10}];saveReceiptDraft();renderReceiving();priceReplayState();};
$('priceReplayCountShort').onclick=()=>{receiptList=[{productId:'milk',name:'מוצר בדיקה',barcode:'7290000000008',qty:9}];saveReceiptDraft();renderReceiving();priceReplayState();};
$('priceReplayFinish').onclick=()=>{finishReceipt();priceReplayState();};
$('priceReplayBack').onclick=()=>{currentView='receiving';renderReceiving();priceReplayState();};
renderReceiving();priceReplayState();
`;
const toolbar=`<aside style="max-width:390px;margin:auto;background:#fff7d6;padding:10px;direction:rtl;font:14px sans-serif">סביבת בדיקה ${supplier} · בקשות AI: <output id="priceReplayRequests">0</output> · נספרו: <output id="priceReplayCount">0</output><br><button id="priceReplayStart">פענח תעודת דוגמה</button> <button id="priceReplayCountMatch">ספירה תואמת</button> <button id="priceReplayCountShort">ספירה חסרה</button> <button id="priceReplayFinish">סיום בדיקה</button> <button id="priceReplayBack">חזור לקליטה</button><pre id="priceReplaySaved" hidden></pre></aside>`;
const page=html.replace(/<script type="module">[\s\S]*?<\/script>/,()=>'<script type="module">'+setup+moduleSource+replay+'</script>').replace(/(<body[^>]*>)/,'$1'+toolbar).replace('</head>','<style>body{max-width:390px;margin:auto!important}#app{width:100%}button{min-height:36px}</style></head>');
http.createServer((req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"connect-src 'none'; worker-src 'none'");res.end(page);}).listen(Number(process.argv[2])||8771,'0.0.0.0',()=>console.log('Local '+supplier+' replay ready'));
