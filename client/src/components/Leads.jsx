import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Plus, PlusCircle, Trash2, UserCheck, UserRound, Star, Phone, PhoneOff, AtSign, Eye, X, CreditCard, Award, Send, Clipboard, Edit2, Check, LayoutGrid, List, MessageCircle, MapPin, Tag, Bell, FileCheck2, FolderOpen, Download, ReceiptText, History, RotateCw, ChevronDown, ChevronLeft, Users, Ticket, CalendarDays, Package, Gift, ShoppingBag, Archive, ArchiveRestore, ShieldCheck, ShieldAlert, HeartPulse, Undo2, Loader2, Pencil } from 'lucide-react';
import { STATUSES, LEAD_SOURCES, LEAD_SEGMENTS } from '../mockData.js';
import { useAuth } from './AuthGate.jsx';
import { StatusBadge, Modal } from './UI.jsx';
import {
  TEST_KINDS,
  TEST_TYPE_COLORS,
  testKindMeta,
} from '../utils/levelTestKinds.js';
import { LEVELS, levelColor, routeStyleMeta, ROUTE_STYLE, highestPassedLevel } from '../utils/levelGrades.js';
import GenderPicker, { AdultMark, GenderMark, genderKind } from './GenderPicker.jsx';
import { GroupPickerField } from './GroupPickerCards.jsx';
import {
  blobToBase64,
  buildHealthDeclarationPdf,
  downloadParticipationWaiverPdf,
  downloadHealthDeclarationPdf,
} from '../utils/healthDeclarationPdf.js';
import { healthExpiryDate } from '../utils/healthValidity.js';
import {
  DECLARATION_KINDS,
  DOCUMENT_FILE_KINDS,
  declarationKind,
  documentRowKind,
  templateKind,
  templateShortLabel,
} from '../utils/declarationKinds.js';
import { studentDeclarationStatus } from '../utils/declarationStatus.js';
import {
  filterAndSortDocumentRows,
  participationDocumentScope,
  participationScopeValidity,
} from '../utils/participationDocuments.js';
import { safetyTestStatus, SAFETY_TONE } from '../utils/safetyValidity.js';
import {
  FORM_FOLDER,
  FORM_SHORT,
} from '../utils/participationForm.js';
import {
  buildLeadEntries,
  buildLeadEntryScopes,
  isArchivedParent,
  isParentOnlyLead,
  matchesLeadSearch,
  normalizePhone,
  resolveLeadOpenTarget,
} from '../utils/leadUtils.js';
import { buildFamilyMemberTabs, buildFamilyRows, householdStudentsForParent } from '../utils/leadHouseholds.js';
import {
  CATEGORY_COLORS,
  CATEGORY_ICONS,
  DEFAULT_CATEGORY_COLOR,
  PRODUCT_CATEGORIES,
  catTint,
  imageBackground,
  imageFitOf,
  normalizeCategories,
} from './productCategories.js';
import ConversationPanel from './ConversationPanel.jsx';
import ConversationInbox from './ConversationInbox.jsx';
import AttendanceList from './AttendanceList.jsx';
import {
  AttendanceToggle,
  activityDayLabel,
  saveActivityAttendance,
} from './ActivityAttendance.jsx';
import { isAwaitingHandling, nextCommunicationRow, sortCommunicationRows, threadIsAwaitingReply } from './communicationQueue.js';
import { consecutiveAbsences } from '../scheduleUtils.js';
import { studentGroupIds } from '../utils/studentGroups.js';
import { passPurchasedText, passSubtitle } from '../utils/passes.js';
import { otherGuardians, studentGuardianIds } from '../utils/studentGuardians.js';
import {
  EQUIPMENT_ICONS,
  EQUIPMENT_ICON_COLORS,
  EQUIPMENT_LABELS,
  EQUIPMENT_ORDER,
  EQUIPMENT_STATUS_TONES,
  applyEquipmentTone,
  equipmentItemTone,
  equipmentToneBg,
  equipmentToneColor,
  equipmentToneLabel,
  equipmentToneTransition,
  formatRentalRange,
} from './equipmentUtils.js';
import AppSelect from './AppSelect.jsx';
import { joinParentName, splitParentName } from '../utils/parentName.js';

const COUPON_STATE_BADGE = {
  active: { label: 'בתוקף', cls: 'badge badge-green' },
  reserved: { label: 'ממתין לתשלום', cls: 'badge badge-amber' },
  redeemed: { label: 'מומש', cls: 'badge badge-blue' },
  expired: { label: 'פג תוקף', cls: 'badge badge-gray' },
  cancelled: { label: 'בוטל', cls: 'badge badge-red' },
};

/** Mirrors passDiscountNote in server/posUtils.js — kept local like pickBestPunchCard. */
function passDiscountNote(pass) {
  if (!pass?.coupon_label && pass?.list_price == null) return '';
  const list = Number(pass.list_price);
  const paid = Number(pass.paid_price);
  const label = pass.coupon_label || 'הטבה';
  if (Number.isFinite(list) && Number.isFinite(paid) && list > paid) {
    return `נקנתה ב${label} · שולם ₪${paid} במקום ₪${list}`;
  }
  return `נקנתה ב${label}`;
}

const EMPTY_COUPON_DRAFT = {
  type: 'percent',
  value: '50',
  units: '1',
  validityDays: '30',
  pricelistId: '',
  label: '',
  recurring: false,
  noExpiry: false,
};

