import { useEffect, useState } from 'react';

/**
 * Reads for the marketing site. Everything the site shows about activities,
 * classes and opening hours comes from the CRM, so the owner keeps one source
 * of truth — the calendar they already work in.
 */
export function usePublicData(path, key) {
  const [state, setState] = useState({ data: null, loading: true, error: '' });

  useEffect(() => {
    let live = true;
    fetch(path)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((json) => live && setState({ data: json[key] ?? null, loading: false, error: '' }))
      .catch(() => live && setState({ data: null, loading: false, error: 'load-failed' }));
    return () => { live = false; };
  }, [path, key]);

  return state;
}

export const useActivities = () => usePublicData('/api/public/activities', 'activities');
export const useOpeningHours = () => usePublicData('/api/public/opening-hours', 'days');
export const useGroups = () => usePublicData('/api/public/groups', 'groups');

export const WHATSAPP_NUMBER = '972515862878';
export const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}`;
export function whatsappUrl(message = '') {
  const text = String(message || '').trim();
  return text ? `${WHATSAPP_URL}?text=${encodeURIComponent(text)}` : WHATSAPP_URL;
}
export const FACEBOOK_URL = 'https://www.facebook.com/kirboaz';
export const INSTAGRAM_URL = 'https://www.instagram.com/kir_boaz/';
export const ADDRESS = 'השקד 1, תל מונד';
export const MAP_QUERY = encodeURIComponent('קיר בועז, השקד 1, תל מונד');

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** «היום», «מחר», then the weekday — how people actually read a schedule. */
export function dayLabel(isoDate, todayIso) {
  if (isoDate === todayIso) return 'היום';
  const today = new Date(`${todayIso}T12:00:00`);
  today.setDate(today.getDate() + 1);
  if (isoDate === today.toISOString().slice(0, 10)) return 'מחר';
  return DAY_NAMES[new Date(`${isoDate}T12:00:00`).getDay()];
}

export function shortDate(isoDate) {
  if (!isoDate) return '';
  const d = new Date(`${isoDate}T12:00:00`);
  return `${d.getDate()}.${d.getMonth() + 1}`;
}

export function weekdayName(dayIndex) {
  return DAY_NAMES[Number(dayIndex)] || '';
}

export function formatSlot(slot) {
  if (slot.all_day) return slot.note || 'פתוח כל היום';
  if (slot.start_time && slot.end_time) return `${slot.start_time}–${slot.end_time}`;
  return slot.start_time || slot.end_time || 'פתוח';
}

export const ACTIVITY_TYPE_LABELS = {
  trip: 'טיול שטח',
  birthday: 'יום הולדת',
  school: 'בית ספר',
  company: 'חברה',
  route_building: 'בניית מסלולים',
  opening_hours: 'שעות פתיחה',
  training_vacation: 'חופשה',
  other: 'פעילות',
};
