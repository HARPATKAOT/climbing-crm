import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, FileStack, Loader2, Plus, Search, Trash2, X } from 'lucide-react';

const CATEGORY_META = {
  field: { label: 'פעילויות שטח', color: '#34D399', hint: 'טיולים, נחלים וטיפוס בטבע' },
  wall: { label: 'אירועים בקיר', color: '#FB923C', hint: 'ימי הולדת, גיבוש ואימונים' },
};

/**
 * Category → template picker.
 * Selecting a template opens a prefilled (unsaved) activity form.
 * "אירוע מותאם" opens a blank custom form.
 */
export default function ActivityTemplatesMenu({
  onApplyTemplate,
  onCustomEvent,
  defaultDate,
}) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [categories, setCategories] = useState([
    { id: 'field', label: 'פעילויות שטח' },
    { id: 'wall', label: 'אירועים בקיר' },
  ]);
  const [categoryId, setCategoryId] = useState(null); // null = pick category
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setMsg('');
    try {
      const res = await fetch('/api/activity-templates?grouped=1');
      if (!res.ok) {
        setMsg('טעינת תבניות נכשלה');
        return;
      }
      const data = await res.json();
      if (Array.isArray(data.categories) && data.categories.length) {
        setCategories(data.categories);
      }
      setTemplates(Array.isArray(data.templates) ? data.templates : (Array.isArray(data) ? data : []));
    } catch {
      setMsg('שגיאת רשת');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setCategoryId(null);
      setQuery('');
      load();
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = templates.filter((t) => t.is_active !== false);
    if (categoryId) {
      list = list.filter((t) => String(t.category || 'wall') === categoryId);
    }
    if (q) {
      list = list.filter((t) => {
        const hay = `${t.name || ''} ${t.description || ''} ${t.location || ''}`.toLowerCase();
        return hay.includes(q);
      });
    }
    return list;
  }, [templates, categoryId, query]);

  const groupedSearch = useMemo(() => {
    if (!query.trim() || categoryId) return null;
    return categories.map((cat) => ({
      ...cat,
      templates: filtered.filter((t) => String(t.category || 'wall') === cat.id),
    })).filter((g) => g.templates.length > 0);
  }, [query, categoryId, filtered, categories]);

  const pickTemplate = (tpl) => {
    setBusy(tpl.id);
    setMsg('');
    try {
      const date = defaultDate || new Date().toISOString().slice(0, 10);
      onApplyTemplate?.(tpl, date);
      setOpen(false);
    } finally {
      setBusy('');
    }
  };

  const remove = async (tpl, e) => {
    e.stopPropagation();
    if (!window.confirm(`למחוק את התבנית "${tpl.name}"?`)) return;
    setBusy(tpl.id);
    try {
      await fetch(`/api/activity-templates/${encodeURIComponent(tpl.id)}`, { method: 'DELETE' });
      await load();
    } finally {
      setBusy('');
    }
  };

  const startCustom = () => {
    setOpen(false);
    onCustomEvent?.(defaultDate || new Date().toISOString().slice(0, 10));
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn-ghost"
        onClick={() => setOpen(true)}
        title="תבניות ואירוע מותאם"
      >
        <FileStack size={14} /> תבניות
      </button>

      {open && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 220,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(520px, 100%)',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 16,
              overflow: 'hidden',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '14px 16px', borderBottom: '1px solid var(--border)',
            }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-1)' }}>
                  {categoryId
                    ? (CATEGORY_META[categoryId]?.label || categories.find((c) => c.id === categoryId)?.label || 'תבניות')
                    : 'בחירת תבנית'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                  {categoryId
                    ? 'בחרו תבנית — אפשר לערוך לפני שמירה'
                    : 'קטגוריה, או אירוע מותאם ללקוח'}
                </div>
              </div>
              <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="סגור">
                <X size={16} />
              </button>
            </div>

            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{
                  position: 'absolute', insetInlineStart: 10, top: '50%', transform: 'translateY(-50%)',
                  color: 'var(--text-3)',
                }} />
                <input
                  className="input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={categoryId ? 'חיפוש בתוך הקטגוריה...' : 'חיפוש בכל הקטגוריות...'}
                  style={{ paddingInlineStart: 32 }}
                />
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {!categoryId && !query.trim() && (
                <>
                  <button
                    type="button"
                    onClick={startCustom}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '14px 14px', borderRadius: 12, cursor: 'pointer',
                      border: '1px dashed var(--border)',
                      background: 'rgba(255,255,255,0.02)',
                      textAlign: 'right', width: '100%',
                      color: 'var(--text-1)',
                    }}
                  >
                    <Plus size={18} style={{ color: '#7DD3FC' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 800, fontSize: 14 }}>אירוע מותאם ללקוח</div>
                      <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                        מחיר, טקסט וקישור הרשמה חופשיים — בלי תבנית
                      </div>
                    </div>
                  </button>

                  {categories.map((cat) => {
                    const meta = CATEGORY_META[cat.id] || {};
                    const count = templates.filter((t) => String(t.category || 'wall') === cat.id && t.is_active !== false).length;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => { setCategoryId(cat.id); setQuery(''); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '14px 14px', borderRadius: 12, cursor: 'pointer',
                          border: `1px solid ${meta.color || 'var(--border)'}44`,
                          background: `${meta.color || '#94A3B8'}14`,
                          textAlign: 'right', width: '100%',
                          color: 'var(--text-1)',
                        }}
                      >
                        <div style={{
                          width: 10, height: 10, borderRadius: '50%',
                          background: meta.color || '#94A3B8', flexShrink: 0,
                        }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 800, fontSize: 14 }}>{cat.label || meta.label}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                            {meta.hint || ''} · {count} תבניות
                          </div>
                        </div>
                        <ArrowRight size={16} style={{ color: 'var(--text-3)', transform: 'scaleX(-1)' }} />
                      </button>
                    );
                  })}
                </>
              )}

              {loading && (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)' }}>
                  <Loader2 size={20} className="spin" />
                </div>
              )}

              {/* Global search results with category labels */}
              {groupedSearch && !loading && (
                groupedSearch.length === 0 ? (
                  <div style={{ padding: 16, fontSize: 13, color: 'var(--text-3)' }}>לא נמצאו תבניות</div>
                ) : (
                  groupedSearch.map((g) => (
                    <div key={g.id} style={{ marginBottom: 8 }}>
                      <div style={{
                        fontSize: 11, fontWeight: 800, color: CATEGORY_META[g.id]?.color || 'var(--text-3)',
                        margin: '6px 4px',
                      }}>
                        {g.label}
                      </div>
                      {g.templates.map((tpl) => (
                        <TemplateRow
                          key={tpl.id}
                          tpl={tpl}
                          busy={busy === tpl.id}
                          onPick={() => pickTemplate(tpl)}
                          onRemove={(e) => remove(tpl, e)}
                        />
                      ))}
                    </div>
                  ))
                )
              )}

              {/* Inside a category */}
              {categoryId && !loading && (
                <>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => { setCategoryId(null); setQuery(''); }}
                    style={{ alignSelf: 'flex-start', marginBottom: 4 }}
                  >
                    ← חזרה לקטגוריות
                  </button>
                  {filtered.length === 0 ? (
                    <div style={{ padding: 16, fontSize: 13, color: 'var(--text-3)' }}>
                      אין תבניות בקטגוריה זו
                    </div>
                  ) : (
                    filtered.map((tpl) => (
                      <TemplateRow
                        key={tpl.id}
                        tpl={tpl}
                        busy={busy === tpl.id}
                        onPick={() => pickTemplate(tpl)}
                        onRemove={(e) => remove(tpl, e)}
                      />
                    ))
                  )}
                </>
              )}

              {msg && <div style={{ fontSize: 12, color: '#FCA5A5', padding: 6 }}>{msg}</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TemplateRow({ tpl, busy, onPick, onRemove }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => { if (e.key === 'Enter') onPick(); }}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
        border: '1px solid var(--border)',
        background: 'rgba(255,255,255,0.02)',
        marginBottom: 6,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>{tpl.name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
          {tpl.price ? `₪${Math.round(Number(tpl.price))}` : 'ללא מחיר קבוע'}
          {tpl.max_participants ? ` · עד ${tpl.max_participants}` : ''}
          {tpl.location ? ` · ${tpl.location}` : ''}
        </div>
      </div>
      {busy ? (
        <Loader2 size={14} className="spin" />
      ) : (
        <button
          type="button"
          className="icon-btn"
          onClick={onRemove}
          aria-label="מחיקה"
          style={{ color: '#F87171' }}
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}
