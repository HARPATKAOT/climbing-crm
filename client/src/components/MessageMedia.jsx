import React, { useEffect, useRef, useState } from 'react';
import { Download, FileText, Loader2, Play, AlertCircle, X } from 'lucide-react';
import { useAuthedMedia } from '../hooks/useAuthedMedia.js';
import { mediaKindOf, hasStoredMedia, mediaFilenameOf, mediaLabel } from '../utils/mediaRef.js';

const FRAME = {
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'rgba(0,0,0,0.18)',
  overflow: 'hidden',
};

/** A muted line inside the bubble — used for every non-renderable state. */
function Note({ icon, children, tone = 'var(--text-3)' }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 11,
      color: tone,
      padding: '6px 8px',
      borderRadius: 8,
      border: '1px dashed var(--border)',
      marginBottom: 4,
    }}>
      {icon}
      <span style={{ lineHeight: 1.4 }}>{children}</span>
    </div>
  );
}

/** Full-screen preview. Escape and a click anywhere close it. */
function Lightbox({ url, alt, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={onClose}
        style={{ position: 'absolute', top: 16, insetInlineEnd: 16, color: '#fff' }}
        aria-label="סגירה"
      >
        <X size={18} />
      </button>
      <img
        src={url}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8, objectFit: 'contain' }}
      />
    </div>
  );
}

function humanFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['ב׳', 'ק״ב', 'מ״ב'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * The file attached to one message bubble.
 *
 * Images load when they scroll into view; video, audio and documents wait for a
 * click, so opening a long thread does not pull tens of megabytes.
 */
export default function MessageMedia({ message, parentId }) {
  const kind = mediaKindOf(message);
  const stored = hasStoredMedia(message);
  const filename = mediaFilenameOf(message);
  const label = mediaLabel(kind);

  const holderRef = useRef(null);
  const anchorRef = useRef(null);
  const savedRef = useRef(false);
  const [visible, setVisible] = useState(false);
  const [requested, setRequested] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  const isImage = kind === 'image' || kind === 'sticker';
  // An image loads on sight; everything else only once staff asked for it.
  const shouldLoad = stored && (isImage ? visible : requested);
  const { url, loading, error, reason } = useAuthedMedia(parentId, message?.id, shouldLoad);

  useEffect(() => {
    if (!isImage || visible || !holderRef.current) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
    }, { rootMargin: '200px' });
    observer.observe(holderRef.current);
    return () => observer.disconnect();
  }, [isImage, visible]);

  // A document click starts the download and the bytes arrive a moment later.
  // Save once, and only for a click staff actually made.
  useEffect(() => {
    if (!requested || !url || savedRef.current || !anchorRef.current) return;
    savedRef.current = true;
    anchorRef.current.click();
  }, [requested, url]);

  if (!kind) return null;

  // The row says it is a photo, but nothing points at the bytes. Every message
  // received before inbound media capture shipped looks like this.
  if (!stored) {
    return (
      <Note icon={<span>{label.icon}</span>}>
        {label.noun} — לא נשמרה במערכת
      </Note>
    );
  }

  if (error) {
    return (
      <Note icon={<AlertCircle size={13} />} tone={reason === 'expired' ? '#FBBF24' : '#F87171'}>
        {error}
      </Note>
    );
  }

  if (isImage) {
    return (
      <div ref={holderRef} style={{ marginBottom: 4 }}>
        {url ? (
          <>
            <img
              src={url}
              alt={filename || label.noun}
              onClick={() => setZoomed(true)}
              style={{
                ...FRAME,
                display: 'block',
                maxWidth: '100%',
                maxHeight: 260,
                cursor: 'zoom-in',
              }}
            />
            {zoomed && <Lightbox url={url} alt={filename || label.noun} onClose={() => setZoomed(false)} />}
          </>
        ) : (
          // Reserve the space before the bytes arrive, so the thread does not
          // jump under the reader when an image finally paints.
          <div style={{
            ...FRAME,
            height: 140,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-3)',
            fontSize: 11,
            gap: 6,
          }}>
            <Loader2 size={13} className="spin" /> {loading ? 'טוען תמונה...' : label.noun}
          </div>
        )}
      </div>
    );
  }

  if (kind === 'video') {
    return (
      <div style={{ marginBottom: 4 }}>
        {url ? (
          <video src={url} controls style={{ ...FRAME, display: 'block', maxWidth: '100%', maxHeight: 280 }} />
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setRequested(true)}
            disabled={loading}
            style={{ ...FRAME, width: '100%', justifyContent: 'center', padding: '14px 10px', gap: 8 }}
          >
            {loading ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
            {loading ? 'טוען סרטון...' : 'הצגת הסרטון'}
          </button>
        )}
      </div>
    );
  }

  if (kind === 'audio') {
    return (
      <div style={{ marginBottom: 4 }}>
        {url ? (
          <audio src={url} controls style={{ width: '100%', minWidth: 200 }} />
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setRequested(true)}
            disabled={loading}
            style={{ ...FRAME, width: '100%', justifyContent: 'center', padding: '10px', gap: 8 }}
          >
            {loading ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
            {loading ? 'טוען...' : 'האזנה להודעה הקולית'}
          </button>
        )}
      </div>
    );
  }

  // Documents are saved, not viewed inline — the browser handles the rest.
  return (
    <div style={{ marginBottom: 4 }}>
      <a
        ref={anchorRef}
        href={url || undefined}
        download={filename || 'קובץ'}
        onClick={(e) => {
          if (url) return;
          // First click only starts the fetch; the effect below fires the save
          // as soon as the bytes land, so staff never have to click twice.
          e.preventDefault();
          setRequested(true);
        }}
        style={{
          ...FRAME,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 11px',
          textDecoration: 'none',
          color: 'var(--text-1)',
          cursor: 'pointer',
        }}
      >
        <FileText size={18} style={{ color: '#F87171', flexShrink: 0 }} />
        <span style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{
            fontSize: 12,
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {filename || 'קובץ מצורף'}
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-3)' }}>
            {loading ? 'מוריד...' : url ? 'לחצו לשמירה' : 'לחצו להורדה'}
          </span>
        </span>
        {loading ? <Loader2 size={14} className="spin" /> : <Download size={14} style={{ flexShrink: 0 }} />}
      </a>
    </div>
  );
}

export { humanFileSize };
