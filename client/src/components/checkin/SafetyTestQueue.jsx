import React, { useEffect, useState } from 'react';
import { Award, RefreshCw, ShieldAlert } from 'lucide-react';
import EmployeeSelect from '../EmployeeSelect.jsx';
import { canConductSafetyTest, employeesFor } from '../../utils/operationalEmployees.js';

const hhmm = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
};

/**
 * מי שנכנס היום ועוד אין לו מבחן אבטחה בתוקף.
 *
 * הכניסה לא נחסמת על מבחן חסר — התדריך והמבחן קורים אחריה, עם מדריך. השורה
 * נשארת כאן עד שהמדריך חותם, והחתימה נכנסת לתיק המתאמן כך שבפעם הבאה לא
 * צריך לחזור על זה.
 */
export default function SafetyTestQueue({ employees = [], onDone, refreshKey = 0 }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [examinerByStudent, setExaminerByStudent] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetch('/api/checkin/safety-queue').then((r) => (r.ok ? r.json() : []));
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  // נטען מחדש אחרי כל כניסה חדשה — מי שנכנס עכשיו בלי מבחן צריך להופיע מיד.
  useEffect(() => { load(); }, [refreshKey]);

  const examiners = employeesFor(employees, canConductSafetyTest);

  const sign = async (row) => {
    const examinerId = examinerByStudent[row.student_id] || examiners[0]?.id;
    const examiner = examiners.find((e) => e.id === examinerId);
    if (!examiner) {
      setError('אין עובד פעיל שיכול לחתום על המבחן');
      return;
    }
    setSavingId(row.student_id);
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
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'שמירת המבחן נכשלה');
      }
      await load();
      onDone?.(`נחתם מבחן אבטחה ל${row.name}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="card">
      <div className="section-title" style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <ShieldAlert size={17} />
        <span>ממתינים לתדריך ומבחן אבטחה ({rows.length})</span>
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginInlineStart: 'auto' }} onClick={load}>
          <RefreshCw size={14} />
        </button>
      </div>

      {error && <div className="alert alert-error" style={{ margin: 14, fontSize: 13 }}>{error}</div>}

      <div className="table-wrap">
        <table className="crm-table">
          <thead>
            <tr>
              <th>שעת כניסה</th>
              <th>שם</th>
              <th>מצב</th>
              <th>מי העביר תדריך ומבחן</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-3)', padding: 24 }}>טוען...</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-3)', padding: 24 }}>
                לכל מי שנכנס היום יש מבחן אבטחה בתוקף
              </td></tr>
            )}
            {rows.map((row) => (
              <tr key={row.student_id}>
                <td style={{ fontFamily: 'monospace' }}>{hhmm(row.entered_at)}</td>
                <td style={{ fontWeight: 600 }}>{row.name}</td>
                <td>
                  <span className={row.state === 'missing' ? 'badge badge-red' : 'badge badge-amber'}>
                    {row.state === 'missing' ? 'אין מבחן' : `פג ${row.expires_at || ''}`}
                  </span>
                </td>
                <td style={{ minWidth: 200 }}>
                  <EmployeeSelect
                    className="input select input-sm"
                    employees={examiners}
                    value={examinerByStudent[row.student_id] || examiners[0]?.id || ''}
                    placeholder="בחירת מדריך"
                    aria-label={`מי העביר מבחן ל${row.name}`}
                    onChange={(emp) => setExaminerByStudent((prev) => ({ ...prev, [row.student_id]: emp?.id || '' }))}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={savingId === row.student_id || examiners.length === 0}
                    onClick={() => sign(row)}
                  >
                    <Award size={14} /> {savingId === row.student_id ? 'שומר...' : 'עבר מבחן'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
