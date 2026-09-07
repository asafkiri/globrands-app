import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function source(name) {
  const m = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(html);
  assert.ok(m, 'Missing function: ' + name);
  const eol = html.indexOf('\n', m.index);
  const end = html.slice(m.index, eol).trimEnd().endsWith('}') ? eol : html.indexOf('\n}', eol) + 2;
  return html.slice(m.index, end);
}
const names = ['aiCompressInvoiceImage', 'aiCropInitFrame', 'aiCropResetOverlay', 'aiCropDraw',
  'aiCropSyncCanvasBox', 'aiCropContainRect', 'aiCropFit', 'aiCropHitTest', 'aiCropPointerPosition',
  'aiCropPointerDown', 'aiCropPointerMove', 'aiCropPointerUp', 'aiApplyCropIfMoved',
  'aiReprocessFromSource', 'aiUnrotateRect', 'aiNormalizeQuarterTurns', 'aiRenderInvoiceRotation',
  'aiSetOrientationBusy', 'aiUpdateOrientationControls', 'aiToggleCropMode', 'aiRestoreOriginalImage',
  'aiCropInfoText', 'aiPaintOrientationReview', 'aiOrientationLocation', 'aiOpenOrientationReview',
  'aiCloseOrientationReview', 'aiRotateOrientationReview', 'aiConfirmOrientationReview'];

// Record real canvas source/destination rectangles; no model calls or external images.
function context() {
  const images = new Map([['source', { naturalWidth: 4000, naturalHeight: 3000 }]]);
  const draws = [], rotations = [], nodes = new Map();
  let seq = 0;
  function node(id) {
    if (nodes.has(id)) return nodes.get(id);
    const classes = new Set(id === 'aiCropCanvas' ? ['hidden'] : []);
    const n = { id, style: {}, width: 600, height: 450, clientWidth: 600, clientHeight: 450,
      naturalWidth: 3000, naturalHeight: 2250,
      classList: { add: v => classes.add(v), remove: v => classes.delete(v), contains: v => classes.has(v),
        toggle: (v, yes) => yes ? classes.add(v) : classes.delete(v) },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 450 }),
      parentElement: { getBoundingClientRect: () => ({ width: 624, height: 474 }) },
      getContext: () => ({ clearRect() {}, fillRect() {}, strokeRect() {} }) };
    nodes.set(id, n); return n;
  }
  const c = vm.createContext({ console, Number, Math, Array, Object, String, Promise,
    aiOrientationSession: null, aiOrientationBusy: false, aiCropState: null, aiScanBusy: false,
    aiScanDocuments: [], aiScanResponse: null, aiScanEvaluation: null, aiScanError: '',
    aiScanAutoRotationNote: '', aiScanAttemptCount: 0,
    $: node, setTimeout() {}, refreshScanHost() {}, aiOpenNextUnconfirmedOrientation() {},
    yotvataInvalidatePhotoDoc() {}, tnuvaInvalidatePhotoDoc() {},
    showToast: message => { c.lastToast = message; },
    aiReadFile: async () => 'source', aiLoadImage: async url => { assert.ok(images.has(url), url); return images.get(url); },
    aiEnhanceDocumentPixels: () => false,
    aiComputePaperCropBox: () => { throw new Error('Automatic crop must never run during capture'); },
    aiCanvasToInvoiceJpeg: canvas => {
      const dataUrl = 'encoded-' + (++seq); images.set(dataUrl, { naturalWidth: canvas.width, naturalHeight: canvas.height });
      return { dataUrl, bytes: 100 };
    },
    aiDataUrlBytes: () => 100,
    document: { createElement: tag => {
      assert.equal(tag, 'canvas');
      const canvas = { width: 0, height: 0 };
      canvas.getContext = () => ({ fillRect() {}, translate() {}, rotate: angle => rotations.push(angle),
        drawImage: (...args) => draws.push({ args, width: canvas.width, height: canvas.height }),
        getImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData() {} });
      return canvas;
    } }
  });
  vm.runInContext(names.map(source).join('\n'), c);
  Object.defineProperty(node('aiOrientationImage'), 'src', { set(url) {
    const img = images.get(url); if (img) { this.naturalWidth = img.naturalWidth; this.naturalHeight = img.naturalHeight; }
    c.aiCropInitFrame(); // The actual image load handler.
  } });
  return { c, node, images, draws, rotations };
}
async function capture(ctx) {
  const page = await ctx.c.aiCompressInvoiceImage({ name: 'fixture.jpg' });
  ctx.c.aiScanDocuments = [{ pages: [page] }];
  ctx.c.aiOpenOrientationReview(0, 0, true);
  return page;
}
const plain = value => JSON.parse(JSON.stringify(value));

