import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Send, Hash, History, Bot, CheckCircle, RefreshCw, Sparkles, Pencil, Plus, Trash2, FileText, Bookmark, RotateCcw, Target, Wrench, MessageSquareText, Clock, Headset, GraduationCap, ClipboardList, Inbox, Search, FilterX, Archive } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { Modal } from './UI.jsx';
import SegmentBuilder from './SegmentBuilder.jsx';
import { EMPTY_FILTERS } from './segmentFilters.js';
import TemplatesManager, { TemplatePreview, CategoryIcon, CATEGORIES } from './TemplatesManager.jsx';
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

// Only downloaded when the campaigns tab is opened.
const Campaigns = lazy(() => import('./Campaigns.jsx'));

const PLAYGROUND_PHONE = '0599111000';

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
  const [previewCount, setPreviewCount] = useState(0);
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const [sendResult, setSendResult] = useState(null);

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
      const response = await fetch('/api/whatsapp/broadcasts');
      if (response.ok) {
        const data = await response.json();
        setBroadcasts(data);
      }
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

  useEffect(() => {
    let cancelled = false;
    fetch('/api/broadcast/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters: segmentFilters }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setPreviewCount(d.count || 0);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [JSON.stringify(segmentFilters)]);

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

  const handleSendBroadcast = async () => {
    if (!selectedTemplate && !customMessage.trim()) {
      alert('בחרו תבנית מאושרת, או כתבו הודעה לנמענים עם חלון פתוח');
      return;
    }
    setSendingBroadcast(true);
    setSendResult(null);

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
        }),
      });

      const data = await response.json();
      if (response.ok && data.sent > 0) {
        setSendResult({
          success: true,
          sent: data.sent,
          failed: data.failed || 0,
          total: data.recipientCount || data.total,
          jobId: data.jobId,
        });
        setSelectedTemplate(null);
        setCustomMessage('');
      } else {
        setSendResult({
          success: false,
          error: data.error || 'השליחה נכשלה. לרוב האסימון של Meta פג תוקף.',
          sent: data.sent || 0,
          failed: data.failed || 0,
        });
      }
    } catch (err) {
      setSendResult({ success: false, error: 'שגיאה בחיבור' });
    } finally {
      setSendingBroadcast(false);
    }
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
              if (key === 'compose') setSendResult(null);
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
        sendResult && sendResult.success ? (
          <div className="fade-in" style={{ maxWidth: 500, margin: '0 auto', textAlign: 'center', paddingTop: 40 }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>📤</div>
            <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>הדיוור נשלח בהצלחה!</h2>
            <div className="alert alert-success" style={{ textAlign: 'right', marginBottom: 20 }}>
              <CheckCircle size={18} style={{ flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 600 }}>ההודעה הופצה ל-{sendResult.sent} נמענים</div>
                {sendResult.failed > 0 && (
                  <div style={{ fontSize: 12, marginTop: 4 }}>נכשלו: {sendResult.failed}</div>
                )}
              </div>
            </div>
            <button className="btn btn-ghost" onClick={() => setSendResult(null)}>דיוור חדש</button>
          </div>
        ) : sendResult && !sendResult.success ? (
          <div className="fade-in" style={{ maxWidth: 520, margin: '0 auto', textAlign: 'center', paddingTop: 40 }}>
            <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>הדיוור לא נשלח</h2>
            <div className="alert alert-danger" style={{ textAlign: 'right', marginBottom: 20 }}>
              <div style={{ fontWeight: 600 }}>{sendResult.error || 'שגיאה בשליחה'}</div>
              {(sendResult.sent != null || sendResult.failed != null) && (
                <div style={{ fontSize: 12, marginTop: 6 }}>
                  נשלחו: {sendResult.sent || 0} · נכשלו: {sendResult.failed || 0}
                </div>
              )}
            </div>
            <button className="btn btn-ghost" onClick={() => setSendResult(null)}>חזרה</button>
          </div>
        ) : (
          <div className="grid-21" style={{ gap: 20, alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              <div className="card card-p">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
                  <div className="section-title" style={{ marginBottom: 0 }}>רשימת תפוצה</div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={openListsModal} style={{ gap: 6 }}>
                    <Pencil size={13} /> עריכת רשימות
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className={`btn btn-sm ${selectedList === '' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setSelectedList('')}
                  >
                    <Hash size={13} /> כל הרשימות
                  </button>
                  {lists.map(l => (
                    <button key={l.key} className={`btn btn-sm ${selectedList === l.key ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setSelectedList(l.key)}>
                      <Hash size={13} /> {l.label}
                    </button>
                  ))}
                </div>
                {Array.isArray(segmentFilters.groupIds) && segmentFilters.groupIds.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 10, lineHeight: 1.45 }}>
                    נבחרו קבוצות — הדיוור יישלח לכל הרשומים בקבוצות, בלי תלות ברשימת התפוצה למעלה.
                  </div>
                )}
              </div>

              <div className="card card-p">
                <div className="section-title" style={{ marginBottom: 14 }}>פילוח קהל</div>
                <SegmentBuilder
                  parents={parents}
                  students={students}
                  groups={groups}
                  lists={lists}
                  filters={segmentFilters}
                  onChange={(next) => {
                    const hasGroups = Array.isArray(next.groupIds) && next.groupIds.length > 0;
                    setSegmentFilters({
                      ...next,
                      listKey: hasGroups ? '' : (selectedList || next.listKey || ''),
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
                  {[...(pinnedTemplate ? [pinnedTemplate] : []), ...visibleTemplates].map(tmpl => (
                    <div key={tmpl.id} className={`check-item ${selectedTemplate?.id === tmpl.id ? 'checked' : ''}`}
                      onClick={() => { setSelectedTemplate(selectedTemplate?.id === tmpl.id ? null : tmpl); setCustomMessage(''); }}
                      // .check-item is a flex row — left as-is, the name and the
                      // message body sit side by side instead of one under the other.
                      style={{ padding: 12, cursor: 'pointer', background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)', borderRadius: 8, opacity: tmpl.archived ? 0.72 : 1, flexDirection: 'column', alignItems: 'stretch', gap: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <CategoryIcon category={tmpl.category} />
                        <div style={{ fontWeight: 700, fontSize: 13, minWidth: 0 }}>{tmpl.name}</div>
                        {tmpl.archived && (
                          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: 5, padding: '1px 6px' }}>
                            ארכיון
                          </span>
                        )}
                      </div>
                      {tmpl.metaName && tmpl.metaName !== tmpl.name && (
                        <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 3, direction: 'ltr', textAlign: 'right', fontFamily: 'monospace' }}>
                          {tmpl.metaName}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {tmpl.text}
                      </div>
                    </div>
                  ))}
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
                </div>
              </div>

              <div className="card card-p">
                <div className="section-title" style={{ marginBottom: 10 }}>הודעה חופשית (רק לנמענים עם חלון 24ש פתוח)</div>
                <textarea className="input textarea" rows={4} placeholder="כתוב הודעה..."
                  value={customMessage} onChange={e => { setCustomMessage(e.target.value); setSelectedTemplate(null); }} />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              <div className="card card-p">
                <TemplatePreview draft={previewDraft} varMeta={previewVarMeta} />
              </div>

              <button className="btn btn-primary btn-full" style={{ paddingBlock: 14 }} onClick={handleSendBroadcast}
                disabled={(!messageText || !String(messageText).trim()) || sendingBroadcast || previewCount === 0}>
                {sendingBroadcast ? '⏳ שולח...' : `שלח ל-${previewCount} נמענים`}
              </button>
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
                  <th>רשימה</th>
                  <th>הודעה</th>
                  <th>תאריך</th>
                  <th>נמענים</th>
                  <th>סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {broadcasts.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>אין קמפיינים בהיסטוריה</td></tr>
                ) : (
                  broadcasts.map(b => (
                    <tr key={b.id}>
                      <td style={{ fontWeight: 700 }}>{b.campaign_name}</td>
                      <td>{b.list_name}</td>
                      <td style={{ maxWidth: 200, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{b.message_text}</td>
                      <td>{new Date(b.created_at).toLocaleDateString('he-IL')}</td>
                      <td>{b.recipient_count}</td>
                      <td><span className="badge badge-green">{b.status}</span></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
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
