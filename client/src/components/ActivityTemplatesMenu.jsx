import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, Cake, Clock3, Dumbbell, FileStack, FileText, Footprints,
  GraduationCap, Handshake, Loader2, Mountain, Pencil, Plus, Search, Sparkles,
  Trash2, TreePine, Users, Waves, X,
} from 'lucide-react';

const CATEGORY_META = {
  field: { label: 'פעילויות שטח', color: '#34D399', hint: 'טיולים, נחלים וטיפוס בטבע' },
  wall: { label: 'אירועים בקיר', color: '#FB923C', hint: 'ימי הולדת, גיבוש ואימונים' },
  ops: { label: 'תפעול', color: '#7DD3FC', hint: 'ניקיון, צוות, מסלולים ושעות פתיחה' },
};

/** Icons for starter templates (by stable id). */
const TEMPLATE_ICON_BY_ID = {
  tpl_field_rahaf: { Icon: Waves, color: '#60A5FA' },
  tpl_field_black_canyon: { Icon: Footprints, color: '#34D399' },
  tpl_field_kabra: { Icon: TreePine, color: '#A78BFA' },
  tpl_wall_private: { Icon: Dumbbell, color: '#38BDF8' },
  tpl_wall_birthday: { Icon: Cake, color: '#FB923C' },
  tpl_wall_teambuilding: { Icon: Handshake, color: '#FBBF24' },
  tpl_ops_cleaning: { Icon: Sparkles, color: '#7DD3FC' },
  tpl_ops_team_meeting: { Icon: Users, color: '#C4B5FD' },
  tpl_ops_route_building: { Icon: Mountain, color: '#A78BFA' },
  tpl_ops_opening_hours: { Icon: Clock3, color: '#22D3EE' },
};

/** Fallback by activity type for custom / unknown templates. */
const TEMPLATE_ICON_BY_TYPE = {
  opening_hours: { Icon: Clock3, color: '#22D3EE' },
  route_building: { Icon: Mountain, color: '#A78BFA' },
  birthday: { Icon: Cake, color: '#FB923C' },
  trip: { Icon: Footprints, color: '#34D399' },
  school: { Icon: GraduationCap, color: '#34D399' },
  company: { Icon: Handshake, color: '#FBBF24' },
  other: { Icon: FileText, color: '#94A3B8' },
};

function iconForTemplate(tpl) {
  return TEMPLATE_ICON_BY_ID[tpl?.id]
    || TEMPLATE_ICON_BY_TYPE[tpl?.type]
    || { Icon: FileText, color: '#94A3B8' };
}

// Pseudo-category: drills into the writable Google calendars instead of templates.
const GOOGLE_CAT = '__google_calendars__';
const GOOGLE_CAT_META = {
  label: 'יומני גוגל',
  color: '#A78BFA',
  hint: 'אירוע ישירות ביומן חיצוני',
};

/**
 * Category → template picker.
 * Selecting a template opens a prefilled (unsaved) activity form.
 * "אירוע מותאם" opens a blank custom form.
 * Supports controlled open (e.g. from day "+" on the calendar).
 * startInManageMode: open as template admin (toolbar «תבניות»), not create-event.
 */
