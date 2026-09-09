import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function source(name) {
  const match = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(html);
  assert.ok(match, 'Missing app function ' + name);
  const firstEnd = html.indexOf('\n', match.index);
  if (html.slice(match.index, firstEnd).trimEnd().endsWith('}')) return html.slice(match.index, firstEnd);
  const end = html.indexOf('\n}', firstEnd);
  assert.ok(end > firstEnd);
  return html.slice(match.index, end + 2);
}
const names = ['priceAuditNumber','priceAuditDate','priceAuditCapture','priceAuditSource','priceAuditIdentity','priceAuditDocumentComplete','receiptPriceAudit','receiptPriceAuditHtml','priceAuditLegacyVisible','refreshPriceScannerNotice','receiptRememberScanResults','receiptRebuildScanResponse','receiptScanChanged','receiptScanSnapshot','receiptStorageNotice','persistReceiptDraft','receiptDraftActive','scheduleReceiptDraftSync','refreshReceiptDraftNotice','yotvataPaperCheck', 'yotvataResetPhotoReceipt', 'yotvataCachedDoc', 'yotvataPhotoReady',
  'yotvataInvalidatePhotoDoc', 'yotvataAdoptPaperAnchors', 'yotvataStartPaperScan', 'yotvataScanMetadata',
  'yotvataStoreScanResults', 'yotvataReceiptScanAudit', 'receiptDraftPayload', 'saveReceiptDraft',
  'restoreDraftScan', 'restoreReceiptDraft', 'normNote', 'noteSum', 'noteAnchorSum', 'recomputeNoteTotal',
  'aiScanSingleDocPipeline', 'aiRunInvoiceScan', 'aiTotalPages', 'aiMoneyCents', 'aiDocRowUnits',
  'rememberReceiptManualInput', 'switchReceiptEntryMode', 'receiptBackToPhotosHtml', 'noteEditorBodyHtml', 'parseNoteVal', 'readNoteEntry',
  'aiSingleDocScore', 'aiSingleDocScoreBetter', 'aiFetchWithRetry', 'aiRequestSingleDocScan'];
function context(extra = {}) {
  const storage = new Map();
  const c = vm.createContext({ console, setTimeout, clearTimeout, AbortController, Date, JSON, Math, Number,
    Map, Set, Array, Object, String, Promise, Error, PRICE_AUDIT_SUPPLIER: 'yotvata', receiptPriceSaveFailed:false,
    db:null, receiptStorageWarning:'',receiptDraftId:null,makeOperationId:()=> 'test-' + Math.random(),receiptAnalysisCache:null,aiScanEditingImages:false,
    receiptSync:{revision:0,dirty:false},receiptSyncSignature:null,receiptCloudReady:false,receiptSyncTimer:null,receiptSyncConflict:null,receiptSyncError:'',receiptFinalizing:false,
    receiptQuantityReview: null, receiptManualInput: null, $: () => null, htmlEscape: String, fmtMoney: String,
    receiptEntryMode: 'photo', receiptAnchorSource: null, receiptPaperScanState: '', receiptPaperScanProblems: [],
    receiptPhotoCaptureOpen: false, receiptScanHistory: [], aiScanRunId: 0, receiptOpened: false,
    receiptNotes: [], receiptNoteTotal: null, receiptNoteUnits: null, receiptList: [], receiptDepositWaived: false,
    receiptUnitsWaived: false, receiptNoDoc: false, receiptAttachTarget: null, editingNotes: false,
    aiScanDocuments: [], aiScanResponse: null, aiScanEvaluation: null, aiScanBusy: false,
    aiScanProgressText: '', aiScanError: '', aiScanErrorAnchor: false, aiScanReused: false, aiScanFromDraft: false,
    aiScanAttemptCount: 0, aiScanAutoRotationNote: '', reconcileData: null, currentView: 'receiving',
    AI_SCAN_MAX_AUTO_ROTATION_RETRIES: 2, AI_SCAN_NETWORK_RETRIES: 2, AI_SCAN_FETCH_TIMEOUT_MS: 2000,
    AI_SCAN_NETWORK_RETRY_DELAY_MS: 1, AI_SCAN_WORKER_URL: 'https://fixture.invalid/scan', RECEIPT_DRAFT_KEY: 'fixture',
    receiptDraftNoticeHtml:()=>'',products: [], auth: { currentUser: { getIdToken: async () => 'fixture' } },
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
    r2: n => Math.round(n * 100) / 100, refreshScanHost() {}, renderReceiving() {}, showToast() {},
    openReceivingScanner() {}, yotvataEnsurePhotoService: async () => {}, aiOpenNextUnconfirmedOrientation() {}, aiReceivedProductIds: () => [],
    normalizeBarcode: s => String(s), aiIsActionableFinding: () => false,
    ...extra });
  vm.runInContext(names.map(source).join('\n'), c);
  return c;
}
const page = () => ({ dataUrl: 'data:image/jpeg;base64,YQ==', orientationConfirmed: true });
const input = () => ({ noteIndex: 0, amount: null, units: null, pages: [page()] });
const paper = (index = 0, amount = 50) => ({ noteIndex: index, pageCount: 1, subtotalExVat: amount, printedUnits: 10,
  printedLines: 1, rows: [{ description: 'חלב', sourcePage: 1, quantity: 10, lineTotalExVat: amount }], confidence: 0.9 });
