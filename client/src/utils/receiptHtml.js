/**
 * קבלה כ-HTML, להדפסה דרך מנגנון ההדפסה של ווינדוס.
 *
 * הנתיב הישיר (WebUSB) אינו אפשרי כשמדפסת הקבלות משרתת גם תוכנת קופה אחרת:
 * דרייבר המדפסת של ווינדוס מחזיק את ההתקן, והדפדפן מקבל „Access denied”.
 * העברת המדפסת ל-WinUSB הייתה פותרת את זה ומנתקת אותה מהתוכנה השנייה, ולכן
 * כאן מדפיסים כמו כל תוכנה אחרת — והמדפסת נשארת משותפת.
 *
 * מה שלא עובר בדרך הזאת הוא פקודת פתיחת המגירה: היא פקודת ESC/POS ולא חלק
 * מהמסמך. רוב דרייברי מדפסות הקבלות יודעים לפתוח את המגירה בכל הדפסה —
 * זו הגדרה בדרייבר, פעם אחת.
 */

import { vatBreakdown } from './vat.js';

const PAPER_MM = 80;

/**
 * שוליים מתים של הראש התרמי. נמדד מהדרייבר של BTP-R880NPII: בתוך דף של
 * 80.08 מ"מ השטח בר-ההדפסה מתחיל ב-5.00 מ"מ ורוחבו 72.57 מ"מ, כלומר 2.51 מ"מ
 * מתים גם בצד ימין. תוכן שחורג מהתחום הזה פשוט לא יוצא מהמדפסת — וזה מה שאכל
 * את סימן ה-₪ בשורת הסה״כ, שיושבת בקצה השמאלי בדף RTL.
 */
const PAD_LEFT_MM = 6;
const PAD_RIGHT_MM = 3.5;

/** מרווח בסוף הקבלה כדי שהחיתוך לא ייגע בשורה האחרונה. */
const TAIL_MM = 3;

/** תקרת ההמתנה לטעינת הלוגו לפני הדפסה. */
const IMAGE_WAIT_MS = 2000;

/**
 * הלוגו בגרסת הדפסה.
 *
 * לוגו האתר בנוי מבלוקים בגוונים בינוניים — אפור, אדום, כחול, כתום, טורקיז,
 * חום. המדפסת מונוכרום ואין בה אפור כלל, וההמרה לגווני אפור מקרבת דווקא את
 * הצבעים האלה זה לזה: הסף מאחד את כולם לגוש כהה אחד, והצורה נעלמת. שום סינון
 * CSS לא מציל את זה, כי המידע אובד בהמרה עצמה ולא בסף.
 *
 * `logo-print.png` הוא צללית שחור-לבן שהוכנה מראש בדיוק לשימוש הזה — קווי
 * המתאר של היעל והסלע נשמרים, ואין מה לרבב.
 *
 * לוגו שהועלה דרך ההגדרות אינו מוכר לנו מראש, ולכן הוא נשאר עם דחיפת
 * הניגודיות: לא מושלם, אבל עדיף על כלום. על התמונה הבינארית הסינון הזה הוא
 * ממילא חסר השפעה.
 */
const PRINT_LOGO = '/logo-print.png';

const logoSrc = (profile) => {
  const url = String(profile?.logo_url || '').trim();
  return !url || url === '/logo.png' ? PRINT_LOGO : url;
};

/** גוף הדף — משותף לקבלה ולפתק פתיחת הקופה. */
const PAGE_CSS = `
  @page { margin: 0; }
  * { box-sizing: border-box; }
  body {
    width: ${PAPER_MM}mm; margin: 0;
    padding: 4mm ${PAD_RIGHT_MM}mm ${TAIL_MM}mm ${PAD_LEFT_MM}mm;
    font-family: "Segoe UI", Arial, sans-serif; font-size: 11pt; color: #000;
    background: #fff; -webkit-print-color-adjust: exact;
  }`;

// המרכאות נחוצות מאז שה-`logo_url` מוזרק לתוך מאפיין `src`, ולא רק לטקסט.
const escape = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const money = (value) => `₪${(Number(value) || 0).toFixed(2)}`;

/**
 * כותרת המסמך — **נקודת ההחלטה היחידה** בקובץ הזה.
 *
 * „חשבונית מס קבלה” מודפס רק כששני התנאים מתקיימים: קיים מספר מסמך מ-iCount
 * (`doctype: 'invrec'` — מסמך מס אמיתי, ממוספר וחתום), וקיים מספר עוסק
 * בהגדרות העסק. חסר אחד מהם — מודפס „אישור תשלום”, כי מסמך בלי מספר עוסק
 * אינו חשבונית מס, ולהדפיס עליו את הכותרת הזאת פירושו להציג פתק דלפק כמשהו
 * שהוא לא.
 *
 * כשרואה החשבון יחזיר תשובה על אופי הפתק — זו הפונקציה שמשתנה, ולא שום דבר
 * אחר.
 */
function documentTitle(sale, profile) {
  const hasDoc = !!sale?.icount_doc_number;
  const hasVatId = !!String(profile?.vat_id || '').trim();
  return hasDoc && hasVatId ? 'חשבונית מס קבלה' : 'אישור תשלום';
}

