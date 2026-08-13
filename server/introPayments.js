import { db, persistCore } from './db.js';
import { icount } from './icount.js';

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Open one idempotent payment request for one trainee, group and session.
 * The booking is created first, so every payment carries the durable business
 * identity that the webhook needs to finish the reservation.
 */
export async function createIntroPaymentRequest({ booking, product, student, parent, group } = {}) {
  if (!booking?.id || !student?.id || !group?.id) {
    throw Object.assign(new Error('חסרים פרטי אימון ההיכרות'), { code: 'intro_context_missing' });
  }
  if (!icount.isConfigured()) {
    throw Object.assign(new Error('שירות התשלום אינו מוגדר'), { code: 'payment_service_unavailable' });
  }
  const amount = number(product?.price ?? booking.price);
  if (!(amount > 0)) {
    throw Object.assign(new Error('מחיר אימון ההיכרות אינו תקין'), { code: 'intro_price_invalid' });
  }

  const paymentId = `pay_intro_${booking.id}`;
  const saleId = `sale_intro_${booking.id}`;
  const existingPayment = db.getOne('payments', paymentId);
  const existingSale = db.getOne('pos_sales', saleId);
  if (existingPayment?.payment_url && existingSale) {
    return {
      payment: existingPayment,
      sale: existingSale,
      paymentId,
      saleId,
      paymentUrl: existingPayment.payment_url,
      shareUrl: icount.buildPaymentRedirectUrl(paymentId),
      duplicate: true,
    };
  }

  let clientId = parent?.icount_client_id || null;
  if (parent?.id) {
    try {
      const ensured = await icount.ensureClient(parent);
      clientId = ensured.clientId;
      if (String(parent.icount_client_id || '') !== String(clientId || '')) {
        const updatedParent = db.update('parents', parent.id, { icount_client_id: clientId });
        if (updatedParent) await persistCore('parents', updatedParent);
      }
    } catch (error) {
      // The payment page can still be created without a linked iCount client;
      // the payment id remains the canonical webhook correlation.
      console.warn('Intro payment client sync skipped:', error.message);
    }
  }

  const description = `אימון היכרות — ${student.name || 'מתאמן/ת'} — ${group.name || 'קבוצה'} — ${booking.session_date}`;
  const stamp = new Date().toISOString();
  const paymentRecord = {
    id: paymentId,
    parent_id: parent?.id || student.parentId || null,
    student_id: student.id,
    amount,
    description,
    status: 'pending',
    payment_url: null,
    price_includes_vat: true,
    icount_client_id: clientId,
    icount_doc_id: null,
    icount_doc_number: null,
    icount_doctype: null,
    intro_booking_id: booking.id,
    group_id: group.id,
    session_date: booking.session_date,
    expires_at: booking.payment_expires_at,
    paid_at: null,
    created_at: stamp,
    updated_at: stamp,
  };
  const payment = existingPayment
    ? db.update('payments', paymentId, paymentRecord)
    : db.insert('payments', paymentRecord);
  await persistCore('payments', payment);

  const saleRecord = {
    id: saleId,
    items: [{
      pricelist_id: product.id || null,
      name: product.name || 'אימון היכרות',
      description: product.name || 'אימון היכרות',
      unitprice: amount,
      quantity: 1,
      product_type: product.product_type || 'product',
      is_intro_training: true,
    }],
    total: amount,
    payment_method: 'online',
    status: 'pending_payment',
    price_includes_vat: true,
    student_id: student.id,
    parent_id: parent?.id || student.parentId || null,
    customer_name: parent?.name || student.name || 'לקוח',
    customer_phone: parent?.phone || '',
    customer_email: parent?.email || '',
    icount_client_id: clientId,
    payment_id: paymentId,
    intro_booking_id: booking.id,
    group_id: group.id,
    session_date: booking.session_date,
    source: 'intro_booking',
    created_at: stamp,
    updated_at: stamp,
  };
  const sale = existingSale
    ? db.update('pos_sales', saleId, saleRecord)
    : db.insert('pos_sales', saleRecord);
  await persistCore('pos_sales', sale);
  const linkedPayment = db.update('payments', paymentId, { pos_sale_id: saleId, updated_at: stamp }) || payment;

  const paymentUrl = await icount.buildPaymentUrl({
    amount,
    description,
    name: parent?.name || student.name || 'לקוח',
    lastName: parent?.lastName,
    idNumber: parent?.idNumber,
    phone: parent?.phone || '',
    email: parent?.email || '',
    paymentId,
    ipnUrl: icount.buildIpnUrl({ paymentId }),
  });
  const finalPayment = db.update('payments', paymentId, { payment_url: paymentUrl, updated_at: new Date().toISOString() });
  const finalSale = db.update('pos_sales', saleId, { payment_url: paymentUrl, updated_at: new Date().toISOString() });
  await persistCore('payments', finalPayment || linkedPayment);
  await persistCore('pos_sales', finalSale || sale);

  return {
    payment: finalPayment || linkedPayment,
    sale: finalSale || sale,
    paymentId,
    saleId,
    paymentUrl,
    shareUrl: icount.isLocalPublicApiBase() ? paymentUrl : icount.buildPaymentRedirectUrl(paymentId),
    duplicate: false,
  };
}
