import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Plus, PlusCircle, Trash2, UserCheck, Phone, Mail, Eye, X, CreditCard, Award, Send, Clipboard, Edit2, Check, LayoutGrid, List, MessageCircle, MapPin, Tag, Bell, FileCheck2, Download, ReceiptText, History, ChevronDown, ChevronLeft, Users, Ticket, CalendarDays, Package, Gift, ShoppingBag, Archive, ArchiveRestore, ShieldCheck, ShieldAlert } from 'lucide-react';
import { STATUSES, LEAD_SOURCES, LEAD_SEGMENTS } from '../mockData.js';
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
  downloadHealthDeclarationPdf,
} from '../utils/healthDeclarationPdf.js';
import { healthExpiryDate, isHealthDeclarationValid } from '../utils/healthValidity.js';
import {
  DECLARATION_KINDS,
  DEFAULT_KIND,
  declarationKind,
  templateKind,
  templateShortLabel,
} from '../utils/declarationKinds.js';
import { studentDeclarationStatus } from '../utils/declarationStatus.js';
import { safetyTestStatus, SAFETY_TONE } from '../utils/safetyValidity.js';
import {
  FORM_FOLDER,
  FORM_SHORT,
  FORM_SIGNED_ROW,
} from '../utils/participationForm.js';
import {
  buildLeadEntries,
  isArchivedParent,
  isParentOnlyLead,
  normalizePhone,
  resolveLeadOpenTarget,
} from '../utils/leadUtils.js';
import { buildFamilyRows, householdStudentsForParent } from '../utils/leadHouseholds.js';
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
import { awaitingSince, isAwaitingHandling } from './communicationQueue.js';
import { consecutiveAbsences } from '../scheduleUtils.js';
import { studentGroupIds } from '../utils/studentGroups.js';
import { passPurchasedText, passSubtitle } from '../utils/passes.js';
import { otherGuardians } from '../utils/studentGuardians.js';
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

function genderLabel(gender) {
  const kind = genderKind(gender);
  if (kind === 'male') return 'בן';
  if (kind === 'female') return 'בת';
  return gender || '—';
}

