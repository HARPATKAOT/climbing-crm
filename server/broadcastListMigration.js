/**
 * רשימות התפוצה הקנוניות. ההיסטוריה בקצרה:
 *
 * ארבע רשימות נושא ישנות (כללי, חוגים, טיולים, אירועים) קופלו לשתיים —
 * תפעולי ושיווקי — כי אף אחת מהן לא ענתה על השאלה המשפטית «מותר לפרסם לאדם
 * הזה». ב-2026-08 הבעלים ביקש לפרק את «שיווקי» חזרה לנושאים: לקוח שרוצה
 * לשמוע על טיולים אבל לא על קייטנות צריך דרך להגיד את זה. הפעם ההסכמה
 * נשמרת נכונה: מפתח marketing (עם ההסרות שנרשמו בו) נשאר, רק בשם חדש,
 * ורשימות הנושא החדשות מתחילות עם כולם רשומים — מסירים את עצמם מי שרוצה.
 *
 * ההגדרות כאן הן מקור האמת: אתחול שרת מיישר את השורות השמורות לנוסח הזה.
 * מפתחות חדשים אסור שיתנגשו עם LEGACY_LIST_MAP — מפתח שמופיע שם נמחק בבוט.
 */

export const OPERATIONAL_LIST = 'operational';
export const MARKETING_LIST = 'marketing';

/** Which canonical list an old (pre-2026) key belongs to. */
export const LEGACY_LIST_MAP = Object.freeze({
  classes: OPERATIONAL_LIST,
  general: MARKETING_LIST,
  trips: MARKETING_LIST,
  events: MARKETING_LIST,
});

export const CANONICAL_LIST_DEFS = Object.freeze([
  {
    key: OPERATIONAL_LIST,
    label: 'תפעולי',
    description: 'שינויי שעות, ביטולים ותזכורות',
    color: 'var(--green)',
    icon: 'bell',
    sortOrder: 0,
  },
  {
    key: 'clubs',
    label: 'חוגי טיפוס',
    description: 'פתיחת הרשמה, מקומות אחרונים ועונה חדשה',
    color: 'var(--blue)',
    icon: 'mountain',
    sortOrder: 1,
  },
  {
    key: 'field_trips',
    label: 'טיולים וימי שטח',
    description: 'טיולי טיפוס, ימי סלע ופעילות בשטח',
    color: 'var(--cyan)',
    icon: 'compass',
    sortOrder: 2,
  },
  {
    key: 'camps',
    label: 'קייטנות ומחנות',
    description: 'קייטנות בחופשות ומחנות טיפוס',
    color: 'var(--amber)',
    icon: 'tent',
    sortOrder: 3,
  },
  {
    // המפתח נשאר marketing בכוונה: ההסרות שנרשמו ברשימת «שיווקי» ממשיכות
    // לחול על הרשימה הזאת, וגם דגל marketing_opt_in נגזר ממנה.
    key: MARKETING_LIST,
    label: 'מבצעים ואירועים',
    description: 'מבצעים, ימי הולדת, ערבי טיפוס ועדכונים כלליים',
    color: 'var(--purple)',
    icon: 'party',
    sortOrder: 4,
  },
]);

/** Kept for older imports/tests. */
export const TWO_LIST_DEFS = CANONICAL_LIST_DEFS;

/**
 * Runs while a legacy list is still defined, and is a no-op afterwards — so a
 * later rename of a label by the owner survives every restart.
 */
