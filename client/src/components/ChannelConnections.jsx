import React, { useEffect, useState } from 'react';
import { RefreshCw, Smartphone } from 'lucide-react';

/**
 * Meta channel setup (WhatsApp / Messenger / Instagram). This used to live in a
 * tab inside the broadcast screen, which is not where anyone looks for a
 * connection — it now sits with every other connection in business settings.
 * The component owns its own state so it can be dropped anywhere.
 */
export default function ChannelConnections({ focus = 'whatsapp' }) {
  const [settings, setSettings] = useState({});
  const [waStatus, setWaStatus] = useState({ connected: false });
  const [waConnectConfig, setWaConnectConfig] = useState({ configured: false, checklist: [] });
  const [waConnectError, setWaConnectError] = useState('');
  const [waConnectSuccess, setWaConnectSuccess] = useState('');
  const [activatingWa, setActivatingWa] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testingSend, setTestingSend] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [saveSettingsSuccess, setSaveSettingsSuccess] = useState(false);

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/whatsapp/settings');
      if (response.ok) {
        const data = await response.json();
        setSettings((prev) => ({ ...prev, ...data }));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchWaStatus = async (refresh = false) => {
    try {
      const response = await fetch(`/api/whatsapp/status${refresh ? '?refresh=1' : ''}`);
      if (response.ok) setWaStatus(await response.json());
    } catch (e) {
      console.error(e);
    }
  };

  const fetchWaConnectConfig = async () => {
    try {
      const response = await fetch('/api/whatsapp/connect-config');
      if (response.ok) setWaConnectConfig(await response.json());
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchSettings();
    fetchWaStatus();
    fetchWaConnectConfig();
  }, []);

  const coexistenceLabel = () => {
    if (waStatus.coexistenceEnabled || waStatus.isOnBizApp) return 'פעיל (טלפון + מערכת)';
    if (waStatus.connected) return 'לא עודכן — לחצו «רענן סטטוס»';
    return 'לא מחובר';
  };

  const handleActivateWhatsApp = async () => {
    setActivatingWa(true);
    setWaConnectError('');
    setWaConnectSuccess('');
    try {
      const response = await fetch('/api/whatsapp/activate', { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || 'אימות החיבור נכשל');
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
      if (response.ok) setWaConnectSuccess('הודעת בדיקה נשלחה בהצלחה');
      else setWaConnectError(data.error || 'שליחת בדיקה נכשלה');
    } catch {
      setWaConnectError('שגיאת רשת בשליחת בדיקה');
    } finally {
      setTestingSend(false);
    }
  };

  // Only the channel fields are sent, and the server writes just what it gets,
  // so saving here can never clobber the bot settings saved on the other screen.
  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setSavingSettings(true);
    setSaveSettingsSuccess(false);
    try {
      const response = await fetch('/api/whatsapp/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metaPageId: settings.metaPageId || '',
          metaIgAccountId: settings.metaIgAccountId || '',
          metaIgAccessToken: settings.metaIgAccessToken || '',
        }),
      });
      if (response.ok) {
        setSaveSettingsSuccess(true);
        setTimeout(() => setSaveSettingsSuccess(false), 3000);
      } else {
        const data = await response.json().catch(() => ({}));
        alert(data.error || 'שמירת ההגדרות נכשלה');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSavingSettings(false);
    }
  };

  const showWhatsapp = focus === 'whatsapp' || focus === 'all';
  const showMessenger = focus === 'messenger' || focus === 'all';
  const showInstagram = focus === 'instagram' || focus === 'all';

  return (
    <div className="card card-p" style={{ maxWidth: 680 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Smartphone size={18} style={{ color: 'var(--blue)' }} />
        <span className="section-title">חיבורי ערוצים (וואטסאפ, מסנג׳ר, אינסטגרם)</span>
      </div>

      {saveSettingsSuccess && (
        <div className="alert alert-success" style={{ marginBottom: 16 }}>
          <span>ההגדרות נשמרו בהצלחה! ✓</span>
        </div>
      )}

      {showWhatsapp && (
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
                onChange={(e) => setTestPhone(e.target.value)}
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
      )}

      {showMessenger && (
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
      )}

      {showInstagram && (
        <div style={{
          border: '1px solid rgba(247,119,55,0.45)',
          background: 'rgba(247,119,55,0.06)',
          borderRadius: 12,
          padding: 14,
          marginBottom: 18,
        }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: '#F77737', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>חיבור אינסטגרם (Instagram DM Webhook)</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12, lineHeight: 1.6 }}>
            כדי שפניות והודעות פרטיות מאינסטגרם יפתחו אוטומטית ליד במערכת ויקבלו מענה AI:
            <ol style={{ margin: '6px 20px', padding: 0 }}>
              <li>היכנסו לפורטל המפתחים של Meta או להגדרות Instagram Graph API.</li>
              <li>הגדירו את כתובת ה-Webhook ל-<code style={{ color: '#F77737' }}>https://YOUR_SERVER_URL/api/instagram/webhook</code> (או לכתובת המנהרת Pinggy שלכם).</li>
              <li>הזינו את אסימון האימות ששמור בהגדרות השרת.</li>
              <li>סמנו תחת אירועי Webhook את <code style={{ color: '#F77737' }}>messages</code> ואת <code style={{ color: '#F77737' }}>messaging_postbacks</code>.</li>
            </ol>
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label" style={{ fontSize: 11 }}>Instagram Account ID (IG Business ID)</label>
              <input className="input input-sm" placeholder="17841400000000000" value={settings.metaIgAccountId || ''} onChange={(e) => setSettings({ ...settings, metaIgAccountId: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label" style={{ fontSize: 11 }}>Instagram Access Token</label>
              <input className="input input-sm" type="password" placeholder="EAAGb..." value={settings.metaIgAccessToken || ''} onChange={(e) => setSettings({ ...settings, metaIgAccessToken: e.target.value })} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>
            משתני שרת: <code>META_IG_ACCOUNT_ID</code> ו-<code>META_IG_ACCESS_TOKEN</code>
          </div>
        </div>
      )}

      {(showMessenger || showInstagram) && (
        <form onSubmit={handleSaveSettings}>
          <button type="submit" className="btn btn-primary btn-full" disabled={savingSettings}>
            {savingSettings ? 'שומר...' : 'שמור הגדרות חיבורי ערוצים'}
          </button>
        </form>
      )}
    </div>
  );
}
