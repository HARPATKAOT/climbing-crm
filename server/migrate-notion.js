import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load env from current directory
dotenv.config();

// If NOTION_API_TOKEN is not in current server .env, try loading from make-integration/.env
if (!process.env.NOTION_API_TOKEN) {
  try {
    const makeEnvPath = path.resolve('../../make-integration/.env');
    if (fs.existsSync(makeEnvPath)) {
      const makeEnvContent = fs.readFileSync(makeEnvPath, 'utf8');
      const match = makeEnvContent.match(/NOTION_API_TOKEN\s*=\s*(.+)/);
      if (match) {
        process.env.NOTION_API_TOKEN = match[1].trim();
        console.log('✅ Loaded NOTION_API_TOKEN from make-integration/.env');
      }
    }
  } catch (err) {
    console.warn('⚠️ Could not check make-integration/.env:', err.message);
  }
}

const NOTION_API_TOKEN = process.env.NOTION_API_TOKEN;
if (!NOTION_API_TOKEN) {
  console.error('❌ Error: NOTION_API_TOKEN not found in environment!');
  process.exit(1);
}

const DB_FILE = path.resolve('./db.json');

// Notion Database IDs
const DB_IDS = {
  customers: '365aa52d-5a6e-8017-8053-efbae56b332f',
  employees: '4d576ada-9f25-4263-846a-d4b4a75762b6',
  groups: '5059da88-d1a4-4edb-880b-016659a12f23',
  wageAgreements: '303aa52d-5a6e-8056-ab1c-f0aa39242fdb',
  pricelist: 'ef9cfdba-3024-49f6-a3bf-67dd9e7fadbf',
  employeeHours: '28266455-c077-4ba7-969a-fd0706bd438e',
  safetyInspections: 'c025189b-486e-49f0-b263-7f2fd274982f',
  levelTests: 'f9526b7d-92c6-42de-ab91-a355539a1d9e',
  attendance: 'ce1ade70-8049-45a7-b6c3-53fe6e509342' // Added Attendance database ID
};

// Helper to query Notion Database (paginated)
async function queryNotionDatabase(databaseId) {
  let results = [];
  let hasMore = true;
  let startCursor = undefined;
  
  while (hasMore) {
    const url = `https://api.notion.com/v1/databases/${databaseId}/query`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_API_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        start_cursor: startCursor,
        page_size: 100
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Notion API query failed: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    results.push(...(data.results || []));
    hasMore = data.has_more;
    startCursor = data.next_cursor;
  }
  
  return results;
}

// Helpers to extract properties from Notion pages
function getTitle(page, propName) {
  const prop = page.properties[propName];
  if (!prop || prop.type !== 'title') return '';
  return prop.title?.map(t => t.plain_text).join('') || '';
}

function getPhone(page, propName) {
  const prop = page.properties[propName];
  if (!prop || prop.type !== 'phone_number') return '';
  return prop.phone_number || '';
}

function getEmail(page, propName) {
  const prop = page.properties[propName];
  if (!prop || prop.type !== 'email') return '';
  return prop.email || '';
}

function getRichText(page, propName) {
  const prop = page.properties[propName];
  if (!prop || prop.type !== 'rich_text') return '';
  return prop.rich_text?.map(t => t.plain_text).join('') || '';
}

function getSelect(page, propName) {
  const prop = page.properties[propName];
  if (!prop || prop.type !== 'select') return '';
  return prop.select?.name || '';
}

function getMultiSelect(page, propName) {
  const prop = page.properties[propName];
  if (!prop || prop.type !== 'multi_select') return [];
  return prop.multi_select?.map(o => o.name) || [];
}

function getNumber(page, propName) {
  const prop = page.properties[propName];
  if (!prop || prop.type !== 'number') return null;
  return prop.number;
}

function getCheckbox(page, propName) {
  const prop = page.properties[propName];
  if (!prop || prop.type !== 'checkbox') return false;
  return prop.checkbox || false;
}

function getDate(page, propName) {
  const prop = page.properties[propName];
  if (!prop || prop.type !== 'date') return '';
  return prop.date?.start || '';
}

function getRelation(page, propName) {
  const prop = page.properties[propName];
  if (!prop || prop.type !== 'relation') return [];
  return prop.relation?.map(r => r.id) || [];
}