export async function migrateToTwoBroadcastLists({ database, persist = null } = {}) {
  const defs = database.get('broadcast_list_defs') || [];
  const legacyDefs = defs.filter((row) => Object.hasOwn(LEGACY_LIST_MAP, String(row?.key || '')));
  // Also runs when the wording/colour/icon of a canonical list has changed:
  // these rows are what a customer reads, and a row written by an earlier
  // deploy would otherwise keep serving the old text forever.
  const staleText = CANONICAL_LIST_DEFS.filter((wanted) => {
    const existing = defs.find((row) => String(row?.key || '') === wanted.key);
    return !existing
      || existing.label !== wanted.label
      || (existing.description || '') !== wanted.description
      || (existing.color || '') !== wanted.color
      || (existing.icon || '') !== wanted.icon
      || Number(existing.sortOrder ?? -1) !== wanted.sortOrder;
  });
  if (!legacyDefs.length && !staleText.length) return { defs: 0, parents: 0 };

  // Definitions are keyed by `key`, not `id`, so they go through their own
  // helpers — the generic update/delete match on an id these rows do not have.
  let defsWritten = 0;
  for (const wanted of CANONICAL_LIST_DEFS) {
    // `some`, not `find`, because a second instance running this may already
    // have written the row: inserting again is what put each list on the screen
    // twice.
    const exists = defs.some((row) => String(row?.key || '') === wanted.key);
    if (exists) {
      database.updateBroadcastListDef?.(wanted.key, wanted);
    } else {
      database.insert('broadcast_list_defs', { ...wanted });
    }
    defsWritten += 1;
    if (persist) await persist('broadcast_list_defs', { ...wanted });
  }

  // One answer per parent per new list, decided from whatever they had said.
  const rows = database.get('broadcast_lists') || [];
  const byParent = new Map();
  for (const row of rows) {
    const target = LEGACY_LIST_MAP[String(row?.listName || '')];
    if (!target || !row?.parentId) continue;
    const current = byParent.get(row.parentId) || {};
    if (target === MARKETING_LIST) {
      current[MARKETING_LIST] = current[MARKETING_LIST] === true || row.subscribed === true;
    } else {
      current[OPERATIONAL_LIST] = true;
    }
    byParent.set(row.parentId, current);
  }

  let parentsWritten = 0;
  for (const [parentId, wanted] of byParent) {
    const next = {
      [OPERATIONAL_LIST]: true,
      [MARKETING_LIST]: wanted[MARKETING_LIST] === true,
    };
    for (const [listName, subscribed] of Object.entries(next)) {
      const existing = rows.find((row) => (
        row.parentId === parentId && String(row.listName || '') === listName
      ));
      const saved = existing
        ? database.update('broadcast_lists', existing.id, { ...existing, subscribed })
        : database.insert('broadcast_lists', {
            id: `bl_${parentId}_${listName}`,
            parentId,
            listName,
            subscribed,
          });
      if (saved && persist) await persist('broadcast_lists', saved);
    }
    parentsWritten += 1;
  }

  // The legacy definitions go last, so a crash halfway leaves the migration
  // still needing to run rather than leaving a parent with no lists at all.
  for (const legacy of legacyDefs) {
    database.deleteBroadcastListDef?.(legacy.key);
  }

  return { defs: defsWritten, parents: parentsWritten, retired: legacyDefs.length };
}

/**
 * חד-פעמי (בקשת הבעלים, 2026-08-15): עם המעבר לרשימות נושא — כולם מתחילים
 * רשומים לכל הרשימות, כולל מי שהסיר את עצמו מ«שיווקי» הישנה. ההסרות הישנות
 * נמחקות במודע; מהיום ההסכמה מנוהלת לפי נושא, בקישור האישי או מול הבוט.
 */
export async function freshStartBroadcastSubscriptions({ database, persist = null } = {}) {
  const settings = database.getSettings?.() || {};
  if (settings.broadcastListsFreshStart === '2026-08') return { reset: 0 };

  let reset = 0;
  for (const row of database.get('broadcast_lists') || []) {
    if (row?.subscribed === false) {
      const saved = database.update('broadcast_lists', row.id, { subscribed: true });
      if (saved && persist) await persist('broadcast_lists', saved);
      reset += 1;
    }
  }
  for (const parent of database.get('parents') || []) {
    if (parent?.marketing_opt_in === false) {
      const saved = database.update('parents', parent.id, { marketing_opt_in: true });
      if (saved && persist) await persist('parents', saved);
      reset += 1;
    }
  }
  database.saveSettings?.({ broadcastListsFreshStart: '2026-08' });
  return { reset };
}
