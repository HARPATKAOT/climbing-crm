/**
 * תלוש מול חשבונית — מסלול ההעסקה של העובד.
 *
 * זה נסגר מול העובד פעם אחת ונשמר בתיק שלו (`payment_method`). שום מסך אחר
 * לא משנה אותו, רק מציג — ולכן מה שיש כאן הוא תג לקריאה בלבד.
 *
 * ההבחנה חשובה כשמשבצים דווקא בגלל הכסף: לעובד חשבונית התעריף הוא **לפני
 * מע״מ** — הוא יוסיף אותו בחשבונית — ואילו בתלוש התעריף הוא **ברוטו**, והנטו
 * תלוי בנתוני מס אישיים שהמערכת הזאת לא מחזיקה ולעולם לא תציג.
 */

import React from 'react';
import { FileText, Receipt } from 'lucide-react';

export function isInvoiceMethod(method) {
  return method === 'invoice' || method === 'חשבונית';
}

/** מה הסכום שמוצג ליד העובד באמת אומר. */
export function amountBasisLabel(method) {
  return isInvoiceMethod(method) ? 'לפני מע״מ' : 'ברוטו';
}

/**
 * תלוש מול חשבונית: שני מסלולי העסקה שונים לגמרי, ולכן הם נבדלים בסימן
 * ובצבע ולא רק במילה.
 */
export function PaymentMethodBadge({ method, compact = false }) {
  const invoice = isInvoiceMethod(method);
  const Icon = invoice ? FileText : Receipt;
  if (compact) {
    return (
      <span
        className={`payment-method-dot${invoice ? ' is-invoice' : ''}`}
        title={invoice ? 'חשבונית · התעריף לפני מע״מ' : 'תלוש · התעריף ברוטו'}
      >
        <Icon size={12} aria-hidden="true" />
      </span>
    );
  }
  return (
    <span
      className={`badge ${invoice ? 'badge-amber' : 'badge-blue'}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
    >
      <Icon size={12} />
      {invoice ? 'חשבונית' : 'תלוש'}
    </span>
  );
}
