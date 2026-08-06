import BotSettingsCard from './BotSettingsCard.jsx';

/**
 * How the bot speaks, and the handful of facts that have no screen of their own.
 *
 * Everything the business already keeps somewhere — class prices, equipment,
 * opening hours, events — is read by a tool from the screen that owns it. What
 * is typed here is prose the model may repeat, so a fact written here twice is
 * a fact that can go stale in one of the two places.
 */
export default function BotToneSettings({ settings, setSettings }) {
  const patch = (key, value) => setSettings({ ...settings, [key]: value });

  return (
    <div className="form-grid" style={{ gap: 14 }}>
      <BotSettingsCard
        title="איך הבוט מדבר"
        hint="השדה הזה משפיע על כל תשובה — טון, אורך ורמת פורמליות. עובדות אין לכתוב כאן. שם העסק נלקח אוטומטית ממסך הגדרות העסק."
        keys={['aiSystemPrompt', 'aiMaxReplyChars']}
        settings={settings}
      >
        <div className="form-group">
          <label className="form-label">הנחיות אימון למענה (System Prompt)</label>
          <textarea
            className="input textarea"
            rows={6}
            style={{ fontSize: 12, lineHeight: 1.5 }}
            value={settings.aiSystemPrompt || ''}
            onChange={(e) => patch('aiSystemPrompt', e.target.value)}
          />
        </div>
        <div className="form-group" style={{ marginBottom: 0, maxWidth: 220 }}>
          <label className="form-label" style={{ fontSize: 11 }}>אורך מקסימלי לתשובה (תווים)</label>
          <input
            className="input input-sm"
            type="number"
            min={100}
            max={4000}
            value={settings.aiMaxReplyChars ?? 700}
            onChange={(e) => patch('aiMaxReplyChars', Number(e.target.value))}
          />
        </div>
      </BotSettingsCard>

      <BotSettingsCard
        title="ידע שאין לו מסך משלו"
        hint="כאן רק מה שאין לו מקום אחר — כתובת, חניה, נהלים. מחירי חוגים, ציוד, דמי העשרה, שעות פתיחה ואירועים נקראים מהמסכים שלהם; אם כותבים אותם גם כאן, הבוט עלול לצטט את הישן מבין השניים."
        keys={['aiBusinessFacts', 'aiKnowledgeBase', 'aiForbiddenTopics']}
        settings={settings}
      >
        <div className="form-group">
          <label className="form-label" style={{ fontSize: 11 }}>פרטי עסק (כתובת / חניה / קישורים)</label>
          <textarea
            className="input textarea"
            rows={3}
            style={{ fontSize: 12 }}
            value={settings.aiBusinessFacts || ''}
            onChange={(e) => patch('aiBusinessFacts', e.target.value)}
          />
          <div className="text-muted" style={{ fontSize: 10, marginTop: 4 }}>
            שורת «כתובת:» היא גם מקור הכתובת בהודעות התזכורת — אין למחוק אותה.
          </div>
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
      </BotSettingsCard>
    </div>
  );
}
