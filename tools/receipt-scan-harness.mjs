// Runs the complete application module. Only browser/Firebase/network boundaries
// are faked; scan adaptation, storage, restoration, comparison and HTML are real.
import fs from 'node:fs';
import vm from 'node:vm';

export const supplier = 'yotvata';
export function runtime(supplier, { storage = new Map(), data = fixture(supplier), cloud = null } = {}) {
  const html = fs.readFileSync(process.env.RECEIPT_TEST_APP || new URL('../index.html', import.meta.url), 'utf8');
  const moduleSource = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
    .replace(/^import[\s\S]*?from "https:\/\/www\.gstatic\.com\/firebasejs\/[^"\n]+";\n/gm, '');
  const nodes = new Map(), callbacks = [], events = new Map(), requests = [], writes = [], toasts = [];
  function node(id) {
    if (nodes.has(id)) return nodes.get(id);
    const classes = new Set(['hidden']);
    const n = { id, value: '', style: {}, dataset: {}, innerHTML: '', textContent: '', disabled: false,
      classList: { add: (...vs) => vs.forEach(v => classes.add(v)), remove: (...vs) => vs.forEach(v => classes.delete(v)),
        contains: v => classes.has(v), toggle: v => classes.has(v) ? classes.delete(v) : classes.add(v) },
      addEventListener(type, fn) { events.set(id + ':' + type, fn); },
      setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
      querySelector() { return null; }, querySelectorAll() { return []; }, insertAdjacentHTML() {},
      focus() {}, blur() {}, scrollIntoView() {}, appendChild() {}, remove() {},
      getContext() { return { clearRect() {} }; },
      getBoundingClientRect() { return { top: 0, left: 0, width: 400, height: 600 }; } };
    nodes.set(id, n); return n;
  }
  const currentUser = { getIdToken: async () => 'local-test-token' };
  const context = vm.createContext({ console, URL, TextEncoder, TextDecoder, AbortController, structuredClone, Blob, Response, CompressionStream, DecompressionStream, btoa, atob,
    crypto: { randomUUID: () => 'local-' + Math.random().toString(36).slice(2) },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    document: { getElementById: node, querySelectorAll: () => [], querySelector: () => null,
      documentElement: node('root'), body: node('body'), createElement: tag => node('new-' + tag),
      addEventListener(type, fn) { events.set(type, fn); }, visibilityState: 'visible' },
    window: { addEventListener() {}, scrollTo() {}, innerWidth: 400, innerHeight: 850 },
    navigator: { onLine: true }, history: { replaceState() {}, pushState() {} }, location: { href: 'http://localhost/test' },
    setTimeout(fn) { callbacks.push(fn); return callbacks.length; }, clearTimeout() {}, setInterval() {}, clearInterval() {},
    requestAnimationFrame() {}, MutationObserver: class { observe() {} },
    initializeApp: () => ({}), getAuth: () => ({ currentUser }), initializeFirestore: () => ({}),
    getFirestore: () => ({}), persistentLocalCache: () => ({}), persistentMultipleTabManager: () => ({}),
    signInAnonymously: async () => ({}), onAuthStateChanged() {},
    fetch: async (url, options) => {
      requests.push({ url: String(url), body: options?.body });
      if (options?.body && JSON.parse(options.body).mode === 'analyze') return {ok:true, status:200, json:async()=>({ok:true,analysis:{claims:[],summary:'fixture'}})};
      if (String(url).endsWith('/health')) return { ok: true, json: async () => ({ok: true, keyConfigured: true, serviceVersion: supplier === 'tnuva' ? 10 : 145, photoFirst: true}) };
      if (!String(url).endsWith('/scan')) throw new Error('Unexpected network request: ' + url);
      return { ok: true, status: 200, json: async () => structuredClone(data.paper) };
    }
  });
  vm.runInContext(moduleSource, context, { filename: 'index.html', timeout: 5000 });
  context.testData = structuredClone(data); context.testWrites = writes; context.testToasts = toasts;
  const run = script => vm.runInContext(script, context, { timeout: 5000 });
  run(`currentView = 'receiving'; mainMode = 'receiving'; products = testData.products; promos = testData.promos;
    showToast = text => testToasts.push(text);
    runCloudTask = async (label, task) => { testWrites.push(structuredClone(task)); return true; };
    const auditOriginalAnalyzer = aiRunAnalyzer; aiRunAnalyzer = async () => {}; openReceivingScanner = () => {};`);
  if (cloud) {
    context.doc = (_db, ...path) => path.join('/');
    context.runTransaction = (_db, fn) => cloud.transaction(fn, context);
    context.onSnapshot = (ref, opts, listener) => cloud.subscribe(ref, listener, context);
    run('startReceiptDraftListener()');
  }
  async function scan(count = 1) {
    run(`receiptOpened = false; receiptList = []; receiptDupConfirmed = true;
      aiScanDocuments = Array.from({length:${count}}, (_,i) => ({noteIndex:i, amount:null, units:null,
        pages:[{dataUrl:'data:image/jpeg;base64,Zml4dHVyZQ==', orientationConfirmed:true}]}));`);
    await run(supplier + 'StartPaperScan()');
    run('receiptList = structuredClone(testData.items); saveReceiptDraft();');
  }
  function click(role, id, dataset = {}) {
    const target = { dataset: { role, id, ...dataset }, closest: selector => selector === '[data-role]' ? target : null };
    return events.get('app:click')({ target });
  }
  return { context, run, scan, click, node, nodes, events, requests, storage, writes, toasts, callbacks };
}

