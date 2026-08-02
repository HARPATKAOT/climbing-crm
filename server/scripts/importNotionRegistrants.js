/**
 * ייבוא כל הרשומים מ-Notion למערכת: הורים, מתאמנים, מבחני רמה והובלה,
 * מבחני אבטוח, ופעילויות עבר עם המשתתפים שלהן.
 *
 * המקור הוא קבצי צילום מצב שנשלפו מ-Notion ב-2.8.2026:
 *   notion-registrants.json, notion-level-tests.json, notion-security-tests.json,
 *   notion-examiners.json, notion-activities-catalog.json, notion-activity-participants.json
 *
 * הרצה (מתוך server/):
 *   node scripts/importNotionRegistrants.js             → הדמיה, לא נכתב כלום
 *   node scripts/importNotionRegistrants.js --apply     → כתיבה בפועל (Supabase + db.json)
 *   node scripts/importNotionRegistrants.js --rollback  → מחיקת כל מה שהסקריפט יצר
 *
 * עקרונות:
 *  - מזהים יציבים הנגזרים מה-pageId של Notion (pn_/sn_/ltn_/lts_/acn_/arn_) —
 *    ריצה חוזרת מעדכנת במקום לשכפל, ו-rollback מזהה את מה שיובא.
 *  - איחוד משפחות לפי טלפון ההורה: כמה שורות Notion עם אותו טלפון = תיק אחד.
 *  - כרטיס קיים במערכת רק מושלם (מילוי שדות ריקים); שם אמיתי מחליף placeholder.
 *  - נכתבים רק שדות שקיימים במערכת. מידע ללא שדה מתאים לא מיובא.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const HERE = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(HERE, '../.env') });

const { db, initDb, normalizeParentPhone, parentPhonesMatch } = await import('../db.js');
const { supa } = await import('../supa.js');
const { normalizedChildName } = await import('../studentGuardians.js');

const APPLY = process.argv.includes('--apply');
const ROLLBACK = process.argv.includes('--rollback');

const LEVEL_EXAMINER = 'דלק איל';
const SOURCE = 'notion';
const PLACEHOLDER_NAMES = new Set(['לקוח וואטסאפ', 'ליד מאינסטגרם', 'לקוח מסנג׳ר', 'לקוח מדלפק']);
const JUNK_CHILD_NAMES = new Set(['facebook', 'xxx', 'instagram', 'אינסטגרם', 'פייסבוק']);

/** סטטוס ב-Notion מגיע עם אימוג'י ורווחים משתנים — משאירים רק אותיות עבריות. */
const hebOnly = (s) => String(s || '').replace(/[^א-ת ]/g, '').replace(/\s+/g, ' ').trim();

const SKIP_STATUSES = new Set(['למחיקה', 'לאשפה מוחלטת', 'ליד שנפסל', 'מנהלי']);

const STATUS_MAP = {
  'רשום': 'past_registered', // הנחיית הבעלים: השנה נגמרה, אף אחד לא "חוג פעיל"
  'רשימת המתנה': 'waitlist',
  'מחכה להרשמה': 'pending_signup',
  'אימון הכירות שולם': 'intro_paid',
  'השתתף באימון ניסיון': 'intro_scheduled',
  'ליד חדש': 'lead_new',
  'מולאו פרטים': 'lead_new',
  'מצריך בירור': 'lead_new',
  'רענון': 'lead_new',
  'מתעניין לשנה הבאה': 'lead_new',
  '': 'lead_new',
  'ארכיון': 'archived',
  'נשר מהחוג': 'archived',
  'היה רשום בשנה שעברה': 'archived',
  'לקוח מזדמן': 'archived',
  'צעיר מידי': 'archived',
};

const STATUS_RANK = {
  registered: 50, past_registered: 45, health_signed: 40, pending_signup: 35,
  intro_paid: 30, intro_scheduled: 25, waitlist: 20, lead_new: 10, archived: 0,
};

const report = {
  skippedByStatus: {}, unmappedStatuses: {}, families: 0, phonelessFamilies: 0,
  parentsCreated: 0, parentsMerged: [], parentsNameless: [],
  studentsCreated: 0, studentsMergedExisting: [], studentsAmbiguous: [],
  duplicateChildrenCollapsed: [], notionArchivedRows: 0,
  parentOnlyRows: 0,
  levelTests: { level: 0, lead: 0, leadNoResult: 0, skippedNotTaken: 0, noResult: [], unresolved: [] },
  securityTests: { imported: 0, withExaminer: 0, forcedPassed: 0, unresolved: [] },
  activities: [], registrations: { imported: 0, nameOnly: 0, skippedByStatus: {} },
};

