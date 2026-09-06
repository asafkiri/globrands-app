// verify.js <original.json> <enriched.json>
//
// ההוכחה, לא ההבטחה. עובר על שני הקבצים במלואם ומוודא שההפרש היחיד בכל
// מקום הוא הוספת מפתח "sku" למסמך מוצר. כל שינוי אחר — מחיר שזז, שדה
// שנמחק, מסמך שנעלם, אוסף שהשתנה — מפיל את הבדיקה ומדפיס בדיוק מה זז.
const fs = require('fs');
const [, , aPath, bPath] = process.argv;
if (!aPath || !bPath) { console.error('שימוש: node verify.js <original.json> <enriched.json>'); process.exit(2); }

const A = JSON.parse(fs.readFileSync(aPath, 'utf8'));
const B = JSON.parse(fs.readFileSync(bPath, 'utf8'));

const diffs = [];
function walk(a, b, path) {
  if (a === b) return;
  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
  const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
  if (ta !== tb) { diffs.push({ path, kind: 'type', from: ta, to: tb }); return; }
  if (ta !== 'object' && ta !== 'array') {
    if (!Object.is(a, b)) diffs.push({ path, kind: 'value', from: a, to: b });
    return;
  }
  if (ta === 'array') {
    if (a.length !== b.length) { diffs.push({ path, kind: 'length', from: a.length, to: b.length }); return; }
    for (let i = 0; i < a.length; i++) walk(a[i], b[i], path + '[' + i + ']');
    return;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const inA = Object.prototype.hasOwnProperty.call(a, k);
    const inB = Object.prototype.hasOwnProperty.call(b, k);
    if (inA && !inB) { diffs.push({ path: path + '.' + k, kind: 'removed', from: a[k] }); continue; }
    if (!inA && inB) { diffs.push({ path: path + '.' + k, kind: 'added', to: b[k] }); continue; }
    walk(a[k], b[k], path + '.' + k);
  }
}
walk(A, B, '$');

// המותר היחיד: הוספת sku על $.collections.products.<id>
const ALLOWED = /^\$\.collections\.products\.[^.]+\.sku$/;
const ok = [], bad = [];
diffs.forEach(d => {
  const isAllowed = d.kind === 'added' && ALLOWED.test(d.path) && /^\d{1,20}$/.test(String(d.to));
  (isAllowed ? ok : bad).push(d);
});

console.log('סה"כ הפרשים בין הקבצים :', diffs.length);
console.log('  הוספות sku מותרות   :', ok.length);
console.log('  שינויים אסורים      :', bad.length);

if (bad.length) {
  console.log('\n❌ נמצאו שינויים שאינם sku:\n');
  bad.slice(0, 40).forEach(d => console.log('   ' + d.kind.padEnd(8) + d.path + '   ' + JSON.stringify(d.from) + ' → ' + JSON.stringify(d.to)));
  if (bad.length > 40) console.log('   ... ועוד ' + (bad.length - 40));
  process.exit(1);
}

// בדיקה שנייה, בלתי תלויה: מסירים את כל מפתחות sku משני הצדדים —
// מה שנשאר חייב להיות זהה כמחרוזת JSON אחת.
const strip = o => JSON.parse(JSON.stringify(o), function (k, v) { return k === 'sku' ? undefined : v; });
const sameWithoutSku = JSON.stringify(strip(A)) === JSON.stringify(strip(B));
console.log('\nבדיקה בלתי-תלויה (הסרת כל שדות sku משני הצדדים):', sameWithoutSku ? '✅ זהים לחלוטין' : '❌ שונים');
if (!sameWithoutSku) process.exit(1);

const prods = (B.collections && B.collections.products) || {};
const withSku = Object.values(prods).filter(p => p && p.sku).length;
console.log('\n✅ אומת: השינוי היחיד בקובץ הוא ' + ok.length + ' שדות sku שנוספו.');
console.log('   מוצרים עם מק"ט בפלט: ' + withSku + ' מתוך ' + Object.keys(prods).length);
