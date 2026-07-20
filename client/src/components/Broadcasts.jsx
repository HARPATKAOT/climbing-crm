import React, { useState, useEffect, useRef } from 'react';
import { Send, Hash, History, Settings, Smartphone, CheckCircle, RefreshCw, Sparkles, Pencil, Plus, Trash2, FileText, Bookmark } from 'lucide-react';
import { Modal } from './UI.jsx';
import SegmentBuilder, { EMPTY_FILTERS } from './SegmentBuilder.jsx';
import TemplatesManager from './TemplatesManager.jsx';
import SavedRepliesManager from './SavedRepliesManager.jsx';

const DEFAULT_LISTS = [
  { key: 'general', label: 'כללי', description: 'עדכונים שוטפים', color: 'var(--blue)' },
  { key: 'classes', label: 'חוגים', description: 'שינויי שעות וכדומה', color: 'var(--green)' },
  { key: 'trips',   label: 'טיולים', description: 'טיולי סנפלינג/חוץ', color: 'var(--amber)' },
  { key: 'events',  label: 'אירועים', description: 'אירועים ותחרויות מועדון', color: 'var(--purple)' },
];

const LIST_COLORS = [
  { value: 'var(--blue)', label: 'כחול' },
  { value: 'var(--green)', label: 'ירוק' },
  { value: 'var(--amber)', label: 'כתום' },
  { value: 'var(--purple)', label: 'סגול' },
];

const WA_TEMPLATES = [];

const DAY_OPTIONS = [
  { value: 0, label: 'א׳' },
  { value: 1, label: 'ב׳' },
  { value: 2, label: 'ג׳' },
  { value: 3, label: 'ד׳' },
  { value: 4, label: 'ה׳' },
  { value: 5, label: 'ו׳' },
  { value: 6, label: 'ש׳' },
];