const payload = () => ({ ok: true, serviceVersion: 145, model: 'gpt-5.6-luna', requestId: 'fixture',
  scan: { documents: [paper()], warnings: [] }, checksumRetryAttempted: false,
  scanAudit: { version: 1, attempts: [{ model: 'gpt-5.6-luna', stage: 'initial', outcome: 'read', selected: true }] } });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('background completion refreshes the visible invoice header without replacing the active input', () => {
  const nodes = Object.fromEntries(['rcNoteSummaryLabel', 'rcNoteSummaryValue', 'rcPaperStatus', 'rcTotals', 'rcProgress', 'rcCount'].map(id => [id, {}]));
  const activeInput = { value: '7', selectionStart: 1 };
  nodes.activeQuantity = activeInput;
  const c = context({
    $: id => nodes[id], fmtMoney: n => Number(n).toFixed(2), htmlEscape: String,
    receiptOpened: true, receiptPaperScanState: 'running',
    receiptTotals: () => ({ ex: 4.18, units: 1 }),
    receiptTotalsHtml: () => 'totals', receivingProgressHtml: () => 'progress',
    renderReceiving() { throw new Error('Must preserve the scanner and active input'); }
  });
  vm.runInContext(['receiptNoteHeaderLabel', 'receiptNoteHeaderValue', 'refreshReceiptTotals', 'refreshScanHost', 'yotvataPaperStatusHtml'].map(source).join('\n'), c);
  c.refreshScanHost();
  assert.equal(nodes.rcNoteSummaryValue.textContent, 'התעודה בפענוח…');
  c.aiScanDocuments = [input()];
  const doc = paper(0, 971.42); doc.printedUnits = doc.rows[0].quantity = 244;
  c.aiScanResponse = { scan: { documents: [doc] } };
  assert.equal(c.yotvataAdoptPaperAnchors(), true);
  assert.equal(nodes.rcNoteSummaryValue.textContent, '₪971.42');
  assert.match(nodes.rcNoteSummaryLabel.textContent, /244/);
  assert.match(nodes.rcPaperStatus.innerHTML, /סיכומיה אומתו/);
  assert.equal(nodes.activeQuantity, activeInput);
  assert.equal(activeInput.value, '7');
  assert.equal(activeInput.selectionStart, 1);
});

