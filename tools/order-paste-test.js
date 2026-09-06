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

// marks: { productId: כמות מסומנת פעילה }
function build(products, marks) {
  const m = marks || {};
  const f = new Function('products', 'appOrdersFor', 'appOrderQtyOf', 'appActiveList',
    code + '\nreturn { parse: parseSupplierOrder, analyze: analyzeOrderPaste, clean: pasteCleanLine, willWrite: orderPasteWillWrite, extras: orderPasteExtras, diagnose: orderPasteDiagnosis };');
  return f(products || [],
    k => (m[k] ? [{ amount: m[k] }] : []),
    list => (list || []).reduce((a, x) => a + (Number(x.amount) || 0), 0),
    // כמו appActiveList האמיתי: כל מה שמסומן פעיל, לפי מפתח
    () => Object.keys(m).filter(k => m[k] > 0).map(k => ({
      key: k, qty: m[k],
      name: ((products || []).find(p => p.id === k) || {}).name || k
    })));
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

// ===== הדבקה חוזרת של הזמנה שכבר מסומנת =====
const paste2 = block('שוקו פקק 250 מ"ל', '341470', 12, 1) + '\n' +
               block("קוטג' 5% 250 גרם", '216962', 12, 2);

// --- הכל כבר מסומן באותן כמויות: שום דבר לא ייכתב
let a = build(P, { p1: 1, p2: 2 }).analyze(paste2);
check('הכל מסומן — כל השורות מסומנות same', a.hit.map(h => h.status), ['same', 'same']);
check('הכל מסומן — אין מה לכתוב', build(P, { p1: 1, p2: 2 }).willWrite(a.hit).length, 0);

// --- כמות שונה: רק היא נכתבת
a = build(P, { p1: 1, p2: 5 }).analyze(paste2);
check('כמות שונה מזוהה כעדכון', a.hit.map(h => h.status), ['same', 'changed']);
check('רק המשתנה נכתב', build(P, {}).willWrite(a.hit).map(h => h.id), ['p2']);
check('הכמות מההדבקה גוברת על הקיימת', a.hit[1].qty, 2);
check('הכמות הקודמת נשמרת לתצוגה', a.hit[1].was, 5);

// --- לא מסומן כלל: חדש
a = build(P, {}).analyze(paste2);
check('ללא סימון קיים — הכל חדש', a.hit.map(h => h.status), ['new', 'new']);

// --- מסומן אבל לא פעיל (שודר לנהג / לא הגיע) נחשב חדש, כי appOrdersFor
//     מחזיר רק סימונים פעילים — וזו בדיוק הזמנה חוזרת
a = build(P, { p1: 0 }).analyze(paste2);
check('סימון לא פעיל נחשב חדש', a.hit[0].status, 'new');

// --- המצב האמיתי בשטח: סימנתי חלק, ואז הדבקתי את כל ההזמנה
const P3 = P.concat([{ id: 'p3', name: 'מילקי', sku: '365349' }]);
const paste3 = paste2 + '\n' + block('מילקי בטעם פסק זמן', '365349', 24, 1);
const mixed = build(P3, { p1: 1, p2: 9 });      // p1 נכון · p2 בכמות שגויה · p3 לא מסומן
a = mixed.analyze(paste3);
check('תערובת — כל שורה מסווגת נכון', a.hit.map(h => h.status), ['same', 'changed', 'new']);
check('תערובת — נכתבים רק מה שחסר ומה שהשתנה',
  mixed.willWrite(a.hit).map(h => h.id), ['p2', 'p3']);
check('תערובת — מה שכבר נכון לא נגע', mixed.willWrite(a.hit).some(h => h.id === 'p1'), false);

// ===== עמידות למבנה העתקה שונה (מכשירי אנדרואיד/דפדפנים אחרים) =====

// --- אותם שדות מופרדים בטאבים במקום בשורות
const tabbed = 'שוקו פקק 250 מ"ל\tשוקו פקק 250 מ"ל\t341470\t261 גרם\t12 יח׳ בקרטון\t1 קרטונים\t₪\t37.92';
check('שדות מופרדים בטאבים נקראים', api.parse(tabbed), [{ sku: '341470', name: 'שוקו פקק 250 מ"ל', qty: 1 }]);

// --- שורות ריקות כפולות ו-CRLF
check('CRLF ושורות ריקות לא שוברים',
  api.parse(block('מוצר', '111111', 6, 2).split('\n').join('\r\n\r\n')).map(x => x.qty), [2]);

// --- גרסאות של "יח׳ בקרטון"
['6 יח בקרטון', "6 יח' בקרטון", '6 יחידות בקרטון', '6 יח״ בקרטון'].forEach(u => {
  const t = 'מוצר\nמוצר\n123456\n250 גרם\n' + u + '\n3 קרטונים\n₪\n5';
  check('תכולת ארגז בכתיב "' + u + '" אינה נחשבת לכמות', api.parse(t).map(x => x.qty), [3]);
});

// --- "קרטון" ביחיד, ובלי רווח
check('"1 קרטון" ביחיד נקרא', api.parse('מוצר\nמוצר\n123456\n250 גרם\n6 יח׳ בקרטון\n1 קרטון\n₪\n5').map(x => x.qty), [1]);
check('"2קרטונים" בלי רווח נקרא', api.parse('מוצר\nמוצר\n123456\n250 גרם\n6 יח׳ בקרטון\n2קרטונים\n₪\n5').map(x => x.qty), [2]);

// ===== אבחון כישלון — כדי שיהיה אפשר לדעת מרחוק מה נשבר =====
check('הדבקה ריקה', api.diagnose('  '), 'לא הודבק כלום.');
check('מסך קטלוג — ההודעה מזכירה את מסך הקטלוג',
  /מסך הקטלוג/.test(api.diagnose('סקי\nסקי\n212339\n500 גרם\n12 יח׳ בקרטון\n0\n₪\n8.37')), true);
check('מק"טים בלי כמויות — נאמר כמה מק"טים נמצאו',
  /נמצאו 2 מק״טים, אבל אף שורת כמות/.test(api.diagnose('111111\n222222\nשלום')), true);
check('כמויות בלי מק"טים',
  /נמצאו 2 שורות כמות, אבל אף מק״ט/.test(api.diagnose('1 קרטונים\n2 קרטונים')), true);
check('טקסט זר לגמרי', /לא זוהתה אף שורת הזמנה/.test(api.diagnose('שלום מה נשמע')), true);

// ===== "מסומן אצלך ואינו בהדבקה" =====
// p9 מסומן אבל אינו בדף ההזמנה — או שהוזמן בהזמנה אחרת, או שבסוף לא הוזמן
const P4 = P3.concat([{ id: 'p9', name: 'חלב אדום', sku: '344072' }]);
let api4 = build(P4, { p1: 1, p9: 2 });
a = api4.analyze(paste3);
check('מסומן שאינו בהדבקה מופיע כחריג', api4.extras(a.hit).map(x => x.key), ['p9']);
check('מסומן שכן בהדבקה אינו חריג', api4.extras(a.hit).some(x => x.key === 'p1'), false);
check('החריג נושא את הכמות שלו לתצוגה', api4.extras(a.hit)[0].qty, 2);

// --- ההדבקה עצמה לא נוגעת בחריגים: הם לא נכתבים ולא נמחקים
check('חריג אינו נכנס למה שייכתב', api4.willWrite(a.hit).some(h => h.id === 'p9'), false);

// --- בלי שום סימון חורג הרשימה ריקה
api4 = build(P4, { p1: 1 });
check('אין חריגים כשהכל בהדבקה', api4.extras(api4.analyze(paste3).hit).length, 0);

// --- מוצר שאין לו כרטיס (מפתח שם) גם הוא חריג לגיטימי
api4 = build(P4, { 'name:מוצר ידני': 1 });
check('סימון לפי שם נחשב חריג', api4.extras(api4.analyze(paste3).hit).map(x => x.key), ['name:מוצר ידני']);


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

      // --- הדבקה חוזרת על המצב האמיתי שבאפליקציה: מה שכבר מסומן לא נכתב
      const pasteFile = path.join(dir, 'order-paste.txt');
      const draft = ((backup.collections.drafts || {}).appOrders || {}).items || [];
      if (fs.existsSync(pasteFile) && draft.length) {
        const marks = {};
        draft.forEach(m => { if (m && m.key && (Number(m.amount) || 0) > 0) marks[m.key] = (marks[m.key] || 0) + Number(m.amount); });
        const withMarks = build(prods, marks);
        const re = withMarks.analyze(fs.readFileSync(pasteFile, 'utf8'));
        const willWrite = withMarks.willWrite(re.hit);
        console.log('   הדבקה חוזרת על ' + draft.length + ' סימונים קיימים · ' +
          're.hit=' + re.hit.length + ' · ייכתבו: ' + willWrite.length);
        check('הדבקה חוזרת של הזמנה שכבר מסומנת אינה כותבת כלום', willWrite.length, 0);

        // --- סימון חלקי: משאירים מחצית מהסימונים ומדביקים את כל ההזמנה.
        //     מה שנכתב חייב להיות בדיוק מה שאינו מסומן נכון — לא פחות ולא יותר.
        const keys = Object.keys(marks);
        const half = {};
        keys.slice(0, Math.floor(keys.length / 2)).forEach(k => { half[k] = marks[k]; });
        if (keys.length) half[keys[0]] = marks[keys[0]] + 3;      // ואחד בכמות שגויה
        const partApi = build(prods, half);
        const part = partApi.analyze(fs.readFileSync(pasteFile, 'utf8'));
        const partWrite = partApi.willWrite(part.hit);
        const expect = part.hit.filter(h => (half[h.id] || 0) !== h.qty).map(h => h.id).sort();
        console.log('   סימון חלקי (' + Object.keys(half).length + ' מסומנים) · חדשים ' +
          part.hit.filter(h => h.status === 'new').length + ' · עדכון כמות ' +
          part.hit.filter(h => h.status === 'changed').length + ' · ללא שינוי ' +
          part.hit.filter(h => h.status === 'same').length + ' · ייכתבו ' + partWrite.length);
        check('סימון חלקי — נכתב בדיוק מה שאינו מסומן נכון', partWrite.map(h => h.id).sort(), expect);
        check('סימון חלקי — לא נכתב כלום שכבר היה נכון',
          partWrite.some(h => half[h.id] === h.qty), false);

        // --- חריגים על הנתונים האמיתיים: כל 28 הסימונים נמצאים בהדבקה
        check('המצב האמיתי — אין סימון חורג', withMarks.extras(re.hit).length, 0);
        // וכשמוסיפים סימון למוצר שאינו בהזמנה, הוא ואך ורק הוא מופיע
        const outsider = prods.find(p => p.sku && !re.hit.some(h => h.id === p.id));
        if (outsider) {
          const plus = Object.assign({}, marks); plus[outsider.id] = 2;
          const plusApi = build(prods, plus);
          const ex = plusApi.extras(plusApi.analyze(fs.readFileSync(pasteFile, 'utf8')).hit);
          console.log('   סימון אחד מחוץ להזמנה (' + outsider.name + ') → חריגים: ' + ex.length);
          check('סימון מחוץ להזמנה מופיע כחריג יחיד', ex.map(x => x.key), [outsider.id]);
        }
      }
    }
  }
} else {
  console.log('\n⏭  ללא דפי הזמנה אמיתיים (העבירו תיקייה כארגומנט) — רצו רק הבדיקות המובנות.');
}

console.log('\n' + '─'.repeat(46));
console.log('עברו ' + pass + ' · נכשלו ' + fail);
process.exit(fail ? 1 : 0);