export default function Broadcasts({ parents, students, groups = [] }) {
  const [activeTab, setActiveTab] = useState('compose'); // compose | templates | saved | history | simulator | settings
  
  // Compose / Send State
  const [lists, setLists] = useState(DEFAULT_LISTS);
  const [selectedList, setSelectedList] = useState('general');
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [approvedTemplates, setApprovedTemplates] = useState([]);
  const [customMessage, setCustomMessage] = useState('');
  const [segmentFilters, setSegmentFilters] = useState({ ...EMPTY_FILTERS, listKey: 'general' });
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
    aiSystemPrompt: 'אתה עוזר שירות לקוחות אינטליגנטי עבור קיר הטיפוס My Wall בירושלים. ענה בעברית מנומסת וקצרה. מחירון כניסות: כניסת יחיד מבוגר 50 ש"ח, ילד (עד 18) 40 ש"ח. כרטיסיית 10 כניסות 400 ש"ח. מנוי חודשי 220 ש"ח.',
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const [saveSettingsSuccess, setSaveSettingsSuccess] = useState(false);

  // WhatsApp Coexistence connect state
  const [waStatus, setWaStatus] = useState({ connected: false });
  const [waConnectConfig, setWaConnectConfig] = useState({ configured: false, appId: '', configId: '', checklist: [] });
  const [waConnectError, setWaConnectError] = useState('');
  const [waConnectSuccess, setWaConnectSuccess] = useState('');
  const [activatingWa, setActivatingWa] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testingSend, setTestingSend] = useState(false);
  
  // AI Workbench Simulator State
  const [workbenchInput, setWorkbenchInput] = useState('');
  const [workbenchOutput, setWorkbenchOutput] = useState('');
  const [testingAi, setTestingAi] = useState(false);

  // Chat Log & Simulator State
  const [chatLogs, setChatLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  
  // Simulator specific
  const [simChannel, setSimChannel] = useState('whatsapp'); // 'whatsapp' | 'instagram'
  const [simPhone, setSimPhone] = useState('0547654321');
  const [simIgId, setSimIgId] = useState('moti_climber');
  const [simIgName, setSimIgName] = useState('מוטי מטפס (אינסטגרם)');
  const [simInput, setSimInput] = useState('');
  const [simSending, setSimSending] = useState(false);
  const [selectedSimThread, setSelectedSimThread] = useState('0547654321');

  const phoneMessagesEndRef = useRef(null);

  const coexistenceLabel = () => {
    if (waStatus.coexistenceEnabled || waStatus.isOnBizApp) return 'פעיל (טלפון + מערכת)';
    if (waStatus.connected) return 'לא עודכן — לחצו «רענן סטטוס»';
    return 'לא פעיל';
  };

  const toggleActiveDay = (day) => {
    const current = Array.isArray(settings.aiActiveDays) ? settings.aiActiveDays : [];
    const next = current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day].sort((a, b) => a - b);
    setSettings({ ...settings, aiActiveDays: next.length ? next : [day] });
  };

  const fetchLists = async () => {
    try {
      const response = await fetch('/api/broadcast-list-defs');
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          setLists(data);
          setSelectedList((prev) => (data.some((l) => l.key === prev) ? prev : data[0].key));
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
      setSelectedList((prev) => (next.some((l) => l.key === prev) ? prev : next[0]?.key));
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

  const fetchWaStatus = async (refresh = false) => {
    try {
      const response = await fetch(`/api/whatsapp/status${refresh ? '?refresh=1' : ''}`);
      if (response.ok) {
        const data = await response.json();
        setWaStatus(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchWaConnectConfig = async () => {
    try {
      const response = await fetch('/api/whatsapp/connect-config');
      if (response.ok) {
        const data = await response.json();
        setWaConnectConfig(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleActivateWhatsApp = async () => {
    setActivatingWa(true);
    setWaConnectError('');
    setWaConnectSuccess('');
    try {
      const response = await fetch('/api/whatsapp/activate', { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'אימות החיבור נכשל');
      }
      setWaStatus(data.status || { connected: true });
      setWaConnectSuccess('החיבור הישיר מול Meta אומת וקבלת ההודעות הופעלה');
    } catch (err) {
      setWaConnectError(err.message || 'אימות החיבור נכשל');
    } finally {
      setActivatingWa(false);
    }
  };

  const handleTestWhatsAppSend = async () => {
    if (!testPhone.trim()) {
      alert('הזינו מספר לבדיקה');
      return;
    }
    setTestingSend(true);
    setWaConnectError('');
    try {
      const response = await fetch('/api/whatsapp/send-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: testPhone.trim(), templateId: 'hello_world' }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        setWaConnectSuccess('הודעת בדיקה נשלחה בהצלחה');
      } else {
        setWaConnectError(data.error || 'שליחת בדיקה נכשלה');
      }
    } catch {
      setWaConnectError('שגיאת רשת בשליחת בדיקה');
    } finally {
      setTestingSend(false);
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

  const fetchChatLogs = async () => {
    setLoadingLogs(true);
    try {
      const response = await fetch('/api/whatsapp/logs');
      if (response.ok) {
        const data = await response.json();
        setChatLogs(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    fetchLists();
    fetchSettings();
    fetchChatLogs();
    fetchWaStatus();
    fetchWaConnectConfig();
    fetchApprovedTemplates();
  }, []);

  const fetchApprovedTemplates = async () => {
    try {
      const res = await fetch('/api/message-templates?approved=1');
      const data = res.ok ? await res.json() : [];
      const remote = Array.isArray(data) ? data.map((t) => ({
        id: t.meta_name || t.name,
        name: t.name || t.meta_name,
        text: t.body || '',
        language: t.language,
      })) : [];
      setApprovedTemplates(remote.length ? remote : WA_TEMPLATES);
    } catch {
      setApprovedTemplates(WA_TEMPLATES);
    }
  };

  useEffect(() => {
    if (activeTab === 'history') {
      fetchBroadcasts();
    } else if (activeTab === 'simulator') {
      fetchChatLogs();
    } else if (activeTab === 'templates') {
      fetchApprovedTemplates();
    }
  }, [activeTab]);

  useEffect(() => {
    if (phoneMessagesEndRef.current) {
      phoneMessagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatLogs, selectedSimThread]);

  useEffect(() => {
    setSegmentFilters((prev) => ({ ...prev, listKey: selectedList || '' }));
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

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setSavingSettings(true);
    setSaveSettingsSuccess(false);
    try {
      const response = await fetch('/api/whatsapp/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      if (response.ok) {
        setSaveSettingsSuccess(true);
        setTimeout(() => setSaveSettingsSuccess(false), 3000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSavingSettings(false);
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

    try {
      const response = await fetch('/api/broadcast/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignName,
          listName: selectedList,
          templateId: selectedTemplate?.id || null,
          customMessage: selectedTemplate ? null : customMessage,
          filters: { ...segmentFilters, listKey: selectedList || segmentFilters.listKey },
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
        fetchChatLogs();
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

  const handleSimSend = async (e) => {
    e.preventDefault();
    if (!simInput.trim()) return;

    setSimSending(true);
    const messageToSend = simInput;
    setSimInput('');

    try {
      const endpoint = simChannel === 'instagram' ? '/api/instagram/simulate-incoming' : '/api/whatsapp/simulate-incoming';
      const bodyPayload = simChannel === 'instagram'
        ? { igId: simIgId, message: messageToSend, name: simIgName }
        : { phone: simPhone, message: messageToSend };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload)
      });

      if (response.ok) {
        const targetThread = simChannel === 'instagram' ? simIgId : simPhone;
        setSelectedSimThread(targetThread);
        setTimeout(async () => {
          await fetchChatLogs();
          setSimSending(false);
        }, 800);
      } else {
        setSimSending(false);
      }
    } catch (err) {
      console.error(err);
      setSimSending(false);
    }
  };

  // Test AI bot reply directly in the workbench console
  const handleTestAiResponse = async () => {
    if (!workbenchInput.trim()) return;
    setTestingAi(true);
    setWorkbenchOutput('');
    try {
      const response = await fetch('/api/whatsapp/simulate-incoming', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: '0599999999',
          message: workbenchInput
        })
      });
      if (response.ok) {
        const data = await response.json();
        setWorkbenchOutput(data.reply || 'הבוט סירב לענות או החזיר תשובה ריקה.');
      } else {
        setWorkbenchOutput('שגיאה בתקשורת עם מנוע ה-AI');
      }
    } catch (err) {
      setWorkbenchOutput('שגיאה בחיבור לשרת ה-API');
    } finally {
      setTestingAi(false);
    }
  };

  const threadMessages = chatLogs
    .filter(log => log.phone === selectedSimThread)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const threads = chatLogs.reduce((acc, current) => {
    const existing = acc.find(item => item.phone === current.phone);
    if (!existing) {
      acc.push({
        phone: current.phone,
        lastMessage: current.message,
        lastTime: current.created_at
      });
    }
    return acc;
  }, []);

  if (simPhone && !threads.some(t => t.phone === simPhone)) {
    threads.unshift({
      phone: simPhone,
      lastMessage: 'הקש הודעה בסימולטור כדי להתחיל שיחה...',
      lastTime: new Date().toISOString()
    });
  }
  if (simIgId && !threads.some(t => t.phone === simIgId)) {
    threads.unshift({
      phone: simIgId,
      lastMessage: 'הודעת DM מאינסטגרם...',
      lastTime: new Date().toISOString()
    });
  }

  return (
    <div className="fade-in">
      <div className="section-header" style={{ marginBottom: 16 }}>
        <div>
          <div className="section-title">מערכת דיוור וואטסאפ ובוט AI</div>
          <div className="section-sub">אינטגרציה לדיוור מסיבי וניהול מענה בינה מלאכותית אוטומטי ללקוחות</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 10, flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${activeTab === 'compose' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setActiveTab('compose'); setSendResult(null); }}>
          <Send size={14} /> שליחת דיוור
        </button>
        <button className={`btn btn-sm ${activeTab === 'templates' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTab('templates')}>
          <FileText size={14} /> תבניות Meta
        </button>
        <button className={`btn btn-sm ${activeTab === 'saved' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTab('saved')}>
          <Bookmark size={14} /> הודעות שמורות
        </button>
        <button className={`btn btn-sm ${activeTab === 'history' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTab('history')}>
          <History size={14} /> היסטוריית קמפיינים
        </button>
        <button className={`btn btn-sm ${activeTab === 'simulator' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTab('simulator')}>
          <Smartphone size={14} /> סימולטור שיחות
        </button>
        <button className={`btn btn-sm ${activeTab === 'settings' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTab('settings')}>
          <Settings size={14} /> הגדרות ואימון AI
        </button>
      </div>

      {activeTab === 'templates' && <TemplatesManager />}
      {activeTab === 'saved' && <SavedRepliesManager />}

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
          <div className="grid-12" style={{ gap: 20, alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, gridColumn: 'span 7' }}>
              <div className="card card-p">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
                  <div className="section-title" style={{ marginBottom: 0 }}>רשימת תפוצה</div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={openListsModal} style={{ gap: 6 }}>
                    <Pencil size={13} /> עריכת רשימות
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {lists.map(l => (
                    <button key={l.key} className={`btn btn-sm ${selectedList === l.key ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setSelectedList(l.key)}>
                      <Hash size={13} /> {l.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="card card-p">
                <div className="section-title" style={{ marginBottom: 14 }}>פילוח קהל</div>
                <SegmentBuilder
                  parents={parents}
                  students={students}
                  groups={groups}
                  lists={lists}
                  filters={segmentFilters}
                  onChange={setSegmentFilters}
                />
              </div>

              <div className="card card-p">
                <div className="section-title" style={{ marginBottom: 14 }}>תבניות מאושרות</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(approvedTemplates.length ? approvedTemplates : WA_TEMPLATES).map(tmpl => (
                    <div key={tmpl.id} className={`check-item ${selectedTemplate?.id === tmpl.id ? 'checked' : ''}`}
                      onClick={() => { setSelectedTemplate(selectedTemplate?.id === tmpl.id ? null : tmpl); setCustomMessage(''); }}
                      style={{ padding: 12, cursor: 'pointer', background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)', borderRadius: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{tmpl.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>{tmpl.text}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 10 }}>
                  לניהול והגשת תבניות חדשות — עברו לטאב «תבניות Meta».
                </div>
              </div>

              <div className="card card-p">
                <div className="section-title" style={{ marginBottom: 10 }}>הודעה חופשית (רק לנמענים עם חלון 24ש פתוח)</div>
                <textarea className="input textarea" rows={4} placeholder="כתוב הודעה..."
                  value={customMessage} onChange={e => { setCustomMessage(e.target.value); setSelectedTemplate(null); }} />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, gridColumn: 'span 5' }}>
              <div className="card card-p" style={{ background: 'rgba(16,185,129,0.03)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <span style={{ color: 'var(--green)' }}>📝</span>
                  <div className="section-title">תצוגה מקדימה</div>
                </div>
                <div style={{ background: 'rgba(16,185,129,0.06)', padding: 16, borderRadius: 8, fontSize: 13, minHeight: 80 }}>
                  {messageText || 'בחר תבנית או כתוב הודעה...'}
                </div>
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

      {/* SIMULATOR */}
      {activeTab === 'simulator' && (
        <div className="grid-12" style={{ gap: 20, alignItems: 'flex-start' }}>
          <div className="card" style={{ gridColumn: 'span 7', display: 'flex', flexDirection: 'column', height: '540px' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className="section-title" style={{ fontSize: 14 }}>יומן צ׳אט וסימולטור פעיל</span>
                <div style={{ display: 'flex', background: 'var(--bg-2)', borderRadius: 8, padding: 2 }}>
                  <button type="button" className={`btn btn-xs ${simChannel === 'whatsapp' ? 'btn-success' : 'btn-ghost'}`}
                    onClick={() => { setSimChannel('whatsapp'); setSelectedSimThread(simPhone); }} style={{ gap: 4, padding: '4px 8px' }}>
                    💬 WhatsApp
                  </button>
                  <button type="button" className={`btn btn-xs ${simChannel === 'instagram' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => { setSimChannel('instagram'); setSelectedSimThread(simIgId); }} style={{ gap: 4, padding: '4px 8px', background: simChannel === 'instagram' ? 'linear-gradient(45deg, #f09433, #dc2743, #bc1888)' : undefined, color: simChannel === 'instagram' ? 'white' : undefined }}>
                    📱 Instagram DM
                  </button>
                </div>
              </div>
              <button className="btn btn-ghost btn-xs" onClick={fetchChatLogs}><RefreshCw size={12} /></button>
            </div>
            
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              <div style={{ width: '180px', borderLeft: '1px solid var(--border)', overflowY: 'auto' }}>
                {threads.map(t => {
                  const isIg = t.phone?.includes('ig_') || t.phone?.includes('_ig') || t.phone?.includes('climber');
                  return (
                    <div key={t.phone} onClick={() => setSelectedSimThread(t.phone)}
                      style={{ padding: 12, borderBottom: '1px solid var(--border)', cursor: 'pointer', background: selectedSimThread === t.phone ? 'rgba(99,102,241,0.08)' : undefined }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13 }}>{isIg ? '📱' : '💬'}</span>
                        <div style={{ fontWeight: 'bold', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.phone}</div>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-3)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', marginTop: 4 }}>{t.lastMessage}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#090d16', padding: 12 }}>
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {threadMessages.map(msg => (
                    <div key={msg.id} style={{ alignSelf: msg.direction === 'inbound' ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
                      <div style={{ background: msg.direction === 'inbound' ? (msg.channel === 'instagram' ? 'linear-gradient(135deg, rgba(225,48,108,0.2), rgba(193,53,132,0.2))' : 'rgba(99,102,241,0.15)') : 'rgba(255,255,255,0.05)', border: msg.channel === 'instagram' && msg.direction === 'inbound' ? '1px solid rgba(225,48,108,0.4)' : undefined, padding: '8px 12px', borderRadius: 10, fontSize: 12 }}>
                        {msg.message}
                        {msg.is_ai && <span style={{ display: 'block', fontSize: 9, color: msg.channel === 'instagram' ? '#ff80bf' : 'var(--green)', marginTop: 4 }}>🤖 מענה אוטומטי AI ({msg.channel === 'instagram' ? 'אינסטגרם' : 'וואטסאפ'})</span>}
                      </div>
                    </div>
                  ))}
                  <div ref={phoneMessagesEndRef} />
                </div>
              </div>
            </div>
          </div>

          <div style={{ gridColumn: 'span 5', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ width: '100%', maxWidth: '300px', height: '540px', border: '8px solid #1f2937', borderRadius: 24, background: simChannel === 'instagram' ? '#000000' : '#e5ddd5', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
              <div style={{ background: simChannel === 'instagram' ? 'linear-gradient(90deg, #833ab4, #fd1d1d, #fcb045)' : '#075e54', color: 'white', padding: 10, fontSize: 12, fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 24, height: 24, borderRadius: '50%', background: simChannel === 'instagram' ? 'rgba(255,255,255,0.2)' : '#128c7e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>{simChannel === 'instagram' ? '📸' : 'MW'}</div>
                  <span>{simChannel === 'instagram' ? 'My Wall Instagram DM' : 'תמיכה My Wall 🧗'}</span>
                </div>
                <span style={{ fontSize: 10, opacity: 0.85 }}>{simChannel === 'instagram' ? 'Active now' : 'מחובר'}</span>
              </div>

              {simChannel === 'instagram' && (
                <div style={{ background: '#121212', padding: '6px 10px', borderBottom: '1px solid #262626', display: 'flex', gap: 6, fontSize: 11 }}>
                  <input className="input input-sm" style={{ flex: 1, background: '#262626', color: 'white', fontSize: 11 }} placeholder="IG Username (לדוגמה: moti_ig)" value={simIgId} onChange={e => setSimIgId(e.target.value)} />
                  <input className="input input-sm" style={{ flex: 1.2, background: '#262626', color: 'white', fontSize: 11 }} placeholder="שם מלא (מוטי)" value={simIgName} onChange={e => setSimIgName(e.target.value)} />
                </div>
              )}

              <div style={{ flex: 1, padding: 10, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, direction: 'rtl' }}>
                {threadMessages.map(msg => (
                  <div key={msg.id} style={{ alignSelf: msg.direction === 'inbound' ? 'flex-start' : 'flex-end', background: msg.direction === 'inbound' ? (simChannel === 'instagram' ? '#262626' : '#d9fdd3') : (simChannel === 'instagram' ? 'linear-gradient(45deg, #7b4397, #dc2430)' : '#ffffff'), padding: '8px 12px', borderRadius: 14, fontSize: 11, maxWidth: '85%', color: simChannel === 'instagram' || msg.direction !== 'inbound' ? (simChannel === 'instagram' && msg.direction === 'inbound' ? '#ffffff' : '#ffffff') : '#111827', borderBottomLeftRadius: msg.direction === 'inbound' ? 4 : 14, borderBottomRightRadius: msg.direction === 'inbound' ? 14 : 4 }}>
                    {msg.message}
                  </div>
                ))}
                {simSending && <span style={{ fontSize: 10, color: 'var(--text-3)' }}>✍️ הבוט מנתח ומקליד...</span>}
              </div>
              <form onSubmit={handleSimSend} style={{ background: simChannel === 'instagram' ? '#121212' : '#f0f2f5', padding: 8, display: 'flex', gap: 6, borderTop: simChannel === 'instagram' ? '1px solid #262626' : undefined }}>
                <input className="input" style={{ fontSize: 12, padding: 8, background: simChannel === 'instagram' ? '#262626' : 'white', color: simChannel === 'instagram' ? 'white' : 'black' }} placeholder={simChannel === 'instagram' ? 'שלח DM באינסטגרם...' : 'שלח הודעה כלקוח...'} value={simInput} onChange={e => setSimInput(e.target.value)} />
                <button type="submit" className="btn btn-primary btn-sm btn-icon" disabled={simSending} style={{ background: simChannel === 'instagram' ? 'linear-gradient(45deg, #f09433, #dc2743)' : undefined }}>Go</button>
              </form>
            </div>
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
                  <select
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
                  </select>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="grid-2" style={{ gap: 20, alignItems: 'flex-start' }}>
          {/* Settings Form — WhatsApp connect first */}
          <div className="card card-p">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <Settings size={18} style={{ color: 'var(--blue)' }} />
              <span className="section-title">אימון בוט ה-AI והגדרות API</span>
            </div>

            {saveSettingsSuccess && (
              <div className="alert alert-success" style={{ marginBottom: 16 }}>
                <span>ההגדרות נשמרו בהצלחה! ✓</span>
              </div>
            )}

            {/* WhatsApp connect — primary action in this screen */}
            <div style={{
              border: '1px solid rgba(37,211,102,0.45)',
              background: 'rgba(37,211,102,0.06)',
              borderRadius: 12,
              padding: 14,
              marginBottom: 18,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Smartphone size={18} style={{ color: '#25D366' }} />
                  <span style={{ fontWeight: 700, fontSize: 14 }}>חיבור WhatsApp של העסק</span>
                </div>
                <span style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: 999,
                  background: waStatus.connected ? 'rgba(37,211,102,0.2)' : 'rgba(239,68,68,0.15)',
                  color: waStatus.connected ? '#25D366' : '#F87171',
                }}>
                  {waStatus.connected ? 'מחובר' : 'לא מחובר'}
                </span>
              </div>

              <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.65, marginBottom: 12 }}>
                החיבור נעשה ישירות מול Meta באמצעות הגדרות השרת.
                לאחר ההעברה אפשר לענות מהטלפון ומהמערכת, והשיחה תופיע בתיק הלקוח.
              </p>

              <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.7, marginBottom: 12 }}>
                <div style={{ fontWeight: 700, color: 'var(--text-2)', marginBottom: 4 }}>איך מחברים:</div>
                <ol style={{ margin: '0 18px', padding: 0 }}>
                  <li>השלימו את העברת המספר בחשבון העסקי של Meta.</li>
                  <li>שמרו את מזהי החשבון ואת האסימון הקבוע בהגדרות השרת.</li>
                  <li>הגדירו ב-Meta את כתובת קבלת ההודעות ולחצו כאן על רענון.</li>
                </ol>
              </div>

              {waStatus.connected && (
                <div style={{ display: 'grid', gap: 6, marginBottom: 12, fontSize: 12 }}>
                  <div><strong>מספר:</strong> {waStatus.displayPhone || waStatus.phoneNumberId || '—'}</div>
                  {waStatus.verifiedName && <div><strong>שם מאומת:</strong> {waStatus.verifiedName}</div>}
                  <div><strong>טלפון + מערכת:</strong> {coexistenceLabel()}</div>
                </div>
              )}

              {waConnectSuccess && (
                <div className="alert alert-success" style={{ marginBottom: 10 }}>
                  <span>{waConnectSuccess}</span>
                </div>
              )}
              {waConnectError && (
                <div className="alert alert-danger" style={{ marginBottom: 10 }}>
                  <span>{waConnectError}</span>
                </div>
              )}

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                {(waConnectConfig.canActivate || waConnectConfig.configured) && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleActivateWhatsApp}
                    disabled={activatingWa}
                    style={{ background: '#25D366', borderColor: '#25D366' }}
                  >
                    {activatingWa ? 'מאמת...' : 'אמת והפעל חיבור'}
                  </button>
                )}
                <button type="button" className="btn btn-ghost" onClick={() => fetchWaStatus(true)}>
                  <RefreshCw size={14} /> רענן סטטוס
                </button>
              </div>

              {waStatus.connected && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
                  <input
                    className="input input-sm"
                    style={{ maxWidth: 180 }}
                    placeholder="מספר לבדיקה (05...)"
                    value={testPhone}
                    onChange={e => setTestPhone(e.target.value)}
                  />
                  <button type="button" className="btn btn-sm btn-success" onClick={handleTestWhatsAppSend} disabled={testingSend}>
                    {testingSend ? 'שולח...' : 'בדוק שליחה'}
                  </button>
                </div>
              )}

              <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.65, marginTop: 4 }}>
                <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--text-2)' }}>Webhook לקבלת הודעות (חד-פעמי ב-Meta):</div>
                <ol style={{ margin: '0 18px', padding: 0 }}>
                  <li>הגדירו Callback URL ל-<code style={{ color: 'var(--blue)' }}>/api/whatsapp/webhook</code> בשרת שלכם.</li>
                  <li>הזינו ב-Meta את אסימון האימות ששמור בהגדרות השרת.</li>
                  <li>סמנו: <code style={{ color: '#25D366' }}>messages</code>, <code style={{ color: '#25D366' }}>smb_message_echoes</code>, <code style={{ color: '#25D366' }}>history</code></li>
                </ol>
                {Array.isArray(waConnectConfig.missingRequired) && waConnectConfig.missingRequired.length > 0 && (
                  <div style={{ marginTop: 8, padding: 8, borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
                    <strong style={{ color: '#F87171' }}>חסרים ערכים הכרחיים בשרת לשליחת הודעות:</strong>{' '}
                    <code>{waConnectConfig.missingRequired.join(', ')}</code>
                  </div>
                )}
                {waConnectConfig.messagingReady && Array.isArray(waConnectConfig.missingRecommended) && waConnectConfig.missingRecommended.length > 0 && (
                  <div style={{ marginTop: 8, padding: 8, borderRadius: 8, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
                    <strong style={{ color: '#FBBF24' }}>מומלץ להשלים בשרת (לא חוסם שליחה):</strong>{' '}
                    <code>{waConnectConfig.missingRecommended.join(', ')}</code>
                  </div>
                )}
              </div>
            </div>

            <div style={{
              border: '1px solid rgba(0,132,255,0.35)',
              background: 'rgba(0,132,255,0.06)',
              borderRadius: 12,
              padding: 14,
              marginBottom: 18,
            }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>חיבור מסנג׳ר (דף פייסבוק)</div>
              <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 10, lineHeight: 1.6 }}>
                כדי לקבל ולשלוח הודעות מסנג׳ר מתוך תיק הלקוח, שמרו כאן את מזהה הדף.
                את אסימון הדף עדיף לשמור בהגדרות השרת.
              </p>
              <input
                className="input input-sm"
                placeholder="מזהה דף פייסבוק"
                value={settings.metaPageId || ''}
                onChange={(e) => setSettings({ ...settings, metaPageId: e.target.value })}
              />
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>
                משתני שרת: <code>META_PAGE_ID</code> ו-<code>META_PAGE_ACCESS_TOKEN</code>
              </div>
            </div>

            <form onSubmit={handleSaveSettings} className="form-grid" style={{ gap: 14 }}>
              <div style={{
                border: `1px solid ${settings.aiResponderEnabled ? 'rgba(37,211,102,0.45)' : 'rgba(239,68,68,0.35)'}`,
                background: settings.aiResponderEnabled ? 'rgba(37,211,102,0.06)' : 'rgba(239,68,68,0.06)',
                borderRadius: 12,
                padding: 14,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>מענה אוטומטי של הבוט</div>
                    <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                      {settings.aiResponderEnabled
                        ? 'הבוט פעיל — עונה אוטומטית להודעות נכנסות'
                        : 'הבוט כבוי — לא יישלח מענה אוטומטי'}
                    </div>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={!!settings.aiResponderEnabled}
                      onChange={e => setSettings({ ...settings, aiResponderEnabled: e.target.checked })}
                      style={{ width: 20, height: 20 }}
                    />
                    {settings.aiResponderEnabled ? 'פעיל' : 'כבוי'}
                  </label>
                </div>

                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
                    <input
                      type="checkbox"
                      checked={!!settings.aiActiveHoursEnabled}
                      onChange={e => setSettings({ ...settings, aiActiveHoursEnabled: e.target.checked })}
                      disabled={!settings.aiResponderEnabled}
                      style={{ width: 18, height: 18 }}
                    />
                    הגבלת שעות פעילות
                  </label>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 10, lineHeight: 1.5 }}>
                    מחוץ לשעות האלה הבוט לא יענה (לפי שעון ישראל). בדיקת המענה במסך הזה תמשיך לעבוד גם מחוץ לשעות.
                  </div>
                  <div className="form-grid-2" style={{ opacity: settings.aiResponderEnabled && settings.aiActiveHoursEnabled ? 1 : 0.45, pointerEvents: settings.aiResponderEnabled && settings.aiActiveHoursEnabled ? 'auto' : 'none' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: 11 }}>משעה</label>
                      <input
                        className="input input-sm"
                        type="time"
                        value={settings.aiActiveHoursStart || '09:00'}
                        onChange={e => setSettings({ ...settings, aiActiveHoursStart: e.target.value })}
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: 11 }}>עד שעה</label>
                      <input
                        className="input input-sm"
                        type="time"
                        value={settings.aiActiveHoursEnd || '21:00'}
                        onChange={e => setSettings({ ...settings, aiActiveHoursEnd: e.target.value })}
                      />
                    </div>
                  </div>
                  <div style={{ marginTop: 10, opacity: settings.aiResponderEnabled && settings.aiActiveHoursEnabled ? 1 : 0.45, pointerEvents: settings.aiResponderEnabled && settings.aiActiveHoursEnabled ? 'auto' : 'none' }}>
                    <div className="form-label" style={{ fontSize: 11, marginBottom: 6 }}>ימים פעילים</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {DAY_OPTIONS.map((day) => {
                        const active = (settings.aiActiveDays || []).includes(day.value);
                        return (
                          <button
                            key={day.value}
                            type="button"
                            onClick={() => toggleActiveDay(day.value)}
                            style={{
                              minWidth: 36,
                              padding: '6px 8px',
                              borderRadius: 8,
                              border: active ? '1px solid rgba(37,211,102,0.55)' : '1px solid var(--border)',
                              background: active ? 'rgba(37,211,102,0.18)' : 'transparent',
                              color: 'var(--text)',
                              fontWeight: 700,
                              fontSize: 12,
                              cursor: 'pointer',
                            }}
                          >
                            {day.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">הנחיות אימון למענה ה-AI (System Prompt)</label>
                <textarea className="input textarea" rows={6} style={{ fontSize: 12, lineHeight: 1.5 }}
                  value={settings.aiSystemPrompt} onChange={e => setSettings({ ...settings, aiSystemPrompt: e.target.value })} />
                <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
                  הסבר ל-AI כיצד להציג את הקיר, אלו מחירים לתת, וכיצד להתנסח (למשל: לתת קישורי רישום).
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 4 }}>
                <div style={{ fontWeight: 'bold', fontSize: 13, marginBottom: 10, color: '#E1306C', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>📸 חיבור וקליטת הודעות אינסטגרם (Instagram DM Webhook)</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12, lineHeight: 1.6 }}>
                  כדי שפניות והודעות פרטיות מאינסטגרם יפתחו אוטומטית ליד במערכת ויקבלו מענה AI:
                  <ol style={{ margin: '6px 20px', padding: 0 }}>
                    <li>היכנסו לפורטל המפתחים של Meta או להגדרות Instagram Graph API.</li>
                    <li>הגדירו את כתובת ה-Webhook ל-<code style={{ color: 'var(--blue)' }}>https://YOUR_SERVER_URL/api/instagram/webhook</code> (או לכתובת המנהרת Pinggy שלכם).</li>
                    <li>הזינו את אסימון האימות ששמור בהגדרות השרת.</li>
                    <li>סמנו תחת אירועי Webhook את <code style={{ color: '#ff80bf' }}>messages</code> ואת <code style={{ color: '#ff80bf' }}>messaging_postbacks</code>.</li>
                  </ol>
                </div>
                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="form-label" style={{ fontSize: 11 }}>Instagram Account ID (IG Business ID)</label>
                    <input className="input input-sm" placeholder="17841400000000000" value={settings.metaIgAccountId || ''} onChange={e => setSettings({ ...settings, metaIgAccountId: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" style={{ fontSize: 11 }}>Instagram Access Token</label>
                    <input className="input input-sm" type="password" placeholder="EAAGb..." value={settings.metaIgAccessToken || ''} onChange={e => setSettings({ ...settings, metaIgAccessToken: e.target.value })} />
                  </div>
                </div>
              </div>

              <button type="submit" className="btn btn-primary btn-full" disabled={savingSettings}>
                {savingSettings ? 'שומר...' : 'שמור הגדרות בוט ואינסטגרם'}
              </button>
            </form>
          </div>

          {/* AI Testing Workbench Playground */}
          <div className="card card-p" style={{ border: '1px solid rgba(99,102,241,0.25)', background: 'linear-gradient(135deg, rgba(99,102,241,0.02) 0%, rgba(168,85,247,0.02) 100%)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Sparkles size={18} style={{ color: '#A5B4FC' }} />
              <span className="section-title">ארגז חול לבדיקת מענה ה-AI (Playground)</span>
            </div>
            
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 16 }}>
              בחן כיצד בוט ה-AI מגיב לשאלות לקוחות על בסיס הנחיות ה-System Prompt שכתבת משמאל.
            </div>

            <div className="form-grid" style={{ gap: 12 }}>
              <div className="form-group">
                <label className="form-label" style={{ fontSize: 11 }}>שאלת לקוח מדומה (לדוגמה)</label>
                <input className="input" placeholder="לדוגמה: כמה עולה אצלכם כניסה חד פעמית לילד?"
                  value={workbenchInput} onChange={e => setWorkbenchInput(e.target.value)} />
              </div>

              <button type="button" className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }}
                disabled={testingAi || !workbenchInput.trim()} onClick={handleTestAiResponse}>
                {testingAi ? '⏳ מנתח תשובה...' : '🚀 בדוק מענה בוט'}
              </button>

              {workbenchOutput && (
                <div className="fade-in" style={{ marginTop: 14 }}>
                  <label className="form-label" style={{ fontSize: 11, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>🤖 תגובת הבוט (סימולציה):</span>
                  </label>
                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, fontSize: 12, lineHeight: 1.6, color: 'var(--text-1)' }}>
                    {workbenchOutput}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        </div>
      )}
    </div>
  );
}
