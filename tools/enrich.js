// enrich.js <backup.json> <catalog-merged.json> <out.json>
//
// חוק ברזל אחד: הסקריפט הזה מוסיף אך ורק מפתח "sku" למסמכי מוצרים.
// הוא לא כותב, לא מוחק ולא משנה שום שדה אחר, בשום אוסף אחר. הפלט נבנה
// מהמקור עצמו (JSON.parse של אותו טקסט), כך שכל מה שלא נגעתי בו נשאר
// זהה בייט-לבייט. verify.js מוכיח את זה אחר כך.
const fs = require('fs');
const [, , backupPath, catalogPath, outPath] = process.argv;
if (!backupPath || !catalogPath || !outPath) {
  console.error('שימוש: node enrich.js <backup.json> <catalog-merged.json> <out.json>');
  process.exit(2);
}

const rawText = fs.readFileSync(backupPath, 'utf8');
const payload = JSON.parse(rawText);
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

// הכרעות ידניות של החנות — ידע שאין בשום נתון ולכן אי אפשר לחשב אותו:
// "חלב אדום" הוא 1%, "גמדים סקוואיז תכלת" הוא ארוחת בוקר תות. גובר על הכל.
let OVERRIDES = {};
try {
  OVERRIDES = JSON.parse(fs.readFileSync(__dirname + '/sku-overrides.json', 'utf8'));
  delete OVERRIDES._;
} catch (e) { /* אין קובץ — ממשיכים בלי */ }

// ===== ולידציה של מבנה הגיבוי — נכשלים ברעש, לא בשקט =====
if (!payload || typeof payload !== 'object') throw new Error('גיבוי לא תקין');
if (!payload.collections || typeof payload.collections !== 'object') throw new Error('אין collections בגיבוי');
const productDocs = payload.collections.products;
if (!productDocs || typeof productDocs !== 'object') throw new Error('אין אוסף products בגיבוי');

