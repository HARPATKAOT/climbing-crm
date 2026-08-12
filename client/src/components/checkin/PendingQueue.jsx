import React, { useEffect, useRef, useState } from 'react';
import {
  Award, Banknote, CheckCircle2, ClipboardList, CreditCard, Hourglass, RefreshCw, ShieldAlert, X,
} from 'lucide-react';
import EmployeeSelect from '../EmployeeSelect.jsx';

const hhmm = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
};

/**
 * טבלת „ממתינים לטיפול” — מה שנשאר פתוח בדלפק.
 *
 * שני סוגי שורות: מי שנכנס ועוד לא עבר תדריך ומבחן אבטחה, ומי שנשלח אליו
 * קישור תשלום שעוד לא נסגר. שורת תשלום **לא נעלמת מעצמה** כשהכסף מגיע — היא
 * נצבעת ירוק, והמדריך מסיר אותה בלחיצה. הלחיצה היא מה שמוודא שאדם ראה
 * שהתשלום עבר, במקום ששורה תיעלם בזמן שאיש לא הסתכל.
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
  const staff = employees.filter((e) => e.is_active !== false && e.can_test_safety !== false);
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

  const clearPayment = async (row) => {
    setSavingId(row.id);
    setError('');
    try {
      const res = await fetch(`/api/checkin/pending/payment/${encodeURIComponent(row.sale_id)}/handled`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: pickedFor(row) || null }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'ההסרה נכשלה');
      await load();
      onDone?.(`התשלום של ${row.name} טופל`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId(null);
    }
  };

  const paidCount = rows.filter((r) => r.paid).length;

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
        {tab === 'pending' && paidCount > 0 && (
          <span className="badge badge-green">{paidCount} שילמו — ממתינים לאישור</span>
        )}
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginInlineStart: 'auto' }} onClick={load}>
          <RefreshCw size={14} />
        </button>
      </div>

      {error && <div className="alert alert-error" style={{ margin: 14, fontSize: 13 }}>{error}</div>}

      {tab === 'sales' ? (
        <div className="table-wrap">
          <table className="crm-table">
            <thead>
              <tr><th>שעה</th><th>שם</th><th>מה נקנה</th><th>אופן תשלום</th><th>סכום</th></tr>
            </thead>
            <tbody>
              {sales.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-3)', padding: 24 }}>
                  עוד לא נמכר כלום במשמרת הזאת
                </td></tr>
              )}
              {sales.map((row) => (
                <tr key={row.id}>
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
                    {row.method === 'cash' ? (
                      <span className="badge badge-green"><Banknote size={12} /> מזומן</span>
                    ) : row.paid ? (
                      <span className="badge badge-green"><CreditCard size={12} /> שולם בקישור</span>
                    ) : (
                      <span className="badge badge-amber"><Hourglass size={12} /> ממתין לתשלום</span>
                    )}
                  </td>
                  <td style={{ fontWeight: 700 }}>₪{row.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : tab === 'active' ? (
        <div className="table-wrap">
          <table className="crm-table">
            <thead>
              <tr><th>שעת כניסה</th><th>שם</th><th>מצב</th></tr>
            </thead>
            <tbody>
              {active.length === 0 && (
                <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-3)', padding: 24 }}>
                  אף אחד לא נכנס עדיין במשמרת הזאת
                </td></tr>
              )}
              {active.map((row) => (
                <tr key={row.id}>
                  <td style={{ fontFamily: 'monospace' }}>{hhmm(row.at)}</td>
                  <td style={{ fontWeight: 600 }}>{row.name}</td>
                  <td>
                    <span className="badge badge-green">
                      <CheckCircle2 size={12} /> שילם ועבר מבחן — על הקיר
                    </span>
                  </td>
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
                  style={row.paid ? { background: 'rgba(16,185,129,0.07)' } : undefined}
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
                      {isPayment && (row.paid ? (
                        <span className="badge badge-green">
                          <CheckCircle2 size={12} /> שולם ₪{row.total}
                          {row.grants_entry ? ' — אפשר להכניס' : ''}
                        </span>
                      ) : (
                        <span className="badge badge-amber">
                          <Hourglass size={12} /> קישור תשלום ₪{row.total} — טרם שולם
                        </span>
                      ))}
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
                  <td style={{ minWidth: 190 }}>
                    {waitingForMoney ? (
                      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>ממתין לסליקה</span>
                    ) : isPayment && !row.needs_safety ? (
                      // אישור על תשלום אינו חתימה על כלום — רק „ראיתי שהכסף נכנס”.
                      // בורר עובד כאן שאל שאלה שאין לה משמעות בתיק של אף אחד.
                      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>ממתין לאישור הדלפק</span>
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
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {isPayment && !waitingForMoney && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={savingId === row.id}
                          onClick={() => clearPayment(row)}
                        >
                          <CreditCard size={14} /> {savingId === row.id ? 'שומר...' : 'אישור'}
                        </button>
                      )}
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
    </div>
  );
}
