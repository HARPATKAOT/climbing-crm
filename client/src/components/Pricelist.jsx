import React, { useState, useMemo, useEffect } from 'react';
import { Plus, Edit2, Trash2, Save, X, Search, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';

const NOTION_PRICELIST = [
  { id: 'pr-1a', name: 'כניסה לקיר', price: 50, description: 'כניסה בודדת לקיר הטיפוס ללא הגבלת זמן', notes: '', durationH: null, participants: '', categories: ['כניסה'], ages: ['ללא הגבלה'], active: true },
  { id: 'pr-2a', name: 'כניסה ילד (עד 18)', price: 40, description: 'כניסה בודדת לקיר הטיפוס לבני נוער עד גיל 18', notes: '', durationH: null, participants: '', categories: ['כניסה'], ages: ['ללא הגבלה'], active: true },
  { id: 'pr-kt10', name: 'כרטיסייה 10 כניסות', price: 400, description: '10 כניסות לקיר הטיפוס. בתוקף למשך שנה.', notes: '40₪ לכניסה — הנחה של 20% מכניסה בודדת.', durationH: null, participants: '', categories: ['כרטיסיה', 'כניסה'], ages: ['ללא הגבלה'], active: true },
];

const ALL_CATEGORIES = [
  'כניסה', 'כרטיסיה', 'מנוי', 'שיעורים פרטיים',
  'קורסים', 'קייטנה', 'השכרת ציוד', 'שונות',
  'הנחות', 'אירועים',
];

const CATEGORY_COLORS = {
  'כניסה':         { bg: 'rgba(99,102,241,0.12)',  text: '#A5B4FC' },
  'כרטיסיה':       { bg: 'rgba(16,185,129,0.1)',   text: '#34D399' },
  'מנוי':          { bg: 'rgba(6,182,212,0.1)',    text: '#67E8F9' },
  'שיעורים פרטיים': { bg: 'rgba(245,158,11,0.1)',  text: '#FCD34D' },
  'קורסים':        { bg: 'rgba(168,85,247,0.1)',   text: '#C084FC' },
  'קייטנה':        { bg: 'rgba(236,72,153,0.1)',   text: '#F472B6' },
  'השכרת ציוד':    { bg: 'rgba(249,115,22,0.1)',   text: '#FB923C' },
  'שונות':         { bg: 'rgba(255,255,255,0.06)', text: 'var(--text-3)' },
  'הנחות':         { bg: 'rgba(239,68,68,0.08)',   text: '#FCA5A5' },
  'אירועים':       { bg: 'rgba(52,211,153,0.1)',   text: '#6EE7B7' },
};
const defaultColor = { bg: 'rgba(255,255,255,0.05)', text: 'var(--text-2)' };

function CatBadge({ cat }) {
  const c = CATEGORY_COLORS[cat] || defaultColor;
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600,
      background: c.bg, color: c.text,
    }}>{cat}</span>
  );
}