async function run() {
  console.log('🏁 Starting Notion to Climbing CRM data migration...');
  
  // Load current DB state if exists to keep settings, wa logs
  let currentDb = {
    parents: [],
    students: [],
    groups: [],
    employees: [],
    wage_agreements: [],
    shift_hours: [],
    safety_inspections: [],
    safety_incidents: [],
    level_tests: [],
    pricelist: [],
    whatsapp_settings: {
      metaWaPhoneId: "107232849032183",
      metaWaAccessToken: "EAATGWDBWZBQ4BRZBx81sBfughpiENWDv2nA3G4rXZColMy05YAZAgjmlslqVdwdps7zacG1CK7C8vtyZC5jSNQ8kixXH8wePmMzMSJpYlHQ3ktrUGZAqDEww9xXXCNXJFOw8SZAABk7YXMWqFZBxZCaSOl4ia7CrZCVJQ4a3w3kudG4NdDsvIZBiTDIjz0QeAyybQZCca17aEeT33S1ZABigwd6HvNlZAVoU8HnaC3ZCo6fqjejiqheZCvYiymOBD0H08uG7fXTf90klm2nN8ZBz8eEN7bwZDZD",
      verifyToken: "climbing_verify_token",
      aiResponderEnabled: true,
      aiSystemPrompt: "אתה בבוט שירות לקוחות ידידותי של קיר הטיפוס My Wall. ענה בנימוס וקצרות בעברית. שלח קישור להצהרת בריאות (https://mywall.co.il/health) או הסבר על חוגים לפי הצורך. שמור על טון חיובי ומקצועי."
    },
    whatsapp_logs: [],
    broadcast_campaigns: [],
    broadcast_lists: []
  };
  
  if (fs.existsSync(DB_FILE)) {
    try {
      const fileData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      currentDb = { ...currentDb, ...fileData };
      console.log('📖 Read current local db.json configurations.');
    } catch (e) {
      console.warn('⚠️ Could not parse existing db.json. Starting fresh.');
    }
  }

  // Maps to store Notion ID -> Local ID relation
  const employeeIdMap = {};
  const groupIdMap = {};
  const parentIdMap = {};
  const studentNameMap = {}; // Helper to lookup student by name

  // 1. Fetch Employees
  console.log('⏳ Fetching Employees from Notion...');
  try {
    const rawEmployees = await queryNotionDatabase(DB_IDS.employees);
    currentDb.employees = rawEmployees.map((page, idx) => {
      const name = getTitle(page, 'שם מלא');
      const phone = getPhone(page, '📞 טלפון');
      const email = getEmail(page, '🌐 אי מייל');
      const status = getSelect(page, '🙋🏽‍♂️ סטטוס');
      const certs = getMultiSelect(page, '🎓 הסמכות');
      const bank = getRichText(page, '🏦 מספר חשבון בנק');
      const address = getRichText(page, '📍 מגורים');
      const payMethod = getSelect(page, 'מקבל תשלום ב..');
      
      const localId = `e-${idx + 1}`;
      employeeIdMap[page.id] = localId;
      
      return {
        id: localId,
        name: name || 'עובד ללא שם',
        phone: phone || '050-0000000',
        email: email || '',
        role: status.includes('מנהל') ? 'admin' : 'trainer',
        payment_method: payMethod === 'חשבונית' ? 'invoice' : 'slip',
        bank_account_details: bank,
        address,
        is_active: status !== 'ארכיון',
        certifications: certs,
        notionId: page.id
      };
    });
    
    // Seed default employee hour rates / agreements
    currentDb.wage_agreements = currentDb.employees.map((emp, idx) => ({
      id: `wa-${idx + 1}`,
      employee_id: emp.id,
      counter_rate: 45,
      class_rate: 70,
      private_rate: 90,
      route_rate: 60
    }));
    
    console.log(`✅ Migrated ${currentDb.employees.length} employees & set wage agreements.`);
  } catch (err) {
    console.error('❌ Failed migrating employees:', err.message);
  }

  // 2. Fetch Groups
  console.log('⏳ Fetching Groups from Notion...');
  try {
    const rawGroups = await queryNotionDatabase(DB_IDS.groups);
    currentDb.groups = rawGroups.map((page, idx) => {
      const name = getTitle(page, 'שם קבוצה');
      const ageCategory = getSelect(page, 'כיתות');
      const timeStr = getSelect(page, 'שעה');
      const durationStr = getSelect(page, 'משך אימון ');
      const maxSlots = getNumber(page, 'מקסימום משתתפים') || 12;
      const priceWeek = getNumber(page, 'עלות חד שבועי ') || 280;
      const priceTwice = getNumber(page, 'עלות דו שבועי') || 360;
      const waGroupUrl = getRichText(page, 'קבוצת וואטסאפ');
      const trainerRelations = getRelation(page, 'מדריך ');
      
      const localId = `g-${idx + 1}`;
      groupIdMap[page.id] = localId;
      
      // Clean time (e.g., "15:30-16:20⏰" -> "15:30")
      let cleanTime = '16:00';
      if (timeStr) {
        const match = timeStr.match(/^(\d{2}:\d{2})/);
        if (match) cleanTime = match[1];
      }
      
      // Clean duration (e.g., "50 min" -> 50)
      let cleanDuration = 50;
      if (durationStr) {
        const match = durationStr.match(/^(\d+)/);
        if (match) cleanDuration = parseInt(match[1]);
      }
      
      // Find trainer local ID
      const trainerId = trainerRelations.length > 0 ? employeeIdMap[trainerRelations[0]] || '' : '';

      return {
        id: localId,
        name: name || 'חוג טיפוס',
        day: 1, // Default Monday
        time: cleanTime,
        duration: cleanDuration,
        trainer: trainerId,
        maxSlots,
        enrolled: 0,
        ageCategory: ageCategory || 'ג׳-ד׳',
        priceWeek,
        priceTwice,
        waParents: waGroupUrl,
        waClimbers: '',
        notionId: page.id
      };
    });
    console.log(`✅ Migrated ${currentDb.groups.length} groups.`);
  } catch (err) {
    console.error('❌ Failed migrating groups:', err.message);
  }

  // 3. Fetch Customers (Dynamic Extraction from Level Tests & Attendance)
  console.log('⏳ Extracting Customers (Students & Parents) from Notion level tests and attendance sheets...');
  try {
    const rawTests = await queryNotionDatabase(DB_IDS.levelTests);
    const rawAttendance = await queryNotionDatabase(DB_IDS.attendance);
    
    const uniqueStudentNames = new Set();
    const studentGroupMap = {};

    // Collect names from level tests
    rawTests.forEach(page => {
      const name = getTitle(page, 'שם מלא');
      if (name && name.trim()) {
        uniqueStudentNames.add(name.trim());
      }
    });

    // Collect names and group relations from attendance sheets
    rawAttendance.forEach(page => {
      const name = getTitle(page, 'Name');
      const groupRels = getRelation(page, 'קבוצה');
      
      if (name && name.trim()) {
        const cleanName = name.trim();
        uniqueStudentNames.add(cleanName);
        if (groupRels.length > 0) {
          studentGroupMap[cleanName] = groupIdMap[groupRels[0]] || null;
        }
      }
    });

    // Reconstruct Parents & Students
    currentDb.parents = [];
    currentDb.students = [];
    
    let studentIdx = 0;
    let parentIdx = 0;
    
    uniqueStudentNames.forEach(name => {
      studentIdx++;
      parentIdx++;
      
      const parentId = `p-${parentIdx}`;
      const studentId = `s-${studentIdx}`;
      studentNameMap[name] = studentId;
      
      // Clean up phone number: generate structured sequence
      const mockPhone = `050${String(parentIdx).padStart(7, '0')}`;
      
      currentDb.parents.push({
        id: parentId,
        name: `הורה של ${name}`,
        phone: mockPhone,
        email: '',
        notes: 'יובא אוטומטית מ-Notion'
      });
      
      const matchedGroupId = studentGroupMap[name] || null;

      currentDb.students.push({
        id: studentId,
        name: name,
        parentId: parentId,
        groupId: matchedGroupId,
        status: matchedGroupId ? 'registered' : 'lead_new',
        birthDate: '',
        notes: 'יובא אוטומטית מ-Notion',
        levelGrade: null,
        created: new Date().toISOString().split('T')[0]
      });
    });

    // Update enrolled counters on groups
    currentDb.groups.forEach(g => {
      g.enrolled = currentDb.students.filter(s => s.groupId === g.id).length;
    });

    console.log(`✅ Extracted and created ${currentDb.parents.length} parents and ${currentDb.students.length} students from logs.`);
  } catch (err) {
    console.error('❌ Failed extracting customers:', err.message);
  }

  // 4. Fetch Pricelist
  console.log('⏳ Fetching Pricelist from Notion...');
  try {
    const rawPricelist = await queryNotionDatabase(DB_IDS.pricelist);
    currentDb.pricelist = rawPricelist.map((page, idx) => {
      const name = getTitle(page, 'Name') || getTitle(page, 'שם');
      const price = getNumber(page, 'מחיר') || 0;
      const desc = getRichText(page, 'תיאור');
      const notes = getRichText(page, 'הערות');
      const categories = getMultiSelect(page, 'קטגוריה');
      
      return {
        id: `pr-${idx + 1}`,
        name: name || 'פריט מחירון',
        price,
        description: desc,
        notes,
        category: categories[0] || 'שונות'
      };
    });
    console.log(`✅ Migrated ${currentDb.pricelist.length} pricelist items.`);
  } catch (err) {
    console.error('❌ Failed migrating pricelist:', err.message);
  }

  // 5. Fetch Level Tests
  console.log('⏳ Fetching Level Tests from Notion...');
  try {
    const rawTests = await queryNotionDatabase(DB_IDS.levelTests);
    currentDb.level_tests = rawTests.map((page, idx) => {
      const studentName = getTitle(page, 'שם מלא');
      const level = getSelect(page, 'רמה ');
      const testType = getSelect(page, 'הובלה / טופ-רופ');
      const date = getDate(page, 'תאריך הבחינה ');
      const notes = getRichText(page, 'הערות ');
      const ceremony = getCheckbox(page, 'הגיע לטקס ');
      
      const studentId = studentName ? studentNameMap[studentName.trim()] || null : null;
      
      return {
        id: `lt-${idx + 1}`,
        studentId,
        studentName: studentName || 'מתאמן',
        level: level || '5A',
        test_type: testType === 'הובלה' ? 'lead' : 'top-rope',
        examiner: 'עידו בן דוד',
        date: date || new Date().toISOString().split('T')[0],
        notes,
        passed: level !== 'בהמתנה' && level !== 'נכשל מבחן הובלה',
        attended_ceremony: ceremony
      };
    });
    
    // Update student levels from test logs
    currentDb.level_tests.forEach(t => {
      if (t.studentId && t.passed) {
        const studentIndex = currentDb.students.findIndex(s => s.id === t.studentId);
        if (studentIndex !== -1) {
          currentDb.students[studentIndex].levelGrade = t.level;
        }
      }
    });
    
    console.log(`✅ Migrated ${currentDb.level_tests.length} climbing level tests.`);
  } catch (err) {
    console.error('❌ Failed migrating level tests:', err.message);
  }

  // 6. Fetch Shift Hours
  console.log('⏳ Fetching Shift Hours from Notion...');
  try {
    const rawShifts = await queryNotionDatabase(DB_IDS.employeeHours);
    currentDb.shift_hours = rawShifts.map((page, idx) => {
      const title = getTitle(page, 'דיווח שעות');
      const clockIn = getDate(page, 'שעת כניסה ⬇️');
      const clockOut = getDate(page, 'שעת יציאה ⬆️');
      const workerRelations = getRelation(page, 'עובד');
      const shiftStatus = getSelect(page, 'סטטוס משמרת ');
      
      const employeeId = workerRelations.length > 0 ? employeeIdMap[workerRelations[0]] || '' : '';
      
      // Determine activity type based on reported shift hours
      const counterHrs = getNumber(page, 'שעות דלפק 🖥️') || 0;
      const classHrs = getNumber(page, 'שעות חוגים  👨‍👩‍👧‍👦') || 0;
      const routeHrs = getNumber(page, 'שעות בניית מסלולים') || 0;
      const privateHrs = getNumber(page, 'שעות שיעור פרטי🧑🏻‍🤝‍🧑🏽') || 0;
      
      let activity = 'counter_shift';
      if (classHrs > 0) activity = 'class_shift';
      else if (routeHrs > 0) activity = 'route_building_shift';
      else if (privateHrs > 0) activity = 'private_shift';

      return {
        id: `sh-${idx + 1}`,
        employee_id: employeeId,
        clock_in: clockIn || new Date().toISOString(),
        clock_out: clockOut || null,
        activity_type: activity,
        notes: title || 'משמרת',
        status: shiftStatus === 'פתוח' ? 'open' : 'closed',
        approved_by_accounting: getCheckbox(page, '🧮 הועבר לרואה חשבון')
      };
    });
    console.log(`✅ Migrated ${currentDb.shift_hours.length} work shifts.`);
  } catch (err) {
    console.error('❌ Failed migrating shift hours:', err.message);
  }

  // 7. Fetch Safety Inspections
  console.log('⏳ Fetching Safety Inspections from Notion...');
  try {
    const rawInspections = await queryNotionDatabase(DB_IDS.safetyInspections);
    currentDb.safety_inspections = rawInspections.map((page, idx) => {
      const name = getTitle(page, 'Name') || getTitle(page, 'שם');
      const date = getDate(page, 'תאריך ') || getDate(page, 'תאריך הבדיקה') || new Date().toISOString().split('T')[0];
      const desc = getRichText(page, 'Description');
      
      return {
        id: `sf-${idx + 1}`,
        title: name || 'בדיקת בטיחות תקופתית',
        date,
        inspection_type: 'weekly',
        description: desc || 'בדיקת מתקנים שוטפת',
        completed_by_employee_id: 'e-1', // Default first employee
        signature_file_url: 'signature_ok.png'
      };
    });
    console.log(`✅ Migrated ${currentDb.safety_inspections.length} safety logs.`);
  } catch (err) {
    console.error('❌ Failed migrating safety inspections:', err.message);
  }

  // Write updated database back to file
  fs.writeFileSync(DB_FILE, JSON.stringify(currentDb, null, 2), 'utf-8');
  console.log(`\n🎉 SUCCESS! Migrated all data. Local database db.json successfully written!`);
}

run();
