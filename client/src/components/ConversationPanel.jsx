import React, { useEffect, useRef, useState } from 'react';
import { Send, MessageCircle, Image as ImageIcon, FileText, Bookmark, RefreshCw } from 'lucide-react';

const CHANNEL_LABELS = {
  whatsapp: 'וואטסאפ',
  instagram: 'אינסטגרם',
  messenger: 'מסנג׳ר',
};

const CHANNEL_COLORS = {
  whatsapp: 'rgba(37,211,102,0.14)',
  instagram: 'rgba(225,48,108,0.14)',
  messenger: 'rgba(0,132,255,0.14)',
};

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

export default function ConversationPanel({ parent, student }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [replyText, setReplyText] = useState('');
  const [channel, setChannel] = useState('whatsapp');
  const [mode, setMode] = useState('text'); // text | template | saved | image
  const [templates, setTemplates] = useState([]);
  const [savedReplies, setSavedReplies] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [templateVars, setTemplateVars] = useState(['']);
  const [selectedSaved, setSelectedSaved] = useState('');
  const [imagePreview, setImagePreview] = useState(null);
  const [imageBase64, setImageBase64] = useState('');
  const chatEndRef = useRef(null);
  const fileRef = useRef(null);

  const load = async () => {
    if (!parent?.id) return;
    setLoading(true);
    setError('');
    try {
      const [convRes, tplRes, srRes] = await Promise.all([
        fetch(`/api/conversations/${parent.id}`),
        fetch('/api/message-templates?approved=1'),
        fetch('/api/saved-replies'),
      ]);
      const conv = await convRes.json();
      if (!convRes.ok) throw new Error(conv.error || 'טעינת שיחה נכשלה');
      setData(conv);
      setChannel(conv.defaultChannel || 'whatsapp');
      const tpls = tplRes.ok ? await tplRes.json() : [];
      setTemplates(Array.isArray(tpls) ? tpls : []);
      const srs = srRes.ok ? await srRes.json() : [];
      setSavedReplies(Array.isArray(srs) ? srs : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parent?.id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [data?.messages?.length]);

  const windowOpen = data?.windows?.[channel]?.open;
  const freeformBlocked = !windowOpen;

  useEffect(() => {
    if (freeformBlocked && channel === 'whatsapp' && (mode === 'text' || mode === 'image' || mode === 'saved')) {
      setMode('template');
    }
  }, [freeformBlocked, mode, channel]);

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
      let body = { channel, type: mode === 'saved' ? 'saved_reply' : mode };
      if (mode === 'text') {
        if (!replyText.trim()) return;
        body.text = replyText.trim();
      } else if (mode === 'template') {
        if (!selectedTemplate) throw new Error('בחרו תבנית');
        const tpl = templates.find((t) => t.id === selectedTemplate || t.meta_name === selectedTemplate);
        body.templateName = tpl?.meta_name || tpl?.name || selectedTemplate;
        body.language = tpl?.language || 'he';
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
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'שליחה נכשלה');
      setReplyText('');
      setImageBase64('');
      setImagePreview(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  if (!parent) {
    return (
      <div className="card card-p" style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>אין איש קשר מקושר ללקוח זה</div>
      </div>
    );
  }

  const messages = data?.messages || [];
  const channels = data?.channels || {};

  return (
    <>
      <div className="section-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <MessageCircle size={15} /> תקשורת עם הלקוח
        </div>
        <button type="button" className="btn btn-ghost btn-xs" onClick={load} disabled={loading}>
          <RefreshCw size={12} /> רענון
        </button>
      </div>

      <div className="card card-p" style={{ marginBottom: 20, padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
          {['whatsapp', 'instagram', 'messenger'].map((ch) => (
            <WindowBadge key={ch} windows={data?.windows} channel={ch} />
          ))}
        </div>

        <div style={{ display: 'flex', gap: 6, padding: '8px 12px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
          {Object.keys(CHANNEL_LABELS).map((ch) => (
            <button
              key={ch}
              type="button"
              className={`btn btn-xs ${channel === ch ? 'btn-primary' : 'btn-ghost'}`}
              disabled={!channels[ch]}
              onClick={() => setChannel(ch)}
              title={!channels[ch] ? 'ערוץ לא מחובר ללקוח זה' : ''}
            >
              {CHANNEL_LABELS[ch]}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 360 }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 160 }}>
            {loading && !messages.length ? (
              <div style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center', marginTop: 20 }}>טוען שיחה...</div>
            ) : messages.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center', marginTop: 20 }}>
                עדיין אין הודעות. שלחו הודעה או המתינו לפנייה מהלקוח.
              </div>
            ) : (
              messages.map((m, i) => {
                const inbound = m.direction === 'inbound';
                const ch = m.channel || 'whatsapp';
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
                      {m.template_id || m.template_name ? ' · תבנית' : ''}
                      {m.is_ai ? ' · בוט' : ''}
                    </div>
                    {(m.media_url || m.message_type === 'image') && (
                      <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 4 }}>📷 תמונה / מדיה</div>
                    )}
                    <div style={{ color: 'var(--text-1)', whiteSpace: 'pre-wrap' }}>
                      {m.body || m.message || m.text || '(ללא תוכן)'}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
                      {m.created_at ? new Date(m.created_at).toLocaleString('he-IL') : ''}
                      {m.status ? ` · ${m.status}` : ''}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={chatEndRef} />
          </div>

          {freeformBlocked && (
            <div style={{ fontSize: 11, color: '#FBBF24', padding: '6px 12px', background: 'rgba(251,191,36,0.08)', borderTop: '1px solid var(--border)' }}>
              {channel === 'whatsapp'
                ? 'חלון 24 השעות סגור בוואטסאפ — אפשר לשלוח רק תבנית מאושרת.'
                : 'חלון 24 השעות סגור בערוץ הזה. עברו לוואטסאפ כדי לשלוח תבנית מאושרת, או המתינו לפנייה מהלקוח.'}
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, padding: '8px 10px', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
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
          </div>

          <form onSubmit={handleSend} style={{ padding: 10, background: 'rgba(0,0,0,0.15)' }}>
            {mode === 'template' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
                <select
                  className="input input-sm"
                  value={selectedTemplate}
                  onChange={(e) => {
                    setSelectedTemplate(e.target.value);
                    const tpl = templates.find((t) => t.id === e.target.value || t.meta_name === e.target.value);
                    const vars = Array.isArray(tpl?.variables) ? tpl.variables : [];
                    setTemplateVars(vars.length ? vars.map(() => student?.name || parent?.name || '') : [parent?.name || '']);
                  }}
                >
                  <option value="">בחרו תבנית מאושרת...</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name || t.meta_name} ({t.language || 'he'})</option>
                  ))}
                </select>
                {templateVars.map((v, idx) => (
                  <input
                    key={idx}
                    className="input input-sm"
                    placeholder={`משתנה {{${idx + 1}}}`}
                    value={v}
                    onChange={(e) => {
                      const next = [...templateVars];
                      next[idx] = e.target.value;
                      setTemplateVars(next);
                    }}
                  />
                ))}
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
                  onChange={(e) => setReplyText(e.target.value)}
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
            <div style={{ fontSize: 11, color: '#F87171', padding: '0 10px 8px' }}>{error}</div>
          )}
        </div>
      </div>
    </>
  );
}
