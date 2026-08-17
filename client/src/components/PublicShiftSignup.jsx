/**
 * The link the staff get instead of a WhatsApp poll: pick who you are, then for
 * each shift say which role you would come in. Nothing here places anyone — a
 * claim is an offer, and the manager turns it into a shift on the roster.
 *
 * The role matters and cannot be inferred: eight of the twenty-three staff hold
 * four roles each, and the role is what decides the rate they are paid. So the
 * form shows each person only the seats they are marked for, and a shift with
 * none of their roles says so rather than disappearing.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarCheck, Check, CheckCircle, Loader2 } from 'lucide-react';
import { useBusinessProfile } from '../BusinessProfileContext.jsx';
import { EventStyles } from './publicFormKit.jsx';
import AppSelect from './AppSelect.jsx';
import { roleIcon, roleColor } from '../utils/roleIcons.js';

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
  // כמה מהמשמרות שסומנו העובד באמת רוצה. 0 = לא ענה, ואז הסימון הוא כל מה שיש.
  const [wanted, setWanted] = useState(0);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  // המפתח האישי שבקישור. מי שקיבל אותו בוואטסאפ מזוהה בלי לבחור שם מרשימה.
  const personalKey = new URLSearchParams(window.location.search).get('u') || '';

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/public/shift-signup/${encodeURIComponent(token)}${personalKey ? `?u=${encodeURIComponent(personalKey)}` : ''}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) {
          setError(body.error || 'הטופס לא נמצא');
          return;
        }
        setData(body);
        // קישור אישי פותח את הטופס על השם של מי שקיבל אותו, כולל מה שכבר ענה.
        if (body.me) {
          setEmployeeId(body.me);
          const mine = (body.mine || []).find((row) => String(row.employee_id) === String(body.me));
          setPicked(mine?.picks || []);
          setWanted(mine?.wanted_count || 0);
          setNote(mine?.note || '');
        }
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
    setPicked(mine?.picks || []);
    setWanted(mine?.wanted_count || 0);
    setNote(mine?.note || '');
  };

  /** התפקידים שהעובד הנוכחי מסומן בהם. מהם נגזר מה הוא יכול לקחת. */
  const myRoles = useMemo(() => {
    const me = (data?.eligible || []).find((e) => String(e.id) === String(employeeId));
    return me?.roles || [];
  }, [data, employeeId]);

  const canTake = (role) => !role || myRoles.includes(role);
  const claimOf = (slotId) => picked.find((p) => p.slot_id === slotId) || null;

  /**
   * לחיצה על תפקיד היא הבחירה כולה: איזו משמרת, ובאיזה כובע.
   * לחיצה על אותו תפקיד מבטלת; לחיצה על תפקיד אחר באותה משמרת מחליפה, כי אי
   * אפשר לעבוד בשני תפקידים באותה שעה.
   */
  const claimSeat = (slotId, role) => {
    setPicked((current) => {
      const mine = current.find((p) => p.slot_id === slotId);
      const next = mine && mine.role === role
        ? current.filter((p) => p.slot_id !== slotId)
        : [...current.filter((p) => p.slot_id !== slotId), { slot_id: slotId, role }];
      // „רוצה 4” אחרי שירדנו לשלוש בחירות הוא בקשה למשמרת שלא נבחרה.
      setWanted((n) => (n > next.length ? next.length : n));
      return next;
    });
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
        body: JSON.stringify({
          employee_id: employeeId, picks: picked, wanted_count: wanted, note,
          u: personalKey || undefined,
        }),
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
              : `סימנת ${picked.length} משמרות${wanted ? `, ורוצה ${wanted} מהן` : ''}. השיבוץ הסופי יישלח אליך בהמשך.`}
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
            <span>{(data.slots || []).length} משמרות</span>
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
              {/* קישור אישי כבר יודע מי זה. בורר במקרה כזה הוא לא נוחות אלא
                  הזמנה לענות בשם מישהו אחר. */}
              {data.me ? (
                <div className="event-body" style={{ fontWeight: 700, fontSize: 17 }}>
                  {(data.eligible || []).find((e) => String(e.id) === String(data.me))?.name || ''}
                </div>
              ) : (
                <AppSelect value={employeeId} onChange={(e) => chooseEmployee(e.target.value)}>
                  <option value="">בחרו את השם שלכם...</option>
                  {(data.eligible || []).map((employee) => (
                    <option key={employee.id} value={employee.id}>{employee.name}</option>
                  ))}
                </AppSelect>
              )}
              {(data.eligible || []).length === 0 && (
                <p className="event-hint" style={{ marginTop: 10 }}>
                  אין עובדים פעילים ברשימת הטופס — דברו עם המנהל.
                </p>
              )}
            </section>

            <section>
              <h2 style={{ padding: 0 }}>מה מתאים לכם?</h2>
              <p className="event-hint">
                {employeeId
                  ? 'לכל משמרת בחרו באיזה תפקיד תבואו. אפשר לסמן יותר ממה שצריך — זו זמינות, לא שיבוץ.'
                  : 'קודם בחרו את השם שלכם, ואז יוצגו התפקידים שאתם יכולים לקחת בכל משמרת.'}
              </p>
              <div className="shift-rows">
                {slots.map((slot) => {
                  const claim = claimOf(slot.id);
                  // תפקיד שהעובד לא מסומן בו מוצג ולא נעלם: „למה אני לא רואה את
                  // יום שלישי” היא שאלה גרועה יותר מ„למה אני לא יכול לקחת אותו”.
                  const mine = (slot.needs || []).filter((need) => canTake(need.role));
                  return (
                    <div key={slot.id} className={`shift-row-card ${claim ? 'is-on' : ''}`}>
                      <div className="shift-row-day">
                        {dayLabel(slot.date)}{slot.label ? ` · ${slot.label}` : ''}
                      </div>
                      <div className="shift-row-meta">{slot.start_time}–{slot.end_time}</div>
                      <div className="seat-row">
                        {(slot.needs || []).map((need) => {
                          const on = claim?.role === (need.role || '');
                          const allowed = canTake(need.role);
                          const Icon = roleIcon(need.role);
                          return (
                            <button
                              type="button"
                              key={need.role || 'any'}
                              className={`seat-pill ${on ? 'is-on' : ''} ${allowed ? '' : 'is-off'}`}
                              // גוון התפקיד, אותו אחד שבכרטיס העובד. כשמסמנים,
                              // הוא הופך לרקע — כך רואים מרחוק מה נבחר.
                              style={{ '--seat-accent': roleColor(need.role) }}
                              disabled={!allowed || !employeeId}
                              aria-pressed={on}
                              title={allowed
                                ? undefined
                                : `התפקיד „${need.role}” לא מסומן אצלכם בכרטיס העובד`}
                              onClick={() => claimSeat(slot.id, need.role || '')}
                            >
                              {on ? <Check size={13} /> : <Icon size={13} aria-hidden="true" />}
                              {need.role || 'משמרת'}
                              <span className="seat-count">
                                {need.taken > 0 ? `${need.taken}/${need.count}` : `דרושים ${need.count}`}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      {employeeId && mine.length === 0 && (
                        <div className="shift-row-meta">אין כאן תפקיד שמסומן אצלכם.</div>
                      )}
                    </div>
                  );
                })}
                {slots.length === 0 && (
                  <p className="event-hint">אין משמרות פתוחות בטופס הזה.</p>
                )}
              </div>
            </section>

            {/* כמה מהסימונים הם באמת בקשה. רוב האנשים מסמנים כל מה שהם *יכולים*,
                וזה נקרא כמו בקשה לכל אחת מהן — כאן הם אומרים כמה הם רוצים. */}
            {picked.length > 1 && (
              <section>
                <h2 style={{ padding: 0 }}>כמה מהן אתם רוצים?</h2>
                <p className="event-hint">
                  סימנתם {picked.length} משמרות אפשריות. כמה מהן אתם רוצים בפועל?
                </p>
                <div className="want-row">
                  {Array.from({ length: picked.length }, (_, index) => index + 1).map((n) => (
                    <button
                      type="button"
                      key={n}
                      className={`want-pill ${wanted === n ? 'is-on' : ''}`}
                      onClick={() => setWanted(wanted === n ? 0 : n)}
                    >
                      {n}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`want-pill ${wanted === 0 ? 'is-on' : ''}`}
                    onClick={() => setWanted(0)}
                  >
                    כמה שיש
                  </button>
                </div>
              </section>
            )}

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
        /* כרטיס למשמרת, ובתוכו כפתור לכל תפקיד. הבחירה היא „באיזה כובע אני בא”,
           ולכן היא שייכת לתפקיד ולא לשורת המשמרת כולה. */
        .shift-row-card{display:flex;flex-direction:column;gap:7px;padding:13px 14px;border-radius:13px;
          border:1px solid rgba(255,255,255,.13);background:rgba(255,255,255,.04);
          transition:border-color .14s ease,background .14s ease}
        .shift-row-card.is-on{border-color:var(--form-accent-solid,#38bdf8);
          background:var(--form-accent-soft-strong,rgba(56,189,248,.14))}
        .seat-row{display:flex;flex-wrap:wrap;gap:7px;margin-top:2px}
        .seat-pill{--seat-accent:#94a3b8;
          display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:10px;
          font:inherit;font-size:13px;font-weight:700;cursor:pointer;
          border:1px solid color-mix(in srgb, var(--seat-accent) 34%, transparent);
          background:color-mix(in srgb, var(--seat-accent) 12%, transparent);color:#e2e8f0}
        .seat-pill svg{color:var(--seat-accent);flex-shrink:0}
        .seat-pill.is-on{border-color:var(--seat-accent);background:var(--seat-accent);color:#0b1220}
        .seat-pill.is-on svg{color:#0b1220}
        .seat-pill.is-off{opacity:.4;cursor:not-allowed}
        .seat-pill:disabled{cursor:not-allowed}
        .seat-count{font-weight:500;font-size:11.5px;opacity:.75}
        .want-row{display:flex;flex-wrap:wrap;gap:8px}
        .want-pill{min-width:44px;padding:10px 14px;border-radius:11px;font:inherit;font-weight:700;
          cursor:pointer;border:1px solid rgba(255,255,255,.13);background:rgba(255,255,255,.04);color:#e2e8f0}
        .want-pill.is-on{border-color:var(--form-accent-solid,#38bdf8);
          background:var(--form-accent-soft-strong,rgba(56,189,248,.18));color:#fff}
      `}</style>
    </div>
  );
}
