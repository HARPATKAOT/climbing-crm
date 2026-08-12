import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Award, Trophy, ChevronDown, ChevronUp, Medal, Edit2, Trash2, BarChart3, SlidersHorizontal, RotateCcw, Search } from 'lucide-react';
import { Modal } from './UI.jsx';
import { LEVELS, LEVEL_COLOR, LEVEL_POINTS, ROUTE_STYLE, routeStyleMeta, levelRank } from '../utils/levelGrades.js';
import {
  TEST_KINDS,
  TEST_TYPE_COLORS,
  testKindMeta,
  normalizeTestKindKey,
} from '../utils/levelTestKinds.js';
import { studentInGroup } from '../utils/studentGroups.js';
import AppSelect from './AppSelect.jsx';
import { useAuth } from './AuthGate.jsx';

const ROUTE_TYPES = Object.values(ROUTE_STYLE);

const isoToday = () => new Date().toISOString().slice(0, 10);

function isoMonthsAgo(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** קווי הסרגל האנכי — עד 5 מספרים עגולים שמכסים את העמודה הגבוהה. */
function axisScale(max) {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  const step = steps.find((s) => max / s <= 4) || Math.ceil(max / 4);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks = [];
  for (let v = top; v >= 0; v -= step) ticks.push(v);
  return { top, ticks };
}

function normalizeTest(t) {
  const studentId = t.studentId || t.climber_id || null;
  const level = t.level || t.grade || null;
  const routeStyle = t.route_style || t.route_type || (t.test_type === 'top-rope' || t.test_type === 'top_rope' ? 'top-rope' : null);
  const testType = t.test_type === 'top-rope' || t.test_type === 'top_rope' ? 'level' : (t.test_type || 'level');
  const passed = t.passed ?? (t.status === 'passed');
  const status = t.status || (passed ? 'passed' : 'failed');
  return {
    ...t,
    studentId,
    climber_id: studentId,
    level,
    grade: level,
    test_type: testType,
    route_style: routeStyle,
    route_type: routeStyle,
    passed,
    status,
    ceremony: t.ceremony ?? t.attended_ceremony ?? false,
    attended_ceremony: t.attended_ceremony ?? t.ceremony ?? false,
  };
}

function TestFormModal({ students, groups, employees, allowedKinds = TEST_KINDS, initial, onSave, onClose }) {
  const [studentId, setStudentId]     = useState(initial?.studentId || initial?.climber_id || '');
  const [testType, setTestType]       = useState(initial?.test_type || allowedKinds[0]?.key || 'level');
  const [level, setLevel]             = useState(initial?.level || initial?.grade || '5A');
  const [routeStyle, setRouteStyle]   = useState(initial?.route_style || initial?.route_type || 'top-rope');
  const [examinerId, setExaminerId]   = useState(
    initial?.examinerId
      || employees.find((e) => e.name === initial?.examiner)?.id
      || employees[0]?.id
      || ''
  );
  const [date, setDate]               = useState(initial?.date || new Date().toISOString().split('T')[0]);
  const [status, setStatus]           = useState(initial?.status || (initial?.passed === false ? 'failed' : 'passed'));
  const [ceremony, setCeremony]       = useState(!!(initial?.ceremony ?? initial?.attended_ceremony));
  const [notes, setNotes]             = useState(initial?.notes || '');

  useEffect(() => {
    if (!examinerId && employees[0]?.id) setExaminerId(employees[0].id);
  }, [employees, examinerId]);

  const handleSubmit = e => {
    e.preventDefault();
    if (!studentId) return;
    if (!examinerId) {
      alert('נא לבחור את המדריך הבוחן');
      return;
    }
    const student = students.find(s => s.id === studentId);
    const examinerName = employees.find(emp => emp.id === examinerId)?.name || null;
    onSave({
      studentId,
      studentName: student?.name,
      climber_id: studentId,
      test_type: testType,
      level: testType === 'level' ? level : null,
      grade: testType === 'level' ? level : null,
      route_style: testType === 'level' ? routeStyle : null,
      examiner: examinerName,
      examinerId,
      date,
      status,
      passed: status === 'passed',
      ceremony: testType === 'level' ? ceremony : false,
      attended_ceremony: testType === 'level' ? ceremony : false,
      notes: notes.trim()
    });
  };

  const registeredStudents = students.filter(s => s.status === 'registered');
  const isEdit = !!initial?.id;

  return (
    <Modal title={isEdit ? 'עריכת מבחן' : 'שמירת מבחן חדש'} onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>ביטול</button>
          <button form="add-test-form" type="submit" className="btn btn-primary">
            <Award size={16} /> {isEdit ? 'שמור שינויים' : 'שמור מבחן'}
          </button>
        </>
      }
    >
      <form id="add-test-form" onSubmit={handleSubmit} className="form-grid">
        <div className="form-group">
          <label className="form-label">מתאמן *</label>
          <AppSelect className="input select" required value={studentId} onChange={e => setStudentId(e.target.value)}>
            <option value="">בחר מתאמן...</option>
            {registeredStudents.map(s => {
              const grp = groups.find(g => g.id === s.groupId);
              return (
                <option key={s.id} value={s.id}>
                  {s.name} {grp ? `(${grp.name.split('—')[0].trim()})` : ''}
                </option>
              );
            })}
          </AppSelect>
        </div>

        <div className="form-group">
          <label className="form-label">סוג מבחן *</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {allowedKinds.map((k) => {
              const active = testType === k.key;
              const Icon = k.Icon;
              return (
                <button
                  key={k.key}
                  type="button"
                  className={`btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setTestType(k.key)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontWeight: 800,
                    ...(active
                      ? { background: k.bg, color: k.accent, borderColor: k.border }
                      : { color: k.accent }),
                  }}
                >
                  <Icon size={15} strokeWidth={2.3} />
                  {k.label}
                </button>
              );
            })}
          </div>
        </div>

        {testType === 'level' && (
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">רמה</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {LEVELS.map(l => (
                  <button key={l} type="button"
                    className={`btn btn-sm ${level === l ? 'btn-primary' : 'btn-ghost'}`}
                    style={level === l ? { background: `${LEVEL_COLOR[l]}22`, color: LEVEL_COLOR[l], borderColor: LEVEL_COLOR[l] } : {}}
                    onClick={() => setLevel(l)}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">טופ רופ / הובלה</label>
              {ROUTE_TYPES.map(rt => (
                <button key={rt.key} type="button"
                  className={`btn btn-sm ${routeStyle === rt.key ? 'btn-primary' : 'btn-ghost'}`}
                  style={{
                    marginLeft: 6,
                    marginBottom: 6,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    ...(routeStyle === rt.key
                      ? { background: `${rt.color}22`, color: rt.color, borderColor: rt.color, fontWeight: 800 }
                      : { color: rt.color }),
                  }}
                  onClick={() => setRouteStyle(rt.key)}>
                  <rt.Icon size={14} strokeWidth={2.4} />
                  {rt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">בוחן *</label>
          <AppSelect className="input select" required value={examinerId} onChange={e => setExaminerId(e.target.value)}>
            <option value="">בחר בוחן...</option>
            {employees.length === 0 && <option value="" disabled>אין עובדים במערכת</option>}
            {employees.map(emp => (
              <option key={emp.id} value={emp.id}>{emp.name}</option>
            ))}
          </AppSelect>
        </div>

        <div className="form-grid-2">
          <div className="form-group">
            <label className="form-label">תאריך מבחן</label>
            <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">תוצאה</label>
            <AppSelect className="input select" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="passed">עבר ✓</option>
              <option value="pending">ממתין לתוצאה</option>
              <option value="failed">לא עבר ✗</option>
            </AppSelect>
          </div>
        </div>

        {testType === 'level' && (
          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={ceremony} onChange={e => setCeremony(e.target.checked)}
                style={{ width: 16, height: 16 }} />
              השתתף בטקס הענקת תגים
            </label>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">הערות</label>
          <textarea className="input textarea" rows={2} placeholder="הערות על הביצוע..."
            value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
      </form>
    </Modal>
  );
}

/**
 * התפלגות לפי רמה — ציר X הוא הרמה, גובה העמודה הוא הכמות.
 * לחיצה על עמודה מסננת את הטבלה לאותה רמה, ולחיצה חוזרת מנקה.
 */
function LevelDistributionChart({ rows, mode, onModeChange, activeLevel, onPickLevel }) {
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const { top, ticks } = axisScale(Math.max(1, ...rows.map((r) => r.count)));
  const busiest = rows.reduce((best, r) => (r.count > (best?.count || 0) ? r : best), null);
  const unit = mode === 'climbers' ? 'מתאמנים' : 'מבחנים';
  // המסך ימין־לשמאל, ולכן האיבר הראשון יושב מימין: הרמות הגבוהות בצד ימין.
  const columns = [...rows].reverse();

  return (
    <div className="card card-p" style={{ marginBottom: 20 }}>
      <div className="section-header" style={{ marginBottom: 14, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <BarChart3 size={17} style={{ color: 'var(--cyan)', flexShrink: 0 }} />
          <div>
            <div className="section-title" style={{ fontSize: 14 }}>התפלגות לפי רמה</div>
            <div className="section-sub" style={{ fontSize: 11 }}>
              {mode === 'climbers'
                ? 'כל מתאמן נספר פעם אחת — לפי הרמה הגבוהה ביותר שעבר'
                : 'מספר המבחנים שנרשמו בכל רמה'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { val: 'climbers', label: 'לפי מתאמן' },
            { val: 'tests',    label: 'לפי מבחן' },
          ].map((m) => (
            <button key={m.val} className={`btn btn-xs ${mode === m.val ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => onModeChange(m.val)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {total === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-3)', fontSize: 13 }}>
          אין נתוני רמה שמתאימים לסינון
        </div>
      ) : (
        <>
          <div className="level-dist-plot">
            <div className="level-dist-grid">
              {ticks.map((t) => (
                <span key={t} style={{ bottom: `${(t / top) * 100}%` }}>{t}</span>
              ))}
            </div>
            {columns.map((r) => {
              const color = LEVEL_COLOR[r.level] || '#38BDF8';
              const isActive = activeLevel === r.level;
              return (
                <button
                  key={r.level}
                  type="button"
                  className={`level-dist-col${isActive ? ' is-active' : ''}${activeLevel !== 'all' && !isActive ? ' is-dim' : ''}`}
                  style={{ '--lv': color }}
                  title={`רמה ${r.level} · ${r.count} ${unit}`}
                  onClick={() => onPickLevel(isActive ? 'all' : r.level)}
                >
                  <span className="level-dist-track">
                    <i className="level-dist-bar" style={{ height: `${(r.count / top) * 100}%` }}>
                      {r.count > 0 && <b>{r.count}</b>}
                    </i>
                  </span>
                  <em>{r.level}</em>
                </button>
              );
            })}
          </div>
          <div className="level-dist-foot">
            <span>סה"כ <b>{total}</b> {unit}</span>
            {busiest?.count > 0 && (
              <span>הרמה השכיחה: <b style={{ color: LEVEL_COLOR[busiest.level] }}>{busiest.level}</b> ({busiest.count})</span>
            )}
            <span style={{ color: 'var(--text-3)' }}>לחיצה על עמודה מסננת את הטבלה</span>
          </div>
        </>
      )}
    </div>
  );
}

function StudentLevelCard({ student, tests, groups, onEdit, onDelete, canEditTest = () => true }) {
  const [expanded, setExpanded] = useState(false);
  const myTests = tests
    .filter(t => (t.climber_id || t.studentId) === student.id)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const latestPassed = myTests.find(t => t.status === 'passed' && (t.test_type === 'level' || !t.test_type || t.grade));
  const group = groups.find(g => g.id === student.groupId);

  if (myTests.length === 0) return null;

  return (
    <div className="card card-p" style={{ marginBottom: 10 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{
          width: 56, height: 56, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, fontWeight: 900, flexShrink: 0,
          background: latestPassed?.grade ? `${LEVEL_COLOR[latestPassed.grade]}22` : 'rgba(255,255,255,0.04)',
          color: latestPassed?.grade ? LEVEL_COLOR[latestPassed.grade] : 'var(--text-3)',
          border: `2px solid ${latestPassed?.grade ? LEVEL_COLOR[latestPassed.grade] : 'var(--border)'}`,
        }}>
          {latestPassed?.grade || '?'}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>{student.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
            {group?.name} · {myTests.length} מבחן{myTests.length !== 1 ? 'ים' : ''}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {myTests.filter(t => t.ceremony).length > 0 && (
            <span title="השתתף בטקס"><Trophy size={16} style={{ color: '#FCD34D' }} /></span>
          )}
          {expanded ? <ChevronUp size={16} style={{ color: 'var(--text-3)' }} /> : <ChevronDown size={16} style={{ color: 'var(--text-3)' }} />}
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {myTests.map(t => {
              const asLevel = t.test_type === 'level' || t.test_type === 'top-rope' || t.test_type === 'top_rope';
              const kind = testKindMeta(t.test_type);
              const KindIcon = kind.Icon;
              const typeColor = TEST_TYPE_COLORS[kind.key];
              const gradeAccent = asLevel && t.grade ? LEVEL_COLOR[t.grade] : null;
              const accent = gradeAccent || typeColor.accent;
              const bg = gradeAccent ? `${gradeAccent}14` : typeColor.bg;
              const border = gradeAccent ? `${gradeAccent}44` : typeColor.border;
              const route = asLevel ? routeStyleMeta(t.route_style || t.route_type) : null;
              const statusColor = t.status === 'passed' ? 'var(--green)' : t.status === 'failed' ? 'var(--red)' : 'var(--amber)';
              const statusLabel = t.status === 'passed' ? '✓ עבר' : t.status === 'failed' ? '✗ לא עבר' : '⏳ ממתין';
              return (
                <div key={t.id} style={{
                  display: 'flex', gap: 12, alignItems: 'center',
                  padding: '8px 12px', borderRadius: 8,
                  background: bg,
                  border: `1px solid ${border}`,
                  borderRight: `3px solid ${accent}`,
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: accent, background: typeColor.bg, border: `1px solid ${typeColor.border}`,
                    fontSize: asLevel ? 13 : 14, fontWeight: 900,
                  }}>
                    {asLevel ? (t.grade || '?') : <KindIcon size={18} strokeWidth={2.2} />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {asLevel && (
                        <>
                          <span style={{ color: accent, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            <KindIcon size={13} strokeWidth={2.3} />
                            רמה {t.grade || t.level || ''}
                          </span>
                          {route && (
                            <span style={{
                              color: route.color,
                              marginInlineStart: 6,
                              fontWeight: 800,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                            }}>
                              <route.Icon size={13} strokeWidth={2.4} />
                              {route.label}
                            </span>
                          )}
                        </>
                      )}
                      {!asLevel && (
                        <span style={{ color: accent, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <KindIcon size={14} strokeWidth={2.3} />
                          {kind.label}
                        </span>
                      )}
                      {t.ceremony ? ' 🏆' : ''}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>בוחן: {t.examiner || '—'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{t.date}</div>
                    {t.notes && <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 3 }}>{t.notes}</div>}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: statusColor }}>{statusLabel}</span>
                  {canEditTest(t) && <button type="button" className="btn btn-ghost btn-icon btn-xs" title="עריכה" onClick={(e) => { e.stopPropagation(); onEdit?.(t); }}>
                    <Edit2 size={13} />
                  </button>}
                  {canEditTest(t) && <button type="button" className="btn btn-ghost btn-icon btn-xs" title="מחיקה" style={{ color: 'var(--red)' }} onClick={(e) => { e.stopPropagation(); onDelete?.(t); }}>
                    <Trash2 size={13} />
                  </button>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LevelTests({ students, groups }) {
  const { user, isOwner } = useAuth();
  const rank = { none: 0, view: 1, edit: 2 };
  const testModule = (key) => key === 'security' ? 'safety_tests' : key === 'lead' ? 'lead_tests' : 'level_tests';
  const canAccessKind = (key, level = 'view') => isOwner
    || (rank[user?.modules?.[testModule(key)]] || 0) >= rank[level];
  const visibleKinds = TEST_KINDS.filter((kind) => canAccessKind(kind.key));
  const editableKinds = TEST_KINDS.filter((kind) => canAccessKind(kind.key, 'edit'));
  const canEditTest = (test) => canAccessKind(testKindMeta(test?.test_type).key, 'edit');
  const [tests, setTests]               = useState([]);
  const [employees, setEmployees]       = useState([]);
  const [formTest, setFormTest]         = useState(null); // null | {} (new) | test (edit)
  const [filterLevel, setFilterLevel]   = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterKind, setFilterKind]     = useState('all');
  const [activeTab, setActiveTab]       = useState('tests'); // tests | leaderboard
  const [showAdvanced, setShowAdvanced]         = useState(false);
  const [filterEnrollment, setFilterEnrollment] = useState('all'); // all | registered | unregistered
  const [filterGroup, setFilterGroup]           = useState('all');
  const [filterExaminer, setFilterExaminer]     = useState('all');
  const [filterRoute, setFilterRoute]           = useState('all'); // all | top-rope | lead
  const [dateFrom, setDateFrom]                 = useState('');
  const [dateTo, setDateTo]                     = useState('');
  const [searchName, setSearchName]             = useState('');
  const [chartMode, setChartMode]               = useState('climbers'); // climbers | tests

  const refreshTests = async () => {
    try {
      const data = await fetch('/api/level-tests').then(r => r.json());
      setTests((Array.isArray(data) ? data : []).map(normalizeTest));
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    refreshTests();
    fetch('/api/employees')
      .then(r => r.ok ? r.json() : [])
      .then(data => setEmployees(Array.isArray(data) ? data : []))
      .catch(err => console.error(err));
  }, []);

  const handleSave = async (data) => {
    try {
      const isEdit = !!formTest?.id;
      const response = await fetch(
        isEdit ? `/api/level-tests/${formTest.id}` : '/api/level-tests',
        {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }
      );
      if (response.ok) {
        setFormTest(null);
        refreshTests();
      } else {
        const body = await response.json().catch(() => ({}));
        alert(body.error || 'שמירת המבחן נכשלה');
      }
    } catch (err) {
      console.error(err);
      alert('שמירת המבחן נכשלה');
    }
  };

  const handleDelete = async (test) => {
    if (!window.confirm('למחוק את המבחן? הפעולה אינה הפיכה.')) return;
    try {
      const response = await fetch(`/api/level-tests/${test.id}`, { method: 'DELETE' });
      if (response.ok) {
        refreshTests();
      } else {
        const body = await response.json().catch(() => ({}));
        alert(body.error || 'מחיקת המבחן נכשלה');
      }
    } catch (err) {
      console.error(err);
      alert('מחיקת המבחן נכשלה');
    }
  };

  const passed  = tests.filter(t => t.status === 'passed').length;
  const trophies = tests.filter(t => t.ceremony && t.status === 'passed').length;

  const studentById = useMemo(
    () => new Map(students.map(s => [String(s.id), s])),
    [students]
  );

  /** כל הסינונים חוץ מהרמה — הגרף צריך אותם בלי לאבד את ציר ה־X. */
  const matchesFilters = useMemo(() => {
    const examinerName = filterExaminer === 'all'
      ? null
      : employees.find(e => e.id === filterExaminer)?.name || null;
    const query = searchName.trim().toLowerCase();

    return (t, { ignoreStatus = false } = {}) => {
      const kind = normalizeTestKindKey(t.test_type);
      if (filterKind !== 'all' && kind !== filterKind) return false;
      if (!ignoreStatus && filterStatus !== 'all' && t.status !== filterStatus) return false;

      const date = String(t.date || '').slice(0, 10);
      if (dateFrom && (!date || date < dateFrom)) return false;
      if (dateTo && (!date || date > dateTo)) return false;

      if (filterRoute !== 'all') {
        if (kind !== 'level') return false;
        if ((routeStyleMeta(t.route_style || t.route_type)?.key || null) !== filterRoute) return false;
      }

      if (filterExaminer !== 'all'
        && t.examinerId !== filterExaminer
        && (!examinerName || t.examiner !== examinerName)) return false;

      const student = studentById.get(String(t.climber_id || t.studentId || ''));
      if (filterEnrollment === 'registered' && student?.status !== 'registered') return false;
      if (filterEnrollment === 'unregistered' && student?.status === 'registered') return false;
      if (filterGroup !== 'all' && !studentInGroup(student, filterGroup)) return false;

      if (query && !String(student?.name || t.studentName || '').toLowerCase().includes(query)) return false;
      return true;
    };
  }, [filterKind, filterStatus, dateFrom, dateTo, filterRoute, filterExaminer, filterEnrollment,
      filterGroup, searchName, employees, studentById]);

  const filteredTests = useMemo(() => {
    return tests
      .filter(t => matchesFilters(t) && (filterLevel === 'all' || t.grade === filterLevel))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }, [tests, matchesFilters, filterLevel]);

  /** במצב "מתאמנים" סופרים כל מטפס פעם אחת, לפי המבחן הגבוה שעבר. */
  const levelDistribution = useMemo(() => {
    const counts = Object.fromEntries(LEVELS.map(l => [l, 0]));
    const climbersMode = chartMode === 'climbers';
    const relevant = tests.filter(t =>
      normalizeTestKindKey(t.test_type) === 'level'
      && matchesFilters(t, { ignoreStatus: climbersMode })
    );

    if (!climbersMode) {
      relevant.forEach(t => {
        const grade = t.grade || t.level;
        if (counts[grade] !== undefined) counts[grade] += 1;
      });
    } else {
      const best = new Map();
      relevant.forEach(t => {
        if (t.status !== 'passed') return;
        const rank = levelRank(t.grade || t.level);
        const climberId = String(t.climber_id || t.studentId || '');
        if (rank < 0 || !climberId) return;
        if (rank > (best.get(climberId) ?? -1)) best.set(climberId, rank);
      });
      best.forEach(rank => { counts[LEVELS[rank]] += 1; });
    }

    return LEVELS.map(level => ({ level, count: counts[level] }));
  }, [tests, matchesFilters, chartMode]);

  const activeFilterCount = [
    filterEnrollment !== 'all',
    filterGroup !== 'all',
    filterExaminer !== 'all',
    filterRoute !== 'all',
    !!dateFrom || !!dateTo,
    !!searchName.trim(),
  ].filter(Boolean).length;

  const resetAdvanced = () => {
    setFilterEnrollment('all');
    setFilterGroup('all');
    setFilterExaminer('all');
    setFilterRoute('all');
    setDateFrom('');
    setDateTo('');
    setSearchName('');
  };

  const studentsWithTests = students.filter(s => tests.some(t => (t.climber_id || t.studentId) === s.id));

  const leaderboard = useMemo(() => {
    const teamGroupIds = new Set(
      groups
        .filter(g => g.name.includes('נבחרת') || g.name.includes('עלית') || g.name.includes('ליגה') || g.name.includes('נבחרת צעירה'))
        .map(g => g.id)
    );

    const board = students
      .filter(s => s.status === 'registered' && teamGroupIds.has(s.groupId))
      .map(s => {
        const studentTests = tests.filter(t =>
          (t.climber_id || t.studentId) === s.id &&
          t.status === 'passed' &&
          (t.test_type === 'level' || t.test_type === 'top-rope' || (!t.test_type && t.grade))
        );
        let maxGrade = '5A';
        let maxPoints = 1;
        let testCount = tests.filter(t => (t.climber_id || t.studentId) === s.id).length;

        studentTests.forEach(t => {
          const pts = LEVEL_POINTS[t.grade] || 1;
          if (pts > maxPoints) {
            maxPoints = pts;
            maxGrade = t.grade;
          }
        });

        const grp = groups.find(g => g.id === s.groupId);

        return {
          id: s.id,
          name: s.name,
          groupName: grp ? grp.name : 'נבחרת',
          maxGrade,
          maxPoints,
          testCount,
          trophiesCount: studentTests.filter(t => t.ceremony).length
        };
      });

    return board.sort((a, b) => b.maxPoints - a.maxPoints);
  }, [students, groups, tests]);

  return (
    <div className="fade-in">
      {formTest !== null && editableKinds.length > 0 && (
        <TestFormModal
          students={students}
          groups={groups}
          employees={employees}
          allowedKinds={editableKinds}
          initial={formTest.id ? formTest : null}
          onSave={handleSave}
          onClose={() => setFormTest(null)}
        />
      )}

      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="card stat-card" style={{ '--stat-color': '#6366F1' }}>
          <div className="stat-label">סה"כ מבחנים מבוצעים</div>
          <div className="stat-value">{tests.length}</div>
        </div>
        <div className="card stat-card" style={{ '--stat-color': '#10B981' }}>
          <div className="stat-label">עברו בהצלחה</div>
          <div className="stat-value">{passed}</div>
          <div className="stat-sub up">✓ הצלחה</div>
        </div>
        <div className="card stat-card" style={{ '--stat-color': '#F59E0B' }}>
          <div className="stat-label">גביעי טקסי הסמכה</div>
          <div className="stat-value">{trophies}</div>
          <div className="stat-sub warn">🏆 הוענקו לנבחרת</div>
        </div>
      </div>

      <div className="section-header" style={{ marginBottom: 20 }}>
        <div>
          <div className="section-title">מבחנים ונבחרת</div>
          <div className="section-sub">מבחני רמה, אבטחה והובלה · לוח הישגים של הנבחרת</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="tab-bar tab-bar-inline">
            <button className={`tab-pill ${activeTab === 'tests' ? 'active' : ''}`} onClick={() => setActiveTab('tests')}>
              <Award size={15} /> מבחנים
            </button>
            <button className={`tab-pill ${activeTab === 'leaderboard' ? 'active' : ''}`} onClick={() => setActiveTab('leaderboard')}>
              <Trophy size={15} /> לוח הנבחרת
            </button>
          </div>
          {editableKinds.length > 0 && <button className="btn btn-primary btn-sm" onClick={() => setFormTest({})}>
            <Plus size={15} /> שמירת מבחן חדש
          </button>}
        </div>
      </div>

      {activeTab === 'tests' && (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>סוג מבחן</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className={`btn btn-xs ${filterKind === 'all' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setFilterKind('all')}>הכל</button>
                {visibleKinds.map((k) => {
                  const Icon = k.Icon;
                  const active = filterKind === k.key;
                  return (
                    <button
                      key={k.key}
                      className={`btn btn-xs ${active ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setFilterKind(k.key)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        ...(active
                          ? { background: k.bg, color: k.accent, borderColor: k.border, fontWeight: 800 }
                          : { color: k.accent }),
                      }}
                    >
                      <Icon size={13} strokeWidth={2.3} />
                      {k.shortLabel}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>סינון לפי רמה</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className={`btn btn-xs ${filterLevel === 'all' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setFilterLevel('all')}>הכל</button>
                {LEVELS.map(l => (
                  <button key={l} className={`btn btn-xs ${filterLevel === l ? 'btn-primary' : 'btn-ghost'}`}
                    style={filterLevel === l ? { background: `${LEVEL_COLOR[l]}22`, color: LEVEL_COLOR[l], borderColor: LEVEL_COLOR[l] } : {}}
                    onClick={() => setFilterLevel(l)}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>תוצאה</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {[
                  { val: 'all',     label: 'הכל' },
                  { val: 'passed',  label: '✓ עבר' },
                  { val: 'pending', label: '⏳ ממתין' },
                  { val: 'failed',  label: '✗ לא עבר' },
                ].map(f => (
                  <button key={f.val} className={`btn btn-xs ${filterStatus === f.val ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setFilterStatus(f.val)}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
              <button className={`btn btn-xs ${showAdvanced || activeFilterCount ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setShowAdvanced(!showAdvanced)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <SlidersHorizontal size={13} strokeWidth={2.3} />
                סינון מתקדם
                {activeFilterCount > 0 && (
                  <span style={{
                    background: 'var(--cyan)', color: '#0B1020', borderRadius: 999,
                    fontSize: 10, fontWeight: 900, padding: '0 5px', minWidth: 15, textAlign: 'center',
                  }}>{activeFilterCount}</span>
                )}
                {showAdvanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
              {activeFilterCount > 0 && (
                <button className="btn btn-xs btn-ghost" onClick={resetAdvanced}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text-3)' }}>
                  <RotateCcw size={12} /> נקה
                </button>
              )}
            </div>
          </div>

          {showAdvanced && (
            <div className="card card-p level-filters">
              <div className="form-group">
                <label className="form-label">שם מתאמן</label>
                <div style={{ position: 'relative' }}>
                  <Search size={14} style={{
                    position: 'absolute', insetInlineStart: 10, top: '50%', transform: 'translateY(-50%)',
                    color: 'var(--text-3)', pointerEvents: 'none',
                  }} />
                  <input className="input" placeholder="חיפוש לפי שם..." value={searchName}
                    onChange={e => setSearchName(e.target.value)} style={{ paddingInlineStart: 30 }} />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">רישום לחוג</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {[
                    { val: 'all',          label: 'הכל' },
                    { val: 'registered',   label: 'רשומים לחוג' },
                    { val: 'unregistered', label: 'לא רשומים' },
                  ].map(f => (
                    <button key={f.val} className={`btn btn-xs ${filterEnrollment === f.val ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setFilterEnrollment(f.val)}>
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">חוג</label>
                <AppSelect className="input select" value={filterGroup} onChange={e => setFilterGroup(e.target.value)}>
                  <option value="all">כל החוגים</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </AppSelect>
              </div>

              <div className="form-group">
                <label className="form-label">בוחן</label>
                <AppSelect className="input select" value={filterExaminer} onChange={e => setFilterExaminer(e.target.value)}>
                  <option value="all">כל הבוחנים</option>
                  {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                </AppSelect>
              </div>

              <div className="form-group">
                <label className="form-label">סגנון מסלול</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className={`btn btn-xs ${filterRoute === 'all' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setFilterRoute('all')}>הכל</button>
                  {ROUTE_TYPES.map(rt => (
                    <button key={rt.key} className={`btn btn-xs ${filterRoute === rt.key ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setFilterRoute(rt.key)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        ...(filterRoute === rt.key
                          ? { background: `${rt.color}22`, color: rt.color, borderColor: rt.color, fontWeight: 800 }
                          : { color: rt.color }),
                      }}>
                      <rt.Icon size={13} strokeWidth={2.4} />
                      {rt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group level-filters-dates">
                <label className="form-label">תאריך המבחן</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input className="input" type="date" value={dateFrom} max={dateTo || undefined}
                    onChange={e => setDateFrom(e.target.value)} style={{ width: 155 }} />
                  <span style={{ color: 'var(--text-3)', fontSize: 12 }}>עד</span>
                  <input className="input" type="date" value={dateTo} min={dateFrom || undefined}
                    onChange={e => setDateTo(e.target.value)} style={{ width: 155 }} />
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {[
                      { label: 'החודש',    from: () => `${isoToday().slice(0, 7)}-01` },
                      { label: '3 חודשים', from: () => isoMonthsAgo(3) },
                      { label: 'שנה',      from: () => isoMonthsAgo(12) },
                    ].map(p => (
                      <button key={p.label} className="btn btn-xs btn-ghost"
                        onClick={() => { setDateFrom(p.from()); setDateTo(isoToday()); }}>
                        {p.label}
                      </button>
                    ))}
                    {(dateFrom || dateTo) && (
                      <button className="btn btn-xs btn-ghost" style={{ color: 'var(--text-3)' }}
                        onClick={() => { setDateFrom(''); setDateTo(''); }}>
                        כל הזמנים
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          <LevelDistributionChart
            rows={levelDistribution}
            mode={chartMode}
            onModeChange={setChartMode}
            activeLevel={filterLevel}
            onPickLevel={setFilterLevel}
          />

          <div style={{ marginBottom: 28 }}>
            <div className="card">
              <div className="table-wrap">
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>מתאמן</th>
                      <th>קבוצה</th>
                      <th>סוג מבחן</th>
                      <th>פרטים</th>
                      <th>בוחן</th>
                      <th>תאריך</th>
                      <th>תוצאה</th>
                      <th>הערות</th>
                      <th style={{ width: 80 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTests.length === 0 && (
                      <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>אין מבחנים מותאמים לסינון</td></tr>
                    )}
                    {filteredTests.slice(0, 100).map(t => {
                      const student = students.find(s => s.id === (t.climber_id || t.studentId));
                      const group   = groups.find(g => g.id === student?.groupId);
                      const asLevel = t.test_type === 'level' || t.test_type === 'top-rope' || t.test_type === 'top_rope';
                      const route = asLevel ? routeStyleMeta(t.route_style || t.route_type) : null;
                      const kind = testKindMeta(t.test_type);
                      const KindIcon = kind.Icon;
                      const typeColor = TEST_TYPE_COLORS[kind.key];
                      const gradeAccent = asLevel && t.grade ? LEVEL_COLOR[t.grade] : null;
                      const statusColor = t.status === 'passed' ? 'badge-green' : t.status === 'failed' ? 'badge-red' : 'badge-amber';
                      const statusLabel = t.status === 'passed' ? '✓ עבר' : t.status === 'failed' ? '✗ נכשל' : '⏳ ממתין';
                      const rowBg = gradeAccent ? `${gradeAccent}10` : typeColor.bg;
                      return (
                        <tr key={t.id} style={{ background: rowBg }}>
                          <td style={{ fontWeight: 700 }}>{student?.name || t.studentName || t.climber_id || '—'}</td>
                          <td style={{ fontSize: 12, color: 'var(--text-3)' }}>{group?.name?.split(' ')[0] || '—'}</td>
                          <td style={{ fontSize: 13, fontWeight: 700, color: typeColor.accent }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <KindIcon size={15} strokeWidth={2.3} />
                              {kind.label}
                            </span>
                          </td>
                          <td>
                            {asLevel ? (
                              <span style={{ fontWeight: 900, fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ color: LEVEL_COLOR[t.grade] || 'var(--text-2)' }}>{t.grade || '—'}</span>
                                {route && (
                                  <span style={{
                                    color: route.color,
                                    fontWeight: 800,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                  }}>
                                    <route.Icon size={13} strokeWidth={2.4} />
                                    {route.label}
                                  </span>
                                )}
                              </span>
                            ) : '—'}
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--text-3)' }}>{t.examiner || '—'}</td>
                          <td style={{ fontSize: 12, color: 'var(--text-3)' }}>{t.date}</td>
                          <td><span className={`badge ${statusColor}`}>{statusLabel}</span></td>
                          <td style={{ fontSize: 12, color: 'var(--text-3)', maxWidth: 160 }}>{t.notes || '—'}</td>
                          <td>
                            <div style={{ display: 'flex', gap: 4 }}>
                              {canEditTest(t) && <button type="button" className="btn btn-ghost btn-icon btn-xs" title="עריכה" onClick={() => setFormTest(t)}>
                                <Edit2 size={13} />
                              </button>}
                              {canEditTest(t) && <button type="button" className="btn btn-ghost btn-icon btn-xs" title="מחיקה" style={{ color: 'var(--red)' }} onClick={() => handleDelete(t)}>
                                <Trash2 size={13} />
                              </button>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {studentsWithTests.length > 0 && (
            <>
              <div className="section-header" style={{ marginBottom: 12 }}>
                <div className="section-title">פרופיל התקדמות לפי מתאמן</div>
              </div>
              <div className="grid-2" style={{ gap: 12, alignItems: 'flex-start' }}>
                <div>
                  {studentsWithTests.slice(0, Math.ceil(studentsWithTests.length / 2)).map(s => (
                    <StudentLevelCard key={s.id} student={s} tests={tests} groups={groups} onEdit={setFormTest} onDelete={handleDelete} canEditTest={canEditTest} />
                  ))}
                </div>
                <div>
                  {studentsWithTests.slice(Math.ceil(studentsWithTests.length / 2)).map(s => (
                    <StudentLevelCard key={s.id} student={s} tests={tests} groups={groups} onEdit={setFormTest} onDelete={handleDelete} canEditTest={canEditTest} />
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {activeTab === 'leaderboard' && (
        <div className="card">
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Medal style={{ color: 'var(--amber)' }} size={18} />
            <div className="section-title" style={{ fontSize: 14 }}>דירוג חברי נבחרות קיר הטיפוס</div>
          </div>
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th style={{ width: 60, textAlign: 'center' }}>מיקום</th>
                  <th>שם המטפס</th>
                  <th>נבחרת</th>
                  <th style={{ textAlign: 'center' }}>רמה הגבוהה ביותר</th>
                  <th style={{ textAlign: 'center' }}>סך מבחנים שבוצעו</th>
                  <th style={{ textAlign: 'center' }}>גביעי טקס</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>
                      לא נמצאו מטפסים רשומים בקבוצות נבחרת במערכת.
                    </td>
                  </tr>
                ) : (
                  leaderboard.map((member, idx) => {
                    const isTop3 = idx < 3;
                    const medalEmoji = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '';
                    return (
                      <tr key={member.id}>
                        <td style={{ textAlign: 'center', fontWeight: 'bold', fontSize: isTop3 ? 16 : 13 }}>
                          {medalEmoji || idx + 1}
                        </td>
                        <td style={{ fontWeight: 700 }}>{member.name}</td>
                        <td style={{ color: 'var(--text-2)' }}>{member.groupName}</td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{
                            fontWeight: 900, fontSize: 17,
                            color: LEVEL_COLOR[member.maxGrade],
                            background: `${LEVEL_COLOR[member.maxGrade]}18`,
                            padding: '2px 8px', borderRadius: 6,
                            border: `1px solid ${LEVEL_COLOR[member.maxGrade]}33`
                          }}>{member.maxGrade}</span>
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 600 }}>{member.testCount}</td>
                        <td style={{ textAlign: 'center', fontSize: 16 }}>
                          {member.trophiesCount > 0 ? (
                            <span title={`${member.trophiesCount} גביעים`}>
                              🏆{' '}<span style={{ fontSize: 11, fontWeight: 700 }}>x{member.trophiesCount}</span>
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
