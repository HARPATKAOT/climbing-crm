import AppSelect from './AppSelect.jsx';
import BotSettingsCard from './BotSettingsCard.jsx';

const DAY_OPTIONS = [
  { value: 0, label: 'א׳' },
  { value: 1, label: 'ב׳' },
  { value: 2, label: 'ג׳' },
  { value: 3, label: 'ד׳' },
  { value: 4, label: 'ה׳' },
  { value: 5, label: 'ו׳' },
  { value: 6, label: 'שבת' },
];

/**
 * When the bot answers at all: hours, who it answers, how often, and the
 * customer's own way of telling it to stop. Every one of these runs before the
 * model is reached — they are gates, not instructions.
 */
export default function BotScheduleSettings({ settings, setSettings, disabled = false }) {
  const patch = (key, value) => setSettings({ ...settings, [key]: value });
  const replyDelaySeconds = Math.max(
    7,
    Math.min(30, Math.round(Number(settings.aiReplyDelayMs ?? 7_000) / 1_000))
  );

  const toggleActiveDay = (day) => {
    const current = Array.isArray(settings.aiActiveDays) ? settings.aiActiveDays : [];
    const next = current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day].sort((a, b) => a - b);
    setSettings({ ...settings, aiActiveDays: next.length ? next : [day] });
  };

  const hoursOn = !disabled && settings.aiActiveHoursEnabled;

  return (
    <div className="form-grid" style={{ gap: 14 }}>
      <BotSettingsCard
        title="שעות פעילות"
        hint="מחוץ לשעות האלה הבוט לא יענה (לפי שעון ישראל). ארגז החול ממשיך לעבוד גם מחוץ לשעות."
        keys={['aiActiveHoursEnabled', 'aiActiveHoursStart', 'aiActiveHoursEnd', 'aiActiveDays', 'aiOutsideHoursMessage']}
        settings={settings}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={!!settings.aiActiveHoursEnabled}
            onChange={(e) => patch('aiActiveHoursEnabled', e.target.checked)}
            disabled={disabled}
            style={{ width: 18, height: 18 }}
          />
          הגבלת שעות פעילות
        </label>
        <div
          className="form-grid-2"
          style={{ opacity: hoursOn ? 1 : 0.45, pointerEvents: hoursOn ? 'auto' : 'none' }}
        >
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: 11 }}>משעה</label>
            <input
              className="input input-sm"
              type="time"
              value={settings.aiActiveHoursStart || '09:00'}
              onChange={(e) => patch('aiActiveHoursStart', e.target.value)}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: 11 }}>עד שעה</label>
            <input
              className="input input-sm"
              type="time"
              value={settings.aiActiveHoursEnd || '21:00'}
              onChange={(e) => patch('aiActiveHoursEnd', e.target.value)}
            />
          </div>
        </div>
        <div style={{ marginTop: 10, opacity: hoursOn ? 1 : 0.45, pointerEvents: hoursOn ? 'auto' : 'none' }}>
          <div className="form-label" style={{ fontSize: 11, marginBottom: 6 }}>ימים פעילים</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {DAY_OPTIONS.map((day) => {
              const active = (settings.aiActiveDays || []).includes(day.value);
              return (
                <button
                  key={day.value}
                  type="button"
                  onClick={() => toggleActiveDay(day.value)}
                  style={{
                    minWidth: 36,
                    padding: '6px 8px',
                    borderRadius: 8,
                    border: active ? '1px solid rgba(37,211,102,0.55)' : '1px solid var(--border)',
                    background: active ? 'rgba(37,211,102,0.18)' : 'transparent',
                    color: 'var(--text)',
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="form-group" style={{ marginTop: 12, marginBottom: 0 }}>
          <label className="form-label" style={{ fontSize: 11 }}>הודעה מחוץ לשעות</label>
          <textarea
            className="input textarea"
            rows={3}
            style={{ fontSize: 12 }}
            value={settings.aiOutsideHoursMessage || ''}
            onChange={(e) => patch('aiOutsideHoursMessage', e.target.value)}
          />
          <div className="text-muted" style={{ fontSize: 10, marginTop: 4 }}>
            נשלחת פעם אחת ביום לכל לקוח, לא על כל הודעה.
          </div>
        </div>
      </BotSettingsCard>

      <BotSettingsCard
        title="קהל ומגבלות"
        keys={['aiAudienceMode', 'aiRateLimitPerHour', 'aiReplyDelayMs', 'aiHistoryCount']}
        settings={settings}
      >
        <div className="form-group">
          <label className="form-label" style={{ fontSize: 11 }}>למי הבוט עונה</label>
          <AppSelect
            className="input input-sm"
            value={settings.aiAudienceMode || 'all'}
            onChange={(e) => patch('aiAudienceMode', e.target.value)}
          >
            <option value="all">כולם</option>
            <option value="leads_only">לידים בלבד</option>
            <option value="customers_only">לקוחות פעילים בלבד</option>
          </AppSelect>
        </div>
        <div className="form-grid-2">
          <div className="form-group">
            <label className="form-label" style={{ fontSize: 11 }}>הודעות בוט מקסימום לשעה</label>
            <input
              className="input input-sm"
              type="number"
              min={1}
              max={200}
              value={settings.aiRateLimitPerHour ?? 20}
              onChange={(e) => patch('aiRateLimitPerHour', Number(e.target.value))}
            />
          </div>
          <div className="form-group">
            <label className="form-label" style={{ fontSize: 11 }}>המתנה לשקט בין הודעות (שניות)</label>
            <input
              className="input input-sm"
              type="number"
              min={7}
              max={30}
              step={1}
              value={replyDelaySeconds}
              onChange={(e) => patch('aiReplyDelayMs', Number(e.target.value) * 1_000)}
            />
            <div className="text-muted" style={{ fontSize: 10, marginTop: 4 }}>
              כל הודעה חדשה מאפסת את הטיימר. פתיח קצר כמו „היי” מקבל 12 שניות כדי לאפשר ללקוח להמשיך לכתוב.
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: 11 }}>הודעות היסטוריה לבינה</label>
            <input
              className="input input-sm"
              type="number"
              min={0}
              max={30}
              value={settings.aiHistoryCount ?? 8}
              onChange={(e) => patch('aiHistoryCount', Number(e.target.value))}
            />
            <div className="text-muted" style={{ fontSize: 10, marginTop: 4 }}>
              כמה הודעות קודמות מהשיחה נמסרות למודל. 0 = בלי היסטוריה.
            </div>
          </div>
        </div>
      </BotSettingsCard>

      <BotSettingsCard
        title="ניהול העדפות דיוור בשיחה"
        hint="«הסר» פותח בחירת רשימות מסודרת; «הסרת אחריות» אינה מפעילה אותה."
        keys={['aiStopKeywords']}
        settings={settings}
      >
        <div className="form-group">
          <label className="form-label" style={{ fontSize: 11 }}>ביטויים לפתיחת בחירת הרשימות</label>
          <input
            className="input input-sm"
            value={settings.aiStopKeywords || ''}
            onChange={(e) => patch('aiStopKeywords', e.target.value)}
          />
          <div className="text-muted" style={{ fontSize: 10, marginTop: 6 }}>
            הלקוח יכול לבחור רשימה אחת, כמה רשימות או את כולן, ולקבל קישור אישי לעריכה מלאה.
          </div>
        </div>
      </BotSettingsCard>
    </div>
  );
}
