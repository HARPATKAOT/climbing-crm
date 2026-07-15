// Central data store - mock data that mimics a real DB
// Will be replaced with actual Supabase calls later

export const STATUSES = {
  lead_new:         { label: 'ליד חדש', badge: 'badge-blue',   color: '#818CF8' },
  health_signed:    { label: 'חתם הצהרה', badge: 'badge-amber',  color: '#FCD34D' },
  intro_scheduled:  { label: 'נקבע אימון הכירות', badge: 'badge-cyan',  color: '#67E8F9' },
  intro_paid:       { label: 'שילם - ממתין להכירות', badge: 'badge-purple', color: '#C084FC' },
  registered:       { label: 'חוג פעיל', badge: 'badge-green',  color: '#34D399' },
  waitlist:         { label: 'רשימת המתנה', badge: 'badge-gray',   color: '#9DA5BE' },
  archived:         { label: 'ארכיון', badge: 'badge-gray',   color: '#5A6380' },
};

export const DAYS_HEB = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳'];
export const DAYS_FULL = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];

export const mockParents = [
  { id: 'p1', name: 'מיכל לוי', phone: '0521234567', email: 'michal@gmail.com' },
  { id: 'p2', name: 'דוד כהן', phone: '0549876543', email: 'david@gmail.com' },
  { id: 'p3', name: 'שירה מזרחי', phone: '0505555555', email: 'shira@gmail.com' },
  { id: 'p4', name: 'נמרוד שמר', phone: '0582222333', email: 'nimrod@gmail.com' },
  { id: 'p5', name: 'רחל גולן', phone: '0527890123', email: 'rachel@gmail.com' },
];

