import fs from 'fs';
import path from 'path';

const DB_FILE = path.join(process.cwd(), 'db.json');

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
    { id: 's1', name: 'עומרי לוי', parentId: 'p1', groupId: 'g-48775fd8', status: 'lead_new', birthDate: '2017-03-12', notes: '', levelGrade: null, created: '2026-07-08' },
    { id: 's2', name: 'נועה לוי', parentId: 'p1', groupId: null, status: 'lead_new', birthDate: '2015-07-22', notes: 'אחות של עומרי', levelGrade: null, created: '2026-07-08' },
    { id: 's3', name: 'רוני כהן', parentId: 'p2', groupId: 'g-993c2022', status: 'health_signed', birthDate: '2014-01-05', notes: '', levelGrade: '5C', created: '2026-07-07' },
    { id: 's4', name: 'גיל מזרחי', parentId: 'p3', groupId: 'g-53d1483e', status: 'intro_scheduled', birthDate: '2013-11-15', notes: 'ניסיון קודם בטיפוס', levelGrade: null, created: '2026-07-06' },
    { id: 's5', name: 'עברי שמר', parentId: 'p4', groupId: 'g-cf7a413e', status: 'registered', birthDate: '2012-04-20', notes: 'רשום לחוג בוגרים', levelGrade: '6B', created: '2026-07-05' },
    { id: 's6', name: 'תמר גולן', parentId: 'p5', groupId: 'g-165dbd26', status: 'registered', birthDate: '2016-09-30', notes: '', levelGrade: '5A', created: '2026-07-01' },
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
    { id: 'g-02d0c7cf-b', name: "מתקדמים ה'-ו' — ב׳+ה׳ 15:30", day: 1, time: '15:30', duration: 80, trainer: '', maxSlots: 13, enrolled: 0, ageCategory: "ה'-ו'", priceWeek: 0, priceTwice: 420, waParents: 'https://chat.whatsapp.com/KQDVxQC7YPBLvZJOXu5WTr', waClimbers: 'https://chat.whatsapp.com/CbHECN5brUcGiiiLMVulxZ' },
    { id: 'g-02d0c7cf', name: "מתקדמים ה'-ו' — ב׳+ה׳ 15:30", day: 4, time: '15:30', duration: 80, trainer: '', maxSlots: 13, enrolled: 0, ageCategory: "ה'-ו'", priceWeek: 0, priceTwice: 420, waParents: 'https://chat.whatsapp.com/KQDVxQC7YPBLvZJOXu5WTr', waClimbers: 'https://chat.whatsapp.com/CbHECN5brUcGiiiLMVulxZ' },
    { id: 'g-c5aece01', name: 'נבחרת צעירה — ה׳ 17:00', day: 4, time: '17:00', duration: 110, trainer: '', maxSlots: 13, enrolled: 0, ageCategory: 'חטיבה', priceWeek: 550, priceTwice: 550, waParents: 'https://chat.whatsapp.com/KX1HoM5PYqb2Fz7TH8j1aJ', waClimbers: '' },
    { id: 'g-529e08f6', name: 'נבחרת בוגרת — ה׳ 19:10', day: 4, time: '19:10', duration: 110, trainer: '', maxSlots: 13, enrolled: 0, ageCategory: 'תיכון', priceWeek: 0, priceTwice: 550, waParents: 'https://chat.whatsapp.com/HasZy575i5XAtUVLPfOyX4', waClimbers: 'https://chat.whatsapp.com/LGg0ekCjQr10S1PkmA9OcK' },
  ],
  employees: [
    { id: 'e1', name: 'עידו בן דוד', role: 'trainer', phone: '0521111111', clockedIn: true, clockInTime: '08:45' },
    { id: 'e2', name: 'ליאת שניר', role: 'trainer', phone: '0522222222', clockedIn: false, clockInTime: null },
    { id: 'e3', name: 'יובל כץ', role: 'safety_officer', phone: '0523333333', clockedIn: true, clockInTime: '09:10' },
  ],
  whatsapp_settings: {
    metaWaPhoneId: '',
    metaWaAccessToken: '',
    metaIgAccountId: '',
    metaIgAccessToken: '',
    verifyToken: 'climbing_verify_token',
    aiResponderEnabled: true,
    aiSystemPrompt: 'אתה בוט שירות לקוחות ידידותי של קיר הטיפוס My Wall. ענה בנימוס וקצרות בעברית. שלח קישור להצהרת בריאות (https://mywall.co.il/health) או הסבר על חוגים לפי הצורך. שמור על טון חיובי ומקצועי.',
  },
  whatsapp_logs: [],
  broadcast_campaigns: [],
};

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
    return data.whatsapp_settings || SEED_DATA.whatsapp_settings;
  },

  saveSettings: (newSettings) => {
    const data = readDb();
    data.whatsapp_settings = { ...data.whatsapp_settings, ...newSettings };
    writeDb(data);
    return data.whatsapp_settings;
  },

  insert: (table, record) => {
    const data = readDb();
    if (!data[table]) data[table] = [];
    const newRecord = { id: record.id || `${table.slice(0, 2)}${Date.now()}`, ...record, created_at: new Date().toISOString() };
    data[table].push(newRecord);
    writeDb(data);
    return newRecord;
  },

  update: (table, id, updates) => {
    const data = readDb();
    if (!data[table]) return null;
    const index = data[table].findIndex(item => item.id === id);
    if (index === -1) return null;
    data[table][index] = { ...data[table][index], ...updates, updated_at: new Date().toISOString() };
    writeDb(data);
    return data[table][index];
  },

  delete: (table, id) => {
    const data = readDb();
    if (!data[table]) return false;
    const index = data[table].findIndex(item => item.id === id);
    if (index === -1) return false;
    data[table].splice(index, 1);
    writeDb(data);
    return true;
  },

  upsertParentByPhone: (name, phone, email) => {
    const data = readDb();
    const cleanPhone = phone.replace(/[-\s]/g, '');
    let parent = data.parents.find(p => p.phone.replace(/[-\s]/g, '') === cleanPhone);
    
    if (parent) {
      if (email && !parent.email) {
        parent.email = email;
      }
      if (name && parent.name === 'לקוח וואטסאפ') {
        parent.name = name;
      }
      writeDb(data);
    } else {
      parent = {
        id: `p${Date.now()}`,
        name: name || 'לקוח וואטסאפ',
        phone: phone,
        email: email || ''
      };
      data.parents.push(parent);
      writeDb(data);
    }
    return parent;
  },

  createLeadFromWhatsApp: (phone, text) => {
    const parent = db.upsertParentByPhone('לקוח וואטסאפ', phone);
    const data = readDb();
    // Extract potential student name from message, or use a default
    let studentName = 'מתאמן חדש';
    
    // Check if child name is already there
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
        created: new Date().toISOString().split('T')[0]
      };
      data.students.unshift(newStudent);
      writeDb(data);
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
      writeDb(data);
      return parent;
    } else {
      parent = {
        id: `p${Date.now()}`,
        name: name,
        phone: '',
        email: '',
        instagram_id: igId,
        channel: 'instagram'
      };
      data.parents.push(parent);
      writeDb(data);
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
        created: new Date().toISOString().split('T')[0]
      };
      data.students.unshift(newStudent);
      writeDb(data);
      return { parent, student: newStudent, isNew: true };
    }
    
    // Append note if student exists and ensure status is visible if archived
    if (existingStudent.status === 'archived') {
      existingStudent.status = 'lead_new';
    }
    existingStudent.notes = (existingStudent.notes ? existingStudent.notes + '\n' : '') + `הודעה נוספת מאינסטגרם: "${text}"`;
    writeDb(data);
    return { parent, student: existingStudent, isNew: false };
  },

  getParentBroadcastLists: (parentId) => {
    const data = readDb();
    if (!data.broadcast_lists) data.broadcast_lists = [];
    
    const lists = ['general', 'classes', 'trips', 'events'];
    const result = {};
    
    lists.forEach(l => {
      const record = data.broadcast_lists.find(r => r.parentId === parentId && r.listName === l);
      result[l] = record ? record.subscribed : true; // Default to true if no record exists
    });
    
    return result;
  },

  updateParentBroadcastLists: (parentId, subscriptions) => {
    const data = readDb();
    if (!data.broadcast_lists) data.broadcast_lists = [];
    
    Object.entries(subscriptions).forEach(([listName, subscribed]) => {
      const index = data.broadcast_lists.findIndex(r => r.parentId === parentId && r.listName === listName);
      if (index !== -1) {
        data.broadcast_lists[index].subscribed = subscribed;
      } else {
        data.broadcast_lists.push({
          id: `bl${Date.now()}_${listName}`,
          parentId,
          listName,
          subscribed
        });
      }
    });
    
    writeDb(data);
    return db.getParentBroadcastLists(parentId);
  },

  deleteStudent: (id) => {
    const data = readDb();
    if (!data.students) data.students = [];
    const index = data.students.findIndex(s => s.id === id);
    if (index === -1) return false;
    
    const student = data.students[index];
    data.students.splice(index, 1);
    
    // Check if parent has other children
    const otherChildren = data.students.filter(s => s.parentId === student.parentId);
    if (otherChildren.length === 0) {
      // Delete parent if they have no other children
      const parentIdx = data.parents.findIndex(p => p.id === student.parentId);
      if (parentIdx !== -1) {
        data.parents.splice(parentIdx, 1);
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
    return newIncident;
  },

  insertLevelTest: (test) => {
    const data = readDb();
    if (!data.level_tests) data.level_tests = [];
    
    const newTest = {
      id: `lt${Date.now()}`,
      studentId: test.studentId || null,
      studentName: test.studentName || 'מתאמן',
      level: test.level || '5A',
      test_type: test.test_type || 'top-rope',
      examiner: test.examiner || 'עידו בן דוד',
      date: new Date().toISOString().split('T')[0],
      notes: test.notes || '',
      passed: test.passed ?? true,
      attended_ceremony: test.attended_ceremony ?? false
    };
    
    data.level_tests.unshift(newTest);
    
    // If test passed, update student level grade
    if (newTest.studentId && newTest.passed) {
      const studentIndex = data.students.findIndex(s => s.id === newTest.studentId);
      if (studentIndex !== -1) {
        data.students[studentIndex].levelGrade = newTest.level;
      }
    }
    
    writeDb(data);
    return newTest;
  }
};