export default function ActivityTemplatesMenu({
  onApplyTemplate,
  onEditTemplate,
  onCreateTemplate,
  onCustomEvent,
  onExternalEvent,
  externalCalendars = [],
  defaultDate,
  open: controlledOpen,
  onOpenChange,
  onRequestOpen,
  hideTrigger = false,
  startInManageMode = false,
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (next) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const [templates, setTemplates] = useState([]);
  const [categories, setCategories] = useState([
    { id: 'field', label: 'פעילויות שטח' },
    { id: 'wall', label: 'אירועים בקיר' },
    { id: 'ops', label: 'תפעול' },
  ]);
  const [categoryId, setCategoryId] = useState(null); // null = pick category
  const [manageMode, setManageMode] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const resolveDate = () => defaultDate || new Date().toISOString().slice(0, 10);

  const load = async ({ silent = false } = {}) => {
    // Keep existing UI stable when we already have data — avoids modal height jump.
    if (!silent) setLoading(true);
    setMsg('');
    try {
      const res = await fetch('/api/activity-templates?grouped=1');
      if (!res.ok) {
        setMsg('טעינת תבניות נכשלה');
        return;
      }
      const data = await res.json();
      // Always keep local CATEGORY_META (incl. ops) even if API is stale.
      const fromApi = Array.isArray(data.categories) ? data.categories : [];
      const byId = new Map(fromApi.map((c) => [c.id, c]));
      const merged = Object.keys(CATEGORY_META).map((id) => ({
        id,
        label: byId.get(id)?.label || CATEGORY_META[id].label,
      }));
      for (const c of fromApi) {
        if (!CATEGORY_META[c.id] && c.id) merged.push({ id: c.id, label: c.label || c.id });
      }
      setCategories(merged);
      setTemplates(Array.isArray(data.templates) ? data.templates : (Array.isArray(data) ? data : []));
    } catch {
      setMsg('שגיאת רשת');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setCategoryId(null);
      setManageMode(!!startInManageMode);
      setQuery('');
      // Silent refresh when templates already cached — prevents spinner/height jump.
      load({ silent: templates.length > 0 });
    }
  }, [open, startInManageMode]);

  const startCreate = (catId) => {
    setOpen(false);
    onCreateTemplate?.(catId || categoryId || 'wall');
  };

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

  const inGoogleCat = categoryId === GOOGLE_CAT;
  const showGoogleCat = !!onExternalEvent && externalCalendars.length > 0;

  const filteredCalendars = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return externalCalendars;
    return externalCalendars.filter((c) => String(c.name || '').toLowerCase().includes(q));
  }, [externalCalendars, query]);

  const pickTemplate = (tpl) => {
    setBusy(tpl.id);
    setMsg('');
    try {
      onApplyTemplate?.(tpl, resolveDate());
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

  const editTemplate = (tpl, e) => {
    e?.stopPropagation?.();
    setOpen(false);
    onEditTemplate?.(tpl);
  };

  const startCustom = () => {
    setOpen(false);
    onCustomEvent?.(resolveDate());
  };

  const startExternal = (calendarId) => {
    setOpen(false);
    onExternalEvent?.(calendarId, resolveDate());
  };

  const dateLabel = defaultDate
    ? String(defaultDate).slice(0, 10).split('-').reverse().join('/')
    : '';

  return (
    <div style={{ position: 'relative' }}>
      {!hideTrigger && (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            onRequestOpen?.();
            setOpen(true);
          }}
          title="ניהול תבניות — הוספה, עריכה ומחיקה"
        >
          <FileStack size={16} strokeWidth={2.25} />
          תבניות
        </button>
      )}

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
                  {inGoogleCat
                    ? GOOGLE_CAT_META.label
                    : manageMode && !categoryId
                      ? 'ניהול תבניות'
                      : categoryId
                        ? (CATEGORY_META[categoryId]?.label || categories.find((c) => c.id === categoryId)?.label || 'תבניות')
                        : 'אירוע חדש'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                  {inGoogleCat
                    ? 'בחרו יומן — האירוע ייווצר ישירות בגוגל'
                    : manageMode && !categoryId
                      ? 'בחרו קטגוריה כדי להוסיף, לערוך או למחוק תבנית'
                      : categoryId
                        ? (manageMode
                          ? 'הוסיפו תבנית חדשה, או ערכו / מחקו תבנית קיימת'
                          : 'בחרו תבנית לאירוע חדש')
                        : (dateLabel
                          ? `לתאריך ${dateLabel} — מתבנית שמורה או אירוע ריק`
                          : 'מתבנית שמורה, או אירוע מותאם ללקוח')}
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
                  placeholder={inGoogleCat
                    ? 'חיפוש יומן...'
                    : (categoryId ? 'חיפוש בתוך הקטגוריה...' : 'חיפוש בכל הקטגוריות...')}
                  style={{ paddingInlineStart: 32 }}
                />
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {!categoryId && !query.trim() && (
                <>
                  {!manageMode && (
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
                        <div style={{ fontWeight: 800, fontSize: 14 }}>אירוע בלי תבנית</div>
                        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                          טופס ריק — מחיר, טקסט וקישור הרשמה חופשיים
                        </div>
                      </div>
                    </button>
                  )}

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
                            {meta.hint || ''} · {loading ? '…' : `${count} תבניות`}
                          </div>
                        </div>
                        <ArrowRight size={16} style={{ color: 'var(--text-3)', transform: 'scaleX(-1)' }} />
                      </button>
                    );
                  })}

                  {showGoogleCat && !manageMode && (
                    <button
                      type="button"
                      onClick={() => { setCategoryId(GOOGLE_CAT); setQuery(''); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '14px 14px', borderRadius: 12, cursor: 'pointer',
                        border: `1px solid ${GOOGLE_CAT_META.color}44`,
                        background: `${GOOGLE_CAT_META.color}14`,
                        textAlign: 'right', width: '100%',
                        color: 'var(--text-1)',
                      }}
                    >
                      <div style={{
                        width: 10, height: 10, borderRadius: '50%',
                        background: GOOGLE_CAT_META.color, flexShrink: 0,
                      }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 800, fontSize: 14 }}>{GOOGLE_CAT_META.label}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                          {GOOGLE_CAT_META.hint} · {externalCalendars.length} יומנים
                        </div>
                      </div>
                      <ArrowRight size={16} style={{ color: 'var(--text-3)', transform: 'scaleX(-1)' }} />
                    </button>
                  )}
                </>
              )}

              {/* Inside the Google calendars category */}
              {inGoogleCat && (
                <>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => { setCategoryId(null); setQuery(''); }}
                    style={{ alignSelf: 'flex-start', marginBottom: 4 }}
                  >
                    ← חזרה לקטגוריות
                  </button>
                  {filteredCalendars.length === 0 ? (
                    <div style={{ padding: 16, fontSize: 13, color: 'var(--text-3)' }}>
                      לא נמצאו יומנים
                    </div>
                  ) : (
                    filteredCalendars.map((cal) => (
                      <button
                        key={cal.id}
                        type="button"
                        onClick={() => startExternal(cal.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                          border: '1px solid var(--border)',
                          background: 'rgba(255,255,255,0.02)',
                          textAlign: 'right', width: '100%',
                          color: 'var(--text-1)',
                          marginBottom: 6,
                        }}
                      >
                        <div style={{
                          width: 9, height: 9, borderRadius: '50%',
                          background: cal.backgroundColor || '#94A3B8', flexShrink: 0,
                        }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: 13, fontWeight: 700,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>
                            {cal.name}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                            נשמר ישירות ביומן גוגל — בלי הרשמה או תשלום
                          </div>
                        </div>
                        <Plus size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                      </button>
                    ))
                  )}
                </>
              )}

              {/* Spinner only when content depends on templates (search / category) — not on the category picker itself */}
              {loading && !inGoogleCat && (categoryId || !!query.trim()) && (
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
                          manageMode={manageMode}
                          onPick={() => (manageMode ? editTemplate(tpl) : pickTemplate(tpl))}
                          onEdit={manageMode && onEditTemplate ? (e) => editTemplate(tpl, e) : null}
                          onRemove={manageMode ? (e) => remove(tpl, e) : null}
                        />
                      ))}
                    </div>
                  ))
                )
              )}

              {/* Inside a template category */}
              {categoryId && !inGoogleCat && !loading && (
                <>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => { setCategoryId(null); setQuery(''); }}
                    style={{ alignSelf: 'flex-start', marginBottom: 4 }}
                  >
                    ← חזרה לקטגוריות
                  </button>

                  {manageMode && onCreateTemplate && (
                    <button
                      type="button"
                      onClick={() => startCreate(categoryId)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                        border: '1px dashed rgba(125,211,252,0.5)',
                        background: 'rgba(125,211,252,0.08)',
                        textAlign: 'right', width: '100%',
                        color: 'var(--text-1)',
                        marginBottom: 6,
                      }}
                    >
                      <Plus size={16} style={{ color: '#7DD3FC' }} />
                      <div style={{ flex: 1, fontWeight: 800, fontSize: 13 }}>
                        תבנית חדשה בקטגוריה זו
                      </div>
                    </button>
                  )}

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
                        manageMode={manageMode}
                        onPick={() => (manageMode ? editTemplate(tpl) : pickTemplate(tpl))}
                        onEdit={manageMode && onEditTemplate ? (e) => editTemplate(tpl, e) : null}
                        onRemove={manageMode ? (e) => remove(tpl, e) : null}
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

