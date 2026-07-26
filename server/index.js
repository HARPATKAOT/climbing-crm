import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import { db, initDb, persistCore, parentPhonesMatch } from './db.js';
import { supa } from './supa.js';
import { whatsappService, instagramService } from './whatsapp.js';
import { whatsappConnectService } from './whatsappConnect.js';
import { automationsService, runScheduledAutomationsIfDue } from './automations.js';
import { icount } from './icount.js';
import { apiAuth, requireOwner } from './auth.js';
import { googleCalendarService } from './googleCalendar.js';
import {
  sendActivityRegistrationConfirmation,
  sendHostRegistrationLink,
  isEmailConfigured,
} from './email.js';
import {
  makeRegistrationSlug,
  makePrivatePaymentToken,
  normalizeHostPaymentStatus,
  activeRegistrations,
  remainingCapacity,
  registrationIsOpen,
  findActivityBySlug,
  publicRegistrationPayload,
  templateFieldsFromActivity,
  normalizeTemplatePayload as normalizeActivityTemplatePayload,
  openUnpaidActivities,
  listActivityTemplates,
  groupTemplatesByCategory,
  ensureSeedActivityTemplates,
  sanitizeRegistrationTheme,
  normalizeActivityTheme,
  activityDraftFromTemplate,
  TEMPLATE_CATEGORIES,
} from './activityRegistration.js';
import {
  buildRegistrationRefundPlan,
  applyRegistrationRefundMarks,
  buildHostRefundPlan,
  applyHostRefundMarks,
  summarizeHostPayment,
} from './activityRegistrationRefund.js';
import { chargeAmount, normalizePriceIncludesVat, icountVatType } from './vat.js';
import {
  registerActivityGroup,
  markRegistrationOrderPaid,
  markHostedActivityPaid,
} from './activityRegistrationOrderService.js';
import {
  resolveDeclarationTemplate,
  resolveDefaultDeclarationTemplate,
  findLatestValidDeclaration,
  saveCrmParticipants,
} from './crmWaiverService.js';
import {
  declarationSignedAt,
  isHealthDeclarationValid,
} from './healthValidity.js';
import {
  enrichPricelistItem,
  buildPassFromItem,
  computeSaleTotal,
  pickBestPunchCard,
  isPassUsable,
  normalizeProductType,
  PRODUCT_TYPES,
  requiresCustomer,
  listTrackedInventory,
  listExpiringPasses,
  aggregatePosSales,
} from './posUtils.js';
import {
  EQUIPMENT_ITEM_TYPES,
  EQUIPMENT_ITEM_LABELS,
  EQUIPMENT_TEMPLATE_NAME,
  DEFAULT_EQUIPMENT_SETTINGS,
  normalizeEquipmentSettings,
  isKidStudent,
  ensureStudentEquipment,
  markEquipmentItemsPaid,
  resetShoeRental,
  markEquipmentGiven,
  markEquipmentPendingFulfillment,
  computeEquipmentTotal,
  describeEquipmentItems,
  equipmentGapFlags,
  newCheckoutToken,
  ensureEquipmentWhatsappTemplate,
} from './equipmentService.js';
import {
  EVENT_HOST_PAYMENT_TEMPLATE,
  EVENT_PARTICIPANT_LINK_TEMPLATE,
  ensureEventWhatsappTemplates,
  findApprovedEventTemplate,
} from './eventWhatsappTemplates.js';
import {
  ensureProductCategories,
  renameCategoryOnProducts,
  clampImage,
} from './productCategories.js';
import {
  getBusinessProfile,
  saveBusinessProfile,
  safeBusinessProfile,
} from './businessProfile.js';
import { applyBusinessBrand, resetPlaygroundConversation } from './whatsappBot.js';
import { countEnrolled } from './groupCapacity.js';
import {
  ensureAttendanceRows,
  israelDateStr,
  israelHour,
  normalizeAttStatus,
} from './attendanceUtils.js';
import {
  getConversation,
  replyToParent,
  updateMessageStatusByMetaId,
  handleMessengerIncoming,
  markCommunicationHandled,
} from './channels/conversations.js';
import {
  rebuildLogMirrorFromMessages,
  startPendingMessageRetry,
  flushPendingMessages,
  countPendingMessages,
} from './channels/messageStore.js';
import { canSendFreeform } from './channels/sessionWindow.js';
import {
  listLocalTemplates,
  listApprovedTemplates,
  createDraftTemplate,
  updateLocalTemplate,
  deleteLocalTemplate,
  moveTemplate,
  submitTemplateToMeta,
  syncTemplatesFromMeta,
  applyTemplateStatusUpdate,
} from './channels/templates.js';
import {
  previewAudience,
  listSavedSegments,
  saveSegment,
  deleteSegment,
  INTEREST_OPTIONS,
} from './channels/segments.js';
import { startBroadcastJob, getBroadcastJob, listBroadcastJobs } from './channels/broadcast.js';
import { mediaCredentialsStatus } from './channels/media.js';

const app = express();
const PORT = process.env.PORT || 5000;
const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v25.0';
app.set('trust proxy', 1);

const configuredOrigins = String(process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = new Set([
  'https://client-omega-topaz-35.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  ...configuredOrigins,
]);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin) || (origin && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')))) {
      return callback(null, true);
    }
    return callback(new Error('Origin is not allowed'));
  },
}));
app.use(express.json({
  limit: '15mb',
  verify(req, _res, buffer) {
    req.rawBody = buffer;
  },
}));
// iCount payment-page IPN often posts as form-urlencoded
app.use(express.urlencoded({ extended: true }));

// ─────────────────────────────────────────────────────────────────────────────
// 1. CRM GENERAL ENDPOINTS (Database Synced)
// ─────────────────────────────────────────────────────────────────────────────

// Health check endpoint for uptime monitoring & keep-alive.
// `?deep=1` also probes the durable store and the message write queue, so a
// monitor can tell "process alive" apart from "actually able to serve".
app.get('/api/health', async (req, res) => {
  const base = {
    status: 'UP',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  };

  if (!req.query.deep) return res.status(200).json(base);

  const store = await supa.ping();
  const pendingMessages = countPendingMessages();
  const healthy = store.ok && pendingMessages === 0;

  return res.status(healthy ? 200 : 503).json({
    ...base,
    status: healthy ? 'UP' : 'DEGRADED',
    database: store.ok ? { ok: true, ms: store.ms } : { ok: false, error: store.error },
    serviceRoleKey: supa.hasServiceRoleKey(),
    pendingMessages,
  });
});

/** Short public redirect: WhatsApp template button → iCount payment URL */
function resolveStoredPaymentUrl(paymentId) {
  const id = String(paymentId || '').trim();
  if (!id) return '';
  const payment = db.getOne('payments', id);
  if (payment?.payment_url) return String(payment.payment_url);
  const sales = db.get('pos_sales') || [];
  const sale =
    sales.find((row) => String(row.payment_id || '') === id) ||
    sales.find((row) => String(row.id || '') === String(payment?.pos_sale_id || '')) ||
    null;
  if (sale?.payment_url) return String(sale.payment_url);
  return '';
}

function redirectPaymentLink(req, res) {
  const paymentId = String(req.params.paymentId || '').trim();
  if (!paymentId) return res.status(400).send('חסר מזהה תשלום');
  const payUrl = resolveStoredPaymentUrl(paymentId);
  if (!payUrl) {
    return res
      .status(404)
      .type('html')
      .send(
        '<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8" />' +
          '<title>קישור לא נמצא</title><body style="font-family:sans-serif;padding:24px">' +
          '<h1>קישור התשלום לא נמצא או שפג תוקפו</h1>' +
          '<p>פנו לצוות My Wall לקבלת קישור חדש.</p></body></html>'
      );
  }
  // Heal payments row if the URL only lived on the sale (older / partial writes).
  try {
    const payment = db.getOne('payments', paymentId);
    if (payment && !payment.payment_url) {
      db.update('payments', paymentId, {
        payment_url: payUrl,
        updated_at: new Date().toISOString(),
      });
    }
  } catch {
    /* non-fatal */
  }
  return res.redirect(302, payUrl);
}
app.get('/r/:paymentId', redirectPaymentLink);
app.get('/api/r/:paymentId', redirectPaymentLink);

app.use('/api', apiAuth);

app.get('/api/auth/me', (req, res) => {
  res.json(req.crmUser);
});

app.get('/api/public/business-profile', async (_req, res) => {
  try {
    const profile = await getBusinessProfile();
    res.json(safeBusinessProfile(profile));
  } catch (error) {
    console.error('business profile public load error:', error.message);
    res.json(safeBusinessProfile());
  }
});

app.get('/api/settings/business-profile', requireOwner, async (_req, res) => {
  try {
    res.json(await getBusinessProfile({ fresh: true }));
  } catch (error) {
    res.status(503).json({ error: error.message || 'טעינת פרטי העסק נכשלה' });
  }
});

app.put('/api/settings/business-profile', requireOwner, async (req, res) => {
  try {
    res.json(await saveBusinessProfile(req.body || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || 'שמירת פרטי העסק נכשלה' });
  }
});

const publicRequestWindows = new Map();
function publicFormRateLimit(req, res, next) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const current = publicRequestWindows.get(key);
  if (!current || current.resetAt <= now) {
    if (publicRequestWindows.size > 5000) {
      for (const [storedKey, value] of publicRequestWindows) {
        if (value.resetAt <= now) publicRequestWindows.delete(storedKey);
      }
    }
    publicRequestWindows.set(key, { count: 1, resetAt: now + windowMs });
    return next();
  }
  current.count += 1;
  if (current.count > 20) {
    res.set('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
    return res.status(429).json({ error: 'יותר מדי בקשות. אפשר לנסות שוב בעוד כמה דקות' });
  }
  return next();
}

