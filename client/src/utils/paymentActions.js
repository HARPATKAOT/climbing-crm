const money = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

async function responseBody(response) {
  return response.json().catch(() => ({}));
}

async function postPaymentAction(row, endpoint, payload = {}) {
  const paymentId = row?.payment_id || row?.id;
  if (!paymentId) throw new Error('התשלום אינו מקושר לרשומת תשלום במערכת');
  const response = await fetch(`/api/payments/${encodeURIComponent(paymentId)}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await responseBody(response);
  if (!response.ok) throw new Error(body.error || 'הפעולה נכשלה');
  return body;
}

export async function downloadPaymentDocument(row, kind = 'charge') {
  const paymentId = row?.payment_id || row?.id;
  const direct = kind === 'refund'
    ? (row?.refund_document_url || row?.refund_doc_url)
    : (row?.document_url || row?.icount_doc_url);
  const url = paymentId
    ? `/api/payments/${encodeURIComponent(paymentId)}/invoice?kind=${encodeURIComponent(kind)}`
    : direct;
  if (!url) throw new Error('לא נמצא קישור למסמך');

  if (!paymentId) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }

  const response = await fetch(url);
  if (!response.ok) {
    const body = await responseBody(response);
    throw new Error(body.error || 'הורדת המסמך נכשלה');
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = kind === 'refund' ? 'refund.pdf' : 'invoice.pdf';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export function printPaymentDocument(row, kind = 'charge') {
  const paymentId = row?.payment_id || row?.id;
  const direct = kind === 'refund'
    ? (row?.refund_document_url || row?.refund_doc_url)
    : (row?.document_url || row?.icount_doc_url);
  const url = direct || (paymentId
    ? `/api/payments/${encodeURIComponent(paymentId)}/invoice?kind=${encodeURIComponent(kind)}`
    : '');
  if (!url) throw new Error('לא נמצא מסמך להדפסה');

  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.inset = '0';
  frame.style.width = '1px';
  frame.style.height = '1px';
  frame.style.opacity = '0';
  frame.src = url;
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    window.setTimeout(() => frame.remove(), 60_000);
  };
  document.body.appendChild(frame);
}

export async function sendPaymentDocument(row, kind = 'charge') {
  return postPaymentAction(row, 'send-invoice', { kind });
}

async function previewPaymentRefund(row, endpoint) {
  return postPaymentAction(row, endpoint);
}

/**
 * Runs the same policy-aware refund flow from every payment surface.
 * Partial refunds are deliberately owner-only on the server and always require
 * a reason; full equipment/pass refunds first show the policy calculation.
 */
export async function refundPayment(row, { partial = false } = {}) {
  const amountPaid = Number(row?.amount) || 0;

  if (partial) {
    let recommended = null;
    try {
      if (row?.equipment_policy_refund || row?.equipment_checkout_token) {
        const preview = await previewPaymentRefund(row, 'equipment-refund-preview');
        recommended = Number(preview.recommendation?.amount);
      } else if (row?.has_passes) {
        const preview = await previewPaymentRefund(row, 'pass-refund-preview');
        recommended = Number(preview.total);
      }
      if (!Number.isFinite(recommended)) recommended = null;
    } catch {
      recommended = null;
    }

    const entered = window.prompt(
      `סכום לזיכוי (מתוך ${money.format(amountPaid)})`
        + (recommended != null ? `\nהמלצת המדיניות: ${money.format(recommended)}` : ''),
      recommended != null ? String(recommended) : '',
    );
    if (entered == null) return false;
    const amount = Number(String(entered).replace(/[^\d.]/g, ''));
    if (!(amount > 0) || amount > amountPaid) throw new Error('סכום הזיכוי אינו תקין');
    const reason = window.prompt('סיבת הזיכוי (חובה):', '') ?? '';
    if (!reason.trim()) throw new Error('זיכוי חלקי מחייב סיבה');
    const policyNote = recommended != null && Math.abs(amount - recommended) >= 0.005
      ? `\nזו חריגה מהמלצת המדיניות (${money.format(recommended)}) והיא תתועד.`
      : '';
    if (!window.confirm(`להחזיר ${money.format(amount)}?${policyNote}\nהפעולה תתבצע בפועל ותפיק מסמך זיכוי.`)) {
      return false;
    }
    await postPaymentAction(row, 'manual-refund', {
      amount,
      reason: reason.trim(),
      recommended_amount: recommended,
    });
    return true;
  }

  if (row?.equipment_policy_refund || row?.equipment_checkout_token) {
    const preview = await previewPaymentRefund(row, 'equipment-refund-preview');
    const recommendation = preview.recommendation || {};
    if (!recommendation.period_resolved) {
      throw new Error('לא ניתן לקבוע כמה מתקופת ההשכרה נוצלה — יש לבחור זיכוי חלקי ולהזין סכום ידני');
    }
    const amount = Number(recommendation.amount) || 0;
    if (!(amount > 0)) throw new Error('לפי מדיניות ההשכרה אין יתרה לזיכוי');
    const feeLine = Number(recommendation.fixed_fee) > 0
      ? `\nדמי ביטול: ${money.format(recommendation.fixed_fee)}`
      : '';
    if (!window.confirm(
      `זיכוי השכרת ציוד לפי ${preview.policy?.name || 'המדיניות'}:`
        + `\nשולם: ${money.format(preview.paid_amount)}`
        + `\nנותרו ${recommendation.remaining_units} מתוך ${recommendation.total_units} יחידות`
        + feeLine
        + `\n\nלהחזיר ${money.format(amount)}?`,
    )) return false;
    const reason = window.prompt('סיבת הזיכוי (לא חובה):', '') ?? '';
    await postPaymentAction(row, 'equipment-refund', {
      approved_amount: amount,
      reason: reason.trim(),
    });
    return true;
  }

  if (row?.has_passes) {
    const preview = await previewPaymentRefund(row, 'pass-refund-preview');
    if (!preview.resolved) {
      throw new Error('לא ניתן לקבוע כמה מהכרטיס נוצל — יש לבחור זיכוי חלקי ולהזין סכום ידני');
    }
    const amount = Number(preview.total) || 0;
    if (!(amount > 0)) throw new Error('לפי מדיניות הכרטיס אין יתרה לזיכוי');
    const lines = (preview.items || []).map((item) => {
      const unit = item.unit === 'days' ? 'ימים' : 'כניסות';
      return `${item.pass_name}: נוצלו ${item.used_units} מתוך ${item.total_units} ${unit} · מוחזר ${money.format(item.amount)}`;
    });
    if (!window.confirm(
      `זיכוי לפי ${preview.policy?.name || 'מדיניות הכרטיס'}:`
        + `\n\n${lines.join('\n')}`
        + `\n\nסה״כ להחזר: ${money.format(amount)}`
        + '\nהכרטיסים יבוטלו רק לאחר שהכסף יוחזר.',
    )) return false;
    const reason = window.prompt('סיבת הזיכוי (לא חובה):', '') ?? '';
    await postPaymentAction(row, 'pass-refund', {
      approved_amount: amount,
      reason: reason.trim(),
    });
    return true;
  }

  const reason = window.prompt('סיבת הזיכוי (לא חובה):', '') ?? '';
  if (!window.confirm(`לבטל את העסקה ולזכות את מלוא התשלום בסך ${money.format(amountPaid)}?`)) {
    return false;
  }
  await postPaymentAction(row, 'refund', { reason: reason.trim() });
  return true;
}
