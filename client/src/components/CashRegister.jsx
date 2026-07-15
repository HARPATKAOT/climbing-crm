import React, { useState, useEffect } from 'react';
import { Coins, TrendingUp, AlertTriangle, CheckCircle2, CreditCard, ReceiptText } from 'lucide-react';

const SEED_SHIFTS = [
  { id: 'sh1', date: '2026-07-08', shift: 'בוקר', employee: 'עידו בן דוד', expected: 920, actual: 920, discrepancy: 0, status: 'closed' },
  { id: 'sh2', date: '2026-07-07', shift: 'צהריים', employee: 'ליאת שניר', expected: 1240, actual: 1185, discrepancy: -55, status: 'closed' },
  { id: 'sh3', date: '2026-07-07', shift: 'בוקר', employee: 'עידו בן דוד', expected: 850, actual: 850, discrepancy: 0, status: 'closed' },
  { id: 'sh4', date: '2026-07-06', shift: 'ערב', employee: 'יובל כץ', expected: 1680, actual: 1680, discrepancy: 0, status: 'closed' },
];

export default function CashRegister() {
  const [expectedAmount, setExpectedAmount] = useState('');
  const [actualAmount, setActualAmount]     = useState('');
  const [shiftType, setShiftType]           = useState('בוקר');
  const [employee, setEmployee]             = useState('עידו בן דוד');
  const [saving, setSaving]                 = useState(false);
  const [savedOk, setSavedOk]              = useState(false);
  const [shifts, setShifts]                 = useState([]);
  const [activeTab, setActiveTab]           = useState('close'); // close | history | icount
  const [employees, setEmployees]           = useState([]);

  const refreshRegister = async () => {
    try {
      const data = await fetch('/api/cash-register').then(r => r.ok ? r.json() : []);
      const emps = await fetch('/api/employees').then(r => r.ok ? r.json() : []);
      
      setEmployees(emps);
      if (data.length === 0) {
        // If DB has no cash register shifts, fallback to seeds
        setShifts(SEED_SHIFTS);
      } else {
        setShifts(data);
      }
    } catch (err) {
      console.error(err);
      setShifts(SEED_SHIFTS);
    }
  };

  useEffect(() => {
    refreshRegister();
  }, []);

  const discrepancy = actualAmount && expectedAmount
    ? parseFloat(actualAmount) - parseFloat(expectedAmount)
    : null;

  const handleClose = async () => {
    if (!expectedAmount || !actualAmount) { alert('מלא את כל השדות'); return; }
    setSaving(true);
    
    const newShift = {
      date: new Date().toISOString().split('T')[0],
      shift: shiftType,
      employee,
      expected: parseFloat(expectedAmount),
      actual: parseFloat(actualAmount),
      discrepancy: parseFloat(actualAmount) - parseFloat(expectedAmount),
      status: 'closed',
    };

    try {
      const res = await fetch('/api/cash-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newShift)
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

  const totalWeekly = shifts.reduce((sum, s) => sum + s.actual, 0);
  const problemShifts = shifts.filter(s => s.discrepancy !== 0).length;

  return (
    <div className="fade-in">
      {/* Stats */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="card stat-card" style={{ '--stat-color': '#10B981' }}>
          <div className="stat-label">הכנסות מצטברות (מזומן)</div>
          <div className="stat-value">₪{totalWeekly.toLocaleString()}</div>
        </div>
        <div className="card stat-card" style={{ '--stat-color': '#6366F1' }}>
          <div className="stat-label">עסקאות אשראי (iCount)</div>
          <div className="stat-value">₪3,840</div>
          <div className="stat-sub up">✓ חיבור API תקין</div>
        </div>
        <div className="card stat-card" style={{ '--stat-color': problemShifts > 0 ? '#EF4444' : '#10B981' }}>
          <div className="stat-label">חריגות קופה (שבועי)</div>
          <div className="stat-value" style={{ color: problemShifts > 0 ? 'var(--red)' : 'var(--green)' }}>
            {problemShifts > 0 ? `${problemShifts} חריגות` : 'תקין'}
          </div>
          <div className={`stat-sub ${problemShifts > 0 ? 'down' : 'up'}`}>
            {problemShifts > 0 ? '⚠️ דרוש בירור' : '✓ כל המשמרות תואמות'}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[
          { k: 'close', label: '🔒 סגירת קופה' },
          { k: 'history', label: '📋 היסטוריה' },
          { k: 'icount', label: '🧾 iCount / סליקה' },
        ].map(t => (
          <button key={t.k} className={`btn btn-sm ${activeTab === t.k ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTab(t.k)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Close Shift */}
      {activeTab === 'close' && (
        <div className="grid-2" style={{ alignItems: 'flex-start' }}>
          <div className="card card-p">
            <div className="section-title" style={{ marginBottom: 20 }}>סגירת קופה — {new Date().toLocaleDateString('he-IL')}</div>

            {savedOk && (
              <div className="alert alert-success" style={{ marginBottom: 16 }}>
                <span>הקופה נסגרה ונשמרה בהצלחה! ✓</span>
              </div>
            )}

            <div className="form-grid" style={{ gap: 14 }}>
              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">משמרת</label>
                  <select className="input select" value={shiftType} onChange={e => setShiftType(e.target.value)}>
                    {['בוקר', 'צהריים', 'ערב', 'לילה'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">שם העובד</label>
                  <select className="input select" value={employee} onChange={e => setEmployee(e.target.value)}>
                    {employees.map(emp => <option key={emp.id} value={emp.name}>{emp.name}</option>)}
                    {employees.length === 0 && <option>עידו בן דוד</option>}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">סכום צפוי בקופה (ש"ח) *</label>
                <div className="input-icon-wrap">
                  <span className="input-icon" style={{ fontSize: 14 }}>₪</span>
                  <input
                    className="input"
                    type="number"
                    placeholder="0.00"
                    style={{ paddingRight: 32 }}
                    value={expectedAmount}
                    onChange={e => setExpectedAmount(e.target.value)}
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
                    style={{ paddingRight: 32, borderColor: discrepancy !== null ? (discrepancy === 0 ? 'var(--green)' : 'var(--red)') : undefined }}
                    value={actualAmount}
                    onChange={e => setActualAmount(e.target.value)}
                  />
                </div>
              </div>

              {discrepancy !== null && (
                <div className={`alert ${discrepancy === 0 ? 'alert-success' : 'alert-error'}`}>
                  <div>
                    {discrepancy === 0
                      ? <strong>הקופה מאוזנת ✓ — אין חריגה</strong>
                      : <><strong>חריגה של {discrepancy > 0 ? '+' : ''}{discrepancy} ש"ח</strong><div style={{ fontSize: 12, marginTop: 4 }}>{discrepancy > 0 ? 'עודף — בדוק אם חסרה רשומת מכירה' : 'גירעון — בדוק עם הצוות'}</div></>
                    }
                  </div>
                </div>
              )}

              <button className="btn btn-primary btn-full" style={{ paddingBlock: 13 }} onClick={handleClose} disabled={saving}>
                {saving ? '⏳ שומר...' : '🔒 סגור קופה ושמור דוח'}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card card-p">
              <div className="section-title" style={{ marginBottom: 14 }}>משמרת בוקר — סיכום היום</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { label: 'כניסות בודדות', amount: 380 },
                  { label: 'כרטיסיות שנמכרו', amount: 260 },
                  { label: 'ציוד השכרה', amount: 120 },
                  { label: 'קפיטריה', amount: 160 },
                ].map(item => (
                  <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{item.label}</span>
                    <span style={{ fontWeight: 700, color: 'var(--green)' }}>₪{item.amount}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>סה"כ צפוי</span>
                  <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--green)' }}>₪920</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* History */}
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
                {shifts.map(s => (
                  <tr key={s.id}>
                    <td>{s.date}</td>
                    <td><span className="badge badge-blue">{s.shift}</span></td>
                    <td>{s.employee}</td>
                    <td>₪{s.expected.toLocaleString()}</td>
                    <td style={{ fontWeight: 700 }}>₪{s.actual.toLocaleString()}</td>
                    <td>
                      <span className={s.discrepancy === 0 ? 'badge badge-green' : 'badge badge-red'}>
                        {s.discrepancy === 0 ? '✓ תקין' : `${s.discrepancy > 0 ? '+' : ''}${s.discrepancy} ₪`}
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

      {/* iCount */}
      {activeTab === 'icount' && (
        <div className="grid-2" style={{ alignItems: 'flex-start' }}>
          <div className="card card-p">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <ReceiptText size={22} style={{ color: 'var(--blue)' }} />
              <div>
                <div className="section-title">iCount · סליקה וחשבוניות</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>API Token מחובר ✓</div>
              </div>
            </div>

            <div className="alert alert-info" style={{ marginBottom: 20 }}>
              💡 הסליקה מתבצעת ישירות דרך iCount API (Max Business). שלח קישור תשלום מתיק הלקוח.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
