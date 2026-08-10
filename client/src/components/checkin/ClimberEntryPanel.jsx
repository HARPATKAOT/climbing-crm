import React, { useEffect, useRef, useState } from 'react';
import { CalendarClock, LogIn, Search, ShieldAlert, ShieldCheck, Ticket, UserPlus } from 'lucide-react';

function DocumentsBadge({ documents }) {
  if (!documents) return <span className="badge badge-gray">בודק מסמכים...</span>;
  if (documents.state === 'valid') return <span className="badge badge-green"><ShieldCheck size={12} /> מסמכים בתוקף</span>;
  if (documents.state === 'expired') return <span className="badge badge-amber"><ShieldAlert size={12} /> {documents.label}</span>;
  return <span className="badge badge-red"><ShieldAlert size={12} /> {documents.label}</span>;
}

/**
 * חיפוש מתאמן. משמש לניקוב עבור חבר על כרטיסייה מועברת, וגם כבורר הלקוח
 * למי שאין לו הרשאת מכירה ולכן לא רואה את מסך הקופה.
 */
export function ClimberPicker({
  students, exclude = [], onPick, placeholder = 'שם החבר שנכנס...', size = 'sm',
}) {
  const [query, setQuery] = useState('');
  const term = query.trim().toLowerCase();
  const excluded = new Set(exclude.map(String));
  const hits = term
    ? students.filter((s) => !excluded.has(String(s.id)) && String(s.name || '').toLowerCase().includes(term)).slice(0, 5)
    : [];
  return (
    <div style={{ position: 'relative' }}>
      <div className="input-icon-wrap">
        <Search size={size === 'sm' ? 14 : 16} className="input-icon" />
        <input
          className={size === 'sm' ? 'input input-sm' : 'input'}
          style={size === 'sm' ? { paddingRight: 32 } : { paddingRight: 36, fontSize: 17, height: 48 }}
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {hits.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, left: 0, zIndex: 60,
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
          marginTop: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden',
        }}>
          {hits.map((s) => (
            <div
              key={s.id}
              onClick={() => { onPick(s); setQuery(''); }}
              style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 13 }}
            >
              {s.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * אישור הכניסה של המתאמן שנבחר בקופה.
 *
 * החלונית יושבת מתחת ללקוח במסך המכירה, כדי שבחירת הלקוח, מצב המסמכים,
 * הכרטיסייה והקופה יהיו כולם על מסך אחד — הדלפקיסט לא מחליף מסכים באמצע
 * שיחה עם מי שעומד מולו.
 */
export default function ClimberEntryPanel({ studentId, students = [], groups = [], onEntered }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [entered, setEntered] = useState(false);
  const [guests, setGuests] = useState([]);
  const requestRef = useRef(0);

  const load = async (id) => {
    const ticket = ++requestRef.current;
    setLoading(true);
    try {
      const data = await fetch(`/api/checkin/climber/${encodeURIComponent(id)}`)
        .then((r) => (r.ok ? r.json() : null));
      if (ticket === requestRef.current) setSummary(data);
    } catch {
      if (ticket === requestRef.current) setSummary(null);
    } finally {
      if (ticket === requestRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    setEntered(false);
    setGuests([]);
    if (!studentId) {
      setSummary(null);
      requestRef.current += 1;
      return;
    }
    load(studentId);
  }, [studentId]);

  if (!studentId) return null;

  const registerEntry = async (climber, passId) => {
    const group = groups.find((g) => g.id === climber.groupId);
    const res = await fetch('/api/check-ins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        climber_id: climber.id,
        climber_name: climber.name,
        group_name: group ? group.name : 'טיפוס חופשי',
        timestamp: new Date().toISOString(),
      }),
    });
    if (!res.ok) throw new Error('רישום הכניסה נכשל');

    let note = '';
    let refusal = null;
    if (passId) {
      const punchRes = await fetch(`/api/pos/passes/${passId}/punch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'check_in', student_id: climber.id }),
      });
      const punchData = await punchRes.json().catch(() => ({}));
      if (punchRes.ok) {
        note = ` · נשארו ${punchData.pass?.visits_remaining} כניסות`;
        if (punchData.safetyNote) note += ` · ⚠ ${punchData.safetyNote}`;
      } else if (punchData.error) {
        refusal = punchData.error;
      }
    }
    return { name: climber.name, note, refusal };
  };

  const punch = summary?.best_punch;
  const membership = summary?.membership;
  const climber = summary?.student
    || students.find((s) => String(s.id) === String(studentId))
    || null;

  const confirmEntry = async () => {
    if (!climber || busy) return;
    setBusy(true);
    try {
      const result = await registerEntry(climber, punch?.id);
      onEntered(result);
      if (!result.refusal) setEntered(true);
      await load(studentId);
    } catch (err) {
      onEntered({ name: climber.name, refusal: err.message });
    } finally {
      setBusy(false);
    }
  };

  const punchForGuest = async (guest) => {
    if (!punch || busy) return;
    setBusy(true);
    try {
      const result = await registerEntry(guest, punch.id);
      onEntered(result);
      setGuests((prev) => [...prev, { name: guest.name, refusal: result.refusal }]);
      await load(studentId);
    } catch (err) {
      onEntered({ name: guest.name, refusal: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="form-group"
      style={{
        marginBottom: 12, padding: 12, borderRadius: 12,
        background: 'rgba(45,212,191,0.05)', border: '1px solid rgba(45,212,191,0.3)',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: '#2DD4BF' }}>
        <LogIn size={15} /> כניסה לקיר
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)' }}>
        <CalendarClock size={13} />
        {loading ? 'טוען היסטוריה...' : (summary?.last_visit?.label || 'לא נרשמה כניסה קודמת')}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <DocumentsBadge documents={summary?.documents} />
        {summary?.safety && summary.safety.state !== 'valid' && (
          <span className="badge badge-amber">
            <ShieldAlert size={12} /> {summary.safety.state === 'missing' ? 'אין מבחן אבטחה' : 'מבחן אבטחה פג'}
          </span>
        )}
      </div>

      <div style={{ fontSize: 12.5, padding: '8px 10px', borderRadius: 8, background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
        {punch ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Ticket size={13} /> <strong>{punch.name}</strong>
              {punch.transferable && (
                <span className="badge" style={{ fontSize: 10, background: 'rgba(167,139,250,0.15)', color: '#A78BFA' }}>מועברת</span>
              )}
            </div>
            <div style={{ color: 'var(--text-3)', marginTop: 3 }}>
              נשארו {punch.visits_remaining} מתוך {punch.visits_total}
              {punch.valid_until ? ` · עד ${punch.valid_until}` : ''}
            </div>
          </>
        ) : membership ? (
          <div>מנוי: <strong>{membership.name}</strong>{membership.valid_until ? ` · עד ${membership.valid_until}` : ''}</div>
        ) : (
          <div style={{ color: 'var(--text-3)' }}>אין כרטיסייה או מנוי פעיל — מכרו כניסה בעגלה שמשמאל</div>
        )}
      </div>

      {summary?.punch_block_reason && (
        <div className="alert alert-error" style={{ fontSize: 12.5, margin: 0 }}>{summary.punch_block_reason}</div>
      )}

      <button
        type="button"
        className={entered ? 'btn btn-secondary btn-full' : 'btn btn-primary btn-full'}
        style={{ minHeight: 42, fontWeight: 700 }}
        disabled={busy || loading}
        onClick={confirmEntry}
      >
        {entered ? 'רישום כניסה נוספת' : punch ? 'אישור כניסה וניקוב' : 'אישור כניסה'}
      </button>

      {punch?.transferable && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <UserPlus size={13} /> ניקוב נוסף על אותה כרטיסייה — לחבר שבא יחד
          </div>
          <ClimberPicker students={students} exclude={[studentId]} onPick={punchForGuest} />
          {guests.map((g, i) => (
            <div key={`${g.name}-${i}`} style={{ fontSize: 11.5, color: g.refusal ? 'var(--red)' : 'var(--text-3)' }}>
              {g.refusal ? `${g.name} — ${g.refusal}` : `✓ ${g.name} נוקב`}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