// ─── Real groups imported from Notion (fetched 2026-07-08) ───────────────────
// day: 0=ראשון, 1=שני, 2=שלישי, 3=רביעי, 4=חמישי, 5=שישי
export const mockGroups = [
  // ── ראשון ───────────────────────────────────────────────────────────────────
  {
    id: 'g-48775fd8', notionId: '48775fd8-5ed8-479d-a1e8-c42e801f0ba0',
    name: "כיתות ג'-ד' — יום א׳ 15:30",
    day: 0, time: '15:30', duration: 50, trainer: '',
    maxSlots: 11, enrolled: 0, ageCategory: "ג'-ד'",
    priceWeek: 280, priceTwice: 360,
    waParents: '',
    waClimbers: '',
  },
  {
    id: 'g-f0bc07f0', notionId: 'f0bc07f0-aed3-4db3-8d37-e65f8b3c3b05',
    name: "כיתות ה'-ו' — יום א׳ 16:30",
    day: 0, time: '16:30', duration: 50, trainer: '',
    maxSlots: 12, enrolled: 0, ageCategory: "ה'-ו'",
    priceWeek: 260, priceTwice: 360,
    waParents: 'https://chat.whatsapp.com/Lwm3gC3zrfuIRUVC0VSolp',
    waClimbers: '',
  },
  {
    id: 'g-9b5f1891', notionId: '9b5f1891-2793-485b-99f3-e0958072804b',
    name: "ילדים ג'-ד' — יום א׳ 17:30",
    day: 0, time: '17:30', duration: 50, trainer: '',
    maxSlots: 11, enrolled: 0, ageCategory: "ג'-ד'",
    priceWeek: 280, priceTwice: 360,
    waParents: '',
    waClimbers: '',
  },
  {
    id: 'g-cf7a413e', notionId: 'cf7a413e-7bb4-4d2a-842c-e40224af30b7',
    name: 'חטיבה — יום א׳ 18:40',
    day: 0, time: '18:40', duration: 80, trainer: '',
    maxSlots: 12, enrolled: 0, ageCategory: 'חטיבה',
    priceWeek: 305, priceTwice: 420,
    waParents: 'https://chat.whatsapp.com/DPqRRjNdEwqKEbkEVHlvcG',
    waClimbers: 'https://chat.whatsapp.com/JwfMVZUnpUIDK1FX0KLz8q',
  },
  {
    id: 'g-9dfcc000', notionId: '9dfcc000-789f-48f8-ae00-517b9229c9d3',
    name: "בוגרים — יום א׳ 20:10",
    day: 0, time: '20:10', duration: 80, trainer: '',
    maxSlots: 12, enrolled: 0, ageCategory: 'בוגרים',
    priceWeek: 305, priceTwice: 420,
    waParents: '',
    waClimbers: '',
  },

  // ── שלישי ────────────────────────────────────────────────────────────────────
  {
    id: 'g-165dbd26', notionId: '165dbd26-2780-4c5a-9776-d79b034dd11c',
    name: "הורים וילדים — יום ג׳ 17:10",
    day: 2, time: '17:10', duration: 50, trainer: '',
    maxSlots: 9, enrolled: 0, ageCategory: "א'-ב'",
    priceWeek: 290, priceTwice: 0,
    waParents: 'https://chat.whatsapp.com/CwafATne3ChDTlNYtZcytV',
    waClimbers: '',
  },
  {
    id: 'g-ea56ee32', notionId: 'ea56ee32-b3a7-4756-a380-2658a759729f',
    name: "הורים וילדים — יום ג׳ 18:10",
    day: 2, time: '18:10', duration: 50, trainer: '',
    maxSlots: 9, enrolled: 0, ageCategory: "א'-ב'",
    priceWeek: 290, priceTwice: 0,
    waParents: 'https://chat.whatsapp.com/JBrnGLBCLTL9FbIGhLmFz3',
    waClimbers: '',
  },
  {
    id: 'g-993c2022', notionId: '993c2022-fb77-44b6-b53e-4ffd31940e12',
    name: "ילדים ג'-ד' — יום ג׳ 15:00",
    day: 2, time: '15:00', duration: 50, trainer: '',
    maxSlots: 11, enrolled: 0, ageCategory: "ג'-ד'",
    priceWeek: 280, priceTwice: 0,
    waParents: 'https://chat.whatsapp.com/L6FpOJUnoOIGQX9XhFL0Wk',
    waClimbers: '',
  },
  {
    id: 'g-726d5612', notionId: '726d5612-9a9f-4809-8088-1bd9d1da46a3',
    name: "ילדים ג'-ד' — יום ג׳ 16:00",
    day: 2, time: '16:00', duration: 50, trainer: '',
    maxSlots: 11, enrolled: 0, ageCategory: "ג'-ד'",
    priceWeek: 280, priceTwice: 0,
    waParents: 'https://chat.whatsapp.com/EJ5rIWENKAA5kxmLYkUAJN',
    waClimbers: '',
  },

  // ── רביעי ────────────────────────────────────────────────────────────────────
  {
    id: 'g-48775fd8-d', notionId: '33268fb8-0f80-41b9-99f6-c94a9dd9c4ea',
    name: "כיתות ג'-ד' — יום ד׳ 15:30",
    day: 3, time: '15:30', duration: 50, trainer: '',
    maxSlots: 11, enrolled: 0, ageCategory: "ג'-ד'",
    priceWeek: 280, priceTwice: 360,
    waParents: 'https://chat.whatsapp.com/LdHhvHhE9cSEskgQG7KCBj',
    waClimbers: '',
  },
  {
    id: 'g-53d1483e', notionId: '53d1483e-f601-4e05-8345-75ca193652f6',
    name: "כיתות ה'-ו' — יום ד׳ 16:30",
    day: 3, time: '16:30', duration: 50, trainer: '',
    maxSlots: 12, enrolled: 0, ageCategory: "ה'-ו'",
    priceWeek: 260, priceTwice: 360,
    waParents: 'https://chat.whatsapp.com/E5dtW6roMh6GUyecxyibc0',
    waClimbers: '',
  },
  {
    id: 'g-b2da9ca1', notionId: 'b2da9ca1-cf6f-4888-a721-1b041f964dfe',
    name: "ילדים ג'-ד' — יום ד׳ 17:30",
    day: 3, time: '17:30', duration: 50, trainer: '',
    maxSlots: 11, enrolled: 0, ageCategory: "ג'-ד'",
    priceWeek: 280, priceTwice: 360,
    waParents: 'https://chat.whatsapp.com/E41RU70lyzJ4xDrvrMlXwW',
    waClimbers: '',
  },
  {
    id: 'g-b5e58aa6', notionId: 'b5e58aa6-2a7f-4448-8e63-425ca4d4263e',
    name: "חטיבה — יום ד׳ 18:40",
    day: 3, time: '18:40', duration: 80, trainer: '',
    maxSlots: 12, enrolled: 0, ageCategory: 'חטיבה',
    priceWeek: 305, priceTwice: 420,
    waParents: 'https://chat.whatsapp.com/DPqRRjNdEwqKEbkEVHlvcG',
    waClimbers: 'https://chat.whatsapp.com/JwfMVZUnpUIDK1FX0KLz8q',
  },
  {
    id: 'g-4012bf2e', notionId: '4012bf2e-2fed-4b26-bd9d-16051ddba008',
    name: "בוגרים — יום ד׳ 20:10",
    day: 3, time: '20:10', duration: 80, trainer: '',
    maxSlots: 12, enrolled: 0, ageCategory: 'בוגרים',
    priceWeek: 305, priceTwice: 420,
    waParents: 'https://chat.whatsapp.com/KQDVxQC7YPBLvZJOXu5WTr',
    waClimbers: '',
  },

  // ── חמישי (+ שני) ────────────────────────────────────────────────────────────
  {
    id: 'g-02d0c7cf-b', notionId: '02d0c7cf-c275-446e-8051-e0ca23567e47',
    name: "מתקדמים ה'-ו' — ב׳+ה׳ 15:30",
    day: 1, time: '15:30', duration: 80, trainer: '',
    maxSlots: 13, enrolled: 0, ageCategory: "ה'-ו'",
    priceWeek: 0, priceTwice: 420,
    waParents: 'https://chat.whatsapp.com/KQDVxQC7YPBLvZJOXu5WTr',
    waClimbers: 'https://chat.whatsapp.com/CbHECN5brUcGiiiLMVulxZ',
  },
  {
    id: 'g-02d0c7cf', notionId: '02d0c7cf-c275-446e-8051-e0ca23567e47',
    name: "מתקדמים ה'-ו' — ב׳+ה׳ 15:30",
    day: 4, time: '15:30', duration: 80, trainer: '',
    maxSlots: 13, enrolled: 0, ageCategory: "ה'-ו'",
    priceWeek: 0, priceTwice: 420,
    waParents: 'https://chat.whatsapp.com/KQDVxQC7YPBLvZJOXu5WTr',
    waClimbers: 'https://chat.whatsapp.com/CbHECN5brUcGiiiLMVulxZ',
  },
  {
    id: 'g-c5aece01', notionId: 'c5aece01-6427-4f4d-9ce1-c1947e2c6fba',
    name: 'נבחרת צעירה — ה׳ 17:00',
    day: 4, time: '17:00', duration: 110, trainer: '',
    maxSlots: 13, enrolled: 0, ageCategory: 'חטיבה',
    priceWeek: 550, priceTwice: 550,
    waParents: 'https://chat.whatsapp.com/KX1HoM5PYqb2Fz7TH8j1aJ',
    waClimbers: '',
  },
  {
    id: 'g-529e08f6', notionId: '529e08f6-fcae-4294-87cb-08e5b77d0f83',
    name: 'נבחרת בוגרת — ה׳ 19:10',
    day: 4, time: '19:10', duration: 110, trainer: '',
    maxSlots: 13, enrolled: 0, ageCategory: 'תיכון',
    priceWeek: 0, priceTwice: 550,
    waParents: 'https://chat.whatsapp.com/HasZy575i5XAtUVLPfOyX4',
    waClimbers: 'https://chat.whatsapp.com/LGg0ekCjQr10S1PkmA9OcK',
  },
];

