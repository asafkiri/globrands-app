// מפענח אחיד לשני המסכים של אפליקציית הספק:
//   "קטלוג"  — עמוד עיון: שורת כמות "0", ואחריה מחיר ליחידה [+ מחיר מבצע]
//   "הזמנה"  — היסטוריית הזמנות: שורת כמות "N קרטונים", ואחריה סכום השורה
// העוגן בשניהם זהה: שורת המק"ט בת 6 הספרות.
// מחיר היחידה נגזר תמיד מ-(מחיר לקרטון / יח' בקרטון) ולא מהסכום שמעליו,
// כי בהזמנה הסכום הוא סך השורה — ובשורה אחת בהיסטוריה הוא גם לא עקבי.
const fs = require('fs');

function parseSupplierText(raw) {
  const lines = raw.split('\n')
    .map(s => s.replace(/[­؜​-‏⁠-⁩﻿]/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const isSku    = s => /^\d{6}$/.test(s);
  const isBadge  = s => /^\d+% הנחה$/.test(s) || s === 'מוצר חדש';
  const cartonRe = /^(\d+) יח׳ בקרטון$/;
  const qtyRe    = /^(\d+) קרטונים?$/;
  const isSize   = s => /^\d+(\.\d+)?( ?(גרם|מ"ל|מל|ליטר|ק"ג))?$/.test(s);
  const isMoney  = s => /^\d+(\.\d+)?$/.test(s);

  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isSku(lines[i])) continue;
    // לאחור: השם (מופיע פעמיים) ולפניו תגית אפשרית
    let j = i - 1;
    const name = lines[j];
    if (name === undefined || isSku(name)) continue;
    if (lines[j - 1] === name) j--;
    const badge = isBadge(lines[j - 1]) ? lines[j - 1] : '';

    let k = i + 1;
    let size = '';
    if (!cartonRe.test(lines[k]) && isSize(lines[k])) size = lines[k++];
    const cm = cartonRe.exec(lines[k] || '');
    const cartonUnits = cm ? Number(cm[1]) : null;
    if (cm) k++;

    // ===== אזור הכמות =====
    // שלוש צורות נראו בשטח, ולכן לא מניחים צורה אחת אלא בולעים את כל מה
    // שאינו מחיר עד המחיר הראשון:
    //   "0"                          — קטלוג, בורר הכמות סגור
    //   "1 קרטונים"                  — היסטוריית הזמנות
    //   "קרטון / יח׳ / 1 / קרטונים"  — קטלוג, בורר הכמות פתוח (+ "הוספה" בסוף)
    // כל מחיר אמיתי בפורמט הזה מגיע מיד אחרי שורת "₪" משלו. לכן הגבול
    // אמין: מה שבין יח׳ בקרטון ל-"₪" הראשון הוא ממשק הכמות, לא מחיר.
    // בלי הכלל הזה "0" ו-"1" של בורר הכמות נקראו כמחיר.
    const UNIT_WORDS = new Set(['קרטון', 'קרטונים', 'יח׳', 'יחידה', 'יחידות', 'הוספה']);
    let source = 'catalog', qty = null;
    const qStart = k;
    while (k < lines.length && k - qStart < 8 && lines[k] !== '₪' && lines[k] !== 'מחיר לקרטון') {
      const qm = qtyRe.exec(lines[k]);
      if (qm) { source = 'order'; qty = Number(qm[1]); }          // "4 קרטונים" — הזמנה שסופקה
      else if (/^\d+$/.test(lines[k]) && UNIT_WORDS.has(lines[k + 1] || '')) qty = Number(lines[k]); // בורר פתוח
      k++;
    }
    if (qty === 0) qty = null;   // "0" הוא בורר סגור, לא כמות

    const prices = [];
    while (k < lines.length && lines[k] !== 'מחיר לקרטון' && prices.length < 4) {
      if (lines[k] === '₪') { k++; continue; }
      if (isMoney(lines[k])) { prices.push(Number(lines[k])); k++; continue; }
      break;
    }
    let cartonPrice = null;
    if (lines[k] === 'מחיר לקרטון') {
      k++;
      if (lines[k] === '₪') k++;
      if (isMoney(lines[k])) cartonPrice = Number(lines[k]);
    }
    const unitPrice = (cartonPrice != null && cartonUnits) ? Math.round(cartonPrice / cartonUnits * 100) / 100 : null;

    out.push({
      sku: lines[i], name, badge, size, cartonUnits, cartonPrice, unitPrice, source,
      qty,
      listPrice: source === 'catalog' ? (prices[0] ?? null) : null,
      salePrice: source === 'catalog' && prices.length > 1 ? prices[1] : null,
      lineTotal: source === 'order' ? (prices[0] ?? null) : null,
    });
  }
  return out;
}

