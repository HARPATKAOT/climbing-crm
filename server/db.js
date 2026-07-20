import fs from 'fs';
import path from 'path';
import { supa, CORE_TABLES, OPERATIONAL_TABLES } from './supa.js';

const DB_FILE = path.join(process.cwd(), 'db.json');

export function planDurableHydration(table, remoteRows, localRows = []) {
  if (remoteRows === null) return { mode: 'error', rows: localRows };
  if (OPERATIONAL_TABLES.includes(table)) {
    const remoteIds = new Set(remoteRows.map((record) => String(record.id ?? record.key)));
    const missingLocal = localRows.filter(
      (record) => !remoteIds.has(String(record.id ?? record.key))
    );
    if (missingLocal.length > 0) {
      return {
        mode: 'migrate',
        rows: [...remoteRows, ...missingLocal],
        toMigrate: missingLocal,
      };
    }
  }
  return { mode: 'remote', rows: remoteRows };
}

// Fire-and-forget write-through to Supabase for CRM-core collections.
// Reads stay synchronous (served from the local db.json cache); Supabase is the
// durable store that re-seeds db.json on every server start.
function syncUpsert(table, record) {
  if (record && CORE_TABLES.includes(table)) {
    Promise.resolve(supa.upsert(table, record)).catch((e) =>
      console.error(`syncUpsert(${table}) error:`, e?.message || e)
    );
  }
}

/** Await durable write for CRM-core tables (use on public form submit). */
export async function persistCore(table, record) {
  if (!record || !CORE_TABLES.includes(table)) return { ok: true };
  return supa.upsert(table, record);
}
function syncRemove(table, id) {
  if (CORE_TABLES.includes(table)) {
    Promise.resolve(supa.remove(table, id)).catch((e) =>
      console.error(`syncRemove(${table}) error:`, e?.message || e)
    );
  }
}

