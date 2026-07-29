/**
 * Shared logic for the payment actions in the customer file:
 * refund, invoice download, invoice send.
 *
 * A payment row can belong to a counter sale, an event registration,
 * an event host payment, or stand on its own (invoice or payment link
 * created straight from the customer file). The refund side effects are
 * different for each case, so we resolve the owner first and let the
 * route reuse the helper that already knows that flow.
 */

const CARD_METHODS = ['emv', 'credit', 'cc', 'online', 'card'];

export function paymentOwner(db, payment) {
  if (!payment) return { kind: 'none' };

  if (payment.activity_registration_id) {
    const registration = db.getOne('activity_registrations', payment.activity_registration_id);
    const activity = registration
      ? db.getOne('activities', registration.activity_id)
      : null;
    if (registration && activity) {
      return { kind: 'registration', registration, activity };
    }
  }

  if (payment.activity_host_payment && payment.activity_id) {
    const activity = db.getOne('activities', payment.activity_id);
    if (activity) return { kind: 'host', activity };
  }

  if (payment.pos_sale_id) {
    const sale = db.getOne('pos_sales', payment.pos_sale_id);
    if (sale) return { kind: 'pos', sale };
  }

  return { kind: 'generic' };
}

/**
 * Document numbers / links for both sides of the payment.
 * Older counter sales kept the document only on the sale row, so we fall
 * back to it before giving up.
 */
export function paymentDocRefs(db, payment) {
  const owner = paymentOwner(db, payment);
  const sale = owner.kind === 'pos' ? owner.sale : null;

  return {
    charge: {
      url: payment?.icount_doc_url || sale?.icount_doc_url || null,
      docId: payment?.icount_doc_id || sale?.icount_doc_id || null,
      docnum: payment?.icount_doc_number || sale?.icount_doc_number || null,
      doctype: payment?.icount_doctype || sale?.icount_doctype || 'invrec',
    },
    refund: {
      url: payment?.refund_doc_url || sale?.refund_doc_url || null,
      docId: null,
      docnum: payment?.refund_doc_number || sale?.refund_doc_number || null,
      doctype:
        payment?.refund_doctype ||
        sale?.refund_doctype ||
        payment?.icount_doctype ||
        sale?.icount_doctype ||
        'invrec',
    },
  };
}

export function paymentHasCardCharge(db, payment) {
  const owner = paymentOwner(db, payment);
  const method =
    payment?.payment_method ||
    (owner.kind === 'pos' ? owner.sale?.payment_method : null) ||
    '';
  if (CARD_METHODS.includes(String(method).toLowerCase())) return true;
  // Payment links are always cleared on the card terminal.
  return !!(payment?.payment_url || payment?.cc_confirmation_code || payment?.cc_last4);
}

export function checkPaymentRefundable(db, payment) {
  if (!payment) return { ok: false, error: 'התשלום לא נמצא' };
  if (payment.status === 'refunded' || payment.status === 'cancelled') {
    return { ok: false, error: 'התשלום כבר זוכה או בוטל' };
  }
  if (payment.status === 'pending') {
    return {
      ok: false,
      error: 'אי אפשר לזכות תשלום שעדיין לא שולם — אפשר למחוק את דרישת התשלום במקום',
      code: 'not_paid',
    };
  }
  if (payment.status !== 'paid') {
    return { ok: false, error: 'אפשר לזכות רק תשלום שסומן כשולם' };
  }
  const refs = paymentDocRefs(db, payment);
  if (!refs.charge.docnum) {
    return {
      ok: false,
      error: 'לתשלום אין מספר מסמך במערכת החיוב — אי אפשר לזכות אוטומטית',
      code: 'missing_doc',
    };
  }
  return { ok: true, refs };
}

/**
 * Mark a standalone payment as refunded. Counter sales, registrations and
 * host payments have their own mark helpers with extra side effects.
 */
export async function applyGenericRefundMarks({
  db,
  persist,
  payment,
  reason,
  cancellation,
  refundedBy,
} = {}) {
  const now = new Date().toISOString();
  const originalDoc = payment.icount_doc_number || null;
  const refundDoc =
    cancellation?.docnum && String(cancellation.docnum) !== String(originalDoc || '')
      ? cancellation.docnum
      : null;

  const updated = db.update('payments', payment.id, {
    status: 'refunded',
    refunded_at: now,
    refund_reason: reason || 'זיכוי תשלום',
    refund_doc_number: refundDoc,
    refund_doctype: refundDoc ? cancellation?.doctype || null : null,
    refund_doc_url: cancellation?.docUrl || payment.refund_doc_url || null,
    refunded_by: refundedBy || null,
    updated_at: now,
  });
  if (updated && persist) await persist('payments', updated);
  return { payment: updated };
}

export function buildInvoiceWhatsAppText({
  businessName,
  parentName,
  description,
  amount,
  docNumber,
  url,
  kind = 'charge',
}) {
  const title = kind === 'refund' ? 'מסמך זיכוי' : 'חשבונית';
  const lines = [];
  lines.push(`שלום ${String(parentName || '').trim() || 'רב'},`);
  lines.push(
    `מצורף ${title}${docNumber ? ` מס׳ ${docNumber}` : ''}${description ? ` עבור ${description}` : ''}.`
  );
  if (amount != null && amount !== '') {
    lines.push(`סכום: ₪${Number(amount).toLocaleString('he-IL')}`);
  }
  lines.push(url);
  const signature = String(businessName || '').trim();
  if (signature) lines.push(signature);
  return lines.filter(Boolean).join('\n');
}
