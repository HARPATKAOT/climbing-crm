import React, { useState, useEffect } from 'react';
import {
  Plus, Trash2, Edit2, Play, Save, X, ToggleLeft, ToggleRight,
  CalendarClock, Eye, Send,
} from 'lucide-react';

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

const WEEKDAYS = [
  { value: 0, label: 'ראשון' },
  { value: 1, label: 'שני' },
  { value: 2, label: 'שלישי' },
  { value: 3, label: 'רביעי' },
  { value: 4, label: 'חמישי' },
  { value: 5, label: 'שישי' },
  { value: 6, label: 'שבת' },
];
/** Seeded server-side by agendaDigestTemplate.js. */
const AGENDA_TEMPLATE_NAME = 'my_agenda_v1';

const AGENDA_ROWS = [
  {
    key: 'daily',
    field: 'dailyEnabled',
    name: 'תזכורת יומית — מה מתוכנן מחר',
    trigger: 'כל ערב (אוטומטי)',
    detail: 'רשימת אירועי מחר לפי שעות',
  },
  {
    key: 'weekly',
    field: 'weeklyEnabled',
    name: 'סיכום שבועי — מה מתוכנן השבוע',
    trigger: 'פעם בשבוע בערב (אוטומטי)',
    detail: 'שורה מתומצת לכל יום בשבוע הקרוב',
  },
];

