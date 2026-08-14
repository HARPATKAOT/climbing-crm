import { studentGroupIds } from './studentGroups.js';

const ACTIVE_WAITLIST_STATUSES = new Set(['waiting', 'offered', 'paused_after_acceptance']);

export function activeWaitlists(lifecycle = {}) {
  return (lifecycle.waitlists || []).filter((entry) => ACTIVE_WAITLIST_STATUSES.has(String(entry.status)));
}

export function deriveGroupPlacement(student, lifecycle = {}) {
  const hold = lifecycle.hold || null;
  if (hold?.status === 'active' || (hold && !hold.status)) {
    return {
      mode: 'hold',
      groupIds: [...new Set((hold.group_ids || []).map(String))],
    };
  }
  const groupIds = studentGroupIds(student);
  if (groupIds.length) {
    return { mode: 'fixed', groupIds };
  }
  const waitlists = activeWaitlists(lifecycle);
  if (waitlists.length) {
    return {
      mode: 'waitlist',
      groupIds: [...new Set(waitlists.map((entry) => String(entry.group_id)).filter(Boolean))],
    };
  }
  return { mode: 'none', groupIds: [] };
}