export const mockStudents = [
  { id: 's1', name: 'עומרי לוי', parentId: 'p1', groupId: 'g-48775fd8', status: 'lead_new', birthDate: '2017-03-12', notes: '', levelGrade: null, created: '2026-07-08' },
  { id: 's2', name: 'נועה לוי', parentId: 'p1', groupId: null, status: 'lead_new', birthDate: '2015-07-22', notes: 'אחות של עומרי', levelGrade: null, created: '2026-07-08' },
  { id: 's3', name: 'רוני כהן', parentId: 'p2', groupId: 'g-993c2022', status: 'health_signed', birthDate: '2014-01-05', notes: '', levelGrade: '5C', created: '2026-07-07' },
  { id: 's4', name: 'גיל מזרחי', parentId: 'p3', groupId: 'g-53d1483e', status: 'intro_scheduled', birthDate: '2013-11-15', notes: 'ניסיון קודם בטיפוס', levelGrade: null, created: '2026-07-06' },
  { id: 's5', name: 'עברי שמר', parentId: 'p4', groupId: 'g-cf7a413e', status: 'registered', birthDate: '2012-04-20', notes: 'רשום לחוג בוגרים', levelGrade: '6B', created: '2026-07-05' },
  { id: 's6', name: 'תמר גולן', parentId: 'p5', groupId: 'g-165dbd26', status: 'registered', birthDate: '2016-09-30', notes: '', levelGrade: '5A', created: '2026-07-01' },
];

