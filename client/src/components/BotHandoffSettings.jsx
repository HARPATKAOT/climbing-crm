import BotSettingsCard from './BotSettingsCard.jsx';

/**
 * When the bot steps aside for a person.
 *
 * The keyword list runs before the model: money, injury and an explicit ask for
 * a human never reach it at all. The staff numbers are here rather than beside
 * the business facts, because what they are for is this — hearing about a
 * conversation the bot just handed over.
 */
export default function BotHandoffSettings({ settings, setSettings }) {
  const patch = (key, value) => setSettings({ ...settings, [key]: value });

  return (
    <div className="form-grid" style={{ gap: 14 }}>
      <BotSettingsCard
        title="מה מעביר לצוות מיד"
        hint="ההודעות האלה לא מגיעות למודל כלל — ביטול, החזר, חשבונית, פציעה או בקשה מפורשת לדבר עם אדם."
        keys={['aiHandoffKeywords', 'aiHandoffAckMessage']}
        settings={settings}
      >
        <div className="form-group">
          <label className="form-label" style={{ fontSize: 11 }}>מילות מפתח להעברה (מופרד בפסיקים)</label>
          <input
            className="input input-sm"
            value={settings.aiHandoffKeywords || ''}
            onChange={(e) => patch('aiHandoffKeywords', e.target.value)}
          />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" style={{ fontSize: 11 }}>הודעת אישור העברה</label>
          <textarea
            className="input textarea"
            rows={2}
            style={{ fontSize: 12 }}
            value={settings.aiHandoffAckMessage || ''}
            onChange={(e) => patch('aiHandoffAckMessage', e.target.value)}
          />
        </div>
      </BotSettingsCard>

      <BotSettingsCard
        title="מי מקבל את ההתראה"
        keys={['aiStaffPhones']}
        settings={settings}
      >
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" style={{ fontSize: 11 }}>מספרי צוות (סוכן CRM במקום בוט לקוחות)</label>
          <textarea
            className="input textarea"
            rows={2}
            style={{ fontSize: 12 }}
            placeholder="0501234567, 0527654321"
            value={settings.aiStaffPhones || ''}
            onChange={(e) => patch('aiStaffPhones', e.target.value)}
          />
          <div className="text-muted" style={{ fontSize: 10, marginTop: 4 }}>
            המספרים האלה מקבלים התראה כשהבוט מעביר שיחה לצוות, וגם תשובות מנתוני
            המערכת. פעולות כתיבה עדיין ממתינות לאישור במסך העוזר.
          </div>
        </div>
      </BotSettingsCard>

      <BotSettingsCard
        title="השהיה אחרי שעובד ענה"
        hint="ברגע שעובד כותב בשיחה — מהמערכת או מהטלפון — הבוט מפסיק לענות בה, כדי ששני קולות לא ידברו עם אותו לקוח."
        keys={['aiPauseOnHumanReply', 'aiPauseMinutesAfterHuman']}
        settings={settings}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={settings.aiPauseOnHumanReply !== false}
            onChange={(e) => patch('aiPauseOnHumanReply', e.target.checked)}
            style={{ width: 18, height: 18 }}
          />
          השהה בוט אחרי תשובת עובד (מערכת או טלפון)
        </label>
        <div className="form-group" style={{ marginBottom: 0, maxWidth: 220 }}>
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
      </BotSettingsCard>
    </div>
  );
}
