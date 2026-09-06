// v320: בודק שסימון "הוזמן באפליקציה" עובר דרך שאלת הכמות, ושהכמות שנבחרה
// היא זו שנרשמת. הקוד נשלף מ-index.html עצמו לפי סימנים בטקסט, כדי שהבדיקה
// תיפול אם הלוגיקה משתנה ולא רק אם ההעתק כאן מתיישן.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const grab = (a, b) => {
  const i = src.indexOf(a); if (i < 0) throw new Error('לא נמצא: ' + a);
  const j = src.indexOf(b, i); if (j < 0) throw new Error('לא נמצא סוף: ' + b);
  return src.slice(i, j);
};

const code =
  grab('function askOrderTexts(title, yes, no)', '// ===== v292: העתקת ברקוד בלחיצה') +
  '\n' + grab('function toggleAppOrder(key, item, fromOrderId)', '// הסרה ידנית של מוצר שלא הגיע') +
  '\n' + grab('function addAppOrderFromSearch(productId)', '// v290: סימון מעדכן רק את השורה');

// סביבה מינימלית: DOM מזויף שזוכר טקסטים ומחלקות, ושאר הפונקציות כמלכודות
// שמעידות שהן נקראו — כדי לבדוק גם מה קורה וגם מה *לא* קורה
function build(state) {
  const els = {};
  const el = id => els[id] || (els[id] = {
    id: id, textContent: '', cls: {},
    classList: { add(c) { el(id).cls[c] = 1; }, remove(c) { delete el(id).cls[c]; } }
  });
  const log = [];
  const fn = new Function(
    '$', 'products', 'appOrders', 'appSearch', 'askProduct', 'askMark', 'askQty',
    'buzz', 'showToast', 'saveAppOrders', 'refreshAppRows', 'refreshAppPanels',
    'refreshAppNotArrived', 'refreshAppOrderUi', 'nextAppOrderStamp', 'appOrderActive',
    'appOrderIndex', 'barcodeForKey', 'setAskBarcode', 'appOrdersForProduct', 'log',
    code + `
    return {
      toggleAppOrder: toggleAppOrder,
      addAppOrderFromSearch: addAppOrderFromSearch,
      answerAskOrder: answerAskOrder,
      stepAskQty: stepAskQty,
      state: () => ({ appOrders: appOrders, appSearch: appSearch, askMark: askMark, askQty: askQty }),
    };`);

  let appOrders = state.appOrders || [];
  let appSearch = state.appSearch || '';
  let stamp = 1000;
  const api = fn(
    el,
    state.products || [],
    appOrders,
    appSearch,
    null, null, 1,
    () => log.push('buzz'),
    (t) => log.push('toast:' + t),
    () => log.push('save'),
    () => log.push('rows'),
    () => log.push('panels'),
    () => log.push('notArrived'),
    () => log.push('orderUi'),
    () => ++stamp,
    x => !x.sent,
    () => state.index || {},
    k => (state.barcodes || {})[k] || '',
    v => log.push('askBarcode:' + v),
    () => [],
    log
  );
  api.el = el;
  api.els = els;
  api.log = log;
  return api;
}

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log((ok ? '✅ ' : '❌ ') + name);
  if (!ok) console.log('     קיבלתי ' + JSON.stringify(got) + '  ציפיתי ' + JSON.stringify(want));
};

const P = [{ id: 'a', name: 'שוקו פקק', barcode: '7290003029433' }];

// --- לחיצה על שורה לא מסמנת מיד אלא פותחת את החלון
let api = build({ products: P, appOrders: [], barcodes: { a: '7290003029433' } });
api.toggleAppOrder('a', { name: 'שוקו פקק' }, 'o1');
check('לחיצה לא כותבת סימון', api.state().appOrders.length, 0);
check('לחיצה לא שומרת', api.log.indexOf('save'), -1);
check('החלון נפתח', !api.els.askOrderModal.cls.hidden, true);
check('הכותרת היא שאלת כמות', api.els.askOrderTitle.textContent, 'כמה ארגזים הזמנת?');
check('שם המוצר בחלון', api.els.askOrderName.textContent, 'שוקו פקק');
check('הברקוד בחלון', api.els.askOrderCode.textContent, '7290003029433');
check('הכפתורים משנים טקסט', [api.els.askOrder_yes.textContent, api.els.askOrder_no.textContent], ['סמן', 'ביטול']);