const readSnap = (file) => JSON.parse(fs.readFileSync(path.resolve(HERE, file), 'utf8')).rows;
const yes = (v) => v === '__YES__' || v === true;
const dateOnly = (v) => (v ? String(v).slice(0, 10) : null);
const rank = (s) => STATUS_RANK[s] ?? 5;

function mapStatus(raw) {
  const key = hebOnly(raw);
  if (key in STATUS_MAP) return STATUS_MAP[key];
  report.unmappedStatuses[key] = (report.unmappedStatuses[key] || 0) + 1;
  return 'lead_new';
}

const statusOfRow = (row) => (row.notionArchived ? 'archived' : mapStatus(row.status));

const isJunkChildName = (name) => {
  const n = String(name || '').trim().toLowerCase();
  return !n || JUNK_CHILD_NAMES.has(n);
};

/** טלפון של ילד רק אם יש בו מספר אמיתי — בנושן נפוץ "+972" ריק. */
function childPhoneOf(raw) {
  const p = normalizeParentPhone(raw);
  return p.length >= 11 ? p : '';
}

function surnameOf(childName) {
  const words = String(childName || '').trim().split(/\s+/);
  return words.length >= 2 ? words[words.length - 1] : '';
}

function ageOf(birthDate) {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (Number.isNaN(b.getTime())) return null;
  return (Date.now() - b.getTime()) / (365.25 * 24 * 3600 * 1000);
}

// ─── Rollback ───────────────────────────────────────────────────────────────

const CREATED = [
  // reverse-FK order: registrations → activities → tests → students → parents
  { table: 'activity_registrations', prefix: 'arn_' },
  { table: 'activities', prefix: 'acn_' },
  { table: 'level_tests', prefix: 'ltn_' },
  { table: 'level_tests', prefix: 'lts_' },
  { table: 'students', prefix: 'sn_' },
  { table: 'parents', prefix: 'pn_' },
];

async function rollback() {
  await initDb();
  for (const { table, prefix } of CREATED) {
    const rows = (db.get(table) || []).filter((r) => String(r.id).startsWith(prefix));
    console.log(`🗑️  ${table}: מוחק ${rows.length} רשומות ${prefix}*`);
    for (const row of rows) {
      await db.deleteDurable(table, row.id);
    }
  }
  console.log('⚠️  הורים קיימים שמוזגו לא שוחזרו — לשחזור ידני יש את קובץ הגיבוי.');
}

// ─── Main import ────────────────────────────────────────────────────────────

