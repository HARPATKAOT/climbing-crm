import React, { useRef, useState } from 'react';
import { CalendarDays, Clock3, ImagePlus, MapPin, Users, X } from 'lucide-react';
import { compressImageFile, readImageFileAsDataUrl } from './productCategories.js';
import { useBusinessProfile } from '../BusinessProfileContext.jsx';

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
  const theme = themeFrom(form.registration_theme);
  const coverImage = theme.cover_image || '';
  const { x, y } = parsePosition(theme.cover_position);
  const position = formatPosition(x, y);
  const publicTitle = form.registration_page_title || form.name || '';
  const publicBody = form.registration_page_body || form.description || '';
  const paidPerParticipant = form.registration_mode === 'paid_per_participant'
    || (!form.registration_mode && form.collect_registration_payment);

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
          <div className="activity-designer-help">לחצו על הפרטים כדי לערוך אותם</div>
        </div>
        <div className="activity-designer-brand">
          {brandLogo ? (
            <img src={brandLogo} alt={brandName} className="activity-designer-brand-logo" />
          ) : (
            brandName
          )}
        </div>
      </div>

      <div className="activity-designer-cover-layout">
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

        <div className="activity-designer-details">
          <label>
            <CalendarDays size={15} />
            <InlineField
              label="תאריך"
              type="date"
              value={form.date || ''}
              onChange={(value) => patch({ date: value })}
              readOnly={readOnly}
              required
            />
          </label>
          <label>
            <CalendarDays size={15} />
            <InlineField
              label="תאריך סיום"
              type="date"
              value={form.end_date || ''}
              min={form.date || undefined}
              onChange={(value) => patch({ end_date: value })}
              readOnly={readOnly}
            />
          </label>
          {!form.all_day && (
            <>
              <label>
                <Clock3 size={15} />
                <InlineField
                  label="שעת התחלה"
                  type="time"
                  value={form.start_time || ''}
                  onChange={(value) => patch({ start_time: value })}
                  readOnly={readOnly}
                />
              </label>
              <label>
                <Clock3 size={15} />
                <InlineField
                  label="שעת סיום"
                  type="time"
                  value={form.end_time || ''}
                  onChange={(value) => patch({ end_time: value })}
                  readOnly={readOnly}
                />
              </label>
            </>
          )}
          <label className="activity-designer-detail-wide">
            <MapPin size={15} />
            <InlineField
              label="מיקום הפעילות"
              value={form.location || ''}
              onChange={(value) => patch({ location: value })}
              readOnly={readOnly}
            />
          </label>
          <label>
            <span className="activity-designer-currency">₪</span>
            <InlineField
              label="מחיר"
              type="number"
              min="0"
              step="1"
              value={form.price ?? ''}
              onChange={(value) => patch({ price: value })}
              readOnly={readOnly}
            />
            <span className="activity-designer-suffix">
              {paidPerParticipant ? 'למשתתף' : 'לאירוע'}
            </span>
          </label>
          <label>
            <Users size={15} />
            <InlineField
              label="מכסה"
              type="number"
              min="0"
              step="1"
              value={form.max_participants ?? ''}
              onChange={(value) => patch({ max_participants: value })}
              readOnly={readOnly}
            />
            <span className="activity-designer-suffix">משתתפים</span>
          </label>
        </div>

        {!readOnly && (
          <label className="activity-designer-all-day">
            <input
              type="checkbox"
              checked={!!form.all_day}
              onChange={(event) => patch({
                all_day: event.target.checked,
                start_time: event.target.checked ? '' : (form.start_time || '10:00'),
                end_time: event.target.checked ? '' : (form.end_time || '12:00'),
              })}
            />
            אירוע של יום שלם
          </label>
        )}
      </div>
    </section>
  );
}