test('background scan allows counting immediately; no premature comparison or analyzer call', async () => {
  const c = context(); let resolve, barcodeOpened = false;
  c.aiScanDocuments = [input()];
  c.aiRequestSingleDocScan = () => new Promise(done => { resolve = done; });
  c.openReceivingScanner = () => { barcodeOpened = true; };
  c.aiEvaluateInvoiceScan = () => { throw new Error('Premature comparison'); };
  c.aiRunAnalyzer = () => { throw new Error('Premature paid analysis'); };
  c.receiptManualInput = { amount: '12.', count: '3' };
  const run = c.yotvataStartPaperScan();
  await tick();
  assert.equal(barcodeOpened, true);
  assert.equal(c.aiScanBusy, true);
  c.receiptList.push({ productId: 'physical-only', qty: 4 });
  resolve(payload()); await run;
  assert.equal(c.receiptList[0].qty, 4);
  assert.equal(c.receiptPaperScanState, 'ok');
  assert.equal(c.receiptNoteTotal, 50);
  assert.equal(c.receiptManualInput, null, 'Validated paper must not leave an extra pending manual note');
  assert.equal(c.receiptScanHistory.length, 1);
  assert.equal(c.aiScanEvaluation, null);
});
test('cancel then new receipt ignores late OCR and never overwrites new counts', async () => {
  const c = context(); let resolve;
  c.aiScanDocuments = [input()];
  c.aiRequestSingleDocScan = () => new Promise(done => { resolve = done; });
  const run = c.yotvataStartPaperScan(); await tick();
  c.yotvataResetPhotoReceipt();
  c.aiScanBusy = false; c.aiScanDocuments = [input()]; c.aiScanResponse = null;
  c.receiptList = [{ productId: 'new', qty: 2 }]; c.receiptNoteTotal = null;
  resolve(payload()); await run;
  assert.equal(c.aiScanResponse, null);
  assert.equal(c.receiptNoteTotal, null);
  assert.equal(c.receiptList[0].productId, 'new');
  assert.equal(c.receiptScanHistory.length, 0);
});
test('first document survives second failure, reload and retry; only missing document is sent', async () => {
  const c = context(); c.aiScanDocuments = [input(), { ...input(), noteIndex: 1 }];
  let calls = 0;
  c.aiRequestSingleDocScan = async () => { if (++calls === 2) throw new Error('network'); return payload(); };
  await c.yotvataStartPaperScan();
  assert.equal(c.receiptPaperScanState, 'failed');
  assert.equal(c.receiptNoteTotal, null);
  assert.equal(calls, 2);
  const saved = JSON.parse(c.localStorage.getItem('fixture'));
  assert.ok(!JSON.stringify(saved).includes('data:image'));
  assert.equal(saved.aiScan.scan.documents.length, 1);
  const restored = context(); restored.localStorage.setItem('fixture', JSON.stringify(saved));
  restored.restoreReceiptDraft();
  assert.equal(restored.aiScanDocuments.length, 2);
  assert.equal(restored.yotvataCachedDoc(restored.aiScanDocuments[0]), true);
  assert.equal(restored.yotvataCachedDoc(restored.aiScanDocuments[1]), false);
  restored.aiScanDocuments[1].pages = [page()];
  let secondCalls = 0; restored.aiRequestSingleDocScan = async () => { secondCalls++; return payload(); };
  await restored.yotvataStartPaperScan();
  assert.equal(secondCalls, 1);
  assert.equal(restored.receiptNoteTotal, 100);
  assert.equal(restored.receiptNoteUnits, 20);
  assert.equal(restored.receiptPaperScanState, 'ok');
});
test('refresh before first result preserves document count and does not resubmit automatically', () => {
  const c = context(); c.aiScanDocuments = [input(), { ...input(), noteIndex: 1 }];
  c.receiptPaperScanState = 'running'; c.receiptOpened = true; c.saveReceiptDraft();
  const restored = context(); restored.localStorage.setItem('fixture', c.localStorage.getItem('fixture'));
  restored.restoreReceiptDraft();
  assert.equal(restored.receiptPaperScanState, 'interrupted');
  assert.equal(restored.aiScanDocuments.length, 2);
  assert.equal(restored.yotvataPhotoReady(), false);
  assert.equal(restored.aiScanBusy, false);
});
test('each paper closes independently, even if two incorrect sums cancel overall', () => {
  const c = context(); c.aiScanDocuments = [input(), { ...input(), noteIndex: 1 }];
  const a = paper(0, 49), b = paper(1, 51); a.rows[0].lineTotalExVat = b.rows[0].lineTotalExVat = 50;
  c.aiScanResponse = { scan: { documents: [a, b] } };
  assert.equal(c.yotvataAdoptPaperAnchors(), false);
  assert.equal(c.receiptNoteTotal, null);
});
test('photo missing summary never triggers orientation rereads', async () => {
  const c = context(); c.aiScanDocuments = [input()]; let calls = 0;
  c.aiRequestSingleDocScan = async () => { calls++; const p = payload(); p.scan.documents[0].rows = []; return p; };
  await c.yotvataStartPaperScan();
  assert.equal(calls, 1);
  assert.equal(c.receiptPaperScanState, 'failed');
});
test('invoice network failures get one transport attempt; error remains visible', async () => {
  const c = context(); let calls = 0;
  c.fetch = async () => { calls++; throw new Error('network'); };
  await assert.rejects(c.aiRequestSingleDocScan('fixture', [page()], {}));
  assert.equal(calls, 1);
});
test('new image invalidates only that document cache', () => {
  const c = context(); const a = input(), b = input();
  for (const d of [a, b]) { d.cachedPages = d.pages.slice(); d.cachedResult = { ok: true }; }
  c.yotvataInvalidatePhotoDoc(b);
  assert.equal(c.yotvataCachedDoc(a), true);
  assert.equal(c.yotvataCachedDoc(b), false);
});

