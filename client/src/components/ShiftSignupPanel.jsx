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
  AlertTriangle, CalendarCheck, CalendarPlus, CalendarRange, Check, Copy, Link2, Loader2, Lock,
  Unlock, Plus, Repeat, Send, Square, Trash2, UserPlus, Users, X,
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

/**
 * מי מקבל את הקישור.
 *
 * ברירת המחדל היא כל מי שמסומן בתפקיד, כי זו התשובה הנכונה ברוב הפעמים ואסור
 * שהיא תדרוש סימון. אבל „כל מי שמסומן” הוא לא תמיד מי שרוצים: אחד בחופשה, אחד
 * חדש שעוד לא מוכן למשמרת לבד, ואחד שכבר סוכם איתו בעל פה. לכן אפשר לצמצם
 * לשמות — וברגע שנבחר שם אחד לפחות, הרשימה הזאת היא הטופס, לא התפקיד.
 */
function RecipientPicker({ employees, role, value, onChange }) {
  const byRole = useMemo(() => employees.filter((employee) => (
    Array.isArray(employee.certifications) && employee.certifications.includes(role)
  )), [employees, role]);
  const explicit = value.length > 0;
  const shown = explicit ? employees : byRole;

  const toggle = (id) => {
    // המעבר מ„כולם” לרשימה מפורשת מתחיל ממי שבתפקיד פחות מי שהוסר — אחרת
    // לחיצה אחת על שם אחד הייתה מבטלת בשקט את כל השאר.
    if (!explicit) {
      onChange(byRole.map((e) => e.id).filter((x) => x !== id));
      return;
    }
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  };

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span>למי לשלוח</span>
        {explicit ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([])}>
            <X size={12} /> חזרה לכל מי שבתפקיד
          </button>
        ) : (
          <span className="badge badge-blue">כל מי שמסומן ב„{role}” ({byRole.length})</span>
        )}
      </div>
      <div className="choice-row" style={{ maxHeight: 132, overflowY: 'auto' }}>
        {shown.map((employee) => {
          const on = explicit ? value.includes(employee.id) : true;
          return (
            <button
              type="button"
              key={employee.id}
              className={`choice-pill ${on ? 'active' : ''}`}
              style={{ '--choice-accent': '#A78BFA' }}
              onClick={() => toggle(employee.id)}
            >
              {on ? <Check size={13} /> : <Square size={13} />} {employee.name}
            </button>
          );
        })}
        {shown.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--amber)' }}>
            אף עובד לא מסומן ב„{role}” — צריך לסמן את התפקיד בכרטיס העובד.
          </span>
        )}
      </div>
    </div>
  );
}

