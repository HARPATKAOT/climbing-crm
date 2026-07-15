import React, { useState, useEffect, useMemo } from 'react';
import {
  CheckCircle2, AlertTriangle, Clock, User, Plus, Trash2,
  X, Calendar, ChevronLeft, ChevronRight, AlertCircle, RefreshCw, FileText, Check, ListFilter, ShieldAlert
} from 'lucide-react';
import { Modal } from './UI.jsx';

const HEB_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const FREQUENCIES = ['יומי', 'שבועי', 'חודשי', 'שנתי'];

const FREQ_DAYS = {
  'יומי': 1,
  'שבועי': 7,
  'חודשי': 30,
  'שנתי': 365
};

function getDayOfWeek(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';
  return HEB_DAYS[date.getDay()];
}

function getDaysSincePerformed(lastDateStr) {
  if (!lastDateStr) return Infinity;
  const today = new Date();
  const last = new Date(lastDateStr);
  const diffTime = today - last;
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

function checkIsOverdue(frequency, lastDateStr) {
  const daysSince = getDaysSincePerformed(lastDateStr);
  const allowed = FREQ_DAYS[frequency] || 7;
  return daysSince >= allowed;
}

// ─── Modal: Log Inspection (Checklist submission) ───────────────────────
function LogInspectionModal({ type, employees, onSave, onClose }) {
  const [testerId, setTesterId]   = useState(employees[0]?.id || '');
  const [status, setStatus]       = useState('תקין');
  const [notes, setNotes]           = useState('');
  const [date, setDate]             = useState(new Date().toISOString().split('T')[0]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!testerId) {
      alert('נא לבחור את שם הבודק');
      return;
    }
    const testerName = employees.find(emp => emp.id === testerId)?.name || 'מאמן';
    onSave({
      title: type.name,
      inspection_type: type.frequency === 'יומי' ? 'daily' : 'weekly',
      description: notes.trim() || 'בדיקת תקינות',
      completed_by_employee_id: testerId,
      testerName: testerName,
      date,
      status
    });
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal slide-up" style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">✍️ חתימה על בדיקת בטיחות</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
              בדיקה: {type.name} · תדירות נדרשת: {type.frequency}
            </div>
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <form id="log-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">תאריך ביצוע *</label>
                <input className="input" type="date" required value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">שם המדריך החותם *</label>
                <select className="input select" value={testerId} onChange={e => setTesterId(e.target.value)}>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">סטטוס בדיקה *</label>
              <div style={{ display: 'flex', gap: 10 }}>
                {['תקין', 'נמצאו ליקויים'].map(s => (
                  <button
                    key={s} type="button" className={`btn ${status === s ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ flex: 1 }} onClick={() => setStatus(s)}
                  >
                    {s === 'תקין' ? '✓ תקין' : '⚠️ נמצאו ליקויים'}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">הערות, ממצאים ופעולות מתקנות *</label>
              <textarea className="input textarea" rows={3} required value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="פרט מה נבדק ומה הממצאים..." />
            </div>
          </form>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>ביטול</button>
          <button form="log-form" type="submit" className="btn btn-primary">
            💾 שמור חתימה ועדכן תאריך
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Add Safety Incident ──────────────────────────────────────────
function AddIncidentModal({ employees, onSave, onClose }) {
  const [climberName, setClimberName]           = useState('');
  const [gearUsed, setGearUsed]                 = useState('autobelay');
  const [description, setDescription]           = useState('');
  const [injuryDescription, setInjuryDetails]   = useState('');
  const [actionTaken, setActionTaken]           = useState('');
  const [employeeId, setEmployeeId]             = useState(employees[0]?.id || '');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!climberName.trim() || !description.trim()) return;
    
    onSave({
      climber_name: climberName.trim(),
      gear_used: gearUsed,
      description: description.trim(),
      injury_description: injuryDescription.trim(),
      action_taken: actionTaken.trim(),
      employee_id: employeeId
    });
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal slide-up" style={{ maxWidth: 500 }}>
        <div className="modal-header">
          <div className="modal-title">⚠️ דיווח פציעה / אירוע בטיחות</div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <form id="incident-form" onSubmit={handleSubmit} className="form-grid">
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">שם המטפס המעורב *</label>
                <input className="input" placeholder="שם מלא של המטפס" required value={climberName} onChange={e => setClimberName(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">ציוד/מכשיר בשימוש *</label>
                <select className="input select" value={gearUsed} onChange={e => setGearUsed(e.target.value)}>
                  <option value="autobelay">אבטחה אוטומטית (Autobelay)</option>
                  <option value="toprope">טופ רופ (Top-Rope)</option>
                  <option value="lead">חבל הובלה (Lead)</option>
                  <option value="boulder">בולדרינג (Mat/Boulder)</option>
                  <option value="other">אחר / ללא ציוד</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">תיאור המקרה *</label>
              <textarea className="input textarea" rows={3} placeholder="תיאור מפורט של השתלשלות האירועים..." required value={description} onChange={e => setDescription(e.target.value)} />
            </div>

            <div className="form-group">
              <label className="form-label">פירוט הפגיעה / פציעה (במידה ויש)</label>
              <textarea className="input textarea" rows={2} placeholder="למשל: נקע בקרסול ימין..." value={injuryDescription} onChange={e => setInjuryDetails(e.target.value)} />
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">טיפול שניתן בשטח *</label>
                <input className="input" placeholder="למשל: עזרה ראשונה / קרח / פינוי מד״א" required value={actionTaken} onChange={e => setActionTaken(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">מדריך אחראי מדווח *</label>
                <select className="input select" value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
            </div>
          </form>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>ביטול</button>
          <button form="incident-form" type="submit" className="btn btn-primary">
            💾 שמור דוח פציעה
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Safety Component ───────────────────────────────────────────────────
export default function Safety() {
  const [types, setTypes] = useState([
    { id: 't-1', name: 'בדיקת רתמות', frequency: 'שבועי', description: 'בדיקת תפרים, אבזמים ובלאי של כל רתמות הקיר', lastPerformed: '2026-07-06' },
    { id: 't-2', name: 'בדיקת עוגני טופ רופ ורד בלוק', frequency: 'שבועי', description: 'בדיקת טבעות עליונות, שאקלים וחיבורי רד בלוק', lastPerformed: '2026-07-07' },
    { id: 't-6', name: 'בדיקת מפגעים במתחם', frequency: 'יומי', description: 'בדיקת ברגים בולטים, ניקיון המזרנים ומכשולים ברצפה', lastPerformed: '2026-07-08' }
  ]);

  const [logs, setLogs]             = useState([]);
  const [incidents, setIncidents]   = useState([]);
  const [employees, setEmployees]   = useState([]);

  const [activeTab, setActiveTab]         = useState('types'); // types | missed | history | incidents
  const [selectedType, setSelectedType]   = useState(null);
  const [showLogForm, setShowLogForm]     = useState(false);
  const [showIncidentForm, setShowIncidentForm] = useState(false);

  const refreshData = async () => {
    try {
      const isps = await fetch('/api/safety/inspections').then(r => r.json());
      const incs = await fetch('/api/safety/incidents').then(r => r.json());
      const emps = await fetch('/api/employees').then(r => r.json());
      
      setLogs(isps);
      setIncidents(incs);
      setEmployees(emps);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    refreshData();
  }, []);

  const missedTypes = useMemo(() => {
    return types.filter(t => checkIsOverdue(t.frequency, t.lastPerformed));
  }, [types]);

  const handleSaveLog = async (newLog) => {
    try {
      const response = await fetch('/api/safety/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newLog)
      });
      if (response.ok) {
        // Update local timestamps
        setTypes(prev => prev.map(t => t.name === newLog.title ? { ...t, lastPerformed: newLog.date } : t));
        refreshData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveIncident = async (newIncident) => {
    try {
      const response = await fetch('/api/safety/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newIncident)
      });
      if (response.ok) {
        refreshData();
        alert('דוח פציעה נרשם במאגר הבטיחות!');
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="fade-in">
      {/* Modals */}
      {showLogForm && selectedType && (
        <LogInspectionModal
          type={selectedType}
          employees={employees}
          onSave={handleSaveLog}
          onClose={() => { setShowLogForm(false); setSelectedType(null); }}
        />
      )}

      {showIncidentForm && (
        <AddIncidentModal
          employees={employees}
          onSave={handleSaveIncident}
          onClose={() => setShowIncidentForm(false)}
        />
      )}

      {/* Stats Headers */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="card stat-card" style={{ '--stat-color': '#EF4444' }} onClick={() => setActiveTab('missed')}>
          <div className="stat-icon" style={{ cursor: 'pointer' }}><AlertTriangle size={18} /></div>
          <div className="stat-label">בדיקות שפוספסו / פג תוקף</div>
          <div className="stat-value">{missedTypes.length}</div>
          <div className="stat-sub warn">דורש ביצוע מיידי</div>
        </div>
        <div className="card stat-card" style={{ '--stat-color': '#10B981' }} onClick={() => setActiveTab('history')}>
          <div className="stat-icon" style={{ cursor: 'pointer' }}><CheckCircle2 size={18} /></div>
          <div className="stat-label">סה"כ חתימות ביצוע</div>
          <div className="stat-value">{logs.length}</div>
          <div className="stat-sub">ארכיון דוחות</div>
        </div>
        <div className="card stat-card" style={{ '--stat-color': '#EC4899' }} onClick={() => setActiveTab('incidents')}>
          <div className="stat-icon" style={{ cursor: 'pointer' }}><ShieldAlert size={18} /></div>
          <div className="stat-label">דוחות פציעות ואירועים</div>
          <div className="stat-value">{incidents.length}</div>
          <div className="stat-sub">רשומות במאגר</div>
        </div>
      </div>

      {/* Toolbar Header */}
      <div className="section-header" style={{ marginBottom: 20 }}>
        <div>
          <div className="section-title">בקרת בטיחות וניהול סיכונים</div>
          <div className="section-sub">יומן בדיקות מתקנים יומיות/שבועיות לצד פנקס פציעות ותקלות בטיחות</div>
        </div>
        <button className="btn btn-danger btn-sm" onClick={() => setShowIncidentForm(true)}>
          <ShieldAlert size={14} /> דיווח פציעה/אירוע
        </button>
      </div>

      {/* Tabs Navigation */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 1 }}>
        <button
          className={`btn btn-sm ${activeTab === 'types' ? 'btn-primary' : 'btn-ghost'}`}
          style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottom: activeTab === 'types' ? '2px solid var(--blue)' : 'none' }}
          onClick={() => setActiveTab('types')}
        >
          📋 תדירויות בדיקת מתקנים ({types.length})
        </button>
        <button
          className={`btn btn-sm ${activeTab === 'missed' ? 'btn-primary' : 'btn-ghost'}`}
          style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottom: activeTab === 'missed' ? '2px solid var(--blue)' : 'none' }}
          onClick={() => setActiveTab('missed')}
        >
          ⚠️ בדיקות שפוספסו ({missedTypes.length})
        </button>
        <button
          className={`btn btn-sm ${activeTab === 'history' ? 'btn-primary' : 'btn-ghost'}`}
          style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottom: activeTab === 'history' ? '2px solid var(--blue)' : 'none' }}
          onClick={() => setActiveTab('history')}
        >
          📜 ארכיון חתימות בטיחות ({logs.length})
        </button>
        <button
          className={`btn btn-sm ${activeTab === 'incidents' ? 'btn-primary' : 'btn-ghost'}`}
          style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottom: activeTab === 'incidents' ? '2px solid var(--blue)' : 'none' }}
          onClick={() => setActiveTab('incidents')}
        >
          ⚠️ פנקס פציעות ואירועים ({incidents.length})
        </button>
      </div>

      {/* Tab 1: Inspection Types */}
      {activeTab === 'types' && (
        <div className="card">
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>שם הבדיקה</th>
                  <th>תדירות</th>
                  <th>הנחיות לביצוע</th>
                  <th>בוצעה לאחרונה</th>
                  <th>סטטוס תפעולי</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {types.map(t => {
                  const overdue = checkIsOverdue(t.frequency, t.lastPerformed);
                  const daysSince = getDaysSincePerformed(t.lastPerformed);

                  return (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 700 }}>{t.name}</td>
                      <td><span className="badge badge-blue">{t.frequency}</span></td>
                      <td style={{ fontSize: 12, color: 'var(--text-2)', maxWidth: 280 }}>
                        {t.description || '—'}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-3)' }}>
                        {t.lastPerformed ? `${t.lastPerformed} (${getDayOfWeek(t.lastPerformed)})` : 'אף פעם'}
                      </td>
                      <td>
                        {overdue ? (
                          <span className="badge badge-red" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <AlertTriangle size={10} /> פג תוקף
                          </span>
                        ) : (
                          <span className="badge badge-green" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Check size={10} /> תקין (לפני {daysSince} ימים)
                          </span>
                        )}
                      </td>
                      <td>
                        <button className="btn btn-primary btn-xs" onClick={() => { setSelectedType(t); setShowLogForm(true); }}>
                          ✍️ חתום
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Missed Overdue Checks */}
      {activeTab === 'missed' && (
        <div className="card">
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>סוג בדיקה שפוספס</th>
                  <th>תדירות נדרשת</th>
                  <th>בוצע לאחרונה</th>
                  <th>חתימה מהירה</th>
                </tr>
              </thead>
              <tbody>
                {missedTypes.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>
                      🎉 מעולה! כל בדיקות הבטיחות מעודכנות בזמן.
                    </td>
                  </tr>
                ) : (
                  missedTypes.map(t => (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 700 }}>{t.name}</td>
                      <td><span className="badge badge-blue">{t.frequency}</span></td>
                      <td style={{ color: 'var(--text-2)' }}>{t.lastPerformed || 'אף פעם'}</td>
                      <td>
                        <button className="btn btn-primary btn-xs" onClick={() => { setSelectedType(t); setShowLogForm(true); }}>
                          ✍️ חתום עכשיו
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Inspection History */}
      {activeTab === 'history' && (
        <div className="card">
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>תאריך ביצוע</th>
                  <th>שם הבדיקה</th>
                  <th>מדריך מאשר</th>
                  <th>תוצאה</th>
                  <th>פירוט בדיקה</th>
                </tr>
              </thead>
              <tbody>
                {logs
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map(log => {
                    const emp = employees.find(e => e.id === log.completed_by_employee_id);
                    return (
                      <tr key={log.id}>
                        <td style={{ fontWeight: 700 }}>{log.date}</td>
                        <td>{log.title}</td>
                        <td style={{ fontWeight: 600, color: 'var(--green)' }}>✍️ {log.testerName || emp?.name || 'מאמן'}</td>
                        <td>
                          <span className="badge badge-green">תקין</span>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-2)' }}>{log.description}</td>
                      </tr>
                    );
                  })}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>
                      אין חתימות מתועדות בארכיון.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Incidents Ledger */}
      {activeTab === 'incidents' && (
        <div className="card">
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>תאריך מקרה</th>
                  <th>מטפס מעורב</th>
                  <th>ציוד בשימוש</th>
                  <th>תיאור המקרה</th>
                  <th>פציעה שדווחה</th>
                  <th>טיפול שניתן</th>
                  <th>מדריך אחראי</th>
                </tr>
              </thead>
              <tbody>
                {incidents
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map(inc => {
                    const emp = employees.find(e => e.id === inc.employee_id);
                    
                    let gearLabel = 'אחר';
                    if (inc.gear_used === 'autobelay') gearLabel = 'אבטחה אוטומטית';
                    else if (inc.gear_used === 'toprope') gearLabel = 'טופ-רופ';
                    else if (inc.gear_used === 'lead') gearLabel = 'הובלה';
                    else if (inc.gear_used === 'boulder') gearLabel = 'בולדר/מזרן';

                    return (
                      <tr key={inc.id}>
                        <td style={{ fontWeight: 700 }}>{inc.date}</td>
                        <td style={{ fontWeight: 700, color: 'var(--text-1)' }}>{inc.climber_name}</td>
                        <td><span className="badge badge-gray">{gearLabel}</span></td>
                        <td style={{ fontSize: 12, color: 'var(--text-2)', maxWidth: 200 }} title={inc.description}>{inc.description}</td>
                        <td style={{ fontSize: 12, color: '#FCA5A5', fontWeight: 600 }}>{inc.injury_description || '—'}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-2)' }}>{inc.action_taken}</td>
                        <td style={{ fontWeight: 600 }}>{emp?.name || 'מאמן'}</td>
                      </tr>
                    );
                  })}
                {incidents.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>
                      🎉 מעולה! אין פציעות או תקלות בטיחות רשומות במאגר.
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
