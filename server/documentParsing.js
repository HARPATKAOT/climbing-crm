/**
 * חילוץ נתונים מחשבוניות — FINANCE_SPEC שלב 2.
 *
 * שני חצאים טהורים:
 *  1. extractPdfText — שכבת הטקסט של PDF, כולל מפות ToUnicode לעברית.
 *     best-effort במוצהר: מה שלא נקרא מוריד confidence, לא מפיל את הקליטה.
 *  2. extractInvoiceFields — שליפת ספק, ח.פ, מספר מסמך, מספר הקצאה, תאריך,
 *     סכומים ומע״מ מטקסט חופשי בעברית/אנגלית, עם ציון ביטחון.
 *
 * OCR לתמונות סרוקות אינו כאן (חסם B4) — קובץ בלי שכבת טקסט נקלט עם
 * confidence 0 ונוחת בתיבת הנכנס לשיוך ידני.
 */

import zlib from 'zlib';

// ─── PDF text layer ─────────────────────────────────────────────────────────

function inflate(buffer) {
  try { return zlib.inflateSync(buffer); } catch { return null; }
}

/** אוסף את כל זרמי התוכן של ה-PDF, פתוחים. */
function contentStreams(pdfBuffer) {
  const streams = [];
  const raw = pdfBuffer;
  let cursor = 0;
  while (cursor < raw.length) {
    const start = raw.indexOf('stream', cursor);
    if (start < 0) break;
    let dataStart = start + 'stream'.length;
    if (raw[dataStart] === 0x0d) dataStart += 1;
    if (raw[dataStart] === 0x0a) dataStart += 1;
    const end = raw.indexOf('endstream', dataStart);
    if (end < 0) break;
    const chunk = raw.subarray(dataStart, end);
    const dictStart = raw.lastIndexOf('<<', start);
    const dict = dictStart >= 0 ? raw.subarray(dictStart, start).toString('latin1') : '';
    streams.push({ dict, data: /FlateDecode/.test(dict) ? inflate(chunk) : chunk });
    cursor = end + 'endstream'.length;
  }
  return streams.filter((stream) => stream.data);
}

/** מפות ToUnicode: bfchar/bfrange של גופנים מוטמעים — המפתח לעברית. */
function toUnicodeMaps(streams) {
  const map = new Map();
  for (const stream of streams) {
    const text = stream.data.toString('latin1');
    if (!text.includes('beginbfchar') && !text.includes('beginbfrange')) continue;
    for (const match of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const pair of match[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
        const code = parseInt(pair[1], 16);
        const unicode = pair[2].match(/.{1,4}/g).map((hex) => String.fromCharCode(parseInt(hex, 16))).join('');
        map.set(code, unicode);
      }
    }
    for (const match of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const triple of match[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
        const from = parseInt(triple[1], 16);
        const to = parseInt(triple[2], 16);
        const base = parseInt(triple[3], 16);
        for (let code = from; code <= to && code - from < 65536; code += 1) {
          map.set(code, String.fromCharCode(base + (code - from)));
        }
      }
    }
  }
  return map;
}

function decodeLiteral(text) {
  return text
    .replace(/\\([nrtbf()\\])/g, (_m, ch) => ({ n: '\n', r: '\r', t: '\t', b: '', f: '', '(': '(', ')': ')', '\\': '\\' }[ch] ?? ch))
    .replace(/\\(\d{1,3})/g, (_m, oct) => String.fromCharCode(parseInt(oct, 8)));
}

function decodeHex(hex, unicodeMap) {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  if (unicodeMap.size) {
    // ננסה קודם קודים של 2 בתים (CID) — הנפוץ בגופנים עבריים מוטמעים.
    const wide = clean.match(/.{1,4}/g) || [];
    if (wide.every((code) => unicodeMap.has(parseInt(code, 16)))) {
      return wide.map((code) => unicodeMap.get(parseInt(code, 16))).join('');
    }
  }
  return (clean.match(/.{1,2}/g) || []).map((code) => String.fromCharCode(parseInt(code, 16))).join('');
}

/**
 * שכבת הטקסט. עברית ב-PDF נכתבת לרוב ויזואלית (שמאל→ימין הפוך); אחרי
 * החילוץ אנחנו הופכים רצפים עבריים חזרה לסדר לוגי כדי שה-regex ימצא אותם.
 */
export function extractPdfText(pdfBuffer) {
  if (!pdfBuffer || pdfBuffer.length < 8 || pdfBuffer.subarray(0, 5).toString() !== '%PDF-') {
    return { text: '', method: 'not_pdf' };
  }
  const streams = contentStreams(pdfBuffer);
  const unicodeMap = toUnicodeMaps(streams);
  const parts = [];
  for (const stream of streams) {
    const content = stream.data.toString('latin1');
    if (!/\b(Tj|TJ|Tf|BT)\b/.test(content)) continue;
    for (const match of content.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) {
      parts.push(decodeLiteral(match[1]));
    }
    for (const match of content.matchAll(/<([0-9a-fA-F\s]+)>\s*Tj/g)) {
      parts.push(decodeHex(match[1], unicodeMap));
    }
    for (const match of content.matchAll(/\[((?:\\.|[^\]])*)\]\s*TJ/g)) {
      const inner = match[1];
      const literals = [...inner.matchAll(/\(((?:\\.|[^\\()])*)\)/g)].map((m) => decodeLiteral(m[1]));
      const hexes = [...inner.matchAll(/<([0-9a-fA-F\s]+)>/g)].map((m) => decodeHex(m[1], unicodeMap));
      parts.push([...literals, ...hexes].join(''));
    }
    parts.push('\n');
  }
  let text = parts.join(' ').replace(/[ \t]+/g, ' ').trim();
  // היפוך רצפים עבריים שנשמרו ויזואלית: "הנובשח" → "חשבונה".
  text = text.replace(/[֐-׿][֐-׿ "'׳״-]*[֐-׿]/g, (segment) =>
    [...segment].reverse().join(''));
  return { text, method: text.length > 20 ? 'text_layer' : 'empty' };
}

