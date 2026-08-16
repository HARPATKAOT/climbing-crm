import React from 'react';
import { Bell, Mountain, Compass, Tent, PartyPopper, Megaphone } from 'lucide-react';

/**
 * אייקון לכל רשימת תפוצה. המפתח נשמר על הגדרת הרשימה בשרת (שדה `icon`),
 * וכל מסך שמציג רשימות — בוחר הקהל, מודל העריכה, דף ההעדפות הציבורי —
 * מצייר מכאן, כדי שהרשימה תיראה אותו דבר בכל מקום.
 */
export const LIST_ICONS = {
  bell: { component: Bell, label: 'פעמון' },
  mountain: { component: Mountain, label: 'הר' },
  compass: { component: Compass, label: 'מצפן' },
  tent: { component: Tent, label: 'אוהל' },
  party: { component: PartyPopper, label: 'חגיגה' },
  megaphone: { component: Megaphone, label: 'מגפון' },
};

/**
 * צבעי הרשימות נשמרים בשרת כמשתני CSS של האפליקציה («var(--green)»).
 * בעמודים ציבוריים המשתנים האלה לא קיימים — כאן הם מקובעים לערכים עצמם.
 */
const VAR_COLOR_HEX = {
  'var(--blue)': '#38BDF8',
  'var(--green)': '#34D399',
  'var(--amber)': '#FBBF24',
  'var(--purple)': '#A78BFA',
  'var(--cyan)': '#2DD4BF',
  'var(--red)': '#F87171',
  'var(--pink)': '#F472B6',
};

export function listColorHex(color) {
  const key = String(color || '').trim();
  return VAR_COLOR_HEX[key] || key || '#38BDF8';
}

export function ListIcon({ icon, size = 15, color, style }) {
  const Icon = (LIST_ICONS[icon] || LIST_ICONS.megaphone).component;
  const resolved = color ? listColorHex(color) : 'currentColor';
  return <Icon size={size} style={{ color: resolved, flexShrink: 0, ...style }} />;
}
