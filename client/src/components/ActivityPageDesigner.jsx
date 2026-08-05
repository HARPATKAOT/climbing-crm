import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { compressImageFile, readImageFileAsDataUrl } from './productCategories.js';
import { useBusinessProfile } from '../BusinessProfileContext.jsx';
import { normalizeParticipationScope } from '../utils/participationDocuments.js';

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

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 12, marginTop: 16 }}>
          {[
            ['audience', 'קהל יעד'],
            ['included', 'מה כלול'],
            ['what_to_bring', 'מה להביא / ציוד'],
            ['important_info', 'מידע חשוב'],
          ].map(([key, label]) => (
            readOnly ? (
              form[key] ? <div key={key}><strong>{label}</strong><p style={{ whiteSpace: 'pre-wrap' }}>{form[key]}</p></div> : null
            ) : (
              <label key={key} className="event-field" style={{ margin: 0 }}>
                <span>{label}</span>
                <textarea rows={3} value={form[key] || ''} onChange={(event) => patch({ [key]: event.target.value })} />
              </label>
            )
          ))}
        </div>

        {!readOnly && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 12, marginTop: 16 }}>
            <label className="event-field" style={{ margin: 0 }}>
              <span>האישור הנדרש מהמשתתפים</span>
              <select
                value={normalizeParticipationScope(
                  form.participation_scope || (form.type === 'trip' ? 'trip' : 'wall')
                )}
                onChange={(event) => patch({ participation_scope: event.target.value })}
              >
                <option value="wall">אישור פעילות בקיר</option>
                <option value="trip">יציאה לטיול הליכה / סנפלינג / טיפוס / מערנות</option>
              </select>
            </label>
            <label className="event-field" style={{ margin: 0 }}>
              <span>מדיניות ביטול</span>
              <select
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
              >
                <option value="__default__">ברירת המחדל של העסק</option>
                <option value="__none__">ללא מדיניות</option>
                {policies.filter((policy) => policy.status === 'published').map((policy) => (
                  <option key={policy.id} value={policy.id}>{policy.name}</option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>
    </section>
  );
}