// Mock data to seed the database if it doesn't exist
const SEED_DATA = {
  parents: [
    { id: 'p1', name: 'מיכל לוי', phone: '0521234567', email: 'michal@gmail.com' },
    { id: 'p2', name: 'דוד כהן', phone: '0549876543', email: 'david@gmail.com' },
    { id: 'p3', name: 'שירה מזרחי', phone: '0505555555', email: 'shira@gmail.com' },
    { id: 'p4', name: 'נמרוד שמר', phone: '0582222333', email: 'nimrod@gmail.com' },
    { id: 'p5', name: 'רחל גולן', phone: '0527890123', email: 'rachel@gmail.com' },
  ],
  students: [
    { id: 's1', name: 'עומרי לוי', parentId: 'p1', groupId: 'g-48775fd8', status: 'lead_new', birthDate: '2017-03-12', notes: '', levelGrade: null, created: '2026-07-08', created_at: '2026-07-08T14:32:00.000Z' },
    { id: 's2', name: 'נועה לוי', parentId: 'p1', groupId: null, status: 'lead_new', birthDate: '2015-07-22', notes: 'אחות של עומרי', levelGrade: null, created: '2026-07-08', created_at: '2026-07-08T11:05:00.000Z' },
    { id: 's3', name: 'רוני כהן', parentId: 'p2', groupId: 'g-993c2022', status: 'health_signed', birthDate: '2014-01-05', notes: '', levelGrade: '5C', created: '2026-07-07', created_at: '2026-07-07T09:18:00.000Z' },
    { id: 's4', name: 'גיל מזרחי', parentId: 'p3', groupId: 'g-53d1483e', status: 'intro_scheduled', birthDate: '2013-11-15', notes: 'ניסיון קודם בטיפוס', levelGrade: null, created: '2026-07-06', created_at: '2026-07-06T16:40:00.000Z' },
    { id: 's5', name: 'עברי שמר', parentId: 'p4', groupId: 'g-cf7a413e', status: 'registered', birthDate: '2012-04-20', notes: 'רשום לחוג בוגרים', levelGrade: '6B', created: '2026-07-05', created_at: '2026-07-05T10:12:00.000Z' },
    { id: 's6', name: 'תמר גולן', parentId: 'p5', groupId: 'g-165dbd26', status: 'registered', birthDate: '2016-09-30', notes: '', levelGrade: '5A', created: '2026-07-01', created_at: '2026-07-01T13:55:00.000Z' },
  ],
  groups: [
    { id: 'g-48775fd8', name: "כיתות ג'-ד' — יום א׳ 15:30", day: 0, time: '15:30', duration: 50, trainer: '', maxSlots: 11, enrolled: 0, ageCategory: "ג'-ד'", priceWeek: 280, priceTwice: 360, waParents: '', waClimbers: '' },
    { id: 'g-f0bc07f0', name: "כיתות ה'-ו' — יום א׳ 16:30", day: 0, time: '16:30', duration: 50, trainer: '', maxSlots: 12, enrolled: 0, ageCategory: "ה'-ו'", priceWeek: 260, priceTwice: 360, waParents: 'https://chat.whatsapp.com/Lwm3gC3zrfuIRUVC0VSolp', waClimbers: '' },
    { id: 'g-9b5f1891', name: "ילדים ג'-ד' — יום א׳ 17:30", day: 0, time: '17:30', duration: 50, trainer: '', maxSlots: 11, enrolled: 0, ageCategory: "ג'-ד'", priceWeek: 280, priceTwice: 360, waParents: '', waClimbers: '' },
    { id: 'g-cf7a413e', name: 'חטיבה — יום א׳ 18:40', day: 0, time: '18:40', duration: 80, trainer: '', maxSlots: 12, enrolled: 0, ageCategory: 'חטיבה', priceWeek: 305, priceTwice: 420, waParents: 'https://chat.whatsapp.com/DPqRRjNdEwqKEbkEVHlvcG', waClimbers: 'https://chat.whatsapp.com/JwfMVZUnpUIDK1FX0KLz8q' },
    { id: 'g-9dfcc000', name: "בוגרים — יום א׳ 20:10", day: 0, time: '20:10', duration: 80, trainer: '', maxSlots: 12, enrolled: 0, ageCategory: 'בוגרים', priceWeek: 305, priceTwice: 420, waParents: '', waClimbers: '' },
    { id: 'g-165dbd26', name: "הורים וילדים — יום ג׳ 17:10", day: 2, time: '17:10', duration: 50, trainer: '', maxSlots: 9, enrolled: 0, ageCategory: "א'-ב'", priceWeek: 290, priceTwice: 0, waParents: 'https://chat.whatsapp.com/CwafATne3ChDTlNYtZcytV', waClimbers: '' },
    { id: 'g-ea56ee32', name: "הורים וילדים — יום ג׳ 18:10", day: 2, time: '18:10', duration: 50, trainer: '', maxSlots: 9, enrolled: 0, ageCategory: "א'-ב'", priceWeek: 290, priceTwice: 0, waParents: 'https://chat.whatsapp.com/JBrnGLBCLTL9FbIGhLmFz3', waClimbers: '' },
    { id: 'g-993c2022', name: "ילדים ג'-ד' — יום ג׳ 15:00", day: 2, time: '15:00', duration: 50, trainer: '', maxSlots: 11, enrolled: 0, ageCategory: "ג'-ד'", priceWeek: 280, priceTwice: 0, waParents: 'https://chat.whatsapp.com/L6FpOJUnoOIGQX9XhFL0Wk', waClimbers: '' },
    { id: 'g-726d5612', name: "ילדים ג'-ד' — יום ג׳ 16:00", day: 2, time: '16:00', duration: 50, trainer: '', maxSlots: 11, enrolled: 0, ageCategory: "ג'-ד'", priceWeek: 280, priceTwice: 0, waParents: 'https://chat.whatsapp.com/EJ5rIWENKAA5kxmLYkUAJN', waClimbers: '' },
    { id: 'g-48775fd8-d', name: "כיתות ג'-ד' — יום ד׳ 15:30", day: 3, time: '15:30', duration: 50, trainer: '', maxSlots: 11, enrolled: 0, ageCategory: "ג'-ד'", priceWeek: 280, priceTwice: 360, waParents: 'https://chat.whatsapp.com/LdHhvHhE9cSEskgQG7KCBj', waClimbers: '' },
    { id: 'g-53d1483e', name: "כיתות ה'-ו' — יום ד׳ 16:30", day: 3, time: '16:30', duration: 50, trainer: '', maxSlots: 12, enrolled: 0, ageCategory: "ה'-ו'", priceWeek: 260, priceTwice: 360, waParents: 'https://chat.whatsapp.com/E5dtW6roMh6GUyecxyibc0', waClimbers: '' },
    { id: 'g-b2da9ca1', name: "ילדים ג'-ד' — יום ד׳ 17:30", day: 3, time: '17:30', duration: 50, trainer: '', maxSlots: 11, enrolled: 0, ageCategory: "ג'-ד'", priceWeek: 280, priceTwice: 360, waParents: 'https://chat.whatsapp.com/E41RU70lyzJ4xDrvrMlXwW', waClimbers: '' },
    { id: 'g-b5e58aa6', name: "חטיבה — יום ד׳ 18:40", day: 3, time: '18:40', duration: 80, trainer: '', maxSlots: 12, enrolled: 0, ageCategory: 'חטיבה', priceWeek: 305, priceTwice: 420, waParents: 'https://chat.whatsapp.com/DPqRRjNdEwqKEbkEVHlvcG', waClimbers: 'https://chat.whatsapp.com/JwfMVZUnpUIDK1FX0KLz8q' },
    { id: 'g-4012bf2e', name: "בוגרים — יום ד׳ 20:10", day: 3, time: '20:10', duration: 80, trainer: '', maxSlots: 12, enrolled: 0, ageCategory: 'בוגרים', priceWeek: 305, priceTwice: 420, waParents: 'https://chat.whatsapp.com/KQDVxQC7YPBLvZJOXu5WTr', waClimbers: '' },
    { id: 'g-02d0c7cf', name: "מתקדמים ה'-ו' — ב׳+ה׳ 15:30", day: 4, time: '15:30', duration: 80, trainer: '', maxSlots: 13, enrolled: 0, ageCategory: "ה'-ו'", priceWeek: 0, priceTwice: 420, waParents: 'https://chat.whatsapp.com/KQDVxQC7YPBLvZJOXu5WTr', waClimbers: 'https://chat.whatsapp.com/CbHECN5brUcGiiiLMVulxZ' },
    { id: 'g-c5aece01', name: 'נבחרת צעירה — ה׳ 17:00', day: 4, time: '17:00', duration: 110, trainer: '', maxSlots: 13, enrolled: 0, ageCategory: 'חטיבה', priceWeek: 550, priceTwice: 550, waParents: 'https://chat.whatsapp.com/KX1HoM5PYqb2Fz7TH8j1aJ', waClimbers: '' },
    { id: 'g-529e08f6', name: 'נבחרת בוגרת — ה׳ 19:10', day: 4, time: '19:10', duration: 110, trainer: '', maxSlots: 13, enrolled: 0, ageCategory: 'תיכון', priceWeek: 0, priceTwice: 550, waParents: 'https://chat.whatsapp.com/HasZy575i5XAtUVLPfOyX4', waClimbers: 'https://chat.whatsapp.com/LGg0ekCjQr10S1PkmA9OcK' },
  ],
  employees: [],
  whatsapp_settings: {
    metaWaPhoneId: '',
    metaWaAccessToken: '',
    metaWaWabaId: '',
    metaWaBusinessId: '',
    connectedPhoneDisplay: '',
    connectedVerifiedName: '',
    coexistenceEnabled: false,
    isOnBizApp: false,
    connectedAt: null,
    lastConnectEvent: null,
    metaIgAccountId: '',
    metaIgAccessToken: '',
    metaPageId: '',
    metaPageAccessToken: '',
    verifyToken: '',
    aiResponderEnabled: true,
    aiActiveHoursEnabled: false,
    aiActiveHoursStart: '09:00',
    aiActiveHoursEnd: '21:00',
    // 0=ראשון … 6=שבת (אזור זמן ישראל)
    aiActiveDays: [0, 1, 2, 3, 4, 5, 6],
    aiSystemPrompt: 'אתה בוט שירות לקוחות ידידותי של קיר הטיפוס My Wall. ענה בנימוס וקצרות בעברית. שלח קישור להצהרת בריאות (https://mywall.co.il/health) או הסבר על חוגים לפי הצורך. שמור על טון חיובי ומקצועי.',
  },
  whatsapp_logs: [],
  broadcast_campaigns: [],
  broadcast_list_defs: [
    { key: 'general', label: 'כללי', description: 'עדכונים שוטפים', color: 'var(--blue)', sortOrder: 0 },
    { key: 'classes', label: 'חוגים', description: 'שינויי שעות וכדומה', color: 'var(--green)', sortOrder: 1 },
    { key: 'trips', label: 'טיולים', description: 'טיולי סנפלינג/חוץ', color: 'var(--amber)', sortOrder: 2 },
    { key: 'events', label: 'אירועים', description: 'אירועים ותחרויות מועדון', color: 'var(--purple)', sortOrder: 3 },
  ],
};

