// v321: בודק את פענוח דף ההזמנה של הספק ואת ההצלבה מול המאגר.
// הקוד נשלף מ-index.html עצמו לפי סימנים בטקסט — הבדיקה נופלת אם הלוגיקה
// משתנה, ולא רק אם ההעתק כאן מתיישן.
//
// דוגמאות אמיתיות (דפי הזמנה שהועתקו מהאפליקציה) אינן בריפו — הן נתוני
// ספק. הנתיב אליהן מגיע כארגומנט או ב-SAMPLES, ובלעדיו רצות רק הבדיקות
// המובנות.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const grab = (a, b) => {
  const i = src.indexOf(a); if (i < 0) throw new Error('לא נמצא: ' + a);
  const j = src.indexOf(b, i); if (j < 0) throw new Error('לא נמצא סוף: ' + b);
  return src.slice(i, j);
};

const code =
  grab('function normalizeSku(value)', 'function duplicateBarcodeMessage') +
  '\n' + grab('const PASTE_SKU_RE', 'let orderPaste = null;');

function build(products) {
  const f = new Function('products', 'appOrdersFor', 'appOrderQtyOf',
    code + '\nreturn { parse: parseSupplierOrder, analyze: analyzeOrderPaste, clean: pasteCleanLine };');
  return f(products || [], () => [], () => 0);
}

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log((ok ? '✅ ' : '❌ ') + name);
  if (!ok) console.log('     קיבלתי ' + JSON.stringify(got) + '  ציפיתי ' + JSON.stringify(want));
};

const api = build([]);
const block = (name, sku, units, qty, extra) =>
  (extra ? extra + '\n' : '') + name + '\n' + name + '\n' + sku + '\n250 גרם\n' +
  units + ' יח׳ בקרטון\n' + qty + ' קרטונים\n₪\n61.20\nמחיר לקרטון \n₪\n61.20';

// --- המבנה הבסיסי
check('שורה אחת נקראת במלואה',
  api.parse(block('שוקו פקק 250 מ"ל', '341470', 12, 1)),
  [{ sku: '341470', name: 'שוקו פקק 250 מ"ל', qty: 1 }]);

// --- כמות גדולה מ-1 היא העיקר כאן
check('2 קרטונים נקראים כ-2',
  api.parse(block("קוטג' 5% 250 גרם", '216962', 12, 2)).map(x => x.qty), [2]);

// --- "12 יח׳ בקרטון" אינו הכמות
check('תכולת הארגז אינה נחשבת לכמות',
  api.parse(block('מוצר', '111111', 12, 3)).map(x => x.qty), [3]);

// --- תוויות מעל השם
check('תווית הנחה אינה נלקחת כשם',
  api.parse(block('חומוס 750 צהובה', '320400', 6, 1, '12% הנחה')).map(x => x.name), ['חומוס 750 צהובה']);
check('"מוצר חדש" אינו נלקח כשם',
  api.parse(block('שוקו מקופלת 1 ליטר', '365083', 12, 1, 'מוצר חדש')).map(x => x.name), ['שוקו מקופלת 1 ליטר']);

// --- מסך הקטלוג: הכמות היא 0 ולכן אין מה לקלוט
check('מסך קטלוג (כמות 0) אינו נקלט',
  api.parse('סקי משפחתי 5%\nסקי משפחתי 5%\n212339\n500 גרם\n12 יח׳ בקרטון\n0\n₪\n8.37\nמחיר לקרטון\n₪\n100.44').length, 0);

// --- מספר ההזמנה אינו מק"ט
check('מספר הזמנה (10 ספרות) אינו מק"ט',
  api.parse('הזמנה מס׳ 1050602831\n1050602831\n1 קרטונים').length, 0);

// --- מחירים אינם מק"טים
check('מחיר אינו נקרא כמק"ט',
  api.parse('מוצר\n106.32\n1 קרטונים').length, 0);

// --- כמות של מוצר אחד לא נגנבת למוצר שלפניו
const two = api.parse(block('מוצר א', '111111', 6, 0).replace(/0 קרטונים\n/, '') + '\n' + block('מוצר ב', '222222', 6, 4));
check('מוצר בלי כמות אינו גונב את הכמות של הבא',
  two, [{ sku: '222222', name: 'מוצר ב', qty: 4 }]);

