import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * Drawer צדדי גנרי של מסך העבודה: נפתח מהצד, סוגר ב-Escape ובלחיצה על הרקע,
 * נועל את גלילת העמוד מאחוריו ומחזיק כותרת + גוף גליל.
 */
export default function WorkDrawer({ title, sub, icon: Icon, tone = '#38BDF8', onClose, children }) {
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="dw-drawer-backdrop"
      onClick={(event) => event.target === event.currentTarget && onClose?.()}
    >
      <aside className="dw-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header className="dw-drawer-header">
          {Icon && (
            <span className="daily-work-section-icon" style={{ color: tone, background: `${tone}1f` }}>
              <Icon size={18} />
            </span>
          )}
          <div className="dw-drawer-title">
            <h2>{title}</h2>
            {sub && <span>{sub}</span>}
          </div>
          <button ref={closeRef} type="button" className="icon-btn" onClick={onClose} aria-label="סגירת החלונית">
            <X size={16} />
          </button>
        </header>
        {children}
      </aside>
    </div>
  );
}
