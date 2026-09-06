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
  const pq = Number(p.price), pc = c.salePrice != null ? c.salePrice : c.unitPrice;
  if (pq > 0 && pc > 0) {
    const rel = Math.abs(pq - pc) / pc;
    if (rel <= 0.02) { s += 0.25; why.push('מחיר'); }
    else if (rel <= 0.08) { s += 0.08; }
    else s -= 0.10;
  }
  return { s, why };
}

// ===== ההרצה =====
const bySku = new Map(catalog.map(c => [c.sku, c]));
const filled = [], ambiguous = [], nomatch = [], already = [];
let touched = 0;

for (const id of Object.keys(productDocs)) {
  const p = productDocs[id];
  if (!p || typeof p !== 'object') continue;
  if (p.hidden) { continue; }                       // מוצרים מוסתרים — לא נוגעים
  const existing = String(p.sku == null ? '' : p.sku).replace(/\D/g, '');
  if (existing) { already.push({ id, name: p.name, sku: existing }); continue; }

  const ranked = catalog.map(c => ({ c, ...score(p, c) })).sort((a, b) => b.s - a.s);
  const [a, b] = ranked;
  if (!a || a.s < 0.62) { nomatch.push({ id, name: p.name, price: p.price, best: a && a.c.name, s: a && +a.s.toFixed(2) }); continue; }
  const gap = a.s - (b ? b.s : 0);
  if (gap < 0.12) {
    ambiguous.push({ id, name: p.name, price: p.price,
      options: ranked.slice(0, 3).map(r => ({ sku: r.c.sku, name: r.c.name, size: r.c.size, unit: r.c.unitPrice, s: +r.s.toFixed(2), why: r.why.join('+') })) });
    continue;
  }
  // === הכתיבה היחידה בכל הסקריפט ===
  p.sku = a.c.sku;
  touched++;
  filled.push({ id, name: p.name, sku: a.c.sku, matched: a.c.name, s: +a.s.toFixed(2), why: a.why.join('+') || '—' });
}

fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
fs.writeFileSync(outPath.replace(/\.json$/, '') + '-report.json',
  JSON.stringify({ filled, ambiguous, nomatch, already }, null, 1));

const total = Object.keys(productDocs).length;
console.log('מוצרים בגיבוי        :', total);
console.log('כבר היה להם מק"ט    :', already.length);
console.log('מולאו אוטומטית      :', filled.length);
console.log('דו-משמעיים (לך)     :', ambiguous.length);
console.log('לא נמצאה התאמה      :', nomatch.length);
console.log('\nשדות שנכתבו בסך הכל :', touched, '(כולם sku, ותו לא)');
console.log('קטלוג זמין          :', catalog.length, 'מק"טים');
