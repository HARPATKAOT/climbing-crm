const DAY_OPTIONS = [
  { value: 0, label: 'א׳' },
  { value: 1, label: 'ב׳' },
  { value: 2, label: 'ג׳' },
  { value: 3, label: 'ד׳' },
  { value: 4, label: 'ה׳' },
  { value: 5, label: 'ו׳' },
  { value: 6, label: 'שבת' },
];

function Section({ title, children }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

export default function BotSettingsPanel({
  settings,
  setSettings,
  savingBotToggle,
  botToggleError,
  handleBotToggle,
}) {
  const toggleActiveDay = (day) => {
    const current = Array.isArray(settings.aiActiveDays) ? settings.aiActiveDays : [];
    const next = current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day].sort((a, b) => a - b);
    setSettings({ ...settings, aiActiveDays: next.length ? next : [day] });
  };

  const patch = (key, value) => setSettings({ ...settings, [key]: value });

  return (
    <div className="form-grid" style={{ gap: 14 }}>
      <div style={{
        border: `1px solid ${settings.aiResponderEnabled ? 'rgba(37,211,102,0.45)' : 'rgba(239,68,68,0.35)'}`,
        background: settings.aiResponderEnabled ? 'rgba(37,211,102,0.06)' : 'rgba(239,68,68,0.06)',
        borderRadius: 12,
        padding: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>מענה אוטומטי של הבוט</div>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
              {settings.aiResponderEnabled
                ? 'הבוט פעיל — עונה אוטומטית להודעות נכנסות'
                : 'הבוט כבוי — לא יישלח מענה אוטומטי'}
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: savingBotToggle ? 'wait' : 'pointer', fontWeight: 600, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={!!settings.aiResponderEnabled}
              disabled={savingBotToggle}
              onChange={(e) => handleBotToggle(e.target.checked)}
              style={{ width: 20, height: 20 }}
            />
            {savingBotToggle ? 'שומר...' : settings.aiResponderEnabled ? 'פעיל' : 'כבוי'}
          </label>
        </div>
        {botToggleError && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--red)' }}>{botToggleError}</div>
        )}
        {!settings.aiResponderEnabled && !botToggleError && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-2)' }}>
            הבוט כבוי — לא יישלחו תשובות אוטומטיות, גם לא ללידים חדשים.
          </div>
        )}

        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={!!settings.aiActiveHoursEnabled}
              onChange={(e) => patch('aiActiveHoursEnabled', e.target.checked)}
              disabled={!settings.aiResponderEnabled}
              style={{ width: 18, height: 18 }}
            />
            הגבלת שעות פעילות
          </label>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 10, lineHeight: 1.5 }}>
            מחוץ לשעות האלה הבוט לא יענה (לפי שעון ישראל). בדיקת המענה במסך הזה תמשיך לעבוד גם מחוץ לשעות.
          </div>
          <div className="form-grid-2" style={{ opacity: settings.aiResponderEnabled && settings.aiActiveHoursEnabled ? 1 : 0.45, pointerEvents: settings.aiResponderEnabled && settings.aiActiveHoursEnabled ? 'auto' : 'none' }}>
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
          <div style={{ marginTop: 10, opacity: settings.aiResponderEnabled && settings.aiActiveHoursEnabled ? 1 : 0.45, pointerEvents: settings.aiResponderEnabled && settings.aiActiveHoursEnabled ? 'auto' : 'none' }}>
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
          </div>
        </div>
      </div>

      <Section title="העברה לצוות והשהיה">
        <div className="form-group">
          <label className="form-label" style={{ fontSize: 11 }}>מילות מפתח להעברה (מופרד בפסיקים)</label>
          <input
            className="input input-sm"
            value={settings.aiHandoffKeywords || ''}
            onChange={(e) => patch('aiHandoffKeywords', e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label" style={{ fontSize: 11 }}>הודעת אישור העברה</label>
          <textarea
            className="input textarea"
            rows={2}
            style={{ fontSize: 12 }}
            value={settings.aiHandoffAckMessage || ''}
            onChange={(e) => patch('aiHandoffAckMessage', e.target.value)}
          />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={settings.aiPauseOnHumanReply !== false}
            onChange={(e) => patch('aiPauseOnHumanReply', e.target.checked)}
            style={{ width: 18, height: 18 }}
          />
          השהה בוט אחרי תשובת עובד (מערכת או טלפון)
        </label>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" style={{ fontSize: 11 }}>דקות השהיה אחרי אדם</label>
          <input
            className="input input-sm"
            type="number"
            min={1}
            max={10080}
            value={settings.aiPauseMinutesAfterHuman ?? 120}
            onChange={(e) => patch('aiPauseMinutesAfterHuman', Number(e.target.value))}
          />
        </div>
      </Section>

      <Section title="קהל יעד ואיסוף ליד">
        <div className="form-group">
          <label className="form-label" style={{ fontSize: 11 }}>למי הבוט עונה</label>
          <select
            className="input input-sm"
            value={settings.aiAudienceMode || 'all'}
            onChange={(e) => patch('aiAudienceMode', e.target.value)}
          >
            <option value="all">כולם</option>
            <option value="leads_only">לידים בלבד</option>
            <option value="customers_only">לקוחות פעילים בלבד</option>
          </select>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={!!settings.aiLeadCaptureEnabled}
            onChange={(e) => patch('aiLeadCaptureEnabled', e.target.checked)}
            style={{ width: 18, height: 18 }}
          />
          איסוף ליד מדורג (שם הורה ← ילד ← כיתה ← יום)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={settings.aiInteractiveMenuEnabled !== false}
            onChange={(e) => patch('aiInteractiveMenuEnabled', e.target.checked)}
            style={{ width: 18, height: 18 }}
          />
          תפריט אינטראקטיבי לליד חדש (עם נפילה לטקסט)
        </label>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" style={{ fontSize: 11 }}>טקסט תפריט פתיחה</label>
          <textarea
            className="input textarea"
            rows={5}
            style={{ fontSize: 12 }}
            value={settings.aiGreetingMenu || ''}
            onChange={(e) => patch('aiGreetingMenu', e.target.value)}
          />
        </div>
      </Section>

      <Section title="ידע עסקי ושאלות נפוצות">
        <div className="form-group">
          <label className="form-label" style={{ fontSize: 11 }}>פרטי עסק (כתובת / שעות / קישורים)</label>
          <textarea
            className="input textarea"
            rows={3}
            style={{ fontSize: 12 }}
            value={settings.aiBusinessFacts || ''}
            onChange={(e) => patch('aiBusinessFacts', e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label" style={{ fontSize: 11 }}>בסיס ידע / שאלות נפוצות</label>
          <textarea
            className="input textarea"
            rows={4}
            style={{ fontSize: 12 }}
            value={settings.aiKnowledgeBase || ''}
            onChange={(e) => patch('aiKnowledgeBase', e.target.value)}
          />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" style={{ fontSize: 11 }}>נושאים אסורים</label>
          <textarea
            className="input textarea"
            rows={3}
            style={{ fontSize: 12 }}
            value={settings.aiForbiddenTopics || ''}
            onChange={(e) => patch('aiForbiddenTopics', e.target.value)}
          />
        </div>
      </Section>

      <Section title="הגנות ומגבלות">
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
            <label className="form-label" style={{ fontSize: 11 }}>עיכוב לפני תשובה (אלפיות שנייה)</label>
            <input
              className="input input-sm"
              type="number"
              min={0}
              max={10000}
              value={settings.aiReplyDelayMs ?? 800}
              onChange={(e) => patch('aiReplyDelayMs', Number(e.target.value))}
            />
          </div>
          <div className="form-group">
            <label className="form-label" style={{ fontSize: 11 }}>אורך מקסימלי לתשובה</label>
            <input
              className="input input-sm"
              type="number"
              min={100}
              max={4000}
              value={settings.aiMaxReplyChars ?? 700}
              onChange={(e) => patch('aiMaxReplyChars', Number(e.target.value))}
            />
          </div>
          <div className="form-group">
            <label className="form-label" style={{ fontSize: 11 }}>הודעות היסטוריה לבינה</label>
            <input
              className="input input-sm"
              type="number"
              min={0}
              max={30}
              value={settings.aiHistoryCount ?? 8}
              onChange={(e) => patch('aiHistoryCount', Number(e.target.value))}
            />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label" style={{ fontSize: 11 }}>מילות עצירה</label>
          <input
            className="input input-sm"
            value={settings.aiStopKeywords || ''}
            onChange={(e) => patch('aiStopKeywords', e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label" style={{ fontSize: 11 }}>הודעת אישור עצירה</label>
          <textarea
            className="input textarea"
            rows={2}
            style={{ fontSize: 12 }}
            value={settings.aiOptOutMessage || ''}
            onChange={(e) => patch('aiOptOutMessage', e.target.value)}
          />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" style={{ fontSize: 11 }}>מילות הפעלה מחדש</label>
          <input
            className="input input-sm"
            value={settings.aiReactivateKeywords || ''}
            onChange={(e) => patch('aiReactivateKeywords', e.target.value)}
          />
        </div>
      </Section>

      <Section title="סף ביטחון והנחיות בינה">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={settings.aiEscalateWhenUnsure !== false}
            onChange={(e) => patch('aiEscalateWhenUnsure', e.target.checked)}
            style={{ width: 18, height: 18 }}
          />
          העברה לצוות כשהבינה לא בטוחה
        </label>
        <div className="form-group">
          <label className="form-label" style={{ fontSize: 11 }}>הודעה כשלא בטוחים</label>
          <textarea
            className="input textarea"
            rows={2}
            style={{ fontSize: 12 }}
            value={settings.aiUnsureReply || ''}
            onChange={(e) => patch('aiUnsureReply', e.target.value)}
          />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">הנחיות אימון למענה (System Prompt)</label>
          <textarea
            className="input textarea"
            rows={6}
            style={{ fontSize: 12, lineHeight: 1.5 }}
            value={settings.aiSystemPrompt || ''}
            onChange={(e) => patch('aiSystemPrompt', e.target.value)}
          />
          <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
            הסבר לבינה איך להציג את הקיר, אילו מחירים לתת, ואיך להתנסח.
          </div>
        </div>
      </Section>
    </div>
  );
}
