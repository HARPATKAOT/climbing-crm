import { studentGroupIds } from './studentGroups.js';

const ACTIVE_WAITLIST_STATUSES = new Set(['waiting', 'offered', 'paused_after_acceptance']);

export function activeWaitlists(lifecycle = {}) {
  return (lifecycle.waitlists || []).filter((entry) => ACTIVE_WAITLIST_STATUSES.has(String(entry.status)));
}

export function deriveGroupPlacement(student, lifecycle = {}) {
  const placements = deriveGroupPlacements(student, lifecycle);
  const priority = ['hold', 'fixed', 'waitlist'];
  const mode = priority.find((candidate) => Object.values(placements).includes(candidate)) || 'none';
  return {
    mode,
    groupIds: Object.entries(placements).filter(([, value]) => value === mode).map(([groupId]) => groupId),
  };
}

export function deriveGroupPlacements(student, lifecycle = {}) {
  const placements = {};
  const holds = Array.isArray(lifecycle.holds) && lifecycle.holds.length
    ? lifecycle.holds
    : (lifecycle.hold ? [lifecycle.hold] : []);
  const heldIds = new Set();
  for (const hold of holds) {
    if (hold?.status && hold.status !== 'active') continue;
    for (const groupId of hold?.group_ids || []) {
      heldIds.add(String(groupId));
      placements[String(groupId)] = 'hold';
    }
  }
  for (const groupId of studentGroupIds(student)) {
    if (!heldIds.has(String(groupId))) placements[String(groupId)] = 'fixed';
  }
  for (const entry of activeWaitlists(lifecycle)) {
    const groupId = String(entry.group_id || '');
    if (groupId && !placements[groupId]) placements[groupId] = 'waitlist';
  }
  return placements;
}
