import React, { useState, useEffect, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Edit2, Trash2, Save, X, Users, Calendar, UserPlus, UserMinus, History, Loader2, ChevronLeft, ChevronRight, Package, Footprints, Shirt, Sparkles, ExternalLink, FolderOpen, AlertTriangle } from 'lucide-react';
import { DAYS_FULL } from '../mockData.js';
import {
  getGroupDays,
  localDateStr,
  dateToWeekday,
  ATT_STATUS,
  ATT_MARK_KEYS,
  consecutiveAbsences,
  normalizeAttStatus,
  isAttPresent,
  isAttPending,
  isAttAbsent,
  attStatusMeta,
} from '../scheduleUtils.js';
import { StatusPill } from './AttendanceList.jsx';
import {
  EQUIPMENT_LABELS,
  applyEquipmentTone,
  equipmentItemTone,
  equipmentToneColor,
  equipmentToneBg,
  equipmentToneLabel,
} from './equipmentUtils.js';
import { studentInGroup, studentGroupIds } from '../utils/studentGroups.js';

// Pulled in only when a trainee file is actually opened from the schedule.
const StudentFilePanel = lazy(() => import('./StudentFilePanel.jsx'));

const EQUIPMENT_ICONS = {
  shoes: Footprints,
  shirt: Shirt,
  chalk_bag: Sparkles,
};

/** Matrix columns (RTL: after kid name, right→left): chalk, shoes, shirt */
const EQUIPMENT_MATRIX_COLS = ['chalk_bag', 'shoes', 'shirt'];

const EQUIPMENT_LEGEND_TONES = [
  { tone: 'unpaid', label: 'ממתין לתשלום' },
  { tone: 'awaiting', label: 'שולם' },
  { tone: 'given', label: 'נמסר' },
  { tone: 'own', label: 'מהבית' },
  { tone: 'declined', label: 'לא מעוניינים' },
];

async function ensureAttendance({ date, groupId } = {}) {
  const res = await fetch('/api/attendance/ensure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, groupId }),
  });
  if (!res.ok) throw new Error('ensure failed');
  return res.json();
}

async function saveAttendanceMark(record) {
  const res = await fetch('/api/attendance/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: [record] }),
  });
  if (!res.ok) throw new Error('mark failed');
  const saved = await res.json();
  return Array.isArray(saved) ? saved[0] : saved;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const AGE_COLORS = {
  "א'-ב'":  { bg: 'rgba(99,102,241,0.15)',  border: 'rgba(99,102,241,0.35)',  text: '#A5B4FC' },
  "ג'-ד'":  { bg: 'rgba(16,185,129,0.13)',  border: 'rgba(16,185,129,0.35)',  text: '#34D399' },
  "ה'-ו'":  { bg: 'rgba(245,158,11,0.13)',  border: 'rgba(245,158,11,0.35)',  text: '#FCD34D' },
  'חטיבה':  { bg: 'rgba(168,85,247,0.13)',  border: 'rgba(168,85,247,0.35)',  text: '#C084FC' },
  'תיכון':  { bg: 'rgba(236,72,153,0.13)',  border: 'rgba(236,72,153,0.35)',  text: '#F472B6' },
  'בוגרים': { bg: 'rgba(6,182,212,0.13)',   border: 'rgba(6,182,212,0.35)',   text: '#67E8F9' },
};
const DEF_COLOR = { bg: 'rgba(99,102,241,0.12)', border: 'rgba(99,102,241,0.3)', text: '#A5B4FC' };

// Grid: 1.5px per minute, starting at 14:00, ending at 22:00
const START_MIN  = 14 * 60;   // 840 min
const END_MIN    = 22 * 60;   // 1320 min
const PX_PER_MIN = 1.5;
const HOUR_H     = 60 * PX_PER_MIN;  // 90px
const GRID_H     = (END_MIN - START_MIN) * PX_PER_MIN; // 720px
const HOURS      = Array.from({ length: 9 }, (_, i) => 14 + i); // 14..22

const AGE_CATEGORIES = ["א'-ב'", "ג'-ד'", "ה'-ו'", 'חטיבה', 'תיכון', 'בוגרים'];
const TIME_OPTIONS = [
  '14:00','15:00','15:30','16:00','16:30',
  '17:00','17:10','17:30','18:00','18:10',
  '18:40','19:00','19:10','19:40','20:00','20:10','20:30',
];
const DUR_OPTIONS = [
  { val: 50, label: '50 דקות' },
  { val: 80, label: '80 דקות' },
  { val: 110, label: '110 דקות' },
];

