import { getSortedGroupDays } from './attendanceUtils.js';

export const GROUP_META_COLLECTION = 'group_bot_meta';

function cleanDays(value = []) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(Number)
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    .sort((a, b) => a - b);
}

export function groupMetaRows(db) {
  const rows = db?.get?.(GROUP_META_COLLECTION);
  return Array.isArray(rows) ? rows : [];
}

export function groupMetaFor(db, groupId) {
  return groupMetaRows(db).find((row) => String(row.id) === String(groupId)) || null;
}

/** Add bot-owned fields without adding columns to the locked groups table. */
export function enrichGroupWithBotMeta(db, group) {
  if (!group) return group;
  const meta = groupMetaFor(db, group.id) || {};
  const explicit = cleanDays(meta.trainingDays || meta.training_days);
  const legacy = cleanDays(getSortedGroupDays({ ...group, trainingDays: [] }));
  return {
    ...group,
    trainingDays: explicit.length ? explicit : legacy,
    returningPriorityUntil:
      meta.returningPriorityUntil || meta.returning_priority_until || null,
  };
}

export function enrichGroupsWithBotMeta(db, groups = []) {
  return (Array.isArray(groups) ? groups : []).map((group) => enrichGroupWithBotMeta(db, group));
}

export async function saveGroupBotMeta(db, persist, groupId, patch = {}) {
  const id = String(groupId || '').trim();
  if (!id || !db?.getOne?.('groups', id)) return null;
  const existing = groupMetaFor(db, id);
  const now = new Date().toISOString();
  const next = {
    id,
    trainingDays: cleanDays(patch.trainingDays ?? existing?.trainingDays),
    returningPriorityUntil:
      patch.returningPriorityUntil === undefined
        ? (existing?.returningPriorityUntil || null)
        : (String(patch.returningPriorityUntil || '').slice(0, 10) || null),
    created_at: existing?.created_at || now,
    updated_at: now,
  };
  const saved = existing
    ? db.update(GROUP_META_COLLECTION, id, next)
    : db.insert(GROUP_META_COLLECTION, next);
  if (saved && typeof persist === 'function') await persist(GROUP_META_COLLECTION, saved);
  return saved;
}

/** Seed known twice-weekly groups from their existing names, once and safely. */
export async function backfillCanonicalTrainingDays(db, persist) {
  const changed = [];
  for (const group of db?.get?.('groups') || []) {
    if (!group?.id || groupMetaFor(db, group.id)?.trainingDays?.length) continue;
    const days = cleanDays(getSortedGroupDays({ ...group, trainingDays: [] }));
    if (!days.length) continue;
    const saved = await saveGroupBotMeta(db, persist, group.id, { trainingDays: days });
    if (saved) changed.push(saved);
  }
  return changed;
}
