import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveMessages } from '../hooks/useLiveMessages.js';
import {
  Send,
  MessageCircle,
  Image as ImageIcon,
  FileText,
  Bookmark,
  RefreshCw,
  CheckCircle2,
  Bot,
  PowerOff,
  ChevronDown,
  Sparkles,
  Archive,
  ArchiveRestore,
  ExternalLink,
  Pencil,
  ThumbsUp,
  ThumbsDown,
  UserCheck,
  UserX,
  Clock,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { normalizeTemplateVariables, buildPrefillValues } from './templateVariables.js';
import { SUGGESTED_TEMPLATE_TAGS, templateTagStyle } from './templateTags.js';
import { isAwaitingHandling, threadIsBehindCard } from './communicationQueue.js';
import AppSelect from './AppSelect.jsx';

const CHANNEL_LABELS = {
  whatsapp: 'וואטסאפ',
  instagram: 'אינסטגרם',
  messenger: 'מסנג׳ר',
};

const SERVER_DOWN_MESSAGE = 'השרת לא זמין כרגע. ההודעה לא נשלחה — נסו שוב בעוד רגע';

const CHANNEL_COLORS = {
  whatsapp: 'rgba(37,211,102,0.14)',
  instagram: 'rgba(225,48,108,0.14)',
  messenger: 'rgba(0,132,255,0.14)',
};

function LinkifiedMessage({ text }) {
  const value = String(text || '(ללא תוכן)');
  const parts = value.split(/(https?:\/\/[^\s]+)/giu);
  return parts.map((part, index) => {
    if (!/^https?:\/\//iu.test(part)) return <React.Fragment key={`${index}-${part}`}>{part}</React.Fragment>;
    const match = part.match(/^(.*?)([.,;:!?)}\]׳״]*)$/u);
    const href = match?.[1] || part;
    const suffix = match?.[2] || '';
    return (
      <React.Fragment key={`${index}-${part}`}>
        <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#7dd3fc', textDecoration: 'underline' }}>
          {href}
        </a>
        {suffix}
      </React.Fragment>
    );
  });
}

// The local calendar day a message belongs to. Not the ISO date — that one
// flips at UTC midnight and would cut an evening conversation in two.
function messageDayKey(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function messageDayLabel(value) {
  const d = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (messageDayKey(d) === messageDayKey(today)) return 'היום';
  if (messageDayKey(d) === messageDayKey(yesterday)) return 'אתמול';
  const opts = { weekday: 'long', day: 'numeric', month: 'numeric' };
  if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('he-IL', opts);
}

function phonesMatchClient(a, b) {
  const digits = (p) => String(p || '').replace(/[^\d]/g, '');
  let na = digits(a);
  let nb = digits(b);
  if (!na || !nb) return false;
  if (na.startsWith('0') && na.length >= 9) na = `972${na.slice(1)}`;
  if (nb.startsWith('0') && nb.length >= 9) nb = `972${nb.slice(1)}`;
  if (na === nb) return true;
  return na.slice(-9).length === 9 && na.slice(-9) === nb.slice(-9);
}

const WINDOW_BADGE_STYLE = {
  fontSize: 11,
  height: 30,
  padding: '0 8px',
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-2)',
  whiteSpace: 'nowrap',
};

function windowTone(open) {
  return open ? '#34D399' : '#F87171';
}

function WindowBadge({ windows, channel }) {
  const w = windows?.[channel];
  if (!w) return null;
  return (
    <span style={WINDOW_BADGE_STYLE} title={`${CHANNEL_LABELS[channel]}: ${w.label}`}>
      <MessageCircle size={14} style={{ color: windowTone(w.open), flexShrink: 0 }} />
      <span>{w.label}</span>
    </span>
  );
}

const CONTACT_SYNC_TONES = {
  synced: '#34D399',
  missing: '#FBBF24',
  stale: '#FBBF24',
  no_phone: '#94A3B8',
  not_connected: '#94A3B8',
  error: '#F87171',
};

const CONTACT_SYNC_SHORT = {
  synced: 'איש קשר מסונכרן',
  missing: 'ממתין לסנכרון',
  stale: 'ממתין לעדכון',
  no_phone: 'אין מספר לסנכרון',
  not_connected: 'אנשי קשר: לא מחובר',
  error: 'בדיקת סנכרון נכשלה',
};

function contactSyncTitle(info) {
  const lines = [];
  if (info.expectedName) lines.push(`השם בטלפון: ${info.expectedName}`);
  if (info.state === 'stale' && info.currentName) lines.push(`כרגע בגוגל: ${info.currentName}`);
  if (info.state === 'missing') lines.push('הלקוח עדיין לא נוצר באנשי הקשר');
  if (info.state === 'no_phone') lines.push('אין מספר תקין, ולכן הלקוח לא נכנס לאנשי הקשר');
  if (info.state === 'error' && info.error) lines.push(info.error);
  if (info.lastSyncAt) lines.push(`סנכרון אחרון: ${new Date(info.lastSyncAt).toLocaleString('he-IL')}`);
  lines.push('לחיצה בודקת מחדש מול גוגל');
  return lines.join('\n');
}

/** Does this customer sit in the phone's address book under the agreed name. */
function ContactSyncBadge({ parentId }) {
  const [info, setInfo] = useState(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async (refresh) => {
    if (!parentId) return;
    setChecking(true);
    try {
      const res = await fetch(
        `/api/google-contacts/contact-status?key=parent:${encodeURIComponent(parentId)}${refresh ? '&refresh=1' : ''}`
      );
      const json = await res.json().catch(() => null);
      setInfo(json?.state ? json : null);
    } catch {
      setInfo(null);
    } finally {
      setChecking(false);
    }
  }, [parentId]);

  useEffect(() => {
    setInfo(null);
    check(false);
  }, [check]);

  // Without Google keys on the server the whole feature is off — stay silent.
  if (!info || info.state === 'not_configured') return null;
  const iconColor = CONTACT_SYNC_TONES[info.state] || CONTACT_SYNC_TONES.error;
  const Icon = info.state === 'synced'
    ? UserCheck
    : info.state === 'missing' || info.state === 'stale'
      ? Clock
      : UserX;

  return (
    <button
      type="button"
      onClick={() => check(true)}
      disabled={checking}
      title={contactSyncTitle(info)}
      aria-label={checking ? 'בודק סנכרון איש קשר' : CONTACT_SYNC_SHORT[info.state] || info.label}
      style={{
        ...WINDOW_BADGE_STYLE,
        width: 30,
        padding: 0,
        justifyContent: 'center',
        cursor: checking ? 'default' : 'pointer',
      }}
    >
      <Icon size={14} style={{ color: iconColor, flexShrink: 0 }} />
    </button>
  );
}

function ThreadWindowBadge({ thread, channel }) {
  if (channel === 'whatsapp' && thread?.window) {
    return (
      <span style={WINDOW_BADGE_STYLE} title={`וואטסאפ: ${thread.window.label}`}>
        <MessageCircle size={14} style={{ color: windowTone(!!thread.window.open), flexShrink: 0 }} />
        <span>{thread.window.label}</span>
      </span>
    );
  }
  return null;
}