export const mockEmployees = [
  { id: 'e1', name: 'עידו בן דוד', role: 'trainer', phone: '0521111111', clockedIn: true, clockInTime: '08:45' },
  { id: 'e2', name: 'ליאת שניר', role: 'trainer', phone: '0522222222', clockedIn: false, clockInTime: null },
  { id: 'e3', name: 'יובל כץ', role: 'safety_officer', phone: '0523333333', clockedIn: true, clockInTime: '09:10' },
];

export const mockSafetyChecklist = [
  { id: 'sc1', label: 'בדיקת עמדות חיבור ובולטים', category: 'ציוד', critical: true },
  { id: 'sc2', label: 'בדיקת רשתות ומחצלות נחיתה', category: 'ציוד', critical: true },
  { id: 'sc3', label: 'בדיקת כבלי ועמדות הרמה', category: 'מבנה', critical: true },
  { id: 'sc4', label: 'ניקיון ויבוש רצפות', category: 'היגיינה', critical: false },
  { id: 'sc5', label: 'בדיקת ציוד מגן (קסדות, ארנסים)', category: 'ציוד', critical: true },
  { id: 'sc6', label: 'בדיקת גנרטור חירום', category: 'מבנה', critical: false },
  { id: 'sc7', label: 'נוהל פינוי חירום מוצג בולט', category: 'בטיחות', critical: true },
];

export const mockActivities = [
  { id: 'a1', type: 'whatsapp', title: 'הצהרת בריאות נשלחה', desc: 'עומרי לוי - מיכל לוי', time: 'לפני 5 דק׳' },
  { id: 'a2', type: 'doc', title: 'הצהרת בריאות נחתמה', desc: 'רוני כהן ← דוד כהן', time: 'לפני שעתיים' },
  { id: 'a3', type: 'payment', title: 'תשלום התקבל - iCount', desc: 'עברי שמר — ₪420', time: 'אתמול 18:30' },
  { id: 'a4', type: 'cash', title: 'קופה נסגרה ✓', desc: 'עידו בן דוד — ₪850 מזומן, ללא חריגה', time: 'אתמול 15:00' },
  { id: 'a5', type: 'lead', title: 'ליד חדש הגיע מוואטסאפ', desc: 'מספר: 054-9999999 — ממתין לאישור', time: 'אתמול 11:22' },
];
