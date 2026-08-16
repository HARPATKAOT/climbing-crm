import React from 'react';
import {
  Banknote, Bot, Building2, CheckCircle2, CreditCard, FileQuestion, FileText,
  Landmark, Link2, Mail, PencilLine, ReceiptText, Ruler, Store, User, Wallet,
} from 'lucide-react';

/**
 * תגיות צבעוניות אחידות לכל המרכז הפיננסי — אותו דפוס badge של הקופה
 * (payMethodBadge ב-CashRegister), במקום אחד במקום פונקציות פזורות.
 */

// אמצעי תשלום — המפתח הוא התווית העברית שהשרת מחזיר (payment_method_label).
export const PAYMENT_METHOD_BADGES = {
  'מזומן': { badge: 'badge badge-green', Icon: Banknote, color: '#34D399' },
  'אשראי': { badge: 'badge badge-purple', Icon: CreditCard, color: '#A78BFA' },
  'אשראי אונליין': { badge: 'badge badge-blue', Icon: CreditCard, color: '#60A5FA' },
  'אשראי בקופה': { badge: 'badge badge-purple', Icon: CreditCard, color: '#A78BFA' },
  'העברה בנקאית': { badge: 'badge badge-cyan', Icon: Landmark, color: '#2DD4BF' },
  'המחאה': { badge: 'badge badge-amber', Icon: FileText, color: '#FBBF24' },
  'PayPal': { badge: 'badge badge-blue', Icon: Wallet, color: '#60A5FA' },
  'ברטר': { badge: 'badge badge-gray', Icon: Ruler, color: '#94A3B8' },
};

export function paymentMethodBadge(label) {
  return PAYMENT_METHOD_BADGES[label] || { badge: 'badge badge-gray', Icon: Wallet, color: '#94A3B8' };
}

export function PaymentMethodTag({ label }) {
  if (!label || label === 'לא ידוע') return <span className="badge badge-gray">לא ידוע</span>;
  const { badge, Icon } = paymentMethodBadge(label);
  return <span className={badge}><Icon size={12} />{label}</span>;
}

// מקור הוצאה (expense-center source_tags).
export const EXPENSE_SOURCE_BADGES = {
  bank: { label: 'בנק', badge: 'badge badge-cyan', Icon: Landmark },
  credit_card: { label: 'אשראי', badge: 'badge badge-purple', Icon: CreditCard },
  icount: { label: 'iCount', badge: 'badge badge-blue', Icon: ReceiptText },
  manual: { label: 'ידני', badge: 'badge badge-gray', Icon: PencilLine },
  notion: { label: 'ארכיון', badge: 'badge badge-gray', Icon: FileText },
  email: { label: 'מייל', badge: 'badge badge-amber', Icon: Mail },
};

export function ExpenseSourceTag({ tag }) {
  const meta = EXPENSE_SOURCE_BADGES[tag] || { label: tag, badge: 'badge badge-gray', Icon: FileText };
  const { badge, Icon, label } = meta;
  return <span className={badge}><Icon size={12} />{label}</span>;
}

// סטטוס חשבונית של הוצאה — ✓ ברור למה שיש, אדום בולט למה שחסר.
export const INVOICE_STATUS_BADGES = {
  matched: { label: 'חשבונית מותאמת', badge: 'badge badge-green', Icon: CheckCircle2 },
  attached: { label: 'חשבונית מצורפת', badge: 'badge badge-green', Icon: CheckCircle2 },
  proposed: { label: 'התאמה מוצעת', badge: 'badge badge-purple', Icon: Link2 },
  missing: { label: 'חסרה חשבונית', badge: 'badge badge-red', Icon: FileQuestion },
};

export function InvoiceStatusTag({ status }) {
  const meta = INVOICE_STATUS_BADGES[status] || INVOICE_STATUS_BADGES.missing;
  const { badge, Icon, label } = meta;
  return <span className={badge}><Icon size={12} />{label}</span>;
}

// מקור הקטגוריה — מי תייג.
export const CATEGORY_SOURCE_META = {
  ai: { label: 'תויג AI', Icon: Bot },
  rule: { label: 'לפי חוק', Icon: Ruler },
  manual: { label: 'ידני', Icon: User },
};

// אייקונים לפילטרים של מסך ההכנסות (source values של השרת).
export const INCOME_SOURCE_ICONS = {
  pos: { Icon: Store, color: '#FBBF24' },
  activity: { Icon: Building2, color: '#A78BFA' },
  equipment: { Icon: Ruler, color: '#2DD4BF' },
  customer: { Icon: User, color: '#60A5FA' },
  icount: { Icon: ReceiptText, color: '#38BDF8' },
};
