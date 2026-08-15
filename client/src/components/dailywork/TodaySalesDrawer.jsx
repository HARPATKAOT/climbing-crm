import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ban,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  FileText,
  Link2,
  RefreshCw,
  Send,
  Undo2,
} from 'lucide-react';
import { Modal } from '../UI.jsx';
import WorkDrawer from './WorkDrawer.jsx';

const METHOD_LABEL = {
  cash: 'מזומן',
  online: 'סליקה',
  other: 'אחר',
};

const EXCLUDED_LABEL = {
  refunded: 'זוכתה',
  cancelled: 'בוטלה',
  pending: 'ממתינה לתשלום',
};

function timeLabel(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const time = parsed.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });
  const dayOf = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  // חיוב פתוח ישן מציג גם תאריך — אחרת הוא נראה כאילו נוצר היום.
  if (dayOf(parsed) !== dayOf(new Date())) {
    return `${parsed.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', timeZone: 'Asia/Jerusalem' })} · ${time}`;
  }
  return time;
}

function shekel(value) {
  return `₪${Number(value || 0).toLocaleString('he-IL')}`;
}

/**
 * דיאלוג זיכוי: מלא (ביטול המסמך כולו) או חלקי בסכום (לעסקת אשראי עם שורת
 * תשלום, לבעלים בלבד). סיבה חובה — היא נשמרת על העסקה וביומן הפעולות.
 */
function RefundDialog({ row, allowPartial, onClose, onDone }) {
  const [mode, setMode] = useState('full');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setError('חובה לציין סיבה לזיכוי');
      return;
    }
    if (mode === 'partial') {
      const value = Number(amount);
      if (!Number.isFinite(value) || value <= 0 || value > Number(row.amount)) {
        setError('סכום הזיכוי חייב להיות גדול מאפס ולא יותר מסכום העסקה');
        return;
      }
    }
    setBusy(true);
    setError('');
    try {
      const url = mode === 'partial'
        ? `/api/payments/${encodeURIComponent(row.payment_id)}/manual-refund`
        : `/api/pos/sales/${encodeURIComponent(row.sale_id)}/refund`;
      const body = mode === 'partial'
        ? { amount: Number(amount), reason: trimmedReason }
        : { reason: trimmedReason };
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'הזיכוי נכשל');
      onDone(mode === 'partial'
        ? `בוצע זיכוי חלקי של ${shekel(amount)} ללקוח`
        : `העסקה זוכתה במלואה${result.cancellation?.docnum ? ` · מסמך ביטול ${result.cancellation.docnum}` : ''}`);
    } catch (err) {
      setError(err.message || 'הזיכוי נכשל');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`זיכוי — ${row.customer_name || 'לקוח מזדמן'} · ${shekel(row.amount)}`}
      onClose={busy ? () => {} : onClose}
      footer={(
        <>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onClose}>ביטול</button>
          <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={submit}>
            {busy ? 'מזכה…' : (mode === 'partial' ? 'בצע זיכוי חלקי' : 'בצע זיכוי מלא')}
          </button>
        </>
      )}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {allowPartial && (
          <div style={{ display: 'flex', gap: 14, fontSize: 13 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="radio" className="dw-check" checked={mode === 'full'} onChange={() => setMode('full')} />
              זיכוי מלא
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="radio" className="dw-check" checked={mode === 'partial'} onChange={() => setMode('partial')} />
              זיכוי חלקי
            </label>
          </div>
        )}
        {mode === 'partial' && (
          <input
            type="number"
            className="input input-sm"
            placeholder={`סכום לזיכוי (עד ${shekel(row.amount)})`}
            value={amount}
            min="1"
            max={row.amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        )}
        <textarea
          className="textarea"
          rows={2}
          placeholder="סיבת הזיכוי (חובה) — נשמרת על העסקה וביומן הפעולות"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
          {mode === 'partial'
            ? 'הכסף יוחזר לכרטיס האשראי ותופק חשבונית זיכוי על הסכום שנבחר.'
            : 'יווצר מסמך ביטול במערכת החיוב. אם העסקה שולמה באשראי — הכסף יוחזר לכרטיס. כרטיסיות או מנויים מהעסקה יבוטלו.'}
        </div>
        {error && <div className="alert alert-error" style={{ padding: 10, fontSize: 12 }}>{error}</div>}
      </div>
    </Modal>
  );
}

function CancelDialog({ row, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/pos/sales/${encodeURIComponent(row.sale_id)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || 'ביטול ממסך העבודה' }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'הביטול נכשל');
      onDone('העסקה בוטלה — קישור התשלום נסגר');
    } catch (err) {
      setError(err.message || 'הביטול נכשל');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`ביטול עסקה — ${row.customer_name || 'לקוח מזדמן'} · ${shekel(row.amount)}`}
      onClose={busy ? () => {} : onClose}
      footer={(
        <>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onClose}>חזרה</button>
          <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={submit}>
            {busy ? 'מבטל…' : 'בטל את העסקה'}
          </button>
        </>
      )}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
          העסקה לא שולמה ולא יצאה עליה חשבונית, ולכן אין זיכוי ואין מסמך ביטול.
          קישור התשלום יפסיק לעבוד והעסקה תישאר בהיסטוריה כמבוטלת.
        </div>
        <textarea
          className="textarea"
          rows={2}
          placeholder="סיבת הביטול (רשות)"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        {error && <div className="alert alert-error" style={{ padding: 10, fontSize: 12 }}>{error}</div>}
      </div>
    </Modal>
  );
}

