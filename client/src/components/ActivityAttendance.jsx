import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { HEB_WEEKDAY_LETTERS, attStatusMeta } from '../scheduleUtils.js';

/**
 * נוכחות בפעילות — לא מסך משלה אלא חלק מרשימת המשתתפים הרשומים.
 * הקובץ מספק את ההוק שמושך את הרשימה מהשרת, את פס בחירת היום לאירוע רב-יומי,
 * ואת כפתורי הגיע / לא הגיע שמופיעים גם בשורת המשתתף וגם בתיק המתאמן.
 */

/** Noon avoids the date sliding a day back/forward across time zones. */
function dateAtNoon(dateStr) {
  return new Date(`${dateStr}T12:00:00`);
}

export function formatActivityDay(dateStr) {
  const d = dateAtNoon(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr || '';
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
}

export function activityDayLabel(dateStr) {
  const d = dateAtNoon(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr || '';
  const letter = HEB_WEEKDAY_LETTERS[d.getDay()];
  return `${letter ? `יום ${letter}׳ · ` : ''}${formatActivityDay(dateStr)}`;
}

/**
 * שגיאה קריאה גם כשהשרת לא החזיר JSON — למשל בזמן הפעלה מחדש של השרת,
 * שאז מתקבל דף שגיאה של הפרוקסי. בלי הקוד המספרי אי אפשר להבדיל בין
 * „הנתיב לא קיים בשרת” לבין „השרת לא זמין כרגע”.
 */
function requestError(res, body, fallback) {
  if (body?.error) return new Error(body.error);
  if (res.status === 404) return new Error(`${fallback} — הנתיב לא נמצא בשרת (404). ייתכן שהשרת מריץ גרסה ישנה`);
  return new Error(`${fallback} (${res.status})`);
}

/** POST של סימונים; מחזיר שגיאה בעברית אם השמירה לא הגיעה למסד. */
export async function saveActivityAttendance(records) {
  const res = await fetch('/api/activity-attendance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw requestError(res, body, 'שמירת הנוכחות נכשלה');
  return body?.rows || [];
}

/**
 * הגיע / לא הגיע לתאריך אחד. לחיצה על הסטטוס הפעיל מנקה אותו חזרה ל„ממתין”,
 * כך שאפשר לתקן סימון בטעות בלי תפריט נוסף.
 */
export function AttendanceToggle({ status, busy = false, disabled = false, onMark, size = 'sm' }) {
  const pad = size === 'xs' ? '2px 8px' : '3px 9px';
  const font = size === 'xs' ? 11 : 11.5;

  const button = (key, Icon) => {
    const meta = attStatusMeta(key);
    const active = status === key;
    return (
      <button
        type="button"
        key={key}
        onClick={() => onMark?.(active ? 'pending' : key)}
        disabled={busy || disabled}
        title={active ? `ביטול הסימון «${meta.label}»` : meta.label}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: pad,
          borderRadius: 999,
          fontSize: font,
          fontWeight: 700,
          lineHeight: 1.2,
          whiteSpace: 'nowrap',
          cursor: busy || disabled ? 'default' : 'pointer',
          opacity: busy || disabled ? 0.6 : 1,
          background: active ? meta.bg : 'transparent',
          border: `1px solid ${active ? meta.border : 'var(--border)'}`,
          color: active ? meta.color : 'var(--text-3)',
        }}
      >
        <Icon size={12} strokeWidth={2.5} />
        {meta.label}
      </button>
    );
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      {button('attended', Check)}
      {button('absent', X)}
      {busy && <Loader2 size={12} className="spin" style={{ color: 'var(--text-3)' }} />}
    </span>
  );
}

/**
 * רשימת הנוכחות של אירוע. השרת גוזר אותה בכל קריאה מהמשתתפים הרשומים כפול ימי
 * האירוע, ולכן משתתף שנרשם אחרי שהרשימה נפתחה מופיע בה ברענון הבא בלי טיפול ידני.
 * `refreshToken` משתנה עם רשימת הנרשמים, וזה מה שמחזיר את הרשימה מהשרת.
 */
export function useActivityAttendance({ activityId, refreshToken = '', enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [activeDate, setActiveDate] = useState('');

  const load = useCallback(async () => {
    if (!activityId || !enabled) {
      setData(null);
      return;
    }
    try {
      const res = await fetch(`/api/activities/${encodeURIComponent(activityId)}/attendance`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw requestError(res, body, 'טעינת רשימת הנוכחות נכשלה');
      setData(body);
      setError('');
    } catch (err) {
      setError(err.message || 'טעינת רשימת הנוכחות נכשלה');
      setData(null);
    }
  }, [activityId, enabled]);

  useEffect(() => { load(); }, [load, refreshToken]);

  // A failed load used to stick until the event was reopened — the token only
  // changes when the participant list does. Retrying when the window comes back
  // heals a server that was restarting at the wrong moment.
  useEffect(() => {
    if (!activityId || !enabled) return undefined;
    const retryWhenVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', retryWhenVisible);
    return () => {
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', retryWhenVisible);
    };
  }, [activityId, enabled, load]);

  const dates = useMemo(() => data?.dates || [], [data]);

  // Default to today while the activity is running, otherwise its first day.
  useEffect(() => {
    if (!dates.length) {
      setActiveDate('');
      return;
    }
    setActiveDate((prev) => {
      if (prev && dates.includes(prev)) return prev;
      const today = new Date().toLocaleDateString('en-CA');
      return dates.includes(today) ? today : dates[0];
    });
  }, [dates]);

  const dayIndex = dates.indexOf(activeDate);

  const statusByRegistration = useMemo(() => {
    const map = new Map();
    for (const participant of data?.participants || []) {
      map.set(String(participant.registration_id), participant.days?.[dayIndex]?.status || 'pending');
    }
    return map;
  }, [data, dayIndex]);

  const applyLocal = (updates) => {
    setData((prev) => {
      if (!prev) return prev;
      const index = prev.dates.indexOf(activeDate);
      if (index < 0) return prev;
      const wanted = new Map(updates.map((u) => [String(u.registrationId), u.status]));
      const participants = prev.participants.map((participant) => {
        const next = wanted.get(String(participant.registration_id));
        if (!next) return participant;
        return {
          ...participant,
          days: participant.days.map((day) => (day.date === activeDate ? { ...day, status: next } : day)),
        };
      });
      const summary = { date: activeDate, attended: 0, absent: 0, pending: 0, total: participants.length };
      for (const participant of participants) {
        summary[participant.days[index]?.status || 'pending'] += 1;
      }
      return {
        ...prev,
        participants,
        totals: prev.totals.map((row, i) => (i === index ? summary : row)),
      };
    });
  };

  const mark = async (registrationId, status) => {
    if (!activeDate) return;
    setBusyKey(String(registrationId));
    setError('');
    try {
      await saveActivityAttendance([{
        activity_id: activityId,
        registration_id: registrationId,
        date: activeDate,
        status,
      }]);
      applyLocal([{ registrationId, status }]);
    } catch (err) {
      setError(err.message || 'שמירת הנוכחות נכשלה');
    } finally {
      setBusyKey('');
    }
  };

  const markAllPresent = async () => {
    const pending = (data?.participants || []).filter(
      (participant) => participant.days?.[dayIndex]?.status !== 'attended'
    );
    if (!pending.length || !activeDate) return;
    setBusyKey('all');
    setError('');
    try {
      await saveActivityAttendance(pending.map((participant) => ({
        activity_id: activityId,
        registration_id: participant.registration_id,
        date: activeDate,
        status: 'attended',
      })));
      applyLocal(pending.map((participant) => ({
        registrationId: participant.registration_id,
        status: 'attended',
      })));
    } catch (err) {
      setError(err.message || 'שמירת הנוכחות נכשלה');
    } finally {
      setBusyKey('');
    }
  };

  return {
    dates,
    totals: data?.totals || [],
    dayTotals: data?.totals?.[dayIndex] || null,
    multiDay: !!data?.multi_day,
    activeDate,
    setActiveDate,
    hasList: dates.length > 0 && (data?.participants?.length || 0) > 0,
    statusFor: (registrationId) => statusByRegistration.get(String(registrationId)) || 'pending',
    busyFor: (registrationId) => busyKey === String(registrationId) || busyKey === 'all',
    markingAll: busyKey === 'all',
    mark,
    markAllPresent,
    error,
    reload: load,
  };
}

/**
 * בחירת היום של האירוע + „סימון כולם כהגיעו”. מוצג מעל רשימת המשתתפים,
 * ובאירוע של יום אחד יש בו רק את התאריך ואת כפתור הסימון הקבוצתי.
 */
export function AttendanceDayBar({ attendance, readOnly = false }) {
  const { dates, totals, activeDate, setActiveDate, multiDay, markAllPresent, markingAll } = attendance;
  if (!dates.length) return null;

  return (
    <div className="registration-attendance-bar">
      {multiDay && (
        <div className="registration-attendance-days">
          {dates.map((date, index) => {
            const active = date === activeDate;
            const dayTotals = totals[index];
            return (
              <button
                key={date}
                type="button"
                className={`btn btn-xs ${active ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setActiveDate(date)}
              >
                {activityDayLabel(date)}
                {dayTotals ? ` · ${dayTotals.attended}/${dayTotals.total}` : ''}
              </button>
            );
          })}
        </div>
      )}
      <div className="registration-attendance-bar-row">
        <span className="registration-attendance-day-label">
          נוכחות — {activityDayLabel(activeDate)}
        </span>
        {!readOnly && (
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={markAllPresent}
            disabled={markingAll}
          >
            {markingAll ? <Loader2 size={12} className="spin" /> : <Check size={12} />}
            סימון כולם כהגיעו
          </button>
        )}
      </div>
    </div>
  );
}