/** „בן 4 וחצי” בשורה אחת; אם חסר מין או תאריך לידה מציגים את מה שיש. */
function ageWithGenderLabel(birthDateStr, gender) {
  const age = ageLabel(birthDateStr);
  const g = genderLabel(gender);
  const prefix = g === 'בן' || g === 'בת' ? g : '';
  if (!prefix) return age ?? '—';
  return age ? `${prefix} ${age}` : prefix;
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
function buildHealthWhatsAppText(parentName, studentName, link) {
  const p = String(parentName || '').trim();
  const s = String(studentName || '').trim();
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

function buildShareHealthLink(studentId, phone, healthPath = '/register') {
  const params = new URLSearchParams();
  if (studentId && !String(studentId).startsWith('parent:')) {
    params.set('studentId', studentId);
  } else if (phone) {
    params.set('phone', phone);
  }
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
 * Declaration state for one climber, as icons: the scroll is the wall form,
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
    { key: 'wall', Icon: DECLARATION_KINDS.wall.Icon, label: 'טופס השתתפות לקיר' },
    { key: 'event', Icon: DECLARATION_KINDS.event.Icon, label: 'טופס השתתפות לפעילות בקיר' },
    { key: 'trip', Icon: DECLARATION_KINDS.trip.Icon, label: 'טופס השתתפות לטיולים' },
  ];
  const validMarks = marks.filter(({ key }) => {
    const state = status?.[key];
    return !!state?.signed && !state?.expired;
  });
  // Name-row mode: green icons for every valid signature; if none, one amber
  // scroll so a missing wall form still reads at a glance.
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

function FolderRow({ id, title, icon: Icon, summary, open, onToggle, children, summaryColor, accent = 'var(--blue)' }) {
  return (
    <div
      data-folder-id={id}
      className={`folder-row ${open ? 'open' : ''}`}
      style={{ '--folder-accent': accent }}
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
      {open && <div className="folder-row-body">{children}</div>}
    </div>
  );
}

// ─── Lead/Customer Card (detail sidebar) ────────────────────────────────────
export function CustomerCard({ student, parent: primaryParent, parents: allParents = [], siblings = [], onSelectSibling, group, groups = [], onClose, onStatusChange, onDelete, onArchive, onUpdateStudent, onUpdateParent, pricelist, refreshData, canManageBilling = false, canViewComms = true, onCommunicationHandled }) {
  if (!student) return null;

  /**
   * A child can have two parents on file — mum and dad, each with their own
   * phone, mailing lists and conversation. The card shows one of them at a
   * time, chosen by the tabs below, and everything else here reads `parent`,
   * so the whole page follows the tab without a second code path.
   */
  const [activeParentId, setActiveParentId] = useState(primaryParent?.id || null);
  useEffect(() => {
    setActiveParentId(primaryParent?.id || null);
  }, [student.id, primaryParent?.id]);
  const parent = (allParents || []).find((item) => String(item.id) === String(activeParentId))
    || primaryParent;

  const parentOnly = isParentOnlyLead(student);
  const parentArchived = isArchivedParent(parent);
  const statusKeys = Object.keys(STATUSES);
  const navigate = useNavigate();

  const [broadcastListDefs, setBroadcastListDefs] = useState([
    { key: 'general', label: 'כללי', description: 'עדכונים שוטפים' },
    { key: 'classes', label: 'חוגים', description: 'שינויי שעות וכדומה' },
    { key: 'trips', label: 'טיולים', description: 'טיולי סנפלינג/חוץ' },
    { key: 'events', label: 'אירועים', description: 'אירועים ותחרויות מועדון' },
  ]);
  const [broadcastLists, setBroadcastLists] = useState({});
  const [loadingLists, setLoadingLists] = useState(false);
  const [editingBroadcastLists, setEditingBroadcastLists] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [phoneCopied, setPhoneCopied] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editingGroup, setEditingGroup] = useState(false);
  const [savingGroup, setSavingGroup] = useState(false);
  const [editingFollowup, setEditingFollowup] = useState(false);
  const [savingFollowup, setSavingFollowup] = useState(false);
  
  // Edit Form Fields (student)
  const [editStudentName, setEditStudentName] = useState(student.name || '');
  const [editBirthDate, setEditBirthDate] = useState(student.birthDate || '');
  const [editStudentPhone, setEditStudentPhone] = useState(student.phone || '');
  const [editGender, setEditGender] = useState(student.gender || '');
  const [editNotes, setEditNotes] = useState(student.notes || '');
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
  const [editSource, setEditSource] = useState(parent?.source || student.source || 'unknown');
  const [editFocus, setEditFocus] = useState('student'); // student | parent
  const [editError, setEditError] = useState('');

  // Health declaration + waiver status for this student
  const [healthDecl, setHealthDecl] = useState(null);
  // All of this student's declarations, one per activity they signed for.
  const [studentDeclarations, setStudentDeclarations] = useState([]);
  const [sendingHealth, setSendingHealth] = useState(false);
  const [healthSendMsg, setHealthSendMsg] = useState('');
  const [healthSendLink, setHealthSendLink] = useState('');
  const [formTemplates, setFormTemplates] = useState([]);
  const [selectedFormSlug, setSelectedFormSlug] = useState('');
  const [showHealthSendModal, setShowHealthSendModal] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [clientDocuments, setClientDocuments] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState('');
  // A file leaves the client's personal file for good, so the row is only armed
  // once the word is typed out by hand.
  const [pendingDocDelete, setPendingDocDelete] = useState(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
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
    setEditStudentName(student.name || '');
    setEditBirthDate(student.birthDate || '');
    setEditStudentPhone(student.phone || '');
    setEditGender(student.gender || '');
    setEditNotes(isParentOnlyLead(student) ? (parent?.notes || '') : (student.notes || ''));
    setEditSegment(student.segment || '');
    setEditNextFollowup(student.nextFollowup || '');
    setEditGroupIds(studentGroupIds(student));
    const nextParentName = parentNameParts(parent);
    setEditParentName(nextParentName.firstName);
    setEditParentLastName(nextParentName.lastName);
    setEditParentIdNumber(parent?.idNumber || '');
    setEditPhone(parent?.phone || '');
    setEditEmail(parent?.email || '');
    setEditCity(parent?.city || '');
    setEditSource(parent?.source || student.source || 'unknown');
    setIsEditing(false);
    setEditFocus('student');
    setEditError('');
    setEditingGroup(false);
    setEditingFollowup(false);
    setOpenFolder(null);
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
    fetch('/api/health-declarations')
      .then(res => res.ok ? res.json() : [])
      .then(decls => {
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
        // one per activity — the wall, a birthday, a trip — and the file has to
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
      })
      .catch(() => setHealthDecl(null));
  }, [student.id, student.name, student.status, student.healthSignedAt, parent?.phone, onUpdateStudent]);

  useEffect(() => {
    fetch('/api/form-templates')
      .then(res => res.ok ? res.json() : [])
      .then(list => {
        const active = (list || []).filter(t => t.isActive !== false);
        setFormTemplates(active);
        const def = active.find(t => t.isDefault) || active[0];
        if (def) setSelectedFormSlug(def.slug);
      })
      .catch(() => setFormTemplates([]));
  }, []);

  const selectedTemplate = formTemplates.find(t => t.slug === selectedFormSlug)
    || formTemplates.find(t => t.isDefault)
    || formTemplates[0];
  const healthPath = selectedTemplate && !selectedTemplate.isDefault
    ? `/register/${selectedTemplate.slug}`
    : '/register';
  // WhatsApp-shareable public links (never localhost)
  const healthShareUrl = buildShareHealthLink(student.id, parent?.phone, healthPath);
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
  }, [parentOnly, student.id]);

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
          const res = await fetch(`/api/public/onboard/${encodeURIComponent(decl.id)}/pdf`, {
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
    const fallbackLink = buildShareHealthLink(targetStudentId, parent?.phone, healthPath);
    try {
      const res = await fetch(`/api/leads/${encodeURIComponent(targetStudentId)}/send-health-form`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: window.location.origin,
          templateSlug: selectedTemplate?.slug || selectedFormSlug || undefined,
          // The parent whose tab is open, not the file's primary parent: the
          // message belongs in the conversation staff are actually in.
          parentId: parent?.id || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      const link = data.healthUrl || fallbackLink;
      if (!data.sent) {
        openPersonalWhatsApp(buildHealthWhatsAppText(parent.name, targetStudentName, link));
      }
      return {
        sent: !!data.sent,
        link,
        sentTo: data.sentTo || parent.name || '',
        warning: data.sent ? undefined : (data.warning || data.error || 'השליחה האוטומטית נכשלה'),
      };
    } catch {
      openPersonalWhatsApp(buildHealthWhatsAppText(parent.name, targetStudentName, fallbackLink));
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
        const formLabel = selectedTemplate
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
  const showEquipment = !parentOnly && !student.isAdult;

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
          offer: {
            type: couponDraft.type,
            value: Number(couponDraft.value) || 0,
            units: Number(couponDraft.units) || 1,
            validityDays: Number(couponDraft.validityDays) || 30,
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

  /**
   * Hand the "primary" badge to the parent whose tab is open. Primary is the
   * parent the CRM addresses by default — reminders, links, invoices.
   */
  const handleMakePrimary = async () => {
    if (!student?.id || !parent?.id || settingPrimary) return;
    setSettingPrimary(true);
    try {
      const response = await fetch(
        `/api/students/${encodeURIComponent(student.id)}/guardians/${encodeURIComponent(parent.id)}/primary`,
        { method: 'PUT' }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'עדכון ההורה הראשי נכשל');
      }
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
        body: JSON.stringify({ sendWhatsapp: true }),
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
    fetch(`/api/attendance?studentId=${encodeURIComponent(student.id)}`)
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
    fetch(`/api/students/${encodeURIComponent(student.id)}/activity-registrations`)
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
        body: JSON.stringify({ source: 'customer_card' }),
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
        const list = Array.isArray(data) ? data : [];
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
      if (!parentOnly && editFocus !== 'parent') {
        const trimmedStudentName = editStudentName.trim();
        if (!trimmedStudentName) {
          setEditError('יש למלא שם למתאמן');
          return;
        }
        const sRes = await fetch(`/api/students/${student.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: trimmedStudentName,
            birthDate: editBirthDate,
            phone: editStudentPhone.trim(),
            gender: editGender || null,
            notes: editNotes,
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
      }

      if (parent?.id && editFocus !== 'student') {
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
            source: editSource,
            notes: editNotes,
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
      setStudentPayments(
        list.filter((p) => (parent?.id && p.parent_id === parent.id) || p.student_id === student.id)
      );
    } catch (err) {
      console.error('Failed to load payments:', err);
    }
  };

  useEffect(() => {
    if (canManageBilling) loadStudentPayments();
  }, [canManageBilling, student.id, parent?.id]);

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

  const refundPayment = async (payment) => {
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
          studentId: student.id,
          parentId: parent?.id,
          studentName: student.name,
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
          studentId: student.id,
          studentName: student.name,
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

  // Which activities this student has signed for, beyond the everyday wall
  // form — a trip or a birthday is the thing staff actually look for here.
  const signedKinds = Array.from(new Map(
    studentDeclarations
      .filter((d) => isHealthDeclarationValid(d.signedDate || d.date))
      .map((d) => [declarationKind(d).key, declarationKind(d)])
  ).values());
  const extraKinds = signedKinds.filter((k) => k.key !== DEFAULT_KIND.key);
  const healthSummary = !isHealthSigned
    ? 'חסר'
    : healthExpired
      ? `פג תוקף · ${healthExpiry.toLocaleDateString('he-IL')}`
      : `חתום${healthExpiry ? ` · בתוקף עד ${healthExpiry.toLocaleDateString('he-IL')}` : ''}${
        extraKinds.length ? ` · ${extraKinds.map((k) => k.label).join(', ')}` : ''}`;
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
  const statusSummary = STATUSES[student.status]?.label || student.status || '—';
  const mailingListSummary = (() => {
    if (!parent?.id) return 'אין הורה';
    const active = broadcastListDefs.filter((list) => broadcastLists[list.key] !== false).length;
    return `${active}/${broadcastListDefs.length} רשימות`;
  })();

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
          <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-1)', lineHeight: 1.3 }}>
                  {parentDisplayName(parent) || (parentOnly ? 'ליד ללא מתאמן' : 'הורה')}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>הורה / משלם</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={() => {
                    const nextParentName = parentNameParts(parent);
                    setEditFocus('parent');
                    setEditParentName(nextParentName.firstName);
                    setEditParentLastName(nextParentName.lastName);
                    setEditParentIdNumber(parent?.idNumber || '');
                    setEditPhone(parent?.phone || '');
                    setEditEmail(parent?.email || '');
                    setEditCity(parent?.city || '');
                    setEditNotes(parent?.notes || '');
                    setEditError('');
                    setIsEditing(true);
                  }}
                  title="עריכת פרטי הורה"
                  style={{ border: '1px solid var(--border)', gap: 4 }}
                >
                  <Edit2 size={11} /> ערוך
                </button>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="סגור">
                  <X size={18} />
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
              {parent?.phone ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                  <a href={`tel:${parent.phone}`} className="btn btn-ghost btn-xs">
                    <Phone size={12} /> {parent.phone}
                  </a>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-xs"
                    title={phoneCopied ? 'הועתק' : 'העתקת המספר'}
                    aria-label="העתקת מספר הטלפון"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(parent.phone);
                        setPhoneCopied(true);
                        setTimeout(() => setPhoneCopied(false), 1500);
                      } catch { /* ignore */ }
                    }}
                  >
                    {phoneCopied ? <Check size={12} color="var(--green)" /> : <Clipboard size={12} />}
                  </button>
                </span>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>אין טלפון</span>
              )}
              {parent?.phone && (
                <a
                  href={`https://wa.me/${String(parent.phone).replace(/[^\d]/g, '').replace(/^0/, '972')}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-success btn-xs"
                >
                  וואטסאפ
                </a>
              )}
              {parent?.email && (
                <a href={`mailto:${parent.email}`} className="btn btn-ghost btn-xs">
                  <Mail size={12} /> {parent.email}
                </a>
              )}
            </div>
            {parent?.city && (
              <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 6 }}>
                <MapPin size={11} style={{ verticalAlign: -1 }} /> {parent.city}
              </div>
            )}
            {/* Parent tabs — the same idea as the child tabs below: one child,
                two parents, each with their own details, lists and conversation.
                The row stays even for a single parent, to carry "הוסף איש קשר". */}
            {(guardians.length > 1 || (!parentOnly && contactCandidates.length > 0)) && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
                {guardians.length > 1 && guardians.map((guardian) => {
                  const active = String(guardian.id) === String(parent?.id);
                  return (
                    <button
                      key={guardian.id}
                      type="button"
                      onClick={() => setActiveParentId(guardian.id)}
                      title={active ? 'ההורה המוצג' : `מעבר לפרטים ולשיחה של ${guardian.name}`}
                      style={{
                        border: active ? '1px solid rgba(56,189,248,0.65)' : '1px solid var(--border)',
                        background: active ? 'rgba(56,189,248,0.18)' : 'rgba(255,255,255,0.04)',
                        color: active ? 'var(--text-1)' : 'var(--text-2)',
                        borderRadius: 999,
                        padding: '4px 10px',
                        fontSize: 12,
                        fontWeight: active ? 700 : 600,
                        cursor: 'pointer',
                        lineHeight: 1.3,
                      }}
                    >
                      {guardian.name || 'הורה'}
                      {guardian.primary ? ' · ראשי' : ''}
                    </button>
                  );
                })}
                {/* Taking a parent off a child is a family decision, so it lives
                    in one place only: "פיצול משפחה" under עריכה. */}
                {guardians.some((g) => String(g.id) === String(parent?.id) && !g.primary) && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    style={{ border: '1px solid var(--border)' }}
                    disabled={settingPrimary}
                    title="ההורה הראשי הוא זה שאליו המערכת פונה כברירת מחדל"
                    onClick={handleMakePrimary}
                  >
                    {settingPrimary ? 'מעדכן...' : 'קבע כהורה ראשי'}
                  </button>
                )}
                {!parentOnly && contactCandidates.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    style={{ borderRadius: 999, border: '1px dashed var(--border)', gap: 4 }}
                    title="הורה שני, סבתא או מטפלת — איש קשר בתיק, בלי לפתוח כרטיס מתאמן"
                    onClick={openAddContact}
                  >
                    <Plus size={12} /> הוסף איש קשר
                  </button>
                )}
              </div>
            )}
          </div>

          <div
            ref={foldersScrollRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              overscrollBehavior: 'contain',
              padding: '12px 14px 16px',
              minHeight: 0,
            }}
          >
            {/* Parent-level sections — above child tabs */}
            {parent?.id && (
              <div style={{ marginBottom: 12 }}>
                <FolderRow
                  id="mailing"
                  title="רשימות תפוצה"
                  icon={Bell}
                  accent="#FBBF24"
                  summary={mailingListSummary}
                  open={openFolder === 'mailing'}
                  onToggle={toggleFolder}
                >
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
                </FolderRow>

                {canManageBilling && (
                  <FolderRow
                    id="payments"
                    title="תשלומים"
                    icon={CreditCard}
                    accent="#34D399"
                    summary={paymentsSummary}
                    open={openFolder === 'payments'}
                    onToggle={toggleFolder}
                  >
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => setShowPaymentModal(true)}
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
                                  {p.icount_doc_app_url && (
                                    <a
                                      className="btn btn-ghost btn-xs"
                                      href={p.icount_doc_app_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      title="לזיכוי חלקי — פותחים את המסמך במערכת החיוב"
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
                  </FolderRow>
                )}
              </div>
            )}

            {/* Household trainee chips — one row for the adults, one for the children.
                Order stays put when someone else is selected or a parent tab changes. */}
            {(() => {
              const ordered = [...siblings].sort(compareTraineeChips);
              const adultChips = ordered.filter((sib) => sib.isAdult);
              const childChips = ordered.filter((sib) => !sib.isAdult);
              const renderChip = (sib) => {
                const active = !parentOnly && sib.id === student.id;
                const gLabel = genderLabel(sib.gender);
                return (
                  <button
                    key={sib.id}
                    type="button"
                    onClick={() => onSelectSibling?.(sib.id)}
                    title={[
                      'החלפת תיק מתאמן — השיחה מימין לא משתנה',
                      gLabel !== '—' ? gLabel : null,
                      sib.isAdult ? 'מבוגר' : null,
                    ].filter(Boolean).join(' · ')}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      border: active
                        ? '1px solid rgba(249, 115, 22, 0.65)'
                        : '1px solid var(--border)',
                      background: active
                        ? 'rgba(249, 115, 22, 0.18)'
                        : 'rgba(255,255,255,0.04)',
                      color: active ? 'var(--text-1)' : 'var(--text-2)',
                      borderRadius: 999,
                      padding: '4px 10px',
                      fontSize: 12,
                      fontWeight: active ? 700 : 600,
                      cursor: 'pointer',
                      lineHeight: 1.3,
                      maxWidth: '100%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <GenderMark gender={sib.gender} size={12} />
                    {sib.isAdult && <AdultMark size={12} />}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {sib.name}
                    </span>
                  </button>
                );
              };
              const rowStyle = { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' };
              return (
                <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {adultChips.length > 0 && (
                    <div style={rowStyle}>{adultChips.map(renderChip)}</div>
                  )}
                  <div style={rowStyle}>
                    {childChips.map(renderChip)}
                    {parent?.id && (
                      <button
                        type="button"
                        className={`btn btn-xs ${parentOnly ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => {
                          setAddChildError('');
                          setNewChildName('');
                          setSendHealthOnAdd(true);
                          setShowAddChild(true);
                        }}
                        style={{
                          borderRadius: 999,
                          border: parentOnly ? undefined : '1px dashed var(--border)',
                          gap: 4,
                        }}
                      >
                        <Plus size={12} /> הוסף ילד / מתאמן
                      </button>
                    )}
                  </div>
                  {parentOnly && (
                    <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                      אין מתאמן רשום עדיין
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Selected child details — compact inline rows */}
            {!parentOnly && (() => {
              const streak = consecutiveAbsences(attendanceHistory);
              const streakColor = streak >= 2 ? '#F87171' : streak === 1 ? '#FBBF24' : 'var(--text-1)';
              const detailRow = (label, value, valueStyle = {}) => (
                <div
                  key={label}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    padding: '5px 0',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    fontSize: 12,
                  }}
                >
                  <span style={{ color: 'var(--text-3)', flexShrink: 0 }}>{label}</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-1)', textAlign: 'left', ...valueStyle }}>{value}</span>
                </div>
              );
              return (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    {/* מימין לשם ב־RTL: האייקונים לפני הטקסט ב־DOM */}
                    <DeclarationIcons
                      status={studentDeclarationStatus(studentDeclarations, student, parent?.phone)}
                      validOnly
                      size={15}
                      onClick={() => toggleFolder('health')}
                    />
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>
                      {student.name}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => {
                      setEditFocus('student');
                      setEditStudentName(student.name || '');
                      setEditBirthDate(student.birthDate || '');
                      setEditStudentPhone(student.phone || '');
                      setEditGender(student.gender || '');
                      setEditNotes(student.notes || '');
                      setEditNextFollowup(student.nextFollowup || '');
                      setEditGroupIds(studentGroupIds(student));
                      setEditError('');
                      setIsEditing(true);
                    }}
                    style={{ borderRadius: 999, border: '1px solid var(--border)', gap: 4, flexShrink: 0 }}
                  >
                    <Edit2 size={11} /> ערוך
                  </button>
                </div>

                <div>
                  {detailRow('גיל', ageWithGenderLabel(student.birthDate, student.gender))}
                  {detailRow('טלפון', student.phone || '—')}
                  {(() => {
                    const topLevel = highestPassedLevel(levelTestsHistory) || student.levelGrade || null;
                    const gradeTint = topLevel ? levelColor(topLevel) : null;
                    return detailRow(
                      'מבחן רמה',
                      topLevel ? (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          color: gradeTint || 'var(--text-1)',
                          fontWeight: 900,
                        }}>
                          <Award size={13} strokeWidth={2.4} />
                          {topLevel}
                        </span>
                      ) : '—',
                      topLevel ? { color: gradeTint || undefined } : {}
                    );
                  })()}
                  {(() => {
                    const safety = punchSafety || safetyTestStatus(levelTestsHistory);
                    const tone = SAFETY_TONE[safety.state] || SAFETY_TONE.missing;
                    let expiryText = '';
                    if (safety.state === 'valid' && safety.expires_at) {
                      const day = safety.expires_at instanceof Date
                        ? safety.expires_at
                        : new Date(`${String(safety.expires_at).slice(0, 10)}T12:00:00`);
                      if (!Number.isNaN(day.getTime())) {
                        expiryText = ` עד ${day.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })}`;
                      }
                    }
                    const label = safety.state === 'valid'
                      ? `בתוקף${expiryText}`
                      : tone.label;
                    const SafetyIcon = tone.alert ? ShieldAlert : ShieldCheck;
                    return detailRow(
                      'מבחן בטיחות',
                      <button
                        type="button"
                        onClick={() => toggleFolder('tests')}
                        title="פתיחת תיקיית מבחנים"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          height: 24,
                          padding: '0 8px',
                          borderRadius: 999,
                          background: tone.bg,
                          border: `1px solid ${tone.color}${tone.alert ? 'AA' : '55'}`,
                          color: tone.color,
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        <SafetyIcon size={13} strokeWidth={2.5} />
                        {label}
                      </button>
                    );
                  })()}
                  {detailRow(
                    'העדרויות רצופות',
                    attendanceLoading ? '…' : streak,
                    { color: streakColor }
                  )}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      padding: '5px 0',
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
              </div>
              );
            })()}

            {/* Selected child folders */}
            {!parentOnly && (
              <>
            <FolderRow
              id="health"
              title={FORM_FOLDER}
              icon={FileCheck2}
              accent="#F472B6"
              summary={healthSummary}
              summaryColor={isHealthSigned && !healthExpired ? '#34D399' : '#FCD34D'}
              open={openFolder === 'health'}
              onToggle={toggleFolder}
            >
              {(() => {
                // A doctor's approval hangs off the same declaration but is not
                // the declaration: counting it as one would hide the fact that
                // the signed form itself is still missing.
                const isClearanceDoc = (doc) => doc.type === 'medical_clearance';
                const isHealthDoc = (doc) => !isClearanceDoc(doc)
                  && (doc.isVirtual || doc.type === 'health_waiver_pdf' || !!doc.declarationId);
                // Which activity a row belongs to. A stored document knows only
                // its declaration id, so the activity is read off the
                // declaration it hangs from.
                const kindForDoc = (doc) => {
                  const decl = doc.virtualData
                    || studentDeclarations.find((d) => d.id === doc.declarationId)
                    || null;
                  return decl ? declarationKind(decl) : null;
                };
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
                    fileName: FORM_SIGNED_ROW,
                    created_at: decl.signedAt || decl.signedDate || decl.date || decl.createdAt || Date.now(),
                    type: 'health_waiver_pdf',
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
                    fileName: FORM_SIGNED_ROW,
                    created_at: student.healthSignedAt || student.waiverSignedAt || Date.now(),
                    type: 'health_waiver_pdf',
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
                // Renewal banner when nothing is signed, or the signature expired
                const showUnsignedControls = healthExpired || (!isHealthSigned && !hasHealthDoc);
                // Form-type picker + send stay available even after a signature —
                // a family may still need the trip or activity form.
                const canSendForm = !!parent?.phone;

                const handleDownloadDoc = async (doc) => {
                  const source = doc.virtualData || healthDecl;
                  if (doc.isVirtual || (!doc.id || String(doc.id).startsWith('virtual_'))) {
                    if (!source) {
                      setHealthSendMsg('האישור עדיין נטען — נסו שוב בעוד רגע');
                      return;
                    }
                    setDownloadingPdf(true);
                    setHealthSendMsg('');
                    try {
                      await downloadHealthDeclarationPdf(source);
                      setHealthSendMsg('קובץ האישור החתום הורד למחשב');
                    } catch (err) {
                      console.error(err);
                      setHealthSendMsg('שגיאה בהורדת האישור');
                    } finally {
                      setDownloadingPdf(false);
                    }
                    return;
                  }
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
                    setHealthSendMsg('קובץ האישור החתום הורד למחשב');
                  } catch (err) {
                    console.error(err);
                    setHealthSendMsg('שגיאה בהורדת המסמך מהתיק');
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
                    setHealthSendMsg(healthRow ? `${FORM_SHORT} נמחק מהתיק` : 'המסמך נמחק מהתיק');
                  } catch (err) {
                    console.error(err);
                    setHealthSendMsg(err.message === 'delete failed' ? 'מחיקת המסמך נכשלה' : (err.message || 'מחיקת המסמך נכשלה'));
                  } finally {
                    setDeletingDocId('');
                  }
                };

                return (
                  <>
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
                          <button
                            type="button"
                            className="btn btn-success btn-xs"
                            disabled={sendingHealth || !canSendForm}
                            onClick={() => setShowHealthSendModal(true)}
                          >
                            <Send size={12} /> שלח הצהרה
                          </button>
                          {parentOnly && healthExpired && healthDecl && (
                            <button
                              type="button"
                              className="btn btn-primary btn-xs"
                              disabled={downloadingPdf}
                              onClick={() => handleDownloadDoc({ isVirtual: true, virtualData: healthDecl })}
                            >
                              <Download size={12} /> {downloadingPdf ? 'מכין...' : 'הורדה'}
                            </button>
                          )}
                        </div>
                      </>
                    )}

                    {!showUnsignedControls && (
                      <>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn btn-success btn-xs"
                            disabled={sendingHealth || !canSendForm}
                            onClick={() => setShowHealthSendModal(true)}
                          >
                            <Send size={12} /> שלח הצהרה
                          </button>
                          {parentOnly && isHealthSigned && !healthExpired && (
                            <button
                              type="button"
                              className="btn btn-primary btn-xs"
                              disabled={downloadingPdf || !healthDecl}
                              onClick={async () => {
                                if (!healthDecl) return;
                                setDownloadingPdf(true);
                                setHealthSendMsg('');
                                try {
                                  await downloadHealthDeclarationPdf(healthDecl);
                                  setHealthSendMsg('קובץ האישור החתום הורד למחשב');
                                } catch (err) {
                                  console.error(err);
                                  setHealthSendMsg('שגיאה בהורדת האישור');
                                } finally {
                                  setDownloadingPdf(false);
                                }
                              }}
                            >
                              <Download size={12} /> {downloadingPdf ? 'מכין...' : 'הורדה'}
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
                        {docsLoading && !hasHealthDoc ? (
                          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>טוען...</div>
                        ) : combinedDocuments.length === 0 ? (
                          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                            עדיין אין קבצים בתיק. אחרי השלמת טופס החתימה יישמר כאן קובץ אישור.
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {combinedDocuments.map((doc) => {
                              const healthRow = isHealthDoc(doc);
                              const clearanceRow = isClearanceDoc(doc);
                              const kind = kindForDoc(doc);
                              const busy = deletingDocId === doc.id;
                              const title = clearanceRow ? 'אישור רופא' : (kind?.label || FORM_SHORT);
                              const stamp = doc.created_at ? new Date(doc.created_at) : null;
                              return (
                                <div
                                  key={doc.id}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap',
                                    padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)',
                                    background: 'rgba(255,255,255,0.03)', opacity: busy ? 0.5 : 1,
                                    overflowX: 'auto',
                                  }}
                                >
                                  {kind && !clearanceRow ? (
                                    <span
                                      className={`badge ${kind.badge}`}
                                      title={doc.fileName || kind.label}
                                      style={{
                                        height: 32, padding: '0 10px', boxSizing: 'border-box',
                                        fontSize: 12, lineHeight: 1, flexShrink: 0,
                                        display: 'inline-flex', alignItems: 'center', gap: 5,
                                      }}
                                    >
                                      <kind.Icon size={13} style={{ flexShrink: 0 }} />
                                      {kind.label}
                                    </span>
                                  ) : (
                                    <span
                                      title={doc.fileName || title}
                                      style={{
                                        height: 32, fontSize: 12, fontWeight: 600, lineHeight: 1,
                                        color: 'var(--text-1)', whiteSpace: 'nowrap', flexShrink: 0,
                                        display: 'inline-flex', alignItems: 'center',
                                      }}
                                    >
                                      {title}
                                    </span>
                                  )}
                                  {healthRow && healthExpired && (
                                    <span className="badge badge-amber" style={{ height: 32, fontSize: 11, lineHeight: 1, flexShrink: 0 }}>פג תוקף</span>
                                  )}
                                  <span style={{
                                    height: 32, fontSize: 12, fontWeight: 500, lineHeight: 1,
                                    color: 'var(--text-2)', whiteSpace: 'nowrap', flexShrink: 0,
                                    display: 'inline-flex', alignItems: 'center',
                                  }}>
                                    {stamp
                                      ? `${stamp.toLocaleDateString('he-IL')} · ${stamp.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`
                                      : ''}
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
                                      disabled={busy || downloadingPdf || (doc.isVirtual && !(doc.virtualData || healthDecl))}
                                      onClick={() => handleDownloadDoc(doc)}
                                    >
                                      <Download size={13} /> {downloadingPdf ? 'מכין...' : 'הורדה'}
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-xs"
                                      style={{
                                        width: 32, height: 32, padding: 0, boxSizing: 'border-box',
                                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                        color: 'var(--red, #F87171)',
                                      }}
                                      title={healthRow ? `מחיקת ${FORM_SHORT} מהתיק` : 'מחיקת המסמך מהתיק'}
                                      disabled={busy || !!deletingDocId}
                                      onClick={() => {
                                        setDeleteConfirmText('');
                                        setPendingDocDelete({ doc, healthRow });
                                      }}
                                    >
                                      <Trash2 size={13} />
                                    </button>
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
                              {pendingDocDelete.healthRow ? `מחיקת ${FORM_SHORT}` : 'מחיקת מסמך'}
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
                                ? `${FORM_SHORT} של ${student.name || 'המתאמן'} יימחק מהתיק יחד עם הקבצים ששמורים תחתיו, והמתאמן יסומן שוב כמי שטרם חתם.`
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
                                    handleDeleteDoc(pendingDocDelete.doc);
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
                              onClick={() => handleDeleteDoc(pendingDocDelete.doc)}
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
            </FolderRow>

            {/* Group folder */}
            {!parentOnly && (
              <FolderRow
                id="group"
                title="חוג ושיוך"
                icon={Users}
                accent="#A78BFA"
                summary={groupSummary}
                open={openFolder === 'group'}
                onToggle={toggleFolder}
              >
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
              </FolderRow>
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
              >
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
              </FolderRow>
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
            >
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
                          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                            קוד <strong style={{ fontFamily: 'monospace' }}>{coupon.code}</strong>
                            {coupon.expires_at
                              ? coupon.state === 'expired'
                                ? ` · פג ב-${coupon.expires_at}`
                                : ` · בתוקף עד ${coupon.expires_at}`
                              : ''}
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
                      {couponExpiryPreview(couponDraft.validityDays) || 'בלי תוקף'}
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
                    <Gift size={13} /> הנפקת הטבה ידנית
                  </button>
                )}
              </div>
            </FolderRow>

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
            >
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
            </FolderRow>

            {/* Equipment folder — kids only */}
            {showEquipment && (
              <FolderRow
                id="equipment"
                title="ציוד לאימונים"
                icon={Package}
                accent="#A3E635"
                summary={equipmentSummary}
                open={openFolder === 'equipment'}
                onToggle={toggleFolder}
              >
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
                        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
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
              </FolderRow>
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
              >
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
              </FolderRow>
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
              >
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
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
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
                          <span className="badge badge-gray">{row.status_label || row.status || '—'}</span>
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
              </FolderRow>
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
              >
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
              </FolderRow>
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
            >
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
            </FolderRow>
              </>
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
              parent={parent}
              student={student}
              fillHeight
              onHandled={onCommunicationHandled}
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
          title="שליחת הצהרה בוואטסאפ"
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
                disabled={sendingHealth || !parent?.phone || !selectedTemplate}
                onClick={handleSendHealthForm}
              >
                <Send size={15} /> {sendingHealth ? 'שולח...' : 'שלח בוואטסאפ'}
              </button>
            </>
          )}
        >
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">איזה טופס לשלוח?</label>
            {formTemplates.length > 0 ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
            ) : (
              <div className="alert alert-warn">לא נמצאו טפסים פעילים לשליחה.</div>
            )}
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-3)' }}>
              הקישור יישלח בוואטסאפ אל {parentDisplayName(parent)} · {parent?.phone}
            </div>
          </div>
        </Modal>
      )}

      {showAddChild && (
        <Modal
          title="הוספת ילד / מתאמן"
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
                  : (sendHealthOnAdd ? `הוסף ושלח ${FORM_SHORT}` : 'הוסף')}
              </button>
            </>
          }
        >
          <form id="add-child-form" onSubmit={handleAddChild} className="form-grid">
            <div className="form-group">
              <label className="form-label">שם המתאמן *</label>
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
        <Modal title={editFocus === 'parent' ? `עריכת הורה: ${parentDisplayName(parent)}` : `עריכת מתאמן: ${student.name}`} onClose={() => setIsEditing(false)}
          footer={
            <><button className="btn btn-ghost" onClick={() => setIsEditing(false)}>ביטול</button>
              <button className="btn btn-primary" disabled={savingEdit} onClick={handleUpdateDetails}>
                <Check size={15} /> {savingEdit ? 'שומר...' : 'שמור שינויים'}
              </button></>
          }
        >
          <div className="form-grid">
            {editError && (
              <div className="alert alert-warn" style={{ marginBottom: 4 }}>{editError}</div>
            )}
            {(editFocus === 'student' && !parentOnly) && (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)', marginBottom: 4 }}>פרטי המתאמן</div>
                <div className="form-group">
                  <label className="form-label">שם</label>
                  <input
                    className="input"
                    autoFocus
                    value={editStudentName}
                    onChange={(e) => setEditStudentName(e.target.value)}
                  />
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
            <div className="form-group">
              <label className="form-label">הערות מעקב</label>
              <textarea
                className="input"
                style={{ minHeight: 80 }}
                placeholder="הערות פנימיות לצוות"
                value={editNotes}
                onChange={e => setEditNotes(e.target.value)}
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
                    value={editNotes}
                    onChange={e => setEditNotes(e.target.value)}
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
          title="דרישת תשלום / חשבונית"
          onClose={() => setShowPaymentModal(false)}
          footer={
            <button className="btn btn-ghost" onClick={() => setShowPaymentModal(false)}>סגור</button>
          }
        >
          <form onSubmit={handleSendPayment}>
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
  // The whole declaration feed, so the table can mark each climber without
  // opening their file. One fetch for the list, not one per row.
  const [declarations, setDeclarations] = useState([]);

  useEffect(() => {
    fetch('/api/health-declarations')
      .then(res => res.ok ? res.json() : [])
      .then(list => setDeclarations(Array.isArray(list) ? list : []))
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

  const refreshData = async () => {
    try {
      const [studentsResponse, parentsResponse] = await Promise.all([
        fetch('/api/students'),
        fetch('/api/parents'),
      ]);
      if (!studentsResponse.ok || !parentsResponse.ok) return;
      const [freshStudents, freshParents] = await Promise.all([
        studentsResponse.json(),
        parentsResponse.json(),
      ]);
      if (!Array.isArray(freshStudents) || !Array.isArray(freshParents)) return;
      setStudents(freshStudents);
      setParents(freshParents);
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

  // The archive tab is the only place archived customers surface — except in
  // the waiting queue. An archived customer who writes still gets an answer
  // from the bot, so leaving them out of the queue hides a live conversation
  // from the team: the queue is about an unanswered message, not about status.
  const showArchived = filterStatus === 'archived';
  const leadEntries = buildLeadEntries(students, parents, {
    includeArchived: showArchived || filterStatus === 'communication',
  });

  const filtered = leadEntries.filter(({ student: s, parent: p }) => {
    const parent = p || parents.find((x) => x.id === s.parentId);
    const matchSearch = (s.name || '').toLowerCase().includes(search.toLowerCase()) ||
      parent?.name?.toLowerCase().includes(search.toLowerCase()) ||
      (parent?.phone || '').includes(search);
    const matchStatus = showArchived
      ? isArchivedParent(parent)
      : filterStatus === 'all'
        || (filterStatus === 'communication'
          ? isAwaitingHandling(parent, [s])
          : s.status === filterStatus);
    return matchSearch && matchStatus;
  }).map((entry) => entry.student);

  // Table: one row per family. Kanban stays per-student for the funnel.
  const familyRows = buildFamilyRows(filtered, parents, students);
  if (filterStatus === 'communication') {
    // Newest first, counting a fresh registration as well as an inbound
    // message — otherwise a family who just signed sorts to the bottom.
    // Either parent's message counts: the row stands for the whole household.
    const rowAwaitingSince = (row) => Math.max(
      ...(row.parents?.length ? row.parents : [row.parent])
        .map((parent) => awaitingSince(parent, row.students))
    );
    familyRows.sort((a, b) => rowAwaitingSince(b) - rowAwaitingSince(a));
  }
  const familyCountByStatus = (() => {
    const map = {
      all: buildFamilyRows(leadEntries.map((e) => e.student), parents, students).length,
      // Counted off its own archive-inclusive list, so the badge shows the same
      // number whichever tab happens to be open.
      communication: buildFamilyRows(
        buildLeadEntries(students, parents, { includeArchived: true })
          .filter(({ parent, student }) => isAwaitingHandling(parent, [student]))
          .map(({ student }) => student),
        parents,
        students
      ).length,
    };
    for (const key of Object.keys(STATUSES)) {
      if (key === 'archived') continue;
      const matching = leadEntries.filter((e) => e.student.status === key).map((e) => e.student);
      map[key] = buildFamilyRows(matching, parents, students).length;
    }
    map.archived = buildFamilyRows(
      buildLeadEntries(students, parents, { includeArchived: true })
        .filter(({ parent }) => isArchivedParent(parent))
        .map((e) => e.student),
      parents,
      students
    ).length;
    return map;
  })();

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
          parents={parents}
          siblings={selectedSiblings}
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
          onCommunicationHandled={applyHandledParents}
        />
      )}

      {showAddModal && (
        <AddLeadModal students={students} parents={parents} onAdd={handleAdd} onClose={() => setShowAddModal(false)} />
      )}

      {/* Toolbar */}
      <div className="section-header">
        <div>
          <div className="section-title">מאגר לקוחות ולידים</div>
          <div className="section-sub">{leadEntries.length} רשומות סה"כ</div>
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
          הכל ({familyCountByStatus.all})
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
          <button
            className="btn btn-sm btn-success"
            style={{ marginInlineStart: 'auto', gap: 6 }}
            disabled={markingAllHandled}
            onClick={handleMarkAllHandled}
          >
            <Check size={13} /> {markingAllHandled ? 'מסמן את כולם...' : 'סמן את כולם כטופלו'}
          </button>
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
              {familyRows.map((family) => {
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
                          <a href={`https://wa.me/972${parent?.phone?.replace(/^0/, '').replace(/[-\s]/g, '')}`}
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
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
}
