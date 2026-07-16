import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Save, X, Users, Calendar, UserPlus, UserMinus, History, Loader2 } from 'lucide-react';
import { DAYS_FULL } from '../mockData.js';

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

// Attendance status options (present / absent / late)
const ATT_STATUS = [
  { key: 'present', label: 'נוכח',  color: '#10B981' },
  { key: 'absent',  label: 'נעדר',  color: '#EF4444' },
  { key: 'late',    label: 'איחור', color: '#F59E0B' },
];

// Hebrew day-letter → weekday index (0=ראשון … 5=שישי)
const HEB_DAY_IDX = { 'א': 0, 'ב': 1, 'ג': 2, 'ד': 3, 'ה': 4, 'ו': 5 };

// A group may meet twice a week (biweekly). Such groups encode both days in
// their name, e.g. "מתקדמים ה'-ו' — ב׳+ה׳ 15:30". Return every weekday the
// group meets on so it can be rendered on both calendar columns.
function getGroupDays(group) {
  const m = (group?.name || '').match(/([א-ו])['׳’]?\s*\+\s*([א-ו])['׳’]?/);
  if (m) {
    const days = [HEB_DAY_IDX[m[1]], HEB_DAY_IDX[m[2]]].filter(d => d != null);
    if (days.length) return [...new Set([group.day, ...days])].filter(d => d != null);
  }
  return [group?.day].filter(d => d != null);
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
function GroupFormModal({ group, employees, onSave, onClose }) {
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

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>ביטול</button>
          <button form="gf" type="submit" className="btn btn-primary">
            <Save size={15} /> {group ? 'שמור שינויים' : 'הוסף קבוצה'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Attendance Modal (real persistence) ──────────────────────────────────────
function AttendanceModal({ group, students, parents, onClose }) {
  const members = students.filter(s => s.groupId === group.id && s.status !== 'archived');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [view, setView] = useState('sheet'); // 'sheet' | 'history'
  const [state, setState] = useState({});          // studentId -> status
  const [existingIds, setExistingIds] = useState({}); // studentId -> attendance row id
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [history, setHistory] = useState([]);

  // Load saved marks for the selected date (defaults to "present").
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSavedMsg('');
    fetch(`/api/attendance?groupId=${encodeURIComponent(group.id)}&date=${date}`)
      .then(r => (r.ok ? r.json() : []))
      .then(rows => {
        if (cancelled) return;
        const st = {}; const ids = {};
        members.forEach(m => { st[m.id] = 'present'; });
        (rows || []).forEach(r => { st[r.student_id] = r.status; ids[r.student_id] = r.id; });
        setState(st);
        setExistingIds(ids);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, group.id]);

  const loadHistory = () => {
    fetch(`/api/attendance?groupId=${encodeURIComponent(group.id)}`)
      .then(r => (r.ok ? r.json() : []))
      .then(rows => {
        const byDate = {};
        (rows || []).forEach(r => {
          if (!byDate[r.date]) byDate[r.date] = { date: r.date, present: 0, absent: 0, late: 0, total: 0 };
          byDate[r.date].total++;
          if (r.status === 'present') byDate[r.date].present++;
          else if (r.status === 'absent') byDate[r.date].absent++;
          else if (r.status === 'late') byDate[r.date].late++;
        });
        setHistory(Object.values(byDate).sort((a, b) => b.date.localeCompare(a.date)));
      })
      .catch(() => {});
  };
  useEffect(() => { loadHistory(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [group.id]);

  const updateStatus = (sid, status) => setState(prev => ({ ...prev, [sid]: status }));

  const handleSave = async () => {
    setSaving(true);
    setSavedMsg('');
    // Stable ids keep re-saves idempotent (upsert instead of duplicate rows).
    const records = members.map(m => ({
      id: existingIds[m.id] || `att-${group.id}-${date}-${m.id}`,
      student_id: m.id,
      group_id: group.id,
      date,
      status: state[m.id] || 'present',
    }));
    try {
      const res = await fetch('/api/attendance/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records }),
      });
      if (res.ok) {
        const saved = await res.json();
        const ids = { ...existingIds };
        (saved || []).forEach(r => { if (r && r.student_id) ids[r.student_id] = r.id; });
        setExistingIds(ids);
        const present = records.filter(r => r.status === 'present').length;
        setSavedMsg(`נשמר בהצלחה ✓ · ${present}/${records.length} נוכחים`);
        loadHistory();
      } else {
        setSavedMsg('שגיאה בשמירת הנוכחות');
      }
    } catch (err) {
      setSavedMsg('שגיאה בשמירת הנוכחות');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal slide-up" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">📝 יומן נוכחות — {group.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
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

        {/* View toggle */}
        <div style={{ display: 'flex', gap: 6, padding: '10px 16px 0' }}>
          <button className={`btn btn-sm ${view === 'sheet' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setView('sheet')}>
            <Users size={14} /> גיליון יומי
          </button>
          <button className={`btn btn-sm ${view === 'history' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setView('history')}>
            <History size={14} /> היסטוריה
          </button>
        </div>

        <div className="modal-body" style={{ maxHeight: 400, overflowY: 'auto' }}>
          {view === 'sheet' && (
            loading ? (
              <div className="empty-state" style={{ padding: 32 }}>
                <Loader2 size={20} className="spin" />
                <div className="empty-state-sub" style={{ marginTop: 8 }}>טוען נוכחות...</div>
              </div>
            ) : members.length === 0 ? (
              <div className="empty-state" style={{ padding: 32 }}>
                <div className="empty-state-title">אין מתאמנים רשומים בחוג זה</div>
                <div className="empty-state-sub">שבץ מתאמנים לקבוצה כדי לסמן נוכחות</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {members.map(s => {
                  const parent = parents.find(p => p.id === s.parentId);
                  const currentStatus = state[s.id] || 'present';
                  return (
                    <div key={s.id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: 10, background: '#111827', borderRadius: 8, border: '1px solid var(--border)'
                    }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{s.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                          {parent?.name ? `הורה: ${parent.name}` : ''}{parent?.phone ? ` · ${parent.phone}` : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {ATT_STATUS.map(opt => (
                          <button
                            key={opt.key}
                            type="button"
                            className="btn btn-xs"
                            style={{
                              background: currentStatus === opt.key ? opt.color : 'rgba(255,255,255,0.03)',
                              color: currentStatus === opt.key ? 'white' : 'var(--text-3)',
                              fontWeight: currentStatus === opt.key ? 'bold' : 'normal',
                              border: '1px solid rgba(255,255,255,0.05)'
                            }}
                            onClick={() => updateStatus(s.id, opt.key)}
                          >
                            {opt.label}
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
                <div className="empty-state-title">אין נתוני נוכחות שמורים</div>
                <div className="empty-state-sub">שמור נוכחות ליום כלשהו כדי לראות היסטוריה</div>
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
                      {new Date(h.date).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric' })}
                    </div>
                    <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                      <span style={{ color: '#34D399' }}>✓ {h.present}</span>
                      <span style={{ color: '#FCA5A5' }}>✗ {h.absent}</span>
                      <span style={{ color: '#FCD34D' }}>⏱ {h.late}</span>
                    </div>
                  </button>
                ))}
              </div>
            )
          )}
        </div>

        <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: savedMsg.includes('שגיאה') ? 'var(--red)' : 'var(--green)' }}>{savedMsg}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={onClose}>סגור</button>
            {view === 'sheet' && members.length > 0 && (
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 size={15} className="spin" /> : '💾'} {saving ? 'שומר...' : 'שמור נוכחות'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Group Detail Side Panel ──────────────────────────────────────────────────
function GroupPanel({ group, students, parents, employees, onClose, onEdit, onDelete, onAttendance, onAssignStudent, onRemoveStudent }) {
  const [tab, setTab] = useState('members');
  const [assignId, setAssignId] = useState('');
  const c = AGE_COLORS[group.ageCategory] || DEF_COLOR;

  // Enrolled climbers (any non-archived student assigned to this group).
  const members = students.filter(s => s.groupId === group.id && s.status !== 'archived');
  // Students that could be assigned here (anyone not already in this group).
  const assignable = students.filter(s => s.groupId !== group.id && s.status !== 'archived');

  const pct    = group.maxSlots > 0 ? Math.round(members.length / group.maxSlots * 100) : 0;
  const isFull = members.length >= group.maxSlots;
  const freeSlots = Math.max(0, group.maxSlots - members.length);

  const trainer = employees.find(e => e.id === group.trainer);
  const days = getGroupDays(group);

  const handleAssign = () => {
    if (!assignId) return;
    onAssignStudent(assignId, group.id);
    setAssignId('');
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

        {/* Capacity */}
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

        {/* Quick actions */}
        <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" onClick={() => onAttendance(group)}>
            <Users size={14} /> נוכחות חוג
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => onEdit(group)}>
            <Edit2 size={14} /> עריכת קבוצה
          </button>
          {group.waParents && (
            <a href={group.waParents} target="_blank" rel="noreferrer" className="btn btn-success btn-sm">
              💬 וואטסאפ הורים
            </a>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {[
          { key: 'members', label: `משתתפים (${members.length})` },
          { key: 'info',    label: 'פרטים' },
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

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>

        {/* MEMBERS TAB */}
        {tab === 'members' && (
          <div>
            {/* Assign a climber */}
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
                  הקבוצה מלאה — הסר מתאמן כדי לפנות מקום
                </div>
              )}
            </div>

            {/* Members list */}
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
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{s.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>
                          {parent?.name}{parent?.phone ? ` · ${parent.phone}` : ''}
                        </div>
                      </div>
                      {s.levelGrade && (
                        <span style={{ fontWeight: 900, color: c.text, fontSize: 13 }}>{s.levelGrade}</span>
                      )}
                      <button className="btn btn-ghost btn-icon btn-xs" title="הסר מהקבוצה"
                        style={{ color: 'var(--red)' }}
                        onClick={() => onRemoveStudent(s.id)}>
                        <UserMinus size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
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
export default function Schedule({ groups, students, parents, setGroups, setStudents }) {
  const [selectedGroup,   setSelectedGroup]   = useState(null);
  const [editingGroup,    setEditingGroup]     = useState(null);
  const [showAddModal,    setShowAddModal]     = useState(false);
  const [attendanceGroup, setAttendanceGroup]  = useState(null);
  const [viewMode,        setViewMode]         = useState('week');
  const [employees,       setEmployees]        = useState([]);

  // Fetch employees list dynamically for trainers dropdown
  useEffect(() => {
    fetch('/api/employees')
      .then(res => res.ok ? res.json() : [])
      .then(data => setEmployees(Array.isArray(data) ? data : []))
      .catch(err => console.error(err));
  }, []);

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
    try {
      await fetch(`/api/groups/${id}`, { method: 'DELETE' });
    } catch (err) {
      console.error(err);
    }
  };

  const handleAssignStudent = async (studentId, groupId) => {
    setStudents(prev => prev.map(s => s.id === studentId ? { ...s, groupId } : s));
    try {
      await fetch(`/api/students/${studentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId })
      });
      refreshStudents();
    } catch (err) {
      console.error(err);
    }
  };

  const handleRemoveStudent = async (studentId) => {
    setStudents(prev => prev.map(s => s.id === studentId ? { ...s, groupId: null } : s));
    try {
      await fetch(`/api/students/${studentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: null })
      });
      refreshStudents();
    } catch (err) {
      console.error(err);
    }
  };

  const openEdit  = (g)  => { setEditingGroup(g); setShowAddModal(false); };
  const openAdd   = ()   => { setShowAddModal(true); setEditingGroup(null); setSelectedGroup(null); };
  const openPanel = (g)  => { setSelectedGroup(g); setEditingGroup(null); setShowAddModal(false); setAttendanceGroup(null); };

  const getEnrolledCount = (groupId) => {
    return students.filter(s => s.groupId === groupId && s.status !== 'archived').length;
  };

  const formattedGroups = groups.map(g => {
    const trainerObj = employees.find(e => e.id === g.trainer);
    return {
      ...g,
      trainerName: trainerObj ? trainerObj.name : ''
    };
  });

  // Keep the selected/attendance group in sync with the latest data so the
  // members list and enrolled counts update after assign/remove.
  const liveSelectedGroup = selectedGroup ? (formattedGroups.find(g => g.id === selectedGroup.id) || selectedGroup) : null;
  const liveAttendanceGroup = attendanceGroup ? (formattedGroups.find(g => g.id === attendanceGroup.id) || attendanceGroup) : null;

  return (
    <div className="fade-in">
      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {liveAttendanceGroup && !editingGroup && !showAddModal && (
        <AttendanceModal
          group={liveAttendanceGroup}
          students={students}
          parents={parents}
          onClose={() => setAttendanceGroup(null)}
        />
      )}
      {(showAddModal || editingGroup) && (
        <GroupFormModal
          group={editingGroup || null}
          employees={employees}
          onSave={handleSave}
          onClose={() => { setEditingGroup(null); setShowAddModal(false); }}
        />
      )}
      {liveSelectedGroup && !editingGroup && !showAddModal && !attendanceGroup && (
        <GroupPanel
          group={liveSelectedGroup}
          students={students}
          parents={parents}
          employees={employees}
          onClose={() => setSelectedGroup(null)}
          onEdit={openEdit}
          onDelete={handleDelete}
          onAttendance={g => setAttendanceGroup(g)}
          onAssignStudent={handleAssignStudent}
          onRemoveStudent={handleRemoveStudent}
        />
      )}

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div className="section-header" style={{ marginBottom: 20 }}>
        <div>
          <div className="section-title">לוח חוגים שבועי</div>
          <div className="section-sub">{groups.length} קבוצות חוגים פעילות · לחץ על משבצת לפרטים</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={`btn btn-sm ${viewMode === 'week' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setViewMode('week')}>🗓 שבוע</button>
          <button className={`btn btn-sm ${viewMode === 'list' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setViewMode('list')}>📋 רשימה</button>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>
            <Plus size={14} /> קבוצה חדשה
          </button>
        </div>
      </div>

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
                            <button className="btn btn-ghost btn-xs" onClick={() => setAttendanceGroup(g)}>
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