// --- הכמות שנבחרה היא זו שנרשמת
api.stepAskQty(1); api.stepAskQty(1);
check('הכמות בחלון התעדכנה', api.els.askOrderQty.textContent, '3');
api.answerAskOrder(true);
let rec = api.state().appOrders;
check('נרשמה שורה אחת', rec.length, 1);
check('הכמות שנבחרה נשמרה', rec[0] && rec[0].amount, 3);
check('המפתח והשם נשמרו', [rec[0].key, rec[0].name], ['a', 'שוקו פקק']);
check('שיוך להזמנה נשמר', rec[0].fromOrderId, 'o1');
check('נשמר ורוענן', ['save', 'rows', 'panels', 'notArrived'].every(x => api.log.indexOf(x) >= 0), true);
check('החלון נסגר', !!api.els.askOrderModal.cls.hidden, true);

// --- ביטול בחלון לא מסמן כלום
api = build({ products: P, appOrders: [] });
api.toggleAppOrder('a', { name: 'שוקו פקק' }, '');
api.stepAskQty(1);
api.answerAskOrder(false);
check('ביטול לא מסמן', api.state().appOrders.length, 0);
check('ביטול לא שומר', api.log.indexOf('save'), -1);
check('ביטול סוגר את החלון', !!api.els.askOrderModal.cls.hidden, true);

// --- כמות לא יורדת מתחת ל-1
api = build({ products: P, appOrders: [] });
api.toggleAppOrder('a', { name: 'שוקו פקק' }, '');
api.stepAskQty(-1); api.stepAskQty(-1);
check('הכמות לא יורדת מתחת ל-1', api.els.askOrderQty.textContent, '1');

// --- ביטול סימון של מוצר מסומן הוא מיידי, בלי חלון
api = build({ products: P, appOrders: [{ key: 'a', name: 'שוקו פקק', amount: 2, at: 1 }] });
api.toggleAppOrder('a', { name: 'שוקו פקק' }, '');
check('ביטול סימון מוחק מיד', api.state().appOrders.length, 0);
check('ביטול סימון לא פותח חלון', !!api.els.askOrderModal, false);
check('ביטול סימון נשמר', api.log.indexOf('save') >= 0, true);

// --- סימון מחדש מוחק רשומה ישנה של אותו מוצר (v300 נשמר)
api = build({ products: P, appOrders: [{ key: 'a', name: 'שוקו פקק', amount: 1, at: 1, sent: true }] });
api.toggleAppOrder('a', { name: 'שוקו פקק' }, '');   // הישנה אינה פעילה → סימון
api.stepAskQty(1);
api.answerAskOrder(true);
rec = api.state().appOrders;
check('אין שתי רשומות לאותו מוצר', rec.length, 1);
check('הרשומה החדשה עם הכמות שנבחרה', rec[0].amount, 2);

// --- הוספה מהחיפוש עוברת גם היא דרך שאלת הכמות
api = build({ products: P, appOrders: [], appSearch: 'שוקו', index: {} });
api.addAppOrderFromSearch('a');
check('חיפוש פותח חלון ולא מוסיף', api.state().appOrders.length, 0);
check('החיפוש נשמר בזמן השאלה', api.state().appSearch, 'שוקו');
api.stepAskQty(1);
api.answerAskOrder(true);
check('אישור מהחיפוש מוסיף בכמות שנבחרה', api.state().appOrders.map(x => x.amount), [2]);
check('אישור מהחיפוש מנקה את תיבת החיפוש', api.state().appSearch, '');

// --- ביטול מהחיפוש משאיר את החיפוש כדי שאפשר יהיה לבחור מוצר אחר
api = build({ products: P, appOrders: [], appSearch: 'שוקו', index: {} });
api.addAppOrderFromSearch('a');
api.answerAskOrder(false);
check('ביטול מהחיפוש משאיר את החיפוש', api.state().appSearch, 'שוקו');

// --- מוצר שכבר מסומן לא נפתח שוב מהחיפוש
api = build({ products: P, appOrders: [], index: { a: [{ key: 'a', amount: 1 }] } });
api.addAppOrderFromSearch('a');
check('מסומן כבר — החיפוש לא פותח חלון', !!api.els.askOrderModal, false);

// --- סימון ידני אינו נוגע בברקוד הממתין של v305
api = build({ products: P, appOrders: [] });
api.toggleAppOrder('a', { name: 'שוקו פקק' }, '');
api.answerAskOrder(true);
check('הברקוד הממתין לא נמחק', api.log.some(x => String(x).indexOf('askBarcode:') === 0), false);

console.log('\n' + '─'.repeat(46));
console.log('עברו ' + pass + ' · נכשלו ' + fail);
process.exit(fail ? 1 : 0);
