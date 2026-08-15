import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Send, History, Bot, CheckCircle, RefreshCw, Sparkles, Plus, Trash2, FileText, Bookmark, RotateCcw, Target, Wrench, MessageSquareText, Clock, Headset, GraduationCap, ClipboardList, Inbox, Search, FilterX, Archive, CalendarClock, AlertTriangle, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { Modal } from './UI.jsx';
import SegmentBuilder from './SegmentBuilder.jsx';
import { EMPTY_FILTERS } from './segmentFilters.js';
import TemplatesManager, { TemplatePreview, CategoryIcon, CATEGORIES } from './TemplatesManager.jsx';
import TemplateUsageBadges from './TemplateUsageBadges.jsx';
import SavedRepliesManager from './SavedRepliesManager.jsx';
import BotMasterSwitch from './BotMasterSwitch.jsx';
import BotCapabilitiesPanel from './BotCapabilitiesPanel.jsx';
import BotToneSettings from './BotToneSettings.jsx';
import BotScheduleSettings from './BotScheduleSettings.jsx';
import BotHandoffSettings from './BotHandoffSettings.jsx';
import BotLearningPanel from './BotLearningPanel.jsx';
import BotActivityPanel from './BotActivityPanel.jsx';
import BotOpenItemsPanel from './BotOpenItemsPanel.jsx';
import { useBusinessProfile } from '../BusinessProfileContext.jsx';
import AppSelect from './AppSelect.jsx';
import BroadcastQuotaCard from './BroadcastQuotaCard.jsx';
import BroadcastSuppressionPanel from './BroadcastSuppressionPanel.jsx';
import BroadcastPreviewPager from './BroadcastPreviewPager.jsx';
import BroadcastSendFlow from './BroadcastSendFlow.jsx';

// Only downloaded when the campaigns tab is opened.
const Campaigns = lazy(() => import('./Campaigns.jsx'));

const PLAYGROUND_PHONE = '0599111000';

// datetime-local מדבר בשעון המקומי; toISOString נותן UTC ומזיז את המינימום
// שלוש שעות אחורה בישראל — מה שמאפשר לבחור עבר.
function toLocalDatetimeValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const DEFAULT_LISTS = [
  { key: 'operational', label: 'תפעולי', description: 'שינויי שעות, ביטולים ותזכורות', color: 'var(--green)' },
  { key: 'marketing', label: 'שיווקי', description: 'טיולים חדשים, מבצעים ועדכונים כלליים', color: 'var(--amber)' },
];

const LIST_COLORS = [
  { value: 'var(--blue)', label: 'כחול' },
  { value: 'var(--green)', label: 'ירוק' },
  { value: 'var(--amber)', label: 'כתום' },
  { value: 'var(--purple)', label: 'סגול' },
];

const WA_TEMPLATES = [];

// Colours come from the .tab-bar accent cycle in index.css, by position.
const TABS = [
  { key: 'compose',   label: 'שליחת דיוור',        icon: Send },
  { key: 'templates', label: 'תבניות Meta',         icon: FileText },
  { key: 'saved',     label: 'הודעות שמורות',      icon: Bookmark },
  { key: 'campaigns', label: 'קמפיינים אוטומטיים', icon: Target },
  { key: 'history',   label: 'היסטוריית שידורים',  icon: History },
  // Channel connections moved to הגדרות עסק ← חיבורים, next to every other
  // external service.
  // The key stays `settings` so existing links into this tab keep working.
  { key: 'settings',  label: 'בוט AI',              icon: Bot },
];

/** One tab per question the bot screen answers, then its three workbenches. */
const BOT_TABS = [
  // First, and the one the screen opens on: everything else here is a setting
  // that can wait, and this is the only tab where a customer is waiting.
  { key: 'open',     label: 'מה פתוח',       icon: Inbox },
  { key: 'tools',    label: 'כלים',          icon: Wrench },
  { key: 'tone',     label: 'טון וידע',      icon: MessageSquareText },
  { key: 'schedule', label: 'מתי עונה',      icon: Clock },
  { key: 'handoff',  label: 'העברה לצוות',   icon: Headset },
  { key: 'sandbox',  label: 'ארגז חול',      icon: Sparkles },
  { key: 'learning', label: 'בקרת איכות',     icon: GraduationCap },
  { key: 'journal',  label: 'יומן פעולות',   icon: ClipboardList },
];