async function run() {
  await initDb();
  if (APPLY && !supa.isEnabled()) {
    throw new Error('Supabase לא מחובר — ‎--apply היה כותב רק ל-db.json המקומי');
  }

  const registrants = readSnap('notion-registrants.json');
  // שורות שנמחקו/אורכבו בנושן עצמו אבל מבחנים או פעילויות עדיין מצביעים עליהן —
  // נשלפו בנפרד ומיובאות תמיד כ-archived.
  const archivedPath = path.resolve(HERE, 'notion-registrants-archived.json');
  if (fs.existsSync(archivedPath)) {
    const archivedRows = JSON.parse(fs.readFileSync(archivedPath, 'utf8')).rows
      .filter((r) => !r.error)
      .map((r) => ({ ...r, notionArchived: true }));
    report.notionArchivedRows = archivedRows.length;
    registrants.push(...archivedRows);
  }
  const levelTests = readSnap('notion-level-tests.json');
  const securityTests = readSnap('notion-security-tests.json');
  const catalog = readSnap('notion-activities-catalog.json');
  const participants = readSnap('notion-activity-participants.json');

  console.log(`📖 ${registrants.length} רשומים, ${levelTests.length} מבחני רמה, ${securityTests.length} מבחני אבטוח, ${catalog.length} פעילויות, ${participants.length} משתתפים`);
  console.log(APPLY ? '✍️  מצב כתיבה\n' : '🔍 הדמיה בלבד — הרץ עם --apply כדי לכתוב\n');

  // ── גיבוי לפני כתיבה ──
  if (APPLY) {
    const backup = {};
    for (const t of ['parents', 'students', 'level_tests', 'activities', 'activity_registrations']) {
      backup[t] = await supa.getAll(t);
    }
    const backupPath = path.resolve(HERE, `backup-before-notion-import-${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(backup));
    fs.copyFileSync(path.resolve(HERE, '../db.json'), `${backupPath}.db.json`);
    console.log(`💾 גיבוי נשמר: ${backupPath}\n`);
  }

  // ── סינון וקיבוץ משפחות ──
  const kept = [];
  for (const row of registrants) {
    const statusKey = hebOnly(row.status);
    if (!row.notionArchived && SKIP_STATUSES.has(statusKey)) {
      report.skippedByStatus[statusKey] = (report.skippedByStatus[statusKey] || 0) + 1;
      continue;
    }
    kept.push(row);
  }

  const families = new Map(); // key -> rows[]
  for (const row of kept) {
    const key = normalizeParentPhone(row.phone) || `nophone:${row.pageId}`;
    if (!families.has(key)) families.set(key, []);
    families.get(key).push(row);
  }
  report.families = families.size;
  report.phonelessFamilies = [...families.keys()].filter((k) => k.startsWith('nophone:')).length;

  // עותקים חיים של המצב הקיים — גדלים תוך כדי ריצה לזיהוי כפילויות פנימיות.
  const allParents = [...(db.get('parents') || [])];
  const allStudents = [...(db.get('students') || [])];

  const studentIdByPageId = new Map(); // pageId של שורת Notion -> id מתאמן סופי
  const parentIdByPageId = new Map();

  // ── הורים + מתאמנים, משפחה-משפחה ──
  for (const [famKey, rows] of families) {
    // איחוד ילדים כפולים בתוך המשפחה: אותו שם + אותו תאריך לידה (או שחסר אחד מהם)
    const childRows = [];
    const junkRows = [];
    for (const row of rows) {
      if (isJunkChildName(row.child_name)) { junkRows.push(row); continue; }
      const dup = childRows.find((r) =>
        normalizedChildName(r.child_name) === normalizedChildName(row.child_name) &&
        (!r.birth_date || !row.birth_date || dateOnly(r.birth_date) === dateOnly(row.birth_date))
      );
      if (dup) {
        // משאירים את השורה עם הסטטוס הגבוה, ממזגים פרטים חסרים
        const keepRow = rank(statusOfRow(row)) > rank(statusOfRow(dup)) ? row : dup;
        const dropRow = keepRow === row ? dup : row;
        for (const f of ['birth_date', 'gender', 'city', 'email', 'child_phone', 'reg_notes', 'parent_name']) {
          if (!keepRow[f] && dropRow[f]) keepRow[f] = dropRow[f];
        }
        keepRow.mergedPageIds = [...(keepRow.mergedPageIds || []), dropRow.pageId, ...(dropRow.mergedPageIds || [])];
        childRows[childRows.indexOf(dup)] = keepRow;
        report.duplicateChildrenCollapsed.push(`${row.child_name} (${famKey})`);
        continue;
      }
      childRows.push(row);
    }
    report.parentOnlyRows += junkRows.length;

    const infoRows = [...childRows, ...junkRows];
    const phone = famKey.startsWith('nophone:') ? '' : famKey;

    // שם ההורה: ערך הרוב מבין השורות שיש בהן שם הורה
    const parentNames = infoRows.map((r) => String(r.parent_name || '').trim()).filter(Boolean);
    const nameCounts = new Map();
    for (const n of parentNames) nameCounts.set(n, (nameCounts.get(n) || 0) + 1);
    let parentName = [...nameCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';

    // אין שם הורה בכלל → האדם עצמו הוא בעל הכרטיס (מבוגר/לקוח מזדמן)
    const selfCard = !parentName && childRows.length > 0;
    if (selfCard) parentName = String(childRows[0].child_name).trim();

    // שם משפחה מהילדים — רק אם עקבי
    const surnames = [...new Set(childRows.map((r) => surnameOf(r.child_name)).filter(Boolean))];
    const lastName = surnames.length === 1 ? surnames[0] : '';

    const email = infoRows.map((r) => String(r.email || '').trim()).find(Boolean) || '';
    const city = infoRows.map((r) => String(r.city || '').trim()).find(Boolean) || '';
    const famStatus = infoRows.map((r) => statusOfRow(r)).sort((a, b) => rank(b) - rank(a))[0] || 'lead_new';
    const notionStatuses = [...new Set(infoRows.map((r) =>
      (r.notionArchived ? 'נמחק בנושן' : hebOnly(r.status))).filter(Boolean))];
    const importNote = `יובא מ-Notion · סטטוס מקורי: ${notionStatuses.join(', ') || 'ללא'}`;

    if (!parentName) report.parentsNameless.push(famKey);

    // התאמה לכרטיס קיים לפי טלפון
    let parent = phone ? allParents.find((p) => parentPhonesMatch(p.phone, phone)) : null;

    if (parent) {
      const fills = {};
      const hadPlaceholder = PLACEHOLDER_NAMES.has(parent.name) || !parent.name;
      if (parentName && hadPlaceholder) fills.name = parentName;
      if (lastName && !parent.lastName) fills.lastName = lastName;
      if (email && !parent.email) fills.email = email;
      if (city && !parent.city) fills.city = city;
      if (!parent.source || parent.source === 'unknown') fills.source = SOURCE;
      if (!parent.status || parent.status === 'lead_new' || rank(famStatus) > rank(parent.status)) {
        fills.status = famStatus;
      }
      if (!String(parent.notes || '').includes('יובא מ-Notion')) {
        fills.notes = (parent.notes ? `${parent.notes}\n` : '') + importNote;
      }
      if (phone) fills.phone = phone; // פורמט קנוני אחיד
      if (APPLY) {
        const saved = db.update('parents', parent.id, fills);
        await supa.upsert('parents', saved);
        parent = saved;
      } else {
        parent = { ...parent, ...fills };
      }
      const idx = allParents.findIndex((p) => p.id === parent.id);
      allParents[idx] = parent;
      report.parentsMerged.push(`${parentName || '(ללא שם)'} ← ${hadPlaceholder ? 'כרטיס וואטסאפ' : parent.id}`);
    } else {
      parent = {
        id: `pn_${rows[0].pageId}`,
        name: parentName,
        lastName,
        idNumber: '',
        phone,
        email,
        city,
        source: SOURCE,
        status: famStatus,
        nextFollowup: null,
        notes: importNote,
        created_at: dateOnly(rows[0].createdTime) ? `${dateOnly(rows[0].createdTime)}T00:00:00.000Z` : undefined,
      };
      const existingById = db.getOne('parents', parent.id);
      if (APPLY) {
        const saved = existingById ? db.update('parents', parent.id, parent) : db.insert('parents', parent);
        await supa.upsert('parents', saved);
        parent = saved;
      }
      allParents.push(parent);
      report.parentsCreated += 1;
    }
    for (const row of rows) parentIdByPageId.set(row.pageId, parent.id);

    // ── מתאמנים ──
    for (const row of childRows) {
      const childName = String(row.child_name).trim();
      const birthDate = dateOnly(row.birth_date) || '';
      const age = ageOf(birthDate);
      const status = statusOfRow(row);
      const noteParts = [
        row.notionArchived
          ? `נמחק בנושן (סטטוס אחרון: ${hebOnly(row.status) || 'ללא'})`
          : `סטטוס בנושן: ${hebOnly(row.status) || 'ללא'}`,
      ];
      if (row.reg_notes) noteParts.push(String(row.reg_notes).trim());
      if (row.kind) noteParts.push(`סוג: ${hebOnly(row.kind)}`);
      noteParts.push('יובא מ-Notion');

      const stableId = `sn_${row.pageId}`;
      let student = db.getOne('students', stableId) || allStudents.find((s) => s.id === stableId);

      if (!student) {
        // התאמה למתאמן קיים: שם + תאריך לידה (שם בלבד לא מספיק)
        const matches = allStudents.filter((s) =>
          normalizedChildName(s.name) === normalizedChildName(childName) &&
          (!birthDate || !s.birthDate || dateOnly(s.birthDate) === birthDate)
        );
        if (matches.length === 1) student = matches[0];
        else if (matches.length > 1) {
          report.studentsAmbiguous.push(`${childName} — נוצר חדש כי יש כמה התאמות קיימות`);
        }
      }

      if (student && !String(student.id).startsWith('sn_')) {
        const fills = {};
        if (birthDate && !student.birthDate) fills.birthDate = birthDate;
        if (row.gender && !student.gender) fills.gender = row.gender === 'בת' ? 'female' : 'male';
        const sPhone = childPhoneOf(row.child_phone);
        if (sPhone && !student.phone) fills.phone = sPhone;
        if (rank(status) > rank(student.status)) fills.status = status;
        if (!String(student.notes || '').includes('יובא מ-Notion')) {
          fills.notes = (student.notes ? `${student.notes}\n` : '') + noteParts.join(' · ');
        }
        if (APPLY) {
          const saved = db.update('students', student.id, fills);
          await supa.upsert('students', saved);
          student = saved;
        } else {
          student = { ...student, ...fills };
        }
        const idx = allStudents.findIndex((s) => s.id === student.id);
        allStudents[idx] = student;
        report.studentsMergedExisting.push(`${childName} ← ${student.id}`);
      } else if (!student) {
        student = {
          id: stableId,
          name: childName,
          parentId: parent.id,
          groupId: null,
          status,
          birthDate,
          gender: row.gender === 'בת' ? 'female' : row.gender === 'בן' ? 'male' : '',
          phone: childPhoneOf(row.child_phone),
          isAdult: selfCard ? (age === null || age >= 18) : (age !== null && age >= 18),
          interests: [],
          levelGrade: null,
          source: SOURCE,
          segment: null,
          nextFollowup: null,
          notes: noteParts.join(' · '),
          created: dateOnly(row.createdTime) || undefined,
        };
        if (APPLY) {
          const saved = db.insert('students', student);
          await supa.upsert('students', saved);
          student = saved;
        }
        allStudents.push(student);
        report.studentsCreated += 1;
      }

      studentIdByPageId.set(row.pageId, student.id);
      for (const mergedPid of row.mergedPageIds || []) studentIdByPageId.set(mergedPid, student.id);
    }
  }

  // מפת שם→מתאמן להתאמת מבחנים שהקשר שלהם ל-Notion חסר
  const studentsByName = new Map();
  for (const s of allStudents) {
    const key = normalizedChildName(s.name);
    if (!studentsByName.has(key)) studentsByName.set(key, []);
    studentsByName.get(key).push(s);
  }
  const resolveStudent = (climberPageId, title) => {
    if (climberPageId && studentIdByPageId.has(climberPageId)) {
      const id = studentIdByPageId.get(climberPageId);
      return allStudents.find((s) => s.id === id) || null;
    }
    // כותרות מבחנים מגיעות גם כ"📈 - שם הילד" — מנקים לפני התאמת שם
    const cleanTitle = String(title || '').replace(/[^א-תa-zA-Z ]/g, ' ');
    const byName = studentsByName.get(normalizedChildName(cleanTitle)) || [];
    return byName.length === 1 ? byName[0] : null;
  };

  // ── מבחני רמה והובלה ──
  const levelRe = /^[5-8][ABC]$/;
  const testsToWrite = [];
  for (const t of levelTests) {
    const level = String(t.level || '').trim();
    if (level === 'לא עשה' || level === 'בהמתנה') { report.levelTests.skippedNotTaken += 1; continue; }

    let testType, passed, routeStyle = null, grade = null;
    if (levelRe.test(level)) {
      testType = 'level'; passed = true; grade = level;
      routeStyle = t.style === 'הובלה' ? 'lead' : 'top-rope';
      report.levelTests.level += 1;
    } else if (level === 'עבר מבחן הובלה') {
      testType = 'lead'; passed = true; report.levelTests.lead += 1;
    } else if (level === 'נכשל מבחן הובלה') {
      testType = 'lead'; passed = false; report.levelTests.lead += 1;
    } else if (!level && t.style === 'הובלה') {
      // דף מבחן הובלה בלי תוצאה מסומנת — כישלון היה מסומן, לכן נספר כעבר
      testType = 'lead'; passed = true; report.levelTests.leadNoResult += 1;
    } else {
      report.levelTests.noResult.push(`${t.title || '(ללא שם)'} — רמה="${level}" סגנון="${t.style || ''}"`);
      continue;
    }

    const student = resolveStudent(t.climberPageId, t.title);
    if (!student) {
      report.levelTests.unresolved.push(`${t.title || '(ללא שם)'} (${dateOnly(t.test_date) || dateOnly(t.createdTime)})`);
      continue;
    }

    testsToWrite.push({
      id: `ltn_${t.pageId}`,
      studentId: student.id,
      studentName: student.name,
      climber_id: student.id,
      grade,
      level: grade,
      test_type: testType,
      route_style: routeStyle,
      route_type: routeStyle,
      examiner: LEVEL_EXAMINER,
      examinerId: null,
      date: dateOnly(t.test_date) || dateOnly(t.createdTime),
      notes: [String(t.notes || '').trim(), 'יובא מ-Notion'].filter(Boolean).join(' · '),
      passed,
      status: passed ? 'passed' : 'failed',
      attended_ceremony: yes(t.ceremony),
      ceremony: yes(t.ceremony),
    });
  }

  // ── מבחני אבטוח ──
  // הנחיית הבעלים: בפועל תמיד נרשם מתאמן במסד רק אחרי שעבר בפועל את המבחן —
  // תיבת ה"עבר" בנושן לא עודכנה באופן אמין, ולכן כל מבחן מיובא נכנס כ"עבר".
  // אפשרות לסמן מבחן עתידי כ"נכשל" נשארת פתוחה במסך עצמו.
  for (const t of securityTests) {
    const student = resolveStudent(t.climberPageId, t.title);
    if (!student) {
      report.securityTests.unresolved.push(`${t.title || '(ללא שם)'} (${dateOnly(t.test_date) || dateOnly(t.createdTime)})`);
      continue;
    }
    if (t.examinerName) report.securityTests.withExaminer += 1;
    if (!yes(t.passed)) report.securityTests.forcedPassed += 1;
    report.securityTests.imported += 1;
    testsToWrite.push({
      id: `lts_${t.pageId}`,
      studentId: student.id,
      studentName: student.name,
      climber_id: student.id,
      grade: null,
      level: null,
      test_type: 'security',
      route_style: null,
      route_type: null,
      examiner: t.examinerName || null,
      examinerId: null,
      date: dateOnly(t.test_date) || dateOnly(t.createdTime),
      notes: 'יובא מ-Notion',
      passed: true,
      status: 'passed',
      attended_ceremony: false,
      ceremony: false,
    });
  }

  if (APPLY) {
    for (const test of testsToWrite) {
      const exists = db.getOne('level_tests', test.id);
      const saved = exists ? db.update('level_tests', test.id, test) : db.insert('level_tests', test);
      await supa.upsert('level_tests', saved);
    }
  }

  // ── עדכון רמת המתאמן: המבחן העדכני ביותר שעבר ──
  const bestLevel = new Map();
  for (const test of testsToWrite) {
    if (test.test_type !== 'level' || !test.passed || !test.level) continue;
    const cur = bestLevel.get(test.studentId);
    if (!cur || String(test.date) > String(cur.date) ||
        (String(test.date) === String(cur.date) && test.level > cur.level)) {
      bestLevel.set(test.studentId, test);
    }
  }
  let levelGradeUpdates = 0;
  for (const [studentId, test] of bestLevel) {
    const student = allStudents.find((s) => s.id === studentId);
    if (!student || student.levelGrade === test.level) continue;
    levelGradeUpdates += 1;
    if (APPLY) {
      const saved = db.update('students', studentId, { levelGrade: test.level });
      await supa.upsert('students', saved);
    }
  }

  // ── פעילויות ארכיון ──
  const activityTypeOf = (kind) => {
    const k = hebOnly(kind);
    if (k.includes('שטח') || k.includes('מחנה')) return 'trip';
    if (k.includes('תחרות') || k.includes('קיר')) return 'event';
    return 'other';
  };
  for (const a of catalog) {
    const rec = {
      id: `acn_${a.pageId}`,
      name: String(a.name || '').trim() || 'פעילות מ-Notion',
      type: activityTypeOf(a.kind),
      category: hebOnly(a.kind) || null,
      status: hebOnly(a.status) === 'בוטל' ? 'cancelled' : 'closed',
      date: dateOnly(a.start_date),
      end_date: dateOnly(a.end_date),
      start_time: null,
      end_time: null,
      all_day: true,
      location: a.siteName || null,
      notes: 'יובא מ-Notion (ארכיון)',
      // show_on_site לא נשלח: העמודה חסרה במסד החי (ראו database/20260802_activities_show_on_site.sql)
      registration_enabled: false,
      collect_registration_payment: false,
    };
    report.activities.push(`${rec.name} — ${rec.type}/${rec.status}${rec.date ? ` (${rec.date})` : ''}`);
    if (APPLY) {
      const exists = db.getOne('activities', rec.id);
      const saved = exists ? db.update('activities', rec.id, rec) : db.insert('activities', rec);
      await supa.upsert('activities', saved);
    }
  }

  // ── משתתפים בפעילויות ──
  const IMPORT_PART_STATUSES = new Set(['שילם', 'השתתף', 'אישר הגעה']);
  for (const p of participants) {
    const status = String(p.status || '').trim();
    if (!IMPORT_PART_STATUSES.has(status)) {
      const key = status || '(ריק)';
      report.registrations.skippedByStatus[key] = (report.registrations.skippedByStatus[key] || 0) + 1;
      continue;
    }
    if (!p.activityPageId) {
      report.registrations.skippedByStatus['ללא פעילות מקושרת'] =
        (report.registrations.skippedByStatus['ללא פעילות מקושרת'] || 0) + 1;
      continue;
    }
    const student = resolveStudent(p.climberPageId, p.title);
    const parentId = student?.parentId || null;
    const parent = parentId ? allParents.find((x) => x.id === parentId) : null;
    if (!student) report.registrations.nameOnly += 1;
    report.registrations.imported += 1;

    const rec = {
      id: `arn_${p.pageId}`,
      activity_id: `acn_${p.activityPageId}`,
      student_id: student?.id || null,
      parent_id: parentId,
      participant_name: student?.name || String(p.title || '').trim(),
      phone: parent?.phone || null,
      email: parent?.email || null,
      payment_status: 'not_required',
      amount: null,
      paid_at: null,
      status: 'confirmed',
      notes: [`סטטוס בנושן: ${status}`, String(p.notes || '').trim(), 'יובא מ-Notion'].filter(Boolean).join(' · '),
      participant_type: student?.isAdult ? 'adult' : 'child',
    };
    if (APPLY) {
      const exists = db.getOne('activity_registrations', rec.id);
      const saved = exists ? db.update('activity_registrations', rec.id, rec) : db.insert('activity_registrations', rec);
      await supa.upsert('activity_registrations', saved);
    }
  }

  // ── דוח ──
  const fmtList = (arr, max = 15) =>
    arr.slice(0, max).map((l) => `   • ${l}`).join('\n') + (arr.length > max ? `\n   … ועוד ${arr.length - max}` : '');

  console.log('── סינון ──');
  for (const [k, v] of Object.entries(report.skippedByStatus)) console.log(`   דולג "${k}": ${v}`);
  console.log(`\n── משפחות ── ${report.families} (מתוכן ${report.phonelessFamilies} בלי טלפון)`);
  console.log(`   שורות הורה-בלבד (facebook/XXX): ${report.parentOnlyRows}`);
  if (report.duplicateChildrenCollapsed.length) {
    console.log(`   ילדים כפולים שאוחדו: ${report.duplicateChildrenCollapsed.length}`);
  }
  console.log(`\n── הורים ── חדשים: ${report.parentsCreated}, מוזגו לקיימים: ${report.parentsMerged.length}`);
  if (report.parentsMerged.length) console.log(fmtList(report.parentsMerged));
  if (report.parentsNameless.length) {
    console.log(`   ⚠️ בלי שום שם (לטיפול ידני): ${report.parentsNameless.length}`);
  }
  console.log(`\n── מתאמנים ── חדשים: ${report.studentsCreated}, מוזגו לקיימים: ${report.studentsMergedExisting.length}`);
  if (report.studentsMergedExisting.length) console.log(fmtList(report.studentsMergedExisting));
  if (report.studentsAmbiguous.length) {
    console.log(`   ⚠️ שם כפול (נוצרו בנפרד): ${report.studentsAmbiguous.length}`);
    console.log(fmtList(report.studentsAmbiguous));
  }
  if (report.notionArchivedRows) {
    console.log(`   שוחזרו מדפים שנמחקו בנושן: ${report.notionArchivedRows} (יובאו כארכיון)`);
  }
  const lt = report.levelTests;
  console.log(`\n── מבחני רמה והובלה ── רמה: ${lt.level}, הובלה: ${lt.lead}, הובלה ללא תוצאה (נספרו כעברו): ${lt.leadNoResult}`);
  console.log(`   דולגו "לא עשה"/"בהמתנה": ${lt.skippedNotTaken}, בלי תוצאה: ${lt.noResult.length}, בלי מטפס מזוהה: ${lt.unresolved.length}`);
  if (lt.unresolved.length) console.log(fmtList(lt.unresolved));
  const st = report.securityTests;
  console.log(`\n── מבחני אבטוח ── יובאו: ${st.imported} (עם בוחן: ${st.withExaminer}), נכפו כ"עבר" (Notion סימן אחרת): ${st.forcedPassed}, בלי נבחן מזוהה: ${st.unresolved.length}`);
  if (st.unresolved.length) console.log(fmtList(st.unresolved));
  console.log(`   עדכוני רמה למתאמנים: ${levelGradeUpdates}`);
  console.log(`\n── פעילויות ארכיון ── ${report.activities.length}`);
  console.log(fmtList(report.activities, 50));
  const rg = report.registrations;
  console.log(`\n── משתתפים בפעילויות ── יובאו: ${rg.imported} (מתוכם בשם בלבד: ${rg.nameOnly})`);
  for (const [k, v] of Object.entries(rg.skippedByStatus)) console.log(`   דולג "${k}": ${v}`);
  if (Object.keys(report.unmappedStatuses).length) {
    console.log('\n⚠️ סטטוסים לא ממופים (קיבלו lead_new):');
    for (const [k, v] of Object.entries(report.unmappedStatuses)) console.log(`   "${k}": ${v}`);
  }

  fs.writeFileSync(
    path.resolve(HERE, 'notion-import-report.json'),
    JSON.stringify(report, null, 1)
  );
  console.log('\n📝 הדוח המלא: scripts/notion-import-report.json');

  // ── אימות קריאה-חוזרת אחרי כתיבה ──
  if (APPLY) {
    console.log('\n── אימות מול Supabase ──');
    const fresh = {};
    for (const t of ['parents', 'students', 'level_tests', 'activities', 'activity_registrations']) {
      fresh[t] = await supa.getAll(t);
    }
    const count = (rows, prefix) => rows.filter((r) => String(r.id).startsWith(prefix)).length;
    const checks = [
      ['parents pn_', count(fresh.parents, 'pn_'), report.parentsCreated],
      ['students sn_', count(fresh.students, 'sn_'), report.studentsCreated],
      ['level_tests ltn_', count(fresh.level_tests, 'ltn_'), lt.level + lt.lead + lt.leadNoResult - lt.unresolved.filter((u) => !u.startsWith('מתאמן')).length],
      ['activities acn_', count(fresh.activities, 'acn_'), report.activities.length],
      ['registrations arn_', count(fresh.activity_registrations, 'arn_'), rg.imported],
    ];
    let ok = true;
    const studentIds = new Set(fresh.students.map((s) => s.id));
    const parentIds = new Set(fresh.parents.map((p) => p.id));
    const activityIds = new Set(fresh.activities.map((a) => a.id));
    for (const [label, got] of checks) console.log(`   ${label}: ${got}`);
    const orphanStudents = fresh.students.filter((s) => String(s.id).startsWith('sn_') && s.parent_id && !parentIds.has(s.parent_id));
    const orphanRegs = fresh.activity_registrations.filter((r) => String(r.id).startsWith('arn_') && !activityIds.has(r.activity_id));
    const orphanTests = fresh.level_tests.filter((r) => (String(r.id).startsWith('ltn_') || String(r.id).startsWith('lts_')) && r.studentId && !studentIds.has(r.studentId));
    if (orphanStudents.length) { ok = false; console.log(`   ❌ מתאמנים עם הורה חסר: ${orphanStudents.length}`); }
    if (orphanRegs.length) { ok = false; console.log(`   ❌ הרשמות עם פעילות חסרה: ${orphanRegs.length}`); }
    if (orphanTests.length) { ok = false; console.log(`   ❌ מבחנים עם מתאמן חסר: ${orphanTests.length}`); }
    console.log(ok ? '   ✅ שלמות הפניות תקינה' : '   ❌ נמצאו בעיות שלמות — לבדוק לפני שימוש');
  }
}

const main = ROLLBACK ? rollback : run;
main().then(() => process.exit(0)).catch((err) => {
  console.error('❌ נכשל:', err?.stack || err?.message || err);
  process.exit(1);
});
