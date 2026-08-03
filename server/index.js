import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import { db, initDb, persistCore, parentPhonesMatch, setBotEnabledDurable } from './db.js';
import { supa } from './supa.js';
import { requiresDurableStore, publicStoreUnavailableError } from './runtimeSafety.js';
import {
  whatsappService,
  instagramService,
  runConversationAnalysis,
  runNightlySweep,
  runNightlySweepIfDue,
} from './whatsapp.js';
import { whatsappConnectService } from './whatsappConnect.js';
import { automationsService, runScheduledAutomationsIfDue } from './automations.js';
import { capabilityState, capabilitySettingKey, CAPABILITY_KEYS, CAPABILITY_INPUT_KEYS } from './botCapabilities.js';
import { listBotActions, botActionSummary, BOT_ACTION_TYPES } from './botActivityLog.js';
import {
  loadAgendaSettings,
  saveAgendaSettings,
  buildDailyDigest,
  buildWeeklyDigest,
  sendDailyDigest,
  sendWeeklyDigest,
  runAgendaDigestsIfDue,
  addDays as addAgendaDays,
} from './agendaDigest.js';
import {
  OFFER_TYPES,
  OFFER_TYPE_LABELS,
  offerSummary,
  listCoupons,
  activeCouponsFor,
  issueCoupon,
  checkCouponForSale,
  redeemCoupon,
  releaseCouponsForSale,
  cancelCoupon,
  couponStats,
  reserveCoupon,
  COUPON_STATUS,
  todayIsoDate,
} from './coupons.js';
import {
  TRIGGER_TYPES,
  TRIGGER_LABELS,
  SEND_STATUS,
  normalizeCampaign,
  campaignPresets,
  deliverCampaignEntry,
} from './campaigns.js';
import {
  runCampaignNow,
  runCampaignsIfDue,
  sendCampaignMessage,
  businessDisplayName,
} from './campaignRunner.js';
import { icount } from './icount.js';
import { apiAuth, requireOwner } from './auth.js';
import { googleCalendarService } from './googleCalendar.js';
import { googleContactsService } from './googleContacts.js';
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
  heldRegistrationsBy,
  remainingCapacity,
  registrationIsOpen,
  findActivityBySlug,
  publicRegistrationPayload,
  templateFieldsFromActivity,
  normalizeTemplatePayload as normalizeActivityTemplatePayload,
  normalizeTemplateCategory,
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
  upcomingPublicActivities,
  upcomingOpeningHours,
  publicGroups,
} from './publicSite.js';
import {
  SUGGESTION_PENDING,
  approveSuggestion,
  createScenario,
  createTask,
  deleteScenario,
  ensureDefaultScenarios,
  enrichForDisplay,
  listScenarios,
  listSuggestions,
  listTasks,
  loadAssistantSettings,
  rejectSuggestion,
  saveAssistantSettings,
  scenarioStats,
  updateScenario,
  updateTask,
} from './aiActions.js';
import { runChatTurn } from './aiChat.js';
import {
  approveFeedback,
  feedbackStats,
  listFeedback,
  listLearned,
  recordFeedback,
  rejectFeedback,
  setLearnedActive,
} from './botLearning.js';
import {
  INTEREST_COLLECTION,
  addInterest,
  closeInterestForRegistrations,
  convertInterestToRegistration,
  enrichInterest,
  listInterest,
  normalizeInterestInput,
  updateInterest,
} from './activityInterest.js';
import {
  ACTIVITY_ATTENDANCE_COLLECTION,
  activityAttendanceId,
  activityAttendanceRows,
  attendanceDaysFor,
  buildActivityAttendance,
  indexSavedAttendance,
  planAttendanceMark,
  registrationCountsForAttendance,
  summarizeDays,
} from './activityAttendance.js';
import {
  buildRegistrationRefundPlan,
  applyRegistrationRefundMarks,
  buildHostRefundPlan,
  applyHostRefundMarks,
  summarizeHostPayment,
} from './activityRegistrationRefund.js';
import {
  paymentOwner,
  paymentDocRefs,
  paymentHasCardCharge,
  checkPaymentRefundable,
  applyGenericRefundMarks,
  buildInvoiceWhatsAppText,
} from './paymentActions.js';
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
  declarationGap,
  isChildOnlyQuestion,
  isScreeningQuestion,
  needsMedicalClearance,
  questionLabel,
  questionsForSigner,
  requiresClearance,
} from './healthQuestions.js';
import { EVENT_KINDS, normalizeActivityType } from './eventKinds.js';
import { declarationTemplateForActivity, templateActivityTypes } from './activityDeclaration.js';
import { createOtpService } from './otpService.js';
import {
  declarationSignedAt,
  isHealthDeclarationValid,
} from './healthValidity.js';
import { passPunchBlockReason } from './passPunchEligibility.js';
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
  childrenOfParent,
  chooseRecipientParent,
  expandHousehold,
  familyCandidates,
  findChildMatches,
  guardianParentIds,
  householdMergeCandidates,
  householdMergeCandidatesPayload,
  householdSnapshot,
  linkGuardian,
  linkHouseholdGuardians,
  mergeFamily,
  mergeHouseholds,
  normalizedChildName,
  normalizedIdNumber,
  publicChildMatchPayload,
  publicFamilyCandidatesPayload,
  setPrimaryGuardian,
  splitFamily,
  unlinkGuardian,
} from './studentGuardians.js';
import {
  createShopPurchase,
  findShopItemBySlug,
  isSellableProductType,
  makeShopSlug,
  publicShopItems,
  shopItemPayload,
} from './publicShop.js';
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
  markEquipmentOwn,
  markEquipmentUnpaid,
  markEquipmentDeclined,
  computeEquipmentTotal,
  describeEquipmentItems,
  equipmentGapFlags,
  unpaidEquipmentItems,
  newCheckoutToken,
  ensureEquipmentWhatsappTemplate,
  equipmentPublicBase,
  shoesSeasonPricing,
} from './equipmentService.js';
import { safetyTestStatus } from './safetyTestService.js';
import {
  EVENT_HOST_PAYMENT_TEMPLATE,
  EVENT_PARTICIPANT_LINK_TEMPLATE,
  ensureEventWhatsappTemplates,
  findApprovedEventTemplate,
  resolveEventTemplate,
  publicBase as eventPublicBase,
} from './eventWhatsappTemplates.js';
import { ensureOnboardingLinkTemplate } from './onboardingWhatsappTemplate.js';
import { ensureAgendaDigestTemplate } from './agendaDigestTemplate.js';
import {
  ensureProductCategories,
  renameCategoryOnProducts,
  normalizeProductCategories,
  backfillPricelistCategories,
  clampImage,
} from './productCategories.js';
import {
  DEFAULT_BUSINESS_PROFILE,
  getBusinessProfile,
  saveBusinessProfile,
  safeBusinessProfile,
} from './businessProfile.js';
import {
  getEmployeeOnboardConfig,
  saveEmployeeOnboardConfig,
  mergeFieldDefs,
  publicFieldDefs,
  buildEmployeeFromSubmission,
} from './employeeOnboardingForm.js';
import { calculateDashboardStats } from './dashboardStats.js';
import { applyBusinessBrand, resetPlaygroundConversation } from './whatsappBot.js';
import { waitForMessages, currentVersion } from './liveUpdates.js';
import { shouldMarkIntroPaid } from './introStatus.js';
import { countEnrolled } from './groupCapacity.js';
import { enrichStudentsWithGroupIds, studentInGroup } from './studentGroups.js';
import {
  ensureAttendanceRows,
  israelDateStr,
  israelHour,
  normalizeAttStatus,
  isIntroStudent,
  keepIntroStatus,
  consecutiveAbsences,
  activityDateRange,
  planVacationAttendanceUpdates,
  planVacationAttendanceReverts,
  findTrainingVacation,
  VACATION_ACTIVITY_TYPE,
  VACATION_ATT_STATUS,
  VACATION_MARKER,
} from './attendanceUtils.js';
import {
  PAY_MODES,
  ratesOf,
  travelPerDay,
  rateForRole,
  amountForWorkRow,
  roundHoursHalfUp,
  summarizeWork,
  workTypeRole,
  applyRoleLabels,
} from './wageRates.js';
import {
  getConversation,
  listConversations,
  replyToParent,
  updateMessageStatusByMetaId,
  handleMessengerIncoming,
  markCommunicationHandled,
  markAllCommunicationsHandled,
  setBotState,
  draftReply,
} from './channels/conversations.js';
import {
  rebuildLogMirrorFromMessages,
  startPendingMessageRetry,
  flushPendingMessages,
  countPendingMessages,
  applyMessageEditByMetaId,
  applyMessageRevokeByMetaId,
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
  'https://app.kirboaz.co.il',
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

/**
 * A body over the limit, or malformed JSON, otherwise leaves the parser as an
 * HTML error page. Every public form reads `res.json()` and falls back to a
 * blank object, so the family was shown "שגיאה בשמירת הטופס" with no hint that
 * the attachment was the problem. Answering in JSON makes the cause reach them.
 */
app.use((err, _req, res, next) => {
  if (!err || !err.status) return next(err);
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'הקבצים המצורפים גדולים מדי לשליחה. צלמו את האישור בטלפון במקום לצרף קובץ סרוק',
    });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'הבקשה לא התקבלה כראוי — נסו לשלוח שוב' });
  }
  return next(err);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. CRM GENERAL ENDPOINTS (Database Synced)
// ─────────────────────────────────────────────────────────────────────────────

// Health check endpoint for uptime monitoring & keep-alive.
// `/api/health/deep` (or legacy `?deep=1`) also probes the durable store and
// message write queue, so a monitor can tell "alive" from "actually able to serve".
app.get(['/api/health', '/api/health/deep'], async (req, res) => {
  const base = {
    status: 'UP',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  };

  if (!req.query.deep && req.path !== '/api/health/deep') {
    return res.status(200).json(base);
  }

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

const DEFAULT_BRAND_NAME = DEFAULT_BUSINESS_PROFILE.display_name;

/** Business name for customer-facing text; follows the saved business profile. */
async function businessBrand() {
  try {
    return (await getBusinessProfile()).display_name || DEFAULT_BRAND_NAME;
  } catch {
    return DEFAULT_BRAND_NAME;
  }
}

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
          `<p>פנו לצוות ${DEFAULT_BRAND_NAME} לקבלת קישור חדש.</p></body></html>`
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

/**
 * Short link behind the approved equipment template button. Meta freezes the
 * button host, so it points here and the app address is resolved per click —
 * moving the site to another domain never needs a new template approval.
 */
function redirectEquipmentCheckout(req, res) {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).send('חסר מזהה תשלום');
  const target = `${equipmentPublicBase()}/equipment/${encodeURIComponent(token)}`;
  return res.redirect(302, target);
}
app.get('/e/:token', redirectEquipmentCheckout);
app.get('/api/e/:token', redirectEquipmentCheckout);

/**
 * Short link to a group's registration page.
 *
 * The community centre's own address carries the class name in the query
 * string, so it arrives in WhatsApp as four lines of percent-encoding — ugly,
 * and impossible to tell apart from the next one. This is `/s/<group>/<freq>`
 * and it looks up the real address at click time, which also means a link
 * already sent to a family keeps working after the centre changes theirs.
 */
function redirectGroupSignup(req, res) {
  const id = String(req.params.groupId || '').trim();
  const twice = String(req.params.freq || '').toLowerCase() === '2';
  const group = db.getOne('groups', id);
  if (!group) return res.status(404).send('הקבוצה לא נמצאה');
  const target = twice
    ? (group.signupLinkTwice || group.signupLinkWeek)
    : (group.signupLinkWeek || group.signupLinkTwice);
  if (!target) return res.status(404).send('אין קישור הרשמה לקבוצה הזו');
  return res.redirect(302, target);
}
app.get('/s/:groupId/:freq', redirectGroupSignup);
app.get('/s/:groupId', redirectGroupSignup);
app.get('/api/s/:groupId/:freq', redirectGroupSignup);
app.get('/api/s/:groupId', redirectGroupSignup);

/** Same contract as /e, for the two approved event template buttons. */
function eventRedirect(pagePath) {
  return (req, res) => {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).send('חסר מזהה אירוע');
    const target = `${eventPublicBase()}${pagePath}/${encodeURIComponent(token)}`;
    return res.redirect(302, target);
  };
}
const redirectEventHost = eventRedirect('/event-host');
const redirectEventParticipant = eventRedirect('/event');
app.get('/eh/:token', redirectEventHost);
app.get('/api/eh/:token', redirectEventHost);
app.get('/ev/:token', redirectEventParticipant);
app.get('/api/ev/:token', redirectEventParticipant);

/**
 * Onboarding form behind an approved template button. Same contract as /e and
 * /ev, with no token: the form identifies the customer by the phone they type.
 * `?phone=` is passed through when a caller already knows it, so the form opens
 * prefilled instead of asking a returning customer to type it again.
 */
function redirectOnboarding(req, res) {
  const phone = String(req.query.phone || '').trim();
  const query = phone ? `?phone=${encodeURIComponent(phone)}` : '';
  return res.redirect(302, `${eventPublicBase()}/onboard${query}`);
}
app.get('/o', redirectOnboarding);
app.get('/api/o', redirectOnboarding);

/**
 * The intake form for one trainee: `/f/<studentId>`.
 *
 * The long form is `/register?studentId=…`, and a query string at the end of a
 * WhatsApp message is exactly what stops the link being tappable — there is a
 * comment elsewhere in this file working around that by choosing the shortest
 * possible parameter. A path segment has no such problem.
 */
function redirectIntakeForm(req, res) {
  const studentId = String(req.params.studentId || '').trim();
  if (!studentId) return res.status(400).send('חסר מזהה מתאמן');
  return res.redirect(302, `${eventPublicBase()}/register?studentId=${encodeURIComponent(studentId)}`);
}
app.get('/f/:studentId', redirectIntakeForm);
app.get('/api/f/:studentId', redirectIntakeForm);

/** The same form keyed by phone, for a family with no trainee record yet. */
function redirectIntakeByPhone(req, res) {
  const phone = String(req.params.phone || '').replace(/\D/g, '');
  if (!phone) return res.status(400).send('חסר טלפון');
  return res.redirect(302, `${eventPublicBase()}/register?phone=${encodeURIComponent(phone)}`);
}
app.get('/fp/:phone', redirectIntakeByPhone);
app.get('/api/fp/:phone', redirectIntakeByPhone);

/**
 * The intake form pointed at a group: `/g/<groupId>[/<phone>]`.
 *
 * The long form carried the class name as a query parameter, which arrived in
 * WhatsApp as lines of percent-encoded Hebrew. The label is looked up here, so
 * renaming a group no longer strands the links already sent for it.
 */
function redirectGroupIntake(req, res) {
  const group = db.getOne('groups', String(req.params.groupId || '').trim());
  if (!group) return res.status(404).send('הקבוצה לא נמצאה');
  const params = new URLSearchParams();
  params.set('interest', `${group.ageCategory || group.name || ''}`.trim());
  const phone = String(req.params.phone || '').replace(/\D/g, '');
  if (phone) params.set('phone', phone);
  return res.redirect(302, `${eventPublicBase()}/onboard?${params.toString()}`);
}
app.get('/g/:groupId/:phone', redirectGroupIntake);
app.get('/g/:groupId', redirectGroupIntake);
app.get('/api/g/:groupId/:phone', redirectGroupIntake);
app.get('/api/g/:groupId', redirectGroupIntake);

app.use('/api', apiAuth);

app.get('/api/auth/me', (req, res) => {
  res.json(req.crmUser);
});

app.get('/api/dashboard/stats', requireOwner, async (_req, res) => {
  try {
    const cached = {
      sales: db.get('pos_sales') || [],
      parents: db.get('parents') || [],
      students: db.get('students') || [],
      history: db.get('lead_status_history') || [],
    };
    const [sales, parents, students, history] = await Promise.all([
      supa.getAll('pos_sales'),
      supa.getAll('parents'),
      supa.getAll('students'),
      supa.getAll('lead_status_history'),
    ]);
    res.json(calculateDashboardStats({
      sales: sales ?? cached.sales,
      parents: parents ?? cached.parents,
      students: students ?? cached.students,
      history: history ?? cached.history,
    }));
  } catch (error) {
    console.error('GET /api/dashboard/stats failed:', error.message);
    res.json(calculateDashboardStats({
      sales: db.get('pos_sales') || [],
      parents: db.get('parents') || [],
      students: db.get('students') || [],
      history: db.get('lead_status_history') || [],
    }));
  }
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

/**
 * A ceiling on the public forms, and deliberately a high one.
 *
 * The key is `req.ip`, and with `trust proxy: 1` that is the address of the
 * nearest proxy — not the family's. The app is served through a rewrite, so in
 * production the bucket is effectively shared by everyone filling a form at the
 * same time. One completed registration costs 8 requests (context, code, code
 * check, family check, child check, submit, template, PDF), so a limit of 20
 * meant the second family anywhere in the country met "too many requests" and
 * could not register for a quarter of an hour.
 *
 * What actually stops abuse is not this counter. The expensive action — sending
 * a WhatsApp code — is capped per phone number in `otpService` at four in
 * fifteen minutes, and nothing is filed at all without a code that came back.
 * This is left as a backstop against a script hammering the reads, at a level
 * no real family can reach.
 */
const publicRequestWindows = new Map();
const PUBLIC_RATE_WINDOW_MS = 15 * 60 * 1000;
const PUBLIC_RATE_MAX = 400;

function publicFormRateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const current = publicRequestWindows.get(key);
  if (!current || current.resetAt <= now) {
    if (publicRequestWindows.size > 5000) {
      for (const [storedKey, value] of publicRequestWindows) {
        if (value.resetAt <= now) publicRequestWindows.delete(storedKey);
      }
    }
    publicRequestWindows.set(key, { count: 1, resetAt: now + PUBLIC_RATE_WINDOW_MS });
    return next();
  }
  current.count += 1;
  if (current.count > PUBLIC_RATE_MAX) {
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
      const [rows, enrollments, guardians] = await Promise.all([
        supa.getAll('students'),
        supa.getAll('enrollments'),
        supa.getAll('student_guardians'),
      ]);
      if (rows) {
        if (typeof db.set === 'function') db.set('students', rows);
        if (enrollments && typeof db.set === 'function') db.set('enrollments', enrollments);
        if (guardians && typeof db.set === 'function') db.set('student_guardians', guardians);
        // Same enrichment as the local path — a screen must never see a child
        // with groups but no guardians just because the fresh read was used.
        return res.json(db.withStudentRelations(rows));
      }
    }
  } catch (err) {
    console.error('GET /api/students Supabase error:', err.message);
  }
  res.json(db.withStudentRelations(db.get('students')));
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
      const [rows, studentRows, enrollments] = await Promise.all([
        supa.getAll('groups'),
        supa.getAll('students'),
        supa.getAll('enrollments'),
      ]);
      if (rows) {
        const students = enrichStudentsWithGroupIds(
          studentRows || db.get('students') || [],
          enrollments || db.get('enrollments') || []
        );
        // Keep the local cache warm for write paths that still use db.json.
        if (typeof db.set === 'function') {
          db.set('groups', rows);
          if (studentRows) db.set('students', studentRows);
          if (enrollments) db.set('enrollments', enrollments);
        }
        return res.json(withGroupEnrollmentCounts(rows, students));
      }
    }
  } catch (err) {
    console.error('GET /api/groups Supabase error:', err.message);
  }
  res.json(withGroupEnrollmentCounts(db.get('groups'), db.withStudentRelations(db.get('students'))));
});

// Update student status
app.put('/api/students/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const updated = db.update('students', id, { status });
  if (!updated) return res.status(404).json({ error: 'Student not found' });
  
  // Trigger automation event
  automationsService.triggerEvent('status_changed', { ...updated, new_status: status });
  touchGoogleContacts();

  res.json(updated);
});

// Shared lead intake helper (CRM + public form)
async function ingestLeadPayload(body, defaultSource = 'unknown') {
  const { parentName, lastName, idNumber, phone, email, children, city, source, interest } = body;
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
    lastName: lastName || '',
    idNumber: idNumber || '',
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

  touchGoogleContacts();
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

// ─── Employee onboarding link (public) ────────────────────────────────────
app.get('/api/public/employee-onboard-fields', publicFormRateLimit, async (_req, res) => {
  try {
    const config = await getEmployeeOnboardConfig();
    res.json({ fields: publicFieldDefs(config) });
  } catch (error) {
    console.error('employee-onboard-fields load error:', error.message);
    res.json({ fields: publicFieldDefs(await getEmployeeOnboardConfig()) });
  }
});

app.post('/api/public/employee-onboard', publicFormRateLimit, async (req, res) => {
  try {
    const config = await getEmployeeOnboardConfig();
    const { employee, error } = buildEmployeeFromSubmission(req.body?.answers, config);
    if (error) return res.status(400).json({ error });
    const created = db.insert('employees', employee);
    const durable = await persistCore('employees', created);
    if (!durable.ok) {
      console.error('employee onboarding durable write failed:', durable.error);
    }
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('employee onboarding submit error:', error.message);
    res.status(500).json({ error: 'שמירת הפרטים נכשלה — נסו שוב' });
  }
});

// Admin editor for which fields the onboarding form asks for
app.get('/api/settings/employee-onboard-fields', requireOwner, async (_req, res) => {
  try {
    res.json(mergeFieldDefs(await getEmployeeOnboardConfig({ fresh: true })));
  } catch (error) {
    res.status(503).json({ error: error.message || 'טעינת הגדרות הטופס נכשלה' });
  }
});

app.put('/api/settings/employee-onboard-fields', requireOwner, async (req, res) => {
  try {
    const config = await saveEmployeeOnboardConfig(req.body?.fields);
    res.json(mergeFieldDefs(config));
  } catch (error) {
    res.status(400).json({ error: error.message || 'שמירת הגדרות הטופס נכשלה' });
  }
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
app.put('/api/parents/:id', async (req, res) => {
  const { id } = req.params;
  const allowed = [
    'name',
    'lastName',
    'idNumber',
    'phone',
    'email',
    'city',
    'source',
    'notes',
    'icount_client_id',
    'status',
    'nextFollowup',
  ];
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
        {
          city: updates.city,
          lastName: updates.lastName,
          idNumber: updates.idNumber,
          source: updates.source,
          status: updates.status,
          nextFollowup: updates.nextFollowup,
        }
      );
      // Wait for the durable store — a refresh right after save would otherwise
      // pull the pre-merge card and look like the edit never happened.
      const durable = await persistCore('parents', merged);
      if (durable?.ok === false) {
        return res.status(503).json({ error: durable.error || 'העדכון לא נשמר' });
      }
      touchGoogleContacts();
      return res.json(merged);
    }
  }

  const updated = db.update('parents', id, updates);
  if (!updated) return res.status(404).json({ error: 'Parent not found' });
  const durable = await persistCore('parents', updated);
  if (durable?.ok === false) {
    return res.status(503).json({ error: durable.error || 'העדכון לא נשמר' });
  }
  touchGoogleContacts();
  res.json(updated);
});

/** What a record still attached to the card is called, for the refusal message. */
const DELETE_BLOCKER_LABELS = {
  activity_registration_orders: 'הזמנות לאירוע',
  activity_registrations: 'הרשמות לאירוע',
  health_declarations: 'הצהרות בריאות',
  client_documents: 'מסמכים',
  student_equipment: 'ציוד',
  messages: 'התכתבויות',
  payments: 'תשלומים',
  lead_status_history: 'היסטוריית סטטוס',
  enrollments: 'רישום לחוג',
  attendance: 'נוכחות',
  students: 'מתאמנים',
};

/**
 * Turn a foreign-key refusal from the durable store into something the screen
 * can show. Postgres names the blocking table last: `… on table "x"`.
 */
function durableDeleteMessage(error, fallback) {
  const tables = [...String(error || '').matchAll(/on table "([a-z_]+)"/g)].map((m) => m[1]);
  const blocker = tables.length ? tables[tables.length - 1] : '';
  const label = DELETE_BLOCKER_LABELS[blocker];
  if (label) return `לא ניתן למחוק — לכרטיס משויכות ${label}. יש להסיר אותן קודם`;
  return fallback;
}

/**
 * Archive is the answer for a customer who cannot be deleted — one who took part
 * in an event that already happened. The flag lives on the payer, so the whole
 * family leaves the working lists together and comes back together.
 */
app.post('/api/parents/:id/archive', async (req, res) => {
  const archived = req.body?.archived !== false;
  const updated = db.update('parents', req.params.id, {
    status: archived ? 'archived' : 'lead_new',
  });
  if (!updated) return res.status(404).json({ error: 'הלקוח לא נמצא' });
  const durable = await persistCore('parents', updated);
  if (durable?.ok === false) {
    return res.status(503).json({ error: durable.error || 'העדכון לא נשמר' });
  }
  touchGoogleContacts();
  res.json({ success: true, archived, parent: updated });
});

/**
 * Refuse to delete someone who still holds a place on an event. Deleting them
 * leaves a participant on the list that no CRM card explains — the registration
 * has to be cancelled from the event screen first. The durable store is the
 * authority: a stale cache would let the delete through.
 * @param {'student_id'|'parent_id'} field
 */
async function activeRegistrationBlock(field, id) {
  if (supa.isEnabled()) {
    const remote = await supa.getAll('activity_registrations');
    if (remote) db.set('activity_registrations', remote);
  }
  const held = heldRegistrationsBy(db, field, id);
  if (!held.length) return null;

  const today = israelDateStr();
  const upcoming = [];
  const past = [];
  for (const registration of held) {
    const activity = db.getOne('activities', registration.activity_id);
    const lastDay = String(activity?.end_date || activity?.date || '').slice(0, 10);
    // A dateless activity counts as still open — never advise archiving by guess.
    (lastDay && lastDay < today ? past : upcoming).push(activity?.name || '');
  }
  const names = (list) => {
    const unique = [...new Set(list.filter(Boolean))];
    return unique.length ? `: ${unique.join(', ')}` : '';
  };

  if (upcoming.length) {
    return `לא ניתן למחוק — קיימת הרשמה פעילה לאירוע${names(upcoming)}. יש לבטל אותה במסך האירוע ואז למחוק`;
  }
  // The event already happened. Cancelling the registration now would falsify who
  // took part, so deletion is not the tool here.
  return `לא ניתן למחוק — קיימת היסטוריית השתתפות באירוע${names(past)}. אפשר להעביר את הכרטיס לארכיון במקום למחוק`;
}

app.delete('/api/parents/:id', async (req, res) => {
  const { id } = req.params;
  const linked = (db.get('students') || []).filter((s) => s.parentId === id);
  if (linked.length) {
    return res.status(400).json({ error: 'לא ניתן למחוק — יש מתאמנים מקושרים' });
  }
  const registered = await activeRegistrationBlock('parent_id', id);
  if (registered) return res.status(409).json({ error: registered });
  const result = await db.deleteDurable('parents', id);
  if (result.notFound) return res.status(404).json({ error: 'הלקוח לא נמצא' });
  if (!result.ok) {
    return res.status(409).json({
      error: durableDeleteMessage(result.error, 'מחיקת הלקוח נכשלה בשרת הנתונים'),
      detail: result.error,
    });
  }
  touchGoogleContacts();
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

  touchGoogleContacts();
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
  const geminiKey = String(process.env.GEMINI_API_KEY || '').trim();
  res.json({
    ...safe,
    hasAccessToken: !!(metaWaAccessToken && !metaWaAccessToken.includes('YOUR_')),
    hasInstagramAccessToken: !!(metaIgAccessToken && !metaIgAccessToken.includes('YOUR_')),
    hasMessengerAccessToken: !!(metaPageAccessToken && String(metaPageAccessToken).length > 10),
    verifyTokenConfigured: !!verifyToken,
    geminiConfigured: !!(geminiKey && !geminiKey.includes('YOUR_')),
    credentialsManagedByServer: !!(
      process.env.META_WA_PHONE_NUMBER_ID &&
      process.env.META_WA_ACCESS_TOKEN
    ),
  });
});

/**
 * What the bot has been doing — one journal for actions and messages both.
 * Read-only, and open to the team: seeing it is how a systematic mistake gets
 * caught before it repeats a hundred times.
 */
app.get('/api/bot/activity', (req, res) => {
  const { kind = '', type = '', parentId = '', since = '', limit = '200' } = req.query || {};
  res.json({
    types: BOT_ACTION_TYPES,
    summary: botActionSummary(db, { since }),
    actions: listBotActions(db, { kind, type, parentId, since, limit: Number(limit) || 200 }),
  });
});

/**
 * The bot's capability switches. Read by any signed-in team member so the panel
 * can render, written by the owner only — turning off "placement" changes what
 * the bot may do to customer records.
 */
app.get('/api/whatsapp/capabilities', (req, res) => {
  res.json({ capabilities: capabilityState(db.getSettings()) });
});

app.put('/api/whatsapp/capabilities', requireOwner, async (req, res) => {
  const incoming = req.body?.capabilities;
  if (!incoming || typeof incoming !== 'object') {
    return res.status(400).json({ error: 'חסרות הגדרות לעדכון' });
  }
  const patch = {};
  for (const key of CAPABILITY_KEYS) {
    if (incoming[key] === undefined) continue;
    patch[capabilitySettingKey(key)] = !!incoming[key];
  }
  // A capability may own one free-text setting — the community centre's phone
  // numbers, so a change of secretary is a field the owner edits, not a deploy.
  const values = req.body?.values;
  if (values && typeof values === 'object') {
    for (const key of CAPABILITY_INPUT_KEYS) {
      if (values[key] === undefined) continue;
      patch[key] = String(values[key] || '').slice(0, 300);
    }
  }
  if (!Object.keys(patch).length) {
    return res.status(400).json({ error: 'לא נשלחה אף יכולת מוכרת' });
  }
  try {
    // saveSettings merges, so an untouched switch keeps its value.
    const saved = db.saveSettings({ ...db.getSettings(), ...patch });
    console.log(`🤖 Bot capabilities updated by ${req.crmUser?.email || 'unknown'}:`, JSON.stringify(patch));
    res.json({ capabilities: capabilityState(saved) });
  } catch (error) {
    console.error('capabilities update failed:', error.message);
    res.status(500).json({ error: 'שמירת ההגדרות נכשלה' });
  }
});