export default function Broadcasts({ parents, students, groups = [] }) {
  const { profile } = useBusinessProfile();
  const brandName = profile.display_name || 'הרפתקאות';
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  // Other screens link straight to a tab here (e.g. "full template details"
  // from the conversation panel), so the deep link decides the opening tab.
  const [activeTab, setActiveTab] = useState(
    location.state?.broadcastTab || query.get('tab') || 'compose'
  ); // compose | templates | saved | campaigns | history | settings
  // The bot page held four unrelated things stacked in one column — settings,
  // a sandbox, the learning queue and the journal — so the capability list was
  // squeezed into half a column while the sandbox took the other half. Each is
  // its own job, so each gets its own tab and the full width.
  // tools | tone | schedule | handoff | sandbox | learning | journal
  const [botTab, setBotTab] = useState(query.get('botTab') || 'open');
  
  // Compose / Send State
  const [lists, setLists] = useState(DEFAULT_LISTS);
  const [selectedList, setSelectedList] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [approvedTemplates, setApprovedTemplates] = useState([]);
  // Two dozen approved templates in one flat list is a list nobody reads to the
  // end, and several of them share a display name, so the picker needs the same
  // search/filter/sort the management tab has.
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateCategory, setTemplateCategory] = useState('ALL');
  const [templateSort, setTemplateSort] = useState('custom');
  const [showArchivedTemplates, setShowArchivedTemplates] = useState(false);
  const [customMessage, setCustomMessage] = useState('');
  const [segmentFilters, setSegmentFilters] = useState({ ...EMPTY_FILTERS });
  const [sendingBroadcast, setSendingBroadcast] = useState(false);

  // תוכנית השליחה מהשרת: קהל מאוחד לפי טלפון, חסימות, עלות ותצוגות אמת.
  const [plan, setPlan] = useState(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [overrides, setOverrides] = useState([]);
  const [suppressionSettings, setSuppressionSettings] = useState({ recencyDays: 7, capHours: 72 });
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [quota, setQuota] = useState(null);
  const [scheduleAt, setScheduleAt] = useState('');
  const [quietOffer, setQuietOffer] = useState(null); // {error, quiet:{reason,nextAllowed}}
  const [splitOffer, setSplitOffer] = useState(null); // {remaining}
  const [activeJobId, setActiveJobId] = useState(null);
  const [sendError, setSendError] = useState('');

  // Edit mailing lists
  const [showListsModal, setShowListsModal] = useState(false);
  const [editingLists, setEditingLists] = useState([]);
  const [newListLabel, setNewListLabel] = useState('');
  const [newListDescription, setNewListDescription] = useState('');
  const [savingLists, setSavingLists] = useState(false);
  const [listsError, setListsError] = useState('');

  // Broadcast History State
  const [broadcasts, setBroadcasts] = useState([]);
  const [loadingBroadcasts, setLoadingBroadcasts] = useState(false);
  const [historyJobId, setHistoryJobId] = useState(null);

  // Settings State
  const [settings, setSettings] = useState({
    aiResponderEnabled: true,
    aiActiveHoursEnabled: false,
    aiActiveHoursStart: '09:00',
    aiActiveHoursEnd: '21:00',
    aiActiveDays: [0, 1, 2, 3, 4, 5, 6],
    aiSystemPrompt: `אתה עוזר שירות לקוחות אינטליגנטי עבור קיר הטיפוס ${brandName}. ענה בעברית מנומסת וקצרה.`,
  });
  const [savingBotToggle, setSavingBotToggle] = useState(false);
  const [botToggleError, setBotToggleError] = useState('');

  // AI Workbench Simulator State
  const [workbenchInput, setWorkbenchInput] = useState('');
  const [workbenchMessages, setWorkbenchMessages] = useState([]);
  const [testingAi, setTestingAi] = useState(false);
  const [resettingPlayground, setResettingPlayground] = useState(false);
  const workbenchMessagesRef = useRef(null);

  const fetchLists = async () => {
    try {
      const response = await fetch('/api/broadcast-list-defs');
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          setLists(data);
          setSelectedList((prev) => (prev === '' || data.some((l) => l.key === prev) ? prev : ''));
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const openListsModal = () => {
    setEditingLists(lists.map((l) => ({ ...l })));
    setNewListLabel('');
    setNewListDescription('');
    setListsError('');
    setShowListsModal(true);
  };

  const handleSaveListEdits = async () => {
    setSavingLists(true);
    setListsError('');
    try {
      for (const list of editingLists) {
        const original = lists.find((l) => l.key === list.key);
        if (!original) continue;
        const label = String(list.label || '').trim();
        if (!label) {
          setListsError('לכל רשימה חייב להיות שם');
          setSavingLists(false);
          return;
        }
        if (
          label !== original.label ||
          (list.description || '') !== (original.description || '') ||
          list.color !== original.color
        ) {
          const res = await fetch(`/api/broadcast-list-defs/${list.key}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              label,
              description: list.description || '',
              color: list.color,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'שמירת הרשימה נכשלה');
        }
      }
      await fetchLists();
      setShowListsModal(false);
    } catch (err) {
      setListsError(err.message || 'שמירה נכשלה');
    } finally {
      setSavingLists(false);
    }
  };

  const handleAddList = async () => {
    const label = newListLabel.trim();
    if (!label) {
      setListsError('נא להזין שם לרשימה החדשה');
      return;
    }
    setSavingLists(true);
    setListsError('');
    try {
      // שמירת שינויים פתוחים לפני הוספה
      for (const list of editingLists) {
        const original = lists.find((l) => l.key === list.key);
        if (!original) continue;
        if (
          list.label !== original.label ||
          (list.description || '') !== (original.description || '') ||
          list.color !== original.color
        ) {
          await fetch(`/api/broadcast-list-defs/${list.key}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              label: String(list.label || '').trim(),
              description: list.description || '',
              color: list.color,
            }),
          });
        }
      }
      const res = await fetch('/api/broadcast-list-defs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label,
          description: newListDescription.trim(),
          color: 'var(--blue)',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'הוספת הרשימה נכשלה');
      setNewListLabel('');
      setNewListDescription('');
      const nextLists = Array.isArray(data.lists) ? data.lists : null;
      if (nextLists) {
        setLists(nextLists);
        setEditingLists(nextLists.map((l) => ({ ...l })));
      } else {
        const refreshed = await fetch('/api/broadcast-list-defs').then((r) => (r.ok ? r.json() : null));
        if (Array.isArray(refreshed)) {
          setLists(refreshed);
          setEditingLists(refreshed.map((l) => ({ ...l })));
        }
      }
    } catch (err) {
      setListsError(err.message || 'הוספה נכשלה');
    } finally {
      setSavingLists(false);
    }
  };

  const handleDeleteList = async (key) => {
    if (editingLists.length <= 1) {
      setListsError('חייבת להישאר לפחות רשימה אחת');
      return;
    }
    if (!confirm('למחוק את רשימת התפוצה? המנויים שלה יימחקו.')) return;
    setSavingLists(true);
    setListsError('');
    try {
      const res = await fetch(`/api/broadcast-list-defs/${key}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'מחיקה נכשלה');
      const next = Array.isArray(data.lists) ? data.lists : editingLists.filter((l) => l.key !== key);
      setLists(next);
      setEditingLists(next.map((l) => ({ ...l })));
      setSelectedList((prev) => (prev === '' || next.some((l) => l.key === prev) ? prev : ''));
    } catch (err) {
      setListsError(err.message || 'מחיקה נכשלה');
    } finally {
      setSavingLists(false);
    }
  };

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/whatsapp/settings');
      if (response.ok) {
        const data = await response.json();
        setSettings(prev => ({ ...prev, ...data }));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchBroadcasts = async () => {
    setLoadingBroadcasts(true);
    try {
      // משימות חדשות (עם דוח מלא) + קמפיינים ישנים שאין להם שורת משימה.
      const [jobsRes, campaignsRes] = await Promise.all([
        fetch('/api/broadcast/jobs'),
        fetch('/api/whatsapp/broadcasts'),
      ]);
      const jobs = jobsRes.ok ? await jobsRes.json() : [];
      const campaigns = campaignsRes.ok ? await campaignsRes.json() : [];
      const jobIds = new Set(jobs.map((j) => j.id));
      const legacy = campaigns.filter((c) => !jobIds.has(c.id)).map((c) => ({ ...c, legacy: true }));
      setBroadcasts([...jobs, ...legacy].sort(
        (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
      ));
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingBroadcasts(false);
    }
  };

  useEffect(() => {
    fetchLists();
    fetchSettings();
    fetchApprovedTemplates();
    fetch('/api/broadcast/defaults')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setSuppressionSettings({ recencyDays: d.recencyDays, capHours: d.capHours });
      })
      .catch(() => {});
  }, []);

  // Archived templates come down too, behind the "כולל ארכיון" switch below:
  // asking again over the network every time that switch flips would make a
  // filter feel like a page load.
  const fetchApprovedTemplates = async () => {
    try {
      const res = await fetch('/api/message-templates?approved=1&archived=1');
      const data = res.ok ? await res.json() : [];
      const remote = Array.isArray(data) ? data.map((t) => ({
        id: t.meta_name || t.name,
        name: t.name || t.meta_name,
        text: t.body || '',
        language: t.language,
        metaName: t.meta_name || '',
        category: String(t.category || 'UTILITY').toUpperCase(),
        archived: !!t.archived,
        usedBy: Array.isArray(t.used_by) ? t.used_by : [],
        // The preview pane reads these; without them it could only ever show
        // the body, so a template with a button looked like one without.
        header: t.header || '',
        footer: t.footer || '',
        buttons: Array.isArray(t.buttons) ? t.buttons : [],
        variables: Array.isArray(t.variables) ? t.variables : [],
      })) : [];
      setApprovedTemplates(remote.length ? remote : WA_TEMPLATES);
    } catch {
      setApprovedTemplates(WA_TEMPLATES);
    }
  };

  useEffect(() => {
    if (activeTab === 'history') {
      fetchBroadcasts();
    } else if (activeTab === 'templates') {
      fetchApprovedTemplates();
    }
  }, [activeTab]);

  useEffect(() => {
    setSegmentFilters((prev) => {
      if (Array.isArray(prev.groupIds) && prev.groupIds.length > 0) {
        return prev.listKey ? { ...prev, listKey: '' } : prev;
      }
      const nextKey = selectedList || '';
      return prev.listKey === nextKey ? prev : { ...prev, listKey: nextKey };
    });
  }, [selectedList]);

  // עקיפה שאושרה מול תבנית וסינון מסוימים לא נודדת בשקט לקהל אחר.
  useEffect(() => {
    setOverrides([]);
  }, [selectedTemplate?.id, JSON.stringify(segmentFilters)]);

  // תוכנית השליחה מתחשבת מחדש בכל שינוי קהל/תבנית/הודעה/עקיפות — בשרת.
  useEffect(() => {
    let cancelled = false;
    // הדגל נדלק מיידית (לא בתוך ההשהיה) — אחרת ב-350 המילישניות הראשונות
    // כפתור השליחה עדיין חי עם ספירה של הקהל הקודם.
    setPlanLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/broadcast/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filters: segmentFilters,
            templateId: selectedTemplate?.id || null,
            customMessage: selectedTemplate ? '' : customMessage,
            listKey: segmentFilters.listKey || '',
            overrides,
            recencyDays: suppressionSettings.recencyDays,
            capHours: suppressionSettings.capHours,
            sampleLimit: 12,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!cancelled && res.ok && data) setPlan(data);
      } catch {
        /* הרשת נפלה — נשארים עם התוכנית הקודמת */
      } finally {
        if (!cancelled) setPlanLoading(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [
    JSON.stringify(segmentFilters),
    selectedTemplate?.id,
    customMessage,
    overrides.join(','),
    suppressionSettings.recencyDays,
    suppressionSettings.capHours,
  ]);

  const toggleOverride = (id) => {
    setOverrides((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const saveSuppressionDefaults = async () => {
    setSavingDefaults(true);
    try {
      await fetch('/api/broadcast/defaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(suppressionSettings),
      });
    } catch { /* לא קריטי */ } finally {
      setSavingDefaults(false);
    }
  };

  const messageText = selectedTemplate ? (selectedTemplate.text || selectedTemplate.body || `[תבנית: ${selectedTemplate.id}]`) : customMessage;

  const previewDraft = selectedTemplate
    ? {
      header: selectedTemplate.header || '',
      body: messageText,
      footer: selectedTemplate.footer || '',
      buttons: Array.isArray(selectedTemplate.buttons) ? selectedTemplate.buttons : [],
    }
    : { header: '', body: customMessage, footer: '', buttons: [] };
  const previewVarMeta = Array.isArray(selectedTemplate?.variables) ? selectedTemplate.variables : [];

  const allSendableTemplates = approvedTemplates.length ? approvedTemplates : WA_TEMPLATES;
  const sendableCount = allSendableTemplates.filter((t) => !t.archived).length;
  const archivedCount = allSendableTemplates.length - sendableCount;
  const templateFiltersActive =
    !!templateSearch.trim() || templateCategory !== 'ALL' || showArchivedTemplates;

  const visibleTemplates = allSendableTemplates
    .filter((t) => {
      if (t.archived && !showArchivedTemplates) return false;
      if (templateCategory !== 'ALL' && (t.category || 'UTILITY') !== templateCategory) return false;
      const q = templateSearch.trim().toLowerCase();
      if (!q) return true;
      // The Meta name is searched too: three templates here read "אירוע ·
      // קישור תשלום מזמין", and the Meta name is the only thing telling them
      // apart.
      return [t.name, t.metaName, t.text].some((v) => String(v || '').toLowerCase().includes(q));
    })
    .sort((a, b) => {
      if (templateSort === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'he');
      if (templateSort === 'category') {
        return String(a.category || '').localeCompare(String(b.category || ''))
          || String(a.name || '').localeCompare(String(b.name || ''), 'he');
      }
      return 0; // the server already returns the manual order from the Meta tab
    });

  // A template that scrolls out of sight behind a filter is still the one that
  // will be sent, so it stays pinned at the top rather than looking unselected.
  const pinnedTemplate =
    selectedTemplate && !visibleTemplates.some((t) => t.id === selectedTemplate.id)
      ? selectedTemplate
      : null;

  const resetTemplateFilters = () => {
    setTemplateSearch('');
    setTemplateCategory('ALL');
    setShowArchivedTemplates(false);
  };

  const handleBotToggle = async (enabled) => {
    const previous = !!settings.aiResponderEnabled;
    setBotToggleError('');
    setSettings((prev) => ({ ...prev, aiResponderEnabled: enabled }));
    setSavingBotToggle(true);
    try {
      const response = await fetch('/api/whatsapp/bot-enabled', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSettings((prev) => ({ ...prev, aiResponderEnabled: previous }));
        setBotToggleError(data.error || 'שמירת מצב הבוט נכשלה. נסו שוב.');
        return;
      }
      setSettings((prev) => ({ ...prev, aiResponderEnabled: !!data.aiResponderEnabled }));
    } catch (err) {
      console.error(err);
      setSettings((prev) => ({ ...prev, aiResponderEnabled: previous }));
      setBotToggleError('שגיאת חיבור — מצב הבוט לא נשמר');
    } finally {
      setSavingBotToggle(false);
    }
  };

  const handleSendBroadcast = async ({ scheduledAt = null } = {}) => {
    if (!selectedTemplate && !customMessage.trim()) {
      setSendError('בחרו תבנית מאושרת, או כתבו הודעה לנמענים עם חלון פתוח');
      return;
    }

    // הקהל גדול מהמכסה שנותרה — עוצרים להצעה לפני שמנסים בכלל,
    // כולל כשהמכסה נגמרה לגמרי (remaining === 0).
    const remaining = quota?.remaining;
    if (!scheduledAt && !splitOffer && remaining != null
      && (plan?.eligibleCount || 0) > remaining) {
      setSplitOffer({ remaining, resetAt: quota?.window?.oldestRollsOffAt || null });
      return;
    }

    setSendingBroadcast(true);
    setSendError('');
    setQuietOffer(null);

    const campaignName = `קמפיין ${lists.find(l => l.key === selectedList)?.label || 'פילוח'} - ${new Date().toLocaleDateString('he-IL')}`;
    const hasGroupFilter = Array.isArray(segmentFilters.groupIds) && segmentFilters.groupIds.length > 0;
    const effectiveFilters = {
      ...segmentFilters,
      // קבוצה גוברת על רשימת תפוצה — לא לסנן החוצה מי שלא מנוי לרשימה
      listKey: hasGroupFilter ? '' : (selectedList || segmentFilters.listKey || ''),
    };

    try {
      const response = await fetch('/api/broadcast/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignName,
          listName: hasGroupFilter ? 'קבוצות' : selectedList,
          templateId: selectedTemplate?.id || null,
          customMessage: selectedTemplate ? null : customMessage,
          filters: effectiveFilters,
          overrides,
          recencyDays: suppressionSettings.recencyDays,
          capHours: suppressionSettings.capHours,
          ...(scheduledAt ? { scheduledAt } : {}),
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (response.status === 409 && data.quiet) {
        setQuietOffer({ error: data.error, quiet: data.quiet });
        return;
      }
      if (!response.ok) {
        setSendError(data.error || 'השליחה נכשלה. לרוב האסימון של Meta פג תוקף.');
        return;
      }
      setActiveJobId(data.jobId);
      setSplitOffer(null);
      setScheduleAt('');
      setOverrides([]);
    } catch {
      setSendError('שגיאה בחיבור לשרת');
    } finally {
      setSendingBroadcast(false);
    }
  };

  const exitSendFlow = () => {
    setActiveJobId(null);
    setSelectedTemplate(null);
    setCustomMessage('');
    setSendError('');
  };

  // Test AI bot reply as a continuing playground conversation
  const handleTestAiResponse = async () => {
    const text = workbenchInput.trim();
    if (!text || testingAi) return;
    const userMsg = {
      id: `u-${Date.now()}`,
      role: 'user',
      text,
      at: new Date().toISOString(),
    };
    setWorkbenchMessages((prev) => [...prev, userMsg]);
    setWorkbenchInput('');
    setTestingAi(true);
    try {
      const response = await fetch('/api/whatsapp/simulate-incoming', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: PLAYGROUND_PHONE,
          message: text,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        const reply = data.reply
          || (data.skippedReason ? `הבוט לא ענה (${data.skippedReason})` : '')
          || 'הבוט סירב לענות או החזיר תשובה ריקה.';
        setWorkbenchMessages((prev) => [
          ...prev,
          {
            id: `b-${Date.now()}`,
            role: 'bot',
            text: reply,
            at: new Date().toISOString(),
          },
        ]);
      } else {
        const detail = typeof data.error === 'string' && data.error.trim()
          ? data.error.trim()
          : 'שגיאה בתקשורת עם מנוע המענה';
        setWorkbenchMessages((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            role: 'bot',
            text: detail,
            at: new Date().toISOString(),
          },
        ]);
      }
    } catch (err) {
      setWorkbenchMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'bot',
          text: 'שגיאה בחיבור לשרת',
          at: new Date().toISOString(),
        },
      ]);
    } finally {
      setTestingAi(false);
    }
  };

  const handleResetPlayground = async () => {
    setResettingPlayground(true);
    try {
      await fetch('/api/whatsapp/playground-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: PLAYGROUND_PHONE }),
      });
      setWorkbenchMessages([]);
      setWorkbenchInput('');
    } catch (err) {
      console.error(err);
    } finally {
      setResettingPlayground(false);
    }
  };

  useEffect(() => {
    const messagesElement = workbenchMessagesRef.current;
    if (messagesElement) {
      messagesElement.scrollTo({
        top: messagesElement.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [workbenchMessages, testingAi]);

  useEffect(() => {
    if (activeTab !== 'settings') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/whatsapp/logs');
        if (!res.ok || cancelled) return;
        const logs = await res.json();
        const thread = (Array.isArray(logs) ? logs : [])
          .filter((l) => {
            const p = String(l.phone || l.to || l.from || '');
            return p.includes('599111000') || p.includes('0599111000');
          })
          .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
          .map((l, i) => ({
            id: l.id || `log-${i}`,
            role: l.direction === 'inbound' ? 'user' : 'bot',
            text: l.message || '',
            at: l.created_at,
          }))
          .filter((m) => m.text);
        if (!cancelled && thread.length) {
          setWorkbenchMessages(thread);
        }
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab]);

  return (
    <div className="fade-in">
      <div className="section-header" style={{ marginBottom: 16 }}>
        <div>
          <div className="section-title">מערכת דיוור וואטסאפ ובוט AI</div>
          <div className="section-sub">אינטגרציה לדיוור מסיבי וניהול מענה בינה מלאכותית אוטומטי ללקוחות</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tab-bar">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className={`tab-pill ${activeTab === key ? 'active' : ''}`}
            onClick={() => {
              setActiveTab(key);
              if (key === 'compose') setSendError('');
            }}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {activeTab === 'templates' && <TemplatesManager />}
      {activeTab === 'saved' && <SavedRepliesManager />}
      {activeTab === 'campaigns' && (
        <Suspense fallback={<div style={{ color: 'var(--text-3)', fontSize: 13 }}>טוען קמפיינים...</div>}>
          <Campaigns />
        </Suspense>
      )}

      {/* COMPOSE */}
      {activeTab === 'compose' && (
        activeJobId ? (
          <BroadcastSendFlow jobId={activeJobId} onExit={exitSendFlow} />
        ) : (
          <div className="grid-21" style={{ gap: 20, alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              <div className="card card-p">
                <div className="section-title" style={{ marginBottom: 14 }}>פילוח קהל</div>
                <SegmentBuilder
                  parents={parents}
                  students={students}
                  groups={groups}
                  lists={lists}
                  filters={segmentFilters}
                  onManageLists={openListsModal}
                  onChange={(next) => {
                    const hasGroups = Array.isArray(next.groupIds) && next.groupIds.length > 0;
                    const effectiveList = hasGroups ? '' : (next.listKey || '');
                    setSelectedList(effectiveList);
                    setSegmentFilters({
                      ...next,
                      listKey: effectiveList,
                    });
                  }}
                />
              </div>

              <div className="card card-p">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div className="section-title" style={{ marginBottom: 0 }}>תבניות מאושרות</div>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {templateFiltersActive
                      ? `${visibleTemplates.length} מתוך ${sendableCount}`
                      : `${sendableCount} זמינות לשליחה`}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
                  <div className="input-icon-wrap" style={{ flex: '1 1 180px', minWidth: 150 }}>
                    <Search className="input-icon" size={15} />
                    <input
                      className="input input-sm"
                      placeholder="חיפוש שם, טקסט או שם ב-Meta..."
                      style={{ width: '100%', paddingRight: 32 }}
                      value={templateSearch}
                      onChange={(e) => setTemplateSearch(e.target.value)}
                    />
                  </div>
                  {/* .input is width:100%, so without a width these three each
                      take a whole row and the filter bar becomes a stack. */}
                  <AppSelect className="input input-sm" style={{ width: 150, flex: '0 0 auto' }}
                    value={templateCategory} onChange={(e) => setTemplateCategory(e.target.value)}>
                    <option value="ALL">כל הקטגוריות</option>
                    {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </AppSelect>
                  <AppSelect className="input input-sm" style={{ width: 160, flex: '0 0 auto' }}
                    value={templateSort} onChange={(e) => setTemplateSort(e.target.value)}>
                    <option value="custom">מיון: סדר ידני</option>
                    <option value="name">מיון: שם</option>
                    <option value="category">מיון: קטגוריה</option>
                  </AppSelect>
                  {archivedCount > 0 && (
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={showArchivedTemplates}
                        onChange={(e) => setShowArchivedTemplates(e.target.checked)} />
                      <Archive size={13} /> ארכיון ({archivedCount})
                    </label>
                  )}
                  {templateFiltersActive && (
                    <button type="button" className="btn btn-xs btn-ghost" onClick={resetTemplateFilters}>
                      <FilterX size={12} /> נקה
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 460, overflowY: 'auto' }}>
                  {[...(pinnedTemplate ? [pinnedTemplate] : []), ...visibleTemplates].map(tmpl => {
                    const isSelected = selectedTemplate?.id === tmpl.id;
                    return (
                      <label key={tmpl.id} className={`check-item broadcast-template-option ${isSelected ? 'checked' : ''}`}
                        // .check-item is a flex row — left as-is, the name and the
                        // message body sit side by side instead of one under the other.
                        style={{ padding: 12, opacity: tmpl.archived ? 0.72 : 1, flexDirection: 'column', alignItems: 'stretch', gap: 0 }}>
                        <input
                          type="radio"
                          name="broadcast-template"
                          value={tmpl.id}
                          checked={isSelected}
                          onChange={() => { setSelectedTemplate(tmpl); setCustomMessage(''); }}
                          className="broadcast-template-radio"
                        />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <CategoryIcon category={tmpl.category} />
                          <div style={{ fontWeight: 700, fontSize: 13, minWidth: 0 }}>{tmpl.name}</div>
                        {/* אייקון בלבד כאן: השורה צרה, והשם כבר לוקח אותה. */}
                        <TemplateUsageBadges usage={tmpl.usedBy} compact />
                        {tmpl.archived && (
                          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: 5, padding: '1px 6px' }}>
                            ארכיון
                          </span>
                        )}
                        <span className={`broadcast-template-choice ${isSelected ? 'selected' : ''}`}>
                          {isSelected && <CheckCircle size={14} />}
                          {isSelected ? 'נבחרה' : 'בחירה'}
                        </span>
                      </div>
                      {tmpl.metaName && tmpl.metaName !== tmpl.name && (
                        <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 3, direction: 'ltr', textAlign: 'right', fontFamily: 'monospace' }}>
                          {tmpl.metaName}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {tmpl.text}
                      </div>
                      </label>
                    );
                  })}
                  {visibleTemplates.length === 0 && !pinnedTemplate && (
                    <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '14px 4px', textAlign: 'center' }}>
                      {allSendableTemplates.length === 0
                        ? 'אין תבניות מאושרות — סנכרנו מ-Meta בטאב «תבניות Meta»'
                        : 'אין תבנית שמתאימה לחיפוש'}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 10 }}>
                  לניהול — סדר ידני, ארכיון, עריכה ומחיקה — עברו לטאב «תבניות Meta».
                  אפשר למפות בתבנית משתנה מסוג «קישור להעדפות דיוור».
                </div>
              </div>

              <div className="card card-p">
                <div className="section-title" style={{ marginBottom: 10 }}>הודעה חופשית (רק לנמענים עם חלון 24ש פתוח)</div>
                <textarea className="input textarea" rows={4} placeholder="כתוב הודעה..."
                  value={customMessage} onChange={e => { setCustomMessage(e.target.value); setSelectedTemplate(null); }} />
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>
                  קישור אישי ומאובטח לעריכת העדפות הדיוור יתווסף אוטומטית בסוף ההודעה.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              <BroadcastQuotaCard audienceCount={plan?.eligibleCount || 0} onQuota={setQuota} />

              {(plan?.samples?.length || 0) > 0 ? (
                <BroadcastPreviewPager
                  samples={plan.samples}
                  eligibleCount={plan.eligibleCount}
                  templateId={selectedTemplate?.id || null}
                  customMessage={selectedTemplate ? '' : customMessage}
                />
              ) : (
                <div className="card card-p">
                  <TemplatePreview draft={previewDraft} varMeta={previewVarMeta} />
                </div>
              )}

              <BroadcastSuppressionPanel
                plan={plan}
                overrides={overrides}
                onToggleOverride={toggleOverride}
                recencyDays={suppressionSettings.recencyDays}
                capHours={suppressionSettings.capHours}
                onChangeSettings={(patch) => setSuppressionSettings((s) => ({ ...s, ...patch }))}
                onSaveDefaults={saveSuppressionDefaults}
                savingDefaults={savingDefaults}
              />

              {(plan?.compliance?.blockers || []).map((msg) => (
                <div key={msg} className="alert alert-danger" style={{ fontSize: 12, flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <AlertTriangle size={15} style={{ flexShrink: 0 }} /> {msg}
                  </div>
                  <div style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--text-2)' }}>
                    פתחו את כרטיס «רשימת תפוצה» בבחירת הקהל ובחרו רשימה. להוספת
                    רשימות נושא חדשות («טיולים», «קייטנות»…) — כפתור «עריכת רשימות
                    תפוצה» בתוך אותו כרטיס.
                  </div>
                </div>
              ))}
              {(plan?.compliance?.warnings || []).map((msg) => (
                <div key={msg} className="alert alert-warning" style={{ fontSize: 12 }}>
                  <AlertTriangle size={15} style={{ flexShrink: 0 }} /> {msg}
                </div>
              ))}

              {plan && (
                <div className="card card-p" style={{ fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ color: 'var(--text-3)' }}>קהל לפי הסינון</span>
                    <strong>{plan.audience.count} נמענים · {plan.audience.childCount} ילדים</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ color: 'var(--text-3)' }}>אחרי שכבת החסימות</span>
                    <strong style={{ color: 'var(--green)' }}>{plan.eligibleCount} יישלחו</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-3)' }}>עלות משוערת</span>
                    <strong>
                      {plan.cost.total > 0
                        ? `כ-${plan.cost.total} דולר (${plan.cost.perMessage}$ להודעת ${plan.cost.category === 'MARKETING' ? 'שיווק' : 'שירות'})`
                        : 'ללא עלות'}
                    </strong>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>{plan.cost.note}</div>
                </div>
              )}

              <div className="card card-p">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <CalendarClock size={15} style={{ color: 'var(--blue)' }} />
                  <span style={{ fontSize: 12, fontWeight: 700 }}>תזמון (לא חובה)</span>
                  {scheduleAt && (
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => setScheduleAt('')}>
                      <X size={11} /> נקה
                    </button>
                  )}
                </div>
                <input
                  className="input input-sm"
                  type="datetime-local"
                  value={scheduleAt}
                  min={toLocalDatetimeValue(new Date(Date.now() + 5 * 60000))}
                  onChange={(e) => setScheduleAt(e.target.value)}
                />
                {plan?.quiet?.quiet && !scheduleAt && (
                  <div className="alert alert-warning" style={{ fontSize: 11, marginTop: 8 }}>
                    עכשיו שעות שקטות ({plan.quiet.reason}) — שליחה מיידית תיחסם, אפשר לתזמן.
                  </div>
                )}
              </div>

              {sendError && (
                <div className="alert alert-danger" style={{ fontSize: 12 }}>{sendError}</div>
              )}

              {quietOffer && (
                <div className="alert alert-warning" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{quietOffer.error}</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={sendingBroadcast}
                      onClick={() => handleSendBroadcast({ scheduledAt: quietOffer.quiet.nextAllowed })}
                    >
                      <CalendarClock size={14} /> תזמן ל-{new Date(quietOffer.quiet.nextAllowed).toLocaleString('he-IL', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQuietOffer(null)}>ביטול</button>
                  </div>
                </div>
              )}

              {splitOffer && (
                <div className="alert alert-warning" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>
                    {splitOffer.remaining === 0
                      ? 'המכסה בחלון הנוכחי נוצלה במלואה — שליחה עכשיו צפויה להיכשל.'
                      : `הקהל (${plan?.eligibleCount}) גדול מהמכסה שנותרה (${splitOffer.remaining}). שליחה מלאה עכשיו תיכשל באמצע.`}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {/* המכסה מתפנה בהדרגה, נמען-נמען, ולכן אין "שעת פתיחה" אחת שאפשר
                        לתזמן אליה את כולם — הדרך הבטוחה היא שליחה חלקית ואז שליחה
                        חוזרת לנכשלים. */}
                    מומלץ: לשלוח עכשיו, לתת למשימה להיעצר כשהמכסה נגמרת, ואז «שליחה חוזרת
                    לנכשלים» מדוח התוצאות. המקום מתחיל להתפנות בהדרגה
                    {splitOffer.resetAt ? ` מ-${new Date(splitOffer.resetAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })} בערך` : ' במהלך 24 השעות הקרובות'}.
                    לחלופין, תזמנו את השליחה למחר בשדה התזמון.
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-primary btn-sm" disabled={sendingBroadcast}
                      onClick={() => handleSendBroadcast({})}>
                      שלח עכשיו בכל זאת
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSplitOffer(null)}>ביטול</button>
                  </div>
                </div>
              )}

              <button
                className="btn btn-primary btn-full"
                style={{ paddingBlock: 14 }}
                onClick={() => handleSendBroadcast(scheduleAt ? { scheduledAt: new Date(scheduleAt).toISOString() } : {})}
                disabled={
                  (!messageText || !String(messageText).trim())
                  || sendingBroadcast
                  || planLoading
                  || (plan?.eligibleCount || 0) === 0
                  || (plan?.compliance?.blockers?.length || 0) > 0
                }
              >
                {sendingBroadcast
                  ? '⏳ יוצר משימה...'
                  : scheduleAt
                    ? `תזמן ל-${plan?.eligibleCount ?? 0} נמענים`
                    : `שלח ל-${plan?.eligibleCount ?? 0} נמענים (${plan?.eligibleChildCount ?? 0} ילדים)`}
              </button>
              {(plan?.compliance?.blockers?.length || 0) > 0 ? (
                <div style={{ fontSize: 11, color: 'var(--red)', textAlign: 'center', marginTop: -8, lineHeight: 1.5 }}>
                  השליחה חסומה: {plan.compliance.blockers[0]}
                </div>
              ) : (plan?.eligibleCount || 0) === 0 && (plan?.suppressedCount || 0) > 0 ? (
                <div style={{ fontSize: 11, color: 'var(--amber)', textAlign: 'center', marginTop: -8, lineHeight: 1.5 }}>
                  כל הנמענים נחסמו — פתחו את פאנל החסימות כדי לראות למה ולבטל חסימות במודע.
                </div>
              ) : (
                <div style={{ fontSize: 10, color: 'var(--text-3)', textAlign: 'center', marginTop: -8 }}>
                  אחרי הלחיצה יש 30 שניות לבטל לפני שהשליחה מתחילה.
                </div>
              )}
            </div>
          </div>
        )
      )}

      {/* HISTORY */}
      {activeTab === 'history' && (
        <div className="card">
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>שם הקמפיין</th>
                  <th>תבנית / הודעה</th>
                  <th>תאריך</th>
                  <th>נמענים</th>
                  <th>נשלחו</th>
                  <th>נכשלו</th>
                  <th>נחסמו</th>
                  <th>סטטוס</th>
                  <th>נשלח ע״י</th>
                </tr>
              </thead>
              <tbody>
                {loadingBroadcasts && broadcasts.length === 0 ? (
                  <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>טוען…</td></tr>
                ) : broadcasts.length === 0 ? (
                  <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>אין קמפיינים בהיסטוריה</td></tr>
                ) : (
                  broadcasts.map(b => {
                    const statusBadge = {
                      completed: ['badge-green', 'הושלם'],
                      sending: ['badge-blue', 'שולח…'],
                      countdown: ['badge-blue', 'ממתין לשליחה'],
                      scheduled: ['badge-amber', 'מתוזמן'],
                      paused: ['badge-amber', 'מושהה'],
                      stopping: ['badge-amber', 'עוצר…'],
                      stopped: ['badge-gray', 'נעצר'],
                      cancelled: ['badge-gray', 'בוטל'],
                    }[b.status] || ['badge-gray', b.status];
                    return (
                      <tr
                        key={b.id}
                        style={{ cursor: b.legacy ? 'default' : 'pointer' }}
                        onClick={() => { if (!b.legacy) setHistoryJobId(b.id); }}
                        title={b.legacy ? 'קמפיין ישן — אין דוח מפורט' : 'לחיצה פותחת את הדוח המלא'}
                      >
                        <td style={{ fontWeight: 700 }}>{b.campaign_name}</td>
                        <td style={{ maxWidth: 200, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                          {b.template_display || b.template_name || b.message_text}
                        </td>
                        <td>
                          {new Date(b.created_at).toLocaleDateString('he-IL')}
                          {b.scheduled_at && b.status === 'scheduled' && (
                            <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
                              ל-{new Date(b.scheduled_at).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </div>
                          )}
                        </td>
                        <td>{b.recipient_count}</td>
                        <td style={{ color: 'var(--green)' }}>{b.sent_count ?? '—'}</td>
                        <td style={{ color: (b.failed_count || 0) > 0 ? 'var(--red)' : 'inherit' }}>{b.failed_count ?? '—'}</td>
                        <td>{b.suppressed_count ?? '—'}</td>
                        <td><span className={`badge ${statusBadge[0]}`}>{statusBadge[1]}</span></td>
                        <td style={{ fontSize: 11, color: 'var(--text-3)' }}>{b.created_by?.name || '—'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {historyJobId && (
        <Modal
          title="דוח דיוור"
          onClose={() => { setHistoryJobId(null); fetchBroadcasts(); }}
        >
          <BroadcastSendFlow
            jobId={historyJobId}
            onExit={() => { setHistoryJobId(null); fetchBroadcasts(); }}
          />
        </Modal>
      )}

      {showListsModal && (
        <Modal
          title="עריכת רשימות תפוצה"
          onClose={() => !savingLists && setShowListsModal(false)}
          footer={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" disabled={savingLists} onClick={() => setShowListsModal(false)}>
                ביטול
              </button>
              <button type="button" className="btn btn-primary" disabled={savingLists} onClick={handleSaveListEdits}>
                {savingLists ? 'שומר...' : 'שמור שינויים'}
              </button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
              כאן אפשר לשנות שמות, להוסיף רשימות חדשות או למחוק רשימות קיימות.
            </div>

            {listsError && (
              <div className="alert alert-danger">
                <span>{listsError}</span>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {editingLists.map((list, idx) => (
                <div
                  key={list.key}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1.2fr auto auto',
                    gap: 8,
                    alignItems: 'center',
                    padding: 10,
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    background: 'rgba(255,255,255,0.02)',
                  }}
                >
                  <input
                    className="input input-sm"
                    value={list.label}
                    placeholder="שם הרשימה"
                    onChange={(e) => {
                      const next = [...editingLists];
                      next[idx] = { ...next[idx], label: e.target.value };
                      setEditingLists(next);
                    }}
                  />
                  <input
                    className="input input-sm"
                    value={list.description || ''}
                    placeholder="תיאור קצר (אופציונלי)"
                    onChange={(e) => {
                      const next = [...editingLists];
                      next[idx] = { ...next[idx], description: e.target.value };
                      setEditingLists(next);
                    }}
                  />
                  <AppSelect
                    className="input input-sm"
                    style={{ minWidth: 90 }}
                    value={list.color || 'var(--blue)'}
                    onChange={(e) => {
                      const next = [...editingLists];
                      next[idx] = { ...next[idx], color: e.target.value };
                      setEditingLists(next);
                    }}
                  >
                    {LIST_COLORS.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </AppSelect>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-icon"
                    title="מחק רשימה"
                    disabled={savingLists || editingLists.length <= 1}
                    onClick={() => handleDeleteList(list.key)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>הוספת רשימה חדשה</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr auto', gap: 8 }}>
                <input
                  className="input input-sm"
                  placeholder="שם הרשימה"
                  value={newListLabel}
                  onChange={(e) => setNewListLabel(e.target.value)}
                />
                <input
                  className="input input-sm"
                  placeholder="תיאור קצר"
                  value={newListDescription}
                  onChange={(e) => setNewListDescription(e.target.value)}
                />
                <button type="button" className="btn btn-primary btn-sm" disabled={savingLists} onClick={handleAddList} style={{ gap: 6 }}>
                  <Plus size={14} /> הוסף
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* SETTINGS & AI WORKBENCH */}
      {activeTab === 'settings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <BotMasterSwitch
          enabled={!!settings.aiResponderEnabled}
          saving={savingBotToggle}
          error={botToggleError}
          onToggle={handleBotToggle}
        />
        {/* One question per tab. The settings used to be a single form of 27
            fields, which is how a setting that no longer does anything can sit
            there for months without anybody noticing. */}
        {/* Same pill and the same seven-colour accent cycle as the tab bar
            above; the eighth tab starts the cycle again. */}
        <div className="tab-bar tab-bar-inline">
          {BOT_TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              className={`tab-pill ${botTab === key ? 'active' : ''}`}
              onClick={() => setBotTab(key)}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
        {botTab === 'open' && (
          <div className="card card-p">
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>מה הבוט השאיר פתוח</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 14, lineHeight: 1.6 }}>
              מי ממתין לצוות, אילו מעקבים עומדים לצאת, ומי ממתין לאישור המתנ״ס.
              לחיצה על שורה פותחת את כרטיס הלקוח.
            </div>
            <BotOpenItemsPanel />
          </div>
        )}

        {botTab === 'tools' && (
          <div className="card card-p">
            <BotCapabilitiesPanel disabled={!settings.aiResponderEnabled} />
          </div>
        )}

        {botTab === 'tone' && (
          <div className="card card-p">
            <BotToneSettings settings={settings} setSettings={setSettings} />
          </div>
        )}

        {botTab === 'schedule' && (
          <div className="card card-p">
            <BotScheduleSettings
              settings={settings}
              setSettings={setSettings}
              disabled={!settings.aiResponderEnabled}
            />
          </div>
        )}

        {botTab === 'handoff' && (
          <div className="card card-p">
            <BotHandoffSettings settings={settings} setSettings={setSettings} />
          </div>
        )}

        {botTab === 'sandbox' && (
          <>
          {/* AI Testing Workbench Playground */}
          <div className="card card-p" style={{ border: '1px solid rgba(99,102,241,0.25)', background: 'linear-gradient(135deg, rgba(99,102,241,0.02) 0%, rgba(168,85,247,0.02) 100%)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Sparkles size={18} style={{ color: '#A5B4FC' }} />
                <span className="section-title">ארגז חול לבדיקת מענה ה-AI</span>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={resettingPlayground || testingAi}
                onClick={handleResetPlayground}
                title="איפוס שיחת הבדיקה"
              >
                <RotateCcw size={14} />
                {resettingPlayground ? 'מאפס...' : 'איפוס שיחה'}
              </button>
            </div>

            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12 }}>
              שיחת ניסוי עם היסטוריה — אפשר להמשיך לענות לבוט. לא נשלח ללקוחות אמיתיים.
            </div>

            <div ref={workbenchMessagesRef} style={{
              height: 320,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: 12,
              marginBottom: 12,
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'rgba(0,0,0,0.18)',
            }}>
              {workbenchMessages.length === 0 && !testingAi && (
                <div style={{ margin: 'auto', fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>
                  התחילו שיחה — כתבו הודעה למטה
                </div>
              )}
              {workbenchMessages.map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: '85%',
                  }}
                >
                  <div style={{
                    background: msg.role === 'user'
                      ? 'rgba(99,102,241,0.22)'
                      : 'rgba(255,255,255,0.05)',
                    border: msg.role === 'bot' ? '1px solid var(--border)' : '1px solid rgba(99,102,241,0.35)',
                    padding: '8px 12px',
                    borderRadius: 10,
                    fontSize: 12,
                    lineHeight: 1.55,
                    whiteSpace: 'pre-wrap',
                  }}>
                    {msg.text}
                  </div>
                  <div style={{
                    fontSize: 9,
                    color: 'var(--text-3)',
                    marginTop: 3,
                    textAlign: msg.role === 'user' ? 'left' : 'right',
                  }}>
                    {msg.role === 'user' ? 'לקוח (בדיקה)' : 'בוט'}
                  </div>
                </div>
              ))}
              {testingAi && (
                <div style={{ alignSelf: 'flex-start', fontSize: 11, color: 'var(--text-3)' }}>
                  הבוט מקליד...
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder="כתבו הודעה כאילו אתם הלקוח..."
                value={workbenchInput}
                onChange={(e) => setWorkbenchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !testingAi && workbenchInput.trim()) {
                    e.preventDefault();
                    handleTestAiResponse();
                  }
                }}
                disabled={testingAi}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={testingAi || !workbenchInput.trim()}
                onClick={handleTestAiResponse}
              >
                <Send size={14} />
                {testingAi ? '...' : 'שלח'}
              </button>
            </div>
          </div>
          </>
        )}

        {botTab === 'learning' && <BotLearningPanel />}

        {botTab === 'journal' && (
          <div className="card card-p">
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>יומן הפעולות של הבוט</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12, lineHeight: 1.6 }}>
              כל מה שהבוט שינה וכל מה שהוא אמר, לפי סדר. „פעולות” הן שינויים
              במערכת, „הודעות” הן מה שנשלח ללקוח.
            </div>
            <BotActivityPanel />
          </div>
        )}
        </div>
      )}
    </div>
  );
}
