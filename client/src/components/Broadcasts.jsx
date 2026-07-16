import React, { useState, useEffect, useRef } from 'react';
import { Send, Hash, MessageSquare, History, Settings, Smartphone, Loader, CheckCircle, RefreshCw, Sparkles, AlertCircle } from 'lucide-react';

const LISTS = [
  { key: 'general', label: 'כללי', color: 'var(--blue)' },
  { key: 'classes', label: 'חוגים', color: 'var(--green)' },
  { key: 'trips',   label: 'טיולים', color: 'var(--amber)' },
  { key: 'events',  label: 'אירועים', color: 'var(--purple)' },
];

const WA_TEMPLATES = [
  { id: 'hello_world', name: 'תבנית טסט של Meta (hello_world)', text: 'הודעת שלום עולמי רשמית של Meta ללא פרמטרים.' },
  { id: 't1', name: 'ברוכים הבאים (דורש אישור ב-Meta)', text: 'שלום {{שם}}, ברוכים הבאים לקיר הטיפוס! נשמח לראות אתכם 🧗‍♂️' },
  { id: 't2', name: 'הצהרת בריאות (דורש אישור ב-Meta)', text: 'שלום {{שם}}, בבקשה מלאו את הצהרת הבריאות לפני הגעתכם: https://mywall.co.il/health' },
  { id: 't3', name: 'תזכורת שיעור (דורש אישור ב-Meta)', text: 'שלום {{שם}}, תזכורת: שיעור שלכם מחר. נתראה! 🤸‍♀️' },
];

