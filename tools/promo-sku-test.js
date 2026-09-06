// בודק את הלוגיקה שנוספה, מתוך הקוד האמיתי ולא מהעתק
const fs = require('fs');
const src = fs.readFileSync('/home/user/yotvata-app/index.html', 'utf8');
function grab(a, b) {
  const i = src.indexOf(a); if (i < 0) throw new Error('לא נמצא: ' + a);
  const j = src.indexOf(b, i); if (j < 0) throw new Error('לא נמצא סוף: ' + b);
  return src.slice(i, j);
}
const lines = src.split("\n");
const slice = (a, b) => lines.slice(a - 1, b - 1).join("\n");
const code =
  slice(692, 716) +                                    // normalizeBarcode … findProductBySku
  "\n" + grab("let promoSkuPending = [];", "async function flushPromoSkus");

const build = new Function('P', code + `
  return { collect: collectSkuFromSheet, pending: () => promoSkuPending, reset: () => { promoSkuPending = []; } };
`.replace('P', 'products'));

function run(prods) {
  const f = new Function('products', code +
    '\nreturn { collect: collectSkuFromSheet, get pending(){return promoSkuPending;}, reset(){promoSkuPending=[];} };');
  return f(prods);
}

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log((ok ? '✅ ' : '❌ ') + name);
  if (!ok) console.log('     קיבלתי ' + JSON.stringify(got) + '  ציפיתי ' + JSON.stringify(want));
};

// --- מוצר בלי מק"ט מקבל אחד
let P = [{ id: 'a', name: 'שוקו פקק', barcode: '7290003029433' }];
let api = run(P);
api.collect(P[0], '341470');
check('מוצר ריק מקבל מק"ט', api.pending.map(x => x.sku), ['341470']);

// --- מוצר שכבר יש לו מק"ט לא נדרס
P = [{ id: 'a', name: 'שוקו פקק', barcode: '729', sku: '999999' }];
api = run(P);
api.collect(P[0], '341470');
check('מק"ט קיים לא נדרס', api.pending.length, 0);

// --- מק"ט ששייך למוצר אחר נדחה (סימן לשגיאת קריאה)
P = [{ id: 'a', name: 'מוצר א', barcode: '111', sku: '341470' },
     { id: 'b', name: 'מוצר ב', barcode: '222' }];
api = run(P);
api.collect(P[1], '341470');
check('מק"ט תפוס במוצר אחר נדחה', api.pending.length, 0);

// --- אותו מוצר פעמיים בדף לא נאסף פעמיים
P = [{ id: 'a', name: 'מוצר', barcode: '111' }];
api = run(P);
api.collect(P[0], '341470'); api.collect(P[0], '341470');
check('כפילות באותו דף נמנעת', api.pending.length, 1);

// --- ערכים לא תקינים
P = [{ id: 'a', name: 'מוצר', barcode: '111' }];
api = run(P);
['', null, undefined, 'abc', '   '].forEach(v => api.collect(P[0], v));
check('מק"ט ריק/לא-מספרי נדחה', api.pending.length, 0);

// --- ניקוי מהדבקה
P = [{ id: 'a', name: 'מוצר', barcode: '111' }];
api = run(P);
api.collect(P[0], 'מק״ט 341470');
check('מק"ט עם תווית מנוקה', api.pending.map(x => x.sku), ['341470']);

// --- כמה מוצרים בדף אחד
P = [{ id: 'a', name: 'א', barcode: '111' }, { id: 'b', name: 'ב', barcode: '222' }, { id: 'c', name: 'ג', barcode: '333', sku: '5' }];
api = run(P);
api.collect(P[0], '100000'); api.collect(P[1], '200000'); api.collect(P[2], '300000');
check('דף עם 3 שורות → 2 נאספו', api.pending.map(x => x.id), ['a', 'b']);

console.log('\n' + '─'.repeat(46));
console.log('עברו ' + pass + ' · נכשלו ' + fail);
process.exit(fail ? 1 : 0);
