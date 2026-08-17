/**
 * ניהול טפסי הרשמה למשמרות — מה שהחליף את הסקר בוואטסאפ.
 *
 * המנהל פותח „טופס”: אילו משמרות נפתחות, לאיזה תפקיד וכמה אנשים צריך בכל אחת.
 * הצוות מסמן דרך קישור ציבורי, והתשובות מגיעות לכאן כלוח שיבוץ. סימון הוא
 * זמינות בלבד — השיבוץ עצמו נוצר רק בלחיצה, וכותב שורה רגילה ביומן העבודה,
 * זו שממנה מחושבים גם התזכורת וגם השכר.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarPlus, CalendarRange, Check, Copy, Link2, Loader2, Lock, Unlock, Plus, Repeat, Send,
  Square, Trash2, UserCheck, UserPlus, Users, X, GraduationCap,
} from 'lucide-react';
import AppSelect from './AppSelect.jsx';
import { assignableLabelsOf, useRoleCatalog } from '../utils/staffRoles.js';

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

const WORK_TYPE_OPTIONS = [
  { id: 'counter_shift', label: 'דלפק / פתיחת קיר' },
  { id: 'class_shift', label: 'חוג' },
  { id: 'private_shift', label: 'שיעור פרטי' },
  { id: 'route_building_shift', label: 'בניית מסלולים' },
];

function todayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}

function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString('en-CA');
}

function dayLabel(dateStr) {
  const date = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return `יום ${DAY_NAMES[date.getDay()]} · ${date.getDate()}.${date.getMonth() + 1}`;
}

function rangeLabel(from, to) {
  if (!from) return '';
  return from === to ? dayLabel(from) : `${dayLabel(from)} — ${dayLabel(to)}`;
}

async function callApi(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'הפעולה נכשלה');
  return body;
}

// ─── יצירת טופס חדש ─────────────────────────────────────────────────────────
function NewWindowForm({ roleOptions, onCancel, onCreated }) {
  const [title, setTitle] = useState('');
  const [role, setRole] = useState(roleOptions[0] || '');
  const [workType, setWorkType] = useState('counter_shift');
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(addDays(todayStr(), 13));
  const [weekdays, setWeekdays] = useState([0]);
  const [startTime, setStartTime] = useState('16:00');
  const [endTime, setEndTime] = useState('20:00');
  const [note, setNote] = useState('');
  const [deadline, setDeadline] = useState('');
  const [slots, setSlots] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // 'calendar' — אירועים מהיומן; 'classes' — חוגים מלוח החוגים; 'pattern' —
  // משמרת קבועה שמוקלדת כאן ואין לה רישום בשום לוח.
  const [source, setSource] = useState('calendar');
  const [candidates, setCandidates] = useState(null);
  const [withoutHours, setWithoutHours] = useState(0);
  const [pickedIds, setPickedIds] = useState([]);
  // מקומות לכל חוג. בלוח החוגים המספר נקבע לחוג ולא למשמרת הבודדת, כי חוג
  // שצריך שני עוזרי מדריך צריך אותם בכל מפגש שלו.
  const [classSeats, setClassSeats] = useState({});
  const [audienceMode, setAudienceMode] = useState('role');
  const [audienceIds, setAudienceIds] = useState([]);
  const [allStaff, setAllStaff] = useState([]);
  const [reach, setReach] = useState(null);

  useEffect(() => {
    if (!role && roleOptions.length) setRole(roleOptions[0]);
  }, [role, roleOptions]);

  // רשימת השמות נטענת פעם אחת, לבחירה ידנית ולספירה של מי יקבל את הטופס.
  useEffect(() => {
    callApi('/api/shift-signup/audience?mode=all')
      .then((body) => setAllStaff(body.employees || []))
      .catch(() => setAllStaff([]));
  }, []);

  /** כמה עובדים יקבלו את הטופס בפועל — נקרא מהשרת כדי שלא ננחש כלל אחר. */
  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ role, mode: audienceMode });
    if (audienceMode === 'names') query.set('employee_ids', audienceIds.join(','));
    callApi(`/api/shift-signup/audience?${query}`)
      .then((body) => { if (!cancelled) setReach(body.employees || []); })
      .catch(() => { if (!cancelled) setReach(null); });
    return () => { cancelled = true; };
  }, [role, audienceMode, audienceIds]);

  /** כל שינוי שמזיז את מה שייכנס לטופס מבטל תצוגה מוקדמת ישנה. */
  const resetPreview = () => {
    setSlots([]);
    setCandidates(null);
    setPickedIds([]);
    setClassSeats({});
  };

  const toggleWeekday = (day) => {
    setWeekdays((current) => (current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day].sort()));
    resetPreview();
  };

  const preview = async () => {
    setError('');
    setBusy(true);
    try {
      const body = await callApi('/api/shift-signup/expand-slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from, to, weekdays, start_time: startTime, end_time: endTime,
        }),
      });
      setSlots(body.slots || []);
    } catch (e) {
      setError(e.message);
      setSlots([]);
    } finally {
      setBusy(false);
    }
  };

  /** מה שכבר רשום בלוח שנבחר ומתאים לתפקיד — לסימון, לא להקלדה. */
  const loadFromCalendar = async () => {
    setError('');
    setBusy(true);
    try {
      const query = new URLSearchParams({
        role, from, to, include: source === 'classes' ? 'groups' : 'activities',
      });
      const body = await callApi(`/api/shift-signup/calendar-slots?${query}`);
      const rows = body.candidates || [];
      setCandidates(rows);
      setWithoutHours(body.withoutHours || 0);
      if (source === 'classes') {
        // חוג נבחר כיחידה אחת, ולכן הסימון הוא של החוג ולא של מפגש בודד.
        setClassSeats(Object.fromEntries([...new Set(rows.map((c) => c.group_id))].map((id) => [id, 1])));
        setPickedIds([...new Set(rows.map((c) => c.group_id))]);
      } else {
        // ברירת המחדל היא רק מה שעוד לא מאויש — כדי שלא יישלח לצוות טופס שרובו
        // משמרות שכבר סגורות.
        setPickedIds(rows.filter((c) => c.staffed < c.capacity).map((c) => c.id));
      }
    } catch (e) {
      setError(e.message);
      setCandidates(null);
    } finally {
      setBusy(false);
    }
  };

  const toggleCandidate = (id) => {
    setPickedIds((current) => (current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id]));
  };

  /** החוגים שנשלפו, שורה אחת לכל חוג במקום שורה לכל מפגש. */
  const classRows = source !== 'classes' ? [] : [...new Map(
    (candidates || []).map((c) => [c.group_id, c])
  ).values()].map((c) => ({
    group_id: c.group_id,
    label: c.label,
    sessions: (candidates || []).filter((x) => x.group_id === c.group_id),
  }));

  const chosenSlots = (() => {
    if (source === 'pattern') return slots;
    if (source === 'calendar') return (candidates || []).filter((c) => pickedIds.includes(c.id));
    return (candidates || [])
      .filter((c) => pickedIds.includes(c.group_id))
      .map((c) => ({ ...c, capacity: Math.max(1, Number(classSeats[c.group_id]) || 1) }));
  })();

  const create = async () => {
    setError('');
    setBusy(true);
    try {
      const created = await callApi('/api/shift-signup/windows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          role,
          work_type: workType,
          note,
          deadline: deadline || null,
          audience: { mode: audienceMode, employee_ids: audienceIds },
          slots: chosenSlots,
        }),
      });
      onCreated(created);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card card-p" style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 20 }}>
      <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <CalendarPlus size={18} style={{ color: 'var(--blue)' }} /> טופס הרשמה חדש
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: 'var(--text-3)' }}>
          שם הטופס
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="למשל: משמרות פתיחה — שבועיים הקרובים"
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: 'var(--text-3)' }}>
          למי הטופס פונה
          <AppSelect value={role} onChange={(e) => { setRole(e.target.value); resetPreview(); }}>
            {roleOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </AppSelect>
        </label>
        {source === 'pattern' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: 'var(--text-3)' }}>
            סוג המשמרת ביומן העבודה
            <AppSelect value={workType} onChange={(e) => setWorkType(e.target.value)}>
              {WORK_TYPE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </AppSelect>
          </label>
        )}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: 'var(--text-3)' }}>
          אפשר לענות עד (לא חובה)
          <input className="input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </label>
      </div>

      <div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>למי לשלוח</div>
        <div className="choice-row">
          {[
            { key: 'role', label: `מי שמסומן כ„${role}”`, accent: '#A78BFA', icon: UserPlus },
            { key: 'all', label: 'כל הצוות', accent: '#38BDF8', icon: Users },
            { key: 'wall', label: 'עובדי קיר', accent: '#34D399', icon: Users },
            { key: 'external', label: 'עובדי חוץ', accent: '#FBBF24', icon: Users },
            { key: 'names', label: 'בחירת שמות', accent: '#F472B6', icon: UserCheck },
          ].map(({ key, label, accent, icon: Icon }) => (
            <button
              type="button"
              key={key}
              className={`choice-pill ${audienceMode === key ? 'active' : ''}`}
              style={{ '--choice-accent': accent }}
              onClick={() => setAudienceMode(key)}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
        {audienceMode === 'names' && (
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setAudienceIds(allStaff.map((e) => e.id))}>
                סימון כולם
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setAudienceIds([])}>
                <X size={13} /> ניקוי הבחירה
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 190, overflowY: 'auto' }}>
              {allStaff.map((employee) => {
                const on = audienceIds.includes(employee.id);
                return (
                  <button
                    type="button"
                    key={employee.id}
                    className={`btn btn-sm ${on ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setAudienceIds((current) => (on
                      ? current.filter((id) => id !== employee.id)
                      : [...current, employee.id]))}
                  >
                    {on && <Check size={12} />} {employee.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {reach && (
          <div style={{ fontSize: 12, color: reach.length ? 'var(--text-3)' : 'var(--amber)', marginTop: 8 }}>
            {reach.length
              ? `הטופס יגיע ל-${reach.length} עובדים: ${reach.map((e) => e.name).join(', ')}`
              : 'אף עובד לא נכלל בבחירה הזאת — אף אחד לא יוכל למלא את הטופס.'}
          </div>
        )}
      </div>

      <div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>מאיפה המשמרות</div>
        <div className="choice-row">
          <button
            type="button"
            className={`choice-pill ${source === 'calendar' ? 'active' : ''}`}
            style={{ '--choice-accent': '#FB923C' }}
            onClick={() => { setSource('calendar'); resetPreview(); }}
          >
            <CalendarRange size={15} /> מהיומן
          </button>
          <button
            type="button"
            className={`choice-pill ${source === 'classes' ? 'active' : ''}`}
            style={{ '--choice-accent': '#34D399' }}
            onClick={() => { setSource('classes'); resetPreview(); }}
          >
            <GraduationCap size={15} /> מלוח החוגים
          </button>
          <button
            type="button"
            className={`choice-pill ${source === 'pattern' ? 'active' : ''}`}
            style={{ '--choice-accent': '#38BDF8' }}
            onClick={() => { setSource('pattern'); resetPreview(); }}
          >
            <Repeat size={15} /> משמרת קבועה
          </button>
        </div>
      </div>

      {source === 'pattern' && (
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>אילו ימים בשבוע</div>
          <div className="choice-row">
            {DAY_NAMES.map((name, index) => (
              <button
                type="button"
                key={name}
                className={`choice-pill ${weekdays.includes(index) ? 'active' : ''}`}
                style={{ '--choice-accent': '#38BDF8' }}
                onClick={() => toggleWeekday(index)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: 'var(--text-3)' }}>
          מתאריך
          <input className="input" type="date" value={from} onChange={(e) => { setFrom(e.target.value); resetPreview(); }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: 'var(--text-3)' }}>
          עד תאריך
          <input className="input" type="date" value={to} onChange={(e) => { setTo(e.target.value); resetPreview(); }} />
        </label>
        {source === 'pattern' && (
          <>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: 'var(--text-3)' }}>
              משעה
              <input className="input" type="time" value={startTime} onChange={(e) => { setStartTime(e.target.value); resetPreview(); }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: 'var(--text-3)' }}>
              עד שעה
              <input className="input" type="time" value={endTime} onChange={(e) => { setEndTime(e.target.value); resetPreview(); }} />
            </label>
          </>
        )}
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: 'var(--text-3)' }}>
        הסבר שיופיע בטופס (לא חובה)
        <input
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="למשל: מי שמסמן מתחייב להגיע 15 דקות לפני"
        />
      </label>

      {source === 'classes' && candidates !== null && (
        <div style={{ background: 'var(--bg-input)', borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 10 }}>
            {classRows.length === 0
              ? `אין חוגים בטווח הזה שמתאימים ל„${role}”.`
              : `${classRows.length} חוגים. סמנו אילו להציע, וכמה מקומות פנויים בכל אחד:`}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
            {classRows.map((row) => {
              const on = pickedIds.includes(row.group_id);
              return (
                <div
                  key={row.group_id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 11px', borderRadius: 10,
                    border: `1px solid ${on ? 'var(--green)' : 'var(--border)'}`,
                    background: on ? 'rgba(52,211,153,0.08)' : 'transparent',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleCandidate(row.group_id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 9, flex: 1, minWidth: 0,
                      background: 'none', border: 0, font: 'inherit', color: 'var(--text-1)',
                      cursor: 'pointer', textAlign: 'right',
                    }}
                  >
                    {on ? <Check size={14} style={{ color: 'var(--green)' }} /> : <Square size={14} style={{ color: 'var(--text-3)' }} />}
                    <span style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.label}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-3)', flexShrink: 0 }}>
                      {row.sessions.length} מפגשים
                    </span>
                  </button>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>
                    מקומות
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={20}
                      disabled={!on}
                      value={classSeats[row.group_id] ?? 1}
                      onChange={(e) => setClassSeats((current) => ({
                        ...current, [row.group_id]: Math.max(1, Number(e.target.value) || 1),
                      }))}
                      style={{ width: 62, padding: '4px 6px', fontSize: 12 }}
                    />
                  </label>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {source === 'calendar' && candidates !== null && (
        <div style={{ background: 'var(--bg-input)', borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 10 }}>
            {candidates.length === 0
              ? `אין ביומן משמרות בטווח הזה שמתאימות ל„${role}”.`
              : `${candidates.length} משמרות ביומן מתאימות ל„${role}”. סמנו מה להציע:`}
            {withoutHours > 0 && ` (${withoutHours} רשומות ביומן בלי שעות — אי אפשר להציע אותן להרשמה)`}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
            {candidates.map((slot) => {
              const on = pickedIds.includes(slot.id);
              const full = slot.staffed >= slot.capacity;
              return (
                <button
                  type="button"
                  key={slot.id}
                  onClick={() => toggleCandidate(slot.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, textAlign: 'right',
                    padding: '9px 11px', borderRadius: 10, cursor: 'pointer', font: 'inherit',
                    border: `1px solid ${on ? 'var(--blue)' : 'var(--border)'}`,
                    background: on ? 'rgba(56,189,248,0.10)' : 'transparent',
                    color: 'var(--text-1)',
                  }}
                >
                  {on ? <Check size={14} style={{ color: 'var(--blue)' }} /> : <Square size={14} style={{ color: 'var(--text-3)' }} />}
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{dayLabel(slot.date)}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{slot.start_time}–{slot.end_time}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-3)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {slot.label}
                  </span>
                  {slot.staffed > 0 && (
                    <span className={`badge ${full ? 'badge-green' : 'badge-amber'}`}>
                      {full ? 'מאויש' : `כבר ${slot.staffed}`}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {source === 'pattern' && slots.length > 0 && (
        <div style={{ background: 'var(--bg-input)', borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>
            {slots.length} משמרות ייפתחו להרשמה:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {slots.map((slot) => (
              <span key={slot.id} className="badge badge-blue">
                {dayLabel(slot.date)} · {slot.start_time}–{slot.end_time}
              </span>
            ))}
          </div>
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: 'var(--red)' }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
          <X size={14} /> ביטול
        </button>
        {source !== 'pattern' ? (
          <button className="btn btn-ghost btn-sm" onClick={loadFromCalendar} disabled={busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <CalendarRange size={14} />} {source === 'classes' ? 'שליפה מלוח החוגים' : 'שליפה מהיומן'}
          </button>
        ) : (
          <button className="btn btn-ghost btn-sm" onClick={preview} disabled={busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />} חישוב המשמרות
          </button>
        )}
        <button
          className="btn btn-primary btn-sm"
          onClick={create}
          disabled={busy || !chosenSlots.length || !title.trim()}
          title={!chosenSlots.length ? 'קודם שלפו משמרות וסמנו מה להציע' : ''}
        >
          <Plus size={14} /> יצירת הטופס
          {chosenSlots.length > 0 ? ` (${chosenSlots.length})` : ''}
        </button>
      </div>
    </div>
  );
}

// ─── לוח השיבוץ של טופס אחד ──────────────────────────────────────────────────
function SignupBoard({ windowId, onChanged }) {
  const [data, setData] = useState(null);
  const [busySlot, setBusySlot] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await callApi(`/api/shift-signup/windows/${encodeURIComponent(windowId)}`));
    } catch (e) {
      setError(e.message);
    }
  }, [windowId]);

  useEffect(() => { load(); }, [load]);

  /**
   * זה הרגע שבו סימון הופך לשיבוץ. השורה נכתבת ליומן העבודה הרגיל, ולכן היא
   * גוררת אחריה את התזכורת לעובד ואת חישוב השכר — בלי מסלול תמחור נפרד.
   */
  const assign = async (slot, person) => {
    setBusySlot(`${slot.id}:${person.employee_id}`);
    setError('');
    try {
      await callApi('/api/work-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: person.employee_id,
          date: slot.date,
          start_time: slot.start_time,
          end_time: slot.end_time,
          // משמרת שנבחרה מהיומן יודעת מה היא מאיישת ואיזה סוג שורה היא —
          // בלי זה השיבוץ היה מרחף בלי קשר לאירוע או לחוג שהוא מכסה.
          activity_id: slot.activity_id || null,
          group_id: slot.group_id || null,
          work_type: slot.work_type || data.work_type,
          role: data.role,
          source: 'shift_signup',
        }),
      });
      await load();
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusySlot('');
    }
  };

  const unassign = async (slot, person) => {
    if (!person.assignment_id) return;
    setBusySlot(`${slot.id}:${person.employee_id}`);
    setError('');
    try {
      await callApi(`/api/work-assignments/${encodeURIComponent(person.assignment_id)}`, { method: 'DELETE' });
      await load();
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusySlot('');
    }
  };

  if (!data) {
    return (
      <div className="card card-p" style={{ color: 'var(--text-3)', fontSize: 13 }}>
        {error || 'טוען לוח שיבוץ...'}
      </div>
    );
  }

  return (
    <div className="card card-p" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
        לחיצה על שם משבצת אותו למשמרת ופותחת לו שורה ביומן העבודה. לחיצה נוספת מבטלת.
      </div>

      {error && <div style={{ fontSize: 12, color: 'var(--red)' }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(data.board || []).map((slot) => (
          <div
            key={slot.id}
            style={{
              border: '1px solid var(--border)', borderRadius: 12, padding: 12,
              background: slot.missing === 0 ? 'rgba(52,211,153,0.06)' : 'transparent',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>
                {dayLabel(slot.date)} · {slot.start_time}–{slot.end_time}
                {slot.label && (
                  <span style={{ fontWeight: 500, fontSize: 12.5, color: 'var(--text-3)' }}> · {slot.label}</span>
                )}
              </div>
              <span className={`badge ${slot.missing === 0 ? 'badge-green' : 'badge-amber'}`}>
                {slot.missing === 0
                  ? 'מאויש'
                  : (slot.capacity === 1 ? 'חסר עובד' : `שובצו ${slot.capacity - slot.missing} מתוך ${slot.capacity}`)}
              </span>
            </div>

            {slot.signed.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>אף אחד לא סימן את המשמרת הזו.</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                {slot.signed.map((person) => {
                  const busy = busySlot === `${slot.id}:${person.employee_id}`;
                  return (
                    <button
                      type="button"
                      key={person.employee_id}
                      className={`btn btn-sm ${person.assigned ? 'btn-primary' : 'btn-ghost'}`}
                      disabled={busy}
                      title={person.assigned ? 'לחיצה מבטלת את השיבוץ' : 'לחיצה משבצת למשמרת'}
                      onClick={() => (person.assigned ? unassign(slot, person) : assign(slot, person))}
                    >
                      {busy ? <Loader2 size={13} className="spin" /> : (person.assigned ? <Check size={13} /> : <UserPlus size={13} />)}
                      {person.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {(data.respondents_detail || []).length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Users size={14} style={{ color: 'var(--violet)' }} /> מי ענה
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {data.respondents_detail.map((person) => (
              <span key={person.employee_id} className="badge badge-purple">
                {person.name} · סימן {person.picked} · שובץ {person.assigned}
                {person.note ? ` · „${person.note}”` : ''}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── הלשונית עצמה ───────────────────────────────────────────────────────────
export default function ShiftSignupPanel() {
  const catalog = useRoleCatalog();
  const roleOptions = useMemo(() => assignableLabelsOf(catalog), [catalog]);
  const [windows, setWindows] = useState([]);
  const [creating, setCreating] = useState(false);
  // ?signup=<id> פותח לוח שיבוץ מסוים ישירות — כדי שאפשר יהיה לשלוח קישור אליו.
  const [selectedId, setSelectedId] = useState(
    () => new URLSearchParams(window.location.search).get('signup') || ''
  );
  const [copiedId, setCopiedId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setWindows(await callApi('/api/shift-signup/windows'));
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const linkOf = (row) => `${window.location.origin}/shift-signup/${row.token}`;

  const copyLink = async (row) => {
    try {
      await navigator.clipboard.writeText(linkOf(row));
      setCopiedId(row.id);
      setTimeout(() => setCopiedId(''), 2000);
    } catch {
      window.prompt('העתיקו את הקישור:', linkOf(row));
    }
  };

  const toggleStatus = async (row) => {
    try {
      await callApi(`/api/shift-signup/windows/${encodeURIComponent(row.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: row.status === 'open' ? 'closed' : 'open' }),
      });
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`למחוק את „${row.title}” ואת כל התשובות שהתקבלו?`)) return;
    try {
      await callApi(`/api/shift-signup/windows/${encodeURIComponent(row.id)}`, { method: 'DELETE' });
      if (selectedId === row.id) setSelectedId('');
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="section-header" style={{ marginBottom: 0 }}>
        <div>
          <div className="section-title">הרשמה למשמרות</div>
          <div className="section-sub">
            פותחים משמרות לתפקיד מסוים, שולחים קישור אחד לצוות, ומשבצים מהתשובות — בלי להעתיק סקר מוואטסאפ.
          </div>
        </div>
        {!creating && (
          <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
            <Plus size={14} /> טופס חדש
          </button>
        )}
      </div>

      {creating && (
        <NewWindowForm
          roleOptions={roleOptions}
          onCancel={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            setSelectedId(created.id);
            load();
          }}
        />
      )}

      {error && <div style={{ fontSize: 12, color: 'var(--red)' }}>{error}</div>}

      {loading ? (
        <div className="card card-p" style={{ color: 'var(--text-3)', fontSize: 13 }}>טוען...</div>
      ) : windows.length === 0 && !creating ? (
        <div className="empty-state">
          <Send size={32} />
          <strong>עוד לא נפתח אף טופס</strong>
          <span>„טופס חדש” פותח משמרות להרשמה ומייצר קישור לשליחה בוואטסאפ.</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {windows.map((row) => (
            <div key={row.id} className="card card-p" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {row.title}
                    <span className={`badge ${row.open ? 'badge-green' : 'badge-red'}`}>
                      {row.open ? 'פתוח' : 'סגור'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
                    {row.role} · {rangeLabel(row.first_date, row.last_date)} · {row.slot_count} משמרות
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => setSelectedId(selectedId === row.id ? '' : row.id)}
                  >
                    <Users size={13} /> {selectedId === row.id ? 'סגירת לוח השיבוץ' : 'לוח השיבוץ'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => copyLink(row)}>
                    {copiedId === row.id ? <Check size={13} /> : <Copy size={13} />}
                    {copiedId === row.id ? 'הועתק' : 'העתקת קישור'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => toggleStatus(row)}>
                    {row.status === 'open' ? <Lock size={13} /> : <Unlock size={13} />}
                    {row.status === 'open' ? 'סגירה' : 'פתיחה'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => remove(row)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="badge badge-blue">{row.respondents} ענו</span>
                <span className={`badge ${row.missing === 0 ? 'badge-green' : 'badge-amber'}`}>
                  {row.missing === 0 ? 'כל המשמרות מאוישות' : `חסרים ${row.missing} שיבוצים`}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Link2 size={12} /> {linkOf(row)}
                </span>
              </div>

              {selectedId === row.id && <SignupBoard windowId={row.id} onChanged={load} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