// --- אותו מק"ט פעמיים מתחבר
check('מק"ט כפול — הכמויות מתחברות',
  api.parse(block('מוצר', '333333', 6, 1) + '\n' + block('מוצר', '333333', 6, 2)).map(x => x.qty), [3]);

// --- תווים בלתי-נראים מהעתקה מדפדפן
check('סימני כיווניות מנוקים',
  api.clean('‏341470‎'), '341470');
check('מק"ט עטוף בסימני כיווניות עדיין נקרא',
  api.parse('מוצר\nמוצר\n‏341470‎\n250 גרם\n12 יח׳ בקרטון\n‏1 קרטונים\n₪\n5').map(x => x.sku), ['341470']);

// --- הצלבה מול המאגר
const P = [
  { id: 'p1', name: 'שוקו פקק', sku: '341470' },
  { id: 'p2', name: 'קוטג׳ 5%', sku: '216962', hidden: true },
];
const api2 = build(P);
let r = api2.analyze(block('שוקו פקק 250 מ"ל', '341470', 12, 1) + '\n' +
                     block("קוטג' 5% 250 גרם", '216962', 12, 2) + '\n' +
                     block('מוצר שאין לנו', '999999', 6, 1));
check('זוהו שניים, אחד לא', [r.hit.length, r.miss.length], [2, 1]);
check('הזיהוי מחזיר את המוצר שלנו ואת הכמות',
  r.hit.map(h => [h.id, h.qty]), [['p1', 1], ['p2', 2]]);
check('מוצר מוסתר מסומן ככזה', r.hit.map(h => h.hidden), [false, true]);
check('השם של הספק נשמר לצד השם שלנו',
  r.hit[0].supplierName, 'שוקו פקק 250 מ"ל');
check('מה שלא זוהה מגיע עם מק"ט ושם', [r.miss[0].sku, r.miss[0].qty], ['999999', 1]);

// --- הדבקה ריקה או זבל
check('טקסט ריק מחזיר כלום', api2.analyze('').items.length, 0);
check('טקסט לא רלוונטי מחזיר כלום', api2.analyze('שלום\nמה נשמע\n123').items.length, 0);

// ===== מול דפי ההזמנה האמיתיים, אם יש =====
const dir = process.argv[2] || process.env.SAMPLES;
if (dir && fs.existsSync(dir)) {
  const backupPath = path.join(dir, 'backup-with-sku.json');
  if (fs.existsSync(backupPath)) {
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    const prods = Object.entries(backup.collections.products).map(([id, p]) => Object.assign({ id }, p));
    const live = build(prods);
    console.log('\nדפי הזמנה אמיתיים · ' + prods.length + ' מוצרים במאגר, ' +
      prods.filter(p => p.sku).length + ' עם מק"ט:');
    let totalHit = 0, totalItems = 0;
    ['order-paste.txt', 'order1.txt', 'order2.txt'].forEach(f => {
      const fp = path.join(dir, f);
      if (!fs.existsSync(fp)) return;
      const a = live.analyze(fs.readFileSync(fp, 'utf8'));
      totalHit += a.hit.length; totalItems += a.items.length;
      console.log('   ' + f.padEnd(18) + ' ' + String(a.hit.length).padStart(3) + '/' +
        String(a.items.length).padEnd(3) + ' · ' + a.hit.reduce((s, h) => s + h.qty, 0) + ' ארגזים' +
        (a.miss.length ? ' · לא זוהו: ' + a.miss.map(m => m.sku).join(', ') : ''));
    });
    if (totalItems) {
      check('כל דפי ההזמנה יחד — לפחות 85% זוהו', totalHit / totalItems >= 0.85, true);
      // מסך הקטלוג חייב להישאר ריק גם על הקובץ האמיתי
      const cat = path.join(dir, 'catalog.txt');
      if (fs.existsSync(cat)) check('הקטלוג האמיתי אינו נקלט כהזמנה', live.analyze(fs.readFileSync(cat, 'utf8')).items.length, 0);
    }
  }
} else {
  console.log('\n⏭  ללא דפי הזמנה אמיתיים (העבירו תיקייה כארגומנט) — רצו רק הבדיקות המובנות.');
}

console.log('\n' + '─'.repeat(46));
console.log('עברו ' + pass + ' · נכשלו ' + fail);
process.exit(fail ? 1 : 0);
