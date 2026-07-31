import React, { useState, useEffect } from 'react';
import { Settings, Plus, Trash2, Edit2, Play, Save, X, ToggleLeft, ToggleRight } from 'lucide-react';

const TRIGGER_EVENTS = [
  { value: 'new_lead', label: 'ליד חדש נוצר במערכת' },
  { value: 'status_changed', label: 'סטטוס של ליד התעדכן' },
  { value: 'intro_reminder_day_of', label: 'תזכורת ביום אימון הכירות (אוטומטי בבוקר)' },
  { value: 'intro_followup_day_after', label: 'בדיקה יום אחרי אימון הכירות (אוטומטי)' },
];

const STATUS_CONDITIONS = [
  { value: 'lead_new', label: 'ליד חדש (התקבל)' },
  { value: 'health_signed', label: 'חתם על הצהרת בריאות' },
  { value: 'intro_scheduled', label: 'קבע אימון הכירות' },
  { value: 'registered', label: 'נרשם' },
  { value: 'archive', label: 'ארכיון' },
];

const ACTION_TYPES = [
  { value: 'send_whatsapp', label: 'שלח הודעת וואטסאפ (אוטומטי)' },
];

const SCHEDULED_TRIGGERS = new Set([
  'intro_reminder_day_of',
  'intro_followup_day_after',
]);

const DEFAULT_MESSAGES = {
  intro_reminder_day_of:
    'שלום {{parentName}}, תזכורת לאימון ההיכרות של {{name}} היום בשעה {{time}}.\n' +
    'המדריך/ה: {{trainer}}.\n' +
    'הגעה: {{arrival}}.\n' +
    'נתראה על הקיר! 🧗',
  intro_followup_day_after:
    'שלום {{parentName}}, מקווים שאימון ההיכרות של {{name}} היה כיף!\n' +
    'נשמח לשמוע איך היה, ואם תרצו להירשם לחוג — אנחנו כאן 🙂',
};

const DEFAULT_VAR_KEYS = {
  intro_reminder_day_of: 'name,time,trainer,arrival',
  intro_followup_day_after: 'name',
};

