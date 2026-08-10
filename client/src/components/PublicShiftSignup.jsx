/**
 * The link the staff get instead of a WhatsApp poll: pick who you are, tick the
 * shifts that suit you, send. Nothing here places anyone — a tick is an offer,
 * and the manager is the one who turns it into a shift on the roster.
 */
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarCheck, Check, CheckCircle, Loader2 } from 'lucide-react';
import { useBusinessProfile } from '../BusinessProfileContext.jsx';
import { EventStyles } from './publicFormKit.jsx';
import AppSelect from './AppSelect.jsx';

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

function dayLabel(dateStr) {
  const date = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return `יום ${DAY_NAMES[date.getDay()]} · ${date.getDate()}.${date.getMonth() + 1}`;
}

export default function PublicShiftSignup() {
  const { profile } = useBusinessProfile();
  const brandName = profile.display_name || 'הרפתקאות';
  const brandLogo = profile.logo_url || '/logo.png';
  const { token = '' } = useParams();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [employeeId, setEmployeeId] = useState('');
  const [picked, setPicked] = useState([]);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/shift-signup/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) {
          setError(body.error || 'הטופס לא נמצא');
          return;
        }
        setData(body);
      })
      .catch(() => { if (!cancelled) setError('שגיאת רשת — נסו שוב'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  /**
   * Choosing a name loads whatever that person already answered. Without it a
   * correction would start from an empty form and silently erase the earlier
   * picks, since a submission replaces the previous one.
   */
  const chooseEmployee = (id) => {
    setEmployeeId(id);
    const mine = (data?.mine || []).find((row) => String(row.employee_id) === String(id));
    setPicked(mine?.slot_ids || []);
    setNote(mine?.note || '');
  };

  const toggleSlot = (slotId) => {
    setPicked((current) => (current.includes(slotId)
      ? current.filter((id) => id !== slotId)
      : [...current, slotId]));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    if (!employeeId) {
      setError('בחרו את השם שלכם');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const response = await fetch(`/api/public/shift-signup/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: employeeId, slot_ids: picked, note }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error || 'השליחה נכשלה');
        return;
      }
      setDone(true);
    } catch {
      setError('שגיאת רשת — נסו שוב');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="event-page">
        <div className="event-card event-centered">
          <Loader2 size={28} className="spin" />
          <p style={{ color: 'rgba(255,255,255,.7)', marginTop: 12 }}>טוען טופס...</p>
        </div>
        <EventStyles />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="event-page">
        <div className="event-card event-centered">
          <h1 style={{ fontSize: 22 }}>{error || 'הטופס לא נמצא'}</h1>
          <p style={{ color: 'rgba(255,255,255,.6)', fontSize: 14 }}>בדקו את הקישור מול המנהל.</p>
        </div>
        <EventStyles />
      </div>
    );
  }

  if (done) {
    return (
      <div className="event-page">
        <div className="event-card event-centered">
          <CheckCircle size={58} color="#38bdf8" style={{ margin: '0 auto 18px' }} />
          <h1 style={{ fontSize: 24, marginBottom: 8 }}>נרשם, תודה!</h1>
          <p style={{ color: 'rgba(255,255,255,.7)', fontSize: 15, lineHeight: 1.6 }}>
            {picked.length === 0
              ? 'רשמנו שאף אחת מהמשמרות לא מתאימה לך.'
              : `סימנת ${picked.length} משמרות. השיבוץ הסופי יישלח אליך בהמשך.`}
          </p>
          <button
            type="button"
            className="event-secondary"
            style={{ margin: '18px auto 0' }}
            onClick={() => { setDone(false); }}
          >
            לשינוי הבחירה
          </button>
        </div>
        <EventStyles />
      </div>
    );
  }

  const slots = data.slots || [];

  return (
    <div className="event-page">
      <div className="event-card">
        <div className="event-hero">
          <div className="event-brand-logo"><img src={brandLogo} alt={brandName} /></div>
          <div className="event-brand">הרשמה למשמרות</div>
          <h1>{data.title}</h1>
          <div className="event-meta">
            <span>תפקיד: {data.role}</span>
            {data.deadline && <span>אפשר לענות עד {dayLabel(data.deadline)}</span>}
          </div>
          {data.note && <p className="event-body">{data.note}</p>}
        </div>

        {!data.open ? (
          <section style={{ marginTop: 18 }}>
            <p className="event-hint">ההרשמה לטופס הזה נסגרה. דברו עם המנהל אם השתנה משהו.</p>
          </section>
        ) : (
          <form onSubmit={submit}>
            <section style={{ marginTop: 18 }}>
              <label className="event-label">מי ממלא?</label>
              <AppSelect value={employeeId} onChange={(e) => chooseEmployee(e.target.value)}>
                <option value="">בחרו את השם שלכם...</option>
                {(data.eligible || []).map((employee) => (
                  <option key={employee.id} value={employee.id}>{employee.name}</option>
                ))}
              </AppSelect>
              {(data.eligible || []).length === 0 && (
                <p className="event-hint" style={{ marginTop: 10 }}>
                  אף עובד לא מסומן בתפקיד „{data.role}” — צריך לסמן את התפקיד בכרטיס העובד.
                </p>
              )}
            </section>

            <section>
              <h2 style={{ padding: 0 }}>סמנו את המשמרות שמתאימות</h2>
              <p className="event-hint">
                אפשר לסמן יותר ממה שצריך — סימון הוא זמינות, לא שיבוץ. מי שישובץ בפועל יקבל הודעה.
              </p>
              <div className="shift-rows">
                {slots.map((slot) => {
                  const on = picked.includes(slot.id);
                  return (
                    <button
                      type="button"
                      key={slot.id}
                      className={`shift-row ${on ? 'is-on' : ''}`}
                      onClick={() => toggleSlot(slot.id)}
                      aria-pressed={on}
                    >
                      <span className="shift-row-mark">{on ? <Check size={15} /> : null}</span>
                      <span className="shift-row-text">
                        <span className="shift-row-day">
                          {dayLabel(slot.date)}{slot.label ? ` · ${slot.label}` : ''}
                        </span>
                        <span className="shift-row-meta">
                          {slot.start_time}–{slot.end_time} · דרושים {slot.capacity} · סימנו {slot.taken}
                        </span>
                      </span>
                    </button>
                  );
                })}
                {slots.length === 0 && (
                  <p className="event-hint">אין משמרות פתוחות בטופס הזה.</p>
                )}
              </div>
            </section>

            <section>
              <label className="event-field">
                <span>הערה למנהל (לא חובה)</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="למשל: אוכל להישאר גם אחרי" />
              </label>
            </section>

            {error && <div className="event-error">{error}</div>}

            <div className="event-actions">
              <button type="submit" className="event-primary" disabled={submitting}>
                {submitting ? <Loader2 size={17} className="spin" /> : <CalendarCheck size={17} />}
                {submitting ? 'שולח...' : 'שליחת הזמינות'}
              </button>
            </div>
          </form>
        )}
      </div>
      <EventStyles />
      <style>{`
        /* שורה לכל משמרת, ולא כרטיס לכל תאריך: הטופס נפתח כמעט תמיד בטלפון,
           ורשימה אחת שאפשר לרוץ עליה עם האגודל קלה לסימון מאשר רשת אסימונים. */
        .shift-rows{display:flex;flex-direction:column;gap:8px}
        .shift-row{display:flex;align-items:center;gap:12px;width:100%;text-align:right;
          padding:13px 14px;border-radius:13px;font:inherit;cursor:pointer;
          border:1px solid rgba(255,255,255,.13);background:rgba(255,255,255,.04);color:#e2e8f0;
          transition:border-color .14s ease,background .14s ease}
        .shift-row:hover{border-color:rgba(255,255,255,.28)}
        .shift-row.is-on{border-color:var(--form-accent-solid,#38bdf8);background:var(--form-accent-soft-strong,rgba(56,189,248,.18))}
        .shift-row-mark{display:flex;align-items:center;justify-content:center;flex-shrink:0;
          width:22px;height:22px;border-radius:7px;border:1px solid rgba(255,255,255,.25);color:#0b1220}
        .shift-row.is-on .shift-row-mark{background:var(--form-accent-solid,#38bdf8);border-color:transparent}
        .shift-row-text{display:flex;flex-direction:column;gap:3px;min-width:0}
        .shift-row-day{font-weight:800;font-size:15px;color:#fff}
        .shift-row-meta{font-size:12.5px;color:#94a3b8}
        .shift-row.is-on .shift-row-meta{color:var(--form-accent-text,#7dd3fc)}
      `}</style>
    </div>
  );
}