test('camera/gallery preparation and quick confirmation keep every source edge without an overlay', async () => {
  const ctx = context(), { c, node, draws } = ctx;
  const page = await capture(ctx), before = page.dataUrl;
  assert.equal(page.cropped, false);
  assert.deepEqual(plain(page.sourceRegion), { x: 0, y: 0, width: 4000, height: 3000 });
  assert.deepEqual(draws[0].args.slice(1), [0, 0, 4000, 3000, 0, 0, 3000, 2250]);
  assert.equal(c.aiCropState, null);
  assert.equal(node('aiCropCanvas').classList.contains('hidden'), true);
  assert.match(node('aiOrientationConfirm').innerHTML, /אשר תמונה מלאה/);
  await c.aiConfirmOrientationReview();
  assert.equal(page.dataUrl, before);
  assert.equal(draws.length, 1, 'Confirmation must not reencode or crop');
  assert.equal(page.orientationConfirmed, true);
});

test('explicit crop starts on the full image; cancelling or confirming untouched never trims edges', async () => {
  const ctx = context(), { c, node } = ctx;
  const page = await capture(ctx), before = page.dataUrl;
  c.aiToggleCropMode();
  assert.deepEqual(plain(c.aiCropState.rect), { x: 0, y: 0, w: 3000, h: 2250 });
  assert.equal(node('aiCropCanvas').classList.contains('hidden'), false);
  c.aiCropState.rect = { x: 300, y: 225, w: 2400, h: 1800 }; c.aiCropState.moved = true;
  c.aiToggleCropMode();
  assert.equal(c.aiCropState, null); assert.equal(page.dataUrl, before);
  c.aiToggleCropMode();
  await c.aiConfirmOrientationReview();
  assert.equal(page.dataUrl, before); assert.equal(page.cropped, false);
});

test('stale frame movement outside explicit crop mode cannot apply a crop', async () => {
  const ctx = context(), { c } = ctx; const page = await capture(ctx), before = page.dataUrl;
  c.aiCropState = { moved: true, w: 3000, h: 2250, rect: { x: 300, y: 225, w: 2400, h: 1800 } };
  assert.equal(await c.aiApplyCropIfMoved(page), false);
  await c.aiConfirmOrientationReview();
  assert.equal(page.dataUrl, before); assert.equal(page.cropped, false);
});

test('crop then restore recovers all original edges at each orientation without another file read', async () => {
  for (let turns = 0; turns < 4; turns++) {
    const ctx = context(), { c, node } = ctx;
    const page = await capture(ctx), original = page.baseDataUrl;
    await c.aiRotateOrientationReview(turns);
    c.aiToggleCropMode();
    const state = c.aiCropState;
    state.rect = { x: state.w * .1, y: state.h * .1, w: state.w * .8, h: state.h * .8 }; state.moved = true;
    await c.aiConfirmOrientationReview();
    assert.equal(page.cropped, true);
    assert.deepEqual(plain(page.sourceRegion), { x: 400, y: 300, width: 3200, height: 2400 });
    c.aiOpenOrientationReview(0, 0, true);
    assert.equal(node('aiOrientationRestore').classList.contains('hidden'), false);
    c.aiReadFile = () => { throw new Error('Use the saved original'); };
    await c.aiRestoreOriginalImage();
    assert.equal(page.baseDataUrl, original);
    assert.equal(page.cropped, false); assert.equal(page.rotation, turns * 90);
    assert.deepEqual(plain(page.sourceRegion), { x: 0, y: 0, width: 4000, height: 3000 });
    assert.equal(c.aiCropState, null);
    assert.match(node('aiOrientationConfirm').innerHTML, /אשר תמונה מלאה/);
  }
});

