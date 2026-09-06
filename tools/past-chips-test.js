// בודק את appPastList מול נתוני הגיבוי האמיתיים
// הגיבוי עצמו אינו בריפו (נתוני חנות), ולכן הנתיב מגיע כארגומנט או ב-BACKUP:
//   node tools/past-chips-test.js /נתיב/לגיבוי.json
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const grab = (a, b) => {
  const i = src.indexOf(a); if (i < 0) throw new Error('לא נמצא: ' + a);
  const j = src.indexOf(b, i); if (j < 0) throw new Error('לא נמצא סוף: ' + b);
  return src.slice(i, j);
};
const code = grab('function appPastList()', 'function appPastChipsHtml');

const backupPath = process.argv[2] || process.env.BACKUP || path.join(__dirname, 'backup.json');
if (!fs.existsSync(backupPath)) {
  console.log('⏭  אין קובץ גיבוי (' + backupPath + ') — הבדיקה נדלגת.');
  console.log('   הרצה: node tools/past-chips-test.js /נתיב/לגיבוי.json');
  process.exit(0);
}
const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
const prodDocs = backup.collections.products;
const products = Object.entries(prodDocs).map(([id, p]) => Object.assign({ id }, p));
const appOrders = (backup.collections.drafts.appOrders || {}).items || [];

function build(activeMap, notArrivedFn) {
  const f = new Function('products', 'appOrders', 'appOrderIndex', 'appOrderNotArrived',
    code + '\nreturn appPastList;');
  return f(products, appOrders, () => activeMap, notArrivedFn);
}

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log((ok ? '✅ ' : '❌ ') + name + (ok ? '' : '\n     קיבלתי ' + JSON.stringify(got) + ' ציפיתי ' + JSON.stringify(want)));
};

// --- המצב האמיתי עכשיו: כל 28 פעילים
const allActive = {}; appOrders.forEach(x => { allActive[x.key] = [x]; });
let list = build(allActive, () => false)();
check('כשהכל מסומן עכשיו — אין צ׳יפים', list.length, 0);

// --- אחרי שידור: הכל הופך ללא-פעיל → כולם הופכים לצ׳יפים
list = build({}, () => false)();
console.log('   אחרי שידור ההזמנה: ' + list.length + ' צ׳יפים');
if (list.length > 0) pass++; else fail++;
console.log((list.length ? '✅ ' : '❌ ') + 'אחרי שידור — הרפרטואר הופך לצ׳יפים');
console.log('     ' + list.slice(0, 5).map(x => x.name.slice(0, 22)).join(' · '));

// --- מוצר שלא הגיע לא מופיע כצ׳יפ (הוא כבר ברשימה האדומה)
const oneKey = appOrders[0].key;
list = build({}, x => x.key === oneKey)();
check('מוצר ב״לא הגיע״ אינו צ׳יפ', list.some(x => x.id === oneKey), false);

// --- מוצר מוסתר לא מופיע
const hiddenKey = Object.keys(prodDocs).find(k => prodDocs[k].hidden);
const withHidden = appOrders.concat([{ key: hiddenKey, name: 'מוסתר', amount: 1, at: Date.now() }]);
const f = new Function('products', 'appOrders', 'appOrderIndex', 'appOrderNotArrived', code + '\nreturn appPastList;');
list = f(products, withHidden, () => ({}), () => false)();
check('מוצר מוסתר אינו צ׳יפ', list.some(x => x.id === hiddenKey), false);

// --- אין כפילויות
list = build({}, () => false)();
check('אין כפילויות', list.length, new Set(list.map(x => x.id)).size);

console.log('\n' + '─'.repeat(46));
console.log('עברו ' + pass + ' · נכשלו ' + fail);
process.exit(fail ? 1 : 0);