/** "1:47 שע׳" for a long pause, "47 דק׳" for a short one. */
export function formatPauseLeft(until, now = Date.now()) {
  const ms = new Date(until || 0).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `${minutes} דק׳`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')} שע׳`;
}

const PAUSE_REASONS = {
  handoff: 'אחרי שהלקוח ביקש לדבר עם אדם',
  human_reply: 'אחרי שענית ללקוח',
  manual: 'ידנית על ידי הצוות',
};

/** Timed mute choices on the bot badge menu. */
const BOT_PAUSE_OPTIONS = [
  { minutes: 10, label: 'השתקה ל־10 דקות' },
  { minutes: 60, label: 'השתקה לשעה' },
  { minutes: 60 * 4, label: 'השתקה ל־4 שעות' },
  { minutes: 60 * 24, label: 'השתקה ליום' },
];

/**
 * Every reason the bot is silent for this customer, worst first. Each one
 * carries the way out of it, so the badge is never a dead end: a system-wide
 * switch and a per-customer mute are separate blocks that need separate fixes.
 */
export function describeBotBlocks(bot, now = Date.now()) {
  if (!bot) return [];
  const blocks = [];

  if (bot.globallyOff) {
    blocks.push({
      kind: 'global',
      label: 'כבוי לכל הלקוחות',
      reason: 'המתג הראשי במסך ההגדרות כבוי, כך שהבוט לא עונה לאף לקוח.',
      action: 'enable-global',
      actionLabel: 'הדלקת הבוט לכל הלקוחות',
    });
  }

  if (bot.status === 'opted_out') {
    blocks.push({
      kind: 'customer',
      label: bot.source === 'crm' ? 'כבוי קבוע' : 'מנותק — הלקוח ביקש',
      reason: bot.source === 'crm'
        ? 'הבוט כבוי באופן קבוע ללקוח הזה — עד שתחזירו אותו כאן.'
        : 'הלקוח כתב מילת עצירה בוואטסאפ, ולכן הבוט לא יפנה אליו יותר.',
      action: 'resume',
      actionLabel: 'החזרת הבוט ללקוח',
    });
  } else if (bot.status === 'staff_thread') {
    // No pause row behind this one — the bot stands down because the last
    // outbound was written by a person. It used to show up as "בוט פעיל",
    // which read as "the bot will answer" while it answered nothing.
    blocks.push({
      kind: 'customer',
      label: 'ממתין · הצוות בשיחה',
      reason: 'ההודעה האחרונה ללקוח נשלחה בידי אדם, ולכן הבוט לא נכנס לשיחה. '
        + 'הוא יחזור לענות מעצמו כשהוא ישלח את ההודעה הבאה — או עכשיו, בלחיצה.',
      action: 'resume',
      actionLabel: 'החזרת הבוט לשיחה',
    });
  } else if (bot.status === 'paused') {
    // The pause can lapse between polls — an expired one is not a block.
    const left = formatPauseLeft(bot.until, now);
    if (left) {
      blocks.push({
        kind: 'customer',
        label: `מושתק · עוד ${left}`,
        reason: bot.reason === 'manual'
        ? `הבוט הושתק ידנית ללקוח הזה, ויחזור לענות בעוד ${left}.`
        : `הבוט הושתק אוטומטית ${PAUSE_REASONS[bot.reason] || 'אחרי טיפול אנושי'}, ויחזור לענות בעוד ${left}.`,
        action: 'resume',
        actionLabel: 'החזרת הבוט עכשיו',
      });
    }
  }

  return blocks;
}

export function describeBotBadge(bot, now = Date.now()) {
  if (!bot) return null;
  const blocks = describeBotBlocks(bot, now);
  if (!blocks.length) {
    return {
      icon: Bot,
      label: 'בוט פעיל',
      tone: 'active',
      action: null,
      actionLabel: 'ניהול הבוט ללקוח זה',
      blocks,
      canResume: false,
      canPause: true,
      canMutePermanent: true,
    };
  }
  const [first] = blocks;
  const customerBlock = blocks.find((b) => b.kind === 'customer');
  return {
    icon: PowerOff,
    // Two blocks at once ("כבוי במערכת" + "מושתק ללקוח") — say so, don't pick one.
    label: blocks.length > 1
      ? `בוט ${first.label} · וגם ${blocks[1].label}`
      : `בוט ${first.label}`,
    tone: first.kind === 'global' ? 'off' : 'paused',
    action: first.action,
    actionLabel: 'ניהול הבוט ללקוח זה',
    blocks,
    canResume: !!customerBlock,
    canPause: true,
    canMutePermanent: bot.status !== 'opted_out',
  };
}

const BOT_TONES = {
  active: '#34D399',
  paused: '#FBBF24',
  off: '#94A3B8',
};

function messageMatchesThread(message, thread, parentPhone) {
  if (!thread) return true;
  const ch = message.channel || 'whatsapp';
  if (thread.role === 'parent') {
    if (ch !== 'whatsapp') return true;
    if (message.student_id || message.fromChild) return false;
    if (!thread.phone) return !message.phone || phonesMatchClient(message.phone, parentPhone);
    return !message.phone || phonesMatchClient(message.phone, thread.phone) || phonesMatchClient(message.phone, parentPhone);
  }
  // Child thread — WhatsApp only, matching that student's phone / id
  if (ch !== 'whatsapp') return false;
  if (message.student_id && thread.studentId) {
    return String(message.student_id) === String(thread.studentId);
  }
  return phonesMatchClient(message.phone, thread.phone);
}

// These lists are shared by every conversation. Keeping them at module scope
// prevents two identical API round trips each time staff move to another
// customer, while the conversation itself can still refresh normally.
let approvedTemplatesCache = null;
let savedRepliesCache = null;
let composerResourcesPromise = null;
const conversationCache = new Map();

async function loadComposerResources() {
  if (Array.isArray(approvedTemplatesCache) && Array.isArray(savedRepliesCache)) {
    return { templates: approvedTemplatesCache, savedReplies: savedRepliesCache };
  }
  if (!composerResourcesPromise) {
    composerResourcesPromise = Promise.all([
      fetch('/api/message-templates?approved=1&archived=1')
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
      fetch('/api/saved-replies')
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
    ]).then(([templates, savedReplies]) => {
      if (Array.isArray(templates)) approvedTemplatesCache = templates;
      if (Array.isArray(savedReplies)) savedRepliesCache = savedReplies;
      return { templates, savedReplies };
    }).finally(() => {
      composerResourcesPromise = null;
    });
  }
  return composerResourcesPromise;
}

