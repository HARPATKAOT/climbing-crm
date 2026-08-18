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
  AlertTriangle, CalendarCheck, CalendarPlus, CalendarRange, Check, Copy, GraduationCap, Link2,
  Loader2, Lock, Unlock, Plus, Repeat, Send, Square, Trash2, UserPlus, Users, X,
} from 'lucide-react';
import AppSelect from './AppSelect.jsx';
import { assignableLabelsOf, rolesOf, useRoleCatalog } from '../utils/staffRoles.js';
import { isWallStaff } from '../utils/employeeScope.js';
import { activityFilterChips, activityTypeMeta, useActivityTypes } from '../utils/activityTypes.js';
import { activityTypeIcon } from '../utils/activityIcons.js';
import { roleIcon, roleColor } from '../utils/roleIcons.js';

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
 * התגית של החוגים.
 *
 * החוגים אינם ביומן — הם מסך אחר, עם טבלה אחרת — ולכן הם תגית נוספת ולא חלק
 * מהקטלוג. הם גם כבויים כברירת מחדל: שבעה-עשר חוגים על פני שבועיים הם ארבעים
 * משמרות, והן קברו את החמש שבשבילן המנהל בא.
 */
const CLASS_CHIP = {
  id: 'class',
  label: 'חוגים',
  color: '#FBBF24',
  bg: 'rgba(251,191,36,0.18)',
  match: ['class'],
};

/** „חופשה מאימונים” אינה משמרת שמישהו נרשם אליה — היא ביטול של אימונים. */
const NOT_A_SHIFT_TYPE = 'training_vacation';

/**
 * תגית סוג הפעילות, בצבע ובאייקון שלה ביומן.
 *
 * שם הרשומה לבדו לא מספיק: „הנקיק השחור” יכול להיות טיול או שעות פתיחה, והסוג
 * הוא מה שקובע איזה תפקיד מאייש אותה — כלומר בדיוק מה שהמנהל שוקל כשהוא בוחר
 * מה להציע.
 */
function TypeTag({ id }) {
  const meta = id === CLASS_CHIP.id ? CLASS_CHIP : activityTypeMeta(id);
  const Icon = id === CLASS_CHIP.id ? GraduationCap : activityTypeIcon(id);
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
        padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700,
        border: `1px solid ${meta.color}55`, background: meta.bg, color: meta.color,
      }}
    >
      <Icon size={11} strokeWidth={2.4} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

/**
 * אילו סוגי פעילות ייכנסו לטופס.
 *
 * אותן תגיות צבעוניות שביומן, מאותו קטלוג חי — כי „לבחור מהיומן” צריך להיראות
 * כמו היומן. `null` פירושו „כל מה שביומן”, בדיוק כמו במסך היומן עצמו, כך שסוג
 * שייווצר מחר ייכלל מעצמו בלי שאיש יזכור לסמן אותו.
 *
 * לצד כל תגית מופיע מה שהטווח מחזיק ממנה, ותגית שהתפקיד חוסם נראית חסומה
 * במפורש — זה ההבדל בין „אין שעות פתיחה בשבועיים הקרובים” לבין „שעות פתיחה
 * מאוישות על ידי הפעלת קיר, לא על ידי עוזר מדריך”.
 */
