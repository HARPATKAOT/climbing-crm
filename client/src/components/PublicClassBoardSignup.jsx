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
import ClassBoardGrid, { GroupBlock, t2m } from './schedule/ClassBoardGrid.jsx';
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

  // הלוח נגזר מהחוגים שבטופס ולא מ-14:00-22:00 הקבועים: טופס של חוגי אחר
  // הצהריים לא צריך לצייר ערב ריק, ובטלפון כל דקה מיותרת היא גלילה.
  const minutes = groups.map((g) => t2m(g.time));
  const ends = groups.map((g) => t2m(g.time) + (Number(g.duration) || 50));
  const startMin = groups.length ? Math.floor(Math.min(...minutes) / 60) * 60 : 14 * 60;
  const endMin = groups.length ? Math.ceil(Math.max(...ends) / 60) * 60 : 22 * 60;
  // צפיפות שנכנסת במסך: שאיפה ל~420 פיקסל גובה, בלי לרדת מגובה שאפשר לגעת בו.
  const pxPerMin = Math.min(1.2, Math.max(0.75, 420 / Math.max(60, endMin - startMin)));

  const openSeatData = (data.seats || []).find((seat) => seat.id === openSeat) || null;

  const clickSeat = (seat) => {
    if (!employee) return;
    const mine = pickOf(seat.id);
    if (mine) { onClear(seat.id); return; }
    const roles = (seat.needs || []).filter((need) => canFill(need.role));
    // תפקיד אפשרי אחד — הלחיצה בוחרת אותו. יותר מאחד — הבחירה נפתחת מתחת
    // ללוח, כי בתוך משבצת בגובה 40 פיקסל אין מקום לכפתור שאצבע פוגעת בו.
    if (roles.length === 1) onClaim(seat.id, roles[0].role);
    else setOpenSeat(openSeat === seat.id ? '' : seat.id);
  };

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
            startMin={startMin}
            endMin={endMin}
            pxPerMin={pxPerMin}
            hourLabelWidth={34}
            minColWidth={0}
            showCounts={false}
            renderBlock={(group, day, geometry) => {
              const { seat } = group;
              const mine = pickOf(seat.id);
              return (
                <GroupBlock
                  key={`${seat.id}-${day}`}
                  group={group}
                  enrolledCount={null}
                  showStaff={false}
                  selected={Boolean(mine) || openSeat === seat.id}
                  startMin={geometry.startMin}
                  pxPerMin={geometry.pxPerMin}
                  onClick={() => clickSeat(seat)}
                  onContextMenu={(e) => { e.preventDefault(); onClear(seat.id); }}
                >
                  {mine && (
                    <div className="class-seat-mine">
                      <Check size={10} /> {mine.role}
                    </div>
                  )}
                </GroupBlock>
              );
            }}
          />
        </div>

        {/* בורר התפקיד — מתחת ללוח ולא בתוך המשבצת: בטלפון המשבצת קטנה מדי
            לכפתורים, וכאן הם בגודל שאצבע פוגעת בו. */}
        {openSeatData && !pickOf(openSeatData.id) && (
          <div className="class-seat-picker">
            <div className="class-seat-picker-title">{openSeatData.label}</div>
            <div className="class-seat-picker-roles">
              {(openSeatData.needs || []).map((need) => {
                const RoleIcon = roleIcon(need.role);
                const allowed = canFill(need.role);
                return (
                  <button
                    type="button"
                    key={need.role || 'any'}
                    className={`class-seat-pill is-big ${allowed ? '' : 'is-off'}`}
                    disabled={!allowed}
                    title={allowed
                      ? `${need.role} · דרושים ${need.count}, סימנו ${need.taken}`
                      : `אינך מסומן כ„${need.role}” בכרטיס העובד`}
                    onClick={() => { onClaim(openSeatData.id, need.role); setOpenSeat(''); }}
                  >
                    <RoleIcon size={13} /> {need.role}
                    <span style={{ opacity: 0.7, fontWeight: 600 }}>· סימנו {need.taken}</span>
                  </button>
                );
              })}
              <button type="button" className="class-seat-pill is-big" onClick={() => setOpenSeat('')}>
                <X size={13} /> סגירה
              </button>
            </div>
          </div>
        )}

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
        .class-signup-board{padding:0 10px;margin-top:10px}
        .class-signup-board .card{overflow:hidden !important}
        .class-seat-picker{margin:10px 10px 0;padding:10px 12px;border-radius:12px;
          border:1px solid var(--form-accent-border,rgba(56,189,248,.45));
          background:var(--form-accent-soft,rgba(56,189,248,.09))}
        .class-seat-picker-title{font-size:13px;font-weight:800;color:#fff;margin-bottom:8px}
        .class-seat-picker-roles{display:flex;flex-wrap:wrap;gap:7px}
        .class-seat-pill.is-big{font-size:13px;padding:9px 14px;border-radius:11px}
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