function ItemForm({ item, onSave, onCancel }) {
  const isNew = !item?.id;
  const [name, setName]         = useState(item?.name || '');
  const [price, setPrice]       = useState(item?.price ?? '');
  const [desc, setDesc]         = useState(item?.description || '');
  const [notes, setNotes]       = useState(item?.notes || '');
  const [durationH, setDur]     = useState(item?.durationH ?? '');
  const [participants, setPart] = useState(item?.participants || '');
  const [cats, setCats]         = useState(item?.categories || []);
  const [ages, setAges]         = useState(item?.ages || []);
  const [active, setActive]     = useState(item?.active ?? true);
  const [productType, setProductType] = useState(item?.product_type || 'product');
  const [visitsTotal, setVisitsTotal] = useState(item?.visits_total ?? 10);
  const [validityDays, setValidityDays] = useState(item?.validity_days ?? '');
  const [durationDays, setDurationDays] = useState(item?.duration_days ?? 30);
  const [stockQty, setStockQty] = useState(item?.stock_qty ?? '');
  const [trackInventory, setTrackInventory] = useState(item?.track_inventory ?? false);

  const toggleCat = (cat) => setCats(prev =>
    prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
  );
  const toggleAge = (age) => setAges(prev =>
    prev.includes(age) ? prev.filter(a => a !== age) : [...prev, age]
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({
      ...(item || {}),
      name: name.trim(),
      price: parseFloat(price) || 0,
      description: desc.trim(),
      notes: notes.trim(),
      durationH: durationH !== '' ? parseFloat(durationH) : null,
      participants: participants.toString(),
      categories: cats,
      ages,
      active,
      product_type: productType,
      visits_total: productType === 'punch_card' ? (parseInt(visitsTotal, 10) || 10) : null,
      validity_days: productType === 'punch_card' && validityDays !== '' ? parseInt(validityDays, 10) : null,
      duration_days: productType === 'time_membership' ? (parseInt(durationDays, 10) || 30) : null,
      track_inventory: productType === 'product' ? !!trackInventory : false,
      stock_qty: productType === 'product' && stockQty !== '' ? parseInt(stockQty, 10) : null,
    });
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="form-grid-2">
        <div className="form-group" style={{ gridColumn: 'span 2' }}>
          <label className="form-label">שם הפריט *</label>
          <input className="input" required value={name} onChange={e => setName(e.target.value)}
            placeholder="כניסה בודדת..." />
        </div>
        <div className="form-group">
          <label className="form-label">סוג פריט</label>
          <select className="input select" value={productType} onChange={(e) => setProductType(e.target.value)}>
            <option value="product">מוצר / ציוד / חד־פעמי</option>
            <option value="punch_card">כרטיסייה (כניסות)</option>
            <option value="time_membership">מנוי לפי זמן</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">מחיר (₪)</label>
          <input className="input" type="number" min={0} step={0.5} value={price}
            onChange={e => setPrice(e.target.value)} placeholder="0" />
        </div>
        {productType === 'punch_card' && (
          <>
            <div className="form-group">
              <label className="form-label">מספר כניסות</label>
              <input className="input" type="number" min={1} value={visitsTotal}
                onChange={e => setVisitsTotal(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">תוקף בימים (ריק = בלי)</label>
              <input className="input" type="number" min={1} value={validityDays}
                onChange={e => setValidityDays(e.target.value)} placeholder="365" />
            </div>
          </>
        )}
        {productType === 'time_membership' && (
          <div className="form-group">
            <label className="form-label">משך מנוי (ימים)</label>
            <input className="input" type="number" min={1} value={durationDays}
              onChange={e => setDurationDays(e.target.value)} />
          </div>
        )}
        {productType === 'product' && (
          <>
            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <label className="form-label" style={{ marginBottom: 0 }}>מעקב מלאי?</label>
              <input type="checkbox" checked={trackInventory} onChange={e => setTrackInventory(e.target.checked)}
                style={{ width: 18, height: 18, cursor: 'pointer' }} />
            </div>
            {trackInventory && (
              <div className="form-group">
                <label className="form-label">כמות במלאי</label>
                <input className="input" type="number" min={0} value={stockQty}
                  onChange={e => setStockQty(e.target.value)} />
              </div>
            )}
          </>
        )}
        <div className="form-group">
          <label className="form-label">מספר משתתפים</label>
          <input className="input" value={participants} onChange={e => setPart(e.target.value)}
            placeholder="1 / 2 / ..." />
        </div>
        <div className="form-group">
          <label className="form-label">משך זמן (שעות)</label>
          <input className="input" type="number" min={0} step={0.25} value={durationH}
            onChange={e => setDur(e.target.value)} placeholder="1.5" />
        </div>
        <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label className="form-label" style={{ marginBottom: 0 }}>פעיל?</label>
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)}
            style={{ width: 18, height: 18, cursor: 'pointer' }} />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">תיאור</label>
        <textarea className="input textarea" rows={2} value={desc}
          onChange={e => setDesc(e.target.value)} placeholder="תיאור קצר של הפריט..." />
      </div>

      <div className="form-group">
        <label className="form-label">הערות פנימיות</label>
        <textarea className="input textarea" rows={2} value={notes}
          onChange={e => setNotes(e.target.value)} placeholder="הערות..." />
      </div>

      <div className="form-group">
        <label className="form-label">קטגוריות</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
          {ALL_CATEGORIES.map(cat => {
            const sel = cats.includes(cat);
            const c = CATEGORY_COLORS[cat] || defaultColor;
            return (
              <button key={cat} type="button" onClick={() => toggleCat(cat)}
                style={{
                  padding: '4px 10px', borderRadius: 20, fontSize: 12, cursor: 'pointer', border: 'none',
                  background: sel ? c.bg : 'rgba(255,255,255,0.04)',
                  color: sel ? c.text : 'var(--text-3)',
                  outline: sel ? `1px solid ${c.text}55` : '1px solid var(--border)',
                  fontWeight: sel ? 700 : 400,
                }}>
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>ביטול</button>
        <button type="submit" className="btn btn-primary btn-sm">
          <Save size={14} /> {isNew ? 'הוסף פריט' : 'שמור שינויים'}
        </button>
      </div>
    </form>
  );
}

export default function Pricelist() {
  const [items, setItems]               = useState([]);
  const [search, setSearch]             = useState('');
  const [activeCat, setActiveCat]       = useState('הכל');
  const [showInactive, setShowInactive] = useState(false);
  const [editingId, setEditingId]       = useState(null);
  const [addingNew, setAddingNew]       = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [expandedId, setExpandedId]     = useState(null);

  const refreshPricelist = async () => {
    try {
      const data = await fetch('/api/pricelist').then(r => r.ok ? r.json() : []);
      if (data.length === 0) {
        setItems(NOTION_PRICELIST);
      } else {
        // Map category property if it's string format
        const formatted = data.map(item => ({
          ...item,
          categories: Array.isArray(item.categories) ? item.categories : (item.category ? [item.category] : ['שונות']),
          active: item.active ?? true
        }));
        setItems(formatted);
      }
    } catch (err) {
      console.error(err);
      setItems(NOTION_PRICELIST);
    }
  };

  useEffect(() => {
    refreshPricelist();
  }, []);

  const usedCategories = useMemo(() => {
    const set = new Set();
    items.forEach(i => i.categories?.forEach(c => set.add(c)));
    return ['הכל', ...ALL_CATEGORIES.filter(c => set.has(c))];
  }, [items]);

  const visible = useMemo(() => {
    return items.filter(item => {
      if (!showInactive && !item.active) return false;
      if (activeCat !== 'הכל' && !item.categories?.includes(activeCat)) return false;
      const q = search.toLowerCase();
      if (q && !item.name.toLowerCase().includes(q) &&
          !item.description?.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, activeCat, search, showInactive]);

  const stats = useMemo(() => ({
    total:    items.length,
    active:   items.filter(i => i.active).length,
    avgPrice: Math.round(items.filter(i => i.price > 0).reduce((s, i) => s + i.price, 0) /
              Math.max(items.filter(i => i.price > 0).length, 1)),
  }), [items]);

  const handleSave = async (data) => {
    const isEdit = items.some(i => i.id === data.id);
    try {
      const response = await fetch(isEdit ? `/api/pricelist/${data.id}` : '/api/pricelist', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          category: data.categories?.[0] || 'שונות'
        })
      });
      if (response.ok) {
        setEditingId(null);
        setAddingNew(false);
        refreshPricelist();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id) => {
    try {
      const response = await fetch(`/api/pricelist/${id}`, { method: 'DELETE' });
      if (response.ok) {
        setDeleteConfirm(null);
        refreshPricelist();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const toggleActive = async (item) => {
    try {
      const updated = { ...item, active: !item.active };
      await fetch(`/api/pricelist/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
      refreshPricelist();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="fade-in">
      {/* Stats */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        {[
          { label: 'סה"כ פריטים',     value: stats.total,    color: '#6366F1', sub: 'במחירון' },
          { label: 'פריטים פעילים',   value: stats.active,   color: '#10B981', sub: 'זמינים למכירה' },
          { label: 'מחיר ממוצע',       value: `₪${stats.avgPrice}`, color: '#6EE7B7', sub: 'פריטים בתשלום' },
        ].map(s => (
          <div key={s.label} className="card stat-card" style={{ '--stat-color': s.color }}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{s.value}</div>
            <div className="stat-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="section-header" style={{ marginBottom: 16 }}>
        <div>
          <div className="section-title">מחירון</div>
          <div className="section-sub">ניהול עלויות שירותים, כניסות, מנויים והשכרת ציוד</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => { setAddingNew(true); setEditingId(null); }}>
          <Plus size={15} /> הוסף פריט
        </button>
      </div>

      {/* Search + filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
          <input className="input" style={{ paddingRight: 32 }} placeholder="חיפוש פריט..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-3)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)}
            style={{ width: 15, height: 15 }} />
          הצג לא פעילים
        </label>
      </div>

      {/* Category tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
        {usedCategories.map(cat => {
          const isAll = cat === 'הכל';
          const active = activeCat === cat;
          const c = CATEGORY_COLORS[cat] || defaultColor;
          return (
            <button key={cat} onClick={() => setActiveCat(cat)}
              style={{
                padding: '5px 14px', borderRadius: 20, fontSize: 12, cursor: 'pointer', border: 'none',
                background: active ? (isAll ? 'rgba(99,102,241,0.2)' : c.bg) : 'rgba(255,255,255,0.04)',
                color: active ? (isAll ? '#A5B4FC' : c.text) : 'var(--text-3)',
                outline: active ? `1px solid ${isAll ? '#A5B4FC55' : c.text + '55'}` : '1px solid var(--border)',
                fontWeight: active ? 700 : 400,
              }}>
              {cat}
            </button>
          );
        })}
      </div>

      {/* New Item Form */}
      {addingNew && (
        <div className="card card-p" style={{ marginBottom: 20, borderColor: 'rgba(99,102,241,0.3)' }}>
          <div style={{ fontWeight: 700, marginBottom: 16, color: '#A5B4FC' }}>
            <Plus size={16} style={{ verticalAlign: 'middle', marginLeft: 6 }} />
            פריט חדש
          </div>
          <ItemForm
            item={null}
            onSave={handleSave}
            onCancel={() => setAddingNew(false)}
          />
        </div>
      )}

      {/* Delete Confirm */}
      {deleteConfirm && (
        <div className="alert alert-warn" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>למחוק את <strong>"{deleteConfirm.name}"</strong>?</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setDeleteConfirm(null)}>ביטול</button>
            <button className="btn btn-danger btn-sm" onClick={() => handleDelete(deleteConfirm.id)}>
              <Trash2 size={13} /> מחק
            </button>
          </div>
        </div>
      )}

      {/* Items */}
      <div className="card">
        {visible.length === 0 ? (
          <div className="empty-state" style={{ padding: 60 }}>
            <div className="empty-state-title">לא נמצאו פריטים</div>
          </div>
        ) : (
          <div>
            {visible.map((item, idx) => {
              const isEditing  = editingId === item.id;
              const isExpanded = expandedId === item.id;
              const hasDetails = item.description || item.notes;

              return (
                <div key={item.id} style={{
                  borderBottom: idx < visible.length - 1 ? '1px solid var(--border)' : 'none',
                  opacity: item.active ? 1 : 0.45,
                }}>
                  {!isEditing ? (
                    <div style={{ padding: '14px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 700, fontSize: 14 }}>{item.name}</span>
                          </div>
                          {item.categories?.length > 0 && (
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 5 }}>
                              {item.categories.map(c => <CatBadge key={c} cat={c} />)}
                            </div>
                          )}
                          {item.description && !isExpanded && (
                            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '480px' }}>
                              {item.description}
                            </div>
                          )}
                        </div>

                        <div style={{ textAlign: 'left', flexShrink: 0, minWidth: 80 }}>
                          {item.price > 0 ? (
                            <span style={{ fontSize: 18, fontWeight: 900, color: '#34D399' }}>₪{item.price.toLocaleString()}</span>
                          ) : (
                            <span style={{ fontSize: 13, color: 'var(--text-3)' }}>ללא מחיר</span>
                          )}
                        </div>

                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                          {hasDetails && (
                            <button className="btn btn-ghost btn-icon btn-xs"
                              onClick={() => setExpandedId(isExpanded ? null : item.id)}>
                              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                          )}
                          <button className="btn btn-ghost btn-icon btn-xs"
                            onClick={() => toggleActive(item)}
                            style={{ color: item.active ? 'var(--green)' : 'var(--text-3)' }}>
                            {item.active ? '✓' : '○'}
                          </button>
                          <button className="btn btn-ghost btn-icon btn-xs"
                            onClick={() => { setEditingId(item.id); setAddingNew(false); setExpandedId(item.id); }}>
                            <Edit2 size={13} />
                          </button>
                          <button className="btn btn-ghost btn-icon btn-xs" style={{ color: 'var(--red)' }}
                            onClick={() => setDeleteConfirm(item)}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>

                      {isExpanded && hasDetails && (
                        <div style={{
                          marginTop: 12, padding: '12px 16px',
                          background: 'rgba(255,255,255,0.02)',
                          borderRadius: 8, border: '1px solid var(--border)',
                        }}>
                          {item.description && (
                            <div style={{ marginBottom: item.notes ? 10 : 0 }}>
                              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 3 }}>תיאור</div>
                              <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>{item.description}</div>
                            </div>
                          )}
                          {item.notes && (
                            <div style={{ marginTop: 0 }}>
                              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 3 }}>הערות פנימיות</div>
                              <div style={{ fontSize: 12, color: '#FCD34D', lineHeight: 1.6 }}>💡 {item.notes}</div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ padding: '16px 20px', background: 'rgba(99,102,241,0.04)', borderRight: '3px solid #6366F1' }}>
                      <ItemForm
                        item={item}
                        onSave={handleSave}
                        onCancel={() => setEditingId(null)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