// Toggle bot on/off immediately (staff + owner) — awaits durable store write
app.post('/api/whatsapp/bot-enabled', async (req, res) => {
  const enabled = !!req.body?.enabled;
  try {
    const settings = await setBotEnabledDurable(enabled);
    console.log(`🤖 Bot auto-reply ${enabled ? 'enabled' : 'disabled'} by ${req.crmUser?.email || 'unknown'}`);
    res.json({
      aiResponderEnabled: !!settings.aiResponderEnabled,
      message: enabled ? 'הבוט הופעל' : 'הבוט כובה',
    });
  } catch (error) {
    console.error('bot-enabled failed:', error?.message || error);
    res.status(500).json({ error: 'שמירת מצב הבוט נכשלה' });
  }
});

// Update WhatsApp Settings
app.post('/api/whatsapp/settings', requireOwner, async (req, res) => {
  const allowed = [
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
    'aiClarifyReply',
    'aiUnsureReply',
    'aiToolsEnabled',
    'aiLeadCaptureEnabled',
    'aiInteractiveMenuEnabled',
    'aiGreetingMenu',
    'aiReactivateKeywords',
    'aiStaffPhones',
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
  // Master switch is only changed via POST /api/whatsapp/bot-enabled
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
  if (payload.aiToolsEnabled !== undefined) {
    payload.aiToolsEnabled = !!payload.aiToolsEnabled;
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

/**
 * Long poll for the conversation panel: the request waits until a message is
 * actually stored, so a customer's reply appears at once instead of on the next
 * timer tick. `since` is the version the screen last saw; a reply with
 * `changed: false` simply means the wait timed out and the screen asks again.
 */
app.post('/api/updates/messages', async (req, res) => {
  const since = Number(req.body?.since) || 0;
  // Ahead of the server (restart) — resync immediately rather than hang.
  if (since > currentVersion()) {
    return res.json({ version: currentVersion(), changed: true });
  }
  const result = await waitForMessages({ since, timeoutMs: 25000 });
  res.json(result);
});

// Embedded Signup public config (no secrets)
app.get('/api/whatsapp/connect-config', (req, res) => {
  res.json(whatsappConnectService.getConnectConfig());
});

// Conversation engine status for the connections tab.
// A plain read only reports whether a key is present; ?test=1 spends a real
// call on the model, so it stays behind the owner guard.
app.get('/api/ai/status', async (req, res) => {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  const configured = !!(key && !key.includes('YOUR_'));
  const preferredModel = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  if (req.query.test !== '1') {
    return res.json({ configured, preferredModel });
  }
  if (!configured) {
    return res.json({ configured, preferredModel, tested: true, ok: false, error: 'לא הוגדר מפתח מודל בשרת' });
  }
  const models = [preferredModel, 'gemini-3.6-flash', 'gemini-3.5-flash'];
  let lastError = '';
  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'ענה במילה אחת: תקין' }] }],
          generationConfig: { temperature: 0 },
        }),
      });
      if (response.ok) {
        return res.json({ configured, preferredModel, tested: true, ok: true, model, testedAt: new Date().toISOString() });
      }
      const body = await response.text().catch(() => '');
      lastError = `${model}: HTTP ${response.status} ${body.slice(0, 160)}`;
    } catch (err) {
      lastError = `${model}: ${err.message}`;
    }
  }
  res.json({ configured, preferredModel, tested: true, ok: false, error: lastError });
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
// Inbox list — every conversation at once. Must stay above the :parentId route
// so "conversations" is never read as a customer id.
app.get('/api/conversations', (req, res) => {
  try {
    const limit = Number(req.query.limit);
    res.json(listConversations(Number.isFinite(limit) && limit > 0 ? { limit } : {}));
  } catch (err) {
    console.error('Error listing conversations:', err);
    res.status(500).json({ error: err.message || 'טעינת השיחות נכשלה' });
  }
});

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