/** Settings for the evening agenda reminders, opened from the automations list. */
function AgendaDigestModal({ initial, kind, onSaved, onClose }) {
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [preview, setPreview] = useState(null);
  const [templates, setTemplates] = useState([]);

  useEffect(() => {
    // All of them, so we can tell "not approved yet" apart from "does not exist".
    fetch('/api/message-templates')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setTemplates(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  const patch = (changes) => setSettings((prev) => ({ ...prev, ...changes }));

  const save = async (changes = {}) => {
    const next = { ...settings, ...changes };
    setSettings(next);
    setSaving(true);
    setStatus('');
    try {
      const res = await fetch('/api/agenda-digest/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        setSettings(data);
        onSaved(data);
        setStatus('נשמר');
      } else {
        setStatus(data?.error || 'השמירה נכשלה');
      }
    } catch (err) {
      setStatus(err.message);
    } finally {
      setSaving(false);
    }
  };

  const showPreview = async () => {
    setPreview('טוען…');
    try {
      const res = await fetch(`/api/agenda-digest/preview?kind=${kind}`);
      const data = await res.json().catch(() => null);
      setPreview(data?.text || data?.error || 'לא התקבל תוכן');
    } catch (err) {
      setPreview(err.message);
    }
  };

  const sendNow = async () => {
    if (!window.confirm('לשלוח עכשיו לנייד/מייל שהוגדרו?')) return;
    setStatus('שולח…');
    try {
      const res = await fetch('/api/agenda-digest/send-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      const data = await res.json().catch(() => null);
      setStatus(data?.sent ? 'נשלח ✓' : `לא נשלח: ${data?.reason || data?.error || 'שגיאה'}`);
    } catch (err) {
      setStatus(err.message);
    }
  };

  const isDaily = kind === 'daily';
  const usesWhatsapp = (settings.channel || 'whatsapp') !== 'email';
  const usesEmail = ['email', 'both'].includes(settings.channel);
  const enabled = !!settings[isDaily ? 'dailyEnabled' : 'weeklyEnabled'];

  const isApproved = (t) => String(t.status).toUpperCase() === 'APPROVED' || t.active_for_send;
  const approvedTemplates = templates.filter((t) => !t.archived && isApproved(t));
  // Seeded by the server; stays a draft until it is submitted to Meta and approved.
  const agendaTemplate = templates.find((t) => (t.meta_name || t.name) === AGENDA_TEMPLATE_NAME);
  const agendaTemplatePending = !!agendaTemplate && !isApproved(agendaTemplate);

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal slide-up" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div className="modal-title">
            {isDaily ? 'תזכורת יומית — מה מתוכנן מחר' : 'סיכום שבועי — מה מתוכנן השבוע'}
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--text-2)', background: 'var(--bg-input)', padding: '10px 12px', borderRadius: 8, lineHeight: 1.6 }}>
            {isDaily
              ? 'נשלח אלייך כל ערב עם כל מה שמתוכנן מחר לפי שעות.'
              : 'נשלח אלייך פעם בשבוע בערב, שורה אחת מתומצת לכל יום בשבוע הקרוב.'}
            {' '}
            כולל אירועים מיומן הקיר וגם מיומני גוגל שסומנו כשכבה בעמוד הפעילויות.
          </div>

          <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <label className="form-label" style={{ marginBottom: 0 }}>סטטוס:</label>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: enabled ? 'var(--green)' : 'var(--text-3)' }}
              onClick={() => save({ [isDaily ? 'dailyEnabled' : 'weeklyEnabled']: !enabled })}
            >
              {enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
              <span style={{ fontSize: 13 }}>{enabled ? 'פעילה' : 'כבויה'}</span>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: isDaily ? '1fr' : '1fr 1fr' }}>
            {!isDaily && (
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">יום שליחה</label>
                <select
                  className="input select"
                  value={settings.weeklyDay ?? 6}
                  onChange={(e) => save({ weeklyDay: Number(e.target.value) })}
                >
                  {WEEKDAYS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
            )}
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">שעת שליחה</label>
              <input
                className="input"
                type="time"
                value={(isDaily ? settings.dailyTime : settings.weeklyTime) || '20:00'}
                onChange={(e) => patch(isDaily ? { dailyTime: e.target.value } : { weeklyTime: e.target.value })}
                onBlur={() => save()}
              />
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">לאן לשלוח</label>
              <select
                className="input select"
                value={settings.channel || 'whatsapp'}
                onChange={(e) => save({ channel: e.target.value })}
              >
                <option value="whatsapp">וואטסאפ</option>
                <option value="email">אימייל</option>
                <option value="both">גם וגם</option>
              </select>
            </div>
            {usesWhatsapp && (
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">מספר וואטסאפ שלי</label>
                <input
                  className="input"
                  value={settings.phone || ''}
                  onChange={(e) => patch({ phone: e.target.value })}
                  onBlur={() => save()}
                  placeholder="0501234567"
                  dir="ltr"
                  style={{ textAlign: 'left' }}
                />
              </div>
            )}
            {usesEmail && (
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">אימייל שלי</label>
                <input
                  className="input"
                  value={settings.email || ''}
                  onChange={(e) => patch({ email: e.target.value })}
                  onBlur={() => save()}
                  placeholder="me@example.com"
                  dir="ltr"
                  style={{ textAlign: 'left' }}
                />
              </div>
            )}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={settings.includeGoogle !== false}
              onChange={(e) => save({ includeGoogle: e.target.checked })}
            />
            לכלול אירועים מיומני גוגל
          </label>

          {usesWhatsapp && (
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">תבנית מאושרת (כשהחלון סגור)</label>
              <select
                className="input select"
                value={settings.templateName || ''}
                onChange={(e) => save({ templateName: e.target.value })}
              >
                <option value="">ללא תבנית</option>
                {approvedTemplates.map((t) => (
                  <option key={t.id} value={t.meta_name || t.name}>{t.name || t.meta_name}</option>
                ))}
              </select>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>
                וואטסאפ מרשה טקסט חופשי רק 24 שעות אחרי שכתבת לבוט. בלי תבנית עם משתנה
                אחד, תזכורת בערב שקט לא תישלח. בתבנית הרשימה נדחסת לשורה עם מפרידי “|”.
              </div>
              {agendaTemplatePending && (
                <div style={{ fontSize: 11, color: 'var(--yellow, #EAB308)', marginTop: 6, lineHeight: 1.5 }}>
                  ⚠️ התבנית “{agendaTemplate.name}” מוכנה בעמוד ההודעות אבל עדיין לא אושרה
                  במטא — שלחו אותה לאישור משם, ואחרי האישור היא תופיע כאן ברשימה.
                </div>
              )}
            </div>
          )}

          {preview && (
            <div style={{ background: 'var(--bg-input)', borderRadius: 8, padding: 12, fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
              {preview}
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-ghost btn-sm" onClick={showPreview}>
              <Eye size={14} /> תצוגה מקדימה
            </button>
            <button className="btn btn-ghost btn-sm" onClick={sendNow}>
              <Send size={14} /> שלח עכשיו לבדיקה
            </button>
            {(saving || status) && (
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{saving ? 'שומר…' : status}</span>
            )}
          </div>
          <button className="btn btn-primary" onClick={onClose}>סגור</button>
        </div>
      </div>
    </div>
  );
}

export default function Automations() {
  const [automations, setAutomations] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [agenda, setAgenda] = useState(null);
  const [agendaKind, setAgendaKind] = useState(null);

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
    fetch('/api/agenda-digest/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setAgenda(d && !d.error ? d : {}))
      .catch(() => setAgenda({}));
  }, []);

  /** Flip a digest on or off straight from the list, without opening it. */
  const toggleAgenda = async (field) => {
    const next = { ...agenda, [field]: !agenda?.[field] };
    setAgenda(next);
    try {
      const res = await fetch('/api/agenda-digest/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data) setAgenda(data);
    } catch (err) {
      console.error(err);
    }
  };

  const agendaActive = AGENDA_ROWS.filter((r) => agenda?.[r.field]).length;

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

      {agendaKind && agenda && (
        <AgendaDigestModal
          initial={agenda}
          kind={agendaKind}
          onSaved={setAgenda}
          onClose={() => setAgendaKind(null)}
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
          <div className="stat-value">{automations.filter((a) => a.is_active).length + agendaActive}</div>
        </div>
        <div className="card stat-card" style={{ '--stat-color': '#6366F1' }}>
          <div className="stat-label">סך הכל חוקים</div>
          <div className="stat-value">{automations.length + AGENDA_ROWS.length}</div>
        </div>
      </div>

      <div className="card">
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
                {agenda && AGENDA_ROWS.map((row) => (
                  <tr
                    key={row.key}
                    style={{ opacity: agenda[row.field] ? 1 : 0.6, cursor: 'pointer' }}
                    onClick={() => setAgendaKind(row.key)}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <div
                        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        onClick={() => toggleAgenda(row.field)}
                        title={agenda[row.field] ? 'כיבוי' : 'הפעלה'}
                      >
                        {agenda[row.field]
                          ? <ToggleRight size={22} color="var(--green)" />
                          : <ToggleLeft size={22} color="var(--text-3)" />}
                      </div>
                    </td>
                    <td style={{ fontWeight: 600 }}>{row.name}</td>
                    <td style={{ fontSize: 13, color: 'var(--text-3)' }}>
                      <span className="badge badge-gray" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <CalendarClock size={10} />
                        {row.key === 'weekly'
                          ? `${row.trigger} — יום ${WEEKDAYS.find((d) => d.value === (agenda.weeklyDay ?? 6))?.label} ${agenda.weeklyTime || '20:00'}`
                          : `${row.trigger} — ${agenda.dailyTime || '20:00'}`}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontSize: 13 }}>
                        <strong>
                          {agenda.channel === 'email' ? 'שלח אימייל אליי'
                            : agenda.channel === 'both' ? 'שלח וואטסאפ + אימייל אליי'
                            : 'שלח הודעת וואטסאפ אליי'}
                        </strong>
                        <div style={{ color: 'var(--text-3)', marginTop: 2, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 250 }}>
                          {row.detail}
                        </div>
                      </div>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className="btn btn-ghost btn-icon btn-xs" onClick={() => setAgendaKind(row.key)}>
                        <Edit2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
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
      </div>
    </div>
  );
}
