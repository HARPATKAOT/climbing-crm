import 'dotenv/config';
import { db, initDb } from '../db.js';
import { INTRO_COLLECTION, WAITLIST_COLLECTION, migrationDryRun } from '../registrationLifecycle.js';

await initDb({ requireDurable: process.env.NODE_ENV === 'production' });

const report = migrationDryRun({
  students: db.withStudentRelations(db.get('students') || []),
  groups: db.get('groups') || [],
  centreChecks: db.get('centre_registration_checks') || [],
  waitlists: db.get(WAITLIST_COLLECTION) || [],
  introBookings: db.get(INTRO_COLLECTION) || [],
});

console.log(JSON.stringify(report, null, 2));
if (!report.safe_to_apply) process.exitCode = 2;