function appFunctions(c, requested) {
  const available = new Set([...html.matchAll(/^(?:async )?function (\w+)\(/gm)].map(m => m[1]));
  const visited = new Set(), parts = [];
  function add(name) {
    if (visited.has(name) || !available.has(name)) return;
    visited.add(name); const code = source(name); parts.push(code);
    for (const match of code.matchAll(/\b(\w+)\s*\(/g)) add(match[1]);
  }
  requested.forEach(add);
  vm.runInContext(parts.join('\n'), c);
}
function comparisonContext(receivedId = 'milk') {
  const c = context({ promos: [], receipts: [], receiptDupConfirmed: true, receiptFix: null,
    reconcileSupplierDiscount: 0, reconcileSupplierPromoItems: [], reconcilePromoMismatchItems: [],
    reconcileSupplierCreditClaim: null, reconcileAiAudit: null, reconcilePaperEntered: false,
    aiAnalyzeResult: null, aiAnalyzeError: '', aiAnalyzeBusy: false, aiUnknownProductCreateContext: null,
    AI_SCAN_MIN_SERVICE_VERSION: 127, AI_BARCODE_SUFFIX_DIGITS: 6, RECEIPT_ROUNDING_TOLERANCE_CENTS: 20,
    products: [{ id: 'milk', name: 'חלב בדיקה', barcode: '7290000000008', price: 5 },
      { id: 'coffee', name: 'קפה בדיקה', barcode: '7290000000015', price: 5 }] });
  c.receiptList = [{ productId: receivedId, name: receivedId === 'milk' ? 'חלב בדיקה' : 'קפה בדיקה', qty: 10 }];
  c.receiptNotes = [{ amount: 50, units: 10 }]; c.recomputeNoteTotal();
  c.receiptOpened = true; c.receiptPaperScanState = 'ok'; c.receiptAnchorSource = 'paper';
  c.aiScanDocuments = [{ ...input(), amount: 50, units: 10 }];
  const p = payload();
  Object.assign(p.scan.documents[0].rows[0], { description: 'חלב בדיקה', barcode: '7290000000008',
    barcodeObserved: '7290000000008', barcodeReadType: 'full', barcodeMatchMethod: 'exact_full',
    lineNumber: 1, unitPriceExVat: 5, grossLineTotalExVat: 50, lineDiscountExVat: 0, confidence: .95 });
  c.aiScanResponse = p;
  return c;
}
test('equal total/units still enters actual product comparison; equal-price swap is detected', () => {
  for (const productId of ['milk', 'coffee']) {
    const c = comparisonContext(productId);
    appFunctions(c, ['finishReceipt', 'openReconcile', 'resetAiInvoiceScan', 'aiEvaluateInvoiceScan']);
    c.aiCloseOrientationReview = () => {}; c.resetDetectiveQuestions = () => {};
    c.setView = view => { c.currentView = view; }; c.saveReceiptDraft = () => {};
    c.finishReceipt();
    assert.equal(c.currentView, 'reconcile');
    assert.ok(c.aiScanEvaluation, 'Saved paper must be reused without OCR');
    assert.equal(c.aiScanEvaluation.totalVerified, true);
    assert.equal(c.aiScanEvaluation.unitsVerified, true);
    const findings = c.aiScanEvaluation.findings;
    if (productId === 'coffee') {
      assert.ok(findings.some(f => f.type === 'shortage' && f.productId === 'milk'));
      assert.ok(findings.some(f => f.type === 'surplus' && f.productId === 'coffee'));
    } else assert.equal(findings.some(f => ['shortage', 'surplus'].includes(f.type)), false);
  }
});

test('matching totals cannot bypass the photo review screen; applying unlocks the existing finish flow', () => {
  const c = comparisonContext();
  appFunctions(c, ['openReconcile', 'renderReconcile']);
  c.aiCloseOrientationReview = () => {}; c.resetDetectiveQuestions = () => {};
  c.setView = view => { c.currentView = view; }; c.saveReceiptDraft = () => {};
  c.openReconcile();
  c.app = { innerHTML: '' }; c.aiInvoiceCaptureHtml = () => 'PHOTO_REVIEW';
  c.renderReconcile();
  assert.equal(c.rcStep, 'ai');
  assert.ok(c.app.innerHTML.includes('PHOTO_REVIEW'));
  assert.ok(!c.app.innerHTML.includes('data-role="rc-recon-save"'));
  c.reconcilePaperEntered = true;
  c.renderReconcile();
  assert.equal(c.rcStep, 'balanced');
  assert.ok(c.app.innerHTML.includes('data-role="rc-recon-save"'));
});

test('legacy matching manual entry retains its original summary path', () => {
  const c = comparisonContext(); c.receiptEntryMode = 'manual'; c.receiptAnchorSource = 'manual';
  appFunctions(c, ['finishReceipt']);
  const elements = new Map();
  c.$ = id => { if (!elements.has(id)) elements.set(id, { innerHTML: '', classList: { add() {}, remove() {} } }); return elements.get(id); };
  c.finishReceipt();
  assert.equal(c.pendingReceipt.ex, 50);
  assert.equal(c.pendingReceipt.lines[0].productId, 'milk');
  assert.equal(c.currentView, 'receiving');
});

test('old or unavailable scan service never receives a paid photo upload', async () => {
  const c = context(); vm.runInContext(source('yotvataEnsurePhotoService'), c);
  c.aiScanDocuments = [input()];
  let calls = 0;
  c.fetch = async url => {
    calls++; assert.ok(url.endsWith('/health'));
    return { ok: true, json: async () => ({ ok: true, keyConfigured: true, serviceVersion: 144 }) };
  };
  await c.yotvataStartPaperScan();
  assert.equal(calls, 1);
  assert.equal(c.receiptPaperScanState, 'failed');
  assert.ok(c.receiptPaperScanProblems.some(p => p.includes('עדיין לא עודכן')));
});

test('upgrading an empty legacy draft opens photo mode; active legacy receipts remain manual', () => {
  for (const active of [false, true]) {
    const c = context(); c.localStorage.setItem('fixture', JSON.stringify({
      items: active ? [{ productId: 'milk', qty: 2 }] : [], notes: [], opened: active }));
    c.restoreReceiptDraft();
    assert.equal(c.receiptEntryMode, active ? 'manual' : 'photo');
  }
});

test('manual selection without any work returns to photo on reload; active drafts stay manual', () => {
  for (const data of [{}, { opened: true }, { notes: [{ amount: 50, units: 10 }] },
    { manualInput: { amount: '50.', count: '' } }, { noDoc: true }, { attach: { id: 'existing' } }]) {
    const c = context();
    c.localStorage.setItem('fixture', JSON.stringify({ entryMode: 'manual', anchorSource: 'manual',
      items: [], notes: [], photoInputs: [{ pageCount: 0 }], ...data }));
    c.restoreReceiptDraft();
    assert.equal(c.receiptEntryMode, Object.keys(data).length ? 'manual' : 'photo');
  }
});

test('manual to photo and back preserves pending input, counts, notes and cached paper without scanning', () => {
  let nodes = { rcNoteInput: { value: '50.' }, rcNoteUnits: { value: '10' }, rcDocDate: { value: '2026-08-18' } };
  const c = context({ $: id => nodes[id], receiptEntryMode: 'manual', receiptOpened: true,
    receiptAnchorSource: 'manual', receiptNotes: [{ amount: 25, units: 5 }],
    receiptList: [{ productId: 'milk', qty: 3 }], receiptAttachTarget: { id: 'existing' } });
  const doc = input(); doc.cachedPages = doc.pages.slice(); doc.cachedResult = { ok: true };
  c.aiScanDocuments = [doc];
  const beforeNotes = c.receiptNotes, beforeItems = c.receiptList;
  c.aiRunInvoiceScan = () => { throw new Error('Switching must not scan'); };
  const block = html.slice(html.indexOf("  if (role.startsWith('rc-photo-')) {"), html.indexOf("  if (aiScanBusy && ['ai-run'"));
  c.t = { dataset: {} }; c.role = 'rc-photo-capture';
  vm.runInContext('(function(){' + block + '})()', c);
  assert.equal(c.receiptEntryMode, 'photo');
  assert.equal(c.receiptPhotoCaptureOpen, true);
  assert.equal(c.receiptNotes, beforeNotes);
  assert.equal(c.receiptList, beforeItems);
  assert.equal(c.aiScanDocuments[0], doc);
  assert.equal(c.yotvataCachedDoc(doc), true);
  assert.equal(c.receiptManualInput.amount, '50.');
  const restored = context(); restored.localStorage.setItem('fixture', c.localStorage.getItem('fixture'));
  restored.restoreReceiptDraft();
  assert.equal(restored.receiptPhotoCaptureOpen, true);
  assert.equal(restored.receiptManualInput.count, '10');
  assert.equal(restored.receiptList[0].qty, 3);
  assert.equal(restored.receiptAttachTarget.id, 'existing');

  nodes = {};
  c.role = 'rc-photo-manual'; vm.runInContext('(function(){' + block + '})()', c);
  assert.equal(c.receiptEntryMode, 'manual');
  assert.equal(c.editingNotes, true);
  assert.equal(c.receiptPhotoCaptureOpen, false);
  assert.match(c.noteEditorBodyHtml(), /id="rcNoteInput" value="50\."/);
  assert.match(c.noteEditorBodyHtml(), /data-role="rc-photo-capture"/);
  assert.equal(c.yotvataCachedDoc(doc), true);
});

test('partial manual input survives reload and is cleared after adding the note, preventing duplicate entry', () => {
  const nodes = { rcNoteInput: { value: '50.' }, rcNoteUnits: { value: '10' } };
  const c = context({ $: id => nodes[id], receiptEntryMode: 'manual' });
  c.rememberReceiptManualInput(); c.saveReceiptDraft();
  const restored = context({ $: id => nodes[id] });
  restored.localStorage.setItem('fixture', c.localStorage.getItem('fixture')); restored.restoreReceiptDraft();
  assert.equal(restored.receiptEntryMode, 'manual');
  assert.equal(restored.receiptManualInput.amount, '50.');
  const note = restored.readNoteEntry(true);
  assert.equal(note.amount, 50); assert.equal(note.units, 10);
  restored.receiptNotes.push(note); restored.recomputeNoteTotal(); restored.saveReceiptDraft();
  assert.equal(restored.receiptManualInput, null);
  assert.match(restored.noteEditorBodyHtml(), /id="rcNoteInput" value=""/);
  restored.yotvataResetPhotoReceipt();
  assert.equal(restored.receiptEntryMode, 'photo');
  assert.equal(restored.receiptManualInput, null);
});

test('capture method cannot change while OCR is running', () => {
  const c = context({ aiScanBusy: true, receiptEntryMode: 'manual' });
  c.renderReceiving = () => { throw new Error('Busy scan must remain untouched'); };
  c.switchReceiptEntryMode('photo');
  assert.equal(c.receiptEntryMode, 'manual');
  assert.equal(c.aiScanRunId, 0);
});
