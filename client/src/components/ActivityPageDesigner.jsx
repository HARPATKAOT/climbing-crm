import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, ShieldCheck, ShieldOff, Smile, Sparkles, X } from 'lucide-react';
import AppSelect from './AppSelect.jsx';
import { compressImageFile, readImageFileAsDataUrl } from './productCategories.js';
import { useBusinessProfile } from '../BusinessProfileContext.jsx';
import { ACTIVITY_PAGE_FIELDS } from '../utils/activityPageFields.js';

/** אותם מפתחות שהשרת מכיר ב-DRAFT_TONES. */
const DRAFT_TONE_LABELS = {
  plain: 'ענייני',
  warm: 'חם ומזמין',
  brief: 'קצר מאוד',
};

function parsePosition(position) {
  const raw = String(position || '50% 50%').trim().toLowerCase();
  const xWords = { left: 0, center: 50, right: 100 };
  const yWords = { top: 0, center: 50, bottom: 100 };
  const parts = raw.split(/\s+/).filter(Boolean);
  const value = (part, words, fallback) => {
    if (!part) return fallback;
    if (part in words) return words[part];
    const parsed = Number.parseFloat(part);
    return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : fallback;
  };
  return {
    x: value(parts[0], xWords, 50),
    y: value(parts[1], yWords, 50),
  };
}

function formatPosition(x, y) {
  return `${Math.round(x)}% ${Math.round(y)}%`;
}

