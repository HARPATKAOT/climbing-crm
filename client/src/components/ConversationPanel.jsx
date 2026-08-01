import React, { useEffect, useRef, useState } from 'react';
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
  Sparkles,
  Archive,
  ArchiveRestore,
  ExternalLink,
  Pencil,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { normalizeTemplateVariables, buildPrefillValues } from './templateVariables.js';
import { SUGGESTED_TEMPLATE_TAGS, templateTagStyle } from './templateTags.js';
import { isAwaitingHandling, threadIsBehindCard } from './communicationQueue.js';

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

function WindowBadge({ windows, channel }) {
  const w = windows?.[channel];
  if (!w) return null;
  return (
    <span
      style={{
        fontSize: 10,
        padding: '2px 6px',
        borderRadius: 6,
        background: w.open ? 'rgba(34,197,94,0.15)' : 'rgba(248,113,113,0.12)',
        color: w.open ? '#4ade80' : '#F87171',
        border: '1px solid var(--border)',
      }}
    >
      {CHANNEL_LABELS[channel]}: {w.label}
    </span>
  );
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
};

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
      label: bot.source === 'crm' ? 'מושתק ידנית' : 'מנותק — הלקוח ביקש',
      reason: bot.source === 'crm'
        ? 'הבוט הושתק ידנית ללקוח הזה, ללא הגבלת זמן — עד שתחזירו אותו כאן.'
        : 'הלקוח כתב מילת עצירה בוואטסאפ, ולכן הבוט לא יפנה אליו יותר.',
      action: 'resume',
      actionLabel: 'החזרת הבוט ללקוח',
    });
  } else if (bot.status === 'paused') {
    // The pause can lapse between polls — an expired one is not a block.
    const left = formatPauseLeft(bot.until, now);
    if (left) {
      blocks.push({
        kind: 'customer',
        label: `מושתק · עוד ${left}`,
        reason: `הבוט הושתק אוטומטית ${PAUSE_REASONS[bot.reason] || 'אחרי טיפול אנושי'}, ויחזור לענות בעוד ${left}.`,
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
      action: 'mute',
      actionLabel: 'השתקת הבוט ללקוח זה',
      blocks,
    };
  }
  const [first] = blocks;
  return {
    icon: PowerOff,
    // Two blocks at once ("כבוי במערכת" + "מושתק ללקוח") — say so, don't pick one.
    label: blocks.length > 1
      ? `בוט ${first.label} · וגם ${blocks[1].label}`
      : `בוט ${first.label}`,
    tone: first.kind === 'global' ? 'off' : 'paused',
    action: first.action,
    actionLabel: first.actionLabel,
    blocks,
  };
}

const BOT_TONES = {
  active: { color: '#4ade80', background: 'rgba(34,197,94,0.15)' },
  paused: { color: '#FBBF24', background: 'rgba(251,191,36,0.14)' },
  off: { color: '#94A3B8', background: 'rgba(148,163,184,0.14)' },
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

export default function ConversationPanel({ parent, student, fillHeight = false, onHandled }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
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
  const [activeThreadId, setActiveThreadId] = useState('parent');
  const [mode, setMode] = useState('text'); // text | template | saved | image
  const [templates, setTemplates] = useState([]);
  const [savedReplies, setSavedReplies] = useState([]);
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
  const [drafting, setDrafting] = useState(false);
  const [draftInfo, setDraftInfo] = useState(null);
  // Ticks the pause countdown between the conversation polls.
  const [clockTick, setClockTick] = useState(Date.now());
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
  const userPickedThreadRef = useRef(false);
  // Quiet polls keep an old `load` closure — read the live thread id from a ref
  // so a refresh never drags the user back to the parent thread.
  const activeThreadIdRef = useRef('parent');
  // Skip overlapping quiet polls when a round trip is slower than the interval.
  const loadInFlightRef = useRef(false);

  const pickThread = (threadId) => {
    activeThreadIdRef.current = threadId;
    setActiveThreadId(threadId);
  };

  const refreshTemplates = async () => {
    const res = await fetch('/api/message-templates?approved=1&archived=1');
    const rows = res.ok ? await res.json().catch(() => null) : null;
    setTemplatesUnavailable(!Array.isArray(rows));
    if (Array.isArray(rows)) setTemplates(rows);
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
        convRes = await fetch(`/api/conversations/${parent.id}`);
      } else {
        const [cRes, tplRes, srRes] = await Promise.all([
          fetch(`/api/conversations/${parent.id}`),
          // Archived ones come along so the picker can offer them behind a
          // toggle instead of a second round trip.
          fetch('/api/message-templates?approved=1&archived=1'),
          fetch('/api/saved-replies'),
        ]);
        convRes = cRes;

        // Templates / saved replies first — don't lose them if conversation load fails
        const tpls = tplRes.ok ? await tplRes.json().catch(() => null) : null;
        // A round trip that failed must not empty the picker. Background polls
        // run while the API restarts, and overwriting the list with [] made that
        // read as "Meta approved nothing" — sending staff to press a sync button
        // that fixes nothing, on a list that was fine a second earlier.
        setTemplatesUnavailable(!Array.isArray(tpls));
        if (Array.isArray(tpls)) setTemplates(tpls);
        const srs = srRes.ok ? await srRes.json().catch(() => null) : null;
        if (Array.isArray(srs)) setSavedReplies(srs);
      }

      const conv = await convRes.json().catch(() => ({}));
      if (!convRes.ok) throw new Error(conv.error || 'טעינת שיחה נכשלה');
      setData(conv);

      const threads = Array.isArray(conv.threads) ? conv.threads : [];
      const preferredThreadId = conv.defaultThreadId || 'parent';
      const pickedThreadId = activeThreadIdRef.current;
      const nextThreadId = userPickedThreadRef.current
        && threads.some((t) => t.id === pickedThreadId)
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
    userPickedThreadRef.current = false;
    modeSyncedRef.current = false;
    atBottomRef.current = true;
    pickThread('parent');
    load();
    // Reload when a newer inbound lands on the parent card (waiting-queue poll).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    parent?.id,
    parent?.last_inbound_whatsapp,
    parent?.last_inbound_instagram,
    parent?.last_inbound_messenger,
  ]);

  // A different customer starts with an empty composer — never carrying over the
  // draft, template or image that was aimed at the previous one.
  useEffect(() => {
    setSelectedTemplate('');
    setTemplateVars([]);
    setReplyText('');
    setImageBase64('');
    setImagePreview(null);
    composingRef.current = false;
  }, [parent?.id]);

  useEffect(() => {
    composingRef.current = !!selectedTemplate || !!replyText.trim() || !!imageBase64;
  }, [selectedTemplate, replyText, imageBase64]);

  // Live chat: poll every few seconds while the tab is visible, and again the
  // moment the tab comes back into view. WhatsApp pushes instantly; waiting a
  // quarter-minute made the CRM feel stuck next to the phone.
  useEffect(() => {
    if (!parent?.id) return undefined;
    const tick = () => {
      if (document.visibilityState === 'visible') load({ quiet: true });
    };
    const timer = setInterval(tick, 3000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parent?.id]);

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
  const threadChannels = activeThread?.channels || data?.channels || {};
  const allMessages = data?.messages || [];
  const messages = allMessages.filter((m) => messageMatchesThread(m, activeThread, parent?.phone));

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

  const selectThread = (threadId) => {
    userPickedThreadRef.current = true;
    pickThread(threadId);
    const thread = threads.find((t) => t.id === threadId);
    const available = thread?.channels || {};
    if (!available[channel]) {
      const next = ['whatsapp', 'instagram', 'messenger'].find((ch) => available[ch]) || 'whatsapp';
      setChannel(next);
    }
  };

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

  const handleBotToggle = async (action) => {
    if (!parent?.id || !action || botBusy) return;
    // The master switch is not a per-customer setting — make that explicit
    // before one conversation turns the bot back on for everybody.
    if (action === 'enable-global'
      && !window.confirm('הדלקת הבוט תחזיר אותו לענות אוטומטית לכל הלקוחות, לא רק ללקוח הזה. להמשיך?')) {
      return;
    }
    setBotBusy(true);
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
      const res = await fetch(`/api/conversations/${parent.id}/bot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
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
          gap: 8,
          padding: fillHeight ? '12px 14px' : undefined,
          borderBottom: fillHeight ? '1px solid var(--border)' : undefined,
          flexShrink: 0,
        }}
      >
        <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
          <MessageCircle size={15} /> תקשורת עם הלקוח
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {botBadge && (
            <button
              type="button"
              onClick={() => handleBotToggle(botBadge.action)}
              disabled={botBusy}
              title={botBadge.actionLabel}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 10,
                padding: '3px 7px',
                borderRadius: 6,
                cursor: botBusy ? 'default' : 'pointer',
                border: '1px solid var(--border)',
                ...BOT_TONES[botBadge.tone],
              }}
            >
              <botBadge.icon size={11} />
              {botBusy ? 'מעדכן...' : botBadge.label}
            </button>
          )}
          <button
            type="button"
            className={`btn btn-xs ${awaitingHandling ? 'btn-success' : 'btn-ghost'}`}
            onClick={handleMarkHandled}
            disabled={!awaitingHandling || markingHandled}
            title={awaitingHandling ? 'סיום הטיפול והסרת הלקוח מרשימת ההמתנה' : 'אין טיפול פתוח ללקוח זה'}
          >
            <CheckCircle2 size={12} />
            {markingHandled ? 'מסיים...' : awaitingHandling ? 'סיום טיפול' : 'הטיפול הסתיים'}
          </button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => load()} disabled={loading}>
            <RefreshCw size={12} /> רענון
          </button>
        </div>
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

        {threads.length > 0 && (
          <div style={{ display: 'flex', gap: 6, padding: '8px 12px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', flexShrink: 0 }}>
            {threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className={`btn btn-xs ${activeThreadId === thread.id ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => selectThread(thread.id)}
                title={thread.phone || ''}
              >
                {thread.role === 'parent' ? `הורה · ${thread.label}` : thread.label}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {channel === 'whatsapp' && activeThread?.window ? (
            <span
              style={{
                fontSize: 10,
                padding: '2px 6px',
                borderRadius: 6,
                background: activeThread.window.open ? 'rgba(34,197,94,0.15)' : 'rgba(248,113,113,0.12)',
                color: activeThread.window.open ? '#4ade80' : '#F87171',
                border: '1px solid var(--border)',
              }}
            >
              וואטסאפ: {activeThread.window.label}
            </span>
          ) : (
            <WindowBadge windows={data?.windows} channel={channel} />
          )}
          {channel === 'whatsapp' && activeThread?.phone && (
            <span style={{ fontSize: 10, color: 'var(--text-3)', alignSelf: 'center' }}>
              {activeThread.role === 'student' ? 'נשלח למתאמן' : 'נשלח להורה'}
              {' · '}
              <span style={{ direction: 'ltr', unicodeBidi: 'plaintext' }}>{activeThread.phone}</span>
            </span>
          )}
        </div>

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
                return (
                  <div
                    key={m.id || i}
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
                    <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>
                      {CHANNEL_LABELS[ch] || ch}
                      {childLabel ? ` · מאת ${childLabel}` : ''}
                      {m.template_id || m.template_name ? ' · תבנית' : ''}
                      {m.is_ai ? ' · בוט' : ''}
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
                        {m.body || m.message || m.text || '(ללא תוכן)'}
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
                    {/* A list rather than a <select>: the purpose chip is what
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
              <select
                className="input input-sm"
                style={{ marginBottom: 8, width: '100%' }}
                value={selectedSaved}
                onChange={(e) => setSelectedSaved(e.target.value)}
              >
                <option value="">בחרו הודעה שמורה...</option>
                {savedReplies.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
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
