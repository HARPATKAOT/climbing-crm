/**
 * טופס שיבוץ מהיומן — יומן, לא רשימה.
 *
 * המנהל בחר אילו אירועים להציע, והעובד רואה אותם במקום שבו הם קיימים: רשת
 * חודשית עם כותרות האירועים בצבע הסוג שלהם, בדיוק כמו במסך היומן. רשימת שורות
 * מתארת את היומן; זה היומן.
 *
 * קליק שמאלי לוקח מקום, קליק ימני מחזיר אותו, ועל כרטיס שנבחר יש × גלוי — כי
 * הקישור נפתח מוואטסאפ, ובטלפון אין קליק ימני.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, Check, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import MonthGrid, { monthLabelOf } from './calendar/MonthGrid.jsx';
import { roleIcon } from '../utils/roleIcons.js';

export default function PublicCalendarSignup({
  data,
  picks,
  onClaim,
  onClear,
  employee,
  canFill,
  note,
  onNote,
  onSubmit,
  submitting,
  error,
  wanted,
  onWanted,
}) {
  const slots = useMemo(() => data.slots || [], [data.slots]);
  // הלוח נפתח על החודש של המשמרת הראשונה שמוצעת, ולא על החודש הנוכחי: טופס
  // לחודש הבא היה נפתח על דף ריק.
  const [cursor, setCursor] = useState(() => {
    const first = slots[0]?.date;
    return first ? new Date(`${first}T12:00:00`) : new Date();
  });
  const [openSlot, setOpenSlot] = useState('');
  const [compact, setCompact] = useState(() => (typeof window !== 'undefined' && window.innerWidth < 720));

  useEffect(() => {
    const onResize = () => setCompact(window.innerWidth < 720);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const byDate = useMemo(() => {
    const map = new Map();
    for (const slot of slots) {
      const list = map.get(slot.date) || [];
      list.push(slot);
      map.set(slot.date, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.start_time.localeCompare(b.start_time));
    return map;
  }, [slots]);

  const pickOf = (slotId) => picks.find((p) => p.slot_id === slotId) || null;
  const monthShift = (delta) => setCursor((prev) => {
    const next = new Date(prev);
    next.setMonth(next.getMonth() + delta);
    return next;
  });

  /** הכרטיס של משמרת אחת — זהה בשתי התצוגות. */
  const renderSlot = (slot) => {
              const mine = pickOf(slot.id);
              const open = openSlot === slot.id;
              const colour = slot.type_color || '#94A3B8';
              return (
                <div key={slot.id}>
                  <button
                    type="button"
                    className={`cal-signup-event ${mine ? 'is-mine' : ''}`}
                    style={{
                      '--ev-color': colour,
                      '--ev-bg': mine ? colour : (slot.type_bg || 'rgba(148,163,184,0.16)'),
                    }}
                    title={`${slot.start_time}–${slot.end_time} · ${slot.label || ''}`}
                    onClick={() => {
                      if (!employee) return;
                      const roles = (slot.needs || []).filter((need) => canFill(need.role));
                      if (!mine && roles.length === 1) onClaim(slot.id, roles[0].role);
                      else setOpenSlot(open ? '' : slot.id);
                    }}
                    onContextMenu={(e) => { e.preventDefault(); onClear(slot.id); }}
                  >
                    <span className="cal-signup-time">{slot.start_time}</span>
                    <span className="cal-signup-name">{slot.label || slot.type_label}</span>
                    {mine && <Check size={10} />}
                  </button>

                  {mine && (
                    <button
                      type="button"
                      className="cal-signup-clear"
                      onClick={() => onClear(slot.id)}
                    >
                      {mine.role} <X size={9} />
                    </button>
                  )}

                  {open && !mine && (
                    <div className="cal-signup-roles">
                      {(slot.needs || []).map((need) => {
                        const RoleIcon = roleIcon(need.role);
                        const allowed = canFill(need.role);
                        return (
                          <button
                            type="button"
                            key={need.role || 'any'}
                            className={`cal-signup-role ${allowed ? '' : 'is-off'}`}
                            disabled={!allowed}
                            title={allowed
                              ? `${need.role} · דרושים ${need.count}, סימנו ${need.taken}`
                              : `אינך מסומן כ„${need.role}” בכרטיס העובד`}
                            onClick={() => { onClaim(slot.id, need.role); setOpenSlot(''); }}
                          >
                            <RoleIcon size={9} /> {need.role || 'מי שמתאים'}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
  };

  return (
    <>
      <section>
        <h2 style={{ padding: 0 }}>מה מתאים לכם?</h2>
        <p className="event-hint">
          לחיצה על אירוע בוחרת תפקיד, לחיצה ימנית או ה-× מסירים את הבחירה. סימון
          הוא זמינות ולא שיבוץ — מי שישובץ יקבל הודעה.
        </p>

        <div className="cal-signup">
          {!compact && (
            <div className="cal-signup-head">
              <button type="button" onClick={() => monthShift(-1)} aria-label="חודש קודם">
                <ChevronRight size={16} />
              </button>
              <span>{monthLabelOf(cursor)}</span>
              <button type="button" onClick={() => monthShift(1)} aria-label="חודש הבא">
                <ChevronLeft size={16} />
              </button>
            </div>
          )}

          {compact ? (
            <div className="cal-agenda">
              {[...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => (
                <div key={date} className="cal-agenda-day">
                  <div className="cal-agenda-date">
                    {new Date(`${date}T12:00:00`).toLocaleDateString('he-IL', {
                      weekday: 'long', day: 'numeric', month: 'numeric',
                    })}
                  </div>
                  <div className="cal-agenda-events">{list.map((slot) => renderSlot(slot))}</div>
                </div>
              ))}
              {byDate.size === 0 && <p className="event-hint">אין משמרות פתוחות בטופס הזה.</p>}
            </div>
          ) : (
          <MonthGrid
            cursor={cursor}
            byDate={byDate}
            renderEvent={(slot) => renderSlot(slot)}
          />
          )}
        </div>

        {/* היום בלוח צר, ולכן מה שנבחר מסוכם גם כרשימה קריאה. */}
        <div className="cal-signup-summary">
          {picks.length === 0 ? (
            <span className="event-hint">עוד לא סימנתם משמרות.</span>
          ) : picks.map((pick) => {
            const slot = slots.find((s) => s.id === pick.slot_id);
            if (!slot) return null;
            return (
              <span key={pick.slot_id} className="cal-signup-chip">
                {new Date(`${slot.date}T12:00:00`).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })}
                {' · '}{slot.start_time} · {pick.role}
                <button type="button" onClick={() => onClear(pick.slot_id)} title="הסרה"><X size={11} /></button>
              </span>
            );
          })}
        </div>

        {picks.length > 1 && (
          <div style={{ marginTop: 12 }}>
            <label className="event-label">כמה מהן אתם רוצים בפועל?</label>
            <div className="event-day-chips">
              <button
                type="button"
                className={`event-day-chip ${wanted === 0 ? 'is-on' : ''}`}
                onClick={() => onWanted(0)}
              >
                כמה שיש
              </button>
              {Array.from({ length: picks.length }, (_, i) => i + 1).map((n) => (
                <button
                  type="button"
                  key={n}
                  className={`event-day-chip ${wanted === n ? 'is-on' : ''}`}
                  onClick={() => onWanted(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section>
        <label className="event-field">
          <span>הערה למנהל (לא חובה)</span>
          <input value={note} onChange={(e) => onNote(e.target.value)} placeholder="למשל: אוכל להישאר גם אחרי" />
        </label>
      </section>

      {error && <div className="event-error">{error}</div>}

      <div className="event-actions">
        <button type="button" className="event-primary" disabled={submitting || !employee} onClick={onSubmit}>
          {submitting ? <Loader2 size={17} className="spin" /> : <CalendarCheck size={17} />}
          {submitting ? 'שולח...' : 'שליחת הזמינות'}
        </button>
      </div>

      <style>{`
        .cal-signup{padding:0 24px;margin-top:10px}
        .cal-signup-head{display:flex;align-items:center;justify-content:center;gap:14px;
          margin-bottom:8px;font-size:15px;font-weight:800;color:#fff}
        .cal-signup-head button{display:inline-flex;align-items:center;justify-content:center;
          width:28px;height:28px;border-radius:9px;cursor:pointer;
          border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e2e8f0}
        .cal-signup-event{display:flex;align-items:center;gap:3px;width:100%;text-align:right;
          font:inherit;font-size:9.5px;font-weight:700;cursor:pointer;padding:2px 4px;border-radius:5px;
          border:1px solid var(--ev-color);background:var(--ev-bg);color:var(--ev-color);
          overflow:hidden;white-space:nowrap}
        .cal-signup-event.is-mine{color:#0b1220}
        .cal-signup-time{opacity:.8;flex-shrink:0}
        .cal-signup-name{overflow:hidden;text-overflow:ellipsis}
        .cal-signup-clear{display:flex;align-items:center;gap:3px;width:100%;margin-top:2px;
          font:inherit;font-size:9px;font-weight:800;cursor:pointer;padding:1px 4px;border-radius:5px;
          border:0;background:var(--form-accent-solid,#38bdf8);color:#0b1220}
        .cal-signup-roles{display:flex;flex-direction:column;gap:2px;margin-top:2px}
        .cal-signup-role{display:flex;align-items:center;gap:3px;font:inherit;font-size:9px;font-weight:700;
          padding:2px 5px;border-radius:999px;cursor:pointer;
          border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.12);color:#fff}
        .cal-signup-role.is-off{opacity:.4;cursor:not-allowed;text-decoration:line-through}
        .cal-agenda{display:flex;flex-direction:column;gap:12px}
        .cal-agenda-day{border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:9px 11px;
          background:rgba(0,0,0,.18)}
        .cal-agenda-date{font-size:13px;font-weight:800;color:#fff;margin-bottom:6px}
        .cal-agenda-events{display:flex;flex-direction:column;gap:5px}
        .cal-agenda .cal-signup-event{font-size:12.5px;padding:6px 9px;border-radius:9px}
        .cal-agenda .cal-signup-clear{font-size:11px;padding:3px 8px}
        .cal-agenda .cal-signup-role{font-size:11px;padding:3px 8px}
        .cal-signup-summary{display:flex;flex-wrap:wrap;gap:6px;padding:12px 24px 0}
        .cal-signup-chip{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;
          padding:4px 9px;border-radius:999px;color:var(--form-accent-text,#7dd3fc);
          background:var(--form-accent-soft-strong,rgba(56,189,248,.18));
          border:1px solid var(--form-accent-border,rgba(56,189,248,.45))}
        .cal-signup-chip button{display:inline-flex;border:0;background:none;color:inherit;cursor:pointer;padding:0}
      `}</style>
    </>
  );
}
