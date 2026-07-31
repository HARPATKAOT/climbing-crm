import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Plus, Edit2, Trash2, Save, Search, AlertCircle, ArrowRight,
  ImagePlus, X, Package, FolderOpen, Crop, Maximize2, Link2,
} from 'lucide-react';
import {
  PRODUCT_CATEGORIES,
  CATEGORY_COLORS,
  CATEGORY_ICONS,
  DEFAULT_CATEGORY_COLOR,
  normalizeCategories,
  compressImageFile,
  catTint,
  imageBackground,
} from './productCategories.js';

const NOTION_PRICELIST = [
  { id: 'pr-1a', name: 'כניסה לקיר', price: 50, description: 'כניסה בודדת לקיר הטיפוס ללא הגבלת זמן', notes: '', durationH: null, participants: '', categories: ['כניסה'], ages: ['ללא הגבלה'], active: true, image: '' },
  { id: 'pr-2a', name: 'כניסה ילד (עד 18)', price: 40, description: 'כניסה בודדת לקיר הטיפוס לבני נוער עד גיל 18', notes: '', durationH: null, participants: '', categories: ['כניסה'], ages: ['ללא הגבלה'], active: true, image: '' },
  { id: 'pr-kt10', name: 'כרטיסייה 10 כניסות', price: 400, description: '10 כניסות לקיר הטיפוס. בתוקף למשך שנה.', notes: '40₪ לכניסה — הנחה של 20% מכניסה בודדת.', durationH: null, participants: '', categories: ['כרטיסיות ומנויים', 'כניסה'], ages: ['ללא הגבלה'], active: true, image: '' },
];

const defaultColor = DEFAULT_CATEGORY_COLOR;

/** Virtual folder for products whose category was deleted or never set. */
const UNCATEGORIZED = '__uncategorized__';
const UNCATEGORIZED_LABEL = 'ללא קטגוריה';

function catLabel(name) {
  return name === UNCATEGORIZED ? UNCATEGORIZED_LABEL : name;
}

function catColor(name) {
  return CATEGORY_COLORS[name] || defaultColor;
}