function themeFrom(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function InlineField({ label, value, onChange, readOnly, type = 'text', className = '', ...props }) {
  if (readOnly) {
    return <span className={`activity-designer-static ${className}`}>{value || label}</span>;
  }
  return (
    <input
      className={`activity-designer-inline ${className}`}
      type={type}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
      aria-label={label}
      placeholder={label}
      {...props}
    />
  );
}

export default function ActivityPageDesigner({ form, setForm, readOnly }) {
  const { profile } = useBusinessProfile();
  const brandName = profile.display_name || 'הרפתקאות';
  const brandLogo = profile.logo_url || '';
  const fileRef = useRef(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [policies, setPolicies] = useState([]);
  const theme = themeFrom(form.registration_theme);
  const coverImage = theme.cover_image || '';
  const { x, y } = parsePosition(theme.cover_position);
  const position = formatPosition(x, y);
  const publicTitle = form.registration_page_title || form.name || '';
  const publicBody = form.registration_page_body || form.description || '';

  useEffect(() => {
    if (readOnly) return undefined;
    let active = true;
    fetch('/api/settings/cancellation-policies')
      .then((response) => response.ok ? response.json() : { policies: [] })
      .then((body) => { if (active) setPolicies((body.policies || []).filter((policy) => policy.status !== 'archived')); })
      .catch(() => {});
    return () => { active = false; };
  }, [readOnly]);

  const patch = (values) => {
    if (readOnly) return;
    setForm((current) => ({ ...current, ...values }));
  };

  const [draftBusy, setDraftBusy] = useState('');
  const [draftError, setDraftError] = useState('');
  // העדפת סגנון אישית ונשמרת בדפדפן — היא לא תכונה של האירוע ולא של העסק.
  const [draftTone, setDraftTone] = useState(
    () => localStorage.getItem('activityDraftTone') || 'warm'
  );
  const [draftEmoji, setDraftEmoji] = useState(
    () => localStorage.getItem('activityDraftEmoji') !== '0'
  );
  useEffect(() => { localStorage.setItem('activityDraftTone', draftTone); }, [draftTone]);
  useEffect(() => { localStorage.setItem('activityDraftEmoji', draftEmoji ? '1' : '0'); }, [draftEmoji]);

  /** מבקש ניסוח לסעיף אחד ומכניס אותו לשדה. לא שומר — זו טיוטה לעריכה. */
  const draftField = async (field) => {
    if (readOnly || draftBusy) return;
    setDraftBusy(field);
    setDraftError('');
    try {
      const res = await fetch('/api/activities/draft-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field,
          tone: draftTone,
          emoji: draftEmoji,
          activity: {
            type: form.type,
            name: form.name,
            location: form.location,
            date: form.date,
            start_time: form.start_time,
            end_time: form.end_time,
            registration_page_body: form.registration_page_body || form.description || '',
            audience: form.audience,
            included: form.included,
            what_to_bring: form.what_to_bring,
            important_info: form.important_info,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.draft) throw new Error(data.error || 'ניסוח ההצעה נכשל');
      patch({ [field]: data.draft });
    } catch (err) {
      setDraftError(err.message || 'ניסוח ההצעה נכשל');
    } finally {
      setDraftBusy('');
    }
  };

  const patchTheme = (values) => {
    if (readOnly) return;
    setForm((current) => ({
      ...current,
      registration_theme: {
        ...themeFrom(current.registration_theme),
        ...values,
      },
    }));
  };

  const setTitle = (value) => patch({
    name: value,
    registration_page_title: value,
  });

  const setBody = (value) => patch({
    description: value,
    registration_page_body: value,
  });

  const setPosition = (nextX, nextY) => {
    patchTheme({ cover_position: formatPosition(nextX, nextY) });
  };

  const loadImage = async (file) => {
    if (!file || readOnly) return;
    if (!String(file.type || '').startsWith('image/')
      && !/\.(jpe?g|png|webp|gif)$/i.test(file.name || '')) {
      setImageError('יש לבחור קובץ תמונה');
      return;
    }
    setImageBusy(true);
    setImageError('');
    try {
      let dataUrl;
      try {
        dataUrl = await compressImageFile(file, { maxSide: 1200, quality: 0.78 });
      } catch (compressionError) {
        dataUrl = await readImageFileAsDataUrl(file, { maxBytes: 1_500_000 });
        if (!dataUrl) throw compressionError;
      }
      patchTheme({ cover_image: dataUrl, cover_position: '50% 50%' });
    } catch (error) {
      setImageError(error.message || 'טעינת התמונה נכשלה');
    } finally {
      setImageBusy(false);
      setDragOver(false);
    }
  };

  const chooseFile = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!readOnly && !imageBusy) fileRef.current?.click();
  };

  return (
    <section className="activity-designer">
      <div className="activity-designer-heading">
        <div>
          <div className="activity-designer-kicker">תצוגת דף ההרשמה</div>
          <div className="activity-designer-help">עריכת תמונה, כותרת ותיאור — שאר הפרטים בחלונית הימנית</div>
        </div>
        <div className="activity-designer-brand">
          {brandLogo ? (
            <img src={brandLogo} alt={brandName} className="activity-designer-brand-logo" />
          ) : (
            brandName
          )}
        </div>
      </div>

      <div className={`activity-designer-cover-layout${coverImage ? ' has-image' : ''}`}>
        {coverImage && (
          <label className="activity-designer-vertical-control">
            <span>{Math.round(y)}%</span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={Math.round(y)}
              disabled={readOnly || imageBusy}
              onChange={(event) => setPosition(x, Number(event.target.value))}
              aria-label="מיקום אנכי של התמונה"
            />
            <span>אנכי</span>
          </label>
        )}

        <div className="activity-designer-cover-column">
          <div
            className={`activity-designer-cover${dragOver ? ' is-dragging' : ''}`}
            role="button"
            tabIndex={readOnly ? -1 : 0}
            onClick={!coverImage ? chooseFile : undefined}
            onKeyDown={(event) => {
              if (!coverImage && (event.key === 'Enter' || event.key === ' ')) chooseFile(event);
            }}
            onDragEnter={(event) => {
              event.preventDefault();
              if (!readOnly) setDragOver(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
              if (!readOnly) setDragOver(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              if (!event.currentTarget.contains(event.relatedTarget)) setDragOver(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              loadImage(event.dataTransfer?.files?.[0]);
            }}
          >
            {coverImage ? (
              <img src={coverImage} alt="" style={{ objectPosition: position }} />
            ) : (
              <div className="activity-designer-cover-empty">
                <ImagePlus size={30} />
                <strong>{imageBusy ? 'מעבד תמונה...' : 'העלאת תמונת כיסוי'}</strong>
                <span>גררו תמונה לכאן או לחצו לבחירה</span>
              </div>
            )}
            {coverImage && !readOnly && (
              <div className="activity-designer-image-actions">
                <button type="button" onClick={chooseFile}>
                  <ImagePlus size={14} /> החלפה
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    patchTheme({ cover_image: '', cover_position: '50% 50%' });
                  }}
                >
                  <X size={14} /> הסרה
                </button>
              </div>
            )}
          </div>

          {coverImage && (
            <label className="activity-designer-horizontal-control">
              <span>שמאל</span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={Math.round(x)}
                disabled={readOnly || imageBusy}
                onChange={(event) => setPosition(Number(event.target.value), y)}
                aria-label="מיקום אופקי של התמונה"
              />
              <span>ימין · {Math.round(x)}%</span>
            </label>
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          loadImage(file);
        }}
      />
      {imageError && <div className="activity-designer-image-error">{imageError}</div>}

      <div className="activity-designer-content">
        <InlineField
          label="כותרת האירוע"
          value={publicTitle}
          onChange={setTitle}
          readOnly={readOnly}
          className="activity-designer-title"
          required
        />

        {readOnly ? (
          publicBody && <p className="activity-designer-body">{publicBody}</p>
        ) : (
          <textarea
            className="activity-designer-body-input"
            value={publicBody}
            onChange={(event) => setBody(event.target.value)}
            placeholder="מידע קצר על הפעילות..."
            rows={3}
          />
        )}

        {!readOnly && (
          <div className="activity-designer-divider">
            מה יופיע בדף
            <span className="draft-style-controls">
              <AppSelect
                className="input"
                value={draftTone}
                onChange={(event) => setDraftTone(event.target.value)}
                title="סגנון הניסוח של העוזר"
              >
                {Object.entries(DRAFT_TONE_LABELS).map(([value, text]) => (
                  <option key={value} value={value}>{text}</option>
                ))}
              </AppSelect>
              <button
                type="button"
                className={`draft-emoji-toggle${draftEmoji ? ' is-on' : ''}`}
                onClick={() => setDraftEmoji((on) => !on)}
                title={draftEmoji ? "עם אימוג'י" : "בלי אימוג'י"}
                aria-pressed={draftEmoji}
              >
                <Smile size={13} />
              </button>
            </span>
          </div>
        )}
        {draftError && <div className="activity-designer-image-error">{draftError}</div>}
        <div className="activity-designer-fields">
          {ACTIVITY_PAGE_FIELDS.map(({ key, label, hint, Icon, color }) => (
            readOnly ? (
              form[key] ? (
                <div key={key}>
                  <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon size={15} style={{ color }} aria-hidden="true" />
                    {label}
                  </strong>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{form[key]}</p>
                </div>
              ) : null
            ) : (
              <label key={key} className="event-field" style={{ '--field-accent': color }}>
                <span>
                  <Icon size={15} aria-hidden="true" />
                  {label}
                </span>
                {/* הכפתור יושב בפינת התיבה שאותה הוא ממלא. ההצעה נכנסת כטיוטה
                    — היא לא נשמרת עד שתשמרו את האירוע, וניתן לערוך אותה. */}
                <span className="event-field-box">
                  <textarea
                    rows={3}
                    value={form[key] || ''}
                    placeholder={hint}
                    onChange={(event) => patch({ [key]: event.target.value })}
                  />
                  <button
                    type="button"
                    className="event-field-draft"
                    title={`נסח הצעה · ${DRAFT_TONE_LABELS[draftTone]}${draftEmoji ? " · עם אימוג'י" : ""}`}
                    disabled={!!draftBusy}
                    onClick={() => draftField(key)}
                  >
                    {draftBusy === key
                      ? <Loader2 size={13} className="spin" />
                      : <Sparkles size={13} />}
                  </button>
                </span>
              </label>
            )
          ))}
        </div>

        {!readOnly && (
          <>
            {/* „האישור הנדרש מהמשתתפים” ישב כאן וגם „הצהרת בריאות” בחלונית
                ההגדרות — שתי שאלות שנשמעות זהות על אותו מסך, ושיכלו לסתור זו את
                זו. נשארה אחת, בחלונית ההגדרות, והיא קובעת גם את תחום האישור. */}
            <div className="activity-designer-divider">על מה חותמים</div>
            <div className="activity-designer-fields">
            <label className="event-field" style={{ margin: 0 }}>
              <span>
                <ShieldCheck size={15} aria-hidden="true" />
                מדיניות ביטול
              </span>
              {/* היה `select` מקורי, ולכן רשימת האפשרויות נצבעה על ידי מערכת
                  ההפעלה — לבן על פאנל כהה. AppSelect מצייר אותה בעצמו. */}
              <AppSelect
                className="input"
                value={form.cancellation_policy_disabled
                  ? '__none__'
                  : (form.cancellation_policy_id || '__default__')}
                onChange={(event) => {
                  const value = event.target.value;
                  patch({
                    cancellation_policy_id: value.startsWith('__') ? null : value,
                    cancellation_policy_disabled: value === '__none__',
                  });
                }}
                optionIcon={(value) => (value === '__none__'
                  ? { Icon: ShieldOff, color: 'var(--text-3)' }
                  : { Icon: ShieldCheck, color: '#A78BFA' })}
              >
                <option value="__default__">ברירת המחדל של העסק</option>
                <option value="__none__">ללא מדיניות</option>
                {policies.filter((policy) => policy.status === 'published').map((policy) => (
                  <option key={policy.id} value={policy.id}>{policy.name}</option>
                ))}
              </AppSelect>
            </label>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
