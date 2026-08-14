import React, { useEffect, useRef, useState } from 'react';
import {
  Award, Banknote, CheckCircle2, ClipboardList, CreditCard, Eye, Hourglass,
  RefreshCw, ShieldAlert, X,
} from 'lucide-react';
import EmployeeSelect from '../EmployeeSelect.jsx';
import CounterRecordDialog from './CounterRecordDialog.jsx';
import { canConductSafetyTest, employeesFor } from '../../utils/operationalEmployees.js';

const hhmm = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
};

/**
 * טבלת „ממתינים לטיפול” — מה שנשאר פתוח בדלפק.
 *
 * שני סוגי שורות: מי שנכנס ועוד לא עבר תדריך ומבחן אבטחה, ומי שנשלח אליו
 * קישור תשלום שעוד לא שולם. ברגע שהכסף מגיע השורה מפסיקה להיות משימה
 * ומופיעה מיד ב„מכירות במשמרת”; אם עדיין חסר מבחן אבטחה, נשארת שורת מבחן.
 *
 * הטבלה נטענת מחדש כל 20 שניות: התשלום מגיע מהסליקה בזמן שלו, בלי שאיש
 * במסוף לחץ על כלום.
 */
export default function PendingQueue({ employees = [], onDone, refreshKey = 0 }) {
  const [rows, setRows] = useState([]);
  const [active, setActive] = useState([]);
  const [sales, setSales] = useState([]);
  // „ממתינים” היא רשימת משימות; „מטפסים במשמרת” היא תמונת מצב של מי על הקיר.
  // שני דברים שונים, ולכן שתי לשוניות ולא טבלה אחת עם דגלים.
  const [tab, setTab] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [byRow, setByRow] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [actionBusyId, setActionBusyId] = useState('');
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [error, setError] = useState('');
  const liveRef = useRef(true);

  const load = async () => {
    try {
      const data = await fetch('/api/checkin/pending').then((r) => (r.ok ? r.json() : null));
      if (!liveRef.current) return;
      // תמיכה בשתי הצורות: מערך שטוח מהגרסה הקודמת, ואובייקט שתי הרשימות.
      setRows(Array.isArray(data) ? data : (data?.pending || []));
      setActive(Array.isArray(data) ? [] : (data?.active || []));
      setSales(Array.isArray(data) ? [] : (data?.sales || []));
    } catch {
      if (liveRef.current) { setRows([]); setActive([]); setSales([]); }
    } finally {
      if (liveRef.current) setLoading(false);
    }
  };

  useEffect(() => { load(); }, [refreshKey]);

  useEffect(() => {
    liveRef.current = true;
    const timer = window.setInterval(load, 20000);
    return () => {
      liveRef.current = false;
      window.clearInterval(timer);
    };
  }, []);

  // רק מי שהוסמך להעביר תדריך ומבחן. הרשימה מגיעה מהשרת כבר מסוננת, וזו
  // הרשת השנייה: מבחן לא נחתם על שם מי שלא מורשה לו.
  const staff = employeesFor(employees, canConductSafetyTest);
  const pickedFor = (row) => byRow[row.id] || staff[0]?.id || '';

  const signSafety = async (row) => {
    const examiner = staff.find((e) => e.id === pickedFor(row));
    if (!examiner) {
      setError('אין עובד פעיל שיכול לחתום על המבחן');
      return;
    }
    setSavingId(row.id);
    setError('');
    try {
      const res = await fetch('/api/level-tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: row.student_id,
          studentName: row.name,
          test_type: 'security',
          date: new Date().toISOString().slice(0, 10),
          examiner: examiner.name,
          examinerId: examiner.id,
          passed: true,
          notes: 'תדריך ומבחן אבטחה בדלפק',
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'שמירת המבחן נכשלה');
      await load();
      onDone?.(`נחתם מבחן אבטחה ל${row.name}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId(null);
    }
  };

  /** הסרה ידנית — למי שהלך, או למקרה שהצוות יודע משהו שהמערכת לא. */
  const dismissRow = async (row) => {
    setSavingId(row.id);
    setError('');
    try {
      const res = await fetch('/api/checkin/pending/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ row_id: row.id, employee_id: pickedFor(row) || null }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'ההסרה נכשלה');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId(null);
    }
  };

  /** זיכוי מלא של מכירה — כולל תיקון יומן המזומן וביטול ההטבות שנוצרו. */
  const refundSale = async (sale) => {
    const cashNote = sale.method === 'cash'
      ? '\nזו עסקת מזומן: לאחר האישור יש למסור ללקוח את הסכום מהמגירה.'
      : '\nההחזר יבוצע לאמצעי התשלום דרך מערכת הסליקה.';
    const ok = window.confirm(
      `לזכות את ${sale.payer_name || sale.name} על ₪${sale.total}?
יופק מסמך זיכוי, וכרטיסייה או מנוי שנוצרו בעסקה יבוטלו.${cashNote}
אי אפשר לבטל את הפעולה.`
    );
    if (!ok) return;
    setActionBusyId(`refund:${sale.sale_id}`);
    setError('');
    try {
      const res = await fetch(`/api/pos/sales/${encodeURIComponent(sale.sale_id)}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'זיכוי מהדלפק' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'הזיכוי נכשל');
      await load();
      setSelectedRecord(null);
      onDone?.(`בוצע זיכוי ל${sale.payer_name || sale.name}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setActionBusyId('');
    }
  };

  /** עסקה שלא שולמה מבטלים; אין כסף להחזיר ואין מסמך זיכוי. */
  const cancelSale = async (sale) => {
    const ok = window.confirm(
      `לבטל את קישור התשלום של ${sale.payer_name || sale.name} על ₪${sale.total}?\n`
      + 'הקישור יפסיק לעבוד, והעסקה תישאר ביומן כמבוטלת.'
    );
    if (!ok) return;
    setActionBusyId(`cancel:${sale.sale_id}`);
    setError('');
    try {
      const res = await fetch(`/api/pos/sales/${encodeURIComponent(sale.sale_id)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'ביטול קישור מהדלפק' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'ביטול העסקה נכשל');
      await load();
      setSelectedRecord(null);
      onDone?.(`קישור התשלום של ${sale.payer_name || sale.name} בוטל`);
    } catch (err) {
      setError(err.message);
    } finally {
      setActionBusyId('');
    }
  };

  /**
   * פתיחת המסמך שהופק ב-iCount.
   *
   * המסלול מזרים PDF ודורש הזדהות, ולכן אי אפשר פשוט לפתוח אותו בלשונית —
   * היא תגיע בלי הטוקן ותחזור 401. מושכים את הקובץ ופותחים אותו מהזיכרון.
   */
  const openDoc = async (sale, kind = 'charge', printAfterOpen = false) => {
    setError('');
    const popup = window.open('', '_blank');
    if (!popup) {
      setError('הדפדפן חסם את חלון החשבונית — אשרו חלונות קופצים ונסו שוב');
      return;
    }
    popup.opener = null;
    try {
      const res = await fetch(`/api/pos/sales/${encodeURIComponent(sale.sale_id)}/invoice?kind=${kind}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'לא נמצא מסמך');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (printAfterOpen) {
        popup.onload = () => window.setTimeout(() => {
          try { popup.focus(); popup.print(); } catch { /* חלון ה-PDF עדיין מאפשר הדפסה ידנית */ }
        }, 300);
      }
      popup.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 120000);
      if (printAfterOpen) onDone?.('החשבונית נפתחה להדפסה חוזרת');
    } catch (err) {
      popup.close();
      setError(err.message);
    }
  };

  const copyPaymentLink = async (sale) => {
    setError('');
    try {
      if (!sale.payment_url) throw new Error('לא נשמר קישור תשלום לעסקה הזאת');
      await navigator.clipboard.writeText(sale.payment_url);
      onDone?.('קישור התשלום הועתק');
    } catch (err) {
      setError(err.message || 'העתקת הקישור נכשלה');
    }
  };

  const resendPaymentLink = async (sale) => {
    setActionBusyId(`resend:${sale.sale_id}`);
    setError('');
    try {
      const res = await fetch(`/api/pos/sales/${encodeURIComponent(sale.sale_id)}/send-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: sale.customer_phone || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'שליחת הקישור נכשלה');
      if (!body.whatsappSent && body.whatsappUrl) window.open(body.whatsappUrl, '_blank', 'noopener,noreferrer');
      onDone?.(body.whatsappSent ? 'קישור התשלום נשלח שוב' : 'נפתח WhatsApp לשליחה ידנית');
    } catch (err) {
      setError(err.message);
    } finally {
      setActionBusyId('');
    }
  };

  const openDetails = (row, sourceTab) => {
    setError('');
    setSelectedRecord({ ...row, source_tab: sourceTab });
  };

  const relatedSales = selectedRecord
    ? selectedRecord.sale_id
      ? sales.filter((sale) => String(sale.sale_id) === String(selectedRecord.sale_id))
      : selectedRecord.student_id
        ? sales.filter((sale) => String(sale.student_id || '') === String(selectedRecord.student_id))
        : []
    : [];

  return (
    <div className="card">
      <div className="section-title" style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <ClipboardList size={17} />
        <button
          type="button"
          className={`tab-pill ${tab === 'pending' ? 'active' : ''}`}
          onClick={() => setTab('pending')}
        >
          ממתינים לטיפול ({rows.length})
        </button>
        <button
          type="button"
          className={`tab-pill ${tab === 'active' ? 'active' : ''}`}
          onClick={() => setTab('active')}
        >
          מטפסים במשמרת ({active.length})
        </button>
        <button
          type="button"
          className={`tab-pill ${tab === 'sales' ? 'active' : ''}`}
          onClick={() => setTab('sales')}
        >
          מכירות במשמרת ({sales.length})
        </button>
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginInlineStart: 'auto' }} onClick={load}>
          <RefreshCw size={14} />
        </button>
      </div>

      {error && <div className="alert alert-error" style={{ margin: 14, fontSize: 13 }}>{error}</div>}

      {tab === 'sales' ? (
        <div className="table-wrap">
          <table className="crm-table">
            <thead>
              <tr><th>שעה</th><th>שם</th><th>מה נקנה</th><th>אופן תשלום</th><th>סכום</th><th /></tr>
            </thead>
            <tbody>
              {sales.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-3)', padding: 24 }}>
                  עוד לא נמכר כלום במשמרת הזאת
                </td></tr>
              )}
              {sales.map((row) => (
                <tr
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  title="לחיצה להצגת פרטי העסקה והפעולות"
                  onClick={() => openDetails(row, 'sales')}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openDetails(row, 'sales');
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <td style={{ fontFamily: 'monospace' }}>{hhmm(row.at)}</td>
                  <td style={{ fontWeight: 600 }}>
                    {row.name}
                    {row.payer_name && row.payer_name !== row.name && (
                      <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 400 }}>
                        שילם: {row.payer_name}
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-2)' }}>{row.items || '—'}</td>
                  <td>
                    {row.status === 'refunded' ? (
                      <span className="badge badge-red"><CreditCard size={12} /> זוכה</span>
                    ) : row.status === 'cancelled' ? (
                      <span className="badge badge-gray"><X size={12} /> בוטל</span>
                    ) : row.method === 'cash' ? (
                      <span className="badge badge-green"><Banknote size={12} /> מזומן</span>
                    ) : row.paid ? (
                      <span className="badge badge-green"><CreditCard size={12} /> שולם בקישור</span>
                    ) : (
                      <span className="badge badge-amber"><Hourglass size={12} /> ממתין לתשלום</span>
                    )}
                  </td>
                  <td style={{ fontWeight: 700 }}>
                    ₪{row.total}
                    {row.refunded && <div style={{ fontSize: 11, color: 'var(--amber)' }}>זוכתה</div>}
                  </td>
                  <td>
                    <span className="btn btn-ghost btn-sm"><Eye size={14} /> פרטים ופעולות</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : tab === 'active' ? (
        <div className="table-wrap">
          <table className="crm-table">
            <thead>
              <tr><th>שעת כניסה</th><th>שם</th><th>מצב</th><th /></tr>
            </thead>
            <tbody>
              {active.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-3)', padding: 24 }}>
                  אף אחד לא נכנס עדיין במשמרת הזאת
                </td></tr>
              )}
              {active.map((row) => (
                <tr
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  title="לחיצה להצגת פרטי הכניסה והרכישות"
                  onClick={() => openDetails(row, 'active')}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openDetails(row, 'active');
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <td style={{ fontFamily: 'monospace' }}>{hhmm(row.at)}</td>
                  <td style={{ fontWeight: 600 }}>{row.name}</td>
                  <td>
                    <span className="badge badge-green">
                      <CheckCircle2 size={12} /> שילם ועבר מבחן — על הקיר
                    </span>
                  </td>
                  <td><span className="btn btn-ghost btn-sm"><Eye size={14} /> פרטים</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
      <div className="table-wrap">
        <table className="crm-table">
          <thead>
            <tr>
              <th>שעה</th>
              <th>שם</th>
              <th>ממתין ל־</th>
              <th>מי מטפל</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-3)', padding: 24 }}>טוען...</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-3)', padding: 24 }}>
                אין אף אחד שממתין לטיפול
              </td></tr>
            )}
            {rows.map((row) => {
              const isPayment = row.kind === 'payment_link';
              const waitingForMoney = isPayment && !row.paid;
              return (
                <tr
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  title="לחיצה להצגת פרטי הרשומה והרכישות"
                  onClick={() => openDetails(row, 'pending')}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openDetails(row, 'pending');
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <td style={{ fontFamily: 'monospace' }}>{hhmm(row.at)}</td>
                  <td style={{ fontWeight: 600 }}>
                    {row.name}
                    {row.payer_name && row.payer_name !== row.name && (
                      <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 400 }}>
                        שילם: {row.payer_name}
                      </div>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {isPayment && (
                        <span className="badge badge-amber">
                          <Hourglass size={12} /> קישור תשלום ₪{row.total} — טרם שולם
                        </span>
                      )}
                      {row.needs_safety && (
                        <span className={row.state === 'missing' ? 'badge badge-red' : 'badge badge-amber'}>
                          <ShieldAlert size={12} /> {row.state === 'missing' ? 'תדריך ומבחן אבטחה' : `מבחן אבטחה פג ${row.expires_at || ''}`}
                        </span>
                      )}
                    </div>
                    {isPayment && row.items && (
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>{row.items}</div>
                    )}
                  </td>
                  <td style={{ minWidth: 190 }} onClick={(event) => event.stopPropagation()}>
                    {waitingForMoney ? (
                      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>ממתין לסליקה</span>
                    ) : (
                      <EmployeeSelect
                        className="input select input-sm"
                        employees={staff}
                        value={pickedFor(row)}
                        placeholder="בחירת מדריך"
                        aria-label={`מי מטפל ב${row.name}`}
                        onChange={(emp) => setByRow((prev) => ({ ...prev, [row.id]: emp?.id || '' }))}
                      />
                    )}
                  </td>
                  <td onClick={(event) => event.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {row.needs_safety && row.student_id && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={savingId === row.id || staff.length === 0}
                          onClick={() => signSafety(row)}
                        >
                          <Award size={14} /> {savingId === row.id ? 'שומר...' : 'עבר מבחן'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm"
                        disabled={savingId === row.id}
                        title="הסרה מהרשימה"
                        aria-label={`הסרת ${row.name} מהרשימה`}
                        onClick={() => dismissRow(row)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {selectedRecord && (
        <CounterRecordDialog
          record={selectedRecord}
          relatedSales={relatedSales}
          busyId={actionBusyId}
          error={error}
          onClose={() => { setSelectedRecord(null); setError(''); }}
          onRefund={refundSale}
          onCancel={cancelSale}
          onOpenDoc={(sale, kind) => openDoc(sale, kind, false)}
          onPrintDoc={(sale, kind) => openDoc(sale, kind, true)}
          onCopyPaymentLink={copyPaymentLink}
          onResendPaymentLink={resendPaymentLink}
        />
      )}
    </div>
  );
}