// ─── Field extraction ───────────────────────────────────────────────────────

const parseNumber = (raw) => {
  const value = Number(String(raw).replace(/[^\d.]/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
};

function findDate(text) {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = text.match(/\b(\d{1,2})[./](\d{1,2})[./](20\d{2}|\d{2})\b/);
  if (!dmy) return null;
  const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
  return `${year}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
}

function findAmountAfter(text, labels) {
  for (const label of labels) {
    const pattern = new RegExp(`${label}[^\\d₪-]{0,25}([\\d,]+(?:\\.\\d{1,2})?)`, 'i');
    const match = text.match(pattern);
    if (match) {
      const value = parseNumber(match[1].replace(/,/g, ''));
      if (value) return value;
    }
  }
  return null;
}

/**
 * שליפת שדות מטקסט חשבונית. כל שדה שנמצא מעלה confidence; חסר = null,
 * לעולם לא ניחוש.
 */
export function extractInvoiceFields(text = '') {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  const fields = {
    supplier_tax_id: null,
    doc_number: null,
    allocation_number: null,
    issue_date: null,
    total_gross: null,
    vat_amount: null,
    supplier_name_guess: null,
  };

  const taxId = clean.match(/(?:ח\.?פ\.?|עוסק מורשה|ע\.?מ\.?|מס' עוסק|tax id)[^\d]{0,12}(\d{9})/i)
    || clean.match(/\b(5\d{8})\b/);
  if (taxId) fields.supplier_tax_id = taxId[1];

  const docNumber = clean.match(/(?:חשבונית(?:\s*מס)?(?:\s*[\/]?\s*קבלה)?|קבלה|invoice|מסמך)\s*(?:מס'?|מספר|#|no\.?)?\s*[:\-]?\s*([A-Za-z]{0,4}[-]?\d{3,10})/i);
  if (docNumber) fields.doc_number = docNumber[1];

  // מספר הקצאה של רשות המסים — 9 ספרות, לעולם לא מיוצר אצלנו.
  const allocation = clean.match(/(?:מספר|מס'?)\s*הקצאה[^\d]{0,10}(\d{9})/);
  if (allocation) fields.allocation_number = allocation[1];

  fields.issue_date = findDate(clean);
  fields.total_gross = findAmountAfter(clean, [
    'סה"?כ לתשלום', 'סה"?כ כולל מע"?מ', 'לתשלום', 'סה"?כ', 'total due', 'total',
  ]);
  fields.vat_amount = findAmountAfter(clean, ['מע"?מ\\s*(?:18%?)?', 'vat']);
  if (fields.vat_amount && fields.total_gross && fields.vat_amount >= fields.total_gross) {
    fields.vat_amount = null; // תפסנו את שורת הסכום, לא את שורת המע״מ
  }

  // שם הספק: השורה הראשונה המשמעותית שאינה מילת מפתח של מסמך.
  const lines = String(text).split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const supplierLine = lines.find((line) =>
    line.length >= 3 && line.length <= 60
    && !/חשבונית|קבלה|invoice|receipt|תאריך|date|מספר|עמוד/i.test(line)
    && /[֐-׿A-Za-z]{3}/.test(line));
  if (supplierLine) fields.supplier_name_guess = supplierLine;

  const weights = [
    [fields.total_gross, 0.3],
    [fields.issue_date, 0.2],
    [fields.doc_number, 0.2],
    [fields.supplier_tax_id, 0.15],
    [fields.supplier_name_guess, 0.1],
    [fields.vat_amount, 0.05],
  ];
  const confidence = weights.reduce((sum, [value, weight]) => sum + (value ? weight : 0), 0);
  return { ...fields, confidence: Math.round(confidence * 100) / 100 };
}

/** מזהה קישור לחשבונית בגוף מייל — רק דומיינים מוכרים (FINANCE_SPEC 4.2). */
const INVOICE_LINK_DOMAINS = [
  'icount.co.il', 'greeninvoice.co.il', 'morning.co.il', 'meshulam.co.il', 'ezcount.co.il',
];

export function findInvoiceLinks(bodyText = '') {
  const links = [...String(bodyText).matchAll(/https:\/\/[^\s"'<>]+/g)].map((match) => match[0]);
  return links.filter((link) => {
    try {
      const host = new URL(link).hostname;
      return INVOICE_LINK_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
    } catch {
      return false;
    }
  });
}