// One segment only, so it can never be read as a customer id by the routes below.
app.post('/api/conversations/handled-all', async (req, res) => {
  try {
    res.json(await markAllCommunicationsHandled());
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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

app.post('/api/conversations/:parentId/bot', async (req, res) => {
  try {
    const result = await setBotState(req.params.parentId, req.body?.action, {
      minutes: req.body?.minutes,
    });
    if (!result.success) return res.status(result.status || 400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/conversations/:parentId/draft', async (req, res) => {
  try {
    const result = await draftReply(req.params.parentId, req.body || {});
    if (!result.success) return res.status(result.status || 400).json(result);
    res.json(result);
  } catch (err) {
    console.error('AI draft failed:', err);
    res.status(500).json({ success: false, error: err.message || 'ניסוח התשובה נכשל' });
  }
});

// ─── Message templates ───────────────────────────────────────────────────────
app.get('/api/message-templates', (req, res) => {
  try {
    ensureEventWhatsappTemplates({
      db,
      persist: persistCore,
    });
    ensureOnboardingLinkTemplate({ db, persist: persistCore });
    ensureAgendaDigestTemplate({ db, persist: persistCore });
  } catch (err) {
    console.warn('event whatsapp templates ensure on list skipped:', err.message);
  }
  const approvedOnly = req.query.approved === '1' || req.query.approved === 'true';
  const includeArchived = req.query.archived === '1' || req.query.archived === 'true';
  res.json(approvedOnly ? listApprovedTemplates({ includeArchived }) : listLocalTemplates());
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

/** Meta webhook timestamp → ISO (seconds or milliseconds). */
function metaTimestampToIso(timestamp) {
  if (timestamp == null || timestamp === '') return new Date().toISOString();
  const n = Number(timestamp);
  if (!Number.isFinite(n)) return new Date().toISOString();
  return new Date(n > 1e12 ? n : n * 1000).toISOString();
}

/**
 * Coexistence edit / revoke (customer messages field or business phone echoes).
 * Updates the original stored row; returns true when the event was consumed.
 */
function applyWhatsAppEditOrRevoke(message = {}) {
  if (message.type === 'edit') {
    const originalId = message.edit?.original_message_id;
    if (!originalId) {
      console.warn('WhatsApp edit webhook missing original_message_id');
      return true;
    }
    const inner = message.edit?.message || {};
    const text = whatsappConnectService.extractMessageText(inner);
    const updated = applyMessageEditByMetaId(originalId, {
      text,
      at: metaTimestampToIso(message.timestamp),
    });
    console.log(
      updated
        ? `✏️ WhatsApp edit applied to ${originalId}`
        : `✏️ WhatsApp edit for unknown message ${originalId}`
    );
    return true;
  }
  if (message.type === 'revoke') {
    const originalId = message.revoke?.original_message_id;
    if (!originalId) {
      console.warn('WhatsApp revoke webhook missing original_message_id');
      return true;
    }
    const updated = applyMessageRevokeByMetaId(originalId, {
      at: metaTimestampToIso(message.timestamp),
    });
    console.log(
      updated
        ? `🗑️ WhatsApp revoke applied to ${originalId}`
        : `🗑️ WhatsApp revoke for unknown message ${originalId}`
    );
    return true;
  }
  return false;
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

  // Inbound customer messages (live) — edit/revoke update the original row.
  if (field === 'messages') {
    for (const message of value.messages || []) {
      if (message.history_context) continue; // history sync handled separately
      if (applyWhatsAppEditOrRevoke(message)) continue;
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
      if (applyWhatsAppEditOrRevoke(echo)) continue;
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

// AI sandbox (owner-only). Always uses a fixed test phone — never sends to Meta.
const PLAYGROUND_PHONE = '0599111000';

function developmentOnly(req, res, next) {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  return next();
}

app.post('/api/whatsapp/simulate-incoming', requireOwner, async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) {
    return res.status(400).json({ error: 'חסרה הודעה לבדיקה' });
  }
  console.log(`📱 [Sandbox] Incoming text from ${PLAYGROUND_PHONE}: "${message}"`);
  try {
    const result = await whatsappService.handleIncomingMessage(PLAYGROUND_PHONE, message, true);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('sandbox simulate-incoming failed:', err.message);
    res.status(500).json({ error: err.message || 'מנוע המענה נכשל' });
  }
});

app.post('/api/whatsapp/playground-reset', requireOwner, async (req, res) => {
  try {
    const result = await resetPlaygroundConversation(PLAYGROUND_PHONE);
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

// Agenda digests — tomorrow's schedule each evening, the week each Saturday
app.get('/api/agenda-digest/settings', async (req, res) => {
  try {
    res.json(await loadAgendaSettings());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/agenda-digest/settings', async (req, res) => {
  try {
    const body = req.body || {};
    const patch = {};
    for (const key of [
      'dailyEnabled', 'weeklyEnabled', 'channel', 'phone', 'email',
      'dailyTime', 'weeklyDay', 'weeklyTime', 'includeGoogle', 'templateName',
    ]) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    res.json(await saveAgendaSettings(patch));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Preview the exact text without sending it anywhere
app.get('/api/agenda-digest/preview', async (req, res) => {
  try {
    const settings = await loadAgendaSettings();
    const kind = req.query.kind === 'weekly' ? 'weekly' : 'daily';
    const start = String(req.query.date || '').slice(0, 10)
      || addAgendaDays(israelDateStr(), 1);
    const digest = kind === 'weekly'
      ? await buildWeeklyDigest(start, settings)
      : await buildDailyDigest(start, settings);
    res.json({ kind, ...digest, events: digest.items.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/agenda-digest/send-now', async (req, res) => {
  try {
    const kind = req.body?.kind === 'weekly' ? 'weekly' : 'daily';
    const start = String(req.body?.date || '').slice(0, 10)
      || addAgendaDays(israelDateStr(), 1);
    // A manual send must not tick the "already sent tonight" marker.
    const result = kind === 'weekly'
      ? await sendWeeklyDigest(start, { record: false })
      : await sendDailyDigest(start, { record: false });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Cron / external scheduler: run whichever digest this evening still owes
app.post('/api/agenda-digest/run-due', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.get('x-cron-secret') !== secret && req.query.secret !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const result = await runAgendaDigestsIfDue();
    res.json({ ok: true, ...(result || { skipped: true }) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
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

// ─── הצעות AI ומשימות ────────────────────────────────────────────────────────
// המודל מציע, הצוות מאשר, הקוד מבצע. אישור הוא הפעולה היחידה שכותבת ל-CRM.

app.get('/api/ai/suggestions', (req, res) => {
  const status = req.query.status === 'all' ? null : (req.query.status || SUGGESTION_PENDING);
  const rows = listSuggestions(db, {
    status,
    parentId: req.query.parentId || null,
    scenarioId: req.query.scenarioId || null,
  });
  res.json(rows.map((row) => enrichForDisplay(db, row)));
});

// ─── תרחישים: מה העוזר מורשה להציע. הרשימה הפעילה היא רשימת ההיתר של המודל ───

app.get('/api/ai/scenarios', (req, res) => {
  res.json(listScenarios(db, { enabledOnly: req.query.enabled === '1' }));
});

app.post('/api/ai/scenarios', async (req, res) => {
  try {
    const row = await createScenario({
      db,
      persist: persistCore,
      input: req.body || {},
      actor: req.crmUser?.email || '',
    });
    res.status(201).json(row);
  } catch (err) {
    if (!err.status) console.error('create scenario error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.put('/api/ai/scenarios/:id', async (req, res) => {
  try {
    const row = await updateScenario({ db, persist: persistCore, id: req.params.id, patch: req.body || {} });
    res.json(row);
  } catch (err) {
    if (!err.status) console.error('update scenario error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.delete('/api/ai/scenarios/:id', async (req, res) => {
  try {
    await deleteScenario({ db, id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    if (!err.status) console.error('delete scenario error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/ai/scenarios/stats', (req, res) => {
  res.json(scenarioStats(db));
});

app.get('/api/ai/assistant-settings', (req, res) => {
  res.json(loadAssistantSettings(db));
});

app.put('/api/ai/assistant-settings', async (req, res) => {
  try {
    const saved = await saveAssistantSettings({ db, persist: persistCore, patch: req.body || {} });
    console.log(`🧠 AI assistant settings updated by ${req.crmUser?.email || 'unknown'}`);
    res.json(saved);
  } catch (err) {
    if (!err.status) console.error('save assistant settings error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/ai/suggestions/:id/approve', async (req, res) => {
  try {
    const result = await approveSuggestion({
      db,
      persist: persistCore,
      id: req.params.id,
      actor: req.crmUser?.email || '',
    });
    res.json({
      success: true,
      suggestion: enrichForDisplay(db, result.suggestion),
      // רק `create_task` מייצר משימה. לשאר הפעולות אין משימה להחזיר.
      task: result.task ? enrichForDisplay(db, result.task) : null,
    });
  } catch (err) {
    if (!err.status) console.error('approve suggestion error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/ai/suggestions/:id/reject', async (req, res) => {
  try {
    const row = await rejectSuggestion({
      db,
      persist: persistCore,
      id: req.params.id,
      actor: req.crmUser?.email || '',
      note: req.body?.note || '',
    });
    res.json({ success: true, suggestion: enrichForDisplay(db, row) });
  } catch (err) {
    if (!err.status) console.error('reject suggestion error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── Bot learning (rate replies → approve into prompt examples) ───────────────
app.get('/api/bot-learning/feedback', (req, res) => {
  try {
    const status = req.query.status || '';
    res.json({
      items: listFeedback(db, status ? { status } : {}),
      stats: feedbackStats(db, { days: 7 }),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bot-learning/feedback', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await recordFeedback({
      db,
      persist: persistCore,
      messageId: body.messageId || body.message_id,
      parentId: body.parentId || body.parent_id || null,
      phone: body.phone || '',
      rating: body.rating,
      note: body.note || '',
      alternative: body.alternative || '',
      replyExcerpt: body.replyExcerpt || body.reply_excerpt || '',
      inboundExcerpt: body.inboundExcerpt || body.inbound_excerpt || '',
      createdBy: req.crmUser?.email || '',
    });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ success: true, feedback: result.row });
  } catch (err) {
    console.error('bot feedback error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bot-learning/feedback/:id/approve', async (req, res) => {
  try {
    const result = await approveFeedback({
      db,
      persist: persistCore,
      id: req.params.id,
      actor: req.crmUser?.email || '',
      editedAlternative: req.body?.alternative,
    });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ success: true, feedback: result.row, learned: result.learned });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bot-learning/feedback/:id/reject', async (req, res) => {
  try {
    const result = await rejectFeedback({
      db,
      persist: persistCore,
      id: req.params.id,
      actor: req.crmUser?.email || '',
    });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ success: true, feedback: result.row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bot-learning/learned', (req, res) => {
  try {
    const activeOnly = req.query.all !== '1';
    res.json({ items: listLearned(db, { activeOnly }) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bot-learning/learned/:id/active', async (req, res) => {
  try {
    const result = await setLearnedActive({
      db,
      persist: persistCore,
      id: req.params.id,
      active: req.body?.active !== false,
    });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ success: true, learned: result.row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * סוכן השיחה — הצוות שואל, המודל קורא נתונים בכלים ועונה.
 * חסר-מצב: ההיסטוריה מגיעה מהלקוח בכל קריאה. פעולות כתיבה לא מבוצעות כאן,
 * הן חוזרות כהצעות ממתינות שעוברות דרך אותם /approve ו-/reject שלמעלה.
 */
app.post('/api/ai/chat', async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  if (!messages.length) return res.status(400).json({ error: 'messages חובה' });

  const settings = loadAssistantSettings(db);
  if (!settings.enabled) {
    return res.status(409).json({ error: 'העוזר החכם כבוי. הדליקו אותו במסך העוזר → הגדרות.' });
  }

  try {
    const result = await runChatTurn({
      db,
      persist: persistCore,
      messages,
      actor: req.crmUser?.email || '',
      page: String(req.body?.page || '').slice(0, 40),
      brandName: await businessBrand(),
    });
    res.json({
      reply: result.reply,
      reason: result.reason,
      tools_used: result.tools_used,
      model_calls: result.model_calls,
      actions: result.proposals.map((row) => enrichForDisplay(db, row)),
    });
  } catch (err) {
    if (!err.status) console.error('ai chat error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** ניתוח ידני של שיחה אחת — עובד גם כשההפעלה האוטומטית כבויה. */
app.post('/api/ai/suggestions/analyze', async (req, res) => {
  const phone = String(req.body?.phone || '').trim();
  if (!phone) return res.status(400).json({ error: 'phone חובה' });
  try {
    const result = await runConversationAnalysis(phone, { auto: false });
    res.json({
      success: true,
      reason: result.reason,
      skipped: result.skipped,
      created: (result.created || []).map((row) => enrichForDisplay(db, row)),
    });
  } catch (err) {
    console.error('analyze conversation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * סריקה לילית — מופעלת מ-Cron חיצוני עם אותו סוד של האוטומציות.
 * `force` מריץ גם כשהמתג הלילי כבוי, כדי שאפשר יהיה לבדוק ידנית.
 */
app.post('/api/ai/suggestions/run-nightly', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const fromCron = secret && req.get('x-cron-secret') === secret;
  // בעלים מחובר יכול להריץ ידנית; בלי כניסה נדרש סוד ה-Cron.
  if (!fromCron && req.crmUser?.role !== 'owner') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const result = await runNightlySweep({ force: req.body?.force === true });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('nightly sweep failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tasks', (req, res) => {
  const status = req.query.status === 'all' ? null : (req.query.status || undefined);
  const rows = listTasks(db, {
    ...(status === undefined ? {} : { status }),
    parentId: req.query.parentId || null,
  });
  res.json(rows.map((row) => enrichForDisplay(db, row)));
});

app.post('/api/tasks', async (req, res) => {
  try {
    const task = await createTask({
      db,
      persist: persistCore,
      input: req.body || {},
      actor: req.crmUser?.email || '',
    });
    res.status(201).json(enrichForDisplay(db, task));
  } catch (err) {
    if (!err.status) console.error('create task error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.put('/api/tasks/:id', async (req, res) => {
  try {
    const task = await updateTask({
      db,
      persist: persistCore,
      id: req.params.id,
      patch: req.body || {},
      actor: req.crmUser?.email || '',
    });
    res.json(enrichForDisplay(db, task));
  } catch (err) {
    if (!err.status) console.error('update task error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Delete student/lead
app.delete('/api/students/:id', async (req, res) => {
  const { id } = req.params;
  const registered = await activeRegistrationBlock('student_id', id);
  if (registered) return res.status(409).json({ error: registered });
  const result = await db.deleteStudent(id);
  if (result.notFound) return res.status(404).json({ error: 'המתאמן לא נמצא' });
  if (!result.ok) {
    return res.status(409).json({
      error: durableDeleteMessage(result.error, 'מחיקת המתאמן נכשלה בשרת הנתונים'),
      detail: result.error,
    });
  }
  touchGoogleContacts();
  res.json({
    success: true,
    // The child is gone either way; say so when the parent card had to stay.
    parentWarning: result.parentError
      ? durableDeleteMessage(result.parentError, 'כרטיס ההורה נשאר במערכת')
      : undefined,
  });
});

// ─── Guardians: the parents attached to one child ────────────────────────────

/** Every parent on the child's file, primary first. */
app.get('/api/students/:id/guardians', (req, res) => {
  const student = db.getOne('students', req.params.id);
  if (!student) return res.status(404).json({ error: 'המתאמן לא נמצא' });
  const parents = guardianParentIds(db, student)
    .map((parentId) => db.getOne('parents', parentId))
    .filter(Boolean)
    .map((parent) => ({
      id: parent.id,
      name: parent.name || '',
      phone: parent.phone || '',
      email: parent.email || '',
      primary: String(parent.id) === String(student.parentId),
    }));
  res.json({ student_id: student.id, guardians: parents });
});

/**
 * Staff adding another contact by hand — the public forms do it themselves.
 *
 * Three ways in, all landing on the same link: an existing card picked by id, a
 * phone that already messaged us and became its own lead card, or a name and
 * phone that are new to the CRM. The number decides which: `upsertParentByPhone`
 * returns the card that owns it rather than minting a second copy.
 *
 * `studentIds` links the whole household in one request. Doing it per child from
 * the browser would race two parallel creates into two duplicate parent cards.
 */
app.post('/api/students/:id/guardians', async (req, res) => {
  const student = db.getOne('students', req.params.id);
  if (!student) return res.status(404).json({ error: 'המתאמן לא נמצא' });

  const askedParentId = String(req.body?.parentId || '').trim();
  let parent = askedParentId ? db.getOne('parents', askedParentId) : null;
  if (askedParentId && !parent) {
    return res.status(400).json({ error: 'כרטיס ההורה לא נמצא' });
  }
  if (!parent) {
    const name = String(req.body?.name || '').trim();
    const phone = String(req.body?.phone || '').trim();
    if (!name || !phone) {
      return res.status(400).json({ error: 'צריך שם וטלפון לאיש הקשר' });
    }
    // No `status` in the extras on purpose: it would overwrite the status of a
    // card that already exists, turning a paying customer back into a new lead.
    parent = db.upsertParentByPhone(name, phone, String(req.body?.email || '').trim(), {});
    if (!parent?.id) return res.status(400).json({ error: 'יצירת איש הקשר נכשלה' });
    await persistCore('parents', parent);
  }
  const parentId = String(parent.id);

  const asked = Array.isArray(req.body?.studentIds) && req.body.studentIds.length
    ? req.body.studentIds.map(String)
    : [String(student.id)];
  const targets = asked.map((id) => db.getOne('students', id)).filter(Boolean);
  if (!targets.length) return res.status(400).json({ error: 'לא נבחר מתאמן לשיוך' });

  const alreadyOn = targets.filter((row) => guardianParentIds(db, row).includes(parentId));
  if (alreadyOn.length === targets.length) {
    return res.status(400).json({ error: 'איש הקשר הזה כבר מופיע בתיק' });
  }

  const linked = [];
  for (const target of targets) {
    const link = linkGuardian(db, { studentId: target.id, parentId, source: 'staff' });
    if (link) await persistCore('student_guardians', link);
    linked.push(String(target.id));
  }
  res.status(201).json({ linked: true, student_ids: linked, parent_id: parentId, parent });
});

/** Who the CRM addresses by default for this child. */
app.put('/api/students/:id/guardians/:parentId/primary', async (req, res) => {
  const result = setPrimaryGuardian(db, {
    studentId: req.params.id,
    parentId: req.params.parentId,
  });
  if (!result) {
    return res.status(400).json({ error: 'אפשר לקבוע כהורה ראשי רק הורה שכבר משויך למתאמן' });
  }
  if (result.changed) {
    await persistCore('students', result.student);
    if (result.added) await persistCore('student_guardians', result.added);
    if (result.removed && supa.isEnabled()) {
      await supa.remove('student_guardians', `sg-${req.params.id}-${req.params.parentId}`);
    }
  }
  res.json({ changed: !!result.changed, student: db.withStudentRelation(result.student) });
});

app.delete('/api/students/:id/guardians/:parentId', async (req, res) => {
  const student = db.getOne('students', req.params.id);
  if (!student) return res.status(404).json({ error: 'המתאמן לא נמצא' });
  if (String(student.parentId || '') === String(req.params.parentId)) {
    return res.status(400).json({
      error: 'אי אפשר להסיר את ההורה הראשי — שנו קודם את השיוך של המתאמן',
    });
  }
  const removed = unlinkGuardian(db, {
    studentId: student.id,
    parentId: req.params.parentId,
  });
  if (removed && supa.isEnabled()) {
    await supa.remove('student_guardians', `sg-${student.id}-${req.params.parentId}`);
  }
  res.json({ removed });
});

/** Household around a parent — for the desk "split family" dialog. */
app.get('/api/parents/:id/household', (req, res) => {
  const snapshot = householdSnapshot(db, req.params.id);
  if (!snapshot) return res.status(404).json({ error: 'הלקוח לא נמצא' });
  res.json(snapshot);
});

/**
 * Undo a bad family merge: each child is assigned to exactly one parent.
 * Children and parent cards stay; only primary + guardian links change.
 */
app.post('/api/parents/:id/split-family', async (req, res) => {
  const anchorId = String(req.params.id || '');
  const snapshot = householdSnapshot(db, anchorId);
  if (!snapshot) return res.status(404).json({ error: 'הלקוח לא נמצא' });

  const assignments = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
  if (!assignments.length) {
    return res.status(400).json({ error: 'יש לשייך כל ילד להורה' });
  }

  const householdParentIds = new Set(snapshot.parents.map((p) => String(p.id)));
  const householdChildIds = new Set(snapshot.children.map((c) => String(c.id)));
  const seenChildren = new Set();

  for (const row of assignments) {
    const studentId = String(row?.studentId || '');
    const parentId = String(row?.parentId || '');
    if (!householdChildIds.has(studentId)) {
      return res.status(400).json({ error: 'אחד הילדים לא שייך למשק הבית הזה' });
    }
    if (!householdParentIds.has(parentId)) {
      return res.status(400).json({ error: 'אחד ההורים לא שייך למשק הבית הזה' });
    }
    if (seenChildren.has(studentId)) {
      return res.status(400).json({ error: 'כל ילד יכול להיות משויך להורה אחד בלבד' });
    }
    seenChildren.add(studentId);
  }

  for (const child of snapshot.children) {
    if (!seenChildren.has(String(child.id))) {
      return res.status(400).json({ error: `חסר שיוך עבור ${child.name || 'ילד'}` });
    }
  }

  const result = splitFamily(db, { assignments });
  if (!result.ok) {
    return res.status(400).json({ error: result.error || 'פיצול המשפחה נכשל' });
  }

  for (const change of result.changes) {
    await persistCore('students', change.student);
    if (supa.isEnabled()) {
      for (const link of change.removed) {
        await supa.remove('student_guardians', link.id);
      }
    }
  }

  res.json({
    ok: true,
    household: householdSnapshot(db, anchorId),
    changed: result.changes.length,
  });
});

/** Families the desk can join this one to — for the "merge families" dialog. */
app.get('/api/parents/:id/merge-candidates', (req, res) => {
  if (!db.getOne('parents', req.params.id)) {
    return res.status(404).json({ error: 'הלקוח לא נמצא' });
  }
  res.json(householdMergeCandidatesPayload(householdMergeCandidates(db, {
    parentId: req.params.id,
    query: String(req.query.q || ''),
  })));
});

/**
 * Two cards that are really one family: every parent joins every child.
 * Nothing is deleted — split-family undoes this in full.
 */
app.post('/api/parents/:id/merge-family', async (req, res) => {
  const result = mergeHouseholds(db, {
    parentId: req.params.id,
    otherParentId: String(req.body?.otherParentId || ''),
  });
  if (!result.ok) {
    return res.status(400).json({ error: result.error || 'מיזוג המשפחות נכשל' });
  }
  for (const link of result.links) await persistCore('student_guardians', link);

  res.json({
    ok: true,
    linked: result.links.length,
    household: householdSnapshot(db, req.params.id),
  });
});

// Update student/lead details (supports multi-group via groupIds / addGroupId / removeGroupId)
app.put('/api/students/:id', async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const {
    addGroupId,
    removeGroupId,
    groupIds,
    groupId,
    ...rest
  } = body;

  const hasGroupIds = Object.prototype.hasOwnProperty.call(body, 'groupIds');
  const hasAdd = Object.prototype.hasOwnProperty.call(body, 'addGroupId');
  const hasRemove = Object.prototype.hasOwnProperty.call(body, 'removeGroupId');
  const hasGroupId = Object.prototype.hasOwnProperty.call(body, 'groupId');

  // Strip membership fields from a plain field update; they are handled below.
  const fieldUpdates = { ...rest };
  delete fieldUpdates.groupIds;
  delete fieldUpdates.addGroupId;
  delete fieldUpdates.removeGroupId;

  let updated = null;
  if (Object.keys(fieldUpdates).length) {
    // Keep groupId out of fieldUpdates when we're managing membership separately,
    // unless it's the only membership signal (legacy single-group set/clear).
    if (hasAdd || hasRemove || hasGroupIds) {
      delete fieldUpdates.groupId;
    } else if (hasGroupId) {
      // Legacy: groupId alone — add without wiping other groups, or clear all if null.
      delete fieldUpdates.groupId;
    }
    if (Object.keys(fieldUpdates).length) {
      updated = db.update('students', id, fieldUpdates);
      if (!updated) return res.status(404).json({ error: 'Student not found' });
    }
  }

  if (!db.getOne('students', id)) {
    return res.status(404).json({ error: 'Student not found' });
  }

  if (hasAdd && addGroupId) {
    updated = db.addStudentToGroup(id, addGroupId);
  } else if (hasRemove) {
    updated = db.removeStudentFromGroup(id, removeGroupId);
  } else if (hasGroupIds) {
    const list = Array.isArray(groupIds) ? groupIds : [];
    updated = db.setStudentGroups(id, list, {
      primaryGroupId: groupId || list[0] || null,
    });
  } else if (hasGroupId) {
    if (groupId) {
      // Add (do not replace other groups) and set as primary.
      const current = db.withStudentRelation(db.getOne('students', id));
      const ids = Array.from(new Set([...(current?.groupIds || []), String(groupId)]));
      updated = db.setStudentGroups(id, ids, { primaryGroupId: groupId });
    } else {
      updated = db.setStudentGroups(id, []);
    }
  }

  if (!updated) updated = db.withStudentRelation(db.getOne('students', id));
  // Same race as parent edit: refresh right after save must see the new fields.
  const durable = await persistCore('students', updated);
  if (durable?.ok === false) {
    return res.status(503).json({ error: durable.error || 'העדכון לא נשמר' });
  }
  touchGoogleContacts();
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

/**
 * Equipment settings for display. Falls back the way it always has.
 * Anything that decides a charge must use `loadEquipmentSettingsForCharge`.
 */
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

/**
 * The same settings, but refusing to invent prices.
 *
 * A transient database read failure used to be indistinguishable from "never
 * configured", and both produced the built-in defaults — which is how a 280 ₪
 * kit could become a 350 ₪ payment link. A checkout that cannot read the real
 * prices must fail; the customer can try again in a minute, but a wrong charge
 * has to be refunded.
 *
 * @throws when the prices cannot be established
 */
async function loadEquipmentSettingsForCharge() {
  const read = await supa.readAppSetting('equipment_settings');
  if (!read.ok) {
    throw Object.assign(
      new Error('לא הצלחנו לקרוא את מחירי הציוד כרגע — נסו שוב בעוד רגע'),
      { status: 503 }
    );
  }
  const stored = read.configured ? read.value : db.getSettings?.()?.equipment_settings;
  if (!stored) {
    throw Object.assign(
      new Error('מחירי הציוד אינם מוגדרים במערכת — יש לפנות לצוות'),
      { status: 503 }
    );
  }
  return normalizeEquipmentSettings(stored);
}

async function saveEquipmentSettings(next) {
  const normalized = normalizeEquipmentSettings(next);
  const result = await supa.setAppSetting('equipment_settings', normalized);
  if (result?.ok === false) {
    throw new Error(result.error || 'שמירת הגדרות הציוד נכשלה');
  }
  return normalized;
}

/**
 * מחיר הנעליים לחצי העונה הנוכחי, מקוזז לפי תאריך ההצטרפות של המתאמן
 * כפי שהוא עולה מרשימת הנוכחות שלו.
 */
async function shoesPricingForStudent(studentId, settings) {
  await refreshAttendanceCache();
  const attendance = (db.get('attendance') || []).filter(
    (row) => row && row.student_id === studentId
  );
  return shoesSeasonPricing({ settings, attendance });
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
      const [remoteStudents, remoteParents, remoteGroups, remoteEnrollments] = await Promise.all([
        supa.getAll('students'),
        supa.getAll('parents'),
        supa.getAll('groups'),
        supa.getAll('enrollments'),
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
      if (remoteEnrollments && typeof db.set === 'function') {
        db.set('enrollments', remoteEnrollments);
      }
      students = enrichStudentsWithGroupIds(students, remoteEnrollments || db.get('enrollments') || []);
    } else {
      students = db.withStudentRelations(students);
    }

    const groupId = req.query.groupId ? String(req.query.groupId) : '';
    const filter = String(req.query.filter || 'gaps'); // gaps | unpaid | awaiting | all
    const kids = students.filter(
      (s) => isKidStudent(s) && s.status !== 'archived' && (!groupId || studentInGroup(s, groupId))
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
    // מידות: החולצה נבחרת בדף התשלום, הנעליים נרשמות על ידי המדריך.
    const sizePatch = {};
    if (req.body?.shirt_size !== undefined) {
      sizePatch.shirt_size = String(req.body.shirt_size || '').trim() || null;
    }
    if (req.body?.shoe_size !== undefined) {
      sizePatch.shoe_size = String(req.body.shoe_size || '').trim() || null;
    }
    Object.assign(patch, sizePatch);
    // „שולם” נקבע בדרך כלל מזרימת התשלום (markEquipmentItemsPaid מתוך
    // ה-IPN). סימון ידני עוקף סליקה, ולכן הוא שמור למנהל בלבד — מדריך
    // שינסה יקבל 403 גם אם המסך אצלו מציג את הכפתור.
    if (req.body?.payment_status === 'paid') {
      if (req.crmUser?.role !== 'owner') {
        return res.status(403).json({
          error: 'סימון „שולם” ידני שמור למנהל — תשלום רגיל נקלט מדף התשלום',
        });
      }
      const student = db.getOne('students', row.student_id);
      const settings = await loadEquipmentSettings();
      const shoesPricing =
        row.item_type === 'shoes' ? await shoesPricingForStudent(row.student_id, settings) : null;
      // markEquipmentItemsPaid מדלג על „מהבית”/„לא מעוניינים” בכוונה, כדי
      // שתשלום נכנס לא ידרוס החלטה של הורה. מנהל שמסמן ידנית מתכוון בדיוק
      // להפוך אותה, ולכן מאפסים את השורה לפני הסימון.
      if (row.payment_status === 'own' || row.payment_status === 'declined') {
        const reset = markEquipmentUnpaid({ db, persist: persistCore, rowId: row.id });
        if (!reset.ok) return res.status(400).json({ error: reset.error });
      }
      const result = markEquipmentItemsPaid({
        db,
        persist: persistCore,
        studentId: row.student_id,
        itemTypes: [row.item_type],
        shirtSize: sizePatch.shirt_size ?? row.shirt_size ?? null,
        rentalDays: settings.rental_days,
        rentalEndsAt: shoesPricing?.half_end || null,
      });
      if (!result.updated.length) {
        return res.status(400).json({
          error: result.errors[0] || 'הפריט כבר מסומן כשולם',
        });
      }
      const marked = result.updated.find((r) => r.item_type === row.item_type) || result.updated[0];
      if (sizePatch.shoe_size !== undefined) {
        const withSize = db.update('student_equipment', row.id, { shoe_size: sizePatch.shoe_size });
        if (withSize) {
          await persistCore('student_equipment', withSize);
          return res.json(withSize);
        }
      }
      console.log(
        `equipment manual paid: ${row.id} (${student?.name || row.student_id}) by ${req.crmUser?.email || 'owner'}`
      );
      return res.json(marked);
    }
    if (req.body?.payment_status === 'unpaid' || req.body?.payment_status === 'own' || req.body?.payment_status === 'declined') {
      if (req.body.payment_status === 'own') {
        const result = markEquipmentOwn({ db, persist: persistCore, rowId: row.id });
        if (!result.ok) return res.status(400).json({ error: result.error });
        // מותר לשלוח מידה יחד עם שינוי הסטטוס באותה בקשה
        if (Object.keys(sizePatch).length) {
          const withSize = db.update("student_equipment", row.id, sizePatch);
          if (withSize) await persistCore('student_equipment', withSize);
          return res.json(withSize || result.row);
        }
        return res.json(result.row);
      }
      if (req.body.payment_status === 'declined') {
        const result = markEquipmentDeclined({ db, persist: persistCore, rowId: row.id });
        if (!result.ok) return res.status(400).json({ error: result.error });
        if (Object.keys(sizePatch).length) {
          const withSize = db.update("student_equipment", row.id, sizePatch);
          if (withSize) await persistCore('student_equipment', withSize);
          return res.json(withSize || result.row);
        }
        return res.json(result.row);
      }
      patch.payment_status = req.body.payment_status;
      if (req.body.payment_status === 'unpaid') {
        patch.paid_at = null;
        patch.payment_id = null;
        patch.given_at = null;
        patch.given_by = null;
        patch.fulfillment_status = 'pending';
        if (row.item_type === 'shoes') {
          patch.rental_starts_at = null;
          patch.rental_ends_at = null;
        }
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

app.post('/api/equipment/:id/mark-own', async (req, res) => {
  try {
    await refreshStudentEquipmentCache();
    const result = markEquipmentOwn({
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

app.post('/api/equipment/:id/mark-declined', async (req, res) => {
  try {
    await refreshStudentEquipmentCache();
    const result = markEquipmentDeclined({
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

app.post('/api/equipment/:id/mark-unpaid', async (req, res) => {
  try {
    await refreshStudentEquipmentCache();
    const result = markEquipmentUnpaid({
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
      ensureEquipmentWhatsappTemplate({ db, persist: persistCore });
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
    const unpaid = unpaidEquipmentItems(items);
    const shoesPricing = await shoesPricingForStudent(student.id, settings);
    res.json({
      student_name: student.name,
      parent_name: parent?.name || '',
      items,
      unpaid_items: unpaid,
      // מחיר הנעליים שמוצג הוא המקוזז, כדי שהסכום בדף יתאים לחיוב בפועל.
      settings: { ...settings, prices: { ...settings.prices, shoes: shoesPricing.amount } },
      shoes_pricing: shoesPricing,
      labels: EQUIPMENT_ITEM_LABELS,
      all_paid: unpaid.length === 0,
    });
  } catch (err) {
    console.error('public equipment lookup error:', err.message);
    res.status(503).json({ error: err.message || 'טעינת דף הציוד נכשלה' });
  }
});

/**
 * "We already have that from last year."
 *
 * A family was made to pay for a chalk bag they already owned, because the only
 * way to record owning one was a staff member ticking it in the CRM — and the
 * parent staring at the payment page had no way to say so. The status already
 * existed; what was missing was the parent's own hand on it.
 *
 * Shoes are excluded: they are rented for the season, not owned, and marking
 * them "own" here would quietly cancel a rental the wall has to hand out.
 */
app.post('/api/public/equipment/:token/own', publicFormRateLimit, async (req, res) => {
  try {
    const checkout = await resolveEquipmentCheckout(req.params.token);
    if (!checkout) return res.status(404).json({ error: 'קישור התשלום לא נמצא' });
    if (checkout.expires_at && new Date(checkout.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ error: 'פג תוקף הקישור — בקשו קישור חדש מהצוות' });
    }
    await refreshStudentEquipmentCache();
    const student = db.getOne('students', checkout.student_id);
    if (!student || !isKidStudent(student)) {
      return res.status(404).json({ error: 'המתאמן לא נמצא' });
    }

    const wanted = Array.isArray(req.body?.itemTypes)
      ? req.body.itemTypes.map((t) => String(t || '').trim())
      : [];
    const allowed = wanted.filter(
      (t) => EQUIPMENT_ITEM_TYPES.includes(t) && t !== 'shoes'
    );
    if (!allowed.length) {
      return res.status(400).json({ error: 'בחרו לפחות פריט אחד שכבר יש למתאמן' });
    }

    const items = ensureStudentEquipment({ db, student, persist: persistCore });
    const marked = [];
    for (const type of allowed) {
      const row = items.find((i) => i.item_type === type);
      if (!row) continue;
      // Never overwrite something already paid for — that is a real payment.
      if (row.payment_status === 'paid') continue;
      const result = markEquipmentOwn({ db, persist: persistCore, rowId: row.id });
      if (result.ok) marked.push(type);
    }
    if (!marked.length) {
      return res.status(400).json({ error: 'לא נמצאו פריטים לסימון' });
    }

    const fresh = ensureStudentEquipment({ db, student, persist: persistCore });
    res.json({
      ok: true,
      marked,
      items: fresh,
      unpaid_items: unpaidEquipmentItems(fresh),
      all_paid: unpaidEquipmentItems(fresh).length === 0,
    });
  } catch (err) {
    console.error('public equipment own error:', err.message);
    res.status(503).json({ error: err.message || 'סימון הציוד נכשל' });
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
    // This request ends in a payment link, so the prices must be the real ones
    // or none at all.
    const settings = await loadEquipmentSettingsForCharge();
    const unpaidTypes = new Set(
      unpaidEquipmentItems(items).map((i) => i.item_type)
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

    const shoesPricing = await shoesPricingForStudent(student.id, settings);
    const entered = computeEquipmentTotal(settings, selected, { shoes: shoesPricing.amount });
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
      // נשמר על התשלום כדי שה-IPN יסמן את חלון ההשכרה לפי חצי העונה
      // שתומחר בפועל, גם אם ההגדרות ישתנו בין היצירה לאישור.
      equipment_rental_starts_at: shoesPricing.rental_starts_at,
      equipment_rental_ends_at: shoesPricing.half_end,
      equipment_shoes_amount: selected.includes('shoes') ? shoesPricing.amount : null,
      updated_at: new Date().toISOString(),
    });

    const paymentUrl = await icount.buildPaymentUrl({
      amount,
      description,
      name: parent.name,
      lastName: parent.lastName,
      idNumber: parent.idNumber,
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
      shoesPricing,
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
  // סוג שנשלח בשמו הישן (יום הולדת / בית ספר / חברה) נשמר כ„אירוע” עם התגית
  // המתאימה, כך שגם לקוח שלא עודכן וגם סנכרון ותיק נוחתים במקום אחד.
  const { type, eventKind } = normalizeActivityType(
    body.type || 'other',
    body.event_kind ?? body.eventKind
  );
  const hostName = body.host_name || body.contact_name || '';
  const hostPhone = body.host_phone || body.contact_phone || '';
  const hostParentId = body.host_parent_id || body.hostParentId || null;
  const date = body.date || null;
  const registrationMode = body.registration_mode === 'host_pays'
    ? 'host_pays'
    : 'paid_per_participant';
  const category = normalizeTemplateCategory(body.category);
  const isOps = category === 'ops';
  return {
    name: String(body.name || '').trim(),
    type,
    event_kind: eventKind,
    category,
    status: body.status || 'open',
    date,
    end_date: normalizeActivityEndDate(date, body.end_date),
    start_time: body.all_day ? null : (body.start_time || null),
    end_time: body.all_day ? null : (body.end_time || null),
    location: body.location || '',
    price: isOps ? 0 : (body.price === '' || body.price === undefined ? 0 : Number(body.price) || 0),
    price_includes_vat: isOps ? false : normalizePriceIncludesVat(body.price_includes_vat),
    max_participants: isOps ? null : (body.max_participants === '' || body.max_participants == null
      ? null
      : Number(body.max_participants) || null),
    responsible_id: body.responsible_id || null,
    description: body.description || '',
    payment_link: isOps ? '' : (body.payment_link || ''),
    notes: body.notes || '',
    all_day: !!body.all_day,
    contact_name: hostName || body.contact_name || '',
    contact_phone: hostPhone || body.contact_phone || '',
    host_name: hostName,
    host_email: body.host_email || '',
    host_phone: hostPhone,
    host_parent_id: hostParentId || null,
    payment_status: normalizeHostPaymentStatus(body.payment_status),
    registration_slug: isOps ? null : (body.registration_slug || null),
    participant_registration_slug:
      isOps ? null : (body.participant_registration_slug || body.registration_slug || null),
    registration_enabled: isOps ? false : !!body.registration_enabled,
    registration_closes_at: body.registration_closes_at || null,
    collect_registration_payment:
      !isOps && registrationMode === 'paid_per_participant' && Number(body.price || 0) > 0,
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
    // שיבוץ ותשלום צוות: איזה תפקיד מותר לשבץ לאירוע, ואיך משולם —
    // לפי התעריף האישי (null) או סכום גלובלי שנקבע כאן.
    staff_role: body.staff_role || null,
    staff_pay_mode: body.staff_pay_mode === 'flat' ? 'flat' : null,
    staff_flat_amount: body.staff_pay_mode === 'flat'
      ? Math.max(0, Number(body.staff_flat_amount) || 0)
      : null,
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

async function refreshPublicActivities() {
  if (!supa.isEnabled()) {
    return { storeAvailable: !requiresDurableStore(), rows: null };
  }
  const rows = await supa.getAll('activities');
  if (rows === null) return { storeAvailable: false, rows: null };
  db.set('activities', rows);
  return { storeAvailable: true, rows };
}

/** Resolve host-payment activity, refreshing from durable store when local cache is stale. */
async function findActivityByHostPaymentToken(token) {
  let activity = matchHostPaymentActivity(db.get('activities'), token);
  // Always refresh from durable store so host edits (name / linked customer)
  // are visible on the public payment link even when the server cache is stale.
  const refreshed = await refreshPublicActivities();
  if (refreshed.rows) {
    activity = matchHostPaymentActivity(refreshed.rows, token) || activity;
  }
  return { activity, storeAvailable: refreshed.storeAvailable };
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
  const durable = await persistCore('activities', record);
  if (durable?.ok === false) {
    console.error('activity create persist failed:', durable.error);
    return res.status(503).json({ error: durable.error || 'שמירת האירוע למסד נכשלה' });
  }
  res.status(201).json(record);
  // Don't block the UI on Google — sync in the background
  syncActivityToGoogle(record).catch((err) =>
    console.error('Background Google push failed:', err.message)
  );
  applyVacationAttendanceForActivities(record).catch((err) =>
    console.error('Vacation attendance sync failed:', err.message)
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
  if (!updated) return res.status(404).json({ error: 'Activity not found' });
  const durable = await persistCore('activities', updated);
  if (durable?.ok === false) {
    console.error('activity update persist failed:', durable.error);
    return res.status(503).json({ error: durable.error || 'שמירת האירוע למסד נכשלה' });
  }
  res.json(updated);
  syncActivityToGoogle(updated).catch((err) =>
    console.error('Background Google push failed:', err.message)
  );
  applyVacationAttendanceForActivities(existing, updated).catch((err) =>
    console.error('Vacation attendance sync failed:', err.message)
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
  applyVacationAttendanceForActivities(existing).catch((err) =>
    console.error('Vacation attendance sync failed:', err.message)
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
    const [remoteRegs, remoteOrders, remoteDeclarations, remotePayments, remoteInterest] = await Promise.all([
      supa.getAll('activity_registrations'),
      supa.getAll('activity_registration_orders'),
      supa.getAll('health_declarations'),
      supa.getAll('payments'),
      supa.getAll(INTEREST_COLLECTION),
    ]);
    if (remoteRegs) db.set('activity_registrations', remoteRegs);
    if (remoteOrders) db.set('activity_registration_orders', remoteOrders);
    if (remoteDeclarations) db.set('health_declarations', remoteDeclarations);
    if (remotePayments) db.set('payments', remotePayments);
    if (remoteInterest) db.set(INTEREST_COLLECTION, remoteInterest);
  }
  const regs = activeRegistrations(db, activity.id).sort((a, b) =>
    String(b.created_at || '').localeCompare(String(a.created_at || ''))
  );
  const parents = db.get('parents') || [];
  const declarations = db.get('health_declarations') || [];
  const enriched = regs.map((registration) => ({
    ...registration,
    parent_name: parents.find((parent) => String(parent.id) === String(registration.parent_id))?.name || '',
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
    interested: listInterest(db, activity.id).map((row) => enrichInterest(db, row)),
    host_payment: hostPayment,
  });
});

// ─── מתעניינים: שיבוץ לפני הרשמה ותשלום ──────────────────────────────────────
/** Interested people never consume capacity — only real registrations do. */
function interestResponse(activity) {
  return {
    interested: listInterest(db, activity.id).map((row) => enrichInterest(db, row)),
    remaining: remainingCapacity(activity, activeRegistrations(db, activity.id)),
  };
}

async function loadInterestRow(activityId, interestId) {
  if (supa.isEnabled()) {
    const remote = await supa.getAll(INTEREST_COLLECTION);
    if (remote) db.set(INTEREST_COLLECTION, remote);
  }
  const row = db.getOne(INTEREST_COLLECTION, interestId);
  if (!row || String(row.activity_id) !== String(activityId)) return null;
  return row;
}

app.post('/api/activities/:id/interested', async (req, res) => {
  try {
    const activity = db.getOne('activities', req.params.id);
    if (!activity) return res.status(404).json({ error: 'Activity not found' });
    const input = normalizeInterestInput(req.body || {});
    if (supa.isEnabled()) {
      const remote = await supa.getAll(INTEREST_COLLECTION);
      if (remote) db.set(INTEREST_COLLECTION, remote);
    }
    const row = await addInterest({ db, persist: persistCore, activityId: activity.id, input });
    res.status(201).json({ success: true, interest: enrichInterest(db, row), ...interestResponse(activity) });
  } catch (err) {
    if (!err.status) console.error('add interest error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.put('/api/activities/:id/interested/:interestId', async (req, res) => {
  try {
    const activity = db.getOne('activities', req.params.id);
    if (!activity) return res.status(404).json({ error: 'Activity not found' });
    const row = await loadInterestRow(activity.id, req.params.interestId);
    if (!row) return res.status(404).json({ error: 'המתעניין לא נמצא באירוע' });
    const input = normalizeInterestInput({ ...row, ...req.body });
    const updated = await updateInterest({ db, persist: persistCore, row, patch: input });
    res.json({ success: true, interest: enrichInterest(db, updated), ...interestResponse(activity) });
  } catch (err) {
    if (!err.status) console.error('update interest error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.delete('/api/activities/:id/interested/:interestId', async (req, res) => {
  try {
    const activity = db.getOne('activities', req.params.id);
    if (!activity) return res.status(404).json({ error: 'Activity not found' });
    const row = await loadInterestRow(activity.id, req.params.interestId);
    if (!row) return res.status(404).json({ error: 'המתעניין לא נמצא באירוע' });
    await updateInterest({
      db,
      persist: persistCore,
      row,
      patch: { status: 'cancelled', cancelled_at: new Date().toISOString() },
    });
    res.json({ success: true, ...interestResponse(activity) });
  } catch (err) {
    console.error('delete interest error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/activities/:id/interested/:interestId/convert', async (req, res) => {
  try {
    const activity = db.getOne('activities', req.params.id);
    if (!activity) return res.status(404).json({ error: 'Activity not found' });
    if (supa.isEnabled()) {
      const [remoteRegs, remoteParents] = await Promise.all([
        supa.getAll('activity_registrations'),
        supa.getAll('parents'),
      ]);
      if (remoteRegs) db.set('activity_registrations', remoteRegs);
      if (remoteParents) db.set('parents', remoteParents);
    }
    const row = await loadInterestRow(activity.id, req.params.interestId);
    if (!row) return res.status(404).json({ error: 'המתעניין לא נמצא באירוע' });

    const remainingBefore = remainingCapacity(activity, activeRegistrations(db, activity.id));
    if (remainingBefore != null && remainingBefore < 1) {
      return res.status(409).json({ error: 'אין מקומות פנויים באירוע' });
    }

    const result = await convertInterestToRegistration({
      db,
      persist: persistCore,
      activity,
      row,
      paymentStatus: req.body?.payment_status,
    });
    res.json({
      success: true,
      registration: result.registration,
      parent_id: result.parent.id,
      ...interestResponse(activity),
    });
  } catch (err) {
    if (!err.status) console.error('convert interest error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
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
        for (const link of linkHouseholdGuardians(db, {
          studentId: student.id,
          source: 'activity_registration',
        })) {
          await persistCore('student_guardians', link);
        }
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

// ─── Activity attendance ─────────────────────────────────────────────────────
// The list is derived on every read (participants × activity days), so a
// participant who registers after the list was opened is already on it.

/** Pull the tables an attendance read/write depends on, so we never act on stale rows. */
async function refreshActivityAttendanceTables() {
  if (!supa.isEnabled()) return;
  const [remoteRegs, remoteMarks] = await Promise.all([
    supa.getAll('activity_registrations'),
    supa.getAll(ACTIVITY_ATTENDANCE_COLLECTION),
  ]);
  if (remoteRegs) db.set('activity_registrations', remoteRegs);
  if (remoteMarks) db.set(ACTIVITY_ATTENDANCE_COLLECTION, remoteMarks);
}

/** An event created elsewhere may be missing from the local cache — pull once before giving up. */
async function findActivityForAttendance(id) {
  const local = db.getOne('activities', id);
  if (local) return local;
  await refreshActivitiesCache();
  return db.getOne('activities', id) || null;
}

app.get('/api/activities/:id/attendance', async (req, res) => {
  try {
    const activity = await findActivityForAttendance(req.params.id);
    if (!activity) return res.status(404).json({ error: 'האירוע לא נמצא' });
    await refreshActivityAttendanceTables();

    const parents = db.get('parents') || [];
    const registrations = activeRegistrations(db, activity.id)
      .slice()
      .sort((a, b) => String(a.participant_name || '').localeCompare(String(b.participant_name || ''), 'he'))
      .map((registration) => ({
        ...registration,
        parent_name:
          parents.find((parent) => String(parent.id) === String(registration.parent_id))?.name || '',
      }));

    res.json(buildActivityAttendance({
      activity,
      registrations,
      saved: activityAttendanceRows(db).filter(
        (row) => String(row.activity_id || '') === String(activity.id)
      ),
    }));
  } catch (err) {
    console.error('get activity attendance error:', err.message);
    res.status(500).json({ error: err.message || 'טעינת רשימת הנוכחות נכשלה' });
  }
});

/**
 * Mark attendance for activity participants.
 * Body: { records: [{ activity_id?, registration_id, date, status }] }
 * Records may span activities, so the customer file can save from one call.
 */
app.post('/api/activity-attendance', async (req, res) => {
  try {
    const records = Array.isArray(req.body?.records) ? req.body.records : null;
    if (!records) return res.status(400).json({ error: 'records חייב להיות מערך' });
    if (records.length === 0) return res.json({ success: true, rows: [] });

    await refreshActivityAttendanceTables();
    const markedBy = req.crmUser?.email || req.crmUser?.name || null;
    const saved = [];

    for (const record of records) {
      const registration = db.getOne('activity_registrations', String(record?.registration_id || ''));
      if (!registration) {
        return res.status(404).json({ error: 'המשתתף לא נמצא באירוע' });
      }
      if (record.activity_id && String(record.activity_id) !== String(registration.activity_id)) {
        return res.status(400).json({ error: 'המשתתף לא שייך לאירוע הזה' });
      }
      const activity = await findActivityForAttendance(registration.activity_id);
      if (!activity) return res.status(404).json({ error: 'האירוע לא נמצא' });
      if (!registrationCountsForAttendance(registration)) {
        return res.status(400).json({ error: 'לא ניתן לסמן נוכחות למשתתף שבוטל' });
      }

      const id = activityAttendanceId(registration.id, record.date);
      const existing = db.getOne(ACTIVITY_ATTENDANCE_COLLECTION, id) || null;
      const plan = planAttendanceMark({
        activity,
        registration,
        date: record.date,
        status: record.status,
        existing,
        markedBy,
      });

      if (plan.action === 'invalid') return res.status(400).json({ error: plan.error });
      if (plan.action === 'none') {
        saved.push({ id, date: String(record.date || '').slice(0, 10), status: 'pending' });
        continue;
      }
      if (plan.action === 'delete') {
        db.delete(ACTIVITY_ATTENDANCE_COLLECTION, id);
        // Awaited on purpose: the next read pulls the durable store, and a
        // fire-and-forget removal could resurrect the mark it just cleared.
        await supa.remove(ACTIVITY_ATTENDANCE_COLLECTION, id);
        saved.push({ id, date: String(record.date || '').slice(0, 10), status: 'pending' });
        continue;
      }

      const row = plan.action === 'insert'
        ? db.insert(ACTIVITY_ATTENDANCE_COLLECTION, plan.row)
        : db.update(ACTIVITY_ATTENDANCE_COLLECTION, id, plan.row) || plan.row;
      const durable = await persistCore(ACTIVITY_ATTENDANCE_COLLECTION, row);
      if (durable?.ok === false) {
        return res.status(503).json({ error: durable.error || 'שמירת הנוכחות נכשלה' });
      }
      saved.push(row);
    }

    res.json({ success: true, rows: saved });
  } catch (err) {
    console.error('mark activity attendance error:', err.message);
    res.status(500).json({ error: err.message || 'שמירת הנוכחות נכשלה' });
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
      });
    } catch (tplErr) {
      console.warn('event whatsapp templates ensure skipped:', tplErr.message);
    }

    let whatsappSent = false;
    let whatsappError = null;
    let whatsappViaTemplate = false;
    if (req.body?.via !== 'email') {
      const inWindow = canSendFreeform(parent, 'whatsapp');
      const preferredMetaName = sendHostPayment
        ? EVENT_HOST_PAYMENT_TEMPLATE
        : EVENT_PARTICIPANT_LINK_TEMPLATE;
      const localTpl = resolveEventTemplate(db, sendHostPayment ? 'host' : 'participant');
      const metaName = localTpl?.meta_name || preferredMetaName;
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

app.patch('/api/activities/:id/payment-status', async (req, res) => {
  const activity = db.getOne('activities', req.params.id);
  if (!activity) return res.status(404).json({ error: 'Activity not found' });
  const payment_status = normalizeHostPaymentStatus(req.body?.payment_status);
  const updated = db.update('activities', activity.id, { payment_status });
  if (!updated) return res.status(404).json({ error: 'Activity not found' });
  const durable = await persistCore('activities', updated);
  if (durable?.ok === false) {
    console.error('activity payment-status persist failed:', durable.error);
    return res.status(503).json({ error: durable.error || 'שמירת סטטוס התשלום נכשלה' });
  }
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

app.post('/api/activity-templates', async (req, res) => {
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
  const durable = await persistCore('activity_templates', record);
  if (durable?.ok === false) {
    console.error('activity template create persist failed:', durable.error);
    return res.status(503).json({ error: durable.error || 'שמירת התבנית למסד נכשלה' });
  }
  res.status(201).json(record);
});

app.put('/api/activity-templates/:id', async (req, res) => {
  const existing = db.getOne('activity_templates', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Template not found' });
  const payload = normalizeActivityTemplatePayload({ ...existing, ...(req.body || {}) });
  if (!payload.name) return res.status(400).json({ error: 'חסר שם תבנית' });
  const updated = db.update('activity_templates', existing.id, payload);
  if (!updated) return res.status(404).json({ error: 'Template not found' });
  const durable = await persistCore('activity_templates', updated);
  if (durable?.ok === false) {
    console.error('activity template update persist failed:', durable.error);
    return res.status(503).json({ error: durable.error || 'שמירת התבנית למסד נכשלה' });
  }
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
  const durable = await persistCore('activities', record);
  if (durable?.ok === false) {
    console.error('template create-activity persist failed:', durable.error);
    return res.status(503).json({ error: durable.error || 'שמירת האירוע למסד נכשלה' });
  }
  res.status(201).json(record);
  syncActivityToGoogle(record).catch((err) =>
    console.error('Background Google push failed:', err.message)
  );
});

// ─── Public activity registration ────────────────────────────────────────────
app.get('/api/public/host-payments/:token', publicFormRateLimit, async (req, res) => {
  try {
    const { activity, storeAvailable } = await findActivityByHostPaymentToken(req.params.token);
    if (!storeAvailable) {
      const unavailable = publicStoreUnavailableError();
      return res.status(unavailable.status).json(unavailable.body);
    }
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
    const { activity, storeAvailable } = await findActivityByHostPaymentToken(req.params.token);
    if (!storeAvailable) {
      const unavailable = publicStoreUnavailableError();
      return res.status(unavailable.status).json(unavailable.body);
    }
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
      lastName: parent.lastName,
      idNumber: parent.idNumber,
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
  const refreshed = await refreshPublicActivities();
  if (refreshed.rows) {
    activity = findActivityBySlug(db, slug) || activity;
  }
  return { activity, storeAvailable: refreshed.storeAvailable };
}

// Marketing-site reads. Registered before the :slug route so the bare path is
// not swallowed by it.
app.get('/api/public/activities', publicFormRateLimit, (_req, res) => {
  try {
    res.json({ activities: upcomingPublicActivities(db) });
  } catch (err) {
    console.error('public activities list error:', err.message);
    res.status(500).json({ error: 'טעינת הפעילויות נכשלה' });
  }
});

app.get('/api/public/opening-hours', publicFormRateLimit, (_req, res) => {
  try {
    res.json({ days: upcomingOpeningHours(db) });
  } catch (err) {
    console.error('public opening hours error:', err.message);
    res.status(500).json({ error: 'טעינת שעות הפתיחה נכשלה' });
  }
});

app.get('/api/public/groups', publicFormRateLimit, (_req, res) => {
  try {
    res.json({ groups: publicGroups(db) });
  } catch (err) {
    console.error('public groups error:', err.message);
    res.status(500).json({ error: 'טעינת החוגים נכשלה' });
  }
});

app.get('/api/public/activities/:slug', publicFormRateLimit, async (req, res) => {
  try {
    const { activity, storeAvailable } = await findActivityBySlugFresh(req.params.slug);
    if (!storeAvailable) {
      const unavailable = publicStoreUnavailableError();
      return res.status(unavailable.status).json(unavailable.body);
    }
    if (!activity) return res.status(404).json({ error: 'הפעילות לא נמצאה' });
    if (supa.isEnabled()) {
      const remoteRegs = await supa.getAll('activity_registrations');
      if (remoteRegs) db.set('activity_registrations', remoteRegs);
    }
    const regs = activeRegistrations(db, activity.id);
    // The declaration the event itself calls for — a trip asks the trip
    // questions. This used to be the default template whatever the event was.
    const template = declarationTemplateForActivity(db, activity, resolveDeclarationTemplate);
    res.json({
      ...publicRegistrationPayload(activity, regs),
      form_template: template,
    });
  } catch (err) {
    console.error('public activity get error:', err.message);
    res.status(500).json({ error: err.message || 'טעינת הפעילות נכשלה' });
  }
});

/**
 * What a public form may know about a household before anyone signs anything:
 * who is on the card, and which of them still has a declaration in force — so
 * a returning customer is never asked to sign the same waiver twice.
 *
 * Shared by every public flow that opens with a phone number. Nothing here
 * leaves the allowlist below: no notes, no siblings' declarations, no history.
 */
async function loadPublicHousehold(rawPhone) {
  const phone = normalizePhone(rawPhone || '');
  if (!phone || phone.replace(/\D/g, '').length < 9) {
    return { found: false, parent: null, children: [], adult_health_valid: false };
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
    return { found: false, parent: null, children: [], adult_health_valid: false };
  }
  // The household's children, not only the ones whose card names this parent as
  // primary: after a merge every child belongs to both parents, and a public
  // form that lists one parent's half asks a family to register a child twice.
  const children = childrenOfParent(db, parent.id)
    .filter((student) => student.isAdult !== true)
    .map((student) => {
      const declaration = findLatestValidDeclaration(db, { studentId: student.id });
      const signedAt = declarationSignedAt(declaration) || student.healthSignedAt || null;
      // A missing signature date is *not* a valid declaration here. Elsewhere an
      // unknown date is read generously so old records are not flagged; on a
      // public form that generosity would offer to reuse a signature that was
      // never given.
      const healthValid = !!declaration
        || (!!student.healthSignedAt && isHealthDeclarationValid(student.healthSignedAt));
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

  const adultStudent = childrenOfParent(db, parent.id).find((student) => {
    if (student.isAdult !== true) return false;
    const parentName = String(parent.name || '').trim().toLowerCase();
    const studentName = String(student.name || '').trim().toLowerCase();
    return !parentName || studentName === parentName;
  }) || childrenOfParent(db, parent.id).find((student) => student.isAdult === true);
  const adultDeclaration = (adultStudent
    ? findLatestValidDeclaration(db, { studentId: adultStudent.id })
    : null)
    || findLatestValidDeclaration(db, {
      parentId: parent.id,
      climberName: parent.name,
    });

  return {
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
  };
}

/**
 * "Is this child already on someone else's file?" — asked by every public form
 * after the child's details are filled in, before anything is written.
 *
 * Answers with the holder's **first name only**: enough for the person filling
 * the form to recognise their own family ("נועם רשום על שם אבנר"), and nothing
 * that identifies or reaches that household. A match needs both the name and
 * the exact date of birth, so it cannot be produced by guessing a name.
 */
app.get('/api/public/child-check', publicFormRateLimit, async (req, res) => {
  try {
    if (supa.isEnabled()) {
      const [remoteStudents, remoteParents, remoteGuardians] = await Promise.all([
        supa.getAll('students'),
        supa.getAll('parents'),
        supa.getAll('student_guardians'),
      ]);
      if (remoteStudents) db.set('students', remoteStudents);
      if (remoteParents) db.set('parents', remoteParents);
      if (remoteGuardians) db.set('student_guardians', remoteGuardians);
    }
    // Children already on the caller's own card are the household lookup's job.
    const ownParent = findParentForOnboard({ phone: normalizePhone(req.query.phone || '') });
    const matches = findChildMatches(db, {
      name: req.query.name,
      birthDate: req.query.birthDate,
      idNumber: req.query.idNumber,
      excludeParentId: ownParent?.id || null,
    });
    if (matches.length === 1 && supa.isEnabled()) {
      const remoteDecls = await supa.getAll('health_declarations');
      if (remoteDecls) db.set('health_declarations', remoteDecls);
    }
    const matched = matches.length === 1 ? matches[0].student : null;
    res.json(publicChildMatchPayload(matches, {
      healthValid: matched
        ? !!findLatestValidDeclaration(db, { studentId: matched.id })
          || (!!matched.healthSignedAt && isHealthDeclarationValid(matched.healthSignedAt))
        : false,
    }));
  } catch (err) {
    console.error('public child check error:', err.message);
    // A failed check must never block a registration — it only offers a link.
    res.json({ match: false });
  }
});

/**
 * "Do we already know this family?" — asked when a parent we have never seen
 * fills in their name. Two parents of the same household share nothing our
 * lookups can match on (different phone, different child), so the family name
 * is the only thread, and a human confirms it.
 */
app.get('/api/public/family-check', publicFormRateLimit, async (req, res) => {
  try {
    if (supa.isEnabled()) {
      const [remoteParents, remoteStudents, remoteGuardians] = await Promise.all([
        supa.getAll('parents'),
        supa.getAll('students'),
        supa.getAll('student_guardians'),
      ]);
      if (remoteParents) db.set('parents', remoteParents);
      if (remoteStudents) db.set('students', remoteStudents);
      if (remoteGuardians) db.set('student_guardians', remoteGuardians);
    }
    const ownParent = findParentForOnboard({ phone: normalizePhone(req.query.phone || '') });
    // A parent we already know is handled by the household lookup, not here.
    if (ownParent) return res.json({ families: [] });
    res.json(publicFamilyCandidatesPayload(familyCandidates(db, {
      lastName: req.query.lastName,
    })));
  } catch (err) {
    console.error('public family check error:', err.message);
    res.json({ families: [] });
  }
});

app.get('/api/public/activities/:slug/household', publicFormRateLimit, async (req, res) => {
  try {
    const { activity, storeAvailable } = await findActivityBySlugFresh(req.params.slug);
    if (!storeAvailable) {
      const unavailable = publicStoreUnavailableError();
      return res.status(unavailable.status).json(unavailable.body);
    }
    if (!activity) return res.status(404).json({ error: 'הפעילות לא נמצאה' });
    res.json(await loadPublicHousehold(req.query.phone));
  } catch (err) {
    console.error('public activity household error:', err.message);
    res.status(500).json({ error: err.message || 'טעינת פרטי הלקוח נכשלה' });
  }
});

app.post('/api/public/activities/:slug/register', publicFormRateLimit, async (req, res) => {
  try {
    const { activity, storeAvailable } = await findActivityBySlugFresh(req.params.slug);
    if (!storeAvailable) {
      const unavailable = publicStoreUnavailableError();
      return res.status(unavailable.status).json(unavailable.body);
    }
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
        lastName: parent.lastName,
        idNumber: parent.idNumber,
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
    if (!result.duplicate) {
      // Someone the staff had slotted as "מתעניין" just registered — close that slot.
      try {
        if (supa.isEnabled()) {
          const remoteInterest = await supa.getAll(INTEREST_COLLECTION);
          if (remoteInterest) db.set(INTEREST_COLLECTION, remoteInterest);
        }
        await closeInterestForRegistrations({
          db,
          persist: persistCore,
          activityId: activity.id,
          parentId: parent?.id || null,
          phone: parent?.phone || '',
          registrations: result.registrations,
        });
      } catch (interestErr) {
        console.warn('⚠️ [activity interest] auto-close skipped:', interestErr.message);
      }
    }
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
    // Same reason as the other public forms: a customer the address book has
    // never heard of shows up as an unknown number when they call.
    touchGoogleContacts();
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

// ─── Public shop: self-serve purchase of a pass ──────────────────────────────

/** Catalog edits must be visible on the public link even with a stale cache. */
async function refreshPublicPricelist() {
  if (!supa.isEnabled()) {
    return { storeAvailable: !requiresDurableStore(), rows: null };
  }
  const rows = await supa.getAll('pricelist');
  if (rows === null) return { storeAvailable: false, rows: null };
  db.set('pricelist', rows);
  return { storeAvailable: true, rows };
}

async function findShopItemBySlugFresh(slug) {
  let item = findShopItemBySlug(db, slug);
  const refreshed = await refreshPublicPricelist();
  if (refreshed.rows) item = findShopItemBySlug(db, slug) || item;
  return { item, storeAvailable: refreshed.storeAvailable };
}

app.get('/api/public/shop', publicFormRateLimit, async (_req, res) => {
  try {
    const refreshed = await refreshPublicPricelist();
    if (!refreshed.storeAvailable) {
      const unavailable = publicStoreUnavailableError();
      return res.status(unavailable.status).json(unavailable.body);
    }
    res.json({ items: publicShopItems(db) });
  } catch (err) {
    console.error('public shop list error:', err.message);
    res.status(500).json({ error: 'טעינת החנות נכשלה' });
  }
});

app.get('/api/public/shop/:slug', publicFormRateLimit, async (req, res) => {
  try {
    const { item, storeAvailable } = await findShopItemBySlugFresh(req.params.slug);
    if (!storeAvailable) {
      const unavailable = publicStoreUnavailableError();
      return res.status(unavailable.status).json(unavailable.body);
    }
    if (!item) return res.status(404).json({ error: 'הפריט לא נמצא או שאינו נמכר אונליין' });
    res.json({
      ...shopItemPayload(item),
      form_template: resolveDefaultDeclarationTemplate(db),
    });
  } catch (err) {
    console.error('public shop item error:', err.message);
    res.status(500).json({ error: err.message || 'טעינת הפריט נכשלה' });
  }
});

app.get('/api/public/shop/:slug/household', publicFormRateLimit, async (req, res) => {
  try {
    const { item, storeAvailable } = await findShopItemBySlugFresh(req.params.slug);
    if (!storeAvailable) {
      const unavailable = publicStoreUnavailableError();
      return res.status(unavailable.status).json(unavailable.body);
    }
    if (!item) return res.status(404).json({ error: 'הפריט לא נמצא או שאינו נמכר אונליין' });
    res.json(await loadPublicHousehold(req.query.phone));
  } catch (err) {
    console.error('public shop household error:', err.message);
    res.status(500).json({ error: err.message || 'טעינת פרטי הלקוח נכשלה' });
  }
});

app.post('/api/public/shop/:slug/purchase', publicFormRateLimit, async (req, res) => {
  try {
    if (!icount.isConfigured()) {
      return res.status(503).json({ error: 'הרכישה אונליין אינה זמינה כרגע' });
    }
    const { item, storeAvailable } = await findShopItemBySlugFresh(req.params.slug);
    if (!storeAvailable) {
      const unavailable = publicStoreUnavailableError();
      return res.status(unavailable.status).json(unavailable.body);
    }
    if (!item) return res.status(404).json({ error: 'הפריט לא נמצא או שאינו נמכר אונליין' });

    // Sales and payments live in the same durable store as the passes they
    // create — a purchase we cannot record is a purchase we must not charge for.
    if (supa.isEnabled()) {
      const [remoteSales, remotePayments] = await Promise.all([
        supa.getAll('pos_sales'),
        supa.getAll('payments'),
      ]);
      if (remoteSales) db.set('pos_sales', remoteSales);
      if (remotePayments) db.set('payments', remotePayments);
    }

    const result = await createShopPurchase({
      db,
      persist: persistCore,
      item,
      payload: req.body || {},
      syncCustomer: (parent) => syncParentToIcount(parent),
      createPaymentUrl: async ({ payment, parent, amount, description }) => icount.buildPaymentUrl({
        amount,
        description,
        name: parent.name,
        lastName: parent.lastName,
        idNumber: parent.idNumber,
        phone: normalizePhone(parent.phone),
        email: parent.email,
        paymentId: payment.id,
        ipnUrl: icount.buildIpnUrl({ paymentId: payment.id }),
        successUrl: `${frontendPublicBase(req)}/shop/${encodeURIComponent(req.params.slug)}?paid=1`,
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

    if (!result.paymentUrl) {
      return res.status(502).json({ error: 'יצירת קישור התשלום נכשלה' });
    }
    // A customer created by a public form is a customer the phone should
    // recognise on an incoming call. Only staff-side paths used to schedule
    // this, so families who joined through a form never reached the address
    // book at all — there is no nightly sweep behind it.
    touchGoogleContacts();
    console.log(
      `🛒 [shop] ${result.duplicate ? 'retry' : 'new'} purchase item=${item.name} sale=${result.sale.id}`
    );
    res.status(201).json({
      duplicate: result.duplicate,
      paymentUrl: result.paymentUrl,
      total: result.sale.total,
    });
  } catch (err) {
    console.error('public shop purchase error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'הרכישה נכשלה' });
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

// ─── Google Contacts — CRM address book on the phone ─────────────────────────
const googleContactsDeps = {
  getParents: () => db.get('parents') || [],
  getStudents: () => db.get('students') || [],
};

/** Queue a contacts refresh after a CRM edit that changes a name or a status. */
function touchGoogleContacts() {
  try {
    googleContactsService.scheduleSync(googleContactsDeps);
  } catch (err) {
    console.error('Google Contacts schedule failed:', err.message);
  }
}

app.get('/api/google-contacts/status', async (req, res) => {
  try {
    res.json(await googleContactsService.getStatus());
  } catch (err) {
    res.status(500).json({ configured: false, connected: false, error: err.message });
  }
});

app.get('/api/google-contacts/auth-url', requireOwner, (req, res) => {
  try {
    res.json({ url: googleContactsService.getAuthUrl() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/google-contacts/oauth/callback', async (req, res) => {
  const base = googleContactsService.frontendBase();
  try {
    const code = req.query.code;
    if (!code) return res.redirect(`${base}/business-settings?googleContacts=error`);
    await googleContactsService.completeOAuth(String(code));
    // First fill right after connecting, so the phone is useful immediately.
    try {
      await googleContactsService.syncContacts(googleContactsDeps);
    } catch (err) {
      console.error('Initial Google Contacts sync failed:', err.message);
    }
    res.redirect(googleContactsService.oauthCallbackRedirectUrl());
  } catch (err) {
    console.error('Google Contacts OAuth callback failed:', err.message);
    res.redirect(`${base}/business-settings?googleContacts=error&msg=${encodeURIComponent(err.message)}`);
  }
});

app.post('/api/google-contacts/disconnect', requireOwner, async (req, res) => {
  try {
    res.json(await googleContactsService.disconnect());
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/google-contacts/sync', requireOwner, async (req, res) => {
  try {
    const result = await googleContactsService.syncContacts(googleContactsDeps, {
      force: req.body?.force === true,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Cron-friendly sync (same secret pattern as the calendar pull)
app.post('/api/google-contacts/sync-due', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.get('x-cron-secret') !== secret && req.query.secret !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    res.json(await googleContactsService.syncContacts(googleContactsDeps));
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

async function refreshActivitiesCache() {
  try {
    if (supa.isEnabled()) {
      const rows = await supa.getAll('activities');
      if (rows && typeof db.set === 'function') db.set('activities', rows);
    }
  } catch (err) {
    console.error('activities cache refresh failed:', err.message);
  }
}

/**
 * Keep attendance in sync with «חופשה מאימונים» calendar events:
 * pending rows on a vacation day become "יום חג", and rows the automation
 * marked earlier revert to pending once the vacation no longer covers them.
 * Manually marked rows are never touched. Source of truth is our own calendar
 * (`activities`), never a Google push.
 * `dates` = the YYYY-MM-DD days to sync.
 * Operates on the current caches; callers refresh what they need first.
 */
function syncVacationAttendance(dates) {
  if (!Array.isArray(dates) || dates.length === 0) return { marked: 0, reverted: 0 };
  const activities = db.get('activities') || [];
  const attendance = db.get('attendance') || [];

  const toMark = planVacationAttendanceUpdates({ activities, attendance, dates });
  for (const row of toMark) {
    db.update('attendance', row.id, {
      status: VACATION_ATT_STATUS,
      marked_by: VACATION_MARKER,
    });
  }

  const toRevert = planVacationAttendanceReverts({ activities, attendance, dates });
  for (const row of toRevert) {
    db.update('attendance', row.id, { status: 'pending', marked_by: null });
  }

  if (toMark.length || toRevert.length) {
    console.log(
      `🏖️ Training-vacation attendance sync: ${toMark.length} marked, ${toRevert.length} reverted`
    );
  }
  return { marked: toMark.length, reverted: toRevert.length };
}

/** Dates a vacation edit touches — old range ∪ new range. */
function vacationSyncDates(...activities) {
  const dates = new Set();
  for (const activity of activities) {
    if (!activity) continue;
    if (activity.type !== VACATION_ACTIVITY_TYPE) continue;
    for (const day of activityDateRange(activity)) dates.add(day);
  }
  return [...dates];
}

/**
 * Called after a calendar activity is created / edited / deleted.
 * Uses the local activities cache on purpose: it already reflects the change,
 * while a remote re-read could still return the pre-change rows.
 */
async function applyVacationAttendanceForActivities(...activities) {
  const dates = vacationSyncDates(...activities);
  if (!dates.length) return { marked: 0, reverted: 0 };
  await refreshAttendanceCache();
  return syncVacationAttendance(dates);
}

async function refreshStudentsAndGroupsCache() {
  try {
    if (supa.isEnabled()) {
      const [groups, students, enrollments] = await Promise.all([
        supa.getAll('groups'),
        supa.getAll('students'),
        supa.getAll('enrollments'),
      ]);
      if (groups && typeof db.set === 'function') db.set('groups', groups);
      if (students && typeof db.set === 'function') db.set('students', students);
      if (enrollments && typeof db.set === 'function') db.set('enrollments', enrollments);
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
  await refreshActivitiesCache();

  const result = ensureAttendanceRows({
    groups: db.get('groups') || [],
    students: db.withStudentRelations(db.get('students') || []),
    attendance: db.get('attendance') || [],
    activities: db.get('activities') || [],
    date,
    groupId,
  });

  for (const row of result.created) {
    db.insert('attendance', row);
  }

  // Caches are already fresh — flip any pre-existing pending rows on this date.
  const vacationSync = syncVacationAttendance([date]);

  res.status(201).json({
    created: result.created.length,
    existing: result.existing,
    groups: result.groups,
    date: result.date,
    vacation: result.vacation,
    notTrainingDay: result.notTrainingDay,
    vacationSync,
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
  await refreshActivitiesCache();
  const result = ensureAttendanceRows({
    groups: db.get('groups') || [],
    students: db.withStudentRelations(db.get('students') || []),
    attendance: db.get('attendance') || [],
    activities: db.get('activities') || [],
    date: israelDateStr(),
    groupId: null,
  });
  for (const row of result.created) {
    db.insert('attendance', row);
  }
  const vacationSync = syncVacationAttendance([result.date]);
  console.log(`📋 Daily attendance ensure: created ${result.created.length} for ${result.date}`);
  res.status(201).json({
    created: result.created.length,
    existing: result.existing,
    groups: result.groups,
    date: result.date,
    vacation: result.vacation,
    vacationSync,
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
        // שורת הכירות קיימת נשארת הכירות.
        status: keepIntroStatus(match.status, r.status),
        marked_by: r.marked_by ?? match.marked_by ?? null,
        notes: r.notes ?? match.notes ?? '',
      });
    }
    // שורה חדשה למתאמן שעדיין בהכירות נולדת מסומנת ככזו.
    const student = db.getOne('students', r.student_id);
    return db.insert('attendance', {
      id: r.id || `att-${r.group_id}-${r.date}-${r.student_id}`,
      student_id: r.student_id,
      group_id: r.group_id,
      date: r.date,
      status: isIntroStudent(student) ? keepIntroStatus('intro_pending', r.status) : r.status,
      marked_by: r.marked_by || null,
      notes: r.notes || '',
    });
  }).filter(Boolean);

  res.status(201).json(saved);
});

app.put('/api/attendance/:id', (req, res) => {
  const { id } = req.params;
  const body = { ...req.body };
  if (body.status) {
    // שורת הכירות נשארת הכירות גם כשמגיע סטטוס רגיל.
    const current = db.getOne('attendance', id);
    body.status = keepIntroStatus(current?.status, body.status);
  }
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

/**
 * Publishing an item to the public shop is a pricing decision made in the
 * owner's name, so it is the one field on a product staff cannot flip. The slug
 * is minted once and kept forever — a link already sitting in a customer's chat
 * must not die because the item was unpublished and published again.
 */
function applySelfServeFields(body, current = {}, user) {
  if (body.self_serve === undefined) return null;
  const wanted = body.self_serve === true || body.self_serve === 'true';
  if (wanted !== (current.self_serve === true) && user?.role !== 'owner') {
    return { status: 403, error: 'פרסום מוצר למכירה עצמית זמין למנהל בלבד' };
  }
  const productType = normalizeProductType({ ...current, ...body });
  if (wanted && !isSellableProductType(productType)) {
    return { status: 400, error: 'אפשר למכור אונליין רק כרטיסייה או מנוי — מוצר פיזי נמכר בדלפק' };
  }
  if (wanted && !(Number(body.price ?? current.price) > 0)) {
    return { status: 400, error: 'למכירה אונליין צריך מחיר גדול מאפס' };
  }
  body.self_serve = wanted;
  body.public_slug = current.public_slug || body.public_slug || makeShopSlug();
  return null;
}

// Create pricelist item
app.post('/api/pricelist', (req, res) => {
  try {
    const body = { ...req.body };
    if (body.image !== undefined) body.image = body.image ? clampImage(body.image) : '';
    body.categories = normalizeProductCategories(body);
    body.category = body.categories[0];
    const denied = applySelfServeFields(body, {}, req.crmUser);
    if (denied) return res.status(denied.status).json({ error: denied.error });
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
    const current = db.getOne('pricelist', id) || {};
    if (body.image !== undefined) body.image = body.image ? clampImage(body.image) : '';
    // Only touch categories when the caller actually sent them — partial patches
    // (stock, active flag) must not be re-labelled as 'שונות'.
    if (body.categories !== undefined || body.category !== undefined) {
      body.categories = normalizeProductCategories({ ...current, ...body });
      body.category = body.categories[0];
    }
    const denied = applySelfServeFields(body, current, req.crmUser);
    if (denied) return res.status(denied.status).json({ error: denied.error });
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
      image_fit: req.body?.image_fit === 'contain' ? 'contain' : 'cover',
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
    if (req.body?.image_fit !== undefined) {
      updates.image_fit = req.body.image_fit === 'contain' ? 'contain' : 'cover';
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
    const found = await icount.searchDocs({
      startDate: req.query.start,
      endDate: req.query.end,
    });
    // doc/search does not carry a link, so hand back the deep link into the
    // billing interface — the printable copy is resolved per row on demand.
    const docs = found.map((doc) => ({
      ...doc,
      doc_app_url: icount.docAppUrl({ doctype: doc?.doctype, docnum: doc?.docnum }),
    }));
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

/**
 * Resolve the shareable copy of one document in the billing system. The docs
 * list only knows type + number, so ask for the document itself when staff
 * actually want to open it.
 */
app.get('/api/icount/docs/link', async (req, res) => {
  try {
    if (!icount.isConfigured()) {
      return res.status(503).json({ error: 'iCount לא מוגדר בשרת' });
    }
    const doctype = String(req.query.doctype || '').trim();
    const docnum = String(req.query.docnum || '').trim();
    if (!doctype || !docnum) {
      return res.status(400).json({ error: 'חסרים סוג ומספר מסמך' });
    }

    const appUrl = icount.docAppUrl({ doctype, docnum });
    let url = null;
    let clientName = null;
    try {
      const info = await icount.getDocInfo({ doctype, docnum });
      const docInfo = info.doc_info || info;
      url = docInfo?.doc_url || docInfo?.docurl || info?.doc_url || info?.docurl || null;
      clientName = docInfo?.client_name || null;
    } catch (err) {
      console.warn('⚠️ [iCount doc link] lookup failed:', err.message);
    }

    if (!url && !appUrl) {
      return res.status(404).json({ error: 'לא נמצא קישור למסמך' });
    }
    res.json({ url, appUrl, clientName, doctype, docnum });
  } catch (err) {
    console.error('iCount doc link error:', err.message);
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
    payments = [...payments]
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      .map((payment) => {
        // Deep links into the billing interface, for anything we cannot do
        // from here — a partial credit, for example.
        const refs = paymentDocRefs(db, payment);
        const parent = payment.parent_id ? db.getOne('parents', payment.parent_id) : null;
        return {
          ...payment,
          icount_doc_app_url: icount.docAppUrl({
            doctype: refs.charge.doctype,
            docnum: refs.charge.docnum,
            docId: refs.charge.docId,
          }),
          icount_client_app_url: icount.clientCardUrl(
            payment.icount_client_id || parent?.icount_client_id
          ),
        };
      });
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Pull the tables a payment action may touch, so we never act on a stale row. */
async function refreshPaymentTables() {
  if (!supa.isEnabled()) return;
  const tables = [
    'payments',
    'pos_sales',
    'customer_passes',
    'activities',
    'activity_registrations',
    'activity_registration_orders',
  ];
  const rows = await Promise.all(tables.map((table) => supa.getAll(table)));
  tables.forEach((table, i) => {
    if (rows[i]) db.set(table, rows[i]);
  });
}

/**
 * Find the public document link for one side of a payment (charge / refund),
 * asking the billing system once when we only have a document number.
 */
async function resolvePaymentDocUrl(payment, kind) {
  const refs = paymentDocRefs(db, payment);
  const side = kind === 'refund' ? refs.refund : refs.charge;
  if (side.url) return { url: side.url, docnum: side.docnum, doctype: side.doctype };
  if (!icount.isConfigured()) return { url: null, docnum: side.docnum, doctype: side.doctype };

  let url = null;
  if (side.docId) {
    try {
      const info = await icount.getDoc(side.docId);
      url = info?.doc_url || info?.docurl || info?.doc?.doc_url || info?.doc?.docurl || null;
    } catch (err) {
      console.warn('⚠️ [payment invoice] doc lookup failed:', err.message);
    }
  }
  if (!url && side.docnum) {
    try {
      const info = await icount.getDocInfo({ doctype: side.doctype, docnum: side.docnum });
      const docInfo = info.doc_info || info;
      url = docInfo?.doc_url || docInfo?.docurl || info?.doc_url || info?.docurl || null;
    } catch (err) {
      console.warn('⚠️ [payment invoice] doc info lookup failed:', err.message);
    }
  }

  if (url) {
    const patch =
      kind === 'refund'
        ? { refund_doc_url: url, updated_at: new Date().toISOString() }
        : { icount_doc_url: url, updated_at: new Date().toISOString() };
    const updated = db.update('payments', payment.id, patch);
    if (updated) await persistCore('payments', updated);
  }
  return { url, docnum: side.docnum, doctype: side.doctype };
}

app.get('/api/payments/:id/invoice', async (req, res) => {
  try {
    await refreshPaymentTables();
    const payment = db.getOne('payments', req.params.id);
    if (!payment) return res.status(404).json({ error: 'התשלום לא נמצא' });

    const kind = String(req.query.kind || 'charge') === 'refund' ? 'refund' : 'charge';
    const { url, docnum } = await resolvePaymentDocUrl(payment, kind);
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
      kind === 'refund' ? `invoice-refund-${safeDoc}.pdf` : `invoice-charge-${safeDoc}.pdf`;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    console.error('payment invoice download error:', err.message);
    res.status(502).json({ error: err.message || 'הורדת המסמך נכשלה' });
  }
});

app.post('/api/payments/:id/send-invoice', async (req, res) => {
  try {
    await refreshPaymentTables();
    const payment = db.getOne('payments', req.params.id);
    if (!payment) return res.status(404).json({ error: 'התשלום לא נמצא' });

    const kind = String(req.body?.kind || 'charge') === 'refund' ? 'refund' : 'charge';
    const { url, docnum } = await resolvePaymentDocUrl(payment, kind);
    if (!url) {
      return res.status(404).json({
        error:
          kind === 'refund'
            ? 'אין מסמך זיכוי לשליחה'
            : 'אין חשבונית לשליחה — ייתכן שהמסמך עדיין לא הופק במערכת החיוב',
      });
    }

    const parent = payment.parent_id ? db.getOne('parents', payment.parent_id) : null;
    const student = payment.student_id ? db.getOne('students', payment.student_id) : null;
    const phone = normalizePhone(req.body?.phone || parent?.phone || student?.phone);
    if (!phone) {
      return res.status(400).json({ error: 'אין מספר טלפון לשליחה' });
    }

    const profile = await getBusinessProfile();
    const text = buildInvoiceWhatsAppText({
      businessName: profile?.display_name,
      parentName: parent?.name || student?.name,
      description: payment.description,
      amount: payment.amount,
      docNumber: docnum,
      url,
      kind,
    });

    // clip:false — the document link must never be cut by the bot reply limit.
    const result = await whatsappService.sendTextMessage(phone, text, false, {
      clip: false,
      parentId: parent?.id || null,
      studentId: payment.student_id || null,
    });
    if (!result?.success) {
      return res.status(502).json({
        error:
          result?.error ||
          'שליחת ההודעה נכשלה — ייתכן שחלון 24 השעות סגור ואין תבנית מאושרת למסמכים',
      });
    }

    console.log(`📄 [payment] invoice sent payment=${payment.id} kind=${kind} doc=${docnum || '-'}`);
    res.json({ success: true, url, docNumber: docnum, phone });
  } catch (err) {
    console.error('payment invoice send error:', err.message);
    res.status(502).json({ error: err.message || 'שליחת החשבונית נכשלה' });
  }
});

/**
 * Refund one payment row from the customer file.
 * The row can belong to a counter sale, an event registration or an event
 * host payment — each of those has extra bookkeeping, so we dispatch to the
 * helper that already handles it instead of only cancelling the document.
 */
app.post('/api/payments/:id/refund', async (req, res) => {
  try {
    if (!icount.isConfigured()) {
      return res.status(503).json({ error: 'מערכת החיוב לא מוגדרת בשרת' });
    }
    await refreshPaymentTables();
    const payment = db.getOne('payments', req.params.id);
    if (!payment) return res.status(404).json({ error: 'התשלום לא נמצא' });

    const check = checkPaymentRefundable(db, payment);
    if (!check.ok) {
      return res.status(400).json({ error: check.error, code: check.code || null });
    }

    const owner = paymentOwner(db, payment);
    const reason =
      String(req.body?.reason || '').trim() ||
      `זיכוי · ${payment.description || 'תשלום'}`;
    const refundedBy = req.crmUser?.email || req.crmUser?.name || null;

    // Event registration — the shared-payment plan also frees the seats.
    if (owner.kind === 'registration') {
      const plan = buildRegistrationRefundPlan(db, {
        activity: owner.activity,
        registration: owner.registration,
      });
      if (!plan.ok) return res.status(400).json({ error: plan.error, code: plan.code || null });
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
        refundedBy,
      });
      console.log(`↩️ [payment] registration refund payment=${payment.id} doc=${plan.docnum}`);
      return res.json({
        success: true,
        kind: 'registration',
        cancellation,
        amount: plan.amount,
        payment: db.getOne('payments', payment.id),
        registrations: marked.registrations,
      });
    }

    // Event host payment — also flips the event back to "refunded".
    if (owner.kind === 'host') {
      const plan = buildHostRefundPlan(db, owner.activity);
      if (!plan.ok) return res.status(400).json({ error: plan.error, code: plan.code || null });
      const cancellation = await icount.cancelDoc({
        doctype: plan.doctype,
        docnum: plan.docnum,
        reason,
        refundCc: true,
      });
      const marked = await applyHostRefundMarks({
        db,
        persist: persistCore,
        activity: owner.activity,
        payment: plan.payment,
        reason,
        cancellation,
        refundedBy,
      });
      console.log(`↩️ [payment] host refund payment=${payment.id} doc=${plan.docnum}`);
      return res.json({
        success: true,
        kind: 'host',
        cancellation,
        amount: plan.amount,
        payment: marked.payment,
        activity: marked.activity,
      });
    }

    const doctype = check.refs.charge.doctype;
    const docnum = check.refs.charge.docnum;
    const cancellation = await icount.cancelDoc({
      doctype,
      docnum,
      reason,
      refundCc: paymentHasCardCharge(db, payment),
    });

    // Counter sale — void whatever passes the sale issued and mark the sale.
    if (owner.kind === 'pos') {
      const now = new Date().toISOString();
      const voidedPasses = [];
      for (const pass of db.get('customer_passes') || []) {
        if (String(pass.sale_id) !== String(owner.sale.id)) continue;
        if (pass.status === 'void') continue;
        const updatedPass = db.update('customer_passes', pass.id, {
          status: 'void',
          void_reason: reason,
          updated_at: now,
        });
        if (updatedPass) {
          await persistCore('customer_passes', updatedPass);
          voidedPasses.push(updatedPass);
        }
      }
      const updatedSale = db.update('pos_sales', owner.sale.id, {
        status: 'refunded',
        refunded_at: now,
        refund_reason: reason,
        refund_doc_number: cancellation.docnum,
        refund_doctype: cancellation.doctype,
        refund_doc_url: cancellation.docUrl || null,
        refunded_by: refundedBy,
        updated_at: now,
      });
      if (updatedSale) await persistCore('pos_sales', updatedSale);
      const marked = await applyGenericRefundMarks({
        db,
        persist: persistCore,
        payment,
        reason,
        cancellation,
        refundedBy,
      });
      console.log(`↩️ [payment] pos refund payment=${payment.id} sale=${owner.sale.id} doc=${docnum}`);
      return res.json({
        success: true,
        kind: 'pos',
        cancellation,
        payment: marked.payment,
        sale: updatedSale,
        voidedPasses,
      });
    }

    const marked = await applyGenericRefundMarks({
      db,
      persist: persistCore,
      payment,
      reason,
      cancellation,
      refundedBy,
    });
    console.log(`↩️ [payment] refund payment=${payment.id} doc=${docnum} → ${cancellation.docnum}`);
    res.json({ success: true, kind: 'generic', cancellation, payment: marked.payment });
  } catch (err) {
    console.error('payment refund error:', err.message, err.details?.error_details || '');
    const details = Array.isArray(err.details?.error_details)
      ? err.details.error_details.filter(Boolean).join(' · ')
      : '';
    let message = details || err.message;
    const lower = String(message || '').toLowerCase();
    if (lower.includes('no cc payment') || lower.includes('no credit')) {
      message =
        'לתשלום אין חיוב אשראי — אי אפשר להחזיר כסף לכרטיס. אם זה תשלום במזומן, רענן ונסה שוב (ביטול מסמך בלבד).';
    }
    res.status(502).json({ error: message, code: err.code });
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

    // The process that receives the notification is not necessarily the one that
    // opened the payment link — a second instance, a restart, or a purchase made
    // from another machine. Matching only against this process's memory silently
    // drops the notification, and the customer is charged without getting the
    // pass. Read the durable store first, like the refund route does.
    await refreshPaymentTables();

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
          const storedItems = sale.items || [];
          // Re-attach the benefit marks from our own stored sale (mapCartLines
          // rebuilds a fixed shape), so a pass bought on a discounted link is
          // filed with what was actually paid.
          const lines = mapCartLines(
            storedItems.map((line) => ({
              ...line,
              pricelist_id: line.pricelist_id,
              quantity: line.quantity,
              unitprice: line.unitprice,
            }))
          ).map((line, index) => {
            const stored = storedItems[index];
            if (!stored?.coupon_applied) return line;
            return {
              ...line,
              coupon_applied: true,
              list_price: stored.list_price,
              coupon_label: stored.coupon_label,
              coupon_code: stored.coupon_code,
            };
          });
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

          // The money arrived, so the reservation becomes a real redemption.
          if (sale.coupon_id) {
            const held = db.getOne('customer_coupons', sale.coupon_id);
            if (held && held.status === COUPON_STATUS.RESERVED) {
              redeemCoupon(db, sale.coupon_id, {
                saleId: sale.id,
                amount: sale.coupon_discount || 0,
              });
              await persistCore('customer_coupons', db.getOne('customer_coupons', sale.coupon_id));
              console.log(`🎟️ [POS] coupon ${sale.coupon_code} redeemed on paid link ${sale.id}`);
            }
          }
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
          rentalEndsAt: payment.equipment_rental_ends_at || null,
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
    lastName: parent?.lastName,
    idNumber: parent?.idNumber,
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

// ─── משמרת קיר מהמסוף ────────────────────────────────────────────────────────
// פתיחה וסגירה של משמרת מפעיל קיר ממסוף הכניסה. הסגירה יוצרת שורת עבודה
// בתפקיד „מפעיל קיר” עם השעות בפועל — זו השורה שמסך השכר סוכם.

app.get('/api/wall-shift/open', (req, res) => {
  const open = (db.get('shift_hours') || []).filter((s) => s.status === 'open');
  res.json(open.map((s) => ({
    id: s.id,
    employee_id: s.employee_id,
    clock_in: s.clock_in,
    activity_type: s.activity_type,
  })));
});

app.post('/api/wall-shift/open', (req, res) => {
  const { employee_id: employeeId } = req.body || {};
  if (!employeeId) return res.status(400).json({ error: 'employee_id is required' });
  const emp = (db.get('employees') || []).find((e) => e.id === employeeId);
  if (!emp) return res.status(404).json({ error: 'העובד לא נמצא' });
  const shift = db.clockIn(employeeId, 'counter_shift', 'משמרת קיר — מסוף כניסה');
  const dueSafety = (db.getSafetyDueToday() || []).filter((c) => c.is_due && !c.signed_today);
  res.status(201).json({ shift, due_safety: dueSafety });
});

app.post('/api/wall-shift/close', async (req, res) => {
  const { employee_id: employeeId, closed_by: closedById } = req.body || {};
  if (!employeeId) return res.status(400).json({ error: 'employee_id is required' });

  // מי שסוגר לא חייב להיות מי שפתח — מדריך אחר יכול לסגור בשם מי שכבר הלך.
  // אם לא צוין סוגר, מניחים שהעובד סוגר לעצמו.
  let closerNote = '';
  if (closedById && closedById !== employeeId) {
    const closer = (db.get('employees') || []).find((e) => e.id === closedById);
    if (!closer) return res.status(404).json({ error: 'העובד הסוגר לא נמצא' });
    closerNote = `נסגר ע"י ${closer.name}`;
  }

  const shift = db.clockOut(employeeId, closerNote, closedById || null);
  if (!shift) return res.status(404).json({ error: 'אין משמרת פתוחה לעובד הזה' });

  // שורת השכר נגזרת מהשעון: מהכניסה עד היציאה, מעוגל לחצי שעה כלפי מעלה.
  // השעות תמיד משולמות לבעל המשמרת — מי שסגר הוא רק פרט מתועד, לא מקבל השכר.
  const cin = israelLocalParts(shift.clock_in);
  const cout = israelLocalParts(shift.clock_out);
  let row = null;
  if (cin && cout) {
    const minutes = (new Date(shift.clock_out) - new Date(shift.clock_in)) / 60000;
    row = db.insert('work_assignments', withFrozenPay({
      employee_id: employeeId,
      activity_id: null,
      group_id: null,
      date: cin.date,
      work_type: 'counter_shift',
      role: await systemRoleLabel(SYSTEM_ROLE_KEYS.WALL_OPERATOR),
      start_time: cin.hm,
      end_time: cout.hm,
      hours: roundHoursHalfUp(minutes / 60),
      pay_mode: 'hourly',
      flat_amount: null,
      source: 'wall_shift',
      shift_id: shift.id,
      approved: false,
      notes: closerNote,
    }));
  }
  res.json({ shift, row });
});

// ─── קטלוג התפקידים וההסמכות ─────────────────────────────
// לתפקידי המערכת יש מפתח יציב (`trainer`, `wall_operator`...) שהקוד מזהה
// לפיו, ותווית שהמשתמש רשאי לשנות. שינוי תווית מתפשט לכל מקום שהשם שמור בו,
// והמפתח נשאר — כך אפשר לקרוא ל„מדריך” בשם אחר בלי לשבור שיבוץ או תמחור.
const SYSTEM_ROLE_KEYS = {
  TRAINER: 'trainer',
  ASSISTANT: 'assistant',
  WALL_OPERATOR: 'wall_operator',
  RAPPEL: 'rappel',
  PRIVATE: 'private',
  ROUTE: 'route_l1',
};

// התוויות מנוסחות כמשימה ולא כתואר: מה העובד עושה במשמרת, לא איך קוראים לו.
const DEFAULT_SYSTEM_ROLES = [
  { key: SYSTEM_ROLE_KEYS.TRAINER, label: 'הדרכת חוג' },
  { key: SYSTEM_ROLE_KEYS.ASSISTANT, label: 'עוזר מדריך' },
  { key: SYSTEM_ROLE_KEYS.WALL_OPERATOR, label: 'הפעלת קיר' },
  { key: SYSTEM_ROLE_KEYS.RAPPEL, label: 'הדרכת סנפלינג' },
  { key: SYSTEM_ROLE_KEYS.PRIVATE, label: 'שיעור פרטי' },
  { key: SYSTEM_ROLE_KEYS.ROUTE, label: 'בונה מסלולים' },
];

/**
 * התוויות הישנות, לפני שהתפקידים נוסחו כמשימות. שתי רמות בניית המסלולים
 * התאחדו לאחת — לא היה הבדל בתמחור ובשיבוץ ביניהן. הרשימה נדרשת כדי להחליף
 * את השם בכל מקום שהוא כבר שמור בו; בלעדיה עובד שסומן „מדריך” לא היה נמצא
 * כשהיומן מחפש מי מתאים ל„הדרכת חוג”.
 */
const LEGACY_ROLE_LABELS = [
  { from: 'מדריך', to: 'הדרכת חוג' },
  { from: 'מפעיל קיר', to: 'הפעלת קיר' },
  { from: 'מדריך סנפלינג', to: 'הדרכת סנפלינג' },
  { from: 'מדריך שיעור פרטי', to: 'שיעור פרטי' },
  { from: 'בונה מסלולים רמה 1', to: 'בונה מסלולים' },
  { from: 'בונה מסלולים רמה 2', to: 'בונה מסלולים' },
  { from: 'בניית מסלולים', to: 'בונה מסלולים' },
];
const DEFAULT_EXTRA_ROLES = ['מנהל פארק חבלים', 'מדריך טיפוס ספורטיבי', 'מאמן אתלטיקה', 'מורה דרך'];

/** אילו תפקידים מתאימים לכל סוג פעילות ביומן. ברירת מחדל שאפשר לשנות. */
const DEFAULT_ACTIVITY_ROLES = {
  // יום הולדת, בית ספר ופעילות חברה החזיקו בדיוק את אותה שורה. עכשיו הם סוג
  // אחד, והתגית מבדילה ביניהם בלי לפצל את השיבוץ והשכר.
  event: [SYSTEM_ROLE_KEYS.TRAINER, SYSTEM_ROLE_KEYS.ASSISTANT],
  personal_training: [SYSTEM_ROLE_KEYS.TRAINER],
  trip: [SYSTEM_ROLE_KEYS.RAPPEL],
  opening_hours: [SYSTEM_ROLE_KEYS.WALL_OPERATOR],
  route_building: [SYSTEM_ROLE_KEYS.ROUTE],
  other: [],
};

/**
 * סוגי הפעילות ביומן.
 *
 * הרשימה היא נתון ולא קוד, כדי שאפשר יהיה להוסיף מחר סוג חדש בלי גרסה. לשני
 * סוגים יש התנהגות מיוחדת שכתובה בקוד (`opening_hours` פותח יום קיר,
 * `training_vacation` מבטל אימונים), ולכן הם מסומנים `locked` — אפשר לשנות
 * להם שם וצבע, אבל מחיקה הייתה מכבה יכולת בלי שיישאר לה מסך.
 */
const DEFAULT_ACTIVITY_TYPES = [
  // „אירוע” אחד במקום שלושה. איזה אירוע בדיוק נשמר בתגית (`event_kind`).
  { id: 'event', label: 'אירוע', color: '#FB923C', bg: 'rgba(251,146,60,0.18)' },
  { id: 'trip', label: 'טיול', color: '#60A5FA', bg: 'rgba(96,165,250,0.18)' },
  { id: 'personal_training', label: 'אימון אישי', color: '#34D399', bg: 'rgba(52,211,153,0.18)' },
  { id: 'route_building', label: 'בניית מסלולים', color: '#A78BFA', bg: 'rgba(167,139,250,0.18)' },
  { id: 'opening_hours', label: 'שעות פתיחה', color: '#22D3EE', bg: 'rgba(34,211,238,0.16)', locked: true },
  { id: 'training_vacation', label: 'חופשה מאימונים', color: '#F472B6', bg: 'rgba(244,114,182,0.18)', locked: true },
  { id: 'other', label: 'אחר', color: '#94A3B8', bg: 'rgba(148,163,184,0.16)', locked: true },
];

const ROLE_CATALOG_KEY = 'staff_role_catalog';
const ACTIVITY_TYPE_CATALOG_KEY = 'activity_type_catalog';

function blankCatalog() {
  return {
    system: DEFAULT_SYSTEM_ROLES.map((r) => ({ ...r })),
    extra: [...DEFAULT_EXTRA_ROLES],
    activityRoles: { ...DEFAULT_ACTIVITY_ROLES },
  };
}

/** משלים שדות חסרים, כדי שקטלוג שנשמר בגרסה קודמת ימשיך לעבוד. */
function normalizeCatalog(raw) {
  const base = blankCatalog();
  if (!raw || typeof raw !== 'object') return base;

  // גרסה ישנה החזיקה רק `extra`; תפקידי המערכת היו קבועים בקוד.
  // תווית שנשמרה בניסוח הישן מוחלפת בחדש; תווית שהמשתמש שינה בעצמו נשארת.
  const system = Array.isArray(raw.system) && raw.system.every((r) => r && r.key)
    ? DEFAULT_SYSTEM_ROLES.map((def) => {
      const found = raw.system.find((r) => r.key === def.key);
      const saved = String(found?.label || def.label);
      const renamed = LEGACY_ROLE_LABELS.find((l) => l.from === saved);
      return { key: def.key, label: renamed ? renamed.to : saved };
    })
    : base.system;

  const knownKeys = new Set(system.map((r) => r.key));
  const extra = Array.isArray(raw.extra) ? raw.extra.map(String).filter(Boolean) : base.extra;
  const rawActivityRoles = (raw.activityRoles && typeof raw.activityRoles === 'object')
    ? { ...base.activityRoles, ...raw.activityRoles }
    : base.activityRoles;
  // מפתח של תפקיד שכבר לא קיים (route_l2) נשמט, בלי לרוקן את הסוג.
  const activityRoles = {};
  for (const [type, keys] of Object.entries(rawActivityRoles)) {
    const kept = (Array.isArray(keys) ? keys : [])
      .filter((k) => knownKeys.has(k) || extra.includes(k));
    activityRoles[type] = [...new Set(kept)];
  }

  return { system, extra, activityRoles };
}

/**
 * מחזיר את הקטלוג, ומעדכן תוך כדי את התוויות שהתמחור נשען עליהן. בלי זה,
 * שורה ותיקה בלי תפקיד רשום הייתה מתומחרת לפי שם שכבר שונה — כלומר ₪0.
 */
async function readRoleCatalog() {
  const local = db.getAppSettingLocal?.(ROLE_CATALOG_KEY);
  if (local) {
    const normalized = normalizeCatalog(local);
    applyRoleLabels(normalized.system);
    return normalized;
  }
  try {
    const remote = await supa.getAppSetting(ROLE_CATALOG_KEY);
    if (remote) {
      const normalized = normalizeCatalog(remote);
      db.setAppSettingLocal?.(ROLE_CATALOG_KEY, normalized);
      applyRoleLabels(normalized.system);
      return normalized;
    }
  } catch { /* אין עותק עמיד — ממשיכים לברירת המחדל */ }
  const blank = blankCatalog();
  applyRoleLabels(blank.system);
  return blank;
}

async function writeRoleCatalog(catalog) {
  const value = normalizeCatalog(catalog);
  db.setAppSettingLocal?.(ROLE_CATALOG_KEY, value);
  applyRoleLabels(value.system);
  try { await supa.setAppSetting(ROLE_CATALOG_KEY, value); } catch { /* נשמר מקומית */ }
  return value;
}

/**
 * התווית הנוכחית של תפקיד מערכת. הקוד שכותב שורות עבודה חייב לעבור דרך כאן —
 * אחרת שינוי שם היה יוצר שורות עם השם הישן לצד נתונים שכבר הומרו.
 */
async function systemRoleLabel(key) {
  const catalog = await readRoleCatalog();
  const found = catalog.system.find((r) => r.key === key);
  return found?.label || DEFAULT_SYSTEM_ROLES.find((r) => r.key === key)?.label || '';
}

/**
 * התוויות של התפקידים שמתאימים לסוג פעילות. מוחזרות תוויות ולא מפתחות, כי זה
 * מה ששמור על העובדים ועל שורות העבודה.
 */
async function rolesForActivityType(activityType) {
  const catalog = await readRoleCatalog();
  const keys = catalog.activityRoles?.[activityType];
  if (!Array.isArray(keys) || keys.length === 0) return [];
  return keys
    .map((key) => catalog.system.find((r) => r.key === key)?.label
      || (catalog.extra.includes(key) ? key : null))
    .filter(Boolean);
}

function allCatalogLabels(catalog) {
  return [...catalog.system.map((r) => r.label), ...catalog.extra];
}

/**
 * מחליף שם תפקיד בכל מקום שהוא שמור בו. מחזיר כמה רשומות עודכנו.
 * כפילויות נמחקות: אם השם החדש כבר קיים אצל אותו עובד (איחוד שני תפקידים
 * לאחד), הוא לא יופיע פעמיים.
 */
function propagateRoleRename(from, to) {
  let touched = 0;
  for (const emp of db.get('employees') || []) {
    const certs = Array.isArray(emp.certifications) ? emp.certifications : [];
    if (!certs.includes(from)) continue;
    db.update('employees', emp.id, {
      certifications: [...new Set(certs.map((c) => (c === from ? to : c)))],
    });
    touched += 1;
  }
  for (const wage of db.get('wage_agreements') || []) {
    const rates = Array.isArray(wage.rates) ? wage.rates : [];
    if (!rates.some((r) => r.role === from)) continue;
    const merged = [];
    for (const rate of rates) {
      const role = rate.role === from ? to : rate.role;
      // בין שני תעריפים לאותו תפקיד נשמר זה שיש בו סכום.
      const existing = merged.find((r) => r.role === role);
      if (!existing) merged.push({ ...rate, role });
      else if (!Number(existing.amount) && Number(rate.amount)) {
        Object.assign(existing, { ...rate, role });
      }
    }
    db.update('wage_agreements', wage.id, { rates: merged });
    touched += 1;
  }
  for (const act of db.get('activities') || []) {
    if (act.staff_role !== from) continue;
    db.update('activities', act.id, { staff_role: to });
    touched += 1;
  }
  for (const row of db.get('work_assignments') || []) {
    if (row.role !== from) continue;
    db.update('work_assignments', row.id, { role: to });
    touched += 1;
  }
  return touched;
}

// ─── קטלוג סוגי הפעילות ──────────────────────────────────────────────────────

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** רקע שקוף לצבע — כך מספיק לבחור צבע אחד וגם הכרטיס ביומן מקבל גוון. */
function bgForColor(color) {
  const hex = HEX_COLOR.test(color) ? color : '#94A3B8';
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},0.18)`;
}

/** מזהה יציב לסוג חדש. השם עשוי להשתנות, המזהה נשאר על הפעילויות. */
function activityTypeId(label) {
  const slug = String(label).trim().toLowerCase()
    .replace(/[^a-z0-9֐-׿]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `t_${slug || 'type'}_${Date.now().toString(36)}`;
}

function normalizeActivityTypes(raw) {
  const base = DEFAULT_ACTIVITY_TYPES.map((t) => ({ ...t }));
  if (!Array.isArray(raw) || raw.length === 0) return base;

  const byId = new Map();
  for (const item of raw) {
    const id = String(item?.id || '').trim();
    if (!id || byId.has(id)) continue;
    const fallback = base.find((t) => t.id === id);
    const color = HEX_COLOR.test(item?.color) ? item.color : (fallback?.color || '#94A3B8');
    byId.set(id, {
      id,
      label: String(item?.label || fallback?.label || id),
      color,
      bg: typeof item?.bg === 'string' && item.bg ? item.bg : bgForColor(color),
      // ההגנה על סוג מערכת חיה בקוד ולא במה שנשמר, כדי שעריכה ידנית של
      // ההגדרה לא תוכל להפוך סוג נעול לנמחק.
      locked: !!fallback?.locked,
    });
  }
  // סוג מערכת שנמחק מהנתון השמור חוזר — הקוד עדיין מסתמך עליו.
  for (const t of base) if (t.locked && !byId.has(t.id)) byId.set(t.id, t);
  return [...byId.values()];
}

async function readActivityTypes() {
  const local = db.getAppSettingLocal?.(ACTIVITY_TYPE_CATALOG_KEY);
  if (local) return normalizeActivityTypes(local);
  try {
    const remote = await supa.getAppSetting(ACTIVITY_TYPE_CATALOG_KEY);
    if (remote) {
      const normalized = normalizeActivityTypes(remote);
      db.setAppSettingLocal?.(ACTIVITY_TYPE_CATALOG_KEY, normalized);
      return normalized;
    }
  } catch { /* אין עותק עמיד — ממשיכים לברירת המחדל */ }
  return normalizeActivityTypes(null);
}

async function writeActivityTypes(list) {
  const value = normalizeActivityTypes(list);
  db.setAppSettingLocal?.(ACTIVITY_TYPE_CATALOG_KEY, value);
  try { await supa.setAppSetting(ACTIVITY_TYPE_CATALOG_KEY, value); } catch { /* נשמר מקומית */ }
  return value;
}

/** כמה פעילויות משתמשות בסוג — מה שקובע אם מותר למחוק אותו. */
function activitiesUsingType(typeId) {
  return (db.get('activities') || []).filter((a) => a.type === typeId).length;
}

app.get('/api/activity-types', async (req, res) => {
  const types = await readActivityTypes();
  res.json(types.map((t) => ({ ...t, in_use: activitiesUsingType(t.id) })));
});

app.post('/api/activity-types', async (req, res) => {
  const label = String(req.body?.label || '').trim();
  if (!label) return res.status(400).json({ error: 'שם הסוג חסר' });
  const types = await readActivityTypes();
  if (types.some((t) => t.label === label)) {
    return res.status(409).json({ error: 'כבר קיים סוג בשם הזה' });
  }
  const color = HEX_COLOR.test(req.body?.color) ? req.body.color : '#94A3B8';
  const created = { id: activityTypeId(label), label, color, bg: bgForColor(color), locked: false };
  const saved = await writeActivityTypes([...types, created]);
  res.status(201).json({ types: saved, created });
});

app.put('/api/activity-types/:id', async (req, res) => {
  const { id } = req.params;
  const types = await readActivityTypes();
  const found = types.find((t) => t.id === id);
  if (!found) return res.status(404).json({ error: 'הסוג לא נמצא' });

  const label = req.body?.label !== undefined ? String(req.body.label).trim() : found.label;
  if (!label) return res.status(400).json({ error: 'שם הסוג חסר' });
  if (types.some((t) => t.id !== id && t.label === label)) {
    return res.status(409).json({ error: 'כבר קיים סוג בשם הזה' });
  }
  const color = HEX_COLOR.test(req.body?.color) ? req.body.color : found.color;
  const next = types.map((t) => (t.id === id ? { ...t, label, color, bg: bgForColor(color) } : t));
  res.json(await writeActivityTypes(next));
});

app.delete('/api/activity-types/:id', async (req, res) => {
  const { id } = req.params;
  const types = await readActivityTypes();
  const found = types.find((t) => t.id === id);
  if (!found) return res.status(404).json({ error: 'הסוג לא נמצא' });
  if (found.locked) {
    return res.status(400).json({ error: 'זה סוג שהמערכת מסתמכת עליו — אפשר לשנות לו שם וצבע, אבל לא למחוק' });
  }
  const used = activitiesUsingType(id);
  if (used > 0) {
    return res.status(409).json({
      error: `יש ${used} פעילויות מהסוג הזה. העבירו אותן לסוג אחר לפני המחיקה.`,
      in_use: used,
    });
  }
  const saved = await writeActivityTypes(types.filter((t) => t.id !== id));
  // המיפוי לתפקידים מתלווה לסוג — אין טעם להשאיר שורה יתומה.
  const catalog = await readRoleCatalog();
  if (catalog.activityRoles?.[id]) {
    delete catalog.activityRoles[id];
    await writeRoleCatalog(catalog);
  }
  res.json(saved);
});

/**
 * המרה חד-פעמית לניסוח המשימות. רצה בעלייה של השרת ושותקת כשאין מה להמיר,
 * כי אחרי ההמרה הראשונה אף רשומה כבר לא מחזיקה את השמות הישנים.
 */
async function migrateLegacyRoleLabels() {
  const catalog = await readRoleCatalog();
  const current = new Set(catalog.system.map((r) => r.label));
  let touched = 0;
  for (const { from, to } of LEGACY_ROLE_LABELS) {
    // שם ישן שהמשתמש בחר להשאיר כתווית פעילה אינו „ישן” — לא נוגעים בו.
    if (current.has(from)) continue;
    touched += propagateRoleRename(from, to);
  }
  // כותבים רק אם ההמרה באמת שינתה משהו. כתיבה בכל עלייה הייתה דורסת שם
  // שהמשתמש בחר בעצמו במקרה שהקריאה מהאחסון העמיד נכשלה והוחזרה ברירת מחדל.
  const stored = db.getAppSettingLocal?.(ROLE_CATALOG_KEY);
  const storedDiffers = stored && JSON.stringify(stored) !== JSON.stringify(catalog);
  if (touched > 0 || storedDiffers) {
    await writeRoleCatalog(catalog);
  }
  if (touched > 0) console.log(`🧗 שמות תפקידים הומרו לניסוח משימה ב-${touched} רשומות`);
  return touched;
}

app.get('/api/staff-roles', async (req, res) => {
  const catalog = await readRoleCatalog();
  // התוויות המחושבות נשלחות לצד הלקוח כדי שלא יצטרך לתרגם מפתחות בעצמו.
  const labelsByType = {};
  for (const type of Object.keys(catalog.activityRoles || {})) {
    labelsByType[type] = await rolesForActivityType(type);
  }
  res.json({ ...catalog, activityRoleLabels: labelsByType });
});

app.post('/api/staff-roles', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'שם התפקיד חסר' });
  const catalog = await readRoleCatalog();
  if (allCatalogLabels(catalog).includes(name)) {
    return res.status(409).json({ error: 'התפקיד כבר קיים' });
  }
  catalog.extra.push(name);
  res.status(201).json(await writeRoleCatalog(catalog));
});

app.post('/api/staff-roles/rename', async (req, res) => {
  const from = String(req.body?.from || '').trim();
  const to = String(req.body?.to || '').trim();
  if (!from || !to) return res.status(400).json({ error: 'חסר שם ישן או חדש' });

  const catalog = await readRoleCatalog();
  if (from !== to && allCatalogLabels(catalog).includes(to)) {
    return res.status(409).json({ error: 'השם החדש כבר קיים' });
  }

  // תפקיד מערכת: המפתח נשאר, רק התווית משתנה.
  const systemRole = catalog.system.find((r) => r.label === from);
  if (systemRole) {
    systemRole.label = to;
  } else {
    const idx = catalog.extra.indexOf(from);
    if (idx === -1) return res.status(404).json({ error: 'התפקיד לא נמצא' });
    catalog.extra[idx] = to;
  }

  const saved = await writeRoleCatalog(catalog);
  const touched = propagateRoleRename(from, to);
  res.json({ ...saved, touched });
});

app.post('/api/staff-roles/delete', async (req, res) => {
  const role = String(req.body?.role || '').trim();
  if (!role) return res.status(400).json({ error: 'שם התפקיד חסר' });

  const catalog = await readRoleCatalog();
  if (catalog.system.some((r) => r.label === role)) {
    return res.status(400).json({
      error: 'זה תפקיד מערכת — אפשר לשנות לו שם, אבל לא למחוק אותו',
    });
  }
  catalog.extra = catalog.extra.filter((r) => r !== role);
  const saved = await writeRoleCatalog(catalog);

  // מסירים מהעובדים ומההסכמים; שורות עבודה היסטוריות שומרות את השם.
  let touched = 0;
  for (const emp of db.get('employees') || []) {
    const certs = Array.isArray(emp.certifications) ? emp.certifications : [];
    if (!certs.includes(role)) continue;
    db.update('employees', emp.id, { certifications: certs.filter((c) => c !== role) });
    touched += 1;
  }
  for (const wage of db.get('wage_agreements') || []) {
    const rates = Array.isArray(wage.rates) ? wage.rates : [];
    if (!rates.some((r) => r.role === role)) continue;
    db.update('wage_agreements', wage.id, { rates: rates.filter((r) => r.role !== role) });
    touched += 1;
  }
  res.json({ ...saved, touched });
});

/** אילו תפקידים אפשר לשבץ לסוג פעילות. */
app.post('/api/staff-roles/activity-roles', async (req, res) => {
  const { activity_type: activityType, role_keys: roleKeys } = req.body || {};
  if (!activityType) return res.status(400).json({ error: 'activity_type is required' });
  if (!Array.isArray(roleKeys)) return res.status(400).json({ error: 'role_keys must be an array' });

  const catalog = await readRoleCatalog();
  const known = new Set([...catalog.system.map((r) => r.key), ...catalog.extra]);
  catalog.activityRoles = {
    ...catalog.activityRoles,
    [activityType]: roleKeys.filter((k) => known.has(k)),
  };
  res.json(await writeRoleCatalog(catalog));
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
      // The schedule screen only offers an employee for a slot they are marked
      // for, so the roles list has to travel with the name — without it every
      // dropdown there is empty but for people already assigned.
      certifications: Array.isArray(employee.certifications) ? employee.certifications : [],
    })));
});

app.get('/api/employees', (req, res) => {
  res.json(db.get('employees'));
});

// Same field catalog the public onboarding form renders from (label/type/
// options per field) — the internal edit form reads it too, so a label or
// option list only ever needs to change in one place. Unlike the
// enabled/required *config* (owner-only, /api/settings/...), this is plain
// metadata: any signed-in team member editing an employee needs it.
app.get('/api/employees/onboard-fields', async (_req, res) => {
  try {
    res.json(mergeFieldDefs(await getEmployeeOnboardConfig()));
  } catch (error) {
    console.error('employees/onboard-fields load error:', error.message);
    res.json(mergeFieldDefs(await getEmployeeOnboardConfig()));
  }
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

/**
 * ההסכמים הישנים מוגשים עם רשימת תעריפים מלאה, כדי שהמסך לא יצטרך להכיר את
 * ארבעת השדות הקבועים שהיו פעם. השדות עצמם נשארים על השורה — הם עוד נקראים
 * במקומות ותיקים, ומחיקתם הייתה משנה נתוני שכר בלי שביקשו.
 */
function wageWithRates(agreement) {
  return {
    ...agreement,
    rates: ratesOf(agreement),
    travel_per_day: travelPerDay(agreement),
  };
}

function normalizeWageBody(body = {}) {
  const next = { ...body };
  if (Array.isArray(body.rates)) {
    next.rates = body.rates
      .filter((r) => r && r.role)
      .map((r) => ({
        role: String(r.role),
        mode: PAY_MODES.includes(r.mode) ? r.mode : 'hourly',
        amount: Math.max(0, Number(r.amount) || 0),
      }));
  }
  if (body.travel_per_day !== undefined) {
    next.travel_per_day = Math.max(0, Number(body.travel_per_day) || 0);
  }
  return next;
}

app.get('/api/wages', (req, res) => {
  res.json((db.get('wage_agreements') || []).map(wageWithRates));
});

app.post('/api/wages', (req, res) => {
  const { employee_id } = req.body || {};
  if (!employee_id) return res.status(400).json({ error: 'employee_id is required' });
  const body = normalizeWageBody(req.body);

  // One agreement per employee: reuse the existing row instead of creating a duplicate.
  const existing = (db.get('wage_agreements') || []).find((w) => w.employee_id === employee_id);
  if (existing) {
    const updated = db.update('wage_agreements', existing.id, { ...body, id: existing.id });
    return res.json(wageWithRates(updated));
  }

  const created = db.insert('wage_agreements', body);
  res.status(201).json(wageWithRates(created));
});

app.put('/api/wages/:id', (req, res) => {
  const { id } = req.params;
  const updated = db.update('wage_agreements', id, normalizeWageBody(req.body));
  if (!updated) return res.status(404).json({ error: 'Wage agreement not found' });
  res.json(wageWithRates(updated));
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

function normalizePayMode(value, existing = null) {
  const raw = value !== undefined ? value : existing?.pay_mode;
  return raw === 'flat' ? 'flat' : 'hourly';
}

function normalizeFlatAmount(value, payMode, existing = null) {
  if (payMode !== 'flat') return null;
  const raw = value !== undefined ? value : existing?.flat_amount;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * חתימת השכר על שורת עבודה.
 *
 * הסכום נשמר על השורה עצמה ולא מחושב מחדש בכל צפייה, כי התעריפים ושמות
 * התפקידים משתנים עם הזמן — ומשכורת של חודש שעבר חייבת להישאר מה שסוכם אז.
 * החתימה מתרעננת בכל כתיבה של השורה, עד שהיא ננעלת בסוף היום.
 */
function payFieldsForWorkRow(row) {
  const agreement = (db.get('wage_agreements') || [])
    .find((w) => w.employee_id === row.employee_id) || null;
  const role = row.role || workTypeRole(row.work_type) || null;
  const rate = rateForRole(agreement, role);
  // בלי pay_frozen_at על העותק — אחרת החישוב היה מחזיר את הסכום הישן.
  const amount = amountForWorkRow({ ...row, pay_frozen_at: null }, agreement);
  return {
    pay_amount: amount,
    pay_rate: rate ? rate.amount : null,
    pay_rate_mode: rate ? rate.mode : (row.pay_mode === 'flat' ? 'flat' : null),
    pay_frozen_at: new Date().toISOString(),
  };
}

/** שורה חדשה נכתבת כבר עם השכר החתום עליה. */
function withFrozenPay(fields) {
  return { ...fields, ...payFieldsForWorkRow(fields) };
}

/**
 * נעילת יום: כל שורה מיום שהסתיים מתומחרת מחדש לפי מה שידוע עכשיו ואז ננעלת.
 * הריצה חוזרת כל שעה, כך שיום נסגר מעצמו גם בלי שאף אחד נכנס למערכת.
 */
function sealPastWorkDays() {
  const today = israelLocalParts(new Date())?.date || new Date().toISOString().slice(0, 10);
  const withAgreement = new Set((db.get('wage_agreements') || []).map((w) => w.employee_id));
  let sealed = 0;
  let released = 0;
  for (const row of db.get('work_assignments') || []) {
    if (!row.date || row.date >= today) continue;
    if (row.pay_locked_at) {
      // שורה שננעלה על ₪0 בלי תעריף — הנעילה הייתה מקבעת טעות. משחררים אותה
      // כדי שתיתפס שוב ברגע שיהיה לתפקיד שלה תעריף.
      if (row.pay_mode !== 'flat' && !Number(row.pay_amount)) {
        db.update('work_assignments', row.id, { pay_locked_at: null, pay_frozen_at: null });
        released += 1;
      }
      continue;
    }
    // בלי הסכם שכר אין לפי מה לתמחר. נעילה כאן הייתה מקבעת ₪0 לנצח, ולכן
    // השורה ממתינה — ברגע שייכתב הסכם לעובד היא תיתפס בסבב הבא.
    if (row.pay_mode !== 'flat' && !withAgreement.has(row.employee_id)) continue;
    // שורה בלי תפקיד היא נתון חסר ולא התנדבות. נעילה שלה הייתה מקבעת ₪0.
    if (row.pay_mode !== 'flat' && !(row.role || workTypeRole(row.work_type))) continue;
    const pay = payFieldsForWorkRow(row);
    // ₪0 בשורה שעתית פירושו שאין עדיין תעריף לתפקיד — לא נועלים אפס.
    if (row.pay_mode !== 'flat' && !pay.pay_amount) continue;
    db.update('work_assignments', row.id, { ...pay, pay_locked_at: new Date().toISOString() });
    sealed += 1;
  }
  if (sealed > 0) console.log(`💰 ננעלו ${sealed} שורות שכר מימים שהסתיימו`);
  if (released > 0) console.log(`🔓 שוחררו ${released} שורות שננעלו בלי תעריף`);
  return sealed;
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
  const payMode = normalizePayMode(body.pay_mode, existing);
  const flatAmount = normalizeFlatAmount(body.flat_amount, payMode, existing);
  return {
    employee_id: body.employee_id || existing?.employee_id || null,
    activity_id: body.activity_id !== undefined ? (body.activity_id || null) : (existing?.activity_id ?? null),
    // A class shift hangs off a group rather than a calendar activity. Keeping
    // the group here is what lets staff attendance find its own row again.
    group_id: body.group_id !== undefined ? (body.group_id || null) : (existing?.group_id ?? null),
    date: body.date || existing?.date || null,
    work_type: workType,
    // התפקיד הוא מה שקובע את התעריף. `work_type` נשאר לשורות ותיקות ולמסכים
    // שעוד מדברים בשפה הישנה, אבל התמחור עובר דרך התפקיד.
    role: body.role !== undefined
      ? (body.role || null)
      : (existing?.role ?? workTypeRole(workType) ?? null),
    start_time: startTime,
    end_time: endTime,
    hours,
    pay_mode: payMode,
    flat_amount: flatAmount,
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

app.post('/api/work-assignments/from-activity', async (req, res) => {
  const { activity_id, employee_ids, employee_roles: employeeRoles } = req.body || {};
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
  // האירוע עצמו קובע את התפקיד ואת אופן התשלום: „לפי תעריף” מושך את התעריף
  // האישי של כל עובד לתפקיד הזה, ו„גלובלי” משלם סכום קבוע שהוגדר על האירוע.
  // כשלסוג הפעילות מתאימים כמה תפקידים, כל עובד יכול לשבת בתפקיד אחר —
  // `employee_roles` נושא את הבחירה, ובלי זה נופלים לתפקיד הראשון שמתאים.
  const allowedRoles = await rolesForActivityType(activity.type);
  const defaultRole = activity.staff_role || allowedRoles[0] || workTypeRole(workType) || null;
  const flatPay = activity.staff_pay_mode === 'flat';
  const flatAmount = flatPay ? (Number(activity.staff_flat_amount) || 0) : null;
  const existing = (db.get('work_assignments') || []).filter((r) => r.activity_id === activity_id);
  const created = [];

  for (const employeeId of ids) {
    if (existing.some((r) => r.employee_id === employeeId)) continue;
    const suggestion = suggestHoursFromClock(employeeId, activity.date, eventStart, eventEnd);
    const row = db.insert('work_assignments', withFrozenPay({
      employee_id: employeeId,
      activity_id,
      date: activity.date,
      work_type: workType,
      role: (employeeRoles && employeeRoles[employeeId]) || defaultRole,
      start_time: suggestion?.start_time || eventStart,
      end_time: suggestion?.end_time || eventEnd,
      hours: suggestion?.hours || eventHours,
      pay_mode: flatPay ? 'flat' : 'hourly',
      flat_amount: flatAmount,
      source: suggestion ? suggestion.source : 'calendar',
      shift_id: suggestion?.shift_id || null,
      approved: false,
      notes: '',
    }));
    created.push(row);
  }

  res.status(201).json({ created, existing_count: existing.length });
});

/**
 * נוכחות הצוות באימון של קבוצה.
 *
 * הנוכחות עצמה חיה ב-`staff_attendance` — גם היעדרות היא עובדה שרוצים לספור,
 * ושורת שכר לא יכולה לייצג אותה. נוכחות של מדריך מייצרת בנוסף שורת עבודה
 * (`work_assignments`) מסוג „חוג”, שממנה מחושב השכר. עוזרי מדריך מתנדבים:
 * השעות נספרות להם, שורת שכר לא נוצרת.
 *
 * המפתח הטבעי הוא קבוצה+תאריך+עובד, ולכן סימון חוזר מעדכן ולא מכפיל.
 */
const STAFF_ATTENDANCE_SOURCE = 'class_attendance';
const STAFF_ROLES = ['trainer', 'assistant'];
/** התפקידים שמשולם עליהם. עוזר מדריך אינו כאן — זו התנדבות. */
const PAID_STAFF_ROLES = ['trainer'];
/** התפקיד בחוג בשפת הסכם השכר, שממנו נגזר התעריף. */
/** התפקיד בחוג נקרא מהקטלוג, כדי ששינוי שם ישתקף מיד גם בשורות חדשות. */
const STAFF_ROLE_KEY_FOR = {
  trainer: SYSTEM_ROLE_KEYS.TRAINER,
  assistant: SYSTEM_ROLE_KEYS.ASSISTANT,
};

function staffAttendanceRows({ groupId = null, date = null, employeeId = null } = {}) {
  return (db.get('staff_attendance') || []).filter((r) =>
    (!groupId || r.group_id === groupId)
    && (!date || r.date === date)
    && (!employeeId || r.employee_id === employeeId));
}

/** שעות האימון מתוך הגדרת הקבוצה — ברירת מחדל שאפשר לתקן במסך השכר. */
function groupShiftTimes(group) {
  const start = group?.time || '16:00';
  const startMin = parseHmToMinutes(start);
  const duration = Number(group?.duration) || 50;
  // חוג של 50 דקות משולם כשעה — העיגול הוא לחצי השעה הקרובה כלפי מעלה.
  const hours = roundHoursHalfUp(duration / 60);
  if (startMin == null) return { start_time: start, end_time: null, hours };
  const endMin = startMin + duration;
  const end = `${String(Math.floor(endMin / 60) % 24).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
  return { start_time: start, end_time: end, hours };
}

function classPayRowFor(groupId, date, employeeId) {
  return (db.get('work_assignments') || []).find((r) =>
    r.source === STAFF_ATTENDANCE_SOURCE
    && r.group_id === groupId
    && r.date === date
    && r.employee_id === employeeId) || null;
}

/** שורת השכר נגזרת מהנוכחות, ולכן היא נוצרת ונמחקת יחד איתה. */
function syncClassPayRow({ group, date, employeeId, paid, times, roleTitle }) {
  const existing = classPayRowFor(group.id, date, employeeId);
  if (!paid) {
    if (existing) db.delete('work_assignments', existing.id);
    return null;
  }
  if (existing) return existing;
  const suggestion = suggestHoursFromClock(employeeId, date, times.start_time, times.end_time);
  return db.insert('work_assignments', withFrozenPay({
    employee_id: employeeId,
    activity_id: null,
    group_id: group.id,
    date,
    work_type: 'class_shift',
    role: roleTitle || 'הדרכת חוג',
    start_time: suggestion?.start_time || times.start_time,
    end_time: suggestion?.end_time || times.end_time,
    // שעות החוג הן מה שמשולם. שעון נוכחות ארוך יותר אינו הופך חוג לשתי שעות.
    hours: times.hours,
    pay_mode: 'hourly',
    flat_amount: null,
    source: STAFF_ATTENDANCE_SOURCE,
    shift_id: suggestion?.shift_id || null,
    approved: false,
    notes: '',
  }));
}

app.get('/api/groups/:id/staff-attendance', (req, res) => {
  const { date } = req.query;
  res.json(staffAttendanceRows({ groupId: req.params.id, date: date || null }));
});

app.post('/api/groups/:id/staff-attendance', async (req, res) => {
  const groupId = req.params.id;
  const {
    date,
    employee_id: employeeId,
    status,
    role,
    substitute_for: substituteFor,
  } = req.body || {};
  if (!date) return res.status(400).json({ error: 'date is required' });
  if (!employeeId) return res.status(400).json({ error: 'employee_id is required' });

  const group = db.getOne('groups', groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  // ביום חופשה מאימונים לא היה אימון, ולכן אין למי לרשום שעות. בלי החסימה הזו
  // סימון המתאמנים כ„יום חג” היה פותח את רשימת הצוות ומזמין תשלום על כלום.
  const vacation = findTrainingVacation(db.get('activities') || [], date);
  if (vacation) {
    return res.status(409).json({
      error: 'אין נוכחות צוות ביום חופשה מאימונים',
      vacation: { id: vacation.id, name: vacation.name || '' },
    });
  }

  const existing = staffAttendanceRows({ groupId, date })
    .find((r) => r.employee_id === employeeId) || null;

  // סטטוס שאינו „נוכח”/„נעדר” מנקה את הסימון לגמרי — חזרה למצב „טרם סומן”.
  if (status !== 'present' && status !== 'absent') {
    if (existing) db.delete('staff_attendance', existing.id);
    syncClassPayRow({ group, date, employeeId, paid: false });
    return res.json({ status: null, removed: !!existing });
  }

  const staffRole = STAFF_ROLES.includes(role) ? role : 'trainer';
  const times = groupShiftTimes(group);
  const payRow = syncClassPayRow({
    group,
    date,
    employeeId,
    paid: status === 'present' && PAID_STAFF_ROLES.includes(staffRole),
    times,
    roleTitle: await systemRoleLabel(STAFF_ROLE_KEY_FOR[staffRole]),
  });

  const fields = {
    group_id: groupId,
    date,
    employee_id: employeeId,
    role: staffRole,
    status,
    substitute_for: substituteFor || null,
    // גם מתנדב צובר שעות — הן פשוט לא הופכות לכסף.
    hours: status === 'present' ? (payRow?.hours ?? times.hours) : 0,
  };
  const row = existing
    ? db.update('staff_attendance', existing.id, fields)
    : db.insert('staff_attendance', fields);

  res.status(existing ? 200 : 201).json({ status, row, paid: !!payRow });
});

/**
 * סיכום לתיק העובד: כמה שעות עבד וכמה פעמים נעדר, מופרד לפי תפקיד כדי
 * שהתנדבות כעוזר מדריך לא תיראה כמו שעות בתשלום.
 */
app.get('/api/employees/:id/attendance-summary', (req, res) => {
  const { from, to } = req.query;
  const rows = staffAttendanceRows({ employeeId: req.params.id })
    .filter((r) => (!from || r.date >= from) && (!to || r.date <= to));

  const blank = () => ({ present: 0, absent: 0, hours: 0 });
  const summary = { total: blank(), trainer: blank(), assistant: blank() };

  for (const row of rows) {
    const bucket = summary[row.role] || summary.trainer;
    const target = row.status === 'absent' ? 'absent' : 'present';
    bucket[target] += 1;
    summary.total[target] += 1;
    if (row.status !== 'absent') {
      const hrs = Number(row.hours) || 0;
      bucket.hours += hrs;
      summary.total.hours += hrs;
    }
  }
  for (const key of Object.keys(summary)) {
    summary[key].hours = Math.round(summary[key].hours * 100) / 100;
  }

  res.json({ from: from || null, to: to || null, ...summary, rows });
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
  const created = db.insert('work_assignments', withFrozenPay(normalized));
  res.status(201).json(created);
});

app.put('/api/work-assignments/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.getOne('work_assignments', id);
  if (!existing) return res.status(404).json({ error: 'Work assignment not found' });
  const normalized = normalizeWorkAssignment(req.body || {}, { existing });
  // עריכה ידנית של השורה מתמחרת אותה מחדש — גם אם היום שלה כבר ננעל. שינוי
  // תעריף או שם תפקיד לעומת זאת לא עובר כאן, ולכן לא נוגע בשורות ישנות.
  const updated = db.update('work_assignments', id, withFrozenPay({ ...existing, ...normalized }));
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
  const withStatus = req.query.withStatus !== '0' && req.query.withStatus !== 'false';
  if (withStatus) {
    return res.json(db.getSafetyCheckTypesWithStatus({ includeInactive }));
  }
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

/**
 * מה שהמדריך צריך לראות לצד כל מתאמן בגיליון היומי: איזה ציוד עוד לא
 * נמסר, ומה מצב מבחן האבטחה. נפרד מ-/api/equipment הכבד, כדי שפתיחת
 * הגיליון לא תמשוך את כל המועדון.
 */
app.get('/api/groups/:id/training-brief', async (req, res) => {
  try {
    const groupId = req.params.id;
    await refreshStudentEquipmentCache();
    const students = db
      .withStudentRelations(db.get('students') || [])
      .filter((s) => studentInGroup(s, groupId) && s.status !== 'archived');

    const tests = db.get('level_tests') || [];
    const refDate = req.query.date || israelDateStr();

    // רצף ההיעדרויות נספר על פני כל הקבוצות של המתאמן, ולכן צריך את
    // כל הנוכחות ולא רק את זו של הקבוצה הנוכחית.
    await refreshAttendanceCache();
    const attendance = db.get('attendance') || [];
    const attendanceByStudent = new Map();
    for (const row of attendance) {
      if (!row?.student_id) continue;
      const list = attendanceByStudent.get(row.student_id);
      if (list) list.push(row);
      else attendanceByStudent.set(row.student_id, [row]);
    }

    const rows = students.map((student) => {
      const equipment = isKidStudent(student)
        ? ensureStudentEquipment({ db, student, persist: persistCore }).map((item) => ({
            // המזהה נחוץ לעריכת הסטטוס ישירות מגיליון הנוכחות.
            id: item.id,
            item_type: item.item_type,
            payment_status: item.payment_status,
            fulfillment_status: item.fulfillment_status,
            shirt_size: item.shirt_size || null,
            shoe_size: item.shoe_size || null,
          }))
        : [];
      const studentTests = tests.filter(
        (t) => (t.studentId || t.student_id || t.climber_id) === student.id
      );
      return {
        student_id: student.id,
        equipment,
        safety: safetyTestStatus(studentTests, refDate),
        absence_streak: consecutiveAbsences(attendanceByStudent.get(student.id) || [], {
          until: refDate,
        }),
      };
    });

    res.json({ group_id: groupId, date: refDate, rows });
  } catch (err) {
    console.error('training brief error:', err.message);
    res.status(503).json({ error: err.message || 'טעינת נתוני האימון נכשלה' });
  }
});

app.post('/api/level-tests', (req, res) => {
  const record = db.insertLevelTest(req.body);
  res.status(201).json(record);
});

app.put('/api/level-tests/:id', (req, res) => {
  const updated = db.updateLevelTest(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'מבחן לא נמצא' });
  res.json(updated);
});

app.delete('/api/level-tests/:id', (req, res) => {
  const ok = db.deleteLevelTest(req.params.id);
  if (!ok) return res.status(404).json({ error: 'מבחן לא נמצא' });
  res.json({ ok: true });
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
        discount: line.coupon_applied
          ? {
              listPrice: line.list_price,
              paidPrice: line.unitprice,
              couponCode: line.coupon_code || null,
              couponLabel: line.coupon_label || null,
            }
          : null,
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
  // הניקוב הוא אישור הצוות בדלפק שהמתאמן יכול לטפס: בלי הצהרת בריאות
  // והסרת אחריות בתוקף ובלי מבחן אבטחה בתוקף אין אישור, ולכן אין ניקוב.
  const blocked = passPunchBlockReason({
    student: pass.student_id ? db.getOne('students', pass.student_id) : null,
    declarations: db.get('health_declarations') || [],
    tests: db.get('level_tests') || [],
  });
  if (blocked) {
    const err = new Error(blocked);
    err.status = 409;
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

/** Undo an accidental punch: give the visit back and keep the row as a cancelled record. */
function cancelPunch(pass, punch, { cancelledBy, reason }) {
  if (!pass) {
    const err = new Error('כרטיסייה לא נמצאה');
    err.status = 404;
    throw err;
  }
  if (!punch || String(punch.pass_id) !== String(pass.id)) {
    const err = new Error('הניקוב לא נמצא בכרטיסייה הזאת');
    err.status = 404;
    throw err;
  }
  if (punch.cancelled_at) {
    const err = new Error('הניקוב כבר בוטל');
    err.status = 400;
    throw err;
  }
  const total = Number(pass.visits_total);
  const before = Number(pass.visits_remaining) || 0;
  const after = Number.isNaN(total) ? before + 1 : Math.min(total, before + 1);
  if (after === before) {
    const err = new Error('אי אפשר להחזיר כניסה — הכרטיסייה כבר מלאה');
    err.status = 400;
    throw err;
  }
  const updated = db.update('customer_passes', pass.id, {
    visits_remaining: after,
    // A depleted card comes back to life; an expired one stays expired.
    status: pass.status === 'depleted' && after > 0 ? 'active' : pass.status,
    updated_at: new Date().toISOString(),
  });
  const cancelled = db.update('pass_punches', punch.id, {
    cancelled_at: new Date().toISOString(),
    cancelled_by: cancelledBy || null,
    cancel_reason: reason || '',
  });
  return { pass: updated, punch: cancelled };
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

    // Reversing the sale reverses the benefit too: the customer keeps the
    // coupon unless it has expired in the meantime.
    const restoredCoupons = releaseCouponsForSale(db, sale.id);
    for (const restored of restoredCoupons) {
      await persistCore('customer_coupons', restored);
    }

    console.log(
      `↩️ [POS] refund sale=${sale.id} doc=${sale.icount_doc_number} → cancel=${cancellation.docnum}`
    );

    res.json({
      sale: updatedSale,
      cancellation,
      voidedPasses,
      restoredCoupons,
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

// ─── Coupons ────────────────────────────────────────────────────────────────
// A coupon is the benefit a campaign (or a member of staff) handed to one
// customer. Staff may read and issue them; only the owner deletes campaigns.

app.get('/api/coupons', (req, res) => {
  const { parentId, studentId, campaignId, status } = req.query;
  res.json(
    listCoupons(db, {
      parentId: parentId || undefined,
      studentId: studentId || undefined,
      campaignId: campaignId || undefined,
      status: status || undefined,
    })
  );
});

app.post('/api/coupons', async (req, res) => {
  try {
    const { offer, parentId, studentId, campaignId, campaignName } = req.body || {};
    if (!parentId && !studentId) {
      return res.status(400).json({ error: 'בחרו לקוח שיקבל את ההטבה' });
    }
    const coupon = issueCoupon(db, {
      offer,
      parentId: parentId || null,
      studentId: studentId || null,
      campaignId: campaignId || null,
      campaignName: campaignName || '',
      source: 'manual',
      issuedBy: req.crmUser?.email || req.crmUser?.name || '',
    });
    await persistCore('customer_coupons', coupon);
    res.status(201).json(coupon);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/coupons/:id/cancel', async (req, res) => {
  const updated = cancelCoupon(db, req.params.id, req.body?.reason || '');
  if (!updated) return res.status(404).json({ error: 'ההטבה לא נמצאה' });
  await persistCore('customer_coupons', updated);
  res.json(updated);
});

/** Active benefits for the customer the register has selected. */
app.get('/api/pos/coupons', (req, res) => {
  const { parentId, studentId } = req.query;
  if (!parentId && !studentId) return res.json([]);
  res.json(activeCouponsFor(db, { parentId, studentId }));
});

/**
 * What a coupon would be worth against the cart on screen. Only a preview —
 * `/api/pos/sale` recomputes the same thing before honouring it.
 */
app.post('/api/pos/coupon-preview', (req, res) => {
  const { cart = [], code, couponId, parentId, studentId } = req.body || {};
  const lines = mapCartLines(cart);
  const check = checkCouponForSale(db, { code, couponId, parentId, studentId, lines });
  if (!check.ok) return res.status(400).json({ error: check.error });
  res.json({
    coupon: check.coupon,
    discount: check.discount,
    total: computeSaleTotal(check.lines),
    lines: check.lines.map(({ item, ...rest }) => rest),
  });
});

// ─── Campaigns ──────────────────────────────────────────────────────────────

/** Everything the campaign screen needs to draw its forms. */
app.get('/api/campaigns/meta', requireOwner, (req, res) => {
  res.json({
    triggers: Object.values(TRIGGER_TYPES).map((key) => ({ key, label: TRIGGER_LABELS[key] })),
    offerTypes: Object.values(OFFER_TYPES).map((key) => ({ key, label: OFFER_TYPE_LABELS[key] })),
    presets: campaignPresets(),
  });
});

/** The approval queue: suggestions waiting for a member of staff to decide. */
app.get('/api/campaigns/pending', requireOwner, (req, res) => {
  const rows = (db.get('campaign_sends') || [])
    .filter((row) => row.status === SEND_STATUS.PENDING)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  res.json(rows);
});

app.get('/api/campaigns', requireOwner, (req, res) => {
  const today = todayIsoDate();
  const sends = db.get('campaign_sends') || [];
  const rows = (db.get('campaigns') || []).map((raw) => {
    const campaign = normalizeCampaign(raw);
    const mine = sends.filter((s) => String(s.campaign_id) === String(campaign.id));
    return {
      ...campaign,
      trigger_label: TRIGGER_LABELS[campaign.trigger_type],
      offer_summary: campaign.offer ? offerSummary(campaign.offer) : '',
      stats: {
        ...couponStats(db, campaign.id, today),
        sent: mine.filter((s) => s.status === SEND_STATUS.SENT).length,
        pending: mine.filter((s) => s.status === SEND_STATUS.PENDING).length,
        failed: mine.filter((s) => s.status === SEND_STATUS.FAILED).length,
      },
    };
  });
  res.json(rows);
});

app.post('/api/campaigns', requireOwner, async (req, res) => {
  try {
    const draft = normalizeCampaign({ ...req.body, id: undefined });
    // A new campaign starts today, so switching it on never mails the back
    // catalogue that happens to match the trigger.
    const record = db.insert('campaigns', {
      ...draft,
      id: undefined,
      start_date: req.body?.start_date || todayIsoDate(),
      created_at: new Date().toISOString(),
    });
    await persistCore('campaigns', record);
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/campaigns/:id', requireOwner, async (req, res) => {
  const existing = db.getOne('campaigns', req.params.id);
  if (!existing) return res.status(404).json({ error: 'הקמפיין לא נמצא' });
  const merged = normalizeCampaign({ ...existing, ...req.body, id: existing.id });
  const updated = db.update('campaigns', existing.id, {
    ...merged,
    created_at: existing.created_at,
    updated_at: new Date().toISOString(),
  });
  await persistCore('campaigns', updated);
  res.json(updated);
});

app.delete('/api/campaigns/:id', requireOwner, (req, res) => {
  const removed = db.delete('campaigns', req.params.id);
  if (!removed) return res.status(404).json({ error: 'הקמפיין לא נמצא' });
  res.json({ ok: true });
});

/** Who would this catch today, and who would be held back and why. */
app.post('/api/campaigns/:id/dry-run', requireOwner, async (req, res) => {
  try {
    const campaign = db.getOne('campaigns', req.params.id) || req.body?.campaign;
    if (!campaign) return res.status(404).json({ error: 'הקמפיין לא נמצא' });
    res.json(await runCampaignNow(campaign, { dryRun: true }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Run now, without waiting for the daily pass. */
app.post('/api/campaigns/:id/run', requireOwner, async (req, res) => {
  try {
    const campaign = db.getOne('campaigns', req.params.id);
    if (!campaign) return res.status(404).json({ error: 'הקמפיין לא נמצא' });
    res.json(await runCampaignNow(campaign));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/campaigns/:id/sends', requireOwner, (req, res) => {
  const rows = (db.get('campaign_sends') || [])
    .filter((row) => String(row.campaign_id) === String(req.params.id))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, 300);
  res.json(rows);
});

/** Approving a suggestion is the moment the coupon is created and sent. */
app.post('/api/campaigns/pending/:sendId/approve', requireOwner, async (req, res) => {
  try {
    const pending = db.getOne('campaign_sends', req.params.sendId);
    if (!pending) return res.status(404).json({ error: 'הפנייה לא נמצאה' });
    if (pending.status !== SEND_STATUS.PENDING) {
      return res.status(400).json({ error: 'הפנייה כבר טופלה' });
    }
    const campaign = db.getOne('campaigns', pending.campaign_id);
    if (!campaign) return res.status(404).json({ error: 'הקמפיין לא נמצא' });

    const result = await deliverCampaignEntry(
      db,
      campaign,
      {
        parentId: pending.parent_id,
        parentName: pending.parent_name,
        studentId: pending.student_id,
        studentName: pending.student_name,
        phone: pending.phone,
        reason: pending.reason,
      },
      {
        sendMessage: sendCampaignMessage,
        businessName: await businessDisplayName(),
        offer: pending.offer || campaign.offer,
        decidedBy: req.crmUser?.email || req.crmUser?.name || '',
      }
    );

    // The pending row becomes the record of the decision; the delivery row
    // holds what actually happened.
    db.delete('campaign_sends', pending.id);
    if (result.coupon) await persistCore('customer_coupons', result.coupon);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/campaigns/pending/:sendId/reject', requireOwner, async (req, res) => {
  const pending = db.getOne('campaign_sends', req.params.sendId);
  if (!pending) return res.status(404).json({ error: 'הפנייה לא נמצאה' });
  const updated = db.update('campaign_sends', pending.id, {
    status: SEND_STATUS.REJECTED,
    decided_by: req.crmUser?.email || req.crmUser?.name || '',
    decided_at: new Date().toISOString(),
  });
  await persistCore('campaign_sends', updated);
  res.json(updated);
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

app.post('/api/pos/passes/:id/punches/:punchId/cancel', (req, res) => {
  try {
    const pass = db.getOne('customer_passes', req.params.id);
    const punch = db.getOne('pass_punches', req.params.punchId);
    const result = cancelPunch(pass, punch, {
      cancelledBy: req.crmUser?.name || req.crmUser?.email || 'צוות',
      reason: req.body?.reason || '',
    });
    res.json(result);
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
      couponCode,
    } = req.body || {};

    let lines = mapCartLines(cart);
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

    // The register only previews a coupon — the benefit is recomputed here so a
    // stale screen or a hand-edited request can never hand out a bigger discount.
    let coupon = null;
    let couponDiscount = 0;
    if (couponCode) {
      const check = checkCouponForSale(db, {
        code: couponCode,
        parentId: parent?.id || parentId || null,
        studentId: student?.id || null,
        lines,
      });
      if (!check.ok) return res.status(400).json({ error: check.error });
      lines = check.lines;
      coupon = check.coupon;
      couponDiscount = check.discount;
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
      coupon_id: coupon?.id || null,
      coupon_code: coupon?.code || null,
      coupon_discount: couponDiscount || 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (coupon) {
      redeemCoupon(db, coupon.id, { saleId: sale.id, amount: couponDiscount });
      await persistCore('customer_coupons', db.getOne('customer_coupons', coupon.id));
      console.log(`🎟️ [POS] coupon ${coupon.code} redeemed on sale ${sale.id} (₪${couponDiscount})`);
    }

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

    // Paying for an intro training is the moment the funnel can advance on its
    // own — nobody has to remember to change the status afterwards.
    if (shouldMarkIntroPaid(student, lines)) {
      const moved = db.update('students', student.id, { status: 'intro_paid' });
      if (moved) {
        await persistCore('students', moved);
        automationsService.triggerEvent('status_changed', { ...moved, new_status: 'intro_paid' });
        touchGoogleContacts();
        console.log(`🧗 [POS] ${moved.name || student.id} → intro_paid after paying for an intro training`);
      }
    }

    let whatsappUrl = null;
    if (sendWhatsapp) {
      const phone = normalizePhone(syncedParent?.phone || walkInPhone);
      if (phone) {
        const digits = phone.replace(/^0/, '972');
        const text = encodeURIComponent(
          `שלום${syncedParent?.name ? ` ${syncedParent.name}` : ''},\n` +
            `תודה על הרכישה ב־${await businessBrand()}.\n` +
            `סכום: ₪${total}` +
            (doc?.docnum ? `\nמספר מסמך: ${doc.docnum}` : '') +
            (doc?.docUrl ? `\nקישור למסמך: ${doc.docUrl}` : '')
        );
        whatsappUrl = `https://wa.me/${digits}?text=${text}`;
      }
    }

    res.status(201).json({
      sale,
      passes,
      doc,
      whatsappUrl,
      isNewLead: !!isNewLead,
      parent: syncedParent,
      coupon: coupon ? { code: coupon.code, discount: couponDiscount } : null,
    });
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
      sendEmail = false,
      sendWhatsapp = false,
      includePaymentLink = false,
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
    if (includePaymentLink && needsCustomer && !student?.id) {
      return res.status(400).json({ error: 'מנוי או כרטיסייה דורשים בחירת מתאמן' });
    }

    const total = computeSaleTotal(lines);
    if (includePaymentLink && !(Number(total) > 0)) {
      return res.status(400).json({
        error:
          'לא ניתן לכלול קישור תשלום בסכום 0. הסר את הסימון או שנה מחיר.',
      });
    }

    let clientId = parent?.icount_client_id || null;
    let syncedParent = parent;
    if (parent?.id) {
      const synced = await syncParentToIcount(parent);
      syncedParent = synced.parent;
      clientId = synced.clientId;
    }

    const email = syncedParent?.email || walkInEmail || '';
    const customerName = syncedParent?.name || student?.name || walkInName || 'לקוח';
    const description = lines
      .map((l) => `${l.name}${Number(l.quantity) > 1 ? ` (${l.quantity})` : ''}`)
      .join(', ')
      .slice(0, 180);

    let payment = null;
    let payUrl = null;
    let shortUrl = null;
    let shareUrl = null;
    if (includePaymentLink) {
      payment = db.insert('payments', {
        parent_id: syncedParent?.id || null,
        student_id: student?.id || null,
        amount: total,
        description: description || 'הצעת מחיר',
        status: 'pending',
        payment_url: null,
        price_includes_vat: true,
        icount_client_id: clientId,
        icount_doc_id: null,
        icount_doc_number: null,
        paid_at: null,
        updated_at: new Date().toISOString(),
      });
      const ipnUrl = icount.buildIpnUrl({ paymentId: payment.id });
      payUrl = await icount.buildPaymentUrl({
        amount: total,
        description: description || `הצעת מחיר מ־${await businessBrand()}`,
        name: customerName,
        lastName: syncedParent?.lastName,
        idNumber: syncedParent?.idNumber,
        phone: syncedParent?.phone || walkInPhone,
        email: syncedParent?.email || walkInEmail,
        paymentId: payment.id,
        ipnUrl,
      });
      shortUrl = icount.buildPaymentRedirectUrl(payment.id);
      shareUrl = icount.isLocalPublicApiBase() ? payUrl : shortUrl || payUrl;
    }

    const commentParts = [];
    if (student?.name) commentParts.push(`עבור: ${student.name}`);
    if (shareUrl) commentParts.push(`קישור לתשלום: ${shareUrl}`);

    const doc = await icount.createOffer({
      clientId,
      clientName: customerName,
      items: lines.map((l) => ({
        description: l.description,
        unitprice: l.unitprice,
        quantity: l.quantity,
      })),
      comment: commentParts.length ? commentParts.join('\n') : undefined,
      emailTo: sendEmail && email ? email : undefined,
      vattype: icountVatType(true),
    });

    let sale = db.insert('pos_sales', {
      items: lines.map(({ item, ...rest }) => rest),
      total,
      payment_method: includePaymentLink ? 'online' : null,
      status: 'quoted',
      price_includes_vat: true,
      student_id: student?.id || null,
      parent_id: syncedParent?.id || parentId || null,
      customer_name: customerName,
      customer_phone: syncedParent?.phone || walkInPhone || '',
      customer_email: email,
      icount_client_id: clientId,
      icount_doc_id: doc.docId,
      icount_doc_number: doc.docnum,
      icount_doc_url: doc.docUrl,
      icount_doctype: 'offer',
      payment_id: payment?.id || null,
      payment_url: payUrl || null,
      sold_by: req.crmUser?.email || req.crmUser?.name || null,
      sent_email: !!(sendEmail && email),
      sent_whatsapp: !!sendWhatsapp,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (payment) {
      const updatedPayment = db.update('payments', payment.id, {
        pos_sale_id: sale.id,
        payment_url: payUrl,
        updated_at: new Date().toISOString(),
      });
      if (updatedPayment) {
        payment = updatedPayment;
        await persistCore('payments', updatedPayment);
      }
      await persistCore('pos_sales', sale);
      console.log(
        `💳 [POS] quote+payment-link sale=${sale.id} total=${total} url=${payUrl} short=${shortUrl}`
      );
    }

    let whatsappUrl = null;
    let whatsappSent = false;
    let whatsappError = null;
    if (sendWhatsapp) {
      const phone = normalizePhone(syncedParent?.phone || walkInPhone);
      if (phone) {
        const waMsg =
          `שלום${customerName ? ` ${customerName}` : ''},\n` +
          `מצורפת הצעת מחיר מ־${await businessBrand()}.\n` +
          `סכום: ₪${total}` +
          (doc.docnum ? `\nמספר הצעה: ${doc.docnum}` : '') +
          (doc.docUrl ? `\nקישור להצעה: ${doc.docUrl}` : '') +
          (shareUrl
            ? `\n\nלתשלום מאובטח:\n${shareUrl}\nלאחר התשלום תופק חשבונית מס קבלה אוטומטית.`
            : '');

        // Prefer Meta template for the payment button when a pay link is included
        if (shareUrl && payment?.id) {
          const tplName = icount.getPaymentTemplateName();
          const localTpl = (db.get('message_templates') || []).find(
            (t) => (t.meta_name || t.name) === tplName
          );
          const tplApproved =
            localTpl &&
            (String(localTpl.status).toUpperCase() === 'APPROVED' || localTpl.active_for_send);
          const canUseMetaTemplate = tplApproved && !icount.isLocalPublicApiBase();
          if (canUseMetaTemplate) {
            try {
              const waResult = await whatsappService.sendTemplateMessage(
                phone,
                tplName,
                [customerName, description || 'הצעת מחיר', String(total)],
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
        }

        if (!whatsappSent) {
          try {
            const waResult = await whatsappService.sendTextMessage(phone, waMsg);
            whatsappSent = !!waResult?.success;
            if (!whatsappSent) {
              whatsappError = waResult?.error || whatsappError || 'שליחת וואטסאפ נכשלה';
            } else {
              whatsappError = null;
            }
          } catch (waErr) {
            whatsappError = waErr.message || whatsappError || 'שליחת וואטסאפ נכשלה';
          }
          if (!whatsappSent) {
            const digits = phone.startsWith('972') ? phone : phone.replace(/^0/, '972');
            whatsappUrl = `https://wa.me/${digits}?text=${encodeURIComponent(waMsg)}`;
          }
        }

        if (whatsappSent || whatsappUrl) {
          const patched = db.update('pos_sales', sale.id, {
            sent_whatsapp: true,
            updated_at: new Date().toISOString(),
          });
          if (patched) {
            sale = patched;
            if (payment) await persistCore('pos_sales', patched);
          }
        }
      } else {
        whatsappError = 'אין מספר טלפון לשליחה בוואטסאפ';
      }
    }

    res.status(201).json({
      sale,
      doc,
      payment: payment || null,
      payUrl: payUrl || null,
      shortUrl: shortUrl || null,
      shareUrl: shareUrl || null,
      whatsappUrl,
      whatsappSent,
      whatsappError,
      emailedTo: sendEmail ? email : null,
      isNewLead: !!isNewLead,
      parent: syncedParent,
    });
  } catch (err) {
    console.error('POS quote error:', err.message);
    res.status(502).json({ error: err.message, code: err.code });
  }
});

/**
 * Send a payment link over WhatsApp. Shared by the moment the link is created
 * and by the "send again" action, so a link that failed to reach the customer
 * does not have to be recreated (which would also re-reserve the coupon).
 */
async function sendPaymentLinkWhatsapp({
  phone: rawPhone,
  customerName = 'לקוח',
  parentId = null,
  paymentId,
  description = '',
  amount = 0,
  shareUrl,
}) {
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    return {
      whatsappUrl: null, whatsappSent: false, via: null,
      whatsappError: 'אין מספר טלפון לשליחה בוואטסאפ',
    };
  }

  let whatsappSent = false;
  let whatsappError = null;
  let whatsappUrl = null;
  let via = null;

  const tplName = icount.getPaymentTemplateName();
  const localTpl = (db.get('message_templates') || []).find(
    (t) => (t.meta_name || t.name) === tplName
  );
  const tplApproved =
    localTpl && (String(localTpl.status).toUpperCase() === 'APPROVED' || localTpl.active_for_send);
  // Meta template button is fixed to the live /r/ host. Never use it from local
  // (the payment only exists on this machine, and localhost short links fail on phones).
  const runningLocally = icount.isLocalPublicApiBase();
  const canUseMetaTemplate = tplApproved && !runningLocally;

  // Why the reliable path was skipped — the screen has to say this, otherwise a
  // message Meta accepted but never delivered looks like a success.
  const templateSkippedReason = canUseMetaTemplate
    ? null
    : !localTpl
      ? `לא נמצאה תבנית בשם „${tplName}” במערכת`
      : !tplApproved
        ? `התבנית „${tplName}” עדיין לא מאושרת במטא`
        : 'השרת רץ מקומית, ולכן הכפתור בתבנית היה מוביל לכתובת שלא זמינה מהטלפון';

  if (canUseMetaTemplate) {
    try {
      const waResult = await whatsappService.sendTemplateMessage(
        phone,
        tplName,
        [customerName, description || 'רכישה', String(amount)],
        { fallbackName: customerName, parentId, buttonUrlParam: paymentId }
      );
      whatsappSent = !!waResult?.success;
      if (whatsappSent) via = 'template';
      else whatsappError = waResult?.error || 'שליחת תבנית וואטסאפ נכשלה';
    } catch (waErr) {
      whatsappError = waErr.message || 'שליחת תבנית וואטסאפ נכשלה';
    }
  }

  // Fallback: free-form text (only works inside 24h window)
  if (!whatsappSent) {
    const waMsg =
      `שלום${customerName ? ` ${customerName}` : ''},\n` +
      `לסיום התשלום ב-${await businessBrand()}:\n${shareUrl}\n\n` +
      `לאחר התשלום תופק חשבונית מס קבלה אוטומטית.`;
    try {
      const waResult = await whatsappService.sendTextMessage(phone, waMsg);
      whatsappSent = !!waResult?.success;
      if (!whatsappSent) {
        whatsappError = waResult?.error || whatsappError || 'שליחת וואטסאפ נכשלה';
        console.error('POS payment-link WhatsApp failed:', whatsappError);
      } else {
        via = 'freeform';
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

  // Free text is accepted by Meta even when it will not be delivered — outside
  // the 24 hour service window it is dropped silently. Say so rather than let
  // the screen report a send that never reached anyone.
  const deliveryWarning =
    via === 'freeform'
      ? `נשלח כטקסט חופשי ולא בתבנית מאושרת (${templateSkippedReason}). ` +
        'טקסט חופשי מגיע רק אם הלקוח כתב לנו ב-24 השעות האחרונות — אחרת מטא בולעת אותו בשקט. ' +
        'ודאו מול הלקוח, או שלחו את הקישור ידנית.'
      : null;

  console.log(
    `📤 [POS] payment link to ${phone}: ${whatsappSent ? `sent via ${via}` : `failed — ${whatsappError}`}`
  );

  return { whatsappUrl, whatsappSent, whatsappError, via, deliveryWarning, templateSkippedReason };
}

/** Send an existing, still-unpaid payment link again. */
app.post('/api/pos/sales/:id/send-link', async (req, res) => {
  try {
    const sale = db.getOne('pos_sales', req.params.id);
    if (!sale) return res.status(404).json({ error: 'המכירה לא נמצאה' });
    if (sale.status === 'paid') return res.status(400).json({ error: 'העסקה כבר שולמה' });
    if (!sale.payment_url) return res.status(400).json({ error: 'לעסקה אין קישור תשלום' });

    const phone = req.body?.phone || sale.customer_phone;
    if (!phone) return res.status(400).json({ error: 'אין מספר טלפון ללקוח' });

    const shortUrl = sale.payment_id ? icount.buildPaymentRedirectUrl(sale.payment_id) : '';
    const shareUrl = icount.isLocalPublicApiBase() ? sale.payment_url : shortUrl || sale.payment_url;
    const description = (sale.items || [])
      .map((line) => line.description || line.name)
      .join(', ')
      .slice(0, 180);

    const result = await sendPaymentLinkWhatsapp({
      phone,
      customerName: sale.customer_name || 'לקוח',
      parentId: sale.parent_id || null,
      paymentId: sale.payment_id,
      description,
      amount: sale.total,
      shareUrl,
    });
    res.json({ ...result, shareUrl });
  } catch (err) {
    res.status(502).json({ error: err.message });
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
      couponCode,
    } = req.body || {};

    let lines = mapCartLines(cart);
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

    // Same server-side recompute as the counter sale, so the amount baked into
    // the payment link is one we calculated, not one the screen sent.
    let coupon = null;
    let couponDiscount = 0;
    if (couponCode) {
      const check = checkCouponForSale(db, {
        code: couponCode,
        parentId: parent?.id || parentId || null,
        studentId: student?.id || null,
        lines,
      });
      if (!check.ok) return res.status(400).json({ error: check.error });
      lines = check.lines;
      coupon = check.coupon;
      couponDiscount = check.discount;
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

    // The payment page shows this one line, so the benefit has to be named here
    // — otherwise the customer sees a reduced price with no explanation. A line
    // the coupon split is regrouped by product, so it reads as one item.
    const quantityByName = new Map();
    for (const line of lines) {
      const name = line.name || 'פריט';
      quantityByName.set(name, (quantityByName.get(name) || 0) + (Number(line.quantity) || 1));
    }
    const itemsLabel = [...quantityByName]
      .map(([name, qty]) => `${name}${qty > 1 ? ` (${qty})` : ''}`)
      .join(', ');
    const discountNote = coupon
      ? ` · כולל הטבה ${coupon.code}: ${coupon.label} (−₪${couponDiscount})`
      : '';
    const description = `${itemsLabel}${discountNote}`.slice(0, 180);
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
      coupon_id: coupon?.id || null,
      coupon_code: coupon?.code || null,
      coupon_discount: couponDiscount || 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    db.update('payments', payment.id, { pos_sale_id: sale.id });

    // Held, not spent: the link may never be paid, and the daily job hands the
    // benefit back if it is still unpaid a week from now.
    if (coupon) {
      reserveCoupon(db, coupon.id, { saleId: sale.id, amount: couponDiscount });
      await persistCore('customer_coupons', db.getOne('customer_coupons', coupon.id));
      console.log(`🎟️ [POS] coupon ${coupon.code} reserved for payment link on sale ${sale.id}`);
    }

    const ipnUrl = icount.buildIpnUrl({ paymentId: payment.id });
    const payUrl = await icount.buildPaymentUrl({
      amount: total,
      description: description || `רכישה ב-${await businessBrand()}`,
      name: syncedParent?.name || student?.name || walkInName || 'לקוח',
      lastName: syncedParent?.lastName,
      idNumber: syncedParent?.idNumber,
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

    const delivery = sendWhatsapp
      ? await sendPaymentLinkWhatsapp({
          phone: syncedParent?.phone || walkInPhone,
          customerName: syncedParent?.name || walkInName || 'לקוח',
          parentId: syncedParent?.id || null,
          paymentId: payment.id,
          description,
          amount: total,
          shareUrl,
        })
      : { whatsappUrl: null, whatsappSent: false, whatsappError: null };
    const { whatsappUrl, whatsappSent, whatsappError, via, deliveryWarning } = delivery;

    res.status(201).json({
      sale: updatedSale || { ...sale, payment_url: payUrl },
      payment: updatedPayment || { ...payment, payment_url: payUrl },
      payUrl,
      shortUrl,
      shareUrl,
      whatsappUrl,
      whatsappSent,
      whatsappError,
      whatsappVia: via,
      deliveryWarning,
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

/**
 * Slugs that links already carry, pointing at the template that replaced them.
 *
 * The birthday declaration turned out to be the declaration for any activity at
 * the wall — a company day and a school group sign the same risks — so it was
 * rewritten as one form. The old address keeps working: it was sent out over
 * WhatsApp, and a link that 404s is a family that cannot register.
 */
const FORM_TEMPLATE_SLUG_ALIASES = { birthday: 'event' };

function findFormTemplateBySlug(slug) {
  const key = slugifyFormTemplate(slug);
  if (!key) return null;
  const templates = listFormTemplates();
  const active = (s) => templates.find((t) => t.slug === s && t.isActive !== false) || null;
  return active(key) || (FORM_TEMPLATE_SLUG_ALIASES[key] ? active(FORM_TEMPLATE_SLUG_ALIASES[key]) : null);
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

/**
 * אילו סוגי פעילות ההצהרה הזאת משרתת.
 *
 * הצהרה אחת יכולה לשרת כמה סוגים — יום הולדת ויום גיבוש חותמים על אותו מסמך —
 * אבל סוג פעילות שייך להצהרה אחת בלבד, אחרת אין תשובה לשאלה „על מה חותמים
 * בטיול”. האכיפה של הצד השני נעשית בשמירה, ב-`claimActivityTypes`.
 */
function normalizeTemplateActivityTypes(body, existing = null) {
  const raw = Array.isArray(body?.activityTypes) ? body.activityTypes
    : Array.isArray(body?.activity_types) ? body.activity_types
      : (body?.activityType || body?.activity_type)
        ? [body.activityType || body.activity_type]
        : null;
  const list = raw || templateActivityTypes(existing || {});
  const seen = new Set();
  return list
    .map((t) => String(t || '').trim().toLowerCase())
    .filter((t) => t && t !== 'custom' && !seen.has(t) && seen.add(t));
}

/**
 * מוציא את הסוגים שנבחרו מכל הצהרה אחרת, כדי שסוג פעילות יישאר מקושר להצהרה
 * אחת. שקט ובכוונה: מי שסימן „טיול” כאן התכוון להעביר אותו לכאן.
 */
function claimActivityTypes(keepId, types) {
  const claimed = new Set(types || []);
  if (!claimed.size) return;
  for (const t of listFormTemplates()) {
    if (t.id === keepId) continue;
    const had = templateActivityTypes(t);
    const kept = had.filter((type) => !claimed.has(type));
    if (kept.length !== had.length) {
      db.update('form_templates', t.id, {
        activityTypes: kept,
        activityType: kept[0] || 'custom',
      });
    }
  }
}

function normalizeFormTemplatePayload(body, existing = null) {
  const slug = slugifyFormTemplate(body.slug || existing?.slug || body.title || `form-${Date.now()}`);
  if (!slug) return { error: 'חסר מזהה קישור (slug)' };
  const healthQuestions = Array.isArray(body.healthQuestions)
    ? body.healthQuestions
    : (Array.isArray(body.health_questions) ? body.health_questions : (existing?.healthQuestions || DEFAULT_HEALTH_QUESTIONS));
  const activityTypes = normalizeTemplateActivityTypes(body, existing);
  return {
    slug,
    title: (body.title ?? existing?.title ?? '').trim() || 'הצהרת בריאות',
    activityTypes,
    // Kept in step with the first entry, for anything still reading one value.
    activityType: activityTypes[0] || 'wall',
    waiverText: body.waiverText ?? body.waiver_text ?? existing?.waiverText ?? '',
    // The plain-language layer shown in front of the legal text.
    waiverSummary: body.waiverSummary ?? body.waiver_summary ?? existing?.waiverSummary ?? '',
    // `kind` and `requireYes` used to be dropped here, so saving a template
    // from the CRM screen turned every mandatory clause into an optional one
    // and every screening question into a tick box. `audience` and
    // `requiresClearance` were being dropped the same way, which quietly
    // deleted the parent-only clauses and the doctor's-approval rule the first
    // time anyone edited a declaration — the wording survived, the rules did not.
    healthQuestions: healthQuestions.map((q, i) => {
      const rawLabel = String(q.label || q.text || '').trim();
      const screening = isScreeningQuestion({ ...q, label: rawLabel });
      return {
        id: q.id || `q${i + 1}`,
        label: questionLabel({ ...q, label: rawLabel }),
        kind: screening ? 'screen' : 'confirm',
        audience: isChildOnlyQuestion({ ...q, label: rawLabel }) ? 'child' : 'all',
        requiresClearance: screening && requiresClearance({ ...q, label: rawLabel }),
        requireYes: !screening,
      };
    }).filter((q) => q.label),
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
  claimActivityTypes(record.id, normalized.activityTypes);
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
  claimActivityTypes(existing.id, normalized.activityTypes);
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

  // 2) Same household + matching climber name — a child registered by the other
  //     parent is still this parent's child once the family is one card.
  const siblings = childrenOfParent(db, parent.id);
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
  // The form asks for the surname separately; storing it keeps the household
  // matcher and the invoice off the last word of a free-text name.
  const parentLastName = String(req.body?.parentLastName || req.body?.lastName || '').trim();
  const parent = db.upsertParentByPhone(parentName, phone, '', {
    source: 'form',
    channel: 'form',
    lastName: parentLastName,
  });
  // Always refresh parent name from form when provided
  if (parentName && parent.name !== parentName) {
    db.update('parents', parent.id, { name: parentName });
    parent.name = parentName;
  }
  if (parentLastName && parent.lastName !== parentLastName) {
    db.update('parents', parent.id, { lastName: parentLastName });
    parent.lastName = parentLastName;
  }

  // Confirmed on the form as a child already on another parent's file. The
  // identity is re-checked here: a posted id alone must never attach anyone to
  // a stranger's child.
  const linkStudentId = String(req.body?.link_student_id || req.body?.linkStudentId || '').trim();
  let linkedStudent = null;
  if (linkStudentId) {
    const candidate = db.getOne('students', linkStudentId);
    const identityHolds = candidate
      && !!String(birthDate || '').trim()
      && normalizedChildName(candidate.name) === normalizedChildName(climberName)
      && String(candidate.birthDate || '').trim() === String(birthDate || '').trim();
    if (!identityHolds) {
      return res.status(400).json({ error: 'הפרטים לא תואמים את הילד שנבחר במערכת' });
    }
    linkedStudent = candidate;
  }

  let student = linkedStudent
    || resolveStudentForHealthForm({ studentId, parent, climberName, phone });
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
    // Born into a family that was already merged: put the child on every parent
    // card of the household, not only the one that filled the form.
    for (const link of linkHouseholdGuardians(db, { studentId: student.id, source: 'form' })) {
      await persistCore('student_guardians', link);
    }
  }

  if (!student?.id || !parent?.id) {
    return res.status(500).json({ error: 'לא ניתן לקשר את ההצהרה ללקוח' });
  }

  // A second parent signing for a child that stays on the first parent's file.
  if (linkedStudent && String(linkedStudent.parentId || '') !== String(parent.id)) {
    const link = linkGuardian(db, { studentId: student.id, parentId: parent.id, source: 'form' });
    if (link) await persistCore('student_guardians', link);
  }

  // Confirmed on the form as the same household as an existing card.
  const familyParentId = String(req.body?.family_parent_id || req.body?.familyParentId || '').trim();
  if (familyParentId) {
    const familyLinks = mergeFamily(db, {
      parentId: parent.id,
      familyParentId,
      extraStudentIds: [student.id],
    });
    for (const link of familyLinks) await persistCore('student_guardians', link);
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

  // A family created by a public form should be recognised on an incoming
  // call like any other customer. Only staff-side paths scheduled this, and
  // there is no nightly sweep behind it, so these families never reached the
  // address book at all.
  touchGoogleContacts();
  res.status(201).json({ success: true, record, student, parent });
});

const REQUIRED_BROADCAST_LIST = 'classes';

function findParentForOnboard({ parentId, phone, studentId, idNumber }) {
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
    // Cards are stored in 972… form while customers type 050… — comparing the
    // raw strings would miss the very customer we are trying to spare a second
    // signature, so match on the same normalized phone the CRM merges cards by.
    const byPhone = parents.find((p) => parentPhonesMatch(p.phone, phoneKey));
    if (byPhone) return byPhone;
  }
  // The phone is the usual key, but a parent registering a second child from a
  // different handset — the other parent's, a new number — is still the same
  // person, and their ID says so.
  const idKey = normalizedIdNumber(idNumber);
  if (idKey.length >= 5) {
    return parents.find((p) => normalizedIdNumber(p.idNumber) === idKey) || null;
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
          lastName: String(parent.lastName || '').trim(),
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
  const idNumber = String(req.query.idNumber || '').trim();
  // Which declaration the visitor is about to fill. "Already signed" is only a
  // meaningful answer with respect to a particular form.
  const requestedSlug = String(req.query.templateSlug || req.query.template || '').trim().toLowerCase();
  const contextTemplate = requestedSlug
    ? (findFormTemplateBySlug(requestedSlug) || findDefaultFormTemplate())
    : findDefaultFormTemplate();
  const contextTemplateSlug = String(contextTemplate?.slug || 'wall').toLowerCase();

  const parent = (parentId || studentId || phone || idNumber)
    ? findParentForOnboard({ parentId, phone, studentId, idNumber })
    : null;
  const listDefs = db.getBroadcastListDefs();
  // The whole household, not only the children whose `parentId` happens to be
  // this parent. A child registered by the other parent — or moved during a
  // merge — is linked through `student_guardians`, and filtering on `parentId`
  // alone dropped them from the form: the parent was never offered a renewal
  // for a child the CRM shows on their own card.
  const household = parent ? expandHousehold(db, parent.id) : { parentIds: [], students: [] };
  const householdParents = household.parentIds
    .map((id) => db.getOne('parents', id))
    .filter(Boolean);
  // A parent who climbs themselves also has a student card. That card is not a
  // participant this form registers — signing for yourself is what the "I am
  // over 18 and filling in for myself" box at the top is for.
  const isParentThemselves = (student) => householdParents.some((p) => {
    const parentId = normalizedIdNumber(p.idNumber);
    const studentId = normalizedIdNumber(student.idNumber);
    if (parentId && studentId) return parentId === studentId;
    return student.isAdult === true
      && normalizedChildName(p.name) === normalizedChildName(student.name);
  });
  const students = parent ? household.students.filter((s) => !isParentThemselves(s)) : [];

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

  // The same template the "already signed" answers above were judged against,
  // so the form and its verdicts can never be about two different documents.
  const template = contextTemplate || findFormTemplateBySlug('wall');

  res.json({
    parent: parent
      ? {
          id: parent.id,
          name: parent.name || '',
          // Sent separately so the form can fill its own surname box instead of
          // guessing the surname from the last word of the name.
          lastName: parent.lastName || '',
          relation: parent.relation || '',
          phone: parent.phone || '',
          email: parent.email || '',
          city: parent.city || '',
          idNumber: parent.idNumber || '',
        }
      : null,
    students: students.map((s) => {
      // Whether this participant already has a declaration in force decides
      // whether the form asks them for one again, so the answer travels with
      // the card rather than being guessed from the status.
      // Scoped to the declaration this form is about, so a child covered for
      // the wall is still asked to sign before a trip.
      const declaration = findLatestValidDeclaration(db, {
        studentId: s.id,
        parentId: parent?.id || null,
        climberName: s.name || '',
        templateSlug: contextTemplateSlug,
      });
      const healthValid = !!declaration
        || (contextTemplateSlug === 'wall'
          && !!s.healthSignedAt
          && isHealthDeclarationValid(s.healthSignedAt));
      return {
        id: s.id,
        name: s.name || '',
        birthDate: s.birthDate || '',
        gender: s.gender || '',
        idNumber: s.idNumber || '',
        status: s.status || '',
        interests: Array.isArray(s.interests) ? s.interests : [],
        notes: s.notes || '',
        healthValid,
        healthSignedAt: declaration
          ? (declaration.signedDate || declaration.date || s.healthSignedAt || '')
          : (s.healthSignedAt || ''),
      };
    }),
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

// ── Phone verification for the public form ───────────────────────────────────
// A code over WhatsApp proves the person filling the form holds the phone they
// typed. The declaration then carries "verified", which is what turns the
// drawn signature into evidence about a particular person.

const otpService = createOtpService();
const OTP_TEMPLATE_NAME = 'phone_verification_code';

app.post('/api/public/otp/send', publicFormRateLimit, async (req, res) => {
  const phone = normPhone(req.body?.phone);
  if (!phone || phone.length < 11) {
    return res.status(400).json({ error: 'מספר הטלפון לא תקין' });
  }
  const issued = otpService.issueCode(phone);
  if (issued.error) return res.status(429).json({ error: issued.error });
  try {
    const result = await whatsappService.sendTemplateMessage(
      phone,
      OTP_TEMPLATE_NAME,
      [issued.code],
      { buttonUrlParams: [issued.code], source: 'otp' }
    );
    if (result && result.error) {
      console.error('otp send failed:', JSON.stringify(result.error).slice(0, 300));
      return res.status(502).json({ error: 'שליחת הקוד בוואטסאפ נכשלה — בדקו את המספר ונסו שוב' });
    }
    // Local development without Meta credentials: the code cannot arrive on a
    // phone, so hand it back for testing. Never in production.
    const dev = result?.mock ? { devCode: issued.code } : {};
    res.json({ ok: true, ...dev });
  } catch (err) {
    console.error('otp send error:', err.message);
    res.status(502).json({ error: 'שליחת הקוד בוואטסאפ נכשלה — נסו שוב' });
  }
});

app.post('/api/public/otp/verify', publicFormRateLimit, (req, res) => {
  const phone = normPhone(req.body?.phone);
  const code = String(req.body?.code || '').trim();
  if (!phone || !code) return res.status(400).json({ error: 'חסר קוד או מספר טלפון' });
  const outcome = otpService.verifyCode(phone, code);
  if (outcome.error) return res.status(400).json({ error: outcome.error });
  res.json({ ok: true, token: outcome.token });
});

/**
 * A doctor's approval reaches storage as a PDF and nothing else — the personal
 * file bucket accepts no other type. A photograph is wrapped into a PDF by the
 * form before it is sent, so what arrives here is already one.
 */
const CLEARANCE_MIME_EXTENSIONS = {
  'application/pdf': 'pdf',
};
// Above what the form allows through, so a legitimate submission is never
// refused here — this is the backstop for a caller that is not the form.
const MAX_CLEARANCE_BYTES = 4 * 1024 * 1024;

/**
 * Turns what the form sent into something storable, or says why it is not.
 *
 * Nothing here trusts the browser: the form downsizes photos before sending,
 * but the size and the type are re-checked because this route is public and the
 * next caller may not be the form at all.
 */
function decodeClearanceUpload(payload) {
  const mimeType = String(payload?.mimeType || '').toLowerCase();
  const extension = CLEARANCE_MIME_EXTENSIONS[mimeType];
  if (!extension) return { error: 'אישור הרופא חייב להיות תמונה או קובץ PDF' };

  const raw = String(payload?.base64 || '');
  const body = raw.includes(',') ? raw.split(',')[1] : raw;
  if (!body) return { error: 'אישור הרופא לא הגיע' };

  let buffer;
  try {
    buffer = Buffer.from(body, 'base64');
  } catch {
    return { error: 'אישור הרופא אינו קובץ תקין' };
  }
  if (!buffer.length) return { error: 'אישור הרופא אינו קובץ תקין' };
  if (buffer.length > MAX_CLEARANCE_BYTES) return { error: 'אישור הרופא גדול מדי' };

  const fileName = String(payload?.fileName || `medical-clearance.${extension}`)
    .replace(/[^\w֐-׿.\-]+/g, '_')
    .slice(0, 120);

  return { buffer, mimeType, extension, fileName };
}

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
  const parentLast = String(parentBody.lastName || '').trim();
  const parentRelation = String(parentBody.relation || '').trim();
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

  // Checked before anything else is read or written. A declaration signed from
  // a phone that never answered a code is the document this gate exists to
  // prevent, and enforcing it only in the form leaves the route open to anyone
  // who skips the form — including the file uploads further down.
  const otpToken = String(req.body?.phoneVerification?.token || '').trim();
  if (!otpToken || !otpService.checkToken(otpToken, normPhone(phone))) {
    return res.status(403).json({
      error: 'אימות הטלפון פג או לא בוצע — חזרו לתחילת הטופס ובקשו קוד חדש',
    });
  }
  const phoneVerification = {
    verified: true,
    method: 'whatsapp_code',
    phone: normPhone(phone),
    at: new Date().toISOString(),
  };

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
        healthNotes: String(c.healthNotes || '').trim(),
        medicalClearance: c.medicalClearance || null,
        signature: c.signature || '',
        waiverAccepted: c.waiverAccepted === true || c.waiverAccepted === 'true',
        // Confirmed on the form as a child already on another parent's file.
        link_student_id: String(c.link_student_id || c.linkStudentId || '').trim() || null,
        reuse_health: c.reuse_health === true || c.reuseHealth === true,
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
    // A declaration already in force is not re-signed; saveCrmParticipants
    // verifies that claim against what was on file before this request.
    if (child.reuse_health) continue;
    if (!child.waiverAccepted || !child.signature) {
      return res.status(400).json({
        error: `חסרה חתימה או אישור וויתור עבור ${child.name}`,
      });
    }
  }

  const template = templateId
    ? (db.get('form_templates') || []).find((t) => t.id === templateId)
    : (templateSlug ? findFormTemplateBySlug(templateSlug) : findDefaultFormTemplate());

  for (const child of childList) {
    if (child.reuse_health) continue;
    const asked = questionsForSigner(template?.healthQuestions || [], {
      isAdultSelf: child.type === 'adult',
    });
    const gap = declarationGap(asked, child.answers, child.name);
    if (gap) return res.status(400).json({ error: gap });
    // A doctor already limited this person's physical activity. The wall does
    // not overrule that on a tick box, so the written approval is a condition
    // of filing the declaration at all — checked here and not only in the form,
    // which is the half of this a caller can skip.
    if (needsMedicalClearance(asked, child.answers) && !child.medicalClearance) {
      return res.status(400).json({
        error: `נדרש אישור רופא להשתתפות בפעילות ספורטיבית עבור ${child.name}`,
      });
    }
  }

  // Uploaded before anything is written: a signed declaration on file with the
  // approval missing is the one outcome this whole feature exists to prevent.
  // An orphan file in storage, if the save then fails, costs nothing.
  const clearanceUploads = [];
  for (const child of childList) {
    if (!child.medicalClearance) continue;
    const prepared = decodeClearanceUpload(child.medicalClearance);
    if (prepared.error) {
      return res.status(400).json({ error: `${prepared.error} (${child.name})` });
    }
    const storagePath = `medical-clearance/${Date.now()}_${crypto.randomUUID()}.${prepared.extension}`;
    let uploaded;
    try {
      uploaded = await supa.uploadClientDocument(storagePath, prepared.buffer, prepared.mimeType);
    } catch (err) {
      console.error('medical clearance upload error:', err.message);
      return res.status(503).json({ error: 'שמירת אישור הרופא נכשלה — נסו שוב' });
    }
    if (!uploaded?.ok) {
      return res.status(503).json({ error: uploaded?.error || 'שמירת אישור הרופא נכשלה — נסו שוב' });
    }
    clearanceUploads.push({
      name: child.name,
      storagePath,
      fileName: prepared.fileName,
      mimeType: prepared.mimeType,
    });
  }

  let crmResult;
  try {
    crmResult = await saveCrmParticipants({
      db,
      persist: persistCore,
      parent: {
        ...parentBody,
        name: parentName,
        lastName: parentLast,
        relation: parentRelation,
        phone,
        email,
        city,
        idNumber: parentIdNum,
      },
      participants: childList,
      template: template || resolveDeclarationTemplate(db, { templateId, templateSlug }),
      phoneVerification,
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

  // The uploaded approvals become documents in the personal file, alongside the
  // signed declaration PDF, so the office sees why this registration was let
  // through and can open the approval itself.
  const clearanceDocuments = [];
  for (const upload of clearanceUploads) {
    const index = childList.findIndex((child) => child.name === upload.name);
    const student = index >= 0 ? savedStudents[index] : null;
    const declaration = declarations.find((d) => d.studentId === student?.id) || null;
    const doc = db.insert('client_documents', {
      parentId: parent?.id || null,
      studentId: student?.id || null,
      declarationId: declaration?.id || null,
      type: 'medical_clearance',
      fileName: upload.fileName,
      storagePath: upload.storagePath,
      mimeType: upload.mimeType,
    });
    const durableDoc = await persistCore('client_documents', doc);
    if (durableDoc?.ok === false) {
      console.error('medical clearance document persist failed:', durableDoc.error);
    }
    clearanceDocuments.push(doc);
  }

  for (let index = 0; index < savedStudents.length; index += 1) {
    const student = savedStudents[index];
    const child = childList[index];
    const noteParts = [];
    if (interestText) noteParts.push(`עניין: ${interestText}`);
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
    const phone = child.childPhone || student.phone || '';
    const updatedStudent = db.update('students', student.id, {
      interests,
      segment,
      phone,
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

  // A family created by a public form should be recognised on an incoming
  // call like any other customer. Only staff-side paths scheduled this, and
  // there is no nightly sweep behind it, so these families never reached the
  // address book at all.
  touchGoogleContacts();

  // Spent only now, with the registration actually filed. Spending it up front
  // meant a submission refused for a missing birth date burned the
  // verification, and the correction came back "אימות הטלפון פג".
  otpService.consumeToken(otpToken, normPhone(phone));

  res.status(201).json({
    success: true,
    parent,
    students: savedStudents,
    declarations,
    subscriptions: savedLists,
    medicalClearances: clearanceDocuments,
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

  // Express 4 does not catch a rejected promise from a handler: without this
  // guard a storage failure on an unauthenticated route becomes an unhandled
  // rejection, and Node takes the whole API down with it.
  let uploaded;
  try {
    uploaded = await supa.uploadClientDocument(storagePath, buffer, 'application/pdf');
  } catch (err) {
    console.error('public onboard pdf upload error:', err.message);
    return res.status(500).json({ error: 'שמירת הקובץ נכשלה' });
  }
  if (!uploaded?.ok) {
    return res.status(500).json({ error: uploaded?.error || 'שמירת הקובץ נכשלה' });
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

/** Drop a stored file and its row — durable store first, then the local cache. */
async function removeClientDocumentRecord(doc) {
  if (doc.storagePath) await supa.removeClientDocument(doc.storagePath);
  const result = await db.deleteDurable('client_documents', doc.id);
  if (result.notFound) {
    const remote = await supa.remove('client_documents', doc.id);
    return remote?.ok === false ? remote : { ok: true };
  }
  return result;
}

// Staff: remove a single file from the personal file (a doctor's approval, a
// scan). The signed declaration goes through the route below instead.
app.delete('/api/documents/:id', async (req, res) => {
  const doc = (db.get('client_documents') || []).find((d) => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: 'מסמך לא נמצא' });
  const removed = await removeClientDocumentRecord(doc);
  if (!removed.ok) {
    return res.status(409).json({ error: removed.error || 'מחיקת המסמך נכשלה' });
  }
  res.json({ success: true });
});

// Staff: remove a health declaration from the file — the record, the PDFs saved
// under it, and the signed marks on the student. Deleting only the file is not
// enough: the card would still read "signed", and the client re-uploads the same
// PDF for a declaration that has no file.
app.delete('/api/students/:id/health-declaration', async (req, res) => {
  const studentId = String(req.params.id || '');
  const student = (db.get('students') || []).find((s) => s.id === studentId);
  if (!student) return res.status(404).json({ error: 'המתאמן לא נמצא' });

  const declarationId = String(req.query.declarationId || req.body?.declarationId || '').trim();
  const declarations = db.get('health_declarations') || [];
  const target = declarationId ? declarations.find((d) => d.id === declarationId) : null;
  // Once this declaration is gone, is any other one left on the child? If not,
  // files that were saved without a declaration id belong to it too.
  const otherDeclarations = declarations.filter(
    (d) => d.studentId === studentId && d.id !== declarationId
  );

  const docs = (db.get('client_documents') || []).filter((d) => {
    // A doctor's approval stands on its own and is deleted from its own row.
    if (d.type === 'medical_clearance') return false;
    if (declarationId && d.declarationId === declarationId) return true;
    if (d.declarationId) return false;
    return otherDeclarations.length === 0
      && d.studentId === studentId
      && d.type === 'health_waiver_pdf';
  });

  for (const doc of docs) {
    const removed = await removeClientDocumentRecord(doc);
    if (!removed.ok) {
      return res.status(409).json({ error: removed.error || 'מחיקת הקובץ נכשלה' });
    }
  }

  if (declarationId) {
    const removed = target
      ? await db.deleteDurable('health_declarations', declarationId)
      : await supa.remove('health_declarations', declarationId);
    if (removed?.ok === false) {
      return res.status(409).json({ error: removed.error || 'מחיקת ההצהרה נכשלה' });
    }
  }

  const stillSigned = (db.get('health_declarations') || []).some(
    (d) => d.studentId === studentId && (d.signed || d.status === 'approved' || d.waiverAccepted)
  );
  let updated = student;
  if (!stillSigned) {
    updated = db.update('students', studentId, {
      healthSignedAt: null,
      waiverSignedAt: null,
      status: student.status === 'health_signed' ? 'lead_new' : student.status,
    }) || student;
    await persistCore('students', updated);
  }

  res.json({ success: true, student: updated, removedDocuments: docs.length });
});

app.get('/api/students/:id/activity-registrations', async (req, res) => {
  try {
    const studentId = String(req.params.id || '').trim();
    if (!studentId) return res.status(400).json({ error: 'חסר מזהה מתאמן' });
    if (supa.isEnabled()) {
      const [remoteRegs, remoteActivities, remoteMarks] = await Promise.all([
        supa.getAll('activity_registrations'),
        supa.getAll('activities'),
        supa.getAll(ACTIVITY_ATTENDANCE_COLLECTION),
      ]);
      if (remoteRegs) db.set('activity_registrations', remoteRegs);
      if (remoteActivities) db.set('activities', remoteActivities);
      if (remoteMarks) db.set(ACTIVITY_ATTENDANCE_COLLECTION, remoteMarks);
    }
    const savedById = indexSavedAttendance(activityAttendanceRows(db));
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
        // Every day of the activity, so a multi-day camp is markable per day.
        const days = registrationCountsForAttendance(registration)
          ? attendanceDaysFor({ activity, registration, savedById })
          : [];
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
          days,
          attendance_summary: summarizeDays(days),
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
/**
 * Who a link about this child is sent to.
 *
 * `student.parentId` is the primary parent — the file's owner — and that is the
 * right default. But a child can have two parents on file, each with their own
 * phone and their own conversation, and the card shows one of them at a time.
 * When the caller names the parent it is looking at, the message follows the
 * open tab instead of always going to the primary, so a reply lands in the
 * thread it was asked from. A parent who is not on this child's file, or has no
 * phone, is ignored rather than trusted.
 */
function resolveLeadSendTarget(studentIdParam, preferredParentId = '') {
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
  const parent = chooseRecipientParent(db.get('parents') || [], {
    guardianIds: guardianParentIds(db, student),
    primaryParentId: student.parentId,
    preferredParentId,
  });
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
const PUBLIC_APP_FALLBACK = 'https://app.kirboaz.co.il';

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
  const base = `${String(origin).replace(/\/$/, '')}/register${pathSlug || ''}`;
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
  const target = resolveLeadSendTarget(req.params.studentId, req.body?.parentId);
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
    // The form is three things — participant details, the health declaration
    // and the waiver. Calling it "the health declaration" undersold it, and a
    // parent who opened it found fields nobody had mentioned.
    const freeformText = forChild
      ? `שלום ${parentLabel}, מצורף קישור למילוי פרטי המשתתף, הצהרת בריאות והסרת אחריות עבור ${studentLabel}:\n\n${healthUrl}`
      : `שלום ${parentLabel}, בבקשה מלאו את פרטי המשתתף, הצהרת הבריאות והסרת האחריות לפני הגעתכם:\n\n${healthUrl}`;
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
      // Which of the two parents it actually went to — the card says so rather
      // than leaving staff to assume it followed the tab they were on.
      sentTo: parentLabel,
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
    await refreshActivitiesCache();
    const result = ensureAttendanceRows({
      groups: db.get('groups') || [],
      students: db.withStudentRelations(db.get('students') || []),
      attendance: db.get('attendance') || [],
      activities: db.get('activities') || [],
      date: today,
      groupId: null,
    });
    for (const row of result.created) {
      db.insert('attendance', row);
    }
    syncVacationAttendance([today]);
    console.log(
      `📋 Daily attendance ensure (${today}): created ${result.created.length}` +
      (result.vacation ? ` · יום חופש: ${result.vacation.name || 'חופשה מאימונים'}` : '')
    );
  } catch (err) {
    console.error('Daily attendance ensure failed:', err.message);
    lastAttendanceEnsureDate = null;
  }
}

// Start Server (after loading CRM-core data from Supabase)
initDb({ requireDurable: requiresDurableStore() }).then(() => {
  try {
    ensureEquipmentWhatsappTemplate({ db, persist: persistCore });
  } catch (err) {
    console.warn('equipment template seed skipped:', err.message);
  }
  try {
    ensureEventWhatsappTemplates({
      db,
      persist: persistCore,
    });
  } catch (err) {
    console.warn('event whatsapp templates seed skipped:', err.message);
  }
  Promise.resolve(ensureDefaultScenarios({ db, persist: persistCore }))
    .then((created) => {
      if (created) console.log(`🧠 Seeded ${created} default AI scenario(s)`);
    })
    .catch((err) => console.warn('AI scenario seed skipped:', err.message));
  try {
    // Seed/hydrate catalog folders, then heal products left without a category.
    ensureProductCategories(db);
    const catFix = backfillPricelistCategories(db);
    if (catFix.updated > 0) {
      console.log(`🏷️ Pricelist category backfill: ${catFix.updated} product(s)`);
    }
  } catch (err) {
    console.warn('product catalog seed skipped:', err.message);
  }
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  try {
    automationsService.ensureDefaultIntroAutomations();
  } catch (err) {
    console.error('ensureDefaultIntroAutomations failed:', err.message);
  }

  migrateLegacyRoleLabels().catch((err) =>
    console.error('migrateLegacyRoleLabels failed:', err.message)
  );

  // נעילת ימים שהסתיימו. פעם בשעה ולא פעם ביום, כדי שיום ייסגר גם אם השרת
  // הופעל מחדש בדיוק בשעה שבה הריצה הייתה אמורה לקרות.
  const sealSafely = () => {
    try { sealPastWorkDays(); } catch (err) { console.error('sealPastWorkDays failed:', err.message); }
  };
  // אחרי טעינת הקטלוג ולא לפניה — התמחור נשען על התוויות שהיא מביאה.
  readRoleCatalog().then(sealSafely).catch(sealSafely);
  setInterval(sealSafely, 60 * 60 * 1000);

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
  // Follow-ups are not a once-a-day job: a short one is aimed 23 hours after
  // the customer's last message so it lands while free text is still allowed,
  // and a morning-only run would miss that hour on most conversations.
  setInterval(() => {
    automationsService.runBotFollowUps().catch((err) =>
      console.error('bot follow-ups failed:', err.message));
  }, 15 * 60 * 1000);

  // Evening agenda digests — tomorrow's plan daily, the coming week on Saturday
  setTimeout(() => { runAgendaDigestsIfDue(); }, 70_000);
  setInterval(() => { runAgendaDigestsIfDue(); }, 10 * 60 * 1000);

  // Campaigns + coupon expiry (from 10:00 Asia/Jerusalem, after the morning jobs)
  setTimeout(() => { runCampaignsIfDue(10); }, 90_000);
  setInterval(() => { runCampaignsIfDue(10); }, 15 * 60 * 1000);

  // AI assistant sweep over conversations that went quiet (from 03:00 Asia/Jerusalem)
  setInterval(() => { runNightlySweepIfDue(3); }, 15 * 60 * 1000);

  // Google Calendar pull every 10 minutes (backup for missed webhooks).
  // Skipped on local/dev so a laptop API cannot thrash the live OAuth tokens.
  const runGooglePullIfConnected = async () => {
    try {
      if (!googleCalendarService.backgroundSyncEnabled()) return;
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
  if (googleCalendarService.backgroundSyncEnabled()) {
    setTimeout(() => { runGooglePullIfConnected(); }, 60_000);
    setInterval(() => { runGooglePullIfConnected(); }, 10 * 60 * 1000);
  } else {
    console.log('📅 Google Calendar background sync disabled on this process (local/dev)');
  }

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
}).catch((error) => {
  console.error('FATAL: server startup aborted because durable data is unavailable:', error.message);
  process.exit(1);
});