export default function ConversationPanel({ parent, student, selectedThreadId = 'parent', fillHeight = false, onClose, onHandled, onConversationChange }) {
  const navigate = useNavigate();
  const [data, setData] = useState(() => conversationCache.get(String(parent?.id || '')) || null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [markingHandled, setMarkingHandled] = useState(false);
  const [feedbackBusy, setFeedbackBusy] = useState('');
  const [feedbackFor, setFeedbackFor] = useState(null);
  const [feedbackAlt, setFeedbackAlt] = useState('');
  const [feedbackNote, setFeedbackNote] = useState('');
  const [feedbackDone, setFeedbackDone] = useState({});
  const [error, setError] = useState('');
  const [replyText, setReplyText] = useState('');
  const [channel, setChannel] = useState('whatsapp');
  const [activeThreadId, setActiveThreadId] = useState(selectedThreadId || 'parent');
  const [mode, setMode] = useState('text'); // text | template | saved | image
  const [templates, setTemplates] = useState(() => approvedTemplatesCache || []);
  const [savedReplies, setSavedReplies] = useState(() => savedRepliesCache || []);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [templateVars, setTemplateVars] = useState([]);
  const [showArchivedTemplates, setShowArchivedTemplates] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState('');
  const [templateTagDraft, setTemplateTagDraft] = useState('');
  const [templateUsageDraft, setTemplateUsageDraft] = useState('');
  const [templateBusyId, setTemplateBusyId] = useState('');
  const [templateError, setTemplateError] = useState('');
  // The last template fetch failed — different from "Meta approved nothing".
  const [templatesUnavailable, setTemplatesUnavailable] = useState(false);
  const [selectedSaved, setSelectedSaved] = useState('');
  const [imagePreview, setImagePreview] = useState(null);
  const [imageBase64, setImageBase64] = useState('');
  const [botBusy, setBotBusy] = useState(false);
  const [botMenuOpen, setBotMenuOpen] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftInfo, setDraftInfo] = useState(null);
  // Ticks the pause countdown between the conversation polls.
  const [clockTick, setClockTick] = useState(Date.now());
  const botMenuRef = useRef(null);
  const messagesRef = useRef(null);
  const fileRef = useRef(null);
  const wasBlockedRef = useRef(false);
  // The nudge out of the template tab belongs to opening a customer. Once staff
  // pick that tab themselves, no background poll may pull them out of it.
  const modeSyncedRef = useRef(false);
  // Whether the messages pane was parked at the bottom before the last render.
  const atBottomRef = useRef(true);
  const scrolledThreadRef = useRef('parent');
  // Half-written reply in the composer. `load` runs from a stale closure on the
  // poll, so this has to be a ref rather than the state it mirrors.
  const composingRef = useRef(false);
  // Quiet polls keep an old `load` closure — read the live thread id from a ref
  // so a refresh never drags the user back to the parent thread.
  const activeThreadIdRef = useRef(selectedThreadId || 'parent');
  // The family cards own the selected communication entity. Keep that request
  // across the parent change and the following async conversation load.
  const requestedThreadIdRef = useRef(selectedThreadId || 'parent');
  // Skip overlapping quiet polls when a round trip is slower than the interval.
  const loadInFlightRef = useRef(false);
  const currentParentIdRef = useRef(String(parent?.id || ''));
  currentParentIdRef.current = String(parent?.id || '');

  const pickThread = (threadId) => {
    activeThreadIdRef.current = threadId;
    setActiveThreadId(threadId);
  };

  const refreshTemplates = async () => {
    const res = await fetch('/api/message-templates?approved=1&archived=1');
    const rows = res.ok ? await res.json().catch(() => null) : null;
    setTemplatesUnavailable(!Array.isArray(rows));
    if (Array.isArray(rows)) {
      approvedTemplatesCache = rows;
      setTemplates(rows);
    }
  };

  /**
   * The label and the archive flag are internal fields — Meta never sees them,
   * so they stay editable after approval and can be fixed from here instead of
   * making staff leave the conversation to tidy a list they are looking at.
   */
  const patchTemplate = async (tpl, patch) => {
    setTemplateBusyId(tpl.id);
    setTemplateError('');
    try {
      const res = await fetch(`/api/message-templates/${encodeURIComponent(tpl.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'עדכון התבנית נכשל');
      await refreshTemplates();
      setEditingTemplateId('');
    } catch (err) {
      setTemplateError(err.message);
    } finally {
      setTemplateBusyId('');
    }
  };

  const load = async ({ quiet = false } = {}) => {
    if (!parent?.id) return;
    const requestedParentId = String(parent.id);
    // A slow round trip must not stack quiet polls on top of itself.
    if (quiet && loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    if (!quiet) setLoading(true);
    setError('');
    try {
      // Quiet polls only refresh the thread — templates and saved replies barely
      // change, and re-fetching them every few seconds delayed new messages.
      let convRes;
      if (quiet) {
        convRes = await fetch(`/api/conversations/${requestedParentId}`);
      } else {
        const [cRes, resources] = await Promise.all([
          fetch(`/api/conversations/${requestedParentId}`),
          loadComposerResources(),
        ]);
        convRes = cRes;

        // Templates / saved replies first — don't lose them if conversation load fails
        const tpls = resources.templates;
        // A round trip that failed must not empty the picker. Background polls
        // run while the API restarts, and overwriting the list with [] made that
        // read as "Meta approved nothing" — sending staff to press a sync button
        // that fixes nothing, on a list that was fine a second earlier.
        setTemplatesUnavailable(!Array.isArray(tpls));
        if (Array.isArray(tpls)) setTemplates(tpls);
        const srs = resources.savedReplies;
        if (Array.isArray(srs)) setSavedReplies(srs);
      }

      const conv = await convRes.json().catch(() => ({}));
      if (!convRes.ok) throw new Error(conv.error || 'טעינת שיחה נכשלה');
      conversationCache.set(requestedParentId, conv);
      // A slower previous customer must never replace the card that is now on
      // screen. Its result stays cached for an instant return visit.
      if (currentParentIdRef.current !== requestedParentId) return;
      setData(conv);
      onConversationChange?.(requestedParentId, conv);

      const threads = Array.isArray(conv.threads) ? conv.threads : [];
      const preferredThreadId = conv.defaultThreadId || 'parent';
      const requestedThreadId = requestedThreadIdRef.current;
      const pickedThreadId = activeThreadIdRef.current;
      const nextThreadId = threads.some((t) => t.id === requestedThreadId)
        ? requestedThreadId
        : threads.some((t) => t.id === pickedThreadId)
          ? pickedThreadId
          : preferredThreadId;
      pickThread(nextThreadId);

      const activeThread = threads.find((t) => t.id === nextThreadId) || threads[0];
      const available = activeThread?.channels || conv.channels || {};
      const nextChannel = available[conv.defaultChannel]
        ? (conv.defaultChannel || 'whatsapp')
        : (['whatsapp', 'instagram', 'messenger'].find((ch) => available[ch]) || 'whatsapp');
      setChannel(nextChannel);

      const openNow = nextChannel === 'whatsapp'
        ? !!activeThread?.window?.open
        : !!conv.windows?.[nextChannel]?.open;
      if (openNow) {
        // Only when the customer is first opened, and never over a reply that is
        // already being written. Background polls used to run this too, so the
        // template tab snapped back to text every few seconds.
        if (!modeSyncedRef.current && !composingRef.current) {
          setMode((prev) => (prev === 'template' ? 'text' : prev));
        }
        wasBlockedRef.current = false;
      } else {
        wasBlockedRef.current = true;
      }
      modeSyncedRef.current = true;
    } catch (err) {
      setError(err.message);
    } finally {
      loadInFlightRef.current = false;
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    setData(conversationCache.get(String(parent?.id || '')) || null);
  }, [parent?.id]);

  useEffect(() => {
    const requestedThreadId = selectedThreadId || 'parent';
    requestedThreadIdRef.current = requestedThreadId;
    modeSyncedRef.current = false;
    atBottomRef.current = true;
    pickThread(requestedThreadId);
    load();
    // Reload when a newer inbound lands on the parent card (waiting-queue poll).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    parent?.id,
    parent?.last_inbound_whatsapp,
    parent?.last_inbound_instagram,
    parent?.last_inbound_messenger,
    selectedThreadId,
  ]);

  // A different communication entity starts with an empty composer — never
  // carry a draft, template or image to another parent or child.
  useEffect(() => {
    setSelectedTemplate('');
    setTemplateVars([]);
    setReplyText('');
    setImageBase64('');
    setImagePreview(null);
    setBotMenuOpen(false);
    composingRef.current = false;
  }, [parent?.id, selectedThreadId]);

  useEffect(() => {
    if (!botMenuOpen) return undefined;
    const onPointerDown = (event) => {
      if (botMenuRef.current && !botMenuRef.current.contains(event.target)) {
        setBotMenuOpen(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setBotMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [botMenuOpen]);

  useEffect(() => {
    composingRef.current = !!selectedTemplate || !!replyText.trim() || !!imageBase64;
  }, [selectedTemplate, replyText, imageBase64]);

  // Live chat: one request waits on the server until a message is actually
  // stored, instead of re-fetching the thread every second and a half.
  useLiveMessages(() => load({ quiet: true }), { enabled: !!parent?.id });

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    // Scrolling up means reading history — a poll that lands a new message must
    // not yank the pane back down mid-read. Switching thread always jumps.
    if (atBottomRef.current || activeThreadId !== scrolledThreadRef.current) {
      el.scrollTop = el.scrollHeight;
      atBottomRef.current = true;
    }
    scrolledThreadRef.current = activeThreadId;
  }, [data?.messages?.length, activeThreadId]);

  useEffect(() => {
    if (data?.bot?.status !== 'paused') return undefined;
    const timer = setInterval(() => setClockTick(Date.now()), 30000);
    return () => clearInterval(timer);
  }, [data?.bot?.status, data?.bot?.until]);

  const threads = Array.isArray(data?.threads) ? data.threads : [];
  const activeThread = threads.find((t) => t.id === activeThreadId) || threads[0] || {
    id: 'parent',
    role: 'parent',
    label: parent?.name || 'הורה',
    phone: parent?.phone || '',
    channels: data?.channels || {},
    window: data?.windows?.whatsapp,
  };
  const parentName = (() => {
    const first = String(parent?.name || '').replace(/\s+/g, ' ').trim();
    const last = String(parent?.lastName || '').replace(/\s+/g, ' ').trim();
    if (!last || first.endsWith(last)) return first;
    return [first, last].filter(Boolean).join(' ');
  })();
  const conversationName = activeThread?.role === 'student'
    ? (student?.name || activeThread?.label || 'מתאמן')
    : (parentName || activeThread?.label || 'לקוח');
  const threadChannels = activeThread?.channels || data?.channels || {};
  const allMessages = data?.messages || [];
  const messages = allMessages.filter((m) => messageMatchesThread(m, activeThread, parent?.phone));

  useEffect(() => {
    if (threadChannels[channel]) return;
    const nextChannel = ['whatsapp', 'instagram', 'messenger'].find((ch) => threadChannels[ch]) || 'whatsapp';
    if (nextChannel !== channel) setChannel(nextChannel);
  }, [activeThreadId, channel, threadChannels.whatsapp, threadChannels.instagram, threadChannels.messenger]);

  const windowOpen = channel === 'whatsapp'
    ? !!activeThread?.window?.open
    : !!data?.windows?.[channel]?.open;
  const freeformBlocked = !windowOpen;

  useEffect(() => {
    if (freeformBlocked && channel === 'whatsapp' && (mode === 'text' || mode === 'image' || mode === 'saved')) {
      setMode('template');
    } else if (!freeformBlocked && wasBlockedRef.current && mode === 'template') {
      // Customer just wrote — switch back to free-form text.
      setMode('text');
      setSelectedTemplate('');
      setTemplateVars([]);
      setError('');
    }
    wasBlockedRef.current = !!freeformBlocked;
  }, [freeformBlocked, mode, channel]);

  const findInboundBefore = (index) => {
    for (let i = index - 1; i >= 0; i -= 1) {
      if (messages[i]?.direction === 'inbound') {
        return messages[i].body || messages[i].message || messages[i].text || '';
      }
    }
    return '';
  };

  const submitBotFeedback = async (message, rating, index) => {
    if (!message?.id || feedbackBusy) return;
    if (rating === 'down' && feedbackFor !== message.id) {
      setFeedbackFor(message.id);
      setFeedbackAlt('');
      setFeedbackNote('');
      return;
    }
    setFeedbackBusy(message.id);
    setError('');
    try {
      const res = await fetch('/api/bot-learning/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId: message.id,
          parentId: parent?.id || null,
          phone: message.phone || activeThread?.phone || parent?.phone || '',
          rating,
          note: feedbackNote,
          alternative: rating === 'down' ? feedbackAlt : '',
          replyExcerpt: message.body || message.message || message.text || '',
          inboundExcerpt: findInboundBefore(index),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || 'שמירת המשוב נכשלה');
      setFeedbackDone((prev) => ({ ...prev, [message.id]: rating }));
      setFeedbackFor(null);
      setFeedbackAlt('');
      setFeedbackNote('');
    } catch (err) {
      setError(err.message || 'שמירת המשוב נכשלה');
    } finally {
      setFeedbackBusy('');
    }
  };

  const onPickImage = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      setImagePreview(result);
      setImageBase64(result);
      setMode('image');
    };
    reader.readAsDataURL(file);
  };

  const handleSend = async (e) => {
    e?.preventDefault?.();
    if (!parent?.id || sending) return;
    setSending(true);
    setError('');
    try {
      let body = {
        channel,
        type: mode === 'saved' ? 'saved_reply' : mode,
        studentId: activeThread?.studentId || null,
        targetPhone: activeThread?.phone || null,
      };
      if (mode === 'text') {
        if (!replyText.trim()) return;
        body.text = replyText.trim();
      } else if (mode === 'template') {
        if (!selectedTemplate) throw new Error('בחרו תבנית');
        const tpl = templates.find((t) => t.id === selectedTemplate || t.meta_name === selectedTemplate);
        // Without the row all we hold is our internal id, and Meta would reject
        // it as an unknown template name. Say what actually happened instead.
        if (!tpl) throw new Error('רשימת התבניות לא נטענה. רעננו את המסך ובחרו תבנית שוב');
        body.templateName = tpl.meta_name || tpl.name;
        body.language = tpl.language || 'he';
        body.variables = templateVars.filter((v) => v != null && String(v).length);
      } else if (mode === 'saved') {
        if (!selectedSaved) throw new Error('בחרו הודעה שמורה');
        body.savedReplyId = selectedSaved;
      } else if (mode === 'image') {
        if (!imageBase64) throw new Error('בחרו תמונה');
        body.imageBase64 = imageBase64;
        body.caption = replyText.trim();
        body.mimeType = imageBase64.match(/^data:([^;]+);/)?.[1] || 'image/jpeg';
      }

      const res = await fetch(`/api/conversations/${parent.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      // An API that is down (or restarting) answers with an empty body, and a
      // bare res.json() then surfaces a raw browser string that tells staff
      // nothing about whether the message went out.
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || (json ? 'שליחה נכשלה' : SERVER_DOWN_MESSAGE));
      }
      setReplyText('');
      setImageBase64('');
      setImagePreview(null);
      setDraftInfo(null);
      await load({ quiet: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const handleBotToggle = async (action, minutes) => {
    if (!parent?.id || !action || botBusy) return;
    // The master switch is not a per-customer setting — make that explicit
    // before one conversation turns the bot back on for everybody.
    if (action === 'enable-global'
      && !window.confirm('הדלקת הבוט תחזיר אותו לענות אוטומטית לכל הלקוחות, לא רק ללקוח הזה. להמשיך?')) {
      return;
    }
    if (action === 'mute'
      && !window.confirm('לכבות את הבוט באופן קבוע ללקוח הזה? הוא לא יענה אוטומטית עד שתחזירו אותו מהתג למעלה.')) {
      return;
    }
    setBotBusy(true);
    setBotMenuOpen(false);
    setError('');
    try {
      if (action === 'enable-global') {
        const res = await fetch('/api/whatsapp/bot-enabled', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: true }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'הדלקת הבוט נכשלה');
        await load({ quiet: true });
        return;
      }
      const body = { action };
      if (action === 'pause') body.minutes = minutes;
      const res = await fetch(`/api/conversations/${parent.id}/bot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || 'עדכון מצב הבוט נכשל');
      setData((prev) => (prev ? { ...prev, bot: json.bot } : prev));
    } catch (err) {
      setError(err.message);
    } finally {
      setBotBusy(false);
    }
  };

  const handleDraft = async () => {
    if (!parent?.id || drafting) return;
    setDrafting(true);
    setError('');
    try {
      const res = await fetch(`/api/conversations/${parent.id}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: activeThread?.studentId || null,
          targetPhone: activeThread?.phone || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || 'ניסוח התשובה נכשל');
      setMode('text');
      setReplyText(json.text);
      setDraftInfo({ unsure: !!json.unsure, confidence: json.confidence });
    } catch (err) {
      setError(err.message);
    } finally {
      setDrafting(false);
    }
  };

  const handleMarkHandled = async () => {
    if (!parent?.id || markingHandled) return;
    setMarkingHandled(true);
    setError('');
    try {
      const res = await fetch(`/api/conversations/${parent.id}/handled`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || 'סימון הלקוח כטופל נכשל');
      const ownParent = (json.parents || []).find((item) => item.id === parent.id);
      setData((prev) => prev
        ? { ...prev, parent: ownParent || { ...prev.parent, communication_handled_at: json.handledAt } }
        : prev);
      onHandled?.(json.parents || [], json.handledAt);
    } catch (err) {
      setError(err.message);
    } finally {
      setMarkingHandled(false);
    }
  };

  if (!parent) {
    return (
      <div className="card card-p" style={{ marginBottom: fillHeight ? 0 : 20, height: fillHeight ? '100%' : undefined }}>
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>אין איש קשר מקושר ללקוח זה</div>
      </div>
    );
  }

  const awaitingHandling = isAwaitingHandling(data?.parent || parent);
  const botBadge = describeBotBadge(data?.bot, clockTick);
  const missingNewMessage = !!data && threadIsBehindCard(data?.parent || parent, allMessages);
  const templateStudent = activeThread?.studentId
    ? (data?.students || []).find((s) => String(s.id) === String(activeThread.studentId)) || student
    : student;
  const mainTemplates = templates.filter((t) => !t.archived);
  const archivedTemplates = templates.filter((t) => !!t.archived);
  const pickTemplate = {
    rows: showArchivedTemplates ? [...mainTemplates, ...archivedTemplates] : mainTemplates,
    select: (tpl) => {
      setSelectedTemplate(tpl.id);
      const normalized = normalizeTemplateVariables(tpl?.variables, tpl?.body);
      setTemplateVars(buildPrefillValues(normalized, parent, templateStudent));
    },
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: fillHeight ? '100%' : undefined,
        minHeight: 0,
        flex: fillHeight ? 1 : undefined,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          padding: fillHeight ? '8px 14px' : undefined,
          borderBottom: fillHeight ? '1px solid var(--border)' : undefined,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <div
              className="section-title"
              title={conversationName}
              style={{ margin: 0, flexShrink: 0, maxWidth: 180, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {conversationName}
            </div>
            {channel === 'whatsapp' && activeThread?.window ? (
              <ThreadWindowBadge thread={activeThread} channel={channel} />
            ) : (
              <WindowBadge windows={data?.windows} channel={channel} />
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap', justifyContent: 'center', minWidth: 0 }}>
          <ContactSyncBadge parentId={parent.id} />
          {botBadge && (
            <div ref={botMenuRef} style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setBotMenuOpen((open) => !open)}
                disabled={botBusy}
                title={botBadge.actionLabel}
                aria-haspopup="menu"
                aria-expanded={botMenuOpen}
                style={{
                  ...WINDOW_BADGE_STYLE,
                  width: 44,
                  padding: 0,
                  justifyContent: 'center',
                  gap: 4,
                  lineHeight: 0,
                  cursor: botBusy ? 'default' : 'pointer',
                }}
              >
                <botBadge.icon size={15} style={{ color: BOT_TONES[botBadge.tone] || BOT_TONES.off, flexShrink: 0 }} />
                <ChevronDown size={11} style={{ color: 'var(--text-3)', flexShrink: 0, transform: botMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
              </button>
              {botMenuOpen && (
                <div
                  role="menu"
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 4px)',
                    left: 0,
                    zIndex: 40,
                    minWidth: 180,
                    padding: 6,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                  }}
                >
                  {botBadge.canResume && (
                    <button
                      type="button"
                      role="menuitem"
                      className="btn btn-ghost btn-xs"
                      style={{ justifyContent: 'flex-start', width: '100%' }}
                      disabled={botBusy}
                      onClick={() => handleBotToggle('resume')}
                    >
                      הפעלת הבוט
                    </button>
                  )}
                  {botBadge.canPause && BOT_PAUSE_OPTIONS.map((opt) => (
                    <button
                      key={opt.minutes}
                      type="button"
                      role="menuitem"
                      className="btn btn-ghost btn-xs"
                      style={{ justifyContent: 'flex-start', width: '100%' }}
                      disabled={botBusy}
                      onClick={() => handleBotToggle('pause', opt.minutes)}
                    >
                      {opt.label}
                    </button>
                  ))}
                  {botBadge.canMutePermanent && (
                    <button
                      type="button"
                      role="menuitem"
                      className="btn btn-ghost btn-xs"
                      style={{ justifyContent: 'flex-start', width: '100%', color: '#F87171' }}
                      disabled={botBusy}
                      onClick={() => handleBotToggle('mute')}
                    >
                      כיבוי קבוע
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={handleMarkHandled}
            disabled={!awaitingHandling || markingHandled}
            title={awaitingHandling ? 'סיום הטיפול והסרת הלקוח מרשימת ההמתנה' : 'אין טיפול פתוח ללקוח זה'}
            aria-label={markingHandled ? 'מסיים טיפול' : awaitingHandling ? 'סיום טיפול' : 'הטיפול הסתיים'}
            style={{ ...WINDOW_BADGE_STYLE, width: 30, padding: 0, justifyContent: 'center' }}
          >
            <CheckCircle2 size={14} style={{ color: awaitingHandling ? '#34D399' : 'var(--text-3)', flexShrink: 0 }} />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-xs btn-icon"
            onClick={() => load()}
            disabled={loading}
            title="רענון השיחה"
            aria-label="רענון השיחה"
            style={{ ...WINDOW_BADGE_STYLE, width: 30, padding: 0, justifyContent: 'center' }}
          >
            <RefreshCw size={14} />
          </button>
        </div>
        {onClose && (
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-xs"
            onClick={onClose}
            title="סגירת התיק"
            aria-label="סגירת התיק"
            style={{ width: 30, height: 30, border: '1px solid var(--border)', background: 'transparent', flexShrink: 0 }}
          >
            <X size={15} />
          </button>
        )}
      </div>

      <div
        className={fillHeight ? undefined : 'card card-p'}
        style={{
          marginBottom: fillHeight ? 0 : 20,
          padding: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          flex: fillHeight ? 1 : undefined,
          minHeight: 0,
          background: fillHeight ? 'transparent' : undefined,
          border: fillHeight ? 'none' : undefined,
          borderRadius: fillHeight ? 0 : undefined,
        }}
      >
        {(botBadge?.blocks || []).map((block) => (
          <div
            key={block.kind}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '8px 12px',
              borderBottom: '1px solid var(--border)',
              background: block.kind === 'global' ? 'rgba(148,163,184,0.10)' : 'rgba(251,191,36,0.10)',
              color: block.kind === 'global' ? '#CBD5E1' : '#FBBF24',
              fontSize: 11,
              lineHeight: 1.45,
              flexShrink: 0,
            }}
          >
            <span>{block.reason}</span>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              style={{ flexShrink: 0 }}
              onClick={() => handleBotToggle(block.action)}
              disabled={botBusy}
            >
              {botBusy ? 'מעדכן...' : block.actionLabel}
            </button>
          </div>
        ))}

        {missingNewMessage && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '8px 12px',
              borderBottom: '1px solid var(--border)',
              background: 'rgba(250,204,21,0.12)',
              color: '#FACC15',
              fontSize: 12,
              flexShrink: 0,
            }}
          >
            <span>יש הודעה חדשה שעוד לא נטענה לשיחה</span>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => load()} disabled={loading}>
              <RefreshCw size={12} /> {loading ? 'טוען' : 'טעינה מחדש'}
            </button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, padding: '8px 12px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', flexShrink: 0 }}>
          {Object.keys(CHANNEL_LABELS).map((ch) => (
            <button
              key={ch}
              type="button"
              className={`btn btn-xs ${channel === ch ? 'btn-primary' : 'btn-ghost'}`}
              disabled={!threadChannels[ch]}
              onClick={() => setChannel(ch)}
              title={!threadChannels[ch] ? 'ערוץ לא מחובר לשיחה זו' : ''}
            >
              {CHANNEL_LABELS[ch]}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: fillHeight ? 0 : 160, maxHeight: fillHeight ? undefined : 360 }}>
          <div
            ref={messagesRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              // Measured while the user scrolls, not after the new message is in
              // the DOM — by then scrollHeight already grew and every reader
              // would look like they had scrolled away.
              atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
            }}
            style={{
              flex: 1,
              overflowY: 'auto',
              overscrollBehavior: 'contain',
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              minHeight: fillHeight ? 0 : 160,
            }}
          >
            {loading && !messages.length ? (
              <div style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center', marginTop: 20 }}>טוען שיחה...</div>
            ) : messages.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center', marginTop: 20 }}>
                עדיין אין הודעות בשיחה הזו. שלחו הודעה או המתינו לפנייה.
              </div>
            ) : (
              messages.map((m, i) => {
                const inbound = m.direction === 'inbound';
                const ch = m.channel || 'whatsapp';
                const childLabel = m.fromChild || m.student_id
                  ? (m.studentName || activeThread?.label || 'מתאמן')
                  : null;
                const dayKey = messageDayKey(m.created_at);
                const startsNewDay = !!dayKey && dayKey !== messageDayKey(messages[i - 1]?.created_at);
                return (
                  <React.Fragment key={m.id || i}>
                  {startsNewDay && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      margin: '4px 0',
                    }}>
                      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                      <span style={{
                        fontSize: 10,
                        color: 'var(--text-3)',
                        whiteSpace: 'nowrap',
                        padding: '2px 10px',
                        borderRadius: 999,
                        border: '1px solid var(--border)',
                        background: 'var(--bg-card)',
                      }}>
                        {messageDayLabel(m.created_at)}
                      </span>
                      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                    </div>
                  )}
                  <div
                    style={{
                      alignSelf: inbound ? 'flex-start' : 'flex-end',
                      maxWidth: '88%',
                      fontSize: 12,
                      padding: '8px 10px',
                      borderRadius: 12,
                      background: inbound ? 'rgba(255,255,255,0.04)' : CHANNEL_COLORS[ch] || 'rgba(37,211,102,0.14)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div style={{
                      fontSize: 10,
                      color: 'var(--text-3)',
                      marginBottom: 4,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}>
                      {/* The bot's own icon, so a glance down the thread shows
                          who answered without reading the labels. */}
                      {m.is_ai && <Bot size={12} style={{ color: '#4ade80', flexShrink: 0 }} />}
                      <span>
                        {CHANNEL_LABELS[ch] || ch}
                        {childLabel ? ` · מאת ${childLabel}` : ''}
                        {m.template_id || m.template_name ? ' · תבנית' : ''}
                        {m.is_ai ? ' · בוט' : ''}
                      </span>
                    </div>
                    {(m.media_url || m.message_type === 'image') && !m.deleted_at && m.status !== 'deleted' && (
                      <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 4 }}>📷 תמונה / מדיה</div>
                    )}
                    {m.deleted_at || m.status === 'deleted' ? (
                      <div style={{ color: 'var(--text-3)', fontStyle: 'italic' }}>
                        הודעה זו נמחקה
                      </div>
                    ) : (
                      <div style={{ color: 'var(--text-1)', whiteSpace: 'pre-wrap' }}>
                        <LinkifiedMessage text={m.body || m.message || m.text} />
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
                      {m.created_at ? new Date(m.created_at).toLocaleString('he-IL') : ''}
                      {m.status && m.status !== 'deleted' ? ` · ${m.status}` : ''}
                      {m.edited_at && !(m.deleted_at || m.status === 'deleted') ? ' · נערכה' : ''}
                    </div>
                    {m.is_ai && m.id && !(m.deleted_at || m.status === 'deleted') && (
                      <div style={{ marginTop: 6 }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <button
                            type="button"
                            className="btn btn-xs btn-ghost"
                            title="תשובה טובה"
                            disabled={!!feedbackBusy || !!feedbackDone[m.id]}
                            onClick={() => submitBotFeedback(m, 'up', i)}
                            style={{ padding: '2px 6px', color: feedbackDone[m.id] === 'up' ? '#22c55e' : undefined }}
                          >
                            <ThumbsUp size={12} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-xs btn-ghost"
                            title="תשובה לא טובה"
                            disabled={!!feedbackBusy || !!feedbackDone[m.id]}
                            onClick={() => submitBotFeedback(m, 'down', i)}
                            style={{ padding: '2px 6px', color: feedbackDone[m.id] === 'down' ? '#ef4444' : undefined }}
                          >
                            <ThumbsDown size={12} />
                          </button>
                          {feedbackDone[m.id] && (
                            <span style={{ fontSize: 10, color: 'var(--text-3)' }}>נשמר</span>
                          )}
                        </div>
                        {feedbackFor === m.id && (
                          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <textarea
                              className="input textarea"
                              rows={2}
                              style={{ fontSize: 11 }}
                              placeholder="מה היה נכון לענות במקום?"
                              value={feedbackAlt}
                              onChange={(e) => setFeedbackAlt(e.target.value)}
                            />
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                type="button"
                                className="btn btn-xs btn-primary"
                                disabled={!feedbackAlt.trim() || feedbackBusy === m.id}
                                onClick={() => submitBotFeedback(m, 'down', i)}
                              >
                                שמור חלופה
                              </button>
                              <button
                                type="button"
                                className="btn btn-xs btn-ghost"
                                onClick={() => setFeedbackFor(null)}
                              >
                                ביטול
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  </React.Fragment>
                );
              })
            )}
          </div>

          {freeformBlocked && (
            <div style={{ fontSize: 11, color: '#FBBF24', padding: '6px 12px', background: 'rgba(251,191,36,0.08)', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
              {channel === 'whatsapp'
                ? 'חלון 24 השעות סגור בוואטסאפ — אפשר לשלוח רק תבנית מאושרת.'
                : 'חלון 24 השעות סגור בערוץ הזה. עברו לוואטסאפ כדי לשלוח תבנית מאושרת, או המתינו לפנייה מהלקוח.'}
            </div>
          )}

          {!freeformBlocked && channel === 'whatsapp' && mode === 'template' && (
            <div style={{ fontSize: 11, color: '#4ade80', padding: '6px 12px', background: 'rgba(34,197,94,0.08)', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
              החלון פתוח — אפשר גם לשלוח טקסט חופשי בלשונית טקסט.
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, padding: '8px 10px', borderTop: '1px solid var(--border)', flexWrap: 'wrap', flexShrink: 0 }}>
            {[
              { id: 'text', label: 'טקסט', icon: MessageCircle, disabled: freeformBlocked },
              { id: 'template', label: 'תבנית', icon: FileText, disabled: channel !== 'whatsapp' },
              { id: 'saved', label: 'שמורה', icon: Bookmark, disabled: freeformBlocked },
              { id: 'image', label: 'תמונה', icon: ImageIcon, disabled: freeformBlocked || channel !== 'whatsapp' },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                className={`btn btn-xs ${mode === m.id ? 'btn-primary' : 'btn-ghost'}`}
                disabled={m.disabled}
                onClick={() => setMode(m.id)}
              >
                <m.icon size={11} /> {m.label}
              </button>
            ))}
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              style={{ marginInlineStart: 'auto' }}
              onClick={handleDraft}
              disabled={drafting || freeformBlocked}
              title={freeformBlocked
                ? 'חלון 24 השעות סגור — אפשר לשלוח רק תבנית מאושרת'
                : 'ניסוח תשובה לפי ההודעה האחרונה של הלקוח. התשובה נכנסת לתיבה לעריכה — לא נשלחת.'}
            >
              <Sparkles size={11} /> {drafting ? 'מנסח...' : 'הצע תשובה'}
            </button>
          </div>

          {draftInfo && (
            <div
              style={{
                fontSize: 11,
                padding: '6px 12px',
                borderTop: '1px solid var(--border)',
                flexShrink: 0,
                background: draftInfo.unsure ? 'rgba(251,191,36,0.08)' : 'rgba(59,130,246,0.08)',
                color: draftInfo.unsure ? '#FBBF24' : '#93C5FD',
              }}
            >
              {draftInfo.unsure
                ? 'טיוטה — המערכת לא בטוחה בתשובה. קראו ותקנו לפני שליחה.'
                : 'טיוטה מוכנה לעריכה. שום דבר לא נשלח עד שתלחצו שלח.'}
            </div>
          )}

          <form onSubmit={handleSend} style={{ padding: 10, background: 'var(--bg-input)', flexShrink: 0 }}>
            {mode === 'template' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
                {loading && templates.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.45 }}>
                    טוען תבניות מאושרות...
                  </div>
                ) : templates.length === 0 ? (
                  templatesUnavailable ? (
                    <div style={{ fontSize: 11, color: '#FCA5A5', lineHeight: 1.45 }}>
                      טעינת התבניות נכשלה — השרת לא ענה. הרשימה תחזור לבד תוך כמה שניות,
                      או רעננו את המסך.
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: '#FBBF24', lineHeight: 1.45 }}>
                      אין תבניות מאושרות במערכת.
                      עברו למסך הדיוור, לשונית תבניות, לחצו על סנכרון, ואז רעננו כאן.
                    </div>
                  )
                ) : (
                  <>
                    {/* A list rather than a <AppSelect>: the purpose chip is what
                        staff scan for, and an option element cannot carry it.
                        The label and the archive flag are internal, so they can
                        be fixed right here instead of from the templates screen. */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
                      {pickTemplate.rows.map((t) => {
                        const active = String(selectedTemplate) === String(t.id);
                        const chip = templateTagStyle(t.tag);
                        const editing = editingTemplateId === t.id;
                        const busy = templateBusyId === t.id;
                        return (
                          <div key={t.id}>
                            <div style={{ display: 'flex', alignItems: 'stretch', gap: 4 }}>
                              <button
                                type="button"
                                onClick={() => pickTemplate.select(t)}
                                style={{
                                  flex: 1,
                                  minWidth: 0,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  textAlign: 'right',
                                  padding: '7px 9px',
                                  borderRadius: 10,
                                  cursor: 'pointer',
                                  border: active
                                    ? '1px solid rgba(56,189,248,0.65)'
                                    : '1px solid var(--border)',
                                  background: active ? 'rgba(56,189,248,0.14)' : 'rgba(255,255,255,0.03)',
                                  color: 'var(--text-1)',
                                  fontSize: 12,
                                  fontWeight: active ? 700 : 500,
                                }}
                              >
                                {chip && <span style={chip}>{t.tag}</span>}
                                {/* The Meta name (`coustumer_details`) means nothing
                                    to whoever is writing to a customer. A label
                                    they chose replaces it; the name is only shown
                                    when there is no label to show instead. */}
                                <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                  {!chip && (
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {t.name || t.meta_name}
                                    </span>
                                  )}
                                  {t.usage && (
                                    <span style={{
                                      fontSize: 11,
                                      fontWeight: 400,
                                      color: 'var(--text-3)',
                                      lineHeight: 1.35,
                                      display: '-webkit-box',
                                      WebkitLineClamp: 2,
                                      WebkitBoxOrient: 'vertical',
                                      overflow: 'hidden',
                                    }}>
                                      {t.usage}
                                    </span>
                                  )}
                                </span>
                                {t.archived && (
                                  <span style={{ fontSize: 10, color: 'var(--text-3)', marginInlineStart: 'auto' }}>
                                    ארכיון
                                  </span>
                                )}
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-icon btn-xs"
                                title="פרטי התבנית המלאים — טקסט, כפתורים וסטטוס אישור"
                                onClick={() => navigate('/broadcasts', { state: { broadcastTab: 'templates' } })}
                              >
                                <ExternalLink size={12} />
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-icon btn-xs"
                                title="עריכת תווית / ארכיון"
                                disabled={busy}
                                onClick={() => {
                                  setTemplateError('');
                                  setEditingTemplateId(editing ? '' : t.id);
                                  setTemplateTagDraft(t.tag || '');
                                  setTemplateUsageDraft(t.usage || '');
                                }}
                              >
                                <Pencil size={12} />
                              </button>
                            </div>
                            {editing && (
                              <div style={{
                                margin: '4px 0 6px',
                                padding: 8,
                                borderRadius: 10,
                                border: '1px solid var(--border)',
                                background: 'rgba(0,0,0,0.2)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 6,
                              }}>
                                <input
                                  className="input input-sm"
                                  placeholder="תווית (למשל: הצהרת בריאות)"
                                  value={templateTagDraft}
                                  maxLength={24}
                                  onChange={(e) => setTemplateTagDraft(e.target.value)}
                                />
                                <textarea
                                  className="input input-sm"
                                  rows={2}
                                  placeholder="למה התבנית משמשת? (הערה פנימית לצוות — לא נשלחת ללקוח)"
                                  value={templateUsageDraft}
                                  onChange={(e) => setTemplateUsageDraft(e.target.value)}
                                />
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                  {SUGGESTED_TEMPLATE_TAGS.map((tag) => (
                                    <button
                                      key={tag}
                                      type="button"
                                      onClick={() => setTemplateTagDraft(tag)}
                                      style={{
                                        ...templateTagStyle(tag),
                                        opacity: templateTagDraft === tag ? 1 : 0.6,
                                        cursor: 'pointer',
                                      }}
                                    >
                                      {tag}
                                    </button>
                                  ))}
                                </div>
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                  <button
                                    type="button"
                                    className="btn btn-primary btn-xs"
                                    disabled={busy}
                                    onClick={() => patchTemplate(t, {
                                      tag: templateTagDraft,
                                      usage: templateUsageDraft,
                                    })}
                                  >
                                    {busy ? 'שומר...' : 'שמירה'}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-xs"
                                    disabled={busy}
                                    onClick={() => patchTemplate(t, { archived: !t.archived })}
                                  >
                                    {t.archived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
                                    {t.archived ? 'שחזור מהארכיון' : 'העברה לארכיון'}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-xs"
                                    disabled={busy}
                                    onClick={() => setEditingTemplateId('')}
                                  >
                                    ביטול
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {templateError && (
                      <div style={{ fontSize: 11, color: '#FCA5A5', lineHeight: 1.45 }}>{templateError}</div>
                    )}
                    {archivedTemplates.length > 0 && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        style={{ alignSelf: 'flex-start' }}
                        onClick={() => setShowArchivedTemplates((v) => !v)}
                      >
                        <Archive size={12} />
                        {showArchivedTemplates
                          ? 'הסתרת הארכיון'
                          : `הצגת ארכיון (${archivedTemplates.length})`}
                      </button>
                    )}
                  </>
                )}
                {selectedTemplate && (() => {
                  const tpl = templates.find((t) => t.id === selectedTemplate || t.meta_name === selectedTemplate);
                  const normalized = normalizeTemplateVariables(tpl?.variables, tpl?.body);
                  return templateVars.map((v, idx) => (
                    <div key={idx} style={{ display: 'grid', gap: 4 }}>
                      <label style={{ fontSize: 11, color: 'var(--text-3)' }}>
                        {normalized[idx]?.label || `משתנה ${idx + 1}`}
                      </label>
                      <input
                        className="input input-sm"
                        placeholder={normalized[idx]?.label || `משתנה ${idx + 1}`}
                        value={v}
                        onChange={(e) => {
                          const next = [...templateVars];
                          next[idx] = e.target.value;
                          setTemplateVars(next);
                        }}
                      />
                    </div>
                  ));
                })()}
              </div>
            )}

            {mode === 'saved' && (
              <AppSelect
                className="input input-sm"
                style={{ marginBottom: 8, width: '100%' }}
                value={selectedSaved}
                onChange={(e) => setSelectedSaved(e.target.value)}
              >
                <option value="">בחרו הודעה שמורה...</option>
                {savedReplies.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </AppSelect>
            )}

            {mode === 'image' && (
              <div style={{ marginBottom: 8 }}>
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickImage} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
                  בחירת תמונה
                </button>
                {imagePreview && (
                  <img src={imagePreview} alt="תצוגה" style={{ display: 'block', maxHeight: 80, marginTop: 8, borderRadius: 8 }} />
                )}
              </div>
            )}

            {(mode === 'text' || mode === 'image') && (
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="input input-sm"
                  style={{ flex: 1 }}
                  placeholder={mode === 'image' ? 'כיתוב לתמונה (אופציונלי)' : 'כתבו תשובה ללקוח...'}
                  value={replyText}
                  onChange={(e) => {
                    setReplyText(e.target.value);
                    setDraftInfo(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
                    e.preventDefault();
                    if (sending || freeformBlocked) return;
                    if (mode === 'text' && !replyText.trim()) return;
                    if (mode === 'image' && !imageBase64) return;
                    handleSend(e);
                  }}
                  disabled={sending || freeformBlocked}
                />
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={sending || (mode === 'text' && !replyText.trim()) || (mode === 'image' && !imageBase64)}
                >
                  <Send size={13} /> {sending ? 'שולח...' : 'שלח'}
                </button>
              </div>
            )}

            {(mode === 'template' || mode === 'saved') && (
              <button type="submit" className="btn btn-primary btn-sm" disabled={sending} style={{ width: '100%' }}>
                <Send size={13} /> {sending ? 'שולח...' : 'שלח'}
              </button>
            )}
          </form>

          {error && (
            <div style={{ fontSize: 11, color: '#F87171', padding: '0 10px 8px', flexShrink: 0 }}>{error}</div>
          )}
        </div>
      </div>
    </div>
  );
}