/** One labelled row in the manual-benefit form. */
function CouponField({ label, hint, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', marginBottom: 3 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

function couponExpiryPreview(validityDays) {
  const days = Number(validityDays);
  if (!Number.isFinite(days) || days <= 0) return '';
  const until = new Date();
  until.setDate(until.getDate() + days);
  return `בתוקף עד ${until.toLocaleDateString('he-IL')}`;
}

/** What the benefit would be called if nobody types a name — also the placeholder. */
function suggestedCouponLabel(draft, pricelist = []) {
  const product = draft.pricelistId
    ? (pricelist || []).find((p) => String(p.id) === String(draft.pricelistId))
    : null;
  const on = product ? ` על ${product.name}` : '';
  if (draft.type === 'percent') return `${Number(draft.value) || 0}% הנחה${on}`;
  if (draft.type === 'amount') return `₪${Number(draft.value) || 0} הנחה${on}`;
  if (draft.type === 'free_item') return product ? `${product.name} חינם` : 'פריט חינם';
  return `אחד פלוס אחד${on}`;
}

const PAYMENT_STATUS_BADGES = {
  paid: { label: 'שולם', cls: 'badge badge-green' },
  pending: { label: 'ממתין', cls: 'badge badge-amber' },
  refunded: { label: 'זוכה', cls: 'badge badge-gray' },
  cancelled: { label: 'בוטל', cls: 'badge badge-gray' },
  failed: { label: 'נכשל', cls: 'badge badge-red' },
};

function paymentStatusBadge(status) {
  return PAYMENT_STATUS_BADGES[status] || { label: status || '—', cls: 'badge badge-gray' };
}

const SALE_STATUS_BADGES = {
  paid: { label: 'שולם', cls: 'badge badge-green' },
  quoted: { label: 'הצעת מחיר', cls: 'badge badge-amber' },
  pending: { label: 'ממתין לתשלום', cls: 'badge badge-amber' },
  refunded: { label: 'זוכה', cls: 'badge badge-gray' },
  cancelled: { label: 'בוטל', cls: 'badge badge-gray' },
};

function saleStatusBadge(status) {
  return SALE_STATUS_BADGES[status] || { label: status || '—', cls: 'badge badge-gray' };
}

const SALE_METHOD_LABELS = {
  cash: 'מזומן',
  card: 'אשראי',
  cc: 'אשראי',
  credit: 'אשראי',
  emv: 'אשראי בדלפק',
  online: 'קישור תשלום',
  bit: 'ביט',
  transfer: 'העברה בנקאית',
  check: 'צ׳ק',
};

function saleMethodLabel(method) {
  const key = String(method || '').toLowerCase();
  return SALE_METHOD_LABELS[key] || '';
}

function paymentHasRefundDoc(payment) {
  return !!(payment?.refund_doc_number || payment?.refund_doc_url);
}

// Normalize phone for comparison (supports 05X ↔ 9725X)
const normPhone = normalizePhone;

export const phoneTailMatch = (a, b) => {
  const na = normPhone(a);
  const nb = normPhone(b);
  if (!na || !nb) return false;
  return na === nb || na.slice(-9) === nb.slice(-9);
};

function parentNameParts(parent) {
  const parts = splitParentName(parent || {});
  return { firstName: parts.first, lastName: parts.lastName };
}

function calculateAge(birthDateStr) {
  if (!birthDateStr) return null;
  const birth = new Date(birthDateStr);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age;
}

/**
 * חודשים שהושלמו מאז יום ההולדת האחרון — כדי לדעת אם עברה חצי שנה.
 * שישה חודשים ומעלה נחשבים „וחצי”, בלי לעגל כלפי מעלה לשנה הבאה.
 */
function monthsSinceBirthday(birthDateStr) {
  if (!birthDateStr) return null;
  const birth = new Date(birthDateStr);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let months = (today.getFullYear() - birth.getFullYear()) * 12 + (today.getMonth() - birth.getMonth());
  if (today.getDate() < birth.getDate()) months -= 1;
  return months % 12;
}

/** „4” או „4 וחצי” — הגיל כפי שאומרים אותו על ילד. */
function ageLabel(birthDateStr) {
  const years = calculateAge(birthDateStr);
  if (years == null) return null;
  const months = monthsSinceBirthday(birthDateStr);
  return months != null && months >= 6 ? `${years} וחצי` : String(years);
}

function parentDisplayName(parent) {
  if (!parent) return 'ללא הורה';
  const parts = parentNameParts(parent);
  return [parts.firstName, parts.lastName].filter(Boolean).join(' ') || parent.name || 'ללא שם';
}

/** Adults first, then children — fixed order that does not follow who is open. */
function compareTraineeChips(a, b) {
  const adultDiff = (a?.isAdult ? 0 : 1) - (b?.isAdult ? 0 : 1);
  if (adultDiff) return adultDiff;
  const nameDiff = String(a?.name || '').localeCompare(String(b?.name || ''), 'he');
  if (nameDiff) return nameDiff;
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

/** Count consecutive absences from the newest marked class (skip pending/holiday). */
/** WhatsApp copy for health declaration — always addressed to the parent. */
function buildHealthWhatsAppText(parentName, studentName, link, { healthOnly = false } = {}) {
  const p = String(parentName || '').trim();
  const s = String(studentName || '').trim();
  if (healthOnly) {
    if (s && p && s.toLowerCase() !== p.toLowerCase()) {
      return `שלום ${p}, מצורף קישור לחידוש הצהרת הבריאות של ${s}:\n\n${link}`;
    }
    return `שלום ${p || ''}, מצורף קישור לחידוש הצהרת הבריאות שלך:\n\n${link}`;
  }
  // Blank line before URL helps WhatsApp detect a clickable link.
  // Name all three parts of the form: participant details, health declaration
  // and waiver. "A health declaration link" set the wrong expectation.
  if (s && p && s.toLowerCase() !== p.toLowerCase()) {
    return `שלום ${p}, מצורף קישור למילוי פרטי המשתתף, הצהרת בריאות והסרת אחריות עבור ${s}:\n\n${link}`;
  }
  return `שלום ${p || ''}, בבקשה מלאו את פרטי המשתתף, הצהרת הבריאות והסרת האחריות:\n\n${link}`;
}

function isLocalOrigin(origin) {
  try {
    const host = new URL(String(origin || '')).hostname;
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return true;
  }
}

/** Prefer public site for WhatsApp share links (localhost is not clickable on phones). */
const PUBLIC_APP_FALLBACK = 'https://app.kirboaz.co.il';

function publicShareOrigin() {
  const env = String(import.meta.env.VITE_PUBLIC_APP_URL || '').trim().replace(/\/$/, '');
  if (env && !isLocalOrigin(env)) return env;
  if (!isLocalOrigin(window.location.origin)) return window.location.origin;
  return PUBLIC_APP_FALLBACK;
}

function buildShareHealthLink(studentId, phone, healthPath = '/register', { healthOnly = false } = {}) {
  const params = new URLSearchParams();
  if (studentId && !String(studentId).startsWith('parent:')) {
    params.set('studentId', studentId);
  } else if (phone) {
    params.set('phone', phone);
  }
  if (healthOnly) params.set('mode', 'health-renewal');
  const qs = params.toString();
  return `${publicShareOrigin()}${healthPath}${qs ? `?${qs}` : ''}`;
}

const sourceLabel = (m) => {
  if (m.is_ai || m.source === 'ai') return 'AI';
  if (m.source === 'phone') return 'מהטלפון';
  if (m.source === 'crm') return 'מהמערכת';
  if (m.direction === 'inbound' || m.from) return 'לקוח';
  return 'יוצא';
};


/** Collapsible folder row for lead detail panel */
/**
 * Declaration state for one climber, as icons: the climber is the wall form,
 * footprints the outdoor trip, gift a booked activity. Green means a valid
 * signature is on file, amber means it is missing or expired — the row is
 * scanned, not read, so the colour has to carry the answer.
 *
 * `validOnly` keeps just the green marks (the customer-file name row). The
 * leads table still wants the amber gaps so a missing signature stands out.
 */
function DeclarationIcons({ status, validOnly = false, size = 13, onClick }) {
  const marks = [
    // האייקון מגיע מקטלוג סוגי ההצהרות, כדי שאותו סימן ישמש כאן ובתיק הלקוח.
    { key: 'wall', Icon: DECLARATION_KINDS.wall.Icon, label: 'אישור פעילות בקיר' },
    { key: 'trip', Icon: DECLARATION_KINDS.trip.Icon, label: 'טופס השתתפות לטיולים' },
  ];
  const validMarks = marks.filter(({ key }) => {
    const state = status?.[key];
    return !!state?.signed && !state?.expired;
  });
  // Name-row mode: green icons for every valid signature; if none, one amber
  // climber so a missing wall form still reads at a glance.
  const shown = validOnly
    ? (validMarks.length ? validMarks : marks.filter(({ key }) => key === 'wall'))
    : marks.filter(({ key }) => {
      const state = status?.[key];
      // Wall always shows (missing is the amber signal). Extra activities only
      // appear once there is something to say about them.
      return key === 'wall' || !!state?.signed;
    });
  if (!shown.length) return null;
  const Wrap = onClick ? 'button' : 'span';
  return (
    <Wrap
      {...(onClick
        ? { type: 'button', onClick, title: `פתיחת תיקיית ${FORM_FOLDER}` }
        : {})}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        ...(onClick
          ? {
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }
          : {}),
      }}
    >
      {shown.map(({ key, Icon, label }) => {
        const state = status?.[key];
        const ok = !!state?.signed && !state?.expired;
        const title = !state?.signed
          ? `${label}: לא נחתמה`
          : state.expired ? `${label}: פג תוקף` : `${label}: בתוקף`;
        return (
          // The tooltip hangs off a span: a `title` attribute on an <svg> is
          // not what browsers show on hover.
          <span key={key} title={title} aria-label={title} style={{ display: 'inline-flex' }}>
            <Icon size={size} style={{ color: ok ? 'var(--green)' : 'var(--amber)', opacity: ok ? 1 : 0.75 }} />
          </span>
        );
      })}
    </Wrap>
  );
}

function FolderRow({ id, title, icon: Icon, summary, open, onToggle, children, renderBody, summaryColor, accent = 'var(--blue)', style, headerless = false }) {
  // Large folders contain maps, formatting and controls for years of customer
  // history. A render callback means React does none of that work until the
  // folder is actually opened.
  const body = () => (renderBody ? renderBody() : children);
  if (headerless) {
    if (!open) return null;
    return (
      <div
        data-folder-id={id}
        className="folder-row folder-row-headerless open"
        style={{ '--folder-accent': accent, ...style }}
      >
        <div className="folder-row-body">{body()}</div>
      </div>
    );
  }
  return (
    <div
      data-folder-id={id}
      className={`folder-row ${open ? 'open' : ''}`}
      style={{ '--folder-accent': accent, ...style }}
    >
      <button type="button" className="folder-row-head" onClick={() => onToggle(id)}>
        {Icon && <Icon className="folder-row-icon" size={15} />}
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', flexShrink: 0 }}>{title}</span>
        <span style={{
          fontSize: 12,
          color: summaryColor || 'var(--text-3)',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textAlign: 'left',
        }}>
          {summary}
        </span>
        <ChevronDown
          size={15}
          style={{
            flexShrink: 0,
            opacity: 0.6,
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s ease',
          }}
        />
      </button>
      {open && <div className="folder-row-body">{body()}</div>}
    </div>
  );
}

// ─── Lead/Customer Card (detail sidebar) ────────────────────────────────────
export function CustomerCard({ student, parent: primaryParent, parents: allParents = [], siblings = [], declarations: knownDeclarations = [], onSelectSibling, group, groups = [], onClose, onStatusChange, onDelete, onArchive, onUpdateStudent, onUpdateParent, pricelist, refreshData, canManageBilling = false, canViewComms = true, onCommunicationHandled }) {
  // זיכוי בסכום ידני עוקף את המדיניות, ולכן הוא שמור לבעלים.
  const { isOwner } = useAuth() || {};
  if (!student) return null;

  /**
   * Storage keeps payer/contact and trainee records separate, but the person
   * switcher must not show the same adult twice. `combined` is the one screen
   * tab that opens both sides of an adult who is also a payer.
   */
  const parentOnly = isParentOnlyLead(student);
  const familyMemberTabs = useMemo(
    () => buildFamilyMemberTabs(siblings, allParents),
    [siblings, allParents]
  );
  const householdParentCount = new Set(
    (allParents || []).map((item) => String(item?.id || '')).filter(Boolean)
  ).size;
  const primaryAnchorStudent = (siblings || []).find(
    (member) => !isParentOnlyLead(member) && !member?.isAdult
  ) || (siblings || []).find((member) => !isParentOnlyLead(member)) || (parentOnly ? null : student);
  const householdIdentityKey = (allParents || [])
    .map((item) => String(item?.id || ''))
    .filter(Boolean)
    .sort()
    .join('|');
  const [familyPrimaryParentId, setFamilyPrimaryParentId] = useState(
    primaryAnchorStudent?.parentId || primaryParent?.id || null
  );
  useEffect(() => {
    setFamilyPrimaryParentId(primaryAnchorStudent?.parentId || primaryParent?.id || null);
    // Switching between people in the same household must not move the primary
    // badge. Reset it only when an entirely different household is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdIdentityKey]);
  const selectedMemberTab = familyMemberTabs.find(
    (tab) => tab.student && String(tab.student.id) === String(student.id)
  ) || null;
  const initialCommunicationTab = familyMemberTabs.find((tab) => (
    tab.kind !== 'student' && String(tab.parent?.id) === String(primaryParent?.id)
  )) || selectedMemberTab || familyMemberTabs[0] || null;
  const [activeParentId, setActiveParentId] = useState(primaryParent?.id || null);
  // Communication is a separate axis from the file shown in the details pane.
  // Switching a family tab must never pull the agent out of the conversation
  // they are currently reading.
  const [communicationParentId, setCommunicationParentId] = useState(
    initialCommunicationTab?.parent?.id || primaryParent?.id || null
  );
  const [communicationThreadId, setCommunicationThreadId] = useState('parent');
  const [communicationMemberKey, setCommunicationMemberKey] = useState(
    initialCommunicationTab?.key || null
  );
  const [profileMode, setProfileMode] = useState(() => (
    parentOnly ? 'parent' : (selectedMemberTab?.kind || 'student')
  ));
  const [conversationByParentId, setConversationByParentId] = useState({});
  useEffect(() => {
    const nextMember = familyMemberTabs.find(
      (tab) => tab.student && String(tab.student.id) === String(student.id)
    );
    setActiveParentId(nextMember?.parent?.id || primaryParent?.id || null);
    setProfileMode(parentOnly ? 'parent' : (nextMember?.kind || 'student'));
    // Changing person starts their file at the top; the switcher itself stays fixed.
    if (foldersScrollRef.current) foldersScrollRef.current.scrollTop = 0;
    // `familyMemberTabs` is intentionally omitted: background data refreshes
    // must not kick somebody out of a parent tab they explicitly selected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student.id, primaryParent?.id]);
  const parent = (allParents || []).find((item) => String(item.id) === String(activeParentId))
    || primaryParent;
  const communicationParent = (allParents || []).find(
    (item) => String(item.id) === String(communicationParentId)
  ) || primaryParent || parent;
  const communicationStudent = familyMemberTabs.find(
    (tab) => tab.key === communicationMemberKey
  )?.student || null;

  const showFamilyProfile = profileMode === 'parent' || profileMode === 'combined' || parentOnly;
  const showStudentProfile = !parentOnly && (profileMode === 'student' || profileMode === 'combined');
  const parentArchived = isArchivedParent(parent);
  const statusKeys = Object.keys(STATUSES);
  const navigate = useNavigate();

  const [broadcastListDefs, setBroadcastListDefs] = useState([
    { key: 'operational', label: 'תפעולי', description: 'שינויי שעות, ביטולים ותזכורות' },
    { key: 'marketing', label: 'שיווקי', description: 'טיולים חדשים, מבצעים ועדכונים כלליים' },
  ]);
  const [broadcastLists, setBroadcastLists] = useState({});
  const [loadingLists, setLoadingLists] = useState(false);
  const [editingBroadcastLists, setEditingBroadcastLists] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [phoneCopied, setPhoneCopied] = useState(false);
  const [emailCopied, setEmailCopied] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editingGroup, setEditingGroup] = useState(false);
  const [savingGroup, setSavingGroup] = useState(false);
  const [editingFollowup, setEditingFollowup] = useState(false);
  const [savingFollowup, setSavingFollowup] = useState(false);
  const [programEligibility, setProgramEligibility] = useState([]);
  const [editProgramEligible, setEditProgramEligible] = useState(false);
  
  // Edit Form Fields (student)
  // שם פרטי ושם משפחה בשני שדות, כמו אצל ההורה. תיק שקדם לפיצול נפתח עם
  // אותו ניחוש שהמערכת עשתה תמיד — המילה האחרונה — אבל מכאן הוא נשמר בנפרד.
  const [editStudentFirstName, setEditStudentFirstName] = useState(
    () => splitParentName({ name: student.name, lastName: student.lastName }).first,
  );
  const [editStudentLastName, setEditStudentLastName] = useState(
    () => splitParentName({ name: student.name, lastName: student.lastName }).lastName,
  );
  const [editBirthDate, setEditBirthDate] = useState(student.birthDate || '');
  const [editStudentPhone, setEditStudentPhone] = useState(student.phone || '');
  const [editGender, setEditGender] = useState(student.gender || '');
  const [editStudentNotes, setEditStudentNotes] = useState(student.notes || '');
  const [editSegment, setEditSegment] = useState(student.segment || '');
  const [editNextFollowup, setEditNextFollowup] = useState(student.nextFollowup || '');
  const [editGroupIds, setEditGroupIds] = useState(() => studentGroupIds(student));
  // Edit Form Fields (parent)
  const initialParentName = parentNameParts(parent);
  const [editParentName, setEditParentName] = useState(initialParentName.firstName);
  const [editParentLastName, setEditParentLastName] = useState(initialParentName.lastName);
  const [editParentIdNumber, setEditParentIdNumber] = useState(parent?.idNumber || '');
  const [editPhone, setEditPhone] = useState(parent?.phone || '');
  const [editEmail, setEditEmail] = useState(parent?.email || '');
  const [editCity, setEditCity] = useState(parent?.city || '');
  const [editParentGender, setEditParentGender] = useState(parent?.gender || '');
  const [editParentNotes, setEditParentNotes] = useState(parent?.notes || '');
  const [editSource, setEditSource] = useState(parent?.source || student.source || 'unknown');
  const [editFocus, setEditFocus] = useState('student'); // student | parent
  const [editError, setEditError] = useState('');

  // Health declaration + waiver status for this student
  const [healthDecl, setHealthDecl] = useState(null);
  // All of this student's declarations, one per activity they signed for.
  const [studentDeclarations, setStudentDeclarations] = useState([]);
  const [participationWaivers, setParticipationWaivers] = useState([]);
  const [sendingHealth, setSendingHealth] = useState(false);
  const [healthSendMsg, setHealthSendMsg] = useState('');
  const [healthSendLink, setHealthSendLink] = useState('');
  const [formTemplates, setFormTemplates] = useState([]);
  const [selectedFormSlug, setSelectedFormSlug] = useState('');
  const [showHealthSendModal, setShowHealthSendModal] = useState(false);
  // מזהה המסמך שנבנה כרגע, לא בוליאני: דגל אחד סימן „מכין…” על כל כפתורי
  // ההורדה בתיקייה יחד, ואי אפשר היה לדעת איזו הורדה בכלל התחילה.
  const [downloadingPdf, setDownloadingPdf] = useState('');
  const [clientDocuments, setClientDocuments] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState('');
  // A file leaves the client's personal file for good, so the row is only armed
  // once the word is typed out by hand.
  const [pendingDocDelete, setPendingDocDelete] = useState(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [documentKindFilter, setDocumentKindFilter] = useState('all');
  const [openFolder, setOpenFolder] = useState(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showAddChild, setShowAddChild] = useState(false);
  const [newChildName, setNewChildName] = useState('');
  const [sendHealthOnAdd, setSendHealthOnAdd] = useState(true);
  const [addingChild, setAddingChild] = useState(false);
  const [addChildError, setAddChildError] = useState('');
  const [removingChildId, setRemovingChildId] = useState('');
  const [removeChildError, setRemoveChildError] = useState('');
  // A second phone on the file that is not a trainee: the other parent, a
  // grandparent, a nanny. Adding one must never create a trainee record.
  const [showAddContact, setShowAddContact] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactStudentIds, setContactStudentIds] = useState([]);
  const [addingContact, setAddingContact] = useState(false);
  const [addContactError, setAddContactError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (parentOnly || !student?.id) {
      setProgramEligibility([]);
      return () => { cancelled = true; };
    }
    fetch(`/api/students/${encodeURIComponent(student.id)}/program-eligibility`)
      .then((response) => (response.ok ? response.json() : []))
      .then((rows) => {
        if (!cancelled) {
          const nextRows = Array.isArray(rows) ? rows : [];
          setProgramEligibility(nextRows);
          setEditProgramEligible(nextRows.some((row) => ['returning', 'approved'].includes(String(row.status || ''))));
        }
      })
      .catch(() => {
        if (!cancelled) setProgramEligibility([]);
      });
    return () => { cancelled = true; };
  }, [parentOnly, student?.id]);

  useEffect(() => {
    {
      // איפוס לשני השדות המפוצלים — הקריאה לסטר הישן הפילה את כל המסך.
      const split = splitParentName({ name: student.name, lastName: student.lastName });
      setEditStudentFirstName(split.first);
      setEditStudentLastName(split.lastName);
    }
    setEditBirthDate(student.birthDate || '');
    setEditStudentPhone(student.phone || '');
    setEditGender(student.gender || '');
    setEditStudentNotes(student.notes || '');
    setEditSegment(student.segment || '');
    setEditNextFollowup(student.nextFollowup || '');
    setEditGroupIds(studentGroupIds(student));
    setEditProgramEligible(programEligibility.some((row) => ['returning', 'approved'].includes(String(row.status || ''))));
    const nextParentName = parentNameParts(parent);
    setEditParentName(nextParentName.firstName);
    setEditParentLastName(nextParentName.lastName);
    setEditParentIdNumber(parent?.idNumber || '');
    setEditPhone(parent?.phone || '');
    setEditEmail(parent?.email || '');
    setEditCity(parent?.city || '');
    setEditParentGender(parent?.gender || '');
    setEditParentNotes(parent?.notes || '');
    setEditSource(parent?.source || student.source || 'unknown');
    setIsEditing(false);
    setEditFocus('student');
    setEditError('');
    setEditingGroup(false);
    setEditingFollowup(false);
    setOpenFolder(null);
    setDocumentKindFilter('all');
    setShowHealthSendModal(false);
    setShowPaymentModal(false);
    setShowAddChild(false);
    setRemoveChildError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student.id, parent?.id]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('pendingHealthSend');
      if (!raw) return;
      const pending = JSON.parse(raw);
      if (pending?.studentId && pending.studentId === student.id) {
        setHealthSendMsg(pending.msg || '');
        setHealthSendLink(pending.link || '');
        setOpenFolder('health');
        sessionStorage.removeItem('pendingHealthSend');
      }
    } catch { /* ignore */ }
  }, [student.id]);

  // Opening a folder collapses the previous one, which used to shift the whole
  // column. We remember where the clicked header sat and put it back after the
  // re-render, so the page stays still under the cursor.
  const foldersScrollRef = useRef(null);
  const folderAnchorRef = useRef(null);

  const toggleFolder = (id) => {
    const container = foldersScrollRef.current;
    const row = container?.querySelector(`[data-folder-id="${id}"]`);
    folderAnchorRef.current = row ? { id, top: row.getBoundingClientRect().top } : null;
    setOpenFolder((cur) => (cur === id ? null : id));
  };

  const openFolderView = (id, { documentFilter, testFilter } = {}) => {
    const container = foldersScrollRef.current;
    const row = container?.querySelector(`[data-folder-id="${id}"]`);
    folderAnchorRef.current = row ? { id, top: row.getBoundingClientRect().top } : null;
    if (documentFilter) setDocumentKindFilter(documentFilter);
    if (testFilter) setTestKindFilter(testFilter);
    setOpenFolder(id);
  };

  useLayoutEffect(() => {
    const anchor = folderAnchorRef.current;
    folderAnchorRef.current = null;
    const container = foldersScrollRef.current;
    if (!anchor || !container) return;
    const row = container.querySelector(`[data-folder-id="${anchor.id}"]`);
    if (!row) return;
    const drift = row.getBoundingClientRect().top - anchor.top;
    if (drift) container.scrollTop += drift;
  }, [openFolder]);

  useEffect(() => {
    const decls = knownDeclarations;
        const phoneKey = normPhone(parent?.phone);
        const studentName = String(student.name || '').trim();
        const studentFirst = studentName.split(/\s+/)[0] || '';
        const matchesStudent = (d) => {
          if (d.studentId && d.studentId === student.id) return true;
          const climber = String(d.climberName || d.studentName || '').trim();
          const climberFirst = climber.split(/\s+/)[0] || '';
          if (phoneKey && phoneTailMatch(d.phone, parent?.phone)) {
            if (!climber || climber === studentName || (studentFirst && climberFirst === studentFirst)) return true;
          }
          if (climber && climber === studentName) return true;
          return false;
        };
        const match = (decls || []).find(matchesStudent);
        // Every declaration this student holds, newest first. A family can have
        // one per legal scope — wall activity or trip — and the file has to
        // show which of them are signed, not just that something is.
        const mine = (decls || []).filter(matchesStudent);
        mine.sort((a, b) => String(b.signedDate || b.date || '').localeCompare(String(a.signedDate || a.date || '')));
        setStudentDeclarations(mine);
        setHealthDecl(match || null);
        // Keep list/card in sync when declaration exists but student cache is stale
        if (match && onUpdateStudent && !student.healthSignedAt) {
          onUpdateStudent(student.id, {
            healthSignedAt: match.signedDate || match.date || new Date().toISOString(),
            waiverSignedAt: match.signedDate || match.date || new Date().toISOString(),
          });
        }
  }, [knownDeclarations, student.id, student.name, student.status, student.healthSignedAt, parent?.phone, onUpdateStudent]);

  useEffect(() => {
    fetch('/api/form-templates')
      .then(res => res.ok ? res.json() : [])
      .then(list => {
        // Event/birthday used to be a third waiver. Old signatures remain in
        // history, but staff can only send the two canonical scopes now.
        const active = (list || []).filter((template) => (
          template.isActive !== false
          && !['event', 'birthday'].includes(String(template.slug || '').toLowerCase())
          && ['wall', 'trip'].includes(templateKind(template).key)
        ));
        setFormTemplates(active);
        const def = active.find(t => t.isDefault) || active[0];
        if (def) setSelectedFormSlug(def.slug);
      })
      .catch(() => setFormTemplates([]));
  }, []);

  useEffect(() => {
    if (parentOnly || !student?.id) {
      setParticipationWaivers([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/students/${encodeURIComponent(student.id)}/participation-waivers`)
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => {
        if (!cancelled) setParticipationWaivers(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setParticipationWaivers([]);
      });
    return () => { cancelled = true; };
    // knownDeclarations only changes when the server feed actually changed
    // (the page-level refresh compares bytes) — a form signed while this card
    // is open lands here without closing and reopening the file.
  }, [parentOnly, student.id, knownDeclarations]);

  const healthOnlySelected = selectedFormSlug === 'health-renewal';
  const selectedTemplate = healthOnlySelected
    ? null
    : (formTemplates.find(t => t.slug === selectedFormSlug)
      || formTemplates.find(t => t.isDefault)
      || formTemplates[0]);
  const healthPath = selectedTemplate && !selectedTemplate.isDefault
    ? `/register/${selectedTemplate.slug}`
    : '/register';
  // WhatsApp-shareable public links (never localhost)
  const healthShareUrl = buildShareHealthLink(student.id, parent?.phone, healthPath, {
    healthOnly: healthOnlySelected,
  });
  // Signed if status says so, declaration exists, or durable timestamp was saved on the student
  const isHealthSigned = student.status === 'health_signed'
    || !!student.healthSignedAt
    || !!student.waiverSignedAt
    || !!(healthDecl && (healthDecl.signed || healthDecl.status === 'approved' || healthDecl.waiverAccepted));
  // Declarations expire together every two years, at the end of July (even years)
  const healthSignedOn = healthDecl?.signedDate || healthDecl?.date
    || student.healthSignedAt || student.waiverSignedAt || null;
  const healthExpiry = healthExpiryDate(healthSignedOn);
  const healthExpired = isHealthSigned && !!healthExpiry && healthExpiry.getTime() < Date.now();

  useEffect(() => {
    if (parentOnly || !student?.id) {
      setClientDocuments([]);
      setDocsLoading(false);
      return;
    }
    let cancelled = false;
    setClientDocuments([]);
    setDocsLoading(true);
    fetch(`/api/students/${encodeURIComponent(student.id)}/documents`)
      .then((res) => (res.ok ? res.json() : []))
      .then((docs) => {
        if (!cancelled) setClientDocuments(Array.isArray(docs) ? docs : []);
      })
      .catch(() => {
        if (!cancelled) setClientDocuments([]);
      })
      .finally(() => {
        if (!cancelled) setDocsLoading(false);
      });
    return () => { cancelled = true; };
    // Refetched when the declarations feed changes so a PDF created for a
    // just-signed form shows up in the open folder on its own.
  }, [parentOnly, student.id, knownDeclarations]);

  // Backfill a personal-file PDF for every signed declaration that still has
  // none. The old check stopped at "any health PDF on the file", so a trip
  // signed after the wall never got a row — the icon went green, the folder
  // stayed empty for that activity.
  const pdfBackfillRef = useRef(new Set());
  useEffect(() => {
    if (parentOnly || !student?.id || docsLoading) return;
    const missing = studentDeclarations.filter((decl) => {
      if (!decl?.id) return false;
      if (!(decl.signed || decl.status === 'approved' || decl.waiverAccepted)) return false;
      if (clientDocuments.some((d) => d.declarationId === decl.id && d.type === 'health_waiver_pdf')) return false;
      if (pdfBackfillRef.current.has(decl.id)) return false;
      return true;
    });
    if (!missing.length) return;

    let cancelled = false;
    (async () => {
      let uploadedAny = false;
      for (const decl of missing) {
        if (cancelled) break;
        pdfBackfillRef.current.add(decl.id);
        try {
          const { blob, fileName } = await buildHealthDeclarationPdf(decl);
          const pdfBase64 = await blobToBase64(blob);
          const res = await fetch(`/api/health-declarations/${encodeURIComponent(decl.id)}/pdf`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pdfBase64, fileName }),
          });
          if (!res.ok) {
            pdfBackfillRef.current.delete(decl.id);
            continue;
          }
          uploadedAny = true;
        } catch {
          pdfBackfillRef.current.delete(decl.id);
        }
      }
      if (!uploadedAny || cancelled) return;
      const docsRes = await fetch(`/api/students/${encodeURIComponent(student.id)}/documents`);
      const docs = docsRes.ok ? await docsRes.json() : [];
      if (!cancelled) setClientDocuments(Array.isArray(docs) ? docs : []);
    })();

    return () => { cancelled = true; };
  }, [parentOnly, student.id, studentDeclarations, docsLoading, clientDocuments]);

  const openPersonalWhatsApp = (message) => {
    const digits = String(parent?.phone || '').replace(/[^\d]/g, '');
    if (!digits) return;
    const intl = digits.startsWith('972') ? digits : `972${digits.replace(/^0/, '')}`;
    window.open(`https://wa.me/${intl}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const sendHealthFormForStudent = async (targetStudentId, targetStudentName) => {
    if (!parent?.phone || !targetStudentId) {
      return { sent: false, link: '', warning: 'אין מספר טלפון לשליחה' };
    }
    const fallbackLink = buildShareHealthLink(targetStudentId, parent?.phone, healthPath, {
      healthOnly: healthOnlySelected,
    });
    try {
      const res = await fetch(`/api/leads/${encodeURIComponent(targetStudentId)}/send-health-form`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: window.location.origin,
          templateSlug: selectedTemplate?.slug || selectedFormSlug || undefined,
          healthOnly: healthOnlySelected,
          mode: healthOnlySelected ? 'health-renewal' : 'full',
          // The parent whose tab is open, not the file's primary parent: the
          // message belongs in the conversation staff are actually in.
          parentId: parent?.id || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      const link = data.healthUrl || fallbackLink;
      if (!data.sent) {
        openPersonalWhatsApp(buildHealthWhatsAppText(parent.name, targetStudentName, link, {
          healthOnly: healthOnlySelected,
        }));
      }
      return {
        sent: !!data.sent,
        link,
        sentTo: data.sentTo || parent.name || '',
        warning: data.sent ? undefined : (data.warning || data.error || 'השליחה האוטומטית נכשלה'),
      };
    } catch {
      openPersonalWhatsApp(buildHealthWhatsAppText(parent.name, targetStudentName, fallbackLink, {
        healthOnly: healthOnlySelected,
      }));
      return { sent: false, link: fallbackLink, warning: 'השליחה האוטומטית נכשלה' };
    }
  };

  const handleSendHealthForm = async () => {
    if (!parent?.phone) {
      setHealthSendMsg('אין מספר טלפון לשליחה');
      setHealthSendLink('');
      return;
    }
    setSendingHealth(true);
    setHealthSendMsg('');
    setHealthSendLink('');
    try {
      const result = await sendHealthFormForStudent(student.id, student.name);
      setHealthSendLink(result.link || healthShareUrl);
      if (result.sent) {
        const formLabel = healthOnlySelected
          ? 'חידוש הצהרת בריאות'
          : selectedTemplate
          ? templateShortLabel(selectedTemplate)
          : FORM_SHORT;
        setHealthSendMsg(result.sentTo
          ? `נשלח קישור ל${formLabel} בוואטסאפ ל${result.sentTo}`
          : `נשלח קישור ל${formLabel} בוואטסאפ`);
      } else {
        setHealthSendMsg(
          result.warning
            || 'השליחה האוטומטית נכשלה — העתיקו את הקישור או שלחו מוואטסאפ אישי'
        );
      }
      setShowHealthSendModal(false);
    } finally {
      setSendingHealth(false);
    }
  };

  // iCount Billing Fields
  const [billAmount, setBillAmount] = useState('');
  const [billDescription, setBillDescription] = useState('');
  const [billingStudentId, setBillingStudentId] = useState(parentOnly ? '' : String(student.id));
  const [selectedPricelistItem, setSelectedPricelistItem] = useState('');
  // The catalogue is picked here the same way it is at the till: categories
  // first, products inside the one you opened.
  const [billCategory, setBillCategory] = useState('');
  const [catalogCategories, setCatalogCategories] = useState(
    PRODUCT_CATEGORIES.map((name) => ({ name, image: '' }))
  );
  const [billingLoading, setBillingLoading] = useState(false);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [billingLink, setBillingLink] = useState('');
  const [lastInvoice, setLastInvoice] = useState(null);
  const [studentPayments, setStudentPayments] = useState([]);
  const [paymentMenuId, setPaymentMenuId] = useState(null);
  const [paymentBusyKey, setPaymentBusyKey] = useState('');
  const [paymentActionError, setPaymentActionError] = useState('');
  const [paymentActionOk, setPaymentActionOk] = useState('');

  // Level Test Fields
  const [testLevel, setTestLevel] = useState('5A');
  const [testType, setTestType] = useState('level'); // level | security | lead
  const [testRouteStyle, setTestRouteStyle] = useState('top-rope'); // top-rope | lead (level tests only)
  const [testExaminerId, setTestExaminerId] = useState('');
  const [testNotes, setTestNotes] = useState('');
  const [testPassed, setTestPassed] = useState(true);
  const [testDate, setTestDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [testLoading, setTestLoading] = useState(false);
  const [showTestForm, setShowTestForm] = useState(false);
  const [editingTestId, setEditingTestId] = useState(null);
  const [testKindFilter, setTestKindFilter] = useState('all');
  const [levelTestsHistory, setLevelTestsHistory] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [attendanceHistory, setAttendanceHistory] = useState([]);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [activityHistory, setActivityHistory] = useState([]);
  const [activityHistoryLoading, setActivityHistoryLoading] = useState(false);
  const [activityDayBusy, setActivityDayBusy] = useState('');
  const [activityDayError, setActivityDayError] = useState('');
  const [activityActionBusy, setActivityActionBusy] = useState('');
  const [customerPasses, setCustomerPasses] = useState([]);
  const [guardians, setGuardians] = useState([]);
  const [settingPrimary, setSettingPrimary] = useState(false);
  const [showSplitFamily, setShowSplitFamily] = useState(false);
  const [splitHousehold, setSplitHousehold] = useState(null);
  const [splitAssignments, setSplitAssignments] = useState({});
  const [splitLoading, setSplitLoading] = useState(false);
  const [splitSaving, setSplitSaving] = useState(false);
  const [splitError, setSplitError] = useState('');
  const [showMergeFamily, setShowMergeFamily] = useState(false);
  const [mergeQuery, setMergeQuery] = useState('');
  const [mergeResults, setMergeResults] = useState([]);
  const [mergeSearching, setMergeSearching] = useState(false);
  const [mergeSearched, setMergeSearched] = useState(false);
  const [mergeSavingId, setMergeSavingId] = useState('');
  const [mergeError, setMergeError] = useState('');
  const [passesLoading, setPassesLoading] = useState(false);
  const [punchingId, setPunchingId] = useState(null);
  const [passPunches, setPassPunches] = useState({});
  const [openPunchLog, setOpenPunchLog] = useState('');
  const [cancellingPunchId, setCancellingPunchId] = useState('');
  const [equipmentItems, setEquipmentItems] = useState([]);
  const [equipmentLoading, setEquipmentLoading] = useState(false);
  const [equipmentBusyId, setEquipmentBusyId] = useState('');
  const [equipmentMsg, setEquipmentMsg] = useState('');
  const [equipmentLink, setEquipmentLink] = useState('');
  const [equipmentEditId, setEquipmentEditId] = useState('');
  const [coupons, setCoupons] = useState([]);
  const [couponsLoading, setCouponsLoading] = useState(false);
  const [couponBusyId, setCouponBusyId] = useState('');
  const [showIssueCoupon, setShowIssueCoupon] = useState(false);
  const [couponDraft, setCouponDraft] = useState({ ...EMPTY_COUPON_DRAFT });
  const [couponError, setCouponError] = useState('');
  const [sales, setSales] = useState([]);
  const [salesLoading, setSalesLoading] = useState(false);
  const billableStudents = (siblings || []).filter((member) => !isParentOnlyLead(member));
  const billingStudent = billableStudents.find(
    (member) => String(member.id) === String(billingStudentId)
  ) || (!parentOnly ? student : null);

  useEffect(() => {
    if (!parentOnly) setBillingStudentId(String(student.id));
  }, [parentOnly, student.id]);
  // Every real trainee has equipment: children get shoes, shirt and chalk;
  // adult trainees get shoes and chalk. Only a parent-only placeholder has no kit.
  const showEquipment = !parentOnly;

  // What was actually bought — counter sales and payment links alike. Payments
  // only shows the charge; this shows the goods behind it.
  const refreshSales = async () => {
    const params = new URLSearchParams();
    if (parent?.id) params.set('parentId', parent.id);
    if (!parentOnly && student?.id) params.set('studentId', student.id);
    if (!params.toString()) {
      setSales([]);
      return;
    }
    setSalesLoading(true);
    try {
      const data = await fetch(`/api/pos/sales?${params}`).then((r) => (r.ok ? r.json() : []));
      setSales(Array.isArray(data) ? data : []);
    } catch {
      setSales([]);
    } finally {
      setSalesLoading(false);
    }
  };

  // Benefits follow the family: a campaign issues against the customer card,
  // manual ones may be tied to one trainee.
  const refreshCoupons = async () => {
    const params = new URLSearchParams();
    if (parent?.id) params.set('parentId', parent.id);
    if (!parentOnly && student?.id) params.set('studentId', student.id);
    if (!params.toString()) {
      setCoupons([]);
      return;
    }
    setCouponsLoading(true);
    try {
      const data = await fetch(`/api/coupons?${params}`).then((r) => (r.ok ? r.json() : []));
      setCoupons(Array.isArray(data) ? data : []);
    } catch {
      setCoupons([]);
    } finally {
      setCouponsLoading(false);
    }
  };

  const handleIssueCoupon = async () => {
    setCouponError('');
    setCouponBusyId('issue');
    try {
      const res = await fetch('/api/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentId: parent?.id || null,
          studentId: parentOnly ? null : student?.id || null,
          recurring: Boolean(couponDraft.recurring),
          offer: {
            type: couponDraft.type,
            value: Number(couponDraft.value) || 0,
            units: couponDraft.recurring ? 50 : (Number(couponDraft.units) || 1),
            validityDays: Number(couponDraft.validityDays) || 30,
            noExpiry: Boolean(couponDraft.noExpiry),
            // An untyped name still reads correctly, so nobody ends up with a
            // benefit called "50% הנחה" when it only covers one product.
            label: couponDraft.label.trim() || suggestedCouponLabel(couponDraft, pricelist),
            appliesTo: couponDraft.pricelistId ? 'items' : 'all',
            pricelistIds: couponDraft.pricelistId ? [String(couponDraft.pricelistId)] : [],
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'הנפקת ההטבה נכשלה');
      setShowIssueCoupon(false);
      setCouponDraft({ ...EMPTY_COUPON_DRAFT });
      await refreshCoupons();
    } catch (err) {
      setCouponError(err.message);
    } finally {
      setCouponBusyId('');
    }
  };

  const handleCancelCoupon = async (coupon) => {
    if (!window.confirm(`לבטל את ההטבה ${coupon.code}?`)) return;
    setCouponBusyId(coupon.id);
    try {
      await fetch(`/api/coupons/${coupon.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'בוטל מתיק הלקוח' }),
      });
      await refreshCoupons();
    } finally {
      setCouponBusyId('');
    }
  };

  const refreshPasses = async () => {
    if (parentOnly || !student?.id) {
      setCustomerPasses([]);
      return;
    }
    setPassesLoading(true);
    try {
      const data = await fetch(`/api/pos/passes?studentId=${encodeURIComponent(student.id)}`)
        .then((r) => (r.ok ? r.json() : []));
      setCustomerPasses(Array.isArray(data) ? data : []);
    } catch {
      setCustomerPasses([]);
    } finally {
      setPassesLoading(false);
    }
  };

  /** Primary belongs to the family anchor, never to whichever profile is open. */
  const handleMakePrimary = async (targetParentId = parent?.id) => {
    const targetStudentId = primaryAnchorStudent?.id || student?.id;
    if (!targetStudentId || !targetParentId || settingPrimary) return;
    setSettingPrimary(true);
    try {
      const response = await fetch(
        `/api/students/${encodeURIComponent(targetStudentId)}/guardians/${encodeURIComponent(targetParentId)}/primary`,
        { method: 'PUT' }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'עדכון ההורה הראשי נכשל');
      }
      setFamilyPrimaryParentId(String(targetParentId));
      await refreshGuardians();
      refreshData?.();
    } catch (err) {
      alert(err.message);
    } finally {
      setSettingPrimary(false);
    }
  };

  /** Load the whole household so staff can re-assign every child in one step. */
  const openSplitFamily = async () => {
    const anchorId = parent?.id || primaryParent?.id;
    if (!anchorId) return;
    setShowSplitFamily(true);
    setSplitLoading(true);
    setSplitError('');
    setSplitHousehold(null);
    setSplitAssignments({});
    try {
      const response = await fetch(`/api/parents/${encodeURIComponent(anchorId)}/household`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'טעינת משק הבית נכשלה');
      const parentsList = Array.isArray(body.parents) ? body.parents : [];
      const childrenList = Array.isArray(body.children) ? body.children : [];
      setSplitHousehold({ parents: parentsList, children: childrenList });
      const initial = {};
      childrenList.forEach((child) => {
        initial[child.id] = child.parentId || '';
      });
      setSplitAssignments(initial);
    } catch (err) {
      setSplitError(err.message);
    } finally {
      setSplitLoading(false);
    }
  };

  const handleSplitFamily = async () => {
    const anchorId = parent?.id || primaryParent?.id;
    if (!anchorId || !splitHousehold || splitSaving) return;
    const missing = splitHousehold.children.filter((child) => !splitAssignments[child.id]);
    if (missing.length) {
      setSplitError(`יש לבחור הורה עבור: ${missing.map((c) => c.name).join(', ')}`);
      return;
    }
    setSplitSaving(true);
    setSplitError('');
    try {
      const response = await fetch(`/api/parents/${encodeURIComponent(anchorId)}/split-family`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignments: splitHousehold.children.map((child) => ({
            studentId: child.id,
            parentId: splitAssignments[child.id],
          })),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'פיצול המשפחה נכשל');
      setShowSplitFamily(false);
      const keptParentId = splitAssignments[student.id];
      if (keptParentId) setActiveParentId(keptParentId);
      await refreshGuardians();
      refreshData?.();
    } catch (err) {
      setSplitError(err.message);
    } finally {
      setSplitSaving(false);
    }
  };

  const householdAnchorId = parent?.id || primaryParent?.id || '';

  const openMergeFamily = () => {
    setShowMergeFamily(true);
    setMergeQuery('');
    setMergeResults([]);
    setMergeSearched(false);
    setMergeError('');
  };

  /** Search as the desk types — by parent name, phone, or a child's name. */
  useEffect(() => {
    if (!showMergeFamily || !householdAnchorId) return undefined;
    const query = mergeQuery.trim();
    if (query.length < 2) {
      setMergeResults([]);
      setMergeSearched(false);
      return undefined;
    }
    let cancelled = false;
    setMergeSearching(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/parents/${encodeURIComponent(householdAnchorId)}/merge-candidates?q=${encodeURIComponent(query)}`
        );
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) throw new Error(body.error || 'החיפוש נכשל');
        setMergeResults(Array.isArray(body.families) ? body.families : []);
        setMergeError('');
      } catch (err) {
        if (!cancelled) {
          setMergeResults([]);
          setMergeError(err.message);
        }
      } finally {
        if (!cancelled) {
          setMergeSearching(false);
          setMergeSearched(true);
        }
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [showMergeFamily, mergeQuery, householdAnchorId]);

  /** Join the two households into one customer row — undone by "פיצול משפחה". */
  const handleMergeFamily = async (family) => {
    if (!householdAnchorId || mergeSavingId) return;
    const childList = family.children.length ? ` (${family.children.join(', ')})` : '';
    if (!confirm(`לאחד את המשפחה של ${family.parent_name}${childList} עם ${parentDisplayName(parent) || 'הלקוח הזה'}? כל ההורים יופיעו על כל הילדים. אפשר לבטל אחר כך בפיצול משפחה.`)) return;
    setMergeSavingId(family.parent_id);
    setMergeError('');
    try {
      const response = await fetch(`/api/parents/${encodeURIComponent(householdAnchorId)}/merge-family`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otherParentId: family.parent_id }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'מיזוג המשפחות נכשל');
      setShowMergeFamily(false);
      await refreshGuardians();
      refreshData?.();
    } catch (err) {
      setMergeError(err.message);
    } finally {
      setMergeSavingId('');
    }
  };

  /** Every parent on this child's file — mum and dad each keep their own card. */
  const refreshGuardians = async () => {
    if (parentOnly || !student?.id) {
      setGuardians([]);
      return;
    }
    try {
      const body = await fetch(`/api/students/${encodeURIComponent(student.id)}/guardians`)
        .then((r) => (r.ok ? r.json() : { guardians: [] }));
      setGuardians(Array.isArray(body.guardians) ? body.guardians : []);
    } catch {
      setGuardians([]);
    }
  };

  const refreshEquipment = async () => {
    if (!showEquipment || !student?.id) {
      setEquipmentItems([]);
      return;
    }
    setEquipmentLoading(true);
    try {
      const res = await fetch(`/api/students/${encodeURIComponent(student.id)}/equipment`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'טעינת ציוד נכשלה');
      setEquipmentItems(Array.isArray(body.items) ? body.items : []);
    } catch {
      setEquipmentItems([]);
    } finally {
      setEquipmentLoading(false);
    }
  };

  useEffect(() => {
    refreshEquipment();
    setEquipmentMsg('');
    setEquipmentLink('');
    setEquipmentEditId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student.id, student.isAdult, parentOnly]);

  const handleEquipmentSetStatus = async (item, targetTone) => {
    if (!item?.id) return;
    setEquipmentBusyId(item.id);
    setEquipmentMsg('');
    try {
      await applyEquipmentTone(item.id, targetTone, { currentItem: item });
      await refreshEquipment();
      // הפאנל נשאר פתוח: סגירתו מקצרת את התיק בדיוק ברגע הלחיצה
      // ומזיזה את כל מה שמתחתיו. הסטטוס החדש מסומן „נוכחי”.
      setEquipmentMsg(`עודכן ל„${equipmentToneLabel(targetTone, item.item_type)}”`);
    } catch (err) {
      setEquipmentMsg(err.message);
    } finally {
      setEquipmentBusyId('');
    }
  };

  const handleSendEquipmentLink = async () => {
    setEquipmentBusyId('link');
    setEquipmentMsg('');
    setEquipmentLink('');
    try {
      const res = await fetch(`/api/students/${encodeURIComponent(student.id)}/equipment/payment-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sendWhatsapp: true, preferredParentId: parent?.id || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `יצירת הקישור נכשלה (${res.status})`);
      }
      setEquipmentLink(body.pageUrl || '');
      if (body.pageUrl) {
        try { await navigator.clipboard.writeText(body.pageUrl); } catch { /* ignore */ }
      }
      setEquipmentMsg(
        body.whatsappSent
          ? 'הקישור נשלח בוואטסאפ'
          : (body.whatsappError || 'הקישור נוצר — העתיקו ושילחו ידנית')
      );
    } catch (err) {
      setEquipmentMsg(err.message || 'יצירת הקישור נכשלה');
    } finally {
      setEquipmentBusyId('');
    }
  };

  // Fetch student attendance history for the client dossier
  useEffect(() => {
    if (parentOnly || !student?.id) {
      setAttendanceHistory([]);
      return;
    }
    let cancelled = false;
    setAttendanceLoading(true);
    fetch(`/api/attendance?studentId=${encodeURIComponent(student.id)}&cached=1`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (cancelled) return;
        const rows = (Array.isArray(data) ? data : [])
          .slice()
          .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
        setAttendanceHistory(rows);
      })
      .catch(() => {
        if (!cancelled) setAttendanceHistory([]);
      })
      .finally(() => {
        if (!cancelled) setAttendanceLoading(false);
      });
    return () => { cancelled = true; };
  }, [parentOnly, student.id]);

  // Keep the dossier in sync after an inline status edit, so the absence
  // streak above the folders reflects the change without a reload.
  const handleAttendanceStatusSaved = (rowId, status, savedRow) => {
    setAttendanceHistory((prev) => prev.map((row) => (
      row.id === rowId ? { ...row, ...(savedRow || {}), status } : row
    )));
  };

  useEffect(() => {
    if (parentOnly || !student?.id) {
      setActivityHistory([]);
      return;
    }
    let cancelled = false;
    setActivityHistoryLoading(true);
    fetch(`/api/students/${encodeURIComponent(student.id)}/activity-registrations?cached=1`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!cancelled) setActivityHistory(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setActivityHistory([]);
      })
      .finally(() => {
        if (!cancelled) setActivityHistoryLoading(false);
      });
    return () => { cancelled = true; };
  }, [parentOnly, student.id]);

  // Marking a day here writes the same row the activity's attendance list does.
  const markActivityDay = async (row, date, status) => {
    setActivityDayBusy(`${row.id}|${date}`);
    setActivityDayError('');
    try {
      await saveActivityAttendance([{
        activity_id: row.activity_id,
        registration_id: row.id,
        date,
        status,
      }]);
      setActivityHistory((prev) => prev.map((item) => (
        item.id === row.id
          ? { ...item, days: (item.days || []).map((day) => (day.date === date ? { ...day, status } : day)) }
          : item
      )));
    } catch (err) {
      setActivityDayError(err.message || 'שמירת הנוכחות נכשלה');
    } finally {
      setActivityDayBusy('');
    }
  };

  // Removal and refund hit the same endpoints the activity screen uses, so a
  // participant cancelled here is indistinguishable from one cancelled there.
  const applyActivityRegistrationPatch = (rowId, patch) => {
    // A cancelled registration stops counting for attendance, so its day rows go too.
    setActivityHistory((prev) => prev.map((item) => (
      item.id === rowId ? { ...item, ...patch, days: [] } : item
    )));
  };

  const removeActivityRegistration = async (row) => {
    const paidNote = row.payment_status === 'paid'
      ? '\n\nשימו לב: יש תשלום ששולם. ההסרה לא מזכה אותו — לזיכוי יש להשתמש בכפתור הזיכוי.'
      : '';
    const ok = window.confirm(
      `להסיר את ${student.name || 'המשתתף'} מ"${row.activity_name}"?${paidNote}`
    );
    if (!ok) return;
    setActivityActionBusy(row.id);
    setActivityDayError('');
    try {
      const res = await fetch(
        `/api/activities/${encodeURIComponent(row.activity_id)}/registrations/${encodeURIComponent(row.id)}`,
        { method: 'DELETE' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActivityDayError(data.error || 'הסרת המשתתף נכשלה');
        return;
      }
      applyActivityRegistrationPatch(row.id, { status: 'cancelled', status_label: 'בוטל' });
    } catch {
      setActivityDayError('שגיאת רשת');
    } finally {
      setActivityActionBusy('');
    }
  };

  const refundActivityRegistration = async (row) => {
    const name = student.name || 'המשתתף';
    setActivityActionBusy(`refund:${row.id}`);
    setActivityDayError('');
    try {
      const previewRes = await fetch(
        `/api/activities/${encodeURIComponent(row.activity_id)}/registrations/${encodeURIComponent(row.id)}/refund-preview`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      );
      const preview = await previewRes.json().catch(() => ({}));
      if (!previewRes.ok) {
        setActivityDayError(preview.error || 'חישוב ההחזר נכשל');
        return;
      }
      const recommended = Number(preview.recommendation?.amount) || 0;
      if (preview.manual_partial_refund_required) {
        const openIcount = window.confirm(
          `ההחזר המומלץ עבור ${name}: ₪${recommended.toLocaleString()}\n\n` +
          'זהו זיכוי חלקי. כדי למנוע זיכוי מלא בטעות, יש לבצע אותו במסמך המקורי ב-iCount. לפתוח אותו עכשיו?'
        );
        if (openIcount && preview.icount_doc_app_url) {
          window.open(preview.icount_doc_app_url, '_blank', 'noopener,noreferrer');
        }
        setActivityDayError(`החזר מומלץ עבור ${name}: ₪${recommended.toLocaleString()} · נדרש זיכוי חלקי ב-iCount`);
        return;
      }
      // A group order shares one payment — refunding it cancels the siblings too,
      // and from the child's card that is easy to miss. Spell it out first.
      const sharedNote = preview.shared_payment
        ? `\n\nהתשלום משותף להרשמות של: ${(preview.participant_names || []).join(', ')} — כולן יזוכו ויבוטלו יחד.`
        : '';
      const ok = window.confirm(
        `החזר מומלץ עבור ${name}: ₪${recommended.toLocaleString()}${sharedNote}\n\n` +
        'לאחר האישור יבוצע זיכוי מלא וההרשמה תבוטל. פעולה זו לא ניתנת לביטול מהמערכת.'
      );
      if (!ok) return;
      const res = await fetch(
        `/api/activities/${encodeURIComponent(row.activity_id)}/registrations/${encodeURIComponent(row.id)}/refund`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reason: `זיכוי משתתף · ${name}`,
            approved_amount: recommended,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActivityDayError(data.error || 'הזיכוי נכשל');
        return;
      }
      applyActivityRegistrationPatch(row.id, {
        status: 'cancelled',
        status_label: 'זוכה',
        payment_status: 'refunded',
      });
    } catch {
      setActivityDayError('שגיאת רשת');
    } finally {
      setActivityActionBusy('');
    }
  };

  useEffect(() => {
    refreshPasses();
    refreshGuardians();
    setOpenPunchLog('');
    setPassPunches({});
  }, [parentOnly, student.id]);

  useEffect(() => {
    refreshCoupons();
    setShowIssueCoupon(false);
    setCouponError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentOnly, student.id, parent?.id]);

  useEffect(() => {
    refreshSales();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentOnly, student.id, parent?.id]);

  // הניקוב הוא אישור הצוות בדלפק שהמתאמן יכול לטפס, ולכן הוא סגור למי
  // שאין לו הצהרת בריאות והסרת אחריות בתוקף או מבחן אבטחה בתוקף. השרת
  // אוכף את אותו כלל ב-punchPass; כאן זה רק כדי שהחסימה תיראה לפני
  // הלחיצה ולא אחריה.
  const punchSafety = safetyTestStatus(levelTestsHistory);
  const punchBlockers = [];
  if (!isHealthSigned) punchBlockers.push(`אין ${FORM_SHORT} בתוקף`);
  else if (healthExpired) punchBlockers.push(`${FORM_SHORT} פג תוקף`);
  if (punchSafety.state === 'missing') punchBlockers.push('אין מבחן אבטחה');
  else if (punchSafety.state === 'expired') punchBlockers.push('מבחן האבטחה פג תוקף');
  const punchBlockReason = punchBlockers.join(' · ');

  const handlePunchPass = async (passId) => {
    if (punchBlockReason) {
      alert(`אי אפשר לנקב: ${punchBlockReason}. יש להשלים לפני הטיפוס.`);
      return;
    }
    if (!window.confirm('לנקב כניסה אחת מהכרטיסייה?')) return;
    setPunchingId(passId);
    try {
      const res = await fetch(`/api/pos/passes/${passId}/punch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'customer_card', student_id: student.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'ניקוב נכשל');
      await refreshPasses();
      await reloadPassPunches(passId);
      setOpenPunchLog(passId);
    } catch (err) {
      alert(err.message || 'ניקוב נכשל');
    } finally {
      setPunchingId(null);
    }
  };

  const reloadPassPunches = async (passId) => {
    const punches = await fetch(`/api/pos/passes/${passId}/punches`).then((r) => (r.ok ? r.json() : []));
    setPassPunches((prev) => ({ ...prev, [passId]: punches }));
  };

  const togglePassPunches = async (passId) => {
    if (openPunchLog === passId) {
      setOpenPunchLog('');
      return;
    }
    setOpenPunchLog(passId);
    if (!passPunches[passId]) await reloadPassPunches(passId);
  };

  const handleCancelPunch = async (passId, punchId) => {
    if (!window.confirm('לבטל את הניקוב ולהחזיר כניסה אחת לכרטיסייה?')) return;
    setCancellingPunchId(punchId);
    try {
      const res = await fetch(`/api/pos/passes/${passId}/punches/${punchId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'בוטל מתיק הלקוח' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'ביטול הניקוב נכשל');
      await refreshPasses();
      await reloadPassPunches(passId);
    } catch (err) {
      alert(err.message || 'ביטול הניקוב נכשל');
    } finally {
      setCancellingPunchId('');
    }
  };

  // Fetch student level tests history. Loaded for everyone, not only billing
  // users: the punch button reads the safety test from here.
  useEffect(() => {
    fetch('/api/level-tests')
      .then(res => res.ok ? res.json() : [])
      .then(data => {
        const studentTests = (Array.isArray(data) ? data : []).filter(t => t.studentId === student.id);
        setLevelTestsHistory(studentTests);
      })
      .catch(err => console.error(err));
  }, [student.id]);

  // Fetch employees for examiner picker (security / lead tests)
  useEffect(() => {
    if (!canManageBilling) return;
    fetch('/api/employees')
      .then(res => res.ok ? res.json() : [])
      .then(data => {
        const list = Array.isArray(data)
          ? data.filter((employee) => employee?.is_active !== false && employee?.active !== false)
          : [];
        setEmployees(list);
        if (list.length > 0) setTestExaminerId(prev => prev || list[0].id);
      })
      .catch(err => console.error(err));
  }, [canManageBilling]);

  useEffect(() => {
    if (!parent?.id) return;
    setEditingBroadcastLists(false);
    setLoadingLists(true);
    Promise.all([
      fetch('/api/broadcast-list-defs').then((res) => (res.ok ? res.json() : null)),
      fetch(`/api/parents/${parent.id}/broadcast-lists`).then((res) => (res.ok ? res.json() : null)),
    ])
      .then(([defs, subscriptions]) => {
        if (Array.isArray(defs) && defs.length > 0) setBroadcastListDefs(defs);
        if (subscriptions) setBroadcastLists(subscriptions);
      })
      .catch((err) => console.error(err))
      .finally(() => setLoadingLists(false));
  }, [parent?.id]);

  const handleListToggle = async (listKey) => {
    if (!parent?.id) return;
    const currentlyOn = broadcastLists[listKey] !== false;
    const nextLists = { ...broadcastLists, [listKey]: !currentlyOn };
    setBroadcastLists(nextLists);
    try {
      await fetch(`/api/parents/${parent.id}/broadcast-lists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextLists)
      });
    } catch (err) {
      console.error('Failed to update broadcast lists:', err);
    }
  };

  const handleAddChild = async (e) => {
    e.preventDefault();
    const name = newChildName.trim();
    if (!name || !parent?.id || addingChild) return;
    setAddingChild(true);
    setAddChildError('');
    try {
      const res = await fetch(`/api/parents/${parent.id}/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAddChildError(data.error || 'שגיאה בהוספת מתאמן');
        return;
      }
      const newId = data.student?.id;
      if (sendHealthOnAdd && newId) {
        const sendResult = await sendHealthFormForStudent(newId, name);
        const pendingHealthLink = sendResult.link || '';
        const pendingHealthMsg = sendResult.sent
          ? `נשלח קישור ל${FORM_SHORT} בוואטסאפ ל${sendResult.sentTo || 'הורה'}`
          : (sendResult.warning
            || 'השליחה האוטומטית נכשלה — העתיקו את הקישור או שלחו מוואטסאפ אישי');
        if (pendingHealthLink) {
          try {
            sessionStorage.setItem('pendingHealthSend', JSON.stringify({
              studentId: newId,
              msg: pendingHealthMsg,
              link: pendingHealthLink,
            }));
          } catch { /* ignore */ }
        }
      }
      setShowAddChild(false);
      setNewChildName('');
      setSendHealthOnAdd(true);
      if (refreshData) await refreshData();
      if (newId) onSelectSibling?.(newId);
    } catch (err) {
      console.error(err);
      setAddChildError('לא ניתן להתחבר לשרת');
    } finally {
      setAddingChild(false);
    }
  };

  /** Trainees this contact can be attached to — the whole household, ticked by default. */
  const contactCandidates = (siblings || []).filter((sib) => !isParentOnlyLead(sib));

  const openAddContact = () => {
    setAddContactError('');
    setContactName('');
    setContactPhone('');
    setContactStudentIds(contactCandidates.map((sib) => String(sib.id)));
    setShowAddContact(true);
  };

  const handleAddContact = async (e) => {
    e.preventDefault();
    const name = contactName.trim();
    const phone = contactPhone.trim();
    if (!name || !phone || addingContact) return;
    if (!contactStudentIds.length) {
      setAddContactError('בחרו לפחות מתאמן אחד לשיוך');
      return;
    }
    setAddingContact(true);
    setAddContactError('');
    try {
      // One request for the whole household: two parallel ones would race into
      // two parent cards for the same phone.
      const res = await fetch(`/api/students/${encodeURIComponent(contactStudentIds[0])}/guardians`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, studentIds: contactStudentIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAddContactError(data.error || 'הוספת איש הקשר נכשלה');
        return;
      }
      setShowAddContact(false);
      await refreshGuardians();
      if (refreshData) await refreshData();
    } catch (err) {
      console.error(err);
      setAddContactError('לא ניתן להתחבר לשרת');
    } finally {
      setAddingContact(false);
    }
  };

  const handleRemoveChild = async (sib) => {
    if (removingChildId) return;
    const lastChild = siblings.length <= 1;
    const question = lastChild
      ? `להסיר את ${sib.name} מהרשימה? זה המתאמן היחיד, ולכן גם כרטיס ההורה יימחק. הפעולה אינה הפיכה.`
      : `להסיר את ${sib.name} מהרשימה? תיק המתאמן יימחק לצמיתות. הפעולה אינה הפיכה.`;
    if (!confirm(question)) return;
    setRemovingChildId(sib.id);
    setRemoveChildError('');
    try {
      const res = await fetch(`/api/students/${sib.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setRemoveChildError(data.error || 'שגיאה בהסרת המתאמן');
        return;
      }
      // Switch away before the refresh drops the deleted student from the list
      if (sib.id === student.id) {
        const next = siblings.find((s) => s.id !== sib.id);
        if (next) onSelectSibling?.(next.id);
        else onClose?.();
      }
      if (refreshData) await refreshData();
    } catch (err) {
      console.error(err);
      setRemoveChildError('לא ניתן להתחבר לשרת');
    } finally {
      setRemovingChildId('');
    }
  };

  const handleUpdateDetails = async () => {
    setSavingEdit(true);
    setEditError('');
    try {
      if (!parentOnly) {
        const studentFirst = editStudentFirstName.trim();
        const studentLast = editStudentLastName.trim();
        if (!studentFirst && !studentLast) {
          setEditError('יש למלא שם למתאמן');
          return;
        }
        const sRes = await fetch(`/api/students/${student.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // name המלא נשאר ליד השדה הנפרד — כל מה שמכיר רק אותו ממשיך לעבוד.
            name: joinParentName(studentFirst, studentLast),
            lastName: studentLast,
            birthDate: editBirthDate,
            phone: editStudentPhone.trim(),
            gender: editGender || null,
            notes: editStudentNotes,
            segment: editSegment || null,
            nextFollowup: editNextFollowup || null,
            groupIds: editGroupIds,
            source: editSource
          })
        });
        const sBody = await sRes.json().catch(() => ({}));
        if (!sRes.ok) {
          setEditError(sBody.error || 'שמירת פרטי המתאמן נכשלה');
          return;
        }
        onUpdateStudent?.(student.id, sBody);

        const eligibilityRes = await fetch(`/api/students/${student.id}/program-eligibility`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eligible: editProgramEligible }),
        });
        const eligibilityBody = await eligibilityRes.json().catch(() => ({}));
        if (!eligibilityRes.ok || !eligibilityBody.ok) {
          setEditError(eligibilityBody.error || 'שמירת הזכאות למתקדמים ולנבחרות נכשלה');
          return;
        }
        setProgramEligibility(Array.isArray(eligibilityBody.rows) ? eligibilityBody.rows : []);
      }

      if (parent?.id) {
        const first = editParentName.trim();
        const last = editParentLastName.trim();
        if (!first && !last) {
          setEditError('יש למלא שם להורה');
          return;
        }
        const pRes = await fetch(`/api/parents/${parent.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // Keep a readable full name next to the separate surname field.
            name: joinParentName(first, last),
            lastName: last,
            idNumber: editParentIdNumber.trim(),
            phone: editPhone,
            email: editEmail,
            city: editCity,
            gender: editParentGender || null,
            source: editSource,
            notes: editParentNotes,
            status: parentOnly ? student.status : undefined,
          })
        });
        const pBody = await pRes.json().catch(() => ({}));
        if (!pRes.ok) {
          setEditError(pBody.error || 'שמירת פרטי ההורה נכשלה');
          return;
        }
        onUpdateParent?.(parent.id, pBody);
      }

      setIsEditing(false);
      if (refreshData) await refreshData();
    } catch (err) {
      console.error('Failed to update details:', err);
      setEditError('לא ניתן להתחבר לשרת');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleSaveGroup = async () => {
    setSavingGroup(true);
    try {
      const res = await fetch(`/api/students/${student.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupIds: editGroupIds }),
      });
      if (res.ok) {
        const updated = await res.json();
        onUpdateStudent(student.id, updated);
        setEditingGroup(false);
        if (refreshData) refreshData();
      }
    } catch (err) {
      console.error('Failed to update group:', err);
    } finally {
      setSavingGroup(false);
    }
  };

  const handleSaveFollowup = async (value) => {
    setSavingFollowup(true);
    try {
      const endpoint = parentOnly
        ? `/api/parents/${parent.id}`
        : `/api/students/${student.id}`;
      const res = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nextFollowup: value || null }),
      });
      if (res.ok) {
        const updated = await res.json();
        if (parentOnly) {
          onUpdateParent?.(parent.id, {
            ...updated,
            nextFollowup: updated.nextFollowup ?? (value || null),
          });
        } else {
          onUpdateStudent(student.id, updated);
        }
        setEditNextFollowup(value || '');
        setEditingFollowup(false);
        if (refreshData) refreshData();
      }
    } catch (err) {
      console.error('Failed to update followup:', err);
    } finally {
      setSavingFollowup(false);
    }
  };

  const handlePricelistSelect = (itemId) => {
    setSelectedPricelistItem(itemId);
    const item = pricelist.find(p => String(p.id) === String(itemId));
    if (item) {
      setBillAmount(item.price);
      setBillDescription(item.name);
    } else {
      setBillAmount('');
      setBillDescription('');
    }
  };

  // Category tiles carry the images set in the catalogue, so the picker here
  // looks like the till's. Falls back to the built-in names if the API is down.
  useEffect(() => {
    if (!showPaymentModal) return;
    let cancelled = false;
    fetch('/api/product-categories')
      .then((res) => (res.ok ? res.json() : []))
      .then((cats) => {
        if (cancelled || !Array.isArray(cats) || !cats.length) return;
        setCatalogCategories(cats.filter((c) => c.active !== false));
      })
      .catch(() => { /* keep the built-in list */ });
    return () => { cancelled = true; };
  }, [showPaymentModal]);

  const billProducts = useMemo(() => (
    (pricelist || [])
      .filter((item) => item.active !== false)
      .map((item) => ({
        ...item,
        categories: normalizeCategories(
          Array.isArray(item.categories) ? item.categories : item.category ? [item.category] : []
        ),
      }))
  ), [pricelist]);

  // Only categories that actually hold a product — an empty tile is a dead end.
  const billCategoryTiles = useMemo(() => {
    const counts = new Map();
    for (const item of billProducts) {
      for (const cat of item.categories) counts.set(cat, (counts.get(cat) || 0) + 1);
    }
    const known = catalogCategories.filter((c) => counts.has(c.name));
    const extra = [...counts.keys()]
      .filter((name) => !catalogCategories.some((c) => c.name === name))
      .map((name) => ({ name, image: '' }));
    return [...known, ...extra].map((c) => ({ ...c, count: counts.get(c.name) || 0 }));
  }, [billProducts, catalogCategories]);

  const billCategoryProducts = useMemo(() => (
    billCategory ? billProducts.filter((item) => item.categories.includes(billCategory)) : []
  ), [billProducts, billCategory]);

  const loadStudentPayments = async () => {
    try {
      const qs = parent?.id
        ? `parentId=${encodeURIComponent(parent.id)}`
        : `studentId=${encodeURIComponent(student.id)}`;
      const res = await fetch(`/api/payments?${qs}`);
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setStudentPayments(list.filter((p) => {
        const belongsToFile = (parent?.id && p.parent_id === parent.id) || p.student_id === student.id;
        if (!belongsToFile) return false;
        if (!p.equipment_family_payment || parentOnly || showFamilyProfile) return true;
        return (p.equipment_allocations || []).some(
          (allocation) => String(allocation.student_id) === String(student.id)
        );
      }));
    } catch (err) {
      console.error('Failed to load payments:', err);
    }
  };

  useEffect(() => {
    if (canManageBilling) loadStudentPayments();
  }, [canManageBilling, student.id, parent?.id, showFamilyProfile]);

  useEffect(() => {
    setPaymentMenuId(null);
    setPaymentActionError('');
    setPaymentActionOk('');
  }, [student.id, parent?.id]);

  const downloadPaymentInvoice = async (payment, kind = 'charge') => {
    const key = `${payment.id}:download:${kind}`;
    setPaymentBusyKey(key);
    setPaymentActionError('');
    setPaymentActionOk('');
    try {
      const res = await fetch(
        `/api/payments/${encodeURIComponent(payment.id)}/invoice?kind=${encodeURIComponent(kind)}`
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'הורדת המסמך נכשלה');
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="([^"]+)"/);
      link.href = objectUrl;
      link.download = match?.[1] || (kind === 'refund' ? 'refund.pdf' : 'invoice.pdf');
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      setPaymentActionOk(kind === 'refund' ? 'מסמך הזיכוי הורד' : 'החשבונית הורדה');
    } catch (err) {
      setPaymentActionError(err.message || 'הורדת המסמך נכשלה');
    } finally {
      setPaymentBusyKey('');
    }
  };

  const sendPaymentInvoice = async (payment, kind = 'charge') => {
    const key = `${payment.id}:send:${kind}`;
    setPaymentBusyKey(key);
    setPaymentActionError('');
    setPaymentActionOk('');
    try {
      const res = await fetch(`/api/payments/${encodeURIComponent(payment.id)}/send-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'שליחת המסמך נכשלה');
      setPaymentActionOk(
        kind === 'refund' ? 'מסמך הזיכוי נשלח בוואטסאפ' : 'החשבונית נשלחה בוואטסאפ'
      );
    } catch (err) {
      setPaymentActionError(err.message || 'שליחת המסמך נכשלה');
    } finally {
      setPaymentBusyKey('');
    }
  };

  /**
   * זיכוי השכרת ציוד — לפי מדיניות הביטול ולא על מלוא הסכום.
   *
   * ההשכרה תומחרה לפי כמה מחצי העונה נותר, ולכן גם ההחזר: ערך התקופה שלא
   * נוצלה פחות דמי הביטול. השרת מחשב, כאן רק מציגים לאישור — ומאשרים בדיוק
   * את הסכום שהוצג.
   */
  /**
   * מה שהמדיניות שנשמרה עם התשלום אומרת, בשורה אחת.
   *
   * הצילום נשמר על העסקה ברגע הרכישה, ולכן זה מה שהיה בתוקף אז — גם אם
   * המדיניות שונתה מאז. עובד בדלפק שנשאל „מה מגיע לי” קורא כאן ולא מנחש.
   */
  const policyLine = (payment) => {
    const snap = payment?.policy_snapshot
      || (Array.isArray(payment?.policy_snapshots) ? payment.policy_snapshots[0] : null);
    if (!snap) return '';
    const name = snap.policy_name || 'מדיניות ביטול';
    if (snap.basis === 'usage') {
      const rule = snap.usage_rule || {};
      const percent = Number(rule.unused_refund_percent) || 0;
      const fee = Number(rule.fixed_fee) || 0;
      return `${name}: ${percent}% ממה שלא נוצל${fee ? `, בניכוי ₪${fee}` : ''}`;
    }
    const top = (snap.rules || [])[0];
    if (!top) return name;
    const fee = Number(top.fixed_fee) || 0;
    return `${name}: עד ${Number(top.refund_percent) || 0}% החזר${fee ? `, בניכוי ₪${fee} למשתתף` : ''}`;
  };

  /**
   * זיכוי כרטיסייה או מנוי — לפי מה שנוצל, לא על מלוא הסכום.
   *
   * הכרטיסייה מוזלת בזכות ההתחייבות לכמות, ולכן הכניסות שנוצלו מחויבות במחיר
   * כניסה בודדת והיתרה חוזרת. השרת מחשב; כאן מציגים לאישור ומאשרים בדיוק את
   * הסכום שהוצג.
   */
  /**
   * זיכוי בסכום שנקבע ידנית — לכל מקרה שהמדיניות לא צפתה.
   *
   * מציג קודם מה המדיניות ממליצה, אם יש המלצה, כדי שהחריגה תהיה החלטה ולא
   * ניחוש. הסיבה חובה: היא מה שיאפשר אחר כך להבין למה חרגנו.
   */
  const refundManually = async (payment) => {
    const paid = Number(payment.amount) || 0;
    let recommended = null;
    try {
      const endpoint = payment.equipment_checkout_token
        ? 'equipment-refund-preview'
        : (payment.has_passes ? 'pass-refund-preview' : null);
      if (endpoint) {
        const res = await fetch(`/api/payments/${encodeURIComponent(payment.id)}/${endpoint}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          const value = data.total ?? data.recommendation?.amount;
          if (Number.isFinite(Number(value))) recommended = Number(value);
        }
      }
    } catch {
      // אין המלצה — לא סיבה לחסום זיכוי ידני, רק להציג בלעדיה.
    }

    const entered = window.prompt(
      `סכום הזיכוי (שולם ₪${paid.toLocaleString()})`
      + (recommended != null ? `\nלפי המדיניות: ₪${recommended.toLocaleString()}` : '')
      + '\n\nהסכום יוחזר לכרטיס ותופק חשבונית זיכוי.',
      recommended != null ? String(recommended) : ''
    );
    if (entered == null) return;
    const amount = Number(String(entered).replace(/[^\d.]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) {
      setPaymentActionError('סכום לא תקין');
      return;
    }
    if (amount > paid) {
      setPaymentActionError(`הסכום גבוה ממה ששולם (₪${paid.toLocaleString()})`);
      return;
    }
    const reason = window.prompt('סיבת הזיכוי (חובה):', '') ?? '';
    if (!reason.trim()) {
      setPaymentActionError('זיכוי ידני מחייב סיבה');
      return;
    }
    const deviates = recommended != null && Math.abs(amount - recommended) >= 0.005;
    const ok = window.confirm(
      `להחזיר ₪${amount.toLocaleString()}?`
      + (deviates ? `\n\nזו חריגה מהמדיניות (₪${recommended.toLocaleString()}), והיא תירשם ככזו.` : '')
    );
    if (!ok) return;

    const key = `${payment.id}:refund`;
    setPaymentBusyKey(key);
    setPaymentActionError('');
    setPaymentActionOk('');
    try {
      const res = await fetch(`/api/payments/${encodeURIComponent(payment.id)}/manual-refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, reason: reason.trim(), recommended_amount: recommended }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'הזיכוי נכשל');
      setPaymentActionOk(
        `זוכו ₪${Number(data.amount || 0).toLocaleString()}`
        + (data.refund_doc_number ? ` · מסמך ${data.refund_doc_number}` : '')
        + (data.document_error ? ' · הכסף חזר אך חשבונית הזיכוי נכשלה — יש להוציאה ידנית' : '')
      );
      setPaymentMenuId(null);
      await loadStudentPayments();
      refreshData?.();
    } catch (err) {
      setPaymentActionError(err.message || 'הזיכוי נכשל');
    } finally {
      setPaymentBusyKey('');
    }
  };

  const refundPassPayment = async (payment) => {
    const key = `${payment.id}:refund`;
    setPaymentBusyKey(key);
    setPaymentActionError('');
    setPaymentActionOk('');
    try {
      const previewRes = await fetch(
        `/api/payments/${encodeURIComponent(payment.id)}/pass-refund-preview`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } }
      );
      const preview = await previewRes.json().catch(() => ({}));
      if (!previewRes.ok) throw new Error(preview.error || 'חישוב הזיכוי נכשל');
      if (!preview.resolved) {
        throw new Error('לא ניתן לקבוע כמה מהכרטיס נוצל — יש לבצע את הזיכוי ידנית');
      }

      const total = Number(preview.total) || 0;
      const lines = (preview.items || []).map((item) => {
        const unit = item.unit === 'days' ? 'ימים' : 'כניסות';
        const charged = Number(item.charged_for_used);
        return `${item.pass_name}: נוצלו ${item.used_units} מתוך ${item.total_units} ${unit}`
          + (Number.isFinite(charged) ? ` · מחויב ₪${charged.toLocaleString()}` : '')
          + ` · מוחזר ₪${Number(item.amount || 0).toLocaleString()}`;
      });
      const ok = window.confirm(
        `זיכוי לפי ${preview.policy?.name || 'מדיניות הביטול'}:\n\n`
        + lines.join('\n')
        + `\n\nסה״כ להחזר: ₪${total.toLocaleString()}\n`
        + 'הכרטיסים יבוטלו לאחר שהכסף יוחזר.'
      );
      if (!ok) return;
      const reason = window.prompt('סיבת הזיכוי (לא חובה):', '') ?? '';

      const res = await fetch(`/api/payments/${encodeURIComponent(payment.id)}/pass-refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved_amount: total, reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'הזיכוי נכשל');
      setPaymentActionOk(
        `זוכו ₪${Number(data.amount || 0).toLocaleString()}`
        + (data.refund_doc_number ? ` · מסמך ${data.refund_doc_number}` : '')
        + (data.document_error ? ' · הכסף חזר אך חשבונית הזיכוי נכשלה — יש להוציאה ידנית' : '')
      );
      setPaymentMenuId(null);
      await loadStudentPayments();
      refreshData?.();
    } catch (err) {
      setPaymentActionError(err.message || 'הזיכוי נכשל');
    } finally {
      setPaymentBusyKey('');
    }
  };

  const refundEquipmentPayment = async (payment) => {
    const key = `${payment.id}:refund`;
    setPaymentBusyKey(key);
    setPaymentActionError('');
    setPaymentActionOk('');
    try {
      const previewRes = await fetch(
        `/api/payments/${encodeURIComponent(payment.id)}/equipment-refund-preview`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } }
      );
      const preview = await previewRes.json().catch(() => ({}));
      if (!previewRes.ok) throw new Error(preview.error || 'חישוב הזיכוי נכשל');

      const rec = preview.recommendation || {};
      if (!rec.period_resolved) {
        throw new Error('לא ניתן לקבוע כמה מתקופת ההשכרה נוצלה — יש לבצע את הזיכוי ידנית');
      }
      const amount = Number(rec.amount) || 0;
      const fee = Number(rec.fixed_fee) || 0;
      const ok = window.confirm(
        `זיכוי השכרת ציוד לפי ${preview.policy?.name || 'מדיניות הביטול'}:\n\n`
        + `שולם: ₪${Number(preview.paid_amount || 0).toLocaleString()}\n`
        + `נותרו ${rec.remaining_units} מתוך ${rec.total_units} יחידות\n`
        + (fee ? `דמי ביטול: ₪${fee.toLocaleString()}\n` : '')
        + `\nלהחזיר ₪${amount.toLocaleString()}?`
      );
      if (!ok) return;
      const reason = window.prompt('סיבת הזיכוי (לא חובה):', '') ?? '';

      const res = await fetch(
        `/api/payments/${encodeURIComponent(payment.id)}/equipment-refund`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approved_amount: amount, reason: reason.trim() }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'הזיכוי נכשל');
      setPaymentActionOk(
        `זוכו ₪${Number(data.amount || 0).toLocaleString()}`
        + (data.refund_doc_number ? ` · מסמך ${data.refund_doc_number}` : '')
        + (data.document_error ? ' · הכסף חזר אך חשבונית הזיכוי נכשלה — יש להוציאה ידנית' : '')
      );
      setPaymentMenuId(null);
      await loadStudentPayments();
      refreshData?.();
    } catch (err) {
      setPaymentActionError(err.message || 'הזיכוי נכשל');
    } finally {
      setPaymentBusyKey('');
    }
  };

  const refundPayment = async (payment) => {
    // השכרת ציוד אינה מבוטלת במלואה אלא מזוכה לפי מה שנותר.
    if (payment?.equipment_checkout_token) return refundEquipmentPayment(payment);
    // וכך גם כרטיסייה או מנוי — לפי הכניסות שנוצלו.
    if (payment?.pos_sale_id && payment?.has_passes) return refundPassPayment(payment);
    const amountText = `₪${Number(payment.amount || 0).toLocaleString()}`;
    const ok = window.confirm(
      `לזכות את התשלום "${payment.description || 'תשלום'}" על ${amountText}?\n` +
        'המסמך יבוטל במערכת החיוב, ואם החיוב היה באשראי — הכסף יוחזר לכרטיס.'
    );
    if (!ok) return;
    const reason = window.prompt('סיבת הזיכוי (לא חובה):', '') ?? '';
    const key = `${payment.id}:refund`;
    setPaymentBusyKey(key);
    setPaymentActionError('');
    setPaymentActionOk('');
    try {
      const res = await fetch(`/api/payments/${encodeURIComponent(payment.id)}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'הזיכוי נכשל');
      setPaymentActionOk(`הזיכוי בוצע${data.cancellation?.docnum ? ` · מסמך ${data.cancellation.docnum}` : ''}`);
      setPaymentMenuId(null);
      await loadStudentPayments();
      refreshData?.();
    } catch (err) {
      setPaymentActionError(err.message || 'הזיכוי נכשל');
    } finally {
      setPaymentBusyKey('');
    }
  };

  const handleSendPayment = async (e) => {
    e.preventDefault();
    if (!billAmount || !billDescription) return;
    setBillingLoading(true);
    setBillingLink('');
    setLastInvoice(null);
    try {
      const response = await fetch('/api/checkout/payment-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: billingStudent?.id || null,
          parentId: parent?.id,
          studentName: billingStudent?.name || parentDisplayName(parent),
          amount: parseFloat(billAmount),
          description: billDescription,
          phone: parent?.phone
        })
      });
      const resData = await response.json().catch(() => ({}));
      if (response.ok) {
        setBillingLink(resData.paymentUrl || '');
        await loadStudentPayments();
        const waNote = resData.whatsappSent ? ' ונשלחה בוואטסאפ' : ' (וואטסאפ לא נשלח — בדוק מספר/חיבור)';
        alert(`דרישת תשלום נוצרה${waNote}.\nאחרי התשלום תופק חשבונית מס קבלה אוטומטית.`);
        if (resData.syncWarning) {
          console.warn('iCount sync warning:', resData.syncWarning);
        }
      } else {
        alert(resData.error || 'שגיאה ביצירת דרישת התשלום');
      }
    } catch (err) {
      console.error('Payment request error:', err);
      alert('שגיאה ביצירת דרישת התשלום');
    } finally {
      setBillingLoading(false);
    }
  };

  const handleCreateInvoice = async () => {
    if (!billAmount || !billDescription) {
      alert('מלא תיאור וסכום לפני הפקת חשבונית');
      return;
    }
    if (!confirm(`להפיק חשבונית מס קבלה על ₪${billAmount} ל-${parent?.name || student.name}?`)) {
      return;
    }
    setInvoiceLoading(true);
    setLastInvoice(null);
    try {
      const response = await fetch('/api/icount/invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentId: parent?.id,
          studentId: billingStudent?.id || null,
          studentName: billingStudent?.name || parentDisplayName(parent),
          amount: parseFloat(billAmount),
          description: billDescription,
          phone: parent?.phone,
        }),
      });
      const resData = await response.json().catch(() => ({}));
      if (response.ok) {
        setLastInvoice({
          docNumber: resData.docNumber,
          docId: resData.docId,
          amount: billAmount,
          description: billDescription,
        });
        await loadStudentPayments();
        alert(
          resData.docNumber
            ? `חשבונית מס קבלה הופקה בהצלחה (מס׳ ${resData.docNumber})`
            : 'חשבונית הופקה בהצלחה'
        );
      } else {
        alert(resData.error || 'שגיאה בהפקת חשבונית');
      }
    } catch (err) {
      console.error('Invoice error:', err);
      alert('שגיאה בהפקת חשבונית');
    } finally {
      setInvoiceLoading(false);
    }
  };

  const resetTestForm = () => {
    setTestLevel('5A');
    setTestType('level');
    setTestRouteStyle('top-rope');
    setTestNotes('');
    setTestPassed(true);
    setTestDate(new Date().toISOString().split('T')[0]);
    setEditingTestId(null);
    setShowTestForm(false);
    if (employees[0]?.id) setTestExaminerId(employees[0].id);
  };

  const openNewTestForm = () => {
    resetTestForm();
    setShowTestForm(true);
  };

  const openEditTestForm = (test) => {
    const type = test.test_type === 'top-rope' || test.test_type === 'top_rope' ? 'level' : (test.test_type || 'level');
    setEditingTestId(test.id);
    setTestType(type);
    setTestLevel(test.level || test.grade || '5A');
    setTestRouteStyle(test.route_style || test.route_type || 'top-rope');
    setTestPassed(!!(test.passed ?? test.status === 'passed'));
    setTestDate(test.date || new Date().toISOString().split('T')[0]);
    setTestNotes(test.notes || '');
    setTestExaminerId(test.examinerId || employees.find((e) => e.name === test.examiner)?.id || employees[0]?.id || '');
    setShowTestForm(true);
  };

  const handleSaveTest = async (e) => {
    e.preventDefault();
    if (!testExaminerId) {
      alert('נא לבחור את המדריך הבוחן');
      return;
    }
    const examinerName = employees.find((emp) => emp.id === testExaminerId)?.name || null;
    const payload = {
      studentId: student.id,
      studentName: student.name,
      level: testType === 'level' ? testLevel : null,
      test_type: testType,
      route_style: testType === 'level' ? testRouteStyle : null,
      examiner: examinerName,
      examinerId: testExaminerId,
      date: testDate,
      passed: testPassed,
      notes: testNotes,
      attended_ceremony: false,
    };
    setTestLoading(true);
    try {
      const response = await fetch(
        editingTestId ? `/api/level-tests/${editingTestId}` : '/api/level-tests',
        {
          method: editingTestId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      if (response.ok) {
        const saved = await response.json();
        setLevelTestsHistory((prev) => {
          if (editingTestId) return prev.map((t) => (t.id === editingTestId ? saved : t));
          return [saved, ...prev];
        });
        resetTestForm();
        refreshData();
      } else {
        const body = await response.json().catch(() => ({}));
        alert(body.error || 'שמירת המבחן נכשלה');
      }
    } catch (err) {
      console.error(err);
      alert('שמירת המבחן נכשלה');
    } finally {
      setTestLoading(false);
    }
  };

  const handleDeleteTest = async (test) => {
    if (!window.confirm('למחוק את המבחן? הפעולה אינה הפיכה.')) return;
    try {
      const response = await fetch(`/api/level-tests/${test.id}`, { method: 'DELETE' });
      if (response.ok) {
        setLevelTestsHistory((prev) => prev.filter((t) => t.id !== test.id));
        if (editingTestId === test.id) resetTestForm();
        refreshData();
      } else {
        const body = await response.json().catch(() => ({}));
        alert(body.error || 'מחיקת המבחן נכשלה');
      }
    } catch (err) {
      console.error(err);
      alert('מחיקת המבחן נכשלה');
    }
  };

  const participationValidity = participationScopeValidity(participationWaivers);
  const summaryIconSize = 23;
  const summaryIconBoxSize = 25;
  const summaryIconStrokeWidth = 1.9;
  const documentStatusItems = [
    {
      key: 'health',
      label: 'בריאות',
      valid: isHealthSigned && !healthExpired,
      Icon: HeartPulse,
    },
    ...['wall', 'trip'].map((scope) => {
      const kind = declarationKind(scope);
      return {
        key: scope,
        label: kind.label,
        valid: participationValidity[scope],
        Icon: kind.Icon,
      };
    }),
  ];
  const documentsSummary = (
    <span
      aria-label="מצב מסמכי בריאות והשתתפות"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 7, direction: 'rtl' }}
    >
      {documentStatusItems.map((item) => {
        const color = item.valid ? '#34D399' : '#F87171';
        const title = `${item.label}: ${item.valid ? 'בתוקף' : 'חסר או לא בתוקף'}`;
        const documentFilter = item.key === 'health' ? 'health' : `participation:${item.key}`;
        return (
          <button
            type="button"
            key={item.key}
            title={title}
            aria-label={title}
            aria-pressed={openFolder === 'health' && documentKindFilter === documentFilter}
            onClick={() => openFolderView('health', { documentFilter })}
            style={{
              width: summaryIconBoxSize,
              height: summaryIconBoxSize,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              border: 'none',
              background: 'transparent',
              color,
              lineHeight: 1,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <item.Icon size={summaryIconSize} strokeWidth={summaryIconStrokeWidth} />
          </button>
        );
      })}
    </span>
  );
  const climbingLevel = highestPassedLevel(levelTestsHistory) || student.levelGrade || null;
  const climbingLevelTint = climbingLevel?.startsWith('5')
    ? '#3B82F6'
    : climbingLevel?.startsWith('6')
      ? '#16A34A'
      : climbingLevel ? '#F97316' : 'var(--text-3)';
  const programLabels = {
    advanced_squads: 'מתקדמים ונבחרות',
    advanced: 'מתקדמים ונבחרות',
    young_squad: 'מתקדמים ונבחרות',
    adult_squad: 'מתקדמים ונבחרות',
  };
  const eligibilityLabels = {
    returning: 'ממשיך',
    pending: 'ממתין לאישור',
    approved: 'מאושר',
    rejected: 'נדחה',
  };
  const eligibilityColors = {
    returning: '#60A5FA',
    pending: '#FBBF24',
    approved: '#34D399',
    rejected: '#F87171',
  };
  const visibleProgramEligibility = programEligibility
    .filter((item) => ['returning', 'approved'].includes(String(item.status || '')))
    .sort((a, b) => {
      const rank = { returning: 2, approved: 1 };
      return (rank[b.status] || 0) - (rank[a.status] || 0);
    })
    .slice(0, 1);
  const safetyTone = SAFETY_TONE[punchSafety.state] || SAFETY_TONE.missing;
  const SafetyStatusIcon = safetyTone.alert ? ShieldAlert : ShieldCheck;
  const absenceStreak = consecutiveAbsences(attendanceHistory);
  const studentGroups = groups.filter((g) => studentGroupIds(student).includes(String(g.id)));
  const groupSummary = studentGroups.length === 0
    ? 'לא משויך'
    : studentGroups.length === 1
      ? `${studentGroups[0].name}${studentGroups[0].day != null ? ` · יום ${studentGroups[0].day}` : ''}`
      : (
        // More than one group — flag it so the staff notices the double assignment
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            title="המתאמן משובץ ליותר מחוג אחד"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 15,
              height: 15,
              borderRadius: '50%',
              background: 'rgba(251,191,36,0.18)',
              border: '1px solid rgba(251,191,36,0.5)',
              color: '#FBBF24',
              fontSize: 10,
              fontWeight: 800,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            !
          </span>
          {`${studentGroups.length} חוגים`}
        </span>
      );
  const activePasses = customerPasses.filter((p) => p.status === 'active').length;
  const passesSummary = passesLoading
    ? 'טוען...'
    : activePasses > 0
      ? `${activePasses} פעילים`
      : customerPasses.length === 0
        ? 'אין מנוי או כרטיסייה'
        : 'אין פעילים';
  const activeCoupons = coupons.filter((c) => c.state === 'active');
  const couponsSummary = couponsLoading
    ? 'טוען...'
    : activeCoupons.length > 0
      ? `${activeCoupons.length} בתוקף`
      : coupons.length === 0
        ? 'אין הטבות'
        : 'אין בתוקף';
  const salesPending = sales.filter((s) => s.status !== 'paid' && s.status !== 'refunded').length;
  const salesCountLabel = sales.length === 1 ? 'רכישה אחת' : `${sales.length} רכישות`;
  const salesSummary = salesLoading
    ? 'טוען...'
    : sales.length === 0
      ? 'אין רכישות'
      : salesPending > 0
        ? `${salesCountLabel} · ${salesPending} ממתין לתשלום`
        : salesCountLabel;
  const equipmentUnpaid = equipmentItems.filter((i) => i.payment_status !== 'paid').length;
  const equipmentAwaiting = equipmentItems.filter(
    (i) => i.payment_status === 'paid' && i.fulfillment_status !== 'given'
  ).length;
  const equipmentSummary = !showEquipment
    ? ''
    : equipmentLoading
      ? 'טוען...'
      : equipmentUnpaid + equipmentAwaiting === 0
        ? 'הכל תקין'
        : [
            equipmentUnpaid ? `${equipmentUnpaid} ממתין לתשלום` : null,
            equipmentAwaiting ? `${equipmentAwaiting} שולם` : null,
          ].filter(Boolean).join(' · ');
  const attendanceSummary = attendanceLoading
    ? 'טוען...'
    : attendanceHistory.length === 0
      ? 'אין נוכחות'
      : `${attendanceHistory.length} נוכחויות`;
  const activityHistorySummary = activityHistoryLoading
    ? 'טוען...'
    : activityHistory.length === 0
      ? 'אין פעילויות'
      : `${activityHistory.length} פעילויות`;
  const paymentsSummary = studentPayments.length === 0
    ? 'אין תשלומים'
    : `${studentPayments.length} רשומות`;
  // Same client for every row here, so the first one that carries a link wins.
  const icountClientLink = studentPayments.find((p) => p.icount_client_app_url)?.icount_client_app_url || '';
  const sortedLevelTests = useMemo(
    () =>
      [...levelTestsHistory].sort((a, b) =>
        String(b.date || '').localeCompare(String(a.date || ''))
      ),
    [levelTestsHistory]
  );
  const filteredLevelTests = useMemo(() => {
    if (testKindFilter === 'all') return sortedLevelTests;
    return sortedLevelTests.filter((t) => {
      const type = t.test_type === 'top-rope' || t.test_type === 'top_rope' ? 'level' : (t.test_type || 'level');
      return type === testKindFilter;
    });
  }, [sortedLevelTests, testKindFilter]);
  const testsSummary = levelTestsHistory.length === 0
    ? 'אין מבחנים'
    : `${levelTestsHistory.length} מבחנים`;
  const studentStatusMeta = STATUSES[student.status];
  const statusSummary = studentStatusMeta?.label || student.status || '—';
  const statusColor = studentStatusMeta?.color || '#60A5FA';
  const mailingListSummary = (() => {
    if (!parent?.id) return 'אין הורה';
    const active = broadcastListDefs.filter((list) => broadcastLists[list.key] !== false).length;
    return `${active}/${broadcastListDefs.length} רשימות`;
  })();

  const openUnifiedEditor = () => {
    const nextParentName = parentNameParts(parent);
    setEditFocus(showStudentProfile ? 'student' : 'parent');
    {
      // איפוס לשני השדות המפוצלים — הקריאה לסטר הישן הפילה את כל המסך.
      const split = splitParentName({ name: student.name, lastName: student.lastName });
      setEditStudentFirstName(split.first);
      setEditStudentLastName(split.lastName);
    }
    setEditBirthDate(student.birthDate || '');
    setEditStudentPhone(student.phone || '');
    setEditGender(student.gender || '');
    setEditStudentNotes(student.notes || '');
    setEditNextFollowup(student.nextFollowup || '');
    setEditGroupIds(studentGroupIds(student));
    setEditParentName(nextParentName.firstName);
    setEditParentLastName(nextParentName.lastName);
    setEditParentIdNumber(parent?.idNumber || '');
    setEditPhone(parent?.phone || '');
    setEditEmail(parent?.email || '');
    setEditCity(parent?.city || '');
    setEditParentGender(parent?.gender || '');
    setEditParentNotes(parent?.notes || '');
    setEditSource(parent?.source || student.source || 'unknown');
    setEditError('');
    setIsEditing(true);
  };

  const selectFamilyMember = (tab) => {
    setOpenFolder(null);
    setProfileMode(tab.kind);
    if (tab.parent?.id) setActiveParentId(tab.parent.id);
    if (foldersScrollRef.current) foldersScrollRef.current.scrollTop = 0;
    if (tab.student && String(tab.student.id) !== String(student.id)) {
      onSelectSibling?.(tab.student.id);
    }
  };

  const communicationTargetForTab = (tab) => {
    if (tab.kind === 'student') {
      const guardianIds = studentGuardianIds(tab.student);
      const targetParent = tab.parent
        || (allParents || []).find((item) => String(item.id) === String(tab.student?.parentId))
        || (allParents || []).find((item) => guardianIds.includes(String(item.id)))
        || primaryParent;
      const studentPhone = normalizePhone(tab.student?.phone);
      const parentPhone = normalizePhone(targetParent?.phone);
      // The API deliberately collapses two records that share one number. A
      // child without a distinct phone therefore has no separate conversation.
      if (!studentPhone || studentPhone === parentPhone || !targetParent?.id) return null;
      return { parentId: targetParent.id, threadId: `student:${tab.student.id}` };
    }
    if (!tab.parent?.id) return null;
    return { parentId: tab.parent.id, threadId: 'parent' };
  };

  const conversationParentIds = [...new Set(
    familyMemberTabs
      .map((tab) => communicationTargetForTab(tab)?.parentId)
      .filter(Boolean)
      .map(String)
  )];
  const conversationRefreshKey = conversationParentIds
    .map((parentId) => {
      const targetParent = (allParents || []).find((item) => String(item.id) === parentId);
      return [
        parentId,
        targetParent?.last_inbound_whatsapp || '',
        targetParent?.last_inbound_instagram || '',
        targetParent?.last_inbound_messenger || '',
      ].join(':');
    })
    .join('|');

  useEffect(() => {
    if (!canViewComms || !conversationParentIds.length) return undefined;
    // ConversationPanel already loads the communication card on screen. Only
    // prefetch the other household contacts for their waiting indicators.
    const parentIdsToPrefetch = conversationParentIds.filter(
      (parentId) => String(parentId) !== String(communicationParent?.id || '')
    );
    if (!parentIdsToPrefetch.length) return undefined;
    let cancelled = false;
    Promise.all(parentIdsToPrefetch.map(async (parentId) => {
      const response = await fetch(`/api/conversations/${encodeURIComponent(parentId)}`);
      if (!response.ok) return [parentId, null];
      return [parentId, await response.json().catch(() => null)];
    })).then((entries) => {
      if (cancelled) return;
      setConversationByParentId((current) => ({ ...current, ...Object.fromEntries(entries) }));
    }).catch(() => {});
    return () => { cancelled = true; };
    // The key includes every target parent and their newest inbound timestamps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewComms, conversationRefreshKey]);

  const rememberConversation = (parentId, conversation) => {
    if (!parentId || !conversation) return;
    setConversationByParentId((current) => ({
      ...current,
      [String(parentId)]: conversation,
    }));
  };

  const selectCommunicationMember = (tab) => {
    const target = communicationTargetForTab(tab);
    if (!target) return;
    setCommunicationParentId(target.parentId);
    setCommunicationThreadId(target.threadId);
    setCommunicationMemberKey(tab.key);
  };

  const activeFamilyTabKey = profileMode === 'parent'
    ? `parent:${parent?.id || ''}`
    : `student:${student.id}`;
  const headerTitle = showStudentProfile ? student.name : parentDisplayName(parent);
  const headerAge = showStudentProfile ? ageLabel(student.birthDate) : null;
  const headerGenderKind = showStudentProfile ? genderKind(student.gender) : null;
  const headerAgeColor = headerGenderKind === 'female' ? '#F472B6' : '#7DD3FC';
  const headerDisplayTitle = headerTitle || (parentOnly ? 'ליד ללא מתאמן' : 'ללא שם');
  const profilePhone = showFamilyProfile
    ? (parent?.phone || (showStudentProfile ? student.phone : ''))
    : student.phone;
  const linkedGuardianIds = new Set([
    ...studentGuardianIds(primaryAnchorStudent),
    ...(String(primaryAnchorStudent?.id) === String(student?.id)
      ? guardians.map((guardian) => String(guardian.id))
      : []),
  ]);
  const primaryGuardianId = familyPrimaryParentId
    || primaryAnchorStudent?.parentId
    || primaryParent?.id;
  const familyTabGroups = [
    {
      key: 'parents',
      label: 'הורים',
      tabs: familyMemberTabs.filter((tab) => tab.kind !== 'student'),
    },
    {
      key: 'children',
      label: 'ילדים',
      tabs: familyMemberTabs.filter((tab) => tab.kind === 'student'),
    },
  ].filter((group) => group.tabs.length);

  return (
    <>
      {showMergeFamily && (
        <Modal
          title="איחוד משפחות"
          onClose={() => !mergeSavingId && setShowMergeFamily(false)}
          footer={(
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!!mergeSavingId}
              onClick={() => setShowMergeFamily(false)}
            >
              סגור
            </button>
          )}
        >
          <p style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)' }}>
            חפשו את הכרטיס השני של אותה משפחה. אחרי האיחוד כל ההורים יופיעו על כל הילדים,
            והמשפחה תופיע כשורה אחת. שום כרטיס וילד לא נמחק.
          </p>
          <div className="input-icon-wrap" style={{ marginBottom: 12 }}>
            <Search className="input-icon" size={16} />
            <input
              className="input"
              autoFocus
              style={{ paddingRight: 36 }}
              placeholder="שם הורה, טלפון או שם ילד..."
              value={mergeQuery}
              onChange={(e) => setMergeQuery(e.target.value)}
            />
          </div>
          {mergeError && (
            <div style={{
              marginBottom: 12,
              padding: '10px 12px',
              borderRadius: 10,
              background: 'rgba(248,113,113,0.12)',
              color: '#fca5a5',
              fontSize: 13,
            }}>
              {mergeError}
            </div>
          )}
          {mergeSearching && <div style={{ fontSize: 13, color: 'var(--text-2)' }}>מחפש...</div>}
          {!mergeSearching && mergeSearched && !mergeResults.length && (
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>לא נמצאה משפחה מתאימה.</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {mergeResults.map((family) => (
              <div
                key={family.parent_id}
                style={{
                  padding: 12,
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  background: 'rgba(255,255,255,0.03)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {family.parents.join(' · ') || family.parent_name || 'לקוח'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 3 }}>
                    {family.phone || 'ללא טלפון'}
                    {family.children.length ? ` · ${family.children.join(', ')}` : ' · ללא ילדים'}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-xs"
                  disabled={!!mergeSavingId}
                  onClick={() => handleMergeFamily(family)}
                >
                  {mergeSavingId === family.parent_id ? 'מאחד...' : 'אחד'}
                </button>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {showSplitFamily && (
        <Modal
          title="פיצול משפחה"
          onClose={() => !splitSaving && setShowSplitFamily(false)}
          footer={(
            <>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={splitSaving}
                onClick={() => setShowSplitFamily(false)}
              >
                ביטול
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={splitSaving || splitLoading || !splitHousehold?.children?.length}
                onClick={handleSplitFamily}
              >
                {splitSaving ? 'שומר...' : 'שמור פיצול'}
              </button>
            </>
          )}
        >
          <p style={{ margin: '0 0 14px', fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)' }}>
            בחרו לאיזה הורה שייך כל ילד. הילדים לא נמחקים — רק השיוך מתעדכן.
          </p>
          {splitLoading && <div style={{ fontSize: 13, color: 'var(--text-2)' }}>טוען...</div>}
          {splitError && (
            <div style={{
              marginBottom: 12,
              padding: '10px 12px',
              borderRadius: 10,
              background: 'rgba(248,113,113,0.12)',
              color: '#fca5a5',
              fontSize: 13,
            }}>
              {splitError}
            </div>
          )}
          {!splitLoading && splitHousehold && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {splitHousehold.children.map((child) => (
                <div
                  key={child.id}
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    border: '1px solid var(--border)',
                    background: 'rgba(255,255,255,0.03)',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
                    {child.name || 'ילד'}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {splitHousehold.parents
                      .filter((p) => (child.guardianIds || []).includes(String(p.id)))
                      .map((p) => {
                      const selected = String(splitAssignments[child.id] || '') === String(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setSplitAssignments((prev) => ({
                            ...prev,
                            [child.id]: p.id,
                          }))}
                          style={{
                            flex: '1 1 140px',
                            padding: '10px 12px',
                            borderRadius: 10,
                            font: 'inherit',
                            fontWeight: 700,
                            fontSize: 13,
                            cursor: 'pointer',
                            border: selected
                              ? '1px solid rgba(56,189,248,0.7)'
                              : '1px solid var(--border)',
                            background: selected
                              ? 'rgba(56,189,248,0.18)'
                              : 'rgba(255,255,255,0.03)',
                            color: 'var(--text-1)',
                          }}
                        >
                          {p.name || 'הורה'}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {!splitHousehold.children.length && (
                <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
                  אין ילדים במשק הבית לפיצול.
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'var(--bg-overlay)',
          zIndex: 299,
        }}
      />
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          height: '100vh',
          width: 'min(960px, 92vw)',
          background: 'var(--bg-card)',
          borderRight: '1px solid var(--border)',
          zIndex: 300,
          display: 'flex',
          flexDirection: 'row',
          boxShadow: '4px 0 25px rgba(0,0,0,0.5)',
          animation: 'slideUp 0.2s ease',
          overflow: 'hidden',
        }}
      >
        {/* Details column (RTL: appears on the right) */}
        <div
          style={{
            width: 380,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            borderLeft: '1px solid var(--border)',
            minHeight: 0,
            overscrollBehavior: 'contain',
          }}
        >
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--bg-card)' }}>
            {/* This switcher is the fixed header. The selected person's variable
                profile content lives below in the scroll area, preventing jumps. */}
            <div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {familyTabGroups.map((group) => (
                  <div
                    key={group.key}
                    style={{
                      minWidth: 0,
                    }}
                  >
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textAlign: 'right', marginBottom: 3 }}>
                      {group.label}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6, alignItems: 'stretch' }}>
                {group.tabs.map((tab) => {
                  const fileActive = tab.key === activeFamilyTabKey;
                  const conversationActive = tab.key === communicationMemberKey;
                  const communicationTarget = communicationTargetForTab(tab);
                  const conversationAwaiting = communicationTarget
                    ? threadIsAwaitingReply(
                      conversationByParentId[String(communicationTarget.parentId)],
                      communicationTarget.threadId
                    )
                    : false;
                  const name = tab.student?.name || parentDisplayName(tab.parent);
                  const isParentEntity = tab.kind !== 'student';
                  const isPrimary = !!tab.parent
                    && String(tab.parent.id) === String(primaryGuardianId);
                  const canSetPrimary = !!tab.parent
                    && linkedGuardianIds.has(String(tab.parent.id));
                  const roleDescription = [
                    isParentEntity ? 'הורה' : 'ילד',
                    isPrimary ? 'ראשי' : null,
                  ].filter(Boolean).join(' · ');
                  return (
                    <div
                      key={tab.key}
                      title={`${name} · ${roleDescription}`}
                      style={{
                        minWidth: 0,
                        padding: '5px 6px',
                        borderRadius: 10,
                        border: `1px solid ${fileActive ? 'rgba(148,163,184,0.38)' : 'var(--border)'}`,
                        background: fileActive ? 'rgba(148,163,184,0.12)' : 'transparent',
                        color: 'var(--text-2)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                        {canSetPrimary && isPrimary && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
                            <button
                              type="button"
                              aria-pressed={isPrimary}
                              aria-label={isPrimary ? `${name} הוא ההורה הראשי` : `קביעת ${name} כהורה ראשי`}
                              title={isPrimary ? 'הורה ראשי' : 'קבע כהורה ראשי'}
                              disabled={settingPrimary}
                              onClick={() => {
                                if (!isPrimary) handleMakePrimary(tab.parent.id);
                              }}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: 0,
                                border: 'none',
                                background: 'transparent',
                                color: isPrimary ? '#FBBF24' : 'var(--text-3)',
                                cursor: isPrimary ? 'default' : 'pointer',
                                opacity: settingPrimary ? 0.5 : 1,
                              }}
                            >
                              <Star size={12} fill={isPrimary ? '#FBBF24' : 'none'} />
                            </button>
                          </span>
                        )}
                        <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 700, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {name}
                        </span>
                        {/* אצל הילד הסימן יושב על כרטיס המתאמן, אצל ההורה על
                            כרטיס ההורה — ולמבוגר המילים הן גבר / אישה. */}
                        <GenderMark
                          gender={tab.student?.gender || tab.parent?.gender}
                          size={13}
                          labels={tab.student && !tab.student.isAdult ? ['בן', 'בת'] : ['גבר', 'אישה']}
                        />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                          <button
                            type="button"
                            aria-pressed={fileActive}
                            aria-label={`הצגת התיק של ${name}`}
                            onClick={() => selectFamilyMember(tab)}
                            title={`הצגת התיק של ${name}`}
                            style={{
                              width: 26,
                              height: 26,
                              minWidth: 26,
                              padding: 0,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderRadius: 8,
                              border: `1px solid ${fileActive ? 'rgba(96,165,250,0.75)' : 'rgba(148,163,184,0.2)'}`,
                              background: fileActive ? 'rgba(96,165,250,0.2)' : 'rgba(255,255,255,0.025)',
                              color: fileActive ? '#93C5FD' : 'var(--text-3)',
                              cursor: 'pointer',
                            }}
                          >
                            <FolderOpen size={14} strokeWidth={2} />
                          </button>
                          <button
                            type="button"
                            aria-pressed={conversationActive}
                            aria-label={communicationTarget ? `מעבר לשיחה עם ${name}` : `אין ל${name} מספר טלפון עצמאי`}
                            onClick={() => selectCommunicationMember(tab)}
                            disabled={!communicationTarget}
                            title={communicationTarget ? `מעבר לשיחה עם ${name}` : 'אין למתאמן מספר טלפון עצמאי'}
                            style={{
                              width: 26,
                              height: 26,
                              minWidth: 26,
                              padding: 0,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              position: 'relative',
                              borderRadius: 8,
                              border: `1px solid ${conversationActive ? 'rgba(52,211,153,0.75)' : 'rgba(148,163,184,0.2)'}`,
                              background: 'rgba(255,255,255,0.025)',
                              color: conversationActive ? '#34D399' : 'var(--text-3)',
                              cursor: communicationTarget ? 'pointer' : 'not-allowed',
                              opacity: communicationTarget ? 1 : 0.35,
                            }}
                          >
                            <MessageCircle size={14} strokeWidth={2} />
                            {conversationAwaiting && (
                              <span
                                aria-label="שיחה ממתינה לטיפול"
                                style={{
                                  position: 'absolute',
                                  top: -2,
                                  insetInlineEnd: -2,
                                  width: 7,
                                  height: 7,
                                  borderRadius: '50%',
                                  background: '#FBBF24',
                                }}
                              />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {parent?.id && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => {
                      setAddChildError('');
                      setNewChildName('');
                      setSendHealthOnAdd(true);
                      setShowAddChild(true);
                    }}
                    style={{ borderRadius: 10, border: '1px dashed var(--border)', gap: 4 }}
                    title="הוספת ילד לתיק המשפחה"
                  >
                    <Plus size={12} /> הוסף ילד
                  </button>
                )}
                {!parentOnly && contactCandidates.length > 0 && householdParentCount < 2 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    style={{ borderRadius: 10, border: '1px dashed var(--border)', gap: 4 }}
                    title="הורה שני, סבתא או מטפלת — איש קשר בתיק, בלי לפתוח כרטיס מתאמן"
                    onClick={openAddContact}
                  >
                    <Plus size={12} /> הוסף איש קשר
                  </button>
                )}
              </div>
            </div>
          </div>

          <div
            ref={foldersScrollRef}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto',
              overscrollBehavior: 'contain',
              padding: '12px 14px 16px',
              minHeight: 0,
            }}
          >
            {/* The profile belongs to the selected file and may scroll away. The
                fixed family switcher above therefore keeps exactly one height. */}
            <div style={{ marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 56 }}>
                      <div
                        title={headerDisplayTitle || undefined}
                        style={{ minWidth: 0, fontSize: 18, fontWeight: 800, color: 'var(--text-1)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {headerDisplayTitle}
                      </div>
                      {headerAge && (
                        <span
                          aria-label={`גיל ${headerAge}`}
                          title={`גיל ${headerAge}`}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 2,
                            flexShrink: 0,
                            color: headerAgeColor,
                            fontSize: 12,
                            fontWeight: 800,
                            lineHeight: 1,
                          }}
                        >
                          <RotateCw size={14} strokeWidth={2.2} />
                          <span>{headerAge}</span>
                        </span>
                      )}
                    </div>
                    {profilePhone ? (
                      <span
                        aria-label="פעולות מספר הטלפון"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          flexShrink: 0,
                          padding: 2,
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          background: 'transparent',
                          overflow: 'hidden',
                          boxSizing: 'border-box',
                        }}
                      >
                        <a
                          href={`tel:${profilePhone}`}
                          className="btn btn-ghost btn-xs"
                          title="חיוג למספר הטלפון"
                          aria-label="חיוג למספר הטלפון"
                          style={{ width: 24, minWidth: 24, height: 24, padding: 0, margin: 0, gap: 0, justifyContent: 'center', border: 'none', borderRadius: 6, boxSizing: 'border-box', background: 'transparent' }}
                        >
                          <Phone size={13} />
                        </a>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-xs"
                          title={phoneCopied ? 'הועתק' : 'העתקת המספר'}
                          aria-label="העתקת מספר הטלפון"
                          style={{ width: 24, minWidth: 24, height: 24, padding: 0, margin: 0, gap: 0, justifyContent: 'center', border: 'none', borderRadius: 6, boxSizing: 'border-box', background: 'transparent' }}
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(profilePhone);
                              setPhoneCopied(true);
                              setTimeout(() => setPhoneCopied(false), 1500);
                            } catch { /* ignore */ }
                          }}
                        >
                          {phoneCopied ? <Check size={12} color="var(--green)" /> : <Clipboard size={12} />}
                        </button>
                      </span>
                    ) : (
                      <span
                        title="אין מספר טלפון"
                        aria-label="אין מספר טלפון"
                        style={{
                          width: 30,
                          minWidth: 30,
                          height: 30,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          boxSizing: 'border-box',
                          background: 'transparent',
                          color: 'var(--text-3)',
                          opacity: 0.55,
                        }}
                      >
                        <PhoneOff size={13} />
                      </span>
                    )}
                    {showFamilyProfile && parent?.email && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-xs"
                        title={emailCopied ? 'כתובת המייל הועתקה' : 'העתקת כתובת המייל'}
                        aria-label="העתקת כתובת המייל"
                        style={{ background: 'transparent' }}
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(parent.email);
                            setEmailCopied(true);
                            setTimeout(() => setEmailCopied(false), 1500);
                          } catch { /* ignore */ }
                        }}
                      >
                        {emailCopied ? <Check size={12} color="var(--green)" /> : <AtSign size={13} />}
                      </button>
                    )}
                    {showFamilyProfile && parent?.city && (
                      <span
                        title={parent.city}
                        aria-label={`כתובת: ${parent.city}`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                          minWidth: 0,
                          maxWidth: 78,
                          height: 30,
                          padding: '0 7px',
                          flexShrink: 1,
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          boxSizing: 'border-box',
                          fontSize: 11,
                          color: 'var(--text-2)',
                          background: 'transparent',
                        }}
                      >
                        <MapPin size={11} style={{ flexShrink: 0 }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{parent.city}</span>
                      </span>
                    )}
                    {((showStudentProfile && student?.id) || (showFamilyProfile && parent?.id)) && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-xs"
                        onClick={openUnifiedEditor}
                        title="עריכת פרטי התיק"
                        aria-label="עריכת פרטי התיק"
                        style={{ border: '1px solid var(--border)', background: 'transparent', flexShrink: 0 }}
                      >
                        <Edit2 size={13} />
                      </button>
                    )}
                  </div>
                  {showStudentProfile && (
                    <>
                    <div
                      aria-label="סיכום מצב המתאמן"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 11,
                        minHeight: 31,
                        marginTop: 5,
                        paddingTop: 5,
                        borderTop: '1px solid rgba(148,163,184,0.12)',
                      }}
                    >
                      <span
                        aria-label="אישורי בריאות, השתתפות, בטיחות וסטטוס"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                      >
                        {documentsSummary}
                        <button
                          type="button"
                          onClick={() => openFolderView('tests', { testFilter: 'security' })}
                          title={`מבחן בטיחות: ${safetyTone.label}`}
                          aria-label={`מבחן בטיחות: ${safetyTone.label}`}
                          style={{
                            width: summaryIconBoxSize,
                            height: summaryIconBoxSize,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 0,
                            border: 'none',
                            background: 'transparent',
                            color: safetyTone.color,
                            cursor: 'pointer',
                            flexShrink: 0,
                          }}
                        >
                          <SafetyStatusIcon size={summaryIconSize} strokeWidth={summaryIconStrokeWidth} />
                        </button>
                        <button
                          type="button"
                          onClick={() => openFolderView('status')}
                          title={`סטטוס: ${statusSummary}`}
                          aria-label={`סטטוס: ${statusSummary}`}
                          aria-pressed={openFolder === 'status'}
                          style={{
                            width: summaryIconBoxSize,
                            height: summaryIconBoxSize,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 0,
                            border: 'none',
                            background: 'transparent',
                            color: statusColor,
                            cursor: 'pointer',
                            flexShrink: 0,
                          }}
                        >
                          <Clipboard size={summaryIconSize} strokeWidth={summaryIconStrokeWidth} />
                        </button>
                      </span>
                      <span
                        role="separator"
                        aria-orientation="vertical"
                        style={{ width: 1, height: 20, flexShrink: 0, background: 'rgba(148,163,184,0.28)' }}
                      />
                      <span
                        aria-label="דרגה והיעדרויות"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}
                      >
                        <button
                          type="button"
                          onClick={() => openFolderView('tests', { testFilter: 'level' })}
                          title={`רמת טיפוס: ${climbingLevel || 'ללא מבחן רמה'}`}
                          aria-label={`רמת טיפוס: ${climbingLevel || 'ללא מבחן רמה'}`}
                          style={{
                            width: summaryIconBoxSize,
                            height: summaryIconBoxSize,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 0,
                            border: 'none',
                            background: 'transparent',
                            color: climbingLevelTint,
                            cursor: 'pointer',
                            font: 'inherit',
                            flexShrink: 0,
                          }}
                        >
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 24 24"
                            width={summaryIconSize}
                            height={summaryIconSize}
                            style={{ display: 'block' }}
                          >
                            <polygon points="12,1.5 21,6.8 21,17.2 12,22.5 3,17.2 3,6.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                            <text
                              x="12"
                              y="14.7"
                              fill="currentColor"
                              textAnchor="middle"
                              fontSize="8.2"
                              fontWeight="900"
                              style={{ fontFamily: 'inherit' }}
                            >
                              {climbingLevel || '—'}
                            </text>
                          </svg>
                        </button>
                        {!attendanceLoading && absenceStreak > 0 && (
                          <button
                            type="button"
                            onClick={() => openFolderView('attendance')}
                            title={`העדרויות רצופות: ${absenceStreak}`}
                            aria-label={`העדרויות רצופות: ${absenceStreak}`}
                            style={{
                                width: summaryIconBoxSize,
                                height: summaryIconBoxSize,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              padding: 0,
                              border: 'none',
                              background: 'transparent',
                              color: '#F87171',
                              cursor: 'pointer',
                              flexShrink: 0,
                            }}
                          >
                            <svg aria-hidden="true" viewBox="0 0 24 24" width={summaryIconSize} height={summaryIconSize} style={{ display: 'block' }}>
                              <path
                                d="M5 21V10a7 7 0 0 1 14 0v11l-2.35-2-2.3 2-2.35-2-2.35 2-2.3-2L5 21Z"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              <text
                                x="12"
                                y="13.7"
                                fill="currentColor"
                                textAnchor="middle"
                                fontSize="8.2"
                                fontWeight="900"
                                style={{ fontFamily: 'inherit' }}
                              >
                                {absenceStreak}
                              </text>
                            </svg>
                          </button>
                        )}
                      </span>
                    </div>
                    {visibleProgramEligibility.length > 0 && (
                      <div
                        aria-label="זכאות למתקדמים ולנבחרת"
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 5,
                          marginTop: 5,
                          paddingTop: 5,
                          borderTop: '1px solid rgba(148,163,184,0.12)',
                        }}
                      >
                        {visibleProgramEligibility.map((item) => (
                          <span
                            key={item.id || `${item.program}-${item.season}`}
                            title={`${programLabels[item.program] || item.program}: ${eligibilityLabels[item.status] || item.status}`}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              padding: '3px 7px',
                              borderRadius: 999,
                              border: `1px solid ${eligibilityColors[item.status] || 'var(--border)'}`,
                              color: eligibilityColors[item.status] || 'var(--text-2)',
                              background: 'rgba(15,23,42,0.28)',
                              fontSize: 10,
                              fontWeight: 700,
                            }}
                          >
                            {programLabels[item.program] || item.program} · {eligibilityLabels[item.status] || item.status}
                          </span>
                        ))}
                      </div>
                    )}
                    </>
                  )}
                </div>
              </div>
              {showFamilyProfile && guardians.some((g) => String(g.id) === String(parent?.id) && !g.primary) && (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 5 }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    disabled={settingPrimary}
                    title="ההורה הראשי הוא זה שאליו המערכת פונה כברירת מחדל"
                    onClick={() => handleMakePrimary(parent.id)}
                  >
                    {settingPrimary ? 'מעדכן...' : 'קבע כהורה ראשי'}
                  </button>
                </div>
              )}
            </div>

            {/* Family-only sections appear only on a parent or combined tab. */}
            {showFamilyProfile && parent?.id && (
              <div style={{ marginBottom: 12, order: 2 }}>
                <FolderRow
                  id="mailing"
                  title="רשימות תפוצה"
                  icon={Bell}
                  accent="#FBBF24"
                  summary={mailingListSummary}
                  open={openFolder === 'mailing'}
                  onToggle={toggleFolder}
                  renderBody={() => (
                    <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>רשימות פעילות</div>
                    {!loadingLists && (
                      <button
                        type="button"
                        className={`btn btn-xs ${editingBroadcastLists ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setEditingBroadcastLists((v) => !v)}
                      >
                        {editingBroadcastLists ? <><Check size={11} /> סיום</> : <><Edit2 size={11} /> עריכה</>}
                      </button>
                    )}
                  </div>
                  {loadingLists ? (
                    <div style={{ fontSize: 12, color: 'var(--text-3)' }}>טוען רשימות תפוצה...</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: editingBroadcastLists ? 'auto' : 'none', opacity: editingBroadcastLists ? 1 : 0.85 }}>
                      {broadcastListDefs.map((list) => {
                        const label = list.description ? `${list.label} (${list.description})` : list.label;
                        const checked = broadcastLists[list.key] !== false;
                        return (
                          <label key={list.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: editingBroadcastLists ? 'pointer' : 'default' }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!editingBroadcastLists}
                              onChange={() => handleListToggle(list.key)}
                              style={{ cursor: editingBroadcastLists ? 'pointer' : 'default', width: 15, height: 15 }}
                            />
                            <span style={{ color: checked ? 'var(--text-1)' : 'var(--text-3)', fontWeight: checked ? '600' : 'normal' }}>
                              {label}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                    </>
                  )}
                />

                {canManageBilling && (
                  <FolderRow
                    id="payments"
                    title="תשלומים משפחתיים"
                    icon={CreditCard}
                    accent="#34D399"
                    summary={paymentsSummary}
                    open={openFolder === 'payments'}
                    onToggle={toggleFolder}
                    renderBody={() => (
                      <>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          setBillingStudentId(String(showStudentProfile ? student.id : (billableStudents[0]?.id || '')));
                          setShowPaymentModal(true);
                        }}
                      >
                        <Send size={13} /> שלח בקשת תשלום
                      </button>
                      {icountClientLink && (
                        <a
                          className="btn btn-ghost btn-sm"
                          href={icountClientLink}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ReceiptText size={13} /> תיק הלקוח במערכת החיוב
                        </a>
                      )}
                    </div>
                    {paymentActionError && (
                      <div className="alert alert-error" style={{ marginBottom: 8, fontSize: 12 }}>
                        {paymentActionError}
                      </div>
                    )}
                    {paymentActionOk && (
                      <div className="alert alert-success" style={{ marginBottom: 8, fontSize: 12 }}>
                        {paymentActionOk}
                      </div>
                    )}
                    {studentPayments.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--text-3)' }}>אין היסטוריית תשלומים</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto', overscrollBehavior: 'contain' }}>
                        {studentPayments.slice(0, 8).map((p) => {
                          const badge = paymentStatusBadge(p.status);
                          const menuOpen = paymentMenuId === p.id;
                          const busy = paymentBusyKey.startsWith(`${p.id}:`);
                          const hasRefundDoc = paymentHasRefundDoc(p);
                          const canRefund = p.status === 'paid' && !!p.icount_doc_number;
                          const paymentStudent = billableStudents.find(
                            (member) => String(member.id) === String(p.student_id)
                          );
                          const equipmentAllocations = (p.equipment_allocations || []).filter((allocation) => (
                            showFamilyProfile || String(allocation.student_id) === String(student.id)
                          ));
                          return (
                            <div
                              key={p.id}
                              style={{
                                fontSize: 12,
                                padding: '6px 0',
                                borderBottom: '1px solid var(--border)',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                                <span style={{ color: 'var(--text-2)' }}>
                                  {p.description}
                                  {p.icount_doc_number ? ` · מס׳ ${p.icount_doc_number}` : ''}
                                </span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                  ₪{Number(p.amount).toLocaleString()}{' '}
                                  <span className={badge.cls}>{badge.label}</span>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-xs"
                                    disabled={busy}
                                    onClick={() => {
                                      setPaymentActionError('');
                                      setPaymentActionOk('');
                                      setPaymentMenuId(menuOpen ? null : p.id);
                                    }}
                                  >
                                    פעולות <ChevronDown size={12} style={{ transform: menuOpen ? 'rotate(180deg)' : 'none' }} />
                                  </button>
                                </span>
                              </div>
                              {paymentStudent && (
                                <div style={{ marginTop: 4, color: 'var(--text-3)', fontSize: 11 }}>
                                  עבור {paymentStudent.name}
                                </div>
                              )}
                              {policyLine(p) && (
                                <div style={{ marginTop: 4, color: 'var(--text-3)', fontSize: 11 }}>
                                  <ShieldCheck size={11} style={{ verticalAlign: -1, marginInlineEnd: 4 }} />
                                  {policyLine(p)}
                                </div>
                              )}
                              {equipmentAllocations.length > 0 && (
                                <div style={{ marginTop: 4, color: 'var(--text-3)', fontSize: 11 }}>
                                  {equipmentAllocations.map((allocation) => {
                                    const member = billableStudents.find(
                                      (item) => String(item.id) === String(allocation.student_id)
                                    );
                                    return (
                                      <div key={allocation.student_id || allocation.id}>
                                        {member?.name || 'משתתף'}: ₪{Number(allocation.charge_amount ?? allocation.total ?? 0).toLocaleString()}
                                        {Number(allocation.discount_amount) > 0
                                          ? ` · הנחת משפחה ₪${Number(allocation.discount_amount).toLocaleString()}`
                                          : ''}
                                      </div>
                                    );
                                  })}
                                  <div>החשבונית והזיכוי שייכים לעסקה המשפחתית המלאה</div>
                                </div>
                              )}
                              {menuOpen && (
                                <div
                                  style={{
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    gap: 6,
                                    marginTop: 8,
                                    padding: 8,
                                    background: 'var(--bg-input)',
                                    border: '1px solid var(--border)',
                                    borderRadius: 8,
                                  }}
                                >
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-xs"
                                    disabled={busy}
                                    onClick={() => downloadPaymentInvoice(p, 'charge')}
                                  >
                                    <Download size={12} />{' '}
                                    {paymentBusyKey === `${p.id}:download:charge` ? 'מוריד...' : 'הורדת חשבונית'}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-xs"
                                    disabled={busy}
                                    onClick={() => sendPaymentInvoice(p, 'charge')}
                                  >
                                    <Send size={12} />{' '}
                                    {paymentBusyKey === `${p.id}:send:charge` ? 'שולח...' : 'שליחת חשבונית בוואטסאפ'}
                                  </button>
                                  {hasRefundDoc && (
                                    <>
                                      <button
                                        type="button"
                                        className="btn btn-ghost btn-xs"
                                        disabled={busy}
                                        onClick={() => downloadPaymentInvoice(p, 'refund')}
                                      >
                                        <Download size={12} />{' '}
                                        {paymentBusyKey === `${p.id}:download:refund` ? 'מוריד...' : 'הורדת מסמך זיכוי'}
                                      </button>
                                      <button
                                        type="button"
                                        className="btn btn-ghost btn-xs"
                                        disabled={busy}
                                        onClick={() => sendPaymentInvoice(p, 'refund')}
                                      >
                                        <Send size={12} />{' '}
                                        {paymentBusyKey === `${p.id}:send:refund` ? 'שולח...' : 'שליחת מסמך זיכוי'}
                                      </button>
                                    </>
                                  )}
                                  {canRefund && (
                                    <button
                                      type="button"
                                      className="btn btn-danger btn-xs"
                                      disabled={busy}
                                      onClick={() => refundPayment(p)}
                                    >
                                      <History size={12} />{' '}
                                      {paymentBusyKey === `${p.id}:refund` ? 'מזכה...' : 'זיכוי מלא'}
                                    </button>
                                  )}
                                  {canRefund && isOwner && (
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-xs"
                                      disabled={busy}
                                      onClick={() => refundManually(p)}
                                      title="זיכוי בסכום שאתה קובע — מחייב סיבה ונרשם כחריגה ממדיניות"
                                    >
                                      <Pencil size={12} /> זיכוי בסכום אחר
                                    </button>
                                  )}
                                  {p.icount_doc_app_url && (
                                    <a
                                      className="btn btn-ghost btn-xs"
                                      href={p.icount_doc_app_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      title="לפעולות שאינן זמינות כאן"
                                    >
                                      <ReceiptText size={12} /> פתח מסמך במערכת החיוב
                                    </a>
                                  )}
                                  {!canRefund && p.status === 'paid' && (
                                    <span style={{ fontSize: 11, color: 'var(--text-3)', alignSelf: 'center' }}>
                                      אין מספר מסמך במערכת החיוב — זיכוי אוטומטי לא זמין
                                    </span>
                                  )}
                                  {p.icount_doc_app_url && p.status === 'paid' && (
                                    <div style={{ fontSize: 11, color: 'var(--text-3)', width: '100%' }}>
                                      זיכוי חלקי נעשה במערכת החיוב. הסטטוס כאן יישאר „שולם” עד שתזכה את התשלום גם מכאן.
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                      </>
                    )}
                  />
                )}
              </div>
            )}

            {/* Follow-up remains a compact editable row; the status metrics now
                live directly below the trainee header. */}
            {showStudentProfile && (
              <div style={{ marginBottom: 12, order: 1 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      padding: '7px 2px 0',
                      marginTop: 3,
                      fontSize: 12,
                    }}
                  >
                    <span style={{ color: 'var(--text-3)', flexShrink: 0 }}>מעקב</span>
                    {editingFollowup ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                        <input
                          type="date"
                          className="input input-sm"
                          value={editNextFollowup}
                          disabled={savingFollowup}
                          autoFocus
                          onChange={(e) => {
                            const value = e.target.value;
                            setEditNextFollowup(value);
                            if (value) handleSaveFollowup(value);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              setEditNextFollowup(student.nextFollowup || '');
                              setEditingFollowup(false);
                            }
                          }}
                          style={{ fontSize: 12, padding: '2px 6px', width: 132 }}
                        />
                        {(editNextFollowup || student.nextFollowup) && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            disabled={savingFollowup}
                            onClick={() => handleSaveFollowup('')}
                            title="נקה מעקב"
                          >
                            <X size={11} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          disabled={savingFollowup}
                          onClick={() => {
                            setEditNextFollowup(student.nextFollowup || '');
                            setEditingFollowup(false);
                          }}
                        >
                          ביטול
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditNextFollowup(student.nextFollowup || '');
                          setEditingFollowup(true);
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontWeight: 600,
                          color: student.nextFollowup ? 'var(--amber, #FCD34D)' : 'var(--text-3)',
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                        title="לחץ להוספת מעקב"
                      >
                        {student.nextFollowup || '+ הוסף'}
                      </button>
                    )}
                </div>
              </div>
            )}

            {/* Selected child folders */}
            {showStudentProfile && (
              <div style={{ order: 3, display: 'flex', flexDirection: 'column' }}>
            <div style={{ order: 0, display: 'flex', alignItems: 'center', gap: 8, margin: '3px 2px 8px', color: 'var(--text-2)' }}>
              <span style={{ fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>אימון ובטיחות</span>
              <span style={{ height: 1, flex: 1, background: 'var(--border)' }} />
            </div>
            <div style={{ order: 6, display: 'flex', alignItems: 'center', gap: 8, margin: '10px 2px 8px', color: 'var(--text-2)' }}>
              <span style={{ fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>פעילות ורכישות</span>
              <span style={{ height: 1, flex: 1, background: 'var(--border)' }} />
            </div>
            <FolderRow
              id="health"
              title="אישורים"
              icon={FileCheck2}
              accent="#74B9FF"
              open={openFolder === 'health'}
              onToggle={toggleFolder}
              style={{ order: 1 }}
              renderBody={() => (
                <>
              {(() => {
                // A doctor's approval hangs off the same declaration but is not
                // the declaration: counting it as one would hide the fact that
                // the signed form itself is still missing.
                const isClearanceDoc = (doc) => doc.type === 'medical_clearance';
                const isHealthDoc = (doc) => !isClearanceDoc(doc)
                  && (doc.isVirtual
                    || doc.type === 'health_declaration_pdf'
                    || doc.type === 'health_waiver_pdf');
                // One row per declaration (newest file wins). Duplicate PDFs
                // for the same signature used to stack as identical lines.
                const byDeclaration = new Map();
                for (const doc of clientDocuments) {
                  if (!isHealthDoc(doc)) continue;
                  const key = doc.declarationId || doc.id;
                  const prev = byDeclaration.get(key);
                  if (!prev || String(doc.created_at || '') > String(prev.created_at || '')) {
                    byDeclaration.set(key, doc);
                  }
                }
                for (const decl of studentDeclarations) {
                  if (!(decl.signed || decl.status === 'approved' || decl.waiverAccepted)) continue;
                  if (byDeclaration.has(decl.id)) continue;
                  if ([...byDeclaration.values()].some((d) => d.declarationId === decl.id)) continue;
                  byDeclaration.set(decl.id, {
                    id: `virtual_${decl.id}`,
                    fileName: 'הצהרת בריאות חתומה',
                    created_at: decl.signedAt || decl.signedDate || decl.date || decl.createdAt || Date.now(),
                    type: 'health_declaration_pdf',
                    declarationId: decl.id,
                    isVirtual: true,
                    virtualData: decl,
                  });
                }
                if (
                  !byDeclaration.size
                  && isHealthSigned
                  && !studentDeclarations.length
                ) {
                  byDeclaration.set(`virtual_signed_${student.id}`, {
                    id: `virtual_signed_${student.id}`,
                    fileName: 'הצהרת בריאות חתומה',
                    created_at: student.healthSignedAt || student.waiverSignedAt || Date.now(),
                    type: 'health_declaration_pdf',
                    isVirtual: true,
                    virtualData: healthDecl,
                  });
                }
                const combinedDocuments = [
                  ...[...byDeclaration.values()].sort((a, b) =>
                    String(b.created_at || '').localeCompare(String(a.created_at || ''))
                  ),
                  ...clientDocuments.filter(isClearanceDoc),
                ];
                const hasHealthDoc = combinedDocuments.some(isHealthDoc);
                // One row per approval, newest file wins — the same rule the
                // health rows above already follow. Two PDFs saved under one
                // approval (a retried upload) used to stack as two identical
                // lines that both claimed the same signature and expiry.
                const participationDocsByWaiverId = new Map();
                const unlinkedParticipationDocs = [];
                for (const doc of clientDocuments) {
                  if (doc.type !== 'participation_waiver_pdf') continue;
                  const waiverId = String(doc.waiverId || doc.waiver_id || '');
                  if (!waiverId) {
                    unlinkedParticipationDocs.push(doc);
                    continue;
                  }
                  const prev = participationDocsByWaiverId.get(waiverId);
                  if (!prev || String(doc.created_at || '') > String(prev.created_at || '')) {
                    participationDocsByWaiverId.set(waiverId, doc);
                  }
                }
                const physicalParticipationDocs = [
                  ...participationDocsByWaiverId.values(),
                  ...unlinkedParticipationDocs,
                ];
                const participationRows = [
                  ...physicalParticipationDocs.map((doc) => {
                    const waiver = participationWaivers.find((row) => String(row.id) === String(doc.waiverId || '')) || null;
                    return {
                      category: 'participation',
                      scope: participationDocumentScope(doc, waiver),
                      createdAt: doc.created_at || '',
                      doc,
                      waiver,
                    };
                  }),
                  ...participationWaivers
                    .filter((waiver) => !participationDocsByWaiverId.has(String(waiver.id)))
                    .map((waiver) => ({
                      category: 'participation',
                      scope: participationDocumentScope(null, waiver),
                      createdAt: waiver.signed_at || waiver.signedAt || waiver.created_at || '',
                      doc: {
                        id: `virtual_waiver_${waiver.id}`,
                        waiverId: waiver.id,
                        fileName: '',
                        created_at: waiver.signed_at || waiver.signedAt || waiver.created_at || '',
                        isVirtual: true,
                      },
                      waiver,
                    })),
                ];
                const unifiedDocumentRows = filterAndSortDocumentRows([
                  ...combinedDocuments.map((doc) => ({
                    category: 'health',
                    createdAt: doc.created_at || '',
                    doc,
                  })),
                  ...participationRows,
                ], documentKindFilter);
                // Renewal banner when nothing is signed, or the signature expired
                const showUnsignedControls = healthExpired || (!isHealthSigned && !hasHealthDoc);
                // Form-type picker + send stay available even after a signature —
                // a family may still need the trip or activity form.
                const canSendForm = !!parent?.phone;

                /**
                 * The sealed evidence chain of one signed document.
                 *
                 * The PDF shows what was signed; this shows that the signing
                 * happened — which screens were open and for how long, when each
                 * box was ticked, when the end of the waiver was on screen, the
                 * phone verification, the address it came from, and a seal over
                 * all of it. It is what answers a challenge to the signature.
                 */
                const downloadEvidenceChain = async (documentId, label) => {
                  if (!documentId) return;
                  setHealthSendMsg('');
                  try {
                    const res = await fetch(`/api/signature-evidence?documentId=${encodeURIComponent(documentId)}`);
                    if (!res.ok) throw new Error('evidence fetch failed');
                    const data = await res.json();
                    if (!data?.events?.length) {
                      setHealthSendMsg('אין רשומת ראיות למסמך הזה — הוא נחתם לפני שהתיעוד הופעל');
                      return;
                    }
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `evidence-${label || documentId}.json`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                    setHealthSendMsg('קובץ הראיות הורד למחשב');
                  } catch (err) {
                    console.error(err);
                    setHealthSendMsg('שגיאה בהורדת רשומת הראיות');
                  }
                };

                const handleDownloadDoc = async (doc) => {
                  const source = doc.virtualData || healthDecl;
                  const busyKey = doc.id || 'virtual-health';
                  if (doc.isVirtual || (!doc.id || String(doc.id).startsWith('virtual_'))) {
                    if (!source) {
                      setHealthSendMsg('האישור עדיין נטען — נסו שוב בעוד רגע');
                      return;
                    }
                    setDownloadingPdf(busyKey);
                    setHealthSendMsg('');
                    try {
                      await downloadHealthDeclarationPdf(source);
                      setHealthSendMsg('הקובץ ירד למחשב — בדקו בתיקיית ההורדות');
                    } catch (err) {
                      console.error(err);
                      setHealthSendMsg('שגיאה בהורדת האישור');
                    } finally {
                      setDownloadingPdf('');
                    }
                    return;
                  }
                  setDownloadingPdf(busyKey);
                  setHealthSendMsg('');
                  try {
                    const res = await fetch(`/api/documents/${encodeURIComponent(doc.id)}/download`);
                    if (!res.ok) throw new Error('download failed');
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = doc.fileName || 'document.pdf';
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                    setHealthSendMsg('הקובץ ירד למחשב — בדקו בתיקיית ההורדות');
                  } catch (err) {
                    console.error(err);
                    setHealthSendMsg('שגיאה בהורדת המסמך מהתיק');
                  } finally {
                    setDownloadingPdf('');
                  }
                };

                // Deleting a signed declaration takes the declaration itself with
                // it, not just the file: leaving the record behind keeps the card
                // marked as signed, and the file is rebuilt from it a moment later.
                const handleDeleteDoc = async (doc) => {
                  const healthRow = isHealthDoc(doc);
                  const declId = doc.declarationId || doc.virtualData?.id || healthDecl?.id || '';
                  setPendingDocDelete(null);
                  setDeleteConfirmText('');
                  setDeletingDocId(doc.id);
                  setHealthSendMsg('');
                  try {
                    const url = healthRow
                      ? `/api/students/${encodeURIComponent(student.id)}/health-declaration${declId ? `?declarationId=${encodeURIComponent(declId)}` : ''}`
                      : `/api/documents/${encodeURIComponent(doc.id)}`;
                    const res = await fetch(url, { method: 'DELETE' });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(data.error || 'delete failed');
                    if (healthRow) {
                      if (declId) pdfBackfillRef.current.delete(declId);
                      setStudentDeclarations((prev) => prev.filter((d) => d.id !== declId));
                      setHealthDecl((prev) => {
                        if (!declId || prev?.id === declId) {
                          const next = studentDeclarations.find((d) => d.id !== declId);
                          return next || null;
                        }
                        return prev;
                      });
                      // Keep the card marks in sync with whatever is still on
                      // file — clearing them while a trip/wall signature remains
                      // made the icons lie about a delete that was only partial.
                      if (onUpdateStudent) {
                        onUpdateStudent(student.id, {
                          healthSignedAt: data.student?.healthSignedAt ?? null,
                          waiverSignedAt: data.student?.waiverSignedAt ?? null,
                          status: data.student?.status || student.status,
                        });
                      }
                    }
                    const docsRes = await fetch(`/api/students/${encodeURIComponent(student.id)}/documents`);
                    setClientDocuments(docsRes.ok ? await docsRes.json() : []);
                    setHealthSendMsg(healthRow ? 'הצהרת הבריאות נמחקה מהתיק' : 'המסמך נמחק מהתיק');
                  } catch (err) {
                    console.error(err);
                    setHealthSendMsg(err.message === 'delete failed' ? 'מחיקת המסמך נכשלה' : (err.message || 'מחיקת המסמך נכשלה'));
                  } finally {
                    setDeletingDocId('');
                  }
                };

                // A participation approval is its own legal record, so removing
                // it takes the approval row with the PDF. Dropping only the file
                // would leave the approval standing, and the folder would draw
                // the line again from it a moment later.
                const handleDeleteParticipation = async (doc, waiver) => {
                  const waiverId = waiver?.id || doc.waiverId || '';
                  setPendingDocDelete(null);
                  setDeleteConfirmText('');
                  setDeletingDocId(doc.id);
                  setHealthSendMsg('');
                  try {
                    const url = waiverId
                      ? `/api/students/${encodeURIComponent(student.id)}/participation-waiver?waiverId=${encodeURIComponent(waiverId)}`
                      : `/api/documents/${encodeURIComponent(doc.id)}`;
                    const res = await fetch(url, { method: 'DELETE' });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(data.error || 'delete failed');
                    if (waiverId) {
                      setParticipationWaivers((prev) => prev.filter((row) => String(row.id) !== String(waiverId)));
                    }
                    const docsRes = await fetch(`/api/students/${encodeURIComponent(student.id)}/documents`);
                    setClientDocuments(docsRes.ok ? await docsRes.json() : []);
                    setHealthSendMsg('אישור ההשתתפות נמחק מהתיק');
                  } catch (err) {
                    console.error(err);
                    setHealthSendMsg(err.message === 'delete failed' ? 'מחיקת אישור ההשתתפות נכשלה' : (err.message || 'מחיקת אישור ההשתתפות נכשלה'));
                  } finally {
                    setDeletingDocId('');
                  }
                };

                const runPendingDelete = () => {
                  if (!pendingDocDelete) return;
                  if (pendingDocDelete.participationRow) {
                    handleDeleteParticipation(pendingDocDelete.doc, pendingDocDelete.waiver);
                    return;
                  }
                  handleDeleteDoc(pendingDocDelete.doc);
                };

                const downloadParticipationDoc = async (doc, waiver) => {
                  setDownloadingPdf(doc.id || 'virtual-participation');
                  setHealthSendMsg('');
                  try {
                    if (!doc.isVirtual) {
                      const res = await fetch(`/api/documents/${encodeURIComponent(doc.id)}/download`);
                      if (!res.ok) throw new Error('download failed');
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = doc.fileName || 'participation-waiver.pdf';
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                      URL.revokeObjectURL(url);
                    } else {
                      const snapshot = waiver?.form_snapshot || waiver?.formSnapshot || {};
                      const participant = snapshot.participant || {};
                      const signer = snapshot.signer || {};
                      await downloadParticipationWaiverPdf({
                        ...snapshot,
                        ...waiver,
                        documentType: 'participation_waiver',
                        templateSlug: waiver?.scope || snapshot.scope || 'wall',
                        climberName: participant.name || student.name || '',
                        studentName: participant.name || student.name || '',
                        parentName: signer.name || parent?.name || '',
                        parentIdNum: signer.idNumber || parent?.idNumber || '',
                        phone: signer.phone || parent?.phone || '',
                        signature_url: waiver?.signature_url || '',
                        signedDate: waiver?.signed_at || waiver?.signedAt || '',
                      });
                    }
                    setHealthSendMsg('קובץ אישור ההשתתפות ירד למחשב — בדקו בתיקיית ההורדות');
                  } catch (err) {
                    console.error(err);
                    setHealthSendMsg('שגיאה בהורדת אישור ההשתתפות');
                  } finally {
                    setDownloadingPdf('');
                  }
                };

                return (
                  <>
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: 8, marginBottom: 12, flexWrap: 'wrap',
                    }}>
                      <button
                        type="button"
                        className="btn btn-success btn-xs"
                        disabled={sendingHealth || !canSendForm}
                        onClick={() => setShowHealthSendModal(true)}
                      >
                        <Send size={12} /> שליחת טופס
                      </button>
                      {!parentOnly && (
                        <div style={{
                          display: 'flex', gap: 4, flexWrap: 'nowrap',
                          alignItems: 'center', overflowX: 'auto',
                        }}>
                          {/* Each button wears the mark and the colour its own lines
                              wear below, so the filter reads as the same language as
                              the folder it filters. */}
                          {[
                            {
                              key: 'all', label: 'הכול', Icon: LayoutGrid,
                              color: 'var(--text-2)',
                              bg: 'rgba(148,163,184,0.14)', border: 'rgba(148,163,184,0.35)',
                            },
                            { ...DOCUMENT_FILE_KINDS.health, key: 'health' },
                            { ...DOCUMENT_FILE_KINDS.wall, key: 'participation:wall' },
                            { ...DOCUMENT_FILE_KINDS.trip, key: 'participation:trip', label: 'טיולים' },
                          ].map((filter) => {
                            const active = documentKindFilter === filter.key;
                            const FilterIcon = filter.Icon;
                            return (
                              <button
                                key={filter.key}
                                type="button"
                                className={`btn btn-xs ${active ? 'btn-primary' : 'btn-ghost'}`}
                                aria-pressed={active}
                                title={filter.title || filter.label}
                                onClick={() => setDocumentKindFilter(filter.key)}
                                style={{
                                  flexShrink: 0, minWidth: 54, fontWeight: 700,
                                  display: 'inline-flex', alignItems: 'center',
                                  justifyContent: 'center', gap: 4,
                                  color: filter.color,
                                  ...(active
                                    ? { background: filter.bg, borderColor: filter.border }
                                    : null),
                                }}
                              >
                                <FilterIcon size={13} strokeWidth={2.3} style={{ flexShrink: 0 }} />
                                {filter.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {showUnsignedControls && (
                      <>
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
                          padding: '8px 10px', borderRadius: 8,
                          background: 'rgba(252, 211, 77, 0.1)',
                          border: '1px solid rgba(252, 211, 77, 0.35)',
                        }}>
                          <span style={{ fontSize: 16 }}>⏳</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 700 }}>
                              {healthExpired ? 'פג תוקף — נדרשת חתימה מחדש' : 'טרם נחתם'}
                            </div>
                            {healthExpired && (
                              <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 4 }}>
                                הטופס הקודם פג בתאריך {healthExpiry.toLocaleDateString('he-IL')} · הקובץ הישן נשמר בתיק
                              </div>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {parentOnly && healthExpired && healthDecl && (
                            <button
                              type="button"
                              className="btn btn-primary btn-xs"
                              disabled={!!downloadingPdf}
                              onClick={() => handleDownloadDoc({ isVirtual: true, virtualData: healthDecl })}
                            >
                              <Download size={12} /> {downloadingPdf === 'virtual-health' ? 'מכין...' : 'הורדה'}
                            </button>
                          )}
                        </div>
                      </>
                    )}

                    {!showUnsignedControls && (
                      <>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {parentOnly && isHealthSigned && !healthExpired && (
                            <button
                              type="button"
                              className="btn btn-primary btn-xs"
                              disabled={!!downloadingPdf || !healthDecl}
                              onClick={async () => {
                                if (!healthDecl) return;
                                setDownloadingPdf('virtual-health');
                                setHealthSendMsg('');
                                try {
                                  await downloadHealthDeclarationPdf(healthDecl);
                                  setHealthSendMsg('הקובץ ירד למחשב — בדקו בתיקיית ההורדות');
                                } catch (err) {
                                  console.error(err);
                                  setHealthSendMsg('שגיאה בהורדת האישור');
                                } finally {
                                  setDownloadingPdf('');
                                }
                              }}
                            >
                              <Download size={12} /> {downloadingPdf === 'virtual-health' ? 'מכין...' : 'הורדה'}
                            </button>
                          )}
                        </div>
                      </>
                    )}

                    {healthSendMsg && (
                      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-2)' }}>
                        <div style={{ marginBottom: healthSendLink ? 6 : 0 }}>{healthSendMsg}</div>
                        {healthSendLink && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                            <input
                              className="input input-sm"
                              readOnly
                              value={healthSendLink}
                              style={{ flex: 1, minWidth: 140, fontSize: 11 }}
                              onFocus={(e) => e.target.select()}
                            />
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(healthSendLink);
                                  setHealthSendMsg('הקישור הועתק — אפשר לשלוח אותו ללקוח בוואטסאפ');
                                } catch {
                                  setHealthSendMsg('לא הצלחתי להעתיק — סמנו את הקישור ידנית');
                                }
                              }}
                            >
                              העתק קישור
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {!parentOnly && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ borderTop: '1px solid var(--border)', marginBottom: 12 }} />
                        <div style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          gap: 8, marginBottom: 8,
                        }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)' }}>מסמכים בתיק</div>
                        </div>
                        {docsLoading && !hasHealthDoc && !participationRows.length ? (
                          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>טוען...</div>
                        ) : unifiedDocumentRows.length === 0 ? (
                          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                            {documentKindFilter === 'health'
                              ? 'אין בתיק הצהרות בריאות או אישורי רופא.'
                              : documentKindFilter.startsWith('participation')
                                ? 'אין בתיק אישורי השתתפות חתומים.'
                                : 'עדיין אין מסמכי בריאות או אישורי השתתפות בתיק.'}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {unifiedDocumentRows.map(({ category, doc, waiver }) => {
                              const participationRow = category === 'participation';
                              const healthRow = isHealthDoc(doc);
                              const clearanceRow = isClearanceDoc(doc);
                              const busy = deletingDocId === doc.id;
                              const scope = participationRow ? participationDocumentScope(doc, waiver) : '';
                              const kind = documentRowKind({ category, scope, clearance: clearanceRow });
                              const KindIcon = kind.Icon;
                              const title = kind.title;
                              const stamp = doc.created_at ? new Date(doc.created_at) : null;
                              const sourceDeclaration = doc.virtualData
                                || studentDeclarations.find((decl) => String(decl.id) === String(doc.declarationId || ''))
                                || (!clearanceRow ? healthDecl : null);
                              const healthSignedDate = sourceDeclaration?.signedAt
                                || sourceDeclaration?.signedDate
                                || sourceDeclaration?.date
                                || sourceDeclaration?.createdAt
                                || doc.created_at
                                || null;
                              const expiry = participationRow
                                ? new Date(waiver?.expires_at || waiver?.expiresAt || 0)
                                : (!clearanceRow && healthSignedDate ? healthExpiryDate(healthSignedDate) : null);
                              const hasExpiry = !!expiry && Number.isFinite(expiry.getTime());
                              const expired = hasExpiry && expiry.getTime() < Date.now();
                              return (
                                <div
                                  key={doc.id}
                                  style={{
                                    display: 'flex', flexDirection: 'column', gap: 6,
                                    padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)',
                                    borderInlineStartWidth: 3, borderInlineStartColor: kind.color,
                                    background: 'rgba(255,255,255,0.03)', opacity: busy ? 0.5 : 1,
                                  }}
                                >
                                  {/* Name and buttons on one line, the dates under them: with
                                      everything in a single wrapping row a long approval name
                                      pushed the buttons onto a line of their own. */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span
                                    className={`badge ${kind.badge}`}
                                    title={doc.fileName || title}
                                    style={{
                                      minHeight: 32, padding: '5px 10px', boxSizing: 'border-box',
                                      fontSize: 12, fontWeight: 600, lineHeight: 1.25,
                                      whiteSpace: 'normal', minWidth: 0, textAlign: 'start',
                                      display: 'inline-flex', alignItems: 'center', gap: 5,
                                    }}
                                  >
                                    <KindIcon size={13} style={{ flexShrink: 0 }} />
                                    {title}
                                  </span>
                                  <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center', marginInlineStart: 'auto' }}>
                                    <button
                                      type="button"
                                      className="btn btn-primary btn-xs"
                                      style={{
                                        height: 32, padding: '0 10px', boxSizing: 'border-box',
                                        display: 'inline-flex', alignItems: 'center', gap: 5,
                                        fontSize: 12, lineHeight: 1,
                                      }}
                                      title="הורדת הקובץ"
                                      disabled={busy || !!downloadingPdf || (!participationRow && doc.isVirtual && !(doc.virtualData || healthDecl))}
                                      onClick={() => participationRow
                                        ? downloadParticipationDoc(doc, waiver)
                                        : handleDownloadDoc(doc)}
                                    >
                                      {/* „מכין…” רק על הכפתור שנלחץ — דגל משותף
                                          סימן את כל התיקייה כעסוקה יחד. */}
                                      <Download size={13} /> {downloadingPdf === (doc.id || (participationRow ? 'virtual-participation' : 'virtual-health')) ? 'מכין...' : 'הורדה'}
                                    </button>
                                    {!clearanceRow && (
                                      <button
                                        type="button"
                                        className="btn btn-ghost btn-xs"
                                        style={{
                                          width: 32, height: 32, padding: 0, boxSizing: 'border-box',
                                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                        }}
                                        title="הורדת רשומת הראיות של החתימה"
                                        disabled={busy}
                                        onClick={() => downloadEvidenceChain(
                                          participationRow
                                            ? (waiver?.id || doc.waiverId || doc.id)
                                            : (sourceDeclaration?.id || doc.declarationId || doc.id),
                                          `${student?.name || ''}-${title}`.trim().replace(/\s+/g, '-')
                                        )}
                                      >
                                        <ShieldCheck size={13} />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-xs"
                                      style={{
                                        width: 32, height: 32, padding: 0, boxSizing: 'border-box',
                                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                        color: 'var(--red, #F87171)',
                                      }}
                                      title={`מחיקת ${kind.title} מהתיק`}
                                      disabled={busy || !!deletingDocId}
                                      onClick={() => {
                                        setDeleteConfirmText('');
                                        setPendingDocDelete({ doc, healthRow, participationRow, waiver, kind });
                                      }}
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </div>
                                  </div>
                                  <div style={{
                                    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                                    fontSize: 11, lineHeight: 1.4, color: 'var(--text-2)',
                                  }}>
                                    {hasExpiry && (
                                      <span className={expired ? 'badge badge-red' : undefined}>
                                        {expired ? 'פג תוקף' : 'בתוקף עד'} {expiry.toLocaleDateString('he-IL')}
                                      </span>
                                    )}
                                    {stamp && (
                                      <span style={{ color: 'var(--text-3)' }}>
                                        נחתם {stamp.toLocaleDateString('he-IL')} · {stamp.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {pendingDocDelete && (
                      <div
                        className="modal-backdrop"
                        style={{ zIndex: 400 }}
                        onClick={(e) => e.target === e.currentTarget && setPendingDocDelete(null)}
                      >
                        <div className="modal slide-up" style={{ maxWidth: 420 }}>
                          <div className="modal-header">
                            <div className="modal-title">
                              {pendingDocDelete.kind ? `מחיקת ${pendingDocDelete.kind.title}` : 'מחיקת מסמך'}
                            </div>
                            <button
                              type="button"
                              className="btn btn-ghost btn-icon btn-sm"
                              onClick={() => setPendingDocDelete(null)}
                            >
                              <X size={18} />
                            </button>
                          </div>
                          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
                              {pendingDocDelete.healthRow
                                ? `הצהרת הבריאות של ${student.name || 'המתאמן'} תימחק מהתיק יחד עם הקבצים ששמורים תחתיה, והמתאמן יסומן שוב כמי שטרם חתם.`
                                : pendingDocDelete.participationRow
                                  ? `${pendingDocDelete.kind.title} של ${student.name || 'המתאמן'} יימחק מהתיק יחד עם הקובץ החתום, והמתאמן יסומן שוב כמי שאין לו אישור לפעילות הזו.`
                                  : 'המסמך יימחק מהתיק ולא ניתן יהיה לשחזר אותו.'}
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                              <label className="form-label" style={{ fontSize: 12 }}>
                                כדי לאשר, הקלידו <strong>מחק</strong>
                              </label>
                              <input
                                className="input"
                                autoFocus
                                value={deleteConfirmText}
                                placeholder="מחק"
                                onChange={(e) => setDeleteConfirmText(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && deleteConfirmText.trim() === 'מחק') {
                                    runPendingDelete();
                                  }
                                }}
                              />
                            </div>
                          </div>
                          <div className="modal-footer" style={{ gap: 8 }}>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              disabled={deleteConfirmText.trim() !== 'מחק' || !!deletingDocId}
                              onClick={runPendingDelete}
                            >
                              <Trash2 size={14} /> מחיקה
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => setPendingDocDelete(null)}
                            >
                              ביטול
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
                </>
              )}
            />

            {/* Group folder */}
            {!parentOnly && (
              <FolderRow
                id="group"
                title="קבוצה"
                icon={Users}
                accent="#A78BFA"
                summary={groupSummary}
                open={openFolder === 'group'}
                onToggle={toggleFolder}
                style={{ order: 2 }}
                renderBody={() => (
                  <>
                {editingGroup ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <GroupPickerField
                      groups={groups}
                      selectedIds={editGroupIds}
                      disabled={savingGroup}
                      onToggle={(id) => {
                        setEditGroupIds((prev) => (
                          prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
                        ));
                      }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className="btn btn-primary btn-sm" disabled={savingGroup} onClick={handleSaveGroup}>
                        <Check size={13} /> {savingGroup ? 'שומר...' : 'שמור'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={savingGroup}
                        onClick={() => {
                          setEditGroupIds(studentGroupIds(student));
                          setEditingGroup(false);
                        }}
                      >
                        ביטול
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    {studentGroups.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {studentGroups.map((g) => (
                          <div key={g.id}>
                            <button
                              type="button"
                              onClick={() => navigate(`/schedule?group=${encodeURIComponent(g.id)}`)}
                              title="פתיחת החוג בלוח החוגים"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 5,
                                padding: 0,
                                background: 'none',
                                border: 'none',
                                font: 'inherit',
                                fontWeight: 700,
                                color: 'var(--text-1)',
                                cursor: 'pointer',
                                textAlign: 'right',
                              }}
                            >
                              <span style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>{g.name}</span>
                              <ChevronLeft size={13} style={{ opacity: 0.6, flexShrink: 0 }} />
                            </button>
                            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                              יום {g.day} בשעה {g.time}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ color: 'var(--text-3)', fontSize: 13 }}>לא משויך לחוג עדיין</div>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      style={{ marginTop: 8 }}
                      onClick={() => {
                        setEditGroupIds(studentGroupIds(student));
                        setEditingGroup(true);
                      }}
                    >
                      <Edit2 size={11} /> ערוך שיוך
                    </button>
                  </div>
                )}
                  </>
                )}
              />
            )}

            {/* Passes folder */}
            {!parentOnly && (
              <FolderRow
                id="passes"
                title="מנויים וכרטיסיות"
                icon={Ticket}
                accent="#38BDF8"
                summary={passesSummary}
                open={openFolder === 'passes'}
                onToggle={toggleFolder}
                style={{ order: 7 }}
                renderBody={() => (
                  <>
                {passesLoading ? (
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>טוען...</div>
                ) : customerPasses.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>אין מנוי או כרטיסייה פעילים</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {customerPasses.map((pass) => {
                      const isPunch = pass.pass_type === 'punch_card';
                      const remaining = Number(pass.visits_remaining);
                      const totalVisits = Number(pass.visits_total);
                      // A credited or expired pass stays in the file as history —
                      // it must not read like an asset the customer can still use.
                      const isLive = pass.status === 'active';
                      return (
                        <div key={pass.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8, opacity: isLive ? 1 : 0.6 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: 13 }}>{pass.name}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                                {passSubtitle(pass)}
                              </div>
                              {/* Bought under a benefit — must be obvious before anyone credits it */}
                              {passDiscountNote(pass) && (
                                <div style={{ marginTop: 4 }}>
                                  <span className="badge badge-amber" style={{ fontSize: 10 }}>
                                    <Gift size={10} /> {passDiscountNote(pass)}
                                  </span>
                                </div>
                              )}
                              {isPunch && (
                                <div style={{
                                  marginTop: 4,
                                  fontSize: 14,
                                  fontWeight: 800,
                                  color: !isLive ? 'var(--text-3)' : (remaining > 0 ? 'var(--green)' : 'var(--red)'),
                                }}>
                                  נשארו {remaining} מתוך {totalVisits}
                                </div>
                              )}
                            </div>
                            {isPunch && pass.status === 'active' && remaining > 0 && (
                              <button
                                type="button"
                                className="btn btn-primary btn-xs"
                                disabled={punchingId === pass.id || !!punchBlockReason}
                                title={punchBlockReason || ''}
                                onClick={() => handlePunchPass(pass.id)}
                              >
                                {punchingId === pass.id ? 'מנקב...' : 'ניקוב'}
                              </button>
                            )}
                          </div>
                          {isPunch && pass.status === 'active' && remaining > 0 && punchBlockReason && (
                            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--red)', fontWeight: 700 }}>
                              אי אפשר לנקב — {punchBlockReason}
                            </div>
                          )}
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            style={{ marginTop: 4, fontSize: 11 }}
                            onClick={() => togglePassPunches(pass.id)}
                          >
                            {openPunchLog === pass.id ? 'סגירת היסטוריית ניקובים' : 'היסטוריית ניקובים'}
                          </button>
                          {openPunchLog === pass.id && passPurchasedText(pass) && (
                            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--green)', fontWeight: 700 }}>
                              {passPurchasedText(pass)}
                            </div>
                          )}
                          {openPunchLog === pass.id && Array.isArray(passPunches[pass.id]) && (
                            passPunches[pass.id].length === 0 ? (
                              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-3)' }}>עדיין לא נוקבה כניסה</div>
                            ) : (
                              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-3)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {/* The server sends newest first; the log reads as a timeline —
                                    purchase, then punches in the order they happened. */}
                                {passPunches[pass.id].slice(0, 10).reverse().map((p) => (
                                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{
                                      textDecoration: p.cancelled_at ? 'line-through' : 'none',
                                      // A cancelled punch gave the visit back — it is not a punch any more.
                                      color: p.cancelled_at ? 'var(--text-3)' : 'var(--blue)',
                                    }}>
                                      {new Date(p.punched_at).toLocaleString('he-IL')} · נשאר {p.visits_after}
                                      {p.punched_by ? ` · ${p.punched_by}` : ''}
                                    </span>
                                    {p.cancelled_at ? (
                                      <span className="badge badge-gray" style={{ fontSize: 10 }}>
                                        בוטל{p.cancelled_by ? ` · ${p.cancelled_by}` : ''}
                                      </span>
                                    ) : (
                                      <button
                                        type="button"
                                        className="btn btn-ghost btn-xs"
                                        style={{ fontSize: 10, color: 'var(--red)' }}
                                        disabled={cancellingPunchId === p.id}
                                        onClick={() => handleCancelPunch(pass.id, p.id)}
                                      >
                                        {cancellingPunchId === p.id ? 'מבטל...' : 'ביטול כניסה'}
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                  </>
                )}
              />
            )}

            {/* Coupons folder — benefits from campaigns, or issued by hand */}
            <FolderRow
              id="coupons"
              title="הטבות וקופונים"
              icon={Gift}
              accent="#FB923C"
              summary={couponsSummary}
              summaryColor={activeCoupons.length > 0 ? 'var(--green)' : undefined}
              open={openFolder === 'coupons'}
              onToggle={toggleFolder}
              style={{ order: 10 }}
              renderBody={() => (
                <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {couponsLoading ? (
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>טוען...</div>
                ) : coupons.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    עדיין אין הטבות. אפשר להנפיק אחת ידנית, או שקמפיין ינפיק לבד.
                  </div>
                ) : (
                  coupons.map((coupon) => (
                    <div key={coupon.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{coupon.label}</div>
                          {coupon.recurring && (
                            <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 2 }}>
                              הנחה קבועה · ללא תאריך תפוגה{coupon.usage_count ? ` · מומשה ${coupon.usage_count} פעמים` : ''}
                            </div>
                          )}
                          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                            קוד <strong style={{ fontFamily: 'monospace' }}>{coupon.code}</strong>
                            {coupon.expires_at
                              ? coupon.state === 'expired'
                                ? ` · פג ב-${coupon.expires_at}`
                                : ` · בתוקף עד ${coupon.expires_at}`
                              : !coupon.recurring ? ' · ללא תוקף' : ''}
                            {coupon.state === 'active' && coupon.days_left != null
                              ? ` · עוד ${coupon.days_left} ימים`
                              : ''}
                          </div>
                          {/* When it was used and for how much — the detail a refund needs */}
                          {coupon.state === 'redeemed' && (
                            <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 2 }}>
                              מומש{coupon.redeemed_at ? ` ב-${new Date(coupon.redeemed_at).toLocaleDateString('he-IL')}` : ''}
                              {coupon.redeemed_amount != null
                                ? ` · הנחה של ₪${Number(coupon.redeemed_amount).toLocaleString()}`
                                : ''}
                            </div>
                          )}
                          {coupon.state === 'reserved' && (
                            <div style={{ fontSize: 11, color: 'var(--amber, #FBBF24)', marginTop: 2 }}>
                              שמורה לקישור תשלום שנשלח · תמומש כשהתשלום ייקלט
                            </div>
                          )}
                          {coupon.state === 'cancelled' && coupon.cancelled_reason && (
                            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                              {coupon.cancelled_reason}
                            </div>
                          )}
                          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                            {coupon.source === 'campaign' ? coupon.campaign_name || 'מקמפיין' : 'הונפק ידנית'}
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', flexShrink: 0 }}>
                          <span className={COUPON_STATE_BADGE[coupon.state]?.cls || 'badge badge-gray'}>
                            {COUPON_STATE_BADGE[coupon.state]?.label || coupon.state}
                          </span>
                          {coupon.state === 'active' && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              style={{ fontSize: 10, color: 'var(--red)' }}
                              disabled={couponBusyId === coupon.id}
                              onClick={() => handleCancelCoupon(coupon)}
                            >
                              ביטול
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}

                {activeCoupons.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    ההטבה תוצע אוטומטית בקופה כשבוחרים את הלקוח הזה.
                  </div>
                )}

                {showIssueCoupon ? (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <CouponField label="סוג ההטבה">
                      <AppSelect
                        className="input input-sm"
                        value={couponDraft.type}
                        onChange={(e) => setCouponDraft((d) => ({ ...d, type: e.target.value }))}
                      >
                        <option value="percent">אחוז הנחה</option>
                        <option value="amount">סכום הנחה בשקלים</option>
                        <option value="free_item">פריט חינם</option>
                        <option value="bogo">אחד פלוס אחד</option>
                      </AppSelect>
                    </CouponField>

                    {(couponDraft.type === 'percent' || couponDraft.type === 'amount') && (
                      <CouponField label={couponDraft.type === 'percent' ? 'גובה ההנחה באחוזים' : 'גובה ההנחה בשקלים'}>
                        <input
                          className="input input-sm"
                          type="number"
                          value={couponDraft.value}
                          onChange={(e) => setCouponDraft((d) => ({ ...d, value: e.target.value }))}
                        />
                      </CouponField>
                    )}

                    <CouponField
                      label="על מה ההטבה חלה"
                      hint={
                        couponDraft.pricelistId
                          ? 'ההנחה תינתן רק על המוצר הזה'
                          : 'ההנחה תינתן על הפריט היקר ביותר בעגלה'
                      }
                    >
                      <AppSelect
                        className="input input-sm"
                        value={couponDraft.pricelistId}
                        onChange={(e) => setCouponDraft((d) => ({ ...d, pricelistId: e.target.value }))}
                      >
                        <option value="">כל מוצר בעגלה</option>
                        {(pricelist || [])
                          .filter((p) => p.active !== false)
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} · ₪{item.price}
                            </option>
                          ))}
                      </AppSelect>
                    </CouponField>

                    {couponDraft.type !== 'amount' && (
                      <CouponField label="על כמה פריטים" hint="בדרך כלל אחד">
                        <input
                          className="input input-sm"
                          type="number"
                          min="1"
                          value={couponDraft.units}
                          onChange={(e) => setCouponDraft((d) => ({ ...d, units: e.target.value }))}
                        />
                      </CouponField>
                    )}

                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={couponDraft.recurring}
                        onChange={(e) => setCouponDraft((d) => ({ ...d, recurring: e.target.checked }))}
                      />
                      <span><strong>הנחה קבועה למתאמן</strong><br /><small style={{ color: 'var(--text-3)' }}>תוצע בכל קנייה ולא תתבטל אחרי מימוש</small></span>
                    </label>

                    {!couponDraft.recurring && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={couponDraft.noExpiry}
                          onChange={(e) => setCouponDraft((d) => ({ ...d, noExpiry: e.target.checked }))}
                        />
                        <span><strong>ללא תוקף</strong><br /><small style={{ color: 'var(--text-3)' }}>הטבה חד־פעמית שלא תפוג עד למימוש</small></span>
                      </label>
                    )}

                    {!couponDraft.recurring && !couponDraft.noExpiry && (
                      <CouponField
                        label="תוקף ההטבה בימים"
                        hint={couponExpiryPreview(couponDraft.validityDays)}
                      >
                        <input
                          className="input input-sm"
                          type="number"
                          min="1"
                          value={couponDraft.validityDays}
                          onChange={(e) => setCouponDraft((d) => ({ ...d, validityDays: e.target.value }))}
                        />
                      </CouponField>
                    )}

                    <CouponField label="איך ההטבה תיקרא ללקוח" hint="מופיע בתיק, בהודעה ובקופה">
                      <input
                        className="input input-sm"
                        value={couponDraft.label}
                        onChange={(e) => setCouponDraft((d) => ({ ...d, label: e.target.value }))}
                        placeholder={suggestedCouponLabel(couponDraft, pricelist)}
                      />
                    </CouponField>

                    <div style={{ fontSize: 11, color: 'var(--text-2)', background: 'rgba(255,255,255,0.04)', borderRadius: 6, padding: 8 }}>
                      <Gift size={11} />{' '}
                      {couponDraft.label || suggestedCouponLabel(couponDraft, pricelist)}
                      {' · '}
                      {couponDraft.recurring ? 'קבועה · ללא תפוגה' : couponDraft.noExpiry ? 'חד־פעמית · ללא תוקף' : (couponExpiryPreview(couponDraft.validityDays) || 'בלי תוקף')}
                    </div>

                    {couponError && <div style={{ fontSize: 11, color: '#fb7185' }}>{couponError}</div>}
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="btn btn-primary btn-xs"
                        disabled={couponBusyId === 'issue'}
                        onClick={handleIssueCoupon}
                      >
                        {couponBusyId === 'issue' ? 'מנפיק...' : 'הנפקה'}
                      </button>
                      <button type="button" className="btn btn-ghost btn-xs" onClick={() => setShowIssueCoupon(false)}>
                        ביטול
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowIssueCoupon(true)}>
                    <Gift size={13} /> הוספת הטבה או הנחה קבועה
                  </button>
                )}
              </div>
                </>
              )}
            />

            {/* Purchases folder — what was bought, not just what was charged */}
            <FolderRow
              id="purchases"
              title="רכישות"
              icon={ShoppingBag}
              accent="#38BDF8"
              summary={salesSummary}
              summaryColor={salesPending > 0 ? 'var(--amber, #FBBF24)' : undefined}
              open={openFolder === 'purchases'}
              onToggle={toggleFolder}
              style={{ order: 9 }}
              renderBody={() => (
                <>
              {salesLoading && !sales.length ? (
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>טוען...</div>
              ) : sales.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  עדיין לא נרשמה כאן רכישה — מכירה בדלפק או קישור תשלום יופיעו כאן.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto', overscrollBehavior: 'contain' }}>
                  {sales.map((sale) => {
                    const badge = saleStatusBadge(sale.status);
                    const names = (sale.items || [])
                      .map((i) => {
                        const label = i.description || i.name || 'פריט';
                        return Number(i.quantity) > 1 ? `${label} ×${i.quantity}` : label;
                      })
                      .join(' · ');
                    return (
                      <div key={sale.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 13 }}>{names || 'רכישה'}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                              {sale.created_at
                                ? new Date(sale.created_at).toLocaleDateString('he-IL')
                                : ''}
                              {saleMethodLabel(sale.payment_method) ? ` · ${saleMethodLabel(sale.payment_method)}` : ''}
                              {sale.icount_doc_number ? ` · מס׳ ${sale.icount_doc_number}` : ''}
                            </div>
                          </div>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, fontSize: 12 }}>
                            ₪{Number(sale.total || 0).toLocaleString()}
                            <span className={badge.cls}>{badge.label}</span>
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                          {sale.icount_doc_url && (
                            <a className="btn btn-ghost btn-xs" href={sale.icount_doc_url} target="_blank" rel="noreferrer">
                              <ReceiptText size={12} /> חשבונית
                            </a>
                          )}
                          {sale.status !== 'paid' && sale.payment_url && (
                            <a className="btn btn-ghost btn-xs" href={sale.payment_url} target="_blank" rel="noreferrer">
                              <CreditCard size={12} /> קישור לתשלום
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
                </>
              )}
            />

            {/* Equipment folder — children and adult trainees */}
            {showEquipment && (
              <FolderRow
                id="equipment"
                title="ציוד"
                icon={Package}
                accent="#A3E635"
                summary={equipmentSummary}
                open={openFolder === 'equipment'}
                onToggle={toggleFolder}
                style={{ order: 4 }}
                renderBody={() => (
                  <>
                {/* רק הטעינה הראשונה מחליפה את התוכן. רענון אחרי שינוי סטטוס
                    משאיר את הכרטיסיות במקום, אחרת התיק מתכווץ לשורה אחת
                    וכל מה שמתחתיו קופץ למעלה וחזרה. */}
                {equipmentLoading && !equipmentItems.length ? (
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>טוען...</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={equipmentBusyId === 'link'}
                      onClick={handleSendEquipmentLink}
                    >
                      <Send size={13} />
                      {equipmentBusyId === 'link' ? 'שולח...' : 'שלח קישור תשלום ציוד'}
                    </button>
                    {equipmentMsg && (
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: equipmentLink ? 'var(--text-2)' : '#fb7185',
                        }}
                      >
                        {equipmentMsg}
                      </div>
                    )}
                    {equipmentLink && (
                      <a
                        href={equipmentLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 11, wordBreak: 'break-all', color: 'var(--accent)' }}
                      >
                        {equipmentLink}
                      </a>
                    )}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: `repeat(${Math.max(1, Math.min(3, equipmentItems.length))}, minmax(0, 1fr))`,
                        gap: 8,
                      }}
                    >
                      {EQUIPMENT_ORDER.map((type) => {
                        const item = equipmentItems.find((i) => i.item_type === type);
                        if (!item) return null;
                        const tone = equipmentItemTone(item);
                        const color = equipmentToneColor(tone);
                        const Icon = EQUIPMENT_ICONS[type] || Package;
                        const editing = equipmentEditId === item.id;
                        const busy = equipmentBusyId === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            disabled={busy}
                            onClick={() => setEquipmentEditId(editing ? '' : item.id)}
                            style={{
                              width: '100%',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: 6,
                              padding: '12px 6px 10px',
                              borderRadius: 10,
                              border: editing ? `2px solid ${color}` : '1px solid var(--border)',
                              background: editing ? equipmentToneBg(tone) : 'rgba(255,255,255,0.03)',
                              cursor: busy ? 'wait' : 'pointer',
                              opacity: busy ? 0.6 : 1,
                              color: 'var(--text-1)',
                            }}
                          >
                            <Icon
                              size={24}
                              color={EQUIPMENT_ICON_COLORS[type] || 'var(--text-2)'}
                              strokeWidth={2.2}
                            />
                            <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--text-1)' }}>
                              {EQUIPMENT_LABELS[type] || type}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                fontWeight: 800,
                                color,
                                background: equipmentToneBg(tone),
                                border: `1px solid ${color}66`,
                                borderRadius: 999,
                                padding: '3px 8px',
                                textAlign: 'center',
                                lineHeight: 1.25,
                                maxWidth: '100%',
                              }}
                            >
                              {busy ? '...' : equipmentToneLabel(tone, type)}
                            </div>
                            {type === 'shirt' && item.shirt_size && (
                              <div style={{ fontSize: 10, color: 'var(--text-3)' }}>מידה {item.shirt_size}</div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {equipmentEditId && (() => {
                      const item = equipmentItems.find((i) => i.id === equipmentEditId);
                      if (!item) return null;
                      const tone = equipmentItemTone(item);
                      const busy = equipmentBusyId === item.id;
                      const label = EQUIPMENT_LABELS[item.item_type] || item.item_type;
                      return (
                        <div
                          style={{
                            marginTop: 2,
                            padding: 10,
                            borderRadius: 10,
                            border: '1px solid var(--border)',
                            background: 'rgba(255,255,255,0.06)',
                          }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: 'var(--text-1)' }}>
                            סטטוס ל{label}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {EQUIPMENT_STATUS_TONES.map((opt) => {
                              const optColor = equipmentToneColor(opt);
                              const selected = opt === tone;
                              const { allowed, reason } = equipmentToneTransition(opt, item);
                              const locked = !selected && !allowed;
                              return (
                                <button
                                  key={opt}
                                  type="button"
                                  disabled={busy || selected || locked}
                                  onClick={() => handleEquipmentSetStatus(item, opt)}
                                  title={locked ? reason : ''}
                                  style={{
                                    width: '100%',
                                    fontSize: 13,
                                    fontWeight: 800,
                                    padding: '10px 12px',
                                    borderRadius: 8,
                                    border: selected ? `2px solid ${optColor}` : `1px solid ${optColor}55`,
                                    background: equipmentToneBg(opt),
                                    color: optColor,
                                    cursor: selected || locked ? 'default' : 'pointer',
                                    textAlign: 'center',
                                    opacity: locked ? 0.4 : 1,
                                  }}
                                >
                                  {equipmentToneLabel(opt, item.item_type)}
                                  {selected ? ' · נוכחי' : ''}
                                  {locked ? ' 🔒' : ''}
                                </button>
                              );
                            })}
                          </div>
                          {tone === 'unpaid' && (
                            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>
                              „שולם” ו„נמסר” נפתחים רק אחרי תשלום בדף התשלום.
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {(() => {
                      const shoes = equipmentItems.find((i) => i.item_type === 'shoes');
                      if (!shoes || shoes.payment_status !== 'paid') return null;
                      const range = formatRentalRange(shoes);
                      if (!range) return null;
                      return (
                        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                          תוקף השכרת נעליים: {range}
                        </div>
                      );
                    })()}
                  </div>
                )}
                  </>
                )}
              />
            )}

            {/* Attendance folder */}
            {!parentOnly && (
              <FolderRow
                id="attendance"
                title="נוכחות"
                icon={History}
                accent="#2DD4BF"
                summary={attendanceSummary}
                open={openFolder === 'attendance'}
                onToggle={toggleFolder}
                style={{ order: 3 }}
                renderBody={() => (
                  <>
                {attendanceLoading ? (
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>טוען נוכחות...</div>
                ) : attendanceHistory.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>אין רשומות נוכחות עדיין</div>
                ) : (
                  <AttendanceList
                    rows={attendanceHistory}
                    onStatusSaved={handleAttendanceStatusSaved}
                  />
                )}
                  </>
                )}
              />
            )}

            {!parentOnly && (
              <FolderRow
                id="activities"
                title="פעילויות"
                icon={CalendarDays}
                accent="#818CF8"
                summary={activityHistorySummary}
                open={openFolder === 'activities'}
                onToggle={toggleFolder}
                style={{ order: 8 }}
                renderBody={() => (
                  <>
                {activityHistoryLoading ? (
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>טוען פעילויות...</div>
                ) : activityHistory.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>אין הרשמות לאירועים עדיין</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {activityDayError && (
                      <div className="alert alert-danger" style={{ fontSize: 12 }}>{activityDayError}</div>
                    )}
                    {activityHistory.map((row) => (
                      <div
                        key={row.id}
                        style={{
                          fontSize: 12,
                          padding: '8px 0',
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                          <div>
                            <div style={{ fontWeight: 700, color: 'var(--text)' }}>{row.activity_name}</div>
                            <div style={{ color: 'var(--text-3)', marginTop: 2 }}>
                              {row.date ? new Date(row.date).toLocaleDateString('he-IL') : '—'}
                              {row.activity_type_label && row.activity_type_label !== row.activity_name
                                ? ` · ${row.activity_type_label}`
                                : ''}
                              {row.location ? ` · ${row.location}` : ''}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                            <span className="badge badge-gray">{row.status_label || row.status || '—'}</span>
                            {!['cancelled', 'canceled', 'refunded'].includes(String(row.status || '')) && (
                              <>
                                {canManageBilling && row.payment_status === 'paid' && (
                                  <button
                                    type="button"
                                    className="icon-btn"
                                    onClick={() => refundActivityRegistration(row)}
                                    disabled={!!activityActionBusy}
                                    aria-label="זיכוי והסרה מהפעילות"
                                    title="זיכוי תשלום והסרה"
                                  >
                                    {activityActionBusy === `refund:${row.id}`
                                      ? <Loader2 size={14} className="spin" />
                                      : <Undo2 size={14} />}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="icon-btn is-danger"
                                  onClick={() => removeActivityRegistration(row)}
                                  disabled={!!activityActionBusy}
                                  aria-label="הסרה מהפעילות"
                                  title="הסרה מהפעילות"
                                >
                                  {activityActionBusy === row.id
                                    ? <Loader2 size={14} className="spin" />
                                    : <Trash2 size={14} />}
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Every day of the activity — a camp gets one line per day. */}
                        {(row.days || []).length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                            {row.days.map((day) => (
                              <div
                                key={day.date}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: 8,
                                }}
                              >
                                <span style={{ color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                                  {activityDayLabel(day.date)}
                                </span>
                                <AttendanceToggle
                                  size="xs"
                                  status={day.status}
                                  busy={activityDayBusy === `${row.id}|${day.date}`}
                                  onMark={(status) => markActivityDay(row, day.date, status)}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                  </>
                )}
              />
            )}

            {/* Tests folder */}
            {canManageBilling && (
              <FolderRow
                id="tests"
                title="מבחנים"
                icon={Award}
                accent="#FCD34D"
                summary={testsSummary}
                open={openFolder === 'tests'}
                onToggle={toggleFolder}
                style={{ order: 5 }}
                renderBody={() => (
                  <>
                {showTestForm ? (
                  <form onSubmit={handleSaveTest} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', marginBottom: 8 }}>
                      {editingTestId ? 'עריכת מבחן' : 'מבחן חדש'}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      {TEST_KINDS.map((k) => {
                        const active = testType === k.key;
                        const Icon = k.Icon;
                        return (
                          <button
                            key={k.key}
                            type="button"
                            className={`btn btn-xs ${active ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => setTestType(k.key)}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              fontWeight: 800,
                              ...(active
                                ? { background: k.bg, color: k.accent, borderColor: k.border }
                                : { color: k.accent }),
                            }}
                          >
                            <Icon size={13} strokeWidth={2.3} />
                            {k.shortLabel}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                      {testType === 'level' && (
                        <>
                          <AppSelect
                            className="input input-sm"
                            style={{
                              flex: 1, minWidth: 80, fontWeight: 800,
                              color: levelColor(testLevel) || undefined,
                            }}
                            value={testLevel}
                            onChange={e => setTestLevel(e.target.value)}
                          >
                            {LEVELS.map(lvl => (
                              <option key={lvl} value={lvl}>רמה {lvl}</option>
                            ))}
                          </AppSelect>
                          <AppSelect
                            className="input input-sm"
                            style={{
                              flex: 1, minWidth: 110, fontWeight: 700,
                              color: ROUTE_STYLE[testRouteStyle]?.color,
                            }}
                            value={testRouteStyle}
                            onChange={e => setTestRouteStyle(e.target.value)}
                          >
                            <option value="top-rope">{ROUTE_STYLE['top-rope'].label}</option>
                            <option value="lead">{ROUTE_STYLE.lead.label}</option>
                          </AppSelect>
                        </>
                      )}
                      <AppSelect
                        className="input input-sm"
                        style={{ flex: 1.5, minWidth: 120 }}
                        required
                        value={testExaminerId}
                        onChange={e => setTestExaminerId(e.target.value)}
                      >
                        <option value="">בחר בוחן...</option>
                        {employees.map(emp => (
                          <option key={emp.id} value={emp.id}>{emp.name}</option>
                        ))}
                      </AppSelect>
                      <AppSelect className="input input-sm" style={{ width: 72 }} value={testPassed ? 'yes' : 'no'} onChange={e => setTestPassed(e.target.value === 'yes')}>
                        <option value="yes">עבר</option>
                        <option value="no">נכשל</option>
                      </AppSelect>
                      <input
                        className="input input-sm"
                        type="date"
                        style={{ width: 132 }}
                        value={testDate}
                        onChange={e => setTestDate(e.target.value)}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        className="input input-sm"
                        placeholder="הערות..."
                        style={{ flex: 2 }}
                        value={testNotes}
                        onChange={e => setTestNotes(e.target.value)}
                      />
                      <button type="submit" disabled={testLoading} className="btn btn-primary btn-sm">
                        {editingTestId ? 'שמור' : 'רשום'}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={resetTestForm}>ביטול</button>
                    </div>
                  </form>
                ) : null}

                <div style={{
                  display: 'flex',
                  gap: 4,
                  marginBottom: 8,
                  flexWrap: 'nowrap',
                  alignItems: 'center',
                  overflowX: 'auto',
                }}>
                  {!showTestForm && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-xs"
                      title="מבחן חדש"
                      onClick={openNewTestForm}
                      style={{ flexShrink: 0 }}
                    >
                      <Plus size={15} strokeWidth={2.5} />
                    </button>
                  )}
                  <button
                    type="button"
                    className={`btn btn-xs ${testKindFilter === 'all' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setTestKindFilter('all')}
                    style={{ flexShrink: 0, minWidth: 36, paddingInline: 8 }}
                  >
                    הכל
                  </button>
                  {TEST_KINDS.map((k) => {
                    const Icon = k.Icon;
                    const active = testKindFilter === k.key;
                    return (
                      <button
                        key={k.key}
                        type="button"
                        className={`btn btn-xs ${active ? 'btn-primary' : 'btn-ghost'}`}
                        title={k.label}
                        onClick={() => setTestKindFilter(k.key)}
                        style={{
                          flexShrink: 0,
                          height: 28,
                          paddingInline: 7,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 11,
                          fontWeight: 700,
                          ...(active
                            ? { background: k.bg, color: k.accent, borderColor: k.border }
                            : { color: k.accent }),
                        }}
                      >
                        <Icon size={13} strokeWidth={2.3} />
                        {k.shortLabel}
                      </button>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 280, overflowY: 'auto', overscrollBehavior: 'contain' }}>
                  {levelTestsHistory.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>לא נמצאו מבחנים מדווחים</div>
                  ) : filteredLevelTests.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>אין מבחנים בסינון שנבחר</div>
                  ) : (
                    filteredLevelTests.map(test => {
                      const asLevel = test.test_type === 'level' || test.test_type === 'top-rope' || test.test_type === 'top_rope';
                      const kind = testKindMeta(test.test_type);
                      const KindIcon = kind.Icon;
                      const grade = test.level || test.grade;
                      const gradeAccent = asLevel ? levelColor(grade) : null;
                      const typeColor = TEST_TYPE_COLORS[kind.key];
                      const accent = typeColor.accent;
                      const route = asLevel
                        ? routeStyleMeta(test.route_style || (test.test_type === 'top-rope' ? 'top-rope' : null))
                        : null;
                      const passed = !!(test.passed ?? test.status === 'passed');
                      const dateShort = String(test.date || '').slice(5); // MM-DD
                      return (
                        <div key={test.id} style={{
                          display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
                          padding: '5px 7px', borderRadius: 7,
                          background: typeColor.bg,
                          border: `1px solid ${typeColor.border}`,
                          borderRight: `3px solid ${accent}`,
                        }}>
                          {/* 1. סוג מבחן */}
                          <span
                            title={kind.label}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 3,
                              flexShrink: 0,
                              color: accent,
                              fontWeight: 800,
                              fontSize: 11,
                            }}
                          >
                            <KindIcon size={13} strokeWidth={2.3} />
                            {kind.shortLabel}
                          </span>

                          {/* 2. רמה (רק במבחן רמה) */}
                          {asLevel && grade && (
                            <span style={{
                              flexShrink: 0,
                              fontWeight: 900,
                              fontSize: 12,
                              color: gradeAccent || 'var(--text-2)',
                              minWidth: 22,
                              textAlign: 'center',
                            }}>
                              {grade}
                            </span>
                          )}

                          {/* 3. הובלה / טופ רופ */}
                          {route && (
                            <span
                              title={route.label}
                              style={{
                                color: route.color,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 3,
                                flexShrink: 0,
                                fontWeight: 700,
                              }}
                            >
                              <route.Icon size={12} strokeWidth={2.4} />
                              {route.label}
                            </span>
                          )}

                          {/* 4. בוחן */}
                          <span style={{
                            color: 'var(--text-3)',
                            minWidth: 0,
                            flex: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }} title={test.examiner || ''}>
                            {test.examiner || '—'}
                          </span>

                          <span style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: passed ? 'var(--green)' : 'var(--red)',
                            flexShrink: 0,
                          }}>
                            {passed ? 'עבר' : 'נכשל'}
                          </span>

                          <span style={{ fontSize: 10, color: 'var(--text-3)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                            {dateShort || '—'}
                          </span>

                          <button
                            type="button"
                            className="btn btn-ghost btn-icon btn-xs"
                            title="עריכה"
                            style={{ width: 24, height: 24, flexShrink: 0 }}
                            onClick={() => openEditTestForm(test)}
                          >
                            <Edit2 size={11} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon btn-xs"
                            title="מחיקה"
                            style={{ width: 24, height: 24, color: 'var(--red)', flexShrink: 0 }}
                            onClick={() => handleDeleteTest(test)}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
                  </>
                )}
              />
            )}

            {/* Status & notes folder */}
            <FolderRow
              id="status"
              title="סטטוס והערות"
              icon={Clipboard}
              accent="#60A5FA"
              summary={statusSummary}
              open={openFolder === 'status'}
              onToggle={toggleFolder}
              style={{ order: -1 }}
              headerless
              renderBody={() => (
                <>
              {canManageBilling && (
                <>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>שינוי סטטוס</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
                    {statusKeys.filter(k => k !== 'archived').map(k => (
                      <button
                        key={k}
                        className={`btn ${student.status === k ? 'btn-primary' : 'btn-ghost'} btn-xs`}
                        style={{ justifyContent: 'flex-start', gap: 8 }}
                        onClick={() => onStatusChange(student.id, k)}
                      >
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUSES[k].color, flexShrink: 0 }} />
                        {STATUSES[k].label}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>הערות מעקב</div>
                  <div className="card card-p" style={{ marginBottom: 0, padding: 10 }}>
                    <div style={{ fontSize: 13, color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>
                      {student.notes || 'אין הערות רשומות ללקוח זה'}
                    </div>
                  </div>
                </>
                )}
                  </>
                )}
              />
              </div>
            )}
          </div>
        </div>

        {/* Communication column */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-root)',
            overscrollBehavior: 'contain',
          }}
        >
          {canViewComms ? (
            <ConversationPanel
              parent={communicationParent}
              student={communicationStudent}
              selectedThreadId={communicationThreadId}
              fillHeight
              onClose={onClose}
              onHandled={onCommunicationHandled}
              onConversationChange={rememberConversation}
            />
          ) : (
            <div style={{ padding: 20, color: 'var(--text-3)', fontSize: 13 }}>
              אין הרשאה לצפייה בתקשורת
            </div>
          )}
        </div>
      </div>

      {showHealthSendModal && (
        <Modal
          title="שליחת טופס בוואטסאפ"
          onClose={() => !sendingHealth && setShowHealthSendModal(false)}
          footer={(
            <>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={sendingHealth}
                onClick={() => setShowHealthSendModal(false)}
              >
                ביטול
              </button>
              <button
                type="button"
                className="btn btn-success"
                disabled={sendingHealth || !parent?.phone || (!healthOnlySelected && !selectedTemplate)}
                onClick={handleSendHealthForm}
              >
                <Send size={15} /> {sendingHealth ? 'שולח...' : 'שלח בוואטסאפ'}
              </button>
            </>
          )}
        >
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">איזה טופס לשלוח?</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  title="שאלות הבריאות והחתימה עליהן בלבד — ללא אישור השתתפות או הסרת אחריות"
                  aria-pressed={healthOnlySelected}
                  onClick={() => setSelectedFormSlug('health-renewal')}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7,
                    padding: '9px 14px', borderRadius: 999, cursor: 'pointer',
                    fontSize: 13, fontWeight: healthOnlySelected ? 700 : 600, lineHeight: 1.2,
                    color: healthOnlySelected ? '#7dd3fc' : 'var(--text-2)',
                    background: healthOnlySelected ? 'rgba(56,189,248,.1)' : 'transparent',
                    border: `1px solid ${healthOnlySelected ? '#38bdf8' : 'var(--border)'}`,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      flexShrink: 0,
                      fontSize: 20,
                      lineHeight: 1,
                      fontFamily: 'Arial, sans-serif',
                    }}
                  >
                    ⚕
                  </span>
                  חידוש בריאות בלבד
                </button>
                {formTemplates.map((template) => {
                  const kind = templateKind(template);
                  const KindIcon = kind.Icon;
                  const active = template.slug === selectedFormSlug;
                  return (
                    <button
                      key={template.id}
                      type="button"
                      title={template.title}
                      aria-pressed={active}
                      onClick={() => setSelectedFormSlug(template.slug)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 7,
                        padding: '9px 14px',
                        borderRadius: 999,
                        cursor: 'pointer',
                        fontSize: 13,
                        fontWeight: active ? 700 : 600,
                        lineHeight: 1.2,
                        color: active ? kind.color : 'var(--text-2)',
                        background: active ? 'rgba(255,255,255,0.07)' : 'transparent',
                        border: `1px solid ${active ? kind.color : 'var(--border)'}`,
                      }}
                    >
                      <KindIcon size={15} style={{ flexShrink: 0 }} />
                      {templateShortLabel(template)}
                    </button>
                  );
                })}
            </div>
            {!formTemplates.length && (
              <div className="alert alert-warn" style={{ marginTop: 10 }}>
                טפסי הפעילות לא נטענו; עדיין ניתן לשלוח חידוש בריאות בלבד.
              </div>
            )}
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-3)' }}>
              {healthOnlySelected
                ? 'הקישור יבקש רק הצהרת בריאות חדשה וחתימה עליה; אישורי ההשתתפות הקיימים לא ישתנו. '
                : ''}
              הקישור יישלח בוואטסאפ אל {parentDisplayName(parent)} · {parent?.phone}
            </div>
          </div>
        </Modal>
      )}

      {showAddChild && (
        <Modal
          title="הוספת ילד"
          onClose={() => !addingChild && setShowAddChild(false)}
          footer={
            <>
              <button className="btn btn-ghost" disabled={addingChild} onClick={() => setShowAddChild(false)}>ביטול</button>
              <button
                form="add-child-form"
                type="submit"
                className="btn btn-primary"
                disabled={addingChild || !newChildName.trim()}
              >
                <PlusCircle size={15} />
                {addingChild
                  ? 'מוסיף...'
                  : (sendHealthOnAdd ? `הוסף ילד ושלח ${FORM_SHORT}` : 'הוסף ילד')}
              </button>
            </>
          }
        >
          <form id="add-child-form" onSubmit={handleAddChild} className="form-grid">
            <div className="form-group">
              <label className="form-label">שם הילד *</label>
              <input
                className="input"
                required
                autoFocus
                placeholder="שם מלא"
                value={newChildName}
                onChange={(e) => setNewChildName(e.target.value)}
              />
            </div>
            {parent?.name && (
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                יתווסף תחת {parent.name}. פרטי ההורה כבר במערכת — ההודעה תישלח אליו.
              </div>
            )}
            <label
              className="checkbox-item"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                background: 'var(--bg-input)',
                padding: 10,
                borderRadius: 8,
              }}
            >
              <input
                type="checkbox"
                checked={sendHealthOnAdd}
                onChange={(e) => setSendHealthOnAdd(e.target.checked)}
                style={{ accentColor: 'var(--primary)' }}
              />
              <span style={{ fontSize: 13 }}>שלח {FORM_SHORT} להורה בוואטסאפ</span>
            </label>
            {addChildError && (
              <div className="alert alert-warn" style={{ marginTop: 4 }}>{addChildError}</div>
            )}
          </form>
        </Modal>
      )}

      {showAddContact && (
        <Modal
          title="הוספת איש קשר לתיק"
          onClose={() => !addingContact && setShowAddContact(false)}
          footer={
            <>
              <button className="btn btn-ghost" disabled={addingContact} onClick={() => setShowAddContact(false)}>ביטול</button>
              <button
                form="add-contact-form"
                type="submit"
                className="btn btn-primary"
                disabled={addingContact || !contactName.trim() || !contactPhone.trim()}
              >
                <Plus size={15} /> {addingContact ? 'מוסיף...' : 'הוסף איש קשר'}
              </button>
            </>
          }
        >
          <form id="add-contact-form" onSubmit={handleAddContact} className="form-grid">
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">שם *</label>
                <input
                  className="input"
                  required
                  autoFocus
                  placeholder="שם מלא"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">טלפון *</label>
                <input
                  className="input"
                  type="tel"
                  required
                  placeholder="052-1234567"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                />
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
              מספר שכבר קיים במערכת — למשל מי ששלח לנו הודעה — יצורף לתיק הזה במקום להיפתח ככרטיס נפרד.
              איש קשר אינו מתאמן: לא נפתח לו תיק אימונים.
            </div>
            {contactCandidates.length > 1 && (
              <div className="form-group">
                <label className="form-label">משויך למתאמנים</label>
                {contactCandidates.map((sib) => {
                  const id = String(sib.id);
                  const checked = contactStudentIds.includes(id);
                  return (
                    <label
                      key={id}
                      className="checkbox-item"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        cursor: 'pointer',
                        background: 'var(--bg-input)',
                        padding: 8,
                        borderRadius: 8,
                        marginBottom: 6,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        style={{ accentColor: 'var(--primary)' }}
                        onChange={(e) => setContactStudentIds((prev) => (
                          e.target.checked ? [...prev, id] : prev.filter((row) => row !== id)
                        ))}
                      />
                      <span style={{ fontSize: 13 }}>{sib.name}</span>
                    </label>
                  );
                })}
              </div>
            )}
            {addContactError && (
              <div className="alert alert-warn" style={{ marginTop: 4 }}>{addContactError}</div>
            )}
          </form>
        </Modal>
      )}

      {isEditing && (
        <Modal title="עריכת פרטי התיק" onClose={() => setIsEditing(false)}
          footer={
            <><button className="btn btn-ghost" onClick={() => setIsEditing(false)}>ביטול</button>
              <button className="btn btn-primary" disabled={savingEdit} onClick={handleUpdateDetails}>
                <Check size={15} /> {savingEdit ? 'שומר...' : 'שמור שינויים'}
              </button></>
          }
        >
          <div className="form-grid">
            <div className="tab-bar tab-bar-sub" style={{ marginBottom: 8 }} role="tablist" aria-label="סוג הפרטים לעריכה">
              {!parentOnly && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={editFocus === 'student'}
                  className={`tab-pill ${editFocus === 'student' ? 'active' : ''}`}
                  onClick={() => setEditFocus('student')}
                >
                  מתאמן
                </button>
              )}
              {parent?.id && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={editFocus === 'parent' || parentOnly}
                  className={`tab-pill ${editFocus === 'parent' || parentOnly ? 'active' : ''}`}
                  onClick={() => setEditFocus('parent')}
                >
                  פרטי קשר
                </button>
              )}
            </div>
            {editError && (
              <div className="alert alert-warn" style={{ marginBottom: 4 }}>{editError}</div>
            )}
            {(editFocus === 'student' && !parentOnly) && (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)', marginBottom: 4 }}>פרטי המתאמן</div>
                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="form-label">שם פרטי</label>
                    <input
                      className="input"
                      autoFocus
                      value={editStudentFirstName}
                      onChange={(e) => setEditStudentFirstName(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">שם משפחה</label>
                    <input
                      className="input"
                      value={editStudentLastName}
                      onChange={(e) => setEditStudentLastName(e.target.value)}
                    />
                  </div>
                </div>
                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="form-label">תאריך לידה</label>
                    <input type="date" className="input" value={editBirthDate} onChange={e => setEditBirthDate(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">טלפון מתאמן</label>
                    <input
                      className="input"
                      type="tel"
                      value={editStudentPhone}
                      onChange={(e) => setEditStudentPhone(e.target.value)}
                      placeholder="050..."
                    />
                  </div>
                </div>
                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="form-label">בן / בת</label>
                    {/* אותה בחירה ובאותה צורה כמו בטופס הציבורי — הקלקה על
                        הבחירה הנוכחית מנקה אותה, במקום „— לא הוגדר —”. */}
                    <GenderPicker value={editGender} onChange={setEditGender} />
                  </div>
                </div>
                {/* Its own row — the board opens in a window of its own, and a
                    half-width form cell had nowhere to put the chosen classes. */}
                <div className="form-group">
                  <label className="form-label">שיוך לחוגים</label>
                  <GroupPickerField
                    groups={groups}
                    selectedIds={editGroupIds}
                    onToggle={(id) => {
                      setEditGroupIds((prev) => (
                        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
                      ));
                    }}
                  />
                </div>
                <label
                  className="form-group"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '11px 12px',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={editProgramEligible}
                    onChange={(event) => setEditProgramEligible(event.target.checked)}
                    style={{ accentColor: 'var(--primary)', width: 17, height: 17 }}
                  />
                  <span>
                    <strong style={{ display: 'block', fontSize: 13 }}>זכאי למתקדמים ולנבחרות</strong>
                    <span style={{ color: 'var(--text-3)', fontSize: 11 }}>הקבוצה המדויקת נקבעת בנפרד</span>
                  </span>
                </label>
                <div className="form-group">
                  <label className="form-label">תאריך מעקב הבא</label>
                  <input type="date" className="input" value={editNextFollowup} onChange={e => setEditNextFollowup(e.target.value)} />
                </div>
              </>
            )}

            {(editFocus !== 'student' || parentOnly) && (
              <>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)', margin: editFocus === 'student' && !parentOnly ? '10px 0 4px' : '0 0 4px' }}>
              פרטי הורה / משלם
            </div>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">שם פרטי</label>
                <input
                  className="input"
                  autoFocus={editFocus === 'parent' || parentOnly}
                  value={editParentName}
                  onChange={(e) => setEditParentName(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">שם משפחה</label>
                <input className="input" value={editParentLastName} onChange={e => setEditParentLastName(e.target.value)} />
              </div>
            </div>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">טלפון</label>
                <input className="input" type="tel" value={editPhone} onChange={e => setEditPhone(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">תעודת זהות</label>
                <input className="input" inputMode="numeric" value={editParentIdNumber} onChange={e => setEditParentIdNumber(e.target.value)} />
              </div>
            </div>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">אימייל</label>
                <input className="input" type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">עיר</label>
                <input className="input" value={editCity} onChange={e => setEditCity(e.target.value)} />
              </div>
            </div>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">גבר / אישה</label>
                {/* אותה בחירה כמו אצל המתאמן, במילים של מבוגר. */}
                <GenderPicker
                  value={editParentGender}
                  onChange={setEditParentGender}
                  options={[['גבר', 'male'], ['אישה', 'female']]}
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">הערות מעקב</label>
              <textarea
                className="input"
                style={{ minHeight: 80 }}
                placeholder="הערות פנימיות לצוות"
                value={editParentNotes}
                onChange={e => setEditParentNotes(e.target.value)}
              />
            </div>
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {guardians.length > 1 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-xs w-full"
                  style={{ justifyContent: 'center', gap: 6, border: '1px solid var(--border)' }}
                  disabled={splitLoading}
                  title="בחרו איזה ילד הולך עם איזה הורה — בלי למחוק אף אחד"
                  onClick={() => {
                    setIsEditing(false);
                    openSplitFamily();
                  }}
                >
                  <Users size={12} /> פיצול משפחה
                </button>
              )}
              {!!householdAnchorId && (
                <button
                  type="button"
                  className="btn btn-ghost btn-xs w-full"
                  style={{ justifyContent: 'center', gap: 6, border: '1px solid var(--border)' }}
                  title="שני כרטיסים של אותה משפחה — אחדו אותם לשורה אחת עם כל הילדים"
                  onClick={() => {
                    setIsEditing(false);
                    openMergeFamily();
                  }}
                >
                  <Users size={12} /> איחוד משפחות
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-xs w-full"
                style={{ justifyContent: 'center', gap: 6 }}
                onClick={() => {
                  const next = !parentArchived;
                  if (next && !confirm(`להעביר את ${parentDisplayName(parent) || 'הלקוח'} לארכיון? הכרטיס ייעלם מרשימת הלקוחות ומהחיפוש, וההיסטוריה תישמר. אפשר להחזיר בכל רגע.`)) return;
                  setIsEditing(false);
                  onArchive?.(parent?.id, next);
                }}
              >
                {parentArchived
                  ? <><ArchiveRestore size={12} /> החזר מהארכיון</>
                  : <><Archive size={12} /> העבר לארכיון</>}
              </button>
              <button
                type="button"
                className="btn btn-danger btn-xs w-full"
                style={{ justifyContent: 'center', gap: 6 }}
                onClick={() => {
                  if (confirm('האם אתה בטוח שברצונך למחוק את הלקוח לצמיתות ממאגר הלקוחות? פעולה זו תסיר גם את ההורה במידה ואין לו ילדים נוספים.')) {
                    setIsEditing(false);
                    onDelete(student.id);
                  }
                }}
              >
                <Trash2 size={12} /> מחק לקוח לצמיתות
              </button>
            </div>
              </>
            )}
            {(editFocus === 'student' && !parentOnly) && (
              <>
                <div className="form-group">
                  <label className="form-label">הערות מעקב</label>
                  <textarea
                    className="input"
                    style={{ minHeight: 80 }}
                    placeholder="הערות פנימיות לצוות"
                    value={editStudentNotes}
                    onChange={e => setEditStudentNotes(e.target.value)}
                  />
                </div>
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                  <button
                    type="button"
                    className="btn btn-danger btn-xs w-full"
                    disabled={!!removingChildId}
                    style={{ justifyContent: 'center', gap: 6 }}
                    onClick={() => handleRemoveChild(student)}
                  >
                    <Trash2 size={12} /> {removingChildId ? 'מסיר...' : `הסר את ${student.name} מהרשימה`}
                  </button>
                  {removeChildError && (
                    <div className="alert alert-warn" style={{ marginTop: 8 }}>{removeChildError}</div>
                  )}
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {showPaymentModal && (
        <Modal
          title="חיוב משפחתי"
          onClose={() => setShowPaymentModal(false)}
          footer={
            <button className="btn btn-ghost" onClick={() => setShowPaymentModal(false)}>סגור</button>
          }
        >
          <form onSubmit={handleSendPayment}>
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label className="form-label" style={{ fontSize: 11 }}>עבור איזה משתתף?</label>
              {billableStudents.length > 1 ? (
                <AppSelect
                  className="input input-sm"
                  required
                  value={billingStudentId}
                  onChange={(event) => setBillingStudentId(event.target.value)}
                >
                  {billableStudents.map((member) => (
                    <option key={member.id} value={member.id}>{member.name}</option>
                  ))}
                </AppSelect>
              ) : (
                <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--bg-input)', border: '1px solid var(--border)', fontSize: 13, fontWeight: 700 }}>
                  {billingStudent?.name || 'חיוב כללי למשפחה'}
                </div>
              )}
              <div style={{ marginTop: 4, fontSize: 10.5, color: 'var(--text-3)' }}>
                החיוב משויך למשתתף, והחשבונית ופרטי התשלום נשארים על שם ההורה המשלם.
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <label className="form-label" style={{ fontSize: 11, margin: 0, flex: 1 }}>
                  {billCategory ? `בחר מוצר · ${billCategory}` : 'בחר מוצר מהמחירון'}
                </label>
                {billCategory && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => setBillCategory('')}
                    style={{ gap: 4 }}
                  >
                    <ChevronLeft size={12} /> כל הקטגוריות
                  </button>
                )}
                {selectedPricelistItem && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => handlePricelistSelect('')}
                  >
                    נקה בחירה
                  </button>
                )}
              </div>
              {!billCategory ? (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))',
                  gap: 8,
                  maxHeight: 320,
                  overflow: 'auto',
                }}>
                  {billCategoryTiles.map((category) => {
                    const c = CATEGORY_COLORS[category.name] || DEFAULT_CATEGORY_COLOR;
                    const Icon = CATEGORY_ICONS[category.name] || Package;
                    return (
                      <button
                        key={category.id || category.name}
                        type="button"
                        onClick={() => setBillCategory(category.name)}
                        className="card"
                        style={{
                          padding: 0,
                          textAlign: 'center',
                          cursor: 'pointer',
                          overflow: 'hidden',
                          border: `1px solid ${catTint(c.text, '33')}`,
                          display: 'flex',
                          flexDirection: 'column',
                        }}
                      >
                        <div style={{
                          height: 58,
                          flexShrink: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: imageBackground(
                            category,
                            `linear-gradient(145deg, ${c.bg}, rgba(15,20,30,0.9))`
                          ),
                        }}>
                          {!category.image && <Icon size={24} color={c.text} strokeWidth={1.6} />}
                        </div>
                        <div style={{
                          flex: 1,
                          padding: '8px 6px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                          <div style={{ fontWeight: 700, fontSize: 12, lineHeight: 1.3, color: 'var(--text-1)' }}>
                            {category.name}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {billCategoryTiles.length === 0 && (
                    <div style={{ color: 'var(--text-3)', fontSize: 12, padding: 8 }}>
                      אין מוצרים במחירון — מלאו תיאור ומחיר ידנית
                    </div>
                  )}
                </div>
              ) : (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                  gap: 8,
                  maxHeight: 320,
                  overflow: 'auto',
                }}>
                  {billCategoryProducts.map((item) => {
                    const active = String(selectedPricelistItem) === String(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handlePricelistSelect(item.id)}
                        className="card"
                        style={{
                          padding: 0,
                          textAlign: 'right',
                          cursor: 'pointer',
                          overflow: 'hidden',
                          border: active ? '1px solid var(--blue)' : '1px solid var(--border)',
                        }}
                      >
                        {item.image && (
                          <img
                            src={item.image}
                            alt=""
                            style={{ display: 'block', width: '100%', height: 58, objectFit: imageFitOf(item) }}
                          />
                        )}
                        <div style={{ padding: 8 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-1)', marginBottom: 4 }}>
                            {item.name}
                          </div>
                          <div style={{ fontWeight: 800, fontSize: 12, color: 'var(--accent, #F59E0B)' }}>
                            ₪{Number(item.price || 0).toLocaleString()}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label" style={{ fontSize: 11 }}>תיאור</label>
                <input
                  className="input input-sm"
                  placeholder="למשל: כרטיסיה 10 כניסות"
                  required
                  value={billDescription}
                  onChange={e => setBillDescription(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ width: 100 }}>
                <label className="form-label" style={{ fontSize: 11 }}>מחיר (₪)</label>
                <input
                  className="input input-sm"
                  type="number"
                  placeholder="350"
                  required
                  value={billAmount}
                  onChange={e => setBillAmount(e.target.value)}
                />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button type="submit" disabled={billingLoading || invoiceLoading} className="btn btn-primary btn-sm w-full" style={{ justifyContent: 'center', gap: 8 }}>
                <Send size={13} /> {billingLoading ? 'מייצר קישור...' : 'שלח קישור סליקה בוואטסאפ'}
              </button>
              <button
                type="button"
                disabled={billingLoading || invoiceLoading}
                className="btn btn-ghost btn-sm w-full"
                style={{ justifyContent: 'center', gap: 8 }}
                onClick={handleCreateInvoice}
              >
                <ReceiptText size={13} /> {invoiceLoading ? 'מפיק חשבונית...' : 'הפק חשבונית מס קבלה עכשיו'}
              </button>
            </div>
          </form>
          {billingLink && (
            <div style={{ marginTop: 10, padding: 8, background: 'var(--bg-input)', borderRadius: 6, fontSize: 12, wordBreak: 'break-all' }}>
              <strong>קישור לתשלום:</strong><br />
              <a href={billingLink} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>{billingLink}</a>
            </div>
          )}
          {lastInvoice && (
            <div className="alert alert-success" style={{ marginTop: 10, fontSize: 12 }}>
              חשבונית הופקה
              {lastInvoice.docNumber ? ` · מס׳ ${lastInvoice.docNumber}` : ''}
              {' '}· ₪{lastInvoice.amount} · {lastInvoice.description}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}


// ─── Add Lead Modal ──────────────────────────────────────────────────────────
function AddLeadModal({ students, parents, onAdd, onClose }) {
  const [parentName, setParentName] = useState('');
  const [lastName, setLastName] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [source, setSource] = useState('phone');
  const [isAdult, setIsAdult] = useState(false);
  const [children, setChildren] = useState(['']);
  const [warnings, setWarnings] = useState([]);

  const checkDuplicates = (childrenList, phoneVal) => {
    if (!phoneVal) { setWarnings([]); return; }
    const dupes = childrenList
      .filter(c => c)
      .filter(name => students.some(
        s => s.name.trim() === name.trim() &&
          parents.find(p => p.id === s.parentId)?.phone &&
          normPhone(parents.find(p => p.id === s.parentId).phone) === normPhone(phoneVal)
      ));
    setWarnings(dupes);
  };

  const updateChild = (idx, val) => {
    const next = [...children]; next[idx] = val; setChildren(next);
    checkDuplicates(next, phone);
  };

  const updatePhone = val => {
    setPhone(val);
    checkDuplicates(children, val);
  };

  const handleSubmit = e => {
    e.preventDefault();
    if (!parentName || !phone) return;
    
    let finalChildren = children.map(c => c.trim()).filter(Boolean);
    const fullParentName = [parentName.trim(), lastName.trim()].filter(Boolean).join(' ');
    if (isAdult && finalChildren.length === 0) {
      finalChildren = [fullParentName];
    }

    onAdd({
      parentName: fullParentName,
      lastName: lastName.trim(),
      idNumber: idNumber.trim(),
      phone: phone.trim(),
      email: email.trim(),
      city: city.trim(),
      source,
      children: finalChildren,
    });
    onClose();
  };

  return (
    <Modal title="רישום ליד/לקוח חדש" onClose={onClose}
      footer={
        <><button className="btn btn-ghost" onClick={onClose}>ביטול</button>
          <button form="add-lead-form" type="submit" className="btn btn-primary">
            <UserCheck size={16} /> קלוט ליד
          </button></>
      }
    >
      <form id="add-lead-form" onSubmit={handleSubmit} className="form-grid">
        <div className="form-group" style={{ marginBottom: 16 }}>
          <label className="checkbox-item" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', background: 'var(--bg-input)', padding: 10, borderRadius: 8 }}>
            <input type="checkbox" checked={isAdult} onChange={e => setIsAdult(e.target.checked)} style={{ accentColor: 'var(--primary)' }} />
            <span style={{ fontSize: 14 }}>מתאמן בוגר (מעל גיל 18, נרשם לעצמו)</span>
          </label>
        </div>

        <div className="form-grid-2">
          <div className="form-group">
            <label className="form-label">שם פרטי *</label>
            <input className="input" placeholder="דניאל" required value={parentName} onChange={e => setParentName(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">שם משפחה</label>
            <input className="input" placeholder="כהן" value={lastName} onChange={e => setLastName(e.target.value)} />
          </div>
        </div>
        <div className="form-grid-2">
          <div className="form-group">
            <label className="form-label">תעודת זהות</label>
            <input className="input" inputMode="numeric" placeholder="9 ספרות" value={idNumber} onChange={e => setIdNumber(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">טלפון וואטסאפ *</label>
            <input className="input" type="tel" placeholder="052-1234567" required value={phone} onChange={e => updatePhone(e.target.value)} />
          </div>
        </div>
        <div className="form-grid-2">
          <div className="form-group">
            <label className="form-label">אימייל (לא חובה)</label>
            <input className="input" type="email" placeholder="email@gmail.com" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">עיר (לא חובה)</label>
            <input className="input" placeholder="ירושלים" value={city} onChange={e => setCity(e.target.value)} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">מקור הליד</label>
          <AppSelect className="input" value={source} onChange={e => setSource(e.target.value)}>
            {Object.entries(LEAD_SOURCES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </AppSelect>
        </div>
        
        {!isAdult && (
          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>שמות הילדים (לא חובה)</span>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setChildren([...children, ''])}>
                <PlusCircle size={13} /> הוסף ילד
              </button>
            </label>
            {children.map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input className="input" placeholder={`שם הילד ${i + 1}`} value={c} onChange={e => updateChild(i, e.target.value)} />
                {children.length > 1 && (
                  <button type="button" className="btn btn-danger btn-icon btn-sm" onClick={() => {
                    const next = children.filter((_, j) => j !== i); setChildren(next); checkDuplicates(next, phone);
                  }}><Trash2 size={15} /></button>
                )}
              </div>
            ))}
          </div>
        )}

        {warnings.length > 0 && (
          <div className="alert alert-warn">
            ⚠️ הילד{warnings.length > 1 ? 'ים' : ''} <strong>{warnings.join(', ')}</strong> כבר קיים/ים במערכת תחת הטלפון הזה.
            הסטטוס שלהם יוחזר ל"ליד חדש" באופן אוטומטי.
          </div>
        )}
      </form>
    </Modal>
  );
}

// ─── Main Leads / Customers Page ─────────────────────────────────────────────
export default function Leads({
  students,
  setStudents,
  parents,
  setParents,
  groups,
  canManageBilling = false,
  canViewComms = true,
  loadError = '',
  onRetryLoad,
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('communication');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState(null);
  const [pricelist, setPricelist] = useState([]);
  const [viewMode, setViewMode] = useState('table');
  const [dragOverStatus, setDragOverStatus] = useState(null);
  const [markingHandledId, setMarkingHandledId] = useState(null);
  const [markingAllHandled, setMarkingAllHandled] = useState(false);
  const [handlingError, setHandlingError] = useState('');
  const [communicationSort, setCommunicationSort] = useState('conversation_desc');
  // The whole declaration feed, so the table can mark each climber without
  // opening their file. One fetch for the list, not one per row.
  const [declarations, setDeclarations] = useState([]);

  useEffect(() => {
    fetch('/api/health-declarations')
      .then(res => res.ok ? res.text() : '[]')
      .then(text => {
        const list = JSON.parse(text);
        if (!Array.isArray(list)) return;
        // Remembered so the first background refresh doesn't re-set an
        // identical feed and refetch every open card's folders for nothing.
        lastRefreshRef.current.declarations = text;
        setDeclarations(list);
      })
      .catch(() => setDeclarations([]));
  }, []);

  // Open a customer file from deep links (e.g. activity registration list).
  useEffect(() => {
    const openId = searchParams.get('open');
    if (!openId) return;
    let cancelled = false;

    (async () => {
      let studs = students;
      let pars = parents;

      // Always refresh once — registrations may have created records after App load.
      try {
        const [studentsResponse, parentsResponse] = await Promise.all([
          fetch('/api/students'),
          fetch('/api/parents'),
        ]);
        if (studentsResponse.ok && parentsResponse.ok) {
          const [freshStudents, freshParents] = await Promise.all([
            studentsResponse.json(),
            parentsResponse.json(),
          ]);
          if (
            !cancelled
            && Array.isArray(freshStudents)
            && Array.isArray(freshParents)
          ) {
            studs = freshStudents;
            pars = freshParents;
            setStudents(freshStudents);
            setParents(freshParents);
          }
        }
      } catch {
        /* keep existing in-memory lists */
      }

      if (cancelled) return;

      const targetId = resolveLeadOpenTarget(openId, studs, pars);
      const next = new URLSearchParams(searchParams);
      next.delete('open');
      setSearchParams(next, { replace: true });
      if (targetId) setSelectedStudentId(targetId);
    })();

    return () => { cancelled = true; };
    // Intentionally omit students/parents — run once per open param, then refresh from API.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setSearchParams, setStudents, setParents]);

  // Fetch pricelist for billing options
  useEffect(() => {
    if (!canManageBilling) return;
    fetch('/api/pricelist')
      .then(res => res.ok ? res.json() : [])
      .then(data => setPricelist(data))
      .catch(err => console.error(err));
  }, [canManageBilling]);

  // What the last background refresh returned, so an unchanged answer can be
  // dropped before it becomes new state. Most minutes nothing changed, and
  // replacing the arrays anyway rebuilt every household row and every status
  // count for nothing — which the desk felt as the screen stuttering under them.
  const lastRefreshRef = useRef({ students: null, parents: null, declarations: null });

  const refreshData = async () => {
    try {
      const [studentsResponse, parentsResponse, declarationsResponse] = await Promise.all([
        fetch('/api/students'),
        fetch('/api/parents'),
        fetch('/api/health-declarations'),
      ]);
      if (!studentsResponse.ok || !parentsResponse.ok) return;
      // Compared as text: byte-exact, and cheaper than re-serialising the state.
      const [studentsText, parentsText] = await Promise.all([
        studentsResponse.text(),
        parentsResponse.text(),
      ]);
      // A declaration signed while a customer file is open has to reach that
      // open card — the card derives its approvals from this feed.
      if (declarationsResponse.ok) {
        const declarationsText = await declarationsResponse.text();
        if (declarationsText !== lastRefreshRef.current.declarations) {
          const freshDeclarations = JSON.parse(declarationsText);
          if (Array.isArray(freshDeclarations)) {
            lastRefreshRef.current.declarations = declarationsText;
            setDeclarations(freshDeclarations);
          }
        }
      }
      if (studentsText !== lastRefreshRef.current.students) {
        const freshStudents = JSON.parse(studentsText);
        if (Array.isArray(freshStudents)) {
          lastRefreshRef.current.students = studentsText;
          setStudents(freshStudents);
        }
      }
      if (parentsText !== lastRefreshRef.current.parents) {
        const freshParents = JSON.parse(parentsText);
        if (Array.isArray(freshParents)) {
          lastRefreshRef.current.parents = parentsText;
          setParents(freshParents);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Background refresh: once a minute, and only while the tab is visible.
  // (Was every 15s regardless of visibility — a constant load on the server.)
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refreshData();
    }, 60000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshData();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep both scopes stable. Previously the working-list count jumped merely
  // because the waiting tab used an archive-inclusive source list.
  const showArchived = filterStatus === 'archived';
  const searchActive = Boolean(search.trim());
  const leadEntryScopes = useMemo(
    () => buildLeadEntryScopes(students, parents),
    [students, parents]
  );
  // A direct search is archive-inclusive so an old customer can always be
  // found without the employee first guessing which status tab contains them.
  const leadEntries = searchActive || showArchived || filterStatus === 'communication'
    ? leadEntryScopes.archiveInclusive
    : leadEntryScopes.working;

  const filtered = useMemo(() => {
    return leadEntries.filter(({ student: s, parent: p }) => {
      const parent = p || parents.find((x) => x.id === s.parentId);
      const matchSearch = matchesLeadSearch({ student: s, parent }, search);
      // Searching is a database-wide lookup rather than an intersection with
      // whichever workflow tab happened to be selected beforehand.
      const matchStatus = searchActive
        ? true
        : showArchived
          ? isArchivedParent(parent)
          : filterStatus === 'all'
            || (filterStatus === 'communication'
              ? isAwaitingHandling(parent, [s])
              : s.status === filterStatus);
      return matchSearch && matchStatus;
    }).map((entry) => entry.student);
  }, [leadEntries, parents, search, searchActive, showArchived, filterStatus]);

  // Table: one row per family. Kanban stays per-student for the funnel.
  const familyRows = useMemo(() => {
    const rows = buildFamilyRows(filtered, parents, students);
    if (filterStatus === 'communication') {
      return sortCommunicationRows(rows, communicationSort);
    }
    return rows;
  }, [filtered, parents, students, filterStatus, communicationSort]);

  // Keep modal navigation tied to the complete handling queue, even when the
  // table underneath is filtered or searched. Its order follows the sort the
  // employee selected for incoming enquiries.
  const communicationFamilyRows = useMemo(() => {
    const waitingStudents = leadEntryScopes.archiveInclusive
      .filter(({ parent, student }) => isAwaitingHandling(parent, [student]))
      .map(({ student }) => student);
    return sortCommunicationRows(
      buildFamilyRows(waitingStudents, parents, students),
      communicationSort
    );
  }, [leadEntryScopes, parents, students, communicationSort]);

  // The customer table is a thousand-odd households, and drawing every row cost
  // roughly a second of frozen screen on each visit and each keystroke in
  // search. Rows are added as they are scrolled towards instead. Filtering or
  // searching starts over from the top, which is where the answer is anyway.
  const ROWS_PER_PAGE = 60;
  const [visibleRowCount, setVisibleRowCount] = useState(ROWS_PER_PAGE);
  const moreRowsRef = useRef(null);
  useEffect(() => { setVisibleRowCount(ROWS_PER_PAGE); }, [search, filterStatus, communicationSort]);
  const visibleFamilyRows = useMemo(
    () => familyRows.slice(0, visibleRowCount),
    [familyRows, visibleRowCount]
  );
  useEffect(() => {
    const sentinel = moreRowsRef.current;
    if (!sentinel) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisibleRowCount((count) => count + ROWS_PER_PAGE);
      }
    }, { rootMargin: '400px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleFamilyRows.length, familyRows.length]);

  const familyCountByStatus = useMemo(() => {
    const map = {
      all: buildFamilyRows(
        leadEntryScopes.working.map((e) => e.student),
        parents,
        students
      ).length,
      // Counted off its own archive-inclusive list, so the badge shows the same
      // number whichever tab happens to be open.
      communication: buildFamilyRows(
        leadEntryScopes.archiveInclusive
          .filter(({ parent, student }) => isAwaitingHandling(parent, [student]))
          .map(({ student }) => student),
        parents,
        students
      ).length,
    };
    for (const key of Object.keys(STATUSES)) {
      if (key === 'archived') continue;
      const matching = leadEntryScopes.working
        .filter((e) => e.student.status === key)
        .map((e) => e.student);
      map[key] = buildFamilyRows(matching, parents, students).length;
    }
    map.archived = buildFamilyRows(
      leadEntryScopes.archiveInclusive
        .filter(({ parent }) => isArchivedParent(parent))
        .map((e) => e.student),
      parents,
      students
    ).length;
    return map;
  }, [leadEntryScopes, students, parents]);

  const totalFamilyCount = familyCountByStatus.all + familyCountByStatus.archived;

  const applyHandledParents = (updatedParents = [], handledAt) => {
    const byId = new Map(updatedParents.map((item) => [item.id, item]));
    setParents((prev) => prev.map((item) => {
      if (byId.has(item.id)) return { ...item, ...byId.get(item.id) };
      return item;
    }));
    if (!updatedParents.length && handledAt && selectedParent?.id) {
      setParents((prev) => prev.map((item) => (
        item.id === selectedParent.id
          ? { ...item, communication_handled_at: handledAt }
          : item
      )));
    }
  };

  const handleMarkHandled = async (parentId) => {
    if (!parentId || markingHandledId) return;
    setMarkingHandledId(parentId);
    setHandlingError('');
    try {
      const response = await fetch(`/api/conversations/${parentId}/handled`, { method: 'POST' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'סימון הלקוח כטופל נכשל');
      }
      applyHandledParents(result.parents || [], result.handledAt);
    } catch (error) {
      console.error(error);
      setHandlingError(error.message || 'סימון הלקוח כטופל נכשל');
    } finally {
      setMarkingHandledId(null);
    }
  };

  const handleMarkAllHandled = async () => {
    if (markingAllHandled) return;
    if (!window.confirm(`לסמן את כל ${familyCountByStatus.communication} הממתינים כ"לקוח טופל"? מי שיכתוב שוב יחזור לרשימה.`)) return;
    setMarkingAllHandled(true);
    setHandlingError('');
    try {
      const response = await fetch('/api/conversations/handled-all', { method: 'POST' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'סימון כל הלקוחות כטופלו נכשל');
      }
      applyHandledParents(result.parents || [], result.handledAt);
    } catch (error) {
      console.error(error);
      setHandlingError(error.message || 'סימון כל הלקוחות כטופלו נכשל');
    } finally {
      setMarkingAllHandled(false);
    }
  };

  const selectedStudent = students.find((s) => String(s.id) === String(selectedStudentId))
    || (String(selectedStudentId || '').startsWith('parent:')
      ? buildLeadEntries(students, parents, { includeArchived: true }).find((e) => String(e.key) === String(selectedStudentId))?.student
      : null);
  const selectedParent = selectedStudent ? parents.find((p) => String(p.id) === String(selectedStudent.parentId)) : null;
  const selectedGroup = selectedStudent?.groupId ? groups.find(g => g.id === selectedStudent.groupId) : null;
  const selectedSiblings = selectedParent
    ? householdStudentsForParent(selectedParent.id, students, parents)
      .slice()
      .sort(compareTraineeChips)
    : [];
  const selectedHouseholdParentIds = new Set(
    selectedSiblings.flatMap((member) => studentGuardianIds(member))
  );
  if (selectedParent?.id) selectedHouseholdParentIds.add(String(selectedParent.id));
  const selectedHouseholdParents = parents.filter(
    (item) => selectedHouseholdParentIds.has(String(item.id))
  );

  const handleSelectedCommunicationHandled = (updatedParents = [], handledAt) => {
    // Resolve the next card before the current household disappears from the
    // waiting queue as a result of applying the handled timestamp.
    const nextFamily = nextCommunicationRow(
      communicationFamilyRows,
      selectedHouseholdParents.map((item) => item.id)
    );
    applyHandledParents(updatedParents, handledAt);
    setSelectedStudentId(nextFamily?.primaryStudent?.id || null);
  };

  const handleAdd = async ({ parentName, lastName, idNumber, phone, email, city, source, children }) => {
    let updatedParents = [...parents];
    let updatedStudents = [...students];

    // Find or create parent
    let parent = updatedParents.find(p => normPhone(p.phone) === normPhone(phone));
    if (!parent) {
      parent = {
        id: `p${Date.now()}`,
        name: parentName,
        lastName,
        idNumber,
        phone,
        email,
        city,
        source,
      };
      updatedParents.push(parent);
    }

    children.forEach(childName => {
      const existingIdx = updatedStudents.findIndex(
        s => s.name.trim() === childName && s.parentId === parent.id
      );
      if (existingIdx !== -1) {
        updatedStudents[existingIdx] = { ...updatedStudents[existingIdx], status: 'lead_new', updated: new Date().toISOString().split('T')[0] };
      } else {
        updatedStudents.unshift({
          id: `s${Date.now()}-${childName}`,
          name: childName,
          parentId: parent.id,
          groupId: null,
          status: 'lead_new',
          birthDate: '',
          notes: '',
          levelGrade: null,
          created: new Date().toISOString().split('T')[0],
          created_at: new Date().toISOString(),
        });
      }
    });

    if (children.length === 0) {
      parent = { ...parent, status: 'lead_new' };
      const pIdx = updatedParents.findIndex((p) => p.id === parent.id);
      if (pIdx >= 0) updatedParents[pIdx] = parent;
    }

    setParents(updatedParents);
    setStudents(updatedStudents);

    // Sync to backend API
    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentName, lastName, idNumber, phone, email, city, source, children }),
      });
      if (response.ok) {
        refreshData();
      }
    } catch (e) {
      console.warn('Backend offline, lead saved only locally.', e);
    }
  };

  const handleStatusChange = async (studentId, newStatus) => {
    if (isParentOnlyLead({ id: studentId })) {
      const parentId = studentId.replace(/^parent:/, '');
      setParents((prev) => prev.map((p) => (p.id === parentId ? { ...p, status: newStatus } : p)));
      try {
        await fetch(`/api/parents/${parentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });
      } catch (e) {
        console.warn('Backend offline, status updated only locally.', e);
      }
      return;
    }
    setStudents(prev => prev.map(s => s.id === studentId ? { ...s, status: newStatus } : s));

    try {
      await fetch(`/api/students/${studentId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch (e) {
      console.warn('Backend offline, status updated only locally.', e);
    }
  };

  const handleDelete = async (studentId) => {
    const parentOnly = isParentOnlyLead({ id: studentId });
    const url = parentOnly
      ? `/api/parents/${encodeURIComponent(String(studentId).replace(/^parent:/, ''))}`
      : `/api/students/${encodeURIComponent(studentId)}`;
    try {
      const response = await fetch(url, { method: 'DELETE' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        alert(body.error || 'מחיקת הלקוח נכשלה');
        return;
      }
      if (body.parentWarning) alert(body.parentWarning);
      setSelectedStudentId(null);
      refreshData();
    } catch (err) {
      console.error(err);
      alert('מחיקת הלקוח נכשלה — אין חיבור לשרת');
    }
  };

  const handleArchive = async (parentId, archived) => {
    if (!parentId) return;
    try {
      const response = await fetch(`/api/parents/${encodeURIComponent(parentId)}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        alert(body.error || 'העברה לארכיון נכשלה');
        return;
      }
      // The card is about to leave the list it was opened from.
      setSelectedStudentId(null);
      refreshData();
    } catch (err) {
      console.error(err);
      alert('העברה לארכיון נכשלה — אין חיבור לשרת');
    }
  };

  const handleUpdateStudent = (studentId, updatedData) => {
    setStudents(prev => prev.map(s => s.id === studentId ? { ...s, ...updatedData } : s));
  };

  const handleUpdateParent = (parentId, updatedData) => {
    setParents(prev => prev.map(p => p.id === parentId ? { ...p, ...updatedData } : p));
  };

  return (
    <div className="fade-in">
      {selectedStudentId && (
        <CustomerCard
          student={selectedStudent}
          parent={selectedParent}
          parents={selectedHouseholdParents}
          siblings={selectedSiblings}
          declarations={declarations}
          onSelectSibling={setSelectedStudentId}
          group={selectedGroup}
          groups={groups}
          pricelist={pricelist}
          onClose={() => setSelectedStudentId(null)}
          onStatusChange={handleStatusChange}
          onDelete={handleDelete}
          onArchive={handleArchive}
          onUpdateStudent={handleUpdateStudent}
          onUpdateParent={handleUpdateParent}
          refreshData={refreshData}
          canManageBilling={canManageBilling}
          canViewComms={canViewComms}
          onCommunicationHandled={handleSelectedCommunicationHandled}
        />
      )}

      {showAddModal && (
        <AddLeadModal students={students} parents={parents} onAdd={handleAdd} onClose={() => setShowAddModal(false)} />
      )}

      {/* Toolbar */}
      <div className="section-header">
        <div>
          <div className="section-title">מאגר לקוחות ולידים</div>
          <div className="section-sub">
            {totalFamilyCount} משפחות במאגר · {familyCountByStatus.all} פעילות
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div className="tab-bar tab-bar-inline">
            <button className={`tab-pill tab-pill-icon ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setViewMode('table')} title="תצוגת טבלה">
              <List size={16} />
            </button>
            <button className={`tab-pill tab-pill-icon ${viewMode === 'kanban' ? 'active' : ''}`} onClick={() => setViewMode('kanban')} title="תצוגת קנבן">
              <LayoutGrid size={16} />
            </button>
            {canViewComms && (
              <button
                className={`tab-pill tab-pill-icon ${viewMode === 'inbox' ? 'active' : ''}`}
                onClick={() => setViewMode('inbox')}
                title="תצוגת שיחות"
                style={{ position: 'relative' }}
              >
                <MessageCircle size={16} />
                {familyCountByStatus.communication > 0 && viewMode !== 'inbox' && (
                  <span
                    style={{
                      position: 'absolute', top: 1, insetInlineEnd: 1,
                      width: 7, height: 7, borderRadius: '50%', background: '#FBBF24',
                    }}
                  />
                )}
              </button>
            )}
          </div>
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
            <Plus size={16} /> ליד חדש
          </button>
        </div>
      </div>

      {loadError && (
        <div
          className="alert alert-error"
          style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
        >
          <span>{loadError}. הנתונים לא נמחקו ואפשר לנסות לטעון אותם שוב.</span>
          {onRetryLoad && (
            <button className="btn btn-sm btn-ghost" type="button" onClick={onRetryLoad}>
              נסה שוב
            </button>
          )}
        </div>
      )}

      {/* Status filter tabs (table view) */}
      {viewMode === 'table' && (
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <button
          className={`btn btn-sm ${filterStatus === 'communication' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setFilterStatus('communication')}
        >
          ממתינים לטיפול ({familyCountByStatus.communication})
        </button>
        <button className={`btn btn-sm ${filterStatus === 'all' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilterStatus('all')}>
          פעילים ({familyCountByStatus.all})
        </button>
        {Object.entries(STATUSES).filter(([k]) => k !== 'archived').map(([k, v]) => (
          <button key={k} className={`btn btn-sm ${filterStatus === k ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilterStatus(k)}>
            {v.label} ({familyCountByStatus[k] || 0})
          </button>
        ))}
        {(familyCountByStatus.archived > 0 || showArchived) && (
          <button
            className={`btn btn-sm ${showArchived ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setFilterStatus('archived')}
            style={{ gap: 6 }}
          >
            <Archive size={13} /> ארכיון ({familyCountByStatus.archived})
          </button>
        )}
        {filterStatus === 'communication' && familyCountByStatus.communication > 0 && (
          <div style={{ marginInlineStart: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <AppSelect
              value={communicationSort}
              onChange={(event) => setCommunicationSort(event.target.value)}
              className="btn btn-sm btn-ghost"
              style={{ width: 218 }}
              aria-label="מיון הממתינים לטיפול"
              title="מיון רשימת הממתינים לטיפול"
            >
              <option value="conversation_desc">מיון: זמן שיחה · חדש לישן</option>
              <option value="conversation_asc">מיון: זמן שיחה · ישן לחדש</option>
              <option value="name_asc">מיון: שם הורה · א׳–ת׳</option>
              <option value="created_desc">מיון: תאריך קליטה · חדש לישן</option>
              <option value="created_asc">מיון: תאריך קליטה · ישן לחדש</option>
            </AppSelect>
            <button
              className="btn btn-sm btn-success"
              disabled={markingAllHandled}
              onClick={handleMarkAllHandled}
            >
              <Check size={13} /> {markingAllHandled ? 'מסמן את כולם...' : 'סמן את כולם כטופלו'}
            </button>
          </div>
        )}
      </div>
      )}

      {handlingError && (
        <div className="alert alert-danger" style={{ marginBottom: 14 }}>
          {handlingError}
        </div>
      )}

      {/* Inbox — every conversation in one list, WhatsApp style */}
      {viewMode === 'inbox' && (
        <ConversationInbox parents={parents} onHandled={applyHandledParents} />
      )}

      {/* Kanban board (funnel by status) */}
      {viewMode === 'kanban' && (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 12, alignItems: 'flex-start' }}>
          {Object.entries(STATUSES).filter(([k]) => k !== 'archived').map(([statusKey, statusVal]) => {
            const colStudents = filtered.filter(s => s.status === statusKey);
            return (
              <div
                key={statusKey}
                onDragOver={e => { e.preventDefault(); setDragOverStatus(statusKey); }}
                onDragLeave={() => setDragOverStatus(prev => prev === statusKey ? null : prev)}
                onDrop={e => {
                  e.preventDefault();
                  const sid = e.dataTransfer.getData('text/plain');
                  if (sid) handleStatusChange(sid, statusKey);
                  setDragOverStatus(null);
                }}
                style={{
                  minWidth: 240, width: 240, flexShrink: 0,
                  background: dragOverStatus === statusKey ? 'rgba(129,140,248,0.08)' : 'var(--bg-input)',
                  border: `1px solid ${dragOverStatus === statusKey ? statusVal.color : 'var(--border)'}`,
                  borderRadius: 12, padding: 10, transition: 'background 0.15s, border-color 0.15s'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: statusVal.color }} />
                  <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-1)' }}>{statusVal.label}</span>
                  <span style={{ marginRight: 'auto', fontSize: 12, color: 'var(--text-3)', background: 'var(--bg-1)', borderRadius: 10, padding: '1px 8px' }}>{colStudents.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 40 }}>
                  {colStudents.map(s => {
                    const parent = parents.find(p => p.id === s.parentId);
                    const groupList = groups.filter((g) => studentGroupIds(s).includes(String(g.id)));
                    const src = LEAD_SOURCES[parent?.source || s.source] || LEAD_SOURCES.unknown;
                    return (
                      <div
                        key={s.id}
                        draggable
                        onDragStart={e => e.dataTransfer.setData('text/plain', s.id)}
                        onClick={() => setSelectedStudentId(s.id)}
                        className="card card-p"
                        style={{ cursor: 'grab', padding: 10 }}
                      >
                        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-1)', marginBottom: 4 }}>{s.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{parent?.name}</div>
                        {parent?.phone && <div style={{ fontSize: 11, color: 'var(--text-3)', direction: 'ltr', unicodeBidi: 'plaintext' }}>{parent.phone}</div>}
                        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                          <span className="badge badge-gray" style={{ fontSize: 10 }}>{src.icon} {src.label}</span>
                          {groupList.map((g) => (
                            <span key={g.id} className="badge badge-blue" style={{ fontSize: 10 }}>{g.name.split(' ')[0]}</span>
                          ))}
                          {s.nextFollowup && <span className="badge badge-amber" style={{ fontSize: 10 }}>🔔 {s.nextFollowup}</span>}
                        </div>
                      </div>
                    );
                  })}
                  {colStudents.length === 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'center', padding: 12 }}>גרור לכאן</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Table — one row per family */}
      {viewMode === 'table' && (
      <div className="card">
        <div style={{ display: 'flex', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
          <div className="input-icon-wrap" style={{ flex: 1, maxWidth: 300 }}>
            <Search className="input-icon" size={16} />
            <input
              className="input"
              placeholder="חיפוש לפי שם, הורה, טלפון..."
              style={{ width: '100%', paddingRight: 36 }}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {searchActive && (
            <span className="text-muted" style={{ fontSize: 12 }}>
              החיפוש כולל גם את הארכיון
            </span>
          )}
        </div>
        <div className="table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>שם ההורה</th>
                <th>ילדים / מתאמנים</th>
                <th>טלפון</th>
                <th>קבוצה</th>
                <th>סטטוס</th>
                <th>תאריך קליטה</th>
                <th>פעולות</th>
              </tr>
            </thead>
            <tbody>
              {familyRows.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>אין תוצאות</td></tr>
              )}
              {visibleFamilyRows.map((family) => {
                const parent = family.parent;
                const primary = family.primaryStudent;
                const isIg = parent?.instagram_id || parent?.channel === 'instagram'
                  || family.students.some((s) => s.notes?.includes('אינסטגרם'));
                const namedChildren = family.students.filter((s) => s.name && !isParentOnlyLead(s));
                const groupsInFamily = [...new Set(
                  family.students.flatMap((s) => studentGroupIds(s))
                )].map((gid) => groups.find((g) => g.id === gid)).filter(Boolean);
                // The second parent of the household — same customer, one row.
                const otherParents = (family.parents || [])
                  .filter((p) => String(p.id) !== String(parent?.id));
                const awaiting = [parent, ...otherParents].some((p) => p && isAwaitingHandling(p));

                return (
                  <tr
                    key={family.key}
                    style={{ cursor: 'pointer' }}
                    onClick={() => primary && setSelectedStudentId(primary.id)}
                  >
                    <td style={{ fontWeight: 700 }}>
                      {parentDisplayName(parent) || '—'}
                      {otherParents.length > 0 && (
                        <div style={{ marginTop: 2, fontWeight: 500, fontSize: 11, color: 'var(--text-3)' }}>
                          {otherParents.map((p) => parentDisplayName(p)).filter(Boolean).join(' · ')}
                        </div>
                      )}
                      {awaiting && (
                        <div style={{ marginTop: 4 }}>
                          <span className="badge badge-amber" style={{ fontSize: 10 }}>ממתין לטיפול</span>
                        </div>
                      )}
                      {isArchivedParent(parent) && (
                        <div style={{ marginTop: 4 }}>
                          <span className="badge badge-gray" style={{ fontSize: 10 }}>ארכיון</span>
                        </div>
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {namedChildren.length === 0 ? (
                        <span style={{ color: 'var(--text-3)' }}>ללא מתאמן רשום</span>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {namedChildren.map((child) => {
                            const st = STATUSES[child.status];
                            const statusColor = st?.color;
                            const declStatus = studentDeclarationStatus(declarations, child, parent?.phone);
                            return (
                              <button
                                key={child.id}
                                type="button"
                                className="btn btn-ghost btn-xs"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 5,
                                  padding: '2px 8px',
                                  border: `1px solid ${statusColor ? `${statusColor}66` : 'var(--border)'}`,
                                  background: statusColor ? `${statusColor}1F` : undefined,
                                  borderRadius: 999,
                                  fontWeight: 600,
                                }}
                                onClick={() => setSelectedStudentId(child.id)}
                                title={st?.label || child.status}
                              >
                                {/* First in the chip, so in RTL the icons sit on the leading
                                    edge and line up down the column however long the names are. */}
                                <DeclarationIcons status={declStatus} />
                                <GenderMark gender={child.gender} size={11} />
                                {child.isAdult && <AdultMark size={11} />}
                                {child.name}
                                {/* The signed-declaration status is the icons now, so the
                                    text label would only repeat them. */}
                                {!child.isAdult && namedChildren.length > 1 && child.status !== 'health_signed' && (
                                  <span style={{ color: statusColor || 'var(--text-3)', fontWeight: 500, fontSize: 10 }}>
                                    {st?.label || ''}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    <td style={{ direction: 'ltr', unicodeBidi: 'plaintext', color: isIg && !parent?.phone ? '#ff80bf' : 'var(--text-2)' }}>
                      {isIg && !parent?.phone ? `📸 IG (${parent?.instagram_id || 'DM'})` : parent?.phone}
                      {otherParents
                        .map((p) => p.phone)
                        .filter((phone) => phone && normPhone(phone) !== normPhone(parent?.phone))
                        .map((phone) => (
                          <div key={phone} style={{ fontSize: 11, color: 'var(--text-3)' }}>{phone}</div>
                        ))}
                    </td>
                    <td>
                      {groupsInFamily.length === 0
                        ? <span className="badge badge-gray">—</span>
                        : groupsInFamily.map((g) => (
                          <span key={g.id} className="badge badge-blue" style={{ marginInlineEnd: 4 }}>
                            {g.name.split(' ')[0]}
                          </span>
                        ))}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {family.statuses.map((st) => (
                          <StatusBadge key={st} status={st} />
                        ))}
                      </div>
                    </td>
                    <td style={{ color: 'var(--text-3)', fontSize: 12 }}>{family.created}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-ghost btn-xs" onClick={() => primary && setSelectedStudentId(primary.id)}>
                          <Eye size={13} /> פרטים
                        </button>
                        {isAwaitingHandling(parent) && (
                          <button
                            type="button"
                            className="btn btn-success btn-xs"
                            disabled={markingHandledId === parent?.id}
                            onClick={() => handleMarkHandled(parent?.id)}
                          >
                            <Check size={13} /> {markingHandledId === parent?.id ? 'מסמן...' : 'לקוח טופל'}
                          </button>
                        )}
                        {parent?.phone && !isIg ? (
                          <a href={`https://wa.me/${normalizePhone(parent?.phone)}`}
                            target="_blank" rel="noreferrer" className="btn btn-success btn-xs" onClick={(e) => e.stopPropagation()}>
                            💬
                          </a>
                        ) : isIg ? (
                          <span className="btn btn-xs" style={{ background: 'linear-gradient(45deg, #f09433, #dc2743)', color: 'white', border: 'none' }}>
                            📸 DM
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {visibleFamilyRows.length < familyRows.length && (
                <tr ref={moreRowsRef}>
                  <td colSpan={7} style={{ textAlign: 'center', padding: 16, color: 'var(--text-3)', fontSize: 12 }}>
                    מציג {visibleFamilyRows.length} מתוך {familyRows.length} — גוללים כדי לראות עוד
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
}