function parseVarKeys(text) {
  return String(text || '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function AutomationModal({ automation, onSave, onClose }) {
  const isEdit = !!automation;
  const [name, setName] = useState(automation?.name || '');
  const [triggerEvent, setTriggerEvent] = useState(automation?.trigger_event || 'new_lead');
  const [triggerCondition, setTriggerCondition] = useState(automation?.trigger_condition || '');
  const [actionType, setActionType] = useState(automation?.action_type || 'send_whatsapp');
  const [message, setMessage] = useState(automation?.action_payload?.message || '');
  const [templateName, setTemplateName] = useState(automation?.action_payload?.templateName || '');
  const [preferTemplate, setPreferTemplate] = useState(!!automation?.action_payload?.preferTemplate);
  const [templateVarKeys, setTemplateVarKeys] = useState(
    Array.isArray(automation?.action_payload?.templateVarKeys)
      ? automation.action_payload.templateVarKeys.join(',')
      : ''
  );
  const [arrivalText, setArrivalText] = useState(
    automation?.action_payload?.arrivalText || 'רחוב האורגים 12, אשדוד. יש חניה בחזית.'
  );
  const [templates, setTemplates] = useState([]);
  const [isActive, setIsActive] = useState(automation?.is_active ?? true);

  useEffect(() => {
    fetch('/api/message-templates?approved=1')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setTemplates(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  const handleTriggerChange = (value) => {
    setTriggerEvent(value);
    if (!isEdit && DEFAULT_MESSAGES[value] && !message.trim()) {
      setMessage(DEFAULT_MESSAGES[value]);
    }
    if (!isEdit && DEFAULT_VAR_KEYS[value] && !templateVarKeys.trim()) {
      setTemplateVarKeys(DEFAULT_VAR_KEYS[value]);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    onSave({
      id: automation?.id,
      name,
      trigger_event: triggerEvent,
      trigger_condition: triggerEvent === 'status_changed' ? triggerCondition : null,
      action_type: actionType,
      action_payload: {
        message,
        templateName: templateName || null,
        preferTemplate: !!preferTemplate,
        templateVarKeys: parseVarKeys(templateVarKeys),
        arrivalText: arrivalText || null,
      },
      is_active: isActive,
    });
    onClose();
  };

  const isScheduled = SCHEDULED_TRIGGERS.has(triggerEvent);

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal slide-up" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div className="modal-title">{isEdit ? 'ערוך אוטומציה' : 'יצירת אוטומציה חדשה'}</div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <form id="automation-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-group">
              <label className="form-label">שם האוטומציה</label>
              <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="לדוגמה: תזכורת אימון הכירות" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="form-group">
                <label className="form-label">טריגר (מתי מופעל?)</label>
                <select className="input select" value={triggerEvent} onChange={(e) => handleTriggerChange(e.target.value)}>
                  {TRIGGER_EVENTS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>

              {triggerEvent === 'status_changed' && (
                <div className="form-group">
                  <label className="form-label">לאיזה סטטוס?</label>
                  <select className="input select" value={triggerCondition} onChange={(e) => setTriggerCondition(e.target.value)}>
                    <option value="">(כל עדכון סטטוס)</option>
                    {STATUS_CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              )}
            </div>

            {isScheduled && (
              <div style={{ fontSize: 12, color: 'var(--text-2)', background: 'var(--bg-input)', padding: '10px 12px', borderRadius: 8, lineHeight: 1.5 }}>
                {triggerEvent === 'intro_reminder_day_of'
                  ? 'נשלח אוטומטית בבוקר למתאמנים עם סטטוס אימון הכירות שקבוצתם מתאמנת היום. כולל שעה, מדריך והוראות הגעה.'
                  : 'נשלח אוטומטית בבוקר למי שסומן אתמול בנוכחות כהגיע, וסטטוס שלו עדיין אימון הכירות — לבירור איך היה ולעניין בהרשמה.'}
              </div>
            )}

            <div className="form-group" style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <label className="form-label">פעולה לביצוע</label>
              <select className="input select" value={actionType} onChange={(e) => setActionType(e.target.value)}>
                {ACTION_TYPES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </div>

            {actionType === 'send_whatsapp' && (
              <>
                <div className="form-group">
                  <label className="form-label">תבנית מאושרת (חובה כשהחלון סגור)</label>
                  <select
                    className="input select"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                  >
                    <option value="">ללא תבנית — טקסט חופשי בלבד</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.meta_name || t.name}>
                        {t.name || t.meta_name}
                      </option>
                    ))}
                  </select>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, fontSize: 12 }}>
                    <input type="checkbox" checked={preferTemplate} onChange={(e) => setPreferTemplate(e.target.checked)} />
                    העדף תבנית גם כשהחלון פתוח
                  </label>
                </div>

                {templateName && (
                  <div className="form-group">
                    <label className="form-label">סדר משתנים לתבנית (מופרד בפסיקים)</label>
                    <input
                      className="input"
                      value={templateVarKeys}
                      onChange={(e) => setTemplateVarKeys(e.target.value)}
                      placeholder="name,time,trainer,arrival"
                      dir="ltr"
                      style={{ textAlign: 'left' }}
                    />
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                      אפשרויות:
                      {' '}
                      <code>name</code>
                      {', '}
                      <code>parentName</code>
                      {', '}
                      <code>time</code>
                      {', '}
                      <code>trainer</code>
                      {', '}
                      <code>arrival</code>
                      {', '}
                      <code>group</code>
                    </div>
                  </div>
                )}

                {triggerEvent === 'intro_reminder_day_of' && (
                  <div className="form-group">
                    <label className="form-label">הוראות הגעה</label>
                    <input
                      className="input"
                      value={arrivalText}
                      onChange={(e) => setArrivalText(e.target.value)}
                    />
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">תוכן ההודעה (כשהחלון פתוח)</label>
                  <textarea
                    className="input textarea"
                    rows={5}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="שלום {{name}}, שמחים שבאת לקיר הטיפוס..."
                    required={!templateName}
                  />
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>
                    משתנים זמינים:
                    {' '}
                    <code>{'{{name}}'}</code>
                    {', '}
                    <code>{'{{parentName}}'}</code>
                    {', '}
                    <code>{'{{time}}'}</code>
                    {', '}
                    <code>{'{{trainer}}'}</code>
                    {', '}
                    <code>{'{{arrival}}'}</code>
                    {', '}
                    <code>{'{{group}}'}</code>
                    .
                    <br />
                    אם החלון סגור ואין תבנית מאושרת — ההודעה לא תישלח.
                  </div>
                </div>
              </>
            )}

            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <label className="form-label" style={{ marginBottom: 0 }}>סטטוס אוטומציה:</label>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: isActive ? 'var(--green)' : 'var(--text-3)' }}
                onClick={() => setIsActive(!isActive)}
              >
                {isActive ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                <span style={{ fontSize: 13 }}>{isActive ? 'פעילה' : 'כבויה'}</span>
              </div>
            </div>
          </form>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>ביטול</button>
          <button form="automation-form" type="submit" className="btn btn-primary">
            <Save size={15} /> שמור אוטומציה
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Automations() {
  const [automations, setAutomations] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);

  const fetchAutomations = async () => {
    try {
      const res = await fetch('/api/automations');
      const data = await res.json().catch(() => null);
      setAutomations(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setAutomations([]);
    }
  };

  useEffect(() => {
    fetchAutomations();
  }, []);

  const handleSave = async (data) => {
    const isEdit = !!data.id;
    try {
      const res = await fetch(isEdit ? `/api/automations/${data.id}` : '/api/automations', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        fetchAutomations();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('האם אתה בטוח שברצונך למחוק אוטומציה זו?')) return;
    try {
      const res = await fetch(`/api/automations/${id}`, { method: 'DELETE' });
      if (res.ok) fetchAutomations();
    } catch (err) {
      console.error(err);
    }
  };

  const toggleStatus = async (item) => {
    handleSave({ ...item, is_active: !item.is_active });
  };

  return (
    <div className="fade-in">
      {showForm && (
        <AutomationModal
          automation={editingItem}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditingItem(null); }}
        />
      )}

      <div className="section-header" style={{ marginBottom: 20 }}>
        <div>
          <div className="section-title">אוטומציות ומסעות לקוח</div>
          <div className="section-sub">הגדרת פעולות שיווק ותפעול חכמות למסעות אוטומטיים</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => { setEditingItem(null); setShowForm(true); }}>
          <Plus size={15} /> יצירת אוטומציה חדשה
        </button>
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="card stat-card" style={{ '--stat-color': '#10B981' }}>
          <div className="stat-label">אוטומציות פעילות</div>
          <div className="stat-value">{automations.filter((a) => a.is_active).length}</div>
        </div>
        <div className="card stat-card" style={{ '--stat-color': '#6366F1' }}>
          <div className="stat-label">סך הכל חוקים</div>
          <div className="stat-value">{automations.length}</div>
        </div>
      </div>

      <div className="card">
        {automations.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-3)' }}>
            <Settings size={40} style={{ opacity: 0.2, marginBottom: 10 }} />
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, color: 'var(--text-1)' }}>אין אוטומציות מוגדרות</div>
            <div style={{ fontSize: 13 }}>לחץ על הכפתור למעלה כדי להוסיף את האוטומציה הראשונה.</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th style={{ width: 50 }}>סטטוס</th>
                  <th>שם האוטומציה</th>
                  <th>טריגר (מתי זה קורה)</th>
                  <th>פעולה לביצוע</th>
                  <th style={{ width: 100 }}>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {automations.map((auto) => (
                  <tr key={auto.id} style={{ opacity: auto.is_active ? 1 : 0.6 }}>
                    <td>
                      <div
                        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        onClick={() => toggleStatus(auto)}
                        title={auto.is_active ? 'כיבוי' : 'הפעלה'}
                      >
                        {auto.is_active
                          ? <ToggleRight size={22} color="var(--green)" />
                          : <ToggleLeft size={22} color="var(--text-3)" />}
                      </div>
                    </td>
                    <td style={{ fontWeight: 600 }}>{auto.name}</td>
                    <td style={{ fontSize: 13, color: 'var(--text-3)' }}>
                      <span className="badge badge-gray" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Play size={10} />
                        {TRIGGER_EVENTS.find((t) => t.value === auto.trigger_event)?.label || auto.trigger_event}
                        {auto.trigger_condition && (
                          <span style={{ fontWeight: 600, color: 'var(--text-1)', marginRight: 4 }}>
                            ({STATUS_CONDITIONS.find((s) => s.value === auto.trigger_condition)?.label || auto.trigger_condition})
                          </span>
                        )}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontSize: 13 }}>
                        <strong>{ACTION_TYPES.find((a) => a.value === auto.action_type)?.label || auto.action_type}</strong>
                        {auto.action_type === 'send_whatsapp' && (
                          <div style={{ color: 'var(--text-3)', marginTop: 2, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 250 }}>
                            {auto.action_payload?.templateName
                              ? `תבנית: ${auto.action_payload.templateName}`
                              : `"${auto.action_payload?.message || ''}"`}
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-ghost btn-icon btn-xs" onClick={() => { setEditingItem(auto); setShowForm(true); }}>
                          <Edit2 size={13} />
                        </button>
                        <button className="btn btn-ghost btn-icon btn-xs" onClick={() => handleDelete(auto.id)} style={{ color: 'var(--red)' }}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