// ─── יצירת טופס חדש ─────────────────────────────────────────────────────────
function NewWindowForm({ roleOptions, employees, onCancel, onCreated }) {
  const [title, setTitle] = useState('');
  const [role, setRole] = useState(roleOptions[0] || '');
  const [workType, setWorkType] = useState('counter_shift');
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(addDays(todayStr(), 13));
  const [weekdays, setWeekdays] = useState([0]);
  const [startTime, setStartTime] = useState('16:00');
  const [endTime, setEndTime] = useState('20:00');
  const [capacity, setCapacity] = useState(1);
  const [note, setNote] = useState('');
  const [deadline, setDeadline] = useState('');
  const [recipients, setRecipients] = useState([]);
  const [slots, setSlots] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // 'calendar' — משמרות שכבר קיימות ביומן; 'pattern' — דפוס שבועי שמוקלד כאן.
  const [source, setSource] = useState('calendar');
  const [candidates, setCandidates] = useState(null);
  const [withoutHours, setWithoutHours] = useState(0);
  const [pickedIds, setPickedIds] = useState([]);

  useEffect(() => {
    if (!role && roleOptions.length) setRole(roleOptions[0]);
  }, [role, roleOptions]);

  /** כל שינוי שמזיז את מה שייכנס לטופס מבטל תצוגה מוקדמת ישנה. */
  const resetPreview = () => {
    setSlots([]);
    setCandidates(null);
    setPickedIds([]);
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
          from, to, weekdays, start_time: startTime, end_time: endTime, capacity,
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

  /** מה שכבר קיים ביומן ומתאים לתפקיד שנבחר — לסימון, לא להקלדה. */
  const loadFromCalendar = async () => {
    setError('');
    setBusy(true);
    try {
      const query = new URLSearchParams({ role, from, to, capacity: String(capacity) });
      const body = await callApi(`/api/shift-signup/calendar-slots?${query}`);
      setCandidates(body.candidates || []);
      setWithoutHours(body.withoutHours || 0);
      // ברירת המחדל היא רק מה שעוד לא מאויש — כדי שלא יישלח לצוות טופס שרובו
      // משמרות שכבר סגורות.
      setPickedIds((body.candidates || []).filter((c) => c.staffed < c.capacity).map((c) => c.id));
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

  const chosenSlots = source === 'calendar'
    ? (candidates || []).filter((c) => pickedIds.includes(c.id))
    : slots;

  const create = async () => {
    setError('');
    setBusy(true);
    try {
      const created = await callApi('/api/shift-signup/windows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title, role, work_type: workType, note, deadline: deadline || null,
          recipients, slots: chosenSlots,
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
          <AppSelect
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              // רשימת השמות נגזרה מהתפקיד הקודם; להשאיר אותה אחרי החלפה פירושו
              // לשלוח טופס „הפעלת קיר” בדיוק למי שנבחר בשביל „הדרכת חוג”.
              setRecipients([]);
              resetPreview();
            }}
          >
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

      <RecipientPicker
        employees={employees}
        role={role}
        value={recipients}
        onChange={setRecipients}
      />

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
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: 'var(--text-3)' }}>
          כמה אנשים צריך בכל משמרת
          <input
            className="input"
            type="number"
            min={1}
            max={20}
            value={capacity}
            onChange={(e) => { setCapacity(Number(e.target.value) || 1); resetPreview(); }}
          />
        </label>
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
        {source === 'calendar' ? (
          <button className="btn btn-ghost btn-sm" onClick={loadFromCalendar} disabled={busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <CalendarRange size={14} />} שליפה מהיומן
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

// ─── מסך אישור השיבוצים ─────────────────────────────────────────────────────
/**
 * מה שהמנהל מסמן כאן הוא טיוטה, ורק „אישור ושליחה” כותב אותה ליומן העבודה.
 *
 * הגרסה הראשונה שיבצה בכל לחיצה על שם, וזה הפך טופס של עשרים משמרות לעשרים
 * החלטות נפרדות שאי אפשר לראות יחד — מי קיבל יותר מדי, מי קיבל פחות ממה
 * שביקש, ומה עוד ריק. כאן רואים את התמונה כולה לפני שמישהו מקבל הודעה, וזה
 * גם מה שמאפשר לשלוח לכל עובד הודעה אחת עם כל המשמרות שלו במקום ארבע נפרדות.
 */
function SignupBoard({ windowId, onChanged }) {
  const [data, setData] = useState(null);
  const [picks, setPicks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [busySlot, setBusySlot] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await callApi(`/api/shift-signup/windows/${encodeURIComponent(windowId)}`));
      setPicks([]);
    } catch (e) {
      setError(e.message);
    }
  }, [windowId]);

  useEffect(() => { load(); }, [load]);

  const keyOf = (slotId, employeeId) => `${slotId}|${employeeId}`;
  const picked = useMemo(() => new Set(picks.map((p) => keyOf(p.slot_id, p.employee_id))), [picks]);

  const togglePick = (slot, person) => {
    setResult(null);
    const key = keyOf(slot.id, person.employee_id);
    setPicks((current) => (picked.has(key)
      ? current.filter((p) => keyOf(p.slot_id, p.employee_id) !== key)
      : [...current, { slot_id: slot.id, employee_id: person.employee_id }]));
  };

  /** ביטול שיבוץ קיים פועל מיד: הוא נוגע ביומן העבודה, לא בטיוטה. */
  const unassign = async (slot, person) => {
    if (!person.assignment_id) return;
    setBusySlot(keyOf(slot.id, person.employee_id));
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

  /**
   * אזהרות שנראות לפני האישור ולא אחריו. שתיהן חוקיות — חפיפה מכוונת, או
   * משמרת שסוכמה בטלפון — ולכן הן נאמרות ולא חוסמות.
   */
  const warnings = useMemo(() => {
    if (!data) return [];
    const out = [];
    const perEmployee = new Map();
    for (const slot of data.board || []) {
      const draft = (slot.signed || []).filter((p) => picked.has(keyOf(slot.id, p.employee_id))).length;
      const already = (slot.signed || []).filter((p) => p.assigned).length;
      if (draft + already > slot.capacity) {
        out.push(`${dayLabel(slot.date)} ${slot.start_time} — ${draft + already} אנשים למשמרת שצריכה ${slot.capacity}`);
      }
      for (const person of slot.signed || []) {
        if (!picked.has(keyOf(slot.id, person.employee_id)) && !person.assigned) continue;
        const entry = perEmployee.get(person.employee_id)
          || { name: person.name, wanted: person.wanted_count, count: 0 };
        entry.count += 1;
        perEmployee.set(person.employee_id, entry);
      }
    }
    for (const entry of perEmployee.values()) {
      if (entry.wanted && entry.count > entry.wanted) {
        out.push(`${entry.name} — ${entry.count} משמרות, ביקש ${entry.wanted}`);
      }
    }
    return out;
  }, [data, picked]);

  const approve = async () => {
    setBusy(true);
    setError('');
    try {
      const body = await callApi(`/api/shift-signup/windows/${encodeURIComponent(windowId)}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ picks }),
      });
      setResult(body);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
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
        סמנו מי לוקח כל משמרת, ואז „אישור ושליחה”. כל עובד יקבל הודעה אחת עם כל המשמרות שלו.
      </div>

      {error && <div style={{ fontSize: 12, color: 'var(--red)' }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(data.board || []).map((slot) => {
          const draft = (slot.signed || []).filter((p) => picked.has(keyOf(slot.id, p.employee_id))).length;
          const done = (slot.signed || []).filter((p) => p.assigned).length;
          const full = done + draft >= slot.capacity;
          return (
            <div
              key={slot.id}
              style={{
                border: '1px solid var(--border)', borderRadius: 12, padding: 12,
                background: full ? 'rgba(52,211,153,0.06)' : 'transparent',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {dayLabel(slot.date)} · {slot.start_time}–{slot.end_time}
                  {slot.label && (
                    <span style={{ fontWeight: 500, fontSize: 12.5, color: 'var(--text-3)' }}> · {slot.label}</span>
                  )}
                </div>
                <span className={`badge ${full ? 'badge-green' : 'badge-amber'}`}>
                  {done + draft} מתוך {slot.capacity}
                  {draft > 0 ? ` (${draft} ממתינים לאישור)` : ''}
                </span>
              </div>

              {slot.signed.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>אף אחד לא סימן את המשמרת הזו.</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  {slot.signed.map((person) => {
                    const key = keyOf(slot.id, person.employee_id);
                    const on = picked.has(key);
                    return (
                      <button
                        type="button"
                        key={person.employee_id}
                        className={`btn btn-sm ${person.assigned ? 'btn-primary' : on ? 'btn-secondary' : 'btn-ghost'}`}
                        disabled={busySlot === key || busy}
                        title={person.assigned
                          ? 'כבר שובץ — לחיצה מבטלת את השיבוץ ביומן'
                          : `סימן ${person.picked_count} משמרות${person.wanted_count ? `, רוצה ${person.wanted_count}` : ''}`}
                        onClick={() => (person.assigned ? unassign(slot, person) : togglePick(slot, person))}
                      >
                        {busySlot === key
                          ? <Loader2 size={13} className="spin" />
                          : person.assigned ? <Check size={13} /> : on ? <UserPlus size={13} /> : <Square size={13} />}
                        {person.name}
                        {person.wanted_count > 0 && !person.assigned && (
                          <span style={{ fontSize: 10.5, opacity: 0.7 }}> ({person.wanted_count})</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {warnings.length > 0 && (
        <div style={{ background: 'rgba(251,146,60,0.08)', border: '1px solid var(--amber)', borderRadius: 10, padding: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--amber)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={13} /> לשים לב לפני האישור
          </div>
          {warnings.map((text) => (
            <div key={text} style={{ fontSize: 12, color: 'var(--text-2)' }}>{text}</div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" onClick={approve} disabled={busy || picks.length === 0}>
          {busy ? <Loader2 size={14} className="spin" /> : <CalendarCheck size={14} />}
          אישור ושליחה{picks.length > 0 ? ` (${picks.length})` : ''}
        </button>
        {picks.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => setPicks([])} disabled={busy}>
            <X size={13} /> ניקוי הסימונים
          </button>
        )}
      </div>

      {result && (
        <div style={{ background: 'var(--bg-input)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            {result.created === 1 ? 'שיבוץ אחד נכתב' : `${result.created} שיבוצים נכתבו`} ליומן העבודה
          </div>
          {(result.notified || []).map((row) => (
            <div key={row.employee_id} style={{ fontSize: 12, color: row.ok ? 'var(--text-2)' : 'var(--red)' }}>
              {row.ok
                ? `✓ ${row.name} — נשלחה הודעה על ${row.shifts === 1 ? 'משמרת אחת' : `${row.shifts} משמרות`}`
                : `✗ ${row.name} — ${row.reason}`}
            </div>
          ))}
          {(result.skipped || []).length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
              {result.skipped.length} סימונים דולגו (כבר שובצו או שהמשמרת עברה)
            </div>
          )}
        </div>
      )}

      {(data.pending || []).length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>עוד לא ענו</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {data.pending.map((person) => (
              <span key={person.id} className="badge badge-amber">{person.name}</span>
            ))}
          </div>
        </div>
      )}

      {(data.respondents_detail || []).length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Users size={14} style={{ color: 'var(--violet)' }} /> מי ענה
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {data.respondents_detail.map((person) => (
              <span key={person.employee_id} className="badge badge-purple">
                {person.name} · סימן {person.picked}
                {person.wanted ? ` · רוצה ${person.wanted}` : ''} · שובץ {person.assigned}
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
  const [employees, setEmployees] = useState([]);
  const [sendingId, setSendingId] = useState('');
  const [sendResult, setSendResult] = useState(null);

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

  useEffect(() => {
    callApi('/api/employees')
      .then((rows) => setEmployees((Array.isArray(rows) ? rows : [])
        .filter((employee) => employee.is_active !== false && employee.active !== false)))
      .catch(() => setEmployees([]));
  }, []);

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

  /**
   * שליחת הקישור בוואטסאפ. חוסמת עד שהתשובה חוזרת, כי מי שלא קיבל צריך טיפול
   * ידני עכשיו — ובלי הרשימה הזאת „נשלח” היה נראה כמו „הגיע לכולם”.
   */
  const sendLink = async (row) => {
    setSendingId(row.id);
    setSendResult(null);
    setError('');
    try {
      const body = await callApi(`/api/shift-signup/windows/${encodeURIComponent(row.id)}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      setSendResult({ id: row.id, ...body });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSendingId('');
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
          employees={employees}
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
                    <Users size={13} /> {selectedId === row.id ? 'סגירת מסך האישור' : 'אישור שיבוצים'}
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => sendLink(row)}
                    disabled={sendingId === row.id}
                    title={row.sent_at ? 'שליחה חוזרת לכל מי שהטופס פונה אליו' : ''}
                  >
                    {sendingId === row.id ? <Loader2 size={13} className="spin" /> : <Send size={13} />}
                    {row.sent_at ? 'שליחה חוזרת' : 'שליחה לצוות'}
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
                  {row.missing === 0 ? 'כל המשמרות מאוישות'
                    : row.missing === 1 ? 'חסר שיבוץ אחד'
                      : `חסרים ${row.missing} שיבוצים`}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Link2 size={12} /> {linkOf(row)}
                </span>
              </div>

              {sendResult?.id === row.id && (
                <div style={{ background: 'var(--bg-input)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700 }}>
                    הקישור נשלח ל-{sendResult.sent} מתוך {(sendResult.results || []).length}
                  </div>
                  {(sendResult.results || []).filter((r) => !r.ok).map((r) => (
                    <div key={r.employee_id} style={{ fontSize: 12, color: 'var(--red)' }}>
                      ✗ {r.name} — {r.reason}
                    </div>
                  ))}
                </div>
              )}

              {selectedId === row.id && <SignupBoard windowId={row.id} onChanged={load} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