const DEFAULT_BROADCAST_LIST_DEFS = SEED_DATA.broadcast_list_defs;

function withoutServerSecrets(settings = {}) {
  const {
    metaWaAccessToken: _metaWaAccessToken,
    metaIgAccessToken: _metaIgAccessToken,
    metaPageAccessToken: _metaPageAccessToken,
    verifyToken: _verifyToken,
    ...safe
  } = settings;
  return safe;
}

// Ensure JSON file exists and read it
function readDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(SEED_DATA, null, 2), 'utf-8');
      return SEED_DATA;
    }
    const content = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Error reading local JSON database:', error);
    return SEED_DATA;
  }
}

function writeDb(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error writing local JSON database:', error);
  }
}

// Called once on server startup: pulls the authoritative CRM-core collections
// from Supabase into the local db.json so the ephemeral Render disk always
// reflects the durable store. Non-core collections are left untouched.
export async function initDb() {
  if (!supa.isEnabled()) {
    console.warn('⚠️ Supabase disabled — CRM data will not persist across restarts.');
    return;
  }
  try {
    const data = readDb();
    const counts = {};
    for (const table of CORE_TABLES) {
      const rows = await supa.getAll(table);
      if (rows !== null) {
        const localRows = Array.isArray(data[table]) ? data[table] : [];
        const hydration = planDurableHydration(table, rows, localRows);
        if (hydration.mode === 'migrate') {
          for (const record of hydration.toMigrate) await supa.upsert(table, record);
          data[table] = hydration.rows;
          counts[table] = `migrated:${hydration.toMigrate.length}`;
        } else {
          data[table] = hydration.rows;
          counts[table] = hydration.rows.length;
        }
      } else {
        counts[table] = 'error';
      }
    }
    const remoteSettings = await supa.getAppSetting('whatsapp_settings');
    if (remoteSettings && typeof remoteSettings === 'object') {
      data.whatsapp_settings = {
        ...SEED_DATA.whatsapp_settings,
        ...data.whatsapp_settings,
        ...withoutServerSecrets(remoteSettings),
        metaWaAccessToken: '',
        verifyToken: '',
      };
      await supa.setAppSetting('whatsapp_settings', withoutServerSecrets(data.whatsapp_settings));
      counts.app_settings = 1;
    } else if (data.whatsapp_settings) {
      await supa.setAppSetting('whatsapp_settings', withoutServerSecrets(data.whatsapp_settings));
      counts.app_settings = 'migrated';
    }
    writeDb(data);
    console.log(
      `✅ Loaded CRM-core from Supabase:`,
      Object.entries(counts).map(([t, n]) => `${t}=${n}`).join(', ')
    );
  } catch (error) {
    console.error('initDb() failed — falling back to local db.json:', error.message);
  }
}