function TemplateRow({ tpl, busy, manageMode, onPick, onEdit, onRemove }) {
  const { Icon, color } = iconForTemplate(tpl);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => { if (e.key === 'Enter') onPick(); }}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
        border: manageMode ? '1px solid rgba(125,211,252,0.35)' : '1px solid var(--border)',
        background: manageMode ? 'rgba(125,211,252,0.06)' : 'rgba(255,255,255,0.02)',
        marginBottom: 6,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = manageMode
          ? 'rgba(125,211,252,0.12)'
          : 'rgba(255,255,255,0.05)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = manageMode
          ? 'rgba(125,211,252,0.06)'
          : 'rgba(255,255,255,0.02)';
      }}
    >
      <div
        aria-hidden
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: `${color}22`,
          border: `1px solid ${color}44`,
          color,
        }}
      >
        <Icon size={16} strokeWidth={2.25} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>{tpl.name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
          {tpl.type === 'opening_hours'
            ? 'שעות פתיחה'
            : (tpl.price ? `₪${Math.round(Number(tpl.price))}` : 'ללא מחיר קבוע')}
          {tpl.start_time && tpl.end_time ? ` · ${String(tpl.start_time).slice(0, 5)}–${String(tpl.end_time).slice(0, 5)}` : ''}
          {tpl.max_participants ? ` · עד ${tpl.max_participants}` : ''}
          {tpl.location ? ` · ${tpl.location}` : ''}
        </div>
      </div>
      {busy ? (
        <Loader2 size={14} className="spin" />
      ) : (onEdit || onRemove) ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={(e) => e.stopPropagation()}>
          {onEdit && (
            <button
              type="button"
              className="icon-btn"
              onClick={onEdit}
              aria-label="עריכה"
              title="עריכת תבנית"
              style={{
                color: '#7DD3FC',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                paddingInline: manageMode ? 8 : 6,
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              <Pencil size={12} />
              {manageMode ? 'עריכה' : null}
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              className="icon-btn"
              onClick={onRemove}
              aria-label="מחיקה"
              title="מחיקת תבנית"
              style={{
                color: '#F87171',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                paddingInline: manageMode ? 8 : 6,
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              <Trash2 size={12} />
              {manageMode ? 'מחיקה' : null}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