export function fixture(supplier) {
  const products = [{id:'milk',name:'חלב בדיקה',barcode:'7290000000008',price:5},
    {id:'coffee',name:'קפה בדיקה',barcode:'7290000000015',price:5}];
  const row = {section:'items', description:'חלב בדיקה', itemCode:'111', barcode:'7290000000008',
    barcodeObserved:'7290000000008', barcodeReadType:'full', barcodeMatchMethod:'exact_full',
    lineNumber:1, sourcePage:1, quantity:10, unitPriceExVat:5, grossLineTotalExVat:50,
    lineTotalExVat:50, lineDiscountExVat:0, confidence:.95};
  return {products, promos:[], items:[{productId:'milk',name:'חלב בדיקה',barcode:'7290000000008',qty:9}],
    paper:{ok:true,serviceVersion:supplier==='tnuva'?10:145,model:'fixture',requestId:'audit-fixture',scan:{warnings:[],documents:[{
      noteIndex:0,pageCount:1,docType:'invoice',subtotalExVat:50,printedUnits:supplier==='tnuva'?null:10,
      itemsPrintedLines:1, printedLines:1, itemsSectionTotalExVat:50, promoDiscountExVat:0,
      rows:[row],confidence:.99
    }]}}};
}

// Firestore boundary double. Writes commit atomically; a changed read retries the
// transaction, matching Firestore optimistic concurrency (not app implementation).
export function fakeCloud() {
  const documents = new Map(), listeners = new Map(); let revision = 0;
  const copy = v => v == null ? v : structuredClone(v);
  const snapshot = key => ({ exists: () => documents.has(key), data: () => copy(documents.get(key)),
    metadata: {fromCache:false,hasPendingWrites:false} });
  const publish = keys => keys.forEach(key => { for (const fn of listeners.get(key) || []) queueMicrotask(() => fn(snapshot(key))); });
  return { documents,
    subscribe(key, listener) { if (!listeners.has(key)) listeners.set(key,new Set()); listeners.get(key).add(listener);
      queueMicrotask(() => listener(snapshot(key))); return () => listeners.get(key).delete(listener); },
    async transaction(fn, context) {
      if (context.networkFailure) throw Error('network unavailable');
      for(let i=0;i<6;i++) {
        const before=revision, staged=new Map();
        const result=await fn({get:async key=>snapshot(key),set:(key,value)=>staged.set(key,copy(value))});
        if(before!==revision)continue;
        for(const [key,value] of staged)documents.set(key,value);
        if(staged.size){revision++;publish([...staged.keys()]);} return result;
      }
      throw Error('transaction contention');
    },
    tick: () => new Promise(resolve=>setImmediate(resolve))
  };
}
