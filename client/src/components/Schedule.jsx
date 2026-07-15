import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Save, X, Users, Check, Calendar, PlusCircle, AlertCircle, Send } from 'lucide-react';
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
                  {employees.map(emp => (
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

// ─── Attendance Modal ─────────────────────────────────────────────────────────
function AttendanceModal({ group, students, parents, onClose }) {
  const members = students.filter(s => s.groupId === group.id && s.status === 'registered');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [attendanceState, setAttendanceState] = useState({});

  useEffect(() => {
    // Set default present for all
    const defaults = {};
    members.forEach(m => {
      defaults[m.id] = 'present';
    });
    setAttendanceState(defaults);
  }, [group.id]);

  const updateStatus = (studentId, status) => {
    setAttendanceState(prev => ({ ...prev, [studentId]: status }));
  };

  const handleSave = () => {
    // Collect attendance details and alert/mock save
    const countPresent = Object.values(attendanceState).filter(s => s === 'present').length;
    alert(`דו״ח נוכחות לתאריך ${date} נשמר בהצלחה! ${countPresent} נוכחים.`);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal slide-up" style={{ maxWidth: 500 }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">📝 יומן נוכחות — {group.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <Calendar size={13} style={{ color: 'var(--text-3)' }} />
              <input
                type="date"
                className="input input-xs"
                style={{ background: '#1F2937', color: 'white', border: 'none', padding: '2px 6px', width: 120 }}
                value={date}
                onChange={e => setDate(e.target.value)}
              />
            </div>
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><X size={18} /></button>
        </div>
        
        <div className="modal-body" style={{ maxHeight: 380, overflowY: 'auto' }}>
          {members.length === 0 ? (
            <div className="empty-state" style={{ padding: 32 }}>
              <div className="empty-state-title">אין מתאמנים רשומים בחוג זה</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {members.map(s => {
                const parent = parents.find(p => p.id === s.parentId);
                const currentStatus = attendanceState[s.id] || 'present';
                
                return (
                  <div key={s.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: 10, background: '#111827', borderRadius: 8, border: '1px solid var(--border)'
                  }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{s.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>הורה: {parent?.name} · {parent?.phone}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {[
                        { key: 'present', label: 'נוכח', color: '#10B981' },
                        { key: 'absent', label: 'נעדר', color: '#EF4444' },
                        { key: 'makeup', label: 'השלמה', color: '#3B82F6' }
                      ].map(opt => (
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
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>ביטול</button>
          <button className="btn btn-primary" onClick={handleSave}>
            💾 שמור נוכחות
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Group Detail Side Panel ──────────────────────────────────────────────────
function GroupPanel({ group, students, parents, employees, onClose, onEdit, onDelete, onAttendance }) {
  const [tab, setTab] = useState('members');
  const c       = AGE_COLORS[group.ageCategory] || DEF_COLOR;
  
  // Real registered members
  const members = students.filter(s => s.groupId === group.id && s.status === 'registered');
  
  // Mock waitlist data for testing (in real CRM saved in group.waitlist list)
  const [waitlist, setWaitlist] = useState([
    { id: 'w1', name: 'אמיר שגיא', phone: '0547788990', parent: 'מיה שגיא' }
  ]);
  const [newWaitName, setNewWaitName] = useState('');
  const [newWaitPhone, setNewWaitPhone] = useState('');
  
  const pct     = group.maxSlots > 0 ? Math.round(members.length / group.maxSlots * 100) : 0;
  const isFull  = members.length >= group.maxSlots;

  const trainer = employees.find(e => e.id === group.trainer);

  const handleAddWaitlist = (e) => {
    e.preventDefault();
    if (!newWaitName || !newWaitPhone) return;
    setWaitlist(prev => [...prev, {
      id: `w-${Date.now()}`,
      name: newWaitName,
      phone: newWaitPhone,
      parent: 'הורה וואטסאפ'
    }]);
    setNewWaitName('');
    setNewWaitPhone('');
  };

  const handleRemoveWaitlist = (id) => {
    setWaitlist(prev => prev.filter(w => w.id !== id));
  };

  const handleSendWaNotify = (waiter) => {
    alert(`הודעת וואטסאפ נשלחה ל-${waiter.name} (${waiter.phone}):\n"היי! התפנה מקום בחוג ${group.name}. נשמח לתאם כניסה!"`);
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
              {DAYS_FULL[group.day]} · {group.time} · {group.duration}′
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
          <span style={{ fontSize: 12, fontWeight: 700, color: isFull ? 'var(--red)' : 'var(--text-2)', minWidth: 60 }}>
            {members.length}/{group.maxSlots} ({pct}%)
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
          { key: 'waitlist', label: `רשימת המתנה (${waitlist.length})` },
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
          members.length === 0 ? (
            <div className="empty-state" style={{ padding: 48 }}>
              <div className="empty-state-icon">🧗</div>
              <div className="empty-state-title">אין מתאמנים רשומים</div>
              <div className="empty-state-sub">השבץ מתאמנים לקבוצה דרך מסך לקוחות</div>
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
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* WAITLIST TAB */}
        {tab === 'waitlist' && (
          <div>
            {/* Quick Add to Waitlist */}
            <form onSubmit={handleAddWaitlist} className="card card-p" style={{ marginBottom: 14, background: '#111827' }}>
              <div style={{ fontSize: 12, fontWeight: 'bold', marginBottom: 8 }}>הוסף לרשימת המתנה</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <input
                  className="input input-sm"
                  placeholder="שם הילד..."
                  required
                  value={newWaitName}
                  onChange={e => setNewWaitName(e.target.value)}
                />
                <input
                  className="input input-sm"
                  placeholder="טלפון הורה..."
                  required
                  value={newWaitPhone}
                  onChange={e => setNewWaitPhone(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btn-ghost btn-xs w-full" style={{ justifyContent: 'center' }}>
                <PlusCircle size={12} /> רשום לרשימת המתנה
              </button>
            </form>

            {/* List Waitlist */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {waitlist.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center', padding: 20 }}>אין ממתינים לקבוצה זו</div>
              ) : (
                waitlist.map(w => (
                  <div key={w.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: 10, background: '#1F2937', borderRadius: 8
                  }}>
                    <div>
                      <div style={{ fontWeight: 'bold', fontSize: 13 }}>{w.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>טלפון: {w.phone}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-success btn-icon btn-xs" onClick={() => handleSendWaNotify(w)} title="שלח התראת וואטסאפ שהתפנה מקום">
                        <Send size={11} />
                      </button>
                      <button className="btn btn-danger btn-icon btn-xs" onClick={() => handleRemoveWaitlist(w.id)}>
                        <X size={11} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* INFO TAB */}
        {tab === 'info' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="card card-p">
              {[
                ['יום חוג', DAYS_FULL[group.day]],
                ['שעת התחלה', group.time],
                ['משך אימון', `${group.duration} דק׳`],
                ['מדריך אחראי', trainer ? trainer.name : '—'],
                ['חתך גילאים', group.ageCategory],
                ['מקסימום תפוסה', `${group.maxSlots} תלמידים`],
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
export default function Schedule({ groups, students, parents, setGroups }) {
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
      .then(data => setEmployees(data))
      .catch(err => console.error(err));
  }, []);

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
    // In real CRM backend handles deleteGroup route
  };

  const openEdit  = (g)  => { setEditingGroup(g); setShowAddModal(false); };
  const openAdd   = ()   => { setShowAddModal(true); setEditingGroup(null); setSelectedGroup(null); };
  const openPanel = (g)  => { setSelectedGroup(g); setEditingGroup(null); setShowAddModal(false); setAttendanceGroup(null); };

  // Map group items to display labels
  const getEnrolledCount = (groupId) => {
    return students.filter(s => s.groupId === groupId && s.status === 'registered').length;
  };

  const formattedGroups = groups.map(g => {
    const trainerObj = employees.find(e => e.id === g.trainer);
    return {
      ...g,
      trainerName: trainerObj ? trainerObj.name : ''
    };
  });

  return (
    <div className="fade-in">
      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {attendanceGroup && !editingGroup && !showAddModal && (
        <AttendanceModal
          group={attendanceGroup}
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
      {selectedGroup && !editingGroup && !showAddModal && !attendanceGroup && (
        <GroupPanel
          group={selectedGroup}
          students={students}
          parents={parents}
          employees={employees}
          onClose={() => setSelectedGroup(null)}
          onEdit={openEdit}
          onDelete={handleDelete}
          onAttendance={g => setAttendanceGroup(g)}
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
                const count = groups.filter(g => g.day === i).length;
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
                const dayGroups = formattedGroups.filter(g => g.day === day);
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
                          key={g.id}
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
                    return (
                      <tr key={g.id} style={{ cursor: 'pointer' }} onClick={() => openPanel(g)}>
                        <td style={{ fontWeight: 700 }}>{g.name}</td>
                        <td style={{ color: 'var(--text-2)' }}>{DAYS_FULL[g.day]}</td>
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
