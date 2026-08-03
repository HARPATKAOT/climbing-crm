/**
 * יומן הפעולות של הבוט.
 *
 * הבוט משבץ, מסיר, משנה סטטוס, אוסף פרטים ושולח הודעות — וכל אחד מהדברים
 * האלה השאיר עקבות במקום אחר: השיבוץ בכרטיס המתאמן, ההודעה בחלונית השיחה,
 * המעקב באוסף שלו. אי אפשר היה לשאול „מה הבוט עשה היום” ולקבל תשובה אחת,
 * ולכן גם אי אפשר היה לתפוס טעות שיטתית לפני שהיא חוזרת על עצמה עשר פעמים.
 *
 * הפרדה בין „פעולה” ל„הודעה” היא הפרדה בין מה שהבוט *שינה* לבין מה שהוא
 * *אמר*: שינוי דורש ביקורת, אמירה דורשת קריאה. שתיהן ביומן אחד, כי הן קרו
 * באותה שיחה ובאותו רגע.
 *
 * `bot_actions` ב-kv_collections — אותו דפוס של שאר האוספים התפעוליים.
 */

export const BOT_ACTIONS_COLLECTION = 'bot_actions';

export const ACTION_KIND = 'action';
export const MESSAGE_KIND = 'message';

/**
 * כל סוגי הפעולות, עם התווית שהמסך מציג. הרשימה היא גם רשימת ההיתר: סוג
 * שאינו כאן נרשם כ„אחר”, ולא נבלע בשקט.
 */
export const BOT_ACTION_TYPES = [
  { type: 'placement', kind: ACTION_KIND, label: 'שיבוץ לקבוצה', icon: '🧗' },
  { type: 'waitlist', kind: ACTION_KIND, label: 'רשימת המתנה', icon: '⏳' },
  { type: 'placement_cancelled', kind: ACTION_KIND, label: 'הסרה מקבוצה', icon: '↩️' },
  { type: 'status_changed', kind: ACTION_KIND, label: 'שינוי סטטוס מתאמן', icon: '🔁' },
  { type: 'interest_added', kind: ACTION_KIND, label: 'רישום מתעניין לפעילות', icon: '🎒' },
  { type: 'details_saved', kind: ACTION_KIND, label: 'איסוף פרטים', icon: '📝' },
  { type: 'followup_scheduled', kind: ACTION_KIND, label: 'תזכורת מעקב נקבעה', icon: '📌' },
  { type: 'centre_report', kind: ACTION_KIND, label: 'דיווח למתנ״ס', icon: '🏛️' },
  { type: 'followup_sent', kind: MESSAGE_KIND, label: 'הודעת מעקב', icon: '📤' },
  { type: 'handoff', kind: MESSAGE_KIND, label: 'העברה לצוות', icon: '🔔' },
  { type: 'reply', kind: MESSAGE_KIND, label: 'תשובה ללקוח', icon: '💬' },
  { type: 'other', kind: ACTION_KIND, label: 'אחר', icon: '•' },
];

const TYPE_INDEX = new Map(BOT_ACTION_TYPES.map((t) => [t.type, t]));

export function actionTypeMeta(type) {
  return TYPE_INDEX.get(String(type || '')) || TYPE_INDEX.get('other');
}

export function botActionRows(db) {
  const rows = db.get(BOT_ACTIONS_COLLECTION);
  return Array.isArray(rows) ? rows : [];
}

/** Unique per row: several actions can land inside one conversation turn. */
export function newBotActionId() {
  return `ba${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Write one line to the journal.
 *
 * Never throws and never awaits the durable write on the caller's path: a
 * journal that can break a placement is worse than no journal. Persistence is
 * best-effort and failures are logged, not raised.
 */
export function recordBotAction(db, persist, entry = {}) {
  try {
    const meta = actionTypeMeta(entry.type);
    const row = {
      id: newBotActionId(),
      kind: meta.kind,
      type: meta.type,
      summary: String(entry.summary || '').slice(0, 300),
      details: entry.details && typeof entry.details === 'object' ? entry.details : {},
      parent_id: entry.parentId || null,
      parent_name: String(entry.parentName || '').slice(0, 120),
      student_id: entry.studentId || null,
      student_name: String(entry.studentName || '').slice(0, 120),
      phone: String(entry.phone || '').slice(0, 30),
      actor: entry.actor || 'bot',
      created_at: new Date().toISOString(),
    };
    const saved = db.insert(BOT_ACTIONS_COLLECTION, row);
    if (persist && saved?.id) {
      Promise.resolve(persist(BOT_ACTIONS_COLLECTION, saved)).catch((err) =>
        console.error('bot action log persist failed:', err?.message || err));
    }
    return saved;
  } catch (err) {
    console.error('bot action log failed:', err?.message || err);
    return null;
  }
}

/**
 * Read the journal, newest first.
 * `kind` narrows to actions or messages; `type` to one row of the panel.
 */
export function listBotActions(db, { kind = '', type = '', parentId = '', since = '', limit = 200 } = {}) {
  const wantedKind = String(kind || '').trim();
  const wantedType = String(type || '').trim();
  const wantedParent = String(parentId || '').trim();
  const from = String(since || '').trim();

  return botActionRows(db)
    .filter((row) => (!wantedKind || String(row.kind) === wantedKind))
    .filter((row) => (!wantedType || String(row.type) === wantedType))
    .filter((row) => (!wantedParent || String(row.parent_id || '') === wantedParent))
    .filter((row) => (!from || String(row.created_at || '') >= from))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, Math.max(1, Math.min(1000, Number(limit) || 200)));
}

/** Counts per type for the day, so the screen can show what the bot has been doing. */
export function botActionSummary(db, { since = '' } = {}) {
  const rows = listBotActions(db, { since, limit: 1000 });
  const byType = {};
  for (const row of rows) {
    byType[row.type] = (byType[row.type] || 0) + 1;
  }
  return {
    total: rows.length,
    actions: rows.filter((r) => r.kind === ACTION_KIND).length,
    messages: rows.filter((r) => r.kind === MESSAGE_KIND).length,
    byType,
  };
}