export default function Broadcasts({ parents, students }) {
  const [activeTab, setActiveTab] = useState('compose'); // compose | history | simulator | settings
  
  // Compose / Send State
  const [selectedList, setSelectedList] = useState('general');
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [customMessage, setCustomMessage] = useState('');
  const [recipientFilter, setRecipientFilter] = useState('all'); 
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const [sendResult, setSendResult] = useState(null);

  // Broadcast History State
  const [broadcasts, setBroadcasts] = useState([]);
  const [loadingBroadcasts, setLoadingBroadcasts] = useState(false);

  // Settings State
  const [settings, setSettings] = useState({
    metaWaPhoneId: '',
    metaWaAccessToken: '',
    verifyToken: 'climbing_verify_token',
    aiResponderEnabled: true,
    aiSystemPrompt: 'אתה עוזר שירות לקוחות אינטליגנטי עבור קיר הטיפוס My Wall בירושלים. ענה בעברית מנומסת וקצרה. מחירון כניסות: כניסת יחיד מבוגר 50 ש"ח, ילד (עד 18) 40 ש"ח. כרטיסיית 10 כניסות 400 ש"ח. מנוי חודשי 220 ש"ח.',
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const [saveSettingsSuccess, setSaveSettingsSuccess] = useState(false);

  // WhatsApp Coexistence connect state
  const [waStatus, setWaStatus] = useState({ connected: false });
  const [waConnectConfig, setWaConnectConfig] = useState({ configured: false, appId: '', configId: '', checklist: [] });
  const [waConnecting, setWaConnecting] = useState(false);
  const [waConnectError, setWaConnectError] = useState('');
  const [waConnectSuccess, setWaConnectSuccess] = useState('');
  const [showAdvancedWa, setShowAdvancedWa] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testingSend, setTestingSend] = useState(false);
  const sessionInfoRef = useRef({ phone_number_id: null, waba_id: null, business_id: null, event: null });
  
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

  const loadFacebookSdk = (appId, graphVersion = 'v21.0') => {
    return new Promise((resolve, reject) => {
      if (!appId) {
        reject(new Error('חסר META_APP_ID'));
        return;
      }
      if (window.FB) {
        window.FB.init({ appId, autoLogAppEvents: true, xfbml: true, version: graphVersion });
        resolve(window.FB);
        return;
      }
      window.fbAsyncInit = function () {
        window.FB.init({ appId, autoLogAppEvents: true, xfbml: true, version: graphVersion });
        resolve(window.FB);
      };
      if (document.getElementById('facebook-jssdk')) {
        // Script tag exists; wait briefly for init
        setTimeout(() => (window.FB ? resolve(window.FB) : reject(new Error('Facebook SDK לא נטען'))), 800);
        return;
      }
      const script = document.createElement('script');
      script.id = 'facebook-jssdk';
      script.async = true;
      script.defer = true;
      script.crossOrigin = 'anonymous';
      script.src = 'https://connect.facebook.net/en_US/sdk.js';
      script.onerror = () => reject(new Error('טעינת Facebook SDK נכשלה'));
      document.body.appendChild(script);
    });
  };

  const finishWhatsAppOAuth = async (code) => {
    const session = sessionInfoRef.current || {};
    const response = await fetch('/api/whatsapp/oauth/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        phone_number_id: session.phone_number_id,
        waba_id: session.waba_id,
        business_id: session.business_id,
        event: session.event,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'השלמת החיבור נכשלה');
    }
    setWaStatus(data.status || { connected: true });
    setWaConnectSuccess('WhatsApp חובר בהצלחה (Coexistence). אפשר לענות מהטלפון ומהמערכת.');
    await fetchSettings();
    await fetchWaStatus(true);
  };

  const handleConnectWhatsApp = async () => {
    setWaConnectError('');
    setWaConnectSuccess('');
    setWaConnecting(true);
    try {
      if (!waConnectConfig.configured) {
        throw new Error('חסרים META_APP_ID / META_EMBEDDED_SIGNUP_CONFIG_ID בשרת. השלימו את הצ׳קליסט למטה.');
      }

      await loadFacebookSdk(waConnectConfig.appId, waConnectConfig.graphVersion || 'v21.0');

      const onMessage = (event) => {
        if (!String(event.origin || '').endsWith('facebook.com')) return;
        try {
          const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
          if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
          if (data.event === 'CANCEL') {
            setWaConnectError(data.data?.current_step
              ? `החיבור בוטל בשלב: ${data.data.current_step}`
              : 'החיבור בוטל');
            setWaConnecting(false);
            return;
          }
          sessionInfoRef.current = {
            phone_number_id: data.data?.phone_number_id || null,
            waba_id: data.data?.waba_id || null,
            business_id: data.data?.business_id || null,
            event: data.event || null,
          };
        } catch {
          // ignore non-JSON message events
        }
      };
      window.addEventListener('message', onMessage);

      window.FB.login((response) => {
        window.removeEventListener('message', onMessage);
        (async () => {
          try {
            if (!response?.authResponse?.code) {
              throw new Error('לא התקבל קוד אימות מ-Meta');
            }
            await finishWhatsAppOAuth(response.authResponse.code);
          } catch (err) {
            setWaConnectError(err.message || 'שגיאה בחיבור');
          } finally {
            setWaConnecting(false);
          }
        })();
      }, {
        config_id: waConnectConfig.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: 'whatsapp_business_app_onboarding',
          sessionInfoVersion: '3',
        },
      });
    } catch (err) {
      setWaConnectError(err.message || 'שגיאה בחיבור');
      setWaConnecting(false);
    }
  };

  const handleDisconnectWhatsApp = async () => {
    if (!confirm('לנתק את WhatsApp מהמערכת? (המספר יישאר פעיל באפליקציה בטלפון)')) return;
    setWaConnectError('');
    setWaConnectSuccess('');
    try {
      const response = await fetch('/api/whatsapp/disconnect', { method: 'POST' });
      const data = await response.json();
      setWaStatus(data.status || { connected: false });
      setWaConnectSuccess('החיבור נותק מהמערכת');
      await fetchSettings();
    } catch (err) {
      setWaConnectError('ניתוק נכשל');
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
    fetchSettings();
    fetchChatLogs();
    fetchWaStatus();
    fetchWaConnectConfig();
  }, []);

  useEffect(() => {
    if (activeTab === 'history') {
      fetchBroadcasts();
    } else if (activeTab === 'simulator') {
      fetchChatLogs();
    }
  }, [activeTab]);

  useEffect(() => {
    if (phoneMessagesEndRef.current) {
      phoneMessagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatLogs, selectedSimThread]);

  const getRecipients = () => {
    let filtered = parents || [];
    if (recipientFilter === 'registered') {
      const regParentIds = new Set((students || []).filter(s => s.status === 'registered').map(s => s.parentId));
      filtered = filtered.filter(p => regParentIds.has(p.id));
    } else if (recipientFilter === 'leads') {
      const leadParentIds = new Set((students || []).filter(s => ['lead_new','health_signed','intro_scheduled','intro_paid'].includes(s.status)).map(s => s.parentId));
      filtered = filtered.filter(p => leadParentIds.has(p.id));
    }
    return filtered;
  };

  const recipients = getRecipients();
  const messageText = selectedTemplate ? selectedTemplate.text : customMessage;

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
    if (!messageText.trim()) { alert('נא לכתוב הודעה'); return; }
    setSendingBroadcast(true);
    setSendResult(null);

    const campaignName = `קמפיין ${LISTS.find(l => l.key === selectedList)?.label} - ${new Date().toLocaleDateString('he-IL')}`;
    
    try {
      const response = await fetch('/api/whatsapp/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignName,
          listName: selectedList,
          templateId: selectedTemplate?.id || null,
          customMessage: selectedTemplate ? null : customMessage,
          recipients: recipients
        })
      });

      const data = await response.json();
      if (response.ok) {
        setSendResult({ success: true, sent: data.sent, total: data.total });
        setSelectedTemplate(null);
        setCustomMessage('');
        fetchChatLogs();
      } else {
        setSendResult({ success: false, error: data.error });
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
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
        <button className={`btn btn-sm ${activeTab === 'compose' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setActiveTab('compose'); setSendResult(null); }}>
          <Send size={14} /> שליחת דיוור
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
              </div>
            </div>
            <button className="btn btn-ghost" onClick={() => setSendResult(null)}>דיוור חדש</button>
          </div>
        ) : (
          <div className="grid-12" style={{ gap: 20, alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, gridColumn: 'span 7' }}>
              <div className="card card-p">
                <div className="section-title" style={{ marginBottom: 14 }}>רשימת תפוצה</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {LISTS.map(l => (
                    <button key={l.key} className={`btn btn-sm ${selectedList === l.key ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setSelectedList(l.key)}>
                      <Hash size={13} /> {l.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="card card-p">
                <div className="section-title" style={{ marginBottom: 14 }}>סינון נמענים</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[
                    { val: 'all', label: `כולם (${parents?.length || 0})` },
                    { val: 'registered', label: 'רשומים בלבד' },
                    { val: 'leads', label: 'לידים פעילים' },
                  ].map(f => (
                    <button key={f.val} className={`btn btn-sm ${recipientFilter === f.val ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setRecipientFilter(f.val)}>
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="card card-p">
                <div className="section-title" style={{ marginBottom: 14 }}>תבניות מאושרות</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {WA_TEMPLATES.map(tmpl => (
                    <div key={tmpl.id} className={`check-item ${selectedTemplate?.id === tmpl.id ? 'checked' : ''}`}
                      onClick={() => { setSelectedTemplate(selectedTemplate?.id === tmpl.id ? null : tmpl); setCustomMessage(''); }}
                      style={{ padding: 12, cursor: 'pointer', background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)', borderRadius: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{tmpl.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>{tmpl.text}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card card-p">
                <div className="section-title" style={{ marginBottom: 10 }}>הודעה חופשית</div>
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
                disabled={!messageText.trim() || sendingBroadcast}>
                {sendingBroadcast ? '⏳ שולח...' : `שלח ל-${recipients.length} נמענים`}
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
                כאן מחברים את מספר ה-WhatsApp Business שלכם.
                אחרי החיבור אפשר לענות מהטלפון ומהמערכת, והשיחה תופיע בתיק הלקוח.
              </p>

              <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.7, marginBottom: 12 }}>
                <div style={{ fontWeight: 700, color: 'var(--text-2)', marginBottom: 4 }}>איך מחברים (3 שלבים):</div>
                <ol style={{ margin: '0 18px', padding: 0 }}>
                  <li>לחצו על <strong style={{ color: '#25D366' }}>חבר WhatsApp</strong> למטה.</li>
                  <li>בחלון Meta בחרו חיבור ל-WhatsApp Business App הקיים והזינו/אשרו את המספר.</li>
                  <li>אשרו את הקוד באפליקציה בטלפון — וחזרו לכאן עד שמופיע סטטוס <strong>מחובר</strong>.</li>
                </ol>
              </div>

              {waStatus.connected && (
                <div style={{ display: 'grid', gap: 6, marginBottom: 12, fontSize: 12 }}>
                  <div><strong>מספר:</strong> {waStatus.displayPhone || waStatus.phoneNumberId || '—'}</div>
                  {waStatus.verifiedName && <div><strong>שם מאומת:</strong> {waStatus.verifiedName}</div>}
                  <div><strong>טלפון + מערכת:</strong> {waStatus.coexistenceEnabled || waStatus.isOnBizApp ? 'פעיל' : 'ממתין לאישור Coexistence'}</div>
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
                {!waStatus.connected ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleConnectWhatsApp}
                    disabled={waConnecting}
                    style={{ background: '#25D366', borderColor: '#25D366', minWidth: 160 }}
                  >
                    {waConnecting ? 'מתחבר...' : 'חבר WhatsApp'}
                  </button>
                ) : (
                  <>
                    <button type="button" className="btn btn-ghost" onClick={() => fetchWaStatus(true)}>
                      <RefreshCw size={14} /> רענן סטטוס
                    </button>
                    <button type="button" className="btn btn-danger" onClick={handleDisconnectWhatsApp}>
                      נתק
                    </button>
                  </>
                )}
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
                  <li>Verify Token: <code style={{ color: 'var(--green)' }}>{settings.verifyToken || 'climbing_verify_token'}</code></li>
                  <li>סמנו: <code style={{ color: '#25D366' }}>messages</code>, <code style={{ color: '#25D366' }}>smb_message_echoes</code>, <code style={{ color: '#25D366' }}>history</code></li>
                </ol>
                {!waConnectConfig.configured && (
                  <div style={{ marginTop: 8, padding: 8, borderRadius: 8, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)' }}>
                    <strong style={{ color: '#FBBF24' }}>חסרים משתני סביבה בשרת:</strong>{' '}
                    <code>META_APP_ID</code>, <code>META_APP_SECRET</code>, <code>META_EMBEDDED_SIGNUP_CONFIG_ID</code>
                    <div style={{ marginTop: 4 }}>בלי אלה הכפתור לא יוכל לפתוח את חלון האימות של Meta.</div>
                  </div>
                )}
              </div>

              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 10 }}
                onClick={() => setShowAdvancedWa(v => !v)}
              >
                {showAdvancedWa ? 'הסתר גיבוי ידני' : 'גיבוי ידני (Phone ID / Token)'}
              </button>
              {showAdvancedWa && (
                <div className="form-grid" style={{ gap: 10, marginTop: 10 }}>
                  <div className="form-group">
                    <label className="form-label" style={{ fontSize: 11 }}>Phone Number ID</label>
                    <input className="input input-sm" value={settings.metaWaPhoneId || ''} onChange={e => setSettings({ ...settings, metaWaPhoneId: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" style={{ fontSize: 11 }}>Access Token</label>
                    <input className="input input-sm" type="password" placeholder="EAA..." value={settings.metaWaAccessToken?.includes('•') ? '' : (settings.metaWaAccessToken || '')} onChange={e => setSettings({ ...settings, metaWaAccessToken: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" style={{ fontSize: 11 }}>WABA ID</label>
                    <input className="input input-sm" value={settings.metaWaWabaId || ''} onChange={e => setSettings({ ...settings, metaWaWabaId: e.target.value })} />
                  </div>
                </div>
              )}
            </div>

            <form onSubmit={handleSaveSettings} className="form-grid" style={{ gap: 14 }}>
              <div className="form-group">
                <label className="form-label">הנחיות אימון למענה ה-AI (System Prompt)</label>
                <textarea className="input textarea" rows={6} style={{ fontSize: 12, lineHeight: 1.5 }}
                  value={settings.aiSystemPrompt} onChange={e => setSettings({ ...settings, aiSystemPrompt: e.target.value })} />
                <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
                  הסבר ל-AI כיצד להציג את הקיר, אלו מחירים לתת, וכיצד להתנסח (למשל: לתת קישורי רישום).
                </div>
              </div>

              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input type="checkbox" id="ai-enabled" checked={settings.aiResponderEnabled}
                  onChange={e => setSettings({ ...settings, aiResponderEnabled: e.target.checked })} style={{ width: 18, height: 18 }} />
                <label htmlFor="ai-enabled" className="form-label" style={{ marginBottom: 0, cursor: 'pointer' }}>בוט AI פעיל למענה אוטומטי בוואטסאפ</label>
              </div>

              <div className="form-group">
                <label className="form-label">Verify Token (לחיבור Meta Webhook בוואטסאפ ואינסטגרם)</label>
                <input className="input" value={settings.verifyToken} onChange={e => setSettings({ ...settings, verifyToken: e.target.value })} />
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
                    <li>הזינו את ה-Verify Token הרשום לעיל (<code style={{ color: 'var(--green)' }}>{settings.verifyToken || 'climbing_verify_token'}</code>).</li>
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
                {savingSettings ? 'שומר...' : 'שמור הגדרות בוט, וואטסאפ ואינסטגרם'}
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