function ImagePicker({ value, onChange, label = 'תמונה', tall = false, fit = 'cover', onFitChange }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setErr('');
    try {
      const dataUrl = await compressImageFile(file);
      onChange(dataUrl);
    } catch (ex) {
      setErr(ex.message || 'שגיאה בטעינת תמונה');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
        <div
          style={{
            width: tall ? 120 : 88,
            height: tall ? 120 : 88,
            borderRadius: 12,
            border: '1px dashed var(--border)',
            background: 'rgba(255,255,255,0.03)',
            overflow: 'hidden',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {value ? (
            <img src={value} alt="" style={{ width: '100%', height: '100%', objectFit: fit }} />
          ) : (
            <ImagePlus size={22} style={{ color: 'var(--text-3)' }} />
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
          <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={pick} />
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            <ImagePlus size={14} /> {busy ? 'מעבד...' : value ? 'החלף תמונה' : 'העלה תמונה'}
          </button>
          {value && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange('')}>
              <X size={14} /> הסר תמונה
            </button>
          )}
          {value && onFitChange && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                type="button"
                className={`btn btn-xs ${fit === 'cover' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => onFitChange('cover')}
                title="התמונה ממלאת את המסגרת, הקצוות נחתכים"
              >
                <Crop size={12} /> מילוי
              </button>
              <button
                type="button"
                className={`btn btn-xs ${fit === 'contain' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => onFitChange('contain')}
                title="כל התמונה נכנסת למסגרת בלי חיתוך"
              >
                <Maximize2 size={12} /> התאמה למסגרת
              </button>
            </div>
          )}
          {err && <div style={{ fontSize: 12, color: 'var(--red)' }}>{err}</div>}
        </div>
      </div>
    </div>
  );
}

function ItemForm({ item, onSave, onCancel, categoryOptions, defaultCategory }) {
  const isNew = !item?.id;
  const [name, setName] = useState(item?.name || '');
  const [price, setPrice] = useState(item?.price ?? '');
  const [desc, setDesc] = useState(item?.description || '');
  const [notes, setNotes] = useState(item?.notes || '');
  const [durationH, setDur] = useState(item?.durationH ?? '');
  const [participants, setPart] = useState(item?.participants || '');
  const [cats, setCats] = useState(
    item?.categories?.length
      ? item.categories
      : defaultCategory
        ? [defaultCategory]
        : []
  );
  const [active, setActive] = useState(item?.active ?? true);
  const [productType, setProductType] = useState(item?.product_type || 'product');
  const [visitsTotal, setVisitsTotal] = useState(item?.visits_total ?? 10);
  const [validityDays, setValidityDays] = useState(item?.validity_days ?? '');
  const [durationDays, setDurationDays] = useState(item?.duration_days ?? 30);
  const [stockQty, setStockQty] = useState(item?.stock_qty ?? '');
  const [trackInventory, setTrackInventory] = useState(item?.track_inventory ?? false);
  const [image, setImage] = useState(item?.image || '');
  const [imageFit, setImageFit] = useState(item?.image_fit === 'contain' ? 'contain' : 'cover');
  const [selfServe, setSelfServe] = useState(item?.self_serve === true);
  const sellableOnline = productType === 'punch_card' || productType === 'time_membership';

  const toggleCat = (cat) => setCats((prev) =>
    prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
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
      categories: normalizeCategories(cats.length ? cats : (defaultCategory ? [defaultCategory] : ['שונות'])),
      ages: item?.ages || [],
      active,
      image: image || '',
      image_fit: imageFit,
      product_type: productType,
      visits_total: productType === 'punch_card' ? (parseInt(visitsTotal, 10) || 10) : null,
      validity_days: productType === 'punch_card' && validityDays !== '' ? parseInt(validityDays, 10) : null,
      duration_days: productType === 'time_membership' ? (parseInt(durationDays, 10) || 30) : null,
      track_inventory: productType === 'product' ? !!trackInventory : false,
      stock_qty: productType === 'product' && stockQty !== '' ? parseInt(stockQty, 10) : null,
      self_serve: sellableOnline && selfServe,
    });
  };

  const options = categoryOptions?.length ? categoryOptions : PRODUCT_CATEGORIES;

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <ImagePicker value={image} onChange={setImage} label="תמונת מוצר" tall
        fit={imageFit} onFitChange={setImageFit} />

      <div className="form-grid-2">
        <div className="form-group" style={{ gridColumn: 'span 2' }}>
          <label className="form-label">שם הפריט *</label>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)}
            placeholder="רתמת טיפוס..." />
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
            onChange={(e) => setPrice(e.target.value)} placeholder="0" />
        </div>
        {productType === 'punch_card' && (
          <>
            <div className="form-group">
              <label className="form-label">מספר כניסות</label>
              <input className="input" type="number" min={1} value={visitsTotal}
                onChange={(e) => setVisitsTotal(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">תוקף בימים (ריק = בלי)</label>
              <input className="input" type="number" min={1} value={validityDays}
                onChange={(e) => setValidityDays(e.target.value)} placeholder="365" />
            </div>
          </>
        )}
        {productType === 'time_membership' && (
          <div className="form-group">
            <label className="form-label">משך מנוי (ימים)</label>
            <input className="input" type="number" min={1} value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)} />
          </div>
        )}
        {productType === 'product' && (
          <>
            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <label className="form-label" style={{ marginBottom: 0 }}>מעקב מלאי?</label>
              <input type="checkbox" checked={trackInventory} onChange={(e) => setTrackInventory(e.target.checked)}
                style={{ width: 18, height: 18, cursor: 'pointer' }} />
            </div>
            {trackInventory && (
              <div className="form-group">
                <label className="form-label">כמות במלאי</label>
                <input className="input" type="number" min={0} value={stockQty}
                  onChange={(e) => setStockQty(e.target.value)} />
              </div>
            )}
          </>
        )}
        <div className="form-group">
          <label className="form-label">מספר משתתפים</label>
          <input className="input" value={participants} onChange={(e) => setPart(e.target.value)}
            placeholder="1 / 2 / ..." />
        </div>
        <div className="form-group">
          <label className="form-label">משך זמן (שעות)</label>
          <input className="input" type="number" min={0} step={0.25} value={durationH}
            onChange={(e) => setDur(e.target.value)} placeholder="1.5" />
        </div>
        <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label className="form-label" style={{ marginBottom: 0 }}>פעיל?</label>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)}
            style={{ width: 18, height: 18, cursor: 'pointer' }} />
        </div>
      </div>

      {sellableOnline && (
        <div className="form-group" style={{ padding: 12, borderRadius: 10, background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.25)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={selfServe} onChange={(e) => setSelfServe(e.target.checked)}
              style={{ width: 18, height: 18, cursor: 'pointer' }} />
            <span style={{ fontWeight: 700 }}>מכירה עצמית בקישור ציבורי</span>
          </label>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>
            כל אחד יוכל להיכנס לקישור, למלא פרטים והצהרת בריאות (אם אין לו בתוקף) ולשלם.
            הכרטיסייה נכנסת לתיק הלקוח מיד עם אישור התשלום. הפעלה זמינה למנהל בלבד.
          </div>
        </div>
      )}

      <div className="form-group">
        <label className="form-label">תיאור</label>
        <textarea className="input textarea" rows={2} value={desc}
          onChange={(e) => setDesc(e.target.value)} placeholder="תיאור קצר של הפריט..." />
      </div>

      <div className="form-group">
        <label className="form-label">הערות פנימיות</label>
        <textarea className="input textarea" rows={2} value={notes}
          onChange={(e) => setNotes(e.target.value)} placeholder="הערות..." />
      </div>

      <div className="form-group">
        <label className="form-label">קטגוריות</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
          {options.map((cat) => {
            const sel = cats.includes(cat);
            const c = catColor(cat);
            return (
              <button key={cat} type="button" onClick={() => toggleCat(cat)}
                style={{
                  padding: '4px 10px', borderRadius: 20, fontSize: 12, cursor: 'pointer', border: 'none',
                  background: sel ? c.bg : 'rgba(255,255,255,0.04)',
                  color: sel ? c.text : 'var(--text-3)',
                  outline: sel ? `1px solid ${catTint(c.text, '55')}` : '1px solid var(--border)',
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

function CategoryForm({ category, onSave, onCancel }) {
  const isNew = !category?.id;
  const [name, setName] = useState(category?.name || '');
  const [description, setDescription] = useState(category?.description || '');
  const [image, setImage] = useState(category?.image || '');
  const [imageFit, setImageFit] = useState(category?.image_fit === 'contain' ? 'contain' : 'cover');
  const [active, setActive] = useState(category?.active ?? true);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({
      ...(category || {}),
      name: name.trim(),
      description: description.trim(),
      image: image || '',
      image_fit: imageFit,
      active,
    });
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <ImagePicker value={image} onChange={setImage} label="תמונת קטגוריה" tall
        fit={imageFit} onFitChange={setImageFit} />
      <div className="form-group">
        <label className="form-label">שם הקטגוריה *</label>
        <input className="input" required value={name} onChange={(e) => setName(e.target.value)}
          placeholder="ציוד טיפוס..." />
      </div>
      <div className="form-group">
        <label className="form-label">תיאור קצר</label>
        <textarea className="input textarea" rows={2} value={description}
          onChange={(e) => setDescription(e.target.value)} placeholder="מה נמצא בקטגוריה הזו..." />
      </div>
      <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <label className="form-label" style={{ marginBottom: 0 }}>פעילה?</label>
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)}
          style={{ width: 18, height: 18, cursor: 'pointer' }} />
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>ביטול</button>
        <button type="submit" className="btn btn-primary btn-sm">
          <Save size={14} /> {isNew ? 'צור קטגוריה' : 'שמור קטגוריה'}
        </button>
      </div>
    </form>
  );
}

export default function Pricelist() {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [openCatName, setOpenCatName] = useState(null);
  const [showInactive, setShowInactive] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [addingNew, setAddingNew] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [addingCategory, setAddingCategory] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleteCatConfirm, setDeleteCatConfirm] = useState(null);

  const refresh = async () => {
    try {
      const [pRes, cRes] = await Promise.all([
        fetch('/api/pricelist'),
        fetch('/api/product-categories'),
      ]);
      const data = pRes.ok ? await pRes.json() : [];
      const cats = cRes.ok ? await cRes.json() : [];

      if (!Array.isArray(data) || data.length === 0) {
        setItems(NOTION_PRICELIST);
      } else {
        setItems(data.map((item) => ({
          ...item,
          categories: normalizeCategories(
            Array.isArray(item.categories) ? item.categories : (item.category ? [item.category] : [])
          ),
          active: item.active ?? true,
          image: item.image || '',
        })));
      }
      setCategories(Array.isArray(cats) ? cats : []);
    } catch (err) {
      console.error(err);
      setItems(NOTION_PRICELIST);
    }
  };

  useEffect(() => { refresh(); }, []);

  const categoryNames = useMemo(
    () => (categories.length ? categories.map((c) => c.name) : PRODUCT_CATEGORIES),
    [categories]
  );

  /** Products pointing at a category that no longer exists would be unreachable. */
  const isOrphan = useMemo(() => {
    const known = new Set(categoryNames);
    return (item) => !(item.categories || []).some((c) => known.has(c));
  }, [categoryNames]);

  const countsByCat = useMemo(() => {
    const map = {};
    for (const name of categoryNames) map[name] = 0;
    map[UNCATEGORIZED] = 0;
    for (const item of items) {
      if (!showInactive && !item.active) continue;
      if (isOrphan(item)) {
        map[UNCATEGORIZED] += 1;
        continue;
      }
      for (const c of item.categories || []) {
        map[c] = (map[c] || 0) + 1;
      }
    }
    return map;
  }, [items, categoryNames, showInactive, isOrphan]);

  const visibleCats = useMemo(() => {
    const list = categories.length
      ? categories.filter((c) => showInactive || c.active !== false)
      : PRODUCT_CATEGORIES.map((name, i) => ({ id: `fallback-${i}`, name, image: '', description: '', active: true }));
    const withOrphans = countsByCat[UNCATEGORIZED] > 0
      ? [...list, {
          id: UNCATEGORIZED,
          name: UNCATEGORIZED,
          image: '',
          description: 'מוצרים שהקטגוריה שלהם נמחקה — פתחו ושייכו מחדש',
          active: true,
          virtual: true,
        }]
      : list;
    const q = search.trim().toLowerCase();
    if (!q || openCatName) return withOrphans;
    return withOrphans.filter((c) =>
      catLabel(c.name).toLowerCase().includes(q) ||
      String(c.description || '').toLowerCase().includes(q)
    );
  }, [categories, showInactive, search, openCatName, countsByCat]);

  const visibleItems = useMemo(() => {
    if (!openCatName) return [];
    return items.filter((item) => {
      if (!showInactive && !item.active) return false;
      if (openCatName === UNCATEGORIZED) {
        if (!isOrphan(item)) return false;
      } else if (!item.categories?.includes(openCatName)) {
        return false;
      }
      const q = search.toLowerCase();
      if (q && !item.name.toLowerCase().includes(q) &&
          !item.description?.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, openCatName, search, showInactive, isOrphan]);

  const openCatMeta = useMemo(
    () => categories.find((c) => c.name === openCatName) || { name: openCatName, image: '', description: '' },
    [categories, openCatName]
  );

  const handleSaveItem = async (data) => {
    const isEdit = items.some((i) => i.id === data.id);
    try {
      const response = await fetch(isEdit ? `/api/pricelist/${data.id}` : '/api/pricelist', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          category: data.categories?.[0] || 'שונות',
        }),
      });
      if (response.ok) {
        setEditingId(null);
        setAddingNew(false);
        refresh();
      } else {
        const errorData = await response.json().catch(() => ({}));
        alert(errorData.error || 'שגיאה בשמירת הפריט');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteItem = async (id) => {
    try {
      const response = await fetch(`/api/pricelist/${id}`, { method: 'DELETE' });
      if (response.ok) {
        setDeleteConfirm(null);
        refresh();
      }
    } catch (err) {
      console.error(err);
    }
  };

  /** The public routes are served by this same app, so the current origin is the customer's link too. */
  const copyShopLink = async (item) => {
    const url = `${window.location.origin}/shop/${item.public_slug}`;
    try {
      await navigator.clipboard.writeText(url);
      alert(`הקישור הועתק:\n${url}`);
    } catch {
      window.prompt('העתיקו את הקישור:', url);
    }
  };

  const toggleActive = async (item) => {
    try {
      await fetch(`/api/pricelist/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...item, active: !item.active }),
      });
      refresh();
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveCategory = async (data) => {
    const isEdit = !!data.id;
    try {
      const response = await fetch(
        isEdit ? `/api/product-categories/${data.id}` : '/api/product-categories',
        {
          method: isEdit ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }
      );
      if (response.ok) {
        const saved = await response.json();
        if (isEdit && openCatName && openCatName === editingCategory?.name && saved.name) {
          setOpenCatName(saved.name);
        }
        setEditingCategory(null);
        setAddingCategory(false);
        refresh();
      } else {
        const errorData = await response.json().catch(() => ({}));
        alert(errorData.error || 'שגיאה בשמירת הקטגוריה');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteCategory = async (cat) => {
    try {
      const response = await fetch(`/api/product-categories/${cat.id}`, { method: 'DELETE' });
      if (response.ok) {
        if (openCatName === cat.name) setOpenCatName(null);
        setDeleteCatConfirm(null);
        refresh();
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="fade-in">
      <div className="section-header" style={{ marginBottom: 16 }}>
        <div>
          {openCatName ? (
            <>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ marginBottom: 8 }}
                onClick={() => {
                  setOpenCatName(null);
                  setAddingNew(false);
                  setEditingId(null);
                  setSearch('');
                }}
              >
                <ArrowRight size={14} /> חזרה לקטגוריות
              </button>
              <div className="section-title">{catLabel(openCatName)}</div>
              <div className="section-sub">
                {openCatMeta.description || `${visibleItems.length} מוצרים בקטגוריה`}
              </div>
            </>
          ) : (
            <>
              <div className="section-title">מוצרים לפי קטגוריה</div>
              <div className="section-sub">בחרו קטגוריה כדי לראות ולערוך את המוצרים שבתוכה</div>
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!openCatName && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setAddingCategory(true); setEditingCategory(null); }}>
              <FolderOpen size={15} /> קטגוריה חדשה
            </button>
          )}
          {openCatName && openCatName !== UNCATEGORIZED && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const meta = categories.find((c) => c.name === openCatName);
                if (meta) setEditingCategory(meta);
              }}
            >
              <Edit2 size={14} /> ערוך קטגוריה
            </button>
          )}
          {openCatName !== UNCATEGORIZED && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                if (!openCatName) {
                  alert('בחרו קטגוריה ואז הוסיפו מוצר');
                  return;
                }
                setAddingNew(true);
                setEditingId(null);
              }}
            >
              <Plus size={15} /> הוסף מוצר
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
          <input
            className="input"
            style={{ paddingRight: 32 }}
            placeholder={openCatName ? 'חיפוש מוצר בקטגוריה...' : 'חיפוש קטגוריה...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-3)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)}
            style={{ width: 15, height: 15 }} />
          הצג לא פעילים
        </label>
      </div>

      {(addingCategory || editingCategory) && (
        <div className="card card-p" style={{ marginBottom: 20, borderColor: 'rgba(251,113,133,0.35)' }}>
          <div style={{ fontWeight: 700, marginBottom: 16, color: '#FB7185' }}>
            {editingCategory ? 'עריכת קטגוריה' : 'קטגוריה חדשה'}
          </div>
          <CategoryForm
            category={editingCategory}
            onSave={handleSaveCategory}
            onCancel={() => { setAddingCategory(false); setEditingCategory(null); }}
          />
        </div>
      )}

      {addingNew && openCatName && openCatName !== UNCATEGORIZED && (
        <div className="card card-p" style={{ marginBottom: 20, borderColor: 'rgba(99,102,241,0.3)' }}>
          <div style={{ fontWeight: 700, marginBottom: 16, color: '#A5B4FC' }}>
            <Plus size={16} style={{ verticalAlign: 'middle', marginLeft: 6 }} />
            מוצר חדש ב«{openCatName}»
          </div>
          <ItemForm
            item={null}
            defaultCategory={openCatName}
            categoryOptions={categoryNames}
            onSave={handleSaveItem}
            onCancel={() => setAddingNew(false)}
          />
        </div>
      )}

      {deleteConfirm && (
        <div className="alert alert-warn" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>למחוק את <strong>"{deleteConfirm.name}"</strong>?</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setDeleteConfirm(null)}>ביטול</button>
            <button className="btn btn-danger btn-sm" onClick={() => handleDeleteItem(deleteConfirm.id)}>
              <Trash2 size={13} /> מחק
            </button>
          </div>
        </div>
      )}

      {deleteCatConfirm && (
        <div className="alert alert-warn" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>למחוק את הקטגוריה <strong>"{deleteCatConfirm.name}"</strong>? המוצרים לא יימחקו.</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setDeleteCatConfirm(null)}>ביטול</button>
            <button className="btn btn-danger btn-sm" onClick={() => handleDeleteCategory(deleteCatConfirm)}>
              <Trash2 size={13} /> מחק
            </button>
          </div>
        </div>
      )}

      {/* Category grid */}
      {!openCatName && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 14,
          }}
        >
          {visibleCats.map((cat) => {
            const c = catColor(cat.name);
            const Icon = CATEGORY_ICONS[cat.name] || Package;
            const count = countsByCat[cat.name] || 0;
            return (
              <div
                key={cat.id || cat.name}
                className="card"
                style={{
                  overflow: 'hidden',
                  cursor: 'pointer',
                  borderColor: catTint(c.text, '33'),
                  transition: 'transform 0.15s, box-shadow 0.15s',
                  opacity: cat.active === false ? 0.5 : 1,
                }}
                onClick={() => { setOpenCatName(cat.name); setSearch(''); }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = `0 8px 24px ${catTint(c.text, '22')}`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = '';
                  e.currentTarget.style.boxShadow = '';
                }}
              >
                <div
                  style={{
                    height: 110,
                    background: imageBackground(
                      cat,
                      `linear-gradient(145deg, ${c.bg}, rgba(15,20,30,0.9))`
                    ),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                  }}
                >
                  {!cat.image && <Icon size={36} color={c.text} strokeWidth={1.75} />}
                  {!cat.virtual && (
                  <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-xs"
                      style={{ background: 'rgba(0,0,0,0.45)' }}
                      onClick={() => setEditingCategory(cat)}
                      title="עריכה"
                    >
                      <Edit2 size={12} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-xs"
                      style={{ background: 'rgba(0,0,0,0.45)', color: 'var(--red)' }}
                      onClick={() => setDeleteCatConfirm(cat)}
                      title="מחיקה"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  )}
                </div>
                <div style={{ padding: '12px 14px' }}>
                  <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>{catLabel(cat.name)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    {count === 0 ? 'אין מוצרים עדיין' : `${count} מוצרים`}
                  </div>
                  {cat.description && (
                    <div style={{
                      fontSize: 11, color: 'var(--text-3)', marginTop: 6,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {cat.description}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Products inside category */}
      {openCatName && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 14,
          }}
        >
          {visibleItems.length === 0 && !addingNew ? (
            <div className="card card-p" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 48 }}>
              <div className="empty-state-title">אין מוצרים בקטגוריה הזו</div>
              {openCatName !== UNCATEGORIZED && (
                <>
                  <div style={{ color: 'var(--text-3)', marginTop: 8, marginBottom: 16 }}>הוסיפו את המוצר הראשון</div>
                  <button className="btn btn-primary btn-sm" onClick={() => setAddingNew(true)}>
                    <Plus size={14} /> הוסף מוצר
                  </button>
                </>
              )}
            </div>
          ) : (
            visibleItems.map((item) => {
              const isEditing = editingId === item.id;
              if (isEditing) {
                return (
                  <div key={item.id} className="card card-p" style={{ gridColumn: '1 / -1', borderRight: '3px solid #6366F1' }}>
                    <ItemForm
                      // Orphans keep a stale label the picker can't show — clear it so
                      // the owner re-assigns the product to a live category.
                      item={openCatName === UNCATEGORIZED ? { ...item, categories: [] } : item}
                      defaultCategory={openCatName === UNCATEGORIZED ? null : openCatName}
                      categoryOptions={categoryNames}
                      onSave={handleSaveItem}
                      onCancel={() => setEditingId(null)}
                    />
                  </div>
                );
              }
              return (
                <div
                  key={item.id}
                  className="card"
                  style={{ overflow: 'hidden', opacity: item.active ? 1 : 0.45 }}
                >
                  <div
                    style={{
                      height: 140,
                      background: imageBackground(
                        item,
                        'linear-gradient(145deg, rgba(255,255,255,0.04), rgba(15,20,30,0.85))'
                      ),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {!item.image && <Package size={32} style={{ color: 'var(--text-3)' }} />}
                  </div>
                  <div style={{ padding: '12px 14px' }}>
                    <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4 }}>{item.name}</div>
                    {item.description && (
                      <div style={{
                        fontSize: 12, color: 'var(--text-3)', marginBottom: 8,
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                      }}>
                        {item.description}
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      {item.price > 0 ? (
                        <span style={{ fontSize: 18, fontWeight: 900, color: '#34D399' }}>
                          ₪{Number(item.price).toLocaleString()}
                        </span>
                      ) : (
                        <span style={{ fontSize: 13, color: 'var(--text-3)' }}>ללא מחיר</span>
                      )}
                      <div style={{ display: 'flex', gap: 4 }}>
                        {item.self_serve && item.public_slug && (
                          <button
                            className="btn btn-ghost btn-icon btn-xs"
                            style={{ color: 'var(--green)' }}
                            title="העתקת קישור הרכישה הציבורי"
                            onClick={() => copyShopLink(item)}
                          >
                            <Link2 size={13} />
                          </button>
                        )}
                        <button
                          className="btn btn-ghost btn-icon btn-xs"
                          onClick={() => toggleActive(item)}
                          style={{ color: item.active ? 'var(--green)' : 'var(--text-3)' }}
                          title={item.active ? 'פעיל' : 'לא פעיל'}
                        >
                          {item.active ? '✓' : '○'}
                        </button>
                        <button
                          className="btn btn-ghost btn-icon btn-xs"
                          onClick={() => { setEditingId(item.id); setAddingNew(false); }}
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          className="btn btn-ghost btn-icon btn-xs"
                          style={{ color: 'var(--red)' }}
                          onClick={() => setDeleteConfirm(item)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