// ===== נרמול והתאמה (אותה שיטה שנבדקה קודם) =====
const ABBREV = [
  [/לל["״']?ס/g, 'ללא סוכר'], [/לל["״']?ג/g, 'ללא גלוטן'],
  [/ש\.?\s?שועל|ש["״']ש/g, 'שיבולת שועל'],
  [/ק["״']?ג\b/g, 'קילו'], [/מ["״']?ל\b/g, 'מל'], [/גר["״']?\b/g, 'גרם'],
  // מילות אריזה בעברית מול הספרה שהספק משתמש בה: "אקטימל תות שמינייה"
  // מול "אקטימל 8 תות". בלי זה הן נספרות כמילים מזהות שלא נפגשו, והמוצר
  // הנכון נקנס על הבדל שהוא רק ניסוח.
  [/שמינייה|שמיניית|שמינית/g, '8'], [/רבעייה|רביעייה|רביעיית/g, '4'],
  [/שלישייה|שלישיית/g, '3'], [/זוג\b/g, '2'],
];
const TRANSLIT = { ice: 'אייס', cake: 'קייק', not: 'נוט', milk: 'מילק', 'm*lk': 'מילק' };
const STOP = new Set(['גרם','מל','ליטר','של','עם','בטעם','טעם','יח','קרטון','ארגז','אחוז','מארז','בודד']);
function norm(s) {
  let t = String(s == null ? '' : s).replace(/[­؜​-‏⁠-⁩﻿]/g, '').toLowerCase();
  ABBREV.forEach(([re, to]) => { t = t.replace(re, to); });
  return t.replace(/[a-z*]+/g, m => TRANSLIT[m] || m)
    .replace(/["'׳״`]/g, '').replace(/[()\[\],.\-–—+/\\:;!?*]/g, ' ')
    .replace(/(\d)\s*%/g, '$1 ').replace(/\s+/g, ' ').trim();
}
const stem = w => w.replace(/ם$/,'מ').replace(/ן$/,'נ').replace(/ץ$/,'צ').replace(/ף$/,'פ').replace(/ך$/,'כ');
const toks = s => norm(s).split(' ').filter(w => w && !STOP.has(w)).map(stem);

const DF = new Map();
catalog.forEach(c => new Set(toks(c.name)).forEach(w => DF.set(w, (DF.get(w) || 0) + 1)));
const idf = w => Math.log(catalog.length / (1 + (DF.get(w) || 0))) + 0.3;

function wordSim(a, b) {
  if (a === b) return 1;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return 0.88;
  if (Math.abs(a.length - b.length) <= 1 && a.length >= 4) {
    let i = 0, j = 0, e = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++e > 1) return 0;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return 0.78;
  }
  return 0;
}
const gramsOf = s => { const m = norm(s).match(/(\d{2,4})\s*גרם/) || norm(s).match(/\b(\d{3,4})\b/); return m ? Number(m[1]) : null; };

function score(p, c) {
  const q = toks(p.name), t = toks(c.name);
  if (!q.length || !t.length) return { s: 0, why: [] };
  let num = 0, den = 0;
  q.forEach(qw => { const w = idf(qw); den += w; let b = 0; t.forEach(tw => { b = Math.max(b, wordSim(qw, tw)); }); num += w * b; });
  let s = num / den;
  const why = [];
  // משקל תואם
  const gq = gramsOf(p.name), gc = gramsOf(c.size || '') || gramsOf(c.name);
  if (gq && gc) { if (Math.abs(gq - gc) <= Math.max(5, gq * 0.03)) { s += 0.15; why.push('משקל'); } else s -= 0.10; }
  // יח' בארגז תואם — הערך שאצלכם במחשבון/ארגז שלם
  const bq = Number(p.boxSize) || 0;
  if (bq >= 2 && c.cartonUnits) { if (bq === c.cartonUnits) { s += 0.10; why.push('ארגז'); } else s -= 0.05; }
  // מחיר קנייה מול מחיר היחידה של הספק — האות החזקה ביותר להכרעה בין
  // מוצרים שנבדלים רק בשם ("חומוס 750 צהובה" מול "חומוס 750 אחלה")
  // המחיר השמור אצלכם יכול להיות המלא או זה שבמבצע — תלוי מתי עודכן.
  // "גוואקמולי 220" שמור אצלכם 11.89 (מלא) ובקטלוג הוא כרגע ב-18% הנחה
  // על 9.75; השוואה למבצע בלבד נתנה פער 22% וקנסה דווקא התאמה מושלמת.
  // 48 מוצרים בקטלוג במבצע, ולכן בודקים מול שני המחירים ולוקחים את הקרוב.
  const pq = Number(p.price);
  const cands = [c.unitPrice, c.listPrice, c.salePrice].filter(v => Number(v) > 0);
  if (pq > 0 && cands.length) {
    const rel = Math.min.apply(null, cands.map(v => Math.abs(pq - v) / v));
    if (rel <= 0.02) { s += 0.25; why.push('מחיר'); }
    else if (rel <= 0.08) { s += 0.08; }
    else s -= 0.10;
  }
  return { s, why };
}

// ===== התנגשות טעמים =====
// הבאג שהריצה הראשונה חשפה: חמישה מעדני "דנונה פרו" (תות, וניל, וניל
// עוגיות, פירות יער, 21 גרם) קיבלו כולם את המק"ט של התות. הסיבה מלמדת
// משהו על הנתונים — לכל הטעמים של אותו מוצר יש בדיוק אותו מחיר, אותו
// משקל ואותו ארגז, ולכן דווקא אישור המחיר, שהוא האות החזקה ביותר
// להבחנה בין מוצרים שונים, *מחזק* התאמה שגויה בין טעמים.
// מה שכן מבדיל הוא מילת הטעם עצמה. אם לשאילתה יש מילה מזהה שאין
// למועמד, *וגם* למועמד יש כזאת שאין לשאילתה — "וניל" מול "תות" — אלה
// שני פריטים שונים, כמה שהשאר יתאים.
// מילים תיאוריות שחוזרות על עצמן בקטלוג אינן מזהות טעם ולכן לא נספרות.
// מילים שהן תיאור אריזה או ניסוח, לא זהות המוצר. "כוסות משקה קפה קר
// מעודן" מול "משקה קפה קר בסגנון מעודן" הוא אותו פריט — "כוסות" ו"בסגנון"
// הן המילים היחידות שלא נפגשו, ובלי הרשימה הזאת הן נספרו כהבדל טעם.
const GENERIC = new Set([
  'מעדנ','משקה','גבינת','גבינה','יוגורט','בבקבוק','מועשר','מהדרינ','שרינק','פחית','כוסות','כוס',
  'בקירור','מצונ','מצונינ','חלב','שמנת','ממרח','סלט','גר','ליטר','בטעמ','טעמ','שומנ','חלבונ','אחוז',
  'בסגנונ','סגנונ','מארז','חסכונ','בודד','לשתיה','לשתייה','בכפית','משפחתי','קרטונ',
]);
const distinctive = w => w.length >= 3 && !/^\d+$/.test(w) && !GENERIC.has(w);
function unmatchedDistinctive(from, against) {
  return from.filter(w => distinctive(w) && !against.some(x => wordSim(w, x) >= 0.78));
}
// קנס, לא פסילה. ניסיתי קודם לפסול על הסף וזה חתך יותר מדי: "אקטימל תות
// שמינייה (864 גרם)" מול "אקטימל 8 תות עם ויטמין D" הוא אותו מוצר, אבל
// "שמינייה" מול "ויטמין" הן מילים תיאוריות שלא נפגשו — ומספיק היה זה כדי
// לזרוק את המועמד הנכון ולהשאיר זבל במקומו. כקנס, התנהגות הקצוות נכונה:
// טעם שונה שכל השאר בו זהה צונח מתחת לסף ויוצא לאישור ידני, ואילו התאמה
// אמיתית עם משקל, ארגז ומחיר תואמים שורדת גם עם הפרש תיאורי.
const VARIANT_PENALTY = 0.35;
// צבע בשם שלכם הוא זהות הפריט, לא קישוט: "חלב אדום", "חלב כתום", "גמדים
// סקוואיז תכלת". הקטלוג של הספק לא משתמש בצבעים אלא באחוזי שומן ובטעמים,
// ולכן לצבע לעולם אין בן-זוג שם — ואי אפשר להסיק ממנו כלום.
// בלי הכלל הזה "חלב אדום" קיבל בביטחון את המק"ט של 1% מועשר, כי כל שאר
// המילים במועמד ("בבקבוק", "מועשר", "מהדרין") הן תיאוריות ולא סתרו כלום.
// זה היה ניחוש שנראה כמו ודאות — ו"חלב כתום" נשאר בלי, כי המק"ט כבר נתפס.
// מי שיודע מה כל צבע הוא אתם, ולכן זה תמיד יוצא לאישור ידני.
const COLORS = new Set(['אדומ', 'כתומ', 'כחול', 'ירוק', 'צהוב', 'תכלת', 'ורוד', 'שחור', 'חומ']);
function variantPenalty(p, c) {
  const q = toks(p.name), t = toks(c.name);
  const qOnly = unmatchedDistinctive(q, t);
  if (qOnly.some(w => COLORS.has(w))) return VARIANT_PENALTY;
  return qOnly.length > 0 && unmatchedDistinctive(t, q).length > 0 ? VARIANT_PENALTY : 0;
}

// ===== ההרצה =====
const filled = [], review = [], nomatch = [], already = [];
let touched = 0;

const overridden = [];
const bySku = new Map(catalog.map(c => [c.sku, c]));

// שלב א: מועמדים לכל מוצר, אחרי סינון התנגשויות טעם.
// מוצרים מוסתרים נכללים גם הם — הם קיימים במאגר וגם להם מגיע מק"ט — אבל
// הם מקבלים עדיפות נמוכה בשיוך, כדי שלא יחטפו מק"ט ממוצר פעיל.
const pending = [];
for (const id of Object.keys(productDocs)) {
  const p = productDocs[id];
  if (!p || typeof p !== 'object') continue;
  const existing = String(p.sku == null ? '' : p.sku).replace(/\D/g, '');
  if (existing) { already.push({ id, name: p.name, sku: existing }); continue; }

  const forced = OVERRIDES[String(p.name || '').trim()];
  if (forced) {
    const c = bySku.get(String(forced));
    p.sku = String(forced);                          // === כתיבה: sku בלבד ===
    touched++;
    overridden.push({ id, name: p.name, sku: String(forced), matched: c ? c.name : '(לא בקטלוג)' });
    continue;
  }

  const ranked = catalog.map(c => {
    const base = score(p, c);
    const pen = variantPenalty(p, c);
    return { c, s: base.s - pen, base: base.s, why: pen ? base.why.concat('טעם?') : base.why };
  }).sort((a, b) => b.s - a.s);
  pending.push({ id, p, ranked, hidden: !!p.hidden });
}

// שלב ב: שיוך גלובלי — מק"ט אחד שייך למוצר אחד בלבד.
// בלי זה "טחינה 400 גרם" ו"חומוס עם טחינה 400 גרם" קיבלו את אותו מק"ט,
// והמפסיד נשאר בלי — למרות שיש לו מועמד נכון משלו ברשימה.
const pairs = [];
pending.forEach(entry => entry.ranked.slice(0, 6).forEach(r => pairs.push({ entry, r })));
// פעילים לפני מוסתרים, ובתוך כל קבוצה לפי ניקוד. מוצר שנמכר היום קודם
// לגרסה ישנה שלו שהוסתרה — אחרת המוסתר היה חוטף את המק"ט והפעיל נשאר ריק.
pairs.sort((x, y) => (x.entry.hidden - y.entry.hidden) || (y.r.s - x.r.s));
const takenSku = new Set(), takenProd = new Set();
// מק"ט שנקבע ידנית תפוס מראש — אף מוצר אחר לא יקבל אותו
overridden.forEach(o => takenSku.add(o.sku));
const assigned = new Map();
pairs.forEach(({ entry, r }) => {
  if (takenProd.has(entry.id) || takenSku.has(r.c.sku)) return;
  takenProd.add(entry.id); takenSku.add(r.c.sku);
  assigned.set(entry.id, r);
});

// שלב ג: שערי ביטחון על מה ששויך
pending.forEach(entry => {
  const { id, p, ranked } = entry;
  const a = assigned.get(id);
  const alt = ranked.find(r => r !== a);
  const opts = ranked.slice(0, 3).map(r => ({ sku: r.c.sku, name: r.c.name, size: r.c.size, unit: r.c.unitPrice, s: +r.s.toFixed(2), why: r.why.join('+') || '—' }));
  if (!a || a.s < 0.85) {
    // "לא נמצא" נקבע לפי הניקוד *לפני* קנס הטעם. הקנס עונה על "איזה
    // וריאנט", לא על "האם זה בכלל המוצר": "אקטימל תות שמינייה" קיבל 0.79
    // מול "אקטימל 8 תות עם ויטמין D" ואחרי קנס ירד ל-0.44 — ונפל ל"לא
    // נמצא", למרות שזה בדיוק המוצר ורק צריך להכריע בינו לבין "תות בננה".
    const bestBase = ranked.length ? Math.max(...ranked.map(r => r.base)) : 0;
    if (bestBase < 0.55) nomatch.push({ id, name: p.name, price: p.price, best: ranked[0] && ranked[0].c.name, s: ranked[0] && +ranked[0].s.toFixed(2) });
    else review.push({ id, name: p.name, price: p.price, options: opts });
    return;
  }
  if (alt && a.s - alt.s < 0.12) { review.push({ id, name: p.name, price: p.price, options: opts }); return; }
  // === הכתיבה היחידה בכל הסקריפט ===
  p.sku = a.c.sku;
  touched++;
  filled.push({ id, name: p.name, sku: a.c.sku, matched: a.c.name, s: +a.s.toFixed(2), why: a.why.join('+') || '—' });
});
const ambiguous = review;

fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
fs.writeFileSync(outPath.replace(/\.json$/, '') + '-report.json',
  JSON.stringify({ filled, overridden, ambiguous, nomatch, already }, null, 1));

const total = Object.keys(productDocs).length;
console.log('מוצרים בגיבוי        :', total);
console.log('כבר היה להם מק"ט    :', already.length);
console.log('נקבעו ידנית         :', overridden.length);
console.log('מולאו אוטומטית      :', filled.length);
console.log('דו-משמעיים (לך)     :', ambiguous.length);
console.log('לא נמצאה התאמה      :', nomatch.length);
console.log('\nשדות שנכתבו בסך הכל :', touched, '(כולם sku, ותו לא)');
console.log('קטלוג זמין          :', catalog.length, 'מק"טים');
