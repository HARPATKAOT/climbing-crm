/**
 * Refining the customer table beyond the status tabs: intake date, lead source
 * and group.
 *
 * These run on the finished household rows, not on single students, so what the
 * filter answers is exactly what the row shows — the intake date in the column
 * is the household's earliest, and the group chips are the whole family's.
 * Filtering per student would hide a row whose displayed date or group still
 * matched, which reads as the table lying.
 */
import { studentGroupIds } from './studentGroups.js';

export const EMPTY_LEAD_FILTERS = {
  from: '',
  to: '',
  source: '',
  groupId: '',
};

/** Local calendar date as YYYY-MM-DD — the same shape the rows store. */
function isoDay(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return isoDay(date);
}

function startOfMonth() {
  const date = new Date();
  return isoDay(new Date(date.getFullYear(), date.getMonth(), 1));
}

function startOfYear() {
  return isoDay(new Date(new Date().getFullYear(), 0, 1));
}

/**
 * Ready-made ranges for the common questions ("who came in this month?").
 * Each returns the range fresh, so a tab left open overnight still means today.
 */
export const DATE_PRESETS = [
  { key: 'last7', label: '7 ימים', range: () => ({ from: daysAgo(7), to: '' }) },
  { key: 'last30', label: '30 יום', range: () => ({ from: daysAgo(30), to: '' }) },
  { key: 'month', label: 'החודש', range: () => ({ from: startOfMonth(), to: '' }) },
  { key: 'last90', label: '3 חודשים', range: () => ({ from: daysAgo(90), to: '' }) },
  { key: 'year', label: 'השנה', range: () => ({ from: startOfYear(), to: '' }) },
];

export function matchingPresetKey(filters) {
  if (!filters?.from) return '';
  const found = DATE_PRESETS.find((preset) => {
    const range = preset.range();
    return range.from === filters.from && (range.to || '') === (filters.to || '');
  });
  return found?.key || '';
}

/** Intake date of a row, normalised — rows may carry a full timestamp. */
function rowIntakeDay(row) {
  const raw = row?.created || '';
  return String(raw).slice(0, 10);
}

/**
 * A household's sources: the parent card's, and each trainee's own. A family
 * that arrived through Instagram and later registered for a trip matches both.
 */
function rowSources(row) {
  const values = [
    ...(row?.parents || []).map((parent) => parent?.source),
    ...(row?.students || []).map((student) => student?.source),
  ];
  return new Set(values.filter(Boolean).map((value) => String(value)));
}

function rowGroupIds(row) {
  const ids = (row?.students || []).flatMap((student) => studentGroupIds(student));
  return new Set(ids.map((id) => String(id)));
}

/** How many dimensions are narrowing the table — the badge on the filter button. */
export function countActiveLeadFilters(filters) {
  if (!filters) return 0;
  let count = 0;
  if (filters.from || filters.to) count += 1;
  if (filters.source) count += 1;
  if (filters.groupId) count += 1;
  return count;
}

export function hasActiveLeadFilters(filters) {
  return countActiveLeadFilters(filters) > 0;
}

export function applyLeadFilters(rows, filters) {
  if (!hasActiveLeadFilters(filters)) return rows;
  const { from, to, source, groupId } = filters;

  return (rows || []).filter((row) => {
    if (from || to) {
      const day = rowIntakeDay(row);
      // A row with no intake date on file can't be shown to satisfy a date
      // question — it would be a guess, and the column beside it is empty.
      if (!day) return false;
      if (from && day < from) return false;
      if (to && day > to) return false;
    }

    if (source && !rowSources(row).has(source)) return false;

    if (groupId) {
      const ids = rowGroupIds(row);
      if (groupId === 'none') {
        if (ids.size > 0) return false;
      } else if (!ids.has(String(groupId))) {
        return false;
      }
    }

    return true;
  });
}
