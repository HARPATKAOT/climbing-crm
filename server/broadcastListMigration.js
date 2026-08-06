/**
 * From four topic lists to two: תפעולי and שיווקי.
 *
 * The old lists — כללי, חוגים, טיולים, אירועים — asked a parent to sort our
 * content into topics, and none of them answered the only question that matters
 * in practice: may we advertise to this person. The two that replace them are
 * the same distinction the law draws, so a subscription now means something.
 *
 * Existing answers are carried across rather than reset: anyone who had said
 * yes to any of the marketing-shaped lists keeps saying yes, and the operational
 * list is on for everyone because it is part of being served at all.
 */

export const OPERATIONAL_LIST = 'operational';
export const MARKETING_LIST = 'marketing';

/** Which of the two new lists an old key belongs to. */
export const LEGACY_LIST_MAP = Object.freeze({
  classes: OPERATIONAL_LIST,
  general: MARKETING_LIST,
  trips: MARKETING_LIST,
  events: MARKETING_LIST,
});

export const TWO_LIST_DEFS = Object.freeze([
  {
    key: OPERATIONAL_LIST,
    label: 'תפעולי',
    description: 'שינויי שעות, ביטולים, תזכורות, מידע קריטי לפעילות שנרשמת אליה',
    color: 'var(--green)',
    sortOrder: 0,
  },
  {
    key: MARKETING_LIST,
    label: 'שיווקי',
    description: 'טיולים חדשים, טיפים, מבצעים, עדכונים כלליים',
    color: 'var(--amber)',
    sortOrder: 1,
  },
]);

/**
 * Runs while a legacy list is still defined, and is a no-op afterwards — so a
 * later rename of a label by the owner survives every restart.
 */
export async function migrateToTwoBroadcastLists({ database, persist = null } = {}) {
  const defs = database.get('broadcast_list_defs') || [];
  const legacyDefs = defs.filter((row) => Object.hasOwn(LEGACY_LIST_MAP, String(row?.key || '')));
  const missingNew = TWO_LIST_DEFS.filter((wanted) => (
    !defs.some((row) => String(row?.key || '') === wanted.key)
  ));
  if (!legacyDefs.length && !missingNew.length) return { defs: 0, parents: 0 };

  // Definitions are keyed by `key`, not `id`, so they go through their own
  // helpers — the generic update/delete match on an id these rows do not have.
  let defsWritten = 0;
  for (const wanted of TWO_LIST_DEFS) {
    const existing = defs.find((row) => String(row?.key || '') === wanted.key);
    if (existing) {
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