test('restore while dragging discards the pending crop without modifying pixels', async () => {
  const ctx = context(), { c } = ctx; const page = await capture(ctx), before = page.dataUrl;
  c.aiToggleCropMode(); c.aiCropState.moved = true;
  await c.aiRestoreOriginalImage();
  assert.equal(page.dataUrl, before); assert.equal(c.aiOrientationSession.cropMode, false);
  assert.equal(c.aiCropState, null);
});

test('restoring old auto-cropped pages uses the full source; failures keep the current image intact', async () => {
  const ctx = context(), { c } = ctx; const page = await capture(ctx);
  delete page.originalImage; page.cropped = true; page.sourceRegion = { x: 400, y: 300, width: 3200, height: 2400 };
  const before = page.dataUrl;
  c.aiReadFile = async () => { throw new Error('decode failed'); };
  await c.aiRestoreOriginalImage();
  assert.equal(page.dataUrl, before); assert.equal(page.cropped, true); assert.equal(c.aiOrientationBusy, false);
  assert.match(c.lastToast, /התמונה הנוכחית נשמרה/);
  c.aiReadFile = async () => 'source';
  await c.aiRestoreOriginalImage();
  assert.equal(page.cropped, false);
  assert.deepEqual(plain(page.sourceRegion), { x: 0, y: 0, width: 4000, height: 3000 });
});

test('crop fallback without a source blob preserves full image and rotation for restoration', async () => {
  const ctx = context(), { c } = ctx; const page = await capture(ctx), original = page.dataUrl;
  delete page.sourceBlob; delete page.originalImage;
  await c.aiRotateOrientationReview(1); c.aiToggleCropMode();
  const state = c.aiCropState;
  state.rect = { x: 100, y: 100, w: 1000, h: 1200 }; state.moved = true;
  await c.aiConfirmOrientationReview();
  c.aiOpenOrientationReview(0, 0, true);
  await c.aiRotateOrientationReview(1);
  await c.aiRestoreOriginalImage();
  assert.equal(page.baseDataUrl, original); assert.equal(page.rotation, 180); assert.equal(page.cropped, false);
});

test('viewing a page already used for OCR never enables cropping or restoration', async () => {
  const ctx = context(), { c, node } = ctx; const page = await capture(ctx), before = page.dataUrl;
  c.aiScanResponse = { ok: true }; c.aiCloseOrientationReview(); c.aiOpenOrientationReview(0, 0, false);
  c.aiToggleCropMode(); await c.aiRestoreOriginalImage(); await c.aiRotateOrientationReview(1);
  assert.equal(c.aiCropState, null);
  assert.equal(node('aiOrientationCropRow').classList.contains('hidden'), true);
  assert.equal(page.dataUrl, before);
});

test('crop controls are wired outside the app container and disabled during image processing', async () => {
  const ctx = context(), { c, node } = ctx; await capture(ctx);
  for (const [id, fn] of [['aiOrientationCrop', 'aiToggleCropMode'], ['aiOrientationRestore', 'aiRestoreOriginalImage']]) {
    assert.ok(html.includes(`id="${id}"`));
    assert.ok(html.includes(`$('${id}').addEventListener('click', ${fn});`));
  }
  c.aiSetOrientationBusy(true); c.aiToggleCropMode(); await c.aiRestoreOriginalImage();
  assert.equal(c.aiCropState, null);
  assert.equal(node('aiOrientationCrop').disabled, true); assert.equal(node('aiOrientationRestore').disabled, true);
});