/** תווית אמצעי התשלום כפי שהיא מוכרת ללקוח. */
function paymentLabel(method) {
  switch (String(method || '').toLowerCase()) {
    case 'cash': return 'מזומן';
    case 'emv':
    case 'cc':
    case 'card':
    case 'credit': return 'כרטיס אשראי';
    case 'online': return 'תשלום מקוון';
    default: return '';
  }
}

/**
 * @param {object} args
 * @param {object} [args.profile] פרופיל העסק — שם משפטי, מספר עוסק, כתובת, לוגו.
 * @param {object} args.sale המכירה כפי שחזרה מהשרת.
 * @param {number} [args.changeGiven] עודף שניתן במזומן.
 * @returns {string} מסמך HTML שלם ברוחב נייר הקבלה.
 */
export function buildReceiptHtml({ profile, sale, changeGiven = 0 } = {}) {
  const businessName = String(profile?.legal_name || profile?.display_name || 'קיר בועז').trim();
  const vatId = String(profile?.vat_id || '').trim();
  const title = documentTitle(sale, profile);

  const rows = (sale?.items || []).map((item) => {
    const name = item.name || item.description || 'פריט';
    const qty = Number(item.quantity) || 1;
    const unit = Number(item.unitprice ?? item.price) || 0;
    // כמות ומחיר ליחידה הם פרטי חובה, אבל 70 מ״מ לא נושאים ארבע עמודות
    // קריאות. לכן שם הפריט תופס שורה, והפירוט יושב מתחתיו בשורה משלו.
    return `
      <tr class="item"><td colspan="2">${escape(name)}</td></tr>
      <tr class="item-sub">
        <td class="unit">${qty} × ${money(unit)}</td>
        <td class="sum">${money(qty * unit)}</td>
      </tr>`;
  }).join('');

  // המחירים בקופה כוללים מע״מ (המכירה נשלחת ל-iCount עם `vattype: 0`), ולכן
  // הפירוק הוא חילוץ מהסכום ולא הוספה עליו.
  const { net, vat, rate } = vatBreakdown(Number(sale?.total) || 0, true);

  const tendered = Number(sale?.tendered_amount);
  const isCash = sale?.payment_method === 'cash';
  const method = paymentLabel(sale?.payment_method);
  const paymentRows = [
    method ? `<div class="row"><span>שולם ב${method}</span><span>${money(sale?.total)}</span></div>` : '',
    isCash && Number.isFinite(tendered) ? `<div class="row"><span>התקבל</span><span>${money(tendered)}</span></div>` : '',
    isCash && Number(changeGiven) > 0 ? `<div class="row"><span>עודף</span><span>${money(changeGiven)}</span></div>` : '',
  ].join('');

  const contact = [profile?.address, profile?.phone].map((v) => String(v || '').trim()).filter(Boolean);

  return `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8">
<title>${escape(title)}</title>
<style>
  ${PAGE_CSS}
  /* המדפסת מונוכרום ב-203dpi ואין בה גווני אפור: כל פיקסל הוא שחור או לבן.
     דחיפת הניגודיות מקרבת את הלוגו לשחור-לבן נקי במקום ריבוב אפרפר. */
  .logo { display: block; margin: 0 auto 2mm; max-width: 40mm; max-height: 18mm;
          filter: grayscale(1) contrast(260%); }
  h1 { font-size: 15pt; text-align: center; margin: 0; letter-spacing: 0.3mm; }
  .biz { text-align: center; font-size: 9.5pt; line-height: 1.45; margin-top: 1.5mm; }
  .biz .name { font-size: 11pt; font-weight: 700; }
  .copy { text-align: center; font-size: 9pt; margin-top: 1mm; }
  hr { border: 0; border-top: 1px dashed #000; margin: 2.5mm 0; }
  .meta { font-size: 9.5pt; line-height: 1.55; }
  .meta .row { display: flex; justify-content: space-between; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 0; vertical-align: top; }
  tr.item td { padding-top: 1.2mm; font-size: 10.5pt; }
  tr.item-sub td { font-size: 9.5pt; padding-bottom: 0.8mm; }
  td.unit { text-align: right; }
  td.sum { text-align: left; white-space: nowrap; width: 22mm; }
  .row { display: flex; justify-content: space-between; font-size: 10pt; line-height: 1.6; }
  .total { font-size: 14pt; font-weight: 700; line-height: 1.4; }
  .thanks { text-align: center; margin-top: 4mm; font-size: 11pt; }
</style></head>
<body>
  <img class="logo" src="${escape(logoSrc(profile))}" alt="">

  <h1>${escape(title)}</h1>
  <div class="biz">
    <div class="name">${escape(businessName)}</div>
    ${vatId ? `<div>עוסק מורשה ${escape(vatId)}</div>` : ''}
    ${contact.map((line) => `<div>${escape(line)}</div>`).join('')}
  </div>
  <div class="copy">מקור</div>
  <hr>
  <div class="meta">
    <div class="row"><span>${sale?.icount_doc_number ? 'מס׳ מסמך' : 'מס׳ מכירה'}</span><span>${escape(sale?.icount_doc_number || sale?.id || '')}</span></div>
    <div class="row"><span>תאריך</span><span>${escape(new Date(sale?.created_at || Date.now()).toLocaleString('he-IL'))}</span></div>
    ${sale?.customer_name ? `<div class="row"><span>לקוח</span><span>${escape(sale.customer_name)}</span></div>` : ''}
  </div>
  <hr>
  <table>${rows}</table>
  <hr>
  <div class="row"><span>סה״כ לפני מע״מ</span><span>${money(net)}</span></div>
  <div class="row"><span>מע״מ ${Math.round(rate * 100)}%</span><span>${money(vat)}</span></div>
  <div class="row total"><span>סה״כ לתשלום</span><span>${money(sale?.total)}</span></div>
  <hr>
  ${paymentRows}
  <div class="thanks">תודה!</div>
</body></html>`;
}

