/**
 * שליחת הוצאות וחשבוניות לרואה החשבון במייל — FINANCE_SPEC משוב 2.
 *
 * העקרונות: stub (אין RESEND_API_KEY) לעולם לא נרשם כ"נשלח"; הוצאה בלי
 * קובץ חשבונית לא נשלחת בשקט אלא חוזרת כפריט לטיפול; שליחה חוזרת מעדכנת
 * את אותה שורת delivery (attempts עולה) ולא יוצרת כפילות.
 */

export const MAX_EMAIL_BYTES = 25 * 1024 * 1024; // מתחת לתקרת Resend (40MB)

/** data:<mime>;base64,xxx → {filename, content, contentType} | null. */
export function attachmentFromDataUrl(fileName, dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    filename: fileName || 'invoice.pdf',
    content: match[2],
    contentType: match[1],
    bytes: Math.floor(match[2].length * 3 / 4),
  };
}

/** קובצי החשבונית של הוצאה: הקבצים המצורפים אליה, או המסמך שהותאם אליה. */
export function expenseAttachments(expense, { matchedIngested = null } = {}) {
  const fromExpense = (expense?.attachment_metadata || [])
    .map((attachment) => attachmentFromDataUrl(attachment.file_name, attachment.data))
    .filter(Boolean);
  if (fromExpense.length) return fromExpense;
  if (matchedIngested?.data) {
    const attachment = attachmentFromDataUrl(matchedIngested.file_name, matchedIngested.data);
    if (attachment) return [attachment];
  }
  return [];
}

export function expenseSummaryLine(expense) {
  const amount = Number(expense.amount_gross);
  return [
    expense.expense_date || 'ללא תאריך',
    expense.supplier_name || expense.name || 'ללא ספק',
    Number.isFinite(amount) ? `${amount.toLocaleString('he-IL')} ש"ח` : '',
    expense.document_number ? `מסמך ${expense.document_number}` : '',
  ].filter(Boolean).join(' · ');
}

/** שורת delivery קבועה פר הוצאה — שליחה חוזרת מעדכנת, לא מכפילה. */
export function deliveryRow(expense, { sentTo, emailId, ok, error, previous = null, now = new Date() } = {}) {
  return {
    id: previous?.id || `fad:${expense.id}`,
    expense_id: String(expense.id),
    month: String(expense.expense_date || '').slice(0, 7),
    status: ok ? 'sent' : 'failed',
    sent_at: ok ? now.toISOString() : previous?.sent_at || null,
    sent_to: sentTo || null,
    email_id: emailId || null,
    attempts: (previous?.attempts || 0) + 1,
    last_error: ok ? null : (error || 'שליחה נכשלה'),
  };
}

/** חלוקת הוצאות לחבילות מייל מתחת לתקרת הגודל. הוצאה בלי קובץ — נפסלת החוצה. */
export function bundleForEmail(expensesWithFiles, { maxBytes = MAX_EMAIL_BYTES } = {}) {
  const bundles = [];
  let current = { expenses: [], attachments: [], bytes: 0 };
  for (const entry of expensesWithFiles) {
    const entryBytes = entry.attachments.reduce((sum, file) => sum + file.bytes, 0);
    if (current.expenses.length && current.bytes + entryBytes > maxBytes) {
      bundles.push(current);
      current = { expenses: [], attachments: [], bytes: 0 };
    }
    current.expenses.push(entry.expense);
    current.attachments.push(...entry.attachments);
    current.bytes += entryBytes;
  }
  if (current.expenses.length) bundles.push(current);
  return bundles;
}

export function bundleEmailBody(month, expenses) {
  const total = expenses.reduce((sum, expense) => sum + (Number(expense.amount_gross) || 0), 0);
  return [
    `שלום,`,
    '',
    `מצורפות ${expenses.length} חשבוניות לחודש ${month}, בסכום כולל של ${total.toLocaleString('he-IL')} ש"ח:`,
    '',
    ...expenses.map((expense) => `• ${expenseSummaryLine(expense)}`),
    '',
    'נשלח אוטומטית ממערכת קיר בועז.',
  ].join('\n');
}
