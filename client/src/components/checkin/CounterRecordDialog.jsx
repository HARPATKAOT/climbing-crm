import React, { useEffect } from 'react';
import {
  BadgePercent, Ban, Banknote, CheckCircle2, Copy, ExternalLink,
  FileText, Hourglass, Printer, Send, ShieldAlert, ShoppingBag, Undo2, X,
} from 'lucide-react';
import { icountClientUrl } from '../../utils/icountLinks.js';

const money = (value) => `₪${Number(value || 0).toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;

const dateTime = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('he-IL');
};

const methodLabel = (method) => {
  if (method === 'cash') return 'מזומן';
  if (method === 'online') return 'קישור תשלום';
  if (['emv', 'credit', 'cc', 'card'].includes(method)) return 'אשראי במסוף';
  return method || 'לא ידוע';
};

const statusMeta = (status) => {
  if (status === 'paid') return { label: 'שולם', cls: 'badge badge-green', Icon: CheckCircle2 };
  if (status === 'pending_payment') return { label: 'ממתין לתשלום', cls: 'badge badge-amber', Icon: Hourglass };
  if (status === 'refunded') return { label: 'זוכה', cls: 'badge badge-red', Icon: Undo2 };
  if (status === 'cancelled') return { label: 'בוטל', cls: 'badge badge-gray', Icon: Ban };
  return { label: status || 'לא ידוע', cls: 'badge badge-gray', Icon: FileText };
};

const lineTotal = (line) => {
  const quantity = Number(line?.quantity) || 1;
  if (line?.unitprice != null && Number.isFinite(Number(line.unitprice))) {
    return Number(line.unitprice) * quantity;
  }
  if (line?.total != null && Number.isFinite(Number(line.total))) return Number(line.total);
  return null;
};

function SaleDetails({
  sale, busyId, onRefund, onCancel, onOpenDoc, onPrintDoc, onCopyPaymentLink,
  onResendPaymentLink,
}) {
  const status = statusMeta(sale.status);
  const StatusIcon = status.Icon;
  const items = Array.isArray(sale.line_items) ? sale.line_items : [];
  const canChargeDoc = !!sale.doc_number;
  const canRefundDoc = !!sale.refund_doc_number;
  const canRefund = sale.status === 'paid' && canChargeDoc;
  const canCancel = sale.status === 'pending_payment' && !sale.doc_number;
  const canUsePaymentLink = sale.status === 'pending_payment' && !!sale.payment_url;

  return (
    <section className="card" style={{ padding: 16, display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{sale.payer_name || sale.name || 'לקוח'}</div>
          {sale.name && sale.payer_name && sale.name !== sale.payer_name && (
            <div style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 2 }}>עבור: {sale.name}</div>
          )}
        </div>
        <span className={status.cls}><StatusIcon size={12} /> {status.label}</span>
        <strong style={{ fontSize: 18 }}>{money(sale.total)}</strong>
      </div>

      <div className="pos-sale-detail-meta">
        <div className="pos-sale-detail-field">
          <div className="pos-sale-detail-label">מועד העסקה</div>
          <div className="pos-sale-detail-value">{dateTime(sale.created_at || sale.at)}</div>
        </div>
        {sale.paid_at && (
          <div className="pos-sale-detail-field">
            <div className="pos-sale-detail-label">מועד התשלום</div>
            <div className="pos-sale-detail-value">{dateTime(sale.paid_at)}</div>
          </div>
        )}
        <div className="pos-sale-detail-field">
          <div className="pos-sale-detail-label">אופן תשלום</div>
          <div className="pos-sale-detail-value">{methodLabel(sale.method)}</div>
        </div>
        <div className="pos-sale-detail-field">
          <div className="pos-sale-detail-label">נמכר על ידי</div>
          <div className="pos-sale-detail-value">{sale.seller_name || '—'}</div>
        </div>
        <div className="pos-sale-detail-field">
          <div className="pos-sale-detail-label">מספר עסקה</div>
          <div className="pos-sale-detail-value" style={{ fontFamily: 'monospace' }}>{sale.sale_id}</div>
        </div>
        <div className="pos-sale-detail-field">
          <div className="pos-sale-detail-label">מספר חשבונית</div>
          <div className="pos-sale-detail-value">{sale.doc_number || 'טרם הופקה'}</div>
        </div>
        {sale.method === 'cash' && sale.tendered_amount != null && (
          <div className="pos-sale-detail-field">
            <div className="pos-sale-detail-label">מזומן שהתקבל / עודף</div>
            <div className="pos-sale-detail-value">
              {money(sale.tendered_amount)} / {money(sale.change_given)}
            </div>
          </div>
        )}
        {sale.refunded_at && (
          <div className="pos-sale-detail-field">
            <div className="pos-sale-detail-label">מועד הזיכוי</div>
            <div className="pos-sale-detail-value">{dateTime(sale.refunded_at)}</div>
          </div>
        )}
        {sale.cancelled_at && (
          <div className="pos-sale-detail-field">
            <div className="pos-sale-detail-label">מועד הביטול</div>
            <div className="pos-sale-detail-value">{dateTime(sale.cancelled_at)}</div>
          </div>
        )}
      </div>

      {sale.coupon_code && (
        <div className="badge badge-purple" style={{ justifySelf: 'start' }}>
          <BadgePercent size={12} /> הטבה {sale.coupon_code} · {money(sale.coupon_discount)}
        </div>
      )}

      <div className="pos-sale-detail-items">
        <div className="pos-sale-detail-section-title">פריטים שנרכשו</div>
        {items.length ? items.map((line, index) => {
          const quantity = Number(line.quantity) || 1;
          const total = lineTotal(line);
          return (
            <div key={`${sale.sale_id}-line-${index}`} className="pos-sale-detail-item">
              <span className="pos-sale-detail-item-name">
                {line.name || line.description || 'פריט'}{quantity > 1 ? ` × ${quantity}` : ''}
              </span>
              <span className="pos-sale-detail-item-price">{total == null ? '—' : money(total)}</span>
            </div>
          );
        }) : (
          <div style={{ color: 'var(--text-3)', fontSize: 13 }}>לא נשמר פירוט פריטים לעסקה הזאת.</div>
        )}
      </div>

      <div className="pos-sale-detail-actions">
        {canUsePaymentLink && (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onCopyPaymentLink(sale)}>
              <Copy size={13} /> העתקת קישור
            </button>
            <a className="btn btn-ghost btn-sm" href={sale.payment_url} target="_blank" rel="noreferrer">
              <ExternalLink size={13} /> פתיחת קישור
            </a>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busyId === `resend:${sale.sale_id}`}
              onClick={() => onResendPaymentLink(sale)}
            >
              <Send size={13} /> {busyId === `resend:${sale.sale_id}` ? 'שולח...' : 'שליחה חוזרת'}
            </button>
          </>
        )}
        {sale.icount_client_id && (
          <a
            className="btn btn-ghost btn-sm"
            href={icountClientUrl(sale.icount_client_id)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={13} /> תיק ב־iCount
          </a>
        )}
        {canChargeDoc && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpenDoc(sale, 'charge')}>
            <FileText size={13} /> צפייה בחשבונית
          </button>
        )}
        {canChargeDoc && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onPrintDoc(sale, 'charge')}>
            <Printer size={13} /> הדפסה חוזרת
          </button>
        )}
        {canRefundDoc && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpenDoc(sale, 'refund')}>
            <FileText size={13} /> מסמך זיכוי
          </button>
        )}
        {canRefund && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ marginInlineStart: 'auto', color: 'var(--amber)' }}
            disabled={busyId === `refund:${sale.sale_id}`}
            onClick={() => onRefund(sale)}
          >
            <Undo2 size={13} /> {busyId === `refund:${sale.sale_id}` ? 'מזכה...' : 'החזר מלא'}
          </button>
        )}
        {canCancel && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ marginInlineStart: 'auto', color: 'var(--red)' }}
            disabled={busyId === `cancel:${sale.sale_id}`}
            onClick={() => onCancel(sale)}
          >
            <Ban size={13} /> {busyId === `cancel:${sale.sale_id}` ? 'מבטל...' : 'ביטול קישור שלא שולם'}
          </button>
        )}
      </div>
    </section>
  );
}

export default function CounterRecordDialog({
  record,
  relatedSales = [],
  busyId = '',
  error = '',
  onClose,
  onRefund,
  onCancel,
  onOpenDoc,
  onPrintDoc,
  onCopyPaymentLink,
  onResendPaymentLink,
}) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  if (!record) return null;
  const isPendingPayment = record.kind === 'payment_link' && !record.paid;
  const isSafety = !!record.needs_safety;
  const isActive = record.source_tab === 'active';

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="counter-record-title"
        style={{ maxWidth: 820 }}
      >
        <div className="modal-header">
          <div>
            <div id="counter-record-title" className="modal-title">פרטי רשומה · {record.name}</div>
            <div style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 3 }}>
              {dateTime(record.at)}
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="סגירת פרטי הרשומה" onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'grid', gap: 16 }}>
          {(isPendingPayment || isSafety || isActive) && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {isPendingPayment && (
                <span className="badge badge-amber"><Hourglass size={12} /> ממתין לתשלום</span>
              )}
              {isSafety && (
                <span className={record.state === 'missing' ? 'badge badge-red' : 'badge badge-amber'}>
                  <ShieldAlert size={12} />
                  {record.state === 'missing' ? 'ממתין לתדריך ומבחן אבטחה' : `מבחן אבטחה פג ${record.expires_at || ''}`}
                </span>
              )}
              {isActive && (
                <span className="badge badge-green"><CheckCircle2 size={12} /> נמצא על הקיר</span>
              )}
            </div>
          )}

          {error && <div className="alert alert-error" style={{ margin: 0 }}>{error}</div>}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800 }}>
            <ShoppingBag size={17} /> עסקאות קשורות במשמרת ({relatedSales.length})
          </div>

          {relatedSales.length ? relatedSales.map((sale) => (
            <SaleDetails
              key={sale.sale_id}
              sale={sale}
              busyId={busyId}
              onRefund={onRefund}
              onCancel={onCancel}
              onOpenDoc={onOpenDoc}
              onPrintDoc={onPrintDoc}
              onCopyPaymentLink={onCopyPaymentLink}
              onResendPaymentLink={onResendPaymentLink}
            />
          )) : (
            <div className="card" style={{ padding: 16, color: 'var(--text-3)', fontSize: 13 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text-2)', fontWeight: 700 }}>
                <Banknote size={15} /> אין רכישה שנוצרה במשמרת הזאת
              </div>
              <div style={{ marginTop: 6 }}>
                ייתכן שהכניסה בוצעה באמצעות מנוי או כרטיסייה קיימים. אם נרכשה עסקה ללא שיוך למתאמן,
                היא עדיין מופיעה בלשונית “מכירות במשמרת”.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
