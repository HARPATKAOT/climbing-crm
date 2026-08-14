import React, { useState, useEffect, useMemo } from 'react';
import {
  CheckCircle2, AlertTriangle, Plus, X, ShieldAlert, Check, Pencil, Trash2, History, ListChecks
} from 'lucide-react';
import EntityLink from '../utils/entityLinks.jsx';
import { CheckIcon } from './safetyCheckIcons.jsx';
import AppSelect from './AppSelect.jsx';
import EmployeeSelect from './EmployeeSelect.jsx';
import {
  canSignSafetyChecks,
  employeesFor,
  isActiveWallEmployee,
} from '../utils/operationalEmployees.js';

const HEB_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const FREQUENCIES = ['יומי', 'שבועי', 'דו שבועי', 'חודשי', 'דו חודשי', 'חצי שנתי', 'שנתי'];
const FREQ_DAYS = {
  יומי: 1,
  שבועי: 7,
  'דו שבועי': 14,
  חודשי: 30,
  'דו חודשי': 60,
  'חצי שנתי': 182,
  שנתי: 365,
};

function todayIso() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function getDayOfWeek(dateString) {
  if (!dateString) return '';
  const date = new Date(`${dateString}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return HEB_DAYS[date.getDay()];
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('he-IL', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function addDays(dateStr, days) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + Number(days || 0));
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

// ─── Modal: Sign check ───────────────────────────────────────────────────
function SignCheckModal({ check, employees, initialLog = null, onSave, onClose }) {
  // בדיקת בטיחות היא בדיקת בטיחות — מי שלא הוסמך לחתום עליה לא חותם גם על
  // בדיקה חודשית. עד היום הסינון חל רק על היומיות, ובשאר הופיעו כל העובדים.
  const eligible = employeesFor(employees, canSignSafetyChecks);
  const [testerId, setTesterId] = useState(initialLog?.completed_by_employee_id || eligible[0]?.id || '');
  const [status, setStatus] = useState(initialLog?.status || 'תקין');
  const [notes, setNotes] = useState(initialLog?.description || '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!testerId) {
      alert('נא לבחור את שם הבודק');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        check_type_id: check.id,
        title: check.name,
        completed_by_employee_id: testerId,
        status,
        description: notes.trim(),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal slide-up" style={{ maxWidth: 440 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CheckIcon name={check.name} size={18} />
            <div>
              <div className="modal-title">{initialLog ? 'עריכת בדיקת בטיחות' : 'אישור ביצוע בדיקה'}</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
                {check.name} · {check.frequency}
              </div>
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <form id="sign-check-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-group">
              <label className="form-label">שם הבודק *</label>
              <EmployeeSelect
                employees={eligible}
                value={testerId}
                placeholder="בחר עובד..."
                aria-label="שם הבודק"
                onChange={(emp) => setTesterId(emp?.id || '')}
              />
              {eligible.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--amber)', marginTop: 6 }}>
                  אין עובד שמורשה לחתום על בדיקות בטיחות — סמנו בתיק העובד.
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">תוצאה</label>
              <div style={{ display: 'flex', gap: 10 }}>
                {['תקין', 'נמצאו ליקויים'].map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`btn ${status === s ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ flex: 1 }}
                    onClick={() => setStatus(s)}
                  >
                    {s === 'תקין' ? '✓ תקין' : 'נמצאו ליקויים'}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">הערות (אופציונלי)</label>
              <textarea
                className="input textarea"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="ממצאים או הערות..."
              />
            </div>

            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
              התאריך והשעה יישמרו אוטומטית בעת האישור.
            </div>
          </form>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>ביטול</button>
          <button form="sign-check-form" type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'שומר...' : (initialLog ? 'שמור שינויים' : 'חתום')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Add / Edit check type ────────────────────────────────────────
function CheckTypeModal({ initial, onSave, onClose }) {
  const [name, setName] = useState(initial?.name || '');
  const [frequency, setFrequency] = useState(initial?.frequency || 'יומי');
  const [intervalDays, setIntervalDays] = useState(initial?.interval_days || FREQ_DAYS['יומי']);
  const [description, setDescription] = useState(initial?.description || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!initial) setIntervalDays(FREQ_DAYS[frequency] || 1);
  }, [frequency, initial]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        frequency,
        interval_days: Number(intervalDays) || FREQ_DAYS[frequency] || 1,
        description: description.trim(),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal slide-up" style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <div className="modal-title">{initial ? 'עריכת בדיקה' : 'בדיקה חדשה'}</div>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <form id="check-type-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-group">
              <label className="form-label">שם הבדיקה *</label>
              <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">תדירות *</label>
                <AppSelect
                  className="input select"
                  value={frequency}
                  onChange={(e) => {
                    const f = e.target.value;
                    setFrequency(f);
                    if (!initial) setIntervalDays(FREQ_DAYS[f] || 1);
                  }}
                >
                  {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
                </AppSelect>
              </div>
              <div className="form-group">
                <label className="form-label">ימים בין בדיקות *</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  required
                  value={intervalDays}
                  onChange={(e) => setIntervalDays(e.target.value)}
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">הנחיות לביצוע</label>
              <textarea className="input textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </form>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>ביטול</button>
          <button form="check-type-form" type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'שומר...' : 'שמור'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Add Safety Incident ──────────────────────────────────────────
function AddIncidentModal({ employees, onSave, onClose }) {
  const reporters = employeesFor(employees, isActiveWallEmployee);
  const [climberName, setClimberName] = useState('');
  const [gearUsed, setGearUsed] = useState('autobelay');
  const [description, setDescription] = useState('');
  const [injuryDescription, setInjuryDetails] = useState('');
  const [actionTaken, setActionTaken] = useState('');
  const [employeeId, setEmployeeId] = useState(reporters[0]?.id || '');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!climberName.trim() || !description.trim() || !employeeId) return;
    onSave({
      climber_name: climberName.trim(),
      gear_used: gearUsed,
      description: description.trim(),
      injury_description: injuryDescription.trim(),
      action_taken: actionTaken.trim(),
      employee_id: employeeId,
    });
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal slide-up" style={{ maxWidth: 500 }}>
        <div className="modal-header">
          <div className="modal-title">דיווח פציעה / אירוע בטיחות</div>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <form id="incident-form" onSubmit={handleSubmit} className="form-grid">
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">שם המטפס המעורב *</label>
                <input className="input" placeholder="שם מלא" required value={climberName} onChange={(e) => setClimberName(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">ציוד בשימוש *</label>
                <AppSelect className="input select" value={gearUsed} onChange={(e) => setGearUsed(e.target.value)}>
                  <option value="autobelay">אבטחה אוטומטית</option>
                  <option value="toprope">טופ רופ</option>
                  <option value="lead">חבל הובלה</option>
                  <option value="boulder">בולדרינג</option>
                  <option value="other">אחר</option>
                </AppSelect>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">תיאור המקרה *</label>
              <textarea className="input textarea" rows={3} required value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">פירוט פגיעה (אם יש)</label>
              <textarea className="input textarea" rows={2} value={injuryDescription} onChange={(e) => setInjuryDetails(e.target.value)} />
            </div>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">טיפול שניתן *</label>
                <input className="input" required value={actionTaken} onChange={(e) => setActionTaken(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">מדריך מדווח *</label>
                <EmployeeSelect
                  employees={reporters}
                  value={employeeId}
                  placeholder="בחר עובד..."
                  aria-label="מדריך מדווח"
                  onChange={(emp) => setEmployeeId(emp?.id || '')}
                />
                {reporters.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--amber)', marginTop: 6 }}>
                    אין עובד קיר פעיל שיכול לדווח על האירוע.
                  </div>
                )}
              </div>
            </div>
          </form>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>ביטול</button>
          <button form="incident-form" type="submit" className="btn btn-primary" disabled={!employeeId}>שמור דיווח</button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Check detail + its own log ───────────────────────────────────
function CheckDetailModal({ check, logs, employees, onSign, onEdit, onClose, canManageSettings = true }) {
  const interval = Number(check.interval_days) || FREQ_DAYS[check.frequency] || 1;
  const last = logs[0] || null;
  const nextDue = Object.prototype.hasOwnProperty.call(check, 'next_due')
    ? check.next_due
    : (last?.date ? addDays(last.date, interval) : todayIso());
  const isOverdue = typeof check.is_overdue === 'boolean'
    ? check.is_overdue
    : (!last?.date || String(nextDue || '') <= todayIso());
  const isDaily = check.frequency === 'יומי' || Number(check.interval_days) === 1;

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal slide-up" style={{ maxWidth: 720 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CheckIcon name={check.name} size={20} />
            <div>
              <div className="modal-title">{check.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
                יומן הבדיקות של הבדיקה הזאת
              </div>
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal-body">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <span className="badge badge-blue">{check.frequency}</span>
            {isDaily
              ? <span className="badge badge-gray">בימי פעילות הקיר</span>
              : <span className="badge badge-gray">כל {interval} ימים</span>}
            {isOverdue
              ? <span className="badge badge-red">ממתין לביצוע</span>
              : <span className="badge badge-green">בתוקף</span>}
            {check.skipped_closed && (
              <span className="badge badge-gray">היום הקיר סגור</span>
            )}
          </div>

          {check.description && (
            <div style={{
              padding: '10px 12px',
              borderRadius: 10,
              background: 'var(--bg-input)',
              border: '1px solid var(--border)',
              fontSize: 13,
              color: 'var(--text-2)',
              marginBottom: 14,
            }}>
              {check.description}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
            {[
              { label: 'סך חתימות', value: logs.length },
              { label: 'בוצעה לאחרונה', value: last?.date || 'אף פעם' },
              { label: 'מועד הבא', value: nextDue || '—' },
            ].map((box) => (
              <div
                key={box.label}
                style={{
                  flex: '1 1 150px',
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border)',
                }}
              >
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{box.label}</div>
                <div style={{ fontWeight: 700, marginTop: 4 }}>{box.value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <History size={16} />
            <span style={{ fontWeight: 700 }}>יומן ביצועים</span>
          </div>

          <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>תאריך ושעה</th>
                  <th>בודק</th>
                  <th>תוצאה</th>
                  <th>הערות</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {log.performed_at ? formatDateTime(log.performed_at) : log.date}
                    </td>
                    <td style={{ fontWeight: 600, color: 'var(--green)' }}>
                      {log.completed_by_employee_id ? (
                        <EntityLink kind="employee" id={log.completed_by_employee_id} title="מעבר לתיק העובד">
                          {log.tester_name || employees.find((e) => e.id === log.completed_by_employee_id)?.name || '—'}
                        </EntityLink>
                      ) : (log.tester_name || '—')}
                    </td>
                    <td>
                      <span className={`badge ${log.status === 'נמצאו ליקויים' ? 'badge-red' : 'badge-green'}`}>
                        {log.status || 'תקין'}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-2)' }}>{log.description || '—'}</td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: 30, color: 'var(--text-3)' }}>
                      הבדיקה הזאת עוד לא בוצעה.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>סגור</button>
          {canManageSettings && <button type="button" className="btn btn-ghost" onClick={() => onEdit(check)}>
            <Pencil size={14} /> עריכת הגדרות
          </button>}
          <button type="button" className="btn btn-primary" onClick={() => onSign(check)}>
            חתום
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Safety Component ───────────────────────────────────────────────
export default function Safety({ canManageSettings = true }) {
  const [types, setTypes] = useState([]);
  const [dueToday, setDueToday] = useState([]);
  const [logs, setLogs] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [activeTab, setActiveTab] = useState('today');
  const [historyFilter, setHistoryFilter] = useState('');
  const [selectedCheck, setSelectedCheck] = useState(null);
  const [showSignForm, setShowSignForm] = useState(false);
  const [showTypeForm, setShowTypeForm] = useState(false);
  const [editingType, setEditingType] = useState(null);
  const [showIncidentForm, setShowIncidentForm] = useState(false);
  const [detailCheck, setDetailCheck] = useState(null);
  const [editingLog, setEditingLog] = useState(null);

  const refreshData = async () => {
    try {
      const [typeList, due, isps, incs, emps] = await Promise.all([
        fetch('/api/safety/check-types').then((r) => (r.ok ? r.json() : [])),
        fetch('/api/safety/due-today').then((r) => (r.ok ? r.json() : [])),
        fetch('/api/safety/inspections').then((r) => (r.ok ? r.json() : [])),
        fetch('/api/safety/incidents').then((r) => (r.ok ? r.json() : [])),
        fetch(canManageSettings ? '/api/employees' : '/api/trainers').then((r) => (r.ok ? r.json() : [])),
      ]);
      setTypes(Array.isArray(typeList) ? typeList : []);
      setDueToday(Array.isArray(due) ? due : []);
      setLogs(Array.isArray(isps) ? isps : []);
      setIncidents(Array.isArray(incs) ? incs : []);
      setEmployees(Array.isArray(emps) ? emps : []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    refreshData();
  }, []);

  const lastByType = useMemo(() => {
    const map = {};
    for (const log of logs) {
      const key = log.check_type_id || log.title;
      if (!key) continue;
      if (!map[key] || String(log.performed_at || log.date) > String(map[key].performed_at || map[key].date)) {
        map[key] = log;
      }
    }
    return map;
  }, [logs]);

  const overdueCount = useMemo(() => dueToday.filter((c) => c.is_due && !c.signed_today).length, [dueToday]);

  const filteredLogs = useMemo(() => {
    let list = [...logs];
    if (historyFilter) {
      list = list.filter((l) => l.check_type_id === historyFilter || l.title === types.find((t) => t.id === historyFilter)?.name);
    }
    return list.sort((a, b) => String(b.performed_at || b.date || '').localeCompare(String(a.performed_at || a.date || '')));
  }, [logs, historyFilter, types]);

  const logsForCheck = (check) => {
    if (!check) return [];
    return logs
      .filter((l) => l.check_type_id === check.id || (!l.check_type_id && l.title === check.name))
      .sort((a, b) => String(b.performed_at || b.date || '').localeCompare(String(a.performed_at || a.date || '')));
  };

  const openSign = (check) => {
    setDetailCheck(null);
    setEditingLog(null);
    setSelectedCheck(check);
    setShowSignForm(true);
  };

  const handleSign = async (payload) => {
    const response = await fetch(editingLog ? `/api/safety/inspections/${editingLog.id}` : '/api/safety/inspections', {
      method: editingLog ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const msg = err.error || `שגיאה בשמירת הבדיקה (${response.status})`;
      alert(msg);
      throw new Error(msg);
    }
    setEditingLog(null);
    await refreshData();
  };

  const openEditLog = (log) => {
    const check = types.find((type) => type.id === log.check_type_id || type.name === log.title) || {
      id: log.check_type_id,
      name: log.title,
      frequency: '',
    };
    setSelectedCheck(check);
    setEditingLog(log);
    setShowSignForm(true);
  };

  const handleSaveType = async (payload) => {
    const isEdit = Boolean(editingType?.id);
    const response = await fetch(
      isEdit ? `/api/safety/check-types/${editingType.id}` : '/api/safety/check-types',
      {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      alert(err.error || 'שגיאה בשמירה');
      throw new Error(err.error || 'save failed');
    }
    setEditingType(null);
    if (!isEdit) setActiveTab('types');
    await refreshData();
  };

  const handleDeleteType = async (type) => {
    if (!confirm(`להסיר את הבדיקה "${type.name}"?`)) return;
    await fetch(`/api/safety/check-types/${type.id}`, { method: 'DELETE' });
    await refreshData();
  };

  const handleSaveIncident = async (newIncident) => {
    const response = await fetch('/api/safety/incidents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newIncident),
    });
    if (response.ok) {
      await refreshData();
      alert('דוח הפציעה נרשם');
    }
  };

  const checkNameCell = (check) => (
    <button
      type="button"
      onClick={() => setDetailCheck(check)}
      title="פתיחת יומן הבדיקה"
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        font: 'inherit',
        fontWeight: 700,
        color: 'var(--text-1)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        textAlign: 'right',
      }}
    >
      <CheckIcon name={check.name} size={15} />
      <span style={{ textDecoration: 'underline', textUnderlineOffset: 3, textDecorationColor: 'var(--border)' }}>
        {check.name}
      </span>
    </button>
  );

  const statusBadge = (type) => {
    // Prefer server-computed status (daily checks use operating days, not calendar days).
    if (type.is_overdue === true || (type.is_due && !type.signed_today)) {
      return (
        <span className="badge badge-red" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <AlertTriangle size={10} /> פג תוקף
        </span>
      );
    }
    if (type.is_overdue === false || type.signed_today) {
      return (
        <span className="badge badge-green" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Check size={10} /> תקין
        </span>
      );
    }
    // Fallback if status fields are missing (older responses).
    const last = lastByType[type.id] || lastByType[type.name];
    const lastDate = last?.date;
    const interval = Number(type.interval_days) || FREQ_DAYS[type.frequency] || 1;
    if (!lastDate) {
      return <span className="badge badge-red">טרם בוצעה</span>;
    }
    const daysSince = Math.floor((new Date(`${todayIso()}T12:00:00`) - new Date(`${lastDate}T12:00:00`)) / 86400000);
    if (daysSince >= interval) {
      return (
        <span className="badge badge-red" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <AlertTriangle size={10} /> פג תוקף
        </span>
      );
    }
    return (
      <span className="badge badge-green" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Check size={10} /> תקין
      </span>
    );
  };

  return (
    <div className="fade-in">
      {showSignForm && selectedCheck && (
        <SignCheckModal
          check={selectedCheck}
          employees={employees}
          initialLog={editingLog}
          onSave={handleSign}
          onClose={() => { setShowSignForm(false); setSelectedCheck(null); setEditingLog(null); }}
        />
      )}

      {showTypeForm && (
        <CheckTypeModal
          initial={editingType}
          onSave={handleSaveType}
          onClose={() => { setShowTypeForm(false); setEditingType(null); }}
        />
      )}

      {showIncidentForm && (
        <AddIncidentModal
          employees={employees}
          onSave={handleSaveIncident}
          onClose={() => setShowIncidentForm(false)}
        />
      )}

      {detailCheck && (
        <CheckDetailModal
          check={detailCheck}
          logs={logsForCheck(detailCheck)}
          employees={employees}
          onSign={openSign}
          onEdit={(check) => {
            const full = types.find((t) => t.id === check.id) || check;
            setDetailCheck(null);
            setEditingType(full);
            setShowTypeForm(true);
          }}
          onClose={() => setDetailCheck(null)}
          canManageSettings={canManageSettings}
        />
      )}

      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="card stat-card" style={{ '--stat-color': '#EF4444' }} onClick={() => setActiveTab('today')}>
          <div className="stat-icon" style={{ cursor: 'pointer' }}><AlertTriangle size={18} /></div>
          <div className="stat-label">ממתינות להיום</div>
          <div className="stat-value">{overdueCount}</div>
          <div className="stat-sub warn">דורש ביצוע</div>
        </div>
        <div className="card stat-card" style={{ '--stat-color': '#10B981' }} onClick={() => setActiveTab('history')}>
          <div className="stat-icon" style={{ cursor: 'pointer' }}><CheckCircle2 size={18} /></div>
          <div className="stat-label">חתימות ביומן</div>
          <div className="stat-value">{logs.length}</div>
          <div className="stat-sub">ארכיון ביצועים</div>
        </div>
        <div className="card stat-card" style={{ '--stat-color': '#EC4899' }} onClick={() => setActiveTab('incidents')}>
          <div className="stat-icon" style={{ cursor: 'pointer' }}><ShieldAlert size={18} /></div>
          <div className="stat-label">דיווחי אירועים</div>
          <div className="stat-value">{incidents.length}</div>
          <div className="stat-sub">פנקס פציעות</div>
        </div>
      </div>

      <div className="section-header" style={{ marginBottom: 20 }}>
        <div>
          <div className="section-title">בדיקות בטיחות</div>
          <div className="section-sub">הגדרת תדירויות, חתימה על ביצוע, ומעקב היסטוריה</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canManageSettings && <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => { setEditingType(null); setShowTypeForm(true); }}
          >
            <Plus size={14} /> בדיקה חדשה
          </button>}
          <button type="button" className="btn btn-danger btn-sm" onClick={() => setShowIncidentForm(true)}>
            <ShieldAlert size={14} /> דיווח אירוע
          </button>
        </div>
      </div>

      <div className="tab-bar">
        {[
          { key: 'today', label: `בדיקות להיום (${dueToday.length})`, icon: CheckCircle2 },
          { key: 'types', label: `כל הבדיקות (${types.length})`, icon: ListChecks },
          { key: 'history', label: `היסטוריה (${logs.length})`, icon: History },
          { key: 'incidents', label: `פנקס אירועים (${incidents.length})`, icon: ShieldAlert },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            className={`tab-pill ${activeTab === key ? 'active' : ''}`}
            onClick={() => setActiveTab(key)}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {activeTab === 'today' && (
        <div className="card">
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>בדיקה</th>
                  <th>תדירות</th>
                  <th>סטטוס</th>
                  <th>בוצעה לאחרונה</th>
                  <th>פעולה</th>
                </tr>
              </thead>
              <tbody>
                {dueToday.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>
                      אין בדיקות שמגיעות היום — הכל מעודכן.
                    </td>
                  </tr>
                ) : (
                  dueToday.map((c) => (
                    <tr key={c.id}>
                      <td>{checkNameCell(c)}</td>
                      <td><span className="badge badge-blue">{c.frequency}</span></td>
                      <td>
                        {c.signed_today ? (
                          <span className="badge badge-green">נחתם היום · {c.today_log?.tester_name || c.last_tester_name}</span>
                        ) : (
                          <span className="badge badge-red">ממתין לביצוע</span>
                        )}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-3)' }}>
                        {c.signed_today && c.today_log?.performed_at
                          ? formatDateTime(c.today_log.performed_at)
                          : c.last_performed
                            ? `${c.last_performed} (${getDayOfWeek(c.last_performed)})`
                            : 'אף פעם'}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          {c.signed_today ? (
                            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                              {formatTime(c.today_log?.performed_at)}
                            </span>
                          ) : (
                            <button type="button" className="btn btn-primary btn-xs" onClick={() => openSign(c)}>
                              חתום
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            title="יומן הבדיקה"
                            onClick={() => setDetailCheck(c)}
                          >
                            <History size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'types' && (
        <div className="card">
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>שם הבדיקה</th>
                  <th>תדירות</th>
                  <th>ימים בין בדיקות</th>
                  <th>הנחיות</th>
                  <th>בוצעה לאחרונה</th>
                  <th>סטטוס</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {types.map((t) => {
                  const last = lastByType[t.id] || lastByType[t.name];
                  return (
                    <tr key={t.id}>
                      <td>{checkNameCell(t)}</td>
                      <td><span className="badge badge-blue">{t.frequency}</span></td>
                      <td>{t.frequency === 'יומי' ? 'בימי פעילות' : t.interval_days}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-2)', maxWidth: 240 }}>
                        {t.description || '—'}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-3)' }}>
                        {t.last_performed
                          ? `${t.last_performed}${t.last_tester_name ? ` · ${t.last_tester_name}` : ''}`
                          : (last?.date
                            ? `${last.date}${last.tester_name ? ` · ${last.tester_name}` : ''}`
                            : 'אף פעם')}
                      </td>
                      <td>{statusBadge(t)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'nowrap' }}>
                          <button
                            type="button"
                            className="btn btn-primary btn-xs"
                            style={{ whiteSpace: 'nowrap' }}
                            title="חתימה שהבדיקה בוצעה"
                            onClick={() => openSign(t)}
                          >
                            חתום
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            title="יומן הבדיקה"
                            onClick={() => setDetailCheck(t)}
                          >
                            <History size={12} />
                          </button>
                          {canManageSettings && <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            title="עריכת הבדיקה"
                            onClick={() => { setEditingType(t); setShowTypeForm(true); }}
                          >
                            <Pencil size={12} />
                          </button>}
                          {canManageSettings && <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            title="מחיקת הבדיקה"
                            onClick={() => handleDeleteType(t)}
                          >
                            <Trash2 size={12} />
                          </button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {types.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>
                      <div style={{ marginBottom: 12 }}>אין בדיקות מוגדרות.</div>
                      {canManageSettings && <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => { setEditingType(null); setShowTypeForm(true); }}
                      >
                        <Plus size={14} /> הוספת בדיקה
                      </button>}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="card">
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <AppSelect
              className="input select"
              style={{ maxWidth: 280 }}
              value={historyFilter}
              onChange={(e) => setHistoryFilter(e.target.value)}
            >
              <option value="">כל הבדיקות</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </AppSelect>
          </div>
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>תאריך ושעה</th>
                  <th>שם הבדיקה</th>
                  <th>בודק</th>
                  <th>תוצאה</th>
                  <th>הערות</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => (
                  <tr key={log.id}>
                    <td style={{ fontWeight: 700 }}>{formatDateTime(log.performed_at) || log.date}</td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <CheckIcon name={log.title} size={14} />
                        {log.title}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600, color: 'var(--green)' }}>
                      {log.completed_by_employee_id ? (
                        <EntityLink kind="employee" id={log.completed_by_employee_id} title="מעבר לתיק העובד">
                          {log.tester_name || employees.find((e) => e.id === log.completed_by_employee_id)?.name || '—'}
                        </EntityLink>
                      ) : (log.tester_name || '—')}
                    </td>
                    <td>
                      <span className={`badge ${log.status === 'נמצאו ליקויים' ? 'badge-red' : 'badge-green'}`}>
                        {log.status || 'תקין'}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-2)' }}>{log.description || '—'}</td>
                    <td><button type="button" className="btn btn-ghost btn-xs" title="עריכת בדיקה" onClick={() => openEditLog(log)}><Pencil size={12} /></button></td>
                  </tr>
                ))}
                {filteredLogs.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>
                      אין חתימות ביומן.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'incidents' && (
        <div className="card">
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>תאריך</th>
                  <th>מטפס</th>
                  <th>ציוד</th>
                  <th>תיאור</th>
                  <th>פציעה</th>
                  <th>טיפול</th>
                  <th>מדריך</th>
                </tr>
              </thead>
              <tbody>
                {[...incidents].sort((a, b) => String(b.date).localeCompare(String(a.date))).map((inc) => {
                  const emp = employees.find((e) => e.id === inc.employee_id);
                  let gearLabel = 'אחר';
                  if (inc.gear_used === 'autobelay') gearLabel = 'אבטחה אוטומטית';
                  else if (inc.gear_used === 'toprope') gearLabel = 'טופ רופ';
                  else if (inc.gear_used === 'lead') gearLabel = 'הובלה';
                  else if (inc.gear_used === 'boulder') gearLabel = 'בולדר';

                  return (
                    <tr key={inc.id}>
                      <td style={{ fontWeight: 700 }}>{inc.date}</td>
                      <td style={{ fontWeight: 700 }}>{inc.climber_name}</td>
                      <td><span className="badge badge-gray">{gearLabel}</span></td>
                      <td style={{ fontSize: 12, color: 'var(--text-2)', maxWidth: 200 }}>{inc.description}</td>
                      <td style={{ fontSize: 12, color: '#FCA5A5', fontWeight: 600 }}>{inc.injury_description || '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-2)' }}>{inc.action_taken}</td>
                      <td style={{ fontWeight: 600 }}>
                        {emp ? (
                          <EntityLink kind="employee" id={emp.id} title="מעבר לתיק העובד">{emp.name}</EntityLink>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
                {incidents.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>
                      אין דיווחי אירועים.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