// ===== מיזוג לפי מק"ט על פני כל ההדבקות =====
// הקטלוג גובר על הזמנות, תמיד. הזמנה היא תצלום היסטורי: "משקה קאופרי"
// הוזמן ב-22.07 במחיר מלא (127.20 לקרטון), ובקטלוג הוא היום ב-15% הנחה
// (108.12, יחידה 9.01). מיזוג נאיבי שבו הקובץ האחרון דורס היה מוחק את
// המחיר הנוכחי לטובת ההיסטורי — והמחיר הוא האות שמכריעה בהתאמת השמות.
// לכן הזמנה רק משלימה שדות חסרים, ולעולם לא דורסת נתון מהקטלוג.
const RANK = { catalog: 2, order: 1 };
function mergeRow(prev, next) {
  if (!prev) return Object.assign({}, next);
  const strong = RANK[next.source] >= RANK[prev.source] ? next : prev;
  const weak = strong === next ? prev : next;
  const out = Object.assign({}, weak);
  Object.keys(strong).forEach(k => {
    const v = strong[k];
    if (v !== null && v !== undefined && v !== '') out[k] = v;
  });
  // כמה הוזמן שייך להזמנה, לא לקטלוג — שומרים את הערך האחרון שנראה
  if (next.qty != null) out.qty = next.qty;
  return out;
}
const files = process.argv.slice(2);
const store = new Map();
const perFile = [];
files.forEach(f => {
  const rows = parseSupplierText(fs.readFileSync(f, 'utf8'));
  let added = 0;
  rows.forEach(r => { if (!store.has(r.sku)) added++; store.set(r.sku, mergeRow(store.get(r.sku), r)); });
  perFile.push({ f: f.split('/').pop(), rows: rows.length, added, src: rows[0] && rows[0].source });
});

perFile.forEach(p => console.log(`${p.f.padEnd(16)} ${String(p.rows).padStart(4)} שורות · ${String(p.added).padStart(4)} חדשים · פורמט ${p.src}`));
console.log('─'.repeat(56));
console.log('סה"כ מק"טים ייחודיים:', store.size);

const all = [...store.values()];
console.log('  עם מחיר לקרטון :', all.filter(x => x.cartonPrice != null).length);
console.log('  עם יח\' בקרטון  :', all.filter(x => x.cartonUnits).length);
console.log('  חסרי שם        :', all.filter(x => !x.name).length);

// אימות: מחיר לקרטון / יח' = מחיר יחידה שהקטלוג הדפיס במפורש
const check = all.filter(x => x.listPrice != null && x.unitPrice != null && x.salePrice == null);
const off = check.filter(x => Math.abs(x.unitPrice - x.listPrice) > 0.02);
console.log(`\nאימות מחיר יחידה מול הקטלוג: ${check.length - off.length}/${check.length} תואמים`);
off.forEach(x => console.log('  ⚠', x.sku, x.name, 'גזור', x.unitPrice, 'מודפס', x.listPrice));

// שורות הזמנה שבהן הסכום לא שווה כמות × מחיר לקרטון
const ord = all.filter(x => x.source === 'order' && x.qty && x.cartonPrice != null && x.lineTotal != null);
const odd = ord.filter(x => Math.abs(x.qty * x.cartonPrice - x.lineTotal) > 0.02);
console.log(`\nשורות הזמנה: ${ord.length - odd.length}/${ord.length} עקביות (כמות × מחיר לקרטון = סכום)`);
odd.forEach(x => console.log(`  ⚠ ${x.sku} ${x.name} — ${x.qty} × ${x.cartonPrice} = ${(x.qty*x.cartonPrice).toFixed(2)} אך מודפס ${x.lineTotal}`));

fs.writeFileSync(__dirname + '/catalog-merged.json', JSON.stringify(all, null, 1));
console.log('\nנשמר catalog-merged.json');
