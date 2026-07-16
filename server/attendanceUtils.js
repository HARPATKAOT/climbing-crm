// Server-side attendance helpers (mirror client scheduleUtils for ensure logic)

const HEB_DAY_IDX = { א: 0, ב: 1, ג: 2, ד: 3, ה: 4, ו: 5 };

export function getGroupDays(group) {
  const m = (group?.name || '').match(/([א-ו])['׳’]?\s*\+\s*([א-ו])['׳’]?/);
  if (m) {
    const days = [HEB_DAY_IDX[m[1]], HEB_DAY_IDX[m[2]]].filter((d) => d != null);
    if (days.length) return [...new Set([group.day, ...days])].filter((d) => d != null);
  }
  return [group?.day].filter((d) => d != null);
}

/** YYYY-MM-DD in Asia/Jerusalem. */
export function israelDateStr(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function dateToWeekday(dateStr) {
  if (!dateStr) return new Date().getDay();
  const d = new Date(`${dateStr}T12:00:00`);
  return Number.isNaN(d.getTime()) ? new Date().getDay() : d.getDay();
}

export function normalizeAttStatus(status) {
  if (status === 'present' || status === 'late') return 'attended';
  const known = ['pending', 'attended', 'absent', 'intro_attended', 'intro_absent'];
  if (known.includes(status)) return status;
  return 'pending';
}

/**
 * Ensure pending attendance rows exist for every enrolled student in groups
 * that meet on `date`. Never overwrites existing rows.
 */
export function ensureAttendanceRows({ groups, students, attendance, date, groupId }) {
  const weekday = dateToWeekday(date);
  let targetGroups = (groups || []).filter((g) => {
    if (g.active === false) return false;
    return getGroupDays(g).includes(weekday);
  });
  if (groupId) {
    targetGroups = targetGroups.filter((g) => g.id === groupId);
    // If filtering by groupId, still ensure even if weekday mismatch (manual open)
    if (targetGroups.length === 0) {
      const g = (groups || []).find((x) => x.id === groupId);
      if (g && g.active !== false) targetGroups = [g];
    }
  }

  const existing = attendance || [];
  const keySet = new Set(
    existing.map((r) => `${r.student_id}|${r.group_id}|${r.date}`)
  );

  const created = [];
  for (const g of targetGroups) {
    const members = (students || []).filter(
      (s) => s.groupId === g.id && s.status !== 'archived'
    );
    for (const s of members) {
      const key = `${s.id}|${g.id}|${date}`;
      if (keySet.has(key)) continue;
      const row = {
        id: `att-${g.id}-${date}-${s.id}`,
        student_id: s.id,
        group_id: g.id,
        date,
        status: 'pending',
        marked_by: null,
        notes: '',
      };
      created.push(row);
      keySet.add(key);
    }
  }

  return {
    created,
    existing: existing.length,
    groups: targetGroups.map((g) => g.id),
    date,
  };
}

/** Hour (0-23) in Asia/Jerusalem for cron scheduling. */
export function israelHour(d = new Date()) {
  const h = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: 'numeric',
    hour12: false,
  }).format(d);
  return parseInt(h, 10);
}
