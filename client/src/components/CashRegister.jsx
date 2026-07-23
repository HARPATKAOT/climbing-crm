import React, { useState, useEffect, useCallback } from 'react';
import { ReceiptText, RefreshCw } from 'lucide-react';
import PosSale from './PosSale.jsx';

function docAmount(doc) {
  const n = Number(doc?.totalwithvat ?? doc?.total ?? doc?.sum ?? 0);
  return Number.isNaN(n) ? 0 : n;
}

function docLabel(doc) {
  return (
    doc?.client_name ||
    doc?.clientname ||
    doc?.description ||
    doc?.comment ||
    doc?.docnum ||
    'מסמך'
  );
}

function docDate(doc) {
  const raw = doc?.docdate || doc?.doc_date || doc?.date || '';
  const s = String(raw);
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
  }
  if (s.includes('T')) return new Date(s).toLocaleDateString('he-IL');
  return s || '—';
}

export default function CashRegister() {
  const [expectedAmount, setExpectedAmount] = useState('');
  const [actualAmount, setActualAmount] = useState('');
  const [shiftType, setShiftType] = useState('בוקר');
  const [employee, setEmployee] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [shifts, setShifts] = useState([]);
  const [activeTab, setActiveTab] = useState('sale');
  const [employees, setEmployees] = useState([]);

  const [icountStatus, setIcountStatus] = useState({ loading: true });
  const [icountDocs, setIcountDocs] = useState([]);
  const [icountTotal, setIcountTotal] = useState(0);
  const [icountLoading, setIcountLoading] = useState(false);
  const [payments, setPayments] = useState([]);

  const refreshRegister = useCallback(async () => {
    try {
      const [data, emps] = await Promise.all([
        fetch('/api/cash-register').then((r) => (r.ok ? r.json() : [])),
        fetch('/api/employees').then((r) => (r.ok ? r.json() : [])),
      ]);
      const list = Array.isArray(emps) ? emps : [];
      setEmployees(list);
      if (list.length && !employee) setEmployee(list[0].name);
      setShifts(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setShifts([]);
    }
  }, [employee]);

  const refreshIcount = useCallback(async () => {
    setIcountLoading(true);
    try {
      const [statusRes, docsRes, payRes] = await Promise.all([
        fetch('/api/icount/status'),
        fetch('/api/icount/docs'),
        fetch('/api/payments'),
      ]);

      const status = await statusRes.json().catch(() => ({}));
      setIcountStatus({ loading: false, ...status, httpOk: statusRes.ok });

      if (docsRes.ok) {
        const docsData = await docsRes.json();
        setIcountDocs(Array.isArray(docsData.docs) ? docsData.docs : []);
        setIcountTotal(Number(docsData.total) || 0);
      } else {
        setIcountDocs([]);
        setIcountTotal(0);
      }

      if (payRes.ok) {
        const pays = await payRes.json();
        setPayments(Array.isArray(pays) ? pays : []);
      }
    } catch (err) {
      console.error(err);
      setIcountStatus({
        loading: false,
        ok: false,
        configured: false,
        message: 'לא ניתן לבדוק חיבור ל-iCount',
      });
    } finally {
      setIcountLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshRegister();
    refreshIcount();
  }, [refreshRegister, refreshIcount]);

  const discrepancy =
    actualAmount && expectedAmount
      ? parseFloat(actualAmount) - parseFloat(expectedAmount)
      : null;

  const handleClose = async () => {
    if (!expectedAmount || !actualAmount) {
      alert('מלא את כל השדות');
      return;
    }
    setSaving(true);

    const newShift = {
      date: new Date().toISOString().split('T')[0],
      shift: shiftType,
      employee: employee || 'לא צוין',
      expected: parseFloat(expectedAmount),
      actual: parseFloat(actualAmount),
      discrepancy: parseFloat(actualAmount) - parseFloat(expectedAmount),
      status: 'closed',
    };

    try {
      const res = await fetch('/api/cash-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newShift),
      });
      if (res.ok) {
        setSavedOk(true);
        setExpectedAmount('');
        setActualAmount('');
        refreshRegister();
        setTimeout(() => setSavedOk(false), 3000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const totalCash = shifts.reduce((sum, s) => sum + Number(s.actual || 0), 0);
  const problemShifts = shifts.filter((s) => Number(s.discrepancy) !== 0).length;
  const pendingPayments = payments.filter((p) => p.status === 'pending');

  const statusLine = icountStatus.loading
    ? 'בודק חיבור...'
    : icountStatus.ok
      ? `✓ מחובר${icountStatus.clientsCount != null ? ` · ${icountStatus.clientsCount} לקוחות` : ''}`
      : icountStatus.configured
        ? `✗ שגיאה: ${icountStatus.message || 'חיבור נכשל'}`
        : '✗ חסר אסימון בהגדרות השרת';

  return (
    <div className="fade-in">
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="card stat-card" style={{ '--stat-color': '#10B981' }}>
          <div className="stat-label">הכנסות מזומן (סגירות קופה)</div>
          <div className="stat-value">₪{totalCash.toLocaleString()}</div>
        </div>
        <div className="card stat-card" style={{ '--stat-color': '#6366F1' }}>
          <div className="stat-label">מסמכי iCount (30 יום)</div>
          <div className="stat-value">₪{Math.round(icountTotal).toLocaleString()}</div>
          <div className={`stat-sub ${icountStatus.ok ? 'up' : 'down'}`}>{statusLine}</div>
        </div>
        <div className="card stat-card" style={{ '--stat-color': problemShifts > 0 ? '#EF4444' : '#10B981' }}>
          <div className="stat-label">חריגות קופה</div>
          <div className="stat-value" style={{ color: problemShifts > 0 ? 'var(--red)' : 'var(--green)' }}>
            {problemShifts > 0 ? `${problemShifts} חריגות` : 'תקין'}
          </div>
          <div className={`stat-sub ${problemShifts > 0 ? 'down' : 'up'}`}>
            {problemShifts > 0 ? 'דרוש בירור' : 'כל המשמרות תואמות'}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[
          { k: 'sale', label: 'מכירה' },
          { k: 'close', label: 'סגירת קופה' },
          { k: 'history', label: 'היסטוריה' },
          { k: 'icount', label: 'iCount / סליקה' },
        ].map((t) => (
          <button
            key={t.k}
            className={`btn btn-sm ${activeTab === t.k ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab(t.k)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'sale' && <PosSale />}

      {activeTab === 'close' && (
        <div className="grid-2" style={{ alignItems: 'flex-start' }}>
          <div className="card card-p">
            <div className="section-title" style={{ marginBottom: 20 }}>
              סגירת קופה — {new Date().toLocaleDateString('he-IL')}
            </div>

            {savedOk && (
              <div className="alert alert-success" style={{ marginBottom: 16 }}>
                <span>הקופה נסגרה ונשמרה בהצלחה</span>
              </div>
            )}

            <div className="form-grid" style={{ gap: 14 }}>
              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">משמרת</label>
                  <select className="input select" value={shiftType} onChange={(e) => setShiftType(e.target.value)}>
                    {['בוקר', 'צהריים', 'ערב', 'לילה'].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">שם העובד</label>
                  <select className="input select" value={employee} onChange={(e) => setEmployee(e.target.value)}>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.name}>{emp.name}</option>
                    ))}
                    {employees.length === 0 && <option value="">אין עובדים במערכת</option>}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">סכום צפוי בקופה (ש״ח) *</label>
                <div className="input-icon-wrap">
                  <span className="input-icon" style={{ fontSize: 14 }}>₪</span>
                  <input
                    className="input"
                    type="number"
                    placeholder="0.00"
                    style={{ paddingRight: 32 }}
                    value={expectedAmount}
                    onChange={(e) => setExpectedAmount(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">סכום בפועל בקופה (ספירת מזומן) *</label>
                <div className="input-icon-wrap">
                  <span className="input-icon" style={{ fontSize: 14 }}>₪</span>
                  <input
                    className="input"
                    type="number"
                    placeholder="0.00"
                    style={{
                      paddingRight: 32,
                      borderColor:
                        discrepancy !== null
                          ? discrepancy === 0
                            ? 'var(--green)'
                            : 'var(--red)'
                          : undefined,
                    }}
                    value={actualAmount}
                    onChange={(e) => setActualAmount(e.target.value)}
                  />
                </div>
              </div>

              {discrepancy !== null && (
                <div className={`alert ${discrepancy === 0 ? 'alert-success' : 'alert-error'}`}>
                  <div>
                    {discrepancy === 0 ? (
                      <strong>הקופה מאוזנת — אין חריגה</strong>
                    ) : (
                      <>
                        <strong>
                          חריגה של {discrepancy > 0 ? '+' : ''}
                          {discrepancy} ש״ח
                        </strong>
                        <div style={{ fontSize: 12, marginTop: 4 }}>
                          {discrepancy > 0
                            ? 'עודף — בדוק אם חסרה רשומת מכירה'
                            : 'גירעון — בדוק עם הצוות'}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              <button
                className="btn btn-primary btn-full"
                style={{ paddingBlock: 13 }}
                onClick={handleClose}
                disabled={saving}
              >
                {saving ? 'שומר...' : 'סגור קופה ושמור דוח'}
              </button>
            </div>
          </div>

          <div className="card card-p">
            <div className="section-title" style={{ marginBottom: 14 }}>תשלומים ממתינים</div>
            {pendingPayments.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-3)' }}>אין דרישות תשלום פתוחות</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {pendingPayments.slice(0, 8).map((p) => (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '8px 0',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{p.description}</span>
                    <span style={{ fontWeight: 700 }}>₪{Number(p.amount).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="card">
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>תאריך</th>
                  <th>משמרת</th>
                  <th>עובד</th>
                  <th>צפוי</th>
                  <th>בפועל</th>
                  <th>חריגה בקופה</th>
                  <th>סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {shifts.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-3)' }}>
                      עדיין אין סגירות קופה שמורות
                    </td>
                  </tr>
                )}
                {shifts.map((s) => (
                  <tr key={s.id}>
                    <td>{s.date}</td>
                    <td><span className="badge badge-blue">{s.shift}</span></td>
                    <td>{s.employee}</td>
                    <td>₪{Number(s.expected).toLocaleString()}</td>
                    <td style={{ fontWeight: 700 }}>₪{Number(s.actual).toLocaleString()}</td>
                    <td>
                      <span className={Number(s.discrepancy) === 0 ? 'badge badge-green' : 'badge badge-red'}>
                        {Number(s.discrepancy) === 0
                          ? 'תקין'
                          : `${Number(s.discrepancy) > 0 ? '+' : ''}${s.discrepancy} ₪`}
                      </span>
                    </td>
                    <td><span className="badge badge-gray">סגורה</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'icount' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card card-p">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <ReceiptText size={22} style={{ color: 'var(--blue)' }} />
                <div>
                  <div className="section-title">iCount · מסמכים וסליקה</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{statusLine}</div>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={refreshIcount} disabled={icountLoading}>
                <RefreshCw size={14} /> {icountLoading ? 'מרענן...' : 'רענון'}
              </button>
            </div>

            <div className="alert alert-info" style={{ marginBottom: 0 }}>
              שליחת קישור תשלום והפקת חשבונית מתבצעות מתיק הלקוח. כאן מוצגים מסמכים אמיתיים מ-iCount.
            </div>
          </div>

          <div className="card">
            <div className="table-wrap">
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>תאריך</th>
                    <th>מס׳ מסמך</th>
                    <th>לקוח / תיאור</th>
                    <th>סכום</th>
                  </tr>
                </thead>
                <tbody>
                  {!icountStatus.ok && (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-3)' }}>
                        {icountStatus.message || 'אין חיבור ל-iCount — בדוק את האסימון בשרת'}
                      </td>
                    </tr>
                  )}
                  {icountStatus.ok && icountDocs.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-3)' }}>
                        לא נמצאו מסמכים ב־30 הימים האחרונים
                      </td>
                    </tr>
                  )}
                  {icountDocs.map((doc, i) => (
                    <tr key={doc.doc_id || doc.docnum || i}>
                      <td>{docDate(doc)}</td>
                      <td>{doc.docnum || doc.doc_id || '—'}</td>
                      <td>{docLabel(doc)}</td>
                      <td style={{ fontWeight: 700 }}>₪{docAmount(doc).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {payments.length > 0 && (
            <div className="card">
              <div className="section-title" style={{ padding: '14px 16px 0' }}>תשלומים במערכת</div>
              <div className="table-wrap">
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>תאריך</th>
                      <th>תיאור</th>
                      <th>סכום</th>
                      <th>סטטוס</th>
                      <th>מס׳ מסמך</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.slice(0, 30).map((p) => (
                      <tr key={p.id}>
                        <td>
                          {p.created_at
                            ? new Date(p.created_at).toLocaleDateString('he-IL')
                            : '—'}
                        </td>
                        <td>{p.description}</td>
                        <td>₪{Number(p.amount).toLocaleString()}</td>
                        <td>
                          <span
                            className={
                              p.status === 'paid'
                                ? 'badge badge-green'
                                : p.status === 'pending'
                                  ? 'badge badge-amber'
                                  : 'badge badge-gray'
                            }
                          >
                            {p.status === 'paid'
                              ? 'שולם'
                              : p.status === 'pending'
                                ? 'ממתין'
                                : p.status}
                          </span>
                        </td>
                        <td>{p.icount_doc_number || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
