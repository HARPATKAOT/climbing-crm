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

export function ListIcon({ icon, size = 15, color, style }) {
  const Icon = (LIST_ICONS[icon] || LIST_ICONS.megaphone).component;
  return <Icon size={size} style={{ color: color || 'currentColor', flexShrink: 0, ...style }} />;
}
