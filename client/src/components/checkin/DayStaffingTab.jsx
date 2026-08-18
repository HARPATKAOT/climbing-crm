/**
 * אירועי היום ומי משובץ אליהם — סימון הגעה מהדלפק.
 *
 * שיבוץ הוא תוכנית; הגעה היא עובדה, וצריך לרשום אותה במקום שבו עומדים כשהיא
 * קורית. אירועי היום נסמנים כאן, וחוגים מוצגים לקריאה בלבד — שם המדריך מסמן
 * את הצוות באותו מסך שבו הוא מסמן את החניכים, וסימון כפול היה שתי אמיתות.
 *
 * החלפה היא פעולה אחת: מי לא הגיע ומי בא במקומו, ושתי השורות נכתבות יחד.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, RefreshCw, UserMinus, Users, X } from 'lucide-react';
import AppSelect from '../AppSelect.jsx';

const STATUS_META = {
  present: { label: 'הגיע', className: 'btn-primary' },
  absent: { label: 'לא הגיע', className: 'btn-ghost' },
  substituted: { label: 'הוחלף', className: 'btn-ghost' },
};

function timeLabel(start, end) {
  if (!start) return '';
  return end ? `${start}–${end}` : start;
}

export default function DayStaffingTab({ date, employees = [] }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [subFor, setSubFor] = useState(null);
  const [subId, setSubId] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/day-staffing?date=${encodeURIComponent(date)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'טעינת אירועי היום נכשלה');
      setData(body);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const mark = async (activityId, person, status) => {
    setBusy(`${activityId}:${person.employee_id}`);
    setError('');
    try {
      const res = await fetch(`/api/activities/${encodeURIComponent(activityId)}/staff-attendance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          employee_id: person.employee_id,
          // לחיצה על מה שכבר מסומן מנקה אותו — חזרה ל„טרם סומן”.
          status: person.status === status ? null : status,
          role_label: person.role,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'הסימון נכשל');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const substitute = async (activityId, person) => {
    if (!subId) return;
    setBusy(`${activityId}:${person.employee_id}`);
    setError('');
    try {
      const res = await fetch(`/api/activities/${encodeURIComponent(activityId)}/staff-substitution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, employee_id: person.employee_id, substitute_id: subId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'רישום ההחלפה נכשל');
      setSubFor(null);
      setSubId('');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  if (!data) {
    return <div style={{ color: 'var(--text-3)', padding: 20, textAlign: 'center' }}>{error || 'טוען...'}</div>;
  }

  const nothing = data.activities.length === 0 && data.classes.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="section-title" style={{ margin: 0 }}>אירועי היום</div>
        <button className="btn btn-ghost btn-sm" onClick={load}><RefreshCw size={13} /></button>
        {data.vacation && (
          <span className="badge badge-amber"><AlertTriangle size={12} /> חופשה מאימונים — אין חוגים</span>
        )}
      </div>

      {error && <div className="alert alert-error" style={{ fontSize: 13 }}>{error}</div>}

      {nothing && (
        <div className="empty-state">
          <Users size={30} />
          <strong>אין אירועים או חוגים היום</strong>
        </div>
      )}

      {data.activities.map((activity) => (
        <div key={activity.activity_id} className="card card-p" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ fontWeight: 700 }}>
              {activity.name}
              <span style={{ fontWeight: 500, fontSize: 12, color: 'var(--text-3)' }}>
                {' · '}{timeLabel(activity.start_time, activity.end_time)}
              </span>
            </div>
            {activity.needs.length > 0 && (
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {activity.needs.map((need) => (
                  <span key={need.role} className="badge badge-gray">{need.role} ×{need.count}</span>
                ))}
              </div>
            )}
          </div>

          {activity.placed.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>אף אחד לא משובץ לאירוע הזה.</div>
          ) : activity.placed.map((person) => {
            const key = `${activity.activity_id}:${person.employee_id}`;
            const working = busy === key;
            return (
              <div key={person.employee_id} style={{
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)',
              }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{person.name}</span>
                {person.role && <span className="badge badge-gray">{person.role}</span>}
                {person.substitute_for && (
                  <span className="badge badge-blue">מחליף</span>
                )}
                {person.substituted_by && (
                  <span className="badge badge-amber">הוחלף</span>
                )}
                <div style={{ display: 'flex', gap: 5, marginInlineStart: 'auto' }}>
                  {working ? <Loader2 size={14} className="spin" /> : (
                    <>
                      <button
                        className={`btn btn-sm ${person.status === 'present' ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => mark(activity.activity_id, person, 'present')}
                      >
                        <Check size={13} /> {STATUS_META.present.label}
                      </button>
                      <button
                        className={`btn btn-sm ${person.status === 'absent' ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => mark(activity.activity_id, person, 'absent')}
                      >
                        <X size={13} /> {STATUS_META.absent.label}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => { setSubFor(subFor === key ? null : key); setSubId(''); }}
                        title="מישהו אחר הגיע במקומו"
                      >
                        <UserMinus size={13} /> החלפה
                      </button>
                    </>
                  )}
                </div>

                {subFor === key && (
                  <div style={{ display: 'flex', gap: 6, width: '100%', alignItems: 'center', marginTop: 6 }}>
                    <AppSelect value={subId} onChange={(e) => setSubId(e.target.value)}>
                      <option value="">מי הגיע במקומו?</option>
                      {employees
                        .filter((e) => String(e.id) !== String(person.employee_id))
                        .map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </AppSelect>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={!subId}
                      onClick={() => substitute(activity.activity_id, person)}
                    >
                      רישום החלפה
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {data.classes.length > 0 && (
        <div className="card card-p" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontWeight: 700 }}>חוגים היום</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            נוכחות צוות בחוג נסמנת בגיליון הנוכחות של החוג, על ידי המדריך.
          </div>
          {data.classes.map((row) => (
            <div key={row.group_id} style={{
              display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
              padding: '7px 10px', borderRadius: 10, border: '1px solid var(--border)',
            }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{row.name}</span>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{row.time}</span>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginInlineStart: 'auto' }}>
                {row.placed.length === 0
                  ? <span className="badge badge-red">לא משובץ</span>
                  : row.placed.map((person) => (
                    <span
                      key={person.employee_id}
                      className={`badge ${person.status === 'present' ? 'badge-green'
                        : person.status === 'absent' ? 'badge-red'
                          : person.status === 'substituted' ? 'badge-amber' : 'badge-gray'}`}
                    >
                      {person.name}
                      {person.status ? ` · ${STATUS_META[person.status]?.label || ''}` : ''}
                    </span>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