function TypeChips({ chips, selected, onChange, stats }) {
  const statOf = (chip) => {
    const rows = (stats || []).filter((s) => chip.match.includes(s.id));
    return rows.reduce((acc, s) => ({
      total: acc.total + s.total,
      withoutHours: acc.withoutHours + s.without_hours,
    }), { total: 0, withoutHours: 0 });
  };
  const isOn = (id) => (selected === null ? id !== CLASS_CHIP.id : selected.includes(id));
  const allIds = chips.map((c) => c.id);

  const toggle = (id) => {
    // מ„הכל” לרשימה מפורשת: קודם פורשים את מה שמסומן עכשיו, ורק אז מוסיפים או
    // מורידים — אחרת לחיצה אחת הייתה מכבה בשקט את כל השאר.
    const base = selected === null ? allIds.filter((x) => x !== CLASS_CHIP.id) : selected;
    const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    onChange(next);
  };

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span>אילו סוגי פעילות</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => onChange(selected === null ? [] : null)}
        >
          {selected === null ? 'הסתרת הכל' : 'כל מה שביומן'}
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {chips.map((chip) => {
          const on = isOn(chip.id);
          const stat = statOf(chip);
          const Icon = chip.id === CLASS_CHIP.id ? GraduationCap : activityTypeIcon(chip.id);
          return (
            <button
              type="button"
              key={chip.id}
              onClick={() => toggle(chip.id)}
              title={chip.id === CLASS_CHIP.id
                ? 'כל החוגים בטווח, בלי אפשרות לבחור קבוצות מסוימות'
                : on ? `להסתיר ${chip.label}` : `להציג ${chip.label}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '5px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${on ? chip.color : `${chip.color}55`}`,
                background: on ? chip.bg : `${chip.color}14`,
                color: chip.color,
                opacity: on ? 1 : 0.45,
                transition: 'opacity 0.12s ease',
              }}
            >
              <Icon size={13} strokeWidth={2.4} style={{ flexShrink: 0 }} aria-hidden="true" />
              {chip.label}
              {stat.total > 0 && (
                <span style={{ fontWeight: 500, opacity: 0.85 }}>· {stat.total}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * למי הטופס נשלח.
 *
 * רשימה ריקה פירושה „כל הצוות” — זו ברירת המחדל ולא מצב חסר. כדי לבחור קבוצה
 * אין צורך ללחוץ 23 שמות: הקיצורים ממלאים את הרשימה (עובדי קיר, עובדי חוץ, או
 * תפקיד מסוים), ומשם אפשר להוסיף ולהוריד שמות ידנית. „ניקוי הכל” מרוקן את
 * הסימון כדי להתחיל בחירה מאפס — וזה מצב שאי אפשר לשמור ממנו, כי טופס שלא
 * מגיע לאף אחד הוא טעות ולא בחירה.
 */
function RecipientPicker({ employees, value, onChange, cleared, onCleared }) {
  const [open, setOpen] = useState(false);
  // שני סינונים שמצטלבים: היכן העובד מועסק, ואילו תפקידים הוא מחזיק. „עובד קיר”
  // אינו תפקיד ולכן אינו שייך לאותה שורה — עוזר מדריך יכול להיות מהקיר או מבחוץ.
  const [scope, setScope] = useState('all');
  const [roleFilter, setRoleFilter] = useState([]);
  const explicit = value.length > 0;
  const isOn = (id) => (cleared ? false : (explicit ? value.includes(id) : true));

  const idsWhere = (predicate) => employees.filter(predicate).map((e) => e.id);
  const roleOptions = [...new Set(employees.flatMap((e) => rolesOf(e)))].sort((a, b) => a.localeCompare(b, 'he'));

  /** התוצאה של הצטלבות שני הסינונים. שניהם ריקים = כל הצוות, וזו רשימה ריקה. */
  const applyFilters = (nextScope, nextRoles) => {
    onCleared(false);
    setScope(nextScope);
    setRoleFilter(nextRoles);
    if (nextScope === 'all' && nextRoles.length === 0) {
      onChange([]);
      return;
    }
    onChange(idsWhere((employee) => {
      if (nextScope === 'wall' && !isWallStaff(employee)) return false;
      if (nextScope === 'external' && isWallStaff(employee)) return false;
      if (nextRoles.length === 0) return true;
      // די בתפקיד אחד מהמסומנים — „עוזר מדריך או בונה מסלולים”, לא „גם וגם”.
      return rolesOf(employee).some((role) => nextRoles.includes(role));
    }));
    setOpen(true);
  };

  const toggleRole = (role) => applyFilters(
    scope,
    roleFilter.includes(role) ? roleFilter.filter((r) => r !== role) : [...roleFilter, role]
  );

  const resetAll = () => {
    setScope('all');
    setRoleFilter([]);
    onCleared(false);
    onChange([]);
  };

  const toggle = (id) => {
    onCleared(false);
    // המעבר מ„כולם” לרשימה מפורשת מתחיל מכולם פחות מי שהוסר — אחרת לחיצה אחת
    // על שם אחד הייתה מבטלת בשקט את כל השאר.
    if (!explicit && !cleared) {
      onChange(employees.map((e) => e.id).filter((x) => x !== id));
      return;
    }
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  };

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span>למי לשלוח</span>
        <span className={`badge ${cleared ? 'badge-red' : 'badge-blue'}`}>
          {cleared ? 'לא נבחר אף אחד' : (explicit ? `${value.length} נבחרו` : `כל הצוות (${employees.length})`)}
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(!open)}>
          {open ? 'סגירה' : 'בחירת שמות'}
        </button>
        {(explicit || cleared) && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={resetAll}>
            <Users size={12} /> חזרה לכולם
          </button>
        )}
      </div>

      {/* שורה ראשונה: היכן העובד מועסק. בחירה יחידה, ולחיצה שנייה מבטלת. */}
      <div className="choice-row" style={{ marginTop: 8 }}>
        {[
          { key: 'wall', label: 'עובדי קיר', accent: '#34D399' },
          { key: 'external', label: 'עובדי חוץ', accent: '#FBBF24' },
        ].map(({ key, label, accent }) => (
          <button
            type="button"
            key={key}
            className={`choice-pill ${scope === key ? 'active' : ''}`}
            style={{ '--choice-accent': accent }}
            onClick={() => applyFilters(scope === key ? 'all' : key, roleFilter)}
          >
            <Users size={14} /> {label}
          </button>
        ))}
        <button
          type="button"
          className="choice-pill"
          style={{ '--choice-accent': '#F87171' }}
          onClick={() => { setScope('all'); setRoleFilter([]); onCleared(true); onChange([]); setOpen(true); }}
        >
          <X size={14} /> ניקוי הכל
        </button>
      </div>

      {/* שורה שנייה: תפקידים. אפשר לסמן כמה, ומספיק אחד מהם כדי להיכלל. */}
      <div className="choice-row" style={{ marginTop: 6 }}>
        {roleOptions.map((role) => {
          const RoleIcon = roleIcon(role);
          const on = roleFilter.includes(role);
          return (
            <button
              type="button"
              key={role}
              className={`choice-pill ${on ? 'active' : ''}`}
              style={{ '--choice-accent': roleColor(role) }}
              onClick={() => toggleRole(role)}
            >
              <RoleIcon size={14} /> {role}
            </button>
          );
        })}
      </div>

      {open && (
        <div className="choice-row" style={{ maxHeight: 132, overflowY: 'auto', marginTop: 8 }}>
          {employees.map((employee) => {
            const on = isOn(employee.id);
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
        </div>
      )}
    </div>
  );
}

// ─── יצירת טופס חדש ─────────────────────────────────────────────────────────
function NewWindowForm({ roleOptions, employees, onCancel, onCreated }) {
  const [title, setTitle] = useState('');
  const [workType, setWorkType] = useState('counter_shift');
  // התפקיד שדפוס שבועי מבקש. משמרות מהיומן נושאות את התפקידים שלהן מהאירוע,
  // ורק משמרת שמוקלדת כאן צריכה שיגידו לה מה היא צריכה.
  const [patternRole, setPatternRole] = useState(roleOptions[0] || '');
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(addDays(todayStr(), 13));
  const [weekdays, setWeekdays] = useState([0]);
  const [startTime, setStartTime] = useState('16:00');
  const [endTime, setEndTime] = useState('20:00');
  const [capacity, setCapacity] = useState(1);
  const [note, setNote] = useState('');
  const [deadline, setDeadline] = useState('');
  const [recipients, setRecipients] = useState([]);
  // „ניקוי הכל” — מצב ביניים של בחירה מאפס. רשימה ריקה לבדה פירושה „כל הצוות”,
  // ולכן צריך סימן נפרד כדי לא לשלוח בטעות לכולם.
  const [recipientsCleared, setRecipientsCleared] = useState(false);
  const [slots, setSlots] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // 'calendar' — משמרות שכבר קיימות ביומן; 'pattern' — דפוס שבועי שמוקלד כאן.
  const [source, setSource] = useState('calendar');
  const [candidates, setCandidates] = useState(null);
  const [withoutHours, setWithoutHours] = useState(0);
  const [pickedIds, setPickedIds] = useState([]);
  // null = כל מה שביומן, בלי חוגים — אותה מוסכמה שבמסך היומן, כדי שסוג חדש
  // ייכלל מעצמו במקום להישאר כבוי עד שמישהו ישים לב אליו.
  const [selectedTypes, setSelectedTypes] = useState(null);
  const [byType, setByType] = useState([]);
  const liveTypes = useActivityTypes();

  const typeChips = useMemo(() => [
    ...activityFilterChips().filter((chip) => chip.id !== NOT_A_SHIFT_TYPE),
    CLASS_CHIP,
  ], [liveTypes]);

  /** מה שנשלח לשרת: הסוגים הגולמיים שמאחורי התגיות שנבחרו. */
  const wantedTypes = useMemo(() => {
    const on = selectedTypes === null
      ? typeChips.filter((c) => c.id !== CLASS_CHIP.id)
      : typeChips.filter((c) => selectedTypes.includes(c.id));
    return [...new Set(on.flatMap((c) => c.match))];
  }, [selectedTypes, typeChips]);

  useEffect(() => {
    if (!patternRole && roleOptions.length) setPatternRole(roleOptions[0]);
  }, [patternRole, roleOptions]);

  /** כל שינוי שמזיז את מה שייכנס לטופס מבטל תצוגה מוקדמת ישנה. */
  const resetPreview = () => {
    setSlots([]);
    setCandidates(null);
    setPickedIds([]);
    // הספירות נמדדו על הטווח והתפקיד הקודמים; להשאיר אותן פירושו להראות
    // „11 שעות פתיחה” על טווח שכבר לא נשלף.
    setByType([]);
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
          needs: [{ role: patternRole, count: capacity }],
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

  /** מה שכבר קיים ביומן, עם התפקידים שכל אירוע צריך — לסימון, לא להקלדה. */
  const loadFromCalendar = async () => {
    setError('');
    setBusy(true);
    try {
      const query = new URLSearchParams({
        from,
        to,
        types: source === 'classes' ? CLASS_CHIP.id : wantedTypes.join(','),
      });
      const body = await callApi(`/api/shift-signup/calendar-slots?${query}`);
      setCandidates(body.candidates || []);
      setWithoutHours(body.withoutHours || 0);
      setByType(body.byType || []);
      // ברירת המחדל היא רק מה שעוד לא מאויש — כדי שלא יישלח לצוות טופס שרובו
      // משמרות שכבר סגורות.
      setPickedIds((body.candidates || [])
        .filter((c) => c.staffed < (c.needs || []).reduce((sum, n) => sum + n.count, 0))
        .map((c) => c.id));
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

  const chosenSlots = source !== 'pattern'
    ? (candidates || []).filter((c) => pickedIds.includes(c.id))
    : slots;

  /**
   * למה הרשימה ריקה.
   *
   * אין כאן עוד סינון לפי תפקיד, ולכן רשימה ריקה פירושה טווח ריק — וזה הדבר
   * היחיד שרשימה ריקה צריכה לומר. מה שכן שווה לומר הוא איזה סוג כן יש בטווח
   * וכבוי כרגע, כי זו הלחיצה שתחזיר תוצאות.
   */
  const emptyReason = useMemo(() => {
    const offstage = (byType || [])
      .filter((s) => s.total > 0)
      .map((s) => typeChips.find((c) => c.match.includes(s.id)))
      .filter((chip) => chip && !(selectedTypes === null ? chip.id !== CLASS_CHIP.id : selectedTypes.includes(chip.id)));
    if (offstage.length) {
      const names = [...new Set(offstage.map((c) => c.label))];
      return `אין משמרות מהסוגים שסומנו. יש בטווח ${names.join(', ')} — אפשר להדליק אותם למעלה.`;
    }
    return 'אין ביומן משמרות בטווח התאריכים הזה.';
  }, [byType, typeChips, selectedTypes]);

  const create = async () => {
    setError('');
    setBusy(true);
    try {
      const created = await callApi('/api/shift-signup/windows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title, work_type: workType, note, deadline: deadline || null,
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
        {source === 'pattern' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: 'var(--text-3)' }}>
            איזה תפקיד המשמרת צריכה
            <AppSelect value={patternRole} onChange={(e) => { setPatternRole(e.target.value); resetPreview(); }}>
              {roleOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </AppSelect>
          </label>
        )}
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
        value={recipients}
        onChange={setRecipients}
        cleared={recipientsCleared}
        onCleared={setRecipientsCleared}
      />

      {source === 'calendar' && (
        <TypeChips
          chips={typeChips}
          selected={selectedTypes}
          stats={byType}
          onChange={(next) => { setSelectedTypes(next); resetPreview(); }}
        />
      )}

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
            style={{ '--choice-accent': '#FBBF24' }}
            onClick={() => { setSource('classes'); resetPreview(); }}
          >
            <GraduationCap size={15} /> מלוח החוגים
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

      {source !== 'pattern' && candidates !== null && (
        <div style={{ background: 'var(--bg-input)', borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 10 }}>
            {candidates.length === 0
              ? emptyReason
              : `${candidates.length} משמרות ${source === 'classes' ? 'מלוח החוגים' : 'ביומן'}. סמנו מה להציע לצוות:`}
            {withoutHours > 0 && ` (${withoutHours} רשומות ביומן בלי שעות — אי אפשר להציע אותן להרשמה)`}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
            {candidates.map((slot) => {
              const on = pickedIds.includes(slot.id);
              const wants = (slot.needs || []).reduce((sum, n) => sum + n.count, 0);
              const full = slot.staffed >= wants;
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
                  {/* סוג הפעילות, בצבע שלו מהיומן. „הנקיק השחור” לבדו לא אומר
                      אם זה טיול או שעות פתיחה, וזה מה שקובע מי מאייש אותו. */}
                  <TypeTag id={slot.source_type} />
                  <span style={{ fontSize: 12, color: 'var(--text-3)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {slot.label}
                  </span>
                  {/* מה המשמרת צריכה ומה כבר מאויש, תפקיד תפקיד. „כבר 1” על
                      משמרת שצריכה מפעיל קיר ושני עוזרים לא אמר מי מהם כבר יש. */}
                  {(slot.staffing || slot.needs || []).filter((n) => n.role).map((need) => {
                    const NeedIcon = roleIcon(need.role);
                    const done = (need.staffed || 0) >= need.count;
                    return (
                      <span
                        key={need.role}
                        className={`badge ${done ? 'badge-green' : 'badge-amber'}`}
                        title={done
                          ? `${need.role} — מאויש`
                          : `${need.role} — שובצו ${need.staffed || 0} מתוך ${need.count}`}
                      >
                        <NeedIcon size={11} style={{ color: roleColor(need.role), flexShrink: 0 }} aria-hidden="true" />
                        {need.role} {need.staffed || 0}/{need.count}
                        {done && <Check size={11} aria-hidden="true" />}
                      </span>
                    );
                  })}
                  {full && (
                    <span className="badge badge-green">מאויש</span>
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
        <button
          className="btn btn-ghost btn-sm"
          onClick={loadFromCalendar}
          // רשימת סוגים ריקה פירושה „הכל” בחוט, ולכן כיבוי כל התגיות חייב
          // לחסום את השליפה במקום להחזיר בשקט את מה שהמנהל בדיוק כיבה.
          disabled={busy || (source === 'calendar' && wantedTypes.length === 0)}
          title={source === 'calendar' && wantedTypes.length === 0 ? 'בחרו לפחות סוג פעילות אחד' : ''}
        >
          {busy ? <Loader2 size={14} className="spin" /> : <CalendarRange size={14} />}
          {source === 'classes' ? ' שליפה מלוח החוגים' : ' שליפה מהיומן'}
        </button>
        <button
          className="btn btn-primary btn-sm"
          onClick={create}
          disabled={busy || !chosenSlots.length || !title.trim() || recipientsCleared}
          title={recipientsCleared
            ? 'לא נבחר אף עובד — סמנו למי לשלוח'
            : (!chosenSlots.length ? 'קודם שלפו משמרות וסמנו מה להציע' : '')}
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

  const togglePick = (slot, seat, person) => {
    setResult(null);
    const key = keyOf(slot.id, person.employee_id);
    setPicks((current) => (picked.has(key)
      ? current.filter((p) => keyOf(p.slot_id, p.employee_id) !== key)
      : [...current, { slot_id: slot.id, employee_id: person.employee_id, role: seat.role }]));
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
   *
   * הספירה היא לפי מושב: שני עוזרים על מקום של אחד הם חריגה גם כשסך האנשים
   * במשמרת תקין, וזה בדיוק המקרה שספירה לפי משמרת פספסה.
   */
  const warnings = useMemo(() => {
    if (!data) return [];
    const out = [];
    const perEmployee = new Map();
    for (const slot of data.board || []) {
      for (const seat of slot.seats || []) {
        const draft = (seat.claimants || []).filter((p) => !p.assigned && picked.has(keyOf(slot.id, p.employee_id))).length;
        if (seat.assigned + draft > seat.needed) {
          out.push(`${dayLabel(slot.date)} ${slot.start_time}${seat.role ? ` · ${seat.role}` : ''} — ${seat.assigned + draft} אנשים למקום של ${seat.needed}`);
        }
        for (const person of seat.claimants || []) {
          if (!picked.has(keyOf(slot.id, person.employee_id)) && !person.assigned) continue;
          const entry = perEmployee.get(person.employee_id)
            || { name: person.name, wanted: person.wanted_count, count: 0 };
          entry.count += 1;
          perEmployee.set(person.employee_id, entry);
        }
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
        <div style={{ marginTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11 }}>
          <span><Square size={11} style={{ verticalAlign: '-1px' }} /> פנוי — הודיע שהוא יכול</span>
          <span><UserPlus size={11} style={{ verticalAlign: '-1px' }} /> לשיבוץ — ייכנס באישור</span>
          <span><Check size={11} style={{ verticalAlign: '-1px' }} /> משובץ — כבר ביומן העבודה</span>
        </div>
      </div>

      {error && <div style={{ fontSize: 12, color: 'var(--red)' }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(data.board || []).map((slot) => {
          const draft = (slot.seats || []).reduce((sum, seat) => sum + (seat.claimants || [])
            .filter((p) => !p.assigned && picked.has(keyOf(slot.id, p.employee_id))).length, 0);
          const full = slot.missing - draft <= 0;
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
                  {full ? 'מאויש' : `חסרים ${slot.missing - draft}`}
                  {draft > 0 ? ` · ${draft} ממתינים לאישור` : ''}
                </span>
              </div>

              {/* שורה לכל תפקיד. „שובצו 2 מתוך 3” לא אומר כלום כשהשלושה הם
                  מפעיל קיר ושני עוזרים — שני עוזרים בלי מפעיל אינם משמרת. */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                {(slot.seats || []).map((seat) => {
                  const seatDraft = (seat.claimants || [])
                    .filter((p) => !p.assigned && picked.has(keyOf(slot.id, p.employee_id))).length;
                  const seatFull = seat.assigned + seatDraft >= seat.needed;
                  const SeatIcon = roleIcon(seat.role);
                  return (
                    <div key={seat.role || 'any'} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <span
                        className={`badge ${seatFull ? 'badge-green' : 'badge-amber'}`}
                        style={{ minWidth: 128, justifyContent: 'center' }}
                      >
                        <SeatIcon size={12} style={{ color: roleColor(seat.role), flexShrink: 0 }} aria-hidden="true" />
                        {seat.role || 'משמרת'} · {seat.assigned + seatDraft}/{seat.needed}
                      </span>
                      {(seat.claimants || []).length === 0 ? (
                        <span style={{ fontSize: 12, color: 'var(--text-3)', alignSelf: 'center' }}>
                          אף אחד לא ביקש את התפקיד הזה
                        </span>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flex: 1 }}>
                          {seat.claimants.map((person) => {
                            const key = keyOf(slot.id, person.employee_id);
                            const on = picked.has(key);
                            return (
                              <button
                                type="button"
                                key={person.employee_id}
                                className={`btn btn-sm ${person.assigned ? 'btn-primary' : on ? 'btn-secondary' : 'btn-ghost'}`}
                                disabled={busySlot === key || busy}
                                title={person.assigned
                                  ? (person.answered
                                    ? 'כבר שובץ — לחיצה מבטלת את השיבוץ ביומן'
                                    : 'שובץ מהיומן, בלי לענות לטופס — לחיצה מבטלת')
                                  : `ביקש ${person.picked_count} משמרות${person.wanted_count ? `, רוצה ${person.wanted_count}` : ''}`}
                                onClick={() => (person.assigned
                                  ? unassign(slot, person)
                                  : togglePick(slot, seat, person))}
                              >
                                {busySlot === key
                                  ? <Loader2 size={13} className="spin" />
                                  : person.assigned ? <Check size={13} /> : on ? <UserPlus size={13} /> : <Square size={13} />}
                                {person.name}
                                {/* המצב נכתב במילה ולא רק בצבע: „בר שניר” בכחול
                                    לא אמר אם הוא כבר משובץ, מסומן לשיבוץ, או רק
                                    הודיע שהוא פנוי. */}
                                {person.assigned && (
                                  <span style={{ fontSize: 10.5, opacity: 0.8 }}>
                                    {' · משובץ'}{!person.answered ? ' מהיומן' : ''}
                                  </span>
                                )}
                                {!person.assigned && on && (
                                  <span style={{ fontSize: 10.5, opacity: 0.8 }}> · לשיבוץ</span>
                                )}
                                {!person.assigned && !on && (
                                  <span style={{ fontSize: 10.5, opacity: 0.7 }}> · פנוי</span>
                                )}
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
  const [linksFor, setLinksFor] = useState('');
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

  /**
   * קישור אישי לעובד אחד.
   *
   * הכתובת הכללית מפילה את מי שפותח אותה לבורר שמות פתוח — ומי שקיבל אותה
   * בהעברה יכול לענות בשם כל אחד. לכן ההעתקה היא תמיד של קישור אישי.
   */
  const copyPersonalLink = async (row, employee) => {
    try {
      const body = await callApi(`/api/shift-signup/windows/${encodeURIComponent(row.id)}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: employee.id }),
      });
      try {
        await navigator.clipboard.writeText(body.link);
        setCopiedId(`${row.id}:${employee.id}`);
        setTimeout(() => setCopiedId(''), 2000);
      } catch {
        window.prompt(`הקישור של ${employee.name}:`, body.link);
      }
    } catch (e) {
      setError(e.message);
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
                    {rangeLabel(row.first_date, row.last_date)} · {row.slot_count} משמרות
                    {(row.roles || []).length > 0 && ` · ${row.roles.join(', ')}`}
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
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setLinksFor(linksFor === row.id ? '' : row.id)}
                  >
                    <Copy size={13} /> קישורים אישיים
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

              {linksFor === row.id && (
                <div style={{ background: 'var(--bg-input)', borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>
                    לחיצה על שם מעתיקה את הקישור האישי שלו. קישור אישי פותח את הטופס על שמו
                    ואי אפשר לענות דרכו בשם מישהו אחר.
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {employees
                      .filter((e) => !(row.recipients || []).length || (row.recipients || []).includes(e.id))
                      .map((employee) => (
                        <button
                          key={employee.id}
                          className={`btn btn-sm ${copiedId === `${row.id}:${employee.id}` ? 'btn-primary' : 'btn-ghost'}`}
                          onClick={() => copyPersonalLink(row, employee)}
                        >
                          {copiedId === `${row.id}:${employee.id}` ? <Check size={12} /> : <Copy size={12} />}
                          {employee.name}
                        </button>
                      ))}
                  </div>
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
