/**
 * טופס שיבוץ לחוגים — לוח החוגים עצמו, כפי שהעובד מכיר אותו.
 *
 * לא רשימה של שורות אלא הלוח: אותה רשת, אותם צבעים לפי שכבת גיל, אותו כרטיס.
 * עובד שראה את הלוח במסך החוגים מזהה כאן את אותו דבר, ובוחר בתוכו.
 *
 * בכל חוג מופיע כיסא לכל תפקיד שהוא צריך. כיסא בתפקיד שהעובד אינו מוסמך אליו
 * מוצג חסום ולא מוסתר — „למה אני לא רואה את החוג הזה” היא שאלה שאין לה תשובה
 * במסך, ו„אתה לא מסומן כמדריך” יש לה.
 */
import React, { useState } from 'react';
import { CalendarCheck, Check, Loader2, X } from 'lucide-react';
import ClassBoardGrid, { GroupBlock } from './schedule/ClassBoardGrid.jsx';
import { roleIcon } from '../utils/roleIcons.js';

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** המושבים כקבוצות שהרשת יודעת לצייר. */
function seatsAsGroups(seats = []) {
  return seats.map((seat) => ({
    id: seat.group_id,
    name: seat.label,
    day: seat.day,
    time: seat.time,
    duration: seat.duration,
    ageCategory: seat.ageCategory,
    seat,
  }));
}

export default function PublicClassBoardSignup({
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
}) {
  const [openSeat, setOpenSeat] = useState('');
  const groups = seatsAsGroups(data.seats);
  const pickOf = (seatId) => picks.find((p) => p.slot_id === seatId) || null;

  return (
    <>
      <section>
        <h2 style={{ padding: 0 }}>באילו חוגים תרצו להיות?</h2>
        <p className="event-hint">
          השיבוץ לחוג הוא לכל השנה. לחיצה על חוג בוחרת תפקיד, לחיצה ימנית מסירה
          את הבחירה — או כפתור ה-× שעל הכרטיס.
        </p>

        <div className="class-signup-board">
          <ClassBoardGrid
            groups={groups}
            renderBlock={(group, day) => {
              const { seat } = group;
              const mine = pickOf(seat.id);
              const open = openSeat === seat.id;
              return (
                <GroupBlock
                  key={`${seat.id}-${day}`}
                  group={group}
                  enrolledCount={null}
                  showStaff={false}
                  selected={Boolean(mine)}
                  onClick={() => {
                    if (!employee) return;
                    const roles = (seat.needs || []).filter((need) => canFill(need.role));
                    // תפקיד אחד אפשרי — לחיצה אחת מספיקה. יותר מאחד, ובוחרים.
                    if (!mine && roles.length === 1) onClaim(seat.id, roles[0].role);
                    else setOpenSeat(open ? '' : seat.id);
                  }}
                  onContextMenu={(e) => { e.preventDefault(); onClear(seat.id); }}
                >
                  {mine && (
                    <div className="class-seat-mine">
                      <Check size={10} /> {mine.role}
                      <button
                        type="button"
                        className="class-seat-clear"
                        title="הסרת הבחירה"
                        onClick={(e) => { e.stopPropagation(); onClear(seat.id); }}
                      >
                        <X size={10} />
                      </button>
                    </div>
                  )}
                  {open && !mine && (
                    <div className="class-seat-roles" onClick={(e) => e.stopPropagation()}>
                      {(seat.needs || []).map((need) => {
                        const RoleIcon = roleIcon(need.role);
                        const allowed = canFill(need.role);
                        return (
                          <button
                            type="button"
                            key={need.role || 'any'}
                            className={`class-seat-pill ${allowed ? '' : 'is-off'}`}
                            disabled={!allowed}
                            title={allowed
                              ? `${need.role} · דרושים ${need.count}, סימנו ${need.taken}`
                              : `אינך מסומן כ„${need.role}” בכרטיס העובד`}
                            onClick={() => { onClaim(seat.id, need.role); setOpenSeat(''); }}
                          >
                            <RoleIcon size={10} /> {need.role}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </GroupBlock>
              );
            }}
          />
        </div>

        {/* הלוח צר בטלפון, ולכן מה שנבחר מסוכם גם כרשימה. */}
        <div className="class-signup-summary">
          {picks.length === 0 ? (
            <span className="event-hint">עוד לא בחרתם חוגים.</span>
          ) : (
            picks.map((pick) => {
              const seat = (data.seats || []).find((s) => s.id === pick.slot_id);
              return (
                <span key={pick.slot_id} className="class-signup-chip">
                  {seat?.label || ''} · {pick.role}
                  <button type="button" onClick={() => onClear(pick.slot_id)} title="הסרה">
                    <X size={11} />
                  </button>
                </span>
              );
            })
          )}
        </div>
      </section>

      <section>
        <label className="event-field">
          <span>הערה למנהל (לא חובה)</span>
          <input value={note} onChange={(e) => onNote(e.target.value)} placeholder="למשל: מעדיפה קבוצות צעירות" />
        </label>
      </section>

      {error && <div className="event-error">{error}</div>}

      <div className="event-actions">
        <button type="button" className="event-primary" disabled={submitting || !employee} onClick={onSubmit}>
          {submitting ? <Loader2 size={17} className="spin" /> : <CalendarCheck size={17} />}
          {submitting ? 'שולח...' : 'שליחת הבחירה'}
        </button>
      </div>

      <style>{`
        .class-signup-board{padding:0 24px;margin-top:10px}
        .class-signup-board .card{background:rgba(0,0,0,.2);border:1px solid rgba(255,255,255,.1);border-radius:14px}
        .class-seat-mine{display:flex;align-items:center;gap:4px;font-size:9.5px;font-weight:800;
          color:#0b1220;background:var(--form-accent-solid,#38bdf8);border-radius:6px;padding:1px 5px;margin-top:2px}
        .class-seat-clear{display:inline-flex;margin-inline-start:auto;border:0;background:none;color:inherit;cursor:pointer;padding:0}
        .class-seat-roles{display:flex;flex-wrap:wrap;gap:3px;margin-top:2px}
        .class-seat-pill{display:inline-flex;align-items:center;gap:3px;font:inherit;font-size:9.5px;font-weight:700;
          padding:2px 6px;border-radius:999px;cursor:pointer;
          border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.12);color:#fff}
        .class-seat-pill.is-off{opacity:.4;cursor:not-allowed;text-decoration:line-through}
        .class-signup-summary{display:flex;flex-wrap:wrap;gap:6px;padding:12px 24px 0}
        .class-signup-chip{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;
          padding:4px 9px;border-radius:999px;color:var(--form-accent-text,#7dd3fc);
          background:var(--form-accent-soft-strong,rgba(56,189,248,.18));border:1px solid var(--form-accent-border,rgba(56,189,248,.45))}
        .class-signup-chip button{display:inline-flex;border:0;background:none;color:inherit;cursor:pointer;padding:0}
      `}</style>
    </>
  );
}

export { DAY_NAMES };
