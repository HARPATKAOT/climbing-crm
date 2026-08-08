import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Save, Upload, Building2, Plug, Users, FileText } from 'lucide-react';
import {
  DEFAULT_BUSINESS_PROFILE,
  useBusinessProfile,
} from '../BusinessProfileContext.jsx';
import Integrations from './Integrations.jsx';
import BusinessUsers from './BusinessUsers.jsx';
import CancellationPoliciesSettings from './CancellationPoliciesSettings.jsx';

function SettingsTabs({ tab, setTab }) {
  return (
    <div className="tab-bar" style={{ marginBottom: 16 }}>
      {[
        { key: 'profile', label: 'פרטי עסק', icon: Building2 },
        { key: 'integrations', label: 'חיבורים', icon: Plug },
        { key: 'users', label: 'משתמשים והרשאות', icon: Users },
        { key: 'policies', label: 'מדיניות ביטול', icon: FileText },
      ].map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          className={`tab-pill ${tab === key ? 'active' : ''}`}
          onClick={() => setTab(key)}
        >
          <Icon size={15} />
          {label}
        </button>
      ))}
    </div>
  );
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('קריאת הקובץ נכשלה'));
    reader.readAsDataURL(file);
  });
}

export default function BusinessSettings() {
  const { applyProfile } = useBusinessProfile();
  const fileRef = useRef(null);
  const [form, setForm] = useState({ ...DEFAULT_BUSINESS_PROFILE });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  // Land on the connections tab when Google bounces back from OAuth.
  const [tab, setTab] = useState(() =>
    new URLSearchParams(window.location.search).has('googleContacts') ? 'integrations' : 'profile'
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch('/api/settings/business-profile');
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || 'טעינת פרטי העסק נכשלה');
        }
        if (!cancelled) {
          setForm({ ...DEFAULT_BUSINESS_PROFILE, ...data });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'טעינת פרטי העסק נכשלה');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const set = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const onPickLogo = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImageBusy(true);
    setError('');
    try {
      const dataUrl = await readFileAsDataUrl(file);
      set('logo_url', dataUrl);
    } catch (err) {
      setError(err.message || 'העלאת הלוגו נכשלה');
    } finally {
      setImageBusy(false);
    }
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMsg('');
    setError('');
    try {
      const res = await fetch('/api/settings/business-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'שמירת פרטי העסק נכשלה');
      }
      setForm({ ...DEFAULT_BUSINESS_PROFILE, ...data });
      applyProfile(data);
      setMsg('הפרטים נשמרו');
    } catch (err) {
      setError(err.message || 'שמירת פרטי העסק נכשלה');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-3)', padding: 24 }}>
        <Loader2 size={18} className="spin" />
        טוען הגדרות עסק...
      </div>
    );
  }

  if (tab === 'integrations') {
    return (
      <div className="business-settings">
        <SettingsTabs tab={tab} setTab={setTab} />
        <Integrations />
      </div>
    );
  }

  if (tab === 'users') {
    return (
      <div className="business-settings">
        <SettingsTabs tab={tab} setTab={setTab} />
        <BusinessUsers />
      </div>
    );
  }

  if (tab === 'policies') {
    return (
      <div className="business-settings">
        <SettingsTabs tab={tab} setTab={setTab} />
        <CancellationPoliciesSettings />
      </div>
    );
  }

  return (
    <form className="business-settings" onSubmit={save}>
      <SettingsTabs tab={tab} setTab={setTab} />

      <div className="business-settings-header">
        <div>
          <div className="business-settings-title">
            <Building2 size={18} />
            הגדרות עסק
          </div>
          <div className="business-settings-sub">
            השם והלוגו יופיעו בדפים שפונים ללקוחות
          </div>
        </div>
        <button type="submit" className="btn btn-primary" disabled={saving || imageBusy}>
          {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
          שמירה
        </button>
      </div>

      <div className="business-settings-grid">
        <section className="business-settings-card">
          <div className="business-settings-card-title">מיתוג</div>

          <div className="business-settings-logo-row">
            <div className="business-settings-logo-preview">
              <img
                src={form.logo_url || '/logo.png'}
                alt={form.display_name || 'לוגו'}
              />
            </div>
            <div className="business-settings-logo-actions">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={onPickLogo}
              />
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => fileRef.current?.click()}
                disabled={imageBusy || saving}
              >
                {imageBusy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
                העלאת לוגו
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => set('logo_url', '/logo.png')}
                disabled={imageBusy || saving}
              >
                לוגו ברירת מחדל
              </button>
            </div>
          </div>

          <label className="business-settings-field">
            שם תצוגה
            <input
              className="input"
              value={form.display_name || ''}
              onChange={(e) => set('display_name', e.target.value)}
              placeholder="הרפתקאות"
              required
            />
          </label>

          <label className="business-settings-field">
            שם משפטי למסמכים
            <input
              className="input"
              value={form.legal_name || ''}
              onChange={(e) => set('legal_name', e.target.value)}
              placeholder="אם ריק — משתמשים בשם התצוגה"
            />
          </label>
        </section>

        <section className="business-settings-card">
          <div className="business-settings-card-title">פרטי קשר</div>

          <label className="business-settings-field">
            טלפון
            <input
              className="input"
              value={form.phone || ''}
              onChange={(e) => set('phone', e.target.value)}
              placeholder="05X-XXXXXXX"
            />
          </label>

          <label className="business-settings-field">
            דואר אלקטרוני
            <input
              className="input"
              type="email"
              value={form.email || ''}
              onChange={(e) => set('email', e.target.value)}
              placeholder="info@example.com"
            />
          </label>

          <label className="business-settings-field">
            כתובת
            <input
              className="input"
              value={form.address || ''}
              onChange={(e) => set('address', e.target.value)}
              placeholder="רחוב, עיר"
            />
          </label>

          <label className="business-settings-field">
            כתובת אתר
            <input
              className="input"
              value={form.website_url || ''}
              onChange={(e) => set('website_url', e.target.value)}
              placeholder="https://..."
              dir="ltr"
            />
          </label>
        </section>

      </div>

      {error && <div className="business-settings-alert is-error">{error}</div>}
      {msg && <div className="business-settings-alert is-ok">{msg}</div>}
    </form>
  );
}
