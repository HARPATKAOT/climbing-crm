import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { db, initDb, persistCore, parentPhonesMatch, setBotEnabledDurable } from './db.js';
import { supa, CORE_TABLES } from './supa.js';
import { readTable, readTables, readTablesFresh, markFreshlyLoaded } from './tableCache.js';
import {
  requiresDurableStore,
  publicStoreUnavailableError,
  scheduledJobsEnabled,
} from './runtimeSafety.js';
import {
  whatsappService,
  instagramService,
  runConversationAnalysis,
  runNightlySweep,
  runNightlySweepIfDue,
  runCentreRegistrationChecks,
  probeGeminiService,
  recoverUnansweredConversations,
} from './whatsapp.js';
import { getAiServiceState } from './aiServiceState.js';
import { ensurePublicRedirectLegacyCutoff } from './publicRedirectMigration.js';
import { whatsappConnectService } from './whatsappConnect.js';
import { automationsService, runScheduledAutomationsIfDue } from './automations.js';
import { resumeConversationAfterForm } from './botFormResume.js';
import { formConfirmationPayload } from './formConfirmation.js';
import { ensureGroupSignupWhatsappTemplate } from './groupSignupWhatsappTemplate.js';
import { runOneTimeBotDataMigrations } from './oneTimeBotDataMigrations.js';
import { recoverStalledIntroOffers } from './introOfferPolicy.js';
import { israelTimeToEpoch, runShiftRemindersIfDue, notifyShiftAssigned } from './shiftAlerts.js';
import {
  applyResponse,
  calendarSlotCandidates,
  eligibleEmployees,
  expandWeeklySlots,
  isWindowOpen,
  newSignupToken,
  normalizeNeeds,
  normalizeWindow,
  planAssignments,
  publicWindowView,
  respondentSummary,
  responsesForWindow,
  signupBoard,
} from './shiftSignup.js';
import {
  CLASS_WINDOW_KIND,
  applyClassResponse,
  classAssignmentMessageText,
  classSignupBoard,
  isClassWindowOpen,
  normalizeClassWindow,
  planClassStaffing,
  publicClassBoardView,
} from './classSignup.js';
import { sendAssignmentSummaries, sendSignupInvites } from './shiftSignupNotify.js';
import {
  DENOMINATIONS,
  sessionSnapshot,
  openSession,
  closeSession,
  adjustCash,
  recordSaleInLedger,
  recordRefundInLedger,
  listLedger,
  actionTypeLabel,
  getOpenSession,
  roundMoney as cashRoundMoney,
} from './cashRegister.js';
import { buildSaleReceipt, buildDrawerOnlyPayload } from './escposReceipt.js';
import { alertRecipients, alertSubscribers } from './staffAlerts.js';
import { sendStaffAlert, noteStaffAlertFailure } from './staffNotify.js';
import {
  GROUP_META_COLLECTION,
  enrichGroupsWithBotMeta,
  saveGroupBotMeta,
  backfillCanonicalTrainingDays,
} from './groupMetadata.js';
import {
  PLACEMENT_REQUEST_COLLECTION,
  canPlaceInRestrictedGroup,
  eligibilityForStudent,
  reviewProgramApproval,
  setProgramGroupEligibility,
  setSharedProgramEligibility,
  sharedRestrictedEligibility,
} from './placementEligibility.js';
import { announceProgramEligibility } from './eligibilityNotice.js';
import { buildCustomerTools } from './botTools.js';
import { createIntroPaymentRequest } from './introPayments.js';
import {
  LIFECYCLE_TEMPLATE_NAMES,
  approvedLifecycleTemplate,
  ensureRegistrationLifecycleTemplates,
} from './registrationLifecycleTemplates.js';
import { loadBrandedBotSettings } from './whatsappBot.js';
import { continueApprovedPlacement } from './placementApprovalContinuation.js';
import { notifyGroupMembershipDiff, runIntroHeadsUpIfDue } from './groupAlerts.js';
import { capabilityState, capabilitySettingsPatch } from './botCapabilities.js';
import { normalizeInboundQuietMs } from './inboundBurst.js';
import { listBotActions, botActionSummary, BOT_ACTION_TYPES } from './botActivityLog.js';
import { botOpenItems } from './botOpenItems.js';
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
  normalizeOffer,
  offerSummary,
  couponState,
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
  matchingDiscountRules,
  normalizeDiscountRule,
  offerForDiscountRule,
} from './discountRules.js';
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
import {
  matchEventHostParent,
  normalizeEventHostProfile,
  resolveEventHostRecipient,
} from './eventHostProfile.js';
import { apiAuth, requireOwner } from './auth.js';
import {
  allowedCorsOrigins,
  issueEmployeeOnboardInvite,
  issueOAuthState,
  issuePublicRedirectToken,
  requireCronSecret,
  resolvePublicRedirectRecordId,
  safeIcountDocumentUrl,
  safeHttpsRedirectUrl,
  secureCompare,
  securityLogRef,
  securityHeaders,
  verifyEmployeeOnboardInvite,
  verifyOAuthState,
} from './security.js';
import { financeRouter } from './financeRoutes.js';
import { runFinanceNightlyIfDue } from './financeNightly.js';
import {
  accessAtLeast,
  createAccessRole,
  deleteAccessRole,
  hasSensitiveAccess,
  getAuthorizedUserPreview,
  inviteAuthorizedUser,
  listAccessRoles,
  listAuthorizedUsers,
  removeAuthorizedUser,
  resendAuthorizedUserInvite,
  sendAuthorizedUserPasswordReset,
  updateAccessRole,
  updateAuthorizedUser,
} from './userAccess.js';
import { googleCalendarService } from './googleCalendar.js';
import { googleContactsService } from './googleContacts.js';
import { googleBusinessProfileService } from './googleBusinessProfile.js';
import {
  sendActivityRegistrationConfirmation,
  sendHostRegistrationLink,
  isEmailConfigured,
} from './email.js';
import {
  makeRegistrationSlug,
  makePrivatePaymentToken,
  normalizeHostPaymentStatus,
  leadSourceFromActivityType,
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
  normalizeChargeBasis,
  normalizeCount,
  normalizeMoney,
  hostChargeBreakdown,
} from './activityPricing.js';
import {
  describeRule,
  ensureSeedPriceRules,
  listPriceRules,
  normalizePriceRule,
  priceRuleUsage,
  resolveActivityRule,
  ruleNumbers,
  ruleNumbersChanged,
  MAX_RULE_HISTORY,
} from './activityPriceBook.js';
import {
  activityPublicSlug,
  upcomingPublicActivities,
  upcomingOpeningHours,
  publicGroups,
} from './publicSite.js';
import { eventPublicUrl } from './botFacts.js';
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
  suggestionRows,
  updateScenario,
  updateTask,
} from './aiActions.js';
import { assertAiSuggestionApprovalAccess } from './aiApprovalSecurity.js';
import { READ_TOOLS, runChatTurn, callGeminiChat } from './aiChat.js';
import {
  approveFeedback,
  feedbackStats,
  listFeedback,
  listLearned,
  recordFeedback,
  rejectFeedback,
  setLearnedActive,
  withBotReplies,
} from './botLearning.js';
import {
  INTEREST_COLLECTION,
  addInterest,
  closeInterestForRegistrations,
  convertInterestToRegistration,
  enrichInterest,
  listInterest,
  normalizeInterestInput,
  authorizedRegistrationPaymentStatus,
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
  draftActivityCopy,
  isDraftableField,
} from './activityCopyDraft.js';
import { executePartialRefund } from './partialRefund.js';
import {
  chargeEmvForSale,
  emvFailureMessage,
  listOrphanEmvCharges,
} from './emvCharge.js';
import { equipmentRefundRecommendation, isEquipmentPayment } from './equipmentRefund.js';
import { equipmentPurchaseRows } from './equipmentPurchases.js';
import { canClearPaidEquipmentStatus } from './equipmentPaymentSecurity.js';
import { normalizeManualDeclaration } from './manualDeclarationSecurity.js';
import { secureCheckInRecord } from './checkInSecurity.js';
import { passesOfSale, saleRefundPlan } from './passRefund.js';
import { validateManualRefund, manualRefundMarks } from './manualRefund.js';
import {
  summarizeActivityCancellation,
  registrationsToRelease,
  activityIsCancelled,
  activityIsArchived,
  activityCanBeArchived,
} from './activityCancellation.js';
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
  findLatestDeclaration,
  findLatestValidDeclaration,
  saveCrmParticipants,
  statusAfterHealthSignature,
  validateSignatureImage,
} from './crmWaiverService.js';
import {
  declarationGap,
  isChildOnlyQuestion,
  isScreeningQuestion,
  needsMedicalClearance,
  questionLabel,
  questionsForSigner,
  requiresClearance,
  signsAsAdultFemale,
} from './healthQuestions.js';
import { EVENT_KINDS, normalizeActivityType } from './eventKinds.js';
import { declarationTemplateForActivity, templateActivityTypes } from './activityDeclaration.js';
import { createOtpService } from './otpService.js';
import { resolvePublicIdentity } from './publicIdentity.js';
import {
  appendSignatureEvidence,
  createSignatureEvidenceEvent,
  evidenceReference,
  requestEvidence,
  sha256,
  verifySignatureEvidenceEvent,
} from './signatureEvidence.js';
import {
  declarationSignedAt,
  isHealthDeclarationValid,
  scopedDeclarationSignedAt,
} from './healthValidity.js';
import { participationEligibility } from './participationEligibility.js';
import { participantPaymentAccess } from './posParticipantAccess.js';
import {
  CANONICAL_HEALTH_QUESTIONS,
  normalizeParticipationScope,
  scopeForActivity,
} from './participationDocuments.js';
import {
  ensureAdultParticipantForParent,
  ensureHouseholdForParent,
  householdIdForParent,
  isStudentInHousehold,
  splitExplicitHousehold,
} from './households.js';
import {
  createPolicy,
  currentPolicyVersion,
  publishPolicy,
  recordPolicyAcceptance,
  resolvePolicyFor,
  savePolicyDraft,
  suggestedRefund,
} from './cancellationPolicies.js';
import {
  passPunchBlockReason,
  passPunchSafetyNote,
  wallDocumentsStatus,
  testsForStudent,
} from './passPunchEligibility.js';
import { lastVisit, lastVisitLabel } from './lastVisit.js';
import { buildCounterQueues } from './pendingHandling.js';
import { runHealthExpiryReminders, runParticipationDocumentReminders } from './participationReminders.js';
import { OPERATIONAL_LIST, migrateToTwoBroadcastLists, freshStartBroadcastSubscriptions } from './broadcastListMigration.js';
import {
  anchorInUseBy,
  computeAnchoredPrice,
  dependentPriceUpdates,
  isPriceAnchor,
  validateAnchorLink,
} from './pricelistPricing.js';
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
  unitCapacity,
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
  POS_CHECKOUT_STATUS,
  POS_CHECKOUT_TABLE,
  buildPosCheckoutLink,
  checkoutItemsLabel,
  documentGaps,
  gapText,
  isPosCheckoutOpen,
  newPosCheckoutToken,
  posCheckoutStatus,
  posCheckoutStatusLabel,
  wallAccessLines,
  wallParticipantIds,
} from './posCheckoutLinks.js';
import {
  EQUIPMENT_ITEM_TYPES,
  EQUIPMENT_ITEM_LABELS,
  EQUIPMENT_TEMPLATE_NAME,
  DEFAULT_EQUIPMENT_SETTINGS,
  mergeEquipmentSettingsPatch,
  normalizeEquipmentSettings,
  isKidStudent,
  isEquipmentEligibleStudent,
  equipmentItemTypesForStudent,
  ensureStudentEquipment,
  backfillAdultEquipment,
  markEquipmentItemsPaid,
  resetShoeRental,
  markEquipmentGiven,
  markEquipmentPendingFulfillment,
  markEquipmentOwn,
  markEquipmentUnpaid,
  markEquipmentDeclined,
  computeEquipmentTotal,
  applyEquipmentFamilyDiscount,
  describeEquipmentItems,
  equipmentGapFlags,
  unpaidEquipmentItems,
  newCheckoutToken,
  ensureEquipmentWhatsappTemplate,
  equipmentPublicBase,
  shoesSeasonPricing,
} from './equipmentService.js';
import {
  equipmentReceiptMessage,
  familyEquipmentStanding,
} from './equipmentStanding.js';
import { ideaJustScheduled, ideaScheduledMessage } from './activityIdeas.js';
import { weeklySessionsForStudent } from './studentFrequency.js';
import { shoesUpgradeQuote, describeShoesUpgrade } from './equipmentUpgrade.js';
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
  DEFAULT_MANUAL_TEMPLATE_NAMES,
  loadManualTemplateNames,
  setManualTemplate,
  withManualSendFlag,
} from './conversationTemplateSettings.js';
import { withUsage } from './templateUsage.js';
import {
  PARTICIPATION_FORM_TEMPLATE,
  ensureParticipationFormWhatsappTemplate,
  findApprovedParticipationFormTemplate,
  participationFormButtonParam,
  buildParticipationFormRedirectUrl,
} from './participationFormWhatsappTemplate.js';
import { FORM_FULL, CASH_REGISTER_FORM_SOURCE, isCashRegisterFormSource } from './participationForm.js';
import { migrateUnifiedWallWaiver } from './scripts/applyHealthDeclarationText.js';
import {
  ensureProductCategories,
  renameCategoryOnProducts,
  normalizeProductCategories,
  backfillPricelistCategories,
  backfillWallClimbingProducts,
  clampImage,
} from './productCategories.js';
import { storeImageValue, forgetImageValue } from './productImages.js';
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
  EMPLOYEE_ONBOARD_DOC_DEFS,
  getEmployeeOnboardInviteNonce,
  resetEmployeeOnboardInviteNonce,
  getForm101Url,
  saveForm101Url,
} from './employeeOnboardingForm.js';
import { calculateDashboardStats, funnelFamilies, listTodayTransactions } from './dashboardStats.js';
import { validateUploadedDocument } from './uploadedDocument.js';
import { unsupportedStudentEditFields } from './studentUpdateSecurity.js';
import {
  WORK_PAY_FIELDS,
  canMutateApprovedWorkAssignment,
  hasWorkPayOverride,
} from './workAssignmentSecurity.js';
import {
  applyBusinessBrand,
  isOptedOut,
  parentFirstName,
  resetPlaygroundConversation,
  withBotMark,
} from './whatsappBot.js';
import { waitForMessages, currentVersion } from './liveUpdates.js';
import { shouldMarkIntroPaid } from './introStatus.js';
import { countEnrolled } from './groupCapacity.js';
import { enrichStudentsWithGroupIds, studentGroupIds, studentInGroup } from './studentGroups.js';
import {
  HOLD_COLLECTION,
  GROUP_PLACEMENT_MODE,
  INTRO_COLLECTION,
  WAITLIST_COLLECTION,
  REGISTRATION_STATUS,
  acceptWaitlistOffer,
  activeHoldForStudent,
  applyRegistrationLifecycleMigration,
  capacityForGroup,
  confirmParentRegistration,
  confirmIntroPayment,
  continueAfterIntro,
  createIntroBooking,
  groupPlacementsForStudent,
  joinGroupWaitlist,
  leaveGroupWaitlist,
  lifecycleSnapshotForStudent,
  markPlacementRegistered,
  migrationDryRun,
  occupiedSeatIds,
  offerNextWaitlistee,
  requeueUndeliveredWaitlistOffer,
  releasePlacementHold,
  runRegistrationLifecycle,
  setStudentGroupPlacement,
  setStudentGroupPlacements,
  waitlistEntriesForGroup,
} from './registrationLifecycle.js';
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
import { buildShiftJournal } from './employeeShiftJournal.js';
import { buildWallShiftHistory } from './wallShiftHistory.js';
import { canAccessLevelTest } from './levelTestAccess.js';
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
  COMPANY_PAYMENT_TYPES,
  buildPeriodView,
  isValidPeriod,
  periodsForEmployee,
  sanitizePeriodPatch,
} from './payrollPeriods.js';
import {
  readStaffAttendanceSettings,
  writeStaffAttendanceSettings,
  employeeCanSignDailySafety,
  employeeIsWallStaff,
} from './staffAttendanceSettings.js';
import { isDailySafetyCheck } from './wallOperatingDay.js';
import {
  employeeCanOperateWall,
  openWallShifts,
  employeeCanTestSafety,
  pendingWallSafetyChecks,
  requireQualifiedWallCloser,
  requireSafetyExaminer,
  wallOpeningSafetyChecks,
  wallStationEmployee,
} from './wallOperations.js';
import {
  WALL_ACTIVITY_TYPE,
  WALL_ROLE,
  wallShiftOpener,
  wallShiftStage,
  canClockOut,
  qualifiedClosersOnShift,
  canJoinShift,
  buildWallPayrollRow,
} from './wallShift.js';
import {
  getConversation,
  getConversationMedia,
  markThreadRead,
  listConversations,
  replyToParent,
  updateMessageStatusByMetaId,
  handleMessengerIncoming,
  markCommunicationHandled,
  markAllCommunicationsHandled,
  setBotState,
  continueBotConversation,
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
  POS_INVOICE_TEMPLATE_NAME,
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
import {
  startBroadcastJob,
  getBroadcastJob,
  listBroadcastJobs,
  cancelBroadcastJob,
  pauseBroadcastJob,
  resumeBroadcastJob,
  resendFailedRecipients,
  sendBroadcastTest,
  parentBroadcastHistory,
  startBroadcastRunner,
} from './channels/broadcast.js';
import {
  buildBroadcastPlan,
  getBroadcastDefaults,
  saveBroadcastDefaults,
} from './channels/broadcastPlan.js';
import { getMetaQuota } from './channels/metaQuota.js';
import { mediaCredentialsStatus } from './channels/media.js';
import {
  mailingConfirmationMessage,
  mailingPreferencesSnapshot,
  readMailingPreferenceToken,
  updateMailingPreferences,
  createMailingPreferenceToken,
} from './mailingPreferences.js';
import { resolveMailingShortCode, shortMailingPreferencesUrl } from './mailingShortLinks.js';
import { appPublicBase } from './publicLinks.js';

const app = express();
const PORT = process.env.PORT || 5000;
const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v25.0';
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(securityHeaders);

// The customer list is ~1.7 MB of JSON and the pricelist another 1.7 MB, all
// of it sent uncompressed until now — the single biggest cost of opening a
// screen from outside the office. JSON gzips roughly ten to one.
app.use(compression());

const configuredOrigins = String(process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = allowedCorsOrigins(configuredOrigins);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      return callback(null, true);
    }
    const error = new Error('Origin is not allowed');
    error.code = 'CORS_ORIGIN_DENIED';
    return callback(error);
  },
}));
app.use((err, _req, res, next) => {
  if (err?.code === 'CORS_ORIGIN_DENIED') {
    return res.status(403).json({ error: 'Origin is not allowed' });
  }
  return next(err);
});
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

// Public uptime checks reveal only process health. Store errors and security
// configuration are available on the authenticated owner-only deep endpoint.
function healthBase() {
  return {
    status: 'UP',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    release: String(process.env.RENDER_GIT_COMMIT || '').slice(0, 7) || null,
  };
}

app.get('/api/health', (_req, res) => res.status(200).json(healthBase()));

async function deepHealthResponse(res) {
  const store = await supa.ping();
  const pendingMessages = countPendingMessages();
  const healthy = store.ok && pendingMessages === 0;

  return res.status(healthy ? 200 : 503).json({
    ...healthBase(),
    status: healthy ? 'UP' : 'DEGRADED',
    database: store.ok ? { ok: true, ms: store.ms } : { ok: false, error: store.error },
    serviceRoleKey: supa.hasServiceRoleKey(),
    pendingMessages,
  });
}

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
const publicRedirectWindows = new Map();
const PUBLIC_REDIRECT_WINDOW_MS = 15 * 60 * 1000;
const PUBLIC_REDIRECT_MAX = 30;
let publicLegacyRedirectCutoffMs = 0;

function publicRedirectRateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const current = publicRedirectWindows.get(key);
  if (!current || current.resetAt <= now) {
    if (publicRedirectWindows.size > 5000) {
      for (const [storedKey, value] of publicRedirectWindows) {
        if (value.resetAt <= now) publicRedirectWindows.delete(storedKey);
      }
    }
    publicRedirectWindows.set(key, { count: 1, resetAt: now + PUBLIC_REDIRECT_WINDOW_MS });
    return next();
  }
  current.count += 1;
  if (current.count > PUBLIC_REDIRECT_MAX) {
    res.set('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
    return res.status(429).send('Too many link requests');
  }
  return next();
}

function signedOrLegacyRedirectId(value, purpose) {
  return resolvePublicRedirectRecordId(value, purpose, {
    legacyCutoffMs: publicLegacyRedirectCutoffMs,
  }) || '';
}

function resolveStoredPaymentUrl(paymentId) {
  const id = String(paymentId || '').trim();
  if (!id) return { url: '', expired: false };
  const payment = db.getOne('payments', id);
  const expired = payment?.status !== 'paid'
    && payment?.expires_at
    && new Date(payment.expires_at).getTime() <= Date.now();
  if (expired) return { url: '', expired: true };
  if (payment?.payment_url) return { url: String(payment.payment_url), expired: false };
  const sales = db.get('pos_sales') || [];
  const sale =
    sales.find((row) => String(row.payment_id || '') === id) ||
    sales.find((row) => String(row.id || '') === String(payment?.pos_sale_id || '')) ||
    null;
  if (sale?.payment_url) return { url: String(sale.payment_url), expired: false };
  return { url: '', expired: false };
}

function redirectPaymentLink(req, res) {
  const paymentId = signedOrLegacyRedirectId(req.params.paymentId, 'payment');
  if (!paymentId) return res.status(404).send('קישור התשלום לא נמצא');
  const { url: payUrl, expired } = resolveStoredPaymentUrl(paymentId);
  if (!payUrl) {
    return res
      .status(expired ? 410 : 404)
      .type('html')
      .send(
        '<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8" />' +
          '<title>קישור לא נמצא</title><body style="font-family:sans-serif;padding:24px">' +
          '<h1>קישור התשלום לא נמצא או שפג תוקפו</h1>' +
          `<p>פנו לצוות ${DEFAULT_BRAND_NAME} לקבלת קישור חדש.</p></body></html>`
      );
  }
  const safePayUrl = safeIcountDocumentUrl(payUrl);
  if (!safePayUrl) return res.status(404).send('קישור התשלום אינו זמין');
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
  res.set('Cache-Control', 'no-store');
  return res.redirect(302, safePayUrl);
}
app.get('/r/:paymentId', publicRedirectRateLimit, redirectPaymentLink);
app.get('/api/r/:paymentId', publicRedirectRateLimit, redirectPaymentLink);

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
 * הקישור שמאחורי כפתור „צפייה בחשבונית” בתבנית המאושרת.
 *
 * המסמך עצמו יושב אצל iCount בכתובת ארוכה שמשתנה מעסקה לעסקה, ומטא מקפיאה
 * את המארח של כפתור בתבנית. לכן הכפתור מצביע לכאן עם מזהה המכירה, והשרת
 * שולח משם לכתובת האמיתית.
 */
function redirectSaleDocument(req, res) {
  const saleId = signedOrLegacyRedirectId(req.params.saleId, 'sale-document');
  if (!saleId) return res.status(404).send('קישור החשבונית לא נמצא');
  const sale = db.getOne('pos_sales', saleId);
  const url = safeIcountDocumentUrl(sale?.icount_doc_url);
  if (!url) return res.status(404).send('לא נמצאה חשבונית למכירה הזאת');
  res.set('Cache-Control', 'no-store');
  return res.redirect(302, url);
}
app.get('/d/:saleId', publicRedirectRateLimit, redirectSaleDocument);
app.get('/api/d/:saleId', publicRedirectRateLimit, redirectSaleDocument);

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
  const target = safeHttpsRedirectUrl(twice
    ? (group.signupLinkTwice || group.signupLinkWeek)
    : (group.signupLinkWeek || group.signupLinkTwice));
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
 * The intake / participation form for one trainee: `/f/<studentId>[/<slug>]`.
 *
 * The long form is `/register[/<slug>]?studentId=…`. A query string at the end
 * of a WhatsApp message is exactly what stops the link being tappable — a path
 * segment has no such problem. The optional slug picks wall / trip so
 * the Meta template button can carry the right form without freezing two
 * separate button URLs.
 */
function resolveIntakeRegisterPath(slugParam) {
  const raw = String(slugParam || '').trim().toLowerCase();
  const alias = { birthday: 'wall', event: 'wall' };
  const slug = alias[raw] || raw;
  if (!slug || slug === 'wall') return '/register';
  return `/register/${encodeURIComponent(slug)}`;
}

function redirectIntakeForm(req, res) {
  const studentId = String(req.params.studentId || '').trim();
  if (!studentId) return res.status(400).send('חסר מזהה מתאמן');
  // `p:<טלפון>` — טופס למי שאין לו עדיין תיק. תבנית הוואטסאפ המאושרת בנויה
  // סביב `/f/{{1}}`, ולכן זו הדרך היחידה להגיע דרכה לטופס לפי טלפון בלי
  // לפתוח תיק מראש רק כדי שיהיה מזהה לשים בקישור.
  if (studentId.startsWith('p:')) {
    const phone = studentId.slice(2).replace(/\D/g, '');
    if (!phone) return res.status(400).send('חסר טלפון');
    const path = resolveIntakeRegisterPath(req.params.slug);
    const params = new URLSearchParams({ phone, source: CASH_REGISTER_FORM_SOURCE });
    return res.redirect(302, `${eventPublicBase()}${path}?${params.toString()}`);
  }
  if (String(req.params.slug || '').trim().toLowerCase() === 'health-renewal') {
    const params = new URLSearchParams({ studentId, mode: 'health-renewal' });
    return res.redirect(302, `${eventPublicBase()}/register?${params.toString()}`);
  }
  const path = resolveIntakeRegisterPath(req.params.slug);
  return res.redirect(302, `${eventPublicBase()}${path}?studentId=${encodeURIComponent(studentId)}`);
}
app.get('/f/:studentId/:slug', redirectIntakeForm);
app.get('/f/:studentId', redirectIntakeForm);
app.get('/api/f/:studentId/:slug', redirectIntakeForm);
app.get('/api/f/:studentId', redirectIntakeForm);

/**
 * Meta occasionally delivers a dynamic template button without its suffix.
 * The customer then reaches the frozen base URL (`/f/`) with no student or
 * phone to prefill. Keep that already-sent link usable: the ordinary register
 * form can identify the household by phone after it opens.
 */
function redirectBlankIntakeForm(_req, res) {
  return res.redirect(302, `${eventPublicBase()}/register?source=${CASH_REGISTER_FORM_SOURCE}`);
}
app.get('/f', redirectBlankIntakeForm);
app.get('/f/', redirectBlankIntakeForm);
app.get('/api/f', redirectBlankIntakeForm);
app.get('/api/f/', redirectBlankIntakeForm);

/** The same form keyed by phone, for a family with no trainee record yet. */
function redirectIntakeByPhone(req, res) {
  const phone = String(req.params.phone || '').replace(/\D/g, '');
  if (!phone) return res.status(400).send('חסר טלפון');
  const path = resolveIntakeRegisterPath(req.params.slug);
  return res.redirect(302, `${eventPublicBase()}${path}?phone=${encodeURIComponent(phone)}`);
}
app.get('/fp/:phone/:slug', redirectIntakeByPhone);
app.get('/fp/:phone', redirectIntakeByPhone);
app.get('/api/fp/:phone/:slug', redirectIntakeByPhone);
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
app.use('/api/finance', financeRouter);

app.get('/api/health/deep', requireOwner, async (_req, res) => deepHealthResponse(res));

app.get('/api/auth/me', (req, res) => {
  res.json(req.crmUser);
});

app.get('/api/settings/users', requireOwner, async (req, res) => {
  try {
    res.json(await listAuthorizedUsers(req.crmUser));
  } catch (error) {
    res.status(503).json({ error: error.message || 'טעינת המשתמשים נכשלה' });
  }
});

app.get('/api/settings/users/:id/preview', requireOwner, async (req, res) => {
  try {
    res.json(await getAuthorizedUserPreview(req.params.id, req.crmUser));
  } catch (error) {
    res.status(error.statusCode || 503).json({ error: error.message || 'טעינת תצוגת המשתמש נכשלה' });
  }
});

app.get('/api/settings/user-roles', requireOwner, async (_req, res) => {
  try {
    res.json(await listAccessRoles());
  } catch (error) {
    res.status(503).json({ error: error.message || 'טעינת התפקידים נכשלה' });
  }
});

app.post('/api/settings/user-roles', requireOwner, async (req, res) => {
  try {
    res.status(201).json(await createAccessRole(req.body || {}));
  } catch (error) {
    res.status(error.statusCode || 503).json({ error: error.message || 'יצירת התפקיד נכשלה' });
  }
});

app.patch('/api/settings/user-roles/:id', requireOwner, async (req, res) => {
  try {
    res.json(await updateAccessRole(req.params.id, req.body || {}));
  } catch (error) {
    res.status(error.statusCode || 503).json({ error: error.message || 'עדכון התפקיד נכשל' });
  }
});

app.delete('/api/settings/user-roles/:id', requireOwner, async (req, res) => {
  try {
    res.json(await deleteAccessRole(req.params.id, req.body?.replacement_role_id || null));
  } catch (error) {
    res.status(error.statusCode || 503).json({
      error: error.message || 'מחיקת התפקיד נכשלה',
      ...(error.assignedCount ? { assigned_count: error.assignedCount } : {}),
    });
  }
});

app.post('/api/settings/users', requireOwner, async (req, res) => {
  try {
    res.status(201).json(await inviteAuthorizedUser(req.body || {}, req.crmUser));
  } catch (error) {
    res.status(error.statusCode || 503).json({ error: error.message || 'שליחת ההזמנה נכשלה' });
  }
});

app.patch('/api/settings/users/:id', requireOwner, async (req, res) => {
  try {
    res.json(await updateAuthorizedUser(req.params.id, req.body || {}, req.crmUser));
  } catch (error) {
    res.status(error.statusCode || 503).json({ error: error.message || 'עדכון המשתמש נכשל' });
  }
});

app.delete('/api/settings/users/:id', requireOwner, async (req, res) => {
  try {
    res.json(await removeAuthorizedUser(req.params.id, req.crmUser));
  } catch (error) {
    res.status(error.statusCode || 503).json({ error: error.message || 'הסרת הגישה נכשלה' });
  }
});

app.post('/api/settings/users/:id/password-reset', requireOwner, async (req, res) => {
  try {
    res.json(await sendAuthorizedUserPasswordReset(req.params.id, req.crmUser));
  } catch (error) {
    res.status(error.statusCode || 503).json({ error: error.message || 'שליחת קישור האיפוס נכשלה' });
  }
});

app.post('/api/settings/users/:id/resend-invite', requireOwner, async (req, res) => {
  try {
    res.json(await resendAuthorizedUserInvite(req.params.id, req.crmUser));
  } catch (error) {
    res.status(error.statusCode || 503).json({ error: error.message || 'שליחת ההזמנה מחדש נכשלה' });
  }
});

// Minimal operational roster. Staff need names and class placement to mark
// attendance and wall entry; customer contacts, billing and business data stay
// on owner-only endpoints.
app.get('/api/operations/roster', (req, res) => {
  const students = db.withStudentRelations(db.get('students') || [])
    .filter((student) => student.status !== 'archived')
    .map((student) => ({
    id: student.id,
    name: student.name || '',
    status: student.status || '',
    groupId: student.groupId || null,
    groupIds: studentGroupIds(student),
    isAdult: student.isAdult === true,
    healthSignedAt: student.healthSignedAt || null,
  }));
  const groups = (db.get('groups') || []).map((group) => ({
    id: group.id,
    name: group.name || '',
    day: group.day,
    days: Array.isArray(group.days) ? group.days : undefined,
    time: group.time || '',
    duration: group.duration,
    ageCategory: group.ageCategory || '',
    maxSlots: group.maxSlots,
    trainer: group.trainer || null,
    assistants: Array.isArray(group.assistants) ? group.assistants : [],
  }));
  res.json({ students, groups });
});

app.get('/api/dashboard/stats', async (req, res) => {
  const visibleStats = (stats) => hasSensitiveAccess(req.crmUser, 'finance')
    ? stats
    : omitFields(stats, new Set(['dailySales']));
  try {
    const [sales, payments, parents, students, history] = await readTables(
      'pos_sales',
      'payments',
      'parents',
      'students',
      'lead_status_history'
    );
    res.json(visibleStats(calculateDashboardStats({ sales, payments, parents, students, history })));
  } catch (error) {
    console.error('GET /api/dashboard/stats failed:', error.message);
    res.json(visibleStats(calculateDashboardStats({
      sales: db.get('pos_sales') || [],
      payments: db.get('payments') || [],
      parents: db.get('parents') || [],
      students: db.get('students') || [],
      history: db.get('lead_status_history') || [],
    })));
  }
});

// עסקאות היום — הרשימה שמאחורי מספר ההכנסות במסך העבודה. כספים בלבד.
app.get('/api/dashboard/today-sales', async (req, res) => {
  if (!hasSensitiveAccess(req.crmUser, 'finance')) {
    return res.status(403).json({ error: 'אין הרשאה לצפות בעסקאות היום' });
  }
  try {
    const [sales, payments, parents, students] = await readTables(
      'pos_sales',
      'payments',
      'parents',
      'students'
    );
    res.json(listTodayTransactions({ sales, payments, parents, students }));
  } catch (error) {
    console.error('GET /api/dashboard/today-sales failed:', error.message);
    res.json(listTodayTransactions({
      sales: db.get('pos_sales') || [],
      payments: db.get('payments') || [],
      parents: db.get('parents') || [],
      students: db.get('students') || [],
    }));
  }
});

// המשפחות שמאחורי כל שלב במשפך — לדפדוף מתוך מסך העבודה. גישת מודול לקוחות.
app.get('/api/dashboard/funnel-families', async (req, res) => {
  if (!accessAtLeast(req.crmUser, 'customers', 'view')) {
    return res.status(403).json({ error: 'אין הרשאה לצפות ברשימת הלידים' });
  }
  try {
    const [parents, students] = await readTables('parents', 'students');
    res.json(funnelFamilies(parents, students));
  } catch (error) {
    console.error('GET /api/dashboard/funnel-families failed:', error.message);
    res.json(funnelFamilies(db.get('parents') || [], db.get('students') || []));
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

app.get('/api/settings/cancellation-policies', requireOwner, async (_req, res) => {
  try {
    if (supa.isEnabled()) {
      const [policies, versions] = await Promise.all([
        supa.getAll('cancellation_policies'),
        supa.getAll('cancellation_policy_versions'),
      ]);
      if (policies) db.set('cancellation_policies', policies);
      if (versions) db.set('cancellation_policy_versions', versions);
    }
    const versions = db.get('cancellation_policy_versions') || [];
    res.json({
      policies: (db.get('cancellation_policies') || []).map((policy) => ({
        ...policy,
        versions: versions
          .filter((version) => version.policy_id === policy.id)
          .sort((a, b) => Number(b.version_number) - Number(a.version_number)),
        current: currentPolicyVersion(db, policy.id)?.snapshot || null,
      })),
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'טעינת המדיניות נכשלה' });
  }
});

app.post('/api/settings/cancellation-policies', requireOwner, async (req, res) => {
  try {
    const actor = req.crmUser?.id || req.crmUser?.email || '';
    res.status(201).json(await createPolicy(db, persistCore, req.body || {}, actor));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'יצירת המדיניות נכשלה' });
  }
});

app.put('/api/settings/cancellation-policies/:id/draft', requireOwner, async (req, res) => {
  try {
    const actor = req.crmUser?.id || req.crmUser?.email || '';
    res.json(await savePolicyDraft(db, persistCore, req.params.id, req.body || {}, actor));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'שמירת הטיוטה נכשלה' });
  }
});

app.post('/api/settings/cancellation-policies/:id/publish', requireOwner, async (req, res) => {
  try {
    const actor = req.crmUser?.id || req.crmUser?.email || '';
    res.json(await publishPolicy(db, persistCore, req.params.id, req.body || {}, actor));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'פרסום המדיניות נכשל' });
  }
});

app.post('/api/settings/cancellation-policies/refund-preview', requireOwner, (req, res) => {
  try {
    res.json(suggestedRefund(req.body || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || 'חישוב ההחזר נכשל' });
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
function customerForRequest(req, row) {
  if (hasSensitiveAccess(req.crmUser, 'finance')) return row;
  const allowedFinancialStatus = new Set(['payment_status', 'paid', 'is_paid', 'membership_status', 'pass_status']);
  const sensitiveKey = /(?:amount|balance|price|cost|fee|invoice|receipt|refund|revenue|profit|payment_(?:id|link|url|token)|icount)/i;
  return Object.fromEntries(Object.entries(row || {}).filter(([key]) => (
    allowedFinancialStatus.has(key) || !sensitiveKey.test(key)
  )));
}

// The owner shell needs these three collections together on every full page
// load. They are already hydrated from Supabase before the server starts and
// kept current by the write paths, so serving one in-memory snapshot avoids
// seven duplicate durable-store reads and three HTTP round trips.
app.get('/api/crm/core', requireOwner, (req, res) => {
  const students = db.withStudentRelations(db.get('students') || [])
    .map((row) => customerForRequest(req, {
      ...row,
      registrationLifecycle: lifecycleSnapshotForStudent(db, row.id),
    }));
  const parents = (db.get('parents') || [])
    .map((row) => customerForRequest(req, row));
  const groups = withGroupEnrollmentCounts(db.get('groups') || [], students);
  res.json({ students, parents, groups });
});

app.get('/api/parents', async (req, res) => {
  try {
    const rows = await readTable('parents');
    return res.json(rows.map((row) => customerForRequest(req, row)));
  } catch (err) {
    console.error('GET /api/parents error:', err.message);
  }
  res.json((db.get('parents') || []).map((row) => customerForRequest(req, row)));
});

// Get all students, with their groups and guardians attached.
app.get('/api/students', async (req, res) => {
  try {
    const [rows] = await readTables('students', 'enrollments', 'student_guardians');
    // A screen must never see a child with groups but no guardians, so the
    // enrichment always runs over the same in-memory snapshot.
    return res.json(db.withStudentRelations(rows).map((row) => customerForRequest(req, {
      ...row,
      registrationLifecycle: lifecycleSnapshotForStudent(db, row.id),
    })));
  } catch (err) {
    console.error('GET /api/students error:', err.message);
  }
  res.json(db.withStudentRelations(db.get('students')).map((row) => customerForRequest(req, {
    ...row,
    registrationLifecycle: lifecycleSnapshotForStudent(db, row.id),
  })));
});

function withGroupEnrollmentCounts(groups, students) {
  // Dedupe by id (local cache can accumulate duplicates after naive re-seeds).
  const byId = new Map();
  for (const g of groups || []) {
    if (g?.id) byId.set(g.id, g);
  }
  return enrichGroupsWithBotMeta(db, [...byId.values()]).map(g => ({
    ...g,
    enrolled: occupiedSeatIds(db, g.id).size,
    waitlistCount: waitlistEntriesForGroup(db, g.id).filter((entry) => entry.status === 'waiting').length,
  }));
}

// Get all groups (with live enrolled count computed from students).
app.get('/api/groups', async (req, res) => {
  try {
    const [rows, studentRows, enrollments] = await readTables('groups', 'students', 'enrollments');
    const students = enrichStudentsWithGroupIds(studentRows, enrollments);
    return res.json(withGroupEnrollmentCounts(rows, students));
  } catch (err) {
    console.error('GET /api/groups error:', err.message);
  }
  res.json(withGroupEnrollmentCounts(db.get('groups'), db.withStudentRelations(db.get('students'))));
});

app.get('/api/students/:id/registration-lifecycle', (req, res) => {
  const student = db.getOne('students', req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  return res.json(lifecycleSnapshotForStudent(db, student.id));
});

app.put('/api/students/:id/group-placement', async (req, res) => {
  if (req.crmUser?.role === 'staff' && !accessAtLeast(req.crmUser, 'classes', 'edit')) {
    return res.status(403).json({ error: 'נדרשת הרשאת עריכת חוגים לשינוי שיבוץ' });
  }
  const student = db.getOne('students', req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const groupsBefore = studentGroupIds(db.withStudentRelation(student));
  const hasPlacementMap = req.body?.placements && typeof req.body.placements === 'object' && !Array.isArray(req.body.placements);
  const mode = String(req.body?.mode || GROUP_PLACEMENT_MODE.NONE);
  const groupIds = [...new Set((Array.isArray(req.body?.groupIds) ? req.body.groupIds : [])
    .map((id) => String(id || '').trim()).filter(Boolean))];
  const groups = hasPlacementMap ? db.get('groups') : groupIds.map((id) => db.getOne('groups', id));
  if (groups.some((group) => !group)) {
    return res.status(404).json({ error: 'אחת הקבוצות שנבחרו אינה קיימת' });
  }
  const parent = student.parentId ? db.getOne('parents', student.parentId) : null;
  let result;
  try {
    result = await (hasPlacementMap ? setStudentGroupPlacements : setStudentGroupPlacement)({
      db,
      persist: persistCore,
      student,
      parent,
      groups,
      ...(hasPlacementMap ? { placements: req.body.placements } : { mode }),
      source: 'crm',
    });
  } catch (error) {
    console.error('group placement update failed:', error.message);
    return res.status(error.code === 'durable_write_failed' ? 503 : 500).json({
      error: error.code === 'durable_write_failed'
        ? 'השיבוץ לא נשמר במסד הנתונים. יש לרענן ולנסות שוב.'
        : 'שמירת השיבוץ נכשלה',
    });
  }
  if (!result.ok) {
    const errors = {
      invalid_placement_mode: 'סוג השיבוץ אינו תקין',
      group_required: 'יש לבחור לפחות קבוצה אחת',
      capacity_unknown: 'לא הוגדרה מכסה לקבוצה ולכן אי אפשר לשמור בה מקום',
      full: 'אין מקום פנוי באחת הקבוצות שנבחרו',
      student_already_holding: 'למתאמן כבר קיים מקום שמור בקבוצה אחרת',
    };
    return res.status(409).json({ ...result, error: errors[result.reason] || 'שמירת השיבוץ נכשלה' });
  }
  const updated = db.withStudentRelation(db.getOne('students', student.id));
  notifyGroupMembershipDiff({
    student: updated,
    before: groupsBefore,
    after: studentGroupIds(updated),
  }).catch((err) => console.error('group placement notify failed:', err.message));
  touchGoogleContacts();
  return res.json({
    ...result,
    student: updated,
    lifecycle: lifecycleSnapshotForStudent(db, student.id),
  });
});

app.put('/api/students/:id/group-placement/:groupId', async (req, res) => {
  if (req.crmUser?.role === 'staff' && !accessAtLeast(req.crmUser, 'classes', 'edit')) {
    return res.status(403).json({ error: 'נדרשת הרשאת עריכת חוגים לשינוי שיבוץ' });
  }
  const student = db.getOne('students', req.params.id);
  const group = db.getOne('groups', req.params.groupId);
  if (!student || !group) return res.status(404).json({ error: 'המתאמן או הקבוצה לא נמצאו' });
  const groupsBefore = studentGroupIds(db.withStudentRelation(student));
  const mode = String(req.body?.mode || GROUP_PLACEMENT_MODE.NONE);
  const placements = groupPlacementsForStudent(db, student);
  if (mode === GROUP_PLACEMENT_MODE.NONE) delete placements[String(group.id)];
  else placements[String(group.id)] = mode;
  try {
    const result = await setStudentGroupPlacements({
      db,
      persist: persistCore,
      student,
      parent: student.parentId ? db.getOne('parents', student.parentId) : null,
      groups: db.get('groups'),
      placements,
      source: 'crm_group_panel',
    });
    if (!result.ok) {
      const errors = {
        invalid_placement_mode: 'סוג השיבוץ אינו תקין',
        capacity_unknown: 'לא הוגדרה מכסה לקבוצה ולכן אי אפשר לשמור בה מקום',
        full: 'אין מקום פנוי בקבוצה',
      };
      return res.status(409).json({ ...result, error: errors[result.reason] || 'שמירת השיבוץ נכשלה' });
    }
    const updated = db.withStudentRelation(db.getOne('students', student.id));
    notifyGroupMembershipDiff({
      student: updated,
      before: groupsBefore,
      after: studentGroupIds(updated),
    }).catch((err) => console.error('single group placement notify failed:', err.message));
    touchGoogleContacts();
    return res.json({ ...result, student: updated, lifecycle: lifecycleSnapshotForStudent(db, student.id) });
  } catch (error) {
    console.error('single group placement update failed:', error.message);
    return res.status(error.code === 'durable_write_failed' ? 503 : 500).json({ error: 'שמירת השיבוץ נכשלה' });
  }
});

app.get('/api/groups/:id/waitlist', requireOwner, (req, res) => {
  const group = db.getOne('groups', req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  return res.json({
    group,
    capacity: capacityForGroup(db, group.id),
    entries: waitlistEntriesForGroup(db, group.id, { includeInactive: req.query.all === '1' }),
  });
});

app.post('/api/groups/:id/waitlist', requireOwner, async (req, res) => {
  const group = db.getOne('groups', req.params.id);
  const student = db.getOne('students', String(req.body?.studentId || ''));
  if (!group || !student) return res.status(404).json({ error: 'Group or student not found' });
  const parent = student.parentId ? db.getOne('parents', student.parentId) : null;
  const result = await joinGroupWaitlist({ db, persist: persistCore, group, student, parent, source: 'crm' });
  return res.status(result.ok ? 201 : 409).json(result);
});

app.delete('/api/groups/:id/waitlist/:studentId', requireOwner, async (req, res) => {
  const group = db.getOne('groups', req.params.id);
  const student = db.getOne('students', req.params.studentId);
  if (!group || !student) return res.status(404).json({ error: 'Group or student not found' });
  try {
    const result = await leaveGroupWaitlist({ db, persist: persistCore, group, student, source: 'crm' });
    return res.json(result);
  } catch (error) {
    console.error('waitlist removal failed:', error.message);
    return res.status(error.code === 'durable_write_failed' ? 503 : 500).json({ error: 'ההסרה מרשימת ההמתנה לא נשמרה' });
  }
});

app.post('/api/groups/:id/waitlist/offer-next', requireOwner, async (req, res) => {
  const group = db.getOne('groups', req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  const result = await offerNextWaitlistee({
    db,
    persist: persistCore,
    group,
    isEligible: (student, candidateGroup) => Boolean(student?.id)
      && canPlaceInRestrictedGroup(db, student, candidateGroup).allowed,
  });
  if (!result.ok) return res.status(409).json(result);
  try {
    await deliverRegistrationLifecycleMessage({
      kind: 'waitlist_offer',
      parent: result.parent,
      student: result.student,
      hold: result.hold,
      text: `התפנה מקום עבור ${result.student.name || 'המתאמן/ת'}. המקום שמור ל־24 שעות — תרצו להתקדם להרשמה?`,
    });
    return res.status(201).json(result);
  } catch (error) {
    await requeueUndeliveredWaitlistOffer({ db, persist: persistCore, hold: result.hold });
    return res.status(503).json({
      error: 'המקום לא הוצע כי לא ניתן היה לשלוח הודעה מאושרת ללקוח',
      reason: error.message,
    });
  }
});

app.post('/api/students/:id/waitlist/accept', requireOwner, async (req, res) => {
  const student = db.getOne('students', req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const result = await acceptWaitlistOffer({ db, persist: persistCore, student });
  return res.status(result.ok ? 200 : 409).json(result);
});

app.post('/api/students/:id/registration/parent-confirmation', requireOwner, async (req, res) => {
  const student = db.getOne('students', req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const result = await confirmParentRegistration({ db, persist: persistCore, student });
  return res.status(result.ok ? 200 : 409).json(result);
});

app.post('/api/students/:id/intro', requireOwner, async (req, res) => {
  const student = db.getOne('students', req.params.id);
  const group = db.getOne('groups', String(req.body?.groupId || ''));
  if (!student || !group) return res.status(404).json({ error: 'Student or group not found' });
  const parent = student.parentId ? db.getOne('parents', student.parentId) : null;
  const result = await createIntroBooking({
    db,
    persist: persistCore,
    student,
    parent,
    group,
    createPaymentLink: createIntroPaymentRequest,
  });
  return res.status(result.ok ? 201 : 409).json(result);
});

app.post('/api/students/:id/intro/continue', requireOwner, async (req, res) => {
  const student = db.getOne('students', req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const result = await continueAfterIntro({ db, persist: persistCore, student });
  return res.status(result.ok ? 200 : 409).json(result);
});

app.post('/api/placement-holds/:id/release', requireOwner, async (req, res) => {
  const hold = db.getOne(HOLD_COLLECTION, req.params.id);
  if (!hold) return res.status(404).json({ error: 'Placement hold not found' });
  const result = await releasePlacementHold({
    db,
    persist: persistCore,
    hold,
    reason: String(req.body?.reason || 'crm_manual_release'),
    nextStudentStatus: REGISTRATION_STATUS.DETAILS_COMPLETED,
  });
  return res.json(result);
});

app.get('/api/registration-lifecycle/dry-run', requireOwner, (_req, res) => {
  return res.json(migrationDryRun({
    students: db.withStudentRelations(db.get('students') || []),
    groups: db.get('groups') || [],
    centreChecks: db.get('centre_registration_checks') || [],
    waitlists: db.get(WAITLIST_COLLECTION) || [],
    introBookings: db.get(INTRO_COLLECTION) || [],
  }));
});

app.post('/api/registration-lifecycle/migrate', requireOwner, async (req, res) => {
  if (req.body?.approved !== true || req.body?.confirmation !== 'APPLY_REGISTRATION_LIFECYCLE_MIGRATION') {
    return res.status(400).json({ error: 'Explicit migration approval is required' });
  }
  const missingTemplates = Object.keys(LIFECYCLE_TEMPLATE_NAMES)
    .filter((kind) => !approvedLifecycleTemplate(db, kind));
  if (missingTemplates.length) {
    return res.status(409).json({
      error: 'WhatsApp lifecycle templates are not all approved',
      missingTemplates,
    });
  }
  const result = await applyRegistrationLifecycleMigration({
    db,
    persist: persistCore,
    allowMutation: true,
    sendLegacyWarning: ({ parent, student, hold }) => deliverRegistrationLifecycleMessage({
      kind: 'legacy_hold_warning',
      parent,
      student,
      hold,
      text: `עדכון: המקום של ${student.name || 'המתאמן/ת'} שמור לשלושה ימים. השלימו הרשמה במתנ״ס ואשרו לנו שנרשמתם כדי לשמור על השיבוץ.`,
    }),
  });
  return res.status(result.ok ? 200 : 409).json(result);
});

// Update student status
app.put('/api/students/:id/status', async (req, res) => {
  const { id } = req.params;
  const requested = String(req.body?.status || '').trim();
  const status = requested === 'health_signed' ? REGISTRATION_STATUS.DETAILS_COMPLETED : requested;
  if (!Object.values(REGISTRATION_STATUS).includes(status)) {
    return res.status(400).json({ error: 'סטטוס המתאמן אינו תקין' });
  }
  const current = db.getOne('students', id);
  if (!current) return res.status(404).json({ error: 'Student not found' });
  if (status === REGISTRATION_STATUS.REGISTERED) {
    const result = await markPlacementRegistered({
      db,
      persist: persistCore,
      student: current,
      source: 'crm_manual',
    });
    if (!result.ok) return res.status(409).json({ error: result.reason || 'Registration update failed' });
    automationsService.triggerEvent('status_changed', { ...result.student, new_status: status });
    touchGoogleContacts();
    return res.json({
      ...result.student,
      registrationLifecycle: lifecycleSnapshotForStudent(db, id),
    });
  }
  const hold = activeHoldForStudent(db, id);
  if (hold && ![
    REGISTRATION_STATUS.AWAITING_PARENT,
    REGISTRATION_STATUS.AWAITING_CENTRE,
    REGISTRATION_STATUS.INTRO_SCHEDULED,
  ].includes(status)) {
    await releasePlacementHold({
      db,
      persist: persistCore,
      hold,
      reason: 'manual_status_change',
      nextStudentStatus: status,
    });
  }
  const updated = db.update('students', id, { status });
  if (!updated) return res.status(404).json({ error: 'Student not found' });
  const durable = await persistCore('students', updated);
  if (durable?.ok === false) return res.status(503).json({ error: durable.error || 'Status was not saved' });
  
  // Trigger automation event
  automationsService.triggerEvent('status_changed', { ...updated, new_status: status });
  touchGoogleContacts();

  res.json({ ...updated, registrationLifecycle: lifecycleSnapshotForStudent(db, id) });
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
  console.log(`📥 Lead intake (${leadSource}): contact=${securityLogRef(phone)} children=${childList.length}`);

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
// קישור אחד וקבוע לכל הצוות: אותו קישור חוזר בכל טעינה של המסך, ומשרת כמה
// נקלטים שרוצים. `reset: true` מחליף את ה-nonce ובכך פוסל את הקישור הישן.
app.post('/api/employees/onboard-invite', async (req, res) => {
  try {
    const nonce = req.body?.reset
      ? await resetEmployeeOnboardInviteNonce()
      : await getEmployeeOnboardInviteNonce();
    res.status(201).json(issueEmployeeOnboardInvite({ nonce }));
  } catch (error) {
    res.status(503).json({ error: error.message || 'Employee onboarding signing is not configured' });
  }
});

function requireEmployeeOnboardInvite(req, res) {
  try {
    const invite = verifyEmployeeOnboardInvite(req.get('x-employee-onboard-token'));
    if (!invite) {
      res.status(403).json({ error: 'קישור הקליטה אינו תקף או שפג תוקפו' });
      return null;
    }
    return invite;
  } catch (error) {
    res.status(503).json({ error: error.message || 'Employee onboarding signing is not configured' });
    return null;
  }
}

app.get('/api/public/employee-onboard-fields', publicFormRateLimit, async (req, res) => {
  if (!requireEmployeeOnboardInvite(req, res)) return;
  try {
    const config = await getEmployeeOnboardConfig();
    res.json({
      fields: publicFieldDefs(config),
      docs: EMPLOYEE_ONBOARD_DOC_DEFS,
      form101Url: await getForm101Url(),
    });
  } catch (error) {
    console.error('employee-onboard-fields load error:', error.message);
    res.json({
      fields: publicFieldDefs(await getEmployeeOnboardConfig()),
      docs: EMPLOYEE_ONBOARD_DOC_DEFS,
      form101Url: '',
    });
  }
});

app.post('/api/public/employee-onboard', publicFormRateLimit, async (req, res) => {
  try {
    const invite = requireEmployeeOnboardInvite(req, res);
    if (!invite) return;
    const config = await getEmployeeOnboardConfig();
    const { employee, error } = buildEmployeeFromSubmission(req.body?.answers, config);
    if (error) return res.status(400).json({ error });
    // אסימון העלאה קצר-מועד: הקבצים נשלחים אחד-אחד אחרי שהכרטיס נוצר, כי
    // תמונות של תעודות מטלפון חורגות בקלות ממגבלת גוף הבקשה אם שולחים הכול יחד.
    employee.onboard_upload_token = crypto.randomUUID();
    employee.onboard_upload_expires = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    employee.onboard_invite_id = invite.inviteId;

    const created = db.insert('employees', employee);
    const durable = await persistCore('employees', created);
    if (!durable.ok) {
      console.error('employee onboarding durable write failed:', durable.error);
      db.delete('employees', created.id);
      return res.status(503).json({ error: 'שמירת הפרטים נכשלה — נסו שוב' });
    }
    res.status(201).json({ success: true, uploadToken: created.onboard_upload_token });
  } catch (error) {
    console.error('employee onboarding submit error:', error.message);
    res.status(500).json({ error: 'שמירת הפרטים נכשלה — נסו שוב' });
  }
});

/**
 * צירוף מסמך אחד על ידי העובד עצמו, מיד אחרי שליחת הטופס. קובץ אחד לבקשה,
 * ורק בחלון של שעתיים מרגע השליחה — האסימון אינו כניסה למערכת.
 */
app.post('/api/public/employee-onboard/documents', publicFormRateLimit, async (req, res) => {
  try {
    const { token, docType, fileBase64, fileName, mimeType } = req.body || {};
    if (!token || typeof token !== 'string') return res.status(400).json({ error: 'חסר אסימון העלאה' });

    const emp = (db.get('employees') || []).find((e) => e.onboard_upload_token === token);
    const expires = emp?.onboard_upload_expires ? Date.parse(emp.onboard_upload_expires) : 0;
    if (!emp || !expires || expires < Date.now()) {
      return res.status(403).json({ error: 'חלון ההעלאה נסגר — פנו לצוות כדי לשלוח את המסמך' });
    }

    const result = await storeEmployeeDocument(emp.id, { docType, fileBase64, fileName, mimeType });
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    res.json({ success: true });
  } catch (error) {
    console.error('employee onboarding document error:', error.message);
    res.status(500).json({ error: 'שמירת הקובץ נכשלה' });
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

// הקישור לאתר החיצוני שבו נחתם טופס 101. ריק = לא מוצג בסיום הטופס.
app.get('/api/settings/employee-onboard-form101', requireOwner, async (_req, res) => {
  try {
    res.json({ url: await getForm101Url() });
  } catch (error) {
    res.status(503).json({ error: error.message || 'טעינת הקישור נכשלה' });
  }
});

app.put('/api/settings/employee-onboard-form101', requireOwner, async (req, res) => {
  try {
    res.json({ url: await saveForm101Url(req.body?.url) });
  } catch (error) {
    res.status(400).json({ error: error.message || 'שמירת הקישור נכשלה' });
  }
});

// הגדרות שעון נוכחות / פתיחת קיר (דקות לפני שיבוץ + נוסח אישור)
app.get('/api/settings/staff-attendance', async (_req, res) => {
  try {
    res.json(await readStaffAttendanceSettings(db, supa));
  } catch (error) {
    res.status(500).json({ error: error.message || 'טעינת ההגדרות נכשלה' });
  }
});

app.put('/api/settings/staff-attendance', requireOwner, async (req, res) => {
  try {
    const saved = await writeStaffAttendanceSettings(db, supa, req.body || {});
    res.json(saved);
  } catch (error) {
    res.status(400).json({ error: error.message || 'שמירת ההגדרות נכשלה' });
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
    'gender',
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
          gender: updates.gender,
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

// A signed recipient link can only view or change mailing subscriptions. It is
// deliberately separate from the customer file and never exposes a phone, ID
// number, children or conversation history.
// קישור מקוצר להעדפות דיוור: קוד אקראי קבוע לכל לקוח, שממיר בעת לחיצה
// לטוקן חתום טרי ומפנה לעמוד. כך ההודעה בוואטסאפ נושאת קישור קצר ונקי.
const redirectMailingShortCode = (req, res) => {
  const parent = resolveMailingShortCode(req.params.code);
  const token = parent ? createMailingPreferenceToken(parent) : '';
  if (!token) return res.status(404).send('הקישור אינו תקף');
  return res.redirect(302, `${appPublicBase()}/mailing-preferences/${encodeURIComponent(token)}`);
};
app.get('/api/mp/:code', publicFormRateLimit, redirectMailingShortCode);
app.get('/mp/:code', publicFormRateLimit, redirectMailingShortCode);

app.get('/api/public/mailing-preferences/:token', publicFormRateLimit, (req, res) => {
  const resolved = readMailingPreferenceToken(req.params.token, {
    parents: db.get('parents') || [],
  });
  if (!resolved) return res.status(404).json({ error: 'הקישור אינו תקף או שפג תוקפו' });
  res.set('Cache-Control', 'no-store');
  return res.json(mailingPreferencesSnapshot(db, resolved.parent));
});

app.put('/api/public/mailing-preferences/:token', publicFormRateLimit, async (req, res) => {
  const resolved = readMailingPreferenceToken(req.params.token, {
    parents: db.get('parents') || [],
  });
  if (!resolved) return res.status(404).json({ error: 'הקישור אינו תקף או שפג תוקפו' });
  try {
    // Every save sent a confirmation, so a customer who ticked, untucked and
    // ticked again got three in two minutes — twice saying the opposite of
    // what they had just chosen. The confirmation belongs to a change.
    const before = mailingPreferencesSnapshot(db, resolved.parent);
    const snapshot = await updateMailingPreferences(
      db,
      resolved.parent,
      req.body?.subscriptions,
      {
        persistParent: (row) => persistCore('parents', row),
        persistList: (row) => persistCore('broadcast_lists', row),
      }
    );
    // אישור בוואטסאפ שההעדפות נשמרו — מנוסח לפי מה שנשאר פעיל. Best-effort:
    // אם חלון 24 השעות סגור, ההודעה פשוט לא תישלח והשמירה עצמה תקינה.
    try {
      const confirmation = mailingConfirmationMessage(snapshot);
      if (confirmation !== mailingConfirmationMessage(before)) {
        whatsappService.sendTextMessage(resolved.parent.phone, confirmation, false, {
          parentId: resolved.parent.id,
          source: 'mailing_preferences',
          clip: false,
        }).catch(() => {});
      }
    } catch { /* אישור הוא תוספת — לא מכשיל שמירה */ }
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, ...snapshot });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'שמירת ההעדפות נכשלה' });
  }
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
  // Old screens allowed sub-second values such as 800. Report the effective
  // safe value so the settings screen cannot present or resave that legacy
  // value even before somebody explicitly edits the field.
  branded.aiReplyDelayMs = normalizeInboundQuietMs(branded.aiReplyDelayMs);
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
 * What the bot left open: who is waiting for a person, which reminders are due,
 * and whose registration the מתנ״ס has not confirmed. Each of those lived in a
 * different collection and on no screen, so two customers waited a day and
 * nobody knew. Read-only — closing an item is done where it belongs.
 */
app.get('/api/bot/open-items', (req, res) => {
  res.json(botOpenItems(db));
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
  const values = req.body?.values;
  const invalidCapabilities = incoming !== undefined
    && (!incoming || typeof incoming !== 'object' || Array.isArray(incoming));
  const invalidValues = values !== undefined
    && (!values || typeof values !== 'object' || Array.isArray(values));
  if (invalidCapabilities || invalidValues) {
    return res.status(400).json({ error: 'חסרות הגדרות לעדכון' });
  }
  const patch = capabilitySettingsPatch({ capabilities: incoming, values });
  if (!Object.keys(patch).length) {
    return res.status(400).json({ error: 'לא נשלחה אף יכולת מוכרת' });
  }
  try {
    // saveSettings merges, so an untouched switch keeps its value.
    const saved = db.saveSettings({ ...db.getSettings(), ...patch });
    console.log(`🤖 Bot capabilities updated by actor=${securityLogRef(req.crmUser?.id || req.crmUser?.email)}`);
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
    console.log(`🤖 Bot auto-reply ${enabled ? 'enabled' : 'disabled'} by actor=${securityLogRef(req.crmUser?.id || req.crmUser?.email)}`);
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
  if (payload.aiReplyDelayMs !== undefined) {
    payload.aiReplyDelayMs = normalizeInboundQuietMs(payload.aiReplyDelayMs);
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
    return res.json({ configured, preferredModel, service: getAiServiceState(db) });
  }
  if (!configured) {
    return res.json({ configured, preferredModel, tested: true, ok: false, error: 'לא הוגדר מפתח מודל בשרת', service: getAiServiceState(db) });
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
        await probeGeminiService({ force: true });
        return res.json({ configured, preferredModel, tested: true, ok: true, model, testedAt: new Date().toISOString(), service: getAiServiceState(db) });
      }
      const body = await response.text().catch(() => '');
      lastError = `${model}: HTTP ${response.status} ${body.slice(0, 160)}`;
    } catch (err) {
      lastError = `${model}: ${err.message}`;
    }
  }
  await probeGeminiService({ force: true });
  res.json({ configured, preferredModel, tested: true, ok: false, error: lastError, service: getAiServiceState(db) });
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

// The file behind one message. The browser cannot put a Bearer token on an
// <img src>, so the panel fetches this and renders the blob — same as the
// document download routes.
app.get('/api/conversations/:parentId/media/:messageId', async (req, res) => {
  try {
    const result = await getConversationMedia(req.params.parentId, req.params.messageId);
    if (!result.success) {
      return res.status(result.status || 404).json({
        error: result.error,
        reason: result.reason || 'not_found',
      });
    }
    const filename = result.filename || `media.${result.mimeType.split('/')[1] || 'bin'}`;
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader(
      'Content-Disposition',
      // A document is something staff save; everything else is looked at in place.
      `${result.kind === 'document' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(result.buffer);
  } catch (err) {
    console.error('Error serving conversation media:', err);
    res.status(500).json({ error: err.message || 'שליפת הקובץ נכשלה' });
  }
});

// Blue ticks on the customer's phone, once the desk has the thread open.
app.post('/api/conversations/:parentId/read', async (req, res) => {
  try {
    const result = await markThreadRead(req.params.parentId);
    if (!result.success) return res.status(result.status || 400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
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

app.post('/api/conversations/:parentId/bot/continue', async (req, res) => {
  try {
    const result = await continueBotConversation(req.params.parentId, req.body || {});
    if (!result.success) return res.status(result.status || 400).json(result);
    res.json(result);
  } catch (err) {
    console.error('Manual bot continuation failed:', err);
    res.status(500).json({ success: false, error: err.message || 'הפעלת הבוט נכשלה' });
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
app.get('/api/message-templates', async (req, res) => {
  try {
    ensureEventWhatsappTemplates({
      db,
      persist: persistCore,
    });
    ensureOnboardingLinkTemplate({ db, persist: persistCore });
    ensureParticipationFormWhatsappTemplate({ db, persist: persistCore });
    ensureAgendaDigestTemplate({ db, persist: persistCore });
  } catch (err) {
    console.warn('event whatsapp templates ensure on list skipped:', err.message);
  }
  const approvedOnly = req.query.approved === '1' || req.query.approved === 'true';
  const includeArchived = req.query.archived === '1' || req.query.archived === 'true';
  const rows = approvedOnly ? listApprovedTemplates({ includeArchived }) : listLocalTemplates();
  // Which of these a staff member may send by hand from a customer card is a
  // setting, not a hardcoded list — every consumer of this route reads it off
  // the row so nobody has to fetch the setting separately.
  const manualNames = await loadManualTemplateNames().catch(() => DEFAULT_MANUAL_TEMPLATE_NAMES);
  // ומי שולח כל תבנית — הבוט, אוטומציה או אחד המסכים. נגזר כאן ולא נשמר, כדי
  // שתבנית שנותקה מאוטומציה תפסיק להיות מסומנת באותו רגע.
  res.json(withUsage(withManualSendFlag(rows, manualNames), {
    automations: db.get('automations') || [],
  }));
});

app.post('/api/message-templates/:id/manual-send', requireOwner, async (req, res) => {
  try {
    const template = (db.get('message_templates') || []).find((t) => t.id === req.params.id);
    if (!template) throw new Error('התבנית לא נמצאה');
    const names = await setManualTemplate(template, req.body?.enabled !== false);
    res.json({ success: true, names });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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

// תוכנית שליחה מלאה: קהל מאוחד לפי טלפון, חסימות עם סיבות, עלות, שעות שקטות
// ותצוגות מקדימות עם נתוני נמענים אמיתיים. אותה פונקציה בדיוק רצה גם בשליחה.
app.post('/api/broadcast/plan', (req, res) => {
  try {
    const body = req.body || {};
    const plan = buildBroadcastPlan({
      filters: body.filters || {},
      templateId: body.templateId || null,
      customMessage: body.customMessage || '',
      listKey: body.listKey || '',
      overrides: Array.isArray(body.overrides) ? body.overrides : [],
      recencyDays: body.recencyDays,
      capHours: body.capHours,
      sampleOffset: Number(body.sampleOffset) || 0,
      sampleLimit: Math.min(Number(body.sampleLimit) || 12, 50),
    });
    // The full eligible list stays server-side; the client gets counts + samples.
    const { eligible, ...rest } = plan;
    res.json(rest);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// מכסת Meta: רמת המכסה ודירוג האיכות מה-API, וניצול חלון 24ש מהיומן המקומי.
app.get('/api/broadcast/quota', async (req, res) => {
  try {
    res.json(await getMetaQuota({ force: req.query.refresh === '1' }));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/broadcast/defaults', (_req, res) => {
  res.json(getBroadcastDefaults());
});

app.post('/api/broadcast/defaults', requireOwner, (req, res) => {
  try {
    res.json(saveBroadcastDefaults(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/broadcast/jobs', requireOwner, async (req, res) => {
  try {
    const result = await startBroadcastJob(req.body || {}, { user: req.crmUser });
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    if (err.quiet) {
      return res.status(409).json({ error: err.message, quiet: err.quiet });
    }
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

app.post('/api/broadcast/jobs/:id/cancel', requireOwner, (req, res) => {
  const result = cancelBroadcastJob(req.params.id);
  if (result.error) return res.status(result.status || 400).json(result);
  res.json(result);
});

app.post('/api/broadcast/jobs/:id/pause', requireOwner, (req, res) => {
  const result = pauseBroadcastJob(req.params.id);
  if (result.error) return res.status(result.status || 400).json(result);
  res.json(result);
});

app.post('/api/broadcast/jobs/:id/resume', requireOwner, (req, res) => {
  const result = resumeBroadcastJob(req.params.id);
  if (result.error) return res.status(result.status || 400).json(result);
  res.json(result);
});

app.post('/api/broadcast/jobs/:id/resend-failed', requireOwner, (req, res) => {
  try {
    const { job, eligibleCount, undoSeconds } = resendFailedRecipients(req.params.id, { user: req.crmUser });
    res.json({ success: true, jobId: job.id, recipientCount: eligibleCount, undoSeconds });
  } catch (err) {
    if (err.quiet) return res.status(409).json({ error: err.message, quiet: err.quiet });
    res.status(400).json({ error: err.message });
  }
});

// שליחת בדיקה: ההודעה כפי שתישלח באמת, עם נתוני נמען אמיתי, למספר שבחרת.
app.post('/api/broadcast/test-send', requireOwner, async (req, res) => {
  try {
    res.json(await sendBroadcastTest(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// היסטוריית הדיוורים של לקוח — לכרטיס הלקוח.
app.get('/api/parents/:id/broadcasts', (req, res) => {
  res.json(parentBroadcastHistory(req.params.id));
});

// שליחת הקישור האישי להעדפות דיוור מכרטיס הלקוח — בלחיצה אחת, כשלקוח
// מבקש הסרה בטלפון או בדלפק. הודעה חופשית, ולכן דורשת חלון 24 שעות פתוח.
app.post('/api/parents/:id/send-mailing-link', requireOwner, async (req, res) => {
  const parent = (db.get('parents') || []).find((p) => p.id === req.params.id);
  if (!parent) return res.status(404).json({ error: 'הלקוח לא נמצא' });
  if (!parent.phone) return res.status(400).json({ error: 'אין מספר טלפון בכרטיס' });
  const link = shortMailingPreferencesUrl(parent);
  if (!link) return res.status(500).json({ error: 'יצירת הקישור נכשלה' });
  const firstName = String(parent.name || '').trim().split(/\s+/)[0];
  const message = [
    `היי${firstName ? ` ${firstName}` : ''},`,
    'בקישור האישי הזה אפשר לבחור אילו עדכונים לקבל מאיתנו — או להסיר הכל:',
    link,
    'השינוי נשמר מיידית, ואפשר לחזור ולעדכן בכל זמן.',
  ].join('\n');
  const result = await whatsappService.sendTextMessage(parent.phone, message, false, {
    parentId: parent.id,
    source: 'mailing_preferences',
    clip: false,
  });
  if (!result.success) {
    return res.status(400).json({
      error: `${result.error || 'השליחה נכשלה'} — הודעה חופשית עוברת רק כשחלון 24 השעות פתוח`,
    });
  }
  res.json({ success: true, link });
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
      console.error(`Failed to send broadcast to contact=${securityLogRef(parent.phone)}:`, err.message);
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
      // A staff alert that Meta accepted and then rejected was still written to
      // the journal as sent. Reopen it, so the next scan tries again.
      if (st.status === 'failed') noteStaffAlertFailure(st.id);
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
      console.log(`💬 Processing WhatsApp message: contact=${securityLogRef(phone)} type=${message.type || 'text'}`);
      const leadResult = await whatsappService.handleIncomingMessage(phone, text || `[${message.type || 'media'}]`, false, {
        messageId: message.id,
        type: message.type,
        timestamp: message.timestamp,
        mediaRef: whatsappConnectService.extractMediaRef(message),
      });
      if (leadResult?.durableError) {
        notPersisted.push({ messageId: message.id, error: leadResult.durableError });
      }
      if (leadResult?.parent) {
        console.log(
          `🎉 WhatsApp lead ${leadResult.isNew ? 'created' : 'updated'}: parent=${leadResult.parent.id} contact=${securityLogRef(phone)}${leadResult.student ? ` student=${leadResult.student.id}` : ' (contact only)'}`
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
      console.log(`📱 Phone echo: contact=${securityLogRef(phone)} type=${echo.type || 'text'}`);
      await whatsappService.handlePhoneEcho({
        phone,
        text,
        messageId: echo.id,
        type: echo.type,
        mediaRef: whatsappConnectService.extractMediaRef(echo),
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
              mediaRef: whatsappConnectService.extractMediaRef(message),
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
            mediaRef: whatsappConnectService.extractMediaRef(message),
          });
        }
      }
    }
  }

  if (field === 'account_update') {
    console.log('ℹ️ WhatsApp account_update webhook received');
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
  console.log('📥 Received WhatsApp/Meta webhook', {
    object: body?.object || null,
    entries: Array.isArray(body?.entry) ? body.entry.length : 0,
  });

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
  const webhookSummary = {
    object: body?.object || null,
    entries: Array.isArray(body?.entry) ? body.entry.length : 0,
    fields: [...new Set((body?.entry || []).flatMap((entry) => (
      (entry?.changes || []).map((change) => String(change?.field || '')).filter(Boolean)
    )))],
  };
  console.log('📥 Received Instagram webhook', webhookSummary);

  try {
    // Store in persistent log array for inspection (keep last 50)
    const logs = db.get('webhook_logs') || [];
    const webhookLog = {
      id: `webhook-${Date.now()}`,
      timestamp: new Date().toISOString(),
      summary: webhookSummary,
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
app.post('/api/automations/run-scheduled', requireCronSecret, async (req, res) => {
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
    console.log(`🧠 AI assistant settings updated by actor=${securityLogRef(req.crmUser?.id || req.crmUser?.email)}`);
    res.json(saved);
  } catch (err) {
    if (!err.status) console.error('save assistant settings error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/ai/suggestions/:id/approve', async (req, res) => {
  try {
    const suggestion = suggestionRows(db).find((row) => String(row.id) === String(req.params.id));
    if (!suggestion) return res.status(404).json({ error: 'ההצעה לא נמצאה' });
    const activity = suggestion.type === 'register_to_activity'
      ? (db.get('activities') || []).find(
          (row) => String(row.id) === String(suggestion.args?.activity_id)
        )
      : null;
    assertAiSuggestionApprovalAccess(req.crmUser, suggestion, activity);
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
      items: withBotReplies(db, listFeedback(db, status ? { status } : {})),
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

function aiToolsForRequest(req) {
  if (req.crmUser?.role === 'owner') return READ_TOOLS;
  const tools = {};
  const finance = hasSensitiveAccess(req.crmUser, 'finance');
  if (accessAtLeast(req.crmUser, 'customers')) {
    tools.search_customers = READ_TOOLS.search_customers;
    tools.get_customer = (database, args) => {
      const result = READ_TOOLS.get_customer(database, args);
      if (finance || result?.error) return result;
      return {
        ...result,
        payments: (result.payments || []).map((payment) => ({
          status: payment.status,
          paid_at: payment.paid_at,
          description: payment.description,
        })),
      };
    };
  }
  if (accessAtLeast(req.crmUser, 'attendance') || accessAtLeast(req.crmUser, 'classes')) {
    tools.get_student_attendance = READ_TOOLS.get_student_attendance;
  }
  if (accessAtLeast(req.crmUser, 'classes')) tools.list_groups = READ_TOOLS.list_groups;
  if (accessAtLeast(req.crmUser, 'activities')) {
    tools.list_activities = (database, args) => omitFields(
      READ_TOOLS.list_activities(database, args),
      finance ? new Set() : new Set(['price'])
    );
    tools.get_activity = (database, args) => omitFields(
      READ_TOOLS.get_activity(database, args),
      finance ? new Set() : new Set(['price'])
    );
  }
  if (accessAtLeast(req.crmUser, 'dashboard') || accessAtLeast(req.crmUser, 'assistant')) {
    tools.list_tasks = READ_TOOLS.list_tasks;
    tools.business_snapshot = (database, args) => omitFields(
      READ_TOOLS.business_snapshot(database, args),
      finance ? new Set() : new Set(['paid_this_month'])
    );
  }
  if (finance) tools.list_payments = READ_TOOLS.list_payments;
  return tools;
}

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
      readTools: aiToolsForRequest(req),
      // The staged action catalogue mixes ordinary tasks with financial
      // registrations. Until proposals are split by capability, team users
      // get a read-only assistant so no role can cross its permission boundary.
      allowActions: req.crmUser?.role === 'owner',
      extraRules: hasSensitiveAccess(req.crmUser, 'finance')
        ? ''
        : 'אין להציג סכומי תשלום, הכנסות, עלויות אירוע, רווחיות או מידע פיננסי היסטורי.',
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
  await splitExplicitHousehold(db, persistCore, {
    parentIds: snapshot.parents.map((parent) => parent.id),
    assignments,
  });

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
  await ensureHouseholdForParent(db, persistCore, req.params.id);

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

  // Read before anything moves: the trainers are told what changed, and the
  // only place that knows the previous groups is the record as it is now.
  const groupsBefore = studentGroupIds(db.withStudentRelation(db.getOne('students', id)));

  const hasGroupIds = Object.prototype.hasOwnProperty.call(body, 'groupIds');
  const hasAdd = Object.prototype.hasOwnProperty.call(body, 'addGroupId');
  const hasRemove = Object.prototype.hasOwnProperty.call(body, 'removeGroupId');
  const hasGroupId = Object.prototype.hasOwnProperty.call(body, 'groupId');
  const hasMembershipUpdate = hasAdd || hasRemove || hasGroupIds || hasGroupId;

  if (req.crmUser?.role === 'staff') {
    if (hasMembershipUpdate && !accessAtLeast(req.crmUser, 'classes', 'edit')) {
      return res.status(403).json({ error: 'נדרשת הרשאת עריכת חוגים לשינוי שיוך לקבוצה' });
    }
    if (Object.keys(rest).length && !accessAtLeast(req.crmUser, 'customers', 'edit')) {
      return res.status(403).json({ error: 'נדרשת הרשאת עריכת לקוחות לשינוי פרטי מתאמן' });
    }
  }

  const unsupportedFields = unsupportedStudentEditFields(rest);
  if (unsupportedFields.length) {
    return res.status(400).json({ error: 'הבקשה כוללת שדות מתאמן שאינם ניתנים לעריכה' });
  }

  // Strip membership fields from a plain field update; they are handled below.
  const fieldUpdates = { ...rest };
  if (fieldUpdates.status === 'health_signed') {
    fieldUpdates.status = REGISTRATION_STATUS.DETAILS_COMPLETED;
  }
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
  if (Object.prototype.hasOwnProperty.call(fieldUpdates, 'status')) {
    if (fieldUpdates.status === REGISTRATION_STATUS.REGISTERED) {
      const registered = await markPlacementRegistered({
        db,
        persist: persistCore,
        student: db.getOne('students', id),
        source: 'crm_edit',
      });
      if (!registered.ok) return res.status(409).json({ error: registered.reason || 'Registration update failed' });
      updated = db.withStudentRelation(registered.student);
    } else {
      const hold = activeHoldForStudent(db, id);
      if (hold && ![
        REGISTRATION_STATUS.AWAITING_PARENT,
        REGISTRATION_STATUS.AWAITING_CENTRE,
        REGISTRATION_STATUS.INTRO_SCHEDULED,
      ].includes(fieldUpdates.status)) {
        await releasePlacementHold({
          db,
          persist: persistCore,
          hold,
          reason: 'crm_edit_status_change',
          nextStudentStatus: fieldUpdates.status,
        });
        updated = db.withStudentRelation(db.getOne('students', id));
      }
    }
  }
  // Same race as parent edit: refresh right after save must see the new fields.
  const durable = await persistCore('students', updated);
  if (durable?.ok === false) {
    return res.status(503).json({ error: durable.error || 'העדכון לא נשמר' });
  }
  // Only after the change is durable — a trainer told about a move that failed
  // to save is worse than a trainer told a minute later.
  notifyGroupMembershipDiff({
    student: updated,
    before: groupsBefore,
    after: studentGroupIds(updated),
  }).catch((err) => console.error('group membership notify failed:', err.message));
  touchGoogleContacts();
  res.json(updated);
});

// ─── Training equipment ──────────────────────────────────────────────────────
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
  // The settings screen is the source of truth, but older/stale clients may
  // submit only the fields they know about. Preserve omitted saved fields so a
  // partial payload can never silently erase prices or the owner's wording.
  const read = await supa.readAppSetting('equipment_settings');
  if (!read.ok) {
    throw new Error(read.error || 'קריאת הגדרות הציוד הקיימות נכשלה');
  }
  const current = read.configured ? read.value : (db.getSettings?.()?.equipment_settings || {});
  const merged = mergeEquipmentSettingsPatch(current, next);
  const normalized = normalizeEquipmentSettings(merged);
  if (normalized.cancellation_policy_id) {
    const selectedPolicy = currentPolicyVersion(db, normalized.cancellation_policy_id);
    if (!selectedPolicy || selectedPolicy.policy.status !== 'published') {
      throw new Error('מדיניות הביטול שנבחרה אינה מפורסמת');
    }
    if (selectedPolicy.snapshot.basis !== 'usage') {
      throw new Error('מדיניות ביטול לציוד חייבת להיות מחושבת לפי ניצול');
    }
  }
  const result = await supa.setAppSetting('equipment_settings', normalized);
  if (result?.ok === false) {
    throw new Error(result.error || 'שמירת הגדרות הציוד נכשלה');
  }
  return normalized;
}

/**
 * מחיר הנעליים לחצי העונה הנוכחי: מחיר הבסיס נבחר לפי כמה אימונים בשבוע יש
 * למתאמן, ומקוזז לפי תאריך ההצטרפות כפי שהוא עולה מרשימת הנוכחות שלו.
 */
async function shoesPricingForStudent(studentId, settings) {
  await refreshAttendanceCache();
  // התדירות נגזרת מהקבוצות הפעילות, ולכן שלוש הטבלאות האלה חייבות להיות
  // טעונות לפני החישוב — אחרת מתאמן פעמיים בשבוע מתומחר כפעם בשבוע.
  await readTables('enrollments', 'groups', GROUP_META_COLLECTION);
  const attendance = (db.get('attendance') || []).filter(
    (row) => row && row.student_id === studentId
  );
  const weeklySessions = weeklySessionsForStudent({ db, studentId });
  return shoesSeasonPricing({ settings, attendance, weeklySessions });
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
    await readTable('student_equipment');
    let student = db.getOne('students', req.params.id);
    if (!student && supa.isEnabled()) {
      // Only a card we have never seen justifies waiting for a durable read.
      const remote = await supa.getAll('students');
      if (remote && typeof db.set === 'function') db.set('students', remote);
      student = db.getOne('students', req.params.id);
    }
    if (!student) return res.status(404).json({ error: 'המתאמן לא נמצא' });
    if (!isEquipmentEligibleStudent(student)) {
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
    await readTable('student_equipment');
    const settings = await loadEquipmentSettings();
    let [students, parents, groups, enrollments, payments] = await readTables(
      'students',
      'parents',
      'groups',
      'enrollments',
      // חיוב ההפרש נגזר מהתדירות שצולמה על התשלום, ומימי האימון של הקבוצות.
      'payments',
      GROUP_META_COLLECTION
    );
    students = supa.isEnabled()
      ? enrichStudentsWithGroupIds(students, enrollments)
      : db.withStudentRelations(students);

    const groupId = req.query.groupId ? String(req.query.groupId) : '';
    const filter = String(req.query.filter || 'gaps'); // gaps | unpaid | awaiting | all
    const trainees = students.filter(
      (s) => isEquipmentEligibleStudent(s) && s.status !== 'archived' && (!groupId || studentInGroup(s, groupId))
    );

    const parentById = new Map(parents.map((p) => [p.id, p]));
    const groupById = new Map(groups.map((g) => [g.id, g]));
    // מסננים את התשלומים פעם אחת לכל מתאמן; אחרת כל שורה סורקת את כל הטבלה.
    const equipmentPaymentsByStudent = new Map();
    for (const payment of payments) {
      if (!payment || payment.status !== 'paid') continue;
      if (!payment.equipment_payment && !payment.equipment_shoes_upgrade) continue;
      const ids = new Set();
      if (payment.student_id) ids.add(String(payment.student_id));
      for (const allocation of payment.equipment_allocations || []) {
        if (allocation?.student_id) ids.add(String(allocation.student_id));
      }
      for (const id of ids) {
        if (!equipmentPaymentsByStudent.has(id)) equipmentPaymentsByStudent.set(id, []);
        equipmentPaymentsByStudent.get(id).push(payment);
      }
    }
    const rows = [];

    for (const student of trainees) {
      const items = ensureStudentEquipment({ db, student, persist: persistCore });
      const baseGaps = equipmentGapFlags(items);
      const upgrade = shoesUpgradeQuote({
        settings,
        shoesRow: items.find((item) => item.item_type === 'shoes') || null,
        payments: equipmentPaymentsByStudent.get(String(student.id)) || [],
        weeklySessions: weeklySessionsForStudent({ db, studentId: student.id, student }),
      });
      // הפרש שלא נגבה הוא חוסר לכל דבר, ולכן הוא נכנס ללשונית „חסר משהו”.
      const gaps = {
        ...baseGaps,
        hasUpgrade: upgrade.eligible,
        hasGap: baseGaps.hasGap || upgrade.eligible,
      };
      if (filter === 'unpaid' && !gaps.hasUnpaid) continue;
      if (filter === 'awaiting' && !gaps.hasAwaitingHandoff) continue;
      if (filter === 'gaps' && !gaps.hasGap) continue;
      const parent = parentById.get(student.parentId) || null;
      const group = groupById.get(student.groupId) || null;
      rows.push({
        student_id: student.id,
        student_name: student.name,
        is_adult: !isKidStudent(student),
        parent_id: parent?.id || student.parentId || null,
        parent_name: parent?.name || '',
        parent_phone: parent?.phone || '',
        group_id: group?.id || student.groupId || null,
        group_name: group?.name || '',
        items,
        gaps,
        shoes_upgrade: upgrade.eligible ? upgrade : null,
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
    if (
      req.body?.payment_status !== undefined
      && !canClearPaidEquipmentStatus(
        row.payment_status,
        req.body.payment_status,
        hasSensitiveAccess(req.crmUser, 'finance')
      )
    ) {
      return res.status(403).json({ error: 'נדרשת הרשאת כספים כדי לבטל סימון תשלום קיים' });
    }
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
    const row = db.getOne('student_equipment', req.params.id);
    if (!row) return res.status(404).json({ error: 'פריט הציוד לא נמצא' });
    if (!canClearPaidEquipmentStatus(row.payment_status, 'own', hasSensitiveAccess(req.crmUser, 'finance'))) {
      return res.status(403).json({ error: 'נדרשת הרשאת כספים כדי לבטל סימון תשלום קיים' });
    }
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
    const row = db.getOne('student_equipment', req.params.id);
    if (!row) return res.status(404).json({ error: 'פריט הציוד לא נמצא' });
    if (!canClearPaidEquipmentStatus(row.payment_status, 'declined', hasSensitiveAccess(req.crmUser, 'finance'))) {
      return res.status(403).json({ error: 'נדרשת הרשאת כספים כדי לבטל סימון תשלום קיים' });
    }
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
    const row = db.getOne('student_equipment', req.params.id);
    if (!row) return res.status(404).json({ error: 'פריט הציוד לא נמצא' });
    if (!canClearPaidEquipmentStatus(row.payment_status, 'unpaid', hasSensitiveAccess(req.crmUser, 'finance'))) {
      return res.status(403).json({ error: 'נדרשת הרשאת כספים כדי לבטל סימון תשלום קיים' });
    }
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
    if (!isEquipmentEligibleStudent(student)) {
      return res.status(400).json({ error: 'כרטיס המתאמן אינו זכאי לציוד' });
    }
    const sendWhatsapp = req.body?.sendWhatsapp !== false;
    const parent = chooseRecipientParent(db.get('parents') || [], {
      guardianIds: guardianParentIds(db, student),
      primaryParentId: student.parentId,
      preferredParentId: req.body?.preferredParentId,
    });
    if (!parent) {
      return res.status(400).json({ error: 'לא נמצא משלם בתיק המשפחה' });
    }
    if (sendWhatsapp && !parent.phone) {
      return res.status(400).json({ error: 'חסר טלפון להורה — אי אפשר לשלוח קישור' });
    }

    const familyMembers = expandHousehold(db, parent.id).students.filter(
      (member) => isEquipmentEligibleStudent(member) && member.status !== 'archived'
    );
    familyMembers.forEach((member) => ensureStudentEquipment({ db, student: member, persist: persistCore }));
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
          `לתשלום ציוד האימונים של המשפחה:\n\n` +
          `${publicPageUrl}\n\n` +
          `בקישור אפשר לבחור את המתאמנים ואת הציוד לכל אחד מהם, ולשלם פעם אחת.`;
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
            [parent.name || 'הורה', 'המשפחה'],
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

/** הצעת חיוב ההפרש למתאמן אחד, על נתונים טריים. */
async function shoesUpgradeForStudent(student, settings) {
  await refreshStudentEquipmentCache();
  const [payments] = await readTables('payments', 'enrollments', 'groups', GROUP_META_COLLECTION);
  const items = ensureStudentEquipment({ db, student, persist: persistCore });
  return shoesUpgradeQuote({
    settings,
    shoesRow: items.find((item) => item.item_type === 'shoes') || null,
    payments,
    weeklySessions: weeklySessionsForStudent({ db, studentId: student.id, student }),
  });
}

app.get('/api/students/:id/equipment/shoes-upgrade', async (req, res) => {
  try {
    const student = db.getOne('students', req.params.id);
    if (!student) return res.status(404).json({ error: 'המתאמן לא נמצא' });
    const settings = await loadEquipmentSettings();
    res.json(await shoesUpgradeForStudent(student, settings));
  } catch (err) {
    console.error('shoes upgrade quote error:', err.message);
    res.status(500).json({ error: err.message || 'חישוב ההפרש נכשל' });
  }
});

/**
 * קישור תשלום על הפרש דמי ההשכרה בלבד.
 *
 * לא עובר דרך דף הציוד הציבורי: שם בוחרים פריטים שטרם שולמו, והנעליים כאן
 * כבר שולמו. זהו חיוב יחיד בסכום קבוע, ולכן קישור סליקה ישיר.
 */
app.post('/api/students/:id/equipment/shoes-upgrade-link', async (req, res) => {
  try {
    if (!icount.isConfigured()) {
      return res.status(503).json({ error: 'מערכת החיוב לא מוגדרת בשרת' });
    }
    const student = db.getOne('students', req.params.id);
    if (!student) return res.status(404).json({ error: 'המתאמן לא נמצא' });

    // כסף — לכן ההגדרות חייבות להגיע מהמקור הקבוע, בלי נפילה לברירות מחדל.
    const settings = await loadEquipmentSettingsForCharge();
    const quote = await shoesUpgradeForStudent(student, settings);
    if (!quote.eligible) {
      return res.status(400).json({ error: quote.reason || 'אין הפרש לגבות', quote });
    }

    const sendWhatsapp = req.body?.sendWhatsapp !== false;
    const parent = chooseRecipientParent(db.get('parents') || [], {
      guardianIds: guardianParentIds(db, student),
      primaryParentId: student.parentId,
      preferredParentId: req.body?.preferredParentId,
    });
    if (!parent) return res.status(400).json({ error: 'לא נמצא משלם בתיק המשפחה' });
    if (sendWhatsapp && !parent.phone) {
      return res.status(400).json({ error: 'חסר טלפון להורה — אי אפשר לשלוח קישור' });
    }

    const includesVat = normalizePriceIncludesVat(settings.price_includes_vat, true);
    const amount = chargeAmount(quote.amount, includesVat);
    const description = describeShoesUpgrade(quote, student.name);

    // קישור פתוח שכבר נוצר לאותו הפרש נשלח שוב, כדי שלא ייפתחו שני חיובים.
    const existing = (db.get('payments') || []).find(
      (payment) =>
        payment.status === 'pending' &&
        payment.equipment_shoes_upgrade &&
        String(payment.student_id) === String(student.id) &&
        Number(payment.amount) === amount &&
        payment.payment_url
    );
    if (existing) {
      return res.json({ success: true, reused: true, paymentUrl: existing.payment_url, amount, description, quote });
    }

    const payment = db.insert('payments', {
      parent_id: parent.id,
      student_id: student.id,
      amount,
      price_includes_vat: includesVat,
      description,
      status: 'pending',
      payment_url: null,
      paid_at: null,
      // לא equipment_payment: אין כאן פריט לסמן „שולם”, הפריט כבר שולם.
      // הדגל הזה הוא מה ש-paidWeeklySessions קורא כדי לדעת שההפרש נסגר.
      equipment_shoes_upgrade: true,
      equipment_upgrade_from_sessions: quote.from_sessions,
      equipment_upgrade_to_sessions: quote.to_sessions,
      equipment_upgrade_quote: quote,
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
    });

    const updatedPayment = db.update('payments', payment.id, {
      payment_url: paymentUrl,
      updated_at: new Date().toISOString(),
    }) || payment;
    await persistCore('payments', updatedPayment);

    let whatsappSent = false;
    let whatsappError = null;
    if (sendWhatsapp) {
      if (canSendFreeform(parent, 'whatsapp')) {
        const msg =
          `שלום ${parent.name || ''},\n` +
          `${student.name} עבר/ה ל${quote.to_label} באמצע תקופת השכרת הנעליים.\n` +
          `נותר לשלם את ההפרש על התקופה שנותרה בלבד — ${amount} ₪:\n\n${paymentUrl}`;
        try {
          const waResult = await whatsappService.sendTextMessage(normalizePhone(parent.phone), msg, false, {
            parentId: parent.id,
            fallbackName: parent.name,
          });
          whatsappSent = !!waResult?.success;
          if (!whatsappSent) whatsappError = waResult?.error || 'שליחת הודעה נכשלה';
        } catch (waErr) {
          whatsappError = waErr.message || 'שליחת הודעה נכשלה';
        }
      } else {
        whatsappError = 'חלון 24 השעות סגור — העתיקו את הקישור ידנית';
      }
    }

    res.json({ success: true, paymentUrl, amount, description, quote, whatsappSent, whatsappError });
  } catch (err) {
    console.error('shoes upgrade link error:', err.message);
    res.status(500).json({ error: err.message || 'יצירת קישור ההפרש נכשלה' });
  }
});

app.get('/api/public/equipment/:token', publicFormRateLimit, async (req, res) => {
  try {
    const checkout = await resolveEquipmentCheckout(req.params.token);
    if (!checkout) return res.status(404).json({ error: 'קישור התשלום לא נמצא' });
    if (checkout.expires_at && new Date(checkout.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ error: 'פג תוקף הקישור — בקשו קישור חדש מהצוות' });
    }

    // The family's page re-asks every couple of seconds while it waits for a
    // payment to land; that payment is written by this same process, so the
    // in-memory copy is already current and a durable read would only add lag.
    await readTable('student_equipment');
    const payload = await buildPublicEquipmentPayload(checkout);
    if (!payload) return res.status(404).json({ error: 'לא נמצאו מתאמנים פעילים בתיק המשפחה' });
    res.json(payload);
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
 * This applies to every item, including shoes: some trainees already bring
 * their own pair and must not be charged for a club rental.
 *
 * `owned: false` is the matching undo. The payment page deliberately keeps an
 * owned row visible so a parent who tapped the pill by mistake can put the item
 * back into the checkout, including after a refresh.
 */
app.post('/api/public/equipment/:token/own', publicFormRateLimit, async (req, res) => {
  try {
    const checkout = await resolveEquipmentCheckout(req.params.token);
    if (!checkout) return res.status(404).json({ error: 'קישור התשלום לא נמצא' });
    if (checkout.expires_at && new Date(checkout.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ error: 'פג תוקף הקישור — בקשו קישור חדש מהצוות' });
    }
    await refreshStudentEquipmentCache();
    const family = await resolveEquipmentFamily(checkout);
    const studentId = String(req.body?.studentId || checkout.student_id || '');
    const student = family.members.find((member) => String(member.id) === studentId);
    if (!student) {
      return res.status(404).json({ error: 'המתאמן לא נמצא' });
    }

    const wanted = Array.isArray(req.body?.itemTypes)
      ? req.body.itemTypes.map((t) => String(t || '').trim())
      : [];
    const allowed = wanted.filter((t) => equipmentItemTypesForStudent(student).includes(t));
    if (!allowed.length) {
      return res.status(400).json({ error: 'בחרו לפחות פריט אחד שכבר יש למתאמן' });
    }

    const items = ensureStudentEquipment({ db, student, persist: persistCore });
    const shouldOwn = req.body?.owned !== false;
    const updated = [];
    for (const type of allowed) {
      const row = items.find((i) => i.item_type === type);
      if (!row) continue;
      // Never overwrite something already paid for — that is a real payment.
      // Undo is narrower still: only the "own" state created by this action may
      // be restored to unpaid.
      if (shouldOwn && row.payment_status === 'paid') continue;
      if (!shouldOwn && row.payment_status !== 'own') continue;
      const result = shouldOwn
        ? markEquipmentOwn({ db, persist: persistCore, rowId: row.id })
        : markEquipmentUnpaid({ db, persist: persistCore, rowId: row.id });
      if (result.ok) updated.push(type);
    }
    if (!updated.length) {
      return res.status(400).json({
        error: shouldOwn ? 'לא נמצאו פריטים לסימון' : 'לא נמצאו פריטים לביטול הסימון',
      });
    }

    const payload = await buildPublicEquipmentPayload(checkout);
    res.json({
      ok: true,
      marked: shouldOwn ? updated : [],
      unmarked: shouldOwn ? [] : updated,
      ...payload,
    });
  } catch (err) {
    console.error('public equipment own error:', err.message);
    res.status(503).json({ error: err.message || 'סימון הציוד נכשל' });
  }
});

async function createFamilyEquipmentPayment(req, res, checkout) {
  const { parent, members } = await resolveEquipmentFamily(checkout);
  if (!parent || !members.length) {
    return res.status(404).json({ error: 'לא נמצאו מתאמנים פעילים בתיק המשפחה' });
  }
  const settings = await loadEquipmentSettingsForCharge();
  const byId = new Map(members.map((student) => [String(student.id), student]));
  const requestedByStudent = new Map();
  for (const entry of req.body.allocations) {
    const studentId = String(entry?.studentId || entry?.student_id || '');
    if (!studentId || requestedByStudent.has(studentId)) continue;
    requestedByStudent.set(studentId, entry || {});
  }

  const rawAllocations = [];
  for (const [studentId, entry] of requestedByStudent) {
    const student = byId.get(studentId);
    if (!student) return res.status(400).json({ error: 'נבחר מתאמן שאינו שייך לתיק המשפחה' });
    const rows = ensureStudentEquipment({ db, student, persist: persistCore });
    const unpaidTypes = new Set(unpaidEquipmentItems(rows).map((row) => row.item_type));
    const selected = [...new Set(
      (Array.isArray(entry.itemTypes) ? entry.itemTypes : [])
        .map((type) => String(type || '').trim())
        .filter((type) => equipmentItemTypesForStudent(student).includes(type) && unpaidTypes.has(type))
    )];
    if (!selected.length) continue;

    const shirtSize = String(entry.shirtSize || '').trim();
    if (selected.includes('shirt')) {
      if (!shirtSize) return res.status(400).json({ error: `יש לבחור מידת חולצה עבור ${student.name}` });
      if (!settings.shirt_sizes.includes(shirtSize)) {
        return res.status(400).json({ error: `מידת החולצה של ${student.name} אינה תקפה` });
      }
    }
    const shoesPricing = await shoesPricingForStudent(student.id, settings);
    const subtotal = computeEquipmentTotal(settings, selected, { shoes: shoesPricing.amount });
    if (subtotal <= 0) continue;
    rawAllocations.push({
      student_id: student.id,
      student_name: student.name || '',
      is_adult: !isKidStudent(student),
      item_types: selected,
      shirt_size: selected.includes('shirt') ? shirtSize : null,
      shoes_amount: selected.includes('shoes') ? shoesPricing.amount : null,
      // איזה מחיר בסיס נבחר, כדי שאפשר יהיה להסביר את החיוב בעוד חצי שנה.
      weekly_sessions: selected.includes('shoes') ? shoesPricing.weekly_sessions : null,
      rental_starts_at: selected.includes('shoes') ? shoesPricing.rental_starts_at : null,
      rental_ends_at: selected.includes('shoes') ? shoesPricing.half_end : null,
      rental_days: settings.rental_days,
      description: describeEquipmentItems(selected, shirtSize || null),
      subtotal,
    });
  }
  if (!rawAllocations.length) {
    return res.status(400).json({ error: 'בחרו לפחות פריט אחד לתשלום' });
  }

  const pricing = applyEquipmentFamilyDiscount(settings, rawAllocations);
  if (pricing.total <= 0) {
    return res.status(400).json({ error: 'סכום התשלום אינו תקף — פנו לצוות' });
  }
  const includesVat = normalizePriceIncludesVat(settings.price_includes_vat, true);
  const amount = chargeAmount(pricing.total, includesVat);
  let allocatedCharge = 0;
  const allocations = pricing.allocations.map((allocation, index) => {
    const charge = index === pricing.allocations.length - 1
      ? Math.round((amount - allocatedCharge) * 100) / 100
      : chargeAmount(allocation.total, includesVat);
    allocatedCharge = Math.round((allocatedCharge + charge) * 100) / 100;
    return { ...allocation, charge_amount: charge };
  });
  const description = `ציוד משפחתי: ${allocations.map((allocation) =>
    `${allocation.student_name} – ${allocation.description.replace(/^ציוד לאימונים:\s*/, '')}`
  ).join('; ')}`;
  const cartSignature = crypto
    .createHash('sha256')
    .update(JSON.stringify({ allocations, amount, includesVat }))
    .digest('hex');
  const existing = (db.get('payments') || []).find(
    (payment) =>
      payment.status === 'pending' &&
      payment.equipment_checkout_token === checkout.id &&
      payment.equipment_cart_signature === cartSignature &&
      payment.payment_url
  );
  if (existing) {
    return res.json({
      success: true,
      reused: true,
      paymentUrl: existing.payment_url,
      amount: existing.amount,
      description: existing.description,
      pricing: {
        subtotal: existing.equipment_family_subtotal,
        discount: existing.equipment_family_discount_amount,
        discount_percent: existing.equipment_family_discount_percent,
        total: existing.equipment_family_total,
      },
      allocations: existing.equipment_allocations || allocations,
    });
  }

  const now = new Date().toISOString();
  const payment = db.insert('payments', {
    parent_id: parent.id,
    student_id: checkout.student_id || allocations[0].student_id,
    amount,
    price_includes_vat: includesVat,
    description,
    status: 'pending',
    payment_url: null,
    paid_at: null,
    equipment_payment: true,
    equipment_family_payment: true,
    equipment_checkout_token: checkout.id,
    equipment_cart_signature: cartSignature,
    equipment_allocations: allocations,
    equipment_family_subtotal: pricing.subtotal,
    equipment_family_discount_enabled: pricing.enabled,
    equipment_family_discount_percent: pricing.percent,
    equipment_family_discount_amount: pricing.discount,
    equipment_family_total: pricing.total,
    // צילום מדיניות הביטול כפי שהיא ברגע הרכישה. בלעדיו הזיכוי היה קורא את
    // המדיניות העדכנית בזמן הביטול, ושינוי דמי הביטול היה משנה למפרע החזר
    // של השכרה שכבר שולמה.
    policy_snapshot: equipmentPolicySnapshot(settings),
    updated_at: now,
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

  for (const allocation of allocations) {
    const record = db.insert('equipment_payment_allocations', {
      id: `eqpa-${payment.id}-${allocation.student_id}`,
      payment_id: payment.id,
      checkout_token: checkout.id,
      parent_id: parent.id,
      status: 'pending',
      paid_at: null,
      ...allocation,
      created_at: now,
      updated_at: now,
    });
    await persistCore('equipment_payment_allocations', record);
  }

  return res.json({
    success: true,
    paymentUrl,
    amount,
    description,
    pricing: {
      subtotal: pricing.subtotal,
      discount: pricing.discount,
      discount_percent: pricing.percent,
      total: pricing.total,
    },
    allocations,
  });
}

app.post('/api/public/equipment/:token/pay', publicFormRateLimit, async (req, res) => {
  try {
    const checkout = await resolveEquipmentCheckout(req.params.token);
    if (!checkout) return res.status(404).json({ error: 'קישור התשלום לא נמצא' });
    if (checkout.expires_at && new Date(checkout.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ error: 'פג תוקף הקישור — בקשו קישור חדש מהצוות' });
    }

    if (Array.isArray(req.body?.allocations)) {
      await refreshStudentEquipmentCache();
      return createFamilyEquipmentPayment(req, res, checkout);
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
      equipment_weekly_sessions: selected.includes('shoes') ? shoesPricing.weekly_sessions : null,
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

function requireActiveEmployees(employeeIds = []) {
  const ids = [...new Set((employeeIds || []).map((id) => String(id || '')).filter(Boolean))];
  if (!ids.length) return [];
  const employees = db.get('employees') || [];
  const selected = ids.map((id) => employees.find((employee) => String(employee.id) === id));
  const invalid = ids.map((id, index) => ({ id, employee: selected[index] })).filter(({ employee }) => (
    !employee || employee.is_active === false || employee.active === false
  ));
  if (invalid.length) {
    const names = invalid.map(({ id, employee }) => employee?.name || id).filter(Boolean);
    throw Object.assign(new Error(`לא ניתן לשבץ עובד בארכיון${names.length ? `: ${names.join(', ')}` : ''}`), {
      statusCode: 400,
      code: 'EMPLOYEE_ARCHIVED',
    });
  }
  return selected;
}

function groupEmployeeIds(fields = {}) {
  return [fields.trainer, ...(Array.isArray(fields.assistants) ? fields.assistants : [])];
}

// Create/Update Group (upsert by id so re-seeds don't duplicate local cache)
app.post('/api/groups', async (req, res) => {
  const { trainingDays, returningPriorityUntil, ...groupFields } = req.body || {};
  try {
    requireActiveEmployees(groupEmployeeIds(groupFields));
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message, code: error.code });
  }
  const id = req.body?.id;
  if (id && db.getOne('groups', id)) {
    const updated = db.update('groups', id, groupFields);
    await saveGroupBotMeta(db, persistCore, id, { trainingDays, returningPriorityUntil });
    return res.json(enrichGroupsWithBotMeta(db, [updated])[0]);
  }
  const record = db.insert('groups', groupFields);
  await saveGroupBotMeta(db, persistCore, record.id, { trainingDays, returningPriorityUntil });
  res.status(201).json(enrichGroupsWithBotMeta(db, [record])[0]);
});

app.put('/api/groups/:id', async (req, res) => {
  const { id } = req.params;
  const { trainingDays, returningPriorityUntil, ...groupFields } = req.body || {};
  try {
    requireActiveEmployees(groupEmployeeIds(groupFields));
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message, code: error.code });
  }
  const updated = db.update('groups', id, groupFields);
  if (!updated) return res.status(404).json({ error: 'Group not found' });
  if (trainingDays !== undefined || returningPriorityUntil !== undefined) {
    await saveGroupBotMeta(db, persistCore, id, { trainingDays, returningPriorityUntil });
  }
  res.json(enrichGroupsWithBotMeta(db, [updated])[0]);
});

app.get('/api/placement-requests', (req, res) => {
  const status = String(req.query.status || 'pending');
  const rows = (db.get(PLACEMENT_REQUEST_COLLECTION) || [])
    .filter((row) => {
      if (!status) return true;
      if (status !== 'pending') return String(row.status) === status;
      // An approval whose automatic continuation failed is still work for the
      // team. Keeping it in this queue gives the same button a safe retry path
      // instead of silently losing it after the first click.
      return String(row.status) === 'pending'
        || (String(row.status) === 'approved' && row.continuation_status !== 'sent');
    })
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  res.json(rows);
});

app.get('/api/students/:id/program-eligibility', (req, res) => {
  res.json(eligibilityForStudent(db, req.params.id));
});

app.put('/api/students/:id/program-eligibility', async (req, res) => {
  const wasEligible = sharedRestrictedEligibility(db, req.params.id)
    .some((row) => ['returning', 'approved'].includes(String(row.status || '')));
  const hasExplicitGroups = Array.isArray(req.body?.group_ids);
  const result = hasExplicitGroups
    ? await setProgramGroupEligibility(db, persistCore, {
      studentId: req.params.id,
      groupIds: req.body.group_ids,
      actor: req.crmUser?.email || req.crmUser?.id || 'crm',
    })
    : await setSharedProgramEligibility(db, persistCore, {
      studentId: req.params.id,
      eligible: req.body?.eligible === true,
      actor: req.crmUser?.email || req.crmUser?.id || 'crm',
    });
  if (!result.ok) return res.status(result.status || 400).json(result);

  // The tick was a decision that stayed with us — the family heard nothing
  // until somebody remembered to write. Now granting it opens the
  // conversation, and the bot carries the registration on from the answer.
  let announced = null;
  if (!wasEligible && result.eligible) {
    try {
      const student = db.getOne('students', req.params.id);
      const parent = student?.parentId ? db.getOne('parents', student.parentId) : null;
      const row = (result.rows || []).find((r) => ['returning', 'approved'].includes(String(r.status || '')));
      announced = await announceProgramEligibility({
        db,
        persist: persistCore,
        student,
        parent,
        row,
        windowOpen: parent ? canSendFreeform(parent, 'whatsapp') : false,
        sendReply: (phone, message) => whatsappService.sendBotReply(phone, message, {
          source: 'ai',
          parent,
          logType: 'placement',
        }),
        notifyStaff: async (text) => {
          const { phones } = alertRecipients(db, 'handoff', db.getSettings ? db.getSettings() : {});
          for (const staffPhone of phones) {
            await whatsappService.sendTextMessage(staffPhone, text, false, {
              source: 'staff_notify',
              clip: false,
            });
          }
        },
      });
    } catch (err) {
      console.error('eligibility notice failed:', err.message);
      announced = { ok: false, reason: 'error' };
    }
  }
  res.json({ ...result, ...(announced ? { announced } : {}) });
});

app.post('/api/placement-requests/:id/review', async (req, res) => {
  const decision = req.body?.decision;
  const result = await reviewProgramApproval(db, persistCore, req.params.id, {
    decision,
    note: req.body?.note || '',
    actor: req.crmUser?.email || req.crmUser?.id || 'crm',
  });
  if (!result.ok) return res.status(result.status || 400).json(result);

  if (decision === 'approved') {
    const continuation = await continueApprovedPlacement({
      db,
      persist: persistCore,
      request: result.request,
      group: result.group,
      settings: await loadBrandedBotSettings(),
      buildTools: buildCustomerTools,
      sendReply: (phone, message, options) => whatsappService.sendBotReply(phone, message, options),
    });
    if (!continuation.ok) {
      return res.status(continuation.status || 409).json({
        ...result,
        request: continuation.request || result.request,
        continuation: {
          ok: false,
          error: continuation.error,
        },
      });
    }
    return res.json({
      ...result,
      request: continuation.request || result.request,
      continuation: {
        ok: true,
        duplicate: Boolean(continuation.duplicate),
      },
    });
  }
  res.json(result);
});

app.delete('/api/groups/:id', (req, res) => {
  const { id } = req.params;
  const deleted = db.delete('groups', id);
  if (!deleted) return res.status(404).json({ error: 'Group not found' });
  db.delete('group_bot_meta', id);
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
  const perEventPrice = normalizeChargeBasis(body.charge_basis) !== 'per_participant';
  return {
    name: String(body.name || '').trim(),
    type,
    participation_scope: body.participation_scope
      ? normalizeParticipationScope(body.participation_scope)
      : scopeForActivity({ type, category }),
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
    // הרשמה ליום בודד באירוע רב-יומי. פעילות תפעולית לא נמכרת, ולכן כבויה שם.
    allow_single_day: isOps ? false : body.allow_single_day === true,
    single_day_price: isOps ? 0 : (body.single_day_price === '' || body.single_day_price == null
      ? 0
      : Math.max(0, Number(body.single_day_price) || 0)),
    max_participants: isOps ? null : (body.max_participants === '' || body.max_participants == null
      ? null
      : Number(body.max_participants) || null),
    // תמחור לפי ראש: המינימום הוא רצפת חיוב (12 נרשמים במינימום 15 מחויבים
    // כ-15), התוספת היא המחיר מעבר לרצפה, והתקרה חוסמת את הסכום הכולל.
    // `max_charge` הוא תקרת סכום, בשונה מ-`max_participants` שהוא מכסת נרשמים.
    //
    // במחיר קבוע לאירוע שלושתם נמחקים ולא רק מוסתרים: אירוע שהיה „לפי ראש” עם
    // תקרה של 2,500 ועבר למחיר קבוע של 3,000 היה נשאר עם תקרה שהמסך כבר לא
    // מציג, וממשיכה לחתוך בשקט.
    charge_basis: isOps ? 'flat' : normalizeChargeBasis(body.charge_basis),
    min_participants: isOps || perEventPrice ? null : normalizeCount(body.min_participants),
    extra_participant_price:
      isOps || perEventPrice ? null : normalizeMoney(body.extra_participant_price),
    max_charge: isOps || perEventPrice ? null : normalizeMoney(body.max_charge),
    price_template_id: isOps ? null : (body.price_template_id || null),
    // שורת המחירון שהאירוע מתומחר לפיה, והגרסה שנקבעה כשנבחרה. הגרסה היא מה
    // שמונע מאירוע שכבר תומחר לזוז כשמעדכנים מחיר במחירון.
    price_rule_id: isOps ? null : (body.price_rule_id || null),
    price_rule_version: isOps ? null : normalizeCount(body.price_rule_version),
    // מה שהוקפא ברגע יצירת קישור התשלום למזמין. נשמר על האירוע כדי שהרשמה
    // מאוחרת לא תשנה את הסכום שכבר נשלח לו.
    host_charge_participants: isOps ? null : normalizeCount(body.host_charge_participants),
    host_charge_amount: isOps ? null : normalizeMoney(body.host_charge_amount),
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
    // Whether the activity is advertised at all. This list is rebuilt from
    // scratch on every save, so a field missing from it is not merely ignored —
    // it is erased. That is why an activity saved as published came back
    // private, however it had been set: the flag never survived the next save.
    show_on_site: type === 'opening_hours'
      ? (body.status || 'open') !== 'draft'
      : (!isOps && !!body.registration_enabled && !!body.show_on_site),
    // רעיון: פעילות שאוספת מתעניינים. בלי תאריך היא עדיין חוקית — זו כל
    // הנקודה, ולכן גם הבדיקה של „חסר תאריך” מוותרת עליה.
    collect_interest: !isOps && body.collect_interest === true,
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
    audience: body.audience || '',
    included: body.included || '',
    what_to_bring: body.what_to_bring || '',
    important_info: body.important_info || '',
    cancellation_policy_id: body.cancellation_policy_id || null,
    cancellation_policy_disabled: body.cancellation_policy_disabled === true,
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

/**
 * מקפיא את הסכום שהמזמין יתבקש לשלם, ברגע שנוצר עבורו קישור.
 *
 * הסכום היה מחושב מחדש בכל פעם שהמזמין פותח את הקישור. כל עוד המחיר היה קבוע
 * לאירוע זה לא הזיז דבר, אבל מחיר שנגזר ממספר המשתתפים משתנה בכל הרשמה — ומי
 * שקיבל הצעה על 1,400₪ היה מגלה סכום אחר כשהוא בא לשלם. מכאן ואילך הסכום נקבע
 * פעם אחת, והצוות הוא היחיד שמשנה אותו.
 */
function freezeHostCharge(activity) {
  if (!activity || activity.registration_mode !== 'host_pays') return activity;
  const breakdown = activityChargeBreakdown(activity);
  // סכום שלא ניתן לחשב לא מוקפא. אירוע מדרגות בלי נרשמים, או קבוצה מעל המדרגה
  // האחרונה, מחזירים סירוב — ועדיף שדף המזמין יגיד „המחיר טרם נקבע” מאשר
  // שייסגר על מספר שאיש לא קבע.
  if (breakdown.unpriced || !(breakdown.gross > 0)) return activity;
  return db.update('activities', activity.id, {
    // נשמר מספר הנרשמים בפועל ולא המספר המחויב. השדה הזה נקרא במסך האירוע
    // כתיקון ידני של הצוות, ולכן 12 נרשמים במינימום 15 שנשמרים כ-15 מייצרים
    // שם את ההודעה „נרשמו 12 — החיוב על 15”, בנוסח של תיקון שאיש לא עשה.
    // הרצפה נכנסת שוב בזמן החישוב, ולכן הסכום זהה.
    host_charge_participants: breakdown.registeredCount || null,
    host_charge_amount: breakdown.gross,
  }) || activity;
}

/**
 * פירוט החיוב של אירוע — דרך המחירון כשהוא מקושר, ואחרת מהמספרים שעליו.
 *
 * זה המקום היחיד שמחשב כסף של אירוע, כדי שדף המזמין, מסך האירוע וסיכום התשלום
 * לא יוכלו להראות שלושה מספרים שונים.
 */
function activityChargeBreakdown(activity, { participants } = {}) {
  const registeredCount = participants != null
    ? participants
    : activeRegistrations(db, activity.id).length;
  const resolved = resolveActivityRule(db, activity);
  if (resolved && !resolved.numbers) {
    // הכלל נמחק מהמסד, או שהגרסה שהאירוע נקבע לפיה כבר לא קיימת. אסור ליפול
    // חזרה לחישוב לפי ראש — 350×12 = 4,200₪ במקום 5,700₪ נראה סביר לגמרי,
    // ולכן אף אחד לא היה תופס את זה.
    return {
      basis: 'missing_rule',
      unpriced: true,
      unpricedReason: 'missing_rule',
      registeredCount,
      billableCount: null,
      entered: 0,
      net: 0,
      gross: 0,
      vat: 0,
    };
  }
  return hostChargeBreakdown(activity, {
    registeredCount,
    numbers: resolved?.numbers || null,
  });
}

/** הסכום שהמזמין משלם: מה שהוקפא, ואם אין — חישוב חי, כמו לפני ההקפאה. */
function hostChargeFor(activity) {
  const frozen = normalizeMoney(activity.host_charge_amount);
  if (frozen != null) return frozen;
  return activityChargeBreakdown(activity).gross;
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
  if (record?.type === 'opening_hours') {
    googleBusinessProfileService.scheduleSync(() => db.get('activities') || []);
  }
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

async function applyGooglePull(dbRef) {
  const result = await googleCalendarService.pullChanges({
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
  if ((result?.created || 0) + (result?.updated || 0) + (result?.deleted || 0) > 0) {
    googleBusinessProfileService.scheduleSync(() => dbRef.get('activities') || []);
  }
  return result;
}

const ACTIVITY_FINANCE_FIELDS = new Set([
  'price', 'cost', 'budget', 'revenue', 'profit', 'payment_link', 'payment_url',
  'host_payment_token', 'host_payment_id', 'collect_registration_payment', 'registration_mode',
  'refund_amount', 'amount', 'total_amount', 'paid_amount', 'payment_id', 'icount_doc_id',
  'icount_doc_url', 'refund_doc_url', 'refund_doc_number',
  // שדות התמחור לפי ראש הם מחיר לכל דבר, ומי שלא רואה את `price` לא אמור
  // לגזור אותו מהמינימום והתקרה.
  'charge_basis', 'min_participants', 'extra_participant_price', 'max_charge',
  'host_charge_participants', 'host_charge_amount',
  // הקישור למחירון קובע כסף — בשונה מ-`price_template_id` שהיה דקורטיבי.
  // ⚠️ כל שדה שנוסף כאן חייב להתווסף באותו קומיט גם ל-`permittedPayload`
  // ב-ActivitiesCalendar.jsx, אחרת עובד בלי הרשאת כספים שולח null ומקבל 403
  // על כל שמירה — גם כשהוא שינה רק את המיקום.
  'price_rule_id', 'price_rule_version',
  'payment_status',
]);
const ACTIVITY_HR_FIELDS = new Set(['staff_pay_mode', 'staff_flat_amount', 'staff_cost', 'staff_rate']);

function omitFields(value, blocked) {
  if (Array.isArray(value)) return value.map((item) => omitFields(item, blocked));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !blocked.has(key))
    .map(([key, item]) => [key, omitFields(item, blocked)]));
}

function activityForRequest(req, activity) {
  let result = activity;
  if (!hasSensitiveAccess(req.crmUser, 'finance')) result = omitFields(result, ACTIVITY_FINANCE_FIELDS);
  if (!hasSensitiveAccess(req.crmUser, 'hr')) result = omitFields(result, ACTIVITY_HR_FIELDS);
  return result;
}

function cancellationSummaryForRequest(req, summary) {
  if (hasSensitiveAccess(req.crmUser, 'finance')) return summary;
  return {
    activity_id: summary?.activity_id || null,
    activity_name: summary?.activity_name || '',
    already_cancelled: !!summary?.already_cancelled,
    registrations_count: Number(summary?.registrations_count) || 0,
    total_registrations: Number(summary?.total_registrations) || 0,
    history_only: !!summary?.history_only,
    deletable: !!summary?.deletable,
  };
}

function rejectActivitySensitiveChanges(req, body = {}, existing = {}) {
  const checks = [
    [ACTIVITY_FINANCE_FIELDS, hasSensitiveAccess(req.crmUser, 'finance'), 'אין הרשאה לשנות נתונים כספיים של האירוע'],
    [ACTIVITY_HR_FIELDS, hasSensitiveAccess(req.crmUser, 'hr'), 'אין הרשאה לשנות תעריפי עבודה באירוע'],
  ];
  for (const [fields, allowed, message] of checks) {
    if (allowed) continue;
    const changed = [...fields].some((key) => body[key] !== undefined && JSON.stringify(body[key]) !== JSON.stringify(existing?.[key]));
    if (changed) throw Object.assign(new Error(message), { statusCode: 403 });
  }
}

app.get('/api/activities', async (req, res) => {
  const includeArchived = String(req.query?.include_archived || '') === '1';
  const visibleRows = (rows) => includeArchived
    ? rows
    : rows.filter((row) => !activityIsArchived(row));
  try {
    const rows = await readTable('activities');
    return res.json(visibleRows(rows).map((row) => activityForRequest(req, row)));
  } catch (err) {
    console.error('activities read failed:', err.message);
  }
  res.json(visibleRows(db.get('activities') || []).map((row) => activityForRequest(req, row)));
});

app.post('/api/activities', async (req, res) => {
  try {
    rejectActivitySensitiveChanges(req, req.body || {}, {});
  } catch (error) {
    return res.status(error.statusCode || 403).json({ error: error.message });
  }
  const payload = normalizeActivityPayload(req.body || {});
  if (!payload.name) return res.status(400).json({ error: 'חסר שם פעילות' });
  // רעיון הוא פעילות שעדיין אין לה תאריך — זו כל מהותה.
  if (!payload.date && !payload.collect_interest) return res.status(400).json({ error: 'חסר תאריך' });
  if (payload.end_date && payload.end_date < payload.date) {
    return res.status(400).json({ error: 'תאריך הסיום לפני תאריך ההתחלה' });
  }
  // אירוע שמציע ימים בודדים חייב מחיר ליום. בלי זה ההרשמה החלקית הייתה
  // נחסמת רק ברגע התשלום — הרבה אחרי שהאפשרות כבר פורסמה ללקוחות.
  if (payload.allow_single_day && !(Number(payload.single_day_price) > 0)) {
    return res.status(400).json({ error: 'הרשמה ליום בודד מחייבת עלות ליום בודד' });
  }
  // כתובת ההרשמה נקבעת בשרת ולעולם לא מגיעה מהטופס: היא מזהה ציבורי ייחודי,
  // ואירוע חדש שנשלח עם כתובת של אירוע קיים מתנגש באינדקס הייחודי של המסד.
  // כך נראה אירוע שנשמר בהצלחה ומיד אחר כך הודיע „duplicate key value” —
  // הטופס החזיק את הכתובת שהשמירה הראשונה יצרה ושלח אותה שוב כאירוע חדש.
  payload.participant_registration_slug = payload.registration_enabled
    ? makeRegistrationSlug()
    : null;
  payload.registration_slug = payload.participant_registration_slug;
  if (payload.registration_mode === 'host_pays' && !payload.host_payment_token) {
    payload.host_payment_token = makePrivatePaymentToken();
  }
  const record = db.insert('activities', payload);
  const durable = await persistCore('activities', record);
  if (durable?.ok === false) {
    console.error('activity create persist failed:', durable.error);
    return res.status(503).json({ error: 'שמירת האירוע למסד נכשלה' });
  }
  res.status(201).json(activityForRequest(req, record));
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
  try {
    rejectActivitySensitiveChanges(req, req.body || {}, existing);
  } catch (error) {
    return res.status(error.statusCode || 403).json({ error: error.message });
  }
  const payload = normalizeActivityPayload({ ...existing, ...(req.body || {}) });
  if (!payload.name) return res.status(400).json({ error: 'חסר שם פעילות' });
  // רעיון הוא פעילות שעדיין אין לה תאריך — זו כל מהותה.
  if (!payload.date && !payload.collect_interest) return res.status(400).json({ error: 'חסר תאריך' });
  if (payload.end_date && payload.end_date < payload.date) {
    return res.status(400).json({ error: 'תאריך הסיום לפני תאריך ההתחלה' });
  }
  // אירוע שמציע ימים בודדים חייב מחיר ליום. בלי זה ההרשמה החלקית הייתה
  // נחסמת רק ברגע התשלום — הרבה אחרי שהאפשרות כבר פורסמה ללקוחות.
  if (payload.allow_single_day && !(Number(payload.single_day_price) > 0)) {
    return res.status(400).json({ error: 'הרשמה ליום בודד מחייבת עלות ליום בודד' });
  }
  // הכתובת של האירוע היא שלו בלבד ואינה נלקחת מהטופס — אחרת אירוע אחד היה
  // יכול לקבל את כתובת ההרשמה של אירוע אחר. מתחלפת רק דרך „צור קישור מחדש”.
  const currentSlug = existing.participant_registration_slug || existing.registration_slug || null;
  payload.participant_registration_slug = currentSlug
    || (payload.registration_enabled ? makeRegistrationSlug() : null);
  payload.registration_slug = payload.participant_registration_slug;
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
    return res.status(503).json({ error: 'שמירת האירוע למסד נכשלה' });
  }
  res.json(activityForRequest(req, updated));
  syncActivityToGoogle(updated).catch((err) =>
    console.error('Background Google push failed:', err.message)
  );
  if (existing.type === 'opening_hours' && updated.type !== 'opening_hours') {
    googleBusinessProfileService.scheduleSync(() => db.get('activities') || []);
  }
  applyVacationAttendanceForActivities(existing, updated).catch((err) =>
    console.error('Vacation attendance sync failed:', err.message)
  );
  // The whole point of a list with no date: the moment there is one, the people
  // who asked to be told are told.
  if (ideaJustScheduled(existing, updated)) {
    announceScheduledIdea(updated).catch((err) =>
      console.error('idea announcement failed:', err.message));
  }
});

// Deleting an activity that people are registered to leaves their registrations
// and payments behind with nothing to explain them. There is the same guard on
// deleting a customer; here the alternative is offered instead — cancel, which
// keeps the record and gives the money back.
app.delete('/api/activities/:id', async (req, res) => {
  const { id } = req.params;
  const existing = db.getOne('activities', id);
  if (!existing) return res.status(404).json({ error: 'Activity not found' });
  await refreshCancellationTables();
  const fresh = db.getOne('activities', id) || existing;
  const summary = summarizeActivityCancellation(db, fresh, organizerCancelReview(fresh));
  if (!summary.deletable) {
    return res.status(409).json({
      error: summary.registrations_count
        ? `יש ${summary.registrations_count} נרשמים לאירוע הזה`
        : (summary.history_only
          ? 'יש היסטוריית הרשמות לאירוע הזה'
          : 'יש תשלום מזמין שולם לאירוע הזה'),
      code: 'activity_has_registrations',
      summary: cancellationSummaryForRequest(req, summary),
    });
  }
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

// A historical registration must keep its parent activity, but that does not
// mean the old event has to stay on the operational calendar. Archiving keeps
// the audit trail intact and closes every public entry point.
app.post('/api/activities/:id/archive', async (req, res) => {
  try {
    const existing = db.getOne('activities', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Activity not found' });
    await refreshCancellationTables();
    const fresh = db.getOne('activities', req.params.id) || existing;
    const summary = summarizeActivityCancellation(db, fresh, organizerCancelReview(fresh));
    if (!activityCanBeArchived(summary)) {
      return res.status(409).json({
        error: 'יש לבטל תחילה את ההרשמות הפעילות והזיכויים של האירוע',
        code: 'activity_has_active_registrations',
        summary: cancellationSummaryForRequest(req, summary),
      });
    }

    const archived = db.update('activities', fresh.id, {
      status: 'archived',
      registration_enabled: false,
      show_on_site: false,
      updated_at: new Date().toISOString(),
    });
    if (!archived) return res.status(404).json({ error: 'Activity not found' });
    const durable = await persistCore('activities', archived);
    if (durable?.ok === false) {
      console.error('activity archive persist failed:', durable.error);
      return res.status(503).json({ error: durable.error || 'שמירת האירוע בארכיון נכשלה' });
    }

    res.json({ success: true, activity: activityForRequest(req, archived) });
    if (archived.type === 'opening_hours') {
      googleBusinessProfileService.scheduleSync(() => db.get('activities') || []);
    }
    applyVacationAttendanceForActivities(fresh, archived).catch((err) =>
      console.error('Vacation attendance sync failed:', err.message)
    );
  } catch (err) {
    console.error('activity archive error:', err.message);
    res.status(500).json({ error: err.message || 'העברת האירוע לארכיון נכשלה' });
  }
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
  res.json(hasSensitiveAccess(req.crmUser, 'finance') ? rows : rows.map(({ price: _price, ...row }) => row));
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
    registrations: hasSensitiveAccess(req.crmUser, 'finance')
      ? enriched
      : omitFields(enriched, ACTIVITY_FINANCE_FIELDS),
    interested: listInterest(db, activity.id).map((row) => enrichInterest(db, row)),
    host_payment: hasSensitiveAccess(req.crmUser, 'finance') ? hostPayment : null,
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
      paymentStatus: authorizedRegistrationPaymentStatus(
        req.body?.payment_status,
        activity,
        hasSensitiveAccess(req.crmUser, 'finance')
      ),
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
          status: REGISTRATION_STATUS.DETAILS_COMPLETED,
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
      .map((registration) => {
        const eligibility = participationEligibility(db, {
          studentId: registration.student_id,
          scope: scopeForActivity(activity),
        });
        return {
          ...registration,
          document_status: eligibility.status,
          eligible_now: eligibility.eligible,
          parent_name:
            parents.find((parent) => String(parent.id) === String(registration.parent_id))?.name || '',
        };
      });

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
      const requestedAttendanceStatus = String(record.status || '').toLowerCase();
      if (['attended', 'present', 'late', 'הגיע'].includes(requestedAttendanceStatus)) {
        const eligibility = participationEligibility(db, {
          studentId: registration.student_id,
          scope: scopeForActivity(activity),
        });
        const refreshedRegistration = db.update('activity_registrations', registration.id, {
          document_status: eligibility.status,
          updated_at: new Date().toISOString(),
        });
        if (refreshedRegistration) await persistCore('activity_registrations', refreshedRegistration);
        if (!eligibility.eligible) {
          return res.status(409).json({
            error: eligibility.status === 'blocked_health'
              ? `${registration.participant_name || 'המשתתף/ת'} חסום/ה עקב שינוי במצב הבריאותי`
              : `${registration.participant_name || 'המשתתף/ת'} חסר/ת מסמכים תקפים לפעילות`,
            code: 'participation_documents_required',
            documentStatus: eligibility.status,
          });
        }
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

function cancellationReviewForPayment({ activity, payment, order = null, paidAmount, participantsCancelled = 1, organizerCancelled = false } = {}) {
  const snapshot = order?.policy_snapshot
    || payment?.policy_snapshot
    || resolvePolicyFor(db, activity)?.snapshot
    || null;
  const startsAt = israelTimeToEpoch(activity?.date, activity?.start_time || '00:00');
  const recommendation = snapshot
    ? suggestedRefund({
        snapshot,
        paidAmount,
        activityStartsAt: new Date(startsAt),
        // מתי שולם — זה מה שקובע אם חלון ההתחרטות עדיין פתוח. בלעדיו הכלל
        // הזה לא היה נבדק אף פעם, כי הוא נמדד מהרכישה ולא מהפעילות.
        purchasedAt: payment?.paid_at || order?.created_at || payment?.created_at || null,
        organizerCancelled,
        participantsCancelled,
      })
    : {
        amount: Math.max(0, Number(paidAmount) || 0),
        rule_id: 'legacy_full_refund',
        refund_percent: 100,
        fixed_fee: 0,
      };
  const chargedAmount = Math.max(0, Number(payment?.amount) || 0);
  const automaticFullRefund = Math.abs(Number(recommendation.amount) - chargedAmount) < 0.005;
  return {
    recommendation,
    policy_snapshot: snapshot,
    charged_amount: chargedAmount,
    automatic_full_refund: automaticFullRefund,
    manual_partial_refund_required: !automaticFullRefund,
    icount_doc_app_url: icount.docAppUrl({
      doctype: payment?.icount_doctype || 'invrec',
      docnum: payment?.icount_doc_number,
      docId: payment?.icount_doc_id,
    }),
  };
}

async function resolveEquipmentFamily(checkout) {
  let parent = db.getOne('parents', checkout?.parent_id);
  let anchor = db.getOne('students', checkout?.student_id);
  if ((!parent || !anchor) && supa.isEnabled()) {
    const [remoteStudents, remoteParents, remoteGuardians] = await Promise.all([
      supa.getAll('students'),
      supa.getAll('parents'),
      supa.getAll('student_guardians'),
    ]);
    if (remoteStudents && typeof db.set === 'function') db.set('students', remoteStudents);
    if (remoteParents && typeof db.set === 'function') db.set('parents', remoteParents);
    if (remoteGuardians && typeof db.set === 'function') db.set('student_guardians', remoteGuardians);
    parent = db.getOne('parents', checkout?.parent_id);
    anchor = db.getOne('students', checkout?.student_id);
  }
  if (!parent) return { parent: null, anchor, members: [] };

  const members = expandHousehold(db, parent.id).students.filter(
    (student) => isEquipmentEligibleStudent(student) && student.status !== 'archived'
  );
  if (
    anchor &&
    isEquipmentEligibleStudent(anchor) &&
    anchor.status !== 'archived' &&
    !members.some((student) => String(student.id) === String(anchor.id))
  ) {
    members.push(anchor);
  }
  members.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'he'));
  return { parent, anchor, members };
}

async function buildPublicEquipmentPayload(checkout, suppliedSettings = null) {
  const { parent, anchor, members } = await resolveEquipmentFamily(checkout);
  if (!parent || !members.length) return null;
  const settings = suppliedSettings || await loadEquipmentSettings();
  const payloadMembers = [];
  for (const student of members) {
    const items = ensureStudentEquipment({ db, student, persist: persistCore });
    const unpaid = unpaidEquipmentItems(items);
    const shoesPricing = await shoesPricingForStudent(student.id, settings);
    payloadMembers.push({
      student_id: student.id,
      student_name: student.name || '',
      is_adult: !isKidStudent(student),
      items,
      unpaid_items: unpaid,
      prices: { ...settings.prices, shoes: shoesPricing.amount },
      shoes_pricing: shoesPricing,
      all_resolved: unpaid.length === 0,
    });
  }

  const latestPayment = (db.get('payments') || [])
    .filter((payment) => payment.equipment_checkout_token === checkout.id)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0] || null;
  const anchorPayload = payloadMembers.find(
    (member) => String(member.student_id) === String(anchor?.id || checkout.student_id)
  ) || payloadMembers[0];

  return {
    parent_name: parent.name || '',
    anchor_student_id: checkout.student_id,
    members: payloadMembers,
    settings,
    labels: EQUIPMENT_ITEM_LABELS,
    all_resolved: payloadMembers.every((member) => member.all_resolved),
    latest_payment: latestPayment ? {
      id: latestPayment.id,
      status: latestPayment.status,
      amount: latestPayment.amount,
      paid_at: latestPayment.paid_at || null,
      allocations: latestPayment.equipment_allocations || [],
      discount_percent: latestPayment.equipment_family_discount_percent || 0,
      discount_amount: latestPayment.equipment_family_discount_amount || 0,
    } : null,
    // Backward-compatible fields for already-open versions of the public page.
    student_name: anchorPayload?.student_name || anchor?.name || '',
    items: anchorPayload?.items || [],
    unpaid_items: anchorPayload?.unpaid_items || [],
    shoes_pricing: anchorPayload?.shoes_pricing || null,
    all_paid: anchorPayload?.all_resolved ?? true,
  };
}

function registrationRefundReview(activity, registration, plan, options = {}) {
  const siblingCount = Math.max(1, plan.affectedRegistrations?.length || 1);
  const allocatedPaid = Number(registration.amount) > 0
    ? Number(registration.amount)
    : (Number(plan.amount) || 0) / siblingCount;
  return cancellationReviewForPayment({
    activity,
    payment: plan.payment,
    order: plan.order,
    paidAmount: allocatedPaid,
    participantsCancelled: 1,
    ...options,
  });
}

app.post('/api/activities/:id/registrations/:registrationId/refund-preview', (req, res) => {
  const activity = db.getOne('activities', req.params.id);
  const registration = db.getOne('activity_registrations', req.params.registrationId);
  if (!activity || !registration || String(registration.activity_id) !== String(activity.id)) {
    return res.status(404).json({ error: 'המשתתף לא נמצא באירוע' });
  }
  const plan = buildRegistrationRefundPlan(db, { activity, registration });
  if (!plan.ok) return res.status(400).json({ error: plan.error, code: plan.code || null });
  return res.json({
    ...registrationRefundReview(activity, registration, plan, {
      organizerCancelled: req.body?.organizer_cancelled === true,
    }),
    shared_payment: plan.sharedPayment,
    participant_names: plan.participantNames,
  });
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
    const refundReview = registrationRefundReview(activity, registration, plan, {
      organizerCancelled: req.body?.organizer_cancelled === true,
    });
    const approvedAmount = Number(req.body?.approved_amount);
    if (!Number.isFinite(approvedAmount)
      || Math.abs(approvedAmount - Number(refundReview.recommendation.amount)) >= 0.005) {
      return res.status(409).json({
        error: 'יש לעיין בהחזר המומלץ ולאשר את הסכום לפני ביצוע הזיכוי',
        code: 'refund_amount_approval_required',
        ...refundReview,
      });
    }
    if (refundReview.manual_partial_refund_required) {
      return res.status(409).json({
        error: 'ההחזר המומלץ הוא חלקי. יש לבצע אותו במסמך המקורי ב-iCount; המערכת לא תזכה בטעות את כל העסקה.',
        code: 'manual_partial_refund_required',
        ...refundReview,
      });
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
    res.status(err.status || 502).json({
      error: details || err.message,
      code: err.code,
    });
  }
});

app.post('/api/activities/:id/host-payment/refund-preview', (req, res) => {
  const activity = db.getOne('activities', req.params.id);
  if (!activity) return res.status(404).json({ error: 'Activity not found' });
  const plan = buildHostRefundPlan(db, activity);
  if (!plan.ok) return res.status(400).json({ error: plan.error, code: plan.code || null });
  return res.json(cancellationReviewForPayment({
    activity,
    payment: plan.payment,
    paidAmount: plan.amount,
    participantsCancelled: 1,
    organizerCancelled: req.body?.organizer_cancelled === true,
  }));
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
    const refundReview = cancellationReviewForPayment({
      activity: fresh,
      payment: plan.payment,
      paidAmount: plan.amount,
      participantsCancelled: 1,
      organizerCancelled: req.body?.organizer_cancelled === true,
    });
    const approvedAmount = Number(req.body?.approved_amount);
    if (!Number.isFinite(approvedAmount)
      || Math.abs(approvedAmount - Number(refundReview.recommendation.amount)) >= 0.005) {
      return res.status(409).json({
        error: 'יש לעיין בהחזר המומלץ ולאשר את הסכום לפני ביצוע הזיכוי',
        code: 'refund_amount_approval_required',
        ...refundReview,
      });
    }
    if (refundReview.manual_partial_refund_required) {
      return res.status(409).json({
        error: 'ההחזר המומלץ הוא חלקי. יש לבצע אותו במסמך המקורי ב-iCount.',
        code: 'manual_partial_refund_required',
        ...refundReview,
      });
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

/**
 * Cancelling a whole activity.
 *
 * The money side is deliberately the same machinery as cancelling one
 * participant — same policy review, same iCount document cancellation with a
 * real credit-card refund — only driven once per payment document instead of
 * once per click. What is different is who decided: `organizerCancelled` makes
 * the policy return the full amount, because a trip called off because of
 * weather is not a late cancellation by the customer.
 */

async function refreshCancellationTables() {
  if (!supa.isEnabled()) return;
  const [remoteActivities, remoteRegs, remoteOrders, remotePayments] = await Promise.all([
    supa.getAll('activities'),
    supa.getAll('activity_registrations'),
    supa.getAll('activity_registration_orders'),
    supa.getAll('payments'),
  ]);
  if (remoteActivities) db.set('activities', remoteActivities);
  if (remoteRegs) db.set('activity_registrations', remoteRegs);
  if (remoteOrders) db.set('activity_registration_orders', remoteOrders);
  if (remotePayments) db.set('payments', remotePayments);
}

function organizerCancelReview(activity) {
  return ({ payment, order, paidAmount, participantsCancelled }) =>
    cancellationReviewForPayment({
      activity,
      payment,
      order,
      paidAmount,
      participantsCancelled,
      organizerCancelled: true,
    });
}

/**
 * ניסוח טיוטה לאחד מסעיפי דף האירוע.
 *
 * מחזיר טקסט בלבד — הוא נכנס לשדה בטופס ומי שביקש עורך אותו לפני שמירה.
 * השרת לא נוגע באירוע עצמו, ולכן אין כאן מסלול שבו ניסוח של מודל מגיע לדף
 * החי בלי שאדם ראה אותו.
 */
app.post('/api/activities/draft-copy', async (req, res) => {
  const field = String(req.body?.field || '');
  if (!isDraftableField(field)) {
    return res.status(400).json({ error: 'הסעיף הזה אינו פתוח לניסוח אוטומטי' });
  }
  try {
    const result = await draftActivityCopy({
      field,
      activity: req.body?.activity || {},
      instruction: req.body?.instruction || '',
      tone: req.body?.tone,
      emoji: req.body?.emoji !== false,
      length: req.body?.length,
      generate: async ({ prompt, system }) => {
        const { content, error } = await callGeminiChat({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          systemInstruction: system,
          declarations: [],
        });
        const text = (content?.parts || [])
          .map((part) => String(part.text || ''))
          .filter(Boolean)
          .join('\n');
        return { text, error };
      },
    });
    if (!result.ok) return res.status(result.error.includes('מכסת') ? 429 : 502).json(result);
    res.json(result);
  } catch (err) {
    console.error('activity draft copy error:', err.message);
    res.status(500).json({ error: 'ניסוח ההצעה נכשל' });
  }
});

app.get('/api/activities/:id/cancellation-preview', async (req, res) => {
  const activity = db.getOne('activities', req.params.id);
  if (!activity) return res.status(404).json({ error: 'Activity not found' });
  await refreshCancellationTables();
  const fresh = db.getOne('activities', req.params.id) || activity;
  const summary = summarizeActivityCancellation(db, fresh, organizerCancelReview(fresh));
  res.json({ ...summary, icount_configured: icount.isConfigured() });
});

app.post('/api/activities/:id/cancel', async (req, res) => {
  try {
    const activity = db.getOne('activities', req.params.id);
    if (!activity) return res.status(404).json({ error: 'Activity not found' });
    await refreshCancellationTables();
    const fresh = db.getOne('activities', req.params.id) || activity;
    const summary = summarizeActivityCancellation(db, fresh, organizerCancelReview(fresh));

    if (summary.refund_total > 0 && !icount.isConfigured()) {
      return res.status(503).json({ error: 'מערכת החיוב לא מוגדרת בשרת' });
    }
    // The amount is approved against a number the screen actually showed. If a
    // registration came in between opening the screen and confirming, the total
    // no longer matches and the whole thing stops rather than refunding a
    // figure nobody saw.
    const approvedAmount = Number(req.body?.approved_amount);
    if (!Number.isFinite(approvedAmount)
      || Math.abs(approvedAmount - summary.refund_total) >= 0.005) {
      return res.status(409).json({
        error: 'יש לאשר את סכום הזיכוי המוצג לפני ביטול האירוע',
        code: 'refund_amount_approval_required',
        summary,
      });
    }

    const reason =
      String(req.body?.reason || '').trim() ||
      `ביטול אירוע · ${fresh.name || ''}`.trim();
    const refundedBy = req.crmUser?.email || req.crmUser?.name || null;
    const now = new Date().toISOString();

    // The event stops being an event first. Even if a refund below fails, it is
    // already off the site, off the bot, and out of the wall's activity days.
    let cancelledActivity = fresh;
    if (!activityIsCancelled(fresh)) {
      const updated = db.update('activities', fresh.id, {
        status: 'cancelled',
        registration_enabled: false,
        show_on_site: false,
        updated_at: now,
      });
      if (!updated) return res.status(404).json({ error: 'Activity not found' });
      const durable = await persistCore('activities', updated);
      if (durable?.ok === false) {
        console.error('activity cancel persist failed:', durable.error);
        return res.status(503).json({ error: durable.error || 'שמירת ביטול האירוע נכשלה' });
      }
      cancelledActivity = updated;
    }

    const refunded = [];
    const failed = [];
    const touched = [];

    for (const group of summary.groups) {
      const names = group.names.join(', ');
      try {
        const plan = group.kind === 'host'
          ? buildHostRefundPlan(db, cancelledActivity)
          : buildRegistrationRefundPlan(db, {
            activity: cancelledActivity,
            registration: db.getOne('activity_registrations', group.seed_registration_id),
          });
        if (!plan.ok) {
          failed.push({ names, amount: group.amount, error: plan.error, code: plan.code || null });
          continue;
        }

        let alreadyCancelled = false;
        try {
          const info = await icount.getDocInfo({ doctype: plan.doctype, docnum: plan.docnum });
          const docInfo = info.doc_info || info;
          if (docInfo?.is_cancelled) {
            alreadyCancelled = true;
          } else if (docInfo && docInfo.is_cancellable === false) {
            failed.push({
              names,
              amount: group.amount,
              error: 'המסמך במערכת החיוב לא ניתן לביטול',
            });
            continue;
          }
        } catch (err) {
          console.warn('⚠️ [activity cancel] doc info check failed:', err.message);
        }

        const cancellation = alreadyCancelled
          ? { doctype: plan.doctype, docnum: plan.docnum }
          : await icount.cancelDoc({
            doctype: plan.doctype,
            docnum: plan.docnum,
            reason,
            refundCc: true,
          });

        if (group.kind === 'host') {
          await applyHostRefundMarks({
            db,
            persist: persistCore,
            activity: cancelledActivity,
            payment: plan.payment,
            reason,
            cancellation,
            refundedBy,
          });
        } else {
          const marked = await applyRegistrationRefundMarks({
            db,
            persist: persistCore,
            plan,
            reason,
            cancellation,
            refundedBy,
          });
          for (const registration of marked.registrations) {
            touched.push({
              registration_id: registration.id,
              name: registration.participant_name || 'משתתף',
            });
          }
        }

        refunded.push({
          kind: group.kind,
          names,
          amount: group.amount,
          docnum: cancellation?.docnum || plan.docnum,
          already_cancelled: alreadyCancelled,
        });
      } catch (err) {
        const details = Array.isArray(err.details?.error_details)
          ? err.details.error_details.filter(Boolean).join(' · ')
          : '';
        console.error('activity cancel refund error:', names, err.message, details);
        failed.push({ names, amount: group.amount, error: details || err.message });
      }
    }

    // Places held without money behind them are simply released.
    for (const registrationId of registrationsToRelease(summary)) {
      const registration = db.getOne('activity_registrations', registrationId);
      if (!registration) continue;
      const updated = db.update('activity_registrations', registrationId, {
        status: 'cancelled',
        notes: [registration.notes, reason].filter(Boolean).join(' · '),
        updated_at: now,
      });
      if (updated) {
        await persistCore('activity_registrations', updated);
        touched.push({
          registration_id: updated.id,
          name: updated.participant_name || 'משתתף',
        });
      }
    }

    const refundedAmount = refunded.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    console.log(
      `🚫 [activity] cancelled ${cancelledActivity.id} · refunded ${refunded.length}/${summary.groups.length} docs · ${refundedAmount} ₪`
    );

    res.json({
      success: failed.length === 0,
      activity: activityForRequest(req, cancelledActivity),
      refunded,
      failed,
      refunded_amount: Math.round(refundedAmount * 100) / 100,
      cancelled_registrations: touched,
      notify_candidates: touched,
    });

    syncActivityToGoogle(cancelledActivity).catch((err) =>
      console.error('Background Google push failed:', err.message)
    );
    applyVacationAttendanceForActivities(fresh, cancelledActivity).catch((err) =>
      console.error('Vacation attendance sync failed:', err.message)
    );
  } catch (err) {
    console.error('activity cancel error:', err.message);
    res.status(500).json({ error: err.message || 'ביטול האירוע נכשל' });
  }
});

/**
 * Telling the registrants. Deliberately a separate call made after the refunds
 * are visibly done — a message saying "you have been refunded" must not go out
 * before the money actually moved.
 */
app.post('/api/activities/:id/notify-cancelled', async (req, res) => {
  try {
    const activity = db.getOne('activities', req.params.id);
    if (!activity) return res.status(404).json({ error: 'Activity not found' });
    const ids = Array.isArray(req.body?.registration_ids) ? req.body.registration_ids : [];
    if (!ids.length) return res.status(400).json({ error: 'לא נבחרו נרשמים' });

    const message = String(req.body?.message || '').trim()
      || `שלום, האירוע «${activity.name || ''}» בתאריך ${String(activity.date || '').slice(0, 10).split('-').reverse().join('.')} בוטל.`
        + ' התשלום זוכה במלואו ויוחזר לאמצעי התשלום שבו שולם. מצטערים על אי הנוחות.';

    const sent = [];
    const skipped = [];
    const seenPhones = new Set();

    for (const registrationId of ids) {
      const registration = db.getOne('activity_registrations', registrationId);
      if (!registration) continue;
      const name = registration.participant_name || 'משתתף';
      const parent = registration.parent_id ? db.getOne('parents', registration.parent_id) : null;
      const phone = registration.phone || parent?.phone || '';
      if (!phone) {
        skipped.push({ name, reason: 'אין מספר טלפון' });
        continue;
      }
      const key = String(phone).replace(/\D/g, '');
      if (seenPhones.has(key)) continue;
      seenPhones.add(key);

      // Free-form only travels inside Meta's 24-hour window. Saying so per
      // person is the point: whoever is listed here did not get told.
      if (parent && !canSendFreeform(parent, 'whatsapp')) {
        skipped.push({ name, phone, reason: 'חלון 24 השעות סגור — צריך לפנות אליו ידנית' });
        continue;
      }
      try {
        const result = await whatsappService.sendTextMessage(phone, message, false, {
          clip: false,
          parentId: parent?.id || null,
          source: 'activity_cancelled',
        });
        if (result?.success) sent.push({ name, phone });
        else skipped.push({ name, phone, reason: result?.error || 'שליחה נכשלה' });
      } catch (err) {
        skipped.push({ name, phone, reason: err.message || 'שליחה נכשלה' });
      }
    }

    res.json({ success: skipped.length === 0, sent, skipped, message });
  } catch (err) {
    console.error('activity cancel notify error:', err.message);
    res.status(500).json({ error: err.message || 'שליחת ההודעות נכשלה' });
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

    const documentUrl = safeIcountDocumentUrl(url);
    if (!documentUrl) return res.status(502).json({ error: 'כתובת מסמך החיוב אינה מאושרת' });
    const upstream = await fetch(documentUrl);
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

function icountCustomerDisplayName(client) {
  return String(
    client?.client_name ||
    client?.company_name ||
    [client?.fname, client?.lname].filter(Boolean).join(' ') ||
    ''
  ).trim();
}

/**
 * Resolve an event payer into one CRM card and one iCount client.
 * Matching happens before any write, so retrying cannot create a duplicate.
 */
app.post('/api/activities/:id/host-customer', async (req, res) => {
  try {
    const activity = db.getOne('activities', req.params.id);
    if (!activity) return res.status(404).json({ error: 'האירוע לא נמצא' });
    if (!icount.isConfigured()) {
      return res.status(503).json({ error: 'iCount אינו מוגדר ולכן לא ניתן לקשר לקוח בבטחה' });
    }

    const suppliedName = String(req.body?.name || '').trim();
    const phone = String(req.body?.phone || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length < 9) {
      return res.status(400).json({ error: 'יש להזין מספר טלפון תקין' });
    }

    await readTable('parents');
    const parents = db.get('parents') || [];
    const existingByPhone = parents.find((parent) => parentPhonesMatch(parent.phone, phone)) || null;

    const icountMatches = await icount.findClientsByContact({ phone, email });
    if (icountMatches.length > 1) {
      return res.status(409).json({
        error: 'נמצאו כמה לקוחות תואמים ב-iCount. יש לעדכן שם את הטלפון או המייל ולנסות שוב.',
      });
    }

    const icountMatch = icountMatches[0] || null;
    const linkedParent = icountMatch
      ? parents.find((parent) => (
        String(parent.icount_client_id || '') === String(icountMatch.client_id) ||
        String(parent.id) === String(icountMatch.custom_client_id || '')
      )) || null
      : null;

    if (linkedParent && existingByPhone && linkedParent.id !== existingByPhone.id) {
      return res.status(409).json({
        error: 'הטלפון ותיק iCount מקושרים לשני לקוחות שונים. יש למזג את הכרטיסים לפני השליחה.',
      });
    }

    const matchedParent = linkedParent || existingByPhone;
    if (
      icountMatch &&
      matchedParent?.icount_client_id &&
      String(matchedParent.icount_client_id) !== String(icountMatch.client_id)
    ) {
      return res.status(409).json({
        error: 'כרטיס הלקוח כבר מקושר לתיק iCount אחר. לא בוצע שינוי בקישור.',
      });
    }

    const resolvedName = suppliedName || icountCustomerDisplayName(icountMatch);
    if (!resolvedName) {
      return res.status(400).json({ error: 'יש להזין את שם הלקוח' });
    }

    let parent = matchedParent;
    const existedInCrm = !!parent;
    if (parent) {
      parent = db.update('parents', parent.id, {
        name: parent.name || resolvedName,
        phone,
        email: parent.email || email || String(icountMatch?.email || '').trim(),
        source: parent.source || (icountMatch ? 'icount' : 'event'),
      }) || parent;
    } else {
      parent = db.upsertParentByPhone(
        resolvedName,
        phone,
        email || String(icountMatch?.email || '').trim(),
        { source: icountMatch ? 'icount' : 'event', channel: 'event', status: 'lead_new' }
      );
    }

    if (icountMatch) {
      const matchedClientId = String(icountMatch.client_id);
      parent = db.update('parents', parent.id, { icount_client_id: matchedClientId }) || {
        ...parent,
        icount_client_id: matchedClientId,
      };
    }

    const synced = await syncParentToIcount(parent);
    parent = synced.parent;
    const durableParent = await persistCore('parents', parent);
    if (durableParent?.ok === false) {
      return res.status(503).json({ error: durableParent.error || 'שמירת הלקוח נכשלה' });
    }

    const updatedActivity = db.update('activities', activity.id, {
      host_parent_id: parent.id,
      host_name: parent.name || resolvedName,
      host_phone: parent.phone || phone,
      host_email: parent.email || email,
      contact_name: parent.name || resolvedName,
      contact_phone: parent.phone || phone,
    });
    const durableActivity = await persistCore('activities', updatedActivity);
    if (durableActivity?.ok === false) {
      return res.status(503).json({ error: durableActivity.error || 'קישור הלקוח לאירוע נכשל' });
    }

    return res.status(existedInCrm ? 200 : 201).json({
      customer: parent,
      activity: updatedActivity,
      resolution: icountMatch
        ? (existedInCrm ? 'linked' : 'imported')
        : (existedInCrm ? 'synced' : 'created'),
    });
  } catch (error) {
    console.error('POST activity host-customer failed:', error.message);
    return res.status(502).json({
      error: 'בדיקת הלקוח מול iCount נכשלה. לא בוצעה יצירה נוספת כדי למנוע כפילות.',
    });
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
  updated = freezeHostCharge(updated);
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

    const sendHostPayment = activity.registration_mode === 'host_pays'
      && req.body?.link_type !== 'participant';
    const manualRecipient = req.body?.manual_recipient === true;
    const recipient = resolveEventHostRecipient({
      parents: db.get('parents') || [],
      activity,
      requestedParentId: req.body?.host_parent_id,
      requestedPhone: req.body?.phone,
      manualRecipient,
    });
    const hostParentId = recipient.parentId;
    if (!hostParentId && !sendHostPayment) {
      return res.status(400).json({
        error: 'יש לבחור מזמין מתוך לקוחות המערכת לפני השליחה',
      });
    }

    const parent = recipient.parent;
    if (hostParentId && !parent) {
      return res.status(400).json({ error: 'המזמין שנבחר לא נמצא ברשימת הלקוחות' });
    }

    const hostPhone = normalizePhone(recipient.phone);
    if (!hostPhone) {
      return res.status(400).json({ error: 'יש להזין מספר טלפון לשליחה בוואטסאפ' });
    }

    const hostName = parent?.name || String(req.body?.name || '').trim() || activity.host_name || activity.contact_name || '';
    const hostEmail = String(
      req.body?.email || parent?.email || activity.host_email || ''
    ).trim();

    // Keep snapshot fields in sync with the CRM customer
    activity = db.update('activities', activity.id, {
      host_parent_id: parent?.id || null,
      host_name: hostName,
      host_phone: parent?.phone || hostPhone,
      host_email: hostEmail || activity.host_email || '',
      contact_name: hostName,
      contact_phone: parent?.phone || hostPhone,
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
    if (sendHostPayment) {
      // The send button lives inside the edit form, so the number and pricing
      // visible on screen may not have been saved with "Apply" yet. Persist the
      // billing snapshot supplied by that same screen before freezing the link.
      const charge = req.body?.charge && typeof req.body.charge === 'object'
        ? req.body.charge
        : null;
      if (charge) {
        const nonNegativeMoney = (value, fallback) => {
          const number = Number(value);
          return Number.isFinite(number) && number >= 0 ? number : fallback;
        };
        activity = db.update('activities', activity.id, {
          charge_basis: normalizeChargeBasis(charge.charge_basis),
          price: nonNegativeMoney(charge.price, Number(activity.price) || 0),
          price_includes_vat: normalizePriceIncludesVat(charge.price_includes_vat),
          min_participants: normalizeCount(charge.min_participants),
          extra_participant_price: normalizeMoney(charge.extra_participant_price),
          max_charge: normalizeMoney(charge.max_charge),
          host_charge_participants: normalizeCount(charge.host_charge_participants),
        }) || activity;
      }
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
      // הסכום נקבע כאן, לפני שהקישור יוצא — ולא כשהמזמין פותח אותו.
      activity = freezeHostCharge(activity);
      const chargePersisted = await persistCore('activities', activity);
      if (chargePersisted?.ok === false) {
        return res.status(503).json({
          error: chargePersisted.error || 'שמירת סכום התשלום נכשלה',
        });
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
      const inWindow = parent ? canSendFreeform(parent, 'whatsapp') : false;
      const preferredMetaName = sendHostPayment
        ? EVENT_HOST_PAYMENT_TEMPLATE
        : EVENT_PARTICIPANT_LINK_TEMPLATE;
      const localTpl = resolveEventTemplate(db, sendHostPayment ? 'host' : 'participant');
      const metaName = localTpl?.meta_name || preferredMetaName;
      const freeformMsg = sendHostPayment
        ? (
          `שלום${hostName ? ` ${hostName}` : ''}!\n` +
          `קישור פרטי למילוי פרטים ולתשלום עבור "${activity.name}":\n${url}`
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
              parentId: parent?.id || null,
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
          parentId: parent?.id || null,
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
      host_parent_id: parent?.id || null,
      host_name: hostName,
      host_phone: parent?.phone || hostPhone,
      requires_customer_details: !parent,
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
    return res.json(activityForRequest(req, {
      categories: TEMPLATE_CATEGORIES,
      groups: groupTemplatesByCategory(rows),
      templates: rows,
    }));
  }
  res.json(activityForRequest(req, rows));
});

app.get('/api/activity-templates/categories', (_req, res) => {
  res.json(TEMPLATE_CATEGORIES);
});

app.post('/api/activity-templates', async (req, res) => {
  const body = req.body || {};
  try {
    rejectActivitySensitiveChanges(req, body, {});
  } catch (error) {
    return res.status(error.statusCode || 403).json({ error: error.message });
  }
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
  res.status(201).json(activityForRequest(req, record));
});

app.put('/api/activity-templates/:id', async (req, res) => {
  const existing = db.getOne('activity_templates', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Template not found' });
  try {
    rejectActivitySensitiveChanges(req, req.body || {}, existing);
  } catch (error) {
    return res.status(error.statusCode || 403).json({ error: error.message });
  }
  const payload = normalizeActivityTemplatePayload({ ...existing, ...(req.body || {}) });
  if (!payload.name) return res.status(400).json({ error: 'חסר שם תבנית' });
  const updated = db.update('activity_templates', existing.id, payload);
  if (!updated) return res.status(404).json({ error: 'Template not found' });
  const durable = await persistCore('activity_templates', updated);
  if (durable?.ok === false) {
    console.error('activity template update persist failed:', durable.error);
    return res.status(503).json({ error: durable.error || 'שמירת התבנית למסד נכשלה' });
  }
  res.json(activityForRequest(req, updated));
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
  res.json(activityForRequest(req, activityDraftFromTemplate(template, { date })));
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
  // אירוע שמציע ימים בודדים חייב מחיר ליום. בלי זה ההרשמה החלקית הייתה
  // נחסמת רק ברגע התשלום — הרבה אחרי שהאפשרות כבר פורסמה ללקוחות.
  if (payload.allow_single_day && !(Number(payload.single_day_price) > 0)) {
    return res.status(400).json({ error: 'הרשמה ליום בודד מחייבת עלות ליום בודד' });
  }
  const record = db.insert('activities', payload);
  const durable = await persistCore('activities', record);
  if (durable?.ok === false) {
    console.error('template create-activity persist failed:', durable.error);
    return res.status(503).json({ error: durable.error || 'שמירת האירוע למסד נכשלה' });
  }
  res.status(201).json(activityForRequest(req, record));
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
    if (activityIsArchived(activity)) {
      return res.status(410).json({ error: 'האירוע הועבר לארכיון וקישור התשלום אינו פעיל' });
    }
    await readTable('parents');
    const hostParent = activity.host_parent_id
      ? (db.get('parents') || []).find((parent) => String(parent.id) === String(activity.host_parent_id)) || null
      : null;
    const theme = normalizeActivityTheme(
      activity.registration_theme || activity.theme || {}
    );
    const cancellationPolicy = resolvePolicyFor(db, activity);
    res.json({
      id: activity.id,
      name: activity.name,
      date: activity.date,
      start_time: activity.start_time,
      location: activity.location || '',
      host_name: activity.host_name || activity.contact_name || '',
      host_phone: activity.host_phone || activity.contact_phone || '',
      requires_customer_details: !hostParent,
      price: Number(activity.price) || 0,
      price_includes_vat: normalizePriceIncludesVat(activity.price_includes_vat),
      // הסכום לתשלום נקבע כאן ולא בדפדפן: המזמין צריך לראות בדיוק את מה שיחויב,
      // ופירוט מספר המשתתפים הוא ההסבר מאיפה הסכום הגיע.
      charge_amount: hostChargeFor(activity),
      charge_basis: normalizeChargeBasis(activity.charge_basis),
      charge_participants: normalizeCount(activity.host_charge_participants),
      charge_ready: hostChargeFor(activity) > 0,
      payment_status: activity.payment_status || 'unpaid',
      cover_image: theme.cover_image || '',
      cover_position: theme.cover_position || '50% 50%',
      description: activity.registration_page_body || activity.description || '',
      audience: activity.audience || '',
      included: activity.included || '',
      what_to_bring: activity.what_to_bring || '',
      important_info: activity.important_info || '',
      cancellation_policy: cancellationPolicy?.snapshot || null,
    });
  } catch (err) {
    console.error('host payment lookup error:', err.message);
    res.status(503).json({ error: err.message || 'טעינת קישור התשלום נכשלה' });
  }
});

app.post('/api/public/host-payments/:token/customer', publicFormRateLimit, async (req, res) => {
  try {
    const { activity, storeAvailable } = await findActivityByHostPaymentToken(req.params.token);
    if (!storeAvailable) {
      const unavailable = publicStoreUnavailableError();
      return res.status(unavailable.status).json(unavailable.body);
    }
    if (!activity) return res.status(404).json({ error: 'קישור התשלום לא נמצא' });
    if (activityIsArchived(activity)) {
      return res.status(410).json({ error: 'האירוע הועבר לארכיון וקישור התשלום אינו פעיל' });
    }
    if (activity.payment_status === 'paid') {
      return res.json({ success: true, alreadyPaid: true, requires_customer_details: false });
    }

    const lockedPhone = activity.host_phone || activity.contact_phone || '';
    const profile = normalizeEventHostProfile(req.body || {}, lockedPhone);
    await readTable('parents');
    const parents = db.get('parents') || [];
    let parent = matchEventHostParent(parents, profile);

    const icountMatches = await icount.findClientsByContact({
      phone: profile.phone,
      email: profile.email,
    });
    if (icountMatches.length > 1) {
      return res.status(409).json({
        error: 'נמצאו כמה לקוחות תואמים ב-iCount. יש לפנות לצוות לפני התשלום.',
      });
    }
    const icountMatch = icountMatches[0] || null;
    const linkedParent = icountMatch
      ? parents.find((row) => (
        String(row.icount_client_id || '') === String(icountMatch.client_id) ||
        String(row.id) === String(icountMatch.custom_client_id || '')
      )) || null
      : null;
    if (parent && linkedParent && String(parent.id) !== String(linkedParent.id)) {
      return res.status(409).json({
        error: 'הפרטים משויכים לשני כרטיסי לקוח שונים. יש לפנות לצוות לפני התשלום.',
      });
    }
    parent = parent || linkedParent;
    if (
      parent?.icount_client_id &&
      icountMatch?.client_id &&
      String(parent.icount_client_id) !== String(icountMatch.client_id)
    ) {
      return res.status(409).json({
        error: 'כרטיס הלקוח כבר מקושר לתיק iCount אחר. יש לפנות לצוות לפני התשלום.',
      });
    }

    const existedInCrm = !!parent;
    if (parent) {
      parent = db.update('parents', parent.id, {
        name: profile.name,
        lastName: profile.lastName,
        idNumber: profile.idNumber,
        phone: profile.phone,
        email: profile.email,
        city: profile.city,
        gender: profile.gender,
        birthDate: profile.birthDate,
        relation: parent.relation || profile.relation,
        source: parent.source || (icountMatch ? 'icount' : 'event'),
      }) || parent;
    } else {
      parent = db.upsertParentByPhone(profile.name, profile.phone, profile.email, {
        lastName: profile.lastName,
        idNumber: profile.idNumber,
        city: profile.city,
        gender: profile.gender,
        source: icountMatch ? 'icount' : 'event',
        channel: 'event',
        status: 'lead_new',
      });
      parent = db.update('parents', parent.id, {
        birthDate: profile.birthDate,
        relation: profile.relation,
      }) || parent;
    }

    if (icountMatch) {
      parent = db.update('parents', parent.id, {
        icount_client_id: String(icountMatch.client_id),
      }) || parent;
    } else {
      const synced = await syncParentToIcount(parent);
      parent = synced.parent;
    }
    const durableParent = await persistCore('parents', parent);
    if (durableParent?.ok === false) {
      return res.status(503).json({ error: durableParent.error || 'שמירת פרטי הלקוח נכשלה' });
    }

    const updatedActivity = db.update('activities', activity.id, {
      host_parent_id: parent.id,
      host_name: parent.name,
      host_phone: parent.phone,
      host_email: parent.email,
      contact_name: parent.name,
      contact_phone: parent.phone,
    }) || activity;
    const durableActivity = await persistCore('activities', updatedActivity);
    if (durableActivity?.ok === false) {
      return res.status(503).json({ error: durableActivity.error || 'קישור הלקוח לאירוע נכשל' });
    }

    return res.status(existedInCrm ? 200 : 201).json({
      success: true,
      customer: {
        id: parent.id,
        name: parent.name,
        phone: parent.phone,
        email: parent.email,
      },
      requires_customer_details: false,
      resolution: icountMatch
        ? (existedInCrm ? 'linked' : 'imported')
        : (existedInCrm ? 'updated' : 'created'),
    });
  } catch (err) {
    console.error('public host customer save error:', err.message);
    res.status(err.status || 503).json({
      error: err.status ? err.message : 'שמירת פרטי הלקוח נכשלה. לא נוצרה כפילות.',
    });
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
    if (activityIsArchived(activity)) {
      return res.status(410).json({ error: 'האירוע הועבר לארכיון וקישור התשלום אינו פעיל' });
    }
    if (activity.payment_status === 'paid') {
      return res.json({ success: true, alreadyPaid: true });
    }
    const cancellationPolicy = resolvePolicyFor(db, activity);
    if (cancellationPolicy && req.body?.cancellationPolicyAccepted !== true) {
      return res.status(400).json({
        error: 'יש לקרוא ולאשר את מדיניות הביטול לפני המעבר לתשלום',
        code: 'cancellation_policy_acceptance_required',
      });
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
    // הסכום שהוקפא כשהקישור נוצר. אירוע ותיק שאין לו סכום שמור נופל לחישוב חי,
    // כך שכל קישור שכבר בידי מזמין ממשיך לעבוד בדיוק כמו קודם.
    const amount = hostChargeFor(activity);
    if (!(amount > 0)) {
      // מדרגה שלא נמצאה, כלל שנמחק, או אירוע בלי מחיר. עדיף שהמזמין יראה שהמחיר
      // טרם נקבע מאשר שיישלח לסליקה על סכום שאיש לא קבע.
      return res.status(409).json({
        error: 'המחיר לאירוע טרם נקבע. נציג יחזור אליכם עם הסכום המדויק.',
        code: 'activity_price_undetermined',
      });
    }
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
      policy_snapshot: cancellationPolicy?.snapshot || null,
      updated_at: new Date().toISOString(),
    }) || payment;
    let policyAcceptance = null;
    if (cancellationPolicy) {
      policyAcceptance = (db.get('cancellation_acceptances') || []).find((acceptance) => (
        String(acceptance.payment_id || '') === String(payment.id)
        && String(acceptance.policy_version_id || '') === String(cancellationPolicy.version.id)
      )) || await recordPolicyAcceptance(db, persistCore, {
        policy: cancellationPolicy.policy,
        version: cancellationPolicy.version,
        parentId: parent.id,
        activityId: activity.id,
        paymentId: payment.id,
        acceptedVia: 'host',
      });
      payment = db.update('payments', payment.id, {
        cancellation_acceptance_id: policyAcceptance?.id || null,
        updated_at: new Date().toISOString(),
      }) || payment;
    }
    const paymentPersisted = await persistCore('payments', payment);
    if (paymentPersisted?.ok === false) throw new Error(paymentPersisted.error);
    const updatedActivity = db.update('activities', activity.id, {
      host_payment_id: payment.id,
    }) || activity;
    const activityPersisted = await persistCore('activities', updatedActivity);
    if (activityPersisted?.ok === false) throw new Error(activityPersisted.error);
    res.json({ success: true, paymentUrl, cancellationAcceptanceId: policyAcceptance?.id || null });
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
    const cancellationPolicy = resolvePolicyFor(db, activity);
    res.json({
      ...publicRegistrationPayload(activity, regs),
      form_template: template,
      cancellation_policy: cancellationPolicy?.snapshot || null,
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
/**
 * @param {string} rawPhone
 * @param {string} idNumber government identity number typed before OTP
 * @param {string} templateSlug איזו הצהרה נחתמת בפעילות הזאת. „יש הצהרה בתוקף”
 *   היא תשובה ביחס לטופס מסוים: מי שחתם על הצהרת הקיר לא קרא מעולם את הסעיפים
 *   על גלישה על חבל, ולכן הוא אינו מכוסה לטיול.
 */
async function loadPublicHousehold(rawPhone, idNumber = '', templateSlug = '') {
  const phone = normalizePhone(rawPhone || '');
  const idDigits = normalizedIdNumber(idNumber);
  if (!phone || phone.replace(/\D/g, '').length < 9 || idDigits.length < 5) {
    return {
      found: false, identity_status: 'incomplete', parent: null,
      children: [], adults: [], adult_health_valid: false,
    };
  }
  if (supa.isEnabled()) {
    const [remoteParents, remoteStudents, remoteDecls, remoteWaivers, remoteHolds, remoteGuardians, remoteHouseholds, remoteMembers] = await Promise.all([
      supa.getAll('parents'),
      supa.getAll('students'),
      supa.getAll('health_declarations'),
      supa.getAll('participation_waivers'),
      supa.getAll('health_holds'),
      supa.getAll('student_guardians'),
      supa.getAll('households'),
      supa.getAll('household_members'),
    ]);
    if (remoteParents) db.set('parents', remoteParents);
    if (remoteStudents) db.set('students', remoteStudents);
    if (remoteDecls) db.set('health_declarations', remoteDecls);
    if (remoteWaivers) db.set('participation_waivers', remoteWaivers);
    if (remoteHolds) db.set('health_holds', remoteHolds);
    if (remoteGuardians) db.set('student_guardians', remoteGuardians);
    if (remoteHouseholds) db.set('households', remoteHouseholds);
    if (remoteMembers) db.set('household_members', remoteMembers);
  }
  const identity = resolvePublicIdentity(db.get('parents') || [], { phone, idNumber: idDigits });
  if (identity.status === 'review_required') {
    return {
      found: false,
      identity_status: 'review_required',
      review_required: true,
      parent: null,
      children: [],
      adults: [],
      adult_health_valid: false,
      error: 'הפרטים תואמים לרשומות שונות או אינם חד־משמעיים. לא נפתח תיק חדש; יש לפנות לצוות לבדיקה.',
    };
  }
  const parent = identity.status === 'found' ? identity.parent : null;
  if (!parent) {
    return {
      found: false, identity_status: 'new', parent: null,
      children: [], adults: [], adult_health_valid: false,
    };
  }
  const wantedSlug = String(templateSlug || '').trim().toLowerCase();
  const scope = normalizeParticipationScope(wantedSlug);
  const explicitHousehold = await ensureHouseholdForParent(db, persistCore, parent.id);
  // The household's children, not only the ones whose card names this parent as
  // primary: after a merge every child belongs to both parents, and a public
  // form that lists one parent's half asks a family to register a child twice.
  const memberOf = (student) => {
    const eligibility = participationEligibility(db, { studentId: student.id, scope });
    return {
      id: student.id,
      name: String(student.name || '').trim(),
      birthDate: student.birthDate || '',
      gender: student.gender || '',
      is_adult: student.isAdult === true,
      health_valid: eligibility.eligible,
      health_document_valid: eligibility.health.state === 'valid',
      waiver_valid: eligibility.waiver.state === 'valid',
      document_status: eligibility.status,
      health_signed_at: eligibility.health.signed_at,
      waiver_signed_at: eligibility.waiver.signed_at,
    };
  };
  const byName = (a, b) => a.name.localeCompare(b.name, 'he');

  const children = childrenOfParent(db, parent.id)
    .filter((student) => student.isAdult !== true)
    .map(memberOf)
    .filter((child) => child.name)
    .sort(byName);

  // Grown-ups on the file are participants too. A trip is booked by a family
  // that climbs together, and offering only the children meant a parent could
  // not put themselves on the list at all.
  const adultStudents = childrenOfParent(db, parent.id)
    .filter((student) => student.isAdult === true)
    .map(memberOf)
    .filter((adult) => adult.name)
    .sort(byName);

  const adultStudent = childrenOfParent(db, parent.id).find((student) => {
    if (student.isAdult !== true) return false;
    const parentName = String(parent.name || '').trim().toLowerCase();
    const studentName = String(student.name || '').trim().toLowerCase();
    return !parentName || studentName === parentName;
  }) || childrenOfParent(db, parent.id).find((student) => student.isAdult === true);
  const graph = expandHousehold(db, parent.id);
  const householdParents = (graph.parentIds || [parent.id])
    .map((id) => db.getOne('parents', id))
    .filter(Boolean);
  const representedParentIds = new Set(adultStudents.map((adult) => {
    const student = db.getOne('students', adult.id);
    return student?.parentId || null;
  }).filter(Boolean));
  const adults = [
    ...adultStudents,
    ...householdParents
      .filter((candidate) => !representedParentIds.has(candidate.id))
      .map((candidate) => ({
        id: `parent:${candidate.id}`,
        parent_member_id: candidate.id,
        name: candidate.name || '',
        birthDate: '',
        gender: candidate.gender || '',
        is_adult: true,
        profile_status: candidate.id === parent.id ? 'complete' : 'pending_profile',
        health_valid: false,
        health_document_valid: false,
        waiver_valid: false,
        document_status: 'pending_profile',
      })),
  ].sort(byName);
  const adultEligibility = adultStudent
    ? participationEligibility(db, { studentId: adultStudent.id, scope })
    : null;

  return {
    found: true,
    identity_status: 'found',
    parent: {
      id: parent.id,
      name: parent.name || '',
      lastName: parent.lastName || '',
      relation: parent.relation || '',
      idNumber: parent.idNumber || '',
      email: parent.email || '',
      city: parent.city || '',
    },
    children,
    adults,
    household_id: explicitHousehold.id,
    adult_student_id: adultStudent?.id || null,
    adult: adultStudent ? memberOf(adultStudent) : null,
    adult_health_valid: !!adultEligibility?.eligible,
    adult_health_document_valid: adultEligibility?.health.state === 'valid',
    adult_waiver_valid: adultEligibility?.waiver.state === 'valid',
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
    const verified = requireVerifiedPublicPhone(req, res, req.query.phone);
    if (!verified) return;
    if (supa.isEnabled()) {
      const [remoteStudents, remoteParents, remoteGuardians, remoteDecls, remoteWaivers, remoteHolds] = await Promise.all([
        supa.getAll('students'),
        supa.getAll('parents'),
        supa.getAll('student_guardians'),
        supa.getAll('health_declarations'),
        supa.getAll('participation_waivers'),
        supa.getAll('health_holds'),
      ]);
      if (remoteStudents) db.set('students', remoteStudents);
      if (remoteParents) db.set('parents', remoteParents);
      if (remoteGuardians) db.set('student_guardians', remoteGuardians);
      if (remoteDecls) db.set('health_declarations', remoteDecls);
      if (remoteWaivers) db.set('participation_waivers', remoteWaivers);
      if (remoteHolds) db.set('health_holds', remoteHolds);
    }
    // Children already on the caller's own card are the household lookup's job.
    const ownParent = findParentForOnboard({ phone: normalizePhone(req.query.phone || '') });
    const matches = findChildMatches(db, {
      name: req.query.name,
      birthDate: req.query.birthDate,
      idNumber: req.query.idNumber,
      excludeParentId: ownParent?.id || null,
    });
    const matched = matches.length === 1 ? matches[0].student : null;
    // Scoped to the form being filled: a child linked from another family is
    // covered for the wall, not for a trip whose risks that signature never
    // mentioned. The submit enforces the same rule — without this the form
    // would promise a reuse the server then refuses.
    const wantedSlug = String(req.query.templateSlug || '').trim().toLowerCase();
    const eligibility = matched
      ? participationEligibility(db, {
          studentId: matched.id,
          scope: normalizeParticipationScope(wantedSlug || 'wall'),
        })
      : null;
    res.json(publicChildMatchPayload(matches, {
      healthValid: !!eligibility?.eligible,
      healthDocumentValid: eligibility?.health.state === 'valid',
      waiverValid: eligibility?.waiver.state === 'valid',
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
    const verified = requireVerifiedPublicPhone(req, res, req.query.phone);
    if (!verified) return;
    if (supa.isEnabled()) {
      const [remoteParents, remoteStudents, remoteGuardians, remoteMembers] = await Promise.all([
        supa.getAll('parents'),
        supa.getAll('students'),
        supa.getAll('student_guardians'),
        supa.getAll('household_members'),
      ]);
      if (remoteParents) db.set('parents', remoteParents);
      if (remoteStudents) db.set('students', remoteStudents);
      if (remoteGuardians) db.set('student_guardians', remoteGuardians);
      if (remoteMembers) db.set('household_members', remoteMembers);
    }
    const ownParent = findParentForOnboard({ phone: normalizePhone(req.query.phone || '') });
    // A known phone can still belong to a parent whose spouse and children sit
    // on a separate card. Exclude the caller's current household and offer any
    // other household with the same surname for explicit confirmation.
    res.json(publicFamilyCandidatesPayload(familyCandidates(db, {
      lastName: req.query.lastName,
      excludeParentId: ownParent?.id || null,
    })));
  } catch (err) {
    console.error('public family check error:', err.message);
    res.json({ families: [] });
  }
});

app.get('/api/public/activities/:slug/household', publicFormRateLimit, async (req, res) => {
  try {
    const verified = requireVerifiedPublicPhone(req, res, req.query.phone);
    if (!verified) return;
    const { activity, storeAvailable } = await findActivityBySlugFresh(req.params.slug);
    if (!storeAvailable) {
      const unavailable = publicStoreUnavailableError();
      return res.status(unavailable.status).json(unavailable.body);
    }
    if (!activity) return res.status(404).json({ error: 'הפעילות לא נמצאה' });
    // Judged against the declaration this activity actually calls for.
    const template = declarationTemplateForActivity(db, activity, resolveDeclarationTemplate);
    const household = await loadPublicHousehold(req.query.phone, req.query.idNumber, template?.slug);
    res.status(household.review_required ? 409 : 200).json(household);
  } catch (err) {
    console.error('public activity household error:', err.message);
    res.status(500).json({ error: err.message || 'טעינת פרטי הלקוח נכשלה' });
  }
});

/**
 * The signatures, filed the moment they are given — before the payment screen.
 * A family that signed and never paid still exists in the CRM with its signed
 * documents; the booking itself (order, held places, payment) happens only in
 * /register below, which reuses the documents this call saved instead of
 * asking anyone to sign twice.
 */
app.post('/api/public/activities/:slug/save-documents', publicFormRateLimit, async (req, res) => {
  try {
    const verified = requireVerifiedPublicPhone(req, res, req.body?.parent?.phone);
    if (!verified) return;
    const identity = requirePublicIdentityPair(req, res, verified, req.body?.parent || {});
    if (!identity) return;
    const { activity, storeAvailable } = await findActivityBySlugFresh(req.params.slug);
    if (!storeAvailable) {
      const unavailable = publicStoreUnavailableError();
      return res.status(unavailable.status).json(unavailable.body);
    }
    if (!activity) return res.status(404).json({ error: 'הפעילות לא נמצאה' });
    if (!registrationIsOpen(activity)) {
      return res.status(400).json({ error: 'ההרשמה לפעילות זו סגורה' });
    }
    const clearance = await uploadClearanceFiles((req.body || {}).participants || []);
    if (clearance.error) return res.status(clearance.status).json({ error: clearance.error });
    for (const upload of clearance.uploads) {
      const participant = req.body?.participants?.[upload.participantIndex];
      if (participant) participant.medicalClearanceDocumentId = upload.clientDocumentId;
    }
    const template = declarationTemplateForActivity(db, activity, resolveDeclarationTemplate);
    const crm = await saveCrmParticipants({
      db,
      persist: persistCore,
      parent: req.body?.parent || {},
      participants: (req.body?.participants || []).filter(
        (participant) => participant?.defer_documents !== true && participant?.deferDocuments !== true
      ),
      template,
      activityId: activity.id,
      // There is no order yet — it is created when they actually book. The
      // registration links these documents then, through the reuse path.
      orderId: null,
      participationScope: scopeForActivity(activity),
      phoneVerification: verifiedPhoneEvidence(verified),
      evidenceContext: { requestContext: requestEvidence(req) },
      source: leadSourceFromActivityType(activity.type, activity.event_kind),
      onStudentCreated: (student, parent) => automationsService.triggerEvent('new_lead', {
        ...student,
        phone: parent.phone,
        parentName: parent.name,
      }),
      onStudentStatusChanged: (student) => automationsService.triggerEvent('status_changed', {
        ...student,
        new_status: REGISTRATION_STATUS.DETAILS_COMPLETED,
      }),
    });
    await fileClearanceDocuments(clearance.uploads, {
      parentId: crm.parent?.id || null,
      findTarget: (upload) => {
        const match = (crm.participants || []).find((p) => p.name === upload.name);
        return {
          studentId: match?.student?.id || null,
          declarationId: match?.declaration?.id || null,
        };
      },
    });
    touchGoogleContacts();
    // The token is deliberately not consumed: the same verification still has
    // to authorize the booking call that follows this one.
    res.status(201).json({
      success: true,
      signedDocuments: (crm.participants || []).map((participant) => ({
        student: participant.student,
        health: participant.healthCreated ? participant.healthDeclaration : null,
        waiver: participant.waiverCreated ? participant.waiver : null,
      })),
    });
  } catch (err) {
    console.error('public activity save-documents error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/public/activities/:slug/register', publicFormRateLimit, async (req, res) => {
  try {
    const verified = requireVerifiedPublicPhone(req, res, req.body?.parent?.phone);
    if (!verified) return;
    const identity = requirePublicIdentityPair(req, res, verified, req.body?.parent || {});
    if (!identity) return;
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
    // The doctor's approvals travel in the registration body, exactly as they
    // do on the registration form, and are stored before a declaration is
    // written. Whether one was required at all is decided by the declaration
    // service, against the template this activity actually uses.
    const clearance = await uploadClearanceFiles((req.body || {}).participants || []);
    if (clearance.error) return res.status(clearance.status).json({ error: clearance.error });
    for (const upload of clearance.uploads) {
      const participant = req.body?.participants?.[upload.participantIndex];
      if (participant) participant.medicalClearanceDocumentId = upload.clientDocumentId;
    }
    const result = await registerActivityGroup({
      db,
      persist: persistCore,
      activity,
      payload: {
        ...(req.body || {}),
        // The OTP authorizes this request; the secret itself never belongs in
        // an immutable signed-document snapshot.
        phoneVerification: verifiedPhoneEvidence(verified),
        evidenceContext: { requestContext: requestEvidence(req) },
      },
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
        new_status: REGISTRATION_STATUS.DETAILS_COMPLETED,
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
    // A resend of the same registration already has its approval on file.
    if (!result.duplicate) await fileClearanceDocuments(clearance.uploads, {
      parentId: parent?.id || null,
      findTarget: (upload) => {
        const match = (result.crm?.participants || []).find((p) => p.name === upload.name);
        return {
          studentId: match?.student?.id || null,
          declarationId: match?.declaration?.id || null,
        };
      },
    });
    const documentInvitations = [];
    if (!result.duplicate) {
      for (const registration of result.registrations.filter((row) => (
        ['pending_profile', 'awaiting_documents', 'blocked_health'].includes(row.document_status)
      ))) {
        const invitation = await sendActivityRegistrationDocumentMessage({
          registration,
          activity,
          origin: frontendPublicBase(req),
          kind: 'immediate',
        });
        documentInvitations.push({
          registrationId: registration.id,
          sent: !!invitation.sent,
          warning: invitation.sent ? null : invitation.error,
        });
        if (invitation.sent) {
          const reminder = db.insert('participation_reminders', {
            id: `pr_${crypto.randomUUID()}`,
            registration_id: registration.id,
            activity_id: activity.id,
            student_id: registration.student_id || null,
            kind: 'immediate',
            status: 'sent',
            sent_via: invitation.via || null,
            sent_at: new Date().toISOString(),
          });
          await persistCore('participation_reminders', reminder);
        }
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
    if (!result.duplicate) otpService.consumeToken(verified.token, verified.phone);
    res.status(201).json({
      success: true,
      duplicate: result.duplicate,
      order: result.order,
      registrations: result.registrations,
      declarations: result.crm?.declarations || [],
      waivers: result.crm?.waivers || [],
      signedDocuments: (result.crm?.participants || []).map((participant) => ({
        student: participant.student,
        health: participant.healthCreated ? participant.healthDeclaration : null,
        waiver: participant.waiverCreated ? participant.waiver : null,
      })),
      documentInvitations,
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
/**
 * The shop must not sell while the durable store is unreachable, so this still
 * proves the store answers before every purchase page. It used to prove that by
 * re-downloading the whole pricelist — 1.7 MB and ~2.3s, on every page view,
 * mostly product photos. A head-only probe answers the same question in a
 * fraction of the time, and the rows come from the read-through cache.
 */
async function refreshPublicPricelist() {
  if (!supa.isEnabled()) {
    return { storeAvailable: !requiresDurableStore(), rows: null };
  }
  const [alive, rows] = await Promise.all([supa.ping(), readTable('pricelist')]);
  if (!alive.ok) return { storeAvailable: false, rows: null };
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
      cancellation_policy: resolvePolicyFor(db, item, { allowDefault: false })?.snapshot || null,
    });
  } catch (err) {
    console.error('public shop item error:', err.message);
    res.status(500).json({ error: err.message || 'טעינת הפריט נכשלה' });
  }
});

app.get('/api/public/shop/:slug/household', publicFormRateLimit, async (req, res) => {
  try {
    const verified = requireVerifiedPublicPhone(req, res, req.query.phone);
    if (!verified) return;
    const { item, storeAvailable } = await findShopItemBySlugFresh(req.params.slug);
    if (!storeAvailable) {
      const unavailable = publicStoreUnavailableError();
      return res.status(unavailable.status).json(unavailable.body);
    }
    if (!item) return res.status(404).json({ error: 'הפריט לא נמצא או שאינו נמכר אונליין' });
    // A shop purchase signs the default declaration, so that is what counts.
    const household = await loadPublicHousehold(
      req.query.phone,
      req.query.idNumber,
      resolveDefaultDeclarationTemplate(db)?.slug
    );
    res.status(household.review_required ? 409 : 200).json(household);
  } catch (err) {
    console.error('public shop household error:', err.message);
    res.status(500).json({ error: err.message || 'טעינת פרטי הלקוח נכשלה' });
  }
});

app.post('/api/public/shop/:slug/purchase', publicFormRateLimit, async (req, res) => {
  try {
    const verified = requireVerifiedPublicPhone(req, res, req.body?.parent?.phone);
    if (!verified) return;
    const identity = requirePublicIdentityPair(req, res, verified, req.body?.parent || {});
    if (!identity) return;
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
      payload: {
        ...(req.body || {}),
        phoneVerification: verifiedPhoneEvidence(verified),
        evidenceContext: { requestContext: requestEvidence(req) },
      },
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
        new_status: REGISTRATION_STATUS.DETAILS_COMPLETED,
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
    if (!result.duplicate) otpService.consumeToken(verified.token, verified.phone);
    res.status(201).json({
      duplicate: result.duplicate,
      paymentUrl: result.paymentUrl,
      total: result.sale.total,
      signedDocuments: (result.crm?.participants || []).map((participant) => ({
        student: participant.student,
        health: participant.healthCreated ? participant.healthDeclaration : null,
        waiver: participant.waiverCreated ? participant.waiver : null,
      })),
    });
  } catch (err) {
    console.error('public shop purchase error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'הרכישה נכשלה' });
  }
});

// ─── Counter link, customer side: sign what is missing, then pay ────────────

/**
 * The page behind the link the register sent.
 *
 * What is shown before the phone is verified is deliberately no more than the
 * WhatsApp message already said: what is being bought, for how much, and whose
 * documents are missing. Everything that writes anything is gated on the code.
 */
app.get('/api/public/pos-checkout/:token', publicFormRateLimit, async (req, res) => {
  try {
    const link = await resolvePosCheckoutLink(req.params.token);
    if (!link) return res.status(404).json({ error: 'הקישור לא נמצא' });
    const status = posCheckoutStatus(link);
    if (status === 'paid') {
      return res.json({ status, paid: true, items_label: checkoutItemsLabel(link) });
    }
    if (!isPosCheckoutOpen(link)) {
      return res.status(410).json({
        error: status === POS_CHECKOUT_STATUS.CANCELLED
          ? 'הקישור בוטל — פנו לצוות'
          : 'פג תוקף הקישור — בקשו קישור חדש מהצוות',
        status,
      });
    }
    const template = resolveDefaultDeclarationTemplate(db);
    const parent = db.getOne('parents', link.parent_id);
    res.json({
      status,
      paid: false,
      // The invoice needs somewhere to go. Asked for only when the file has no
      // address on it, so a returning customer is not made to retype one.
      needs_email: !String(parent?.email || '').trim(),
      total: Number(link.total) || 0,
      items: (link.items || []).map((line) => ({
        name: line.name || 'פריט',
        quantity: Number(line.quantity) || 1,
        unitprice: Number(line.unitprice) || 0,
      })),
      items_label: checkoutItemsLabel(link),
      customer_name: link.customer_name || '',
      // Masked: enough to recognise the number the code will go to, not enough
      // to read someone's phone number off a link that was forwarded.
      phone_hint: String(link.customer_phone || '').slice(-4),
      participants: (link.participants || []).map((participant) => {
        const student = db.getOne('students', participant.student_id);
        return {
          student_id: participant.student_id,
          name: participant.name || student?.name || '',
          missing: participant.missing || [],
          is_adult: student?.isAdult === true,
          birthDate: student?.birthDate || '',
        };
      }),
      // The sale already has a payment link waiting — the documents were signed
      // and the customer came back before paying.
      payment_url: link.status === POS_CHECKOUT_STATUS.AWAITING_PAYMENT
        ? link.payment_url || null
        : null,
      form_template: template,
      cancellation_policy: cancellationPoliciesForSaleLines(link.items || [])
        .map((resolved) => resolved.snapshot)[0] || null,
    });
  } catch (err) {
    console.error('public pos-checkout lookup error:', err.message);
    res.status(500).json({ error: err.message || 'טעינת הדף נכשלה' });
  }
});

/**
 * Signatures first, then the charge.
 *
 * The documents are written before any sale exists, exactly as an outing writes
 * them before its order: a family that signed and walked away still has valid
 * documents on file, and the next attempt reuses them instead of asking for a
 * second signature.
 */
app.post('/api/public/pos-checkout/:token/complete', publicFormRateLimit, async (req, res) => {
  try {
    const link = await resolvePosCheckoutLink(req.params.token);
    if (!link) return res.status(404).json({ error: 'הקישור לא נמצא' });
    if (posCheckoutStatus(link) === 'paid') {
      return res.status(400).json({ error: 'הקישור כבר שולם' });
    }
    if (!isPosCheckoutOpen(link)) {
      return res.status(410).json({ error: 'פג תוקף הקישור — בקשו קישור חדש מהצוות' });
    }
    const parent = db.getOne('parents', link.parent_id);
    if (!parent) return res.status(404).json({ error: 'תיק הלקוח לא נמצא — פנו לצוות' });

    // The code has to go to the number the link was sent to. Verifying some
    // other phone would let anyone holding a forwarded link sign for this family.
    const verified = requireVerifiedPublicPhone(req, res, parent.phone);
    if (!verified) return;

    const email = String(req.body?.parent?.email || parent.email || '').trim();
    if (!email) {
      return res.status(400).json({ error: 'נדרש דואר אלקטרוני לשליחת החשבונית' });
    }

    const student = db.getOne('students', link.student_id);
    const template = resolveDefaultDeclarationTemplate(db);
    const submitted = Array.isArray(req.body?.participants) ? req.body.participants : [];
    const clearance = await uploadClearanceFiles(submitted);
    if (clearance.error) return res.status(clearance.status).json({ error: clearance.error });
    for (const upload of clearance.uploads) {
      const participant = submitted[upload.participantIndex];
      if (participant) participant.medicalClearanceDocumentId = upload.clientDocumentId;
    }

    // Only the people the link was opened for. A posted participant that is not
    // on the link is ignored rather than trusted.
    const wanted = new Map((link.participants || []).map((p) => [String(p.student_id), p]));
    const participants = [];
    for (const input of submitted) {
      const target = wanted.get(String(input?.student_id || input?.id || ''));
      if (!target) continue;
      const row = db.getOne('students', target.student_id);
      participants.push({
        ...input,
        id: target.student_id,
        type: row?.isAdult === true ? 'adult' : 'child',
        name: row?.name || target.name || '',
        birthDate: input.birthDate || row?.birthDate || '',
      });
    }
    if (participants.length !== wanted.size) {
      return res.status(400).json({ error: 'יש להשלים את הטפסים לכל מי שמופיע בקישור' });
    }

    // Whoever already has valid documents is not asked to sign again — they may
    // have signed on another form since the link was sent, or the first attempt
    // may have saved the signatures and then failed at the clearing step.
    const unsigned = participants.filter((participant) => !participationEligibility(db, {
      studentId: participant.id,
      scope: 'wall',
    }).eligible);

    let crm = null;
    if (unsigned.length) {
      crm = await saveCrmParticipants({
        db,
        persist: persistCore,
        parent: {
          name: parent.name,
          lastName: parent.lastName,
          phone: parent.phone,
          email,
          city: parent.city,
          idNumber: parent.idNumber,
        },
        participants: unsigned,
        template,
        participationScope: 'wall',
        phoneVerification: verifiedPhoneEvidence(verified),
        evidenceContext: { requestContext: requestEvidence(req) },
        source: parent.source || 'pos',
        onStudentStatusChanged: (updated) => automationsService.triggerEvent('status_changed', {
          ...updated,
          new_status: REGISTRATION_STATUS.DETAILS_COMPLETED,
        }),
      });
      await fileClearanceDocuments(clearance.uploads, {
        parentId: parent.id,
        findTarget: (upload) => {
          const match = (crm.participants || []).find((p) => p.name === upload.name);
          return {
            studentId: match?.student?.id || null,
            declarationId: match?.declaration?.id || null,
          };
        },
      });
    }

    // Judged against what is now on file, not against what the customer just
    // posted: the documents are the authority, and a stale link cannot conjure
    // eligibility that the participation rules do not agree with.
    const stillMissing = documentGaps({
      participantIds: [...wanted.keys()],
      eligibilityOf: (studentId) => participationEligibility(db, { studentId, scope: 'wall' }),
      nameOf: (studentId) => db.getOne('students', studentId)?.name || 'המשתתף',
    });
    if (stillMissing.length) {
      return res.status(400).json({
        error: `עדיין חסר: ${stillMissing.map((gap) => `${gap.name} — ${gapText(gap)}`).join(' · ')}`,
      });
    }

    // Coming back to a link whose documents were already signed: the sale and
    // its clearing page exist, so send them back to the same one instead of
    // opening a second charge.
    if (link.status === POS_CHECKOUT_STATUS.AWAITING_PAYMENT && link.payment_url) {
      return res.json({ paymentUrl: link.payment_url, duplicate: true, signedDocuments: [] });
    }

    const policies = cancellationPoliciesForSaleLines(link.items || []);
    if (policies.length && req.body?.policyAccepted !== true) {
      return res.status(400).json({ error: 'יש לקרוא ולאשר את תנאי הביטול לפני התשלום' });
    }

    const opened = await openPendingPosSale({
      lines: link.items || [],
      student,
      parent,
      parentId: parent.id,
      couponCode: link.coupon_code || null,
      cancellationPolicies: policies,
      recordAcceptances: async ({ sale }) => {
        const acceptances = [];
        for (const resolved of policies) {
          const acceptance = await recordPolicyAcceptance(db, persistCore, {
            ...resolved,
            parentId: parent.id,
            posSaleId: sale.id,
            acceptedVia: 'online',
          });
          if (acceptance) acceptances.push(acceptance);
        }
        return acceptances;
      },
      soldBy: link.created_by || null,
      source: 'checkout_link',
      checkoutLinkId: link.id,
      successUrl: `${frontendPublicBase(req)}/checkout/${encodeURIComponent(link.id)}?paid=1`,
    });

    const updatedLink = db.update(POS_CHECKOUT_TABLE, link.id, {
      status: POS_CHECKOUT_STATUS.AWAITING_PAYMENT,
      sale_id: opened.sale.id,
      payment_id: opened.payment.id,
      payment_url: opened.payUrl,
      documents_signed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }) || link;
    await persistCore(POS_CHECKOUT_TABLE, updatedLink);
    touchGoogleContacts();
    console.log(`📝 [POS] checkout link ${link.id} signed — sale ${opened.sale.id} awaiting payment`);

    res.status(201).json({
      paymentUrl: opened.payUrl,
      total: opened.total,
      duplicate: false,
      // The signed copies are rendered in the browser and posted back, and the
      // certificate names the person who signed it. The phone answering this
      // request already proved it is theirs.
      signer: {
        name: parent.name || '',
        lastName: parent.lastName || '',
        idNumber: parent.idNumber || '',
        phone: parent.phone || '',
      },
      signedDocuments: (crm?.participants || []).map((participant) => ({
        student: participant.student,
        health: participant.healthCreated ? participant.healthDeclaration : null,
        waiver: participant.waiverCreated ? participant.waiver : null,
      })),
    });
  } catch (err) {
    console.error('public pos-checkout complete error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'השלמת הרכישה נכשלה' });
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
    const state = issueOAuthState('google-calendar');
    res.json({ url: googleCalendarService.getAuthUrl(state) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/google-calendar/oauth/callback', async (req, res) => {
  try {
    const code = req.query.code;
    if (!code || !verifyOAuthState(req.query.state, 'google-calendar')) {
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
      if (['cancelled', 'archived'].includes(String(activity.status || '').toLowerCase())) continue;
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
  if (!await googleCalendarService.verifyWebhookNotification(req.headers)) {
    return res.status(401).json({ error: 'Invalid Google webhook notification' });
  }
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
app.post('/api/google-calendar/sync-due', requireCronSecret, async (req, res) => {
  try {
    const result = await applyGooglePull(db);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Google Business Profile — public opening hours on Search/Maps ───────────
app.get('/api/google-business-profile/status', requireOwner, async (_req, res) => {
  try {
    res.json(await googleBusinessProfileService.getStatus());
  } catch (err) {
    res.status(500).json({ configured: false, connected: false, ready: false, error: err.message });
  }
});

app.get('/api/google-business-profile/auth-url', requireOwner, (_req, res) => {
  try {
    const state = issueOAuthState('google-business-profile');
    res.json({ url: googleBusinessProfileService.getAuthUrl(state) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/google-business-profile/oauth/callback', async (req, res) => {
  const base = googleBusinessProfileService.frontendBase();
  try {
    const code = String(req.query.code || '');
    if (!code || !verifyOAuthState(req.query.state, 'google-business-profile')) {
      throw new Error('אישור החיבור לגוגל אינו תקין או שפג תוקפו');
    }
    const status = await googleBusinessProfileService.completeOAuth(code);
    if (status.ready) {
      await googleBusinessProfileService.syncOpeningHours(db.get('activities') || []);
    }
    res.redirect(googleBusinessProfileService.oauthCallbackRedirectUrl());
  } catch (err) {
    console.error('Google Business Profile OAuth callback failed:', err.message);
    res.redirect(
      `${base}/business-settings?tab=integrations&googleBusiness=error&msg=${encodeURIComponent(err.message)}`
    );
  }
});

app.put('/api/google-business-profile/location', requireOwner, async (req, res) => {
  try {
    const status = await googleBusinessProfileService.selectLocation(req.body?.locationName);
    const sync = await googleBusinessProfileService.syncOpeningHours(db.get('activities') || []);
    res.json({ ...status, sync });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/google-business-profile/sync', requireOwner, async (_req, res) => {
  try {
    const result = await googleBusinessProfileService.syncOpeningHours(db.get('activities') || []);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/google-business-profile/disconnect', requireOwner, async (_req, res) => {
  try {
    res.json(await googleBusinessProfileService.disconnect());
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
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

// Sync state of one record, e.g. ?key=parent:12 — powers the badge on the customer screen
app.get('/api/google-contacts/contact-status', async (req, res) => {
  const key = String(req.query.key || '').trim();
  if (!key) return res.status(400).json({ error: 'חסר מזהה רשומה' });
  try {
    res.json(await googleContactsService.getContactSyncStatus(googleContactsDeps, key, {
      refresh: req.query.refresh === '1',
    }));
  } catch (err) {
    res.status(500).json({ key, state: 'error', label: 'בדיקת הסנכרון נכשלה', error: err.message });
  }
});

app.get('/api/google-contacts/auth-url', requireOwner, (req, res) => {
  try {
    const state = issueOAuthState('google-contacts');
    res.json({ url: googleContactsService.getAuthUrl(state) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/google-contacts/oauth/callback', async (req, res) => {
  const base = googleContactsService.frontendBase();
  try {
    const code = req.query.code;
    if (!code || !verifyOAuthState(req.query.state, 'google-contacts')) {
      return res.redirect(`${base}/business-settings?googleContacts=error`);
    }
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
app.post('/api/google-contacts/sync-due', requireCronSecret, async (req, res) => {
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
  if (req.crmUser?.role === 'staff' && !groupId && !date) {
    return res.status(403).json({ error: 'צוות תפעול יכול לצפות בנוכחות לפי חוג או תאריך בלבד' });
  }
  const hasFilter = Boolean(groupId || date || studentId);
  // Customer-card transitions should not wait on another durable round trip:
  // the complete attendance table is hydrated on boot and every write updates
  // this process cache. Other attendance screens keep their current fresh-read
  // behaviour unless they explicitly opt into the fast snapshot.
  if (req.query.cached === '1') {
    return res.json(filterAttendanceRows(db.get('attendance'), { groupId, date, studentId }));
  }
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
app.post('/api/attendance/ensure-today', requireCronSecret, async (req, res) => {
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
  // Product photos are stored inline as base64 and come to 1.7 MB — more than
  // the entire customer list. Screens that only need names and prices ask for
  // `?images=0` and skip it.
  const withImages = req.query.images !== '0';
  const items = (db.get('pricelist') || []).map((raw) => {
    const item = enrichPricelistItem(raw);
    const payload = { ...item, cancellation_policy: resolvePolicyFor(db, item, { allowDefault: false })?.snapshot || null };
    if (!withImages) delete payload.image;
    return payload;
  });
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

/**
 * Whether any product or category still shows this picture. Files are named
 * after their own bytes, so the same photo on two products is one file — and
 * removing it because one of them changed would blank out the other.
 */
function catalogImageStillInUse(imageUrl) {
  if (!imageUrl) return true;
  const rows = [...(db.get('pricelist') || []), ...(db.get('product_categories') || [])];
  return rows.some((row) => row?.image === imageUrl);
}

/**
 * מחיר של פריט שנשען על עוגן נקבע כאן ולא במסך.
 *
 * המסך יכול להיות פתוח מאתמול, ומחיר שנשלח ממנו היה מחזיר לחיים מחיר עוגן
 * ישן. לכן המחיר שהגיע מהלקוח נזרק, והשרת גוזר אותו מחדש מהעוגן שבמחירון.
 */
function applyPriceAnchor(body, current = {}) {
  const merged = { ...current, ...body };
  if (!merged.price_anchor_id) return null;
  const anchor = db.getOne('pricelist', merged.price_anchor_id);
  const problem = validateAnchorLink(merged, anchor);
  if (problem) return { status: 400, error: problem };
  body.price = computeAnchoredPrice(merged, anchor);
  return null;
}

/**
 * מחיר היחידה הבודדת של מוצר — מחיר העוגן שהוא נשען עליו. זה מה שנצרב על
 * כרטיסייה ברגע המכירה, וממנו מחושב אחר כך מה שנוצל במחיר מלא.
 */
function anchorPriceForProduct(pricelistId) {
  const item = pricelistId ? db.getOne('pricelist', pricelistId) : null;
  if (!item?.price_anchor_id) return null;
  const anchor = db.getOne('pricelist', item.price_anchor_id);
  const price = Number(anchor?.price);
  return Number.isFinite(price) && price > 0 ? price : null;
}

/**
 * העלאת מחיר בעוגן מזיזה את כל מי שנשען עליו, באותה שמירה. אחרת היה נשאר
 * מחירון שבו הכניסה כבר 80 והכרטיסייה עדיין מחושבת לפי 70.
 */
function cascadeAnchorPrices(anchor) {
  const updates = dependentPriceUpdates(db.get('pricelist') || [], anchor);
  for (const update of updates) db.update('pricelist', update.id, { price: update.price });
  return updates;
}

// Create pricelist item
app.post('/api/pricelist', async (req, res) => {
  try {
    const body = { ...req.body };
    if (body.image !== undefined) {
      body.image = body.image ? await storeImageValue(clampImage(body.image)) : '';
    }
    body.categories = normalizeProductCategories(body);
    body.category = body.categories[0];
    const denied = applySelfServeFields(body, {}, req.crmUser);
    if (denied) return res.status(denied.status).json({ error: denied.error });
    const anchorProblem = applyPriceAnchor(body);
    if (anchorProblem) return res.status(anchorProblem.status).json({ error: anchorProblem.error });
    const record = db.insert('pricelist', body);
    res.status(201).json(enrichPricelistItem(record));
  } catch (err) {
    res.status(400).json({ error: err.message || 'שגיאה' });
  }
});

// Update pricelist item
app.put('/api/pricelist/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const body = { ...req.body };
    const current = db.getOne('pricelist', id) || {};
    if (body.image !== undefined) {
      body.image = body.image ? await storeImageValue(clampImage(body.image)) : '';
    }
    // Only touch categories when the caller actually sent them — partial patches
    // (stock, active flag) must not be re-labelled as 'שונות'.
    if (body.categories !== undefined || body.category !== undefined) {
      body.categories = normalizeProductCategories({ ...current, ...body });
      body.category = body.categories[0];
    }
    const denied = applySelfServeFields(body, current, req.crmUser);
    if (denied) return res.status(denied.status).json({ error: denied.error });
    // פריט עוגן שמאבד את הסימון בזמן שנשענים עליו משאיר מחירים בלי מקור.
    if (isPriceAnchor(current) && body.is_price_anchor === false) {
      const dependents = anchorInUseBy(db.get('pricelist') || [], id);
      if (dependents.length) {
        return res.status(400).json({
          error: `${dependents.length} פריטים גוזרים את מחירם מכאן (${dependents.map((row) => row.name).slice(0, 3).join(', ')}) — יש לנתק אותם קודם`,
        });
      }
    }
    const anchorProblem = applyPriceAnchor(body, current);
    if (anchorProblem) return res.status(anchorProblem.status).json({ error: anchorProblem.error });
    const updated = db.update('pricelist', id, body);
    if (!updated) return res.status(404).json({ error: 'Pricelist item not found' });
    const cascaded = isPriceAnchor(updated) ? cascadeAnchorPrices(updated) : [];
    res.json({ ...enrichPricelistItem(updated), anchor_cascade: cascaded });
    if (body.image !== undefined) {
      forgetImageValue(current.image, body.image, catalogImageStillInUse);
    }
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

app.post('/api/product-categories', requireOwner, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'שם קטגוריה חובה' });
    const existing = ensureProductCategories(db);
    if (existing.some((c) => c.name === name)) {
      return res.status(400).json({ error: 'קטגוריה בשם הזה כבר קיימת' });
    }
    let image = '';
    if (req.body?.image) image = await storeImageValue(clampImage(req.body.image), 'categories');
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

app.put('/api/product-categories/:id', requireOwner, async (req, res) => {
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
      updates.image = req.body.image
        ? await storeImageValue(clampImage(req.body.image), 'categories')
        : '';
    }
    if (req.body?.image_fit !== undefined) {
      updates.image_fit = req.body.image_fit === 'contain' ? 'contain' : 'cover';
    }

    const updated = db.update('product_categories', id, updates);
    if (updates.name && updates.name !== current.name) {
      renameCategoryOnProducts(db, current.name, updates.name);
    }
    res.json(updated);
    if (updates.image !== undefined) {
      forgetImageValue(current.image, updates.image, catalogImageStillInUse);
    }
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

  return { payload, docId, docnum, doctype, ccBillLogId: extractCcBillLogId(raw) };
}

/**
 * מזהה החיוב בכרטיס, אם iCount שלח אותו ב-IPN.
 *
 * `cc/refund` — הדרך היחידה ב-API לזכות כרטיס בסכום חלקי — מקבל אך ורק את
 * המזהה הזה, והוא אינו מופיע ב-doc/info של המסמך. ה-IPN הוא ההזדמנות היחידה
 * לתפוס אותו, ולכן הוא נשמר על התשלום גם לפני שמסך הזיכוי החלקי קיים.
 */
function extractCcBillLogId(raw = {}) {
  for (const [key, value] of Object.entries(raw || {})) {
    if (/bill_?log/i.test(key) && value != null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return null;
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
          // האם העסקה מכרה כרטיסייה או מנוי — זה מה שמנתב את כפתור הזיכוי
          // למסלול היחסי במקום לביטול מסמך שלם.
          has_passes: payment.pos_sale_id
            ? passesOfSale(db.get('customer_passes') || [], payment.pos_sale_id).length > 0
            : false,
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

    const documentUrl = safeIcountDocumentUrl(url);
    if (!documentUrl) return res.status(502).json({ error: 'כתובת מסמך החיוב אינה מאושרת' });
    const upstream = await fetch(documentUrl);
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
    await recordFinanceAudit({
      action: 'send_invoice',
      paymentId: payment.id,
      saleId: payment.pos_sale_id || null,
      amount: payment.amount,
      actor: req.crmUser?.email || req.crmUser?.name || null,
      details: `kind=${kind} doc=${docnum || '-'}`,
    });
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
/**
 * מדיניות הביטול של הציוד — הפעילה בבסיס „ניצול”, שנבחרת לפי שמה.
 * מוצמדת לתשלום ברגע הרכישה ולא נקראת מחדש בזמן הזיכוי.
 */
function usagePolicySnapshot(namePattern) {
  const usagePolicies = (db.get('cancellation_policies') || [])
    .filter((row) => row.status !== 'archived')
    .map((row) => currentPolicyVersion(db, row.id))
    .filter((resolved) => resolved?.snapshot?.basis === 'usage');
  const chosen = usagePolicies.find((resolved) => namePattern.test(resolved.policy.name))
    || usagePolicies[0]
    || null;
  return chosen?.snapshot || null;
}

function equipmentPolicySnapshot(settings = null) {
  if (settings?.cancellation_policy_id) {
    return currentPolicyVersion(db, settings.cancellation_policy_id)?.snapshot || null;
  }
  return usagePolicySnapshot(/נעל|ציוד|השכר/);
}

function equipmentRefundPlan(payment) {
  // הצילום שנשמר על התשלום הוא האמת. הנפילה לאחור היא בשביל השכרות שנרכשו
  // לפני שהצילום נשמר — עליהן, ורק עליהן, נקראת המדיניות הנוכחית.
  const snapshot = payment?.policy_snapshot || equipmentPolicySnapshot();
  if (!snapshot) {
    return { ok: false, error: 'לא הוגדרה מדיניות ביטול בבסיס „ניצול” לציוד' };
  }
  const recommendation = equipmentRefundRecommendation({ snapshot, payment });
  if (!recommendation.has_shoes) {
    return {
      ok: false,
      error: 'מדיניות הביטול חלה רק על השכרת נעליים, ובתשלום הזה אין נעליים',
    };
  }
  return {
    ok: true,
    policy: { name: snapshot.policy_name || 'מדיניות ביטול ציוד', from_payment: !!payment?.policy_snapshot },
    snapshot,
    recommendation,
  };
}

/**
 * זיכוי כרטיסייה או מנוי, לפי מה שנוצל.
 *
 * הכרטיס יודע בעצמו כמה נוצל (`visits_remaining`) וכמה שולם עליו
 * (`paid_price`), ולכן אין צורך לפרק את שורות המכירה: מכירה שכללה גם מוצר
 * אחר מזוכה על חלק הכרטיס בלבד.
 */
function passRefundContext(payment) {
  const passes = passesOfSale(db.get('customer_passes') || [], payment.pos_sale_id);
  if (!passes.length) {
    return { ok: false, error: 'לא נמצאה כרטיסייה פעילה בעסקה הזאת' };
  }
  const sale = db.getOne('pos_sales', payment.pos_sale_id);
  // הצילום שנשמר על המכירה הוא האמת. הנפילה לאחור היא למכירות ישנות בלבד.
  const snapshot = (Array.isArray(sale?.policy_snapshots) ? sale.policy_snapshots : [])
    .find((snap) => snap?.basis === 'usage')
    || usagePolicySnapshot(/כרטיסי|מנוי/);
  if (!snapshot) {
    return { ok: false, error: 'לא הוגדרה מדיניות ביטול בבסיס „ניצול” לכרטיסיות' };
  }
  const plan = saleRefundPlan({ snapshot, passes, payment });
  return { ok: true, passes, sale, snapshot, plan };
}

/**
 * זיכוי בסכום שנקבע ידנית.
 *
 * שמור לבעלים בכוונה. כל שאר המסלולים כפופים למדיניות ולכן בטוחים בידי כל
 * מי שמורשה לגעת בתיק הלקוח; זה עוקף אותה, ולכן הוא במפורש החלטה של מי
 * שאחראי על הכסף. אם צריך לפתוח אותו לצוות — זה שינוי של שורה אחת כאן.
 *
 * לא מבטל כרטיסיות ולא משחרר מקומות: מי שמזכה סכום שרירותי יודע מה הוא עושה,
 * וביטול אוטומטי של זכאות שלא ביקש היה מפתיע אותו.
 */
app.post('/api/payments/:id/manual-refund', requireOwner, async (req, res) => {
  try {
    if (!icount.isConfigured()) {
      return res.status(503).json({ error: 'מערכת החיוב לא מוגדרת בשרת' });
    }
    await refreshPaymentTables();
    const payment = db.getOne('payments', req.params.id);
    if (!payment) return res.status(404).json({ error: 'התשלום לא נמצא' });
    if (payment.status === 'refunded') {
      return res.status(400).json({ error: 'התשלום כבר זוכה' });
    }

    const reason = String(req.body?.reason || '').trim();
    const check = validateManualRefund({
      amount: req.body?.amount,
      paidAmount: payment.amount,
      reason,
      minRefund: icount.MIN_PARTIAL_REFUND,
    });
    if (!check.ok) {
      return res.status(400).json({ error: check.error, code: check.code || null });
    }

    const parent = payment.parent_id ? db.getOne('parents', payment.parent_id) : null;
    const result = await executePartialRefund({
      icount,
      payment,
      amount: check.amount,
      reason,
      clientName: parent?.name || payment.client_name || 'לקוח',
      emailTo: parent?.email || null,
    });
    if (!result.ok) return res.status(400).json(result);

    const recommended = Number(req.body?.recommended_amount);
    const updated = db.update('payments', payment.id, manualRefundMarks({
      amount: result.amount,
      reason,
      recommended: Number.isFinite(recommended) ? recommended : null,
      approvedBy: req.crmUser?.email || req.crmUser?.name || null,
      result,
    }));
    if (updated) await persistCore('payments', updated);

    console.log(
      `↩️ [manual] refund payment=${payment.id} ₪${result.amount}`
      + (updated?.refund_policy_exception ? ' · חריגה ממדיניות' : '')
      + ` · ${req.crmUser?.email || 'לא ידוע'}`
    );
    await recordFinanceAudit({
      action: 'partial_refund',
      paymentId: payment.id,
      saleId: payment.pos_sale_id || null,
      amount: result.amount,
      reason,
      actor: req.crmUser?.email || req.crmUser?.name || null,
      details: `doc=${payment.icount_doc_number || '-'}`,
    });
    res.json({ success: true, ...result, payment: updated });
  } catch (err) {
    console.error('manual refund error:', err.message);
    res.status(502).json({ error: err.message || 'הזיכוי נכשל' });
  }
});

app.post('/api/payments/:id/pass-refund-preview', async (req, res) => {
  try {
    await refreshPaymentTables();
    const payment = db.getOne('payments', req.params.id);
    if (!payment) return res.status(404).json({ error: 'התשלום לא נמצא' });
    const ctx = passRefundContext(payment);
    if (!ctx.ok) return res.status(400).json({ error: ctx.error });
    res.json({
      policy: { name: ctx.snapshot.policy_name || 'מדיניות ביטול כרטיסיות' },
      items: ctx.plan.items,
      total: ctx.plan.total,
      resolved: ctx.plan.resolved,
      paid_amount: Number(payment.amount) || 0,
    });
  } catch (err) {
    console.error('pass refund preview error:', err.message);
    res.status(500).json({ error: err.message || 'חישוב הזיכוי נכשל' });
  }
});

app.post('/api/payments/:id/pass-refund', async (req, res) => {
  try {
    if (!icount.isConfigured()) {
      return res.status(503).json({ error: 'מערכת החיוב לא מוגדרת בשרת' });
    }
    await refreshPaymentTables();
    const payment = db.getOne('payments', req.params.id);
    if (!payment) return res.status(404).json({ error: 'התשלום לא נמצא' });
    if (payment.status === 'refunded') {
      return res.status(400).json({ error: 'התשלום כבר זוכה' });
    }
    const ctx = passRefundContext(payment);
    if (!ctx.ok) return res.status(400).json({ error: ctx.error });

    const approved = Number(req.body?.approved_amount);
    if (!Number.isFinite(approved) || Math.abs(approved - ctx.plan.total) >= 0.005) {
      return res.status(409).json({
        error: 'יש לאשר את סכום הזיכוי המוצג',
        code: 'refund_amount_approval_required',
        items: ctx.plan.items,
        total: ctx.plan.total,
      });
    }
    if (!ctx.plan.resolved) {
      return res.status(409).json({
        error: 'לא ניתן לקבוע כמה מהכרטיס נוצל — יש לבצע את הזיכוי ידנית',
        code: 'usage_unresolved',
        items: ctx.plan.items,
      });
    }
    if (ctx.plan.total <= 0) {
      return res.status(400).json({ error: 'לפי המדיניות אין החזר על הכרטיס הזה' });
    }

    const parent = payment.parent_id ? db.getOne('parents', payment.parent_id) : null;
    const reason = String(req.body?.reason || '').trim() || 'זיכוי כרטיסייה';

    const result = await executePartialRefund({
      icount,
      payment,
      amount: ctx.plan.total,
      reason,
      clientName: parent?.name || payment.client_name || 'לקוח',
      emailTo: parent?.email || null,
    });
    if (!result.ok) return res.status(400).json(result);

    const now = new Date().toISOString();
    // הכרטיסים מבוטלים רק אחרי שהכסף חזר — כרטיס מבוטל בלי החזר הוא הגרוע
    // משני הכיוונים.
    for (const pass of ctx.passes) {
      const updated = db.update('customer_passes', pass.id, {
        status: 'void',
        void_reason: reason,
        updated_at: now,
      });
      if (updated) await persistCore('customer_passes', updated);
    }
    const updatedPayment = db.update('payments', payment.id, {
      status: 'refunded',
      refunded_at: now,
      refund_reason: reason,
      refund_amount: result.amount,
      refund_doc_number: result.refund_doc_number,
      refund_doc_url: result.refund_doc_url,
      refunded_by: req.crmUser?.email || req.crmUser?.name || null,
      cc_bill_log_id: result.ccBillLogId || payment.cc_bill_log_id || null,
      updated_at: now,
    });
    if (updatedPayment) await persistCore('payments', updatedPayment);

    console.log(
      `↩️ [pass] partial refund payment=${payment.id} ₪${result.amount} passes=${ctx.passes.length}`
    );
    res.json({ success: true, ...result, payment: updatedPayment, items: ctx.plan.items });
  } catch (err) {
    console.error('pass refund error:', err.message);
    res.status(502).json({ error: err.message || 'הזיכוי נכשל' });
  }
});

app.post('/api/payments/:id/equipment-refund-preview', async (req, res) => {
  try {
    await refreshPaymentTables();
    const payment = db.getOne('payments', req.params.id);
    if (!payment) return res.status(404).json({ error: 'התשלום לא נמצא' });
    if (!isEquipmentPayment(payment)) {
      return res.status(400).json({ error: 'זה אינו תשלום ציוד' });
    }
    const plan = equipmentRefundPlan(payment);
    if (!plan.ok) return res.status(400).json({ error: plan.error });
    res.json({
      policy: plan.policy,
      recommendation: plan.recommendation,
      paid_amount: Number(payment.amount) || 0,
    });
  } catch (err) {
    console.error('equipment refund preview error:', err.message);
    res.status(500).json({ error: err.message || 'חישוב הזיכוי נכשל' });
  }
});

app.post('/api/payments/:id/equipment-refund', async (req, res) => {
  try {
    if (!icount.isConfigured()) {
      return res.status(503).json({ error: 'מערכת החיוב לא מוגדרת בשרת' });
    }
    await refreshPaymentTables();
    const payment = db.getOne('payments', req.params.id);
    if (!payment) return res.status(404).json({ error: 'התשלום לא נמצא' });
    if (!isEquipmentPayment(payment)) {
      return res.status(400).json({ error: 'זה אינו תשלום ציוד' });
    }
    if (payment.status === 'refunded') {
      return res.status(400).json({ error: 'התשלום כבר זוכה' });
    }

    const plan = equipmentRefundPlan(payment);
    if (!plan.ok) return res.status(400).json({ error: plan.error });

    // אותו אישור סכום שקיים בזיכוי הרשמה: מה שמאושר הוא מה שהוצג, ולא מספר
    // שנוצר מחדש בין הצגת המסך ללחיצה.
    const approved = Number(req.body?.approved_amount);
    if (!Number.isFinite(approved)
      || Math.abs(approved - Number(plan.recommendation.amount)) >= 0.005) {
      return res.status(409).json({
        error: 'יש לאשר את סכום הזיכוי המוצג',
        code: 'refund_amount_approval_required',
        recommendation: plan.recommendation,
      });
    }
    if (!plan.recommendation.period_resolved) {
      return res.status(409).json({
        error: 'לא ניתן לקבוע כמה מתקופת ההשכרה נוצלה — יש לבצע את הזיכוי ידנית',
        code: 'period_unresolved',
        recommendation: plan.recommendation,
      });
    }

    const parent = payment.parent_id ? db.getOne('parents', payment.parent_id) : null;
    const reason = String(req.body?.reason || '').trim()
      || `זיכוי השכרת ציוד · ${plan.policy.name}`;

    const result = await executePartialRefund({
      icount,
      payment,
      amount: plan.recommendation.amount,
      reason,
      clientName: parent?.name || payment.client_name || 'לקוח',
      emailTo: parent?.email || null,
    });
    if (!result.ok) return res.status(400).json(result);

    const now = new Date().toISOString();
    const updated = db.update('payments', payment.id, {
      status: 'refunded',
      refunded_at: now,
      refund_reason: reason,
      refund_amount: result.amount,
      refund_doc_number: result.refund_doc_number,
      refund_doc_url: result.refund_doc_url,
      refunded_by: req.crmUser?.email || req.crmUser?.name || null,
      cc_bill_log_id: result.ccBillLogId || payment.cc_bill_log_id || null,
      updated_at: now,
    });
    if (updated) await persistCore('payments', updated);

    console.log(
      `↩️ [equipment] partial refund payment=${payment.id} ₪${result.amount} doc=${result.refund_doc_number || '-'}`
    );
    res.json({ success: true, ...result, payment: updated, recommendation: plan.recommendation });
  } catch (err) {
    console.error('equipment refund error:', err.message);
    res.status(502).json({ error: err.message || 'הזיכוי נכשל' });
  }
});

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

/**
 * Everybody who asked to be told when this one gets a date.
 *
 * The list is the only reason a dateless activity exists, so it is the only
 * thing that must happen when the date arrives. Outside the 24-hour window
 * there is no template for it — the news is worth an approved one, but until
 * there is one the team hears instead of nobody hearing at all.
 */
async function announceScheduledIdea(activity) {
  const rows = listInterest(db, activity.id).filter((row) => (
    String(row.status || 'interested') === 'interested'
  ));
  if (!rows.length) return;
  const link = activityPublicSlug(activity) && activity.registration_enabled
    ? eventPublicUrl(activityPublicSlug(activity))
    : '';
  const missed = [];
  for (const row of rows) {
    const parent = row.parent_id ? db.getOne('parents', row.parent_id) : null;
    const phone = normalizePhone(parent?.phone || row.phone || '');
    if (!phone || (parent && isOptedOut(parent))) continue;
    if (parent && !canSendFreeform(parent, 'whatsapp')) {
      missed.push(`${row.name || parent?.name || ''} · ${phone}`);
      continue;
    }
    try {
      await whatsappService.sendTextMessage(
        phone,
        withBotMark(ideaScheduledMessage(activity, {
          firstName: parentFirstName(parent) || String(row.name || '').split(/\s+/)[0],
          link,
        })),
        true,
        { source: 'ai', parentId: parent?.id || null }
      );
    } catch (err) {
      console.error('idea announcement send failed:', err.message);
    }
  }
  if (!missed.length) return;
  const { phones } = alertRecipients(db, 'handoff', db.getSettings ? db.getSettings() : {});
  const body = [
    `📣 נקבע תאריך ל${activity.name || 'פעילות'} — לא הצלחנו להודיע לכולם`,
    ...missed.slice(0, 12).map((line) => `• ${line}`),
    '← חלון 24 השעות סגור אצלם, צריך פנייה מכם.',
  ].join('\n');
  for (const staffPhone of phones) {
    try {
      await whatsappService.sendTextMessage(staffPhone, body, false, {
        source: 'staff_notify',
        clip: false,
      });
    } catch (err) {
      console.error('idea staff notice failed:', err.message);
    }
  }
}

/**
 * The message a family gets once the equipment is settled.
 *
 * Until now paying was a page that closed, and marking "we already have shoes"
 * left no trace the parent could see — so the one who did everything right had
 * no more confirmation than the one who did nothing. This says what was bought
 * and for whom, what was recorded as already theirs, and whether anything is
 * still open, so nobody has to ask.
 *
 * Never worth failing a webhook over: the payment is recorded either way.
 */
async function sendEquipmentReceipt(payment) {
  try {
    const parent = payment.parent_id ? db.getOne('parents', payment.parent_id) : null;
    if (!parent?.phone) return;
    if (isOptedOut(parent)) return;
    const students = (db.get('students') || []).filter(
      (s) => String(s.parentId || s.parent_id || '') === String(parent.id)
    );
    const standing = familyEquipmentStanding(db, { students });
    const body = equipmentReceiptMessage(standing, { firstName: parentFirstName(parent) });
    if (!body) return;
    // A receipt is worth nothing a day late, and a template for it does not
    // exist; outside the window the page itself already showed the result.
    if (!canSendFreeform(parent, 'whatsapp')) return;
    await whatsappService.sendTextMessage(normalizePhone(parent.phone), withBotMark(body), true, {
      source: 'ai',
      parentId: parent.id,
    });
  } catch (err) {
    console.error('equipment receipt failed:', err.message);
  }
}

app.post('/api/icount/webhook', async (req, res) => {
  try {
    const expectedSecret = (process.env.ICOUNT_WEBHOOK_SECRET || '').trim();
    if (!expectedSecret && process.env.NODE_ENV === 'production') {
      return res.status(503).json({ ok: false, error: 'webhook secret is not configured' });
    }
    const headerSecret = String(req.get('X-iCount-Secret') || req.get('x-icount-secret') || '');
    const legacyQuerySecret = String(req.query?.secret || '');
    const paymentId = String(req.query?.payment_id || req.body?.payment_id || '');
    const expectedSignature = icount.signWebhookPaymentId(paymentId, expectedSecret);
    const suppliedSignature = String(req.query?.signature || req.get('x-icount-signature') || '');
    const authorized = !expectedSecret
      || (headerSecret && secureCompare(headerSecret, expectedSecret))
      // Compatibility for already-issued payment links. New links use the
      // payment-bound signature and never expose the reusable secret in a URL.
      || (legacyQuerySecret && secureCompare(legacyQuerySecret, expectedSecret))
      || (expectedSignature && suppliedSignature && secureCompare(suppliedSignature, expectedSignature));
    if (!authorized) {
      console.warn('⛔ [iCount webhook] rejected — bad or missing secret');
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }

    const { payload, docId, docnum, doctype, ccBillLogId } = normalizeIcountNotifyPayload(
      req.body || {},
      req.query || {}
    );
    // שמות השדות בלבד, בלי ערכים — כדי לדעת מה iCount באמת שולח לנו, בלי
    // פרטי אשראי ביומן. חד-פעמי לכל אירוע ולא מזיק.
    console.log(
      '📩 [iCount webhook] payment/document notify',
      doctype ? `doctype=${doctype}` : '',
      docnum ? `docnum=${docnum}` : '',
      ccBillLogId ? 'cc_bill_log=yes' : 'cc_bill_log=no',
      `fields=[${Object.keys(req.body || {}).join(',').slice(0, 300)}]`
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
      // iCount calls this more than once for the same payment, and every call
      // used to be treated as the moment it was paid — which is how one family
      // got the equipment receipt twice inside the same minute. Only the call
      // that actually moves the payment may announce it.
      const alreadyPaid = payment.status === 'paid';

      const updated = db.update('payments', payment.id, {
        status: 'paid',
        // בלעדיו אין זיכוי חלקי דרך ה-API — נשמר עכשיו, גם אם המסך שישתמש
        // בו ייבנה אחר כך. תשלומים ישנים יישארו בלעדיו, וזה בסדר: עליהם
        // הזיכוי החלקי ימשיך להיעשות ידנית ב-iCount.
        cc_bill_log_id: ccBillLogId || payment.cc_bill_log_id || null,
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

      if (payment.intro_booking_id && !alreadyPaid) {
        const confirmed = await confirmIntroPayment({
          db,
          persist: persistCore,
          bookingId: payment.intro_booking_id,
          paymentId: payment.id,
          now: new Date(updated?.paid_at || Date.now()),
        });
        if (!confirmed.ok) {
          const booking = db.getOne(INTRO_COLLECTION, payment.intro_booking_id);
          if (booking) {
            const needsReview = db.update(INTRO_COLLECTION, booking.id, {
              status: 'payment_needs_review',
              payment_review_reason: confirmed.reason || 'hold_not_active',
              paid_at: updated?.paid_at || new Date().toISOString(),
            });
            if (needsReview) await persistCore(INTRO_COLLECTION, needsReview);
          }
          await createTask({
            db,
            persist: persistCore,
            actor: 'icount_webhook',
            input: {
              title: `תשלום מאוחר לאימון היכרות — ${booking?.student_name || payment.student_id || ''}`,
              parent_id: payment.parent_id || null,
              student_id: payment.student_id || null,
              priority: 'high',
              notes: `התשלום התקבל אך שמירת המקום אינה פעילה (${confirmed.reason || 'unknown'}). אין להבטיח מקום לפני בדיקת צוות.`,
            },
          });
        }
      }

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
          await fulfillSalePasses({
            sale,
            lines,
            studentId: sale.student_id,
            parentId: sale.parent_id,
            docId: docId || payment.icount_doc_id,
            docNumber: docnum || payment.icount_doc_number,
          });
          decrementInventory(lines);
          await registerEntriesForSale({ lines, studentId: sale.student_id });
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

          // סליקה בקישור היא מכירת משמרת לכל דבר. בעבר רק מזומן נכתב ביומן
          // הקופה, ולכן סיכומי המשמרת החמיצו את רוב העסקאות ששולמו באשראי.
          const saleLedger = recordSaleInLedger(db, {
            paymentMethod: sale.payment_method,
            total: sale.total,
            saleId: sale.id,
            sessionId: sale.session_id || null,
            reqUser: {
              employee_id: sale.sold_by_employee_id || null,
              name: sale.sold_by || 'סליקה בקישור',
            },
          });
          if (saleLedger) await persistCore('cash_ledger', saleLedger);

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

          // A sale that started as "go fill your forms" closes here. The link
          // is the only place staff can see that story end, so it is marked
          // before anything else can fail, and the team is told.
          if (sale.checkout_link_id) {
            await closePaidCheckoutLink(sale, updated?.paid_at);
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

      if (payment.equipment_payment && Array.isArray(payment.equipment_allocations) && payment.equipment_allocations.length) {
        const paidAt = updated?.paid_at || new Date().toISOString();
        for (const allocation of payment.equipment_allocations) {
          markEquipmentItemsPaid({
            db,
            persist: persistCore,
            studentId: allocation.student_id,
            itemTypes: allocation.item_types || [],
            shirtSize: allocation.shirt_size || null,
            paymentId: payment.id,
            rentalDays: allocation.rental_days || DEFAULT_EQUIPMENT_SETTINGS.rental_days,
            rentalEndsAt: allocation.rental_ends_at || null,
            paidAt,
          });
          const allocationId = `eqpa-${payment.id}-${allocation.student_id}`;
          const existingAllocation = db.getOne('equipment_payment_allocations', allocationId);
          if (existingAllocation) {
            const paidAllocation = db.update('equipment_payment_allocations', allocationId, {
              status: 'paid',
              paid_at: paidAt,
              updated_at: paidAt,
            });
            if (paidAllocation) await persistCore('equipment_payment_allocations', paidAllocation);
          }
        }
      } else if (payment.equipment_payment && payment.student_id) {
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

      if (payment.equipment_payment && !alreadyPaid) await sendEquipmentReceipt(payment);

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

app.get('/api/shifts/wall-history', (req, res) => {
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.month || ''))
    ? String(req.query.month)
    : '';
  res.json({
    month: month || null,
    entries: buildWallShiftHistory({
      shiftHours: db.get('shift_hours') || [],
      cashSessions: db.get('cash_register_sessions') || [],
      cashLedger: db.get('cash_ledger') || [],
      safetyInspections: db.get('safety_inspections') || [],
      employees: db.get('employees') || [],
      month,
    }),
  });
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
  if (!hasSensitiveAccess(req.crmUser, 'hr')) {
    return res.status(403).json({ error: 'אישור שעות דורש הרשאת משאבי אנוש' });
  }
  const { shiftIds } = req.body;
  if (!Array.isArray(shiftIds) || !shiftIds.length) {
    return res.status(400).json({ error: 'shiftIds is required' });
  }
  const approved = db.approveShifts(shiftIds);
  res.json({ success: approved });
});

// ─── משמרת קיר מהמסוף ────────────────────────────────────────────────────────
// פתיחת הקיר היא תהליך: כניסה למשמרת → פתיחת קופה → בדיקת חבלים ומכשירים.
// שעון השכר מתחיל בשלב הראשון, כי גם הבדיקות הן עבודה. הסגירה יוצרת שורת
// עבודה בתפקיד „הפעלת קיר” עם השעות בפועל — זו השורה שמסך השכר סוכם.

/** סגירת משמרת אחת + שורת השכר שלה. */
async function closeOneWallShift(employeeId, { closerNote = '', closedById = null } = {}) {
  const shift = db.clockOut(employeeId, closerNote, closedById, WALL_ACTIVITY_TYPE);
  if (!shift) return { shift: null, row: null };
  const cin = israelLocalParts(shift.clock_in);
  const cout = israelLocalParts(shift.clock_out);
  const settings = await readStaffAttendanceSettings(db, supa);
  const fields = buildWallPayrollRow({
    shift,
    cin,
    cout,
    dayAssignments: (db.get('work_assignments') || []).filter(
      (r) => r.employee_id === employeeId && r.date === cin?.date
    ),
    roleLabel: await systemRoleLabel(SYSTEM_ROLE_KEYS.WALL_OPERATOR),
    minutesBeforeShiftOk: settings.minutes_before_shift_ok,
    closerNote,
  });
  const row = fields ? db.insert('work_assignments', withFrozenPay(fields)) : null;
  return { shift, row };
}

/**
 * כל מה שהמסוף צריך כדי לצייר את עצמו, בקריאה אחת.
 *
 * המסך שאל קודם שלוש שאלות נפרדות (משמרות, קופה, בטיחות) והרכיב מהן מצב
 * בעצמו — כך שתשובה אחת שאיחרה הציגה שלב שכבר עבר.
 */
async function wallShiftState() {
  const employees = db.get('employees') || [];
  const byId = new Map(employees.map((e) => [e.id, e]));
  const shiftHours = db.get('shift_hours') || [];
  const open = openWallShifts(shiftHours);
  const opener = wallShiftOpener(shiftHours);
  const cash = sessionSnapshot(db);
  const dueSafety = db.getSafetyDueToday() || [];
  const pendingSafety = pendingWallSafetyChecks(dueSafety);
  const { stage, step } = wallShiftStage({
    opener,
    cashOpen: !!cash.open,
    pendingSafety,
  });
  const onShiftIds = new Set(open.map((s) => s.employee_id));
  const wallStaff = employees.filter(employeeIsWallStaff);

  // רגע השלמת התהליך נחתם כאן ולא במסך: אם המסוף נסגר או רוענן בדיוק עכשיו,
  // היום עדיין נפתח. בלי החותמת הזאת ספירת הקופה שבסגירה הייתה מחזירה את
  // המסוף לאשף הפתיחה.
  if (stage === 'open' && opener && !opener.wall_opened_at) {
    const stamped = db.update('shift_hours', opener.id, { wall_opened_at: new Date().toISOString() });
    if (stamped?.wall_opened_at) opener.wall_opened_at = stamped.wall_opened_at;
  }

  return {
    stage,
    step,
    opener: opener ? {
      shift_id: opener.id,
      employee_id: opener.employee_id,
      name: byId.get(opener.employee_id)?.name || 'עובד',
      clock_in: opener.clock_in,
      wall_opened_at: opener.wall_opened_at || null,
    } : null,
    staff: open.map((shift) => ({
      shift_id: shift.id,
      employee_id: shift.employee_id,
      name: byId.get(shift.employee_id)?.name || 'עובד',
      clock_in: shift.clock_in,
      wall_role: shift.wall_role || (opener?.id === shift.id ? WALL_ROLE.OPENER : WALL_ROLE.STAFF),
      can_close: employeeCanOperateWall(byId.get(shift.employee_id)),
      can_clock_out: canClockOut(open, shift.employee_id).ok,
    })),
    available: wallStaff
      .filter((emp) => !onShiftIds.has(emp.id))
      .map(wallStationEmployee),
    cash: {
      open: !!cash.open,
      opened_by_name: cash.open?.opened_by_name || null,
      expected_cash: cash.expected_cash ?? null,
    },
    safety: {
      due: dueSafety,
      pending: pendingSafety,
      signers: employees.filter(employeeCanSignDailySafety).map(wallStationEmployee),
      // מי שמוסמך להעביר תדריך ומבחן — הרשימה היחידה שמסך המבחנים בדלפק
      // רשאי להציע, כדי שלא ייחתם מבחן על שם מי שלא הוסמך לו.
      examiners: employees.filter(employeeCanTestSafety).map(wallStationEmployee),
    },
    closers_on_shift: qualifiedClosersOnShift(open, employees).map(wallStationEmployee),
    settings: await readStaffAttendanceSettings(db, supa),
  };
}

app.get('/api/wall-shift/state', async (req, res) => {
  try {
    res.json(await wallShiftState());
  } catch (err) {
    console.error('wall shift state error:', err.message);
    res.status(503).json({ error: 'טעינת מצב המשמרת נכשלה' });
  }
});

app.get('/api/wall-shift/open', (req, res) => {
  const open = openWallShifts(db.get('shift_hours') || []);
  res.json(open.map((s) => ({
    id: s.id,
    employee_id: s.employee_id,
    clock_in: s.clock_in,
    activity_type: s.activity_type,
    wall_role: s.wall_role || null,
  })));
});

app.post('/api/wall-shift/open', async (req, res) => {
  const {
    employee_id: employeeId,
    confirmed,
    place_orderly: placeOrderlyRaw,
    opening_note: openingNoteRaw,
  } = req.body || {};
  if (!employeeId) return res.status(400).json({ error: 'employee_id is required' });
  const emp = (db.get('employees') || []).find((e) => e.id === employeeId);
  if (!emp) return res.status(404).json({ error: 'העובד לא נמצא' });
  if (!employeeCanOperateWall(emp)) {
    return res.status(403).json({ error: 'העובד אינו מורשה לפתוח קיר' });
  }
  // הקופה ובדיקות החבלים כבר לא חוסמות כאן: הן השלבים הבאים בתהליך, לא תנאי
  // מוקדם לו, והשעון של מי שמבצע אותן חייב לרוץ כבר עכשיו. הקיר נחשב פתוח רק
  // כששלושתם הושלמו, והסגירה עדיין חסומה על קופה פתוחה.
  const shiftHours = db.get('shift_hours') || [];
  if (wallShiftOpener(shiftHours)) {
    return res.status(409).json({ error: 'כבר יש משמרת פתוחה', code: 'SHIFT_ALREADY_OPEN' });
  }
  if (openWallShifts(shiftHours).some((s) => s.employee_id === employeeId)) {
    return res.status(409).json({ error: 'העובד כבר נמצא במשמרת', code: 'ALREADY_ON_SHIFT' });
  }
  const settings = await readStaffAttendanceSettings(db, supa);
  // Older clients only sent `confirmed`; they are treated as the old "yes"
  // answer. The current terminal always records an explicit yes/no choice.
  const placeOrderly = typeof placeOrderlyRaw === 'boolean'
    ? placeOrderlyRaw
    : (confirmed === true ? true : null);
  const openingNote = String(openingNoteRaw || '').trim().slice(0, 2000);
  if (placeOrderly == null) {
    return res.status(400).json({
      error: 'יש לבחור האם המקום מסודר',
      code: 'CONFIRM_REQUIRED',
      confirm_message: settings.wall_open_confirm_message,
    });
  }
  if (placeOrderly === false && !openingNote) {
    return res.status(400).json({
      error: 'כשהמקום אינו מסודר יש לכתוב הערה',
      code: 'OPENING_NOTE_REQUIRED',
    });
  }
  const shift = db.clockIn(employeeId, WALL_ACTIVITY_TYPE, 'משמרת קיר — מסוף כניסה', {
    wall_role: WALL_ROLE.OPENER,
    place_orderly: placeOrderly,
    opening_note: openingNote,
  });
  res.status(201).json({ shift, state: await wallShiftState() });
});

app.post('/api/wall-shift/staff/clock-in', async (req, res) => {
  const { employee_id: employeeId } = req.body || {};
  if (!employeeId) return res.status(400).json({ error: 'employee_id is required' });
  if (!wallShiftOpener(db.get('shift_hours') || [])) {
    return res.status(409).json({ error: 'צריך לפתוח משמרת קודם', code: 'NO_OPEN_SHIFT' });
  }
  const emp = (db.get('employees') || []).find((e) => e.id === employeeId);
  const allowed = canJoinShift(emp);
  if (!allowed.ok) return res.status(emp ? 403 : 404).json({ error: allowed.error });
  if (openWallShifts(db.get('shift_hours') || []).some((s) => s.employee_id === employeeId)) {
    return res.status(409).json({ error: 'העובד כבר נמצא במשמרת', code: 'ALREADY_ON_SHIFT' });
  }
  const shift = db.clockIn(employeeId, WALL_ACTIVITY_TYPE, 'כניסה למשמרת — מסוף כניסה', {
    wall_role: WALL_ROLE.STAFF,
  });
  res.status(201).json({ shift, state: await wallShiftState() });
});

app.post('/api/wall-shift/staff/clock-out', async (req, res) => {
  const { employee_id: employeeId } = req.body || {};
  if (!employeeId) return res.status(400).json({ error: 'employee_id is required' });
  const allowed = canClockOut(openWallShifts(db.get('shift_hours') || []), employeeId);
  if (!allowed.ok) {
    return res.status(allowed.code === 'NOT_ON_SHIFT' ? 404 : 409)
      .json({ error: allowed.error, code: allowed.code });
  }
  const { shift, row } = await closeOneWallShift(employeeId);
  if (!shift) return res.status(404).json({ error: 'אין משמרת פתוחה לעובד הזה' });
  res.json({ shift, row, state: await wallShiftState() });
});

/**
 * סגירת המשמרת: מוציאה את כל מי שעוד רשום בה, והסוגר אחרון.
 *
 * דיווח הסגירה הוא גם דיווח היציאה של הסוגר — אחרת מי שסוגר את הקיר נשאר
 * רשום כנמצא בו.
 */
app.post('/api/wall-shift/close', async (req, res) => {
  const body = req.body || {};
  const closedById = body.closed_by || body.employee_id;

  // אי אפשר לסגור משמרת קיר לפני שסוגרים את הקופה.
  if (getOpenSession(db)) {
    return res.status(409).json({
      error: 'יש לסגור את הקופה לפני סגירת משמרת הקיר',
      code: 'CASH_STILL_OPEN',
    });
  }

  // מי שסוגר לא חייב להיות מי שפתח — מדריך אחר יכול לסגור בשם מי שכבר הלך.
  let closer;
  try {
    closer = requireQualifiedWallCloser(db.get('employees') || [], closedById);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  const openShifts = openWallShifts(db.get('shift_hours') || []);
  if (openShifts.length === 0) return res.status(404).json({ error: 'אין משמרת פתוחה' });

  const openerShift = wallShiftOpener(openShifts);
  if (openerShift) {
    db.update('shift_hours', openerShift.id, {
      closed_by_employee_id: closer.id,
      wall_closing_note: String(body.notes || '').trim().slice(0, 2000),
      wall_close_checklist_confirmed: body.checklist_confirmed === true,
    });
  }

  const closerNote = `נסגר ע"י ${closer.name}`;
  const ordered = [
    ...openShifts.filter((s) => s.employee_id !== closer.id),
    ...openShifts.filter((s) => s.employee_id === closer.id),
  ];

  const closed = [];
  for (const openShift of ordered) {
    const isCloser = openShift.employee_id === closer.id;
    const result = await closeOneWallShift(openShift.employee_id, {
      closerNote: isCloser ? '' : closerNote,
      closedById: isCloser ? null : closer.id,
    });
    if (result.shift) closed.push(result);
  }

  res.json({
    closed: closed.map(({ shift, row }) => ({ shift, row })),
    shift: closed[closed.length - 1]?.shift || null,
    row: closed[closed.length - 1]?.row || null,
    state: await wallShiftState(),
  });
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
 * אותה תווית, בלי המתנה. הקטלוג נשמר מקומית ברגע שנקרא, ולכן מסלול שכבר קרא
 * אותו יכול לשאול שוב באופן סינכרוני — וברירת המחדל תמיד קיימת.
 */
function systemRoleLabelSync(key) {
  const local = db.getAppSettingLocal?.(ROLE_CATALOG_KEY);
  const catalog = local ? normalizeCatalog(local) : blankCatalog();
  const found = catalog.system.find((r) => r.key === key);
  return found?.label || DEFAULT_SYSTEM_ROLES.find((r) => r.key === key)?.label || '';
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
/**
 * מה כל אירוע צריך מבחינת כוח אדם: „מפעיל קיר אחד ושני עוזרי מדריך”.
 *
 * טבלה נפרדת ולא עמודה על `activities`, כי `activities` היא טבלת SQL עם עמודות
 * מפורשות ואי אפשר להריץ מכאן מיגרציה — רישום עמודה שאינה קיימת היה מפיל כל
 * שמירה של אירוע. השורה היא מסמך אחד לכל אירוע, וזה בדיוק מה שהאחסון התפעולי
 * נועד לו. מזהה השורה הוא מזהה האירוע, כך שאין חיפוש ואין שתי שורות לאירוע אחד.
 */
const STAFF_NEEDS_TABLE = 'activity_staff_needs';
const CLASS_NEEDS_TABLE = 'class_staff_needs';

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
  // צרכי האיוש של אירועים ושל טפסי המשמרות. בלי אלה שינוי שם תפקיד היה משאיר
  // טופס שנשלח לצוות מבקש תפקיד שכבר לא קיים — מושב שאיש אינו מסומן בו, ולכן
  // איש לא יכול לקחת אותו.
  for (const row of [...(db.get(STAFF_NEEDS_TABLE) || []).map((r) => [STAFF_NEEDS_TABLE, r]),
    ...(db.get(CLASS_NEEDS_TABLE) || []).map((r) => [CLASS_NEEDS_TABLE, r])]) {
    const [table, needsRow] = row;
    const needs = Array.isArray(needsRow.needs) ? needsRow.needs : [];
    if (!needs.some((need) => need.role === from)) continue;
    db.update(table, needsRow.id, {
      needs: needs.map((need) => (need.role === from ? { ...need, role: to } : need)),
    });
    touched += 1;
  }
  for (const win of db.get('shift_signup_windows') || []) {
    const slots = Array.isArray(win.slots) ? win.slots : [];
    if (!slots.some((slot) => (slot.needs || []).some((need) => need.role === from))) continue;
    db.update('shift_signup_windows', win.id, {
      slots: slots.map((slot) => ({
        ...slot,
        needs: (slot.needs || []).map((need) => (need.role === from ? { ...need, role: to } : need)),
      })),
    });
    touched += 1;
  }
  // ומה שכבר נבחר בתשובות, אחרת סימון של עובד מצביע על מושב שאין לו שם.
  for (const answer of db.get('shift_signup_responses') || []) {
    const picks = Array.isArray(answer.picks) ? answer.picks : [];
    if (!picks.some((pick) => pick.role === from)) continue;
    db.update('shift_signup_responses', answer.id, {
      picks: picks.map((pick) => (pick.role === from ? { ...pick, role: to } : pick)),
    });
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
    .map(wallStationEmployee));
});

const EMPLOYEE_OPERATIONAL_FIELDS = new Set([
  'id', 'name', 'role', 'certifications', 'is_active', 'active', 'availability',
  'is_wall_staff', 'staff_category',
  'can_open_wall', 'can_sign_daily_safety', 'can_operate_cash', 'can_test_safety',
  'customer_student_id',
]);
const EMPLOYEE_STAFF_CATEGORIES = new Set(['trainer', 'assistant', 'youth_trainer', 'other']);

function isOwnEmployeeRequest(req, employeeId) {
  return Boolean(req.crmUser?.employee_id && String(req.crmUser.employee_id) === String(employeeId));
}

function employeeOperationalView(employee) {
  return Object.fromEntries(Object.entries(employee || {}).filter(([key]) => EMPLOYEE_OPERATIONAL_FIELDS.has(key)));
}

function employeePrivateView(employee) {
  if (!employee) return employee;
  return {
    ...employee,
    documents: publicLegacyDocuments(employee.documents || {}),
    payroll_documents: payrollDocumentsOf(employee).map(publicPayrollDocument),
  };
}

function employeeForRequest(req, employee) {
  if (!employee) return employee;
  if (hasSensitiveAccess(req.crmUser, 'hr') || isOwnEmployeeRequest(req, employee.id)) return employeePrivateView(employee);
  return employeeOperationalView(employee);
}

function employeePatchForRequest(req, current, patch = {}) {
  const normalizedPatch = { ...patch };
  if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'staff_category')) {
    const category = String(normalizedPatch.staff_category || '').trim();
    if (category && !EMPLOYEE_STAFF_CATEGORIES.has(category)) {
      throw Object.assign(new Error('קטגוריית העובד אינה תקינה'), { statusCode: 400 });
    }
    normalizedPatch.staff_category = category || null;
  }
  if (hasSensitiveAccess(req.crmUser, 'hr')) return normalizedPatch;
  const safe = {};
  for (const [key, value] of Object.entries(normalizedPatch)) {
    if (EMPLOYEE_OPERATIONAL_FIELDS.has(key) && key !== 'id') {
      safe[key] = value;
      continue;
    }
    if (JSON.stringify(value) !== JSON.stringify(current?.[key])) {
      throw Object.assign(new Error('אין הרשאה לשנות שכר או מידע אישי של העובד'), { statusCode: 403 });
    }
  }
  return safe;
}

app.get('/api/employees', (req, res) => {
  res.json((db.get('employees') || []).map((employee) => employeeForRequest(req, employee)));
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
  try {
    const payload = employeePatchForRequest(req, {}, req.body || {});
    const employee = db.insert('employees', payload);
    res.status(201).json(employeeForRequest(req, employee));
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message });
  }
});

app.put('/api/employees/:id', (req, res) => {
  const { id } = req.params;
  const current = db.getOne('employees', id);
  if (!current) return res.status(404).json({ error: 'Employee not found' });
  try {
    const updated = db.update('employees', id, employeePatchForRequest(req, current, req.body || {}));
    res.json(employeeForRequest(req, updated));
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message });
  }
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

// למדריך יש בדרך כלל יותר מתעודה אחת (סלע, מע"ר, עזרה ראשונה). הראשונה נשמרת
// במפתח הישן `certificates` כדי שכרטיסים קיימים לא ישתנו, והנוספות במפתחות
// certificate_2, certificate_3 — כל אחת קובץ אחד.
const EXTRA_CERT_KEY = /^certificate_(\d+)$/;

function isEmployeeDocType(docType) {
  return !!EMPLOYEE_DOC_TYPES[docType] || EXTRA_CERT_KEY.test(String(docType || ''));
}

function employeeDocLabel(docType) {
  const extra = EXTRA_CERT_KEY.exec(String(docType || ''));
  if (extra) return `תעודה ${extra[1]}`;
  return EMPLOYEE_DOC_TYPES[docType] || docType;
}

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

/**
 * העלאת מסמך אחד לתיק העובד. משותפת למסך העובדים ולטופס הקליטה הציבורי, כדי
 * שקובץ שהעובד צירף בעצמו יישמר בדיוק כמו קובץ שהעלה מנהל — אותו נתיב אחסון,
 * אותה מטא-דאטה ואותו דגל ישן.
 * מחזירה { error, status } כשהקלט פסול, או { document, employee } בהצלחה.
 */
async function storeEmployeeDocument(employeeId, { docType, fileBase64, fileName, mimeType }) {
  const emp = (db.get('employees') || []).find((e) => e.id === employeeId);
  if (!emp) return { status: 404, error: 'העובד לא נמצא' };
  if (!isEmployeeDocType(docType)) return { status: 400, error: 'סוג מסמך לא תקין' };
  const validated = validateUploadedDocument(fileBase64);
  if (validated.error) return { status: 400, error: validated.error };
  const { buffer, mimeType: safeMime, ext } = validated;
  const baseName = String(fileName || docType).replace(/\.[^.]+$/, '');
  const safeName = `${baseName}.${ext}`
    .replace(/[^\w\u0590-\u05ff.\-]+/g, '_')
    .slice(0, 120);
  const storagePath = `${emp.id}/${docType}_${Date.now()}.${ext}`;

  const prev = emp.documents?.[docType];
  if (prev?.storagePath) {
    await supa.removeEmployeeDocument(prev.storagePath);
  }

  const uploaded = await supa.uploadEmployeeDocument(storagePath, buffer, safeMime);
  if (!uploaded.ok) {
    return { status: 500, error: uploaded.error || 'שמירת הקובץ נכשלה' };
  }

  const docMeta = {
    fileName: safeName,
    storagePath,
    mimeType: safeMime,
    uploadedAt: new Date().toISOString(),
  };
  // נקרא מחדש: כשמעלים כמה קבצים ברצף, `emp` שנתפס למעלה כבר לא מכיל את
  // הקודמים, והמיזוג היה מוחק אותם.
  const fresh = (db.get('employees') || []).find((e) => e.id === employeeId) || emp;
  const documents = { ...(fresh.documents || {}), [docType]: docMeta };
  const flag = EMPLOYEE_DOC_FLAG[docType];
  const updated = db.update('employees', emp.id, {
    documents,
    ...(flag ? { [flag]: true } : {}),
  });
  await persistCore('employees', updated);
  return { document: docMeta, employee: updated };
}

app.post('/api/employees/:id/documents', async (req, res) => {
  const emp = (db.get('employees') || []).find((e) => e.id === req.params.id);
  if (!emp) return res.status(404).json({ error: 'העובד לא נמצא' });
  if (!hasSensitiveAccess(req.crmUser, 'hr')) {
    return res.status(403).json({ error: 'רק מנהל או בעל הרשאת משאבי אנוש יכול להעלות מסמך רשמי' });
  }

  const { docType, fileBase64, fileName, mimeType } = req.body || {};
  const result = await storeEmployeeDocument(req.params.id, { docType, fileBase64, fileName, mimeType });
  if (result.error) return res.status(result.status || 400).json({ error: result.error });

  res.json({
    success: true,
    document: publicLegacyDocuments({ [docType]: result.document })[docType],
    employee: employeePrivateView(result.employee),
  });
});

app.delete('/api/employees/:id/documents/:docType', async (req, res) => {
  const emp = (db.get('employees') || []).find((e) => e.id === req.params.id);
  if (!emp) return res.status(404).json({ error: 'העובד לא נמצא' });
  if (!hasSensitiveAccess(req.crmUser, 'hr')) {
    return res.status(403).json({ error: 'רק מנהל או בעל הרשאת משאבי אנוש יכול למחוק מסמך רשמי' });
  }

  const { docType } = req.params;
  if (!isEmployeeDocType(docType)) {
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
  res.json({ success: true, employee: employeePrivateView(updated) });
});

app.get('/api/employees/:id/documents/:docType/download', async (req, res) => {
  const emp = (db.get('employees') || []).find((e) => e.id === req.params.id);
  if (!emp) return res.status(404).json({ error: 'העובד לא נמצא' });
  if (!hasSensitiveAccess(req.crmUser, 'hr') && !isOwnEmployeeRequest(req, emp.id)) {
    return res.status(403).json({ error: 'אין הרשאה להוריד מסמך של עובד אחר' });
  }

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
  // `apply_from` הוא הוראה לשמירה הזו בלבד ולא שדה של ההסכם.
  const { apply_from: _applyFrom, ...rest } = body;
  const next = { ...rest };
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

/** תאריך תקין בלבד — כל ערך אחר אומר „אל תיגע בשורות קיימות”. */
function normalizeApplyFrom(value) {
  const s = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * החלת תעריף חדש על שורות עבודה שכבר נרשמו.
 *
 * שורה שננעלה — יום שנסגר או שכר שאושר — לא זזה גם אם היא בטווח: זו האמת על
 * מה ששולם. השאר מתומחרות מחדש לפי ההסכם החדש, כי בלי זה אירוע שנקבע מראש
 * היה נשאר לנצח עם התעריף שהיה ביום ששיבצו אליו.
 */
function repriceWorkRowsFrom(employeeId, fromDate) {
  const from = normalizeApplyFrom(fromDate);
  if (!employeeId || !from) return { updated: 0, locked: 0 };
  let updated = 0;
  let locked = 0;
  for (const row of db.get('work_assignments') || []) {
    if (row.employee_id !== employeeId) continue;
    if (!row.date || row.date < from) continue;
    if (row.pay_locked_at) {
      locked += 1;
      continue;
    }
    db.update('work_assignments', row.id, payFieldsForWorkRow(row));
    updated += 1;
  }
  return { updated, locked };
}

app.get('/api/wages', (req, res) => {
  res.json((db.get('wage_agreements') || []).map(wageWithRates));
});

app.post('/api/wages', (req, res) => {
  const { employee_id } = req.body || {};
  if (!employee_id) return res.status(400).json({ error: 'employee_id is required' });
  const body = normalizeWageBody(req.body);
  const applyFrom = normalizeApplyFrom(req.body?.apply_from);

  // One agreement per employee: reuse the existing row instead of creating a duplicate.
  const existing = (db.get('wage_agreements') || []).find((w) => w.employee_id === employee_id);
  if (existing) {
    const updated = db.update('wage_agreements', existing.id, { ...body, id: existing.id });
    return res.json({ ...wageWithRates(updated), repriced: repriceWorkRowsFrom(employee_id, applyFrom) });
  }

  const created = db.insert('wage_agreements', body);
  res.status(201).json({
    ...wageWithRates(created),
    repriced: repriceWorkRowsFrom(employee_id, applyFrom),
  });
});

app.put('/api/wages/:id', (req, res) => {
  const { id } = req.params;
  const applyFrom = normalizeApplyFrom(req.body?.apply_from);
  const updated = db.update('wage_agreements', id, normalizeWageBody(req.body));
  if (!updated) return res.status(404).json({ error: 'Wage agreement not found' });
  res.json({
    ...wageWithRates(updated),
    repriced: repriceWorkRowsFrom(updated.employee_id, applyFrom),
  });
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
  // נסיעות ליום הזה בלבד. ריק = ליפול לתעריף הקבוע שבהסכם, ולכן ריק ואפס
  // אינם אותו דבר: אפס הוא „ביום הזה לא היו נסיעות”.
  const travelAmount = body.travel_amount === undefined
    ? (existing?.travel_amount ?? null)
    : (body.travel_amount === null || body.travel_amount === ''
      ? null
      : Math.max(0, Number(body.travel_amount) || 0));
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
    travel_amount: travelAmount,
    source: body.source || existing?.source || 'manual',
    shift_id: body.shift_id !== undefined ? (body.shift_id || null) : (existing?.shift_id ?? null),
    approved: body.approved !== undefined ? !!body.approved : !!(existing?.approved),
    notes: body.notes !== undefined ? (body.notes || '') : (existing?.notes || ''),
    exception_notes: body.exception_notes !== undefined
      ? (body.exception_notes || '')
      : (existing?.exception_notes || ''),
  };
}

function workAssignmentForRequest(req, row) {
  if (hasSensitiveAccess(req.crmUser, 'hr') || isOwnEmployeeRequest(req, row?.employee_id)) return row;
  return Object.fromEntries(Object.entries(row || {}).filter(([key]) => !WORK_PAY_FIELDS.has(key)));
}

function rejectWorkPayOverride(req, body = {}, existing = {}) {
  if (hasSensitiveAccess(req.crmUser, 'hr')) return;
  if (hasWorkPayOverride(body, existing)) {
    throw Object.assign(new Error('אין הרשאה לשנות תעריף או סכום שכר'), { statusCode: 403 });
  }
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
  res.json(rows.map((row) => workAssignmentForRequest(req, row)));
});

app.post('/api/work-assignments/from-activity', async (req, res) => {
  const {
    activity_id,
    employee_ids,
    employee_roles: employeeRoles,
    employee_assignments: employeeAssignments,
    role: roleOverride,
    pay_mode: payModeOverride,
    flat_amount: flatAmountOverride,
    start_time: startOverride,
    end_time: endOverride,
  } = req.body || {};
  const assignmentDetails = employeeAssignments
    && typeof employeeAssignments === 'object'
    && !Array.isArray(employeeAssignments)
    ? employeeAssignments
    : {};
  try {
    rejectWorkPayOverride(req, {
      pay_mode: payModeOverride,
      flat_amount: flatAmountOverride,
    });
    for (const detail of Object.values(assignmentDetails)) {
      if (!detail || typeof detail !== 'object' || Array.isArray(detail)) continue;
      rejectWorkPayOverride(req, {
        pay_mode: detail.pay_mode,
        flat_amount: detail.flat_amount,
        travel_amount: detail.travel_amount,
      });
    }
  } catch (error) {
    return res.status(error.statusCode || 403).json({ error: error.message });
  }
  if (!activity_id) return res.status(400).json({ error: 'activity_id is required' });
  const activity = db.getOne('activities', activity_id);
  if (!activity) return res.status(404).json({ error: 'Activity not found' });
  if (!activity.date) return res.status(400).json({ error: 'Activity has no date' });

  const ids = Array.isArray(employee_ids)
    ? employee_ids.filter(Boolean)
    : [];
  if (!ids.length) return res.status(400).json({ error: 'employee_ids is required' });
  try {
    requireActiveEmployees(ids);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message, code: error.code });
  }

  const workType = activityTypeToWorkType(activity.type);
  // מה שנבחר במסך השיבוץ גובר על ההגדרה השמורה של האירוע: הבחירה נעשית רגע
  // לפני הלחיצה, ולפעמים עוד לפני ששמרו את האירוע עצמו.
  const hm = (value) => {
    const s = String(value || '').slice(0, 5);
    return /^\d{2}:\d{2}$/.test(s) ? s : null;
  };
  const eventStart = hm(startOverride) || activity.start_time || '09:00';
  const eventEnd = hm(endOverride) || activity.end_time || '17:00';
  const eventHours = hoursBetweenHm(eventStart, eventEnd) || 2;
  // האירוע עצמו קובע את התפקיד ואת אופן התשלום: „לפי תעריף” מושך את התעריף
  // האישי של כל עובד לתפקיד הזה, ו„גלובלי” משלם סכום קבוע שהוגדר על האירוע.
  // כשלסוג הפעילות מתאימים כמה תפקידים, כל עובד יכול לשבת בתפקיד אחר —
  // `employee_roles` נושא את הבחירה, ובלי זה נופלים לתפקיד הראשון שמתאים.
  const allowedRoles = await rolesForActivityType(activity.type);
  const defaultRole = (roleOverride ? String(roleOverride) : '')
    || activity.staff_role
    || allowedRoles[0]
    || workTypeRole(workType)
    || null;
  const flatPay = payModeOverride
    ? payModeOverride === 'flat'
    : activity.staff_pay_mode === 'flat';
  const flatSource = flatAmountOverride !== undefined
    ? flatAmountOverride
    : activity.staff_flat_amount;
  const flatAmount = flatPay ? (Number(flatSource) || 0) : null;
  // שעות שנקבעו במפורש הן ההוראה; שאיבה משעון הנוכחות היא רק ניחוש כשאין כזו.
  const explicitTimes = !!(hm(startOverride) && hm(endOverride));
  const created = [];

  // הרשימה נקראת מחדש בכל סיבוב ולא פעם אחת לפני הלולאה: שמירת האירוע
  // והכפתור בפאנל יכולים להגיע כמעט יחד, ושתי בקשות שקראו את אותו צילום מצב
  // הכניסו שתיהן שורה — אותו עובד שובץ פעמיים לאותו אירוע, ושולם פעמיים.
  const alreadyAssigned = (employeeId) => (db.get('work_assignments') || []).some(
    (r) => String(r.activity_id) === String(activity_id)
      && String(r.employee_id) === String(employeeId)
  );

  for (const employeeId of ids) {
    if (alreadyAssigned(employeeId)) continue;
    const detail = assignmentDetails[employeeId]
      && typeof assignmentDetails[employeeId] === 'object'
      && !Array.isArray(assignmentDetails[employeeId])
      ? assignmentDetails[employeeId]
      : {};
    const rowStart = hm(detail.start_time) || eventStart;
    const rowEnd = hm(detail.end_time) || eventEnd;
    const rowHasExplicitTimes = !!(
      (hm(detail.start_time) && hm(detail.end_time)) || explicitTimes
    );
    const suggestion = rowHasExplicitTimes
      ? null
      : suggestHoursFromClock(employeeId, activity.date, rowStart, rowEnd);
    const rowFlatPay = detail.pay_mode
      ? detail.pay_mode === 'flat'
      : flatPay;
    const rowFlatSource = Object.hasOwn(detail, 'flat_amount')
      ? detail.flat_amount
      : flatAmount;
    const rowTravelAmount = Object.hasOwn(detail, 'travel_amount')
      ? (detail.travel_amount === '' || detail.travel_amount === null
        ? null
        : Math.max(0, Number(detail.travel_amount) || 0))
      : null;
    const row = db.insert('work_assignments', withFrozenPay({
      employee_id: employeeId,
      activity_id,
      date: activity.date,
      work_type: workType,
      role: Object.hasOwn(detail, 'role')
        ? (detail.role || null)
        : ((employeeRoles && employeeRoles[employeeId]) || defaultRole),
      start_time: suggestion?.start_time || rowStart,
      end_time: suggestion?.end_time || rowEnd,
      hours: detail.hours === undefined || detail.hours === null || detail.hours === ''
        ? (suggestion?.hours || hoursBetweenHm(rowStart, rowEnd) || eventHours)
        : roundHoursQuarter(detail.hours),
      pay_mode: rowFlatPay ? 'flat' : 'hourly',
      flat_amount: rowFlatPay ? (Number(rowFlatSource) || 0) : null,
      travel_amount: rowTravelAmount,
      source: suggestion ? suggestion.source : 'calendar',
      shift_id: suggestion?.shift_id || null,
      approved: false,
      notes: '',
    }));
    created.push(row);
  }

  // The employee hears about their own placement without the screen waiting on
  // WhatsApp: a slow send must not make the assignment look like it failed.
  notifyShiftAssigned(created).catch((err) =>
    console.error('shift assigned notify failed:', err.message));

  res.status(201).json({
    created: created.map((row) => workAssignmentForRequest(req, row)),
    existing_count: ids.length - created.length,
  });
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

  try {
    requireActiveEmployees([employeeId]);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message, code: error.code });
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
  if (!hasSensitiveAccess(req.crmUser, 'hr') && !isOwnEmployeeRequest(req, req.params.id)) {
    return res.status(403).json({ error: 'אין הרשאה לצפות בנוכחות של עובד אחר' });
  }
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

/**
 * יומן המשמרות בתיק העובד — עבר ועתיד ברשימה אחת ממוינת. הבנייה עצמה
 * ב-employeeShiftJournal.js; כאן רק אוספים את הטבלאות ומגישים.
 */
app.get('/api/employees/:id/shift-journal', (req, res) => {
  const employee = db.getOne('employees', req.params.id);
  if (!employee) return res.status(404).json({ error: 'העובד לא נמצא' });
  if (!hasSensitiveAccess(req.crmUser, 'hr') && !isOwnEmployeeRequest(req, employee.id)) {
    return res.status(403).json({ error: 'אין הרשאה לצפות ביומן של עובד אחר' });
  }
  const horizonDays = Number(req.query.horizon_days);
  const journal = buildShiftJournal({
    employeeId: req.params.id,
    workAssignments: db.get('work_assignments') || [],
    staffAttendance: db.get('staff_attendance') || [],
    groups: db.get('groups') || [],
    activities: db.get('activities') || [],
    shiftHours: db.get('shift_hours') || [],
    horizonDays: Number.isFinite(horizonDays) ? horizonDays : 60,
  });
  res.json(journal);
});

const PAYROLL_DOCUMENT_TYPES = Object.freeze({
  payslip: 'תלוש משכורת',
  invoice: 'חשבונית מהעובד',
  salary_transfer: 'אישור העברת או הפקדת משכורת',
  pension_split: 'דף פיצול',
  pension_deposit: 'אישור הפקדה לפנסיה',
  tax_insurance: 'מסמכי מס וביטוח',
  employment: 'חוזה העסקה או טופס 101',
  certificate: 'תעודות ואישורים מקצועיים',
  other: 'מסמך אחר',
});

function payrollDocumentsOf(employee) {
  return Array.isArray(employee?.payroll_documents) ? employee.payroll_documents : [];
}

function publicPayrollDocument(document) {
  if (!document) return null;
  const { storage_path: _storagePath, ...safe } = document;
  return safe;
}

function publicLegacyDocuments(documents = {}) {
  return Object.fromEntries(Object.entries(documents).map(([key, value]) => {
    if (!value || typeof value !== 'object') return [key, value];
    const { storagePath: _storagePath, ...safe } = value;
    return [key, safe];
  }));
}

function employeeSelfPayload(employee) {
  return {
    ...employee,
    documents: publicLegacyDocuments(employee?.documents || {}),
    payroll_documents: payrollDocumentsOf(employee).map(publicPayrollDocument),
  };
}

function employeeJournal(employeeId, horizonDays = 60) {
  return buildShiftJournal({
    employeeId,
    workAssignments: db.get('work_assignments') || [],
    staffAttendance: db.get('staff_attendance') || [],
    groups: db.get('groups') || [],
    activities: db.get('activities') || [],
    shiftHours: db.get('shift_hours') || [],
    horizonDays,
  });
}

function employeeFilePayload(employee, requestedMonth) {
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(requestedMonth || ''))
    ? String(requestedMonth)
    : israelDateStr().slice(0, 7);
  const journal = employeeJournal(employee.id, 60);
  const entries = journal.entries.filter((entry) => String(entry.date || '').startsWith(month));
  const earned = entries.reduce((sum, entry) => (
    entry.status === 'logged' ? sum + (Number(entry.pay_amount) || 0) : sum
  ), 0);
  const hours = entries.reduce((sum, entry) => (
    entry.status === 'logged' ? sum + (Number(entry.hours) || 0) : sum
  ), 0);
  const agreement = (db.get('wage_agreements') || []).find((item) => item.employee_id === employee.id);
  return {
    employee: employeeSelfPayload(employee),
    wage: agreement ? wageWithRates(agreement) : null,
    month,
    shifts: entries,
    summary: { hours: Math.round(hours * 100) / 100, earned: Math.round(earned * 100) / 100 },
    document_types: PAYROLL_DOCUMENT_TYPES,
  };
}

async function savePayrollDocument(req, employee, source) {
  const { type, period, title, fileBase64, fileName, mimeType } = req.body || {};
  const cleanType = String(type || '').trim();
  if (!PAYROLL_DOCUMENT_TYPES[cleanType]) {
    throw Object.assign(new Error('סוג המסמך אינו תקין'), { statusCode: 400 });
  }
  const cleanPeriod = String(period || '').trim();
  if (cleanPeriod && !/^\d{4}-(0[1-9]|1[0-2])$/.test(cleanPeriod)) {
    throw Object.assign(new Error('תקופת המסמך חייבת להיות בפורמט YYYY-MM'), { statusCode: 400 });
  }
  const validated = validateUploadedDocument(fileBase64);
  if (validated.error) {
    throw Object.assign(new Error(validated.error), { statusCode: 400 });
  }
  const { buffer, mimeType: safeMime, ext: extension } = validated;
  const baseName = String(fileName || cleanType).replace(/\.[^.]+$/, '');
  const safeName = `${baseName}.${extension}`
    .replace(/[^\w\u0590-\u05ff.\-]+/g, '_')
    .slice(0, 120);
  const id = `paydoc-${crypto.randomUUID()}`;
  const storagePath = `${employee.id}/payroll/${cleanPeriod || 'general'}/${id}.${extension}`;
  const uploaded = await supa.uploadEmployeeDocument(storagePath, buffer, safeMime);
  if (!uploaded.ok) throw new Error(uploaded.error || 'שמירת הקובץ נכשלה');
  const document = {
    id,
    employee_id: employee.id,
    type: cleanType,
    type_label: PAYROLL_DOCUMENT_TYPES[cleanType],
    period: cleanPeriod || null,
    title: String(title || PAYROLL_DOCUMENT_TYPES[cleanType]).trim().slice(0, 160),
    file_name: safeName,
    mime_type: safeMime,
    storage_path: storagePath,
    source,
    uploaded_by_user_id: String(req.crmUser?.id || ''),
    uploaded_by_name: String(req.crmUser?.name || req.crmUser?.email || ''),
    uploaded_at: new Date().toISOString(),
  };
  const updated = db.update('employees', employee.id, {
    payroll_documents: [document, ...payrollDocumentsOf(employee)],
  });
  await persistCore('employees', updated);
  return document;
}

async function removePayrollDocument(req, employee, documentId, { self = false } = {}) {
  const document = payrollDocumentsOf(employee).find((item) => item.id === documentId);
  if (!document) throw Object.assign(new Error('המסמך לא נמצא'), { statusCode: 404 });
  if (self && (document.source !== 'employee' || document.uploaded_by_user_id !== String(req.crmUser?.id || ''))) {
    throw Object.assign(new Error('עובד יכול להסיר רק מסמך שהוא העלה בעצמו'), { statusCode: 403 });
  }
  if (document.storage_path) await supa.removeEmployeeDocument(document.storage_path);
  const updated = db.update('employees', employee.id, {
    payroll_documents: payrollDocumentsOf(employee).filter((item) => item.id !== documentId),
  });
  await persistCore('employees', updated);
  return document;
}

async function downloadPayrollDocument(res, employee, documentId) {
  const document = payrollDocumentsOf(employee).find((item) => item.id === documentId);
  if (!document?.storage_path) return res.status(404).json({ error: 'המסמך לא נמצא' });
  const downloaded = await supa.downloadEmployeeDocument(document.storage_path);
  if (!downloaded.ok || !downloaded.blob) {
    return res.status(500).json({ error: downloaded.error || 'הורדת המסמך נכשלה' });
  }
  const buffer = Buffer.from(await downloaded.blob.arrayBuffer());
  res.setHeader('Content-Type', document.mime_type || 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(document.file_name || 'document.pdf')}`);
  return res.send(buffer);
}

app.get('/api/settings/users/:id/employee-file', requireOwner, async (req, res) => {
  try {
    const preview = await getAuthorizedUserPreview(req.params.id, req.crmUser);
    if (!preview.employee_id) {
      return res.status(404).json({ error: 'לא נמצא תיק עובד יחיד התואם למייל המשתמש' });
    }
    const employee = db.getOne('employees', preview.employee_id);
    if (!employee) return res.status(404).json({ error: 'תיק העובד לא נמצא' });
    return res.json({ ...employeeFilePayload(employee, req.query.month), read_only: true });
  } catch (error) {
    return res.status(error.statusCode || 503).json({ error: error.message || 'טעינת תיק העובד נכשלה' });
  }
});

app.get('/api/me/employee', (req, res) => {
  const employee = req.crmUser?.employee_id ? db.getOne('employees', req.crmUser.employee_id) : null;
  if (!employee) return res.status(404).json({ error: 'לא נמצא תיק עובד יחיד התואם למייל המשתמש' });
  res.json(employeeFilePayload(employee, req.query.month));
});

app.get('/api/me/employee/documents', (req, res) => {
  const employee = req.crmUser?.employee_id ? db.getOne('employees', req.crmUser.employee_id) : null;
  if (!employee) return res.status(404).json({ error: 'תיק העובד לא נמצא' });
  res.json(payrollDocumentsOf(employee).map(publicPayrollDocument));
});

app.post('/api/me/employee/documents', async (req, res) => {
  const employee = req.crmUser?.employee_id ? db.getOne('employees', req.crmUser.employee_id) : null;
  if (!employee) return res.status(404).json({ error: 'תיק העובד לא נמצא' });
  try {
    res.status(201).json(publicPayrollDocument(await savePayrollDocument(req, employee, 'employee')));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'העלאת המסמך נכשלה' });
  }
});

app.delete('/api/me/employee/documents/:documentId', async (req, res) => {
  const employee = req.crmUser?.employee_id ? db.getOne('employees', req.crmUser.employee_id) : null;
  if (!employee) return res.status(404).json({ error: 'תיק העובד לא נמצא' });
  try {
    const removed = await removePayrollDocument(req, employee, req.params.documentId, { self: true });
    res.json({ success: true, document: publicPayrollDocument(removed) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'מחיקת המסמך נכשלה' });
  }
});

app.get('/api/me/employee/documents/:documentId/download', async (req, res) => {
  const employee = req.crmUser?.employee_id ? db.getOne('employees', req.crmUser.employee_id) : null;
  if (!employee) return res.status(404).json({ error: 'תיק העובד לא נמצא' });
  return downloadPayrollDocument(res, employee, req.params.documentId);
});

app.get('/api/employees/:id/payroll-documents', (req, res) => {
  const employee = db.getOne('employees', req.params.id);
  if (!employee) return res.status(404).json({ error: 'העובד לא נמצא' });
  if (!hasSensitiveAccess(req.crmUser, 'hr') && !isOwnEmployeeRequest(req, employee.id)) {
    return res.status(403).json({ error: 'אין הרשאה למסמכי העובד' });
  }
  res.json(payrollDocumentsOf(employee).map(publicPayrollDocument));
});

app.post('/api/employees/:id/payroll-documents', async (req, res) => {
  const employee = db.getOne('employees', req.params.id);
  if (!employee) return res.status(404).json({ error: 'העובד לא נמצא' });
  if (!hasSensitiveAccess(req.crmUser, 'hr')) return res.status(403).json({ error: 'נדרשת הרשאת משאבי אנוש' });
  try {
    res.status(201).json(publicPayrollDocument(await savePayrollDocument(req, employee, 'employer')));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'העלאת המסמך נכשלה' });
  }
});

app.delete('/api/employees/:id/payroll-documents/:documentId', async (req, res) => {
  const employee = db.getOne('employees', req.params.id);
  if (!employee) return res.status(404).json({ error: 'העובד לא נמצא' });
  if (!hasSensitiveAccess(req.crmUser, 'hr')) return res.status(403).json({ error: 'נדרשת הרשאת משאבי אנוש' });
  try {
    const removed = await removePayrollDocument(req, employee, req.params.documentId);
    res.json({ success: true, document: publicPayrollDocument(removed) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'מחיקת המסמך נכשלה' });
  }
});

app.get('/api/employees/:id/payroll-documents/:documentId/download', async (req, res) => {
  const employee = db.getOne('employees', req.params.id);
  if (!employee) return res.status(404).json({ error: 'העובד לא נמצא' });
  if (!hasSensitiveAccess(req.crmUser, 'hr') && !isOwnEmployeeRequest(req, employee.id)) {
    return res.status(403).json({ error: 'אין הרשאה למסמכי העובד' });
  }
  return downloadPayrollDocument(res, employee, req.params.documentId);
});

// ─── מעקב תשלומי עובדים ─────────────────────────────────────────────────────
// שורה לכל עובד לכל חודש: מה הוא עבד, מה שולם, ואילו מסמכים התקבלו. הסיכום
// מחושב מ-work_assignments כל עוד החודש פתוח, ונצרב על השורה כשסוגרים אותו.

/** קריאת השורות השמורות דרך המטמון, עם נפילה לזיכרון אם הקריאה נכשלה. */
async function readPayrollPeriods() {
  try {
    return await readTable('payroll_periods');
  } catch (error) {
    console.error('readTable payroll_periods error:', error.message);
    return db.get('payroll_periods') || [];
  }
}

const findStoredPeriod = (rows, employeeId, period) => (
  (rows || []).find((row) => row.employee_id === employeeId && row.period === period) || null
);

/** הרכבת תצוגת חודש אחד מכל המקורות. משמש גם את מסך המעקב וגם את כרטיס העובד. */
function periodViewFor(employee, period, storedRows) {
  return buildPeriodView({
    employee,
    period,
    stored: findStoredPeriod(storedRows, employee.id, period),
    workAssignments: db.get('work_assignments') || [],
    agreement: (db.get('wage_agreements') || []).find((item) => item.employee_id === employee.id) || null,
    documents: payrollDocumentsOf(employee).map(publicPayrollDocument),
  });
}

app.get('/api/payroll-periods', async (req, res) => {
  if (!hasSensitiveAccess(req.crmUser, 'hr')) {
    return res.status(403).json({ error: 'נדרשת הרשאת משאבי אנוש' });
  }
  const period = String(req.query.month || '').trim() || israelDateStr().slice(0, 7);
  if (!isValidPeriod(period)) return res.status(400).json({ error: 'חודש חייב להיות בפורמט YYYY-MM' });
  const storedRows = await readPayrollPeriods();
  const employees = (db.get('employees') || []).filter((employee) => employee.is_active !== false);
  res.json({
    period,
    document_types: PAYROLL_DOCUMENT_TYPES,
    periods: employees
      .map((employee) => periodViewFor(employee, period, storedRows))
      .sort((a, b) => (b.summary?.total || 0) - (a.summary?.total || 0)
        || String(a.employee_name).localeCompare(String(b.employee_name), 'he')),
  });
});

app.get('/api/employees/:id/payroll-periods', async (req, res) => {
  const employee = db.getOne('employees', req.params.id);
  if (!employee) return res.status(404).json({ error: 'העובד לא נמצא' });
  if (!hasSensitiveAccess(req.crmUser, 'hr') && !isOwnEmployeeRequest(req, employee.id)) {
    return res.status(403).json({ error: 'אין הרשאה לתשלומי עובד אחר' });
  }
  const storedRows = await readPayrollPeriods();
  const periods = periodsForEmployee({
    employeeId: employee.id,
    workAssignments: db.get('work_assignments') || [],
    storedRows,
    documents: payrollDocumentsOf(employee),
  });
  res.json({
    employee_id: employee.id,
    document_types: PAYROLL_DOCUMENT_TYPES,
    periods: periods.map((period) => periodViewFor(employee, period, storedRows)),
  });
});

/**
 * שמירת השדות הידניים של חודש. השורה נוצרת בפעם הראשונה שנוגעים בה — אין טעם
 * להחזיק שורה ריקה לכל עובד בכל חודש שבו לא קרה כלום.
 */
app.put('/api/payroll-periods/:employeeId/:period', async (req, res) => {
  if (!hasSensitiveAccess(req.crmUser, 'hr')) {
    return res.status(403).json({ error: 'נדרשת הרשאת משאבי אנוש' });
  }
  const { employeeId, period } = req.params;
  const employee = db.getOne('employees', employeeId);
  if (!employee) return res.status(404).json({ error: 'העובד לא נמצא' });
  if (!isValidPeriod(period)) return res.status(400).json({ error: 'חודש חייב להיות בפורמט YYYY-MM' });
  try {
    const patch = sanitizePeriodPatch(req.body || {});
    const existing = findStoredPeriod(db.get('payroll_periods') || [], employeeId, period);
    const saved = existing
      ? db.update('payroll_periods', existing.id, patch)
      : db.insert('payroll_periods', { employee_id: employeeId, period, status: 'open', summary: null, ...patch });
    await persistCore('payroll_periods', saved);
    res.json(periodViewFor(employee, period, db.get('payroll_periods') || []));
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message || 'שמירת החודש נכשלה' });
  }
});

/**
 * סגירת חודש: הסיכום נצרב על השורה ומאותו רגע הוא האמת ההיסטורית שלה.
 * אותו עיקרון כמו הקפאת השכר על שורת עבודה — משכורת של חודש שעבר לא זזה
 * כשמעלים תעריף או משנים שם תפקיד היום.
 */
app.post('/api/payroll-periods/:employeeId/:period/seal', async (req, res) => {
  if (!hasSensitiveAccess(req.crmUser, 'hr')) {
    return res.status(403).json({ error: 'נדרשת הרשאת משאבי אנוש' });
  }
  const { employeeId, period } = req.params;
  const employee = db.getOne('employees', employeeId);
  if (!employee) return res.status(404).json({ error: 'העובד לא נמצא' });
  if (!isValidPeriod(period)) return res.status(400).json({ error: 'חודש חייב להיות בפורמט YYYY-MM' });

  const reopen = req.body?.reopen === true;
  const stored = db.get('payroll_periods') || [];
  const existing = findStoredPeriod(stored, employeeId, period);
  // פתיחה מחדש מוחקת את הסיכום הצרוב, אחרת החודש היה ממשיך להציג אותו.
  const fields = reopen
    ? { status: 'open', summary: null, sealed_at: null }
    : {
      status: 'sealed',
      // תמיד החישוב החי — גם אם החודש כבר היה סגור, סגירה מחדש צורבת מחדש.
      summary: periodViewFor(employee, period, stored).live_summary,
      sealed_at: new Date().toISOString(),
    };
  const saved = existing
    ? db.update('payroll_periods', existing.id, fields)
    : db.insert('payroll_periods', { employee_id: employeeId, period, ...fields });
  await persistCore('payroll_periods', saved);
  res.json(periodViewFor(employee, period, db.get('payroll_periods') || []));
});

// ─── תשלומי חברה ────────────────────────────────────────────────────────────
// ביטוח לאומי וכל תשלום שאינו מיוחס לעובד יחיד: סכום לחודש ואישור העברה.

const publicCompanyPayment = (row) => {
  if (!row) return null;
  const { document, ...rest } = row;
  if (!document) return { ...rest, document: null };
  const { storage_path: _path, ...safeDocument } = document;
  return { ...rest, document: safeDocument };
};

app.get('/api/company-payments', async (req, res) => {
  if (!hasSensitiveAccess(req.crmUser, 'hr')) {
    return res.status(403).json({ error: 'נדרשת הרשאת משאבי אנוש' });
  }
  let rows;
  try {
    rows = await readTable('company_payments');
  } catch (error) {
    console.error('readTable company_payments error:', error.message);
    rows = db.get('company_payments') || [];
  }
  const period = String(req.query.month || '').trim();
  const filtered = isValidPeriod(period) ? rows.filter((row) => row.period === period) : rows;
  res.json({
    types: COMPANY_PAYMENT_TYPES,
    payments: [...filtered].sort((a, b) => String(b.period || '').localeCompare(String(a.period || ''))),
  });
});

app.put('/api/company-payments/:period/:type', async (req, res) => {
  if (!hasSensitiveAccess(req.crmUser, 'hr')) {
    return res.status(403).json({ error: 'נדרשת הרשאת משאבי אנוש' });
  }
  const { period, type } = req.params;
  if (!isValidPeriod(period)) return res.status(400).json({ error: 'חודש חייב להיות בפורמט YYYY-MM' });
  if (!COMPANY_PAYMENT_TYPES[type]) return res.status(400).json({ error: 'סוג התשלום אינו תקין' });
  try {
    const { amount, paid_at: paidAt, notes } = sanitizeCompanyPaymentBody(req.body || {});
    const existing = (db.get('company_payments') || []).find((row) => row.period === period && row.type === type);
    const saved = existing
      ? db.update('company_payments', existing.id, { amount, paid_at: paidAt, notes })
      : db.insert('company_payments', {
        period, type, type_label: COMPANY_PAYMENT_TYPES[type], amount, paid_at: paidAt, notes, document: null,
      });
    await persistCore('company_payments', saved);
    res.json(publicCompanyPayment(saved));
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message || 'שמירת התשלום נכשלה' });
  }
});

function sanitizeCompanyPaymentBody(body) {
  const amountRaw = body.amount;
  let amount = null;
  if (amountRaw !== undefined && amountRaw !== null && amountRaw !== '') {
    const parsed = Number(amountRaw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw Object.assign(new Error('סכום אינו תקין'), { statusCode: 400 });
    }
    amount = Math.round(parsed * 100) / 100;
  }
  let paidAt = null;
  if (body.paid_at) {
    const date = String(body.paid_at).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw Object.assign(new Error('תאריך אינו תקין'), { statusCode: 400 });
    }
    paidAt = date;
  }
  return { amount, paid_at: paidAt, notes: String(body.notes || '').slice(0, 2000) };
}

/**
 * אישור ההעברה של תשלום חברה. אותו bucket פרטי של מסמכי העובדים, בתיקייה
 * נפרדת — הקובץ לא שייך לאף עובד, ולכן אין לו מקום בתיק אישי.
 */
app.post('/api/company-payments/:id/document', async (req, res) => {
  if (!hasSensitiveAccess(req.crmUser, 'hr')) {
    return res.status(403).json({ error: 'נדרשת הרשאת משאבי אנוש' });
  }
  const payment = db.getOne('company_payments', req.params.id);
  if (!payment) return res.status(404).json({ error: 'התשלום לא נמצא' });
  const { fileBase64, fileName, mimeType } = req.body || {};
  const validated = validateUploadedDocument(fileBase64);
  if (validated.error) return res.status(400).json({ error: validated.error });
  const { buffer, mimeType: safeMime, ext } = validated;
  const baseName = String(fileName || payment.type).replace(/\.[^.]+$/, '');
  const safeName = `${baseName}.${ext}`
    .replace(/[^\w֐-׿.\-]+/g, '_')
    .slice(0, 120);
  const storagePath = `company/${payment.type}/${payment.period}/${payment.id}.${ext}`;
  try {
    if (payment.document?.storage_path) await supa.removeEmployeeDocument(payment.document.storage_path);
    const uploaded = await supa.uploadEmployeeDocument(storagePath, buffer, safeMime);
    if (!uploaded.ok) throw new Error(uploaded.error || 'שמירת הקובץ נכשלה');
    const saved = db.update('company_payments', payment.id, {
      document: {
        file_name: safeName,
        storage_path: storagePath,
        mime_type: safeMime,
        uploaded_at: new Date().toISOString(),
      },
    });
    await persistCore('company_payments', saved);
    res.status(201).json(publicCompanyPayment(saved));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'העלאת המסמך נכשלה' });
  }
});

app.get('/api/company-payments/:id/document/download', async (req, res) => {
  if (!hasSensitiveAccess(req.crmUser, 'hr')) {
    return res.status(403).json({ error: 'נדרשת הרשאת משאבי אנוש' });
  }
  const payment = db.getOne('company_payments', req.params.id);
  if (!payment?.document?.storage_path) return res.status(404).json({ error: 'המסמך לא נמצא' });
  const downloaded = await supa.downloadEmployeeDocument(payment.document.storage_path);
  if (!downloaded.ok || !downloaded.blob) {
    return res.status(500).json({ error: downloaded.error || 'הורדת המסמך נכשלה' });
  }
  const buffer = Buffer.from(await downloaded.blob.arrayBuffer());
  res.setHeader('Content-Type', payment.document.mime_type || 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(payment.document.file_name || 'document.pdf')}`);
  return res.send(buffer);
});

app.delete('/api/company-payments/:id/document', async (req, res) => {
  if (!hasSensitiveAccess(req.crmUser, 'hr')) {
    return res.status(403).json({ error: 'נדרשת הרשאת משאבי אנוש' });
  }
  const payment = db.getOne('company_payments', req.params.id);
  if (!payment) return res.status(404).json({ error: 'התשלום לא נמצא' });
  if (payment.document?.storage_path) await supa.removeEmployeeDocument(payment.document.storage_path);
  const saved = db.update('company_payments', payment.id, { document: null });
  await persistCore('company_payments', saved);
  res.json(publicCompanyPayment(saved));
});

app.post('/api/work-assignments/approve', (req, res) => {
  if (!hasSensitiveAccess(req.crmUser, 'hr')) {
    return res.status(403).json({ error: 'אישור שכר דורש הרשאת משאבי אנוש' });
  }
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
  try {
    rejectWorkPayOverride(req, req.body || {});
  } catch (error) {
    return res.status(error.statusCode || 403).json({ error: error.message });
  }
  const normalized = normalizeWorkAssignment(req.body || {});
  if (!normalized.employee_id) return res.status(400).json({ error: 'employee_id is required' });
  if (!normalized.date) return res.status(400).json({ error: 'date is required' });
  try {
    requireActiveEmployees([normalized.employee_id]);
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message, code: error.code });
  }
  const created = db.insert('work_assignments', withFrozenPay(normalized));
  res.status(201).json(workAssignmentForRequest(req, created));
});

app.put('/api/work-assignments/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.getOne('work_assignments', id);
  if (!existing) return res.status(404).json({ error: 'Work assignment not found' });
  if (!canMutateApprovedWorkAssignment(existing, hasSensitiveAccess(req.crmUser, 'hr'))) {
    return res.status(403).json({ error: 'שורת שכר מאושרת ניתנת לעריכה רק עם הרשאת משאבי אנוש' });
  }
  try {
    rejectWorkPayOverride(req, req.body || {}, existing);
  } catch (error) {
    return res.status(error.statusCode || 403).json({ error: error.message });
  }
  const normalized = normalizeWorkAssignment(req.body || {}, { existing });
  if (String(normalized.employee_id || '') !== String(existing.employee_id || '')) {
    try {
      requireActiveEmployees([normalized.employee_id]);
    } catch (error) {
      return res.status(error.statusCode || 400).json({ error: error.message, code: error.code });
    }
  }
  // עריכה ידנית של השורה מתמחרת אותה מחדש — גם אם היום שלה כבר ננעל. שינוי
  // תעריף או שם תפקיד לעומת זאת לא עובר כאן, ולכן לא נוגע בשורות ישנות.
  const updated = db.update('work_assignments', id, withFrozenPay({ ...existing, ...normalized }));
  res.json(workAssignmentForRequest(req, updated));
});

app.delete('/api/work-assignments/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.getOne('work_assignments', id);
  if (!existing) return res.status(404).json({ error: 'Work assignment not found' });
  if (!canMutateApprovedWorkAssignment(existing, hasSensitiveAccess(req.crmUser, 'hr'))) {
    return res.status(403).json({ error: 'שורת שכר מאושרת ניתנת למחיקה רק עם הרשאת משאבי אנוש' });
  }
  const ok = db.delete('work_assignments', id);
  if (!ok) return res.status(404).json({ error: 'Work assignment not found' });
  res.json({ success: true });
});

// ─── הרשמה למשמרות ──────────────────────────────────────────────────────────
// הטופס שהחליף את הסקר בוואטסאפ. הזרימה: המנהל פותח טופס מהיומן, שולח קישור
// למי שבחר, הצוות מסמן זמינות, והמנהל מאשר הכול בפעולה אחת — שכותבת שורות
// ליומן העבודה ושולחת לכל עובד את השיבוץ שלו.

const SIGNUP_TABLES = ['shift_signup_windows', 'shift_signup_responses'];

/**
 * מי מחזיק במפתח האישי שבקישור.
 *
 * המפתח נוצר בשליחה, אחד לכל עובד, ונשמר על הטופס. הוא מזהה בלי סיסמה ובלי
 * בחירה מרשימה — וגם חוסם תשובה בשם מישהו אחר, מה שהבורר הפתוח אִפשר.
 */
const EMPLOYEE_LINKS_TABLE = 'employee_links';

/** הקישור האישי הקבוע של עובד, נוצר בפעם הראשונה שמבקשים אותו. */
function employeeLinkToken(employeeId) {
  const existing = db.getOne(EMPLOYEE_LINKS_TABLE, String(employeeId));
  if (existing && !existing.revoked_at) return existing.token;
  const token = newSignupToken();
  if (existing) db.update(EMPLOYEE_LINKS_TABLE, existing.id, { token, revoked_at: null });
  else db.insert(EMPLOYEE_LINKS_TABLE, { id: String(employeeId), token });
  return token;
}

function employeeIdForKey(windowRow, key) {
  const wanted = String(key || '').trim();
  if (!wanted) return null;
  const keys = windowRow?.employee_keys || {};
  const onWindow = Object.keys(keys).find((employeeId) => keys[employeeId] === wanted);
  if (onWindow) return onWindow;
  // קישור אישי קבוע — אותו מפתח פותח כל טופס שהעובד קיבל, כך שקישור שמור בטלפון
  // ממשיך לעבוד גם לטופס הבא.
  const standing = (db.get(EMPLOYEE_LINKS_TABLE) || [])
    .find((row) => row.token === wanted && !row.revoked_at);
  return standing ? String(standing.id) : null;
}

/** כל התפקידים שטופס אחד מבקש, על פני כל המשמרות שבו. */
function windowRowRoles(windowRow) {
  return [...new Set((windowRow?.slots || [])
    .flatMap((slot) => (slot.needs || []).map((need) => need.role))
    .filter(Boolean))];
}

function staffNeedsFor(activityId) {
  const row = db.getOne(STAFF_NEEDS_TABLE, String(activityId || ''));
  return Array.isArray(row?.needs) ? row.needs : [];
}

app.get('/api/activities/:id/staff-needs', (req, res) => {
  res.json({ needs: staffNeedsFor(req.params.id) });
});

app.put('/api/activities/:id/staff-needs', (req, res) => {
  const activity = db.getOne('activities', req.params.id);
  if (!activity) return res.status(404).json({ error: 'האירוע לא נמצא' });
  // רשימה ריקה היא „לפי סוג הפעילות” — מחיקה של ההגדרה, לא אפס אנשים.
  const needs = normalizeNeeds(req.body?.needs, 0).filter((need) => need.role);
  const existing = db.getOne(STAFF_NEEDS_TABLE, String(activity.id));
  if (!needs.length) {
    if (existing) db.delete(STAFF_NEEDS_TABLE, existing.id);
    return res.json({ needs: [] });
  }
  const saved = existing
    ? db.update(STAFF_NEEDS_TABLE, existing.id, { needs })
    : db.insert(STAFF_NEEDS_TABLE, { id: String(activity.id), needs });
  res.json({ needs: saved.needs });
});

function classNeedsRowFor(groupId) {
  const row = db.getOne(CLASS_NEEDS_TABLE, String(groupId || ''));
  return Array.isArray(row?.needs) ? row.needs : [];
}

/** כל דרישות החוגים במפה אחת, כפי שבורר המשמרות מבקש אותן. */
function classNeedsByGroupMap() {
  return Object.fromEntries((db.get(CLASS_NEEDS_TABLE) || []).map((row) => [row.id, row.needs]));
}

app.get('/api/groups/:id/staff-needs', (req, res) => {
  res.json({ needs: classNeedsRowFor(req.params.id) });
});

app.put('/api/groups/:id/staff-needs', (req, res) => {
  const group = db.getOne('groups', req.params.id);
  if (!group) return res.status(404).json({ error: 'החוג לא נמצא' });
  // רשימה ריקה היא „מדריך אחד, כרגיל” — מחיקה של ההגדרה, לא אפס אנשים.
  const needs = normalizeNeeds(req.body?.needs, 0).filter((need) => need.role);
  const existing = db.getOne(CLASS_NEEDS_TABLE, String(group.id));
  if (!needs.length) {
    if (existing) db.delete(CLASS_NEEDS_TABLE, existing.id);
    return res.json({ needs: [] });
  }
  const saved = existing
    ? db.update(CLASS_NEEDS_TABLE, existing.id, { needs })
    : db.insert(CLASS_NEEDS_TABLE, { id: String(group.id), needs });
  res.json({ needs: saved.needs });
});

/**
 * איזה תפקיד מתאים לאיזו רשומה ביומן — כפי שבורר המשמרות צריך לראות את זה.
 *
 * חוג אינו סוג פעילות אלא קבוצה, ולכן אין לו שורה בקטלוג: התפקידים שיכולים
 * לקחת אותו הם הדרכה ועזרה בהדרכה, ומכאן הרשימה הנפרדת.
 */
async function signupRoleCatalog() {
  const catalog = await readRoleCatalog();
  const rolesByType = {};
  for (const type of Object.keys(catalog.activityRoles || {})) {
    rolesByType[type] = await rolesForActivityType(type);
  }
  const labelOf = (key) => catalog.system.find((r) => r.key === key)?.label || '';
  const classRoles = [labelOf(SYSTEM_ROLE_KEYS.TRAINER), labelOf(SYSTEM_ROLE_KEYS.ASSISTANT)]
    .filter(Boolean);
  return { rolesByType, classRoles };
}

/** רשומת טופס עם הספירות שהרשימה מציגה, בלי גוף המשמרות. */
/** התפקידים שחוג מאויש בהם: הראשון הוא ההדרכה עצמה. */
function signupClassRoles() {
  return [
    systemRoleLabelSync(SYSTEM_ROLE_KEYS.TRAINER),
    systemRoleLabelSync(SYSTEM_ROLE_KEYS.ASSISTANT),
  ].filter(Boolean);
}

function signupWindowSummary(windowRow, responses, today, assignments = null) {
  const answers = responsesForWindow(responses, windowRow.id);
  // טופס לוח חוגים אינו נמדד בתאריכים: המושבים שלו הם חוגים, והשיבוץ נקרא
  // מלוח החוגים עצמו ולא מיומן העבודה.
  if (windowRow.kind === CLASS_WINDOW_KIND) {
    const seats = windowRow.seats || [];
    const board = classSignupBoard(windowRow, responses, db.get('employees') || [],
      db.get('groups') || [], signupClassRoles());
    return {
      id: windowRow.id,
      kind: CLASS_WINDOW_KIND,
      title: windowRow.title,
      roles: [...new Set(seats.flatMap((seat) => (seat.needs || []).map((n) => n.role)).filter(Boolean))],
      status: windowRow.status,
      deadline: windowRow.deadline || null,
      note: windowRow.note || '',
      token: windowRow.token,
      recipients: windowRow.recipients || [],
      sent_at: windowRow.sent_at || null,
      slot_count: seats.length,
      first_date: null,
      last_date: null,
      missing: board.reduce((sum, seat) => sum + seat.missing, 0),
      respondents: answers.length,
      open: isClassWindowOpen(windowRow, today),
      created_at: windowRow.created_at || null,
    };
  }
  const slots = windowRow.slots || [];
  const dates = slots.map((slot) => slot.date).sort();
  // כמה שיבוצים עוד חסרים בטופס כולו. מחושב מהרוסטר ולא נשמר, מאותה סיבה
  // שהלוח עצמו נגזר ממנו: משמרת שבוטלה ביומן חוזרת להיות חסרה מעצמה.
  const board = assignments ? signupBoard(windowRow, responses, [], assignments) : null;
  return {
    id: windowRow.id,
    title: windowRow.title,
    work_type: windowRow.work_type,
    // אילו תפקידים הטופס כולו מבקש — כותרת הרשימה, במקום התפקיד היחיד שהיה
    // נעול על הטופס. נגזר מהמשמרות, כי שם הוא באמת נקבע.
    roles: [...new Set(slots.flatMap((slot) => (slot.needs || []).map((n) => n.role)).filter(Boolean))],
    status: windowRow.status,
    deadline: windowRow.deadline || null,
    note: windowRow.note || '',
    token: windowRow.token,
    recipients: windowRow.recipients || [],
    sent_at: windowRow.sent_at || null,
    slot_count: slots.length,
    first_date: dates[0] || null,
    last_date: dates[dates.length - 1] || null,
    missing: board ? board.reduce((sum, slot) => sum + slot.missing, 0) : null,
    respondents: answers.length,
    open: isWindowOpen(windowRow, today),
    created_at: windowRow.created_at || null,
  };
}

app.get('/api/shift-signup/windows', async (_req, res) => {
  try {
    const [windows, responses] = await readTables(...SIGNUP_TABLES);
    const today = israelDateStr();
    const assignments = db.get('work_assignments') || [];
    const rows = [...windows]
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      .map((row) => signupWindowSummary(row, responses, today, assignments));
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/shift-signup/expand-slots', (req, res) => {
  const { slots, error } = expandWeeklySlots(req.body || {});
  if (error) return res.status(400).json({ error });
  res.json({ slots });
});

app.get('/api/shift-signup/calendar-slots', async (req, res) => {
  try {
    const [activities, groups, assignments] = await readTables('activities', 'groups', 'work_assignments');
    const catalog = await signupRoleCatalog();
    // מה שהמנהל כתב על האירוע עצמו („מפעיל קיר אחד ושני עוזרים”) גובר על מה
    // שסוג הפעילות מרמז. השורות נקראות פעם אחת ומחוברות לאירועים כאן, כדי
    // שהמודול יישאר טהור ולא יידע על טבלאות.
    const needsById = new Map(
      (db.get(STAFF_NEEDS_TABLE) || []).map((row) => [String(row.id), row.needs])
    );
    const withNeeds = activities.map((activity) => (needsById.has(String(activity.id))
      ? { ...activity, staff_needs: needsById.get(String(activity.id)) }
      : activity));

    const { candidates, withoutHours, byType, error } = calendarSlotCandidates({
      activities: withNeeds,
      groups,
      assignments,
      rolesByType: catalog.rolesByType,
      classRoles: catalog.classRoles,
    classNeedsByGroup: classNeedsByGroupMap(),
      from: req.query.from,
      to: req.query.to,
      // רשימת סוגים מופרדת בפסיקים, כפי שהמסך מסמן אותם. ריק פירושו „הכל”,
      // כדי שקריאה ישנה בלי הפרמטר תמשיך להתנהג כמו קודם.
      types: String(req.query.types || '').split(',').map((t) => t.trim()).filter(Boolean),
    });
    if (error) return res.status(400).json({ error });
    res.json({ candidates, withoutHours, byType });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/shift-signup/windows', (req, res) => {
  // שני סוגי טפסים על אותה טבלה: מהיומן, שמושביו נושאים תאריך, ומלוח החוגים,
  // שמושביו הם חוגים ואין להם תאריך כלל.
  const isClass = req.body?.kind === CLASS_WINDOW_KIND;
  const { window: record, error } = isClass
    ? normalizeClassWindow(req.body || {}, { classRoles: signupClassRoles() })
    : normalizeWindow(req.body || {});
  if (error) return res.status(400).json({ error });
  const created = db.insert('shift_signup_windows', record);
  res.status(201).json(created);
});

app.get('/api/shift-signup/windows/:id', async (req, res) => {
  try {
    const [windows, responses] = await readTables(...SIGNUP_TABLES);
    const windowRow = windows.find((row) => row.id === req.params.id);
    if (!windowRow) return res.status(404).json({ error: 'הטופס לא נמצא' });
    const employees = db.get('employees') || [];
    const assignments = db.get('work_assignments') || [];
    const answers = responsesForWindow(responses, windowRow.id);
    const pendingOf = () => eligibleEmployees(employees, windowRow.recipients)
      .filter((person) => !answers.some((answer) => answer.employee_id === person.id));
    if (windowRow.kind === CLASS_WINDOW_KIND) {
      return res.json({
        ...signupWindowSummary(windowRow, responses, israelDateStr(), assignments),
        seats: windowRow.seats || [],
        board: classSignupBoard(windowRow, responses, employees, db.get('groups') || [], signupClassRoles()),
        pending: pendingOf(),
      });
    }
    res.json({
      ...signupWindowSummary(windowRow, responses, israelDateStr(), assignments),
      slots: windowRow.slots || [],
      board: signupBoard(windowRow, responses, employees, assignments),
      respondents_detail: respondentSummary(windowRow, responses, employees, assignments),
      // מי שהטופס פונה אליו ועדיין לא ענה — השאלה הראשונה של כל מנהל שפתח
      // את הלוח ורואה ארבע תשובות במקום שבע.
      pending: eligibleEmployees(employees, windowRow.recipients)
        .filter((person) => !answers.some((answer) => answer.employee_id === person.id)),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/shift-signup/windows/:id', (req, res) => {
  const existing = db.getOne('shift_signup_windows', req.params.id);
  if (!existing) return res.status(404).json({ error: 'הטופס לא נמצא' });
  const { window: record, error } = existing.kind === CLASS_WINDOW_KIND
    ? normalizeClassWindow(req.body || {}, { existing, classRoles: signupClassRoles() })
    : normalizeWindow(req.body || {}, { existing });
  if (error) return res.status(400).json({ error });
  res.json(db.update('shift_signup_windows', existing.id, record));
});

app.delete('/api/shift-signup/windows/:id', (req, res) => {
  const existing = db.getOne('shift_signup_windows', req.params.id);
  if (!existing) return res.status(404).json({ error: 'הטופס לא נמצא' });
  for (const answer of responsesForWindow(db.get('shift_signup_responses') || [], existing.id)) {
    db.delete('shift_signup_responses', answer.id);
  }
  db.delete('shift_signup_windows', existing.id);
  res.json({ success: true });
});

/**
 * שליחת הקישור בוואטסאפ למי שהטופס פונה אליו.
 *
 * הבקשה יכולה לנקוב בשמות (`employee_ids`) — למשל תזכורת רק למי שטרם ענה —
 * וברירת המחדל היא רשימת הנמענים של הטופס. השליחה חוסמת בכוונה: המנהל צריך
 * לראות מיד למי לא הגיע, כי מי שלא קיבל צריך טיפול ידני עכשיו ולא בעוד יום.
 */
app.post('/api/shift-signup/windows/:id/send', async (req, res) => {
  const windowRow = db.getOne('shift_signup_windows', req.params.id);
  if (!windowRow) return res.status(404).json({ error: 'הטופס לא נמצא' });
  const employees = db.get('employees') || [];
  const audience = eligibleEmployees(employees, windowRow.recipients);
  const only = Array.isArray(req.body?.employee_ids) && req.body.employee_ids.length
    ? new Set(req.body.employee_ids.map(String))
    : null;
  // רק מי שיכול לקחת משהו. שליחה למי שאין לו אף אחד מהתפקידים שהטופס מבקש היא
  // הודעה שאי אפשר לענות עליה — ובגודל הצוות הזה, רוב ההודעות היו כאלה.
  const wantedRoles = windowRowRoles(windowRow);
  const targets = audience
    .filter((person) => !only || only.has(String(person.id)))
    .filter((person) => !wantedRoles.length
      || wantedRoles.some((role) => (person.roles || []).includes(role)))
    .map((person) => employees.find((e) => e.id === person.id))
    .filter(Boolean);
  if (!targets.length) {
    return res.status(400).json({
      error: wantedRoles.length
        ? `אף עובד לא מסומן באחד מהתפקידים שהטופס מבקש (${wantedRoles.join(', ')})`
        : 'לא נבחר אף עובד לשליחה',
    });
  }

  const base = `${eventPublicBase()}/shift-signup/${windowRow.token}`;
  try {
    // קישור אישי לכל אחד: הטופס נפתח על השם שלו בלי שיבחר אותו מרשימה, ואי
    // אפשר לענות בשם מישהו אחר גם אם הקישור הועבר הלאה.
    const keys = { ...(windowRow.employee_keys || {}) };
    for (const employee of targets) {
      if (!keys[employee.id]) keys[employee.id] = employeeLinkToken(employee.id);
    }
    const { sent, results } = await sendSignupInvites({
      windowRow,
      employees: targets,
      linkFor: (employee) => `${base}?u=${keys[employee.id]}`,
    });
    db.update('shift_signup_windows', windowRow.id, {
      sent_at: new Date().toISOString(),
      employee_keys: keys,
    });
    res.json({ sent, results, link: base });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * אישור שיבוץ לחוגים.
 *
 * מסלול נפרד מ-`/assign` בכוונה: זה לא כותב שורות ליומן העבודה אלא את השיבוץ
 * הקבוע על החוג, ומשם הנוכחות והשכר מתגלגלים כמו לכל מדריך אחר. הפרדה גם
 * שומרת על המסלול שנוגע בשכר עם בדיקות ההרשאה שלו, בלי ענף נוסף בתוכו.
 */
app.post('/api/shift-signup/windows/:id/assign-class', async (req, res) => {
  const windowRow = db.getOne('shift_signup_windows', req.params.id);
  if (!windowRow) return res.status(404).json({ error: 'הטופס לא נמצא' });
  if (windowRow.kind !== CLASS_WINDOW_KIND) {
    return res.status(400).json({ error: 'הטופס הזה אינו טופס לוח חוגים' });
  }
  const employees = db.get('employees') || [];
  const { groups: plans, skipped } = planClassStaffing(windowRow, req.body?.picks || [], {
    groups: db.get('groups') || [],
    employees,
    classRoles: signupClassRoles(),
    replace: req.body?.replace || [],
  });

  const updated = [];
  for (const plan of plans) {
    try {
      // אותה בדיקה שעוברת שמירה ידנית של חוג: אי אפשר לשבץ עובד שהושבת בינתיים.
      requireActiveEmployees([plan.trainer, ...plan.assistants].filter(Boolean));
    } catch (error) {
      skipped.push({ group_id: plan.group_id, reason: 'inactive_employee', error: error.message });
      continue;
    }
    // רק שני השדות האלה: כל שדה אחר שיישלח לכאן ייעלם במיפוי של הקבוצה.
    db.update('groups', plan.group_id, { trainer: plan.trainer, assistants: plan.assistants });
    updated.push(plan);
  }

  // הודעה אחת לעובד עם כל החוגים שקיבל, ולא הודעה לכל חוג.
  const byEmployee = new Map();
  for (const plan of updated) {
    for (const item of plan.placed) {
      const list = byEmployee.get(item.employee_id) || [];
      list.push({ label: plan.group_name || item.label, role: item.role });
      byEmployee.set(item.employee_id, list);
    }
  }
  let notified = 0;
  try {
    const result = await sendAssignmentSummaries({
      windowRow,
      byEmployee,
      employees,
      textFor: (placed) => classAssignmentMessageText(windowRow, placed),
    });
    notified = result?.sent || 0;
  } catch (error) {
    console.error('class assignment notify failed:', error.message);
  }

  res.json({ updated, skipped, notified });
});

/**
 * הקישור האישי של עובד לטופס.
 *
 * כפתור „העתקת קישור” חילק עד כה את הכתובת הכללית, וזו מפילה את מי שפותח אותה
 * חזרה לבורר שמות פתוח — בדיוק מה שהמפתח האישי נועד למנוע.
 */
app.post('/api/shift-signup/windows/:id/link', (req, res) => {
  const windowRow = db.getOne('shift_signup_windows', req.params.id);
  if (!windowRow) return res.status(404).json({ error: 'הטופס לא נמצא' });
  const employee = db.getOne('employees', String(req.body?.employee_id || ''));
  if (!employee) return res.status(404).json({ error: 'העובד לא נמצא' });
  const token = employeeLinkToken(employee.id);
  const keys = { ...(windowRow.employee_keys || {}) };
  if (!keys[employee.id]) {
    keys[employee.id] = token;
    db.update('shift_signup_windows', windowRow.id, { employee_keys: keys });
  }
  res.json({
    employee_id: employee.id,
    name: employee.name || '',
    link: `${eventPublicBase()}/shift-signup/${windowRow.token}?u=${keys[employee.id]}`,
  });
});

/**
 * אישור השיבוצים של טופס אחד.
 *
 * `picks` היא הטיוטה שהמנהל סימן במסך. השורות נכתבות ליומן העבודה דרך אותה
 * נורמליזציה של שיבוץ ידני — כדי שהשעות, התעריף וקיפאון השכר יתנהגו בדיוק
 * כמו בכל שורה אחרת — ורק אז יוצאת לכל עובד הודעה אחת עם כל מה שקיבל.
 */
app.post('/api/shift-signup/windows/:id/assign', async (req, res) => {
  const windowRow = db.getOne('shift_signup_windows', req.params.id);
  if (!windowRow) return res.status(404).json({ error: 'הטופס לא נמצא' });
  try {
    rejectWorkPayOverride(req, req.body || {});
  } catch (error) {
    return res.status(error.statusCode || 403).json({ error: error.message });
  }

  const picks = Array.isArray(req.body?.picks) ? req.body.picks : [];
  if (!picks.length) return res.status(400).json({ error: 'לא נבחר אף שיבוץ לאישור' });
  const { rows, skipped, error } = planAssignments(windowRow, picks, {
    assignments: db.get('work_assignments') || [],
  });
  if (error) return res.status(400).json({ error });
  if (!rows.length) {
    return res.json({ created: 0, skipped, notified: [], message: 'כל השיבוצים שנבחרו כבר קיימים ביומן' });
  }

  try {
    requireActiveEmployees([...new Set(rows.map((row) => row.assignment.employee_id))]);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: err.message, code: err.code });
  }

  const bySlots = new Map();
  const created = [];
  for (const { assignment, slot, role } of rows) {
    // מזהה מפורש: ברירת המחדל של `db.insert` היא חותמת זמן במילישניות, ולולאה
    // שכותבת חמש שורות ברצף מסיימת בתוך אותה מילישנייה — חמש שורות עם אותו id,
    // שדורסות זו את זו באחסון העמיד ונמחקות יחד.
    const record = db.insert('work_assignments', {
      ...withFrozenPay(normalizeWorkAssignment(assignment)),
      id: `wo${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    });
    created.push(record);
    const key = String(assignment.employee_id);
    if (!bySlots.has(key)) bySlots.set(key, []);
    bySlots.get(key).push({ slot, role });
  }

  // ההודעה יוצאת אחרי שהשורות כבר נשמרו: עובד שקיבל הודעה על משמרת שלא נרשמה
  // הוא התקלה היחידה שאי אפשר לתקן בדיעבד.
  let notified = [];
  try {
    ({ results: notified } = await sendAssignmentSummaries({
      windowRow,
      byEmployee: bySlots,
      employees: db.get('employees') || [],
    }));
  } catch (err) {
    console.error('shift signup summaries failed:', err.message);
  }

  res.status(201).json({
    created: created.length,
    skipped,
    notified,
    assignments: created.map((row) => workAssignmentForRequest(req, row)),
  });
});

app.get('/api/public/shift-signup/:token', publicFormRateLimit, async (req, res) => {
  try {
    const [windows, responses] = await readTables(...SIGNUP_TABLES);
    const windowRow = windows.find((row) => row.token === req.params.token);
    if (!windowRow) return res.status(404).json({ error: 'הטופס לא נמצא' });
    const employees = db.get('employees') || [];
    const answers = responsesForWindow(responses, windowRow.id);
    const me = employeeIdForKey(windowRow, req.query.u) || null;
    const mineOf = () => (me ? answers.filter((a) => a.employee_id === me) : []).map((answer) => ({
      employee_id: answer.employee_id,
      picks: answer.picks || [],
      wanted_count: answer.wanted_count || 0,
      note: answer.note || '',
    }));
    if (windowRow.kind === CLASS_WINDOW_KIND) {
      return res.json({
        ...publicClassBoardView(windowRow, responses, israelDateStr()),
        me,
        eligible: eligibleEmployees(employees, windowRow.recipients),
        mine: mineOf(),
      });
    }
    res.json({
      ...publicWindowView(windowRow, answers),
      // מי פתח את הקישור, כשהוא אישי. הטופס נפתח על השם שלו בלי בורר, ואי אפשר
      // לענות בשם מישהו אחר — הקישור עובר בוואטסאפ ואפשר להעביר אותו הלאה.
      me,
      // כל נמען עם התפקידים שלו: הטופס מציג לכל אחד רק את המושבים שהוא יכול
      // לקחת, וזו ההחלטה שהחליפה את נעילת הטופס לתפקיד אחד.
      eligible: eligibleEmployees(employees, windowRow.recipients),
      // מה שאותו אדם כבר ענה, כדי שפתיחה חוזרת של הקישור תהיה תיקון ולא התחלה
      // מאפס — תשובה חדשה מחליפה את הקודמת, ובלי זה היא הייתה מוחקת אותה.
      // רק שלו: הקישור עובר בוואטסאפ, ומה שכל הצוות סימן אינו עניינו של מי
      // שמחזיק בו.
      mine: (me ? answers.filter((answer) => answer.employee_id === me) : [])
        .map((answer) => ({
          employee_id: answer.employee_id,
          picks: answer.picks || [],
          wanted_count: answer.wanted_count || 0,
          note: answer.note || '',
        })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/public/shift-signup/:token', publicFormRateLimit, async (req, res) => {
  try {
    const [windows, responses] = await readTables(...SIGNUP_TABLES);
    const windowRow = windows.find((row) => row.token === req.params.token);
    if (!windowRow) return res.status(404).json({ error: 'הטופס לא נמצא' });

    // רק מי שהטופס פונה אליו יכול לענות: הקישור עובר בוואטסאפ ואפשר להעביר
    // אותו הלאה, ותשובה בשם מישהו אחר היא בדיוק מה שאסור שיקרה כאן.
    const employees = db.get('employees') || [];
    const allowed = eligibleEmployees(employees, windowRow.recipients);
    // מפתח אישי גובר על מה שהדפדפן שלח: מי שקיבל קישור אישי עונה בשמו בלבד.
    const keyed = employeeIdForKey(windowRow, req.query.u || req.body?.u);
    const employeeId = keyed || String(req.body?.employee_id || '');
    if (!allowed.some((person) => String(person.id) === employeeId)) {
      return res.status(403).json({ error: 'השם הזה לא מופיע ברשימת הטופס' });
    }

    // העובד עצמו נמסר לבדיקת הכשירות: מושב בתפקיד שהוא לא מסומן בו נדחה כאן,
    // ולא רק מוסתר במסך — הקישור עובר בוואטסאפ ואפשר לשלוח בקשה בלי המסך.
    const employee = employees.find((e) => String(e.id) === employeeId) || null;
    const payload = { ...(req.body || {}), employee_id: employeeId };
    const { record, existing, error } = windowRow.kind === CLASS_WINDOW_KIND
      ? applyClassResponse(windowRow, responses, payload, { today: israelDateStr(), employee })
      : applyResponse(windowRow, responses, payload, { employee });
    if (error) return res.status(400).json({ error });
    const saved = existing
      ? db.update('shift_signup_responses', existing.id, record)
      : db.insert('shift_signup_responses', record);
    res.status(existing ? 200 : 201).json({ success: true, picked: (saved.picks || []).length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
  const rows = db.getSafetyDueToday(date);
  res.json(req.query.scope === 'wall-opening' ? wallOpeningSafetyChecks(rows) : rows);
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
    const typeId = body.check_type_id || body.checkTypeId;
    const type = typeId
      ? (db.get('safety_check_types') || []).find((t) => t.id === typeId)
      : null;
    if (type && isDailySafetyCheck(type) && body.completed_by_employee_id) {
      const emp = (db.get('employees') || []).find((e) => e.id === body.completed_by_employee_id);
      if (!employeeCanSignDailySafety(emp)) {
        return res.status(403).json({
          error: 'העובד אינו מורשה לחתום על בדיקות בטיחות יומיות',
        });
      }
    } else if (type && body.completed_by_employee_id) {
      const emp = (db.get('employees') || []).find((e) => e.id === body.completed_by_employee_id);
      if (!employeeIsWallStaff(emp)) {
        return res.status(403).json({
          error: 'רק עובד קיר פעיל יכול לחתום על בדיקות הקיר',
        });
      }
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

// Level Tests history. `studentId` narrows it to one climber — the customer
// file wants the safety test and the grade of the person on screen, and used to
// download all 1400 tests in the club to find the three that were theirs.
app.get('/api/level-tests', (req, res) => {
  const studentId = String(req.query.studentId || '').trim();
  res.json((db.get('level_tests') || [])
    .filter((test) => !studentId || String(test.studentId || '') === studentId)
    .filter((test) => canAccessLevelTest(req.crmUser, test, 'view')));
});

/**
 * מה שהמדריך צריך לראות לצד כל מתאמן בגיליון היומי: איזה ציוד עוד לא
 * נמסר, ומה מצב מבחן האבטחה. נפרד מ-/api/equipment הכבד, כדי שפתיחת
 * הגיליון לא תמשוך את כל המועדון.
 */
app.get('/api/groups/:id/training-brief', async (req, res) => {
  try {
    const groupId = req.params.id;
    await readTable('student_equipment');
    const students = db
      .withStudentRelations(db.get('students') || [])
      .filter((s) => studentInGroup(s, groupId) && s.status !== 'archived');

    const tests = db.get('level_tests') || [];
    const refDate = req.query.date || israelDateStr();

    // רצף ההיעדרויות נספר על פני כל הקבוצות של המתאמן, ולכן צריך את
    // כל הנוכחות ולא רק את זו של הקבוצה הנוכחית.
    await readTable('attendance');
    const attendance = db.get('attendance') || [];
    const attendanceByStudent = new Map();
    for (const row of attendance) {
      if (!row?.student_id) continue;
      const list = attendanceByStudent.get(row.student_id);
      if (list) list.push(row);
      else attendanceByStudent.set(row.student_id, [row]);
    }

    const rows = students.map((student) => {
      const equipment = isEquipmentEligibleStudent(student)
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
  if (!canAccessLevelTest(req.crmUser, req.body || {}, 'edit')) {
    return res.status(403).json({ error: 'אין הרשאה ליצור מבחן מהסוג הזה' });
  }
  // מבחן אבטחה הוא הקביעה שמותר לאדם לטפס, ולכן הבודק חייב להיות עובד קיר
  // שהוסמך לכך במפורש. שאר סוגי המבחנים ממשיכים כרגיל.
  if (String(req.body?.test_type || '') === 'security') {
    try {
      requireSafetyExaminer(db.get('employees') || [], req.body?.examinerId);
    } catch (err) {
      return res.status(err.status || 403).json({ error: err.message });
    }
  }
  const record = db.insertLevelTest(req.body);
  res.status(201).json(record);
});

app.put('/api/level-tests/:id', (req, res) => {
  const existing = db.getOne('level_tests', req.params.id);
  if (!existing) return res.status(404).json({ error: 'מבחן לא נמצא' });
  if (!canAccessLevelTest(req.crmUser, existing, 'edit') || !canAccessLevelTest(req.crmUser, { ...existing, ...(req.body || {}) }, 'edit')) {
    return res.status(403).json({ error: 'אין הרשאה לערוך מבחן מהסוג הזה' });
  }
  const updated = db.updateLevelTest(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'מבחן לא נמצא' });
  res.json(updated);
});

app.delete('/api/level-tests/:id', (req, res) => {
  const existing = db.getOne('level_tests', req.params.id);
  if (!existing) return res.status(404).json({ error: 'מבחן לא נמצא' });
  if (!canAccessLevelTest(req.crmUser, existing, 'edit')) {
    return res.status(403).json({ error: 'אין הרשאה למחוק מבחן מהסוג הזה' });
  }
  const ok = db.deleteLevelTest(req.params.id);
  if (!ok) return res.status(404).json({ error: 'מבחן לא נמצא' });
  res.json({ ok: true });
});

// Cash Register endpoints
app.get('/api/cash-register', (req, res) => {
  // Legacy list of old close reports — kept for history tab compatibility
  res.json(db.get('cash_register_shifts') || []);
});

app.post('/api/cash-register', (req, res) => {
  // Legacy close-only path — prefer /api/cash-register/close
  const record = db.insert('cash_register_shifts', req.body);
  res.status(201).json(record);
});

app.get('/api/cash-register/session', (req, res) => {
  res.json({
    ...sessionSnapshot(db),
    denominations: DENOMINATIONS,
  });
});

app.post('/api/cash-register/open', (req, res) => {
  try {
    const result = openSession(db, {
      denominations: req.body?.denominations || {},
      confirmSuggested: req.body?.confirmSuggested === true,
      notes: req.body?.notes || '',
      reqUser: req.crmUser,
      body: req.body,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || 'שגיאה בפתיחת קופה' });
  }
});

app.post('/api/cash-register/close', async (req, res) => {
  try {
    const result = closeSession(db, {
      denominations: req.body?.denominations || {},
      notes: req.body?.notes || '',
      reqUser: req.crmUser,
      body: req.body,
    });
    // Mirror into legacy collection so older history views still show closes
    db.insert('cash_register_shifts', {
      date: new Date().toISOString().slice(0, 10),
      shift: 'סגירה',
      employee: result.session?.closed_by_name || '',
      expected: result.expected,
      actual: result.actual,
      discrepancy: result.discrepancy,
      status: 'closed',
      session_id: result.session?.id || null,
    });

    const subscribers = alertSubscribers(db, 'cash_register_closed');
    let alertsSent = 0;
    for (const employee of subscribers) {
      const sent = await sendStaffAlert({
        employee,
        kind: 'cash_register_closed',
        text: result.summaryText,
        sendId: `sa-cash-close-${result.session?.id}-${employee.id}`,
        date: new Date().toISOString().slice(0, 10),
      });
      if (sent.sent) alertsSent += 1;
    }
    res.status(201).json({ ...result, alertsSent, alertSubscribers: subscribers.length });
  } catch (err) {
    res.status(400).json({ error: err.message || 'שגיאה בסגירת קופה' });
  }
});

app.post('/api/cash-register/fill', requireOwner, (req, res) => {
  try {
    res.status(201).json(adjustCash(db, { action: 'fill', ...req.body, reqUser: req.crmUser, body: req.body }));
  } catch (err) {
    res.status(400).json({ error: err.message || 'שגיאה' });
  }
});

app.post('/api/cash-register/empty', requireOwner, (req, res) => {
  try {
    res.status(201).json(adjustCash(db, { action: 'empty', ...req.body, reqUser: req.crmUser, body: req.body }));
  } catch (err) {
    res.status(400).json({ error: err.message || 'שגיאה' });
  }
});

app.post('/api/cash-register/reset', requireOwner, (req, res) => {
  try {
    res.status(201).json(adjustCash(db, { action: 'reset', ...req.body, reqUser: req.crmUser, body: req.body }));
  } catch (err) {
    res.status(400).json({ error: err.message || 'שגיאה' });
  }
});

app.get('/api/cash-register/ledger', (req, res) => {
  const rows = listLedger(db, {
    type: req.query.type,
    from: req.query.from,
    to: req.query.to,
    limit: req.query.limit,
  }).map((r) => ({ ...r, action_label: actionTypeLabel(r.action_type) }));
  res.json({
    rows,
    expected_cash: sessionSnapshot(db).expected_cash,
    session: getOpenSession(db),
  });
});

app.post('/api/cash-register/receipt-bytes', (req, res) => {
  try {
    if (req.body?.drawerOnly) {
      return res.json(buildDrawerOnlyPayload());
    }
    const sale = req.body?.sale || {};
    res.json(buildSaleReceipt({
      businessName: req.body?.businessName || 'קיר בועז',
      sale,
      changeGiven: req.body?.changeGiven || sale.change_given || 0,
      openDrawer: req.body?.openDrawer !== false,
    }));
  } catch (err) {
    res.status(400).json({ error: err.message || 'שגיאה בבניית הדפסה' });
  }
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
      grants_wall_climbing: item.grants_wall_climbing === true,
      family_shared: item.family_shared === true,
      transferable: item.transferable === true,
      participants_per_unit: unitCapacity(item),
      participant_ids: Array.isArray(line.participant_ids)
        ? line.participant_ids.map(String).filter(Boolean)
        : [],
      track_inventory: fromCatalog && item.track_inventory === true,
      stock_qty: item.stock_qty,
      item,
    };
  });
}

function cancellationPoliciesForSaleLines(lines = []) {
  const byVersion = new Map();
  for (const line of lines) {
    // A product carries a policy only when one was linked to it in the catalog —
    // there is no business-wide fallback at the counter, so an unlinked product
    // asks the customer to accept nothing.
    if (!line.pricelist_id) continue;
    const resolved = resolvePolicyFor(db, line.item || {}, { allowDefault: false });
    if (resolved?.version?.id) byVersion.set(resolved.version.id, resolved);
  }
  return [...byVersion.values()];
}

function requireCounterPolicyAcceptance(req, policies) {
  if (!policies.length) return;
  if (req.body?.cancellationPolicyAccepted !== true) {
    throw Object.assign(new Error('יש להציג ללקוח את מדיניות הביטול ולסמן שהלקוח אישר אותה'), {
      status: 400,
      code: 'cancellation_policy_acceptance_required',
    });
  }
}

async function recordCounterPolicyAcceptances(req, policies, sale, parentId) {
  const acceptances = [];
  for (const resolved of policies) {
    const acceptance = await recordPolicyAcceptance(db, persistCore, {
      policy: resolved.policy,
      version: resolved.version,
      parentId: parentId || null,
      posSaleId: sale.id,
      acceptedVia: 'counter',
      acceptedByStaff: req.crmUser?.id || req.crmUser?.email || req.crmUser?.name || null,
    });
    if (acceptance) acceptances.push(acceptance);
  }
  return acceptances;
}

/**
 * Wall-access lines resolved to the people they are for, with everyone still
 * short of a document named.
 *
 * The sale and the "fill the forms, then pay" link both ask this question. The
 * link exists precisely for the case the sale refuses, so the two must never be
 * able to disagree about who is missing what.
 */
async function resolveWallAccessSale(lines, { student, parent }) {
  const relevant = wallAccessLines(lines);
  if (!relevant.length) return { lines, gaps: [] };
  if (!student?.id || !parent?.id) {
    throw Object.assign(new Error('מוצר שמקנה טיפוס בקיר דורש שיוך לבן משפחה'), { status: 400 });
  }
  const household = await ensureHouseholdForParent(db, persistCore, parent.id);
  const resolved = (lines || []).map((line) => {
    if (!line.grants_wall_climbing || line.family_shared) return line;
    const quantity = Math.max(1, Number(line.quantity) || 1);
    // יחידה אחת אינה בהכרח אדם אחד: אימון זוגי מכסה שניים. הקיבולת היא
    // כמות × משתתפים ליחידה, ופחות מזה מותר — מי שקנה זוגי ובא לבד שילם
    // על המקום הפנוי.
    const perUnit = Math.max(1, Number(line.participants_per_unit) || 1);
    const capacity = quantity * perUnit;
    const participantIds = line.participant_ids?.length
      ? line.participant_ids
      : Array.from({ length: capacity }, () => String(student.id));
    if (participantIds.length > capacity) {
      throw Object.assign(
        new Error(`"${line.name}" מכסה ${capacity} משתתפים ונבחרו ${participantIds.length}`),
        { status: 400 }
      );
    }
    for (const participantId of participantIds) {
      const participant = db.getOne('students', participantId);
      if (!participant) {
        throw Object.assign(new Error('המשתתף שנבחר לא נמצא'), { status: 404 });
      }
      const inPayerHousehold = isStudentInHousehold(db, household.id, participantId);
      const eligibility = inPayerHousehold
        ? null
        : participationEligibility(db, { studentId: participantId, scope: 'wall' });
      const access = participantPaymentAccess({
        inPayerHousehold,
        wallEligible: eligibility?.eligible === true,
      });
      if (!access.allowed) {
        const error = new Error(
          `אפשר לשלם על ${participant.name || 'ילד שאינו מהמשפחה'} רק כשמסמכי ההשתתפות שלו בתוקף`
        );
        error.status = 409;
        error.code = 'external_participant_documents_required';
        throw error;
      }
    }
    return { ...line, participant_ids: participantIds };
  });
  const gaps = documentGaps({
    participantIds: wallParticipantIds(resolved, student.id),
    eligibilityOf: (studentId) => participationEligibility(db, { studentId, scope: 'wall' }),
    nameOf: (studentId) => db.getOne('students', studentId)?.name || 'המשתתף',
  });
  return { lines: resolved, gaps, household };
}

async function enforceWallAccessSaleEligibility(lines, { student, parent }) {
  const { lines: resolved, gaps } = await resolveWallAccessSale(lines, { student, parent });
  if (!gaps.length) return resolved;
  // The register offers to send a link instead of simply refusing, so the error
  // carries who is missing what rather than only saying that someone is.
  const error = new Error(
    `חסרים מסמכים — ${gaps.map((gap) => `${gap.name}: ${gapText(gap)}`).join(' · ')}`
  );
  error.status = 409;
  error.code = 'wall_documents_required';
  error.blocked = gaps;
  throw error;
}

/**
 * מכירת כניסה בודדת **היא** הכניסה.
 *
 * כרטיסייה ומנוי מייצרים כרטיס שמנוקב בדלפק, ולכן הכניסה נרשמת בניקוב. כניסה
 * בודדת לא מייצרת כלום — כך שמי שקנה אותה שילם, נכנס לקיר, ולא הופיע באף
 * רשימה: לא ביומן הכניסות, ולא בין מי שממתין לתדריך ולמבחן אבטחה. מי ששילם
 * על כניסה עכשיו נכנס עכשיו, וזה נרשם כאן.
 */
async function registerEntriesForSale({ lines, studentId }) {
  if (!studentId) return null;
  const entryLines = (lines || []).filter((line) => (
    line.grants_wall_climbing === true
    && (line.product_type || 'product') === 'product'
  ));
  if (!entryLines.length) return null;
  // הכניסה נרשמת על כל מי שהשורה נקנתה עבורו, ולא על הלקוח שנבחר בדלפק.
  // אימון זוגי הוא יחידה אחת ושני מטפסים; אם נרשום רק את הראשון, השני נמצא
  // על הקיר בלי שאיש יודע.
  const climberIds = new Set();
  for (const line of entryLines) {
    const ids = line.participant_ids?.length ? line.participant_ids : [studentId];
    for (const id of ids) if (id) climberIds.add(String(id));
  }
  const inserted = [];
  for (const climberId of climberIds) {
    const student = db.getOne('students', climberId);
    if (!student) continue;
    const documents = wallDocumentsFor(climberId);
    const group = student.groupId ? db.getOne('groups', student.groupId) : null;
    const record = db.insert('check_ins', {
      climber_id: student.id,
      climber_name: student.name,
      group_name: group?.name || 'טיפוס חופשי',
      timestamp: new Date().toISOString(),
      medical_approved: documents.ok,
      documents_state: documents.state,
      documents_label: documents.label,
      source: 'pos_sale',
    });
    inserted.push(record);
    const persisted = await persistCore('check_ins', record);
    if (persisted?.ok === false) {
      // The sale has already been charged; never turn a durable check-in error
      // into a misleading checkout failure that could cause a duplicate charge.
      console.error(`POS check-in persistence failed for ${student.id}:`, persisted.error);
    }
  }
  return inserted[0] || null;
}

async function fulfillSalePasses({ sale, lines, studentId, parentId, docId, docNumber }) {
  const issued = [];
  for (const line of lines) {
    if (!requiresCustomer(line.product_type)) continue;
    if (!studentId) continue;
    const qty = Number(line.quantity) || 1;
    for (let i = 0; i < qty; i += 1) {
      const assignedStudentId = line.participant_ids?.[i] || studentId;
      const passFields = buildPassFromItem({
        item: {
          id: line.pricelist_id,
          name: line.name,
          product_type: line.product_type,
          visits_total: line.visits_total,
          validity_days: line.validity_days,
          duration_days: line.duration_days,
          grants_wall_climbing: line.grants_wall_climbing,
          family_shared: line.family_shared,
          transferable: line.transferable,
          shared_household_id: line.family_shared ? householdIdForParent(db, parentId) : null,
        },
        studentId: assignedStudentId,
        parentId,
        saleId: sale.id,
        docId,
        docNumber,
        unitListPrice: anchorPriceForProduct(line.pricelist_id),
        discount: line.coupon_applied
          ? {
              listPrice: line.list_price,
              paidPrice: line.unitprice,
              couponCode: line.coupon_code || null,
              couponLabel: line.coupon_label || null,
            }
          : null,
      });
      if (passFields) {
        const pass = db.insert('customer_passes', passFields);
        const persisted = await persistCore('customer_passes', pass);
        if (persisted?.ok === false) {
          const error = new Error(persisted.error || 'שמירת הכרטיסייה בתיק הלקוח נכשלה');
          error.status = 503;
          throw error;
        }
        issued.push(pass);
      }
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

const passPunchLocks = new Map();

async function withPassPunchLock(passId, work) {
  const key = String(passId || '');
  const previous = passPunchLocks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  passPunchLocks.set(key, current);
  try {
    return await current;
  } finally {
    if (passPunchLocks.get(key) === current) passPunchLocks.delete(key);
  }
}

async function punchPass(pass, { punchedBy, source, note, studentId }) {
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
  //
  // כרטיסייה מועברת פותחת את השאלה „למי מותר לנקב” לכל אחד — מי שקנה אותה
  // יכול לשלם בה על חבר שבא איתו, וכל ניקוב נרשם על שם מי שנכנס. מה שהיא
  // **לא** פותחת הוא שער המסמכים: החבר עדיין צריך הצהרה בתוקף בתיק שלו, ולכן
  // צריך לבחור אותו מהרשימה ולא סתם להוסיף ניקוב אנונימי.
  const shareable = pass.transferable === true || pass.family_shared === true;
  const actualStudentId = shareable ? (studentId || pass.student_id) : pass.student_id;
  if (pass.family_shared === true && pass.transferable !== true) {
    if (!actualStudentId || !pass.shared_household_id
      || !isStudentInHousehold(db, pass.shared_household_id, actualStudentId)) {
      const err = new Error('המתאמן שנכנס אינו חבר במשפחה של הכרטיסייה');
      err.status = 403;
      throw err;
    }
  }
  const punchingStudent = actualStudentId ? db.getOne('students', actualStudentId) : null;
  const blocked = passPunchBlockReason({
    student: punchingStudent,
    declarations: db.get('health_declarations') || [],
    waivers: db.get('participation_waivers') || [],
    healthHolds: db.get('health_holds') || [],
  });
  if (blocked) {
    const err = new Error(blocked);
    err.status = 409;
    throw err;
  }
  // Travels with a successful punch, not instead of one: the entry is paid for
  // now, and the briefing happens with an instructor afterwards.
  const safetyNote = passPunchSafetyNote({
    student: punchingStudent,
    tests: db.get('level_tests') || [],
  });
  const before = Number(pass.visits_remaining);
  const after = before - 1;
  const now = new Date().toISOString();
  const punch = {
    id: `pp_${crypto.randomUUID()}`,
    pass_id: pass.id,
    student_id: actualStudentId,
    punched_at: now,
    punched_by: punchedBy || null,
    source: source || 'manual',
    note: note || '',
    visits_before: before,
    visits_after: after,
  };
  if (supa.isEnabled()) {
    const durable = await supa.atomicPassPunch({ passId: pass.id, punch });
    if (!durable.ok) {
      const err = new Error(durable.error || 'שמירת הניקוב האטומית נכשלה');
      err.status = 503;
      throw err;
    }
    const updated = durable.pass || {
      ...pass,
      visits_remaining: after,
      status: after <= 0 ? 'depleted' : 'active',
      updated_at: now,
    };
    const savedPunch = durable.punch || punch;
    db.set('customer_passes', (db.get('customer_passes') || []).map((row) => (
      String(row.id) === String(pass.id) ? updated : row
    )));
    db.set('pass_punches', [
      ...(db.get('pass_punches') || []).filter((row) => String(row.id) !== String(savedPunch.id)),
      savedPunch,
    ]);
    return { pass: updated, punch: savedPunch, safetyNote };
  }
  const updated = db.update('customer_passes', pass.id, {
    visits_remaining: after,
    status: after <= 0 ? 'depleted' : 'active',
    updated_at: now,
  });
  const savedPunch = db.insert('pass_punches', punch);
  return { pass: updated, punch: savedPunch, safetyNote };
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

/**
 * יומן פעולות כספיות — שורה לכל זיכוי, ביטול ושליחת מסמך: מי, מתי, כמה ולמה.
 * append-only בכוונה: אין עדכון ואין מחיקה. כישלון ברישום לא מפיל את הפעולה —
 * היא כבר קרתה — אלא נרשם ללוג השרת.
 */
async function recordFinanceAudit({
  action,
  saleId = null,
  paymentId = null,
  amount = null,
  reason = '',
  actor = null,
  details = '',
} = {}) {
  try {
    const result = await db.appendOnly('finance_audit_log', {
      id: `fa${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      action,
      sale_id: saleId,
      payment_id: paymentId,
      amount: Number.isFinite(Number(amount)) ? Number(amount) : null,
      reason: String(reason || ''),
      actor: actor || 'system',
      details: String(details || ''),
      at: new Date().toISOString(),
    });
    if (result?.ok === false) console.warn('⚠️ [audit] finance audit append failed:', result.error);
  } catch (err) {
    console.warn('⚠️ [audit] finance audit append failed:', err.message);
  }
}

app.get('/api/pos/sales', async (req, res) => {
  let sales = db.get('pos_sales') || [];

  // A customer card asks for its own purchases — by trainee, by household, or both.
  const askStudent = String(req.query.studentId || '').trim();
  const askParent = String(req.query.parentId || '').trim();
  if (askStudent || askParent) {
    sales = sales.filter(
      (s) =>
        (askStudent && String(s.student_id || '') === askStudent) ||
        (askParent && String(s.parent_id || '') === askParent)
    );
  }

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

  // כרטיס לקוח בלבד: תשלום ציוד הוא רכישה, גם בלי שורה ב-pos_sales. מסך
  // הקופה נשאר קופה — הוא מבקש את הרשימה בלי סינון, ולכן לא מקבל אותם.
  // סינון המדריך שלמעלה לא חל כאן בכוונה: לתשלום ציוד אין מוכר ואין משמרת,
  // והמדריך ממילא רואה בתיק הציוד אם שולם — רק לא את הסכום ואת החשבונית.
  if (askStudent || askParent) {
    sales = sales.concat(
      equipmentPurchaseRows({ payments, studentId: askStudent, parentId: askParent })
    );
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

    const documentUrl = safeIcountDocumentUrl(url);
    if (!documentUrl) return res.status(502).json({ error: 'כתובת מסמך החיוב אינה מאושרת' });
    const upstream = await fetch(documentUrl);
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

/** איתור קישור המסמך של עסקה בלי שורת תשלום — אותם שני צעדים כמו מסלול ההורדה. */
async function resolveSaleDocUrl(sale, kind) {
  const docnum = kind === 'refund' ? sale.refund_doc_number : sale.icount_doc_number;
  const doctype = kind === 'refund'
    ? sale.refund_doctype || sale.icount_doctype || 'invrec'
    : sale.icount_doctype || 'invrec';
  let url = kind === 'refund' ? sale.refund_doc_url : sale.icount_doc_url;
  if (url || !icount.isConfigured()) return { url: url || null, docnum };

  if (kind === 'charge' && sale.icount_doc_id) {
    try {
      const info = await icount.getDoc(sale.icount_doc_id);
      url = info?.doc_url || info?.docurl || info?.doc?.doc_url || info?.doc?.docurl || null;
    } catch (err) {
      console.warn('⚠️ [POS send-invoice] doc lookup failed:', err.message);
    }
  }
  if (!url && docnum) {
    try {
      const info = await icount.getDocInfo({ doctype, docnum });
      const docInfo = info.doc_info || info;
      url = docInfo?.doc_url || docInfo?.docurl || info?.doc_url || info?.docurl || null;
    } catch (err) {
      console.warn('⚠️ [POS send-invoice] doc info lookup failed:', err.message);
    }
  }
  if (url) {
    const patch = kind === 'refund'
      ? { refund_doc_url: url, updated_at: new Date().toISOString() }
      : { icount_doc_url: url, updated_at: new Date().toISOString() };
    const updated = db.update('pos_sales', sale.id, patch);
    if (updated) await persistCore('pos_sales', updated);
  }
  return { url: url || null, docnum };
}

/**
 * שליחה חוזרת של מסמך העסקה ללקוח בוואטסאפ — מתוך מסך העבודה או הקופה.
 * לעסקת דלפק בלי כרטיס לקוח אפשר למסור מספר טלפון מפורש בגוף הבקשה.
 */
app.post('/api/pos/sales/:id/send-invoice', async (req, res) => {
  try {
    const sale = db.getOne('pos_sales', req.params.id);
    if (!sale) return res.status(404).json({ error: 'עסקה לא נמצאה' });

    if (req.crmUser?.role === 'staff') {
      const today = new Date().toISOString().slice(0, 10);
      const allowed =
        String(sale.sold_by || '') === String(req.crmUser.email || '') ||
        String(sale.created_at || '').slice(0, 10) === today;
      if (!allowed) return res.status(403).json({ error: 'אין הרשאה לשלוח מסמך לעסקה זו' });
    }

    const kind = String(req.body?.kind || 'charge') === 'refund' ? 'refund' : 'charge';
    // כשיש שורת תשלום מקושרת המסמכים כבר עליה — אותו מסלול איתור כמו בתיק הלקוח.
    const payment =
      (sale.payment_id && db.getOne('payments', sale.payment_id)) ||
      (db.get('payments') || []).find((p) => String(p.pos_sale_id) === String(sale.id)) ||
      null;
    const { url, docnum } = payment
      ? await resolvePaymentDocUrl(payment, kind)
      : await resolveSaleDocUrl(sale, kind);
    if (!url) {
      return res.status(404).json({
        error: kind === 'refund'
          ? 'אין מסמך זיכוי לשליחה'
          : 'אין חשבונית לשליחה — ייתכן שהמסמך עדיין לא הופק במערכת החיוב',
      });
    }

    const parent = sale.parent_id ? db.getOne('parents', sale.parent_id) : null;
    const student = sale.student_id ? db.getOne('students', sale.student_id) : null;
    const phone = normalizePhone(req.body?.phone || sale.customer_phone || parent?.phone || student?.phone);
    if (!phone) return res.status(400).json({ error: 'אין מספר טלפון לשליחה — לעסקה אין כרטיס לקוח' });

    const profile = await getBusinessProfile();
    const itemsText = (Array.isArray(sale.items) ? sale.items : [])
      .map((item) => item?.name)
      .filter(Boolean)
      .join(' · ');
    const text = buildInvoiceWhatsAppText({
      businessName: profile?.display_name,
      parentName: sale.customer_name || parent?.name || student?.name,
      description: itemsText || 'רכישה בדלפק',
      amount: sale.total,
      docNumber: docnum,
      url,
      kind,
    });

    // clip:false — קישור המסמך לא ייחתך על ידי מגבלת אורך התשובה.
    const result = await whatsappService.sendTextMessage(phone, text, false, {
      clip: false,
      parentId: parent?.id || null,
      studentId: sale.student_id || null,
    });
    if (!result?.success) {
      return res.status(502).json({
        error: result?.error
          || 'שליחת ההודעה נכשלה — ייתכן שחלון 24 השעות סגור ואין תבנית מאושרת למסמכים',
      });
    }

    await recordFinanceAudit({
      action: 'send_invoice',
      saleId: sale.id,
      paymentId: payment?.id || null,
      amount: sale.total,
      actor: req.crmUser?.email || req.crmUser?.name || null,
      details: `kind=${kind} doc=${docnum || '-'}`,
    });
    console.log(`📄 [POS] invoice sent sale=${sale.id} kind=${kind} doc=${docnum || '-'}`);
    res.json({ success: true, url, docNumber: docnum, phone });
  } catch (err) {
    console.error('POS invoice send error:', err.message);
    res.status(502).json({ error: err.message || 'שליחת החשבונית נכשלה' });
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
    let alreadyCancelled = false;

    // Verify still cancellable when possible
    try {
      const info = await icount.getDocInfo({ doctype, docnum: sale.icount_doc_number });
      const docInfo = info.doc_info || info;
      if (docInfo?.is_cancelled) {
        // המסמך כבר בוטל מחוץ למסך הזה, אך עדיין צריך להשלים אצלנו את כל
        // הצדדים: כרטיסיות, תשלום, הטבה ויומן קופה. אסור לצאת מוקדם כאן.
        alreadyCancelled = true;
      }
      if (!alreadyCancelled && docInfo && docInfo.is_cancellable === false) {
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

    const cancellation = alreadyCancelled
      ? {
          docnum: sale.refund_doc_number || null,
          doctype: sale.refund_doctype || null,
          docUrl: sale.refund_doc_url || null,
        }
      : await icount.cancelDoc({
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
      if (updatedPass) {
        voidedPasses.push(updatedPass);
        await persistCore('customer_passes', updatedPass);
      }
    }

    // Mark related payments
    const refundedPayments = [];
    for (const payment of db.get('payments') || []) {
      if (String(payment.pos_sale_id) !== String(sale.id) && String(payment.icount_doc_number) !== String(sale.icount_doc_number)) {
        continue;
      }
      const updatedPayment = db.update('payments', payment.id, {
        status: 'refunded',
        updated_at: new Date().toISOString(),
      });
      if (updatedPayment) {
        refundedPayments.push(updatedPayment);
        await persistCore('payments', updatedPayment);
      }
    }

    const updatedSale = db.update('pos_sales', sale.id, {
      status: 'refunded',
      refunded_at: new Date().toISOString(),
      refund_reason: reason,
      refund_doc_number: cancellation.docnum || sale.refund_doc_number || null,
      refund_doctype: cancellation.doctype || sale.refund_doctype || null,
      refund_doc_url: cancellation.docUrl || sale.refund_doc_url || null,
      refund_note: alreadyCancelled ? 'המסמך כבר בוטל במערכת החיוב' : null,
      refunded_by: req.crmUser?.email || req.crmUser?.name || null,
      updated_at: new Date().toISOString(),
    });
    if (updatedSale) await persistCore('pos_sales', updatedSale);

    const refundLedger = recordRefundInLedger(db, {
      paymentMethod: sale.payment_method,
      total: sale.total,
      saleId: sale.id,
      // הזיכוי שייך למשמרת שבה בוצע בפועל, לא בהכרח לזו שבה נמכר.
      sessionId: getOpenSession(db)?.id || null,
      reqUser: req.crmUser,
    });
    if (refundLedger) await persistCore('cash_ledger', refundLedger);

    // Reversing the sale reverses the benefit too: the customer keeps the
    // coupon unless it has expired in the meantime.
    const restoredCoupons = releaseCouponsForSale(db, sale.id);
    for (const restored of restoredCoupons) {
      await persistCore('customer_coupons', restored);
    }

    console.log(
      `↩️ [POS] refund sale=${sale.id} doc=${sale.icount_doc_number} → cancel=${cancellation.docnum || 'already-cancelled'}`
    );
    await recordFinanceAudit({
      action: 'refund',
      saleId: sale.id,
      amount: sale.total,
      reason,
      actor: req.crmUser?.email || req.crmUser?.name || null,
      details: `doc=${sale.icount_doc_number || '-'} cancel=${cancellation.docnum || 'already-cancelled'}`,
    });

    res.json({
      sale: updatedSale,
      cancellation,
      alreadyCancelled,
      refundLedger,
      voidedPasses,
      refundedPayments,
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

/**
 * ביטול רכישה שלא שולמה — לא זיכוי.
 *
 * כשלא יצאה חשבונית אין מה לזכות: לא עבר כסף ואין מסמך לבטל במערכת החיוב.
 * מה שכן נשאר זו שורה שנראית כמו חוב פתוח, קישור תשלום שאפשר לשלם גם בעוד
 * חודש, וקופון שמוחזק בצד בשביל רכישה שלא תקרה. הביטול סוגר את שלושתם.
 *
 * השורה נשארת בהיסטוריה כ"בוטל" ולא נמחקת: מי ביטל ומתי זה בדיוק מה שירצו
 * לדעת כשהלקוח ישאל למה הקישור שקיבל כבר לא עובד.
 */
app.post('/api/pos/sales/:id/cancel', async (req, res) => {
  try {
    const sale = db.getOne('pos_sales', req.params.id);
    if (!sale) return res.status(404).json({ error: 'עסקה לא נמצאה' });

    if (req.crmUser?.role === 'staff') {
      const today = new Date().toISOString().slice(0, 10);
      const allowed =
        String(sale.sold_by || '') === String(req.crmUser.email || '') ||
        String(sale.created_at || '').slice(0, 10) === today;
      if (!allowed) {
        return res.status(403).json({ error: 'אין הרשאה לבטל עסקה זו' });
      }
    }

    if (sale.status === 'cancelled') {
      return res.status(400).json({ error: 'העסקה כבר בוטלה' });
    }
    if (sale.status === 'refunded') {
      return res.status(400).json({ error: 'העסקה זוכתה — אין מה לבטל' });
    }
    if (sale.status === 'paid' || sale.icount_doc_number) {
      return res.status(400).json({
        error: 'העסקה שולמה או שיצאה עליה חשבונית — צריך לזכות אותה, לא לבטל',
      });
    }

    const now = new Date().toISOString();
    const reason = String(req.body?.reason || '').trim();

    const updatedSale = db.update('pos_sales', sale.id, {
      status: 'cancelled',
      cancelled_at: now,
      cancelled_by: req.crmUser?.email || req.crmUser?.name || null,
      cancel_reason: reason || null,
      updated_at: now,
    }) || sale;
    await persistCore('pos_sales', updatedSale);

    // בקשת התשלום עצמה נסגרת גם היא, אחרת הרכישה בוטלה אבל החוב עדיין מוצג
    // בתיק הלקוח ובדוחות.
    const cancelledPayments = [];
    for (const payment of db.get('payments') || []) {
      const linked =
        String(payment.pos_sale_id || '') === String(sale.id) ||
        (sale.payment_id && String(payment.id) === String(sale.payment_id));
      if (!linked) continue;
      if (payment.status === 'paid' || payment.status === 'refunded') continue;
      const patched = db.update('payments', payment.id, { status: 'cancelled', updated_at: now });
      if (patched) {
        cancelledPayments.push(patched);
        await persistCore('payments', patched);
      }
    }

    // ההטבה הוחזקה בשביל התשלום הזה. אין תשלום — היא חוזרת ללקוח.
    const restoredCoupons = releaseCouponsForSale(db, sale.id);
    for (const restored of restoredCoupons) {
      await persistCore('customer_coupons', restored);
    }

    // קישור הטפסים שהוליד את הרכישה נסגר איתה, אחרת אפשר להשלים אותו ולייצר
    // רכישה חדשה בדיוק על מה שביטלנו.
    let cancelledLink = null;
    if (sale.checkout_link_id) {
      const link = db.getOne(POS_CHECKOUT_TABLE, sale.checkout_link_id);
      const open =
        link &&
        link.status !== POS_CHECKOUT_STATUS.PAID &&
        link.status !== POS_CHECKOUT_STATUS.CANCELLED;
      if (open) {
        cancelledLink = db.update(POS_CHECKOUT_TABLE, link.id, {
          status: POS_CHECKOUT_STATUS.CANCELLED,
          updated_at: now,
        });
        if (cancelledLink) await persistCore(POS_CHECKOUT_TABLE, cancelledLink);
      }
    }

    console.log(
      `🚫 [POS] cancelled unpaid sale=${sale.id} total=${sale.total} by=${req.crmUser?.email || 'system'}`
    );
    await recordFinanceAudit({
      action: 'cancel',
      saleId: sale.id,
      amount: sale.total,
      reason,
      actor: req.crmUser?.email || req.crmUser?.name || null,
    });

    res.json({
      sale: updatedSale,
      cancelledPayments,
      restoredCoupons,
      checkoutLink: cancelledLink,
    });
  } catch (err) {
    console.error('POS cancel error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── מחירון פעילויות ─────────────────────────────────────────────────────────
// כללי תמחור שאפשר לשייך לתבניות ולאירועים. קריאה פתוחה למי שרואה כספים — גם
// בורר המחירון בטופס האירוע וגם תקציר התבנית צריכים אותה — וכתיבה לבעלים בלבד.
// אין מחיקה: כלל שנמחק היה מותיר אירועים שאין להם דרך לחשב את עצמם.

app.get('/api/activity-price-rules', (req, res) => {
  if (!hasSensitiveAccess(req.crmUser, 'finance')) {
    return res.status(403).json({ error: 'אין הרשאה לצפות במחירון' });
  }
  const includeInactive = req.query.all === '1';
  const rules = listPriceRules(db, { includeInactive });
  res.json(rules.map((rule) => ({
    ...rule,
    summary: describeRule(rule),
    usage: priceRuleUsage(db, rule.id),
  })));
});

app.post('/api/activity-price-rules', requireOwner, async (req, res) => {
  const normalized = normalizePriceRule(req.body || {});
  const invalid = priceRuleProblem(normalized);
  if (invalid) return res.status(400).json({ error: invalid });
  ensureSeedPriceRules(db);
  const created = db.insert('activity_price_rules', {
    // מזהה מפורש: db.insert היה טובע `ac…` משתי האותיות הראשונות של שם הטבלה,
    // ומתנגש חזותית עם מזהי אירועים בכל לוג ובכל בדיקה.
    id: `pr_${Date.now()}`,
    ...normalized,
    version: 1,
    versions: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  const durable = await persistCore('activity_price_rules', created);
  if (durable?.ok === false) {
    return res.status(503).json({ error: durable.error || 'שמירת שורת המחירון נכשלה' });
  }
  res.status(201).json({ ...created, summary: describeRule(created) });
});

app.put('/api/activity-price-rules/:id', requireOwner, async (req, res) => {
  const current = db.getOne('activity_price_rules', req.params.id);
  if (!current) return res.status(404).json({ error: 'שורת המחירון לא נמצאה' });
  const normalized = normalizePriceRule({ ...current, ...(req.body || {}) });
  const invalid = priceRuleProblem(normalized);
  if (invalid) return res.status(400).json({ error: invalid });

  // גרסה עולה רק כשהמספרים זזו. תיקון ניסוח בשם או בהערה שהיה מעלה גרסה היה
  // מדליק „המחירון עודכן” על כל אירוע קיים, ומרוקן את ההתראה ממשמעות.
  const moved = ruleNumbersChanged(current, normalized);
  const version = moved ? (Number(current.version) || 1) + 1 : (Number(current.version) || 1);
  const versions = moved
    ? [
      ...(current.versions || []),
      { version: Number(current.version) || 1, saved_at: current.updated_at || null, ...ruleNumbers(current) },
    ].slice(-MAX_RULE_HISTORY)
    : (current.versions || []);

  const updated = db.update('activity_price_rules', current.id, {
    ...normalized,
    version,
    versions,
    updated_at: new Date().toISOString(),
  });
  const durable = await persistCore('activity_price_rules', updated);
  if (durable?.ok === false) {
    return res.status(503).json({ error: durable.error || 'שמירת שורת המחירון נכשלה' });
  }
  res.json({
    ...updated,
    summary: describeRule(updated),
    usage: priceRuleUsage(db, updated.id),
  });
});

/** מה שמונע שורת מחירון שאי אפשר לחשב לפיה מחיר. */
function priceRuleProblem(rule) {
  if (!rule.name) return 'יש לתת שם לשורת המחירון';
  if (rule.method === 'flat' && !rule.event_price) return 'יש להזין מחיר לאירוע';
  if (rule.method === 'per_head' && !rule.participant_price) return 'יש להזין מחיר למשתתף';
  if (rule.method === 'brackets') {
    if (!rule.brackets.length) return 'יש להזין לפחות מדרגה אחת';
    if (!rule.participant_price) return 'יש להזין מחיר למשתתף יחיד בהרשמה פתוחה';
  }
  return '';
}

// ─── Coupons ────────────────────────────────────────────────────────────────
// A coupon is the benefit a campaign (or a member of staff) handed to one
// customer. Staff may read and issue them; only the owner deletes campaigns.

app.get('/api/discount-rules', requireOwner, (_req, res) => {
  res.json([...(db.get('discount_rules') || [])].sort((a, b) => (
    String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''))
  )));
});

app.post('/api/discount-rules', requireOwner, async (req, res) => {
  const normalized = normalizeDiscountRule(req.body || {});
  if (!normalized.name) return res.status(400).json({ error: 'יש לתת שם לכלל' });
  if (normalized.audience === 'employee_role' && !normalized.role) {
    return res.status(400).json({ error: 'יש לבחור תפקיד עובד' });
  }
  if (!normalized.benefits.length) return res.status(400).json({ error: 'יש להוסיף לפחות הנחה אחת' });
  const created = db.insert('discount_rules', {
    ...normalized,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  await persistCore('discount_rules', created);
  res.status(201).json(created);
});

app.put('/api/discount-rules/employee/:employeeId/student', requireOwner, async (req, res) => {
  const employee = db.getOne('employees', req.params.employeeId);
  if (!employee) return res.status(404).json({ error: 'העובד לא נמצא' });
  const studentId = req.body?.studentId || null;
  if (studentId && !db.getOne('students', studentId)) {
    return res.status(404).json({ error: 'תיק המתאמן לא נמצא' });
  }
  const updated = db.update('employees', employee.id, {
    customer_student_id: studentId,
    updated_at: new Date().toISOString(),
  });
  await persistCore('employees', updated);
  res.json(employeeForRequest(req, updated));
});

app.put('/api/discount-rules/:id', requireOwner, async (req, res) => {
  const current = db.getOne('discount_rules', req.params.id);
  if (!current) return res.status(404).json({ error: 'כלל ההנחה לא נמצא' });
  const normalized = normalizeDiscountRule({ ...current, ...req.body });
  if (!normalized.name || !normalized.benefits.length) {
    return res.status(400).json({ error: 'הכלל דורש שם והנחה אחת לפחות' });
  }
  const updated = db.update('discount_rules', current.id, {
    ...normalized,
    updated_at: new Date().toISOString(),
  });
  await persistCore('discount_rules', updated);
  res.json(updated);
});

async function syncAutomaticDiscountCoupon(studentId) {
  if (!studentId) return null;
  const student = db.getOne('students', studentId);
  if (!student) return null;
  const rules = matchingDiscountRules(db, studentId);
  const existing = (db.get('customer_coupons') || []).find((coupon) => (
    coupon.source === 'discount_rules' && String(coupon.student_id) === String(studentId)
  )) || null;
  if (!rules.length) {
    if (existing && existing.status !== COUPON_STATUS.CANCELLED) {
      const cancelled = cancelCoupon(db, existing.id, 'הזכאות האוטומטית הסתיימה');
      await persistCore('customer_coupons', cancelled);
    }
    return null;
  }
  const ruleOffers = rules.map(offerForDiscountRule);
  const offer = normalizeOffer({
    type: 'ruleset',
    label: rules.map((rule) => rule.name).join(' · '),
    noExpiry: true,
    parts: ruleOffers.flatMap((item) => item.parts),
  });
  if (existing) {
    const updated = db.update('customer_coupons', existing.id, {
      offer,
      label: offer.label,
      parent_id: student.parentId || student.parent_id || null,
      rule_ids: rules.map((rule) => rule.id),
      recurring: true,
      status: COUPON_STATUS.ACTIVE,
      expires_at: null,
      updated_at: new Date().toISOString(),
    });
    await persistCore('customer_coupons', updated);
    return updated;
  }
  const created = issueCoupon(db, {
    offer,
    parentId: student.parentId || student.parent_id || null,
    studentId,
    recurring: true,
    source: 'discount_rules',
    issuedBy: 'כללי הנחה אוטומטיים',
  });
  const enriched = db.update('customer_coupons', created.id, { rule_ids: rules.map((rule) => rule.id) });
  await persistCore('customer_coupons', enriched);
  return enriched;
}

app.get('/api/coupons', (req, res) => {
  const { parentId, studentId, campaignId, employeeId, recurring, status } = req.query;
  res.json(
    listCoupons(db, {
      parentId: parentId || undefined,
      studentId: studentId || undefined,
      campaignId: campaignId || undefined,
      employeeId: employeeId || undefined,
      recurring: recurring === undefined ? undefined : recurring === '1' || recurring === 'true',
      status: status || undefined,
    })
  );
});

app.post('/api/coupons', async (req, res) => {
  try {
    const { offer, parentId, studentId, employeeId, recurring, campaignId, campaignName } = req.body || {};
    if (!parentId && !studentId) {
      return res.status(400).json({ error: 'בחרו לקוח שיקבל את ההטבה' });
    }
    const coupon = issueCoupon(db, {
      offer,
      parentId: parentId || null,
      studentId: studentId || null,
      campaignId: campaignId || null,
      campaignName: campaignName || '',
      employeeId: employeeId || null,
      recurring: Boolean(recurring),
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

app.put('/api/coupons/:id', async (req, res) => {
  const existing = db.getOne('customer_coupons', req.params.id);
  if (!existing) return res.status(404).json({ error: 'ההטבה לא נמצאה' });
  if (!existing.recurring) return res.status(400).json({ error: 'אפשר לעדכן רק הנחה קבועה' });
  const offer = req.body?.offer ? normalizeOffer(req.body.offer) : existing.offer;
  const updated = db.update('customer_coupons', existing.id, {
    offer,
    label: offerSummary(offer),
    parent_id: req.body?.parentId === undefined ? existing.parent_id : req.body.parentId || null,
    student_id: req.body?.studentId === undefined ? existing.student_id : req.body.studentId || null,
    updated_at: new Date().toISOString(),
  });
  await persistCore('customer_coupons', updated);
  res.json({ ...updated, state: couponState(updated), days_left: null });
});

/** Active benefits for the customer the register has selected. */
app.get('/api/pos/coupons', async (req, res) => {
  const { parentId, studentId } = req.query;
  if (!parentId && !studentId) return res.json([]);
  if (studentId) await syncAutomaticDiscountCoupon(studentId);
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
    offerTypes: Object.values(OFFER_TYPES).filter((key) => key !== OFFER_TYPES.RULESET).map((key) => ({ key, label: OFFER_TYPE_LABELS[key] })),
    presets: campaignPresets(),
  });
});

/** The approval queue: suggestions waiting for a member of staff to decide. */
app.get('/api/campaigns/pending', requireOwner, (req, res) => {
  const rows = (db.get('campaign_sends') || [])
    .filter((row) => row.status === SEND_STATUS.PENDING)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  res.json(activityForRequest(req, rows));
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
  if (req.crmUser?.role === 'staff' && !req.query.studentId) {
    return res.status(403).json({ error: 'צוות תפעול יכול לצפות בכרטיסייה רק בזמן כניסת מתאמן' });
  }
  let passes = db.get('customer_passes') || [];
  if (req.query.studentId) {
    passes = passes.filter((pass) => (
      String(pass.student_id) === String(req.query.studentId)
      || (pass.family_shared === true
        && pass.shared_household_id
        && isStudentInHousehold(db, pass.shared_household_id, req.query.studentId))
    ));
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

app.post('/api/pos/passes/:id/punch', async (req, res) => {
  try {
    const result = await withPassPunchLock(req.params.id, async () => {
      const pass = db.getOne('customer_passes', req.params.id);
      return punchPass(pass, {
        punchedBy: req.crmUser?.name || req.crmUser?.email || 'צוות',
        source: req.body?.source || 'customer_card',
        note: req.body?.note || '',
        studentId: req.body?.student_id || req.body?.studentId || null,
      });
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

function posSellerForRequest(req) {
  const employeeId = String(req.body?.seller_employee_id || '').trim();
  if (!employeeId) {
    if (req.crmUser?.account_type === 'shared_station') {
      throw Object.assign(new Error('יש לבחור מי מבצע את המכירה'), { status: 400, code: 'SELLER_REQUIRED' });
    }
    return {
      employee_id: req.crmUser?.employee_id || null,
      name: req.crmUser?.name || req.crmUser?.email || 'צוות',
    };
  }
  const employee = (db.get('employees') || []).find((row) => String(row.id) === employeeId);
  if (!employee || employee.is_active === false) {
    throw Object.assign(new Error('העובד שנבחר אינו פעיל או לא נמצא'), { status: 400, code: 'SELLER_INVALID' });
  }
  return { employee_id: employee.id, name: employee.name || 'עובד' };
}

/**
 * האם אפשר להציע „אשראי במסוף” בקופה.
 *
 * התשובה מגיעה מהגדרות החשבון ב-iCount ולא ממשתנה סביבה, כדי שחיבור מכשיר או
 * ניתוקו ישתקפו במסך בלי לגעת בשרת. התשובה נשמרת במטמון לכמה דקות.
 */
app.get('/api/pos/emv/status', async (req, res) => {
  try {
    const status = await icount.emvStatus({ force: req.query.refresh === '1' });
    res.json({ ...status, timeoutMs: icount.emvTimeoutMs() });
  } catch (err) {
    res.json({ available: false, configured: icount.isConfigured(), reason: err.message, devices: [] });
  }
});

/**
 * חיובי אשראי של היום שלא הופק עליהם מסמך.
 *
 * זה המסך שמופיע אחרי חיוב שהתשובה עליו אבדה: במקום לחייב שוב, מאתרים כאן את
 * החיוב שכבר קרה ומשלימים עליו את המכירה.
 */
app.get('/api/pos/emv/orphan-charges', async (req, res) => {
  try {
    if (!icount.isConfigured()) {
      return res.status(503).json({ error: 'iCount לא מוגדר בשרת' });
    }
    const amountRaw = String(req.query.amount || '').trim();
    const amount = amountRaw ? Number(amountRaw) : null;
    const charges = await listOrphanEmvCharges({
      icount,
      amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    });
    res.json({
      charges: charges.map((row) => ({
        confirmationCode: row.confirmationCode,
        amount: row.charged,
        cardLast4: row.cardLast4,
        cardType: row.cardType,
        holderName: row.holderName,
        chargeDate: row.chargeDate,
      })),
    });
  } catch (err) {
    console.error('POS emv orphan lookup error:', err.message);
    res.status(502).json({ error: err.message || 'בדיקת החיובים נכשלה' });
  }
});

app.post('/api/pos/sale', async (req, res) => {
  // ההדפסה בדלפק ממתינה לתשובה הזאת: מספר המסמך מודפס על הקבלה, ולכן אי אפשר
  // להדפיס לפני שהוא קיים. המשמעות היא שכל קריאה חיצונית שיושבת כאן נמדדת
  // בשניות שבהן הדלפקיסט עומד מול הלקוח ומחכה. הפירוק לשלבים הוא הדרך היחידה
  // לדעת מי מהן באמת עולה — במקום לנחש ולייעל את הדבר הלא נכון.
  const startedAt = Date.now();
  const phases = [];
  let phaseAt = startedAt;
  const phase = (label) => {
    const now = Date.now();
    phases.push(`${label} ${now - phaseAt}ms`);
    phaseAt = now;
  };
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
      tenderedAmount,
      // מספר אישור מחיוב שכבר בוצע במסוף — מסלול ההשלמה אחרי תשובה שאבדה.
      // כשהוא קיים לא נשלח חיוב חדש למכשיר.
      emvConfirmationCode = '',
    } = req.body || {};

    let lines = mapCartLines(cart);
    if (!lines.length) return res.status(400).json({ error: 'העגלה ריקה' });
    const seller = posSellerForRequest(req);

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
    lines = await enforceWallAccessSaleEligibility(lines, { student, parent });
    phase('eligibility');
    const cancellationPolicies = cancellationPoliciesForSaleLines(lines);
    requireCounterPolicyAcceptance(req, cancellationPolicies);

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
    const rawMethod = String(paymentMethod || 'cash').toLowerCase();
    // „אשראי במסוף” הגיע בעבר בכמה שמות. כולם אותו דבר, ונשמרים כ-emv אחד
    // כדי שסינון, דוחות וזיכוי לא יצטרכו להכיר ארבע מילים לאותו אמצעי תשלום.
    const method = ['emv', 'credit', 'cc', 'card'].includes(rawMethod) ? 'emv' : rawMethod;
    if (method === 'emv' && !icount.isConfigured()) {
      return res.status(503).json({
        error: 'סליקה במסוף דורשת חיבור ל-iCount, והוא לא מוגדר בשרת',
      });
    }

    const openSessionRow = getOpenSession(db);
    let tendered = null;
    let changeGiven = null;
    if (method === 'cash') {
      if (!openSessionRow) {
        return res.status(400).json({
          error: 'אי אפשר לגבות במזומן בלי לפתוח קופה קודם — עברו ללשונית סגירת קופה ופתחו משמרת, או גבו בסליקה בקישור.',
          code: 'CASH_SESSION_REQUIRED',
        });
      }
      tendered = tenderedAmount != null ? cashRoundMoney(tenderedAmount) : cashRoundMoney(total);
      if (!(tendered >= total - 0.001)) {
        return res.status(400).json({
          error: `הסכום שהתקבל (₪${tendered}) קטן מסכום העגלה (₪${total})`,
        });
      }
      changeGiven = cashRoundMoney(tendered - total);
    }
    let clientId = parent?.icount_client_id || null;
    let syncedParent = parent;
    if (parent?.id && icount.isConfigured()) {
      const synced = await syncParentToIcount(parent);
      syncedParent = synced.parent;
      clientId = synced.clientId;
    }
    phase('icount:client');

    const customerName = syncedParent?.name || student?.name || walkInName || 'לקוח מדלפק';

    // הכסף לפני המסמך. חשבונית אפשר להוציא שוב, חיוב שנכשל אחרי שהוצאה
    // חשבונית הוא הכנסה רשומה שלא התקבלה.
    let emvCharge = null;
    if (method === 'emv') {
      try {
        emvCharge = await chargeEmvForSale({
          icount,
          total,
          clientId,
          clientName: customerName,
          email: syncedParent?.email || walkInEmail || '',
          confirmationCode: emvConfirmationCode,
        });
      } catch (chargeErr) {
        console.error(
          `💳 [POS] EMV charge failed (₪${total})`,
          chargeErr.code || '',
          chargeErr.message,
          chargeErr.indeterminate ? '— תשובה לא ודאית' : ''
        );
        if (chargeErr.indeterminate) {
          await recordFinanceAudit({
            action: 'emv_charge_unknown',
            amount: total,
            reason: chargeErr.message,
            actor: seller.name || req.crmUser?.email || null,
            details: `לקוח=${customerName}`,
          });
        }
        return res.status(chargeErr.status || 502).json({
          error: emvFailureMessage(chargeErr),
          code: chargeErr.code || 'emv_failed',
          emvIndeterminate: !!chargeErr.indeterminate,
        });
      }
      phase('icount:emv');
    }

    let doc = null;
    let docError = null;
    if (icount.isConfigured()) {
      const createDoc = () => icount.createInvRec({
        clientId,
        clientName: customerName,
        items: lines.map((l) => ({
          description: l.description,
          unitprice: l.unitprice,
          quantity: l.quantity,
        })),
        comment: `מכירה בדלפק · ${method}${student?.name ? ` · עבור: ${student.name}` : ''}`,
        emailTo: sendEmail ? syncedParent?.email || walkInEmail : undefined,
        paymentMethod: method,
        vattype: icountVatType(true),
        cc: emvCharge
          ? {
            confirmationCode: emvCharge.confirmationCode,
            last4: emvCharge.cardLast4,
            cardType: emvCharge.cardType,
            numOfPayments: emvCharge.numOfPayments || 1,
          }
          : null,
        // מפתח ייחודי לחיוב הזה: ניסיון שני לא יוציא חשבונית שנייה על אותו כסף.
        sanityString: emvCharge?.confirmationCode
          ? `emv-${emvCharge.confirmationCode}`
          : emvCharge?.ccBillLogId
            ? `emv-bill-${emvCharge.ccBillLogId}`
            : '',
      });

      if (emvCharge) {
        // הכסף כבר נגבה. כישלון בהפקת המסמך אינו מבטל את המכירה — הוא מדווח
        // בגלוי כדי שיושלם, ולא בולע חיוב שקרה.
        try {
          doc = await createDoc();
        } catch (err) {
          docError = err.message || 'הפקת החשבונית נכשלה';
          console.error('🧾 [POS] EMV charged but invoice failed:', docError);
          await recordFinanceAudit({
            action: 'emv_invoice_failed',
            amount: total,
            reason: docError,
            actor: seller.name || req.crmUser?.email || null,
            details: `אישור=${emvCharge.confirmationCode || '-'} כרטיס=${emvCharge.cardLast4 || '-'}`,
          });
        }
      } else {
        doc = await createDoc();
      }
    }
    phase('icount:doc');

    let sale = db.insert('pos_sales', {
      items: lines.map(({ item, ...rest }) => rest),
      total,
      payment_method: method,
      cc_confirmation_code: emvCharge?.confirmationCode || null,
      cc_last4: emvCharge?.cardLast4 || null,
      cc_card_type: emvCharge?.cardType || null,
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
      sold_by: seller.name,
      sold_by_employee_id: seller.employee_id,
      sent_email: !!sendEmail,
      sent_whatsapp: !!sendWhatsapp,
      coupon_id: coupon?.id || null,
      coupon_code: coupon?.code || null,
      coupon_discount: couponDiscount || 0,
      tendered_amount: tendered,
      change_given: changeGiven,
      policy_snapshots: cancellationPolicies.map((resolved) => resolved.snapshot),
      session_id: openSessionRow?.id || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const policyAcceptances = await recordCounterPolicyAcceptances(
      req,
      cancellationPolicies,
      sale,
      syncedParent?.id || parentId || null
    );
    sale = db.update('pos_sales', sale.id, {
      cancellation_acceptance_ids: policyAcceptances.map((acceptance) => acceptance.id),
      updated_at: new Date().toISOString(),
    }) || sale;
    await persistCore('pos_sales', sale);

    recordSaleInLedger(db, {
      paymentMethod: method,
      total,
      tendered,
      changeGiven,
      saleId: sale.id,
      sessionId: openSessionRow?.id || null,
      reqUser: { ...req.crmUser, employee_id: seller.employee_id, name: seller.name },
    });

    if (coupon) {
      redeemCoupon(db, coupon.id, { saleId: sale.id, amount: couponDiscount });
      await persistCore('customer_coupons', db.getOne('customer_coupons', coupon.id));
      console.log(`🎟️ [POS] coupon ${coupon.code} redeemed on sale ${sale.id} (₪${couponDiscount})`);
    }

    /**
     * הנפקת הכרטיסיות והמלאי.
     *
     * בעסקת מסוף הכסף כבר עבר בשלב הזה, ולכן שגיאה כאן אינה מוחזרת כשגיאת
     * מכירה: דלפקיסט שרואה „הפעולה נכשלה” אחרי שכרטיס חויב ינסה שוב, וזה
     * חיוב כפול. הכשל מדווח כאזהרה לצד מכירה שהצליחה, כדי שיושלם ביד.
     */
    let passes = [];
    let fulfillmentError = null;
    try {
      passes = await fulfillSalePasses({
        sale,
        lines,
        studentId: student?.id,
        parentId: syncedParent?.id || null,
        docId: doc?.docId,
        docNumber: doc?.docnum,
      });
      decrementInventory(lines);
      await registerEntriesForSale({ lines, studentId: student?.id });
    } catch (fulfillErr) {
      if (method !== 'emv') throw fulfillErr;
      fulfillmentError = fulfillErr.message || 'הנפקת הכרטיסייה נכשלה';
      console.error(`🎫 [POS] EMV sale ${sale.id} charged but fulfilment failed:`, fulfillmentError);
      await recordFinanceAudit({
        action: 'emv_fulfilment_failed',
        saleId: sale.id,
        amount: total,
        reason: fulfillmentError,
        actor: seller.name || req.crmUser?.email || null,
        details: `אישור=${emvCharge?.confirmationCode || '-'}`,
      });
    }

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
      // מזהה החיוב הוא מה שזיכוי חלקי דורש בהמשך, והוא אינו מופיע ב-doc/info.
      // הרגע הזה הוא ההזדמנות היחידה לשמור אותו בלי חיפוש ביומן החיובים.
      cc_bill_log_id: emvCharge?.ccBillLogId || null,
      cc_confirmation_code: emvCharge?.confirmationCode || null,
      cc_last4: emvCharge?.cardLast4 || null,
      cc_card_type: emvCharge?.cardType || null,
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

    // החשבונית נשלחת מהשרת. עד היום נבנתה כאן רק כתובת wa.me שפתחה דפדפן
    // בדלפק וחיכתה שמישהו ילחץ „שלח” — מה שקרה לפעמים, ואיש לא ידע מתי לא.
    phase('db+passes');

    let whatsappUrl = null;
    let invoiceWhatsappSent = false;
    let invoiceWhatsappError = null;
    if (sendWhatsapp) {
      const phone = normalizePhone(syncedParent?.phone || walkInPhone);
      if (!phone) {
        invoiceWhatsappError = 'אין מספר טלפון לשליחת החשבונית';
      } else {
        const msg = [
          `שלום${syncedParent?.name ? ` ${syncedParent.name}` : ''},`,
          `תודה על הרכישה ב־${await businessBrand()}.`,
          `סכום: ₪${total}`,
          doc?.docnum ? `מספר מסמך: ${doc.docnum}` : '',
          doc?.docUrl ? `קישור למסמך: ${doc.docUrl}` : '',
        ].filter(Boolean).join(String.fromCharCode(10));
        // תבנית מאושרת קודם: היא היחידה שמגיעה גם ללקוח שלא כתב לנו קודם,
        // וזה כמעט כל מי שנכנס לטפס. טקסט חופשי הוא רק גיבוי בתוך 24 השעות.
        const invoiceTpl = (db.get('message_templates') || []).find(
          (t) => (t.meta_name || t.name) === POS_INVOICE_TEMPLATE_NAME
        );
        const invoiceTplApproved =
          invoiceTpl && String(invoiceTpl.status).toUpperCase() === 'APPROVED';
        let invoiceButtonToken = '';
        try {
          invoiceButtonToken = issuePublicRedirectToken('sale-document', sale.id);
        } catch {
          // Without a signing secret, use the free-text delivery path below.
        }
        if (invoiceTplApproved && doc?.docnum && invoiceButtonToken) {
          try {
            const waResult = await whatsappService.sendTemplateMessage(
              phone,
              POS_INVOICE_TEMPLATE_NAME,
              [syncedParent?.name || 'לקוח', String(total), String(doc.docnum)],
              { fallbackName: syncedParent?.name, parentId: syncedParent?.id, buttonUrlParam: invoiceButtonToken }
            );
            invoiceWhatsappSent = !!waResult?.success;
            if (!invoiceWhatsappSent) invoiceWhatsappError = waResult?.error || 'שליחת תבנית החשבונית נכשלה';
          } catch (waErr) {
            invoiceWhatsappError = waErr.message || 'שליחת תבנית החשבונית נכשלה';
          }
        }
        if (!invoiceWhatsappSent) {
          try {
            const waResult = await whatsappService.sendTextMessage(phone, msg, false, {
              parentId: syncedParent?.id,
              fallbackName: syncedParent?.name,
              source: 'pos_invoice',
            });
            invoiceWhatsappSent = !!waResult?.success;
            if (!invoiceWhatsappSent) invoiceWhatsappError = waResult?.error || 'שליחת החשבונית נכשלה';
            else invoiceWhatsappError = null;
          } catch (waErr) {
            invoiceWhatsappError = waErr.message || invoiceWhatsappError || 'שליחת החשבונית נכשלה';
          }
        }
        if (!invoiceWhatsappSent) {
          const digits = phone.replace(/^0/, '972');
          whatsappUrl = `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
        }
      }
    }

    phase('whatsapp');

    // גם עסקת אשראי במסוף מקבלת קבלה מודפסת — אבל בלי לפתוח את המגירה,
    // שאין בה מה לעשות כשלא עבר מזומן.
    const receipt = method === 'cash' || method === 'emv'
      ? buildSaleReceipt({
        sale,
        changeGiven,
        openDrawer: method === 'cash',
      })
      : null;

    console.log(
      `⏱️ [POS] sale ${sale.id} took ${Date.now() - startedAt}ms — ${phases.join(' · ')}`
    );

    res.status(201).json({
      sale,
      passes,
      doc,
      // החיוב עבר אבל החשבונית לא יצאה — נאמר במפורש, כדי שיושלם ולא ייעלם.
      documentError: docError,
      fulfillmentError,
      emv: emvCharge
        ? {
          confirmationCode: emvCharge.confirmationCode,
          cardLast4: emvCharge.cardLast4,
          cardType: emvCharge.cardType,
          adopted: !!emvCharge.adopted,
        }
        : null,
      whatsappUrl,
      whatsappSent: invoiceWhatsappSent,
      whatsappError: invoiceWhatsappSent ? null : invoiceWhatsappError,
      isNewLead: !!isNewLead,
      parent: syncedParent,
      coupon: coupon ? { code: coupon.code, discount: couponDiscount } : null,
      changeGiven,
      receiptBytes: receipt,
    });
  } catch (err) {
    console.error('POS sale error:', err.message, err.details?.error_details || '');
    const details = Array.isArray(err.details?.error_details)
      ? err.details.error_details.filter(Boolean).join(' · ')
      : '';
    res.status(err.status || 502).json({
      error: details || err.message,
      code: err.code,
      blocked: err.blocked,
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

    let lines = mapCartLines(cart);
    if (!lines.length) return res.status(400).json({ error: 'העגלה ריקה' });
    const seller = posSellerForRequest(req);

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
    if (includePaymentLink) lines = await enforceWallAccessSaleEligibility(lines, { student, parent });
    const cancellationPolicies = includePaymentLink ? cancellationPoliciesForSaleLines(lines) : [];
    if (includePaymentLink) requireCounterPolicyAcceptance(req, cancellationPolicies);

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
      sold_by: seller.name,
      sold_by_employee_id: seller.employee_id,
      sent_email: !!(sendEmail && email),
      sent_whatsapp: !!sendWhatsapp,
      policy_snapshots: cancellationPolicies.map((resolved) => resolved.snapshot),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const policyAcceptances = await recordCounterPolicyAcceptances(
      req,
      cancellationPolicies,
      sale,
      syncedParent?.id || parentId || null
    );
    if (policyAcceptances.length) {
      sale = db.update('pos_sales', sale.id, {
        cancellation_acceptance_ids: policyAcceptances.map((acceptance) => acceptance.id),
        updated_at: new Date().toISOString(),
      }) || sale;
    }

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
    res.status(err.status || 502).json({ error: err.message, code: err.code, blocked: err.blocked });
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
  const paymentButtonToken = icount.buildPaymentRedirectToken(paymentId);
  const canUseMetaTemplate = tplApproved && !runningLocally && !!paymentButtonToken;

  // Why the reliable path was skipped — the screen has to say this, otherwise a
  // message Meta accepted but never delivered looks like a success.
  const templateSkippedReason = canUseMetaTemplate
    ? null
    : !localTpl
      ? `לא נמצאה תבנית בשם „${tplName}” במערכת`
      : !tplApproved
        ? `התבנית „${tplName}” עדיין לא מאושרת במטא`
        : runningLocally
          ? 'השרת רץ מקומית, ולכן הכפתור בתבנית היה מוביל לכתובת שלא זמינה מהטלפון'
          : 'אין סוד חתימה לקישורים ציבוריים';

  if (canUseMetaTemplate) {
    try {
      const waResult = await whatsappService.sendTemplateMessage(
        phone,
        tplName,
        [customerName, description || 'רכישה', String(amount)],
        { fallbackName: customerName, parentId, buttonUrlParam: paymentButtonToken }
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
    res.status(err.status || 502).json({ error: err.message, code: err.code });
  }
});

/**
 * Open a `pending_payment` counter sale and the clearing link that closes it.
 *
 * The register reaches this directly; the documents link reaches it from the
 * public page, once the customer has signed what was missing. Both must produce
 * the same sale, the same held benefit and the same webhook behaviour, so the
 * whole thing lives here once instead of being written twice.
 *
 * `recordAcceptances` differs between the two — staff tick the policy at the
 * counter, the customer ticks it on their own page — so the caller supplies it.
 */
async function openPendingPosSale({
  lines: inputLines,
  student,
  parent,
  parentId = null,
  walkInName = '',
  walkInPhone = '',
  walkInEmail = '',
  couponCode = null,
  cancellationPolicies = [],
  recordAcceptances = async () => [],
  soldBy = null,
  soldByEmployeeId = null,
  source = null,
  checkoutLinkId = null,
  successUrl = null,
} = {}) {
  let lines = inputLines;
  // Server-side recompute, so the amount baked into the payment link is one we
  // calculated, not one the screen sent.
  let coupon = null;
  let couponDiscount = 0;
  if (couponCode) {
    const check = checkCouponForSale(db, {
      code: couponCode,
      parentId: parent?.id || parentId || null,
      studentId: student?.id || null,
      lines,
    });
    if (!check.ok) throw Object.assign(new Error(check.error), { status: 400 });
    lines = check.lines;
    coupon = check.coupon;
    couponDiscount = check.discount;
  }

  const total = computeSaleTotal(lines);
  if (!(Number(total) > 0)) {
    throw Object.assign(
      new Error(
        'לא ניתן ליצור קישור תשלום לסכום 0. עמוד הסליקה חוזר אז למחיר ברירת מחדל. לסכום חינם השתמשו במזומן או גבייה ללא קישור.'
      ),
      { status: 400 }
    );
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

  let sale = db.insert('pos_sales', {
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
    sold_by: soldBy,
    sold_by_employee_id: soldByEmployeeId,
    // קישור שנפתח בדלפק הוא עסקה של המשמרת כבר מרגע השליחה, בדיוק כמו
    // מזומן. השיוך נשמר גם אם הלקוח משלם כמה דקות אחר כך.
    session_id: getOpenSession(db)?.id || null,
    source: source || undefined,
    // The link that produced this sale, so the webhook can report back to it.
    checkout_link_id: checkoutLinkId || null,
    coupon_id: coupon?.id || null,
    coupon_code: coupon?.code || null,
    coupon_discount: couponDiscount || 0,
    policy_snapshots: cancellationPolicies.map((resolved) => resolved.snapshot),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const policyAcceptances = await recordAcceptances({ sale, parentId: syncedParent?.id || parentId || null });
  if (policyAcceptances.length) {
    sale = db.update('pos_sales', sale.id, {
      cancellation_acceptance_ids: policyAcceptances.map((acceptance) => acceptance.id),
      updated_at: new Date().toISOString(),
    }) || sale;
  }

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
    ...(successUrl ? { successUrl } : {}),
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

  return {
    sale: updatedSale || { ...sale, payment_url: payUrl },
    payment: updatedPayment || { ...payment, payment_url: payUrl },
    payUrl,
    shortUrl,
    shareUrl,
    description,
    total,
    syncedParent,
    syncWarning,
  };
}

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
    const seller = posSellerForRequest(req);

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
    lines = await enforceWallAccessSaleEligibility(lines, { student, parent });
    const cancellationPolicies = cancellationPoliciesForSaleLines(lines);
    requireCounterPolicyAcceptance(req, cancellationPolicies);

    const {
      sale: updatedSale,
      payment: updatedPayment,
      payUrl,
      shortUrl,
      shareUrl,
      description,
      total,
      syncedParent,
      syncWarning,
    } = await openPendingPosSale({
      lines,
      student,
      parent,
      parentId,
      walkInName,
      walkInPhone,
      walkInEmail,
      couponCode,
      cancellationPolicies,
      recordAcceptances: ({ sale, parentId: payerId }) =>
        recordCounterPolicyAcceptances(req, cancellationPolicies, sale, payerId),
      soldBy: seller.name,
      soldByEmployeeId: seller.employee_id,
      // קישור תשלום מהדלפק נשלח רק על דבר שכבר מחייב — ולכן הוא תמיד חוב.
      source: 'pos_debt',
    });

    const delivery = sendWhatsapp
      ? await sendPaymentLinkWhatsapp({
          phone: syncedParent?.phone || walkInPhone,
          customerName: syncedParent?.name || walkInName || 'לקוח',
          parentId: syncedParent?.id || null,
          paymentId: updatedPayment.id,
          description,
          amount: total,
          shareUrl,
        })
      : { whatsappUrl: null, whatsappSent: false, whatsappError: null };
    const { whatsappUrl, whatsappSent, whatsappError, via, deliveryWarning } = delivery;

    res.status(201).json({
      sale: updatedSale,
      payment: updatedPayment,
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
    res.status(err.status || 502).json({ error: err.message, code: err.code, blocked: err.blocked });
  }
});

// ─── Counter link: fill the missing documents, then pay ─────────────────────

/**
 * The link's own record of the payment, plus the message that tells the team.
 *
 * Staff sent this customer away to fill forms; without a line arriving when the
 * money does, the only way to learn it ended well is to go looking for it.
 */
async function closePaidCheckoutLink(sale, paidAt) {
  try {
    const link = await resolvePosCheckoutLink(sale.checkout_link_id);
    if (!link || link.status === POS_CHECKOUT_STATUS.PAID) return;
    const at = paidAt || new Date().toISOString();
    const paid = db.update(POS_CHECKOUT_TABLE, link.id, {
      status: POS_CHECKOUT_STATUS.PAID,
      paid_at: at,
      sale_id: sale.id,
      updated_at: at,
    }) || link;
    await persistCore(POS_CHECKOUT_TABLE, paid);
    console.log(`✅ [POS] checkout link ${link.id} paid — sale ${sale.id}`);

    const names = (link.participants || []).map((p) => p.name).filter(Boolean).join(', ');
    const text =
      `💳 שולם קישור מהקופה\n` +
      `${link.customer_name || 'לקוח'} — ${checkoutItemsLabel(link)} · ₪${Number(link.total) || 0}\n` +
      (names ? `המסמכים הושלמו עבור: ${names}\n` : '') +
      `הכרטיסייה/המנוי נכנסו לתיק.`;
    for (const employee of alertSubscribers(db, 'pos_link_paid')) {
      await sendStaffAlert({
        employee,
        kind: 'pos_link_paid',
        text,
        sendId: `sa-pos-link-${link.id}-${employee.id}`,
        date: at.slice(0, 10),
      });
    }
  } catch (err) {
    // The customer paid and the pass was issued — a failure to update the
    // register's list must never turn into a failed webhook and a retry.
    console.warn('⚠️ [POS] checkout link close skipped:', err.message);
  }
}

function checkoutLinkPageUrl(req, token) {
  const path = `/checkout/${encodeURIComponent(token)}`;
  const origin = String(req?.headers?.origin || '').trim().replace(/\/$/, '');
  // Staff testing from localhost get a link they can open in the same browser.
  if (origin && isLocalAppOrigin(origin)) return `${origin}${path}`;
  return `${frontendPublicBase(req)}${path}`;
}

/**
 * A link by its token, including one created by another instance.
 *
 * The durable read only happens on a miss, and merges rather than replaces:
 * a link written here a moment ago must not be wiped by a remote snapshot that
 * predates it.
 */
async function resolvePosCheckoutLink(token) {
  const wanted = String(token || '').trim();
  if (!wanted) return null;
  const local = db.getOne(POS_CHECKOUT_TABLE, wanted);
  if (local) return local;
  if (!supa.isEnabled()) return null;
  try {
    const rows = await supa.getAll(POS_CHECKOUT_TABLE);
    if (Array.isArray(rows)) db.mergeLocal(POS_CHECKOUT_TABLE, rows);
    return db.getOne(POS_CHECKOUT_TABLE, wanted) || null;
  } catch {
    return null;
  }
}

/** What the register's list shows about one link. */
function posCheckoutLinkRow(row, req = null) {
  return {
    token: row.id,
    status: posCheckoutStatus(row),
    status_label: posCheckoutStatusLabel(row),
    customer_name: row.customer_name || '',
    customer_phone: row.customer_phone || '',
    items_label: checkoutItemsLabel(row),
    total: Number(row.total) || 0,
    participants: (row.participants || []).map((participant) => participant.name).filter(Boolean),
    sale_id: row.sale_id || null,
    documents_signed_at: row.documents_signed_at || null,
    paid_at: row.paid_at || null,
    expires_at: row.expires_at || null,
    created_by: row.created_by || null,
    created_at: row.created_at || null,
    page_url: req ? checkoutLinkPageUrl(req, row.id) : null,
  };
}

/**
 * The register asks for this when a sale is refused for missing documents. The
 * cart travels into the link exactly as priced, and nothing is charged or even
 * recorded as a sale until the customer has signed on their own page.
 */
app.post('/api/pos/documents-link', async (req, res) => {
  try {
    const {
      cart = [],
      studentId,
      parentId,
      walkInName,
      walkInPhone,
      walkInEmail,
      sendWhatsapp = true,
      couponCode,
    } = req.body || {};

    const lines = mapCartLines(cart);
    if (!lines.length) return res.status(400).json({ error: 'העגלה ריקה' });
    const seller = posSellerForRequest(req);
    if (!wallAccessLines(lines).length) {
      return res.status(400).json({
        error: 'הקישור נועד למוצרים שמקנים טיפוס בקיר — בעגלה הזאת אין כאלה',
      });
    }
    const { student, parent } = resolvePosCustomer({
      studentId,
      parentId,
      walkInName,
      walkInPhone,
      walkInEmail,
    });
    if (!student?.id || !parent?.id) {
      return res.status(400).json({ error: 'קישור להשלמת מסמכים דורש בחירת מתאמן מתיק משפחה' });
    }
    if (!parent.phone) {
      return res.status(400).json({ error: 'חסר טלפון ללקוח — אי אפשר לשלוח את הקישור' });
    }

    const { lines: resolvedLines, gaps } = await resolveWallAccessSale(lines, { student, parent });
    if (!gaps.length) {
      return res.status(400).json({
        error: 'לכל המשתתפים יש מסמכים בתוקף — אפשר לגבות רגיל',
        code: 'no_documents_missing',
      });
    }
    // A medical hold is a decision someone made about this climber. Signing a
    // fresh declaration does not lift it, so a link would only send them to
    // fill a form that still ends in a refusal.
    if (gaps.some((gap) => gap.blocked)) {
      return res.status(409).json({
        error: 'קיימת חסימה רפואית — הצהרה חדשה אינה מסירה אותה. יש לפנות למנהל.',
        code: 'health_hold',
      });
    }

    const total = computeSaleTotal(resolvedLines);
    if (!(Number(total) > 0)) {
      return res.status(400).json({ error: 'לא ניתן לשלוח קישור תשלום לסכום 0' });
    }

    const token = newPosCheckoutToken();
    const link = db.insert(POS_CHECKOUT_TABLE, buildPosCheckoutLink({
      token,
      lines: resolvedLines,
      total,
      parentId: parent.id,
      studentId: student.id,
      customerName: parent.name || student.name || 'לקוח',
      customerPhone: parent.phone || '',
      customerEmail: parent.email || '',
      couponCode: couponCode || null,
      gaps,
      createdBy: seller.name,
    }));
    const persisted = await persistCore(POS_CHECKOUT_TABLE, link);
    if (persisted && persisted.ok === false) {
      return res.status(503).json({ error: 'שמירת הקישור נכשלה — נסו שוב' });
    }

    const pageUrl = checkoutLinkPageUrl(req, token);
    const names = gaps.map((gap) => gap.name).filter(Boolean).join(', ');
    let whatsappSent = false;
    let whatsappError = null;
    if (sendWhatsapp) {
      const message =
        `שלום ${parent.name || ''},\n` +
        `כדי להשלים את הרכישה (${checkoutItemsLabel(link)}) נדרשת הצהרת בריאות ואישור טיפוס בקיר עבור ${names}.\n\n` +
        `${pageUrl}\n\n` +
        `בקישור ממלאים וחותמים, ובסוף עוברים לתשלום של ₪${total}. הכרטיסייה נכנסת לתיק מיד עם אישור התשלום.`;
      try {
        const sent = await whatsappService.sendTextMessage(normalizePhone(parent.phone), message, false, {
          parentId: parent.id,
          fallbackName: parent.name,
        });
        whatsappSent = !!sent?.success;
        if (!whatsappSent) whatsappError = sent?.error || 'שליחת ההודעה נכשלה';
      } catch (waErr) {
        whatsappError = waErr.message || 'שליחת ההודעה נכשלה';
      }
      if (!whatsappSent && !whatsappError) {
        whatsappError = 'חלון 24 השעות סגור — העתיקו את הקישור ושלחו ידנית';
      }
    }

    console.log(`📝 [POS] documents link created: id=${link.id} participants=${gaps.length} total=${total}`);
    res.status(201).json({
      link: posCheckoutLinkRow(link, req),
      pageUrl,
      whatsappSent,
      whatsappError,
      gaps: gaps.map((gap) => ({ ...gap, text: gapText(gap) })),
    });
  } catch (err) {
    console.error('POS documents-link error:', err.message);
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

/** The register's own list — this is where a payment on a link becomes visible. */
app.get('/api/pos/checkout-links', async (req, res) => {
  try {
    const rows = (await readTable(POS_CHECKOUT_TABLE))
      .map((row) => posCheckoutLinkRow(row, req))
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    const openOnly = String(req.query.open || '') === '1';
    res.json(openOnly ? rows.filter((row) => row.status !== 'paid' && row.status !== 'cancelled') : rows);
  } catch (err) {
    console.error('POS checkout-links error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pos/checkout-links/:token/cancel', async (req, res) => {
  try {
    const link = await resolvePosCheckoutLink(req.params.token);
    if (!link) return res.status(404).json({ error: 'הקישור לא נמצא' });
    if (link.status === POS_CHECKOUT_STATUS.PAID) {
      return res.status(400).json({ error: 'הקישור כבר שולם' });
    }
    const cancelled = db.update(POS_CHECKOUT_TABLE, link.id, {
      status: POS_CHECKOUT_STATUS.CANCELLED,
      updated_at: new Date().toISOString(),
    }) || link;
    await persistCore(POS_CHECKOUT_TABLE, cancelled);
    res.json(posCheckoutLinkRow(cancelled, req));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health Declarations endpoints
//
// The signature image and the form snapshot are 90% of this feed's weight — a
// megabyte of them — and only the PDF builder ever opens either one. Everything
// that asks "is this climber signed, for which activity, until when" reads the
// other twenty fields, so `?summary=1` leaves the two heavy ones behind and the
// PDF paths pull the one record they need from the route below.
const HEAVY_DECLARATION_FIELDS = ['signature_url', 'signatureUrl', 'formSnapshot', 'form_snapshot'];

function declarationSummary(row) {
  const light = { ...row };
  for (const field of HEAVY_DECLARATION_FIELDS) delete light[field];
  return light;
}

app.get('/api/health-declarations', (req, res) => {
  const rows = db.get('health_declarations') || [];
  if (String(req.query.summary || '') === '1') {
    return res.json(rows.map(declarationSummary));
  }
  res.json(rows);
});

// One full declaration, signature and snapshot included, for building its PDF.
app.get('/api/health-declarations/:declarationId', (req, res) => {
  const row = (db.get('health_declarations') || [])
    .find((decl) => String(decl.id) === String(req.params.declarationId));
  if (!row) return res.status(404).json({ error: 'ההצהרה לא נמצאה' });
  res.json(row);
});

app.post('/api/health-declarations', async (req, res) => {
  try {
    const record = db.insert('health_declarations', normalizeManualDeclaration(req.body, {
      actor: req.crmUser?.email || req.crmUser?.id || '',
      today: israelDateStr(),
    }));
    const durable = await persistCore('health_declarations', record);
    if (durable?.ok === false) {
      return res.status(503).json({ error: durable.error || 'שמירת ההצהרה נכשלה' });
    }
    res.status(201).json(record);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// ─── Form templates (health + liability pages by activity) ───────────────────
const DEFAULT_HEALTH_QUESTIONS = CANONICAL_HEALTH_QUESTIONS.map((question) => ({ ...question }));

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

function formTemplateForClient(template) {
  if (!template) return null;
  const resolved = resolveDeclarationTemplate(db, {
    templateId: template.id,
    templateSlug: template.slug,
  });
  return { ...template, ...resolved };
}

/**
 * Slugs that links already carry, pointing at the template that replaced them.
 *
 * The birthday declaration turned out to be the declaration for any activity at
 * the wall — a company day and a school group sign the same risks — so it was
 * rewritten as one form. The old address keeps working: it was sent out over
 * WhatsApp, and a link that 404s is a family that cannot register.
 */
const FORM_TEMPLATE_SLUG_ALIASES = { birthday: 'wall', event: 'wall' };

function findFormTemplateBySlug(slug) {
  const rawKey = slugifyFormTemplate(slug);
  const key = FORM_TEMPLATE_SLUG_ALIASES[rawKey] || rawKey;
  if (!key) return null;
  const templates = listFormTemplates();
  const active = (s) => templates.find((t) => t.slug === s && t.isActive !== false) || null;
  return active(key);
}

function findDefaultFormTemplate() {
  const all = listFormTemplates().filter((t) => (
    t.isActive !== false
    && !['event', 'birthday'].includes(String(t.slug || '').toLowerCase())
  ));
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
    .map((t) => normalizeParticipationScope(t))
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
  const rawSlug = slugifyFormTemplate(body.slug || existing?.slug || body.title || `form-${Date.now()}`);
  const slug = FORM_TEMPLATE_SLUG_ALIASES[rawSlug] || rawSlug;
  if (!slug) return { error: 'חסר מזהה קישור (slug)' };
  const healthQuestions = Array.isArray(body.healthQuestions)
    ? body.healthQuestions
    : (Array.isArray(body.health_questions) ? body.health_questions : (existing?.healthQuestions || DEFAULT_HEALTH_QUESTIONS));
  const activityTypes = normalizeTemplateActivityTypes(body, existing);
  const normalizedQuestions = healthQuestions.map((q, i) => {
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
  }).filter((q) => q.label);
  const scopedConfirmations = normalizedQuestions.filter((question) => {
    if (isScreeningQuestion(question)) return false;
    if (/^m\d+$/i.test(String(question.id || ''))) return false;
    // The oldest templates stored three medical questions as q1-q3 without a
    // kind marker. They are questions, not legal confirmations.
    if (/^q\d+$/i.test(String(question.id || '')) && /^האם\b/.test(question.label)) return false;
    return true;
  });
  return {
    slug,
    title: (body.title ?? existing?.title ?? '').trim() || 'הצהרת בריאות',
    activityTypes,
    // Kept in step with the first entry, for anything still reading one value.
    activityType: activityTypes[0] || 'wall',
    waiverText: body.waiverText ?? body.waiver_text ?? existing?.waiverText ?? '',
    // The plain-language layer shown in front of the legal text.
    waiverSummary: body.waiverSummary ?? body.waiver_summary ?? existing?.waiverSummary ?? '',
    // What the activity is, above the name of the document being signed. The
    // cover picture is stored as a URL by the caller before this runs.
    headline: String(body.headline ?? existing?.headline ?? '').trim(),
    coverImage: String(body.coverImage ?? body.cover_image ?? existing?.coverImage ?? '').trim(),
    // הטקסט שנקרא לפני כללי הבטיחות. ריק — הטופס נופל לנוסח שבקוד.
    activityNature: String(body.activityNature ?? body.activity_nature ?? existing?.activityNature ?? '').trim(),
    // `kind` and `requireYes` used to be dropped here, so saving a template
    // from the CRM screen turned every mandatory clause into an optional one
    // and every screening question into a tick box. `audience` and
    // `requiresClearance` were being dropped the same way, which quietly
    // deleted the parent-only clauses and the doctor's-approval rule the first
    // time anyone edited a declaration — the wording survived, the rules did not.
    healthQuestions: [
      ...CANONICAL_HEALTH_QUESTIONS.map((question) => ({ ...question })),
      ...scopedConfirmations,
    ],
    isDefault: body.isDefault === true || body.isDefault === 'true' || body.is_default === true,
    isActive: body.isActive !== false && body.is_active !== false,
  };
}

app.get('/api/form-templates', (req, res) => {
  res.json(listFormTemplates()
    .filter((template) => !['event', 'birthday'].includes(String(template.slug || '').toLowerCase()))
    .map(formTemplateForClient));
});

app.post('/api/form-templates', async (req, res) => {
  const body = { ...(req.body || {}) };
  // התמונה מגיעה כ-data URI מהדפדפן ונשמרת כקובץ, כמו תמונות הקטלוג: שורה
  // שנושאת תמונה בתוכה נקראת מחדש בכל טעינה של הטופס.
  body.coverImage = await storeImageValue(body.coverImage ?? body.cover_image ?? '', 'form-covers');
  const normalized = normalizeFormTemplatePayload(body);
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

app.put('/api/form-templates/:id', async (req, res) => {
  const existing = listFormTemplates().find((t) => t.id === req.params.id);
  if (!existing) return res.status(404).json({ error: 'התבנית לא נמצאה' });

  const body = { ...(req.body || {}) };
  if (body.coverImage !== undefined || body.cover_image !== undefined) {
    body.coverImage = await storeImageValue(body.coverImage ?? body.cover_image ?? '', 'form-covers');
  }
  const normalized = normalizeFormTemplatePayload(body, existing);
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
app.get('/api/public/form-templates/:slug', publicFormRateLimit, (req, res) => {
  const slugParam = req.params.slug;
  const template = slugParam === 'default'
    ? findDefaultFormTemplate()
    : (findFormTemplateBySlug(slugParam) || (slugParam === 'wall' ? findDefaultFormTemplate() : null));
  if (!template) return res.status(404).json({ error: 'הטופס לא נמצא' });
  res.json(formTemplateForClient(template));
});

// Check-in endpoints
app.get('/api/check-ins', (req, res) => {
  const rows = db.get('check_ins') || [];
  if (req.crmUser?.role !== 'staff') return res.json(rows);
  const today = israelDateStr();
  return res.json(rows.filter((row) => {
    const timestamp = row.timestamp || row.created_at;
    return timestamp && israelLocalParts(timestamp)?.date === today;
  }));
});

app.put('/api/safety/inspections/:id', (req, res) => {
  const existing = db.getOne('safety_inspections', req.params.id);
  if (!existing) return res.status(404).json({ error: 'בדיקת הבטיחות לא נמצאה' });
  const updated = db.update('safety_inspections', req.params.id, {
    ...(req.body || {}),
    id: existing.id,
    updated_at: new Date().toISOString(),
  });
  res.json(activityForRequest(req, updated));
});

app.patch('/api/safety/inspections/:id', (req, res) => {
  const existing = db.getOne('safety_inspections', req.params.id);
  if (!existing) return res.status(404).json({ error: 'בדיקת הבטיחות לא נמצאה' });
  const updated = db.update('safety_inspections', req.params.id, {
    ...(req.body || {}),
    id: existing.id,
    updated_at: new Date().toISOString(),
  });
  res.json(activityForRequest(req, updated));
});

/** The documents verdict for one climber — the same rule that gates a punch. */
function wallDocumentsFor(studentId) {
  return wallDocumentsStatus({
    student: studentId ? db.getOne('students', studentId) : null,
    students: db.get('students') || [],
    parents: db.get('parents') || [],
    declarations: db.get('health_declarations') || [],
    waivers: db.get('participation_waivers') || [],
    healthHolds: db.get('health_holds') || [],
  });
}

app.get('/api/students/:id/wall-documents', (req, res) => {
  res.json(wallDocumentsFor(req.params.id));
});

/**
 * כל מה שהדלפק צריך לדעת על מתאמן שעומד מולו, בקריאה אחת.
 *
 * המסך שאל קודם בנפרד על כרטיסיות ועל מסמכים, וצייר את התשובה לפני שהשנייה
 * הגיעה. כאן הכול נחתך מאותו רגע: הכרטיסייה שתנוקב, הסיבה שאולי לא תנוקב,
 * מבחן האבטחה, ומתי המתאמן היה כאן בפעם האחרונה.
 */
app.get('/api/checkin/climber/:id', async (req, res) => {
  const studentId = req.params.id;
  const student = db.getOne('students', studentId);
  if (!student) return res.status(404).json({ error: 'המתאמן לא נמצא' });

  const passes = (db.get('customer_passes') || []).filter((pass) => (
    isPassUsable(pass) && (
      String(pass.student_id) === String(studentId)
      || (pass.transferable === true)
      || (pass.family_shared === true
        && pass.shared_household_id
        && isStudentInHousehold(db, pass.shared_household_id, studentId))
    )
  ));
  const mine = passes.filter((pass) => String(pass.student_id) === String(studentId));
  const tests = testsForStudent(student, db.get('level_tests') || []);

  let attendance = [];
  try {
    await readTable('attendance');
    attendance = (db.get('attendance') || []).filter(
      (row) => String(row.student_id) === String(studentId)
    );
  } catch (err) {
    // היסטוריית החוגים היא הקשר, לא שער. אם היא לא נטענה — הכניסה נמשכת.
    console.warn('last visit attendance read failed:', err.message);
  }
  const visit = lastVisit({
    checkIns: db.get('check_ins') || [],
    attendance,
    studentId,
  });

  // ההורה האחראי — מי שקישור החתימה והתשלום נשלח אליו. הדלפק צריך לראות למי
  // הוא שולח לפני שהוא לוחץ, ולא לגלות אחר כך שהמספר לא היה שם.
  const recipient = chooseRecipientParent(db.get('parents') || [], {
    guardianIds: guardianParentIds(db, student),
    primaryParentId: student.parentId,
  });

  res.json({
    student: { id: student.id, name: student.name, groupId: student.groupId || null },
    parent: recipient
      ? { id: recipient.id, name: recipient.name || '', phone: recipient.phone || '' }
      : null,
    passes: mine,
    // כרטיסיות מועברות של אחרים שאפשר לנקב עבור המתאמן הזה (חבר שמשלם עליו).
    guest_passes: passes.filter((pass) => String(pass.student_id) !== String(studentId)),
    best_punch: pickBestPunchCard(mine),
    membership: mine.find((pass) => pass.pass_type === PRODUCT_TYPES.TIME_MEMBERSHIP) || null,
    documents: wallDocumentsFor(studentId),
    punch_block_reason: passPunchBlockReason({
      student,
      students: db.get('students') || [],
      parents: db.get('parents') || [],
      declarations: db.get('health_declarations') || [],
      waivers: db.get('participation_waivers') || [],
      healthHolds: db.get('health_holds') || [],
    }),
    safety: safetyTestStatus(tests),
    safety_note: passPunchSafetyNote({ student, tests }),
    last_visit: { ...visit, label: lastVisitLabel(visit) },
  });
});

/**
 * שליחת טופס ההרשמה למי שאינו במערכת, בלי לפתוח לו תיק.
 *
 * הכפתור בדלפק פתח קודם וואטסאפ עם הקישור מוכן וחיכה שהדלפקיסט ילחץ שלח —
 * צעד נוסף בדיוק ברגע שבו מישהו עומד וממתין. התבנית המאושרת נשלחת מהשרת
 * ומגיעה גם מחוץ לחלון 24 השעות, והקישור שבה מוביל לטופס לפי טלפון.
 */
app.post('/api/checkin/send-form-to-phone', async (req, res) => {
  const rawPhone = String(req.body?.phone || '').trim();
  const digits = rawPhone.replace(/\D/g, '');
  const linkOnly = req.body?.linkOnly === true;
  // קוד לסריקה נוצר גם בלי מספר: הלקוח עומד מול הדלפק ומצלם מהמסך.
  if (!linkOnly && digits.length < 9) return res.status(400).json({ error: 'מספר טלפון לא תקין' });
  const name = String(req.body?.name || '').trim() || 'לקוח';

  try {
    ensureParticipationFormWhatsappTemplate({ db, persist: persistCore });
  } catch (err) {
    console.warn('participation form template ensure skipped:', err.message);
  }

  const origin = resolvePublicAppOrigin(req.body?.origin);
  const formTemplate = findDefaultFormTemplate();
  const link = digits.length >= 9
    ? buildShareableHealthUrl(origin, { phone: digits, source: CASH_REGISTER_FORM_SOURCE })
    : buildShareableHealthUrl(origin, { source: CASH_REGISTER_FORM_SOURCE });
  const approved = findApprovedParticipationFormTemplate(db);

  // אין למי לשלוח, ושליחה שקורית בכל זאת מגיעה כהודעה שאיש לא ביקש.
  if (linkOnly) return res.json({ sent: false, link, linkOnly: true });

  if (approved?.meta_name) {
    try {
      const result = await whatsappService.sendTemplateMessage(
        digits,
        approved.meta_name,
        [name, name],
        {
          buttonUrlParam: `p:${digits}`,
          source: 'participation_form',
        }
      );
      if (result?.success) return res.json({ sent: true, via: 'template', link });
      return res.json({ sent: false, link, warning: result?.error || 'שליחת התבנית נכשלה' });
    } catch (err) {
      return res.json({ sent: false, link, warning: err.message });
    }
  }
  res.json({
    sent: false,
    link,
    templateSlug: formTemplate?.slug || null,
    warning: `התבנית «${PARTICIPATION_FORM_TEMPLATE}» אינה מאושרת — אי אפשר לשלוח למי שלא כתב לנו קודם`,
  });
});

/**
 * טבלת „ממתינים לטיפול” של הדלפק: מבחני אבטחה חסרים וקישורי תשלום פתוחים.
 *
 * הכללים עצמם ב-`pendingHandling.js`; כאן רק אספקת הנתונים.
 */
app.get('/api/checkin/pending', async (req, res) => {
  const today = israelDateStr();
  // The counter is a live operational view. Await these small durable tables so
  // a sale handled by another server instance is visible on this very request.
  const [checkIns, sales, punches, payments] = await readTablesFresh(
    'check_ins',
    'pos_sales',
    'pass_punches',
    'payments'
  );
  const tests = db.get('level_tests') || [];
  const opener = wallShiftOpener(db.get('shift_hours') || []);
  res.json(buildCounterQueues({
    checkIns,
    sales,
    punches,
    payments,
    today,
    shiftStartedAt: opener?.clock_in || null,
    dateOf: (iso) => israelLocalParts(iso)?.date || null,
    studentOf: (id) => db.getOne('students', id),
    parentOf: (id) => db.getOne('parents', id),
    safetyOf: (id) => {
      const student = db.getOne('students', id);
      return student ? safetyTestStatus(testsForStudent(student, tests)) : null;
    },
    dismissedIds: (db.get('checkin_dismissals') || [])
      .filter((row) => row.date === today)
      .map((row) => row.row_id),
  }));
});

/**
 * הסרה ידנית של שורה מהרשימה.
 *
 * לפעמים האדם הלך, ולפעמים הצוות יודע משהו שהמערכת לא. ההסרה תקפה ליום אחד
 * — למחרת הרשימה נבנית מחדש ממילא — והיא נרשמת עם מי שביצע אותה, כדי שאפשר
 * יהיה לדעת מי הסיר שורה שהייתה צריכה להישאר.
 */
app.post('/api/checkin/pending/dismiss', async (req, res) => {
  const rowId = String(req.body?.row_id || '').trim();
  if (!rowId) return res.status(400).json({ error: 'row_id is required' });
  const employeeId = req.body?.employee_id || null;
  const employee = employeeId ? (db.get('employees') || []).find((e) => e.id === employeeId) : null;
  const record = db.insert('checkin_dismissals', {
    row_id: rowId,
    date: israelDateStr(),
    dismissed_by_employee_id: employee?.id || null,
    dismissed_by_name: employee?.name || null,
    reason: String(req.body?.reason || '').trim() || null,
  });
  await persistCore('checkin_dismissals', record);
  res.status(201).json({ ok: true, dismissal: record });
});

/**
 * „ראיתי שהתשלום עבר” — הלחיצה שמסירה שורת תשלום מהטבלה.
 *
 * מותרת רק אחרי שהכסף נכנס: שורה שממתינה לתשלום שנעלמת בלחיצה היא בדיוק
 * המקרה שבו מתאמן נכנס לקיר בלי ששילם.
 */
app.post('/api/checkin/pending/payment/:saleId/handled', async (req, res) => {
  const sale = db.getOne('pos_sales', req.params.saleId);
  if (!sale) return res.status(404).json({ error: 'המכירה לא נמצאה' });
  if (sale.status !== 'paid') {
    return res.status(409).json({
      error: 'הקישור עוד לא שולם — אי אפשר להסיר מהרשימה',
      code: 'NOT_PAID',
    });
  }
  const employeeId = req.body?.employee_id || null;
  const employee = employeeId ? (db.get('employees') || []).find((e) => e.id === employeeId) : null;
  if (employeeId && !employee) return res.status(404).json({ error: 'העובד לא נמצא' });
  const updated = db.update('pos_sales', sale.id, {
    handled_at: new Date().toISOString(),
    handled_by_employee_id: employee?.id || null,
    handled_by_name: employee?.name || null,
    updated_at: new Date().toISOString(),
  });
  if (updated) await persistCore('pos_sales', updated);
  res.json({ ok: true, sale: updated });
});

app.post('/api/check-ins', async (req, res) => {
  // Decided here, never taken from the screen: the counter used to compute it
  // with a looser rule of its own, so the day's log could show a green "תקין"
  // beside someone whose pass had just been refused.
  const student = db.getOne('students', req.body?.climber_id);
  if (!student) return res.status(404).json({ error: 'המתאמן לא נמצא' });
  const group = student.groupId ? db.getOne('groups', student.groupId) : null;
  const documents = wallDocumentsFor(student.id);
  const record = db.insert('check_ins', secureCheckInRecord({ student, group, documents }));
  const persisted = await persistCore('check_ins', record);
  if (persisted?.ok === false) {
    return res.status(503).json({ error: 'שמירת הכניסה נכשלה', code: 'CHECK_IN_NOT_DURABLE' });
  }
  res.status(201).json(record);
});

function normPhone(p) {
  let d = String(p || '').replace(/[^\d]/g, '');
  if (d.startsWith('0') && d.length >= 9) d = `972${d.slice(1)}`;
  return d;
}

function requireVerifiedPublicPhone(req, res, rawPhone, { allowConsumed = false } = {}) {
  const phone = normPhone(rawPhone);
  const token = String(
    req.body?.phoneVerification?.token
      || req.get('x-phone-verification')
      || req.query?.verificationToken
      || req.query?.verification_token
      || ''
  ).trim();
  const valid = allowConsumed
    ? otpService.checkAttachmentToken(token, phone)
    : otpService.checkToken(token, phone);
  if (!phone || !token || !valid) {
    res.status(403).json({
      error: 'אימות הטלפון פג או לא בוצע — בקשו קוד חדש ונסו שוב',
    });
    return null;
  }
  return {
    phone,
    token,
    evidence: otpService.tokenEvidence(token, phone, { allowSpent: allowConsumed }),
  };
}

function verifiedPhoneEvidence(verified) {
  return verified ? {
    verified: true,
    method: 'whatsapp_code',
    phone: verified.phone,
    at: verified.evidence?.verifiedAt || new Date().toISOString(),
    challengeId: verified.evidence?.challengeId || null,
    issuedAt: verified.evidence?.issuedAt || null,
    deliveredAt: verified.evidence?.deliveredAt || null,
    providerMessageId: verified.evidence?.providerMessageId || null,
    verificationAttempts: verified.evidence?.verificationAttempts || null,
    tokenFingerprint: verified.evidence?.tokenFingerprint || null,
  } : null;
}

/**
 * Public identity is a pair: an ID supplied by the person and possession of
 * the phone proven by OTP. A conflict is never interpreted as a new family.
 */
function requirePublicIdentityPair(req, res, verified, parentInput = {}) {
  const idNumber = String(parentInput.idNumber || parentInput.parentIdNum || '').trim();
  if (normalizedIdNumber(idNumber).length < 5) {
    res.status(400).json({ error: 'נדרשת תעודת זהות של ממלא/ת הטופס' });
    return null;
  }
  const identity = resolvePublicIdentity(db.get('parents') || [], {
    phone: verified?.phone,
    idNumber,
  });
  if (identity.status === 'review_required') {
    res.status(409).json({
      error: 'הפרטים תואמים לרשומות שונות או אינם חד־משמעיים. לא נפתח תיק חדש; יש לפנות לצוות לבדיקה.',
      code: 'IDENTITY_REVIEW_REQUIRED',
      identity_status: 'review_required',
    });
    return null;
  }
  if (identity.status === 'incomplete') {
    res.status(400).json({ error: 'נדרשים תעודת זהות ומספר טלפון תקין' });
    return null;
  }
  return identity;
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
  const verified = requireVerifiedPublicPhone(req, res, phone);
  if (!verified) return;
  const identity = requirePublicIdentityPair(req, res, verified, { idNumber: parentIdNum });
  if (!identity) return;
  try {
    validateSignatureImage(signature, climberName);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }

  const sourceTemplate = templateId
    ? listFormTemplates().find((t) => t.id === templateId)
    : (templateSlug ? findFormTemplateBySlug(templateSlug) : findDefaultFormTemplate());
  const template = resolveDeclarationTemplate(db, {
    templateId: sourceTemplate?.id || templateId,
    templateSlug: sourceTemplate?.slug || templateSlug,
  });

  // 1. Upsert parent (phone de-dupe) and resolve / create student
  // The form asks for the surname separately; storing it keeps the household
  // matcher and the invoice off the last word of a free-text name.
  const parentLastName = String(req.body?.parentLastName || req.body?.lastName || '').trim();
  const parent = db.upsertParentByPhone(parentName, phone, '', {
    source: 'form',
    channel: 'form',
    lastName: parentLastName,
    idNumber: parentIdNum || '',
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
      status: statusAfterHealthSignature(prevStatus),
      parentId: student.parentId || parent.id,
      birthDate: birthDate || student.birthDate || '',
      name: cleanClimberName || student.name,
      healthSignedAt: signedAt,
      waiverSignedAt: signedAt,
    }) || student;
    // ההקשר נוסע עם האירוע: טופס קיר אינו הרשמה לחוג, ואישור הקבלה חייב
    // לדעת את ההבדל לפני שהוא מבטיח משהו.
    automationsService.triggerEvent('status_changed', {
      ...student,
      new_status: student.status,
      participation_scope: normalizeParticipationScope(template?.slug || templateSlug || 'wall'),
    });
  } else {
    // Keep the CRM student's id when the staff link included studentId but the
    // server cache was empty (common after Render restart before reload).
    student = db.insert('students', {
      id: studentId || undefined,
      name: cleanClimberName,
      parentId: parent.id,
      groupId: null,
      status: REGISTRATION_STATUS.DETAILS_COMPLETED,
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
    phoneVerification: verifiedPhoneEvidence(verified),
  });

  // 3. Await durable Supabase writes so the client file survives Render restarts
  const durable = await Promise.all([
    persistCore('parents', parent),
    persistCore('students', student),
    persistCore('health_declarations', record),
  ]);
  const failed = durable.find((r) => r && r.ok === false);
  otpService.consumeToken(verified.token, verified.phone);
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

// The operational list is what a customer must be on to be served at all —
// schedule changes, cancellations, reminders. Marketing is the other list, and
// it is never forced.
const REQUIRED_BROADCAST_LIST = OPERATIONAL_LIST;

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
  const verified = requireVerifiedPublicPhone(req, res, phone);
  if (!verified) return;

  const parent = findParentForOnboard({ phone: verified.phone });
  const household = parent ? expandHousehold(db, parent.id) : { students: [] };
  let student = studentId
    ? household.students.find((row) => String(row.id) === studentId) || null
    : null;

  if (!student && parent) {
    const kids = household.students;
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

function publicDeclarationSummary(eligibility) {
  const record = eligibility?.health?.record || null;
  const rawAnswers = record?.answers || record?.formSnapshot?.answers || {};
  const answers = {};
  // Read off the canonical list rather than counting m1..m9. The pregnancy
  // question is m11 — a number chosen deliberately, because m10 belonged to a
  // question that was removed — and a numeric loop would drop it from every
  // summary while looking like it covered everything.
  for (const { id } of CANONICAL_HEALTH_QUESTIONS) {
    const value = rawAnswers?.[id];
    if (typeof value === 'boolean') answers[id] = value;
    else if (['true', 'yes', 'כן', '1'].includes(String(value || '').trim().toLowerCase())) answers[id] = true;
    else if (['false', 'no', 'לא', '0'].includes(String(value || '').trim().toLowerCase())) answers[id] = false;
  }
  return {
    health: record
      ? {
          signedAt: eligibility.health.signed_at || '',
          expiresAt: eligibility.health.expires_at || record.expiresAt || '',
          answers,
          notes: String(record.healthNotes || record.formSnapshot?.healthNotes || '').trim(),
        }
      : null,
    waiver: eligibility?.waiver?.record
      ? {
          signedAt: eligibility.waiver.signed_at || '',
          expiresAt: eligibility.waiver.expires_at || eligibility.waiver.record.expiresAt || '',
        }
      : null,
  };
}

// Public onboarding context — prefill parent/children + mailing lists
app.get('/api/public/onboard-context', publicFormRateLimit, async (req, res) => {
  const parentId = String(req.query.parentId || '').trim();
  const studentId = String(req.query.studentId || '').trim();
  const phone = String(req.query.phone || '').trim();
  const idNumber = String(req.query.idNumber || '').trim();
  const cashRegisterForm = isCashRegisterFormSource(req.query.source);
  const contextRequiredList = cashRegisterForm ? '' : REQUIRED_BROADCAST_LIST;
  // Which declaration the visitor is about to fill. "Already signed" is only a
  // meaningful answer with respect to a particular form.
  const requestedSlug = String(req.query.templateSlug || req.query.template || '').trim().toLowerCase();
  const contextTemplate = requestedSlug
    ? (findFormTemplateBySlug(requestedSlug) || findDefaultFormTemplate())
    : findDefaultFormTemplate();
  const contextTemplateSlug = String(contextTemplate?.slug || 'wall').toLowerCase();
  const publicTemplate = resolveDeclarationTemplate(db, {
    templateId: contextTemplate?.id || null,
    templateSlug: contextTemplateSlug,
  });
  const hasPersonalLookup = !!(parentId || studentId || phone || idNumber);
  const verificationToken = String(
    req.get('x-phone-verification')
      || req.query.verificationToken
      || req.query.verification_token
      || ''
  ).trim();
  if (hasPersonalLookup && (!phone || !verificationToken || !otpService.checkToken(verificationToken, normPhone(phone)))) {
    const listDefs = db.getBroadcastListDefs();
    res.json({
      verification_required: true,
      identity_status: 'verification_required',
      parent: null,
      selfStudent: null,
      students: [],
      listDefs,
      subscriptions: Object.fromEntries(listDefs.map((list) => [list.key, list.key === contextRequiredList])),
      requiredListKey: contextRequiredList,
      interestOptions: INTEREST_OPTIONS,
      template: publicTemplate,
    });
    return;
  }

  // Fresh from the durable store. A long-lived process can still hold the
  // pre-signature student/declaration rows, and then a form signed yesterday
  // is shown as "expired" even though July 2028 is the real end of the cycle.
  if (supa.isEnabled()) {
    try {
      const [remoteParents, remoteStudents, remoteDecls, remoteWaivers, remoteHolds, remoteGuardians] = await Promise.all([
        supa.getAll('parents'),
        supa.getAll('students'),
        supa.getAll('health_declarations'),
        supa.getAll('participation_waivers'),
        supa.getAll('health_holds'),
        supa.getAll('student_guardians'),
      ]);
      if (remoteParents) db.set('parents', remoteParents);
      if (remoteStudents) db.set('students', remoteStudents);
      if (remoteDecls) db.set('health_declarations', remoteDecls);
      if (remoteWaivers) db.set('participation_waivers', remoteWaivers);
      if (remoteHolds) db.set('health_holds', remoteHolds);
      if (remoteGuardians) db.set('student_guardians', remoteGuardians);
    } catch (err) {
      console.error('onboard-context refresh failed:', err.message);
    }
  }

  const hintedParentId = parentId || (
    studentId
      ? String((db.get('students') || []).find((student) => String(student.id) === studentId)?.parentId || '')
      : ''
  );
  const identity = (phone || idNumber)
    ? resolvePublicIdentity(db.get('parents') || [], { phone, idNumber, hintedParentId })
    : { status: 'incomplete' };
  if (identity.status === 'review_required') {
    return res.status(409).json({
      error: 'הפרטים תואמים לרשומות שונות או אינם חד־משמעיים. לא נפתח תיק חדש; יש לפנות לצוות לבדיקה.',
      code: 'IDENTITY_REVIEW_REQUIRED',
      identity_status: 'review_required',
    });
  }
  const parent = identity.status === 'found' ? identity.parent : null;
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
  const isSamePersonAsParent = (student, candidateParent) => {
    if (!student || !candidateParent) return false;
    const parentId = normalizedIdNumber(candidateParent.idNumber);
    const studentId = normalizedIdNumber(student.idNumber);
    if (parentId && studentId) return parentId === studentId;
    return student.isAdult === true
      && normalizedChildName(candidateParent.name) === normalizedChildName(student.name);
  };
  const isParentThemselves = (student) => householdParents.some((p) => {
    return isSamePersonAsParent(student, p);
  });
  // The selected parent may also climb. Keep that adult card out of the
  // children list, but return it separately: its birth date and gender live on
  // the student record, not on the parent record, and the self-signing form
  // needs those values for its participant step.
  const selfStudent = parent
    ? household.students.find((s) => isSamePersonAsParent(s, parent)) || null
    : null;
  const students = parent ? household.students.filter((s) => !isParentThemselves(s)) : [];

  // Onboarding: classes is always on; other lists default off unless explicitly subscribed.
  const broadcastRows = db.get('broadcast_lists') || [];
  const subscriptions = {};
  for (const list of listDefs) {
    if (list.key === contextRequiredList) {
      subscriptions[list.key] = true;
      continue;
    }
    const record = parent
      ? broadcastRows.find((r) => r.parentId === parent.id && r.listName === list.key)
      : null;
    subscriptions[list.key] = record ? record.subscribed === true : false;
  }
  if (contextRequiredList) subscriptions[contextRequiredList] = true;

  // The same template the "already signed" answers above were judged against,
  // so the form and its verdicts can never be about two different documents.
  const template = publicTemplate;

  res.json({
    identity_status: identity.status === 'found' ? 'found' : (identity.status === 'new' ? 'new' : 'incomplete'),
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
          // בלעדיהם הטופס פותח בכל ביקור מחדש את "השלמת הפרטים" — למרות
          // שהכול כבר מולא. תאריך לידה של תיקים ישנים חי רק על כרטיס
          // המתאמן של ההורה, ולכן הנפילה אליו.
          gender: parent.gender || selfStudent?.gender || '',
          birthDate: parent.birthDate || selfStudent?.birthDate || '',
        }
      : null,
    selfStudent: selfStudent
      ? (() => {
          const eligibility = participationEligibility(db, {
            studentId: selfStudent.id,
            scope: normalizeParticipationScope(contextTemplateSlug),
          });
          return {
          id: selfStudent.id,
          name: selfStudent.name || '',
          birthDate: selfStudent.birthDate || '',
          gender: selfStudent.gender || '',
          idNumber: selfStudent.idNumber || '',
          healthValid: eligibility.eligible,
          healthDocumentValid: eligibility.health.state === 'valid',
          waiverValid: eligibility.waiver.state === 'valid',
          documentStatus: eligibility.status,
          healthSignedAt: eligibility.health.signed_at || '',
          waiverSignedAt: eligibility.waiver.signed_at || '',
          declarationSummary: publicDeclarationSummary(eligibility),
        };
      })()
      : null,
    students: students.map((s) => {
      // Whether this participant already has a declaration in force decides
      // whether the form asks them for one again, so the answer travels with
      // the card rather than being guessed from the status.
      // Scoped to the declaration this form is about, so a child covered for
      // the wall is still asked to sign before a trip.
      const eligibility = participationEligibility(db, {
        studentId: s.id,
        scope: normalizeParticipationScope(contextTemplateSlug),
      });
      return {
        id: s.id,
        name: s.name || '',
        lastName: s.lastName || '',
        birthDate: s.birthDate || '',
        gender: s.gender || '',
        idNumber: s.idNumber || '',
        status: s.status || '',
        interests: Array.isArray(s.interests) ? s.interests : [],
        notes: s.notes || '',
        // Compatibility: old clients read `healthValid` as "this whole form is
        // complete". New clients get the two independent facts as well.
        healthValid: eligibility.eligible,
        healthDocumentValid: eligibility.health.state === 'valid',
        waiverValid: eligibility.waiver.state === 'valid',
        documentStatus: eligibility.status,
        healthSignedAt: eligibility.health.signed_at || '',
        waiverSignedAt: eligibility.waiver.signed_at || '',
        declarationSummary: publicDeclarationSummary(eligibility),
      };
    }),
    listDefs,
    subscriptions,
    requiredListKey: contextRequiredList,
    // How many adults the household already holds: a second parent cannot be
    // added to a family that has two.
    householdParentCount: householdParents.length,
    interestOptions: INTEREST_OPTIONS,
    template: template
      ? {
          id: template.id,
          slug: template.slug,
          title: template.title,
          // מה הפעילות, ותמונה שלה — הכותרת לבדה אמרה רק על מה חותמים.
          headline: template.headline || '',
          coverImage: template.coverImage || '',
          // "אופי הפעילות והסיכונים" — בלעדיו המסך נופל לנוסח הקבוע בקוד
          // הקליינט, שכבר אינו הנוסח שבתבנית החיה.
          activityNature: template.activityNature || '',
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
const localTestOtpEnabled = process.env.NODE_ENV !== 'production'
  && process.env.LOCAL_TEST_OTP === '1';

function completeLocalTestOtp(phone, issued, res, reason) {
  console.warn(`otp local-test fallback: ${reason}`);
  otpService.markDelivered(phone, issued.challengeId, {
    providerMessageId: 'local_test',
    deliveredAt: new Date().toISOString(),
  });
  return res.json({ ok: true, devCode: issued.code, delivery: 'local_test' });
}

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
      console.error(`otp send failed for contact=${securityLogRef(phone)}`);
      if (localTestOtpEnabled) {
        return completeLocalTestOtp(phone, issued, res, 'WhatsApp provider rejected the test message');
      }
      return res.status(502).json({ error: 'שליחת הקוד בוואטסאפ נכשלה — בדקו את המספר ונסו שוב' });
    }
    const providerMessageId = result?.messageId
      || result?.id
      || result?.data?.messages?.[0]?.id
      || null;
    otpService.markDelivered(phone, issued.challengeId, {
      providerMessageId,
      deliveredAt: new Date().toISOString(),
    });
    // Local development without Meta credentials: the code cannot arrive on a
    // phone, so hand it back for testing. Never in production.
    const dev = result?.mock && process.env.NODE_ENV !== 'production'
      ? { devCode: issued.code }
      : {};
    res.json({ ok: true, ...dev });
  } catch (err) {
    console.error('otp send error:', err.message);
    if (localTestOtpEnabled) {
      return completeLocalTestOtp(phone, issued, res, 'WhatsApp provider was unavailable');
    }
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

app.post('/api/public/health-holds', publicFormRateLimit, async (req, res) => {
  try {
    const verified = requireVerifiedPublicPhone(req, res, req.body?.phone);
    if (!verified) return;
    const studentId = String(req.body?.studentId || req.body?.student_id || '').trim();
    const parent = findParentForOnboard({ phone: verified.phone });
    if (!parent || !studentId) return res.status(404).json({ error: 'תיק המשפחה או המשתתף לא נמצאו' });
    const household = expandHousehold(db, parent.id);
    if (!(household.students || []).some((student) => String(student.id) === studentId)) {
      return res.status(403).json({ error: 'אין הרשאה לעדכן את המשתתף הזה' });
    }
    const existing = (db.get('health_holds') || []).find((hold) => (
      String(hold.student_id || hold.studentId || '') === studentId
      && !hold.released_at
      && hold.status !== 'released'
    ));
    if (existing) return res.json({ hold: existing, duplicate: true });
    const now = new Date().toISOString();
    const hold = db.insert('health_holds', {
      id: `hh_${crypto.randomUUID()}`,
      student_id: studentId,
      created_by_parent_id: parent.id,
      reason: 'health_changed',
      status: 'active',
      released_at: null,
      released_by_declaration_id: null,
      created_at: now,
      updated_at: now,
    });
    await persistCore('health_holds', hold);
    res.status(201).json({ hold, duplicate: false });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'שמירת שינוי הבריאות נכשלה' });
  }
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

/**
 * Uploads every attached doctor's approval, or says why it could not.
 *
 * Done before anything is written: a signed declaration on file with the
 * approval missing is the one outcome this whole feature exists to prevent. An
 * orphan file in storage, if the save then fails, costs nothing.
 */
async function uploadClearanceFiles(participants = []) {
  const uploads = [];
  for (let participantIndex = 0; participantIndex < participants.length; participantIndex += 1) {
    const participant = participants[participantIndex];
    if (!participant?.medicalClearance) continue;
    const prepared = decodeClearanceUpload(participant.medicalClearance);
    if (prepared.error) {
      return { error: `${prepared.error} (${participant.name})`, status: 400 };
    }
    const storagePath = `medical-clearance/${Date.now()}_${crypto.randomUUID()}.${prepared.extension}`;
    let uploaded;
    try {
      uploaded = await supa.uploadClientDocument(storagePath, prepared.buffer, prepared.mimeType);
    } catch (err) {
      console.error('medical clearance upload error:', err.message);
      return { error: 'שמירת אישור הרופא נכשלה — נסו שוב', status: 503 };
    }
    if (!uploaded?.ok) {
      return { error: uploaded?.error || 'שמירת אישור הרופא נכשלה — נסו שוב', status: 503 };
    }
    uploads.push({
      clientDocumentId: `doc_${crypto.randomUUID()}`,
      participantIndex,
      name: participant.name,
      storagePath,
      fileName: prepared.fileName,
      mimeType: prepared.mimeType,
    });
  }
  return { uploads };
}

/**
 * Files the uploaded approvals in the personal file, alongside the signed
 * declaration, so the office sees why this registration was let through and can
 * open the approval itself.
 */
async function fileClearanceDocuments(uploads, { parentId, findTarget }) {
  const documents = [];
  for (const upload of uploads) {
    const target = findTarget(upload) || {};
    const doc = db.insert('client_documents', {
      id: upload.clientDocumentId,
      parentId: parentId || null,
      studentId: target.studentId || null,
      declarationId: target.declarationId || null,
      type: 'medical_clearance',
      fileName: upload.fileName,
      storagePath: upload.storagePath,
      mimeType: upload.mimeType,
    });
    const durableDoc = await persistCore('client_documents', doc);
    if (durableDoc?.ok === false) {
      console.error('medical clearance document persist failed:', durableDoc.error);
    }
    documents.push(doc);
  }
  return documents;
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
    completionRegistrationId,
    healthOnly: healthOnlyBody = false,
    mode = '',
    targetStudentId: targetStudentIdBody = '',
  } = req.body || {};
  const healthOnly = healthOnlyBody === true || String(mode).trim().toLowerCase() === 'health-renewal';
  const targetStudentId = String(targetStudentIdBody || '').trim();

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
  if (!healthOnly && !email) {
    return res.status(400).json({ error: 'נדרש אימייל' });
  }
  if (!healthOnly && !city) {
    return res.status(400).json({ error: 'נדרש מקום מגורים' });
  }

  // Checked before anything else is read or written. A declaration signed from
  // a phone that never answered a code is the document this gate exists to
  // prevent, and enforcing it only in the form leaves the route open to anyone
  // who skips the form — including the file uploads further down.
  const verified = requireVerifiedPublicPhone(req, res, phone);
  if (!verified) return;
  const identity = requirePublicIdentityPair(req, res, verified, {
    ...parentBody,
    idNumber: parentIdNum,
  });
  if (!identity) return;
  const otpToken = verified.token;
  const phoneVerification = verifiedPhoneEvidence(verified);

  if (healthOnly && identity.status !== 'found') {
    return res.status(403).json({ error: 'חידוש הצהרת בריאות אפשרי רק עבור משתתף קיים בתיק שאומת' });
  }
  if (healthOnly && completionRegistrationId) {
    return res.status(400).json({ error: 'קישור חידוש בריאות אינו קישור להשלמת הרשמה לפעילות' });
  }

  let completionRegistration = null;
  let completionOrder = null;
  if (completionRegistrationId) {
    completionRegistration = db.getOne('activity_registrations', completionRegistrationId);
    completionOrder = completionRegistration
      ? db.getOne('activity_registration_orders', completionRegistration.order_id)
      : null;
    const verifiedParent = identity.status === 'found' ? identity.parent : null;
    const verifiedHouseholdId = verifiedParent ? householdIdForParent(db, verifiedParent.id) : null;
    if (
      !completionRegistration
      || !completionOrder
      || !verifiedParent
      || !verifiedHouseholdId
      || String(verifiedHouseholdId) !== String(completionOrder.household_id || '')
    ) {
      return res.status(403).json({ error: 'קישור ההשלמה אינו שייך לתיק המשפחה שאומת' });
    }
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
        lastName: String(c.lastName || '').trim(),
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
        healthAccepted: c.healthAccepted === true || c.healthAccepted === 'true',
        waiverAccepted: c.waiverAccepted === true || c.waiverAccepted === 'true',
        signatureEvidenceTimeline: c.signatureEvidenceTimeline || c.signature_evidence_timeline || null,
        // Confirmed on the form as a child already on another parent's file.
        link_student_id: String(c.link_student_id || c.linkStudentId || '').trim() || null,
        reuse_health: c.reuse_health === true || c.reuseHealth === true,
        reuse_health_document: c.reuse_health_document === true || c.reuseHealthDocument === true,
        reuse_waiver: c.reuse_waiver === true || c.reuseWaiver === true,
      };
    })
    .filter((c) => c.name);

  if (!childList.length) {
    return res.status(400).json({ error: 'יש להוסיף לפחות משתתף/ת אחד' });
  }

  if (healthOnly) {
    const verifiedParent = identity.parent;
    const householdStudentIds = new Set(
      (expandHousehold(db, verifiedParent.id)?.students || []).map((student) => String(student.id))
    );
    if (
      !targetStudentId
      || childList.length !== 1
      || String(childList[0].id || '') !== targetStudentId
      || !householdStudentIds.has(targetStudentId)
    ) {
      return res.status(403).json({ error: 'קישור חידוש הבריאות אינו שייך למשתתף בתיק המשפחה שאומת' });
    }
    // The canonical card decides whether this is an adult signing for
    // themselves or a minor signed by their guardian; never trust the posted
    // type on a renewal link.
    const targetStudent = db.getOne('students', targetStudentId);
    childList[0].type = targetStudent?.isAdult === true ? 'adult' : 'child';
    childList[0].reuse_health = false;
    childList[0].reuse_health_document = false;
    childList[0].reuse_waiver = false;
    childList[0].waiverAccepted = false;
  }

  for (const child of childList) {
    if (child.type !== 'adult' && !child.birthDate) {
      return res.status(400).json({ error: `חסר תאריך לידה עבור ${child.name}` });
    }
    // A declaration already in force is not re-signed; saveCrmParticipants
    // verifies that claim against what was on file before this request.
    const reusesHealth = child.reuse_health || child.reuse_health_document;
    const reusesWaiver = healthOnly ? true : (child.reuse_health || child.reuse_waiver);
    if (reusesHealth && reusesWaiver) continue;
    if (healthOnly && !child.healthAccepted) {
      return res.status(400).json({ error: `חסר אישור הצהרת הבריאות עבור ${child.name}` });
    }
    if (((!healthOnly && !reusesWaiver && !child.waiverAccepted)) || !child.signature) {
      return res.status(400).json({
        error: healthOnly
          ? `חסרה חתימה על הצהרת הבריאות עבור ${child.name}`
          : `חסרה חתימה או אישור וויתור עבור ${child.name}`,
      });
    }
  }

  const sourceTemplate = templateId
    ? (db.get('form_templates') || []).find((t) => t.id === templateId)
    : (templateSlug ? findFormTemplateBySlug(templateSlug) : findDefaultFormTemplate());
  const template = resolveDeclarationTemplate(db, {
    templateId: sourceTemplate?.id || templateId,
    templateSlug: sourceTemplate?.slug || templateSlug,
  });

  for (const child of childList) {
    if (child.reuse_health || child.reuse_health_document) continue;
    const templateHealthQuestions = template?.medicalQuestions?.length
      ? template.medicalQuestions
      : (template?.healthQuestions || []).filter(isScreeningQuestion);
    const asked = questionsForSigner(
      healthOnly
        ? (templateHealthQuestions.length ? templateHealthQuestions : CANONICAL_HEALTH_QUESTIONS)
        : (template?.healthQuestions || []), {
      isAdultSelf: child.type === 'adult',
      isAdultFemale: signsAsAdultFemale(child),
      }
    );
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

  const clearance = await uploadClearanceFiles(childList);
  if (clearance.error) return res.status(clearance.status).json({ error: clearance.error });
  for (const upload of clearance.uploads) {
    const participant = childList[upload.participantIndex];
    if (participant) participant.medicalClearanceDocumentId = upload.clientDocumentId;
  }
  if (completionRegistration && !childList.some((child) => (
    String(child.id || '') === String(completionRegistration.student_id || '')
  ))) {
    return res.status(403).json({ error: 'קישור ההשלמה מיועד למשתתף אחר' });
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
      template,
      participationScope: normalizeParticipationScope(templateSlug || template?.slug || 'wall'),
      phoneVerification,
      evidenceContext: { requestContext: requestEvidence(req) },
      healthOnly,
      targetStudentId: String(req.body?.targetStudentId || req.body?.target_student_id || '').trim(),
      source: parentBody.source || 'form',
      onStudentStatusChanged: (student) => automationsService.triggerEvent('status_changed', {
        ...student,
        new_status: REGISTRATION_STATUS.DETAILS_COMPLETED,
      }),
    });
  } catch (err) {
    return res.status(err.status || 503).json({ error: err.message });
  }
  const parent = crmResult.parent;
  const declarations = crmResult.declarations;
  const waivers = crmResult.waivers;
  const savedStudents = crmResult.participants.map((participant) => participant.student);

  let completedRegistration = null;
  if (completionRegistration) {
    const target = crmResult.participants.find((participant) => (
      String(participant.student?.id || '') === String(completionRegistration.student_id || '')
    ));
    const activity = db.getOne('activities', completionRegistration.activity_id);
    const eligibility = target && activity
      ? participationEligibility(db, {
          studentId: target.student.id,
          scope: scopeForActivity(activity),
        })
      : null;
    if (!target || !eligibility?.eligible) {
      return res.status(409).json({ error: 'לא הושלמו כל המסמכים הנדרשים לפעילות' });
    }
    completedRegistration = db.update('activity_registrations', completionRegistration.id, {
      health_declaration_id: target.healthDeclaration?.id || completionRegistration.health_declaration_id || null,
      participation_waiver_id: target.waiver?.id || completionRegistration.participation_waiver_id || null,
      document_status: 'eligible',
      updated_at: new Date().toISOString(),
    }) || completionRegistration;
    await persistCore('activity_registrations', completedRegistration);
  }

  const clearanceDocuments = await fileClearanceDocuments(clearance.uploads, {
    parentId: parent?.id || null,
    findTarget: (upload) => {
      const index = childList.findIndex((child) => child.name === upload.name);
      const student = index >= 0 ? savedStudents[index] : null;
      return {
        studentId: student?.id || null,
        declarationId: declarations.find((d) => d.studentId === student?.id)?.id || null,
      };
    },
  });

  if (!healthOnly) for (let index = 0; index < savedStudents.length; index += 1) {
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

  let savedLists = typeof db.getParentBroadcastLists === 'function'
    ? db.getParentBroadcastLists(parent.id)
    : {};
  if (!healthOnly) {
    // Mailing lists — the classes list is forced only for someone who came here
    // to join a class, where schedule changes are part of the service. A trip
    // form is a different errand, and a medical renewal must not silently
    // change marketing preferences at all.
    const classSignup = !isCashRegisterFormSource(req.body?.source) && normalizeParticipationScope(
      req.body?.templateSlug || req.body?.template_slug || 'wall'
    ) !== 'trip';
    const listKeys = (db.getBroadcastListDefs() || []).map((l) => l.key);
    const nextSubs = {};
    for (const key of listKeys) {
      if (key === REQUIRED_BROADCAST_LIST && classSignup) {
        nextSubs[key] = true;
      } else {
        nextSubs[key] = subscriptions[key] === true || subscriptions[key] === 'true';
      }
    }
    savedLists = db.updateParentBroadcastLists(parent.id, nextSubs);
    // דגל ההסכמה הכללי נגזר מרשימות הנושא, באותו כלל כמו עמוד ההעדפות:
    // תיבת האישור בטופס סומנה — כל הנושאים פעילים; הוסרה — כולם כבויים.
    const topicOn = Object.entries(savedLists)
      .some(([key, value]) => key !== REQUIRED_BROADCAST_LIST && value !== false);
    const consentPatch = db.update('parents', parent.id, { marketing_opt_in: topicOn });
    if (consentPatch) {
      persistCore('parents', consentPatch).catch(() => {});
    }
    touchGoogleContacts();
  }

  // Spent only now, with the registration actually filed. Spending it up front
  // meant a submission refused for a missing birth date burned the
  // verification, and the correction came back "אימות הטלפון פג".
  otpService.consumeToken(otpToken, verified.phone);

  // In an active bot conversation the form confirmation and the placement
  // question are one short message. Sending the generic onboarding automation
  // first produced two confirmations seconds apart. If there is no active bot
  // conversation, keep the ordinary standalone confirmation.
  let botResumeResult = null;
  if (!healthOnly) {
    try {
      botResumeResult = await resumeConversationAfterForm({
        phone: parent?.phone || verified.phone,
        studentNames: savedStudents.map((student) => student?.name).filter(Boolean),
        whatsappService,
      });
    } catch (err) {
      console.error('bot resume after form failed:', err.message);
    }

    if (!botResumeResult?.sent) {
      const confirmation = formConfirmationPayload({
        parent,
        students: savedStudents,
        phone: verified.phone,
      });
      if (confirmation) await automationsService.triggerEvent('new_lead', confirmation);
    }
  }

  res.status(201).json({
    success: true,
    parent,
    students: savedStudents,
    declarations,
    waivers,
    signedDocuments: crmResult.participants.map((participant) => ({
      student: participant.student,
      health: participant.healthCreated ? participant.healthDeclaration : null,
      waiver: participant.waiverCreated ? participant.waiver : null,
    })),
    completedRegistration,
    subscriptions: savedLists,
    medicalClearances: clearanceDocuments,
    mode: healthOnly ? 'health-renewal' : 'full',
  });
});

// Upload signed PDF into personal file (Supabase Storage). Public submissions
// use their spent-but-unexpired OTP token; staff backfills use the authenticated
// CRM session on the non-public route below.
async function storeHealthDeclarationPdf(req, res, { publicUpload = true } = {}) {
  const { declarationId } = req.params;
  const { pdfBase64, fileName } = req.body || {};
  if (!pdfBase64 || typeof pdfBase64 !== 'string') {
    return res.status(400).json({ error: 'חסר קובץ PDF' });
  }

  const decl = (db.get('health_declarations') || []).find((d) => d.id === declarationId);
  if (!decl) return res.status(404).json({ error: 'הצהרה לא נמצאה' });
  const declSnapshot = decl.formSnapshot || decl.form_snapshot || {};
  const verified = publicUpload
    ? requireVerifiedPublicPhone(
        req,
        res,
        declSnapshot.signer?.phone || decl.phone,
        { allowConsumed: true }
      )
    : null;
  if (publicUpload && !verified) return;

  // One certificate per declaration. Opening the file (or a sibling's
  // onboarding) used to mint another copy every time, so the folder filled
  // with identical "קיר טיפוס" rows for a single signature.
  const already = (db.get('client_documents') || []).find(
    (d) => d.declarationId === declarationId
      && ['health_declaration_pdf', 'health_waiver_pdf'].includes(d.type)
  );
  if (already) {
    return res.json({ success: true, document: already, existing: true });
  }

  const validatedPdf = validateUploadedDocument(pdfBase64);
  if (validatedPdf.error || validatedPdf.ext !== 'pdf') {
    return res.status(400).json({ error: 'קובץ PDF לא תקין' });
  }
  const { buffer } = validatedPdf;
  const fileHash = sha256(buffer);

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

  const documentId = `doc_${crypto.randomUUID()}`;
  const pdfEvidence = createSignatureEvidenceEvent({
    eventType: 'pdf_attached',
    documentType: 'health_declaration_pdf',
    documentId,
    signer: declSnapshot.signer || {
      parentId: decl.parentId || null, name: decl.parentName || '', phone: decl.phone || '',
    },
    participant: declSnapshot.participant || {
      studentId: decl.studentId || null, name: decl.climberName || '',
    },
    signingCapacity: 'document_attachment',
    occurredAt: new Date().toISOString(),
    contentSnapshot: {
      sourceDocumentType: 'health_declaration',
      sourceDocumentId: decl.id,
      sourceEvidenceId: declSnapshot.evidence?.id || null,
      fileName: safeName,
      mimeType: 'application/pdf',
      fileHash,
    },
    phoneVerification: publicUpload
      ? verifiedPhoneEvidence(verified)
      : {
          verified: true,
          method: 'authenticated_staff_session',
          at: new Date().toISOString(),
          actorId: req.crmUser?.id || null,
          actorEmail: req.crmUser?.email || null,
          actorRole: req.crmUser?.role || null,
        },
    requestContext: requestEvidence(req),
    fileHash,
    priorEvidenceId: declSnapshot.evidence?.id || null,
  });
  const doc = db.insert('client_documents', {
    id: documentId,
    parentId: decl.parentId || null,
    studentId: decl.studentId || null,
    declarationId: decl.id,
    type: 'health_declaration_pdf',
    fileName: safeName,
    storagePath,
    mimeType: 'application/pdf',
    sha256: fileHash,
    evidenceId: pdfEvidence.id,
    sealedAt: pdfEvidence.occurred_at,
  });
  const persisted = await persistCore('client_documents', doc);
  if (persisted?.ok === false) return res.status(503).json({ error: persisted.error || 'שמירת המסמך נכשלה' });
  try {
    await appendSignatureEvidence(db, pdfEvidence);
  } catch (error) {
    console.error('health PDF evidence append failed:', error.message);
    return res.status(503).json({ error: 'שמירת חותמת הראיות של המסמך נכשלה' });
  }

  res.status(201).json({ success: true, document: doc });
}

app.post('/api/public/onboard/:declarationId/pdf', publicFormRateLimit, (req, res) => {
  storeHealthDeclarationPdf(req, res, { publicUpload: true }).catch((error) => {
    console.error('public health PDF route failed:', error.message);
    if (!res.headersSent) res.status(error.status || 500).json({ error: error.message || 'שמירת הקובץ נכשלה' });
  });
});

app.post('/api/health-declarations/:declarationId/pdf', (req, res) => {
  storeHealthDeclarationPdf(req, res, { publicUpload: false }).catch((error) => {
    console.error('staff health PDF route failed:', error.message);
    if (!res.headersSent) res.status(error.status || 500).json({ error: error.message || 'שמירת הקובץ נכשלה' });
  });
});

// The scoped participation approval is a different legal document and gets a
// different PDF/file row. It must never be inferred from the health PDF.
app.post('/api/public/onboard/waivers/:waiverId/pdf', publicFormRateLimit, async (req, res) => {
  const { waiverId } = req.params;
  const { pdfBase64, fileName } = req.body || {};
  if (!pdfBase64 || typeof pdfBase64 !== 'string') {
    return res.status(400).json({ error: 'חסר קובץ PDF' });
  }
  const waiver = (db.get('participation_waivers') || []).find((record) => record.id === waiverId);
  if (!waiver) return res.status(404).json({ error: 'אישור ההשתתפות לא נמצא' });
  const waiverSnapshot = waiver.form_snapshot || waiver.formSnapshot || {};
  const verified = requireVerifiedPublicPhone(
    req,
    res,
    waiverSnapshot.signer?.phone,
    { allowConsumed: true }
  );
  if (!verified) return;
  const already = (db.get('client_documents') || []).find((doc) => (
    String(doc.waiverId || doc.waiver_id || '') === waiverId
    && doc.type === 'participation_waiver_pdf'
  ));
  if (already) return res.json({ success: true, document: already, existing: true });

  const validatedPdf = validateUploadedDocument(pdfBase64);
  if (validatedPdf.error || validatedPdf.ext !== 'pdf') {
    return res.status(400).json({ error: 'קובץ PDF לא תקין' });
  }
  const { buffer } = validatedPdf;
  const fileHash = sha256(buffer);

  const studentId = waiver.student_id || waiver.studentId || null;
  const parentId = waiver.signer_parent_id || waiver.signerParentId || null;
  const scope = normalizeParticipationScope(waiver.scope || 'wall');
  const safeName = String(fileName || `participation-waiver_${scope}_${waiverId}.pdf`)
    .replace(/[^\w\u0590-\u05ff.\-]+/g, '_')
    .slice(0, 120);
  const storagePath = `${parentId || 'unknown'}/${studentId || 'unknown'}/${waiverId}_${Date.now()}.pdf`;
  let uploaded;
  try {
    uploaded = await supa.uploadClientDocument(storagePath, buffer, 'application/pdf');
  } catch (error) {
    console.error('public participation waiver pdf upload error:', error.message);
    return res.status(500).json({ error: 'שמירת הקובץ נכשלה' });
  }
  if (!uploaded?.ok) return res.status(500).json({ error: uploaded?.error || 'שמירת הקובץ נכשלה' });

  const documentId = `doc_${crypto.randomUUID()}`;
  const pdfEvidence = createSignatureEvidenceEvent({
    eventType: 'pdf_attached',
    documentType: 'participation_waiver_pdf',
    documentId,
    signer: waiverSnapshot.signer || { parentId, phone: '' },
    participant: waiverSnapshot.participant || { studentId, name: '' },
    signingCapacity: 'document_attachment',
    occurredAt: new Date().toISOString(),
    contentSnapshot: {
      sourceDocumentType: 'participation_waiver',
      sourceDocumentId: waiver.id,
      sourceEvidenceId: waiverSnapshot.evidence?.id || null,
      fileName: safeName,
      mimeType: 'application/pdf',
      fileHash,
    },
    phoneVerification: verifiedPhoneEvidence(verified),
    requestContext: requestEvidence(req),
    fileHash,
    priorEvidenceId: waiverSnapshot.evidence?.id || null,
  });
  const doc = db.insert('client_documents', {
    id: documentId,
    parentId,
    studentId,
    waiverId,
    type: 'participation_waiver_pdf',
    fileName: safeName,
    storagePath,
    mimeType: 'application/pdf',
    sha256: fileHash,
    evidenceId: pdfEvidence.id,
    sealedAt: pdfEvidence.occurred_at,
  });
  const persisted = await persistCore('client_documents', doc);
  if (persisted?.ok === false) return res.status(503).json({ error: persisted.error || 'שמירת המסמך נכשלה' });
  try {
    await appendSignatureEvidence(db, pdfEvidence);
  } catch (error) {
    console.error('waiver PDF evidence append failed:', error.message);
    return res.status(503).json({ error: 'שמירת חותמת הראיות של המסמך נכשלה' });
  }
  res.status(201).json({ success: true, document: doc });
});

// Staff: list documents in personal file
app.get('/api/students/:id/documents', async (req, res) => {
  const studentId = req.params.id;
  // Answered from memory, refreshed behind the answer. The durable re-read was
  // here so a cleanup elsewhere could not leave deleted copies looking present;
  // the refresh still happens, it just no longer holds the folder shut while it
  // runs. Every delete path in this file writes through to memory anyway.
  await readTable('client_documents');
  const docs = (db.get('client_documents') || [])
    .filter((d) => d.studentId === studentId)
    .slice()
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  res.json(docs);
});

// Participation approvals are legal records, separate from the global health
// declaration. The customer file needs their scope even when the PDF upload is
// still pending, so the UI reads the canonical rows rather than guessing from
// a file name or from a health declaration's template.
app.get('/api/students/:id/participation-waivers', async (req, res) => {
  const studentId = String(req.params.id || '');
  // Served from memory. This answer feeds the approval icons at the top of the
  // customer file, and downloading the whole table from the durable store first
  // — 700KB of signature images for two rows the desk actually wanted — is what
  // made those icons take seconds to turn green, and take them again on every
  // switch between siblings.
  await readTable('participation_waivers');
  const rows = (db.get('participation_waivers') || [])
    .filter((row) => String(row.student_id || row.studentId || '') === studentId)
    .map((row) => ({
      ...row,
      scope: normalizeParticipationScope(row.scope || 'wall'),
    }))
    .slice()
    .sort((a, b) => String(b.signed_at || b.signedAt || '').localeCompare(String(a.signed_at || a.signedAt || '')));
  res.json(rows);
});

// Staff export of the immutable evidence chain for a signed record or PDF.
app.get('/api/signature-evidence', async (req, res) => {
  if (supa.isEnabled()) {
    const remote = await supa.getAll('signature_evidence');
    if (remote) db.set('signature_evidence', remote);
  }
  const documentId = String(req.query.documentId || req.query.document_id || '').trim();
  const studentId = String(req.query.studentId || req.query.student_id || '').trim();
  const rows = (db.get('signature_evidence') || [])
    .filter((row) => !documentId || String(row.document_id || '') === documentId)
    .filter((row) => !studentId || String(row.student_id || '') === studentId)
    .slice()
    .sort((a, b) => String(a.occurred_at || '').localeCompare(String(b.occurred_at || '')));
  res.json({
    appendOnly: true,
    events: rows.map((row) => ({ ...row, seal_valid: verifySignatureEvidenceEvent(row) })),
  });
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

// Staff: remove a participation approval from the file — the approval row and
// the PDF stored under it. Deleting only the file is not enough: the approval
// would still stand, and the folder would draw the line again from it.
app.delete('/api/students/:id/participation-waiver', async (req, res) => {
  const studentId = String(req.params.id || '');
  const waiverId = String(req.query.waiverId || req.body?.waiverId || '').trim();
  if (!waiverId) return res.status(400).json({ error: 'חסר מזהה אישור השתתפות' });
  const waiver = (db.get('participation_waivers') || []).find((row) => (
    row.id === waiverId
    && String(row.student_id || row.studentId || '') === studentId
  ));
  if (!waiver) return res.status(404).json({ error: 'אישור ההשתתפות לא נמצא' });

  const docs = (db.get('client_documents') || []).filter((d) => (
    d.type === 'participation_waiver_pdf'
    && String(d.waiverId || d.waiver_id || '') === waiverId
  ));
  for (const doc of docs) {
    const removed = await removeClientDocumentRecord(doc);
    if (!removed.ok) {
      return res.status(409).json({ error: removed.error || 'מחיקת הקובץ נכשלה' });
    }
  }

  const removed = await db.deleteDurable('participation_waivers', waiverId);
  if (removed?.notFound) {
    const remote = await supa.remove('participation_waivers', waiverId);
    if (remote?.ok === false) {
      return res.status(409).json({ error: remote.error || 'מחיקת אישור ההשתתפות נכשלה' });
    }
  } else if (removed?.ok === false) {
    return res.status(409).json({ error: removed.error || 'מחיקת אישור ההשתתפות נכשלה' });
  }

  res.json({ success: true, removedDocuments: docs.length });
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
      status: ['health_signed', REGISTRATION_STATUS.DETAILS_COMPLETED].includes(student.status)
        ? REGISTRATION_STATUS.LEAD_NEW
        : student.status,
    }) || student;
    await persistCore('students', updated);
  }

  res.json({ success: true, student: updated, removedDocuments: docs.length });
});

app.get('/api/students/:id/activity-registrations', async (req, res) => {
  try {
    const studentId = String(req.params.id || '').trim();
    if (!studentId) return res.status(400).json({ error: 'חסר מזהה מתאמן' });
    // The CRM card can use the boot-hydrated snapshot; registration and
    // attendance writes keep it current. Full activity screens still perform
    // their durable refresh by default.
    if (supa.isEnabled() && req.query.cached !== '1') {
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
          // A refunded registration is stored as cancelled+refunded; the money
          // side is the part worth surfacing.
          status_label: registration.payment_status === 'refunded'
            ? statusLabels.refunded
            : statusLabels[registration.status] || registration.status || '',
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

function buildShareableHealthUrl(origin, {
  pathSlug = '', studentId = '', phone = '', mode = '', source = '',
} = {}) {
  const base = `${String(origin).replace(/\/$/, '')}/register${pathSlug || ''}`;
  const params = new URLSearchParams();
  // Prefer studentId alone — long phone digits at the end break WhatsApp link detection.
  if (studentId && !String(studentId).startsWith('parent:')) {
    params.set('studentId', studentId);
  } else if (phone) {
    params.set('phone', phone);
  }
  if (mode) params.set('mode', mode);
  if (source) params.set('source', source);
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

async function sendActivityRegistrationDocumentMessage({
  registration,
  activity,
  origin = PUBLIC_APP_FALLBACK,
  kind = 'manual',
} = {}) {
  const student = db.getOne('students', registration?.student_id);
  const recipient = student ? db.getOne('parents', student.parentId) : null;
  if (!registration || !activity || !student || !recipient?.phone) {
    return { sent: false, error: 'לא נמצא טלפון של המשתתף להשלמת המסמכים' };
  }
  const template = declarationTemplateForActivity(db, activity, resolveDeclarationTemplate);
  const slug = template?.slug && template.slug !== 'wall' ? `/${template.slug}` : '';
  const params = new URLSearchParams({
    studentId: student.id,
    phone: recipient.phone,
    registrationId: registration.id,
  });
  const url = `${resolvePublicAppOrigin(origin)}/register${slug}?${params.toString()}`;
  const settings = db.getSettings() || {};
  let result;
  try {
    result = await sendWhatsAppWithOptionalTemplate(recipient.phone, {
      templateCandidates: [settings.waOnboardTemplate, process.env.WA_ONBOARD_TEMPLATE].filter(Boolean),
      variables: [recipient.name || student.name || 'לקוח'],
      freeformText:
        `שלום ${recipient.name || ''}, המקום של ${student.name || 'המשתתף/ת'} ב-${activity.name || 'הפעילות'} נשמר, `
        + `אך ההשתתפות עדיין ממתינה להשלמת פרטים ומסמכים. להשלמה:\n\n${url}`,
      parentId: recipient.id,
    });
  } catch (error) {
    return { sent: false, error: error.message, url, recipient, student, kind };
  }
  return { ...result, url, recipient, student, kind };
}

/**
 * "Your health declaration lapses at the end of August — here is the form."
 *
 * Sent while the declaration is still valid, on the same approved template the
 * staff-side "send form" button uses, so no new Meta template is needed and the
 * parent gets a link that opens their own renewal.
 */
async function sendHealthExpiryMessage({ student, expiresAt, origin = PUBLIC_APP_FALLBACK } = {}) {
  const recipient = student ? db.getOne('parents', student.parentId) : null;
  if (!student || !recipient?.phone) {
    return { sent: false, error: 'לא נמצא טלפון של המשתתף לחידוש ההצהרה' };
  }
  const params = new URLSearchParams({
    studentId: student.id,
    phone: recipient.phone,
    mode: 'health-renewal',
  });
  const url = `${resolvePublicAppOrigin(origin)}/health?${params.toString()}`;
  const settings = db.getSettings() || {};
  const expiryText = String(expiresAt || '').slice(0, 10).split('-').reverse().join('.');
  try {
    const result = await sendWhatsAppWithOptionalTemplate(recipient.phone, {
      templateCandidates: [settings.waOnboardTemplate, process.env.WA_ONBOARD_TEMPLATE].filter(Boolean),
      variables: [recipient.name || student.name || 'לקוח'],
      freeformText:
        `שלום ${recipient.name || ''}, הצהרת הבריאות של ${student.name || 'המשתתף/ת'} בתוקף עד ${expiryText}. `
        + `אפשר לחדש אותה כבר עכשיו, בדקה אחת:\n\n${url}`,
      parentId: recipient.id,
    });
    return { ...result, url, recipient, student };
  } catch (error) {
    return { sent: false, error: error.message, url, recipient, student };
  }
}

async function runHealthExpiryRemindersSafely() {
  try {
    const summary = await runHealthExpiryReminders({
      db,
      persist: persistCore,
      healthState: (student) => {
        const eligibility = participationEligibility(db, { studentId: student.id });
        return {
          valid: eligibility?.health?.state === 'valid',
          expiresAt: eligibility?.health?.expires_at || '',
        };
      },
      send: ({ student, expiresAt }) => sendHealthExpiryMessage({
        student,
        expiresAt,
        origin: process.env.PUBLIC_APP_URL || PUBLIC_APP_FALLBACK,
      }),
    });
    if (summary.sent || summary.failed) {
      console.log(`🩺 Health expiry reminders: sent=${summary.sent} failed=${summary.failed} skipped=${summary.skipped}`);
    }
  } catch (error) {
    console.error('Health expiry reminder scan failed:', error.message);
  }
}

app.post('/api/activity-registrations/:id/send-document-reminder', async (req, res) => {
  const registration = db.getOne('activity_registrations', req.params.id);
  const activity = registration ? db.getOne('activities', registration.activity_id) : null;
  if (!registration || !activity) return res.status(404).json({ error: 'ההרשמה לא נמצאה' });
  if (registration.document_status === 'eligible') {
    return res.json({ success: true, sent: false, alreadyComplete: true });
  }
  const result = await sendActivityRegistrationDocumentMessage({
    registration,
    activity,
    origin: req.body?.origin,
    kind: 'staff_resend',
  });
  res.status(result.sent ? 200 : 502).json({ success: !!result.sent, ...result });
});

app.post('/api/public/activity-orders/:id/resend-documents', publicFormRateLimit, async (req, res) => {
  const verified = requireVerifiedPublicPhone(req, res, req.body?.phone);
  if (!verified) return;
  const order = db.getOne('activity_registration_orders', req.params.id);
  const payer = order ? db.getOne('parents', order.parent_id) : null;
  if (!order || !payer || normPhone(payer.phone) !== verified.phone) {
    return res.status(403).json({ error: 'ההזמנה אינה שייכת למספר שאומת' });
  }
  const activity = db.getOne('activities', order.activity_id);
  const registrations = (db.get('activity_registrations') || []).filter((registration) => (
    registration.order_id === order.id
    && ['pending_profile', 'awaiting_documents', 'blocked_health'].includes(registration.document_status)
  ));
  const results = [];
  for (const registration of registrations) {
    const result = await sendActivityRegistrationDocumentMessage({
      registration,
      activity,
      origin: req.body?.origin,
      kind: 'payer_resend',
    });
    results.push({ registrationId: registration.id, sent: !!result.sent, warning: result.error || null });
  }
  res.json({ success: results.some((result) => result.sent), results });
});

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

// Send participation-form link via WhatsApp (from lead card)
app.post('/api/leads/:studentId/send-health-form', async (req, res) => {
  const target = resolveLeadSendTarget(req.params.studentId, req.body?.parentId);
  if (target.error) return res.status(target.status).json({ error: target.error });
  const { student, parent } = target;
  const healthOnly = req.body?.healthOnly === true
    || String(req.body?.mode || '').trim().toLowerCase() === 'health-renewal';
  if (healthOnly && String(student.id || '').startsWith('parent:')) {
    return res.status(400).json({ error: 'יש לבחור משתתף/ת קיים/ת כדי לשלוח חידוש הצהרת בריאות' });
  }

  try {
    ensureParticipationFormWhatsappTemplate({ db, persist: persistCore });
  } catch (tplErr) {
    console.warn('participation form template ensure skipped:', tplErr.message);
  }

  const origin = resolvePublicAppOrigin(req.body?.origin);
  const requestedSlug = slugifyFormTemplate(req.body?.templateSlug || req.body?.slug || '');
  const formTemplate = requestedSlug
    ? findFormTemplateBySlug(requestedSlug)
    : findDefaultFormTemplate();
  const pathSlug = formTemplate?.slug && !formTemplate.isDefault ? `/${formTemplate.slug}` : '';
  const healthUrl = buildShareableHealthUrl(origin, {
    pathSlug: healthOnly ? '' : pathSlug,
    studentId: student.id,
    phone: parent.phone,
    mode: healthOnly ? 'health-renewal' : '',
  });
  const buttonParam = participationFormButtonParam(student.id, formTemplate, { healthOnly });
  const shortUrl = buildParticipationFormRedirectUrl(student.id, formTemplate, { healthOnly }) || healthUrl;

  const parentLabel = parent.name || 'לקוח';
  const studentLabel = student.name || parentLabel;
  const forChild = studentLabel
    && parentLabel
    && studentLabel.trim().toLowerCase() !== parentLabel.trim().toLowerCase();
  // The form is three things — participant details, the health declaration and
  // the waiver. Calling it "the health declaration" undersold it.
  const bodyText = healthOnly
    ? (forChild
        ? `שלום ${parentLabel}, מצורף קישור לחידוש הצהרת הבריאות של ${studentLabel}.`
        : `שלום ${parentLabel}, מצורף קישור לחידוש הצהרת הבריאות שלך.`)
    : (forChild
        ? `שלום ${parentLabel}, מצורף קישור למילוי ${FORM_FULL} עבור ${studentLabel}.`
        : `שלום ${parentLabel}, בבקשה מלאו את ${FORM_FULL} לפני הגעתכם.`);
  const freeformText = `${bodyText}\n\n${healthUrl}`;

  let sent = false;
  let via = null;
  let result = null;
  let warning;

  try {
    // The approved participation template promises a combined form. It must
    // never be used for a health-only renewal; inside the session window we
    // send the exact renewal copy, and outside it the CRM opens WhatsApp with
    // that copy for the staff member to send.
    const approvedTpl = healthOnly ? null : findApprovedParticipationFormTemplate(db);
    const templateName = approvedTpl?.meta_name || '';

    // 1) Approved Meta template with a URL button (works outside the 24h window).
    if (templateName && buttonParam) {
      try {
        const waResult = await whatsappService.sendTemplateMessage(
          parent.phone,
          templateName,
          [parentLabel, studentLabel],
          {
            parentId: parent.id,
            studentId: student.id,
            buttonUrlParam: buttonParam,
            source: healthOnly ? 'health_renewal' : 'participation_form',
          }
        );
        if (waResult?.success) {
          sent = true;
          via = 'template';
          result = waResult;
        } else {
          warning = waResult?.error || 'שליחת תבנית וואטסאפ נכשלה';
        }
      } catch (waErr) {
        warning = waErr.message || 'שליחת תבנית וואטסאפ נכשלה';
      }
    }

    // 2) Session-window CTA button — neat link without waiting for Meta review.
    const inWindow = canSendFreeform(parent, 'whatsapp');
    if (!sent && inWindow) {
      try {
        const waResult = await whatsappService.sendCtaUrlMessage(
          parent.phone,
          {
            body: bodyText,
            buttonText: 'למילוי הטופס',
            url: shortUrl,
          },
          {
            parentId: parent.id,
            studentId: student.id,
            source: healthOnly ? 'health_renewal' : 'participation_form',
          }
        );
        if (waResult?.success) {
          sent = true;
          via = 'cta';
          result = waResult;
          warning = undefined;
        } else if (!warning) {
          warning = waResult?.error;
        }
      } catch (waErr) {
        if (!warning) warning = waErr.message;
      }
    }

    // 3) Plain text with the full URL — last resort inside the window.
    if (!sent && inWindow) {
      try {
        const waResult = await whatsappService.sendTextMessage(parent.phone, freeformText, false, {
          parentId: parent.id,
          studentId: student.id,
          source: healthOnly ? 'health_renewal' : 'participation_form',
          clip: false,
        });
        if (waResult?.success) {
          sent = true;
          via = 'text';
          result = waResult;
          warning = undefined;
        } else if (!warning) {
          warning = waResult?.error || 'שליחת טקסט חופשי נכשלה';
        }
      } catch (waErr) {
        if (!warning) warning = waErr.message;
      }
    }

    if (!sent && !inWindow && !approvedTpl) {
      warning = warning || (healthOnly
        ? 'חלון 24 השעות סגור — ייפתח וואטסאפ אישי עם קישור חידוש הבריאות המוכן לשליחה.'
        : `חלון 24 השעות סגור, והתבנית «${PARTICIPATION_FORM_TEMPLATE}» עדיין לא מאושרת במטא. `
          + 'במסך דיוור ← תבניות: שלחו לאישור את «טופס השתתפות · קישור למילוי».');
    }

    res.json({
      success: sent,
      sent,
      via: via || null,
      healthUrl,
      shortUrl,
      templateSlug: formTemplate?.slug || null,
      mode: healthOnly ? 'health-renewal' : 'full',
      templateName: via === 'template' ? templateName : null,
      sentTo: parentLabel,
      result,
      warning: sent ? undefined : warning,
    });
  } catch (err) {
    res.status(200).json({
      success: false,
      sent: false,
      healthUrl,
      shortUrl,
      templateSlug: formTemplate?.slug || null,
      mode: healthOnly ? 'health-renewal' : 'full',
      warning: err.message,
    });
  }
});

// Daily attendance ensure at 06:00 Asia/Jerusalem (in-process; also call POST /api/attendance/ensure-today)
let lastAttendanceEnsureDate = null;
let lastOpenStepSweepDate = null;

/**
 * The trainee sweep, once a day and never twice. The date marker is cleared on
 * failure so a blip does not cost a whole day of the people it exists to find.
 */
async function runOpenStepSweepIfDue(hour = 10) {
  try {
    const today = israelDateStr();
    if (lastOpenStepSweepDate === today) return null;
    if (israelHour() < hour) return null;
    lastOpenStepSweepDate = today;
    return await automationsService.runOpenStepSweep();
  } catch (err) {
    console.error('open-step sweep failed:', err.message);
    lastOpenStepSweepDate = null;
    return null;
  }
}

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

async function runParticipationRemindersSafely() {
  try {
    if (supa.isEnabled()) {
      const [activities, registrations, reminders] = await Promise.all([
        supa.getAll('activities'),
        supa.getAll('activity_registrations'),
        supa.getAll('participation_reminders'),
      ]);
      if (activities) db.set('activities', activities);
      if (registrations) db.set('activity_registrations', registrations);
      if (reminders) db.set('participation_reminders', reminders);
    }
    const summary = await runParticipationDocumentReminders({
      db,
      persist: persistCore,
      send: ({ registration, activity, kind }) => sendActivityRegistrationDocumentMessage({
        registration,
        activity,
        origin: process.env.PUBLIC_APP_URL || PUBLIC_APP_FALLBACK,
        kind,
      }),
    });
    if (summary.sent || summary.failed) {
      console.log(`📄 Participation reminders: sent=${summary.sent} failed=${summary.failed} skipped=${summary.skipped}`);
    }
  } catch (error) {
    console.error('Participation reminder scan failed:', error.message);
  }
}

async function deliverRegistrationLifecycleMessage(payload = {}) {
  const parent = payload.parent || null;
  const phone = normalizePhone(parent?.phone || '');
  if (!phone) throw new Error('registration_lifecycle_parent_phone_missing');
  const studentName = payload.student?.name || payload.hold?.student_name || 'המתאמן/ת';
  if (canSendFreeform(parent, 'whatsapp')) {
    const sent = await whatsappService.sendTextMessage(phone, withBotMark(payload.text || ''), false, {
      source: 'registration_lifecycle',
      parentId: parent.id || null,
      studentId: payload.student?.id || payload.hold?.student_id || null,
      clip: false,
    });
    if (!sent?.success) throw new Error(sent?.error || 'registration_lifecycle_text_failed');
    return sent;
  }
  const template = approvedLifecycleTemplate(db, payload.kind);
  if (!template) throw new Error(`registration_lifecycle_template_not_approved:${payload.kind}`);
  const sent = await whatsappService.sendTemplateMessage(
    phone,
    template.meta_name || template.name,
    [studentName],
    {
      source: 'registration_lifecycle',
      parentId: parent.id || null,
      studentId: payload.student?.id || payload.hold?.student_id || null,
    }
  );
  if (!sent?.success) throw new Error(sent?.error || 'registration_lifecycle_template_failed');
  return sent;
}

async function refreshRegistrationLifecycleCache() {
  if (!supa.isEnabled()) return;
  const collections = [
    'students',
    'parents',
    'groups',
    'enrollments',
    'attendance',
    HOLD_COLLECTION,
    WAITLIST_COLLECTION,
    INTRO_COLLECTION,
    'registration_lifecycle_events',
  ];
  const loaded = await Promise.all(collections.map((collection) => supa.getAll(collection)));
  collections.forEach((collection, index) => {
    if (Array.isArray(loaded[index])) db.set(collection, loaded[index]);
  });
}

async function runRegistrationLifecycleSafely(now = new Date()) {
  try {
    await refreshRegistrationLifecycleCache();
    const summary = await runRegistrationLifecycle({
      db,
      persist: persistCore,
      now,
      sendCustomer: deliverRegistrationLifecycleMessage,
      createTask: (input) => createTask({
        db,
        persist: persistCore,
        input,
        actor: 'registration_lifecycle',
      }),
      isEligible: (student, group) => Boolean(student?.id)
        && canPlaceInRestrictedGroup(db, student, group).allowed,
    });
    if (Object.values(summary).some((value) => Number(value) > 0)) {
      console.log('Registration lifecycle:', JSON.stringify(summary));
    }
    return summary;
  } catch (error) {
    console.error('Registration lifecycle failed:', error.message);
    return { error: error.message };
  }
}

app.post('/api/registration-lifecycle/run', requireOwner, async (req, res) => {
  const now = req.body?.now ? new Date(req.body.now) : new Date();
  if (Number.isNaN(now.getTime())) return res.status(400).json({ error: 'Invalid time' });
  const result = await runRegistrationLifecycleSafely(now);
  return res.status(result.error ? 500 : 200).json(result);
});

// Start Server (after loading CRM-core data from Supabase)
initDb({ requireDurable: requiresDurableStore() }).then(async () => {
  // Boot just read every core table — the first screen to open should serve
  // that snapshot, not queue a fresh download of everything it touches.
  markFreshlyLoaded(CORE_TABLES);
  const redirectBoundary = await ensurePublicRedirectLegacyCutoff({
    db,
    persist: persistCore,
    requireDurable: requiresDurableStore(),
  });
  publicLegacyRedirectCutoffMs = redirectBoundary.cutoffMs;
  const liveBotSettings = db.getSettings();
  if (Number(liveBotSettings.aiPauseMinutesAfterHuman) !== 1
      || Number(liveBotSettings.aiMaxReplyChars) < 1200) {
    db.saveSettings({
      ...liveBotSettings,
      aiPauseMinutesAfterHuman: 1,
      aiMaxReplyChars: Math.max(1200, Number(liveBotSettings.aiMaxReplyChars) || 0),
    });
  }
  try {
    ensureGroupSignupWhatsappTemplate({ db, persist: persistCore });
  } catch (err) {
    console.warn('group signup template seed skipped:', err.message);
  }
  try {
    const equipmentBackfill = backfillAdultEquipment({ db, persist: persistCore });
    if (equipmentBackfill.created > 0) {
      console.log(`Adult equipment backfill: ${equipmentBackfill.created} row(s) for ${equipmentBackfill.students} trainee(s)`);
    }
  } catch (err) {
    console.warn('adult equipment backfill skipped:', err.message);
  }
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
  try {
    ensureParticipationFormWhatsappTemplate({ db, persist: persistCore });
  } catch (err) {
    console.warn('participation form template seed skipped:', err.message);
  }
  try {
    const created = ensureRegistrationLifecycleTemplates({ db, persist: persistCore });
    if (created.length) console.log(`Registration lifecycle templates seeded: ${created.length}`);
  } catch (err) {
    console.warn('registration lifecycle template seed skipped:', err.message);
  }
  Promise.resolve(migrateToTwoBroadcastLists({ database: db, persist: persistCore }))
    .then((result) => {
      if (result?.defs) {
        console.log(`📬 Broadcast lists: ${result.parents} parent(s) moved onto תפעולי / שיווקי`);
      }
    })
    .then(() => freshStartBroadcastSubscriptions({ database: db, persist: persistCore }))
    .then((fresh) => {
      if (fresh?.reset) {
        console.log(`📬 Broadcast lists fresh start: ${fresh.reset} unsubscribe record(s) cleared — everyone starts on every list`);
      }
    })
    .catch((err) => console.warn('broadcast list migration skipped:', err.message));
  Promise.resolve(migrateUnifiedWallWaiver({ database: db, persist: persistCore }))
    .then(({ updated, retired }) => {
      if (updated || retired) {
        console.log(`📄 Unified wall waiver migration: updated=${updated} retired=${retired}`);
      }
    })
    .catch((err) => console.warn('unified wall waiver migration skipped:', err.message));
  Promise.resolve(ensureDefaultScenarios({ db, persist: persistCore }))
    .then((created) => {
      if (created) console.log(`🧠 Seeded ${created} default AI scenario(s)`);
    })
    .catch((err) => console.warn('AI scenario seed skipped:', err.message));
  Promise.resolve(backfillCanonicalTrainingDays(db, persistCore))
    .then((rows) => {
      if (rows.length) console.log(`Canonical training days backfilled for ${rows.length} group(s)`);
    })
    .catch((err) => console.warn('training days backfill skipped:', err.message));
  Promise.resolve(runOneTimeBotDataMigrations(db, persistCore))
    .then((rows) => {
      if (rows.length) console.log(`Bot rollout data migrations created ${rows.length} guardian link(s)`);
    })
    .catch((err) => console.warn('bot rollout data migration skipped:', err.message));
  try {
    // Seed/hydrate catalog folders, then heal products left without a category.
    ensureProductCategories(db);
    const catFix = backfillPricelistCategories(db);
    if (catFix.updated > 0) {
      console.log(`🏷️ Pricelist category backfill: ${catFix.updated} product(s)`);
    }
    const wallFix = backfillWallClimbingProducts(db);
    if (wallFix.updated > 0) {
      console.log(`🧗 Wall-access product backfill: ${wallFix.updated} product(s)`);
      Promise.all(wallFix.rows.map((row) => persistCore('pricelist', row)))
        .catch((persistError) => console.warn('wall-access product backfill persistence skipped:', persistError.message));
    }
  } catch (err) {
    console.warn('product catalog seed skipped:', err.message);
  }
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  const backgroundJobsEnabled = scheduledJobsEnabled();
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
  if (backgroundJobsEnabled) {
    // אחרי טעינת הקטלוג ולא לפניה — התמחור נשען על התוויות שהיא מביאה.
    readRoleCatalog().then(sealSafely).catch(sealSafely);
    setInterval(sealSafely, 60 * 60 * 1000);
  }

  // Conversation mirror is derived from the durable `messages` table.
  try {
    const mirrored = rebuildLogMirrorFromMessages();
    if (mirrored) console.log(`💬 Conversation mirror rebuilt from ${mirrored} durable message(s)`);
  } catch (err) {
    console.error('rebuildLogMirrorFromMessages failed:', err.message);
  }

  if (backgroundJobsEnabled) {
    // Retry any message whose durable write did not land (Supabase blip).
    startPendingMessageRetry();
    flushPendingMessages().catch((err) =>
      console.error('startup flushPendingMessages failed:', err.message)
    );
  }
  
  if (!backgroundJobsEnabled) {
    console.log('⏸️ Production background jobs disabled on this local/development process');
    return;
  }

  // Self-ping keeps the instance awake and surfaces a degraded store early.
  const renderUrl = process.env.RENDER_EXTERNAL_URL || 'https://climbing-crm-api.onrender.com';
  setInterval(() => {
    fetch(`${renderUrl}/api/health`)
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

  // Once a day, over the trainees rather than the conversations: whoever is
  // stuck mid-registration and is not in anybody's queue. Ten in the morning,
  // so the follow-up it opens goes out during the day rather than at dawn.
  setTimeout(() => { runOpenStepSweepIfDue(10); }, 90_000);
  setInterval(() => { runOpenStepSweepIfDue(10); }, 15 * 60 * 1000);

  // Durable seat holds, waitlist offers and intro follow-ups. Every action has
  // its own event key, so restarts and multiple server instances cannot send it
  // twice.
  setTimeout(() => { runRegistrationLifecycleSafely(); }, 75_000);
  setInterval(() => { runRegistrationLifecycleSafely(); }, 15 * 60 * 1000);

  // Missing spouse/adult documents: once three days before and once the day
  // before. Durable send markers make the hourly scan restart-safe.
  setTimeout(() => { runParticipationRemindersSafely(); }, 50_000);
  setInterval(() => { runParticipationRemindersSafely(); }, 60 * 60 * 1000);
  // A month's notice before the health declaration lapses. Hourly like the scan
  // above rather than once a day: one row per student per season is what stops a
  // second send, so a restart cannot skip the day or repeat it.
  setTimeout(() => { runHealthExpiryRemindersSafely(); }, 65_000);
  setInterval(() => { runHealthExpiryRemindersSafely(); }, 60 * 60 * 1000);
  // Follow-ups are not a once-a-day job: a short one is aimed 23 hours after
  // the customer's last message so it lands while free text is still allowed,
  // and a morning-only run would miss that hour on most conversations.
  setInterval(() => {
    automationsService.runBotFollowUps().catch((err) =>
      console.error('bot follow-ups failed:', err.message));
    // On the same beat: a turn that died before its answer went out leaves a
    // customer answered by nobody, and nothing else would ever say so.
    automationsService.runAbandonedReplySweep().catch((err) =>
      console.error('abandoned reply sweep failed:', err.message));
  }, 15 * 60 * 1000);

  setTimeout(() => {
    probeGeminiService().catch((err) => console.error('Gemini recovery probe failed:', err.message));
  }, 30_000);
  setInterval(() => {
    probeGeminiService().catch((err) => console.error('Gemini recovery probe failed:', err.message));
  }, 5 * 60 * 1000);

  // A webhook can be stored successfully and then lose its worker during a
  // restart. Revisit only recent, still-unanswered customer text; the ordinary
  // gate and durable reply claim decide whether a recovery may answer.
  setTimeout(() => {
    recoverUnansweredConversations().catch((err) => console.error('unanswered WhatsApp recovery failed:', err.message));
  }, 40_000);
  setInterval(() => {
    recoverUnansweredConversations().catch((err) => console.error('unanswered WhatsApp recovery failed:', err.message));
  }, 60_000);

  // One-time policy repair, safe to retry: only a still-last unsolicited intro
  // choice is eligible, the 24h gate stays in force, and the offer id is the
  // durable reply key. Once the direct-registration answer lands, the thread
  // is no longer a candidate.
  const recoverIntroOfferDeadEnds = () => recoverStalledIntroOffers({
    messages: db.get('messages') || [],
    parents: db.get('parents') || [],
    since: Date.parse('2026-08-09T00:00:00+03:00'),
    getStudents: (parent) => (db.get('students') || [])
      .filter((student) => String(student.parentId || student.parent_id || '') === String(parent?.id || '')),
    continueConversation: whatsappService.continueConversation,
  }).then((summary) => {
    if (summary.candidates) console.log(`Direct-signup recovery: ${JSON.stringify(summary)}`);
  });
  setTimeout(() => {
    recoverIntroOfferDeadEnds().catch((err) => console.error('direct-signup recovery failed:', err.message));
  }, 100_000);
  setInterval(() => {
    recoverIntroOfferDeadEnds().catch((err) => console.error('direct-signup recovery failed:', err.message));
  }, 15 * 60_000);

  // Staff reminders before their own shifts. Every 10 minutes rather than once
  // a day, because the lead time is each employee's own choice — two hours for
  // one, two days for another — and a daily pass can only serve one of them.
  setTimeout(() => { runShiftRemindersIfDue(); }, 55_000);
  setInterval(() => { runShiftRemindersIfDue(); }, 10 * 60 * 1000);

  // "Someone is coming to try out tomorrow" — one evening pass, from 17:00.
  setTimeout(() => { runIntroHeadsUpIfDue(17); }, 80_000);
  setInterval(() => { runIntroHeadsUpIfDue(17); }, 15 * 60 * 1000);

  // Evening agenda digests — tomorrow's plan daily, the coming week on Saturday
  setTimeout(() => { runAgendaDigestsIfDue(); }, 70_000);
  setInterval(() => { runAgendaDigestsIfDue(); }, 10 * 60 * 1000);

  // Campaigns + coupon expiry (from 10:00 Asia/Jerusalem, after the morning jobs)
  setTimeout(() => { runCampaignsIfDue(10); }, 90_000);
  setInterval(() => { runCampaignsIfDue(10); }, 15 * 60 * 1000);

  // דיוור: ספירת ה-30 שניות לביטול, משימות מתוזמנות והמשך אחרי restart.
  startBroadcastRunner();

  // AI assistant sweep over conversations that went quiet (from 03:00 Asia/Jerusalem)
  setInterval(() => { runNightlySweepIfDue(3); }, 15 * 60 * 1000);

  // המרכז הפיננסי: משיכת iCount, התאמות, יישוב, ספר ותחזית — פעם ביום
  // מ-04:00. אין cron של Render בחשבון, אז התזמון חי כאן כמו שאר העבודות.
  setInterval(() => {
    runFinanceNightlyIfDue().catch((err) => console.error('finance nightly failed:', err?.message || err));
  }, 15 * 60 * 1000);

  // Sunday and Tuesday at 08:00: one question to the community centre carrying
  // every trainee whose parent said they had registered there.
  setInterval(() => {
    runCentreRegistrationChecks().catch((err) => console.error('Centre check run failed:', err.message));
  }, 15 * 60 * 1000);

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

  // The rolling two-week window advances every day even when nobody edits the
  // calendar, so refresh Google Maps/Search periodically as a safety net.
  const runBusinessHoursSyncIfConnected = async () => {
    try {
      if (!googleBusinessProfileService.backgroundSyncEnabled()) return;
      const status = await googleBusinessProfileService.getStatus();
      if (!status.ready) return;
      const result = await googleBusinessProfileService.syncOpeningHours(db.get('activities') || []);
      if (result?.success) {
        console.log(`🕒 Google Business Profile hours sync: ${result.startDate}–${result.endDate}`);
      }
    } catch (err) {
      console.error('Periodic Google Business Profile sync failed:', err.message);
    }
  };
  if (googleBusinessProfileService.backgroundSyncEnabled()) {
    setTimeout(() => { runBusinessHoursSyncIfConnected(); }, 120_000);
    setInterval(() => { runBusinessHoursSyncIfConnected(); }, 6 * 60 * 60 * 1000);
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
