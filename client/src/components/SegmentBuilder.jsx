import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Users, Save, SlidersHorizontal, CalendarDays, UserCheck, Hash, MapPin,
  Activity, UsersRound, Tag, MessageSquareText, UserRound, ChevronLeft,
  Search, X, Check, Eye, RotateCcw, Pencil,
} from 'lucide-react';
import { STATUSES, STATUS_PROGRESS_ORDER } from '../mockData.js';
import { getGroupDays } from '../scheduleUtils.js';
import { EMPTY_FILTERS } from './segmentFilters.js';
import AppSelect from './AppSelect.jsx';

const DAY_OPTIONS = [
  { value: 0, label: 'א׳' },
  { value: 1, label: 'ב׳' },
  { value: 2, label: 'ג׳' },
  { value: 3, label: 'ד׳' },
  { value: 4, label: 'ה׳' },
  { value: 5, label: 'ו׳' },
  { value: 6, label: 'ש׳' },
];

// «כיתות ג'-ד' — יום א' 15:30» → «כיתות ג'-ד' 15:30». היום כבר מופיע בכותרת העמודה.
// דורש «יום» או צמד «ב׳+ה׳» אחרי המקף כדי לא לבלוע שמות כמו «כיתות ג'-ד'».
const DAY_IN_NAME_RE = /\s*[—–-]\s*(?:יום\s*[א-ו][׳'’]?|[א-ו][׳'’]?\s*\+\s*(?:יום\s*)?[א-ו][׳'’]?)(?=\s|$)/g;

function nameWithoutDay(name) {
  const raw = String(name || '');
  const short = raw.replace(DAY_IN_NAME_RE, ' ').replace(/\s{2,}/g, ' ').trim();
  return short || raw;
}

const GENDER_OPTIONS = [
  { value: 'male', label: 'זכר' },
  { value: 'female', label: 'נקבה' },
  { value: '', label: 'לא צוין' },
];

const PICKER_FIELDS = {
  age: ['ageMin', 'ageMax'],
  registered: ['registered'],
  list: ['listKey'],
  cities: ['cities'],
  statuses: ['statuses'],
  groups: ['groupIds', 'groupDays'],
  genders: ['genders'],
  interests: ['interests'],
  delivery: ['marketingOptIn', 'onlyOpenWindow'],
};

function summaryList(values, emptyLabel) {
  if (!values?.length) return emptyLabel;
  if (values.length <= 2) return values.join(' · ');
  return `${values.slice(0, 2).join(' · ')} ועוד ${values.length - 2}`;
}

/**
 * Every category gets its own colour from the project palette, so the grid can
 * be scanned by colour and not only read. An active card (a chosen value, not
 * "כולם") is tinted with the same colour — one glance shows which filters act.
 */
function FilterCard({ icon: Icon, title, summary, accent, count = 0, active = false, disabled = false, onClick }) {
  return (
    <button
      type="button"
      className={`segment-filter-card ${active ? 'is-active' : ''}`}
      style={accent ? { '--filter-accent': accent } : undefined}
      onClick={onClick}
      disabled={disabled}
      aria-haspopup="dialog"
    >
      <span className="segment-filter-card-icon"><Icon size={18} /></span>
      <span className="segment-filter-card-copy">
        <span className="segment-filter-card-title">{title}</span>
        <span className="segment-filter-card-summary">{summary}</span>
      </span>
      {count > 0 && <span className="segment-filter-card-count" aria-label={`${count} בחירות`}>{count}</span>}
      <ChevronLeft size={17} className="segment-filter-card-chevron" aria-hidden="true" />
    </button>
  );
}

// הצבעים מהפלטה הקיימת של הפרויקט (טוקנים + מחזור הצבעים של הטאבים).
const FILTER_ACCENTS = {
  age: '#38BDF8',        // כחול
  registered: '#34D399', // ירוק
  list: '#FBBF24',       // ענבר
  cities: '#2DD4BF',     // טורקיז
  statuses: '#A78BFA',   // סגול
  groups: '#FB923C',     // כתום
  genders: '#F472B6',    // ורוד
  interests: '#F87171',  // אדום
  delivery: '#A5B4FC',   // אינדיגו
};

function PickerOption({ selected, label, description, color, onClick, disabled = false }) {
  return (
    <button
      type="button"
      className={`segment-picker-option ${selected ? 'is-selected' : ''}`}
      onClick={onClick}
      aria-pressed={selected}
      disabled={disabled}
    >
      {color
        ? <span className="segment-picker-color" style={{ background: color }} aria-hidden="true" />
        : <span className="segment-picker-check" aria-hidden="true">{selected && <Check size={13} />}</span>}
      <span className="segment-picker-option-copy">
        <span>{label}</span>
        {description && <small>{description}</small>}
      </span>
      {color && <span className="segment-picker-check" aria-hidden="true">{selected && <Check size={13} />}</span>}
    </button>
  );
}

function FilterDialog({ title, subtitle, onClose, onApply, onReset, applyLabel = 'החלת הסינון', applyDisabled = false, showCancel = true, children }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const previousFocus = useRef(document.activeElement);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    const focusable = dialog?.querySelector('[data-autofocus]')
      || dialog?.querySelector('input, button:not([disabled]), select, textarea');
    focusable?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const items = [...dialog.querySelectorAll('input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus.current?.focus?.();
    };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={dialogRef} className="modal slide-up segment-filter-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-header segment-filter-dialog-header">
          <div>
            <div className="modal-title" id={titleId}>{title}</div>
            {subtitle && <div className="segment-filter-dialog-subtitle">{subtitle}</div>}
          </div>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="סגירת חלון הבחירה"><X size={18} /></button>
        </div>
        <div className="modal-body segment-filter-dialog-body">{children}</div>
        <div className="modal-footer segment-filter-dialog-footer">
          {onReset && <button type="button" className="btn btn-ghost btn-sm" onClick={onReset}><RotateCcw size={14} /> איפוס</button>}
          <span className="segment-filter-dialog-footer-spacer" />
          {showCancel && <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>ביטול</button>}
          <button type="button" className="btn btn-primary btn-sm" onClick={onApply} disabled={applyDisabled}>{applyLabel}</button>
        </div>
      </div>
    </div>
  );
}

export default function SegmentBuilder({
  parents = [],
  students = [],
  groups = [],
  lists = [],
  filters,
  onChange,
  onManageLists,
}) {
  const [preview, setPreview] = useState({ count: 0, recipients: [] });
  const [interestOptions, setInterestOptions] = useState([]);
  const [savedSegments, setSavedSegments] = useState([]);
  const [segmentName, setSegmentName] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [activePicker, setActivePicker] = useState(null);
  const [pickerDraft, setPickerDraft] = useState(null);
  const [pickerSearch, setPickerSearch] = useState('');

  const f = filters || EMPTY_FILTERS;

  const cities = useMemo(() => {
    const set = new Set((parents || []).map((p) => p.city).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, 'he'));
  }, [parents]);

  const groupsByDay = useMemo(() => {
    const buckets = new Map();
    for (const g of groups || []) {
      const days = getGroupDays(g);
      const targetDays = days.length ? days : [99];
      for (const day of targetDays) {
        if (!buckets.has(day)) buckets.set(day, []);
        buckets.get(day).push(g);
      }
    }
    return [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([day, list]) => ({
        day,
        label: DAY_OPTIONS.find((d) => d.value === day)?.label || 'אחר',
        groups: [...list].sort((a, b) => {
          const aTime = String(a.time || '99:99');
          const bTime = String(b.time || '99:99');
          if (aTime !== bTime) return aTime.localeCompare(bTime);
          return String(a.name || '').localeCompare(String(b.name || ''), 'he');
        }),
      }));
  }, [groups]);

  useEffect(() => {
    fetch('/api/broadcast/interest-options')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setInterestOptions(Array.isArray(d) ? d : []))
      .catch(() => {});
    fetch('/api/saved-segments')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setSavedSegments(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoadingPreview(true);
      try {
        const res = await fetch('/api/broadcast/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filters: f }),
        });
        const data = await res.json();
        if (!cancelled && res.ok) setPreview(data);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [JSON.stringify(f)]);

  const cloneFilters = (source) => ({
    ...EMPTY_FILTERS,
    ...source,
    cities: [...(source.cities || [])],
    statuses: [...(source.statuses || [])],
    groupIds: [...(source.groupIds || [])],
    groupDays: [...(source.groupDays || [])],
    genders: [...(source.genders || [])],
    interests: [...(source.interests || [])],
  });

  const openPicker = (key) => {
    setPickerDraft(cloneFilters(f));
    setPickerSearch('');
    setActivePicker(key);
  };

  const closePicker = () => {
    setActivePicker(null);
    setPickerDraft(null);
    setPickerSearch('');
  };

  const applyPicker = () => {
    if (pickerDraft) onChange(cloneFilters(pickerDraft));
    closePicker();
  };

  const setDraft = (patch) => setPickerDraft((current) => ({ ...current, ...patch }));

  const toggleDraftArray = (key, value) => {
    const arr = Array.isArray(pickerDraft?.[key]) ? [...pickerDraft[key]] : [];
    const idx = arr.indexOf(value);
    if (idx >= 0) arr.splice(idx, 1);
    else arr.push(value);
    setDraft({ [key]: arr });
  };

  const toggleDraftDayGroups = (dayGroups) => {
    const dayIds = dayGroups.map((g) => g.id);
    const selected = Array.isArray(pickerDraft?.groupIds) ? pickerDraft.groupIds : [];
    const allSelected = dayIds.every((id) => selected.includes(id));
    if (allSelected) {
      setDraft({ groupIds: selected.filter((id) => !dayIds.includes(id)) });
    } else {
      setDraft({ groupIds: [...new Set([...selected, ...dayIds])] });
    }
  };

  const resetPicker = () => {
    const fields = PICKER_FIELDS[activePicker] || [];
    const patch = {};
    for (const field of fields) patch[field] = Array.isArray(EMPTY_FILTERS[field]) ? [] : EMPTY_FILTERS[field];
    setDraft(patch);
  };

  const resetAll = () => onChange(cloneFilters(EMPTY_FILTERS));

  const saveCurrent = async () => {
    const name = segmentName.trim() || `קהל ${new Date().toLocaleDateString('he-IL')}`;
    const res = await fetch('/api/saved-segments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, filters: f }),
    });
    if (res.ok) {
      const created = await res.json();
      setSavedSegments((prev) => [...prev, created]);
      setSegmentName('');
    }
  };

  const selectedCityNames = f.cities || [];
  const selectedStatusNames = (f.statuses || []).map((key) => STATUSES[key]?.label || key);
  const selectedGroupNames = (f.groupIds || []).map((id) => nameWithoutDay(groups.find((group) => group.id === id)?.name || id));
  const selectedGenderNames = (f.genders || []).map((value) => GENDER_OPTIONS.find((option) => option.value === value)?.label || value);
  const selectedListLabel = lists.find((list) => list.key === f.listKey)?.label;
  const deliverySummary = [
    f.marketingOptIn === true ? 'מאשרי דיוור' : f.marketingOptIn === false ? 'ללא אישור דיוור' : 'ללא סינון הסכמה',
    f.onlyOpenWindow ? 'חלון 24 שעות פתוח' : null,
  ].filter(Boolean).join(' · ');
  const activeFilterCount = [
    f.ageMin !== '' || f.ageMax !== '',
    f.registered !== 'any',
    !!f.listKey,
    selectedCityNames.length > 0,
    selectedStatusNames.length > 0,
    selectedGroupNames.length > 0,
    selectedGenderNames.length > 0,
    (f.interests || []).length > 0,
    f.marketingOptIn !== EMPTY_FILTERS.marketingOptIn || !!f.onlyOpenWindow,
  ].filter(Boolean).length;

  const pickerTitles = {
    age: ['טווח גילאים', 'הגדירו גיל מינימום, גיל מקסימום או את שניהם.'],
    registered: ['מצב הרשמה לחוג', 'בחרו אם לכלול רשומים, לא רשומים או את כולם.'],
    list: ['רשימת תפוצה', 'בחרו רשימה אחת או השאירו ללא סינון רשימה.'],
    cities: ['מקום מגורים', 'אפשר לבחור כמה יישובים. החיפוש לא משנה את הבחירות שכבר סומנו.'],
    statuses: ['סטטוס מתאמן', 'הסטטוסים מסודרים מלמעלה למטה לפי מסלול ההתקדמות.'],
    groups: ['קבוצות', 'אפשר לבחור כמה קבוצות או לסמן יום שלם. בחירת קבוצה גוברת על רשימת תפוצה.'],
    genders: ['מגדר', 'אפשר לבחור ערך אחד או יותר.'],
    interests: ['תחומי עניין', 'בחרו את התחומים הרלוונטיים לקהל הדיוור.'],
    delivery: ['זכאות לקבלת ההודעה', 'סננו לפי הסכמה לדיוור וחלון השיחה בוואטסאפ.'],
    recipients: ['נמענים בתוצאה', 'תצוגה מקדימה של הקהל לפי הסינון הנוכחי.'],
  };

  const renderSearch = (placeholder) => (
    <div className="input-icon-wrap segment-picker-search">
      <Search className="input-icon" size={16} />
      <input
        className="input"
        data-autofocus
        value={pickerSearch}
        onChange={(event) => setPickerSearch(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </div>
  );

  const renderPickerContent = () => {
    const draft = pickerDraft || cloneFilters(f);
    const query = pickerSearch.trim().toLowerCase();

    if (activePicker === 'age') {
      return (
        <div className="segment-picker-fields">
          <label className="form-label">גיל מינימום
            <input className="input" data-autofocus type="number" min="0" max="120" value={draft.ageMin} onChange={(event) => setDraft({ ageMin: event.target.value })} placeholder="ללא מינימום" />
          </label>
          <label className="form-label">גיל מקסימום
            <input className="input" type="number" min="0" max="120" value={draft.ageMax} onChange={(event) => setDraft({ ageMax: event.target.value })} placeholder="ללא מקסימום" />
          </label>
          {draft.ageMin !== '' && draft.ageMax !== '' && Number(draft.ageMin) > Number(draft.ageMax) && (
            <div className="alert alert-warning segment-picker-wide">גיל המינימום צריך להיות קטן או שווה לגיל המקסימום.</div>
          )}
        </div>
      );
    }

    if (activePicker === 'registered') {
      return (
        <div className="segment-picker-list">
          {[
            ['any', 'כל המתאמנים', 'ללא סינון לפי הרשמה לחוג'],
            ['yes', 'רשומים לחוג', 'מתאמנים המשויכים לקבוצה פעילה'],
            ['no', 'לא רשומים לחוג', 'לידים ומתאמנים ללא הרשמה פעילה'],
          ].map(([value, label, description]) => (
            <PickerOption key={value} selected={draft.registered === value} label={label} description={description} onClick={() => setDraft({ registered: value })} />
          ))}
        </div>
      );
    }

    if (activePicker === 'list') {
      const groupsSelected = draft.groupIds?.length > 0;
      return (
        <div className="segment-picker-list">
          {groupsSelected && <div className="alert alert-info">כבר נבחרו קבוצות, ולכן סינון לפי רשימת תפוצה מושבת. איפוס הקבוצות יאפשר לבחור רשימה.</div>}
          <PickerOption selected={!draft.listKey} label="כל הרשימות" description="ללא סינון לפי רשימת תפוצה" onClick={() => setDraft({ listKey: '' })} />
          {lists.map((list) => (
            <PickerOption key={list.key} selected={draft.listKey === list.key} label={list.label} description={list.description} disabled={groupsSelected} onClick={() => setDraft({ listKey: list.key })} />
          ))}
          {onManageLists && (
            <button type="button" className="btn btn-ghost btn-sm segment-picker-manage" onClick={() => { closePicker(); onManageLists(); }}>
              <Pencil size={14} /> עריכת רשימות תפוצה
            </button>
          )}
        </div>
      );
    }

    if (activePicker === 'cities') {
      const visibleCities = cities.filter((city) => city.toLowerCase().includes(query));
      return (
        <>
          {renderSearch('חיפוש יישוב...')}
          <div className="segment-picker-grid">
            {visibleCities.map((city) => <PickerOption key={city} selected={draft.cities.includes(city)} label={city} onClick={() => toggleDraftArray('cities', city)} />)}
          </div>
          {!visibleCities.length && <div className="segment-picker-empty">לא נמצאו יישובים מתאימים.</div>}
        </>
      );
    }

    if (activePicker === 'statuses') {
      return (
        <div className="segment-picker-list">
          {STATUS_PROGRESS_ORDER.filter((key) => STATUSES[key]).map((key) => (
            <PickerOption key={key} selected={draft.statuses.includes(key)} label={STATUSES[key].label} color={STATUSES[key].color} onClick={() => toggleDraftArray('statuses', key)} />
          ))}
        </div>
      );
    }

    if (activePicker === 'groups') {
      return (
        <>
          {renderSearch('חיפוש קבוצה...')}
          <div className="segment-picker-days">
            {groupsByDay.map((section) => {
              const visibleGroups = section.groups.filter((group) => String(group.name || '').toLowerCase().includes(query));
              if (!visibleGroups.length) return null;
              const visibleIds = visibleGroups.map((group) => group.id);
              const allSelected = visibleIds.every((id) => draft.groupIds.includes(id));
              return (
                <section key={section.day} className="segment-picker-day">
                  <div className="segment-picker-day-head">
                    <strong>יום {section.label}</strong>
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => toggleDraftDayGroups(visibleGroups)}>
                      {allSelected ? 'ביטול סימון היום' : 'בחירת כל היום'}
                    </button>
                  </div>
                  <div className="segment-picker-list">
                    {visibleGroups.map((group) => (
                      <PickerOption key={`${section.day}-${group.id}`} selected={draft.groupIds.includes(group.id)} label={nameWithoutDay(group.name)} description={group.time && !String(group.name || '').includes(group.time) ? group.time : ''} onClick={() => toggleDraftArray('groupIds', group.id)} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      );
    }

    if (activePicker === 'genders') {
      return (
        <div className="segment-picker-list">
          {GENDER_OPTIONS.map((option) => <PickerOption key={option.label} selected={draft.genders.includes(option.value)} label={option.label} onClick={() => toggleDraftArray('genders', option.value)} />)}
        </div>
      );
    }

    if (activePicker === 'interests') {
      const visibleInterests = interestOptions.filter((interest) => interest.toLowerCase().includes(query));
      return (
        <>
          {renderSearch('חיפוש תחום עניין...')}
          <div className="segment-picker-grid">
            {visibleInterests.map((interest) => <PickerOption key={interest} selected={draft.interests.includes(interest)} label={interest} onClick={() => toggleDraftArray('interests', interest)} />)}
          </div>
          {!visibleInterests.length && <div className="segment-picker-empty">לא נמצאו תחומי עניין מתאימים.</div>}
        </>
      );
    }

    if (activePicker === 'delivery') {
      return (
        <div className="segment-picker-stack">
          <div>
            <div className="segment-picker-section-title">אישור דיוור</div>
            <div className="segment-picker-list">
              {[
                [true, 'רק מי שאישר דיוור', 'ברירת המחדל הבטוחה לדיוור'],
                [null, 'ללא סינון לפי אישור', 'כולל מי שלא הגדירו העדפה'],
                [false, 'רק מי שלא אישר דיוור', 'לשימוש תפעולי ובדיקה בלבד'],
              ].map(([value, label, description]) => (
                <PickerOption key={String(value)} selected={draft.marketingOptIn === value} label={label} description={description} onClick={() => setDraft({ marketingOptIn: value })} />
              ))}
            </div>
          </div>
          <div>
            <div className="segment-picker-section-title">חלון וואטסאפ</div>
            <PickerOption selected={!!draft.onlyOpenWindow} label="רק חלון 24 שעות פתוח" description="נדרש לשליחת הודעה חופשית שאינה תבנית" onClick={() => setDraft({ onlyOpenWindow: !draft.onlyOpenWindow })} />
          </div>
        </div>
      );
    }

    if (activePicker === 'recipients') {
      const matchingRecipients = (preview.recipients || []).filter((recipient) =>
        [recipient.name, recipient.phone, recipient.city, recipient.studentName]
          .some((value) => String(value || '').toLowerCase().includes(query))
      );
      return (
        <>
          {renderSearch('חיפוש שם, טלפון או יישוב...')}
          <div className="segment-recipient-list">
            {matchingRecipients.slice(0, 200).map((recipient) => (
              <div className="segment-recipient-row" key={recipient.id}>
                <div>
                  <strong>{recipient.name}</strong>
                  <small>
                    {[
                      recipient.studentName ? `הורה של ${recipient.studentName}` : '',
                      recipient.city,
                    ].filter(Boolean).join(' · ')}
                  </small>
                </div>
                <div className="segment-recipient-contact"><span dir="ltr">{recipient.phone}</span><small className={recipient.windowOpen ? 'is-open' : ''}>{recipient.windowOpen ? 'חלון פתוח' : 'חלון סגור'}</small></div>
              </div>
            ))}
          </div>
          {!matchingRecipients.length && <div className="segment-picker-empty">לא נמצאו נמענים מתאימים.</div>}
          {matchingRecipients.length > 200 && <div className="segment-picker-empty">מוצגים 200 מתוך {matchingRecipients.length} נמענים.</div>}
        </>
      );
    }

    return null;
  };

  const registeredSummary = f.registered === 'yes' ? 'רשומים לחוג' : f.registered === 'no' ? 'לא רשומים לחוג' : 'כולם';
  const ageSummary = f.ageMin !== '' && f.ageMax !== ''
    ? `גיל ${f.ageMin}–${f.ageMax}`
    : f.ageMin !== '' ? `מגיל ${f.ageMin}` : f.ageMax !== '' ? `עד גיל ${f.ageMax}` : 'כל הגילים';
  const invalidDraftAge = activePicker === 'age'
    && pickerDraft?.ageMin !== ''
    && pickerDraft?.ageMax !== ''
    && Number(pickerDraft.ageMin) > Number(pickerDraft.ageMax);

  return (
    <div className="segment-builder">
      <div className="segment-audience-summary">
        <div className="segment-audience-summary-main">
          <span className="segment-audience-icon"><Users size={20} /></span>
          <div>
            <strong>
              {loadingPreview
                ? 'מחשב קהל...'
                : `${preview.count} נמענים · ${preview.childCount ?? 0} ילדים`}
            </strong>
            <small>
              {activeFilterCount ? `${activeFilterCount} מסננים פעילים · ` : ''}
              הסינון לפי מאפייני הילד; ההודעה נשלחת פעם אחת להורה
            </small>
          </div>
        </div>
        <div className="segment-audience-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openPicker('recipients')} disabled={loadingPreview || preview.count === 0}>
            <Eye size={15} /> צפייה בנמענים
          </button>
          {activeFilterCount > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={resetAll}>
              <RotateCcw size={14} /> איפוס מסננים
            </button>
          )}
        </div>
      </div>

      {savedSegments.length > 0 && (
        <div className="segment-saved-row">
          <span>קהל שמור</span>
          <AppSelect
            className="input input-sm"
            defaultValue=""
            onChange={(event) => {
              const segment = savedSegments.find((item) => item.id === event.target.value);
              if (segment?.filters) onChange(cloneFilters(segment.filters));
            }}
          >
            <option value="">בחירת קהל שמור...</option>
            {savedSegments.map((segment) => <option key={segment.id} value={segment.id}>{segment.name}</option>)}
          </AppSelect>
        </div>
      )}

      <div className="segment-filter-heading">
        <div>
          <SlidersHorizontal size={17} />
          <strong>בחירת קהל</strong>
        </div>
        <span>פתחו מסנן ובחרו את האפשרויות הרצויות</span>
      </div>

      <div className="segment-filter-grid">
        <FilterCard icon={CalendarDays} accent={FILTER_ACCENTS.age} title="גיל" summary={ageSummary} active={f.ageMin !== '' || f.ageMax !== ''} onClick={() => openPicker('age')} />
        <FilterCard icon={UserCheck} accent={FILTER_ACCENTS.registered} title="מצב הרשמה" summary={registeredSummary} active={f.registered !== 'any'} onClick={() => openPicker('registered')} />
        <FilterCard icon={Hash} accent={FILTER_ACCENTS.list} title="רשימת תפוצה" summary={f.groupIds?.length ? 'מושבת בעת סינון לפי קבוצה' : (selectedListLabel || 'כל הרשימות')} active={!!f.listKey} onClick={() => openPicker('list')} />
        <FilterCard icon={MapPin} accent={FILTER_ACCENTS.cities} title="מקום מגורים" summary={summaryList(selectedCityNames, 'כל היישובים')} count={selectedCityNames.length} active={selectedCityNames.length > 0} onClick={() => openPicker('cities')} />
        <FilterCard icon={Activity} accent={FILTER_ACCENTS.statuses} title="סטטוס" summary={summaryList(selectedStatusNames, 'כל הסטטוסים')} count={selectedStatusNames.length} active={selectedStatusNames.length > 0} onClick={() => openPicker('statuses')} />
        <FilterCard icon={UsersRound} accent={FILTER_ACCENTS.groups} title="קבוצות" summary={summaryList(selectedGroupNames, 'כל הקבוצות')} count={selectedGroupNames.length} active={selectedGroupNames.length > 0} onClick={() => openPicker('groups')} />
        <FilterCard icon={UserRound} accent={FILTER_ACCENTS.genders} title="מגדר" summary={summaryList(selectedGenderNames, 'כולם')} count={selectedGenderNames.length} active={selectedGenderNames.length > 0} onClick={() => openPicker('genders')} />
        <FilterCard icon={Tag} accent={FILTER_ACCENTS.interests} title="תחום עניין" summary={summaryList(f.interests || [], 'כל תחומי העניין')} count={(f.interests || []).length} active={(f.interests || []).length > 0} onClick={() => openPicker('interests')} />
        <FilterCard icon={MessageSquareText} accent={FILTER_ACCENTS.delivery} title="זכאות לשליחה" summary={deliverySummary} active={f.marketingOptIn !== EMPTY_FILTERS.marketingOptIn || !!f.onlyOpenWindow} onClick={() => openPicker('delivery')} />
      </div>

      <div className="segment-save-panel">
        <div>
          <strong>שמירת הקהל לשימוש חוזר</strong>
          <small>השמירה כוללת את כל המסננים שבחרתם כרגע.</small>
        </div>
        <div className="segment-save-controls">
          <input className="input input-sm" placeholder="שם לקהל השמור" value={segmentName} onChange={(event) => setSegmentName(event.target.value)} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={saveCurrent}><Save size={14} /> שמירה</button>
        </div>
      </div>

      {!loadingPreview && preview.count === 0 && (
        <div className="alert alert-warning segment-empty-audience">
          <strong>לא נמצאו נמענים לפי הסינון הנוכחי.</strong>
          <span>פתחו את כרטיסי הסינון ועדכנו קבוצה, סטטוס, יישוב או זכאות לשליחה.</span>
        </div>
      )}

      {activePicker && (
        <FilterDialog
          title={pickerTitles[activePicker]?.[0] || 'בחירת מסנן'}
          subtitle={pickerTitles[activePicker]?.[1]}
          onClose={closePicker}
          onApply={activePicker === 'recipients' ? closePicker : applyPicker}
          onReset={activePicker === 'recipients' ? null : resetPicker}
          applyLabel={activePicker === 'recipients' ? 'סגירה' : 'החלת הסינון'}
          applyDisabled={invalidDraftAge}
          showCancel={activePicker !== 'recipients'}
        >
          {renderPickerContent()}
        </FilterDialog>
      )}
    </div>
  );
}