export const db = {
  get: (table) => {
    const data = readDb();
    return data[table] || [];
  },

  set: (table, value) => {
    const data = readDb();
    data[table] = value;
    writeDb(data);
  },
  
  getOne: (table, id) => {
    const list = db.get(table);
    return list.find(item => item.id === id);
  },

  getSettings: () => {
    const data = readDb();
    const settings = data.whatsapp_settings || SEED_DATA.whatsapp_settings;
    return {
      ...settings,
      metaWaPhoneId: process.env.META_WA_PHONE_NUMBER_ID || settings.metaWaPhoneId || '',
      metaWaWabaId: process.env.META_WA_WABA_ID || settings.metaWaWabaId || '',
      metaWaAccessToken: process.env.META_WA_ACCESS_TOKEN || '',
      metaIgAccessToken: process.env.INSTAGRAM_ACCESS_TOKEN || settings.metaIgAccessToken || '',
      metaPageId: process.env.META_PAGE_ID || settings.metaPageId || '',
      metaPageAccessToken: process.env.META_PAGE_ACCESS_TOKEN || settings.metaPageAccessToken || '',
      verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN || '',
    };
  },

  saveSettings: (newSettings) => {
    const data = readDb();
    data.whatsapp_settings = {
      ...withoutServerSecrets(data.whatsapp_settings),
      ...withoutServerSecrets(newSettings),
      metaWaAccessToken: '',
      verifyToken: '',
    };
    writeDb(data);
    Promise.resolve(supa.setAppSetting('whatsapp_settings', withoutServerSecrets(data.whatsapp_settings))).catch((error) =>
      console.error('sync whatsapp_settings error:', error?.message || error)
    );
    return data.whatsapp_settings;
  },

  insert: (table, record) => {
    const data = readDb();
    if (!data[table]) data[table] = [];
    // Spread first, then force id — otherwise `id: undefined` in record wipes the generated id.
    const newRecord = {
      ...record,
      id: record.id || `${table.slice(0, 2)}${Date.now()}`,
      created_at: record.created_at || new Date().toISOString(),
    };
    data[table].push(newRecord);
    writeDb(data);
    syncUpsert(table, newRecord);
    return newRecord;
  },

  update: (table, id, updates) => {
    const data = readDb();
    if (!data[table]) return null;
    const index = data[table].findIndex(item => item.id === id);
    if (index === -1) return null;
    data[table][index] = { ...data[table][index], ...updates, updated_at: new Date().toISOString() };
    writeDb(data);
    syncUpsert(table, data[table][index]);
    return data[table][index];
  },

  delete: (table, id) => {
    const data = readDb();
    if (!data[table]) return false;
    const index = data[table].findIndex(item => item.id === id);
    if (index === -1) return false;
    data[table].splice(index, 1);
    writeDb(data);
    syncRemove(table, id);
    return true;
  },

  upsertParentByPhone: (name, phone, email, extras = {}) => {
    const data = readDb();
    const normalize = (p) => {
      let d = String(p || '').replace(/[^\d]/g, '');
      if (d.startsWith('0') && d.length >= 9) d = `972${d.slice(1)}`;
      return d;
    };
    const cleanPhone = normalize(phone);
    const phoneTail = cleanPhone.slice(-9);
    let parent = data.parents.find(p => {
      const np = normalize(p.phone);
      return np === cleanPhone || (phoneTail && np.slice(-9) === phoneTail);
    });
    
    if (parent) {
      if (email && !parent.email) parent.email = email;
      if (name && (parent.name === 'לקוח וואטסאפ' || parent.name === 'ליד מאינסטגרם' || !parent.name)) {
        parent.name = name;
      }
      if (extras.city && !parent.city) parent.city = extras.city;
      if (extras.source && (!parent.source || parent.source === 'unknown')) parent.source = extras.source;
      if (extras.channel && !parent.channel) parent.channel = extras.channel;
      if (extras.notes) parent.notes = (parent.notes ? parent.notes + '\n' : '') + extras.notes;
      writeDb(data);
    } else {
      parent = {
        id: `p${Date.now()}`,
        name: name || 'לקוח וואטסאפ',
        phone: phone || '',
        email: email || '',
        city: extras.city || '',
        source: extras.source || 'unknown',
        channel: extras.channel || extras.source || undefined,
        notes: extras.notes || '',
      };
      data.parents.push(parent);
      writeDb(data);
    }
    syncUpsert('parents', parent);
    return parent;
  },

  createLeadFromWhatsApp: (phone, text) => {
    const parent = db.upsertParentByPhone('לקוח וואטסאפ', phone, '', {
      source: 'whatsapp',
      channel: 'whatsapp',
    });
    const data = readDb();
    const studentName = 'מתאמן חדש';
    
    const existingStudent = data.students.find(s => s.parentId === parent.id);
    if (!existingStudent) {
      const newStudent = {
        id: `s${Date.now()}`,
        name: studentName,
        parentId: parent.id,
        groupId: null,
        status: 'lead_new',
        birthDate: '',
        notes: `פנייה ראשונית מוואטסאפ: "${text}"`,
        levelGrade: null,
        source: 'whatsapp',
        created: new Date().toISOString().split('T')[0],
        created_at: new Date().toISOString(),
      };
      data.students.unshift(newStudent);
      writeDb(data);
      syncUpsert('students', newStudent);
      return { parent, student: newStudent, isNew: true };
    }
    
    return { parent, student: existingStudent, isNew: false };
  },

  upsertParentByInstagram: (igId, name = 'ליד מאינסטגרם') => {
    const data = readDb();
    let parent = data.parents.find(p => p.instagram_id === igId || (p.name === name && name !== 'ליד מאינסטגרם'));
    
    if (parent) {
      parent.instagram_id = igId;
      if (name && name !== 'ליד מאינסטגרם' && (parent.name === 'ליד מאינסטגרם' || parent.name === 'לקוח וואטסאפ')) {
        parent.name = name;
      }
      if (!parent.source || parent.source === 'unknown') parent.source = 'instagram';
      parent.channel = 'instagram';
      writeDb(data);
      syncUpsert('parents', parent);
      return parent;
    } else {
      parent = {
        id: `p${Date.now()}`,
        name: name,
        phone: '',
        email: '',
        source: 'instagram',
        instagram_id: igId,
        channel: 'instagram'
      };
      data.parents.push(parent);
      writeDb(data);
      syncUpsert('parents', parent);
      return parent;
    }
  },

  createLeadFromInstagram: (igId, text, name = 'ליד מאינסטגרם') => {
    const parent = db.upsertParentByInstagram(igId, name);
    const data = readDb();
    
    const existingStudent = data.students.find(s => s.parentId === parent.id);
    if (!existingStudent) {
      const newStudent = {
        id: `s${Date.now()}`,
        name: name,
        parentId: parent.id,
        groupId: null,
        status: 'lead_new',
        birthDate: '',
        notes: `פנייה ראשונית מאינסטגרם (IG ID: ${igId}): "${text}"`,
        levelGrade: null,
        source: 'instagram',
        created: new Date().toISOString().split('T')[0],
        created_at: new Date().toISOString(),
      };
      data.students.unshift(newStudent);
      writeDb(data);
      syncUpsert('students', newStudent);
      return { parent, student: newStudent, isNew: true };
    }
    
    // Append note if student exists and ensure status is visible if archived
    if (existingStudent.status === 'archived') {
      existingStudent.status = 'lead_new';
    }
    if (!existingStudent.source || existingStudent.source === 'unknown') {
      existingStudent.source = 'instagram';
    }
    existingStudent.notes = (existingStudent.notes ? existingStudent.notes + '\n' : '') + `הודעה נוספת מאינסטגרם: "${text}"`;
    writeDb(data);
    syncUpsert('students', existingStudent);
    return { parent, student: existingStudent, isNew: false };
  },

  createLeadFromForm: ({ parentName, phone, email, city, children, interest, source = 'form' }) => {
    const parent = db.upsertParentByPhone(parentName, phone, email, {
      city: city || '',
      source,
      channel: source,
      notes: interest ? `עניין: ${interest}` : '',
    });
    const createdStudents = [];
    const rawNames = Array.isArray(children)
      ? children.map((c) => (c || '').trim()).filter(Boolean)
      : (children ? [String(children).trim()] : []).filter(Boolean);
    const names = rawNames.length > 0 ? rawNames : [(parentName || '').trim() || 'מתאמן חדש'];

    for (const childName of names) {
      const trimmed = (childName || '').trim();
      if (!trimmed) continue;
      const existing = db.get('students').find(
        s => s.name.trim().toLowerCase() === trimmed.toLowerCase() && s.parentId === parent.id
      );
      if (existing) {
        const updated = db.update('students', existing.id, {
          status: existing.status === 'archived' ? 'lead_new' : existing.status,
          source: existing.source && existing.source !== 'unknown' ? existing.source : source,
          notes: interest
            ? ((existing.notes ? existing.notes + '\n' : '') + `עניין (טופס): ${interest}`)
            : existing.notes,
        });
        createdStudents.push(updated || existing);
      } else {
        const student = db.insert('students', {
          name: trimmed,
          parentId: parent.id,
          groupId: null,
          status: 'lead_new',
          birthDate: '',
          notes: interest ? `עניין: ${interest}` : '',
          levelGrade: null,
          source,
          created: new Date().toISOString().split('T')[0],
        });
        createdStudents.push(student);
      }
    }
    return { parent, students: createdStudents, isNew: createdStudents.length > 0 };
  },

  getBroadcastListDefs: () => {
    const data = readDb();
    if (!Array.isArray(data.broadcast_list_defs) || data.broadcast_list_defs.length === 0) {
      data.broadcast_list_defs = DEFAULT_BROADCAST_LIST_DEFS.map((l) => ({ ...l }));
      writeDb(data);
      for (const record of data.broadcast_list_defs) syncUpsert('broadcast_list_defs', record);
    }
    return [...data.broadcast_list_defs].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  },

  createBroadcastListDef: ({ label, description = '', color = 'var(--blue)' }) => {
    const name = String(label || '').trim();
    if (!name) return { error: 'שם הרשימה חובה' };

    const data = readDb();
    if (!Array.isArray(data.broadcast_list_defs)) {
      data.broadcast_list_defs = DEFAULT_BROADCAST_LIST_DEFS.map((l) => ({ ...l }));
    }

    const key = `list_${Date.now().toString(36)}`;
    const sortOrder = data.broadcast_list_defs.reduce((max, l) => Math.max(max, l.sortOrder ?? 0), -1) + 1;
    const created = {
      key,
      label: name,
      description: String(description || '').trim(),
      color: color || 'var(--blue)',
      sortOrder,
    };
    data.broadcast_list_defs.push(created);
    writeDb(data);
    syncUpsert('broadcast_list_defs', created);
    return { ok: true, list: created, lists: db.getBroadcastListDefs() };
  },

  updateBroadcastListDef: (key, updates = {}) => {
    const data = readDb();
    if (!Array.isArray(data.broadcast_list_defs)) {
      data.broadcast_list_defs = DEFAULT_BROADCAST_LIST_DEFS.map((l) => ({ ...l }));
    }
    const index = data.broadcast_list_defs.findIndex((l) => l.key === key);
    if (index === -1) return { error: 'הרשימה לא נמצאה' };

    const current = data.broadcast_list_defs[index];
    const nextLabel = updates.label !== undefined ? String(updates.label).trim() : current.label;
    if (!nextLabel) return { error: 'שם הרשימה חובה' };

    data.broadcast_list_defs[index] = {
      ...current,
      label: nextLabel,
      description: updates.description !== undefined ? String(updates.description || '').trim() : (current.description || ''),
      color: updates.color !== undefined ? (updates.color || current.color) : current.color,
      sortOrder: updates.sortOrder !== undefined ? Number(updates.sortOrder) : current.sortOrder,
    };
    writeDb(data);
    syncUpsert('broadcast_list_defs', data.broadcast_list_defs[index]);
    return { ok: true, list: data.broadcast_list_defs[index], lists: db.getBroadcastListDefs() };
  },

  deleteBroadcastListDef: (key) => {
    const data = readDb();
    if (!Array.isArray(data.broadcast_list_defs)) {
      data.broadcast_list_defs = DEFAULT_BROADCAST_LIST_DEFS.map((l) => ({ ...l }));
    }
    if (data.broadcast_list_defs.length <= 1) {
      return { error: 'חייבת להישאר לפחות רשימת תפוצה אחת' };
    }
    const index = data.broadcast_list_defs.findIndex((l) => l.key === key);
    if (index === -1) return { error: 'הרשימה לא נמצאה' };

    data.broadcast_list_defs.splice(index, 1);
    if (Array.isArray(data.broadcast_lists)) {
      data.broadcast_lists = data.broadcast_lists.filter((r) => r.listName !== key);
    }
    writeDb(data);
    syncRemove('broadcast_list_defs', key);
    return { ok: true, lists: db.getBroadcastListDefs() };
  },

  getParentBroadcastLists: (parentId) => {
    const data = readDb();
    if (!data.broadcast_lists) data.broadcast_lists = [];

    const lists = db.getBroadcastListDefs().map((l) => l.key);
    const result = {};

    lists.forEach((l) => {
      const record = data.broadcast_lists.find((r) => r.parentId === parentId && r.listName === l);
      result[l] = record ? record.subscribed : true; // Default to true if no record exists
    });

    return result;
  },

  updateParentBroadcastLists: (parentId, subscriptions) => {
    const data = readDb();
    if (!data.broadcast_lists) data.broadcast_lists = [];

    Object.entries(subscriptions).forEach(([listName, subscribed]) => {
      const index = data.broadcast_lists.findIndex((r) => r.parentId === parentId && r.listName === listName);
      if (index !== -1) {
        data.broadcast_lists[index].subscribed = subscribed;
      } else {
        data.broadcast_lists.push({
          id: `bl${Date.now()}_${listName}`,
          parentId,
          listName,
          subscribed,
        });
      }
    });

    writeDb(data);
    for (const record of data.broadcast_lists.filter((r) => r.parentId === parentId)) {
      syncUpsert('broadcast_lists', record);
    }
    return db.getParentBroadcastLists(parentId);
  },

  deleteStudent: (id) => {
    const data = readDb();
    if (!data.students) data.students = [];
    const index = data.students.findIndex(s => s.id === id);
    if (index === -1) return false;
    
    const student = data.students[index];
    data.students.splice(index, 1);
    syncRemove('students', id);
    
    // Check if parent has other children
    const otherChildren = data.students.filter(s => s.parentId === student.parentId);
    if (otherChildren.length === 0) {
      // Delete parent if they have no other children
      const parentIdx = data.parents.findIndex(p => p.id === student.parentId);
      if (parentIdx !== -1) {
        data.parents.splice(parentIdx, 1);
        syncRemove('parents', student.parentId);
      }
    }
    
    writeDb(data);
    return true;
  },

  clockIn: (employeeId, activityType, notes) => {
    const data = readDb();
    if (!data.shift_hours) data.shift_hours = [];
    
    // Close any existing open shift for this employee
    data.shift_hours.forEach(s => {
      if (s.employee_id === employeeId && s.status === 'open') {
        s.status = 'closed';
        s.clock_out = new Date().toISOString();
      }
    });

    const newShift = {
      id: `sh${Date.now()}`,
      employee_id: employeeId,
      clock_in: new Date().toISOString(),
      clock_out: null,
      activity_type: activityType || 'counter_shift',
      notes: notes || '',
      status: 'open',
      approved_by_accounting: false
    };
    
    data.shift_hours.push(newShift);
    writeDb(data);
    for (const shift of data.shift_hours.filter((s) => s.employee_id === employeeId)) {
      syncUpsert('shift_hours', shift);
    }
    return newShift;
  },

  clockOut: (employeeId, notes) => {
    const data = readDb();
    if (!data.shift_hours) data.shift_hours = [];
    
    const openShift = data.shift_hours.find(s => s.employee_id === employeeId && s.status === 'open');
    if (!openShift) return null;
    
    openShift.status = 'closed';
    openShift.clock_out = new Date().toISOString();
    if (notes) {
      openShift.notes = (openShift.notes ? openShift.notes + ' | ' : '') + notes;
    }
    
    writeDb(data);
    syncUpsert('shift_hours', openShift);
    return openShift;
  },

  approveShifts: (shiftIds) => {
    const data = readDb();
    if (!data.shift_hours) data.shift_hours = [];
    
    shiftIds.forEach(id => {
      const shift = data.shift_hours.find(s => s.id === id);
      if (shift) {
        shift.approved_by_accounting = true;
      }
    });
    
    writeDb(data);
    for (const shift of data.shift_hours.filter((s) => shiftIds.includes(s.id))) {
      syncUpsert('shift_hours', shift);
    }
    return true;
  },

  insertSafetyInspection: (inspection) => {
    const data = readDb();
    if (!data.safety_inspections) data.safety_inspections = [];
    
    const newInspection = {
      id: `sf${Date.now()}`,
      title: inspection.title || 'בדיקת בטיחות יומית',
      date: new Date().toISOString().split('T')[0],
      inspection_type: inspection.inspection_type || 'daily',
      description: inspection.description || '',
      completed_by_employee_id: inspection.completed_by_employee_id || 'e-1',
      signature_file_url: inspection.signature_file_url || 'signature_ok.png',
      checks: inspection.checks || {}
    };
    
    data.safety_inspections.unshift(newInspection);
    writeDb(data);
    syncUpsert('safety_inspections', newInspection);
    return newInspection;
  },

  insertSafetyIncident: (incident) => {
    const data = readDb();
    if (!data.safety_incidents) data.safety_incidents = [];
    
    const newIncident = {
      id: `in${Date.now()}`,
      climber_name: incident.climber_name || '',
      gear_used: incident.gear_used || '',
      description: incident.description || '',
      injury_description: incident.injury_description || '',
      action_taken: incident.action_taken || '',
      employee_id: incident.employee_id || 'e-1',
      date: new Date().toISOString().split('T')[0]
    };
    
    data.safety_incidents.unshift(newIncident);
    writeDb(data);
    syncUpsert('safety_incidents', newIncident);
    return newIncident;
  },

  insertLevelTest: (test) => {
    const data = readDb();
    if (!data.level_tests) data.level_tests = [];

    // Accept both Leads shape and LevelTests page shape
    let testType = test.test_type || 'level';
    if (testType === 'top_rope') testType = 'top-rope';
    // Legacy LevelTests page sent route_type without test_type
    if (!test.test_type && test.route_type) testType = 'level';

    const isLevelTest = testType === 'level' || testType === 'top-rope';
    const needsExaminer = testType === 'security' || testType === 'lead';

    const routeStyleRaw = test.route_style || test.route_type || 'top-rope';
    const routeStyle = isLevelTest
      ? (routeStyleRaw === 'top_rope' ? 'top-rope' : routeStyleRaw)
      : null;

    const level = isLevelTest ? (test.level || test.grade || '5A') : null;
    const passed = test.passed ?? (test.status ? test.status === 'passed' : true);
    const studentId = test.studentId || test.climber_id || null;

    let studentName = test.studentName || null;
    if (!studentName && studentId) {
      studentName = data.students?.find(s => s.id === studentId)?.name || null;
    }

    const newTest = {
      id: `lt${Date.now()}`,
      studentId,
      studentName: studentName || 'מתאמן',
      // Aliases kept for LevelTests page UI that still reads climber_id/grade/status
      climber_id: studentId,
      grade: level,
      level,
      test_type: testType === 'top-rope' ? 'level' : testType,
      route_style: routeStyle,
      route_type: routeStyle,
      examiner: needsExaminer ? (test.examiner ?? null) : null,
      examinerId: needsExaminer ? (test.examinerId ?? null) : null,
      date: test.date || new Date().toISOString().split('T')[0],
      notes: test.notes || '',
      passed,
      status: test.status || (passed ? 'passed' : 'failed'),
      attended_ceremony: test.attended_ceremony ?? test.ceremony ?? false,
      ceremony: test.attended_ceremony ?? test.ceremony ?? false
    };
    
    data.level_tests.unshift(newTest);
    
    // If a level test passed, update student level grade
    if (isLevelTest && newTest.studentId && newTest.passed && newTest.level) {
      const studentIndex = data.students.findIndex(s => s.id === newTest.studentId);
      if (studentIndex !== -1) {
        data.students[studentIndex].levelGrade = newTest.level;
        syncUpsert('students', data.students[studentIndex]);
      }
    }
    
    writeDb(data);
    syncUpsert('level_tests', newTest);
    return newTest;
  }
};