/**
 * פתק פתיחת קופה.
 *
 * במסלול ההדפסה דרך ווינדוס אין לנו דרך לשלוח את פקודת פתיחת המגירה: היא
 * פקודת ESC/POS, והדרייבר מחזיק את המדפסת. מה שכן בידינו הוא ההדפסה עצמה —
 * והדרייבר מוגדר לפתוח את המגירה בסוף כל מסמך. לכן „פתיחת מגירה” כאן היא
 * הדפסת פתק קצר, והמגירה נפתחת כתופעת לוואי שלה.
 *
 * הפתק אינו בזבוז: פתיחת קופה בלי מכירה היא בדיוק מה שקופות מתעדות, והשורה
 * המודפסת משאירה חותם זמן למי שסופר את הקופה בסוף המשמרת.
 *
 * @returns {string} מסמך HTML שלם ברוחב נייר הקבלה.
 */
export function buildDrawerSlipHtml({ businessName = 'קיר בועז', at = new Date() } = {}) {
  return `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8">
<title>פתיחת קופה</title>
<style>
  ${PAGE_CSS}
  h1 { font-size: 13pt; text-align: center; margin: 0 0 2mm; }
  .what { text-align: center; font-size: 11pt; font-weight: 700; }
  .when { text-align: center; font-size: 9.5pt; margin-top: 1.5mm; }
</style></head>
<body>
  <h1>${escape(businessName)}</h1>
  <div class="what">פתיחת קופה</div>
  <div class="when">${escape(at.toLocaleString('he-IL'))}</div>
</body></html>`;
}

/**
 * הדפסה דרך מנגנון ההדפסה של הדפדפן.
 *
 * ה-iframe מוסתר ונמחק אחרי ההדפסה. `print()` חוסם עד שהמשתמש סוגר את חלון
 * ההדפסה, ולכן הניקוי נעשה אחריו ולא בטיימר.
 */
export function printReceiptViaOs(html) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:-10000px;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(frame);

    const cleanup = () => {
      window.setTimeout(() => {
        try { frame.remove(); } catch { /* ignore */ }
      }, 500);
    };

    /**
     * `print()` מצלם את הדף כפי שהוא באותו רגע. לוגו שעוד לא נטען פשוט לא
     * יופיע — ובמדפסת תרמית אין שום סימן לכך שזה קרה, פשוט יוצאת קבלה בלי
     * לוגו. לכן ממתינים לתמונות, אבל עם תקרת זמן: קבלה בלי לוגו עדיפה בהרבה
     * על קבלה שלא יצאה כי תמונה נתקעה.
     */
    const pendingImages = (doc) => Array.from(doc.images || []).filter((img) => !img.complete);

    const waitForImages = (pending) => Promise.race([
      Promise.all(pending.map((img) => new Promise((done) => {
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      }))),
      new Promise((done) => { window.setTimeout(done, IMAGE_WAIT_MS); }),
    ]);

    frame.onload = () => {
      const view = frame.contentWindow;
      const send = () => {
        try {
          view.focus();
          view.print();
          cleanup();
          resolve({ ok: true, via: 'os' });
        } catch (err) {
          cleanup();
          reject(new Error(err?.message || 'ההדפסה דרך ווינדוס נכשלה'));
        }
      };
      // כשאין תמונה שממתינה, ההדפסה נשלחת מתוך אירוע הטעינה עצמו — בדיוק כפי
      // שהיה לפני שנוספה ההמתנה ללוגו. ההמתנה הפכה כל הדפסה לאסינכרונית, כולל
      // פתק פתיחת הקופה שאין בו תמונה כלל, ומאז מבליח חלון לבן שלא היה קודם.
      // ההמתנה נשארת למי שבאמת צריך אותה, ולא נגבית ממי שלא.
      const pending = pendingImages(view.document);
      if (!pending.length) return send();
      waitForImages(pending).then(send, send);
    };
    frame.onerror = () => {
      cleanup();
      reject(new Error('טעינת הקבלה להדפסה נכשלה'));
    };

    const doc = frame.contentDocument || frame.contentWindow?.document;
    if (!doc) {
      cleanup();
      reject(new Error('אין גישה למסמך ההדפסה'));
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
  });
}
