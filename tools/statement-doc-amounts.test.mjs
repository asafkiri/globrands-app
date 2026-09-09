// v335: סכום לכל תעודת ספק ברשימת המרכזת.
// המספר אינו מחושב ואינו מחולק — הוא הסכום שהוקלד לאותה תעודה (noteParts).
// הבדיקות מקבעות שהחלקים סוגרים בדיוק את הסכום שנכנס לחישוב, שהחוסר נשאר
// ברמת הקליטה, ושאין פירוט היכן שאין לו בסיס.
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

function render(rc, { shortValRaw = 0 } = {}) {
  const c = vm.createContext({ Math, Number, String, Object, Array, Map, Set, JSON, console,
    r2: n => Math.round((Number(n) + Number.EPSILON) * 100) / 100,
    fmtMoney: n => Number(n).toFixed(2),
    htmlEscape: s => String(s),
    receiptDiscrepancyInfo: () => ({ shortValRaw }) });
  vm.runInContext([source('normNote'), source('receiptStatementDocAmountsHtml')].join('\n'), c);
  c.__rc = rc;
  return vm.runInContext('receiptStatementDocAmountsHtml(__rc)', c);
}
const amounts = out => (out.match(/₪[\d.]+/g) || []).map(x => Number(x.slice(1)));

const two = () => ({
  noteParts: [{ amount: 1200 }, { amount: 1103.76 }],
  noteTotalInc: 2303.76,
  priceAudit: { documents: [{ index: 0, number: 'INV-A' }, { index: 1, number: 'INV-B' }], rows: [] },
});

test('כל תעודת ספק מוצגת בסכום שלה, עם מספר התעודה', () => {
  const out = render(two());
  assert.match(out, /תעודת ספק INV-A/);
  assert.match(out, /תעודת ספק INV-B/);
  assert.deepEqual(amounts(out), [1200, 1103.76]);
});

test('החלקים סוגרים בדיוק את הסכום שנכנס לחישוב', () => {
  const rc = two();
  const sum = rc.noteParts.reduce((n, p) => n + p.amount, 0);
  assert.equal(Math.round(sum * 100) / 100, rc.noteTotalInc,
    'receiptPayableBaseEx = noteTotalInc − חוסר, ולכן החלקים חייבים לסגור את noteTotalInc');
});

test('חוסר פתוח נשאר ברמת הקליטה ואינו מחולק בין התעודות', () => {
  const out = render(two(), { shortValRaw: 52.2 });
  assert.deepEqual(amounts(out).slice(0, 2), [1200, 1103.76], 'סכומי הנייר לא נגרעו');
  assert.match(out, /יורד מהקליטה כולה, לא מתעודה מסוימת/);
});

test('בלי חוסר — אין אזכור חוסר', () => {
  const out = render(two());
  assert.doesNotMatch(out, /החוסר הפתוח/);
  assert.match(out, /סכומי הנייר לכל תעודה/);
});

test('בלי מספרי תעודה (קליטה ישנה) — נופלים למספור סידורי, בלי לקרוס', () => {
  const rc = two(); delete rc.priceAudit;
  const out = render(rc);
  assert.match(out, /תעודת ספק 1/);
  assert.match(out, /תעודת ספק 2/);
  assert.deepEqual(amounts(out), [1200, 1103.76], 'הסכומים עובדים גם בלי פענוח שמור');
});

test('תעודת ספק אחת — אין פירוט כלל', () => {
  assert.equal(render({ noteParts: [{ amount: 2303.76 }] }), '');
});

test('בלי תעודות ספק — אין פירוט, בלי לקרוס', () => {
  assert.equal(render({}), '');
  assert.equal(render({ noteParts: [] }), '');
  assert.equal(render({ noteParts: [null, null] }), '');
});

test('שלוש תעודות מוצגות שלושתן', () => {
  const out = render({ noteParts: [{ amount: 10 }, { amount: 20 }, { amount: 30 }] });
  assert.deepEqual(amounts(out), [10, 20, 30]);
});

test('אינו משנה את רשומת הקליטה', () => {
  const rc = two();
  const before = JSON.stringify(rc);
  render(rc);
  assert.equal(JSON.stringify(rc), before);
});