/** Consecutive-absence warning, amber for one meeting and red from two on. */
function AbsenceStreakPill({ streak }) {
  if (!streak) return null;
  const color = streak >= 2 ? 'var(--red)' : 'var(--amber)';
  const label = streak === 1 ? 'החמיץ אימון אחרון' : `${streak} היעדרויות רצופות`;
  return (
    <span
      title={`${label} — בקבוצה זו`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 999,
        background: `${streak >= 2 ? 'rgba(248,113,113,' : 'rgba(251,191,36,'}0.14)`,
        border: `1px solid ${color}55`,
        color,
        fontSize: 10,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      <AlertTriangle size={10} strokeWidth={2.5} />
      {label}
    </span>
  );
}

/** Explicit "open the customer file" button, next to the trainee it belongs to. */
function StudentFileButton({ student, onOpen }) {
  if (!onOpen) return null;
  return (
    <button
      type="button"
      className="btn btn-ghost btn-xs"
      onClick={(e) => { e.stopPropagation(); onOpen(student.id); }}
      title={`פתיחת תיק הלקוח של ${student.name}`}
      style={{ border: '1px solid var(--border)', color: 'var(--blue)', gap: 4, flexShrink: 0 }}
    >
      <FolderOpen size={12} /> תיק לקוח
    </button>
  );
}

/** Trainee name as a link into their customer file; plain text when no handler. */
function StudentNameLink({ student, onOpen, size = 13, truncate = false, showIcon = true }) {
  const nameStyle = {
    fontWeight: 700,
    fontSize: size,
    ...(truncate
      ? { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
      : {}),
  };

  if (!onOpen) return <div style={nameStyle}>{student.name}</div>;

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen(student.id); }}
      title={`פתיחת תיק המתאמן — ${student.name}`}
      style={{
        ...nameStyle,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        maxWidth: '100%',
        padding: 0,
        background: 'none',
        border: 'none',
        color: 'var(--blue)',
        textDecoration: 'underline',
        textUnderlineOffset: 3,
        textDecorationColor: 'rgba(56,189,248,0.5)',
        cursor: 'pointer',
        textAlign: 'right',
      }}
    >
      <span style={truncate ? { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' } : undefined}>
        {student.name}
      </span>
      {showIcon && <ExternalLink size={11} style={{ flexShrink: 0, opacity: 0.85 }} />}
    </button>
  );
}

function t2m(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function topPx(time)   { return (t2m(time) - START_MIN) * PX_PER_MIN; }
function heightPx(dur) { return dur * PX_PER_MIN; }

// ─── Positioned Group Block ───────────────────────────────────────────────────
function GroupBlock({ group, enrolledCount, selected, onClick }) {
  const c    = AGE_COLORS[group.ageCategory] || DEF_COLOR;
  const top  = topPx(group.time);
  const h    = heightPx(group.duration);
  const pct  = group.maxSlots > 0 ? (enrolledCount / group.maxSlots * 100) : 0;
  const full = enrolledCount >= group.maxSlots;

  // Short label
  const label = group.name
    .replace(/—\s*יום\s*[א-ו]׳\s*/g, '')
    .replace(/—\s*[א-ו]׳\+[א-ו]׳\s*/g, '')
    .trim();

  return (
    <div onClick={onClick} style={{
      position: 'absolute',
      top: `${top}px`,
      height: `${h}px`,
      left: '3px',
      right: '3px',
      background: c.bg,
      border: `1.5px solid ${selected ? c.text : c.border}`,
      borderRadius: 7,
      padding: '5px 7px',
      cursor: 'pointer',
      overflow: 'hidden',
      boxShadow: selected ? `0 0 0 2px ${c.text}44, 0 4px 16px ${c.bg}` : '0 1px 4px rgba(0,0,0,0.2)',
      transition: 'box-shadow 0.15s, border-color 0.15s',
      zIndex: selected ? 10 : 2,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
    }}>
      {/* Name */}
      <div style={{ fontSize: Math.min(12, h > 65 ? 12 : 10), fontWeight: 700, color: c.text,
        lineHeight: 1.25, overflow: 'hidden', display: '-webkit-box',
        WebkitLineClamp: h > 55 ? 2 : 1, WebkitBoxOrient: 'vertical' }}>
        {label}
      </div>

      {/* Time + trainer */}
      {h >= 60 && (
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
          {group.time} · {group.duration}′{group.trainerName ? ` · ${group.trainerName}` : ''}
        </div>
      )}

      {/* Capacity bar */}
      {h >= 55 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 'auto', paddingTop: 3 }}>
          <div style={{ flex: 1, height: 2.5, borderRadius: 2, background: 'rgba(255,255,255,0.1)' }}>
            <div style={{ width: `${Math.min(pct,100)}%`, height: '100%', borderRadius: 2,
              background: full ? '#EF4444' : c.text }} />
          </div>
          <span style={{ fontSize: 9, fontWeight: 700, color: full ? '#FCA5A5' : 'rgba(255,255,255,0.45)' }}>
            {enrolledCount}/{group.maxSlots}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Group Form Modal (Add / Edit) ────────────────────────────────────────────
function GroupFormModal({ group, employees, onSave, onDelete, onClose }) {
  const [name,       setName]       = useState(group?.name || '');
  const [day,        setDay]        = useState(group?.day ?? 0);
  const [time,       setTime]       = useState(group?.time || '16:00');
  const [duration,   setDuration]   = useState(group?.duration || 80);
  const [trainer,    setTrainer]    = useState(group?.trainer || '');
  const [maxSlots,   setMaxSlots]   = useState(group?.maxSlots || 12);
  const [ageCat,     setAgeCat]     = useState(group?.ageCategory || "ג'-ד'");
  const [priceWeek,  setPriceWeek]  = useState(group?.priceWeek || 280);
  const [priceTwice, setPriceTwice] = useState(group?.priceTwice || 360);
  const [waParents,  setWaParents]  = useState(group?.waParents || '');
  const [waClimbers, setWaClimbers] = useState(group?.waClimbers || '');

  const handleDelete = () => {
    if (!group?.id || !onDelete) return;
    const label = name.trim() || group.name || 'הקבוצה';
    if (!window.confirm(`למחוק את הקבוצה "${label}" לצמיתות?`)) return;
    onDelete(group.id);
    onClose();
  };

  // Active employees for the dropdown, but always keep the group's current
  // trainer visible even if they've since been marked inactive.
  const trainerOptions = employees.filter(e => e.active !== false || e.id === trainer);

  const handleSubmit = (e) => {
    e.preventDefault();
    const autoName = `${ageCat} — יום ${DAYS_FULL[day]} ${time}`;
    onSave({
      ...(group || {}),
      id:          group?.id || `g-${Date.now()}`,
      name:        name.trim() || autoName,
      day:         parseInt(day),
      time,
      duration:    parseInt(duration),
      trainer:     trainer,
      maxSlots:    parseInt(maxSlots),
      ageCategory: ageCat,
      priceWeek:   parseFloat(priceWeek) || 0,
      priceTwice:  parseFloat(priceTwice) || 0,
      waParents,
      waClimbers,
    });
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal slide-up" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div className="modal-title">{group ? '✏️ עריכת קבוצה' : '➕ קבוצה חדשה'}</div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal-body">
          <form id="gf" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-group">
              <label className="form-label">שם הקבוצה (אופציונלי)</label>
              <input className="input" value={name} onChange={e => setName(e.target.value)}
                placeholder={`${ageCat} — יום ${DAYS_FULL[day]} ${time}`} />
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">יום בשבוע *</label>
                <select className="input select" value={day} onChange={e => setDay(e.target.value)}>
                  {DAYS_FULL.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">שעת התחלה *</label>
                <select className="input select" value={time} onChange={e => setTime(e.target.value)}>
                  {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">משך אימון</label>
                <select className="input select" value={duration} onChange={e => setDuration(e.target.value)}>
                  {DUR_OPTIONS.map(d => <option key={d.val} value={d.val}>{d.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">קטגוריית גיל</label>
                <select className="input select" value={ageCat} onChange={e => setAgeCat(e.target.value)}>
                  {AGE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">מדריך</label>
                <select className="input select" value={trainer} onChange={e => setTrainer(e.target.value)}>
                  <option value="">בחר מדריך...</option>
                  {trainerOptions.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">מקסימום משתתפים</label>
                <input className="input" type="number" min={1} max={30} value={maxSlots}
                  onChange={e => setMaxSlots(e.target.value)} />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">מחיר פעם/שבוע (₪)</label>
                <input className="input" type="number" min={0} value={priceWeek}
                  onChange={e => setPriceWeek(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">מחיר פעמיים/שבוע (₪)</label>
                <input className="input" type="number" min={0} value={priceTwice}
                  onChange={e => setPriceTwice(e.target.value)} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">לינק וואטסאפ הורים</label>
              <input className="input" placeholder="https://chat.whatsapp.com/..." value={waParents}
                onChange={e => setWaParents(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">לינק וואטסאפ מטפסים</label>
              <input className="input" placeholder="https://chat.whatsapp.com/..." value={waClimbers}
                onChange={e => setWaClimbers(e.target.value)} />
            </div>
          </form>
        </div>

        <div className="modal-footer" style={{ justifyContent: 'space-between', gap: 10 }}>
          {group?.id && onDelete ? (
            <button type="button" className="btn btn-ghost" style={{ color: 'var(--red)' }} onClick={handleDelete}>
              <Trash2 size={15} /> מחק קבוצה
            </button>
          ) : (
            <span />
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={onClose}>ביטול</button>
            <button form="gf" type="submit" className="btn btn-primary">
              <Save size={15} /> {group ? 'שמור שינויים' : 'הוסף קבוצה'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Attendance Modal (Supabase-persisted via API) ────────────────────────────
function AttendanceModal({ group, students, parents, employees, initialDate, onClose, onMarked, onOpenStudent }) {
  const members = students.filter(s => studentInGroup(s, group.id) && s.status !== 'archived');
  const [date, setDate] = useState(initialDate || localDateStr());
  const [view, setView] = useState('sheet'); // 'sheet' | 'history'
  const [state, setState] = useState({});          // studentId -> status
  const [existingIds, setExistingIds] = useState({}); // studentId -> attendance row id
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [savedMsg, setSavedMsg] = useState('');
  const [history, setHistory] = useState([]);
  const [studentHistory, setStudentHistory] = useState({}); // studentId -> rows

  const trainer = employees?.find(e => e.id === group.trainer);
  const dayLabel = DAYS_FULL[dateToWeekday(date)] || '';
  const pendingCount = members.filter(m => isAttPending(state[m.id])).length;

  const applyRows = (rows) => {
    const st = {}; const ids = {};
    members.forEach(m => { st[m.id] = 'pending'; });
    (rows || []).forEach(r => {
      st[r.student_id] = normalizeAttStatus(r.status);
      ids[r.student_id] = r.id;
    });
    setState(st);
    setExistingIds(ids);
  };

  // Ensure pending rows, then load marks for the selected date.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSavedMsg('');
    (async () => {
      try {
        await ensureAttendance({ date, groupId: group.id });
        const r = await fetch(`/api/attendance?groupId=${encodeURIComponent(group.id)}&date=${date}`);
        const rows = r.ok ? await r.json() : [];
        if (!cancelled) applyRows(rows);
      } catch {
        if (!cancelled) applyRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, group.id, members.length]);

  const loadHistory = () => {
    fetch(`/api/attendance?groupId=${encodeURIComponent(group.id)}`)
      .then(r => (r.ok ? r.json() : []))
      .then(rows => {
        const byDate = {};
        const byStudent = {};
        (rows || []).forEach(r => {
          if (!byDate[r.date]) byDate[r.date] = { date: r.date, present: 0, absent: 0, pending: 0, intro: 0, total: 0 };
          byDate[r.date].total++;
          const s = normalizeAttStatus(r.status);
          if (s === 'intro_attended' || s === 'intro_absent') byDate[r.date].intro++;
          if (s === 'pending') byDate[r.date].pending++;
          else if (isAttPresent(r.status)) byDate[r.date].present++;
          else if (isAttAbsent(r.status)) byDate[r.date].absent++;
          if (!byStudent[r.student_id]) byStudent[r.student_id] = [];
          byStudent[r.student_id].push(r);
        });
        setHistory(Object.values(byDate).sort((a, b) => b.date.localeCompare(a.date)));
        setStudentHistory(byStudent);
      })
      .catch(() => {});
  };

  /** Counted up to the meeting on screen, so past dates read as they did then. */
  const absenceStreakFor = (studentId) => consecutiveAbsences(
    (studentHistory[studentId] || []).filter((row) => String(row.date || '') <= date)
  );
  useEffect(() => { loadHistory(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [group.id]);

  const markStatus = async (sid, status) => {
    setSavingId(sid);
    setSavedMsg('');
    setState(prev => ({ ...prev, [sid]: status }));
    try {
      const saved = await saveAttendanceMark({
        id: existingIds[sid] || `att-${group.id}-${date}-${sid}`,
        student_id: sid,
        group_id: group.id,
        date,
        status,
        marked_by: group.trainer || null,
      });
      if (saved?.id) setExistingIds(prev => ({ ...prev, [sid]: saved.id }));
      setSavedMsg('עודכן ✓');
      loadHistory();
      onMarked?.();
    } catch {
      setSavedMsg('שגיאה בשמירה');
    } finally {
      setSavingId(null);
    }
  };

  const markOptionsFor = (s) => {
    const isIntro = s.status === 'intro_scheduled' || s.status === 'intro_paid';
    if (isIntro) {
      return ATT_STATUS.filter((o) =>
        ['intro_attended', 'intro_absent', 'attended', 'absent'].includes(o.key)
      );
    }
    return ATT_STATUS.filter((o) => ATT_MARK_KEYS.includes(o.key));
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal slide-up" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">יומן נוכחות — {group.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
              {dayLabel} · {group.time}
              {trainer ? ` · מדריך: ${trainer.name}` : group.trainerName ? ` · מדריך: ${group.trainerName}` : ''}
              {' · '}{members.length} רשומים
              {pendingCount > 0 && (
                <span style={{ color: '#60A5FA', marginRight: 6 }}> · {pendingCount} ממתינים למילוי</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <Calendar size={13} style={{ color: 'var(--text-3)' }} />
              <input
                type="date"
                className="input input-xs"
                style={{ background: '#1F2937', color: 'white', border: 'none', padding: '2px 6px', width: 140 }}
                value={date}
                onChange={e => setDate(e.target.value)}
              />
            </div>
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><X size={18} /></button>
        </div>

        <div style={{ display: 'flex', gap: 6, padding: '10px 16px 0' }}>
          <button className={`btn btn-sm ${view === 'sheet' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setView('sheet')}>
            <Users size={14} /> גיליון יומי
          </button>
          <button className={`btn btn-sm ${view === 'history' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setView('history')}>
            <History size={14} /> היסטוריה
          </button>
        </div>

        <div className="modal-body" style={{ maxHeight: 420, overflowY: 'auto' }}>
          {view === 'sheet' && (
            loading ? (
              <div className="empty-state" style={{ padding: 32 }}>
                <Loader2 size={20} className="spin" />
                <div className="empty-state-sub" style={{ marginTop: 8 }}>יוצר / טוען נוכחות...</div>
              </div>
            ) : members.length === 0 ? (
              <div className="empty-state" style={{ padding: 32 }}>
                <div className="empty-state-title">אין מתאמנים רשומים בחוג זה</div>
                <div className="empty-state-sub">שבץ מתאמנים לקבוצה כדי שיווצרו פריטי נוכחות אוטומטית</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {members.map(s => {
                  const parent = parents.find(p => p.id === s.parentId);
                  const currentStatus = normalizeAttStatus(state[s.id] || 'pending');
                  const meta = attStatusMeta(currentStatus);
                  const isIntro = s.status === 'intro_scheduled' || s.status === 'intro_paid';
                  return (
                    <div key={s.id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                      padding: 10, background: '#111827', borderRadius: 8,
                      border: `1px solid ${isAttPending(currentStatus) ? 'rgba(59,130,246,0.45)' : 'var(--border)'}`,
                      flexWrap: 'wrap',
                    }}>
                      <div style={{ minWidth: 120 }}>
                        <StudentNameLink student={s} onOpen={onOpenStudent} />
                        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                          {isIntro ? 'אימון הכירות · ' : ''}
                          {parent?.name ? `הורה: ${parent.name}` : ''}
                          {parent?.phone ? ` · ${parent.phone}` : ''}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 3 }}>
                          <StatusPill meta={meta} />
                          <AbsenceStreakPill streak={absenceStreakFor(s.id)} />
                          {savingId === s.id && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>שומר...</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {markOptionsFor(s).map(opt => (
                          <button
                            key={opt.key}
                            type="button"
                            className="btn btn-xs"
                            disabled={savingId === s.id}
                            title={opt.label}
                            style={{
                              background: currentStatus === opt.key ? opt.color : 'rgba(255,255,255,0.03)',
                              color: currentStatus === opt.key ? 'white' : 'var(--text-3)',
                              fontWeight: currentStatus === opt.key ? 'bold' : 'normal',
                              border: '1px solid rgba(255,255,255,0.05)'
                            }}
                            onClick={() => markStatus(s.id, opt.key)}
                          >
                            {opt.shortLabel || opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}

          {view === 'history' && (
            history.length === 0 ? (
              <div className="empty-state" style={{ padding: 32 }}>
                <div className="empty-state-title">אין נתוני נוכחות</div>
                <div className="empty-state-sub">פריטי נוכחות נוצרים אוטומטית בימי אימון</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {history.map(h => (
                  <button key={h.date} onClick={() => { setDate(h.date); setView('sheet'); }}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: 10, background: '#111827', borderRadius: 8, border: '1px solid var(--border)',
                      cursor: 'pointer', textAlign: 'right',
                    }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>
                      {new Date(`${h.date}T12:00:00`).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric' })}
                    </div>
                    <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                      <span style={{ color: '#34D399' }}>✓ {h.present}</span>
                      <span style={{ color: '#FCA5A5' }}>✗ {h.absent}</span>
                      {h.pending > 0 && <span style={{ color: '#60A5FA' }}>ממתין {h.pending}</span>}
                      {h.intro > 0 && <span style={{ color: '#A5B4FC' }}>הכירות {h.intro}</span>}
                    </div>
                  </button>
                ))}
              </div>
            )
          )}
        </div>

        <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: savedMsg.includes('שגיאה') ? 'var(--red)' : 'var(--green)' }}>{savedMsg}</span>
          <button className="btn btn-ghost" onClick={onClose}>סגור</button>
        </div>
      </div>
    </div>
  );
}

// ─── Group Detail Side Panel ──────────────────────────────────────────────────
function GroupPanel({ group, students, parents, employees, onClose, onEdit, onDelete, onAttendance, onAssignStudent, onRemoveStudent, initialAttDate, onOpenStudent }) {
  const days = getGroupDays(group);
  const meetsToday = days.includes(dateToWeekday(localDateStr()));
  const [tab, setTab] = useState(meetsToday ? 'attendance' : 'members');
  const [assignId, setAssignId] = useState('');
  const [attDate, setAttDate] = useState(initialAttDate || localDateStr());
  const [attState, setAttState] = useState({});
  const [attIds, setAttIds] = useState({});
  const [attLoading, setAttLoading] = useState(false);
  const [attSavingId, setAttSavingId] = useState(null);
  const [attHistory, setAttHistory] = useState({}); // studentId -> rows in this group
  const [eqByStudent, setEqByStudent] = useState({});
  const [eqLoading, setEqLoading] = useState(false);
  const [eqBusyId, setEqBusyId] = useState('');
  const [eqEditId, setEqEditId] = useState('');
  const [eqError, setEqError] = useState('');
  const c = AGE_COLORS[group.ageCategory] || DEF_COLOR;

  const seatedMembers = students.filter(s =>
    studentInGroup(s, group.id)
    && s.status !== 'archived'
    && s.status !== 'waitlist'
  );
  const waitlistMembers = students.filter(s =>
    studentInGroup(s, group.id) && s.status === 'waitlist'
  );
  const members = seatedMembers;
  const kidMembers = members.filter(s => !s.isAdult);
  const assignable = students.filter(s => !studentInGroup(s, group.id) && s.status !== 'archived');

  const pct    = group.maxSlots > 0 ? Math.round(members.length / group.maxSlots * 100) : 0;
  const isFull = members.length >= group.maxSlots;
  const freeSlots = Math.max(0, group.maxSlots - members.length);

  const trainer = employees.find(e => e.id === group.trainer);
  const pendingCount = members.filter(m => isAttPending(attState[m.id])).length;
  const eqAwaitingCount = kidMembers.filter((m) => {
    const items = eqByStudent[m.id] || [];
    return items.some((i) => i.payment_status === 'paid' && i.fulfillment_status !== 'given');
  }).length;

  const loadGroupEquipment = async ({ silent = false } = {}) => {
    if (!silent) setEqLoading(true);
    setEqError('');
    try {
      const res = await fetch(`/api/equipment?groupId=${encodeURIComponent(group.id)}&filter=all`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'טעינת ציוד נכשלה');
      const map = {};
      for (const row of body.rows || []) {
        map[row.student_id] = row.items || [];
      }
      setEqByStudent(map);
    } catch (err) {
      setEqError(err.message);
      if (!silent) setEqByStudent({});
    } finally {
      if (!silent) setEqLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'equipment') loadGroupEquipment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, group.id]);

  const markEqStatus = async (item, targetTone) => {
    if (!item?.id) return;
    setEqBusyId(item.id);
    setEqError('');
    try {
      await applyEquipmentTone(item.id, targetTone, { currentItem: item });
      setEqEditId('');
      await loadGroupEquipment({ silent: true });
    } catch (err) {
      setEqError(err.message);
    } finally {
      setEqBusyId('');
    }
  };

  const loadPanelAttendance = async (date) => {
    setAttLoading(true);
    try {
      await ensureAttendance({ date, groupId: group.id });
      const r = await fetch(`/api/attendance?groupId=${encodeURIComponent(group.id)}&date=${date}`);
      const rows = r.ok ? await r.json() : [];
      const st = {}; const ids = {};
      members.forEach(m => { st[m.id] = 'pending'; });
      (rows || []).forEach(row => {
        st[row.student_id] = normalizeAttStatus(row.status);
        ids[row.student_id] = row.id;
      });
      setAttState(st);
      setAttIds(ids);
    } catch {
      const st = {};
      members.forEach(m => { st[m.id] = 'pending'; });
      setAttState(st);
    } finally {
      setAttLoading(false);
    }
  };

  /** Whole-group history, so each row can show the climber's absence run. */
  const loadAttHistory = async () => {
    try {
      const r = await fetch(`/api/attendance?groupId=${encodeURIComponent(group.id)}`);
      const rows = r.ok ? await r.json() : [];
      const byStudent = {};
      (rows || []).forEach((row) => {
        if (!byStudent[row.student_id]) byStudent[row.student_id] = [];
        byStudent[row.student_id].push(row);
      });
      setAttHistory(byStudent);
    } catch {
      setAttHistory({});
    }
  };

  useEffect(() => {
    if (tab !== 'attendance') return;
    loadPanelAttendance(attDate);
    loadAttHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, attDate, group.id, members.length]);

  /** Counted up to the meeting on screen, so past dates read as they did then. */
  const absenceStreakFor = (studentId) => consecutiveAbsences(
    (attHistory[studentId] || []).filter((row) => String(row.date || '') <= attDate)
  );

  const handleAssign = () => {
    if (!assignId) return;
    onAssignStudent(assignId, group.id);
    setAssignId('');
  };

  // The remove button sits next to the name, so it needs a deliberate confirm.
  const confirmRemove = (student, { waitlist = false } = {}) => {
    const name = student?.name || 'המתאמן';
    const where = waitlist ? 'מרשימת ההמתנה של' : 'מהקבוצה';
    const message = `להסיר את ${name} ${where} "${group.name}"?\n\n`
      + 'המתאמן יישאר במאגר הלקוחות — רק השיבוץ לקבוצה יוסר.';
    if (!window.confirm(message)) return;
    onRemoveStudent(student.id, group.id);
  };

  const markFromPanel = async (sid, status) => {
    setAttSavingId(sid);
    setAttState(prev => ({ ...prev, [sid]: status }));
    try {
      const saved = await saveAttendanceMark({
        id: attIds[sid] || `att-${group.id}-${attDate}-${sid}`,
        student_id: sid,
        group_id: group.id,
        date: attDate,
        status,
        marked_by: group.trainer || null,
      });
      if (saved?.id) setAttIds(prev => ({ ...prev, [sid]: saved.id }));
      loadAttHistory();
    } catch (e) {
      console.error(e);
    } finally {
      setAttSavingId(null);
    }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, height: '100vh', width: 420,
      background: '#0D1117', borderLeft: '1px solid var(--border)',
      zIndex: 300, display: 'flex', flexDirection: 'column',
      boxShadow: '-4px 0 25px rgba(0,0,0,0.5)',
      animation: 'fadeIn 0.2s ease',
      overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{ padding: '18px 18px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: c.text, lineHeight: 1.3 }}>
              {group.name}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
              {days.map(d => DAYS_FULL[d]).join(' + ')} · {group.time} · {group.duration}′
              {trainer && ` · מדריך: ${trainer.name}`}
            </div>
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><X size={18} /></button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3 }}>
            <div style={{
              width: `${Math.min(pct, 100)}%`, height: '100%', borderRadius: 3,
              background: isFull ? '#EF4444' : c.text,
              transition: 'width 0.4s ease',
            }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: isFull ? 'var(--red)' : 'var(--text-2)', minWidth: 90 }}>
            {members.length}/{group.maxSlots} · {freeSlots} פנויים
          </span>
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" onClick={() => setTab('attendance')}>
            <Users size={14} /> נוכחות
            {pendingCount > 0 && tab === 'attendance' ? ` (${pendingCount})` : ''}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => onAttendance(group)}>
            גיליון מלא
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => onEdit(group)}>
            <Edit2 size={14} /> עריכה
          </button>
          {group.waParents && (
            <a href={group.waParents} target="_blank" rel="noreferrer" className="btn btn-success btn-sm">
              💬 הורים
            </a>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {[
          { key: 'attendance', label: pendingCount > 0 ? `נוכחות (${pendingCount})` : 'נוכחות' },
          { key: 'members', label: `משתתפים (${members.length})` },
          { key: 'equipment', label: eqAwaitingCount > 0 ? `ציוד (${eqAwaitingCount})` : 'ציוד' },
          { key: 'info',    label: 'פרטי הקבוצה' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            flex: 1, padding: '10px 4px', fontSize: 13, fontWeight: tab === t.key ? 700 : 400,
            color: tab === t.key ? c.text : 'var(--text-3)',
            background: 'none', border: 'none', cursor: 'pointer',
            borderBottom: `2px solid ${tab === t.key ? c.text : 'transparent'}`,
            transition: 'all 0.15s',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>

        {/* ATTENDANCE TAB — mark from group folder (Notion-style) */}
        {tab === 'attendance' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <Calendar size={14} style={{ color: 'var(--text-3)' }} />
              <input
                type="date"
                className="input input-sm"
                style={{ width: 150 }}
                value={attDate}
                onChange={e => setAttDate(e.target.value)}
              />
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                {DAYS_FULL[dateToWeekday(attDate)]}
              </span>
              <button className="btn btn-ghost btn-xs" onClick={() => setAttDate(localDateStr())}>היום</button>
            </div>

            {attLoading ? (
              <div className="empty-state" style={{ padding: 32 }}>
                <Loader2 size={18} className="spin" />
                <div className="empty-state-sub" style={{ marginTop: 8 }}>יוצר פריטי נוכחות...</div>
              </div>
            ) : members.length === 0 ? (
              <div className="empty-state" style={{ padding: 32 }}>
                <div className="empty-state-title">אין מתאמנים בקבוצה</div>
                <div className="empty-state-sub">שבץ משתתפים בטאב משתתפים — ואז ייווצרו פריטי נוכחות אוטומטית</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {members.map(s => {
                  const status = normalizeAttStatus(attState[s.id] || 'pending');
                  const meta = attStatusMeta(status);
                  const streak = absenceStreakFor(s.id);
                  return (
                    <div key={s.id} style={{
                      padding: '10px 12px', borderRadius: 8,
                      background: 'rgba(255,255,255,0.02)',
                      border: `1px solid ${isAttPending(status) ? 'rgba(59,130,246,0.45)' : 'var(--border)'}`,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 5 }}>
                          {/* No arrow here — the "תיק לקוח" button on this row already says it. */}
                          <StudentNameLink student={s} onOpen={onOpenStudent} truncate showIcon={false} />
                          <AbsenceStreakPill streak={streak} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                          <StatusPill meta={meta} />
                          <StudentFileButton student={s} onOpen={onOpenStudent} />
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {ATT_STATUS.filter(o => ATT_MARK_KEYS.includes(o.key)).map(opt => (
                          <button
                            key={opt.key}
                            type="button"
                            className="btn btn-sm"
                            disabled={attSavingId === s.id}
                            title={opt.label}
                            style={{
                              flex: 1,
                              minWidth: 72,
                              background: status === opt.key ? opt.color : 'rgba(255,255,255,0.04)',
                              color: status === opt.key ? 'white' : 'var(--text-2)',
                              fontWeight: status === opt.key ? 700 : 500,
                            }}
                            onClick={() => markFromPanel(s.id, opt.key)}
                          >
                            {opt.shortLabel || opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* MEMBERS TAB */}
        {tab === 'members' && (
          <div>

            <div className="card card-p" style={{ marginBottom: 14, background: '#111827' }}>
              <div style={{ fontSize: 12, fontWeight: 'bold', marginBottom: 8 }}>שיבוץ מתאמן לקבוצה</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <select className="input input-sm" style={{ flex: 1 }} value={assignId}
                  onChange={e => setAssignId(e.target.value)}>
                  <option value="">בחר מתאמן...</option>
                  {assignable.map(s => {
                    const p = parents.find(pp => pp.id === s.parentId);
                    return <option key={s.id} value={s.id}>{s.name}{p?.name ? ` — ${p.name}` : ''}</option>;
                  })}
                </select>
                <button className="btn btn-primary btn-sm" onClick={handleAssign} disabled={!assignId || isFull}>
                  <UserPlus size={13} /> שבץ
                </button>
              </div>
              {isFull && (
                <div style={{ fontSize: 11, color: '#FCD34D', marginTop: 6 }}>
                  הקבוצה מלאה — אפשר לשבץ לרשימת המתנה מהבוט או להסיר מתאמן
                </div>
              )}
            </div>

            {members.length === 0 ? (
              <div className="empty-state" style={{ padding: 40 }}>
                <div className="empty-state-icon">🧗</div>
                <div className="empty-state-title">אין מתאמנים רשומים</div>
                <div className="empty-state-sub">שבץ מתאמנים דרך התיבה למעלה</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {members.map(s => {
                  const parent = parents.find(p => p.id === s.parentId);
                  return (
                    <div key={s.id} style={{
                      display: 'flex', gap: 10, alignItems: 'center',
                      padding: '10px 12px', borderRadius: 8,
                      background: 'rgba(255,255,255,0.02)',
                      border: '1px solid var(--border)',
                    }}>
                      <div className="avatar" style={{ width: 34, height: 34, fontSize: 12, flexShrink: 0 }}>
                        {s.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <StudentNameLink student={s} onOpen={onOpenStudent} truncate />
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>
                          {parent?.name}{parent?.phone ? ` · ${parent.phone}` : ''}
                        </div>
                      </div>
                      {s.levelGrade && (
                        <span style={{ fontWeight: 900, color: c.text, fontSize: 13 }}>{s.levelGrade}</span>
                      )}
                      <StudentFileButton student={s} onOpen={onOpenStudent} />
                      <button className="btn btn-ghost btn-icon btn-xs" title="הסר מהקבוצה"
                        style={{ color: 'var(--red)' }}
                        onClick={() => confirmRemove(s)}>
                        <UserMinus size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {waitlistMembers.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)', marginBottom: 8 }}>
                  רשימת המתנה ({waitlistMembers.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {waitlistMembers.map(s => {
                    const parent = parents.find(p => p.id === s.parentId);
                    return (
                      <div key={s.id} style={{
                        display: 'flex', gap: 10, alignItems: 'center',
                        padding: '10px 12px', borderRadius: 8,
                        background: 'rgba(148,163,184,0.08)',
                        border: '1px dashed var(--border)',
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <StudentNameLink student={s} onOpen={onOpenStudent} truncate />
                          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>
                            {parent?.name}{parent?.phone ? ` · ${parent.phone}` : ''}
                          </div>
                        </div>
                        <span className="badge badge-gray">המתנה</span>
                        <StudentFileButton student={s} onOpen={onOpenStudent} />
                        <button className="btn btn-ghost btn-icon btn-xs" title="הסר מהמתנה"
                          style={{ color: 'var(--red)' }}
                          onClick={() => confirmRemove(s, { waitlist: true })}>
                          <UserMinus size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* EQUIPMENT TAB */}
        {tab === 'equipment' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Package size={14} style={{ color: 'var(--text-3)' }} />
              <div style={{ fontSize: 13, fontWeight: 700 }}>ציוד לאימונים — ילדים בקבוצה</div>
            </div>

            {/* Color legend */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                marginBottom: 12,
                padding: '8px 10px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'rgba(255,255,255,0.03)',
              }}
            >
              {EQUIPMENT_LEGEND_TONES.map(({ tone, label }) => {
                const color = equipmentToneColor(tone);
                return (
                  <span
                    key={tone}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--text-2)',
                    }}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: color,
                        boxShadow: `0 0 0 2px ${color}33`,
                        flexShrink: 0,
                      }}
                    />
                    {label}
                  </span>
                );
              })}
            </div>

            {eqError && (
              <div style={{ marginBottom: 10, padding: 8, borderRadius: 8, background: 'rgba(248,113,113,.12)', color: '#f87171', fontSize: 12 }}>
                {eqError}
              </div>
            )}
            {eqLoading ? (
              <div className="empty-state" style={{ padding: 32 }}>
                <Loader2 size={18} className="spin" />
                <div className="empty-state-sub" style={{ marginTop: 8 }}>טוען ציוד...</div>
              </div>
            ) : kidMembers.length === 0 ? (
              <div className="empty-state" style={{ padding: 32 }}>
                <div className="empty-state-title">אין ילדים בקבוצה</div>
                <div className="empty-state-sub">ציוד לאימונים מיועד לילדים בלבד</div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>
                  לחצו על אייקון כדי לשנות סטטוס
                </div>
                <div
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    overflow: 'hidden',
                  }}
                >
                  {/* Header row */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) 52px 52px 52px',
                      gap: 0,
                      alignItems: 'center',
                      padding: '8px 10px',
                      borderBottom: '1px solid var(--border)',
                      background: 'rgba(255,255,255,0.04)',
                      fontSize: 11,
                      fontWeight: 700,
                      color: 'var(--text-3)',
                    }}
                  >
                    <div>ילד</div>
                    {EQUIPMENT_MATRIX_COLS.map((type) => {
                      const Icon = EQUIPMENT_ICONS[type] || Package;
                      return (
                        <div
                          key={type}
                          title={EQUIPMENT_LABELS[type]}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: 2,
                          }}
                        >
                          <Icon size={14} />
                          <span style={{ fontSize: 9, fontWeight: 700 }}>{EQUIPMENT_LABELS[type]}</span>
                        </div>
                      );
                    })}
                  </div>

                  {kidMembers.map((s, idx) => {
                    const p = parents.find((pp) => pp.id === s.parentId);
                    const items = eqByStudent[s.id] || [];
                    const byType = Object.fromEntries(items.map((i) => [i.item_type, i]));
                    const awaiting = items.some(
                      (i) => i.payment_status === 'paid' && i.fulfillment_status !== 'given'
                    );
                    return (
                      <div
                        key={s.id}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'minmax(0, 1fr) 52px 52px 52px',
                          gap: 0,
                          alignItems: 'center',
                          padding: '8px 10px',
                          borderBottom: idx < kidMembers.length - 1 ? '1px solid var(--border)' : 'none',
                          background: awaiting ? 'rgba(251,191,36,.06)' : 'transparent',
                        }}
                      >
                        <div style={{ minWidth: 0, paddingInlineEnd: 8 }}>
                          <StudentNameLink student={s} onOpen={onOpenStudent} truncate />
                          <div style={{ fontSize: 10, color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {p?.name || '—'}
                          </div>
                        </div>
                        {EQUIPMENT_MATRIX_COLS.map((type) => {
                          const item = byType[type];
                          const Icon = EQUIPMENT_ICONS[type] || Package;
                          const tone = item ? equipmentItemTone(item) : 'missing';
                          const color = item ? equipmentToneColor(tone) : '#64748b';
                          const busy = item && eqBusyId === item.id;
                          const editing = item && eqEditId === item.id;
                          const title = item
                            ? `${EQUIPMENT_LABELS[type]} · ${equipmentToneLabel(tone, type)}${type === 'shirt' && item.shirt_size ? ` · מידה ${item.shirt_size}` : ''}`
                            : `${EQUIPMENT_LABELS[type]} · אין רשומה`;
                          return (
                            <div key={type} style={{ display: 'flex', justifyContent: 'center' }}>
                              <button
                                type="button"
                                disabled={!item || busy}
                                onClick={() => item && setEqEditId(editing ? '' : item.id)}
                                title={title}
                                aria-label={title}
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: 10,
                                  border: editing ? `2px solid ${color}` : `1px solid ${color}55`,
                                  background: item ? equipmentToneBg(tone) : 'rgba(100,116,139,0.12)',
                                  color,
                                  display: 'inline-flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: 1,
                                  cursor: item ? 'pointer' : 'default',
                                  opacity: busy ? 0.55 : 1,
                                  padding: 0,
                                }}
                              >
                                {busy ? <Loader2 size={14} className="spin" /> : <Icon size={15} />}
                                {type === 'shirt' && item?.shirt_size && (
                                  <span style={{ fontSize: 8, fontWeight: 800, lineHeight: 1 }}>{item.shirt_size}</span>
                                )}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>

                {/* Status picker for selected cell */}
                {eqEditId && (() => {
                  let editItem = null;
                  let editStudent = null;
                  for (const s of kidMembers) {
                    const found = (eqByStudent[s.id] || []).find((i) => i.id === eqEditId);
                    if (found) {
                      editItem = found;
                      editStudent = s;
                      break;
                    }
                  }
                  if (!editItem) return null;
                  const tone = equipmentItemTone(editItem);
                  const type = editItem.item_type;
                  const Icon = EQUIPMENT_ICONS[type] || Package;
                  const busy = eqBusyId === editItem.id;
                  return (
                    <div
                      style={{
                        marginTop: 12,
                        padding: 12,
                        borderRadius: 12,
                        border: '1px solid var(--border)',
                        background: 'rgba(255,255,255,0.04)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <Icon size={16} style={{ color: equipmentToneColor(tone) }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 800 }}>
                            {editStudent?.name} · {EQUIPMENT_LABELS[type]}
                          </div>
                          {type === 'shirt' && (
                            <div style={{ fontSize: 11, color: editItem.shirt_size ? 'var(--text-2)' : '#fbbf24', marginTop: 2 }}>
                              {editItem.shirt_size
                                ? `מידה לתת: ${editItem.shirt_size}`
                                : 'מידה: לא נבחרה'}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => setEqEditId('')}
                          aria-label="סגור"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {EQUIPMENT_LEGEND_TONES.map(({ tone: opt, label }) => {
                          const optColor = equipmentToneColor(opt);
                          const selected = opt === tone;
                          return (
                            <button
                              key={opt}
                              type="button"
                              disabled={busy || selected}
                              onClick={() => markEqStatus(editItem, opt)}
                              style={{
                                width: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                fontSize: 14,
                                fontWeight: 700,
                                padding: '11px 12px',
                                borderRadius: 10,
                                border: selected ? `2px solid ${optColor}` : '1px solid var(--border)',
                                background: selected ? `${optColor}28` : 'rgba(255,255,255,0.06)',
                                color: '#f8fafc',
                                cursor: selected ? 'default' : 'pointer',
                                textAlign: 'right',
                              }}
                            >
                              <span
                                style={{
                                  width: 12,
                                  height: 12,
                                  borderRadius: '50%',
                                  background: optColor,
                                  boxShadow: `0 0 0 3px ${optColor}44`,
                                  flexShrink: 0,
                                }}
                              />
                              <span style={{ flex: 1 }}>{label}</span>
                              {selected && (
                                <span style={{ fontSize: 11, fontWeight: 700, color: optColor }}>נוכחי</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        )}

        {/* INFO TAB */}
        {tab === 'info' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="card card-p">
              {[
                ['ימי חוג', days.map(d => DAYS_FULL[d]).join(' + ')],
                ['שעת התחלה', group.time],
                ['משך אימון', `${group.duration} דק׳`],
                ['מדריך אחראי', trainer ? trainer.name : '—'],
                ['חתך גילאים', group.ageCategory],
                ['מקסימום תפוסה', `${group.maxSlots} תלמידים`],
                ['מקומות פנויים', `${freeSlots}`],
              ].map(([k, v]) => (
                <div key={k} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13,
                }}>
                  <span style={{ color: 'var(--text-3)' }}>{k}</span>
                  <span style={{ fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>

            {(group.priceWeek > 0 || group.priceTwice > 0) && (
              <div className="card card-p">
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 10 }}>עלויות חוג חודשיות</div>
                {group.priceWeek > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-3)' }}>פעם בשבוע</span>
                    <span style={{ fontWeight: 700, color: 'var(--green)' }}>₪{group.priceWeek}</span>
                  </div>
                )}
                {group.priceTwice > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-3)' }}>פעמיים בשבוע</span>
                    <span style={{ fontWeight: 700, color: 'var(--green)' }}>₪{group.priceTwice}</span>
                  </div>
                )}
              </div>
            )}

            {group.waClimbers && (
              <a href={group.waClimbers} target="_blank" rel="noreferrer" className="btn btn-success btn-sm">
                💬 וואטסאפ מטפסים
              </a>
            )}

            <button className="btn btn-danger btn-sm" style={{ marginTop: 4 }}
              onClick={() => {
                if (window.confirm(`האם אתה בטוח שברצונך למחוק את קבוצת החוג "${group.name}"?`)) onDelete(group.id);
              }}>
              <Trash2 size={14} /> מחק קבוצה לצמיתות
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Schedule Component ──────────────────────────────────────────────────
export default function Schedule({ groups, students, parents, setGroups, setStudents, setParents, canManageBilling = false }) {
  const [studentFileId,   setStudentFileId]   = useState(null);
  const [selectedGroup,   setSelectedGroup]   = useState(null);
  const [editingGroup,    setEditingGroup]     = useState(null);
  const [showAddModal,    setShowAddModal]     = useState(false);
  const [attendanceGroup, setAttendanceGroup]  = useState(null);
  const [attendanceDate,  setAttendanceDate]   = useState(localDateStr());
  const [dayMarks,        setDayMarks]         = useState({}); // groupId -> { marked, present, total }
  const [dayVacation,     setDayVacation]      = useState(null); // «חופשה מאימונים» covering the day
  const [viewMode,        setViewMode]         = useState('week');
  const [employees,       setEmployees]        = useState([]);
  const [searchParams, setSearchParams] = useSearchParams();

  // Deep link from the customer card: /schedule?group=<id> opens that group.
  // Waits for the groups list to arrive, then drops the parameter from the address.
  useEffect(() => {
    const linkedId = searchParams.get('group');
    if (!linkedId) return;
    const match = groups.find((g) => String(g.id) === String(linkedId));
    if (!match) return;
    setSelectedGroup(match);
    setEditingGroup(null);
    setShowAddModal(false);
    setAttendanceGroup(null);
    setViewMode('week');
    const next = new URLSearchParams(searchParams);
    next.delete('group');
    setSearchParams(next, { replace: true });
  }, [searchParams, groups, setSearchParams]);

  // Fetch employees list dynamically for trainers dropdown
  useEffect(() => {
    fetch('/api/trainers')
      .then(res => res.ok ? res.json() : [])
      .then(data => setEmployees(Array.isArray(data) ? data : []))
      .catch(err => console.error(err));
  }, []);

  // Ensure pending rows for the day, then load summary per group.
  useEffect(() => {
    if (viewMode !== 'attendance') return;
    let cancelled = false;
    (async () => {
      try {
        const ensured = await ensureAttendance({ date: attendanceDate });
        if (!cancelled) setDayVacation(ensured?.vacation || null);
      } catch (e) {
        console.error(e);
        if (!cancelled) setDayVacation(null);
      }
      if (cancelled) return;
      try {
        const r = await fetch(`/api/attendance?date=${encodeURIComponent(attendanceDate)}`);
        const rows = r.ok ? await r.json() : [];
        if (cancelled) return;
        const byGroup = {};
        (rows || []).forEach(row => {
          if (!byGroup[row.group_id]) byGroup[row.group_id] = { total: 0, present: 0, pending: 0, absent: 0 };
          byGroup[row.group_id].total++;
          const s = normalizeAttStatus(row.status);
          if (s === 'pending') byGroup[row.group_id].pending++;
          else if (isAttPresent(row.status)) byGroup[row.group_id].present++;
          else if (isAttAbsent(row.status)) byGroup[row.group_id].absent++;
        });
        setDayMarks(byGroup);
      } catch {
        if (!cancelled) setDayMarks({});
      }
    })();
    return () => { cancelled = true; };
  }, [attendanceDate, viewMode, attendanceGroup]);

  const refreshStudents = async () => {
    try {
      const fresh = await fetch('/api/students').then(r => (r.ok ? r.json() : null));
      if (Array.isArray(fresh)) setStudents(fresh);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSave = async (data) => {
    const isEdit = groups.some(g => g.id === data.id);

    // Optimistic state update
    setGroups(prev => {
      const idx = prev.findIndex(g => g.id === data.id);
      return idx >= 0 ? prev.map(g => g.id === data.id ? data : g) : [...prev, data];
    });

    setEditingGroup(null);
    setShowAddModal(false);
    setSelectedGroup(data);

    try {
      await fetch(isEdit ? `/api/groups/${data.id}` : '/api/groups', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id) => {
    setGroups(prev => prev.filter(g => g.id !== id));
    setSelectedGroup(null);
    setEditingGroup(null);
    setShowAddModal(false);
    try {
      await fetch(`/api/groups/${id}`, { method: 'DELETE' });
    } catch (err) {
      console.error(err);
    }
  };

  const handleAssignStudent = async (studentId, groupId) => {
    setStudents(prev => prev.map(s => {
      if (s.id !== studentId) return s;
      const ids = studentGroupIds(s);
      if (ids.includes(String(groupId))) return s;
      const next = [...ids, String(groupId)];
      return { ...s, groupIds: next, groupId: s.groupId || groupId };
    }));
    try {
      await fetch(`/api/students/${studentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addGroupId: groupId })
      });
      refreshStudents();
    } catch (err) {
      console.error(err);
    }
  };

  const handleRemoveStudent = async (studentId, groupId) => {
    setStudents(prev => prev.map(s => {
      if (s.id !== studentId) return s;
      const next = studentGroupIds(s).filter((id) => id !== String(groupId));
      return { ...s, groupIds: next, groupId: next[0] || null };
    }));
    try {
      await fetch(`/api/students/${studentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeGroupId: groupId })
      });
      refreshStudents();
    } catch (err) {
      console.error(err);
    }
  };

  const openEdit  = (g)  => { setEditingGroup(g); setShowAddModal(false); };
  const openAdd   = ()   => { setShowAddModal(true); setEditingGroup(null); setSelectedGroup(null); };
  const openPanel = (g)  => { setSelectedGroup(g); setEditingGroup(null); setShowAddModal(false); setAttendanceGroup(null); };
  const openAttendance = (g, date) => {
    if (date) setAttendanceDate(date);
    setAttendanceGroup(g);
    setSelectedGroup(null);
    setEditingGroup(null);
    setShowAddModal(false);
  };

  const shiftAttendanceDate = (deltaDays) => {
    const d = new Date(`${attendanceDate}T12:00:00`);
    d.setDate(d.getDate() + deltaDays);
    setAttendanceDate(localDateStr(d));
  };

  const getEnrolledCount = (groupId) => {
    return students.filter(s =>
      studentInGroup(s, groupId)
      && s.status !== 'archived'
      && s.status !== 'waitlist'
    ).length;
  };

  const attendanceWeekday = dateToWeekday(attendanceDate);

  const formattedGroups = groups.map(g => {
    const trainerObj = employees.find(e => e.id === g.trainer);
    return {
      ...g,
      trainerName: trainerObj ? trainerObj.name : ''
    };
  });

  const dayGroupsForAttendance = [...formattedGroups]
    .filter(g => getGroupDays(g).includes(attendanceWeekday))
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  // Keep the selected/attendance group in sync with the latest data so the
  // members list and enrolled counts update after assign/remove.
  const liveSelectedGroup = selectedGroup ? (formattedGroups.find(g => g.id === selectedGroup.id) || selectedGroup) : null;
  const liveAttendanceGroup = attendanceGroup ? (formattedGroups.find(g => g.id === attendanceGroup.id) || attendanceGroup) : null;

  return (
    <div className="fade-in">
      {/* Trainee file opened from a group — layers above the group panel/sheet
          so both stay on screen side by side. */}
      {studentFileId && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 600 }}>
          <Suspense fallback={null}>
            <StudentFilePanel
              studentId={studentFileId}
              students={students}
              parents={parents}
              groups={groups}
              setStudents={setStudents}
              setParents={setParents}
              canManageBilling={canManageBilling}
              onClose={() => setStudentFileId(null)}
            />
          </Suspense>
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {liveAttendanceGroup && !editingGroup && !showAddModal && (
        <AttendanceModal
          key={`${liveAttendanceGroup.id}-${attendanceDate}`}
          group={liveAttendanceGroup}
          students={students}
          parents={parents}
          employees={employees}
          initialDate={attendanceDate}
          onClose={() => setAttendanceGroup(null)}
          onMarked={() => setAttendanceGroup(g => (g ? { ...g } : g))}
          onOpenStudent={setStudentFileId}
        />
      )}
      {(showAddModal || editingGroup) && (
        <GroupFormModal
          group={editingGroup || null}
          employees={employees}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => { setEditingGroup(null); setShowAddModal(false); }}
        />
      )}
      {liveSelectedGroup && !editingGroup && !showAddModal && !attendanceGroup && (
        <GroupPanel
          group={liveSelectedGroup}
          students={students}
          parents={parents}
          employees={employees}
          initialAttDate={attendanceDate}
          onClose={() => setSelectedGroup(null)}
          onEdit={openEdit}
          onDelete={handleDelete}
          onAttendance={g => openAttendance(g, attendanceDate)}
          onAssignStudent={handleAssignStudent}
          onRemoveStudent={handleRemoveStudent}
          onOpenStudent={setStudentFileId}
        />
      )}

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div className="section-header" style={{ marginBottom: 20 }}>
        <div>
          <div className="section-title">
            {viewMode === 'attendance' ? 'נוכחות יומית' : 'לוח חוגים שבועי'}
          </div>
          <div className="section-sub">
            {viewMode === 'attendance'
              ? `${dayGroupsForAttendance.length} חוגים ב${DAYS_FULL[attendanceWeekday] || 'יום זה'} · בחר חוג לסימון נוכחות`
              : `${groups.length} קבוצות חוגים פעילות · לחץ על משבצת לפרטים`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className={`btn btn-sm ${viewMode === 'attendance' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setViewMode('attendance')}>✓ נוכחות</button>
          <button className={`btn btn-sm ${viewMode === 'week' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setViewMode('week')}>🗓 שבוע</button>
          <button className={`btn btn-sm ${viewMode === 'list' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setViewMode('list')}>📋 רשימה</button>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>
            <Plus size={14} /> קבוצה חדשה
          </button>
        </div>
      </div>

      {/* ── Daily Attendance View ──────────────────────────────────────────── */}
      {viewMode === 'attendance' && (
        <div>
          <div className="card card-p" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => shiftAttendanceDate(-1)} title="יום קודם">
              <ChevronRight size={18} />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Calendar size={16} style={{ color: 'var(--text-3)' }} />
              <input
                type="date"
                className="input"
                style={{ width: 160 }}
                value={attendanceDate}
                onChange={e => setAttendanceDate(e.target.value)}
              />
              <span style={{ fontWeight: 700, fontSize: 14 }}>
                {DAYS_FULL[attendanceWeekday]}
              </span>
            </div>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => shiftAttendanceDate(1)} title="יום הבא">
              <ChevronLeft size={18} />
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setAttendanceDate(localDateStr())}>
              היום
            </button>
            {attendanceDate !== localDateStr() && (
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>צפייה ביום עבר / עתיד</span>
            )}
          </div>

          {dayVacation && (
            <div
              className="card card-p"
              style={{
                marginBottom: 16,
                borderRight: '3px solid #C084FC',
                background: 'rgba(168, 85, 247, 0.10)',
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 14, color: '#C084FC' }}>
                🏖️ יום חופש — {dayVacation.name || 'חופשה מאימונים'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
                כל הנוכחות ביום זה סומנה אוטומטית כ״יום חג״. סימון ידני של מאמן גובר ולא נדרס.
              </div>
            </div>
          )}

          {dayGroupsForAttendance.length === 0 ? (
            <div className="card empty-state" style={{ padding: 48 }}>
              <div className="empty-state-title">אין חוגים ביום זה</div>
              <div className="empty-state-sub">בחר תאריך אחר או הוסף קבוצה ללוח החוגים</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {dayGroupsForAttendance.map(g => {
                const c = AGE_COLORS[g.ageCategory] || DEF_COLOR;
                const enrolled = getEnrolledCount(g.id);
                const marks = dayMarks[g.id];
                const days = getGroupDays(g);
                return (
                  <div
                    key={g.id}
                    className="card card-p"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
                      borderRight: `3px solid ${c.text}`,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <div style={{ fontWeight: 800, fontSize: 14, color: c.text }}>{g.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
                        {g.time} · {g.duration}′
                        {g.trainerName ? ` · מדריך: ${g.trainerName}` : ' · ללא מדריך'}
                        {days.length > 1 ? ` · ${days.map(d => DAYS_FULL[d]).join(' + ')}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                      <span className="badge" style={{ background: c.bg, color: c.text }}>
                        {enrolled}/{g.maxSlots} רשומים
                      </span>
                      {marks ? (
                        <span style={{ fontWeight: 600, display: 'flex', gap: 8 }}>
                          {marks.pending > 0 && (
                            <span style={{ color: '#60A5FA' }}>ממתין {marks.pending}</span>
                          )}
                          <span style={{ color: '#34D399' }}>הגיע {marks.present}</span>
                          {marks.absent > 0 && (
                            <span style={{ color: '#FCA5A5' }}>לא הגיע {marks.absent}</span>
                          )}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-3)' }}>אין רשומים</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-primary btn-sm" onClick={() => openAttendance(g, attendanceDate)}>
                        <Users size={14} /> פתח נוכחות
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => openPanel(g)}>
                        פרטי קבוצה
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Week View ──────────────────────────────────────────────────────── */}
      {viewMode === 'week' && (
        <div className="card" style={{ overflow: 'auto' }}>
          <div style={{ minWidth: 760, display: 'flex', flexDirection: 'column' }}>
            {/* Day headers */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
              <div style={{ width: 52, flexShrink: 0, padding: '10px 6px', fontSize: 10, color: 'var(--text-3)' }}>שעה</div>
              {DAYS_FULL.map((d, i) => {
                const count = groups.filter(g => getGroupDays(g).includes(i)).length;
                return (
                  <div key={i} style={{
                    flex: 1, padding: '10px 8px',
                    fontSize: 12, fontWeight: 600, color: count ? 'var(--text-1)' : 'var(--text-3)',
                    textAlign: 'center',
                    borderLeft: i > 0 ? '1px solid var(--border)' : 'none',
                  }}>
                    {d}
                    {count > 0 && (
                      <span style={{ marginRight: 5, fontSize: 10, color: 'var(--text-3)' }}>({count})</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Grid body */}
            <div style={{ display: 'flex', position: 'relative' }}>
              {/* Time labels column */}
              <div style={{ width: '52px', flexShrink: 0, position: 'relative', height: `${GRID_H}px` }}>
                {HOURS.map((h, i) => (
                  <div key={h} style={{
                    position: 'absolute', top: `${i * HOUR_H}px`,
                    width: '100%', padding: '3px 6px',
                    fontSize: 10, color: 'var(--text-3)',
                  }}>
                    {String(h).padStart(2, '0')}:00
                  </div>
                ))}
              </div>

              {/* 6 Day columns */}
              {Array.from({ length: 6 }, (_, day) => {
                const dayGroups = formattedGroups.filter(g => getGroupDays(g).includes(day));
                return (
                  <div key={day} style={{
                    flex: 1, position: 'relative', height: `${GRID_H}px`,
                    borderLeft: '1px solid var(--border)',
                  }}>
                    {/* Hour grid lines */}
                    {HOURS.map((_, i) => (
                      <div key={i} style={{
                        position: 'absolute', top: `${i * HOUR_H}px`,
                        width: '100%', borderTop: `1px solid var(--border)`,
                        pointerEvents: 'none',
                      }} />
                    ))}
                    {/* 30-min sub-lines */}
                    {HOURS.map((_, i) => (
                      <div key={`h${i}`} style={{
                        position: 'absolute', top: `${i * HOUR_H + HOUR_H / 2}px`,
                        width: '100%', borderTop: '1px dashed rgba(255,255,255,0.04)',
                        pointerEvents: 'none',
                      }} />
                    ))}

                    {/* Group blocks */}
                    {dayGroups.map(g => {
                      const enrolledCount = getEnrolledCount(g.id);
                      return (
                        <GroupBlock
                          key={`${g.id}-${day}`}
                          group={g}
                          enrolledCount={enrolledCount}
                          selected={selectedGroup?.id === g.id}
                          onClick={() => openPanel(g)}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── List View ──────────────────────────────────────────────────────── */}
      {viewMode === 'list' && (
        <div className="card">
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>שם הקבוצה</th>
                  <th>יום</th>
                  <th>שעה</th>
                  <th>משך</th>
                  <th>מדריך</th>
                  <th>גיל</th>
                  <th>תפוסה</th>
                  <th>מחיר</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {[...formattedGroups]
                  .sort((a, b) => a.day - b.day || a.time.localeCompare(b.time))
                  .map(g => {
                    const c    = AGE_COLORS[g.ageCategory] || DEF_COLOR;
                    const enrolledCount = getEnrolledCount(g.id);
                    const full = enrolledCount >= g.maxSlots;
                    const pct  = g.maxSlots > 0 ? (enrolledCount / g.maxSlots * 100) : 0;
                    const days = getGroupDays(g);
                    return (
                      <tr key={g.id} style={{ cursor: 'pointer' }} onClick={() => openPanel(g)}>
                        <td style={{ fontWeight: 700 }}>{g.name}</td>
                        <td style={{ color: 'var(--text-2)' }}>{days.map(d => DAYS_FULL[d]).join(' + ')}</td>
                        <td>{g.time}</td>
                        <td style={{ color: 'var(--text-3)' }}>{g.duration}′</td>
                        <td style={{ color: 'var(--text-2)' }}>{g.trainerName || '—'}</td>
                        <td>
                          <span className="badge" style={{ background: c.bg, color: c.text }}>
                            {g.ageCategory}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 56, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)' }}>
                              <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', borderRadius: 2, background: full ? '#EF4444' : '#34D399' }} />
                            </div>
                            <span style={{ fontSize: 12, color: full ? 'var(--red)' : 'var(--text-2)' }}>
                              {enrolledCount}/{g.maxSlots}
                            </span>
                          </div>
                        </td>
                        <td style={{ color: 'var(--green)', fontWeight: 700 }}>
                          {g.priceWeek ? `₪${g.priceWeek}` : g.priceTwice ? `₪${g.priceTwice}` : '—'}
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: 5 }}>
                            <button className="btn btn-ghost btn-xs" onClick={() => openAttendance(g, attendanceDate)}>
                              <Users size={12} /> נוכחות
                            </button>
                            <button className="btn btn-ghost btn-icon btn-xs" onClick={() => openEdit(g)}>
                              <Edit2 size={12} />
                            </button>
                            <button className="btn btn-ghost btn-icon btn-xs"
                              style={{ color: 'var(--red)' }}
                              onClick={() => { if (window.confirm(`למחוק "${g.name}"?`)) handleDelete(g.id); }}>
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Legend ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 16 }}>
        {Object.entries(AGE_COLORS).map(([label, c]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-3)' }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: c.text }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