/**
 * העסקאות שמאחורי „הכנסות היום”: כל שורה עם צפייה בקבלה, שליחה ללקוח, זיכוי
 * (מלא/חלקי עם סיבה) וביטול. אחרי פעולה כספית הסכום למעלה מתרענן מיד.
 */
export default function TodaySalesDrawer({ initialFilter = 'all', isOwner = false, onClose, onMoneyChanged, onOpenCustomer }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState(initialFilter);
  const [busyKey, setBusyKey] = useState('');
  const [notice, setNotice] = useState(null);
  const [refundRow, setRefundRow] = useState(null);
  const [cancelRow, setCancelRow] = useState(null);
  const [expandedId, setExpandedId] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await fetch('/api/dashboard/today-sales');
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'טעינת העסקאות נכשלה');
      setData(body);
    } catch (err) {
      setError(err.message || 'טעינת העסקאות נכשלה');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const list = Array.isArray(data?.rows) ? data.rows : [];
    if (filter === 'all') return list;
    if (filter === 'pending') return list.filter((row) => row.excluded_reason === 'pending');
    return list.filter((row) => row.bucket === filter);
  }, [data, filter]);

  const afterMoneyAction = (message) => {
    setRefundRow(null);
    setCancelRow(null);
    setNotice({ type: 'success', text: message });
    setLoading(true);
    load();
    onMoneyChanged?.();
  };

  const copyPaymentLink = async (row) => {
    try {
      await navigator.clipboard.writeText(row.payment_url);
      setNotice({ type: 'success', text: `קישור התשלום של ${row.customer_name || 'הלקוח'} הועתק — אפשר להדביק בוואטסאפ` });
    } catch {
      setNotice({ type: 'error', text: 'ההעתקה נכשלה — אפשר לפתוח את הקישור בלשונית ולהעתיק משם' });
    }
  };

  const openDocument = (row, kind) => {
    const url = row.sale_id
      ? `/api/pos/sales/${encodeURIComponent(row.sale_id)}/invoice?kind=${kind}`
      : `/api/payments/${encodeURIComponent(row.payment_id)}/invoice?kind=${kind}`;
    const win = window.open(url, '_blank', 'noopener');
    if (!win) setNotice({ type: 'error', text: 'הדפדפן חסם את החלון — אשרו חלונות קופצים ונסו שוב' });
  };

  const sendDocument = async (row) => {
    const key = `send:${row.id}`;
    setBusyKey(key);
    setNotice(null);
    try {
      const url = row.sale_id
        ? `/api/pos/sales/${encodeURIComponent(row.sale_id)}/send-invoice`
        : `/api/payments/${encodeURIComponent(row.payment_id)}/send-invoice`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'השליחה נכשלה');
      setNotice({ type: 'success', text: `הקבלה נשלחה בוואטסאפ ל${row.customer_name || 'לקוח'}` });
    } catch (err) {
      setNotice({ type: 'error', text: err.message || 'השליחה נכשלה' });
    } finally {
      setBusyKey('');
    }
  };

  const methodChip = (key, label, amount) => (
    <button
      key={key}
      type="button"
      className={`dw-chip ${filter === key ? 'active' : ''}`}
      onClick={() => setFilter(filter === key ? 'all' : key)}
    >
      {label}
      {amount != null && ` · ${shekel(amount)}`}
    </button>
  );

  return (
    <WorkDrawer
      title="עסקאות היום"
      sub={data ? `${data.count} עסקאות · ${shekel(data.total)}${data.yesterdayTotal ? ` · אתמול ${shekel(data.yesterdayTotal)}` : ''}` : 'טוען…'}
      icon={CircleDollarSign}
      tone="#34D399"
      onClose={onClose}
    >
      <div className="dw-drawer-filters">
        {methodChip('all', 'הכול', data?.total)}
        {methodChip('cash', 'מזומן', data?.cash)}
        {methodChip('online', 'סליקה', data?.online)}
        {Number(data?.other || 0) > 0 && methodChip('other', 'אחר', data?.other)}
        {Number(data?.openCharges?.count || 0) > 0 && (
          <button
            type="button"
            className={`dw-chip ${filter === 'pending' ? 'active' : ''}`}
            style={filter === 'pending' ? undefined : { color: '#FCD34D' }}
            onClick={() => setFilter(filter === 'pending' ? 'all' : 'pending')}
          >
            חיובים פתוחים · {data.openCharges.count} · {shekel(data.openCharges.total)}
          </button>
        )}
        <button type="button" className="dw-chip" onClick={() => { setLoading(true); load(); }} aria-label="רענון הרשימה">
          <RefreshCw size={11} className={loading ? 'spin' : undefined} /> רענון
        </button>
      </div>

      {notice && (
        <div className={`alert alert-${notice.type}`} style={{ margin: '12px 18px', padding: 10, fontSize: 12 }}>
          {notice.text}
        </div>
      )}

      <div className="dw-drawer-body">
        {loading && (
          <>
            <div className="dw-skeleton-row" />
            <div className="dw-skeleton-row" />
            <div className="dw-skeleton-row" />
          </>
        )}
        {!loading && error && (
          <div className="dw-error-box">
            <span>{error}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setLoading(true); load(); }}>נסה שוב</button>
          </div>
        )}
        {!loading && !error && rows.length === 0 && (
          <div className="daily-work-empty">עוד לא נרשמו עסקאות היום{filter !== 'all' ? ' באמצעי התשלום הזה' : ''}</div>
        )}
        {!loading && !error && rows.map((row) => {
          const excluded = !row.counted;
          const isOpenCharge = row.excluded_reason === 'pending';
          const canRefund = row.sale_id && !excluded;
          const allowPartial = Boolean(isOwner && row.payment_id && row.bucket === 'online');
          const hasCustomer = Boolean(row.parent_id || row.student_id);
          const items = Array.isArray(row.items) ? row.items : [];
          const expanded = expandedId === row.id;
          // חיוב פתוח אינו נספר בסכום היום, אבל קו חוצה אומר „בוטל” — לכן ענבר.
          const amountClass = excluded && !isOpenCharge ? 'excluded' : '';
          const amountStyle = isOpenCharge ? { color: '#FCD34D' } : (excluded ? undefined : { color: '#6EE7B7' });
          return (
            <div key={row.id} className="dw-sale-row">
              <div className="dw-sale-main">
                {hasCustomer ? (
                  <strong
                    role="button"
                    tabIndex={0}
                    title="פתיחת תיק הלקוח"
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={(event) => { event.currentTarget.style.color = 'var(--blue)'; }}
                    onMouseLeave={(event) => { event.currentTarget.style.color = ''; }}
                    onClick={() => onOpenCustomer?.(row)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onOpenCustomer?.(row);
                      }
                    }}
                  >
                    {row.customer_name || 'לקוח'}
                  </strong>
                ) : (
                  <strong>{row.customer_name || 'לקוח מזדמן'}</strong>
                )}
                <span className={`dw-sale-amount ${amountClass}`} style={amountStyle}>
                  {shekel(row.amount)}
                </span>
              </div>
              <div className="dw-sale-meta">
                <span>{timeLabel(row.at)}</span>
                <span>·</span>
                <span>{row.description}</span>
                <span className="badge badge-gray" style={{ fontSize: 10 }}>{METHOD_LABEL[row.bucket] || row.payment_method || '—'}</span>
                {excluded && (
                  <span className={`badge ${isOpenCharge ? 'badge-amber' : 'badge-red'}`} style={{ fontSize: 10 }}>
                    {EXCLUDED_LABEL[row.excluded_reason] || row.excluded_reason}
                  </span>
                )}
                {/* מה העסקה הזו בפועל: חשבונית שיצאה, קישור תשלום שמחכה, או רישום ידני בלי שניהם. */}
                {isOpenCharge && (
                  <span className="badge badge-gray" style={{ fontSize: 10 }}>
                    {row.has_charge_doc
                      ? `יצאה חשבונית${row.icount_doc_number ? ` ${row.icount_doc_number}` : ''}`
                      : row.payment_url
                        ? 'קישור תשלום פעיל — מחכה שהלקוח ישלם'
                        : 'רישום ידני — אין חשבונית ואין קישור תשלום'}
                  </span>
                )}
              </div>
              {expanded && items.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '2px 10px 4px', borderInlineStart: '2px solid var(--border)', fontSize: 12, color: 'var(--text-2)' }}>
                  {items.map((item, index) => {
                    const name = /^[�\s?]+$/.test(item.name || '') ? 'פריט ללא שם (נשמר משובש)' : item.name;
                    return (
                      <div key={index} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {name}
                          {item.quantity > 1 && ` ×${item.quantity} (${shekel(item.unit_price)} ליח׳)`}
                        </span>
                        <span style={{ flexShrink: 0, fontWeight: 600 }}>{shekel(item.line_total)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="dw-sale-actions">
                {items.length > 0 && (
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => setExpandedId(expanded ? '' : row.id)}>
                    {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {expanded ? 'סגור פירוט' : 'פירוט מוצרים'}
                  </button>
                )}
                {row.payment_url && (
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => copyPaymentLink(row)}>
                    <Link2 size={12} /> העתק קישור תשלום
                  </button>
                )}
                {row.has_charge_doc && (
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => openDocument(row, 'charge')}>
                    <FileText size={12} /> קבלה
                  </button>
                )}
                {row.has_refund_doc && (
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => openDocument(row, 'refund')}>
                    <FileText size={12} /> מסמך זיכוי
                  </button>
                )}
                {row.has_charge_doc && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    disabled={busyKey === `send:${row.id}` || !row.phone}
                    title={row.phone ? 'שליחת הקבלה ללקוח בוואטסאפ' : 'לעסקה אין מספר טלפון'}
                    onClick={() => sendDocument(row)}
                  >
                    <Send size={12} /> {busyKey === `send:${row.id}` ? 'שולח…' : 'שלח ללקוח'}
                  </button>
                )}
                {canRefund && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    style={{ color: '#FCA5A5' }}
                    onClick={() => setRefundRow({ ...row, allowPartial })}
                  >
                    <Undo2 size={12} /> זיכוי
                  </button>
                )}
                {row.excluded_reason === 'pending' && row.sale_id && (
                  <button type="button" className="btn btn-ghost btn-xs" style={{ color: '#FCA5A5' }} onClick={() => setCancelRow(row)}>
                    <Ban size={12} /> ביטול עסקה
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {refundRow && (
        <RefundDialog
          row={refundRow}
          allowPartial={refundRow.allowPartial}
          onClose={() => setRefundRow(null)}
          onDone={afterMoneyAction}
        />
      )}
      {cancelRow && (
        <CancelDialog row={cancelRow} onClose={() => setCancelRow(null)} onDone={afterMoneyAction} />
      )}
    </WorkDrawer>
  );
}
