import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Link2, Loader2, Mail, RefreshCw, Search, Send, Users, X } from 'lucide-react';

function normalizePhoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

/**
 * Registration / host / payment controls for a saved calendar activity.
 * Kept separate from ActivitiesCalendar to avoid edit conflicts.
 */
export default function ActivityRegistrationPanel({ activityId, form, setForm, readOnly }) {
  const [regs, setRegs] = useState([]);
  const [remaining, setRemaining] = useState(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [tplBusy, setTplBusy] = useState(false);
  const [parents, setParents] = useState([]);
  const [students, setStudents] = useState([]);
  const [customerQuery, setCustomerQuery] = useState('');
  const [hideSuggestions, setHideSuggestions] = useState(false);
  const [customersLoaded, setCustomersLoaded] = useState(false);

  const set = (key, value) => {
    if (readOnly) return;
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const setMany = (patch) => {
    if (readOnly) return;
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const loadRegs = useCallback(async () => {
    if (!activityId) return;
    try {
      const res = await fetch(`/api/activities/${encodeURIComponent(activityId)}/registrations`);
      if (!res.ok) return;
      const data = await res.json();
      setRegs(Array.isArray(data.registrations) ? data.registrations : []);
      setRemaining(data.remaining ?? null);
    } catch {
      /* ignore */
    }
  }, [activityId]);

  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/activity-templates');
      if (!res.ok) return;
      setTemplates(await res.json());
    } catch {
      /* ignore */
    }
  }, []);

  const loadCustomers = useCallback(async () => {
    try {
      const [pRes, sRes] = await Promise.all([
        fetch('/api/parents'),
        fetch('/api/students'),
      ]);
      if (pRes.ok) setParents(await pRes.json());
      if (sRes.ok) setStudents(await sRes.json());
    } catch {
      /* ignore */
    } finally {
      setCustomersLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadRegs();
    loadTemplates();
    loadCustomers();
  }, [loadRegs, loadTemplates, loadCustomers]);

  useEffect(() => {
    if (!form?.registration_slug) return;
    // Prefer server-built public URL (skips localhost when FRONTEND_URL / public fallback is set).
    if (!activityId) {
      setLinkUrl(`${window.location.origin}/event/${form.registration_slug}`);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/activities/${encodeURIComponent(activityId)}/registration-link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enable: true }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.url) {
          setLinkUrl(data.url);
          return;
        }
      } catch {
        /* fall through */
      }
      if (!cancelled) {
        setLinkUrl(`${window.location.origin}/event/${form.registration_slug}`);
      }
    })();
    return () => { cancelled = true; };
  }, [activityId, form?.registration_slug]);

  useEffect(() => {
    if (!copied) return undefined;
    const timeout = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const selectedParent = useMemo(() => {
    if (!form?.host_parent_id) return null;
    return parents.find((p) => String(p.id) === String(form.host_parent_id)) || null;
  }, [form?.host_parent_id, parents]);

  const customerSuggestions = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    if (q.length < 1) return [];
    const phoneQ = normalizePhoneDigits(customerQuery);
    const results = [];

    for (const parent of parents) {
      const name = String(parent.name || '').toLowerCase();
      const phone = normalizePhoneDigits(parent.phone);
      const email = String(parent.email || '').toLowerCase();
      if (
        name.includes(q) ||
        email.includes(q) ||
        (phoneQ.length >= 3 && phone.includes(phoneQ))
      ) {
        results.push({
          key: `parent:${parent.id}`,
          type: 'parent',
          id: parent.id,
          name: parent.name || 'לקוח',
          phone: parent.phone || '',
          email: parent.email || '',
        });
      }
    }

    for (const student of students) {
      const name = String(student.name || '').toLowerCase();
      if (!name.includes(q)) continue;
      const parent = parents.find((p) => p.id === student.parentId);
      if (!parent) continue;
      results.push({
        key: `student:${student.id}`,
        type: 'student',
        id: parent.id,
        name: parent.name || 'לקוח',
        childName: student.name || '',
        phone: parent.phone || '',
        email: parent.email || '',
      });
    }

    return results.slice(0, 12);
  }, [customerQuery, parents, students]);

  const selectCustomer = (hit) => {
    if (readOnly) return;
    setMany({
      host_parent_id: hit.id,
      host_name: hit.name || '',
      host_phone: hit.phone || '',
      host_email: hit.email || '',
      contact_name: hit.name || '',
      contact_phone: hit.phone || '',
    });
    setCustomerQuery('');
    setHideSuggestions(true);
    setMsg('');
  };

  const clearCustomer = () => {
    if (readOnly) return;
    setMany({
      host_parent_id: null,
      host_name: '',
      host_phone: '',
      host_email: '',
      contact_name: '',
      contact_phone: '',
    });
    setCustomerQuery('');
    setHideSuggestions(false);
    setMsg('');
  };

  const ensureLink = async ({ regenerate = false } = {}) => {
    if (!activityId) {
      setMsg('שמרו את האירוע קודם כדי ליצור קישור');
      return null;
    }
    setBusy('link');
    setMsg('');
    try {
      const res = await fetch(`/api/activities/${encodeURIComponent(activityId)}/registration-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regenerate, enable: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error || 'יצירת קישור נכשלה');
        return null;
      }
      setLinkUrl(data.url || '');
      set('registration_slug', data.slug);
      set('registration_enabled', true);
      return data.url;
    } catch {
      setMsg('שגיאת רשת');
      return null;
    } finally {
      setBusy('');
    }
  };

  const copyLink = async () => {
    let url = linkUrl;
    if (!url) url = await ensureLink();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setMsg('הקישור הועתק');
    } catch {
      setCopied(false);
      setMsg(url);
    }
  };

  const sendToHost = async () => {
    if (!activityId) {
      setMsg('שמרו את האירוע קודם');
      return;
    }
    if (!form.host_parent_id) {
      setMsg('יש לבחור מזמין מתוך לקוחות המערכת');
      return;
    }
    if (!form.host_phone && !selectedParent?.phone) {
      setMsg('ללקוח שנבחר אין מספר טלפון');
      return;
    }
    setBusy('send');
    setMsg('');
    try {
      if (!form.registration_enabled) {
        set('registration_enabled', true);
      }
      await ensureLink();
      const res = await fetch(`/api/activities/${encodeURIComponent(activityId)}/send-registration-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host_parent_id: form.host_parent_id,
          email: form.host_email,
          phone: form.host_phone || selectedParent?.phone,
          via: 'whatsapp',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error || 'שליחה נכשלה');
        return;
      }
      if (data.url) setLinkUrl(data.url);
      if (data.host_name) {
        setMany({
          host_name: data.host_name,
          host_phone: data.host_phone || form.host_phone,
          host_parent_id: data.host_parent_id || form.host_parent_id,
        });
      }
      if (data.whatsappSent) {
        setMsg('הקישור נשלח למזמין בוואטסאפ');
      } else if (data.whatsappError) {
        setMsg(data.whatsappError);
      } else {
        setMsg('הקישור מוכן');
      }
    } catch {
      setMsg('שגיאת רשת');
    } finally {
      setBusy('');
    }
  };

  const saveAsTemplate = async () => {
    if (!activityId) {
      setMsg('שמרו את האירוע קודם');
      return;
    }
    const name = window.prompt('שם התבנית', form.name || 'תבנית אירוע');
    if (!name) return;
    const catRaw = window.prompt(
      'קטגוריה: wall = אירועים בקיר, field = פעילויות שטח',
      'wall'
    );
    if (catRaw == null) return;
    const category = String(catRaw).trim().toLowerCase() === 'field' ? 'field' : 'wall';
    setTplBusy(true);
    setMsg('');
    try {
      const res = await fetch('/api/activity-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activity_id: activityId,
          name,
          category,
          theme: form.registration_theme || {},
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error || 'שמירת תבנית נכשלה');
        return;
      }
      setMsg(category === 'field' ? 'נשמר תחת פעילויות שטח' : 'נשמר תחת אירועים בקיר');
      loadTemplates();
    } catch {
      setMsg('שגיאת רשת');
    } finally {
      setTplBusy(false);
    }
  };

  const payLabel = {
    unpaid: 'לא שולם',
    paid: 'שולם',
    partial: 'שולם חלקית',
  };

  const displayName = form.host_name || form.contact_name || selectedParent?.name || '';
  const displayPhone = form.host_phone || form.contact_phone || selectedParent?.phone || '';
  const displayEmail = form.host_email || selectedParent?.email || '';
  const hasLinkedCustomer = !!form.host_parent_id;
  const hasLegacyHost = !hasLinkedCustomer && !!(displayName || displayPhone || displayEmail);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      padding: 12,
      borderRadius: 12,
      border: '1px solid var(--border)',
      background: 'rgba(255,255,255,0.02)',
    }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-1)' }}>
        מזמין · הרשמה · תשלום
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
          בחירת מזמין מלקוחות המערכת
        </div>

        {hasLinkedCustomer ? (
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 10,
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'rgba(0,0,0,0.18)',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>
                {displayName || 'לקוח נבחר'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                {[displayPhone, displayEmail].filter(Boolean).join(' · ') || 'אין טלפון או אימייל'}
              </div>
              {selectedParent == null && customersLoaded && (
                <div style={{ fontSize: 11, color: '#FCD34D' }}>
                  הלקוח נשמר באירוע אך לא נמצא כרגע ברשימה
                </div>
              )}
            </div>
            {!readOnly && (
              <button
                type="button"
                className="btn-ghost"
                onClick={clearCustomer}
                aria-label="הסרת מזמין"
                style={{ flexShrink: 0, gap: 4 }}
              >
                <X size={14} />
                החלפה
              </button>
            )}
          </div>
        ) : (
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'relative' }}>
              <Search
                size={14}
                style={{
                  position: 'absolute',
                  right: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-3)',
                  pointerEvents: 'none',
                }}
              />
              <input
                className="input"
                style={{ paddingRight: 34 }}
                placeholder="חיפוש לפי שם הורה, שם ילד או טלפון..."
                value={customerQuery}
                onChange={(e) => {
                  setCustomerQuery(e.target.value);
                  setHideSuggestions(false);
                }}
                disabled={readOnly}
                autoComplete="off"
              />
            </div>
            {customerQuery.trim() && !hideSuggestions && !readOnly && (
              <div
                style={{
                  position: 'absolute',
                  zIndex: 80,
                  right: 0,
                  left: 0,
                  top: '100%',
                  marginTop: 4,
                  maxHeight: 240,
                  overflow: 'auto',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  background: 'var(--bg-card, #0f172a)',
                  boxShadow: '0 16px 40px rgba(0,0,0,0.55)',
                }}
              >
                {customerSuggestions.length === 0 ? (
                  <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-3)' }}>
                    לא נמצא לקוח מתאים
                  </div>
                ) : (
                  customerSuggestions.map((hit) => (
                    <button
                      key={hit.key}
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{
                        width: '100%',
                        justifyContent: 'flex-start',
                        borderRadius: 0,
                        gap: 8,
                        padding: '10px 12px',
                        textAlign: 'right',
                      }}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectCustomer(hit)}
                    >
                      <span style={{ fontWeight: 700 }}>{hit.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                        {hit.type === 'student' && hit.childName
                          ? `מתאמן: ${hit.childName}`
                          : 'לקוח / הורה'}
                        {hit.phone ? ` · ${hit.phone}` : ''}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {hasLegacyHost && (
          <div style={{
            fontSize: 12,
            color: 'var(--text-3)',
            padding: '8px 10px',
            borderRadius: 8,
            background: 'rgba(252, 211, 77, 0.08)',
            border: '1px solid rgba(252, 211, 77, 0.25)',
          }}>
            פרטי מזמין ישנים (טקסט חופשי):
            {' '}
            {[displayName, displayPhone, displayEmail].filter(Boolean).join(' · ')}
            {' — '}
            מומלץ לקשר ללקוח מהמערכת
          </div>
        )}
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-3)' }}>
        סטטוס תשלום המזמין (דמי הזמנה לקיר)
        <select
          className="input"
          value={form.payment_status || 'unpaid'}
          onChange={(e) => set('payment_status', e.target.value)}
          disabled={readOnly}
        >
          <option value="unpaid">{payLabel.unpaid}</option>
          <option value="paid">{payLabel.paid}</option>
          <option value="partial">{payLabel.partial}</option>
        </select>
      </label>

      <label style={{
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-2)',
      }}>
        <input
          type="checkbox"
          checked={!!form.registration_enabled}
          onChange={(e) => set('registration_enabled', e.target.checked)}
          disabled={readOnly}
        />
        הפעלת דף הרשמה ציבורי
      </label>

      <label style={{
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-2)',
      }}>
        <input
          type="checkbox"
          checked={!!form.collect_registration_payment}
          onChange={(e) => set('collect_registration_payment', e.target.checked)}
          disabled={readOnly}
        />
        גביית תשלום מהמשתתפים בדף (לפי מחיר האירוע)
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-3)' }}>
        כותרת בדף הציבורי
        <input
          className="input"
          value={form.registration_page_title || ''}
          onChange={(e) => set('registration_page_title', e.target.value)}
          disabled={readOnly}
          placeholder="ברירת מחדל: שם האירוע"
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-3)' }}>
        טקסט בדף הציבורי
        <textarea
          className="input"
          rows={2}
          value={form.registration_page_body || ''}
          onChange={(e) => set('registration_page_body', e.target.value)}
          disabled={readOnly}
          style={{ resize: 'vertical' }}
        />
      </label>

      {activityId && (
        <div className="registration-actions">
          <button
            type="button"
            className={`btn btn-sm ${linkUrl ? 'btn-ghost' : 'btn-primary'}`}
            onClick={() => ensureLink()}
            disabled={!!busy || tplBusy || readOnly}
          >
            {busy === 'link' ? <Loader2 size={14} className="spin" /> : <Link2 size={14} />}
            יצירת קישור
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => ensureLink({ regenerate: true })}
            disabled={!!busy || tplBusy || readOnly}
          >
            <RefreshCw size={14} /> קישור חדש
          </button>
          <button
            type="button"
            className={`btn btn-sm ${linkUrl ? 'btn-primary' : 'btn-ghost'}`}
            onClick={sendToHost}
            disabled={!!busy || tplBusy || readOnly}
          >
            {busy === 'send' ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
            שליחה למזמין
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={saveAsTemplate}
            disabled={!!busy || tplBusy || readOnly}
          >
            {tplBusy ? <Loader2 size={14} className="spin" /> : <Mail size={14} />}
            שמירה כתבנית
          </button>
        </div>
      )}

      {linkUrl && (
        <div className="registration-link-field">
          <div className="registration-link-value" title={linkUrl}>
            <Link2 size={14} />
            <span>{linkUrl}</span>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm registration-copy-btn"
            onClick={copyLink}
            disabled={!!busy || tplBusy}
          >
            <Copy size={14} />
            {copied ? 'הועתק' : 'העתקה'}
          </button>
        </div>
      )}

      {!activityId && (
        <div style={{ fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic' }}>
          אחרי שמירה אפשר ליצור קישור הרשמה ולשלוח למזמין
        </div>
      )}

      {activityId && (
        <div className="registration-participants">
          <div className="registration-participants-summary">
            <div className="registration-participants-label">
              <Users size={14} />
              <span>משתתפים רשומים</span>
              {remaining != null && (
                <span className="registration-participants-remaining">
                  · נותרו {remaining}
                </span>
              )}
            </div>
            <button
              type="button"
              className="icon-btn registration-refresh-btn"
              onClick={loadRegs}
              aria-label="רענון"
              title="רענון"
            >
              <RefreshCw size={14} />
            </button>
          </div>
          {regs.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>עדיין אין נרשמים</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
              {regs.map((r) => (
                <div
                  key={r.id}
                  style={{
                    display: 'flex', justifyContent: 'space-between', gap: 8,
                    fontSize: 12, padding: '6px 8px', borderRadius: 8,
                    background: 'rgba(0,0,0,0.2)',
                  }}
                >
                  <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{r.participant_name}</span>
                  <span style={{ color: 'var(--text-3)' }}>
                    {r.phone || r.email || ''}
                    {r.payment_status && r.payment_status !== 'n/a'
                      ? ` · ${r.payment_status === 'paid' ? 'שולם' : 'ממתין'}`
                      : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {templates.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
          תבניות שמורות: {templates.map((t) => t.name).join(' · ')}
        </div>
      )}

      {msg && (
        <div style={{ fontSize: 12, color: '#FCD34D' }}>{msg}</div>
      )}
    </div>
  );
}
