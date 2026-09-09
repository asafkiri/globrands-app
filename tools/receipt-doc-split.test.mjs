// v334: פירוט הקליטה לפי תעודת ספק.
// הנייר יודע איזו שורה שייכת לאיזו תעודה; הספירה הפיזית אינה יודעת. הבדיקות
// כאן מקבעות את כלל ההקצאה (מילוי לפי סדר התעודות), את סימון ההנחה, ואת
// המקרים שבהם אסור לפירוט להופיע בכלל.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function source(name) {
  const match = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(html);
  assert.ok(match, 'חסר ב-index.html: ' + name);
  const firstEnd = html.indexOf('\n', match.index);
  if (html.slice(match.index, firstEnd).trimEnd().endsWith('}')) return html.slice(match.index, firstEnd);
  const end = html.indexOf('\n}', firstEnd);
  assert.ok(end > firstEnd);
  return html.slice(match.index, end + 2);
}

function ctx() {
  const c = vm.createContext({ Math, Number, String, Object, Array, Map, Set, JSON, console,
    r2: n => Math.round((Number(n) + Number.EPSILON) * 100) / 100,
    fmtMoney: n => Number(n).toFixed(2),
    fmtUnitPrice: n => Number(n).toFixed(2),
    htmlEscape: s => String(s) });
  vm.runInContext(['normNote', 'receiptDocSplit', 'receiptDocSplitHtml'].map(source).join('\n'), c);
  return c;
}
const split = rc => { const c = ctx(); c.__rc = rc; return vm.runInContext('receiptDocSplit(__rc)', c); };
const html_ = rc => { const c = ctx(); c.__rc = rc; return vm.runInContext('receiptDocSplitHtml(__rc)', c); };

// שתי תעודות: תעודה 1 — 10 חלב; תעודה 2 — 5 חלב ו-4 קפה.
const base = (countedMilk = 15, countedCoffee = 4) => ({
  noteParts: [{ amount: 100 }, { amount: 60 }],
  items: [{ productId: 'milk', qty: countedMilk }, { productId: 'coffee', qty: countedCoffee }],
  priceAudit: {
    documents: [{ index: 0, number: 'A-1' }, { index: 1, number: 'B-2' }],
    rows: [
      { documentIndex: 0, documentNumber: 'A-1', productId: 'milk', name: 'חלב', code: '8', quantity: 10, page: 1, line: 1, originalUnitPrice: 5, comparisonPrice: 5 },
      { documentIndex: 1, documentNumber: 'B-2', productId: 'milk', name: 'חלב', code: '8', quantity: 5, page: 1, line: 1, originalUnitPrice: 5, comparisonPrice: 5 },
      { documentIndex: 1, documentNumber: 'B-2', productId: 'coffee', name: 'קפה', code: '15', quantity: 4, page: 1, line: 2, originalUnitPrice: 12, comparisonPrice: 12 },
    ],
  },
});

test('כל תעודה מקבלת את השורות, הסכום והשווי שלה', () => {
  const d = split(base());
  assert.equal(d.length, 2);
  assert.equal(d[0].number, 'A-1');
  assert.equal(d[0].rows.length, 1);
  assert.equal(d[0].paperUnits, 10);
  assert.equal(d[0].paperEx, 50);          // 10 × 5
  assert.equal(d[0].noteAmount, 100);
  assert.equal(d[1].number, 'B-2');
  assert.equal(d[1].rows.length, 2);
  assert.equal(d[1].paperUnits, 9);
  assert.equal(d[1].paperEx, 73);          // 5×5 + 4×12
  assert.equal(d[1].noteAmount, 60);
});

test('ספירה מלאה מתחלקת בדיוק לפי הנייר', () => {
  const d = split(base(15, 4));
  assert.equal(d[0].rows[0].received, 10);
  assert.equal(d[1].rows[0].received, 5);
  assert.equal(d[1].rows[1].received, 4);
});

test('חוסר נופל על התעודה האחרונה — תעודה 1 מתמלאת ראשונה', () => {
  const d = split(base(12, 4));            // נייר 10+5=15, נספרו 12
  assert.equal(d[0].rows[0].received, 10, 'תעודה 1 מתמלאת עד תום');
  assert.equal(d[1].rows[0].received, 2, 'היתרה לתעודה האחרונה');
});

test('מוצר שפרוס על שתי תעודות מסומן כשיוך משוער; מוצר שאינו — לא', () => {
  const d = split(base(12, 4));
  assert.equal(d[0].rows[0].spans, true, 'חלב יושב על שתי התעודות');
  assert.equal(d[1].rows[1].spans, false, 'קפה רק על אחת');
  assert.equal(d[0].assumed, true);
  const text = html_(base(12, 4));
  assert.match(text, /שיוך משוער/);
  assert.match(text, /שורה אחת/, 'ניסוח יחיד/רבים תקין');
  assert.doesNotMatch(text, /1 שורות/);
});

test('בלי מוצר חוצה-תעודות אין הנחת שיוך ואין כוכבית', () => {
  const rc = base();
  rc.priceAudit.rows = rc.priceAudit.rows.filter(r => !(r.productId === 'milk' && r.documentIndex === 1));
  rc.items = [{ productId: 'milk', qty: 10 }, { productId: 'coffee', qty: 4 }];
  const d = split(rc);
  assert.equal(d.every(x => x.assumed === false), true);
  assert.doesNotMatch(html_(rc), /שיוך משוער/);
});

test('ספירה חסרה לגמרי מוצגת כאפס, לא כשגיאה', () => {
  const rc = base(); rc.items = [];
  const d = split(rc);
  assert.equal(d[0].rows[0].received, 0);
  assert.equal(d[1].rows[1].received, 0);
  assert.equal(d[0].rows[0].paperQty, 10, 'הנייר נשאר כפי שהוא');
});

test('תעודת ספק אחת — אין פירוט, אין שינוי בתצוגה הקיימת', () => {
  const rc = base(); rc.noteParts = [{ amount: 160 }];
  assert.equal(split(rc), null);
  assert.equal(html_(rc), '');
});

test('קליטה ישנה בלי priceAudit — אין פירוט, בלי לקרוס', () => {
  const rc = base(); delete rc.priceAudit;
  assert.equal(split(rc), null);
  assert.equal(html_(rc), '');
});

test('קליטה בלי צילום (אין שורות פענוח) — אין פירוט', () => {
  const rc = base(); rc.priceAudit = { documents: [], rows: [] };
  assert.equal(split(rc), null);
  assert.equal(html_(rc), '');
});

test('סכומים שאינם תואמים במספרם לתעודות — מציגים שורות בלי סכום מומצא', () => {
  const rc = base(); rc.noteParts = [{ amount: 100 }, { amount: 30 }, { amount: 30 }];
  const d = split(rc);
  assert.ok(d, 'הפירוט עדיין מוצג');
  assert.equal(d[0].noteAmount, null, 'בלי שיוך סכום שאינו מוכח');
  assert.equal(d[1].noteAmount, null);
});

test('הפירוט אינו נוגע בכסף של הקליטה', () => {
  const rc = base(12, 4);
  const before = JSON.stringify(rc);
  split(rc); html_(rc);
  assert.equal(JSON.stringify(rc), before, 'receiptDocSplit לא משנה את הרשומה');
});
