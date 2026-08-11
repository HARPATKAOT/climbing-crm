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

const PAPER_MM = 80;

const escape = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const money = (value) => `₪${(Number(value) || 0).toFixed(2)}`;

/** @returns {string} מסמך HTML שלם ברוחב נייר הקבלה. */
export function buildReceiptHtml({ businessName = 'קיר בועז', sale, changeGiven = 0 } = {}) {
  const items = (sale?.items || []).map((item) => {
    const name = item.name || item.description || 'פריט';
    const qty = Number(item.quantity) || 1;
    const price = Number(item.unitprice ?? item.price) || 0;
    return `
      <tr>
        <td class="name">${escape(name)}</td>
        <td class="qty">${qty}</td>
        <td class="sum">${money(qty * price)}</td>
      </tr>`;
  }).join('');

  const tendered = Number(sale?.tendered_amount);
  const cashRows = sale?.payment_method === 'cash'
    ? [
      Number.isFinite(tendered) ? `<div class="row"><span>התקבל</span><span>${money(tendered)}</span></div>` : '',
      Number(changeGiven) > 0 ? `<div class="row"><span>עודף</span><span>${money(changeGiven)}</span></div>` : '',
    ].join('')
    : '';

  return `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8">
<title>קבלה</title>
<style>
  @page { size: ${PAPER_MM}mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body {
    width: ${PAPER_MM}mm; margin: 0; padding: 4mm 3mm;
    font-family: "Segoe UI", Arial, sans-serif; font-size: 11pt; color: #000;
    background: #fff; -webkit-print-color-adjust: exact;
  }
  h1 { font-size: 15pt; text-align: center; margin: 0 0 3mm; }
  .meta { font-size: 9.5pt; line-height: 1.5; }
  hr { border: 0; border-top: 1px dashed #000; margin: 2.5mm 0; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
  td { padding: 0.6mm 0; vertical-align: top; }
  td.qty { width: 8mm; text-align: center; }
  td.sum { width: 20mm; text-align: left; white-space: nowrap; }
  .row { display: flex; justify-content: space-between; font-size: 10.5pt; }
  .total { font-size: 14pt; font-weight: 700; }
  .thanks { text-align: center; margin-top: 4mm; font-size: 11pt; }
</style></head>
<body>
  <h1>${escape(businessName)}</h1>
  <div class="meta">
    <div>מסמך: ${escape(sale?.icount_doc_number || sale?.id || '')}</div>
    <div>לקוח: ${escape(sale?.customer_name || '')}</div>
    <div>${escape(new Date(sale?.created_at || Date.now()).toLocaleString('he-IL'))}</div>
  </div>
  <hr>
  <table>${items}</table>
  <hr>
  <div class="row total"><span>סה״כ</span><span>${money(sale?.total)}</span></div>
  ${cashRows}
  <div class="thanks">תודה!</div>
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

    frame.onload = () => {
      try {
        const view = frame.contentWindow;
        view.focus();
        view.print();
        cleanup();
        resolve({ ok: true, via: 'os' });
      } catch (err) {
        cleanup();
        reject(new Error(err?.message || 'ההדפסה דרך ווינדוס נכשלה'));
      }
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
