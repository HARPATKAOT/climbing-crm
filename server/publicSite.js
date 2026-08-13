/**
 * Read models for the public marketing site.
 *
 * The site shows live CRM data — upcoming activities, opening hours and class
 * groups — so the owner never maintains a second copy of it. These run on an
 * unauthenticated route, so every function returns an explicit allowlist of
 * fields: no trainer names, no parent contact details, no registrant data.
 */

import { israelDateStr } from './attendanceUtils.js';
import { activeRegistrations, registrationIsOpen, remainingCapacity } from './activityRegistration.js';
import { spotsLeft } from './groupCapacity.js';
import { getGroupDays } from './attendanceUtils.js';

/** Slug the public registration page is served under. */
export function activityPublicSlug(activity) {
  return String(
    activity?.participant_registration_slug || activity?.registration_slug || ''
  ).trim();
}

/**
 * Upcoming activities the owner chose to publish, soonest first.
 *
 * `show_on_site` is a separate opt-in from `registration_enabled`: a private
 * birthday has a registration link the host shares with their own guests, and
 * must never be advertised on the public site just because that link exists.
 * Publishing is therefore opt-in — forgetting the flag hides a trip, which is
 * recoverable; the opposite would expose a customer's private event.
 *
 * A full activity is dropped rather than shown as unavailable — the site is a
 * shop window, and the calendar screen is where staff see the full picture.
 */
export function upcomingPublicActivities(db, { today = israelDateStr(), limit = 24 } = {}) {
  const activities = db.get('activities') || [];
  return activities
    .filter((activity) => {
      if (!activity || activity.cancelled) return false;
      if (!activity.show_on_site) return false;
      if (!activity.registration_enabled) return false;
      if (!activityPublicSlug(activity)) return false;
      const end = String(activity.end_date || activity.date || '');
      if (!end || end < today) return false;
      if (!registrationIsOpen(activity)) return false;
      const remaining = remainingCapacity(activity, activeRegistrations(db, activity.id));
      return remaining == null || remaining > 0;
    })
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))
      || String(a.start_time || '').localeCompare(String(b.start_time || '')))
    .slice(0, limit)
    .map((activity) => {
      const remaining = remainingCapacity(activity, activeRegistrations(db, activity.id));
      const theme = activity.registration_theme || activity.theme || {};
      return {
        name: activity.name || '',
        type: activity.type || 'other',
        date: activity.date || '',
        end_date: activity.end_date || null,
        start_time: activity.start_time || '',
        end_time: activity.end_time || '',
        all_day: !!activity.all_day,
        location: activity.location || '',
        description: activity.description || '',
        price: Number(activity.price) || 0,
        remaining: remaining == null ? null : remaining,
        slug: activityPublicSlug(activity),
        cover_image: theme.cover_image || '',
        accent: theme.accent || '',
      };
    });
}

/**
 * Opening hours live in the calendar as `opening_hours` activities, so the
 * owner sets them where they already work. A day with no entry is closed —
 * the wall's hours genuinely move with the season and the weather, so an
 * absent entry is a real answer, not missing data.
 */
export function upcomingOpeningHours(db, { today = israelDateStr(), days = 14 } = {}) {
  const activities = db.get('activities') || [];
  const open = new Map();
  for (const activity of activities) {
    if (!activity || activity.cancelled) continue;
    if (activity.type !== 'opening_hours') continue;
    // Draft hours stay on the internal calendar, but must not reach either the
    // public site or the bot (which reads this same function).
    if (activity.status === 'draft') continue;
    const date = String(activity.date || '');
    if (!date || date < today) continue;
    if (!open.has(date)) open.set(date, []);
    open.get(date).push({
      start_time: activity.all_day ? '' : (activity.start_time || ''),
      end_time: activity.all_day ? '' : (activity.end_time || ''),
      all_day: !!activity.all_day,
      note: activity.name || '',
    });
  }

  const out = [];
  const cursor = new Date(`${today}T12:00:00`);
  for (let i = 0; i < days; i += 1) {
    const date = israelDateStr(cursor);
    const slots = (open.get(date) || []).sort(
      (a, b) => String(a.start_time || '').localeCompare(String(b.start_time || ''))
    );
    out.push({ date, open: slots.length > 0, slots });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/**
 * Class groups for the site. Deliberately omits `trainer`, `waParents` and
 * `waClimbers` — staff and private-group data that must not leak onto a public
 * page — and **prices**: the business does not quote figures on self-serve
 * channels (the bot carries the same rule), so they never leave the server.
 */
export function publicGroups(db) {
  const students = db.get('students') || [];
  return (db.get('groups') || [])
    .slice()
    .sort((a, b) => Number(a.day) - Number(b.day)
      || String(a.time || '').localeCompare(String(b.time || '')))
    .map((group) => {
      const free = spotsLeft(group, students);
      return {
        id: group.id,
        name: group.name || '',
        day: Number(group.day),
        // A group can meet twice a week ("— ב׳+ה׳"); the site must show it on
        // every one of its days, not only the one stored in `day`.
        days: getGroupDays(group),
        time: group.time || '',
        duration: Number(group.duration) || null,
        age_category: group.ageCategory || '',
        // Unknown capacity is not a closed door: the site says nothing rather
        // than turning a family away on an invented number.
        has_room: free === null ? true : free > 0,
        capacity_known: free !== null,
      };
    });
}