// Re-pull CRM-core collections from Supabase into the local db.json cache.
// Useful after durable-store seed/repair without waiting for a full redeploy cycle.
app.post('/api/admin/reload-core', requireOwner, async (req, res) => {
  try {
    await initDb();
    const groups = db.get('groups') || [];
    const students = db.get('students') || [];
    const parents = db.get('parents') || [];
    res.json({
      ok: true,
      counts: {
        groups: groups.length,
        students: students.length,
        parents: parents.length,
      },
    });
  } catch (err) {
    console.error('reload-core failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// One-shot / on-demand merge of parent cards that share the same phone (050… vs 972…).
app.post('/api/admin/merge-duplicate-parents', requireOwner, (req, res) => {
  try {
    const result = db.mergeAllDuplicateParentsByPhone();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('merge-duplicate-parents failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Get all parents (prefer Supabase so Render never serves a stale empty cache)
app.get('/api/parents', async (req, res) => {
  try {
    if (supa.isEnabled()) {
      const rows = await supa.getAll('parents');
      if (rows) {
        if (typeof db.set === 'function') db.set('parents', rows);
        return res.json(rows);
      }
    }
  } catch (err) {
    console.error('GET /api/parents Supabase error:', err.message);
  }
  res.json(db.get('parents'));
});

// Get all students (prefer Supabase)
app.get('/api/students', async (req, res) => {
  try {
    if (supa.isEnabled()) {
      const rows = await supa.getAll('students');
      if (rows) {
        if (typeof db.set === 'function') db.set('students', rows);
        return res.json(rows);
      }
    }
  } catch (err) {
    console.error('GET /api/students Supabase error:', err.message);
  }
  res.json(db.get('students'));
});

function withGroupEnrollmentCounts(groups, students) {
  // Dedupe by id (local cache can accumulate duplicates after naive re-seeds).
  const byId = new Map();
  for (const g of groups || []) {
    if (g?.id) byId.set(g.id, g);
  }
  return [...byId.values()].map(g => ({
    ...g,
    enrolled: countEnrolled(g.id, students || []),
  }));
}

// Get all groups (with live enrolled count computed from students).
// Prefer Supabase so Render never serves a stale empty db.json after groups
// were re-seeded in the durable store without a process restart.
app.get('/api/groups', async (req, res) => {
  try {
    if (supa.isEnabled()) {
      const rows = await supa.getAll('groups');
      if (rows) {
        const students = (await supa.getAll('students')) || db.get('students') || [];
        // Keep the local cache warm for write paths that still use db.json.
        if (typeof db.set === 'function') db.set('groups', rows);
        return res.json(withGroupEnrollmentCounts(rows, students));
      }
    }
  } catch (err) {
    console.error('GET /api/groups Supabase error:', err.message);
  }
  res.json(withGroupEnrollmentCounts(db.get('groups'), db.get('students')));
});

// Update student status
app.put('/api/students/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const updated = db.update('students', id, { status });
  if (!updated) return res.status(404).json({ error: 'Student not found' });
  
  // Trigger automation event
  automationsService.triggerEvent('status_changed', { ...updated, new_status: status });
  
  res.json(updated);
});

// Shared lead intake helper (CRM + public form)
async function ingestLeadPayload(body, defaultSource = 'unknown') {
  const { parentName, phone, email, children, city, source, interest } = body;
  const childList = Array.isArray(children)
    ? children
    : (typeof children === 'string' && children.trim()
        ? children.split(/[,،\n]/).map(s => s.trim()).filter(Boolean)
        : []);
  if (!parentName || !phone) {
    return { error: 'נדרשים שם ומספר טלפון', status: 400 };
  }

  const leadSource = source || defaultSource;
  console.log(`📥 Lead intake (${leadSource}): Parent: ${parentName}, Phone: ${phone}, Children: ${childList.join(', ')}`);

  const { parent, students: createdStudents } = await db.createLeadFromForm({
    parentName,
    phone,
    email: email || '',
    city: city || '',
    children: childList,
    interest: interest || '',
    source: leadSource,
  });

  try {
    await whatsappService.sendTemplateMessage(phone, 't1', [parentName]);
  } catch (err) {
    console.error('Failed to send welcome WhatsApp message:', err.message);
  }

  for (const student of createdStudents) {
    automationsService.triggerEvent('new_lead', { ...student, phone, parentName });
  }
  if (createdStudents.length === 0) {
    automationsService.triggerEvent('new_lead', {
      id: parent.id,
      parentId: parent.id,
      phone,
      parentName,
      status: parent.status || 'lead_new',
      source: leadSource,
    });
  }

  return { parent, students: createdStudents, status: 201 };
}

// Create Lead (Parent & children) — CRM / internal
app.post('/api/leads', async (req, res) => {
  const result = await ingestLeadPayload(req.body, 'unknown');
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(201).json({
    message: 'Lead received successfully',
    parent: result.parent,
    students: result.students,
  });
});

// Public lead intake form (source=form, phone de-dupe)
app.post('/api/public/leads', publicFormRateLimit, async (req, res) => {
  const result = await ingestLeadPayload(req.body, 'form');
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(201).json({
    success: true,
    message: 'הליד נרשם בהצלחה',
    parent: result.parent,
    students: result.students,
  });
});

// Update parent details (name, phone, email, city, source, notes)
app.put('/api/parents/:id', (req, res) => {
  const { id } = req.params;
  const allowed = ['name', 'phone', 'email', 'city', 'source', 'notes', 'icount_client_id', 'status'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  // If phone is changing to one that already exists — absorb into that card instead of creating ambiguity.
  if (updates.phone) {
    const existing = (db.get('parents') || []).find(
      (p) => p.id !== id && parentPhonesMatch(p.phone, updates.phone)
    );
    if (existing) {
      // Point this card's phone at the existing one via upsert merge path.
      db.update('parents', id, { ...updates, phone: updates.phone });
      const merged = db.upsertParentByPhone(
        updates.name || existing.name,
        updates.phone,
        updates.email || existing.email,
        { city: updates.city, source: updates.source, status: updates.status }
      );
      return res.json(merged);
    }
  }

  const updated = db.update('parents', id, updates);
  if (!updated) return res.status(404).json({ error: 'Parent not found' });
  res.json(updated);
});

app.delete('/api/parents/:id', (req, res) => {
  const { id } = req.params;
  const linked = (db.get('students') || []).filter((s) => s.parentId === id);
  if (linked.length) {
    return res.status(400).json({ error: 'לא ניתן למחוק — יש מתאמנים מקושרים' });
  }
  const ok = db.delete('parents', id);
  if (!ok) return res.status(404).json({ error: 'הלקוח לא נמצא' });
  res.json({ success: true });
});

// Add trainee/child under an existing parent
app.post('/api/parents/:id/students', async (req, res) => {
  const { id } = req.params;
  const { name, birthDate, status, source } = req.body || {};
  const result = await db.addStudentToParent(id, {
    name,
    birthDate: birthDate || '',
    status: status || 'lead_new',
    source: source || 'crm',
  });
  if (result.error) {
    return res.status(result.status || 400).json({
      error: result.error,
      student: result.student || undefined,
    });
  }

  const parent = result.parent;
  automationsService.triggerEvent('new_lead', {
    ...result.student,
    phone: parent?.phone,
    parentName: parent?.name,
  });

  res.status(201).json({ parent, student: result.student });
});

// Broadcast list definitions (editable mailing lists)
app.get('/api/broadcast-list-defs', (req, res) => {
  res.json(db.getBroadcastListDefs());
});

// Public read-only mailing list definitions (for onboarding form)
app.get('/api/public/broadcast-list-defs', publicFormRateLimit, (req, res) => {
  res.json(db.getBroadcastListDefs());
});

app.post('/api/broadcast-list-defs', (req, res) => {
  const result = db.createBroadcastListDef(req.body || {});
  if (result.error) return res.status(400).json({ error: result.error });
  res.status(201).json(result);
});

app.put('/api/broadcast-list-defs/:key', (req, res) => {
  const result = db.updateBroadcastListDef(req.params.key, req.body || {});
  if (result.error) return res.status(404).json({ error: result.error });
  res.json(result);
});

app.delete('/api/broadcast-list-defs/:key', (req, res) => {
  const result = db.deleteBroadcastListDef(req.params.key);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

// Get parent broadcast lists
app.get('/api/parents/:id/broadcast-lists', (req, res) => {
  const { id } = req.params;
  res.json(db.getParentBroadcastLists(id));
});

// Update parent broadcast lists
app.post('/api/parents/:id/broadcast-lists', (req, res) => {
  const { id } = req.params;
  const updated = db.updateParentBroadcastLists(id, req.body);
  res.json(updated);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. WHATSAPP CUSTOMER PORTAL & INTEGRATION ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

// Get WhatsApp Settings (never expose full access token to clients)
app.get('/api/whatsapp/settings', async (req, res) => {
  const settings = db.getSettings();
  let brandName = 'הרפתקאות';
  try {
    const profile = await getBusinessProfile();
    brandName = profile.display_name || brandName;
  } catch {
    // keep fallback
  }
  const branded = applyBusinessBrand(settings, brandName);
  const {
    metaWaAccessToken,
    metaIgAccessToken,
    metaPageAccessToken,
    verifyToken,
    ...safe
  } = branded;
  res.json({
    ...safe,
    hasAccessToken: !!(metaWaAccessToken && !metaWaAccessToken.includes('YOUR_')),
    hasInstagramAccessToken: !!(metaIgAccessToken && !metaIgAccessToken.includes('YOUR_')),
    hasMessengerAccessToken: !!(metaPageAccessToken && String(metaPageAccessToken).length > 10),
    verifyTokenConfigured: !!verifyToken,
    credentialsManagedByServer: !!(
      process.env.META_WA_PHONE_NUMBER_ID &&
      process.env.META_WA_ACCESS_TOKEN
    ),
  });
});

// Toggle bot on/off immediately (staff + owner)
app.post('/api/whatsapp/bot-enabled', (req, res) => {
  const enabled = !!req.body?.enabled;
  const settings = db.saveSettings({ aiResponderEnabled: enabled });
  console.log(`🤖 Bot auto-reply ${enabled ? 'enabled' : 'disabled'} by ${req.crmUser?.email || 'unknown'}`);
  res.json({
    aiResponderEnabled: !!settings.aiResponderEnabled,
    message: enabled ? 'הבוט הופעל' : 'הבוט כובה',
  });
});

// Update WhatsApp Settings
app.post('/api/whatsapp/settings', requireOwner, async (req, res) => {
  const allowed = [
    'aiResponderEnabled',
    'aiActiveHoursEnabled',
    'aiActiveHoursStart',
    'aiActiveHoursEnd',
    'aiActiveDays',
    'aiSystemPrompt',
    'aiOutsideHoursMessage',
    'aiHandoffKeywords',
    'aiHandoffAckMessage',
    'aiStopKeywords',
    'aiOptOutMessage',
    'aiPauseOnHumanReply',
    'aiPauseMinutesAfterHuman',
    'aiAudienceMode',
    'aiHistoryCount',
    'aiMaxReplyChars',
    'aiReplyDelayMs',
    'aiRateLimitPerHour',
    'aiKnowledgeBase',
    'aiForbiddenTopics',
    'aiBusinessFacts',
    'aiEscalateWhenUnsure',
    'aiUnsureReply',
    'aiLeadCaptureEnabled',
    'aiInteractiveMenuEnabled',
    'aiGreetingMenu',
    'aiReactivateKeywords',
    'metaIgAccountId',
    'metaIgAccessToken',
    'metaPageId',
    'metaPageAccessToken',
  ];
  const payload = {};
  for (const key of allowed) {
    if (req.body?.[key] !== undefined) payload[key] = req.body[key];
  }
  if (payload.aiActiveDays !== undefined) {
    const days = (Array.isArray(payload.aiActiveDays) ? payload.aiActiveDays : [])
      .map(Number)
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    payload.aiActiveDays = [...new Set(days)].sort((a, b) => a - b);
    if (!payload.aiActiveDays.length) payload.aiActiveDays = [0, 1, 2, 3, 4, 5, 6];
  }
  if (payload.aiActiveHoursStart !== undefined) {
    payload.aiActiveHoursStart = String(payload.aiActiveHoursStart).slice(0, 5);
  }
  if (payload.aiActiveHoursEnd !== undefined) {
    payload.aiActiveHoursEnd = String(payload.aiActiveHoursEnd).slice(0, 5);
  }
  if (payload.aiResponderEnabled !== undefined) {
    payload.aiResponderEnabled = !!payload.aiResponderEnabled;
  }
  if (payload.aiActiveHoursEnabled !== undefined) {
    payload.aiActiveHoursEnabled = !!payload.aiActiveHoursEnabled;
  }
  if (payload.aiPauseOnHumanReply !== undefined) {
    payload.aiPauseOnHumanReply = !!payload.aiPauseOnHumanReply;
  }
  if (payload.aiEscalateWhenUnsure !== undefined) {
    payload.aiEscalateWhenUnsure = !!payload.aiEscalateWhenUnsure;
  }
  if (payload.aiLeadCaptureEnabled !== undefined) {
    payload.aiLeadCaptureEnabled = !!payload.aiLeadCaptureEnabled;
  }
  if (payload.aiInteractiveMenuEnabled !== undefined) {
    payload.aiInteractiveMenuEnabled = !!payload.aiInteractiveMenuEnabled;
  }
  if (payload.aiAudienceMode !== undefined) {
    const mode = String(payload.aiAudienceMode);
    payload.aiAudienceMode = ['all', 'leads_only', 'customers_only'].includes(mode) ? mode : 'all';
  }
  for (const numKey of ['aiPauseMinutesAfterHuman', 'aiHistoryCount', 'aiMaxReplyChars', 'aiReplyDelayMs', 'aiRateLimitPerHour']) {
    if (payload[numKey] !== undefined) {
      const n = Number(payload[numKey]);
      payload[numKey] = Number.isFinite(n) ? n : undefined;
      if (payload[numKey] === undefined) delete payload[numKey];
    }
  }
  let brandName = 'הרפתקאות';
  try {
    const profile = await getBusinessProfile();
    brandName = profile.display_name || brandName;
  } catch {
    // keep fallback
  }
  const brandedPayload = applyBusinessBrand(payload, brandName);
  for (const key of Object.keys(payload)) {
    if (brandedPayload[key] !== undefined) payload[key] = brandedPayload[key];
  }
  const settings = db.saveSettings(payload);
  const {
    metaWaAccessToken,
    metaIgAccessToken,
    verifyToken,
    ...safe
  } = db.getSettings();
  res.json({
    message: 'Settings saved successfully',
    settings: {
      ...safe,
      hasAccessToken: !!metaWaAccessToken,
      hasInstagramAccessToken: !!metaIgAccessToken,
      verifyTokenConfigured: !!verifyToken,
      credentialsManagedByServer: !!(
        process.env.META_WA_PHONE_NUMBER_ID &&
        process.env.META_WA_ACCESS_TOKEN
      ),
    },
  });
});

// Embedded Signup public config (no secrets)
app.get('/api/whatsapp/connect-config', (req, res) => {
  res.json(whatsappConnectService.getConnectConfig());
});

// Connection status for settings UI
app.get('/api/whatsapp/status', async (req, res) => {
  try {
    if (req.query.refresh === '1') {
      const status = await whatsappConnectService.refreshStatusFromMeta();
      return res.json(status);
    }
    res.json(whatsappConnectService.getStatus());
  } catch (err) {
    res.status(500).json({ connected: false, error: err.message });
  }
});

// Validate direct Meta credentials and subscribe this app to WABA webhooks.
app.post('/api/whatsapp/activate', requireOwner, async (req, res) => {
  try {
    const result = await whatsappConnectService.activateDirectConnection();
    res.json(result);
  } catch (err) {
    console.error('WhatsApp direct activation failed:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
});

// Complete Embedded Signup / Coexistence OAuth
app.post('/api/whatsapp/oauth/callback', requireOwner, async (req, res) => {
  try {
    const result = await whatsappConnectService.completeOAuth(req.body || {});
    res.json(result);
  } catch (err) {
    console.error('WhatsApp OAuth callback failed:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
});

// Disconnect WhatsApp locally
app.post('/api/whatsapp/disconnect', requireOwner, (req, res) => {
  const result = whatsappConnectService.disconnect();
  res.status(result.success ? 200 : 409).json(result);
});

// Reply from CRM lead card
app.post('/api/whatsapp/reply', async (req, res) => {
  const { phone, message, text } = req.body || {};
  const result = await whatsappService.replyFromCrm(phone, message || text);
  if (result.success) {
    res.json({ success: true, message: result.text });
  } else {
    res.status(400).json({ success: false, error: result.error || 'שליחה נכשלה' });
  }
});

// ─── Unified conversations (multi-channel) ───────────────────────────────────
app.get('/api/conversations/:parentId', async (req, res) => {
  const result = await getConversation(req.params.parentId);
  if (result.error) return res.status(result.status || 404).json(result);
  res.json(result);
});

app.post('/api/conversations/:parentId/reply', async (req, res) => {
  try {
    const result = await replyToParent(req.params.parentId, req.body || {});
    if (!result.success) return res.status(result.status || 400).json(result);
    res.json(result);
  } catch (err) {
    console.error('Error in /reply:', err);
    res.status(500).json({ success: false, error: err.message || 'שגיאת שרת פנימית' });
  }
});

app.post('/api/conversations/:parentId/handled', async (req, res) => {
  try {
    const result = await markCommunicationHandled(req.params.parentId);
    if (!result.success) return res.status(result.status || 400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Message templates ───────────────────────────────────────────────────────
app.get('/api/message-templates', (req, res) => {
  try {
    ensureEventWhatsappTemplates({
      db,
      persist: persistCore,
      publicAppBase: process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || '',
    });
  } catch (err) {
    console.warn('event whatsapp templates ensure on list skipped:', err.message);
  }
  const approvedOnly = req.query.approved === '1' || req.query.approved === 'true';
  res.json(approvedOnly ? listApprovedTemplates() : listLocalTemplates());
});

app.post('/api/message-templates', requireOwner, (req, res) => {
  try {
    const created = createDraftTemplate(req.body || {});
    res.json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/message-templates/:id', requireOwner, (req, res) => {
  try {
    const updated = updateLocalTemplate(req.params.id, req.body || {});
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/message-templates/:id', requireOwner, async (req, res) => {
  try {
    res.json(await deleteLocalTemplate(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/message-templates/:id/move', requireOwner, (req, res) => {
  try {
    const direction = req.body?.direction === 'down' ? 'down' : 'up';
    res.json(moveTemplate(req.params.id, direction));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/message-templates/sync', requireOwner, async (req, res) => {
  try {
    const result = await syncTemplatesFromMeta();
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/message-templates/:id/submit', requireOwner, async (req, res) => {
  try {
    const updated = await submitTemplateToMeta(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Saved replies ───────────────────────────────────────────────────────────
app.get('/api/saved-replies', (req, res) => {
  const list = [...(db.get('saved_replies') || [])].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );
  res.json(list);
});

app.post('/api/saved-replies', requireOwner, (req, res) => {
  const name = String(req.body?.name || '').trim();
  const body = String(req.body?.body || '').trim();
  if (!name || !body) return res.status(400).json({ error: 'חסרים שם או תוכן' });
  const created = db.insert('saved_replies', {
    id: `sr_${Date.now()}`,
    name,
    body,
    sort_order: Number(req.body?.sort_order) || 0,
  });
  res.json(created);
});

app.put('/api/saved-replies/:id', requireOwner, (req, res) => {
  const updated = db.update('saved_replies', req.params.id, {
    name: req.body?.name,
    body: req.body?.body,
    sort_order: req.body?.sort_order,
  });
  if (!updated) return res.status(404).json({ error: 'לא נמצא' });
  res.json(updated);
});

app.delete('/api/saved-replies/:id', requireOwner, (req, res) => {
  db.delete('saved_replies', req.params.id);
  res.json({ success: true });
});

// ─── Audience segments + broadcast jobs ──────────────────────────────────────
app.post('/api/broadcast/preview', (req, res) => {
  const preview = previewAudience(req.body?.filters || {});
  res.json(preview);
});

app.get('/api/broadcast/interest-options', (_req, res) => {
  res.json(INTEREST_OPTIONS);
});

app.get('/api/saved-segments', (_req, res) => {
  res.json(listSavedSegments());
});

app.post('/api/saved-segments', requireOwner, (req, res) => {
  const created = saveSegment(req.body?.name, req.body?.filters || {});
  res.json(created);
});

app.delete('/api/saved-segments/:id', requireOwner, (req, res) => {
  res.json(deleteSegment(req.params.id));
});

app.post('/api/broadcast/jobs', requireOwner, async (req, res) => {
  try {
    const result = await startBroadcastJob(req.body || {});
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/broadcast/jobs', (_req, res) => {
  res.json(listBroadcastJobs());
});

app.get('/api/broadcast/jobs/:id', (req, res) => {
  const job = getBroadcastJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'הקמפיין לא נמצא' });
  res.json(job);
});

app.get('/api/channels/status', (_req, res) => {
  res.json(mediaCredentialsStatus());
});

// Thread for a specific phone (lead card)
app.get('/api/whatsapp/thread/:phone', (req, res) => {
  const logs = whatsappService.getLogsForPhone(req.params.phone);
  res.json(logs);
});

// Get WhatsApp Message Logs
app.get('/api/whatsapp/logs', (req, res) => {
  const logs = db.get('whatsapp_logs');
  const phone = req.query.phone;
  let filtered = [...logs];
  if (phone) {
    filtered = whatsappService.getLogsForPhone(phone);
  } else {
    filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  // Optional cap so light consumers (e.g. dashboard) don't download the full log.
  const limit = Number(req.query.limit);
  if (Number.isFinite(limit) && limit > 0) {
    filtered = filtered.slice(0, limit);
  }
  res.json(filtered);
});

// Get Broadcast Campaigns History
app.get('/api/whatsapp/broadcasts', (req, res) => {
  const campaigns = db.get('broadcast_campaigns');
  const sortedCampaigns = [...campaigns].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(sortedCampaigns);
});

// Send single test WhatsApp message
app.post('/api/whatsapp/send-test', async (req, res) => {
  const { phone, message, templateId } = req.body;
  let result;
  
  if (templateId) {
    const isEnglish = ['hello_world', 'jaspers_market_order_confirmation'].includes(templateId);
    result = await whatsappService.sendTemplateMessage(phone, templateId, isEnglish ? [] : ['משתמש בדיקה']);
  } else {
    result = await whatsappService.sendTextMessage(phone, message);
  }

  if (result.success) {
    res.json({ success: true, message: result.message || 'Message sent' });
  } else {
    res.status(500).json({ error: result.error });
  }
});

// Send WhatsApp Broadcast
app.post('/api/whatsapp/broadcast', async (req, res) => {
  const { campaignName, listName, templateId, customMessage, recipients } = req.body;
  console.log(`📣 Initiating WhatsApp Broadcast Campaign "${campaignName}" to ${recipients.length} recipients...`);

  // Insert broadcast campaign record
  const campaign = db.insert('broadcast_campaigns', {
    campaign_name: campaignName,
    list_name: listName,
    template_name: templateId || 'הודעה אישית',
    message_text: customMessage || `[תבנית: ${templateId}]`,
    recipient_count: recipients.length,
    status: 'sending'
  });

  // Async execute sending (simulate actual send delay for visual progression on client)
  // We send the first response immediately to free up the client, but in our simulator it's nice to send back statuses.
  // We'll process them and update DB.
  let successCount = 0;
  for (const parent of recipients) {
    try {
      if (templateId) {
        const isEnglish = ['hello_world', 'jaspers_market_order_confirmation'].includes(templateId);
        await whatsappService.sendTemplateMessage(parent.phone, templateId, isEnglish ? [] : [parent.name]);
      } else {
        await whatsappService.sendTextMessage(parent.phone, customMessage);
      }
      successCount++;
    } catch (err) {
      console.error(`Failed to send broadcast to ${parent.phone}:`, err.message);
    }
  }

  db.update('broadcast_campaigns', campaign.id, {
    status: 'completed',
    notes: `נשלח בהצלחה ל-${successCount} מתוך ${recipients.length} נמענים`
  });

  res.json({ success: true, campaignId: campaign.id, sent: successCount, total: recipients.length });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. WHATSAPP WEBHOOK (Verification & Events)
// ─────────────────────────────────────────────────────────────────────────────

// Meta Webhook Verification (GET)
app.get('/api/whatsapp/webhook', (req, res) => {
  const settings = db.getSettings();
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN ||
    (process.env.NODE_ENV !== 'production' ? settings.verifyToken : '');
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (!verifyToken) return res.status(503).json({ error: 'Webhook verification is not configured' });
  if (mode === 'subscribe' && token === verifyToken) {
    console.log('✅ WhatsApp Webhook verified successfully.');
    res.status(200).send(challenge);
  } else {
    console.warn('❌ WhatsApp Webhook verification failed. Token mismatch.');
    res.sendStatus(403);
  }
});

async function resolveInstagramProfileName(token, senderId) {
  let igName = `משתמש אינסטגרם (${senderId})`;
  if (!token || token.includes('YOUR_')) return igName;
  try {
    const profileRes = await fetch(
      `https://graph.instagram.com/${META_GRAPH_VERSION}/${senderId}?fields=username,name&access_token=${token}`
    );
    if (profileRes.ok) {
      const profileData = await profileRes.json();
      igName = profileData.name || profileData.username || igName;
      console.log(`👤 Retrieved Instagram Profile name: ${igName}`);
    }
  } catch (err) {
    console.error('Error fetching IG profile:', err.message);
  }
  return igName;
}

async function processResolvedInstagramMessage(senderId, text, token, entryId) {
  if (!senderId || senderId === entryId) return false;
  const igName = await resolveInstagramProfileName(token, senderId);
  console.log(`💬 Processing Instagram message from IGID ${senderId}: "${text}"`);
  const { parent, student, isNew } = await instagramService.handleIncomingMessage(senderId, text, igName, false);
  if (isNew && db.getSettings().aiResponderEnabled) {
    automationsService.triggerEvent('new_lead', student || {
      id: parent?.id,
      parentId: parent?.id,
      phone: '',
      parentName: igName,
      status: parent?.status || 'lead_new',
      source: 'instagram',
    });
    console.log(`🎉 New lead created from Instagram: ${student?.id || parent?.id} (${igName})`);
  } else {
    console.log(`📝 Existing Instagram lead updated: ${student?.id || parent?.id}`);
  }
  return true;
}

async function fetchInstagramMessageByMid(token, mid) {
  const msgRes = await fetch(
    `https://graph.instagram.com/${META_GRAPH_VERSION}/${mid}?fields=id,created_time,from,to,message&access_token=${token}`
  );
  const msgData = await msgRes.json().catch(() => ({}));
  if (!msgRes.ok) {
    return { ok: false, error: msgData.error?.message || `HTTP ${msgRes.status}` };
  }
  // Meta sometimes returns HTTP 200 with an empty body when Advanced Access is missing.
  if (!msgData?.from?.id) {
    return { ok: false, error: 'empty_message_payload', raw: msgData };
  }
  return {
    ok: true,
    senderId: msgData.from.id,
    text: msgData.message || messagingTextFallback(),
  };
}

function messagingTextFallback() {
  return '[הודעת אינסטגרם]';
}

async function findRecentInstagramSender(token, mid, ownIds = []) {
  const folders = ['inbox', 'requests', 'pending', 'other'];
  for (const folder of folders) {
    try {
      const url =
        `https://graph.instagram.com/${META_GRAPH_VERSION}/me/conversations?folder=${folder}` +
        `&fields=id,updated_time,participants,messages.limit(5){id,created_time,message,from,to}` +
        `&access_token=${token}`;
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      for (const conv of data.data || []) {
        for (const msg of conv.messages?.data || []) {
          if (mid && msg.id === mid && msg.from?.id && !ownIds.includes(msg.from.id)) {
            return { senderId: msg.from.id, text: msg.message || messagingTextFallback() };
          }
        }
        // Fallback: newest inbound message in this conversation
        const inbound = (conv.messages?.data || []).find(
          (m) => m.from?.id && !ownIds.includes(m.from.id)
        );
        if (inbound) {
          return { senderId: inbound.from.id, text: inbound.message || messagingTextFallback() };
        }
      }
    } catch (err) {
      console.error(`IG conversations folder=${folder} failed:`, err.message);
    }
  }
  return null;
}

// Helper to process any incoming Instagram message payload
async function processInstagramEntry(body) {
  const settings = db.getSettings();
  const token = settings.metaIgAccessToken || process.env.INSTAGRAM_ACCESS_TOKEN;
  const ownIds = ['36688670097443843', '17841409845483243'];

  for (const entry of body.entry || []) {
    if (entry.id) ownIds.push(entry.id);
    // 1. Messenger/Instagram Messaging API format (entry.messaging or entry.standby)
    const allEvents = [...(entry.messaging || []), ...(entry.standby || [])];
    for (const messaging of allEvents) {

      // 1a. Handle message_edit events (Instagram often sends these instead of full messages
      // when the app lacks Advanced Access for instagram_business_manage_messages).
      if (messaging.message_edit && messaging.message_edit.mid) {
        const mid = messaging.message_edit.mid;
        const numEdit = messaging.message_edit.num_edit || 0;
        console.log(`📩 Received Instagram message_edit event (num_edit=${numEdit}, mid=${mid.slice(0, 40)}...)`);

        let senderId = messaging.sender?.id || null;
        let text = messaging.message_edit.text || null;

        if (token && !token.includes('YOUR_')) {
          try {
            if (!senderId || !text) {
              const fetched = await fetchInstagramMessageByMid(token, mid);
              if (fetched.ok) {
                senderId = senderId || fetched.senderId;
                text = text || fetched.text;
                console.log(`📨 Fetched message content via API: from=${senderId}, text="${text}"`);
              } else {
                console.log(`⚠️ Could not fetch message content: ${fetched.error}`);
              }
            }

            // Conversations can lag a bit after webhook — retry briefly.
            if (!senderId) {
              for (const delayMs of [0, 1500, 4000]) {
                if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
                const found = await findRecentInstagramSender(token, mid, ownIds);
                if (found?.senderId) {
                  senderId = found.senderId;
                  text = text || found.text;
                  console.log(`📬 Resolved sender via conversations: ${senderId}`);
                  break;
                }
              }
            }
          } catch (err) {
            console.error('Error processing message_edit:', err.message);
          }
        }

        if (senderId && !ownIds.includes(senderId)) {
          await processResolvedInstagramMessage(
            senderId,
            text || messagingTextFallback(),
            token,
            entry.id
          );
        } else {
          console.warn(
            '⚠️ Instagram message_edit received but sender/text unavailable. ' +
              'Meta usually requires App Live mode + Advanced Access ' +
              '(instagram_business_manage_messages), or the sender must be an app role user/tester.'
          );
          // Persist a visible CRM lead so the inbox is not silently empty.
          const fallbackId = 'ig_unresolved';
          const note =
            '[הודעת אינסטגרם התקבלה ב-webhook ללא תוכן/שולח — נדרש Advanced Access או חשבון Tester באפליקציית Meta]';
          const { student, isNew } = await db.createLeadFromInstagram(
            fallbackId,
            note,
            `הודעת אינסטגרם ממתינה (${new Date().toLocaleString('he-IL')})`
          );
          if (isNew) {
            automationsService.triggerEvent('new_lead', {
              ...student,
              phone: '',
              parentName: student.name,
            });
          }
        }
        continue;
      }

      // 1b. Handle regular message/postback events
      const msgObj = messaging.message || messaging.postback || {};
      if ((msgObj.text || msgObj.caption || msgObj.title || messaging.postback) && !msgObj.is_echo) {
        const senderId = messaging.sender?.id || entry.id;
        const text = msgObj.text || msgObj.caption || msgObj.title || messaging.postback?.payload || messagingTextFallback();
        
        if (senderId && text) {
          await processResolvedInstagramMessage(senderId, text, token, entry.id);
        }
      }
    }

    // 2. Cloud API / Graph API Changes format (entry.changes)
    for (const change of entry.changes || []) {
      const value = change.value;
      if (value && value.messages?.[0]) {
        const message = value.messages[0];
        const senderId = message.from;
        const text = message.text?.body || message.caption || '[הודעה מאינסטגרם]';
        
        if (senderId && text) {
          await processResolvedInstagramMessage(senderId, text, token, entry.id);
        }
      }
    }
  }
}

async function processWhatsAppWebhookChange(change = {}) {
  const field = change.field;
  const value = change.value || {};
  // Messages we could not store durably — Meta must retry the delivery.
  const notPersisted = [];

  // Delivery / read receipts
  if (field === 'messages' && Array.isArray(value.statuses) && value.statuses.length) {
    for (const st of value.statuses) {
      const statusMap = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' };
      updateMessageStatusByMetaId(st.id, statusMap[st.status] || st.status);
    }
  }

  // Inbound customer messages (live)
  if (field === 'messages') {
    for (const message of value.messages || []) {
      if (message.history_context) continue; // history sync handled separately
      const phone = message.from;
      const text = whatsappConnectService.extractMessageText(message);
      if (!phone) continue;
      if (!text && !message.type) continue;
      console.log(`💬 Processing WhatsApp message from ${phone}: "${text}"`);
      const leadResult = await whatsappService.handleIncomingMessage(phone, text || `[${message.type || 'media'}]`, false, {
        messageId: message.id,
        type: message.type,
        timestamp: message.timestamp,
      });
      if (leadResult?.durableError) {
        notPersisted.push({ messageId: message.id, error: leadResult.durableError });
      }
      if (leadResult?.parent) {
        console.log(
          `🎉 WhatsApp lead ${leadResult.isNew ? 'created' : 'updated'}: parent=${leadResult.parent.id} phone=${phone}${leadResult.student ? ` student=${leadResult.student.id}` : ' (contact only)'}`
        );
      }
    }
  }

  // Outbound echoes from WhatsApp Business app (Coexistence)
  if (field === 'smb_message_echoes') {
    for (const echo of value.message_echoes || []) {
      const phone = echo.to;
      const text = whatsappConnectService.extractMessageText(echo);
      console.log(`📱 Phone echo to ${phone}: "${text}"`);
      await whatsappService.handlePhoneEcho({
        phone,
        text,
        messageId: echo.id,
        type: echo.type,
      });
    }
  }

  // History sync during Coexistence onboarding
  if (field === 'history') {
    for (const chunk of value.history || []) {
      if (chunk.threads) {
        for (const thread of chunk.threads) {
          const peer = thread.id || thread.wa_id;
          for (const message of thread.messages || []) {
            const direction = message.from_me || message.direction === 'outbound'
              ? 'outbound'
              : 'inbound';
            const phone = peer
              || (direction === 'inbound' ? message.from : (message.to || message.from))
              || message.from
              || message.to;
            const text = whatsappConnectService.extractMessageText(message);
            await whatsappService.handleHistoryMessage({
              phone,
              text,
              direction,
              messageId: message.id,
              timestamp: message.timestamp,
              type: message.type,
            });
          }
        }
      } else {
        for (const message of chunk.messages || []) {
          const phone = message.from || message.to;
          const text = whatsappConnectService.extractMessageText(message);
          const direction = message.from_me || message.direction === 'outbound' ? 'outbound' : 'inbound';
          await whatsappService.handleHistoryMessage({
            phone,
            text,
            direction,
            messageId: message.id,
            timestamp: message.timestamp,
            type: message.type,
          });
        }
      }
    }
  }

  if (field === 'account_update') {
    console.log('ℹ️ WhatsApp account_update webhook:', JSON.stringify(value));
  }

  // Template review result (APPROVED / REJECTED / …)
  if (field === 'message_template_status_update') {
    try {
      const result = await applyTemplateStatusUpdate(value);
      console.log(
        `📄 Template status update: ${value.message_template_name || value.message_template_id} → ${value.event || 'sync'}`,
        result?.template?.status || result?.success
      );
    } catch (err) {
      console.error('Template status webhook failed:', err.message);
    }
  }

  return { notPersisted };
}

function verifyMetaWebhookSignature(req, res, next) {
  const signature = req.get('x-hub-signature-256') || '';
  const secrets = [
    process.env.META_APP_SECRET,
    process.env.INSTAGRAM_APP_SECRET,
  ].filter(Boolean);

  if (secrets.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({ error: 'Webhook signature verification is not configured' });
    }
    return next();
  }
  if (!signature.startsWith('sha256=') || !req.rawBody) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  const supplied = Buffer.from(signature.slice(7), 'hex');
  const valid = secrets.some((secret) => {
    const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest();
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  });
  if (!valid) return res.status(401).json({ error: 'Invalid webhook signature' });
  return next();
}

// Meta Webhook Messages Processor (POST) - Handles both WhatsApp & Instagram if routed here
app.post('/api/whatsapp/webhook', verifyMetaWebhookSignature, async (req, res) => {
  const body = req.body;
  console.log('📥 Received WhatsApp/Meta webhook:', JSON.stringify(body, null, 2));

  try {
    // If Meta routed an Instagram or Page object to /api/whatsapp/webhook
    if (body.object === 'instagram' || body.object === 'instagram_business_account') {
      await processInstagramEntry(body);
      return res.sendStatus(200);
    }

    // Facebook Page / Messenger
    if (body.object === 'page') {
      for (const entry of body.entry || []) {
        for (const messaging of entry.messaging || []) {
          if (messaging.message?.is_echo) continue;
          const psid = messaging.sender?.id;
          const text = messaging.message?.text || messaging.postback?.title || '';
          if (psid && (text || messaging.message || messaging.postback)) {
            await handleMessengerIncoming({
              psid,
              text: text || '[הודעת מסנג׳ר]',
              messageId: messaging.message?.mid,
              name: 'לקוח מסנג׳ר',
            });
          }
        }
      }
      // Also may contain Instagram changes on page object
      await processInstagramEntry(body);
      return res.sendStatus(200);
    }

    const unstored = [];
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const result = await processWhatsAppWebhookChange(change);
        if (result?.notPersisted?.length) unstored.push(...result.notPersisted);
      }
    }

    // Ask Meta to deliver again rather than silently losing the message.
    if (unstored.length) {
      console.error(`⛔ ${unstored.length} inbound message(s) not stored — asking Meta to retry`);
      return res.status(503).json({ error: 'message store unavailable', retry: true });
    }
  } catch (error) {
    console.error('Error parsing incoming Meta WhatsApp webhook payload:', error);
  }

  res.sendStatus(200);
});

// Local Webhook Simulator Trigger (POST)
function developmentOnly(req, res, next) {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  return next();
}

app.post('/api/whatsapp/simulate-incoming', developmentOnly, async (req, res) => {
  const { phone, message } = req.body;
  console.log(`📱 [Simulator] Incoming text from ${phone}: "${message}"`);
  
  const result = await whatsappService.handleIncomingMessage(phone, message, true);
  res.json({ success: true, ...result });
});

app.post('/api/whatsapp/playground-reset', developmentOnly, async (req, res) => {
  const phone = String(req.body?.phone || '0599111000').trim();
  try {
    const result = await resetPlaygroundConversation(phone);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('playground-reset failed:', err.message);
    res.status(500).json({ error: err.message || 'איפוס השיחה נכשל' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3.5 INSTAGRAM WEBHOOK & SIMULATOR (Lead Generation)
// ─────────────────────────────────────────────────────────────────────────────

// Instagram Webhook Verification (GET)
app.get('/api/instagram/webhook', (req, res) => {
  const settings = db.getSettings();
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN ||
    (process.env.NODE_ENV !== 'production' ? settings.verifyToken : '');
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (!verifyToken) return res.status(503).json({ error: 'Webhook verification is not configured' });
  if (mode === 'subscribe' && token === verifyToken) {
    console.log('✅ Instagram Webhook verified successfully.');
    res.status(200).send(challenge);
  } else {
    console.warn('❌ Instagram Webhook verification failed.');
    res.sendStatus(403);
  }
});

// Get recent raw webhook logs for debugging
app.get('/api/webhook-logs', (req, res) => {
  res.json(db.get('webhook_logs') || []);
});

// Instagram Webhook Messages Processor (POST)
app.post('/api/instagram/webhook', verifyMetaWebhookSignature, async (req, res) => {
  const body = req.body;
  console.log('📥 Received Instagram webhook:', JSON.stringify(body, null, 2));

  try {
    // Store in persistent log array for inspection (keep last 50)
    const logs = db.get('webhook_logs') || [];
    const webhookLog = {
      id: `webhook-${Date.now()}`,
      timestamp: new Date().toISOString(),
      body,
    };
    logs.unshift(webhookLog);
    if (logs.length > 50) logs.pop();
    db.set('webhook_logs', logs);
    supa.upsert('webhook_logs', webhookLog).catch((error) =>
      console.error('Webhook log persistence failed:', error.message)
    );

    // Process regardless of exact object name ('instagram', 'page', 'instagram_business_account')
    await processInstagramEntry(body);
  } catch (error) {
    console.error('Error processing Instagram webhook:', error);
  }
  
  res.sendStatus(200);
});

// Instagram Local Webhook Simulator Trigger (POST)
app.post('/api/instagram/simulate-incoming', developmentOnly, async (req, res) => {
  const { igId, message, name } = req.body;
  const cleanId = igId || `ig_${Date.now()}`;
  const cleanName = name || `משתמש אינסטגרם (${cleanId})`;
  console.log(`📱 [IG Simulator] Incoming DM from ${cleanName} (${cleanId}): "${message}"`);
  
  const result = await instagramService.handleIncomingMessage(cleanId, message, cleanName, true);
  res.json({ success: true, ...result });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. EXTENDED OPERATIONAL MODULE ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

// Automations CRUD
app.get('/api/automations', (req, res) => {
  res.json(db.get('automations'));
});

app.post('/api/automations', (req, res) => {
  const record = db.insert('automations', req.body);
  res.status(201).json(record);
});

app.put('/api/automations/:id', (req, res) => {
  const { id } = req.params;
  const updated = db.update('automations', id, req.body);
  if (!updated) return res.status(404).json({ error: 'Automation not found' });
  res.json(updated);
});

app.delete('/api/automations/:id', (req, res) => {
  const { id } = req.params;
  const deleted = db.delete('automations', id);
  if (!deleted) return res.status(404).json({ error: 'Automation not found' });
  res.json({ success: true });
});

// Cron / external scheduler: intro reminders (today) + followups (yesterday)
app.post('/api/automations/run-scheduled', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return res.status(503).json({ error: 'CRON_SECRET is not configured' });
  }
  const provided = req.get('x-cron-secret') || '';
  if (provided !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    await refreshStudentsAndGroupsCache();
    await refreshAttendanceCache();
    automationsService.ensureDefaultIntroAutomations();
    const result = await automationsService.runScheduled();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('run-scheduled automations failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete student/lead
app.delete('/api/students/:id', (req, res) => {
  const { id } = req.params;
  const deleted = db.deleteStudent(id);
  if (!deleted) return res.status(404).json({ error: 'Student not found' });
  res.json({ success: true, message: 'Student and associated childless parents deleted successfully' });
});

// Update student/lead details
app.put('/api/students/:id', (req, res) => {
  const { id } = req.params;
  const updated = db.update('students', id, req.body);
  if (!updated) return res.status(404).json({ error: 'Student not found' });
  res.json(updated);
});

// ─── Training equipment (kids kit) ───────────────────────────────────────────
async function refreshStudentEquipmentCache() {
  if (!supa.isEnabled()) return db.get('student_equipment') || [];
  try {
    const rows = await supa.getAll('student_equipment');
    if (rows && typeof db.set === 'function') db.set('student_equipment', rows);
    return rows || db.get('student_equipment') || [];
  } catch (err) {
    console.error('refresh student_equipment failed:', err.message);
    return db.get('student_equipment') || [];
  }
}

async function loadEquipmentSettings() {
  let remote = null;
  try {
    remote = await supa.getAppSetting('equipment_settings');
  } catch {
    remote = null;
  }
  const local = db.getSettings?.()?.equipment_settings;
  return normalizeEquipmentSettings(remote || local || DEFAULT_EQUIPMENT_SETTINGS);
}

async function saveEquipmentSettings(next) {
  const normalized = normalizeEquipmentSettings(next);
  const result = await supa.setAppSetting('equipment_settings', normalized);
  if (result?.ok === false) {
    throw new Error(result.error || 'שמירת הגדרות הציוד נכשלה');
  }
  return normalized;
}

function buildEquipmentPageUrl(req, token) {
  if (!token) return '';
  return `${frontendPublicBase(req)}/equipment/${encodeURIComponent(token)}`;
}

async function resolveEquipmentCheckout(token) {
  const wanted = String(token || '').trim();
  if (!wanted) return null;
  let checkout = db.getOne('equipment_checkouts', wanted);
  if (checkout) return checkout;
  if (!supa.isEnabled()) return null;
  try {
    const rows = await supa.getAll('equipment_checkouts');
    if (rows && typeof db.set === 'function') db.set('equipment_checkouts', rows);
    return db.getOne('equipment_checkouts', wanted);
  } catch {
    return null;
  }
}

app.get('/api/equipment-settings', async (_req, res) => {
  try {
    const settings = await loadEquipmentSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/equipment-settings', requireOwner, async (req, res) => {
  try {
    const settings = await saveEquipmentSettings(req.body || {});
    res.json(settings);
  } catch (err) {
    console.error('PUT /api/equipment-settings failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/students/:id/equipment', async (req, res) => {
  try {
    await refreshStudentEquipmentCache();
    let student = db.getOne('students', req.params.id);
    if (!student && supa.isEnabled()) {
      const remote = await supa.getAll('students');
      if (remote && typeof db.set === 'function') db.set('students', remote);
      student = db.getOne('students', req.params.id);
    }
    if (!student) return res.status(404).json({ error: 'המתאמן לא נמצא' });
    if (!isKidStudent(student)) {
      return res.json({ items: [], applicable: false });
    }
    const items = ensureStudentEquipment({ db, student, persist: persistCore });
    const settings = await loadEquipmentSettings();
    res.json({
      applicable: true,
      items,
      settings,
      labels: EQUIPMENT_ITEM_LABELS,
      gaps: equipmentGapFlags(items),
    });
  } catch (err) {
    console.error('GET student equipment error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/equipment', async (req, res) => {
  try {
    await refreshStudentEquipmentCache();
    const settings = await loadEquipmentSettings();
    let students = db.get('students') || [];
    let parents = db.get('parents') || [];
    let groups = db.get('groups') || [];
    if (supa.isEnabled()) {
      const [remoteStudents, remoteParents, remoteGroups] = await Promise.all([
        supa.getAll('students'),
        supa.getAll('parents'),
        supa.getAll('groups'),
      ]);
      if (remoteStudents) {
        students = remoteStudents;
        if (typeof db.set === 'function') db.set('students', remoteStudents);
      }
      if (remoteParents) {
        parents = remoteParents;
        if (typeof db.set === 'function') db.set('parents', remoteParents);
      }
      if (remoteGroups) {
        groups = remoteGroups;
        if (typeof db.set === 'function') db.set('groups', remoteGroups);
      }
    }

    const groupId = req.query.groupId ? String(req.query.groupId) : '';
    const filter = String(req.query.filter || 'gaps'); // gaps | unpaid | awaiting | all
    const kids = students.filter(
      (s) => isKidStudent(s) && s.status !== 'archived' && (!groupId || s.groupId === groupId)
    );

    const parentById = new Map(parents.map((p) => [p.id, p]));
    const groupById = new Map(groups.map((g) => [g.id, g]));
    const rows = [];

    for (const student of kids) {
      const items = ensureStudentEquipment({ db, student, persist: persistCore });
      const gaps = equipmentGapFlags(items);
      if (filter === 'unpaid' && !gaps.hasUnpaid) continue;
      if (filter === 'awaiting' && !gaps.hasAwaitingHandoff) continue;
      if (filter === 'gaps' && !gaps.hasGap) continue;
      const parent = parentById.get(student.parentId) || null;
      const group = groupById.get(student.groupId) || null;
      rows.push({
        student_id: student.id,
        student_name: student.name,
        parent_id: parent?.id || student.parentId || null,
        parent_name: parent?.name || '',
        parent_phone: parent?.phone || '',
        group_id: group?.id || student.groupId || null,
        group_name: group?.name || '',
        items,
        gaps,
      });
    }

    rows.sort((a, b) => String(a.student_name || '').localeCompare(String(b.student_name || ''), 'he'));
    res.json({ rows, settings, labels: EQUIPMENT_ITEM_LABELS });
  } catch (err) {
    console.error('GET /api/equipment error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/equipment/:id', async (req, res) => {
  try {
    await refreshStudentEquipmentCache();
    const row = db.getOne('student_equipment', req.params.id);
    if (!row) return res.status(404).json({ error: 'פריט הציוד לא נמצא' });
    const patch = {};
    if (req.body?.shirt_size !== undefined) {
      patch.shirt_size = String(req.body.shirt_size || '').trim() || null;
    }
    if (req.body?.payment_status === 'paid' || req.body?.payment_status === 'unpaid') {
      patch.payment_status = req.body.payment_status;
      if (req.body.payment_status === 'paid' && !row.paid_at) {
        patch.paid_at = new Date().toISOString();
      }
      if (req.body.payment_status === 'unpaid') {
        patch.paid_at = null;
        patch.payment_id = null;
        if (row.item_type === 'shoes') {
          patch.rental_starts_at = null;
          patch.rental_ends_at = null;
        }
      }
      if (req.body.payment_status === 'paid' && row.item_type === 'shoes' && !row.rental_starts_at) {
        const settings = await loadEquipmentSettings();
        const when = patch.paid_at || new Date().toISOString();
        patch.rental_starts_at = when;
        const end = new Date(when);
        end.setDate(end.getDate() + settings.rental_days);
        patch.rental_ends_at = end.toISOString();
      }
    }
    if (req.body?.fulfillment_status === 'given' || req.body?.fulfillment_status === 'pending') {
      if (req.body.fulfillment_status === 'given') {
        const result = markEquipmentGiven({
          db,
          persist: persistCore,
          rowId: row.id,
          givenBy: req.crmUser?.email || req.crmUser?.name || null,
        });
        if (!result.ok) return res.status(400).json({ error: result.error });
        return res.json(result.row);
      }
      const result = markEquipmentPendingFulfillment({ db, persist: persistCore, rowId: row.id });
      if (!result.ok) return res.status(400).json({ error: result.error });
      return res.json(result.row);
    }
    if (!Object.keys(patch).length) return res.json(row);
    const updated = db.update('student_equipment', row.id, patch);
    if (updated) await persistCore('student_equipment', updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/equipment/:id/mark-given', async (req, res) => {
  try {
    await refreshStudentEquipmentCache();
    const result = markEquipmentGiven({
      db,
      persist: persistCore,
      rowId: req.params.id,
      givenBy: req.crmUser?.email || req.crmUser?.name || null,
    });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json(result.row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/equipment/:id/mark-pending', async (req, res) => {
  try {
    await refreshStudentEquipmentCache();
    const result = markEquipmentPendingFulfillment({
      db,
      persist: persistCore,
      rowId: req.params.id,
    });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json(result.row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/equipment/:id/reset-rental', async (req, res) => {
  try {
    await refreshStudentEquipmentCache();
    const result = resetShoeRental({
      db,
      persist: persistCore,
      rowId: req.params.id,
      givenBy: req.crmUser?.email || req.crmUser?.name || null,
    });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json(result.row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/students/:id/equipment/payment-link', async (req, res) => {
  try {
    await refreshStudentEquipmentCache();
    let student = db.getOne('students', req.params.id);
    if (!student && supa.isEnabled()) {
      const remote = await supa.getAll('students');
      if (remote) {
        if (typeof db.set === 'function') db.set('students', remote);
        student = db.getOne('students', req.params.id);
      }
    }
    if (!student) return res.status(404).json({ error: 'המתאמן לא נמצא' });
    if (!isKidStudent(student)) {
      return res.status(400).json({ error: 'ציוד לאימונים מיועד לילדים בלבד' });
    }
    const parent = db.getOne('parents', student.parentId);
    if (!parent?.phone) {
      return res.status(400).json({ error: 'חסר טלפון להורה — אי אפשר לשלוח קישור' });
    }

    ensureStudentEquipment({ db, student, persist: persistCore });
    try {
      ensureEquipmentWhatsappTemplate({
        db,
        persist: persistCore,
        publicAppBase: frontendPublicBase(req),
      });
    } catch (tplErr) {
      console.warn('equipment template ensure skipped:', tplErr.message);
    }

    const token = newCheckoutToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    const checkout = db.insert('equipment_checkouts', {
      id: token,
      student_id: student.id,
      parent_id: parent.id,
      expires_at: expiresAt.toISOString(),
      created_by: req.crmUser?.email || null,
      created_at: new Date().toISOString(),
    });
    if (!checkout?.id) {
      return res.status(500).json({ error: 'שמירת קישור התשלום נכשלה' });
    }
    const persistResult = await persistCore('equipment_checkouts', checkout);
    if (persistResult && persistResult.ok === false) {
      console.warn('equipment_checkouts persist failed:', persistResult.error);
    }

    const publicPageUrl = buildEquipmentPageUrl(req, token);
    // When staff tests from localhost, show a local link they can open in the same browser.
    let pageUrl = publicPageUrl;
    try {
      const originHeader = String(req?.headers?.origin || '').trim().replace(/\/$/, '');
      if (originHeader && isLocalAppOrigin(originHeader)) {
        pageUrl = `${originHeader}/equipment/${encodeURIComponent(token)}`;
      }
    } catch {
      pageUrl = publicPageUrl;
    }
    const sendWhatsapp = req.body?.sendWhatsapp !== false;
    let whatsappSent = false;
    let whatsappError = null;

    if (sendWhatsapp) {
      const phone = normalizePhone(parent.phone);
      const templates = db.get('message_templates') || [];
      const localTpl = templates.find(
        (t) => (t.meta_name || t.name) === EQUIPMENT_TEMPLATE_NAME
      );
      const tplApproved =
        localTpl &&
        (String(localTpl.status).toUpperCase() === 'APPROVED' || localTpl.active_for_send);

      // Prefer free-form with the full public URL — Meta template buttons can point at a wrong base.
      const inWindow = canSendFreeform(parent, 'whatsapp');
      if (inWindow) {
        const msg =
          `שלום ${parent.name || ''},\n` +
          `לתשלום ציוד האימונים של ${student.name || 'הילד'}:\n\n` +
          `${publicPageUrl}\n\n` +
          `אפשר לבחור נעליים, חולצת חוג ושק מגנזיום.`;
        try {
          const waResult = await whatsappService.sendTextMessage(phone, msg, false, {
            parentId: parent.id,
            fallbackName: parent.name,
          });
          whatsappSent = !!waResult?.success;
          if (!whatsappSent) whatsappError = waResult?.error || 'שליחת הודעה נכשלה';
        } catch (waErr) {
          whatsappError = waErr.message || 'שליחת הודעה נכשלה';
        }
      }

      if (!whatsappSent && tplApproved) {
        try {
          const waResult = await whatsappService.sendTemplateMessage(
            phone,
            EQUIPMENT_TEMPLATE_NAME,
            [parent.name || 'הורה', student.name || 'הילד'],
            {
              fallbackName: parent.name,
              parentId: parent.id,
              buttonUrlParam: token,
            }
          );
          whatsappSent = !!waResult?.success;
          if (!whatsappSent) whatsappError = waResult?.error || 'שליחת תבנית נכשלה';
        } catch (waErr) {
          whatsappError = waErr.message || 'שליחת תבנית נכשלה';
        }
      }

      if (!whatsappSent && !whatsappError) {
        whatsappError =
          'התבנית עדיין לא מאושרת וחלון 24 השעות סגור — העתיקו את הקישור ידנית';
      }
    }

    res.json({
      success: true,
      token,
      pageUrl,
      publicPageUrl,
      whatsappSent,
      whatsappError,
    });
  } catch (err) {
    console.error('equipment payment-link error:', err.message);
    res.status(500).json({ error: err.message || 'יצירת קישור הציוד נכשלה' });
  }
});

app.get('/api/public/equipment/:token', publicFormRateLimit, async (req, res) => {
  try {
    const checkout = await resolveEquipmentCheckout(req.params.token);
    if (!checkout) return res.status(404).json({ error: 'קישור התשלום לא נמצא' });
    if (checkout.expires_at && new Date(checkout.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ error: 'פג תוקף הקישור — בקשו קישור חדש מהצוות' });
    }

    await refreshStudentEquipmentCache();
    let student = db.getOne('students', checkout.student_id);
    let parent = db.getOne('parents', checkout.parent_id);
    if ((!student || !parent) && supa.isEnabled()) {
      const [remoteStudents, remoteParents] = await Promise.all([
        !student ? supa.getAll('students') : null,
        !parent ? supa.getAll('parents') : null,
      ]);
      if (remoteStudents && typeof db.set === 'function') db.set('students', remoteStudents);
      if (remoteParents && typeof db.set === 'function') db.set('parents', remoteParents);
      student = student || db.getOne('students', checkout.student_id);
      parent = parent || db.getOne('parents', checkout.parent_id);
    }
    if (!student || !isKidStudent(student)) {
      return res.status(404).json({ error: 'המתאמן לא נמצא' });
    }

    const items = ensureStudentEquipment({ db, student, persist: persistCore });
    const settings = await loadEquipmentSettings();
    const unpaid = items.filter((i) => i.payment_status !== 'paid');
    res.json({
      student_name: student.name,
      parent_name: parent?.name || '',
      items,
      unpaid_items: unpaid,
      settings,
      labels: EQUIPMENT_ITEM_LABELS,
      all_paid: unpaid.length === 0,
    });
  } catch (err) {
    console.error('public equipment lookup error:', err.message);
    res.status(503).json({ error: err.message || 'טעינת דף הציוד נכשלה' });
  }
});

app.post('/api/public/equipment/:token/pay', publicFormRateLimit, async (req, res) => {
  try {
    const checkout = await resolveEquipmentCheckout(req.params.token);
    if (!checkout) return res.status(404).json({ error: 'קישור התשלום לא נמצא' });
    if (checkout.expires_at && new Date(checkout.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ error: 'פג תוקף הקישור — בקשו קישור חדש מהצוות' });
    }

    await refreshStudentEquipmentCache();
    let student = db.getOne('students', checkout.student_id);
    let parent = db.getOne('parents', checkout.parent_id);
    if ((!student || !parent) && supa.isEnabled()) {
      const [remoteStudents, remoteParents] = await Promise.all([
        !student ? supa.getAll('students') : null,
        !parent ? supa.getAll('parents') : null,
      ]);
      if (remoteStudents && typeof db.set === 'function') db.set('students', remoteStudents);
      if (remoteParents && typeof db.set === 'function') db.set('parents', remoteParents);
      student = student || db.getOne('students', checkout.student_id);
      parent = parent || db.getOne('parents', checkout.parent_id);
    }
    if (!student || !parent) return res.status(404).json({ error: 'הלקוח לא נמצא' });

    const items = ensureStudentEquipment({ db, student, persist: persistCore });
    const settings = await loadEquipmentSettings();
    const unpaidTypes = new Set(
      items.filter((i) => i.payment_status !== 'paid').map((i) => i.item_type)
    );

    let selected = Array.isArray(req.body?.itemTypes)
      ? req.body.itemTypes.map((t) => String(t || '').trim()).filter((t) => EQUIPMENT_ITEM_TYPES.includes(t))
      : [];
    selected = selected.filter((t) => unpaidTypes.has(t));
    if (!selected.length) {
      return res.status(400).json({ error: 'בחרו לפחות פריט אחד לתשלום' });
    }

    const shirtSize = String(req.body?.shirtSize || '').trim();
    if (selected.includes('shirt')) {
      if (!shirtSize) return res.status(400).json({ error: 'יש לבחור מידת חולצה' });
      if (!settings.shirt_sizes.includes(shirtSize)) {
        return res.status(400).json({ error: 'מידת החולצה אינה תקפה' });
      }
    }

    const entered = computeEquipmentTotal(settings, selected);
    if (entered <= 0) return res.status(400).json({ error: 'סכום התשלום אינו תקף — פנו לצוות' });
    const includesVat = normalizePriceIncludesVat(settings.price_includes_vat, true);
    const amount = chargeAmount(entered, includesVat);
    const description = describeEquipmentItems(selected, shirtSize || null);

    const payment = db.insert('payments', {
      parent_id: parent.id,
      student_id: student.id,
      amount,
      price_includes_vat: includesVat,
      description,
      status: 'pending',
      payment_url: null,
      paid_at: null,
      equipment_payment: true,
      equipment_checkout_token: checkout.id,
      equipment_item_types: selected,
      equipment_shirt_size: selected.includes('shirt') ? shirtSize : null,
      equipment_rental_days: settings.rental_days,
      updated_at: new Date().toISOString(),
    });

    const paymentUrl = await icount.buildPaymentUrl({
      amount,
      description,
      name: parent.name,
      phone: normalizePhone(parent.phone),
      email: parent.email,
      paymentId: payment.id,
      ipnUrl: icount.buildIpnUrl({ paymentId: payment.id }),
      successUrl: `${frontendPublicBase(req)}/equipment/${encodeURIComponent(checkout.id)}?paid=1`,
    });

    const updatedPayment = db.update('payments', payment.id, {
      payment_url: paymentUrl,
      updated_at: new Date().toISOString(),
    }) || payment;
    await persistCore('payments', updatedPayment);

    res.json({
      success: true,
      paymentUrl,
      amount,
      description,
      itemTypes: selected,
    });
  } catch (err) {
    console.error('public equipment pay error:', err.message);
    res.status(503).json({ error: err.message || 'יצירת התשלום נכשלה' });
  }
});

// Create/Update Group (upsert by id so re-seeds don't duplicate local cache)
app.post('/api/groups', (req, res) => {
  const id = req.body?.id;
  if (id && db.getOne('groups', id)) {
    const updated = db.update('groups', id, req.body);
    return res.json(updated);
  }
  const record = db.insert('groups', req.body);
  res.status(201).json(record);
});

app.put('/api/groups/:id', (req, res) => {
  const { id } = req.params;
  const updated = db.update('groups', id, req.body);
  if (!updated) return res.status(404).json({ error: 'Group not found' });
  res.json(updated);
});

app.delete('/api/groups/:id', (req, res) => {
  const { id } = req.params;
  const deleted = db.delete('groups', id);
  if (!deleted) return res.status(404).json({ error: 'Group not found' });
  res.json({ success: true });
});

// ─── Activities (trips, birthdays, special events) — Supabase-backed ─────────
function normalizeActivityEndDate(date, endDate) {
  const start = date ? String(date).slice(0, 10) : '';
  const end = endDate ? String(endDate).slice(0, 10) : '';
  if (!start || !end || end === start) return null;
  return end;
}

function normalizeActivityPayload(body = {}) {
  const type = ['birthday', 'trip', 'school', 'company', 'route_building', 'opening_hours', 'training_vacation', 'other'].includes(body.type)
    ? body.type
    : (body.type || 'other');
  const hostName = body.host_name || body.contact_name || '';
  const hostPhone = body.host_phone || body.contact_phone || '';
  const hostParentId = body.host_parent_id || body.hostParentId || null;
  const date = body.date || null;
  const registrationMode = body.registration_mode === 'host_pays'
    ? 'host_pays'
    : 'paid_per_participant';
  return {
    name: String(body.name || '').trim(),
    type,
    status: body.status || 'open',
    date,
    end_date: normalizeActivityEndDate(date, body.end_date),
    start_time: body.all_day ? null : (body.start_time || null),
    end_time: body.all_day ? null : (body.end_time || null),
    location: body.location || '',
    price: body.price === '' || body.price === undefined ? 0 : Number(body.price) || 0,
    price_includes_vat: normalizePriceIncludesVat(body.price_includes_vat),
    max_participants: body.max_participants === '' || body.max_participants == null
      ? null
      : Number(body.max_participants) || null,
    responsible_id: body.responsible_id || null,
    description: body.description || '',
    payment_link: body.payment_link || '',
    notes: body.notes || '',
    all_day: !!body.all_day,
    contact_name: hostName || body.contact_name || '',
    contact_phone: hostPhone || body.contact_phone || '',
    host_name: hostName,
    host_email: body.host_email || '',
    host_phone: hostPhone,
    host_parent_id: hostParentId || null,
    payment_status: normalizeHostPaymentStatus(body.payment_status),
    registration_slug: body.registration_slug || null,
    participant_registration_slug:
      body.participant_registration_slug || body.registration_slug || null,
    registration_enabled: !!body.registration_enabled,
    registration_closes_at: body.registration_closes_at || null,
    collect_registration_payment:
      registrationMode === 'paid_per_participant' && Number(body.price || 0) > 0,
    registration_mode: registrationMode,
    host_payment_token: body.host_payment_token || null,
    host_payment_id: body.host_payment_id || null,
    host_paid_at: body.host_paid_at || null,
    form_template_id: body.form_template_id || null,
    form_template_slug: body.form_template_slug || 'wall',
    registration_page_title: body.registration_page_title || '',
    registration_page_body: body.registration_page_body || '',
    registration_theme: sanitizeRegistrationTheme(
      body.registration_theme && typeof body.registration_theme === 'object'
        ? body.registration_theme
        : (body.theme && typeof body.theme === 'object' ? body.theme : {})
    ),
  };
}

function frontendPublicBase(req) {
  // Prefer configured public app URL over browser Origin (Origin may be localhost during staff testing).
  const requested =
    process.env.FRONTEND_URL ||
    process.env.PUBLIC_APP_URL ||
    req?.headers?.origin ||
    '';
  return resolvePublicAppOrigin(requested);
}

function buildActivityRegistrationUrl(req, slug) {
  if (!slug) return '';
  return `${frontendPublicBase(req)}/event/${encodeURIComponent(slug)}`;
}

function buildHostPaymentUrl(req, token) {
  if (!token) return '';
  return `${frontendPublicBase(req)}/event-host/${encodeURIComponent(token)}`;
}

function matchHostPaymentActivity(rows, token) {
  const wanted = String(token || '').trim();
  if (!wanted) return null;
  return (rows || []).find(
    (item) =>
      item.host_payment_token === wanted &&
      (item.registration_mode === 'host_pays' || !item.registration_mode)
  ) || null;
}

/** Resolve host-payment activity, refreshing from durable store when local cache is stale. */
async function findActivityByHostPaymentToken(token) {
  let activity = matchHostPaymentActivity(db.get('activities'), token);
  // Always refresh from durable store so host edits (name / linked customer)
  // are visible on the public payment link even when the server cache is stale.
  if (supa.isEnabled()) {
    const remote = await supa.getAll('activities');
    if (remote) {
      db.set('activities', remote);
      activity = matchHostPaymentActivity(remote, token) || activity;
    }
  }
  return activity;
}

function ensureActivityRegistrationSlug(activity) {
  if (activity?.registration_slug) return activity;
  const slug = makeRegistrationSlug();
  return db.update('activities', activity.id, { registration_slug: slug }) || {
    ...activity,
    registration_slug: slug,
  };
}

async function syncActivityToGoogle(record, { deleted = false } = {}) {
  try {
    const result = await googleCalendarService.pushActivity(record, { deleted });
    if (deleted || result?.skipped) return record;
    if (result?.google_event_id) {
      return db.update('activities', record.id, {
        google_event_id: result.google_event_id,
        google_etag: result.google_etag || null,
        synced_at: result.synced_at || new Date().toISOString(),
      }) || record;
    }
  } catch (err) {
    console.error('Google Calendar push failed:', err.message);
  }
  return record;
}

function applyGooglePull(dbRef) {
  return googleCalendarService.pullChanges({
    getActivities: () => dbRef.get('activities') || [],
    upsertFromGoogle: (local, fields, crmId) => {
      if (local) {
        dbRef.update('activities', local.id, {
          ...fields,
          // Keep local commercial fields if Google didn't carry them
          price: local.price ?? fields.price,
          max_participants: local.max_participants ?? fields.max_participants,
          payment_link: local.payment_link || '',
          notes: local.notes || fields.notes || '',
          responsible_id: local.responsible_id || null,
          host_name: local.host_name || local.contact_name || '',
          host_email: local.host_email || '',
          host_phone: local.host_phone || local.contact_phone || '',
          host_parent_id: local.host_parent_id || null,
          payment_status: local.payment_status || 'unpaid',
          registration_slug: local.registration_slug || null,
          registration_enabled: !!local.registration_enabled,
          registration_closes_at: local.registration_closes_at || null,
          collect_registration_payment: !!local.collect_registration_payment,
          registration_page_title: local.registration_page_title || '',
          registration_page_body: local.registration_page_body || '',
          registration_theme: local.registration_theme || {},
        });
        return 'updated';
      }
      const id = crmId && !dbRef.getOne('activities', crmId)
        ? crmId
        : undefined;
      const payload = { ...fields };
      if (id) payload.id = id;
      dbRef.insert('activities', payload);
      return 'created';
    },
    deleteByGoogleId: (googleEventId, localId) => {
      if (localId) dbRef.delete('activities', localId);
      else {
        const row = (dbRef.get('activities') || []).find((a) => a.google_event_id === googleEventId);
        if (row) dbRef.delete('activities', row.id);
      }
    },
  });
}

app.get('/api/activities', async (req, res) => {
  try {
    if (supa.isEnabled()) {
      const rows = await supa.getAll('activities');
      if (rows) {
        if (typeof db.set === 'function') db.set('activities', rows);
        return res.json(rows);
      }
    }
  } catch (err) {
    console.error('activities refresh failed:', err.message);
  }
  res.json(db.get('activities') || []);
});

app.post('/api/activities', async (req, res) => {
  const payload = normalizeActivityPayload(req.body || {});
  if (!payload.name) return res.status(400).json({ error: 'חסר שם פעילות' });
  if (!payload.date) return res.status(400).json({ error: 'חסר תאריך' });
  if (payload.end_date && payload.end_date < payload.date) {
    return res.status(400).json({ error: 'תאריך הסיום לפני תאריך ההתחלה' });
  }
  if (payload.registration_enabled && !payload.participant_registration_slug) {
    payload.participant_registration_slug = makeRegistrationSlug();
    payload.registration_slug = payload.participant_registration_slug;
  }
  if (payload.registration_mode === 'host_pays' && !payload.host_payment_token) {
    payload.host_payment_token = makePrivatePaymentToken();
  }
  const record = db.insert('activities', payload);
  res.status(201).json(record);
  // Don't block the UI on Google — sync in the background
  syncActivityToGoogle(record).catch((err) =>
    console.error('Background Google push failed:', err.message)
  );
});

app.put('/api/activities/:id', async (req, res) => {
  const { id } = req.params;
  const existing = db.getOne('activities', id);
  if (!existing) return res.status(404).json({ error: 'Activity not found' });
  const payload = normalizeActivityPayload({ ...existing, ...(req.body || {}) });
  if (!payload.name) return res.status(400).json({ error: 'חסר שם פעילות' });
  if (!payload.date) return res.status(400).json({ error: 'חסר תאריך' });
  if (payload.end_date && payload.end_date < payload.date) {
    return res.status(400).json({ error: 'תאריך הסיום לפני תאריך ההתחלה' });
  }
  if (payload.registration_enabled && !payload.registration_slug) {
    payload.registration_slug = existing.registration_slug || makeRegistrationSlug();
  } else if (!payload.registration_slug && existing.registration_slug) {
    payload.registration_slug = existing.registration_slug;
  }
  payload.participant_registration_slug =
    payload.participant_registration_slug ||
    payload.registration_slug ||
    existing.participant_registration_slug ||
    null;
  if (payload.participant_registration_slug && !payload.registration_slug) {
    payload.registration_slug = payload.participant_registration_slug;
  }
  if (payload.registration_mode === 'host_pays' && !payload.host_payment_token) {
    payload.host_payment_token = existing.host_payment_token || makePrivatePaymentToken();
  }
  const updated = db.update('activities', id, {
    ...payload,
    google_event_id: existing.google_event_id || null,
    google_etag: existing.google_etag || null,
  });
  res.json(updated);
  syncActivityToGoogle(updated).catch((err) =>
    console.error('Background Google push failed:', err.message)
  );
});

app.delete('/api/activities/:id', async (req, res) => {
  const { id } = req.params;
  const existing = db.getOne('activities', id);
  if (!existing) return res.status(404).json({ error: 'Activity not found' });
  const deleted = db.delete('activities', id);
  if (!deleted) return res.status(404).json({ error: 'Activity not found' });
  res.json({ success: true });
  syncActivityToGoogle(existing, { deleted: true }).catch((err) =>
    console.error('Background Google delete failed:', err.message)
  );
});

app.get('/api/activities/unpaid-open', (req, res) => {
  const rows = openUnpaidActivities(db).map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    date: a.date,
    start_time: a.start_time,
    host_name: a.host_name || a.contact_name || '',
    payment_status: normalizeHostPaymentStatus(a.payment_status),
    price: Number(a.price) || 0,
  }));
  res.json(rows);
});

app.get('/api/activities/:id/registrations', async (req, res) => {
  const activity = db.getOne('activities', req.params.id);
  if (!activity) return res.status(404).json({ error: 'Activity not found' });
  if (supa.isEnabled()) {
    const [remoteRegs, remoteOrders, remoteDeclarations, remotePayments] = await Promise.all([
      supa.getAll('activity_registrations'),
      supa.getAll('activity_registration_orders'),
      supa.getAll('health_declarations'),
      supa.getAll('payments'),
    ]);
    if (remoteRegs) db.set('activity_registrations', remoteRegs);
    if (remoteOrders) db.set('activity_registration_orders', remoteOrders);
    if (remoteDeclarations) db.set('health_declarations', remoteDeclarations);
    if (remotePayments) db.set('payments', remotePayments);
  }
  const regs = activeRegistrations(db, activity.id).sort((a, b) =>
    String(b.created_at || '').localeCompare(String(a.created_at || ''))
  );
  const parents = db.get('parents') || [];
  const declarations = db.get('health_declarations') || [];
  const enriched = regs.map((registration) => ({
    ...registration,
    parent_name: parents.find((parent) => parent.id === registration.parent_id)?.name || '',
    declaration_signed: declarations.some(
      (declaration) =>
        declaration.id === registration.health_declaration_id &&
        declaration.signed &&
        !!declaration.signature_url
    ),
  }));

  let hostPayment = summarizeHostPayment(db, activity);
  // Best-effort: fill missing invoice URL from iCount when we already have a doc id
  if (
    hostPayment?.icount_doc_id &&
    !hostPayment.icount_doc_url &&
    icount.isConfigured()
  ) {
    try {
      const info = await icount.getDoc(hostPayment.icount_doc_id);
      const url =
        info?.doc_url ||
        info?.docurl ||
        info?.doc?.doc_url ||
        info?.doc?.docurl ||
        null;
      if (url && hostPayment.payment_id) {
        const updated = db.update('payments', hostPayment.payment_id, {
          icount_doc_url: url,
          updated_at: new Date().toISOString(),
        });
        if (updated) {
          await persistCore('payments', updated);
          hostPayment = { ...hostPayment, icount_doc_url: url };
        }
      } else if (url) {
        hostPayment = { ...hostPayment, icount_doc_url: url };
      }
    } catch (err) {
      console.warn('⚠️ [host payment] doc url lookup failed:', err.message);
    }
  }

  if (
    hostPayment?.refund_doc_number &&
    !hostPayment.refund_doc_url &&
    icount.isConfigured()
  ) {
    try {
      const info = await icount.getDocInfo({
        doctype: hostPayment.refund_doctype || hostPayment.icount_doctype || 'invrec',
        docnum: hostPayment.refund_doc_number,
      });
      const docInfo = info.doc_info || info;
      const url =
        docInfo?.doc_url ||
        docInfo?.docurl ||
        info?.doc_url ||
        info?.docurl ||
        null;
      if (url && hostPayment.payment_id) {
        const updated = db.update('payments', hostPayment.payment_id, {
          refund_doc_url: url,
          updated_at: new Date().toISOString(),
        });
        if (updated) {
          await persistCore('payments', updated);
          hostPayment = { ...hostPayment, refund_doc_url: url };
        }
      } else if (url) {
        hostPayment = { ...hostPayment, refund_doc_url: url };
      }
    } catch (err) {
      console.warn('⚠️ [host payment] refund doc url lookup failed:', err.message);
    }
  }

  res.json({
    activity_id: activity.id,
    max_participants: activity.max_participants ?? null,
    remaining: remainingCapacity(activity, regs),
    registrations: enriched,
    host_payment: hostPayment,
  });
});

app.put('/api/activities/:id/registrations/:registrationId', async (req, res) => {
  try {
    const activity = db.getOne('activities', req.params.id);
    if (!activity) return res.status(404).json({ error: 'Activity not found' });
    if (supa.isEnabled()) {
      const remoteRegs = await supa.getAll('activity_registrations');
      if (remoteRegs) db.set('activity_registrations', remoteRegs);
    }
    const registration = db.getOne('activity_registrations', req.params.registrationId);
    if (!registration || String(registration.activity_id) !== String(activity.id)) {
      return res.status(404).json({ error: 'המשתתף לא נמצא באירוע' });
    }
    if (['cancelled', 'canceled'].includes(String(registration.status || ''))) {
      return res.status(400).json({ error: 'לא ניתן לערוך משתתף שבוטל' });
    }

    const body = req.body || {};
    const patch = {};
    if (body.participant_name != null) {
      const name = String(body.participant_name || '').trim();
      if (!name) return res.status(400).json({ error: 'שם המשתתף חובה' });
      patch.participant_name = name;
    }
    if (body.participant_type != null) {
      patch.participant_type = body.participant_type === 'adult' ? 'adult' : 'child';
    }
    if (body.notes != null) {
      patch.notes = String(body.notes || '');
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'אין שדות לעדכון' });
    }

    const updated = db.update('activity_registrations', registration.id, patch);
    const durable = await persistCore('activity_registrations', updated);
    if (durable?.ok === false) {
      return res.status(503).json({ error: durable.error || 'שמירת המשתתף נכשלה' });
    }

    if (patch.participant_name || patch.participant_type) {
      let student = registration.student_id ? db.getOne('students', registration.student_id) : null;
      const nextType = patch.participant_type || registration.participant_type || 'child';
      const nextName = patch.participant_name || registration.participant_name || '';
      if (!student && registration.parent_id && nextName) {
        student = db.insert('students', {
          name: nextName,
          parentId: registration.parent_id,
          isAdult: nextType === 'adult',
          groupId: null,
          status: 'health_signed',
          source: 'activity_registration',
          created: new Date().toISOString().slice(0, 10),
          healthSignedAt: registration.created_at || new Date().toISOString(),
          waiverSignedAt: registration.created_at || new Date().toISOString(),
        });
        await persistCore('students', student);
        const linked = db.update('activity_registrations', registration.id, { student_id: student.id });
        await persistCore('activity_registrations', linked);
        if (registration.health_declaration_id) {
          const declaration = (db.get('health_declarations') || []).find(
            (row) => String(row.id) === String(registration.health_declaration_id)
          );
          if (declaration) {
            const declarationUpdated = db.update('health_declarations', declaration.id, {
              studentId: student.id,
            });
            await persistCore('health_declarations', declarationUpdated);
          }
        }
      } else if (student) {
        const studentUpdated = db.update('students', student.id, {
          ...(patch.participant_name ? { name: patch.participant_name } : {}),
          ...(patch.participant_type ? { isAdult: nextType === 'adult' } : {}),
        });
        await persistCore('students', studentUpdated);
      }
    }

    res.json({ success: true, registration: db.getOne('activity_registrations', registration.id) || updated });
  } catch (err) {
    console.error('put registration error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/activities/:id/registrations/:registrationId', async (req, res) => {
  try {
    const activity = db.getOne('activities', req.params.id);
    if (!activity) return res.status(404).json({ error: 'Activity not found' });
    if (supa.isEnabled()) {
      const remoteRegs = await supa.getAll('activity_registrations');
      if (remoteRegs) db.set('activity_registrations', remoteRegs);
    }
    const registration = db.getOne('activity_registrations', req.params.registrationId);
    if (!registration || String(registration.activity_id) !== String(activity.id)) {
      return res.status(404).json({ error: 'המשתתף לא נמצא באירוע' });
    }

    const updated = db.update('activity_registrations', registration.id, {
      status: 'cancelled',
      notes: [registration.notes, 'בוטל על ידי צוות'].filter(Boolean).join(' · '),
    });
    const durable = await persistCore('activity_registrations', updated);
    if (durable?.ok === false) {
      return res.status(503).json({ error: durable.error || 'ביטול המשתתף נכשל' });
    }

    const regs = activeRegistrations(db, activity.id);
    res.json({
      success: true,
      registration: updated,
      remaining: remainingCapacity(activity, regs),
    });
  } catch (err) {
    console.error('delete registration error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/activities/:id/registrations/:registrationId/refund', async (req, res) => {
  try {
    if (!icount.isConfigured()) {
      return res.status(503).json({ error: 'מערכת החיוב לא מוגדרת בשרת' });
    }
    const activity = db.getOne('activities', req.params.id);
    if (!activity) return res.status(404).json({ error: 'Activity not found' });
    if (supa.isEnabled()) {
      const [remoteRegs, remoteOrders, remotePayments] = await Promise.all([
        supa.getAll('activity_registrations'),
        supa.getAll('activity_registration_orders'),
        supa.getAll('payments'),
      ]);
      if (remoteRegs) db.set('activity_registrations', remoteRegs);
      if (remoteOrders) db.set('activity_registration_orders', remoteOrders);
      if (remotePayments) db.set('payments', remotePayments);
    }
    const registration = db.getOne('activity_registrations', req.params.registrationId);
    if (!registration || String(registration.activity_id) !== String(activity.id)) {
      return res.status(404).json({ error: 'המשתתף לא נמצא באירוע' });
    }

    const plan = buildRegistrationRefundPlan(db, { activity, registration });
    if (!plan.ok) {
      return res.status(400).json({ error: plan.error, code: plan.code || null });
    }

    const reason =
      String(req.body?.reason || '').trim() ||
      `זיכוי הרשמה · ${activity.name} · ${plan.participantNames.join(', ')}`;

    try {
      const info = await icount.getDocInfo({ doctype: plan.doctype, docnum: plan.docnum });
      const docInfo = info.doc_info || info;
      if (docInfo?.is_cancelled) {
        const marked = await applyRegistrationRefundMarks({
          db,
          persist: persistCore,
          plan,
          reason: 'המסמך כבר בוטל במערכת החיוב',
          cancellation: { doctype: plan.doctype, docnum: plan.docnum },
          refundedBy: req.crmUser?.email || req.crmUser?.name || null,
        });
        const regs = activeRegistrations(db, activity.id);
        return res.json({
          success: true,
          alreadyCancelled: true,
          sharedPayment: plan.sharedPayment,
          participantNames: plan.participantNames,
          amount: plan.amount,
          registrations: marked.registrations,
          remaining: remainingCapacity(activity, regs),
        });
      }
      if (docInfo && docInfo.is_cancellable === false) {
        return res.status(400).json({ error: 'המסמך במערכת החיוב לא ניתן לביטול' });
      }
    } catch (err) {
      console.warn('⚠️ [activity refund] doc info check failed:', err.message);
    }

    const cancellation = await icount.cancelDoc({
      doctype: plan.doctype,
      docnum: plan.docnum,
      reason,
      refundCc: true,
    });

    const marked = await applyRegistrationRefundMarks({
      db,
      persist: persistCore,
      plan,
      reason,
      cancellation,
      refundedBy: req.crmUser?.email || req.crmUser?.name || null,
    });

    const regs = activeRegistrations(db, activity.id);
    console.log(
      `↩️ [activity] refund regs=${marked.registrations.map((r) => r.id).join(',')} doc=${plan.docnum} → ${cancellation.docnum}`
    );

    res.json({
      success: true,
      sharedPayment: plan.sharedPayment,
      participantNames: plan.participantNames,
      amount: plan.amount,
      cancellation,
      registrations: marked.registrations,
      remaining: remainingCapacity(activity, regs),
    });
  } catch (err) {
    console.error('activity registration refund error:', err.message, err.details?.error_details || '');
    const details = Array.isArray(err.details?.error_details)
      ? err.details.error_details.filter(Boolean).join(' · ')
      : '';
    res.status(502).json({
      error: details || err.message,
      code: err.code,
    });
  }
});

app.post('/api/activities/:id/host-payment/refund', async (req, res) => {
  try {
    if (!icount.isConfigured()) {
      return res.status(503).json({ error: 'מערכת החיוב לא מוגדרת בשרת' });
    }
    const activity = db.getOne('activities', req.params.id);
    if (!activity) return res.status(404).json({ error: 'Activity not found' });
    if (supa.isEnabled()) {
      const [remoteActivities, remotePayments] = await Promise.all([
        supa.getAll('activities'),
        supa.getAll('payments'),
      ]);
      if (remoteActivities) db.set('activities', remoteActivities);
      if (remotePayments) db.set('payments', remotePayments);
    }
    const fresh = db.getOne('activities', req.params.id) || activity;
    const plan = buildHostRefundPlan(db, fresh);
    if (!plan.ok) {
      return res.status(400).json({ error: plan.error, code: plan.code || null });
    }

    const reason =
      String(req.body?.reason || '').trim() ||
      `זיכוי דמי הזמנה · ${fresh.name}`;

    try {
      const info = await icount.getDocInfo({ doctype: plan.doctype, docnum: plan.docnum });
      const docInfo = info.doc_info || info;
      if (docInfo?.is_cancelled) {
        const cancelDocnum =
          docInfo.cancellation_docnum ||
          docInfo.cancelled_by_docnum ||
          docInfo.cancel_docnum ||
          null;
        const cancelDoctype =
          docInfo.cancellation_doctype ||
          docInfo.cancelled_by_doctype ||
          plan.doctype;
        const distinctCancel =
          cancelDocnum && String(cancelDocnum) !== String(plan.docnum)
            ? {
                doctype: cancelDoctype,
                docnum: cancelDocnum,
                docUrl:
                  docInfo.cancellation_doc_url ||
                  docInfo.cancelled_by_doc_url ||
                  null,
              }
            : null;
        const marked = await applyHostRefundMarks({
          db,
          persist: persistCore,
          activity: fresh,
          payment: plan.payment,
          reason: 'המסמך כבר בוטל במערכת החיוב',
          cancellation: distinctCancel,
          refundedBy: req.crmUser?.email || req.crmUser?.name || null,
        });
        return res.json({
          success: true,
          alreadyCancelled: true,
          amount: plan.amount,
          activity: marked.activity,
          payment: marked.payment,
        });
      }
      if (docInfo && docInfo.is_cancellable === false) {
        return res.status(400).json({ error: 'המסמך במערכת החיוב לא ניתן לביטול' });
      }
    } catch (err) {
      console.warn('⚠️ [host refund] doc info check failed:', err.message);
    }

    const cancellation = await icount.cancelDoc({
      doctype: plan.doctype,
      docnum: plan.docnum,
      reason,
      refundCc: true,
    });

    const marked = await applyHostRefundMarks({
      db,
      persist: persistCore,
      activity: fresh,
      payment: plan.payment,
      reason,
      cancellation,
      refundedBy: req.crmUser?.email || req.crmUser?.name || null,
    });

    console.log(
      `↩️ [activity] host refund activity=${fresh.id} doc=${plan.docnum} → ${cancellation.docnum}`
    );

    res.json({
      success: true,
      amount: plan.amount,
      cancellation,
      activity: marked.activity,
      payment: marked.payment,
    });
  } catch (err) {
    console.error('host payment refund error:', err.message, err.details?.error_details || '');
    const details = Array.isArray(err.details?.error_details)
      ? err.details.error_details.filter(Boolean).join(' · ')
      : '';
    res.status(502).json({
      error: details || err.message,
      code: err.code,
    });
  }
});

app.get('/api/activities/:id/host-payment/invoice', async (req, res) => {
  try {
    const activity = db.getOne('activities', req.params.id);
    if (!activity) return res.status(404).json({ error: 'האירוע לא נמצא' });
    if (supa.isEnabled()) {
      const [remoteActivities, remotePayments] = await Promise.all([
        supa.getAll('activities'),
        supa.getAll('payments'),
      ]);
      if (remoteActivities) db.set('activities', remoteActivities);
      if (remotePayments) db.set('payments', remotePayments);
    }
    const fresh = db.getOne('activities', req.params.id) || activity;
    const summary = summarizeHostPayment(db, fresh);
    if (!summary) return res.status(404).json({ error: 'לא נמצא תשלום מזמין' });

    const kind = String(req.query.kind || 'charge') === 'refund' ? 'refund' : 'charge';
    let url = kind === 'refund' ? summary.refund_doc_url : summary.icount_doc_url;
    let docnum = kind === 'refund' ? summary.refund_doc_number : summary.icount_doc_number;
    const doctype =
      kind === 'refund'
        ? summary.refund_doctype || summary.icount_doctype || 'invrec'
        : summary.icount_doctype || 'invrec';

    if (!url && kind === 'charge' && summary.icount_doc_id && icount.isConfigured()) {
      try {
        const info = await icount.getDoc(summary.icount_doc_id);
        url =
          info?.doc_url ||
          info?.docurl ||
          info?.doc?.doc_url ||
          info?.doc?.docurl ||
          null;
        if (url && summary.payment_id) {
          const updated = db.update('payments', summary.payment_id, {
            icount_doc_url: url,
            updated_at: new Date().toISOString(),
          });
          if (updated) await persistCore('payments', updated);
        }
      } catch (err) {
        console.warn('⚠️ [host invoice] charge url lookup failed:', err.message);
      }
    }

    if (!url && kind === 'refund' && docnum && icount.isConfigured()) {
      try {
        const info = await icount.getDocInfo({ doctype, docnum });
        const docInfo = info.doc_info || info;
        url =
          docInfo?.doc_url ||
          docInfo?.docurl ||
          info?.doc_url ||
          info?.docurl ||
          null;
        if (url && summary.payment_id) {
          const updated = db.update('payments', summary.payment_id, {
            refund_doc_url: url,
            updated_at: new Date().toISOString(),
          });
          if (updated) await persistCore('payments', updated);
        }
      } catch (err) {
        console.warn('⚠️ [host invoice] refund url lookup failed:', err.message);
      }
    }

    if (!url) {
      return res.status(404).json({
        error:
          kind === 'refund'
            ? 'אין קישור להורדת מסמך הזיכוי'
            : 'אין קישור להורדת חשבונית החיוב',
      });
    }

    const upstream = await fetch(url);
    if (!upstream.ok) {
      return res.status(502).json({ error: 'הורדת המסמך ממערכת החיוב נכשלה' });
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    const contentType = upstream.headers.get('content-type') || 'application/pdf';
    const safeDoc = String(docnum || kind).replace(/[^\w.-]+/g, '_');
    const filename =
      kind === 'refund'
        ? `invoice-refund-${safeDoc}.pdf`
        : `invoice-charge-${safeDoc}.pdf`;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    console.error('host payment invoice download error:', err.message);
    res.status(502).json({ error: err.message || 'הורדת המסמך נכשלה' });
  }
});

app.post('/api/activities/:id/registration-link', async (req, res) => {
  const activity = db.getOne('activities', req.params.id);
  if (!activity) return res.status(404).json({ error: 'Activity not found' });
  const regenerate = !!(req.body || {}).regenerate;
  let updated = activity;
  if (regenerate || !activity.registration_slug) {
    const participantSlug = makeRegistrationSlug();
    updated = db.update('activities', activity.id, {
      registration_slug: participantSlug,
      participant_registration_slug: participantSlug,
      registration_enabled:
        req.body?.enable === false ? false : (activity.registration_enabled || true),
    }) || activity;
  } else if (req.body?.enable) {
    updated = db.update('activities', activity.id, {
      registration_enabled: true,
      participant_registration_slug:
        activity.participant_registration_slug || activity.registration_slug,
    }) || activity;
  }
  const participantSlug =
    updated.participant_registration_slug || updated.registration_slug;
  const url = buildActivityRegistrationUrl(req, participantSlug);
  let hostPaymentToken = updated.host_payment_token;
  if (updated.registration_mode === 'host_pays' && !hostPaymentToken) {
    hostPaymentToken = makePrivatePaymentToken();
    updated = db.update('activities', activity.id, {
      host_payment_token: hostPaymentToken,
    }) || updated;
  }
  const durableLink = await persistCore('activities', updated);
  if (durableLink?.ok === false) {
    return res.status(503).json({ error: durableLink.error || 'שמירת הקישור נכשלה' });
  }
  res.json({
    success: true,
    slug: participantSlug,
    url,
    hostPaymentUrl: buildHostPaymentUrl(req, hostPaymentToken),
    registration_enabled: !!updated.registration_enabled,
  });
});

app.post('/api/activities/:id/send-registration-link', async (req, res) => {
  try {
    let activity = db.getOne('activities', req.params.id);
    if (!activity) return res.status(404).json({ error: 'Activity not found' });

    const hostParentId = req.body?.host_parent_id || activity.host_parent_id || null;
    if (!hostParentId) {
      return res.status(400).json({
        error: 'יש לבחור מזמין מתוך לקוחות המערכת לפני השליחה',
      });
    }

    const parent = (db.get('parents') || []).find(
      (p) => String(p.id) === String(hostParentId)
    );
    if (!parent) {
      return res.status(400).json({ error: 'המזמין שנבחר לא נמצא ברשימת הלקוחות' });
    }

    const hostPhone = normalizePhone(parent.phone || req.body?.phone || activity.host_phone);
    if (!hostPhone) {
      return res.status(400).json({ error: 'ללקוח שנבחר אין מספר טלפון לשליחה בוואטסאפ' });
    }

    const hostName = parent.name || activity.host_name || activity.contact_name || '';
    const hostEmail = String(
      req.body?.email || parent.email || activity.host_email || ''
    ).trim();

    // Keep snapshot fields in sync with the CRM customer
    activity = db.update('activities', activity.id, {
      host_parent_id: parent.id,
      host_name: hostName,
      host_phone: parent.phone || activity.host_phone || '',
      host_email: hostEmail || activity.host_email || '',
      contact_name: hostName,
      contact_phone: parent.phone || activity.contact_phone || '',
    }) || activity;

    if (!activity.registration_enabled && req.body?.enable !== false) {
      activity = db.update('activities', activity.id, { registration_enabled: true }) || activity;
    }
    if (!activity.registration_enabled) {
      return res.status(400).json({ error: 'דף ההרשמה הציבורי כבוי — יש להפעיל אותו קודם' });
    }

    activity = ensureActivityRegistrationSlug(activity);
    if (!activity.registration_slug) {
      return res.status(400).json({ error: 'לא נוצר קישור הרשמה לאירוע' });
    }

    let url = buildActivityRegistrationUrl(
      req,
      activity.participant_registration_slug || activity.registration_slug
    );
    const sendHostPayment = activity.registration_mode === 'host_pays'
      && req.body?.link_type !== 'participant';
    if (sendHostPayment) {
      if (!activity.host_payment_token) {
        activity = db.update('activities', activity.id, {
          host_payment_token: makePrivatePaymentToken(),
        }) || activity;
        const tokenPersisted = await persistCore('activities', activity);
        if (tokenPersisted?.ok === false) {
          return res.status(503).json({
            error: tokenPersisted.error || 'שמירת קישור התשלום נכשלה',
          });
        }
      }
      url = buildHostPaymentUrl(req, activity.host_payment_token);
    }

    let emailed = false;
    let emailStub = false;
    if (hostEmail && req.body?.via !== 'whatsapp') {
      const result = await sendHostRegistrationLink({
        to: hostEmail,
        hostName,
        activityName: activity.name,
        date: activity.date,
        registrationUrl: url,
      });
      emailed = !!result.sent;
      emailStub = !!result.stub;
    }

    try {
      ensureEventWhatsappTemplates({
        db,
        persist: persistCore,
        publicAppBase: frontendPublicBase(req),
      });
    } catch (tplErr) {
      console.warn('event whatsapp templates ensure skipped:', tplErr.message);
    }

    let whatsappSent = false;
    let whatsappError = null;
    let whatsappViaTemplate = false;
    if (req.body?.via !== 'email') {
      const inWindow = canSendFreeform(parent, 'whatsapp');
      const metaName = sendHostPayment
        ? EVENT_HOST_PAYMENT_TEMPLATE
        : EVENT_PARTICIPANT_LINK_TEMPLATE;
      const localTpl = findApprovedEventTemplate(db, metaName);
      const freeformMsg = sendHostPayment
        ? (
          `שלום${hostName ? ` ${hostName}` : ''}!\n` +
          `קישור פרטי לתשלום עבור "${activity.name}":\n${url}`
        )
        : (
          `שלום${hostName ? ` ${hostName}` : ''}!\n` +
          `קישור להרשמת משתתפים עבור "${activity.name}":\n${url}\n` +
          `אפשר להעביר את הקישור לכל מי שמגיע לאירוע.`
        );

      // Prefer approved Meta templates for activity links (host payment / participants).
      if (localTpl) {
        const buttonParam = sendHostPayment
          ? activity.host_payment_token
          : (activity.participant_registration_slug || activity.registration_slug);
        try {
          const waResult = await whatsappService.sendTemplateMessage(
            hostPhone,
            metaName,
            [hostName || 'לקוח', activity.name || 'אירוע'],
            {
              fallbackName: hostName,
              parentId: parent.id,
              buttonUrlParam: buttonParam,
            }
          );
          if (waResult?.success) {
            whatsappSent = true;
            whatsappViaTemplate = true;
            whatsappError = null;
          } else {
            whatsappError = waResult?.error || 'שליחת תבנית וואטסאפ נכשלה';
          }
        } catch (waErr) {
          whatsappError = waErr.message || 'שליחת תבנית וואטסאפ נכשלה';
        }
      }

      // Fallback: free-form only when no approved template is available and the 24h window is open.
      if (!whatsappSent && inWindow) {
        const waResult = await whatsappService.sendTextMessage(hostPhone, freeformMsg, false, {
          clip: false,
          parentId: parent.id,
          source: 'activity_registration',
        });
        if (waResult?.success) {
          whatsappSent = true;
          whatsappViaTemplate = false;
          whatsappError = null;
        } else if (!whatsappError) {
          whatsappError = waResult?.error || 'שליחת וואטסאפ נכשלה';
        }
      }

      if (!whatsappSent && !localTpl && !inWindow) {
        whatsappError =
          'חלון התקשורת של 24 שעות סגור, והתבנית עדיין לא מאושרת במטא. ' +
          'במסך דיוור ← תבניות Meta: שלחו לאישור את «אירוע · קישור תשלום מזמין» או «אירוע · קישור למשתתפים».';
      } else if (!whatsappSent && localTpl && !whatsappError) {
        whatsappError = 'שליחת תבנית וואטסאפ נכשלה';
      }
    }

    if (!whatsappSent && !emailed && !emailStub) {
      return res.status(400).json({
        error: whatsappError || 'השליחה למזמין נכשלה',
        url,
        whatsappSent: false,
        windowClosed: !!whatsappError && String(whatsappError).includes('24'),
        templatePending: !!whatsappError && String(whatsappError).includes('תבנית'),
      });
    }

    res.json({
      success: true,
      url,
      emailed,
      emailStub,
      emailConfigured: isEmailConfigured(),
      whatsappSent,
      whatsappViaTemplate,
      whatsappError: whatsappSent ? null : whatsappError,
      host_parent_id: parent.id,
      host_name: hostName,
      host_phone: parent.phone || '',
    });
  } catch (err) {
    console.error('send-registration-link error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/activities/:id/payment-status', (req, res) => {
  const activity = db.getOne('activities', req.params.id);
  if (!activity) return res.status(404).json({ error: 'Activity not found' });
  const payment_status = normalizeHostPaymentStatus(req.body?.payment_status);
  const updated = db.update('activities', activity.id, { payment_status });
  res.json(updated);
});

// ─── Activity templates ──────────────────────────────────────────────────────
app.get('/api/activity-templates', (req, res) => {
  try {
    ensureSeedActivityTemplates(db);
  } catch (err) {
    console.warn('activity template seed failed:', err.message);
  }
  const includeInactive = String(req.query.include_inactive || '') === '1';
  const rows = listActivityTemplates(db, { includeInactive });
  if (String(req.query.grouped || '') === '1') {
    return res.json({
      categories: TEMPLATE_CATEGORIES,
      groups: groupTemplatesByCategory(rows),
      templates: rows,
    });
  }
  res.json(rows);
});

app.get('/api/activity-templates/categories', (_req, res) => {
  res.json(TEMPLATE_CATEGORIES);
});

app.post('/api/activity-templates', (req, res) => {
  const body = req.body || {};
  let payload;
  if (body.activity_id) {
    const activity = db.getOne('activities', body.activity_id);
    if (!activity) return res.status(404).json({ error: 'Activity not found' });
    payload = {
      ...templateFieldsFromActivity(activity),
      name: String(body.name || activity.name || '').trim() || 'תבנית',
      category: body.category || activity.category || 'wall',
    };
  } else {
    payload = normalizeActivityTemplatePayload(body);
  }
  if (!payload.name) return res.status(400).json({ error: 'חסר שם תבנית' });
  const record = db.insert('activity_templates', payload);
  res.status(201).json(record);
});

app.put('/api/activity-templates/:id', (req, res) => {
  const existing = db.getOne('activity_templates', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Template not found' });
  const payload = normalizeActivityTemplatePayload({ ...existing, ...(req.body || {}) });
  if (!payload.name) return res.status(400).json({ error: 'חסר שם תבנית' });
  const updated = db.update('activity_templates', existing.id, payload);
  res.json(updated);
});

app.delete('/api/activity-templates/:id', (req, res) => {
  const deleted = db.delete('activity_templates', req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Template not found' });
  res.json({ success: true });
});

/** Prefill draft for the calendar form — does not save an activity yet. */
app.get('/api/activity-templates/:id/draft', (req, res) => {
  const template = db.getOne('activity_templates', req.params.id);
  if (!template) return res.status(404).json({ error: 'Template not found' });
  const date = req.query.date || null;
  res.json(activityDraftFromTemplate(template, { date }));
});

app.post('/api/activity-templates/:id/create-activity', async (req, res) => {
  const template = db.getOne('activity_templates', req.params.id);
  if (!template) return res.status(404).json({ error: 'Template not found' });
  const body = req.body || {};
  if (!body.date) return res.status(400).json({ error: 'חסר תאריך' });
  const payload = normalizeActivityPayload({
    ...templateFieldsFromActivity(template),
    name: body.name || template.name,
    date: body.date,
    end_date: body.end_date ?? null,
    start_time: body.start_time ?? template.start_time,
    end_time: body.end_time ?? template.end_time,
    all_day: body.all_day != null ? body.all_day : template.all_day,
    host_name: body.host_name || '',
    host_email: body.host_email || '',
    host_phone: body.host_phone || '',
    host_parent_id: body.host_parent_id || null,
    payment_status: 'unpaid',
    registration_slug: makeRegistrationSlug(),
    registration_enabled: !!template.registration_enabled,
  });
  if (payload.end_date && payload.end_date < payload.date) {
    return res.status(400).json({ error: 'תאריך הסיום לפני תאריך ההתחלה' });
  }
  const record = db.insert('activities', payload);
  res.status(201).json(record);
  syncActivityToGoogle(record).catch((err) =>
    console.error('Background Google push failed:', err.message)
  );
});

// ─── Public activity registration ────────────────────────────────────────────
app.get('/api/public/host-payments/:token', publicFormRateLimit, async (req, res) => {
  try {
    const activity = await findActivityByHostPaymentToken(req.params.token);
    if (!activity) {
      return res.status(404).json({ error: 'קישור התשלום לא נמצא' });
    }
    const theme = normalizeActivityTheme(
      activity.registration_theme || activity.theme || {}
    );
    res.json({
      id: activity.id,
      name: activity.name,
      date: activity.date,
      start_time: activity.start_time,
      location: activity.location || '',
      host_name: activity.host_name || activity.contact_name || '',
      price: Number(activity.price) || 0,
      price_includes_vat: normalizePriceIncludesVat(activity.price_includes_vat),
      payment_status: activity.payment_status || 'unpaid',
      cover_image: theme.cover_image || '',
      cover_position: theme.cover_position || '50% 50%',
    });
  } catch (err) {
    console.error('host payment lookup error:', err.message);
    res.status(503).json({ error: err.message || 'טעינת קישור התשלום נכשלה' });
  }
});

app.post('/api/public/host-payments/:token/pay', publicFormRateLimit, async (req, res) => {
  try {
    const activity = await findActivityByHostPaymentToken(req.params.token);
    if (!activity) {
      return res.status(404).json({ error: 'קישור התשלום לא נמצא' });
    }
    if (activity.payment_status === 'paid') {
      return res.json({ success: true, alreadyPaid: true });
    }
    let parent = db.getOne('parents', activity.host_parent_id);
    if (!parent && activity.host_parent_id && supa.isEnabled()) {
      const remoteParents = await supa.getAll('parents');
      if (remoteParents) {
        db.set('parents', remoteParents);
        parent = db.getOne('parents', activity.host_parent_id);
      }
    }
    if (!parent) return res.status(400).json({ error: 'המזמין אינו מקושר ללקוח במערכת' });

    let payment = activity.host_payment_id
      ? db.getOne('payments', activity.host_payment_id)
      : null;
    const includesVat = normalizePriceIncludesVat(activity.price_includes_vat);
    const amount = chargeAmount(activity.price, includesVat);
    const description = `תשלום אירוע: ${activity.name}`;
    if (
      !payment ||
      payment.status === 'failed' ||
      payment.status === 'refunded' ||
      payment.status === 'cancelled'
    ) {
      payment = db.insert('payments', {
        parent_id: parent.id,
        student_id: null,
        activity_id: activity.id,
        activity_host_payment: true,
        amount,
        price_includes_vat: includesVat,
        description,
        status: 'pending',
        payment_url: null,
        paid_at: null,
        updated_at: new Date().toISOString(),
      });
    } else {
      payment = db.update('payments', payment.id, {
        parent_id: parent.id,
        amount,
        price_includes_vat: includesVat,
        description,
        updated_at: new Date().toISOString(),
      }) || payment;
    }
    const paymentUrl = await icount.buildPaymentUrl({
      amount,
      description,
      name: parent.name,
      phone: normalizePhone(parent.phone),
      email: parent.email,
      paymentId: payment.id,
      ipnUrl: icount.buildIpnUrl({ paymentId: payment.id }),
      successUrl: `${frontendPublicBase(req)}/event-host/${encodeURIComponent(req.params.token)}?paid=1`,
      pageKind: 'event',
    });
    payment = db.update('payments', payment.id, {
      payment_url: paymentUrl,
      updated_at: new Date().toISOString(),
    }) || payment;
    const paymentPersisted = await persistCore('payments', payment);
    if (paymentPersisted?.ok === false) throw new Error(paymentPersisted.error);
    const updatedActivity = db.update('activities', activity.id, {
      host_payment_id: payment.id,
    }) || activity;
    const activityPersisted = await persistCore('activities', updatedActivity);
    if (activityPersisted?.ok === false) throw new Error(activityPersisted.error);
    res.json({ success: true, paymentUrl });
  } catch (err) {
    console.error('host activity payment error:', err.message);
    res.status(503).json({ error: err.message || 'יצירת התשלום נכשלה' });
  }
});

/** Resolve public registration activity, refreshing from durable store when needed. */
async function findActivityBySlugFresh(slug) {
  let activity = findActivityBySlug(db, slug);
  // Always refresh from durable store so cover/theme edits are visible on public links
  // even when the in-memory cache on the server is stale.
  if (supa.isEnabled()) {
    const remote = await supa.getAll('activities');
    if (remote) {
      db.set('activities', remote);
      activity = findActivityBySlug(db, slug) || activity;
    }
  }
  return activity;
}

app.get('/api/public/activities/:slug', publicFormRateLimit, async (req, res) => {
  try {
    const activity = await findActivityBySlugFresh(req.params.slug);
    if (!activity) return res.status(404).json({ error: 'הפעילות לא נמצאה' });
    if (supa.isEnabled()) {
      const remoteRegs = await supa.getAll('activity_registrations');
      if (remoteRegs) db.set('activity_registrations', remoteRegs);
    }
    const regs = activeRegistrations(db, activity.id);
    const template = resolveDefaultDeclarationTemplate(db);
    res.json({
      ...publicRegistrationPayload(activity, regs),
      form_template: template,
    });
  } catch (err) {
    console.error('public activity get error:', err.message);
    res.status(500).json({ error: err.message || 'טעינת הפעילות נכשלה' });
  }
});

app.get('/api/public/activities/:slug/household', publicFormRateLimit, async (req, res) => {
  try {
    const activity = await findActivityBySlugFresh(req.params.slug);
    if (!activity) return res.status(404).json({ error: 'הפעילות לא נמצאה' });
    const phone = normalizePhone(req.query.phone || '');
    if (!phone || phone.replace(/\D/g, '').length < 9) {
      return res.json({ found: false, parent: null, children: [], adult_health_valid: false });
    }
    if (supa.isEnabled()) {
      const [remoteParents, remoteStudents, remoteDecls] = await Promise.all([
        supa.getAll('parents'),
        supa.getAll('students'),
        supa.getAll('health_declarations'),
      ]);
      if (remoteParents) db.set('parents', remoteParents);
      if (remoteStudents) db.set('students', remoteStudents);
      if (remoteDecls) db.set('health_declarations', remoteDecls);
    }
    const parent = findParentForOnboard({ phone });
    if (!parent) {
      return res.json({ found: false, parent: null, children: [], adult_health_valid: false });
    }
    const children = (db.get('students') || [])
      .filter((student) => String(student.parentId) === String(parent.id) && student.isAdult !== true)
      .map((student) => {
        const declaration = findLatestValidDeclaration(db, { studentId: student.id });
        const signedAt = declarationSignedAt(declaration) || student.healthSignedAt || null;
        const healthValid = !!declaration || isHealthDeclarationValid(student.healthSignedAt);
        return {
          id: student.id,
          name: String(student.name || '').trim(),
          birthDate: student.birthDate || '',
          health_valid: healthValid,
          health_signed_at: signedAt,
        };
      })
      .filter((child) => child.name)
      .sort((a, b) => a.name.localeCompare(b.name, 'he'));

    const adultStudent = (db.get('students') || []).find((student) => {
      if (String(student.parentId) !== String(parent.id) || student.isAdult !== true) return false;
      const parentName = String(parent.name || '').trim().toLowerCase();
      const studentName = String(student.name || '').trim().toLowerCase();
      return !parentName || studentName === parentName;
    }) || (db.get('students') || []).find(
      (student) => String(student.parentId) === String(parent.id) && student.isAdult === true
    );
    const adultDeclaration = (adultStudent
      ? findLatestValidDeclaration(db, { studentId: adultStudent.id })
      : null)
      || findLatestValidDeclaration(db, {
        parentId: parent.id,
        climberName: parent.name,
      });

    res.json({
      found: true,
      parent: {
        id: parent.id,
        name: parent.name || '',
        phone: parent.phone || '',
        email: parent.email || '',
        city: parent.city || '',
      },
      children,
      adult_student_id: adultStudent?.id || null,
      adult_health_valid: !!adultDeclaration,
      listDefs: typeof db.getBroadcastListDefs === 'function' ? db.getBroadcastListDefs() : [],
      subscriptions: typeof db.getParentBroadcastLists === 'function'
        ? db.getParentBroadcastLists(parent.id)
        : { classes: true },
    });
  } catch (err) {
    console.error('public activity household error:', err.message);
    res.status(500).json({ error: err.message || 'טעינת פרטי הלקוח נכשלה' });
  }
});

app.post('/api/public/activities/:slug/register', publicFormRateLimit, async (req, res) => {
  try {
    const activity = await findActivityBySlugFresh(req.params.slug);
    if (!activity) return res.status(404).json({ error: 'הפעילות לא נמצאה' });
    if (!registrationIsOpen(activity)) {
      return res.status(400).json({ error: 'ההרשמה לפעילות זו סגורה' });
    }
    if (supa.isEnabled()) {
      const [remoteOrders, remoteRegs] = await Promise.all([
        supa.getAll('activity_registration_orders'),
        supa.getAll('activity_registrations'),
      ]);
      if (remoteOrders) db.set('activity_registration_orders', remoteOrders);
      if (remoteRegs) db.set('activity_registrations', remoteRegs);
    }
    const participantSlug =
      activity.participant_registration_slug || activity.registration_slug;
    const result = await registerActivityGroup({
      db,
      persist: persistCore,
      activity,
      payload: req.body || {},
      createPaymentUrl: ({ payment, parent, amount }) => icount.buildPaymentUrl({
        amount,
        description: `הרשמה — ${activity.name}`,
        name: parent.name,
        phone: normalizePhone(parent.phone),
        email: parent.email,
        paymentId: payment.id,
        ipnUrl: icount.buildIpnUrl({ paymentId: payment.id }),
        successUrl: `${frontendPublicBase(req)}/event/${encodeURIComponent(participantSlug)}?paid=1`,
      }),
      onStudentCreated: (student, parent) => automationsService.triggerEvent('new_lead', {
        ...student,
        phone: parent.phone,
        parentName: parent.name,
      }),
      onStudentStatusChanged: (student) => automationsService.triggerEvent('status_changed', {
        ...student,
        new_status: 'health_signed',
      }),
    });
    const parent = result.crm?.parent || db.getOne('parents', result.order.parent_id);
    let emailResult = { sent: false };
    if (parent?.email && !result.duplicate) {
      emailResult = await sendActivityRegistrationConfirmation({
        to: parent.email,
        participantName: parent.name,
        activityName: activity.name,
        date: activity.date,
        startTime: activity.start_time,
        location: activity.location,
        paymentUrl: result.paymentUrl,
      });
    }
    const updatedRegs = activeRegistrations(db, activity.id);
    res.status(201).json({
      success: true,
      duplicate: result.duplicate,
      order: result.order,
      registrations: result.registrations,
      declarations: result.crm?.declarations || [],
      paymentUrl: result.paymentUrl,
      emailSent: !!emailResult.sent,
      emailStub: !!emailResult.stub,
      activity: publicRegistrationPayload(activity, updatedRegs),
    });
  } catch (err) {
    console.error('public activity register error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── Google Calendar connection + sync ───────────────────────────────────────
app.get('/api/google-calendar/status', async (req, res) => {
  try {
    res.json(await googleCalendarService.getStatus());
  } catch (err) {
    res.status(500).json({ configured: false, connected: false, error: err.message });
  }
});

app.get('/api/google-calendar/auth-url', requireOwner, (req, res) => {
  try {
    res.json({ url: googleCalendarService.getAuthUrl() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/google-calendar/oauth/callback', async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) {
      return res.redirect(`${googleCalendarService.frontendBase()}/activities?google=error`);
    }
    const result = await googleCalendarService.completeOAuth(String(code));
    // Initial pull after connect
    try {
      await applyGooglePull(db);
    } catch (err) {
      console.error('Initial Google pull failed:', err.message);
    }
    res.redirect(googleCalendarService.oauthCallbackRedirectUrl(result));
  } catch (err) {
    console.error('Google OAuth callback failed:', err.message);
    res.redirect(
      `${googleCalendarService.frontendBase()}/activities?google=error&msg=${encodeURIComponent(err.message)}`
    );
  }
});

app.post('/api/google-calendar/disconnect', requireOwner, async (req, res) => {
  try {
    res.json(await googleCalendarService.disconnect());
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/google-calendar/sync', async (req, res) => {
  try {
    // Push local activities missing a Google id (or force refresh)
    const activities = db.get('activities') || [];
    let pushed = 0;
    let pushFailed = 0;
    const pushErrors = [];
    for (const activity of activities) {
      if (activity.status === 'cancelled') continue;
      try {
        const updated = await syncActivityToGoogle(activity);
        if (updated?.google_event_id) pushed += 1;
      } catch (err) {
        pushFailed += 1;
        pushErrors.push({ id: activity.id, error: err.message });
      }
    }

    const result = await applyGooglePull(db);
    res.json({
      success: true,
      pushed,
      pushFailed,
      pushErrors: pushErrors.slice(0, 5),
      ...result,
    });
  } catch (err) {
    console.error('Google Calendar sync failed:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/google-calendar/calendars', async (req, res) => {
  try {
    const calendars = await googleCalendarService.listCalendars();
    const status = await googleCalendarService.getStatus();
    res.json({
      calendars,
      overlayCalendarIds: status.overlayCalendarIds || [],
      wallCalendarId: status.calendarId || null,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/google-calendar/overlays', async (req, res) => {
  try {
    const ids = req.body?.calendarIds ?? req.body?.overlayCalendarIds ?? [];
    const result = await googleCalendarService.setOverlayCalendars(ids);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/google-calendar/overlay-events', async (req, res) => {
  try {
    const from = String(req.query.from || '').slice(0, 10);
    const to = String(req.query.to || '').slice(0, 10);
    const events = await googleCalendarService.listOverlayEvents({ from, to });
    res.json(events);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/google-calendar/overlay-events', async (req, res) => {
  try {
    const body = req.body || {};
    const updated = await googleCalendarService.updateOverlayEvent({
      calendarId: body.calendar_id || body.calendarId,
      eventId: body.google_event_id || body.eventId,
      patch: {
        name: body.name,
        date: body.date,
        start_time: body.start_time,
        end_time: body.end_time,
        all_day: body.all_day,
        location: body.location,
        description: body.description,
      },
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/google-calendar/overlay-events', async (req, res) => {
  try {
    const body = req.body || {};
    const created = await googleCalendarService.createOverlayEvent({
      calendarId: body.calendar_id || body.calendarId,
      patch: {
        name: body.name,
        date: body.date,
        start_time: body.start_time,
        end_time: body.end_time,
        all_day: body.all_day,
        location: body.location,
        description: body.description,
      },
    });
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/google-calendar/overlay-events', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await googleCalendarService.deleteOverlayEvent({
      calendarId: body.calendar_id || body.calendarId || req.query.calendar_id,
      eventId: body.google_event_id || body.eventId || req.query.event_id,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Public webhook from Google push notifications
app.post('/api/google-calendar/webhook', async (req, res) => {
  res.status(200).end();
  const resourceState = req.get('X-Goog-Resource-State');
  if (resourceState === 'sync') return;
  try {
    const status = await googleCalendarService.getStatus();
    if (status.connected) {
      await applyGooglePull(db);
    }
  } catch (err) {
    console.error('Google webhook sync failed:', err.message);
  }
});

// Cron-friendly pull (same secret pattern as attendance ensure)
app.post('/api/google-calendar/sync-due', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.get('x-cron-secret') !== secret && req.query.secret !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const result = await applyGooglePull(db);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Attendance — Supabase-backed ────────────────────────────────────────────
// Optional query filters: ?groupId=..&date=YYYY-MM-DD&studentId=..
function filterAttendanceRows(rows, { groupId, date, studentId }) {
  let out = rows || [];
  if (groupId) out = out.filter((r) => r.group_id === groupId);
  if (date) out = out.filter((r) => r.date === date);
  if (studentId) out = out.filter((r) => r.student_id === studentId);
  return out;
}

app.get('/api/attendance', async (req, res) => {
  const { groupId, date, studentId } = req.query;
  const hasFilter = Boolean(groupId || date || studentId);
  try {
    if (supa.isEnabled()) {
      // With a filter: query only the matching rows in the database.
      // Without a filter: pull everything and refresh the local cache.
      const rows = hasFilter
        ? await supa.getAttendanceFiltered({ groupId, date, studentId })
        : await supa.getAll('attendance');
      if (rows) {
        if (!hasFilter && typeof db.set === 'function') db.set('attendance', rows);
        return res.json(hasFilter ? rows : filterAttendanceRows(rows, { groupId, date, studentId }));
      }
    }
  } catch (err) {
    console.error('GET /api/attendance Supabase error:', err.message);
  }
  res.json(filterAttendanceRows(db.get('attendance'), { groupId, date, studentId }));
});

app.post('/api/attendance', (req, res) => {
  const body = { ...req.body };
  if (body.status) body.status = normalizeAttStatus(body.status);
  else body.status = 'pending';
  const record = db.insert('attendance', body);
  res.status(201).json(record);
});

// Ensure pending attendance rows for every enrolled climber on training days.
// Idempotent: never overwrites existing (student_id, group_id, date) rows.
// Body: { date?: "YYYY-MM-DD", groupId?: string }
async function refreshAttendanceCache() {
  try {
    if (supa.isEnabled()) {
      const rows = await supa.getAll('attendance');
      if (rows && typeof db.set === 'function') db.set('attendance', rows);
    }
  } catch (err) {
    console.error('attendance cache refresh failed:', err.message);
  }
}

async function refreshStudentsAndGroupsCache() {
  try {
    if (supa.isEnabled()) {
      const [groups, students] = await Promise.all([
        supa.getAll('groups'),
        supa.getAll('students'),
      ]);
      if (groups && typeof db.set === 'function') db.set('groups', groups);
      if (students && typeof db.set === 'function') db.set('students', students);
    }
  } catch (err) {
    console.error('groups/students cache refresh failed:', err.message);
  }
}

app.post('/api/attendance/ensure', async (req, res) => {
  const date = req.body?.date || israelDateStr();
  const groupId = req.body?.groupId || null;

  await refreshStudentsAndGroupsCache();
  await refreshAttendanceCache();

  const result = ensureAttendanceRows({
    groups: db.get('groups') || [],
    students: db.get('students') || [],
    attendance: db.get('attendance') || [],
    date,
    groupId,
  });

  for (const row of result.created) {
    db.insert('attendance', row);
  }

  res.status(201).json({
    created: result.created.length,
    existing: result.existing,
    groups: result.groups,
    date: result.date,
    rows: result.created,
  });
});

// Cron / external scheduler entry. The secret is mandatory and header-only.
app.post('/api/attendance/ensure-today', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return res.status(503).json({ error: 'CRON_SECRET is not configured' });
  }
  const provided = req.get('x-cron-secret') || '';
  if (provided !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.body = { ...(req.body || {}), date: israelDateStr() };
  // Reuse ensure handler logic
  await refreshStudentsAndGroupsCache();
  await refreshAttendanceCache();
  const result = ensureAttendanceRows({
    groups: db.get('groups') || [],
    students: db.get('students') || [],
    attendance: db.get('attendance') || [],
    date: israelDateStr(),
    groupId: null,
  });
  for (const row of result.created) {
    db.insert('attendance', row);
  }
  console.log(`📋 Daily attendance ensure: created ${result.created.length} for ${result.date}`);
  res.status(201).json({
    created: result.created.length,
    existing: result.existing,
    groups: result.groups,
    date: result.date,
  });
});

// Bulk upsert attendance for a group on a given date.
// Also matches existing rows by (student_id, group_id, date) so re-saves
// stay idempotent even if the client lost the previous id.
app.post('/api/attendance/bulk', async (req, res) => {
  const { records } = req.body;
  if (!Array.isArray(records)) return res.status(400).json({ error: 'records must be an array' });

  await refreshAttendanceCache();

  const existing = db.get('attendance') || [];
  const saved = records.map((raw) => {
    const r = { ...raw };
    r.status = normalizeAttStatus(r.status || 'pending');
    if (!r.student_id || !r.group_id || !r.date) {
      return null;
    }
    const byId = r.id ? existing.find((e) => e.id === r.id) : null;
    const byKey = existing.find(
      (e) =>
        e.student_id === r.student_id &&
        e.group_id === r.group_id &&
        e.date === r.date
    );
    const match = byId || byKey;
    if (match) {
      return db.update('attendance', match.id, {
        student_id: r.student_id,
        group_id: r.group_id,
        date: r.date,
        status: r.status,
        marked_by: r.marked_by ?? match.marked_by ?? null,
        notes: r.notes ?? match.notes ?? '',
      });
    }
    return db.insert('attendance', {
      id: r.id || `att-${r.group_id}-${r.date}-${r.student_id}`,
      student_id: r.student_id,
      group_id: r.group_id,
      date: r.date,
      status: r.status,
      marked_by: r.marked_by || null,
      notes: r.notes || '',
    });
  }).filter(Boolean);

  res.status(201).json(saved);
});

app.put('/api/attendance/:id', (req, res) => {
  const { id } = req.params;
  const body = { ...req.body };
  if (body.status) body.status = normalizeAttStatus(body.status);
  const updated = db.update('attendance', id, body);
  if (!updated) return res.status(404).json({ error: 'Attendance record not found' });
  res.json(updated);
});

app.delete('/api/attendance/:id', (req, res) => {
  const { id } = req.params;
  const deleted = db.delete('attendance', id);
  if (!deleted) return res.status(404).json({ error: 'Attendance record not found' });
  res.json({ success: true });
});

// Get all pricelist items
app.get('/api/pricelist', (req, res) => {
  const items = (db.get('pricelist') || []).map(enrichPricelistItem);
  res.json(items);
});

// Create pricelist item
app.post('/api/pricelist', (req, res) => {
  try {
    const body = { ...req.body };
    if (body.image !== undefined) body.image = body.image ? clampImage(body.image) : '';
    const record = db.insert('pricelist', body);
    res.status(201).json(enrichPricelistItem(record));
  } catch (err) {
    res.status(400).json({ error: err.message || 'שגיאה' });
  }
});

// Update pricelist item
app.put('/api/pricelist/:id', (req, res) => {
  try {
    const { id } = req.params;
    const body = { ...req.body };
    if (body.image !== undefined) body.image = body.image ? clampImage(body.image) : '';
    const updated = db.update('pricelist', id, body);
    if (!updated) return res.status(404).json({ error: 'Pricelist item not found' });
    res.json(enrichPricelistItem(updated));
  } catch (err) {
    res.status(400).json({ error: err.message || 'שגיאה' });
  }
});

// Delete pricelist item
app.delete('/api/pricelist/:id', (req, res) => {
  const { id } = req.params;
  const deleted = db.delete('pricelist', id);
  if (!deleted) return res.status(404).json({ error: 'Pricelist item not found' });
  res.json({ success: true });
});

// ─── Product categories (catalog folders) ───────────────────────────────────
app.get('/api/product-categories', (req, res) => {
  res.json(ensureProductCategories(db));
});

app.post('/api/product-categories', requireOwner, (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'שם קטגוריה חובה' });
    const existing = ensureProductCategories(db);
    if (existing.some((c) => c.name === name)) {
      return res.status(400).json({ error: 'קטגוריה בשם הזה כבר קיימת' });
    }
    let image = '';
    if (req.body?.image) image = clampImage(req.body.image);
    const record = db.insert('product_categories', {
      name,
      image,
      description: String(req.body?.description || '').trim(),
      sort_order: existing.length,
      active: req.body?.active !== false,
    });
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ error: err.message || 'שגיאה' });
  }
});

app.put('/api/product-categories/:id', requireOwner, (req, res) => {
  try {
    const { id } = req.params;
    const current = (db.get('product_categories') || []).find((c) => c.id === id);
    if (!current) return res.status(404).json({ error: 'קטגוריה לא נמצאה' });

    const updates = {};
    if (req.body?.name != null) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ error: 'שם קטגוריה חובה' });
      const clash = (db.get('product_categories') || []).find(
        (c) => c.id !== id && c.name === name
      );
      if (clash) return res.status(400).json({ error: 'קטגוריה בשם הזה כבר קיימת' });
      updates.name = name;
    }
    if (req.body?.description != null) {
      updates.description = String(req.body.description).trim();
    }
    if (req.body?.sort_order != null) {
      updates.sort_order = Number(req.body.sort_order) || 0;
    }
    if (req.body?.active != null) updates.active = !!req.body.active;
    if (req.body?.image !== undefined) {
      updates.image = req.body.image ? clampImage(req.body.image) : '';
    }

    const updated = db.update('product_categories', id, updates);
    if (updates.name && updates.name !== current.name) {
      renameCategoryOnProducts(db, current.name, updates.name);
    }
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message || 'שגיאה' });
  }
});

app.delete('/api/product-categories/:id', requireOwner, (req, res) => {
  const { id } = req.params;
  const current = (db.get('product_categories') || []).find((c) => c.id === id);
  if (!current) return res.status(404).json({ error: 'קטגוריה לא נמצאה' });
  const deleted = db.delete('product_categories', id);
  if (!deleted) return res.status(404).json({ error: 'קטגוריה לא נמצאה' });
  res.json({ success: true, name: current.name });
});

// ─── iCount: status, clients, invoices, payments, webhook ───────────────────

function normalizePhone(phone) {
  return phone ? String(phone).replace(/[-\s]/g, '') : '';
}

async function syncParentToIcount(parent) {
  const { clientId } = await icount.ensureClient(parent);
  if (String(parent.icount_client_id || '') !== String(clientId)) {
    db.update('parents', parent.id, { icount_client_id: clientId });
    parent = { ...parent, icount_client_id: clientId };
  }
  return { parent, clientId };
}

function matchPendingPayment(payload) {
  const payments = db.get('payments') || [];
  const pending = payments.filter((p) => p.status === 'pending');
  if (!pending.length) return null;

  // Exact match from payment-page custom field / IPN query
  const paymentId =
    payload?.payment_id ||
    payload?.m__payment_id ||
    payload?.custom?.payment_id;
  if (paymentId) {
    const byId = pending.find((p) => String(p.id) === String(paymentId));
    if (byId) return byId;
    // Also allow matching already-paid rows for idempotent retries
    const any = payments.find((p) => String(p.id) === String(paymentId));
    if (any) return any;
  }

  const customId =
    payload?.client?.custom_client_id ||
    payload?.custom_client_id ||
    payload?.client_custom_id;
  if (customId) {
    const byParent = pending.find((p) => String(p.parent_id) === String(customId));
    if (byParent) return byParent;
  }

  const clientId =
    payload?.client?.client_id ||
    payload?.client_id ||
    payload?.clientid ||
    payload?.customer_id;
  if (clientId) {
    const byClient = pending.find((p) => String(p.icount_client_id) === String(clientId));
    if (byClient) return byClient;
  }

  const phone = normalizePhone(
    payload?.client?.phone ||
    payload?.client?.mobile ||
    payload?.phone ||
    payload?.contact_phone ||
    payload?.customer_phone
  );
  const total = Number(
    payload?.totalwithvat ??
    payload?.total ??
    payload?.sum ??
    payload?.paid ??
    NaN
  );

  if (phone) {
    const parents = db.get('parents') || [];
    const parent = parents.find((p) => normalizePhone(p.phone) === phone);
    if (parent) {
      const byPhone = pending
        .filter((p) => p.parent_id === parent.id)
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      if (!Number.isNaN(total)) {
        const exact = byPhone.find((p) => Math.abs(Number(p.amount) - total) < 0.01);
        if (exact) return exact;
      }
      if (byPhone[0]) return byPhone[0];
    }
  }

  if (!Number.isNaN(total)) {
    const byAmount = pending
      .filter((p) => Math.abs(Number(p.amount) - total) < 0.01)
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    if (byAmount[0]) return byAmount[0];
  }

  return null;
}

/** Normalize iCount document webhook OR payment-page IPN payloads. */
function normalizeIcountNotifyPayload(raw = {}, query = {}) {
  const payload = { ...raw };
  if (query.payment_id && !payload.payment_id) payload.payment_id = query.payment_id;
  // IPN echoes m__* custom fields without the prefix
  if (payload.payment_id == null && raw.m__payment_id != null) {
    payload.payment_id = raw.m__payment_id;
  }

  const docId =
    payload.doc_id != null
      ? String(payload.doc_id)
      : payload.docid != null
        ? String(payload.docid)
        : payload?.doc?.doc_id != null
          ? String(payload.doc.doc_id)
          : null;
  const docnum =
    payload.docnum != null
      ? String(payload.docnum)
      : payload?.doc?.docnum != null
        ? String(payload.doc.docnum)
        : null;
  const doctype =
    payload.doctype ||
    payload.doc_type ||
    payload?.doc?.doctype ||
    null;

  return { payload, docId, docnum, doctype };
}

async function resolveCcClearing({ payload, doctype, docnum } = {}) {
  let clearing = icount.extractCcClearing(payload || {});
  if (clearing.cc_confirmation_code || !docnum || !icount.isConfigured()) {
    return clearing;
  }
  try {
    const info = await icount.getDocInfo({
      doctype: doctype || 'invrec',
      docnum,
    });
    clearing = icount.extractCcClearing(info);
  } catch (err) {
    console.warn('⚠️ [iCount] clearing lookup failed:', err.message);
  }
  return clearing;
}

function clearingPatch(clearing = {}) {
  if (!clearing?.cc_confirmation_code && !clearing?.cc_last4 && !clearing?.cc_card_type) {
    return null;
  }
  return {
    cc_confirmation_code: clearing.cc_confirmation_code || null,
    cc_last4: clearing.cc_last4 || null,
    cc_card_type: clearing.cc_card_type || null,
  };
}

async function persistClearingOnPaymentAndSale({ payment, sale, clearing } = {}) {
  const patch = clearingPatch(clearing);
  if (!patch) return { payment, sale };

  let nextPayment = payment;
  let nextSale = sale;
  if (payment?.id) {
    nextPayment = db.update('payments', payment.id, {
      ...patch,
      updated_at: new Date().toISOString(),
    });
    if (nextPayment) await persistCore('payments', nextPayment);
  }
  if (sale?.id) {
    nextSale = db.update('pos_sales', sale.id, {
      ...patch,
      updated_at: new Date().toISOString(),
    });
    if (nextSale) await persistCore('pos_sales', nextSale);
  }
  return { payment: nextPayment || payment, sale: nextSale || sale };
}

app.get('/api/icount/status', async (req, res) => {
  if (!icount.isConfigured()) {
    return res.json({ ok: false, configured: false, message: 'חסר אסימון iCount בהגדרות השרת' });
  }
  try {
    const result = await icount.ping();
    res.json({ ok: true, configured: true, ...result });
  } catch (err) {
    res.status(502).json({
      ok: false,
      configured: true,
      message: err.message,
      code: err.code,
    });
  }
});

app.post('/api/icount/sync-client/:parentId', async (req, res) => {
  try {
    if (!icount.isConfigured()) {
      return res.status(503).json({ error: 'iCount לא מוגדר בשרת' });
    }
    const parent = db.getOne('parents', req.params.parentId);
    if (!parent) return res.status(404).json({ error: 'הורה לא נמצא' });
    const synced = await syncParentToIcount(parent);
    res.json({
      success: true,
      parentId: synced.parent.id,
      icount_client_id: synced.clientId,
      parent: synced.parent,
    });
  } catch (err) {
    console.error('iCount sync-client error:', err.message);
    res.status(502).json({ error: err.message, code: err.code });
  }
});

app.post('/api/icount/invoice', async (req, res) => {
  try {
    if (!icount.isConfigured()) {
      return res.status(503).json({ error: 'iCount לא מוגדר בשרת' });
    }
    const {
      parentId,
      studentId,
      studentName,
      amount,
      description,
      phone,
    } = req.body || {};

    if (!amount || !description) {
      return res.status(400).json({ error: 'חסרים סכום או תיאור' });
    }

    let parent = parentId ? db.getOne('parents', parentId) : null;
    if (!parent && studentId) {
      const student = db.getOne('students', studentId);
      if (student?.parentId) parent = db.getOne('parents', student.parentId);
    }
    if (!parent) {
      parent = {
        id: parentId || `temp-${Date.now()}`,
        name: studentName || 'לקוח',
        phone: phone || '',
        email: '',
      };
    }

    const { parent: syncedParent, clientId } = parentId || parent.id
      ? await syncParentToIcount(parent)
      : { parent, clientId: null };

    const doc = await icount.createInvRec({
      clientId,
      clientName: syncedParent.name || studentName,
      items: [{ description, unitprice: Number(amount), quantity: 1 }],
      comment: studentName ? `עבור: ${studentName}` : undefined,
      paymentMethod: 'cash',
    });

    const payment = db.insert('payments', {
      parent_id: syncedParent.id || null,
      student_id: studentId || null,
      amount: Number(amount),
      description,
      status: 'paid',
      payment_url: null,
      icount_client_id: clientId,
      icount_doc_id: doc.docId,
      icount_doc_number: doc.docnum,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    res.status(201).json({
      success: true,
      payment,
      docId: doc.docId,
      docNumber: doc.docnum,
    });
  } catch (err) {
    console.error('iCount invoice error:', err.message);
    res.status(502).json({ error: err.message, code: err.code });
  }
});

app.get('/api/icount/docs', async (req, res) => {
  try {
    if (!icount.isConfigured()) {
      return res.status(503).json({ error: 'iCount לא מוגדר בשרת' });
    }
    const docs = await icount.searchDocs({
      startDate: req.query.start,
      endDate: req.query.end,
    });
    const total = docs.reduce((sum, d) => {
      const n = Number(d.totalwithvat ?? d.total ?? d.sum ?? 0);
      return sum + (Number.isNaN(n) ? 0 : n);
    }, 0);
    res.json({ docs, total, count: docs.length });
  } catch (err) {
    console.error('iCount docs error:', err.message);
    res.status(502).json({ error: err.message, code: err.code });
  }
});

app.get('/api/payments', async (req, res) => {
  try {
    let rows = null;
    if (supa.isEnabled()) {
      rows = await supa.getAll('payments');
      if (rows) db.set('payments', rows);
    }
    let payments = rows || db.get('payments') || [];
    if (req.query.studentId) {
      payments = payments.filter((p) => p.student_id === req.query.studentId);
    }
    if (req.query.parentId) {
      payments = payments.filter((p) => p.parent_id === req.query.parentId);
    }
    payments = [...payments].sort((a, b) =>
      String(b.created_at || '').localeCompare(String(a.created_at || ''))
    );
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/icount/webhook', async (req, res) => {
  try {
    const expectedSecret = (process.env.ICOUNT_WEBHOOK_SECRET || '').trim();
    if (!expectedSecret && process.env.NODE_ENV === 'production') {
      return res.status(503).json({ ok: false, error: 'webhook secret is not configured' });
    }
    const incoming =
      req.get('X-iCount-Secret') ||
      req.get('x-icount-secret') ||
      req.query?.secret ||
      '';
    if (expectedSecret && String(incoming) !== expectedSecret) {
      console.warn('⛔ [iCount webhook] rejected — bad or missing secret');
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }

    const { payload, docId, docnum, doctype } = normalizeIcountNotifyPayload(
      req.body || {},
      req.query || {}
    );
    console.log(
      '📩 [iCount webhook] payment/document notify',
      doctype ? `doctype=${doctype}` : '',
      docnum ? `docnum=${docnum}` : ''
    );

    let payment = matchPendingPayment(payload);

    // Also match by existing doc id (idempotent)
    if (!payment && docId) {
      payment = (db.get('payments') || []).find(
        (p) => String(p.icount_doc_id) === String(docId)
      );
    }
    if (!payment && docnum) {
      payment = (db.get('payments') || []).find(
        (p) => String(p.icount_doc_number) === String(docnum)
      );
    }

    if (payment) {
      const clearing = await resolveCcClearing({
        payload,
        doctype: doctype || payment.icount_doctype || 'invrec',
        docnum: docnum || payment.icount_doc_number,
      });
      const clearFields = clearingPatch(clearing) || {};

      const updated = db.update('payments', payment.id, {
        status: 'paid',
        icount_doc_id: docId || payment.icount_doc_id,
        icount_doc_number: docnum || payment.icount_doc_number,
        icount_doctype: doctype || payment.icount_doctype || null,
        icount_doc_url:
          payload.doc_url ||
          payload.docurl ||
          payload?.doc?.doc_url ||
          payload?.doc?.docurl ||
          payment.icount_doc_url ||
          null,
        ...clearFields,
        paid_at: payment.paid_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (updated) await persistCore('payments', updated);

      // Fulfill POS sale passes / inventory when payment-link completes
      if (payment.pos_sale_id) {
        const sale = db.getOne('pos_sales', payment.pos_sale_id);
        if (sale && sale.status !== 'paid') {
          const lines = mapCartLines(
            (sale.items || []).map((line) => ({
              ...line,
              pricelist_id: line.pricelist_id,
              quantity: line.quantity,
              unitprice: line.unitprice,
            }))
          );
          fulfillSalePasses({
            sale,
            lines,
            studentId: sale.student_id,
            parentId: sale.parent_id,
            docId: docId || payment.icount_doc_id,
            docNumber: docnum || payment.icount_doc_number,
          });
          decrementInventory(lines);
          const docUrl =
            updated?.icount_doc_url ||
            payload.doc_url ||
            payload.docurl ||
            payload?.doc?.doc_url ||
            payload?.doc?.docurl ||
            sale.icount_doc_url ||
            null;
          const paidSale = db.update('pos_sales', sale.id, {
            status: 'paid',
            icount_doc_id: docId || sale.icount_doc_id,
            icount_doc_number: docnum || sale.icount_doc_number,
            icount_doctype: doctype || sale.icount_doctype || 'invrec',
            icount_doc_url: docUrl,
            payment_url: sale.payment_url || payment.payment_url || null,
            ...clearFields,
            updated_at: new Date().toISOString(),
          });
          if (paidSale) await persistCore('pos_sales', paidSale);
        } else if (sale?.id && Object.keys(clearFields).length) {
          const patchedSale = db.update('pos_sales', sale.id, {
            ...clearFields,
            icount_doc_id: docId || sale.icount_doc_id,
            icount_doc_number: docnum || sale.icount_doc_number,
            icount_doctype: doctype || sale.icount_doctype || 'invrec',
            updated_at: new Date().toISOString(),
          });
          if (patchedSale) await persistCore('pos_sales', patchedSale);
        }
      }

      // Mark linked activity registration paid (public event page)
      if (payment.activity_registration_id) {
        const reg = db.getOne('activity_registrations', payment.activity_registration_id);
        if (reg && reg.payment_status !== 'paid') {
          db.update('activity_registrations', reg.id, {
            payment_status: 'paid',
            paid_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }
      }
      if (payment.activity_registration_order_id) {
        await markRegistrationOrderPaid({
          db,
          persist: persistCore,
          orderId: payment.activity_registration_order_id,
          paidAt: updated?.paid_at,
        });
      }
      if (payment.activity_host_payment && payment.activity_id) {
        await markHostedActivityPaid({
          db,
          persist: persistCore,
          activityId: payment.activity_id,
          paymentId: payment.id,
          paidAt: updated?.paid_at,
        });
      }

      if (payment.equipment_payment && payment.student_id) {
        const itemTypes = Array.isArray(payment.equipment_item_types)
          ? payment.equipment_item_types
          : [];
        const settings = await loadEquipmentSettings();
        markEquipmentItemsPaid({
          db,
          persist: persistCore,
          studentId: payment.student_id,
          itemTypes,
          shirtSize: payment.equipment_shirt_size || null,
          paymentId: payment.id,
          rentalDays: payment.equipment_rental_days || settings.rental_days,
          paidAt: updated?.paid_at || new Date().toISOString(),
        });
      }

      return res.json({
        ok: true,
        matched: true,
        paymentId: updated?.id,
        doctype: doctype || null,
        docnum: docnum || null,
      });
    }

    // Create a paid record from webhook if we can resolve a parent
    const customId =
      payload?.client?.custom_client_id ||
      payload?.custom_client_id;
    const parent = customId ? db.getOne('parents', customId) : null;
    const amount = Number(
      payload?.totalwithvat ?? payload?.total ?? payload?.sum ?? 0
    );
    const description =
      payload?.description ||
      payload?.comment ||
      payload?.cd ||
      (Array.isArray(payload?.items) && payload.items[0]?.desc) ||
      'תשלום iCount';

    if (parent || docId || docnum) {
      const created = db.insert('payments', {
        parent_id: parent?.id || null,
        student_id: null,
        amount: Number.isNaN(amount) ? 0 : amount,
        description,
        status: 'paid',
        payment_url: null,
        icount_client_id:
          payload?.client?.client_id ||
          payload?.customer_id ||
          parent?.icount_client_id ||
          null,
        icount_doc_id: docId,
        icount_doc_number: docnum,
        icount_doctype: doctype || null,
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      return res.json({ ok: true, matched: false, created: true, paymentId: created.id });
    }

    res.json({ ok: true, matched: false, created: false });
  } catch (err) {
    console.error('iCount webhook error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// iCount payment request: sync client + pending payment + WhatsApp link
// After the customer pays on the payment page, iCount issues the configured
// document (חשבונית מס קבלה) and notifies us via IPN → webhook.
app.post('/api/checkout/payment-request', async (req, res) => {
  const { studentId, studentName, amount, description, phone, parentId } = req.body || {};
  console.log(`💳 [iCount] Payment request for ${studentName} (${amount}₪) - "${description}"`);

  if (!amount || !description) {
    return res.status(400).json({ error: 'חסרים סכום או תיאור' });
  }

  let parent = parentId ? db.getOne('parents', parentId) : null;
  if (!parent && studentId) {
    const student = db.getOne('students', studentId);
    if (student?.parentId) parent = db.getOne('parents', student.parentId);
  }

  let clientId = parent?.icount_client_id || null;
  let syncWarning = null;
  if (parent && icount.isConfigured()) {
    try {
      const synced = await syncParentToIcount(parent);
      parent = synced.parent;
      clientId = synced.clientId;
    } catch (err) {
      syncWarning = err.message;
      console.warn('iCount client sync failed, continuing with payment link:', err.message);
    }
  }

  const payName = parent?.name || studentName || 'מטפס';
  const cleanPhone = normalizePhone(phone || parent?.phone);

  // Create pending payment first so we can embed its id in the IPN / URL
  const payment = db.insert('payments', {
    parent_id: parent?.id || null,
    student_id: studentId || null,
    amount: Number(amount),
    description,
    status: 'pending',
    payment_url: null,
    icount_client_id: clientId,
    icount_doc_id: null,
    icount_doc_number: null,
    icount_doctype: null,
    paid_at: null,
    updated_at: new Date().toISOString(),
  });

  const ipnUrl = icount.buildIpnUrl({ paymentId: payment.id });
  const payUrl = await icount.buildPaymentUrl({
    amount,
    description: description || 'חוג טיפוס קיר',
    name: payName,
    phone: cleanPhone,
    email: parent?.email || '',
    paymentId: payment.id,
    ipnUrl,
  });

  const updatedPayment = db.update('payments', payment.id, {
    payment_url: payUrl,
    updated_at: new Date().toISOString(),
  });

  const waMsg = `שלום! להלן קישור מאובטח לתשלום עבור ${description} בסך ${amount} ש״ח:\n${payUrl}\n\nלאחר התשלום תופק חשבונית מס קבלה אוטומטית.`;
  let whatsappSent = false;
  try {
    if (cleanPhone) {
      await whatsappService.sendTextMessage(cleanPhone, waMsg);
      whatsappSent = true;
    }
  } catch (waErr) {
    console.error('Failed to send payment link via WhatsApp:', waErr.message);
  }

  res.json({
    success: true,
    paymentUrl: payUrl,
    payment: updatedPayment || payment,
    whatsappSent,
    autoInvoice: true,
    syncWarning,
    message: 'נוצר קישור תשלום. לאחר התשלום תופק חשבונית מס קבלה באייקאונט',
  });
});

// Shift management (Clock in/out)
app.get('/api/shifts', (req, res) => {
  res.json(db.get('shift_hours'));
});

app.post('/api/shifts/clock-in', (req, res) => {
  const { employeeId, activityType, notes } = req.body;
  const shift = db.clockIn(employeeId, activityType, notes);
  res.json(shift);
});

app.post('/api/shifts/clock-out', (req, res) => {
  const { employeeId, notes } = req.body;
  const shift = db.clockOut(employeeId, notes);
  if (!shift) return res.status(404).json({ error: 'No active open shift found for this employee' });
  res.json(shift);
});

app.post('/api/shifts/approve', (req, res) => {
  const { shiftIds } = req.body;
  const approved = db.approveShifts(shiftIds);
  res.json({ success: approved });
});

// Employees list management
// Prefer the durable Supabase roster (38 real trainers, ids like "e-7") so the
// trainer dropdown and group.trainer_id references resolve correctly. Falls
// back to the local db.json seed if Supabase is unavailable.
app.get('/api/trainers', (req, res) => {
  let employees = db.get('employees') || [];
  res.json(employees
    .filter((employee) => employee.is_active !== false && employee.active !== false)
    .map((employee) => ({
      id: employee.id,
      name: employee.name || '',
      role: employee.role || 'trainer',
    })));
});

app.get('/api/employees', (req, res) => {
  res.json(db.get('employees'));
});

app.post('/api/employees', (req, res) => {
  const employee = db.insert('employees', req.body);
  res.status(201).json(employee);
});

app.put('/api/employees/:id', (req, res) => {
  const { id } = req.params;
  const updated = db.update('employees', id, req.body);
  if (!updated) return res.status(404).json({ error: 'Employee not found' });
  res.json(updated);
});

const EMPLOYEE_DOC_TYPES = {
  contract: 'חוזה העסקה',
  police: 'אישור משטרה',
  certificates: 'תעודות רלוונטיות',
  idPhoto: 'צילום תעודת זהות',
  form101: 'טופס 101',
};

const EMPLOYEE_DOC_FLAG = {
  contract: 'contractSigned',
  police: 'policeClearance',
  certificates: 'hasCertificates',
  idPhoto: 'hasIdPhoto',
  form101: 'hasForm101',
};

function extFromMime(mimeType = '', fileName = '') {
  const fromName = String(fileName).split('.').pop();
  if (fromName && fromName.length <= 5 && fromName !== fileName) return fromName.toLowerCase();
  if (mimeType.includes('pdf')) return 'pdf';
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('gif')) return 'gif';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  if (mimeType.includes('wordprocessingml')) return 'docx';
  if (mimeType.includes('msword')) return 'doc';
  return 'bin';
}

app.post('/api/employees/:id/documents', async (req, res) => {
  const emp = (db.get('employees') || []).find((e) => e.id === req.params.id);
  if (!emp) return res.status(404).json({ error: 'העובד לא נמצא' });

  const { docType, fileBase64, fileName, mimeType } = req.body || {};
  if (!EMPLOYEE_DOC_TYPES[docType]) {
    return res.status(400).json({ error: 'סוג מסמך לא תקין' });
  }
  if (!fileBase64 || typeof fileBase64 !== 'string') {
    return res.status(400).json({ error: 'חסר קובץ' });
  }

  const raw = fileBase64.includes(',') ? fileBase64.split(',')[1] : fileBase64;
  let buffer;
  try {
    buffer = Buffer.from(raw, 'base64');
  } catch {
    return res.status(400).json({ error: 'קובץ לא תקין' });
  }
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) {
    return res.status(400).json({ error: 'גודל הקובץ לא תקין' });
  }

  const safeMime = String(mimeType || 'application/pdf').slice(0, 120);
  const safeName = String(fileName || `${docType}.${extFromMime(safeMime, fileName)}`)
    .replace(/[^\w\u0590-\u05ff.\-]+/g, '_')
    .slice(0, 120);
  const ext = extFromMime(safeMime, safeName);
  const storagePath = `${emp.id}/${docType}_${Date.now()}.${ext}`;

  const prev = emp.documents?.[docType];
  if (prev?.storagePath) {
    await supa.removeEmployeeDocument(prev.storagePath);
  }

  const uploaded = await supa.uploadEmployeeDocument(storagePath, buffer, safeMime);
  if (!uploaded.ok) {
    return res.status(500).json({ error: uploaded.error || 'שמירת הקובץ נכשלה' });
  }

  const docMeta = {
    fileName: safeName,
    storagePath,
    mimeType: safeMime,
    uploadedAt: new Date().toISOString(),
  };
  const documents = { ...(emp.documents || {}), [docType]: docMeta };
  const flag = EMPLOYEE_DOC_FLAG[docType];
  const updated = db.update('employees', emp.id, {
    documents,
    ...(flag ? { [flag]: true } : {}),
  });
  await persistCore('employees', updated);
  res.json({ success: true, document: docMeta, employee: updated });
});

app.delete('/api/employees/:id/documents/:docType', async (req, res) => {
  const emp = (db.get('employees') || []).find((e) => e.id === req.params.id);
  if (!emp) return res.status(404).json({ error: 'העובד לא נמצא' });

  const { docType } = req.params;
  if (!EMPLOYEE_DOC_TYPES[docType]) {
    return res.status(400).json({ error: 'סוג מסמך לא תקין' });
  }

  const prev = emp.documents?.[docType];
  if (prev?.storagePath) {
    await supa.removeEmployeeDocument(prev.storagePath);
  }

  const documents = { ...(emp.documents || {}) };
  delete documents[docType];
  const flag = EMPLOYEE_DOC_FLAG[docType];
  const updated = db.update('employees', emp.id, {
    documents,
    ...(flag ? { [flag]: false } : {}),
  });
  await persistCore('employees', updated);
  res.json({ success: true, employee: updated });
});

app.get('/api/employees/:id/documents/:docType/download', async (req, res) => {
  const emp = (db.get('employees') || []).find((e) => e.id === req.params.id);
  if (!emp) return res.status(404).json({ error: 'העובד לא נמצא' });

  const { docType } = req.params;
  const doc = emp.documents?.[docType];
  if (!doc?.storagePath) return res.status(404).json({ error: 'מסמך לא נמצא' });

  const downloaded = await supa.downloadEmployeeDocument(doc.storagePath);
  if (!downloaded.ok || !downloaded.blob) {
    return res.status(500).json({ error: downloaded.error || 'הורדה נכשלה' });
  }

  const arrayBuffer = await downloaded.blob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  res.setHeader('Content-Type', doc.mimeType || 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(doc.fileName || `${docType}.bin`)}`
  );
  res.send(buffer);
});

// Wage agreements management
app.get('/api/wages', (req, res) => {
  res.json(db.get('wage_agreements'));
});

app.post('/api/wages', (req, res) => {
  const { employee_id } = req.body || {};
  if (!employee_id) return res.status(400).json({ error: 'employee_id is required' });

  // One agreement per employee: reuse the existing row instead of creating a duplicate.
  const existing = (db.get('wage_agreements') || []).find((w) => w.employee_id === employee_id);
  if (existing) {
    const updated = db.update('wage_agreements', existing.id, { ...req.body, id: existing.id });
    return res.json(updated);
  }

  const created = db.insert('wage_agreements', req.body);
  res.status(201).json(created);
});

app.put('/api/wages/:id', (req, res) => {
  const { id } = req.params;
  const updated = db.update('wage_agreements', id, req.body);
  if (!updated) return res.status(404).json({ error: 'Wage agreement not found' });
  res.json(updated);
});

// ─── Work assignments (pay segments per employee) ────────────────────────────
const WORK_TYPES = ['counter_shift', 'class_shift', 'private_shift', 'route_building_shift'];

function activityTypeToWorkType(activityType) {
  if (activityType === 'route_building') return 'route_building_shift';
  return 'counter_shift';
}

function parseHmToMinutes(hm) {
  if (!hm || typeof hm !== 'string') return null;
  const m = hm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function minutesToHm(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Round work hours to nearest quarter-hour (matches UI step=0.25). */
function roundHoursQuarter(h) {
  const n = Number(h);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 4) / 4;
}

function hoursBetweenHm(startHm, endHm) {
  const a = parseHmToMinutes(startHm);
  const b = parseHmToMinutes(endHm);
  if (a == null || b == null || b <= a) return 0;
  return roundHoursQuarter((b - a) / 60);
}

function israelLocalParts(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hm: `${get('hour')}:${get('minute')}`,
    minutes: parseHmToMinutes(`${get('hour')}:${get('minute')}`),
  };
}

function suggestHoursFromClock(employeeId, dateStr, eventStartHm, eventEndHm) {
  const shifts = (db.get('shift_hours') || []).filter((s) => s.employee_id === employeeId && s.clock_in);
  let best = null;
  for (const shift of shifts) {
    const cin = israelLocalParts(shift.clock_in);
    if (!cin || cin.date !== dateStr) continue;
    const cout = shift.clock_out ? israelLocalParts(shift.clock_out) : null;
    const shiftStart = cin.minutes;
    const shiftEnd = cout?.minutes ?? shiftStart;
    if (shiftEnd <= shiftStart) continue;

    const evStart = parseHmToMinutes(eventStartHm);
    const evEnd = parseHmToMinutes(eventEndHm);
    let startMin = shiftStart;
    let endMin = shiftEnd;
    let source = 'clock';

    if (evStart != null && evEnd != null && evEnd > evStart) {
      const overlapStart = Math.max(shiftStart, evStart);
      const overlapEnd = Math.min(shiftEnd, evEnd);
      if (overlapEnd > overlapStart) {
        startMin = overlapStart;
        endMin = overlapEnd;
      } else {
        // No overlap — use full clock duration for that day
        source = 'clock';
      }
    }

    const hours = roundHoursQuarter((endMin - startMin) / 60);
    if (!best || hours > best.hours) {
      best = {
        start_time: minutesToHm(startMin),
        end_time: minutesToHm(endMin),
        hours,
        source,
        shift_id: shift.id,
      };
    }
  }
  return best;
}

function normalizeWorkAssignment(body = {}, { existing = null } = {}) {
  const workType = WORK_TYPES.includes(body.work_type)
    ? body.work_type
    : (existing?.work_type || 'counter_shift');
  let startTime = body.start_time ?? existing?.start_time ?? null;
  let endTime = body.end_time ?? existing?.end_time ?? null;
  let hours = body.hours;
  if (hours === undefined || hours === null || hours === '') {
    hours = hoursBetweenHm(startTime, endTime);
  } else {
    hours = roundHoursQuarter(hours);
  }
  return {
    employee_id: body.employee_id || existing?.employee_id || null,
    activity_id: body.activity_id !== undefined ? (body.activity_id || null) : (existing?.activity_id ?? null),
    date: body.date || existing?.date || null,
    work_type: workType,
    start_time: startTime,
    end_time: endTime,
    hours,
    source: body.source || existing?.source || 'manual',
    shift_id: body.shift_id !== undefined ? (body.shift_id || null) : (existing?.shift_id ?? null),
    approved: body.approved !== undefined ? !!body.approved : !!(existing?.approved),
    notes: body.notes !== undefined ? (body.notes || '') : (existing?.notes || ''),
  };
}

app.get('/api/work-assignments', (req, res) => {
  let rows = db.get('work_assignments') || [];
  const { from, to, employee_id, activity_id } = req.query;
  if (employee_id) rows = rows.filter((r) => r.employee_id === employee_id);
  if (activity_id) rows = rows.filter((r) => r.activity_id === activity_id);
  if (from) rows = rows.filter((r) => r.date && r.date >= from);
  if (to) rows = rows.filter((r) => r.date && r.date <= to);
  rows = [...rows].sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))
    || String(a.start_time || '').localeCompare(String(b.start_time || '')));
  res.json(rows);
});

app.post('/api/work-assignments/from-activity', (req, res) => {
  const { activity_id, employee_ids } = req.body || {};
  if (!activity_id) return res.status(400).json({ error: 'activity_id is required' });
  const activity = db.getOne('activities', activity_id);
  if (!activity) return res.status(404).json({ error: 'Activity not found' });
  if (!activity.date) return res.status(400).json({ error: 'Activity has no date' });

  const ids = Array.isArray(employee_ids)
    ? employee_ids.filter(Boolean)
    : [];
  if (!ids.length) return res.status(400).json({ error: 'employee_ids is required' });

  const workType = activityTypeToWorkType(activity.type);
  const eventStart = activity.start_time || '09:00';
  const eventEnd = activity.end_time || '17:00';
  const eventHours = hoursBetweenHm(eventStart, eventEnd) || 2;
  const existing = (db.get('work_assignments') || []).filter((r) => r.activity_id === activity_id);
  const created = [];

  for (const employeeId of ids) {
    if (existing.some((r) => r.employee_id === employeeId)) continue;
    const suggestion = suggestHoursFromClock(employeeId, activity.date, eventStart, eventEnd);
    const row = db.insert('work_assignments', {
      employee_id: employeeId,
      activity_id,
      date: activity.date,
      work_type: workType,
      start_time: suggestion?.start_time || eventStart,
      end_time: suggestion?.end_time || eventEnd,
      hours: suggestion?.hours || eventHours,
      source: suggestion ? suggestion.source : 'calendar',
      shift_id: suggestion?.shift_id || null,
      approved: false,
      notes: '',
    });
    created.push(row);
  }

  res.status(201).json({ created, existing_count: existing.length });
});

app.post('/api/work-assignments/approve', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ error: 'ids is required' });
  const updated = [];
  for (const id of ids) {
    const row = db.getOne('work_assignments', id);
    if (!row) continue;
    updated.push(db.update('work_assignments', id, { approved: true }));
  }
  res.json({ success: true, updated });
});

app.post('/api/work-assignments', (req, res) => {
  const normalized = normalizeWorkAssignment(req.body || {});
  if (!normalized.employee_id) return res.status(400).json({ error: 'employee_id is required' });
  if (!normalized.date) return res.status(400).json({ error: 'date is required' });
  const created = db.insert('work_assignments', normalized);
  res.status(201).json(created);
});

app.put('/api/work-assignments/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.getOne('work_assignments', id);
  if (!existing) return res.status(404).json({ error: 'Work assignment not found' });
  const normalized = normalizeWorkAssignment(req.body || {}, { existing });
  const updated = db.update('work_assignments', id, normalized);
  res.json(updated);
});

app.delete('/api/work-assignments/:id', (req, res) => {
  const { id } = req.params;
  const ok = db.delete('work_assignments', id);
  if (!ok) return res.status(404).json({ error: 'Work assignment not found' });
  res.json({ success: true });
});

// Safety check types, inspections & incidents
app.get('/api/safety/check-types', (req, res) => {
  const includeInactive = req.query.includeInactive === '1' || req.query.includeInactive === 'true';
  res.json(db.getSafetyCheckTypes({ includeInactive }));
});

app.post('/api/safety/check-types', (req, res) => {
  const record = db.createSafetyCheckType(req.body || {});
  if (record?.error) return res.status(400).json(record);
  res.status(201).json(record);
});

app.put('/api/safety/check-types/:id', (req, res) => {
  const updated = db.updateSafetyCheckType(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'בדיקה לא נמצאה' });
  res.json(updated);
});

app.delete('/api/safety/check-types/:id', (req, res) => {
  const updated = db.softDeleteSafetyCheckType(req.params.id);
  if (!updated) return res.status(404).json({ error: 'בדיקה לא נמצאה' });
  res.json(updated);
});

app.get('/api/safety/due-today', (req, res) => {
  const date = req.query.date || undefined;
  res.json(db.getSafetyDueToday(date));
});

app.get('/api/safety/inspections', (req, res) => {
  let logs = db.get('safety_inspections') || [];
  if (req.query.checkTypeId) {
    logs = logs.filter((l) => l.check_type_id === req.query.checkTypeId);
  }
  if (req.query.date) {
    logs = logs.filter((l) => l.date === req.query.date);
  }
  res.json(logs);
});

app.post('/api/safety/inspections', (req, res) => {
  try {
    const body = req.body || {};
    if (!body.completed_by_employee_id && !body.tester_name && !body.testerName) {
      return res.status(400).json({ error: 'נא לבחור את שם הבודק' });
    }
    const record = db.insertSafetyInspection(body);
    return res.status(201).json(record);
  } catch (err) {
    console.error('POST /api/safety/inspections failed:', err);
    return res.status(500).json({ error: 'שגיאה בשמירת הבדיקה בשרת' });
  }
});

app.get('/api/safety/incidents', (req, res) => {
  res.json(db.get('safety_incidents'));
});

app.post('/api/safety/incidents', (req, res) => {
  const record = db.insertSafetyIncident(req.body);
  res.status(201).json(record);
});

// Level Tests history
app.get('/api/level-tests', (req, res) => {
  res.json(db.get('level_tests'));
});

app.post('/api/level-tests', (req, res) => {
  const record = db.insertLevelTest(req.body);
  res.status(201).json(record);
});

// Cash Register endpoints
app.get('/api/cash-register', (req, res) => {
  res.json(db.get('cash_register_shifts'));
});

app.post('/api/cash-register', (req, res) => {
  const record = db.insert('cash_register_shifts', req.body);
  res.status(201).json(record);
});

// ─── POS: sales, quotes, punch cards ────────────────────────────────────────

function resolvePosCustomer({ studentId, parentId, walkInName, walkInPhone, walkInEmail }) {
  let student = studentId ? db.getOne('students', studentId) : null;
  let parent = parentId ? db.getOne('parents', parentId) : null;
  if (!parent && student?.parentId) parent = db.getOne('parents', student.parentId);

  let isNewLead = false;
  if (!parent && (walkInName || walkInPhone)) {
    const name = String(walkInName || '').trim() || 'לקוח מדלפק';
    const phone = String(walkInPhone || '').trim();
    const email = String(walkInEmail || '').trim();

    // If phone matches an existing card — reuse it (do not reset status to lead).
    const existingByPhone = phone
      ? (db.get('parents') || []).find((p) => parentPhonesMatch(p.phone, phone))
      : null;

    if (existingByPhone) {
      const patch = {};
      if (email && !existingByPhone.email) patch.email = email;
      if (
        name &&
        name !== 'לקוח מדלפק' &&
        (!existingByPhone.name ||
          existingByPhone.name === 'לקוח וואטסאפ' ||
          existingByPhone.name === 'ליד מאינסטגרם')
      ) {
        patch.name = name;
      }
      parent = Object.keys(patch).length
        ? db.update('parents', existingByPhone.id, patch) || existingByPhone
        : existingByPhone;
    } else {
      parent = db.upsertParentByPhone(name, phone, email, {
        source: 'pos',
        channel: 'pos',
        status: 'lead_new',
      });
      isNewLead = true;
      try {
        automationsService.triggerEvent('new_lead', {
          id: parent.id,
          parentId: parent.id,
          phone: parent.phone || phone,
          parentName: parent.name || name,
          status: 'lead_new',
          source: 'pos',
        });
      } catch (err) {
        console.warn('POS new_lead automation skipped:', err.message);
      }
    }
  }

  return { student, parent, isNewLead };
}

function mapCartLines(cart) {
  return (cart || []).map((line) => {
    const fromCatalog = Boolean(line.pricelist_id);
    const item = fromCatalog
      ? enrichPricelistItem(db.getOne('pricelist', line.pricelist_id) || {})
      : enrichPricelistItem({
          ...line,
          product_type: line.product_type || 'product',
          track_inventory: false,
        });
    const quantity = Number(line.quantity) || 1;
    const unitprice = Number(line.unitprice ?? line.price ?? item.price) || 0;
    return {
      pricelist_id: fromCatalog ? (item.id || line.pricelist_id || null) : null,
      name: line.name || item.name || 'פריט',
      description: line.description || item.name || line.name || 'פריט',
      unitprice,
      quantity,
      product_type: normalizeProductType({ ...item, product_type: line.product_type || item.product_type }),
      visits_total: item.visits_total,
      validity_days: item.validity_days,
      duration_days: item.duration_days,
      track_inventory: fromCatalog && item.track_inventory === true,
      stock_qty: item.stock_qty,
      item,
    };
  });
}

function fulfillSalePasses({ sale, lines, studentId, parentId, docId, docNumber }) {
  const issued = [];
  for (const line of lines) {
    if (!requiresCustomer(line.product_type)) continue;
    if (!studentId) continue;
    const qty = Number(line.quantity) || 1;
    for (let i = 0; i < qty; i += 1) {
      const passFields = buildPassFromItem({
        item: {
          id: line.pricelist_id,
          name: line.name,
          product_type: line.product_type,
          visits_total: line.visits_total,
          validity_days: line.validity_days,
          duration_days: line.duration_days,
        },
        studentId,
        parentId,
        saleId: sale.id,
        docId,
        docNumber,
      });
      if (passFields) issued.push(db.insert('customer_passes', passFields));
    }
  }
  return issued;
}

function decrementInventory(lines) {
  for (const line of lines) {
    if (!line.pricelist_id || !line.track_inventory) continue;
    const current = db.getOne('pricelist', line.pricelist_id);
    if (!current) continue;
    const stock = Number(current.stock_qty);
    if (Number.isNaN(stock)) continue;
    const next = Math.max(0, stock - (Number(line.quantity) || 1));
    db.update('pricelist', line.pricelist_id, { stock_qty: next });
  }
}

function punchPass(pass, { punchedBy, source, note }) {
  if (!pass) {
    const err = new Error('כרטיסייה לא נמצאה');
    err.status = 404;
    throw err;
  }
  if (pass.pass_type !== PRODUCT_TYPES.PUNCH_CARD) {
    const err = new Error('אפשר לנקב רק כרטיסיית כניסות');
    err.status = 400;
    throw err;
  }
  if (!isPassUsable(pass)) {
    const err = new Error('הכרטיסייה לא פעילה או שנגמרו הניקובים');
    err.status = 400;
    throw err;
  }
  const before = Number(pass.visits_remaining);
  const after = before - 1;
  const updated = db.update('customer_passes', pass.id, {
    visits_remaining: after,
    status: after <= 0 ? 'depleted' : 'active',
    updated_at: new Date().toISOString(),
  });
  const punch = db.insert('pass_punches', {
    pass_id: pass.id,
    student_id: pass.student_id,
    punched_at: new Date().toISOString(),
    punched_by: punchedBy || null,
    source: source || 'manual',
    note: note || '',
    visits_before: before,
    visits_after: after,
  });
  return { pass: updated, punch };
}

app.get('/api/pos/sales', async (req, res) => {
  let sales = db.get('pos_sales') || [];
  if (req.crmUser?.role === 'staff') {
    const today = new Date().toISOString().slice(0, 10);
    sales = sales.filter(
      (s) =>
        String(s.sold_by || '') === String(req.crmUser.email || '') ||
        String(s.created_at || '').slice(0, 10) === today
    );
  }
  const payments = db.get('payments') || [];

  // Backfill clearing codes for a few recent paid card sales that lack them
  if (icount.isConfigured()) {
    const needsClearing = sales
      .filter(
        (s) =>
          s.status === 'paid' &&
          s.icount_doc_number &&
          !s.cc_confirmation_code &&
          ['online', 'emv', 'credit', 'cc', 'card'].includes(
            String(s.payment_method || '').toLowerCase()
          )
      )
      .slice(0, 3);
    for (const sale of needsClearing) {
      try {
        const clearing = await resolveCcClearing({
          doctype: sale.icount_doctype || 'invrec',
          docnum: sale.icount_doc_number,
        });
        const payment =
          (sale.payment_id && payments.find((p) => String(p.id) === String(sale.payment_id))) ||
          payments.find((p) => String(p.pos_sale_id) === String(sale.id)) ||
          null;
        const { sale: patched } = await persistClearingOnPaymentAndSale({
          payment,
          sale,
          clearing,
        });
        if (patched) {
          const idx = sales.findIndex((s) => String(s.id) === String(sale.id));
          if (idx >= 0) sales[idx] = { ...sales[idx], ...patched };
        }
      } catch (err) {
        console.warn('⚠️ [POS sales] clearing backfill failed:', err.message);
      }
    }
  }

  sales = [...sales]
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .map((sale) => {
      const payment =
        (sale.payment_id && payments.find((p) => String(p.id) === String(sale.payment_id))) ||
        payments.find((p) => String(p.pos_sale_id) === String(sale.id)) ||
        null;
      return {
        ...sale,
        payment_url: sale.payment_url || payment?.payment_url || null,
        icount_doc_url: sale.icount_doc_url || payment?.icount_doc_url || null,
        icount_doc_number: sale.icount_doc_number || payment?.icount_doc_number || null,
        icount_doc_id: sale.icount_doc_id || payment?.icount_doc_id || null,
        icount_doctype: sale.icount_doctype || payment?.icount_doctype || null,
        cc_confirmation_code:
          sale.cc_confirmation_code || payment?.cc_confirmation_code || null,
        cc_last4: sale.cc_last4 || payment?.cc_last4 || null,
        cc_card_type: sale.cc_card_type || payment?.cc_card_type || null,
      };
    });
  res.json(sales);
});

app.get('/api/pos/sales/:id/invoice', async (req, res) => {
  try {
    const sale = db.getOne('pos_sales', req.params.id);
    if (!sale) return res.status(404).json({ error: 'עסקה לא נמצאה' });

    if (req.crmUser?.role === 'staff') {
      const today = new Date().toISOString().slice(0, 10);
      const allowed =
        String(sale.sold_by || '') === String(req.crmUser.email || '') ||
        String(sale.created_at || '').slice(0, 10) === today;
      if (!allowed) {
        return res.status(403).json({ error: 'אין הרשאה להוריד חשבונית לעסקה זו' });
      }
    }

    const kind = String(req.query.kind || 'charge') === 'refund' ? 'refund' : 'charge';
    let url = kind === 'refund' ? sale.refund_doc_url : sale.icount_doc_url;
    let docnum = kind === 'refund' ? sale.refund_doc_number : sale.icount_doc_number;
    const doctype =
      kind === 'refund'
        ? sale.refund_doctype || sale.icount_doctype || 'invrec'
        : sale.icount_doctype || 'invrec';

    if (!url && kind === 'charge' && sale.icount_doc_id && icount.isConfigured()) {
      try {
        const info = await icount.getDoc(sale.icount_doc_id);
        url =
          info?.doc_url ||
          info?.docurl ||
          info?.doc?.doc_url ||
          info?.doc?.docurl ||
          null;
        if (url) {
          const updated = db.update('pos_sales', sale.id, {
            icount_doc_url: url,
            updated_at: new Date().toISOString(),
          });
          if (updated) await persistCore('pos_sales', updated);
        }
      } catch (err) {
        console.warn('⚠️ [POS invoice] charge url lookup failed:', err.message);
      }
    }

    if (!url && docnum && icount.isConfigured()) {
      try {
        const info = await icount.getDocInfo({ doctype, docnum });
        const docInfo = info.doc_info || info;
        url =
          docInfo?.doc_url ||
          docInfo?.docurl ||
          info?.doc_url ||
          info?.docurl ||
          null;
        if (url) {
          const patch =
            kind === 'refund'
              ? { refund_doc_url: url, updated_at: new Date().toISOString() }
              : { icount_doc_url: url, updated_at: new Date().toISOString() };
          const updated = db.update('pos_sales', sale.id, patch);
          if (updated) await persistCore('pos_sales', updated);
        }
      } catch (err) {
        console.warn('⚠️ [POS invoice] doc info url lookup failed:', err.message);
      }
    }

    if (!url) {
      return res.status(404).json({
        error:
          kind === 'refund'
            ? 'אין קישור להורדת מסמך הזיכוי'
            : 'אין קישור להורדת חשבונית החיוב',
      });
    }

    const upstream = await fetch(url);
    if (!upstream.ok) {
      return res.status(502).json({ error: 'הורדת המסמך ממערכת החיוב נכשלה' });
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    const contentType = upstream.headers.get('content-type') || 'application/pdf';
    const safeDoc = String(docnum || kind).replace(/[^\w.-]+/g, '_');
    const filename =
      kind === 'refund'
        ? `invoice-refund-${safeDoc}.pdf`
        : `invoice-charge-${safeDoc}.pdf`;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    console.error('POS invoice download error:', err.message);
    res.status(502).json({ error: err.message || 'הורדת המסמך נכשלה' });
  }
});

app.post('/api/pos/sales/:id/refund', async (req, res) => {
  try {
    if (!icount.isConfigured()) {
      return res.status(503).json({ error: 'iCount לא מוגדר בשרת' });
    }
    const sale = db.getOne('pos_sales', req.params.id);
    if (!sale) return res.status(404).json({ error: 'עסקה לא נמצאה' });

    if (req.crmUser?.role === 'staff') {
      const today = new Date().toISOString().slice(0, 10);
      const allowed =
        String(sale.sold_by || '') === String(req.crmUser.email || '') ||
        String(sale.created_at || '').slice(0, 10) === today;
      if (!allowed) {
        return res.status(403).json({ error: 'אין הרשאה לזכות עסקה זו' });
      }
    }

    if (sale.status === 'refunded' || sale.status === 'cancelled') {
      return res.status(400).json({ error: 'העסקה כבר זוכתה או בוטלה' });
    }
    if (sale.status === 'pending_payment') {
      return res.status(400).json({ error: 'לא ניתן לזכות עסקה שממתינה לתשלום — בטלו את הקישור במקום' });
    }
    if (!sale.icount_doc_number) {
      return res.status(400).json({ error: 'לעסקה אין מספר מסמך ב-iCount — אי אפשר לזכות אוטומטית' });
    }

    const doctype = sale.icount_doctype || 'invrec';
    const reason =
      String(req.body?.reason || '').trim() ||
      `ביטול עסקת קופה ${sale.id}`;

    let docHasCc = ['emv', 'credit', 'cc', 'online', 'card'].includes(
      String(sale.payment_method || '').toLowerCase()
    );

    // Verify still cancellable when possible
    try {
      const info = await icount.getDocInfo({ doctype, docnum: sale.icount_doc_number });
      const docInfo = info.doc_info || info;
      if (docInfo?.is_cancelled) {
        const updated = db.update('pos_sales', sale.id, {
          status: 'refunded',
          refunded_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          refund_note: 'המסמך כבר בוטל במערכת החיוב',
        });
        return res.json({ sale: updated, alreadyCancelled: true });
      }
      if (docInfo && docInfo.is_cancellable === false) {
        return res.status(400).json({ error: 'המסמך במערכת החיוב לא ניתן לביטול' });
      }
      if (docInfo?.has_cc != null) {
        docHasCc = !!docInfo.has_cc;
      }
      if (!sale.cc_confirmation_code) {
        const clearing = icount.extractCcClearing(info);
        const payment =
          (sale.payment_id && db.getOne('payments', sale.payment_id)) ||
          (db.get('payments') || []).find((p) => String(p.pos_sale_id) === String(sale.id)) ||
          null;
        await persistClearingOnPaymentAndSale({ payment, sale, clearing });
      }
    } catch (err) {
      console.warn('⚠️ [POS refund] doc info check failed:', err.message);
    }

    const cancellation = await icount.cancelDoc({
      doctype,
      docnum: sale.icount_doc_number,
      reason,
      refundCc: docHasCc,
    });

    // Void passes issued by this sale
    const voidedPasses = [];
    for (const pass of db.get('customer_passes') || []) {
      if (String(pass.sale_id) !== String(sale.id)) continue;
      if (pass.status === 'void') continue;
      const updatedPass = db.update('customer_passes', pass.id, {
        status: 'void',
        void_reason: reason,
        updated_at: new Date().toISOString(),
      });
      if (updatedPass) voidedPasses.push(updatedPass);
    }

    // Mark related payments
    for (const payment of db.get('payments') || []) {
      if (String(payment.pos_sale_id) !== String(sale.id) && String(payment.icount_doc_number) !== String(sale.icount_doc_number)) {
        continue;
      }
      db.update('payments', payment.id, {
        status: 'refunded',
        updated_at: new Date().toISOString(),
      });
    }

    const updatedSale = db.update('pos_sales', sale.id, {
      status: 'refunded',
      refunded_at: new Date().toISOString(),
      refund_reason: reason,
      refund_doc_number: cancellation.docnum,
      refund_doctype: cancellation.doctype,
      refund_doc_url: cancellation.docUrl || null,
      refunded_by: req.crmUser?.email || req.crmUser?.name || null,
      updated_at: new Date().toISOString(),
    });

    console.log(
      `↩️ [POS] refund sale=${sale.id} doc=${sale.icount_doc_number} → cancel=${cancellation.docnum}`
    );

    res.json({
      sale: updatedSale,
      cancellation,
      voidedPasses,
    });
  } catch (err) {
    console.error('POS refund error:', err.message, err.details?.error_details || '');
    const details = Array.isArray(err.details?.error_details)
      ? err.details.error_details.filter(Boolean).join(' · ')
      : '';
    let message = details || err.message;
    const lower = String(message || '').toLowerCase();
    if (lower.includes('no cc payment') || lower.includes('no credit')) {
      message =
        'לעסקה אין תשלום באשראי — אי אפשר להחזיר כסף לכרטיס. אם זו עסקת מזומן, רענן את המסך ונסה שוב (ביטול מסמך בלבד).';
    }
    res.status(502).json({
      error: message,
      code: err.code,
    });
  }
});

app.get('/api/pos/passes', (req, res) => {
  let passes = db.get('customer_passes') || [];
  if (req.query.studentId) {
    passes = passes.filter((p) => String(p.student_id) === String(req.query.studentId));
  }
  if (req.query.parentId) {
    passes = passes.filter((p) => String(p.parent_id) === String(req.query.parentId));
  }
  if (req.query.active === '1') {
    passes = passes.filter((p) => isPassUsable(p));
  }
  passes = [...passes].sort((a, b) =>
    String(b.created_at || '').localeCompare(String(a.created_at || ''))
  );
  res.json(passes);
});

app.get('/api/pos/passes/:id/punches', (req, res) => {
  const punches = (db.get('pass_punches') || [])
    .filter((p) => String(p.pass_id) === String(req.params.id))
    .sort((a, b) => String(b.punched_at || '').localeCompare(String(a.punched_at || '')));
  res.json(punches);
});

app.post('/api/pos/passes/:id/punch', (req, res) => {
  try {
    const pass = db.getOne('customer_passes', req.params.id);
    const result = punchPass(pass, {
      punchedBy: req.crmUser?.name || req.crmUser?.email || 'צוות',
      source: req.body?.source || 'customer_card',
      note: req.body?.note || '',
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** Local inventory sync / low-stock snapshot (iCount inventory module unavailable). */
app.post('/api/pos/sync-inventory', requireOwner, async (req, res) => {
  try {
    const threshold = Number(req.body?.threshold) || 5;
    const items = (db.get('pricelist') || []).map(enrichPricelistItem);
    const tracked = listTrackedInventory(items, { threshold });
    const lowStock = tracked.filter((i) => i.low);

    let remote = null;
    let remoteError = null;
    try {
      remote = await icount.listInventoryItems();
    } catch (err) {
      remoteError = err.message;
    }

    res.json({
      ok: true,
      mode: remote ? 'remote' : 'local',
      remoteError,
      trackedCount: tracked.length,
      lowStockCount: lowStock.length,
      lowStock,
      items: tracked,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pos/reports', requireOwner, (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
  const threshold = Number(req.query.threshold) || 5;
  const withinDays = Number(req.query.withinDays) || 14;
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceIso = since.toISOString();

  const sales = (db.get('pos_sales') || []).filter(
    (s) => String(s.created_at || '') >= sinceIso
  );
  const aggregates = aggregatePosSales(sales);
  const pricelist = (db.get('pricelist') || []).map(enrichPricelistItem);
  const lowStock = listTrackedInventory(pricelist, { lowOnly: true, threshold });
  const expiringPasses = listExpiringPasses(db.get('customer_passes') || [], { withinDays });

  res.json({
    days,
    ...aggregates,
    lowStock,
    expiringPasses: expiringPasses.slice(0, 50),
  });
});

app.post('/api/pos/sale', async (req, res) => {
  try {
    const {
      cart = [],
      studentId,
      parentId,
      walkInName,
      walkInPhone,
      walkInEmail,
      paymentMethod = 'cash',
      sendEmail = false,
      sendWhatsapp = false,
    } = req.body || {};

    const lines = mapCartLines(cart);
    if (!lines.length) return res.status(400).json({ error: 'העגלה ריקה' });

    const needsCustomer = lines.some((l) => requiresCustomer(l.product_type));
    const { student, parent, isNewLead } = resolvePosCustomer({
      studentId,
      parentId,
      walkInName,
      walkInPhone,
      walkInEmail,
    });
    if (needsCustomer && !student?.id) {
      return res.status(400).json({ error: 'מנוי או כרטיסייה דורשים בחירת מתאמן' });
    }

    const total = computeSaleTotal(lines);
    const method = String(paymentMethod || 'cash').toLowerCase();
    if (method === 'emv' || method === 'credit' || method === 'cc' || method === 'card') {
      return res.status(400).json({
        error:
          'אשראי במסוף לא זמין כרגע — אין חיבור למסוף פיזי. השתמשו במזומן או בסליקה בקישור.',
      });
    }
    let clientId = parent?.icount_client_id || null;
    let syncedParent = parent;
    if (parent?.id && icount.isConfigured()) {
      const synced = await syncParentToIcount(parent);
      syncedParent = synced.parent;
      clientId = synced.clientId;
    }

    let doc = null;
    if (icount.isConfigured()) {
      doc = await icount.createInvRec({
        clientId,
        clientName: syncedParent?.name || student?.name || walkInName || 'לקוח מדלפק',
        items: lines.map((l) => ({
          description: l.description,
          unitprice: l.unitprice,
          quantity: l.quantity,
        })),
        comment: `מכירה בדלפק · ${paymentMethod}${student?.name ? ` · עבור: ${student.name}` : ''}`,
        emailTo: sendEmail ? syncedParent?.email || walkInEmail : undefined,
        paymentMethod,
        vattype: icountVatType(true),
      });
    }

    const sale = db.insert('pos_sales', {
      items: lines.map(({ item, ...rest }) => rest),
      total,
      payment_method: paymentMethod,
      status: 'paid',
      price_includes_vat: true,
      student_id: student?.id || null,
      parent_id: syncedParent?.id || parentId || null,
      customer_name: syncedParent?.name || student?.name || walkInName || 'לקוח מדלפק',
      customer_phone: syncedParent?.phone || walkInPhone || '',
      customer_email: syncedParent?.email || walkInEmail || '',
      icount_client_id: clientId,
      icount_doc_id: doc?.docId || null,
      icount_doc_number: doc?.docnum || null,
      icount_doctype: doc ? 'invrec' : null,
      icount_doc_url: doc?.docUrl || null,
      sold_by: req.crmUser?.email || req.crmUser?.name || null,
      sent_email: !!sendEmail,
      sent_whatsapp: !!sendWhatsapp,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const passes = fulfillSalePasses({
      sale,
      lines,
      studentId: student?.id,
      parentId: syncedParent?.id || null,
      docId: doc?.docId,
      docNumber: doc?.docnum,
    });
    decrementInventory(lines);

    db.insert('payments', {
      parent_id: syncedParent?.id || null,
      student_id: student?.id || null,
      amount: total,
      description: lines.map((l) => l.name).join(', '),
      status: 'paid',
      payment_url: null,
      icount_client_id: clientId,
      icount_doc_id: doc?.docId || null,
      icount_doc_number: doc?.docnum || null,
      pos_sale_id: sale.id,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    let whatsappUrl = null;
    if (sendWhatsapp) {
      const phone = normalizePhone(syncedParent?.phone || walkInPhone);
      if (phone) {
        const digits = phone.replace(/^0/, '972');
        const text = encodeURIComponent(
          `שלום${syncedParent?.name ? ` ${syncedParent.name}` : ''},\n` +
            `תודה על הרכישה ב־My Wall.\n` +
            `סכום: ₪${total}` +
            (doc?.docnum ? `\nמספר מסמך: ${doc.docnum}` : '') +
            (doc?.docUrl ? `\nקישור למסמך: ${doc.docUrl}` : '')
        );
        whatsappUrl = `https://wa.me/${digits}?text=${text}`;
      }
    }

    res.status(201).json({ sale, passes, doc, whatsappUrl, isNewLead: !!isNewLead, parent: syncedParent });
  } catch (err) {
    console.error('POS sale error:', err.message, err.details?.error_details || '');
    const details = Array.isArray(err.details?.error_details)
      ? err.details.error_details.filter(Boolean).join(' · ')
      : '';
    res.status(502).json({
      error: details || err.message,
      code: err.code,
    });
  }
});

app.post('/api/pos/quote', async (req, res) => {
  try {
    if (!icount.isConfigured()) {
      return res.status(503).json({ error: 'iCount לא מוגדר בשרת' });
    }
    const {
      cart = [],
      studentId,
      parentId,
      walkInName,
      walkInPhone,
      walkInEmail,
      sendEmail = true,
      sendWhatsapp = false,
    } = req.body || {};

    const lines = mapCartLines(cart);
    if (!lines.length) return res.status(400).json({ error: 'העגלה ריקה' });

    const { student, parent, isNewLead } = resolvePosCustomer({
      studentId,
      parentId,
      walkInName,
      walkInPhone,
      walkInEmail,
    });

    let clientId = parent?.icount_client_id || null;
    let syncedParent = parent;
    if (parent?.id) {
      const synced = await syncParentToIcount(parent);
      syncedParent = synced.parent;
      clientId = synced.clientId;
    }

    const email = syncedParent?.email || walkInEmail || '';
    const doc = await icount.createOffer({
      clientId,
      clientName: syncedParent?.name || student?.name || walkInName || 'לקוח',
      items: lines.map((l) => ({
        description: l.description,
        unitprice: l.unitprice,
        quantity: l.quantity,
      })),
      comment: student?.name ? `עבור: ${student.name}` : undefined,
      emailTo: sendEmail && email ? email : undefined,
      vattype: icountVatType(true),
    });

    const total = computeSaleTotal(lines);
    const sale = db.insert('pos_sales', {
      items: lines.map(({ item, ...rest }) => rest),
      total,
      payment_method: null,
      status: 'quoted',
      price_includes_vat: true,
      student_id: student?.id || null,
      parent_id: syncedParent?.id || parentId || null,
      customer_name: syncedParent?.name || student?.name || walkInName || 'לקוח',
      customer_phone: syncedParent?.phone || walkInPhone || '',
      customer_email: email,
      icount_client_id: clientId,
      icount_doc_id: doc.docId,
      icount_doc_number: doc.docnum,
      icount_doc_url: doc.docUrl,
      icount_doctype: 'offer',
      sold_by: req.crmUser?.email || req.crmUser?.name || null,
      sent_email: !!(sendEmail && email),
      sent_whatsapp: !!sendWhatsapp,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    let whatsappUrl = null;
    if (sendWhatsapp) {
      const phone = normalizePhone(syncedParent?.phone || walkInPhone);
      if (phone) {
        const digits = phone.replace(/^0/, '972');
        const text = encodeURIComponent(
          `שלום${syncedParent?.name ? ` ${syncedParent.name}` : ''},\n` +
            `מצורפת הצעת מחיר מ־My Wall.\n` +
            `סכום: ₪${total}` +
            (doc.docnum ? `\nמספר הצעה: ${doc.docnum}` : '') +
            (doc.docUrl ? `\nקישור: ${doc.docUrl}` : '')
        );
        whatsappUrl = `https://wa.me/${digits}?text=${text}`;
      }
    }

    res.status(201).json({ sale, doc, whatsappUrl, emailedTo: sendEmail ? email : null, isNewLead: !!isNewLead, parent: syncedParent });
  } catch (err) {
    console.error('POS quote error:', err.message);
    res.status(502).json({ error: err.message, code: err.code });
  }
});

app.post('/api/pos/payment-link', async (req, res) => {
  try {
    const {
      cart = [],
      studentId,
      parentId,
      walkInName,
      walkInPhone,
      walkInEmail,
      sendWhatsapp = false,
    } = req.body || {};

    const lines = mapCartLines(cart);
    if (!lines.length) return res.status(400).json({ error: 'העגלה ריקה' });

    const needsCustomer = lines.some((l) => requiresCustomer(l.product_type));
    const { student, parent, isNewLead } = resolvePosCustomer({
      studentId,
      parentId,
      walkInName,
      walkInPhone,
      walkInEmail,
    });
    if (needsCustomer && !student?.id) {
      return res.status(400).json({ error: 'מנוי או כרטיסייה דורשים בחירת מתאמן' });
    }

    const total = computeSaleTotal(lines);
    if (!(Number(total) > 0)) {
      return res.status(400).json({
        error:
          'לא ניתן ליצור קישור תשלום לסכום 0. עמוד הסליקה חוזר אז למחיר ברירת מחדל. לסכום חינם השתמשו במזומן או גבייה ללא קישור.',
      });
    }
    let clientId = parent?.icount_client_id || null;
    let syncedParent = parent;
    let syncWarning = null;
    if (parent?.id && icount.isConfigured()) {
      try {
        const synced = await syncParentToIcount(parent);
        syncedParent = synced.parent;
        clientId = synced.clientId;
      } catch (err) {
        syncWarning = err.message;
      }
    }

    const description = lines
      .map((l) => `${l.name}${Number(l.quantity) > 1 ? ` (${l.quantity})` : ''}`)
      .join(', ')
      .slice(0, 180);
    const payment = db.insert('payments', {
      parent_id: syncedParent?.id || null,
      student_id: student?.id || null,
      amount: total,
      description,
      status: 'pending',
      payment_url: null,
      price_includes_vat: true,
      icount_client_id: clientId,
      icount_doc_id: null,
      icount_doc_number: null,
      paid_at: null,
      updated_at: new Date().toISOString(),
    });

    const sale = db.insert('pos_sales', {
      items: lines.map(({ item, ...rest }) => rest),
      total,
      payment_method: 'online',
      status: 'pending_payment',
      price_includes_vat: true,
      student_id: student?.id || null,
      parent_id: syncedParent?.id || null,
      customer_name: syncedParent?.name || student?.name || walkInName || 'לקוח',
      customer_phone: syncedParent?.phone || walkInPhone || '',
      customer_email: syncedParent?.email || walkInEmail || '',
      icount_client_id: clientId,
      payment_id: payment.id,
      sold_by: req.crmUser?.email || req.crmUser?.name || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    db.update('payments', payment.id, { pos_sale_id: sale.id });

    const ipnUrl = icount.buildIpnUrl({ paymentId: payment.id });
    const payUrl = await icount.buildPaymentUrl({
      amount: total,
      description: description || 'רכישה ב-My Wall',
      name: syncedParent?.name || student?.name || walkInName || 'לקוח',
      phone: syncedParent?.phone || walkInPhone,
      email: syncedParent?.email || walkInEmail,
      paymentId: payment.id,
      ipnUrl,
    });
    const updatedPayment = db.update('payments', payment.id, {
      payment_url: payUrl,
      updated_at: new Date().toISOString(),
    });
    const updatedSale = db.update('pos_sales', sale.id, {
      payment_url: payUrl,
      updated_at: new Date().toISOString(),
    });
    if (updatedPayment) await persistCore('payments', updatedPayment);
    if (updatedSale) await persistCore('pos_sales', updatedSale);

    const shortUrl = icount.buildPaymentRedirectUrl(payment.id);
    const shareUrl = icount.isLocalPublicApiBase() ? payUrl : shortUrl || payUrl;
    console.log(
      `💳 [POS] payment-link created sale=${sale.id} total=${total} url=${payUrl} short=${shortUrl}`
    );

    let whatsappUrl = null;
    let whatsappSent = false;
    let whatsappError = null;
    if (sendWhatsapp) {
      const phone = normalizePhone(syncedParent?.phone || walkInPhone);
      if (phone) {
        const customerName = syncedParent?.name || walkInName || 'לקוח';
        const amountLabel = String(total);
        const tplName = icount.getPaymentTemplateName();
        const localTpl = (db.get('message_templates') || []).find(
          (t) => (t.meta_name || t.name) === tplName
        );
        const tplApproved =
          localTpl &&
          (String(localTpl.status).toUpperCase() === 'APPROVED' || localTpl.active_for_send);
        // Meta template button is fixed to the live /r/ host. Never use it from local
        // (the payment only exists on this machine, and localhost short links fail on phones).
        const canUseMetaTemplate = tplApproved && !icount.isLocalPublicApiBase();

        if (canUseMetaTemplate) {
          try {
            const waResult = await whatsappService.sendTemplateMessage(
              phone,
              tplName,
              [customerName, description || 'רכישה', amountLabel],
              {
                fallbackName: customerName,
                parentId: syncedParent?.id || null,
                buttonUrlParam: payment.id,
              }
            );
            whatsappSent = !!waResult?.success;
            if (!whatsappSent) {
              whatsappError = waResult?.error || 'שליחת תבנית וואטסאפ נכשלה';
            }
          } catch (waErr) {
            whatsappError = waErr.message || 'שליחת תבנית וואטסאפ נכשלה';
          }
        }

        // Fallback: free-form text (only works inside 24h window)
        if (!whatsappSent) {
          const waMsg =
            `שלום${customerName ? ` ${customerName}` : ''},\n` +
            `לסיום התשלום ב-My Wall:\n${shareUrl}\n\n` +
            `לאחר התשלום תופק חשבונית מס קבלה אוטומטית.`;
          try {
            const waResult = await whatsappService.sendTextMessage(phone, waMsg);
            whatsappSent = !!waResult?.success;
            if (!whatsappSent) {
              whatsappError = waResult?.error || whatsappError || 'שליחת וואטסאפ נכשלה';
              console.error('POS payment-link WhatsApp failed:', whatsappError);
            } else {
              whatsappError = null;
            }
          } catch (waErr) {
            whatsappError = waErr.message || whatsappError || 'שליחת וואטסאפ נכשלה';
            console.error('POS payment-link WhatsApp error:', whatsappError);
          }
          if (!whatsappSent) {
            const digits = phone.startsWith('972') ? phone : phone.replace(/^0/, '972');
            whatsappUrl = `https://wa.me/${digits}?text=${encodeURIComponent(waMsg)}`;
          }
        }
      } else {
        whatsappError = 'אין מספר טלפון לשליחה בוואטסאפ';
      }
    }

    res.status(201).json({
      sale: updatedSale || { ...sale, payment_url: payUrl },
      payment: updatedPayment || { ...payment, payment_url: payUrl },
      payUrl,
      shortUrl,
      shareUrl,
      whatsappUrl,
      whatsappSent,
      whatsappError,
      syncWarning,
      isNewLead: !!isNewLead,
      parent: syncedParent,
    });
  } catch (err) {
    console.error('POS payment-link error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// Health Declarations endpoints
app.get('/api/health-declarations', (req, res) => {
  res.json(db.get('health_declarations'));
});

app.post('/api/health-declarations', (req, res) => {
  const record = db.insert('health_declarations', req.body);
  res.status(201).json(record);
});

// ─── Form templates (health + liability pages by activity) ───────────────────
const DEFAULT_HEALTH_QUESTIONS = [
  { id: 'q1', label: 'האם המתאמן סובל מאסתמה, קוצר נשימה או מחלת ריאות?' },
  { id: 'q2', label: 'האם המתאמן סובל מבעיות לב, לחץ דם, או סחרחורות/התעלפויות?' },
  { id: 'q3', label: 'האם יש בעיה אורתופדית (גב, פרקים, שברים) המגבילה פעילות מאומצת?' },
];

function slugifyFormTemplate(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u0590-\u05ff-_]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function listFormTemplates() {
  return db.get('form_templates') || [];
}

function findFormTemplateBySlug(slug) {
  const key = slugifyFormTemplate(slug);
  if (!key) return null;
  return listFormTemplates().find((t) => t.slug === key && t.isActive !== false) || null;
}

function findDefaultFormTemplate() {
  const all = listFormTemplates().filter((t) => t.isActive !== false);
  return all.find((t) => t.isDefault) || all.find((t) => t.slug === 'wall') || all[0] || null;
}

function clearOtherDefaultTemplates(keepId) {
  for (const t of listFormTemplates()) {
    if (t.id !== keepId && t.isDefault) {
      db.update('form_templates', t.id, { isDefault: false });
    }
  }
}

function normalizeFormTemplatePayload(body, existing = null) {
  const slug = slugifyFormTemplate(body.slug || existing?.slug || body.title || `form-${Date.now()}`);
  if (!slug) return { error: 'חסר מזהה קישור (slug)' };
  const healthQuestions = Array.isArray(body.healthQuestions)
    ? body.healthQuestions
    : (Array.isArray(body.health_questions) ? body.health_questions : (existing?.healthQuestions || DEFAULT_HEALTH_QUESTIONS));
  return {
    slug,
    title: (body.title ?? existing?.title ?? '').trim() || 'הצהרת בריאות',
    activityType: body.activityType || body.activity_type || existing?.activityType || 'wall',
    waiverText: body.waiverText ?? body.waiver_text ?? existing?.waiverText ?? '',
    healthQuestions: healthQuestions.map((q, i) => ({
      id: q.id || `q${i + 1}`,
      label: q.label || q.text || '',
    })).filter((q) => q.label),
    isDefault: body.isDefault === true || body.isDefault === 'true' || body.is_default === true,
    isActive: body.isActive !== false && body.is_active !== false,
  };
}

app.get('/api/form-templates', (req, res) => {
  res.json(listFormTemplates());
});

app.post('/api/form-templates', (req, res) => {
  const normalized = normalizeFormTemplatePayload(req.body);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const duplicate = listFormTemplates().find((t) => t.slug === normalized.slug);
  if (duplicate) return res.status(400).json({ error: 'קיים כבר טופס עם אותו מזהה קישור' });

  if (normalized.isDefault) clearOtherDefaultTemplates(null);
  if (!listFormTemplates().some((t) => t.isDefault)) normalized.isDefault = true;

  const record = db.insert('form_templates', {
    id: req.body.id || `ft_${Date.now()}`,
    ...normalized,
  });
  if (record.isDefault) clearOtherDefaultTemplates(record.id);
  res.status(201).json(record);
});

app.put('/api/form-templates/:id', (req, res) => {
  const existing = listFormTemplates().find((t) => t.id === req.params.id);
  if (!existing) return res.status(404).json({ error: 'התבנית לא נמצאה' });

  const normalized = normalizeFormTemplatePayload(req.body, existing);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const duplicate = listFormTemplates().find((t) => t.slug === normalized.slug && t.id !== existing.id);
  if (duplicate) return res.status(400).json({ error: 'קיים כבר טופס עם אותו מזהה קישור' });

  if (normalized.isDefault) clearOtherDefaultTemplates(existing.id);
  const updated = db.update('form_templates', existing.id, normalized);
  res.json(updated);
});

app.delete('/api/form-templates/:id', (req, res) => {
  const existing = listFormTemplates().find((t) => t.id === req.params.id);
  if (!existing) return res.status(404).json({ error: 'התבנית לא נמצאה' });
  if (existing.isDefault) {
    return res.status(400).json({ error: 'לא ניתן למחוק את תבנית ברירת המחדל — סמנו תבנית אחרת קודם' });
  }
  db.delete('form_templates', existing.id);
  res.json({ success: true });
});

// Public: load template by slug (or "default")
app.get('/api/public/form-templates/:slug', (req, res) => {
  const slugParam = req.params.slug;
  const template = slugParam === 'default'
    ? findDefaultFormTemplate()
    : (findFormTemplateBySlug(slugParam) || (slugParam === 'wall' ? findDefaultFormTemplate() : null));
  if (!template) return res.status(404).json({ error: 'הטופס לא נמצא' });
  res.json(template);
});

// Check-in endpoints
app.get('/api/check-ins', (req, res) => {
  res.json(db.get('check_ins'));
});

app.post('/api/check-ins', (req, res) => {
  const record = db.insert('check_ins', req.body);
  res.status(201).json(record);
});

function normPhone(p) {
  let d = String(p || '').replace(/[^\d]/g, '');
  if (d.startsWith('0') && d.length >= 9) d = `972${d.slice(1)}`;
  return d;
}

function resolveStudentForHealthForm({ studentId, parent, climberName, phone }) {
  const students = db.get('students') || [];
  const cleanName = String(climberName || '').trim();
  const climberFirstName = cleanName.split(/\s+/)[0] || '';
  const phoneKey = normPhone(phone);

  // 1) Explicit student id from staff link
  if (studentId) {
    const byId = students.find((s) => s.id === studentId);
    if (byId) return byId;
  }

  const nameMatches = (s) => {
    const sn = String(s?.name || '').trim();
    if (!sn || !cleanName) return false;
    return sn === cleanName || (climberFirstName && sn.includes(climberFirstName));
  };

  // 2) Same parent + matching climber name
  const siblings = students.filter((s) => s.parentId === parent.id);
  const byName = siblings.find(nameMatches);
  if (byName) return byName;

  // 3) Match via parent phone → any student of that parent with same name
  if (phoneKey) {
    const parents = db.get('parents') || [];
    const parentIds = parents
      .filter((p) => normPhone(p.phone) === phoneKey)
      .map((p) => p.id);
    const byPhoneName = students.find((s) =>
      parentIds.includes(s.parentId) && nameMatches(s)
    );
    if (byPhoneName) return byPhoneName;

    // Single child under this phone → attach declaration there
    const kidsOfPhone = students.filter((s) => parentIds.includes(s.parentId));
    if (kidsOfPhone.length === 1) return kidsOfPhone[0];
  }

  // 4) Only one child under resolved parent
  if (siblings.length === 1) return siblings[0];

  return null;
}

// Public Health Declarations + Liability Waiver
app.post('/api/public/health-declarations', publicFormRateLimit, async (req, res) => {
  const {
    parentName, parentIdNum, phone, climberName, climberIdNum, birthDate,
    signature, answers, waiverAccepted, studentId, notes, templateSlug, templateId
  } = req.body;

  if (!parentName || !phone || !climberName) {
    return res.status(400).json({ error: 'חסרים פרטי הורה / מתאמן / טלפון' });
  }
  if (!waiverAccepted) {
    return res.status(400).json({ error: 'יש לאשר את כתב הוויתור / הסרת האחריות' });
  }

  const template = templateId
    ? listFormTemplates().find((t) => t.id === templateId)
    : (templateSlug ? findFormTemplateBySlug(templateSlug) : findDefaultFormTemplate());

  // 1. Upsert parent (phone de-dupe) and resolve / create student
  const parent = db.upsertParentByPhone(parentName, phone, '', { source: 'form', channel: 'form' });
  // Always refresh parent name from form when provided
  if (parentName && parent.name !== parentName) {
    db.update('parents', parent.id, { name: parentName });
    parent.name = parentName;
  }

  let student = resolveStudentForHealthForm({ studentId, parent, climberName, phone });
  const signedAt = new Date().toISOString();
  const cleanClimberName = String(climberName || '').trim();

  if (student) {
    const prevStatus = student.status;
    student = db.update('students', student.id, {
      status: prevStatus === 'registered' ? prevStatus : 'health_signed',
      parentId: student.parentId || parent.id,
      birthDate: birthDate || student.birthDate || '',
      name: cleanClimberName || student.name,
      healthSignedAt: signedAt,
      waiverSignedAt: signedAt,
    }) || student;
    automationsService.triggerEvent('status_changed', { ...student, new_status: 'health_signed' });
  } else {
    // Keep the CRM student's id when the staff link included studentId but the
    // server cache was empty (common after Render restart before reload).
    student = db.insert('students', {
      id: studentId || undefined,
      name: cleanClimberName,
      parentId: parent.id,
      groupId: null,
      status: 'health_signed',
      birthDate: birthDate || '',
      notes: 'הגיע אוטומטית מטופס הצהרת בריאות + הסרת אחריות',
      levelGrade: null,
      source: 'form',
      healthSignedAt: signedAt,
      waiverSignedAt: signedAt,
      created: new Date().toISOString().split('T')[0]
    });
    automationsService.triggerEvent('new_lead', { ...student, phone, parentName });
  }

  if (!student?.id || !parent?.id) {
    return res.status(500).json({ error: 'לא ניתן לקשר את ההצהרה ללקוח' });
  }

  // 2. Persist declaration locally
  const record = db.insert('health_declarations', {
    date: new Date().toISOString().split('T')[0],
    studentId: student.id,
    parentId: parent.id,
    parentName,
    parentIdNum: parentIdNum || '',
    phone,
    climberName: cleanClimberName,
    climberIdNum: climberIdNum || '',
    birthDate: birthDate || '',
    answers: answers || {},
    waiverAccepted: true,
    signature_url: signature || '',
    status: 'approved',
    notes: notes || '',
    templateSlug: template?.slug || templateSlug || '',
    templateId: template?.id || templateId || null,
    signed: true,
    signedDate: new Date().toISOString().split('T')[0],
    signedBy: parentName,
    studentName: cleanClimberName,
  });

  // 3. Await durable Supabase writes so the client file survives Render restarts
  const durable = await Promise.all([
    persistCore('parents', parent),
    persistCore('students', student),
    persistCore('health_declarations', record),
  ]);
  const failed = durable.find((r) => r && r.ok === false);
  if (failed) {
    console.error('health-declaration durable write failed:', failed.error);
    return res.status(201).json({
      success: true,
      warning: 'ההצהרה נשמרה מקומית אך ייתכן שלא סונכרנה למסד הנתונים',
      record,
      student,
      parent,
    });
  }

  res.status(201).json({ success: true, record, student, parent });
});

const REQUIRED_BROADCAST_LIST = 'classes';

function findParentForOnboard({ parentId, phone, studentId }) {
  const parents = db.get('parents') || [];
  const students = db.get('students') || [];
  if (parentId) {
    const byId = parents.find((p) => p.id === parentId);
    if (byId) return byId;
  }
  if (studentId) {
    const student = students.find((s) => s.id === studentId);
    if (student?.parentId) {
      const byStudent = parents.find((p) => p.id === student.parentId);
      if (byStudent) return byStudent;
    }
  }
  const phoneKey = normalizePhone(phone);
  if (phoneKey) {
    return parents.find((p) => normalizePhone(p.phone) === phoneKey) || null;
  }
  return null;
}

// Public health-form context — prefill parent + climber from CRM
app.get('/api/public/health-context', publicFormRateLimit, (req, res) => {
  const studentId = String(req.query.studentId || '').trim();
  const phone = String(req.query.phone || '').trim();
  const parentId = String(req.query.parentId || '').trim();

  const students = db.get('students') || [];
  let student = studentId ? students.find((s) => s.id === studentId) : null;
  const parent = findParentForOnboard({
    parentId: parentId || student?.parentId || '',
    phone,
    studentId,
  });

  if (!student && parent) {
    const kids = students.filter((s) => s.parentId === parent.id);
    if (kids.length === 1) student = kids[0];
  }

  if (!parent && !student) {
    return res.json({ parent: null, student: null });
  }

  res.json({
    parent: parent
      ? {
          id: parent.id,
          name: String(parent.name || '').trim(),
          phone: parent.phone || '',
          idNumber: parent.idNumber || parent.parentIdNum || '',
        }
      : null,
    student: student
      ? {
          id: student.id,
          name: String(student.name || '').trim(),
          birthDate: student.birthDate || '',
          idNumber: student.idNumber || student.climberIdNum || '',
        }
      : null,
  });
});

// Public onboarding context — prefill parent/children + mailing lists
app.get('/api/public/onboard-context', publicFormRateLimit, (req, res) => {
  const parentId = String(req.query.parentId || '').trim();
  const studentId = String(req.query.studentId || '').trim();
  const phone = String(req.query.phone || '').trim();

  const parent = (parentId || studentId || phone)
    ? findParentForOnboard({ parentId, phone, studentId })
    : null;
  const listDefs = db.getBroadcastListDefs();
  const students = parent
    ? (db.get('students') || []).filter((s) => s.parentId === parent.id)
    : [];

  // Onboarding: classes is always on; other lists default off unless explicitly subscribed.
  const broadcastRows = db.get('broadcast_lists') || [];
  const subscriptions = {};
  for (const list of listDefs) {
    if (list.key === REQUIRED_BROADCAST_LIST) {
      subscriptions[list.key] = true;
      continue;
    }
    const record = parent
      ? broadcastRows.find((r) => r.parentId === parent.id && r.listName === list.key)
      : null;
    subscriptions[list.key] = record ? record.subscribed === true : false;
  }
  subscriptions[REQUIRED_BROADCAST_LIST] = true;

  const template = findDefaultFormTemplate() || findFormTemplateBySlug('wall');

  res.json({
    parent: parent
      ? {
          id: parent.id,
          name: parent.name || '',
          phone: parent.phone || '',
          email: parent.email || '',
          city: parent.city || '',
          idNumber: parent.idNumber || '',
        }
      : null,
    students: students.map((s) => ({
      id: s.id,
      name: s.name || '',
      birthDate: s.birthDate || '',
      gender: s.gender || '',
      idNumber: s.idNumber || '',
      status: s.status || '',
      interests: Array.isArray(s.interests) ? s.interests : [],
      notes: s.notes || '',
    })),
    listDefs,
    subscriptions,
    requiredListKey: REQUIRED_BROADCAST_LIST,
    interestOptions: INTEREST_OPTIONS,
    template: template
      ? {
          id: template.id,
          slug: template.slug,
          title: template.title,
          waiverText: template.waiverText,
          healthQuestions: template.healthQuestions,
        }
      : null,
  });
});

// Public full onboarding submit (details + lists + health per child)
app.post('/api/public/onboard', publicFormRateLimit, async (req, res) => {
  const {
    parent: parentBody = {},
    children = [],
    subscriptions = {},
    interest = '',
    templateSlug,
    templateId,
  } = req.body || {};

  const parentName = String(parentBody.name || '').trim();
  const phone = String(parentBody.phone || '').trim();
  const parentIdNum = String(parentBody.idNumber || parentBody.parentIdNum || '').trim();
  const email = String(parentBody.email || '').trim();
  const city = String(parentBody.city || '').trim();
  const interestText = String(interest || '').trim();

  if (!parentName || !phone) {
    return res.status(400).json({ error: 'נדרשים שם הורה ומספר טלפון' });
  }
  if (!email) {
    return res.status(400).json({ error: 'נדרש אימייל' });
  }
  if (!city) {
    return res.status(400).json({ error: 'נדרש מקום מגורים' });
  }

  const childList = (Array.isArray(children) ? children : [])
    .map((c) => {
      const name = String(c.name || '').trim();
      const explicitAdult = c.type === 'adult' || c.isAdult === true || c.isAdultSelf === true;
      const sameAsParent = name
        && parentName
        && name.trim().toLowerCase().replace(/\s+/g, ' ') === parentName.trim().toLowerCase().replace(/\s+/g, ' ');
      const asAdult = explicitAdult || sameAsParent;
      return {
        id: c.id || null,
        name,
        type: asAdult ? 'adult' : 'child',
        birthDate: String(c.birthDate || '').trim(),
        gender: String(c.gender || '').trim(),
        idNumber: String(c.idNumber || c.climberIdNum || '').trim(),
        childPhone: String(c.childPhone || '').trim(),
        registrationNotes: String(c.registrationNotes || c.notes || '').trim(),
        answers: c.answers || {},
        signature: c.signature || '',
        waiverAccepted: c.waiverAccepted === true || c.waiverAccepted === 'true',
      };
    })
    .filter((c) => c.name);

  if (!childList.length) {
    return res.status(400).json({ error: 'יש להוסיף לפחות משתתף/ת אחד' });
  }

  for (const child of childList) {
    if (child.type !== 'adult' && !child.birthDate) {
      return res.status(400).json({ error: `חסר תאריך לידה עבור ${child.name}` });
    }
    if (!child.waiverAccepted || !child.signature) {
      return res.status(400).json({
        error: `חסרה חתימה או אישור וויתור עבור ${child.name}`,
      });
    }
  }

  const template = templateId
    ? (db.get('form_templates') || []).find((t) => t.id === templateId)
    : (templateSlug ? findFormTemplateBySlug(templateSlug) : findDefaultFormTemplate());

  const requiredQs = (template?.healthQuestions || []).filter((q) => q.requireYes);
  for (const child of childList) {
    for (const q of requiredQs) {
      if (!child.answers?.[q.id]) {
        return res.status(400).json({
          error: `יש לסמן את כל סעיפי ההצהרה עבור ${child.name}`,
        });
      }
    }
  }

  let crmResult;
  try {
    crmResult = await saveCrmParticipants({
      db,
      persist: persistCore,
      parent: {
        ...parentBody,
        name: parentName,
        phone,
        email,
        city,
        idNumber: parentIdNum,
      },
      participants: childList,
      template: template || resolveDeclarationTemplate(db, { templateId, templateSlug }),
      source: parentBody.source || 'form',
      onStudentCreated: (student, savedParent) => automationsService.triggerEvent('new_lead', {
        ...student,
        phone: savedParent.phone,
        parentName: savedParent.name,
      }),
      onStudentStatusChanged: (student) => automationsService.triggerEvent('status_changed', {
        ...student,
        new_status: 'health_signed',
      }),
    });
  } catch (err) {
    return res.status(err.status || 503).json({ error: err.message });
  }
  const parent = crmResult.parent;
  const declarations = crmResult.declarations;
  const savedStudents = crmResult.participants.map((participant) => participant.student);

  for (let index = 0; index < savedStudents.length; index += 1) {
    const student = savedStudents[index];
    const child = childList[index];
    const noteParts = [];
    if (interestText) noteParts.push(`עניין: ${interestText}`);
    if (child.childPhone) noteParts.push(`טלפון ילד/ה: ${child.childPhone}`);
    if (child.registrationNotes) noteParts.push(child.registrationNotes);
    const mergedNotes = noteParts.join('\n');
    const interests = interestText
      ? Array.from(new Set([...(Array.isArray(student.interests) ? student.interests : []), interestText]))
      : (Array.isArray(student.interests) ? student.interests : []);
    const segment = student.segment || (
      /בוגר|מבוגר|adult/i.test(interestText) ? 'adults'
        : /נוער|youth/i.test(interestText) ? 'youth'
          : /ילד|kids|ילדים/i.test(interestText) ? 'kids'
            : /הולדת|birthday/i.test(interestText) ? 'birthday'
              : null
    );
    const updatedStudent = db.update('students', student.id, {
      interests,
      segment,
      notes: mergedNotes
        ? (student.notes && !String(student.notes).includes(mergedNotes)
            ? `${student.notes}\n${mergedNotes}`
            : mergedNotes)
        : (student.notes || ''),
    }) || student;
    savedStudents[index] = updatedStudent;
    const durableStudent = await persistCore('students', updatedStudent);
    if (durableStudent?.ok === false) {
      return res.status(503).json({ error: durableStudent.error || 'שמירת המתאמן נכשלה' });
    }
  }

  // Mailing lists — force classes subscribed
  const listKeys = (db.getBroadcastListDefs() || []).map((l) => l.key);
  const nextSubs = {};
  for (const key of listKeys) {
    if (key === REQUIRED_BROADCAST_LIST) {
      nextSubs[key] = true;
    } else {
      nextSubs[key] = subscriptions[key] === true || subscriptions[key] === 'true';
    }
  }
  const savedLists = db.updateParentBroadcastLists(parent.id, nextSubs);

  res.status(201).json({
    success: true,
    parent,
    students: savedStudents,
    declarations,
    subscriptions: savedLists,
  });
});

// Upload signed PDF into personal file (Supabase Storage)
app.post('/api/public/onboard/:declarationId/pdf', publicFormRateLimit, async (req, res) => {
  const { declarationId } = req.params;
  const { pdfBase64, fileName } = req.body || {};
  if (!pdfBase64 || typeof pdfBase64 !== 'string') {
    return res.status(400).json({ error: 'חסר קובץ PDF' });
  }

  const decl = (db.get('health_declarations') || []).find((d) => d.id === declarationId);
  if (!decl) return res.status(404).json({ error: 'הצהרה לא נמצאה' });

  const raw = pdfBase64.includes(',') ? pdfBase64.split(',')[1] : pdfBase64;
  let buffer;
  try {
    buffer = Buffer.from(raw, 'base64');
  } catch {
    return res.status(400).json({ error: 'קובץ PDF לא תקין' });
  }
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) {
    return res.status(400).json({ error: 'גודל הקובץ לא תקין' });
  }

  const safeName = String(fileName || `health-declaration_${declarationId}.pdf`)
    .replace(/[^\w\u0590-\u05ff.\-]+/g, '_')
    .slice(0, 120);
  const storagePath = `${decl.parentId || 'unknown'}/${decl.studentId || 'unknown'}/${declarationId}_${Date.now()}.pdf`;

  const uploaded = await supa.uploadClientDocument(storagePath, buffer, 'application/pdf');
  if (!uploaded.ok) {
    return res.status(500).json({ error: uploaded.error || 'שמירת הקובץ נכשלה' });
  }

  const doc = db.insert('client_documents', {
    parentId: decl.parentId || null,
    studentId: decl.studentId || null,
    declarationId: decl.id,
    type: 'health_waiver_pdf',
    fileName: safeName,
    storagePath,
    mimeType: 'application/pdf',
  });
  await persistCore('client_documents', doc);

  res.status(201).json({ success: true, document: doc });
});

// Staff: list documents in personal file
app.get('/api/students/:id/documents', (req, res) => {
  const studentId = req.params.id;
  const docs = (db.get('client_documents') || [])
    .filter((d) => d.studentId === studentId)
    .slice()
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  res.json(docs);
});

app.get('/api/students/:id/activity-registrations', async (req, res) => {
  try {
    const studentId = String(req.params.id || '').trim();
    if (!studentId) return res.status(400).json({ error: 'חסר מזהה מתאמן' });
    if (supa.isEnabled()) {
      const [remoteRegs, remoteActivities] = await Promise.all([
        supa.getAll('activity_registrations'),
        supa.getAll('activities'),
      ]);
      if (remoteRegs) db.set('activity_registrations', remoteRegs);
      if (remoteActivities) db.set('activities', remoteActivities);
    }
    const typeLabels = {
      birthday: 'יום הולדת',
      trip: 'טיול',
      school: 'בית ספר',
      company: 'פעילות חברה',
      route_building: 'בניית מסלולים',
      opening_hours: 'שעות פתיחה',
      training_vacation: 'חופשה מאימונים',
      other: 'אחר',
    };
    const statusLabels = {
      confirmed: 'רשום',
      pending_payment: 'ממתין לתשלום',
      cancelled: 'בוטל',
      refunded: 'זוכה',
    };
    const rows = (db.get('activity_registrations') || [])
      .filter((registration) => String(registration.student_id || '') === studentId)
      .map((registration) => {
        const activity = db.getOne('activities', registration.activity_id) || {};
        return {
          id: registration.id,
          activity_id: registration.activity_id,
          activity_name: activity.name || registration.participant_name || 'אירוע',
          activity_type: activity.type || '',
          activity_type_label: typeLabels[activity.type] || 'אירוע',
          date: activity.date || '',
          end_date: activity.end_date || null,
          start_time: activity.start_time || '',
          location: activity.location || '',
          status: registration.status || '',
          status_label: statusLabels[registration.status] || registration.status || '',
          payment_status: registration.payment_status || '',
          created_at: registration.created_at || registration.updated_at || '',
        };
      })
      .sort((a, b) => String(b.date || b.created_at).localeCompare(String(a.date || a.created_at)));
    res.json(rows);
  } catch (err) {
    console.error('student activity registrations error:', err.message);
    res.status(500).json({ error: err.message || 'טעינת פעילויות נכשלה' });
  }
});

app.get('/api/documents/:id/download', async (req, res) => {
  const doc = (db.get('client_documents') || []).find((d) => d.id === req.params.id);
  if (!doc?.storagePath) return res.status(404).json({ error: 'מסמך לא נמצא' });

  const downloaded = await supa.downloadClientDocument(doc.storagePath);
  if (!downloaded.ok || !downloaded.blob) {
    return res.status(500).json({ error: downloaded.error || 'הורדה נכשלה' });
  }

  const arrayBuffer = await downloaded.blob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  res.setHeader('Content-Type', doc.mimeType || 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(doc.fileName || 'document.pdf')}`
  );
  res.send(buffer);
});

/** Resolve student + parent for lead send endpoints (supports parent-only cards). */
function resolveLeadSendTarget(studentIdParam) {
  const rawId = String(studentIdParam || '');
  if (rawId.startsWith('parent:')) {
    const parent = (db.get('parents') || []).find((p) => p.id === rawId.slice('parent:'.length));
    if (!parent) return { error: 'הלקוח לא נמצא', status: 404 };
    if (!parent.phone) return { error: 'אין מספר טלפון לשליחה', status: 400 };
    return {
      student: { id: rawId, name: '', parentId: parent.id },
      parent,
    };
  }
  const student = (db.get('students') || []).find((s) => s.id === rawId);
  if (!student) return { error: 'המתאמן לא נמצא', status: 404 };
  const parent = (db.get('parents') || []).find((p) => p.id === student.parentId);
  if (!parent?.phone) return { error: 'אין מספר טלפון לשליחה', status: 400 };
  return { student, parent };
}

/** Prefer a configured Meta template; fall back to free-form text when the 24h window is open. */
async function sendWhatsAppWithOptionalTemplate(phone, {
  templateCandidates = [],
  variables = [],
  freeformText,
  parentId,
} = {}) {
  const tried = new Set();
  let lastError = '';

  for (const name of templateCandidates) {
    if (!name || tried.has(name)) continue;
    tried.add(name);
    const result = await whatsappService.sendTemplateMessage(phone, name, variables, { parentId });
    if (result?.success) return { sent: true, via: 'template', templateName: name, result };
    lastError = result?.error || lastError;
  }

  if (freeformText) {
    const result = await whatsappService.sendTextMessage(phone, freeformText);
    if (result?.success) return { sent: true, via: 'text', result };
    lastError = result?.error || lastError || 'שליחת טקסט חופשי נכשלה (ייתכן שחלון 24 השעות סגור)';
  }

  return {
    sent: false,
    via: null,
    result: null,
    error: lastError || 'לא נמצאה תבנית מאושרת לשליחה מחוץ לחלון 24 השעות',
  };
}

function isLocalAppOrigin(origin) {
  try {
    const host = new URL(String(origin || '')).hostname;
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return true;
  }
}

/** Prefer a public HTTPS origin for WhatsApp — localhost links are not clickable on phones. */
const PUBLIC_APP_FALLBACK = 'https://client-omega-topaz-35.vercel.app';

function resolvePublicAppOrigin(requestedOrigin) {
  const candidates = [
    process.env.PUBLIC_APP_URL,
    requestedOrigin,
    PUBLIC_APP_FALLBACK,
  ]
    .map((value) => String(value || '').trim().replace(/\/$/, ''))
    .filter(Boolean);

  for (const candidate of candidates) {
    if (!isLocalAppOrigin(candidate)) return candidate;
  }
  return PUBLIC_APP_FALLBACK;
}

function buildShareableHealthUrl(origin, { pathSlug = '', studentId = '', phone = '' } = {}) {
  const base = `${String(origin).replace(/\/$/, '')}/health${pathSlug || ''}`;
  const params = new URLSearchParams();
  // Prefer studentId alone — long phone digits at the end break WhatsApp link detection.
  if (studentId && !String(studentId).startsWith('parent:')) {
    params.set('studentId', studentId);
  } else if (phone) {
    params.set('phone', phone);
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

function buildShareableOnboardUrl(origin, { parentId = '', studentId = '', phone = '' } = {}) {
  const base = `${String(origin).replace(/\/$/, '')}/onboard`;
  const params = new URLSearchParams();
  if (parentId) params.set('parentId', parentId);
  if (studentId && !String(studentId).startsWith('parent:')) params.set('studentId', studentId);
  // Keep phone only when we have no parent/student id to resolve context.
  if (!parentId && !(studentId && !String(studentId).startsWith('parent:')) && phone) {
    params.set('phone', phone);
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

// Send full onboarding link via WhatsApp
app.post('/api/leads/:studentId/send-onboard-link', async (req, res) => {
  const target = resolveLeadSendTarget(req.params.studentId);
  if (target.error) return res.status(target.status).json({ error: target.error });
  const { student, parent } = target;

  const origin = resolvePublicAppOrigin(req.body?.origin);
  const onboardUrl = buildShareableOnboardUrl(origin, {
    parentId: parent.id,
    studentId: student.id,
    phone: parent.phone,
  });

  try {
    const settings = db.getSettings() || {};
    // Do NOT use Meta templates whose button still points at an external form
    // (e.g. noteforms). Prefer free-form with our /onboard URL, or a template
    // explicitly configured for the CRM onboarding page.
    const send = await sendWhatsAppWithOptionalTemplate(parent.phone, {
      templateCandidates: [
        settings.waOnboardTemplate,
        process.env.WA_ONBOARD_TEMPLATE,
      ].filter(Boolean),
      variables: [parent.name || student.name || 'לקוח'],
      freeformText: `שלום ${parent.name || ''}, בבקשה השלימו את הפרטים, רישום הילדים וחתימה על הצהרת הבריאות:\n\n${onboardUrl}`,
      parentId: parent.id,
    });
    res.json({
      success: !!send.sent,
      sent: !!send.sent,
      onboardUrl,
      result: send.result || null,
      warning: send.sent ? undefined : send.error,
    });
  } catch (err) {
    res.status(200).json({
      success: false,
      sent: false,
      onboardUrl,
      warning: err.message,
    });
  }
});

// Send health-form link via WhatsApp (from lead card)
app.post('/api/leads/:studentId/send-health-form', async (req, res) => {
  const target = resolveLeadSendTarget(req.params.studentId);
  if (target.error) return res.status(target.status).json({ error: target.error });
  const { student, parent } = target;

  const origin = resolvePublicAppOrigin(req.body?.origin);
  const requestedSlug = slugifyFormTemplate(req.body?.templateSlug || req.body?.slug || '');
  const template = requestedSlug
    ? findFormTemplateBySlug(requestedSlug)
    : findDefaultFormTemplate();
  const pathSlug = template?.slug && !template.isDefault ? `/${template.slug}` : '';
  const healthUrl = buildShareableHealthUrl(origin, {
    pathSlug,
    studentId: student.id,
    phone: parent.phone,
  });

  try {
    const settings = db.getSettings() || {};
    const parentLabel = parent.name || 'לקוח';
    const studentLabel = student.name || '';
    const forChild = studentLabel
      && parentLabel
      && studentLabel.trim().toLowerCase() !== parentLabel.trim().toLowerCase();
    const freeformText = forChild
      ? `שלום ${parentLabel}, מצורף קישור להצהרת בריאות עבור ${studentLabel}:\n\n${healthUrl}`
      : `שלום ${parentLabel}, בבקשה מלאו את הצהרת הבריאות והסרת האחריות לפני הגעתכם:\n\n${healthUrl}`;
    const send = await sendWhatsAppWithOptionalTemplate(parent.phone, {
      templateCandidates: [
        settings.waHealthTemplate,
        process.env.WA_HEALTH_TEMPLATE,
        't2',
      ].filter(Boolean),
      variables: [parentLabel],
      freeformText,
      parentId: parent.id,
    });
    res.json({
      success: !!send.sent,
      sent: !!send.sent,
      healthUrl,
      templateSlug: template?.slug || null,
      result: send.result || null,
      warning: send.sent ? undefined : send.error,
    });
  } catch (err) {
    // Still return the link so staff can copy/share manually
    res.status(200).json({
      success: false,
      sent: false,
      healthUrl,
      templateSlug: template?.slug || null,
      warning: err.message,
    });
  }
});

// Daily attendance ensure at 06:00 Asia/Jerusalem (in-process; also call POST /api/attendance/ensure-today)
let lastAttendanceEnsureDate = null;
async function runDailyAttendanceEnsureIfDue() {
  try {
    const today = israelDateStr();
    if (lastAttendanceEnsureDate === today) return;
    if (israelHour() < 6) return;
    lastAttendanceEnsureDate = today;
    await refreshStudentsAndGroupsCache();
    await refreshAttendanceCache();
    const result = ensureAttendanceRows({
      groups: db.get('groups') || [],
      students: db.get('students') || [],
      attendance: db.get('attendance') || [],
      date: today,
      groupId: null,
    });
    for (const row of result.created) {
      db.insert('attendance', row);
    }
    console.log(`📋 Daily attendance ensure (${today}): created ${result.created.length}`);
  } catch (err) {
    console.error('Daily attendance ensure failed:', err.message);
    lastAttendanceEnsureDate = null;
  }
}

// Start Server (after loading CRM-core data from Supabase)
initDb().finally(() => {
  try {
    ensureEquipmentWhatsappTemplate({
      db,
      persist: persistCore,
      publicAppBase: process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || '',
    });
  } catch (err) {
    console.warn('equipment template seed skipped:', err.message);
  }
  try {
    ensureEventWhatsappTemplates({
      db,
      persist: persistCore,
      publicAppBase: process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || '',
    });
  } catch (err) {
    console.warn('event whatsapp templates seed skipped:', err.message);
  }
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  try {
    automationsService.ensureDefaultIntroAutomations();
  } catch (err) {
    console.error('ensureDefaultIntroAutomations failed:', err.message);
  }

  // Conversation mirror is derived from the durable `messages` table.
  try {
    const mirrored = rebuildLogMirrorFromMessages();
    if (mirrored) console.log(`💬 Conversation mirror rebuilt from ${mirrored} durable message(s)`);
  } catch (err) {
    console.error('rebuildLogMirrorFromMessages failed:', err.message);
  }

  // Retry any message whose durable write did not land (Supabase blip).
  startPendingMessageRetry();
  flushPendingMessages().catch((err) =>
    console.error('startup flushPendingMessages failed:', err.message)
  );
  
  // Self-ping keeps the instance awake and surfaces a degraded store early.
  const renderUrl = process.env.RENDER_EXTERNAL_URL || 'https://climbing-crm-api.onrender.com';
  setInterval(() => {
    fetch(`${renderUrl}/api/health?deep=1`)
      .then(async (res) => {
        if (res.ok) {
          console.log(`⏱️ Keep-Alive Self-Ping (${res.status}) at ${new Date().toLocaleTimeString()}`);
          return;
        }
        const detail = await res.json().catch(() => ({}));
        console.error(`⚠️ Health check degraded (${res.status}):`, JSON.stringify(detail));
      })
      .catch(err => console.error('Keep-Alive ping error:', err.message));
  }, 8 * 60 * 1000);

  // Check every 15 minutes whether the daily attendance ensure should run
  setTimeout(() => { runDailyAttendanceEnsureIfDue(); }, 20_000);
  setInterval(() => { runDailyAttendanceEnsureIfDue(); }, 15 * 60 * 1000);

  // Intro class reminder + day-after followup (from 08:00 Asia/Jerusalem)
  setTimeout(() => { runScheduledAutomationsIfDue(8); }, 45_000);
  setInterval(() => { runScheduledAutomationsIfDue(8); }, 15 * 60 * 1000);

  // Google Calendar pull every 10 minutes (backup for missed webhooks)
  const runGooglePullIfConnected = async () => {
    try {
      const status = await googleCalendarService.getStatus();
      if (!status.connected) return;
      const result = await applyGooglePull(db);
      if (result && !result.skipped) {
        console.log(
          `📅 Google Calendar sync: +${result.created || 0} ~${result.updated || 0} -${result.deleted || 0}`
        );
      }
    } catch (err) {
      console.error('Periodic Google Calendar sync failed:', err.message);
    }
  };
  setTimeout(() => { runGooglePullIfConnected(); }, 60_000);
  setInterval(() => { runGooglePullIfConnected(); }, 10 * 60 * 1000);

  // Meta WhatsApp template statuses (PENDING → APPROVED/REJECTED)
  const runTemplateSyncIfConfigured = async () => {
    try {
      const result = await syncTemplatesFromMeta();
      if (result?.success) {
        console.log(`📄 Message templates sync: ${result.synced ?? 0} from Meta`);
      } else if (result?.error) {
        console.warn('Periodic template sync skipped:', result.error);
      }
    } catch (err) {
      console.error('Periodic template sync failed:', err.message);
    }
  };
  setTimeout(() => { runTemplateSyncIfConfigured(); }, 90_000);
  setInterval(() => { runTemplateSyncIfConfigured(); }, 15 * 60 * 1000);
});
});

