import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import { employeeAvatarColor, employeeAvatarIcon } from '../utils/roleIcons.js';

/**
 * בחירת עובד פעיל בסגנון המערכת, עם אייקון התיק של העובד וחיפוש בהקלדה.
 */
export default function EmployeeSelect({
  employees = [],
  value = '',
  onChange,
  placeholder = '— בחירה —',
  className = 'input select',
  disabled = false,
  'aria-label': ariaLabel,
}) {
  const active = useMemo(
    () => (Array.isArray(employees) ? employees : [])
      .filter((e) => e && e.is_active !== false && String(e.name || '').trim())
      .slice()
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'he')),
    [employees]
  );

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const searchRef = useRef(null);
  const [pos, setPos] = useState(null);

  const selected = active.find((e) => e.id === value) || null;
  const SelectedIcon = selected ? employeeAvatarIcon(selected.avatar_icon) : null;
  const selectedColor = selected ? employeeAvatarColor(selected.avatar_icon) : null;

  const filtered = useMemo(() => {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return active;
    return active.filter((e) => String(e.name || '').toLowerCase().includes(q));
  }, [active, query]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  useLayoutEffect(() => {
    if (!open || !btnRef.current) {
      setPos(null);
      return undefined;
    }
    const place = () => {
      const r = btnRef.current.getBoundingClientRect();
      const rows = filtered.length + 1;
      const menuH = Math.min(320, 48 + rows * 42 + 12);
      const spaceBelow = window.innerHeight - r.bottom;
      const openUp = spaceBelow < menuH + 8 && r.top > spaceBelow;
      setPos({
        top: openUp ? Math.max(8, r.top - menuH - 4) : r.bottom + 4,
        left: r.left,
        width: Math.max(r.width, 200),
        maxHeight: openUp ? Math.min(320, r.top - 12) : Math.min(320, spaceBelow - 8),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, filtered.length]);

  useEffect(() => {
    if (!open) return undefined;
    const t = window.setTimeout(() => searchRef.current?.focus(), 0);
    const onDoc = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      close();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (emp) => {
    onChange?.(emp);
    close();
  };

  const clear = () => {
    onChange?.(null);
    close();
  };

  const onSearchKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered.length === 1) pick(filtered[0]);
      else if (filtered.length > 0 && String(query || '').trim()) pick(filtered[0]);
    }
  };

  return (
    <div className="app-select-wrap" ref={wrapRef} style={{ width: '100%' }}>
      <button
        ref={btnRef}
        type="button"
        className={['app-select-trigger', className].filter(Boolean).join(' ')}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (disabled) return;
          if (open) close();
          else {
            setQuery('');
            setOpen(true);
          }
        }}
      >
        <span className={`app-select-value emp-select-value${selected ? '' : ' is-placeholder'}`}>
          {selected ? (
            <>
              <span
                className="emp-select-avatar"
                style={{ color: selectedColor }}
                aria-hidden="true"
              >
                <SelectedIcon size={16} strokeWidth={1.9} />
              </span>
              <span className="emp-select-name">{selected.name}</span>
            </>
          ) : (
            placeholder
          )}
        </span>
        <ChevronDown size={15} className={`app-select-chevron${open ? ' is-open' : ''}`} />
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          className="app-select-menu emp-select-menu"
          role="listbox"
          style={{
            top: pos.top,
            left: pos.left,
            width: pos.width,
            maxHeight: pos.maxHeight,
          }}
        >
          <div className="emp-select-search">
            <Search size={14} className="emp-select-search-icon" aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              className="emp-select-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="חיפוש לפי שם…"
              aria-label="חיפוש עובד לפי שם"
              autoComplete="off"
            />
          </div>
          <button
            type="button"
            role="option"
            aria-selected={!selected}
            className={`app-select-option${!selected ? ' is-active' : ''}`}
            onClick={clear}
          >
            <Check size={13} className="app-select-check" />
            <span className="emp-select-name">{placeholder}</span>
          </button>
          {filtered.map((emp) => {
            const Icon = employeeAvatarIcon(emp.avatar_icon);
            const color = employeeAvatarColor(emp.avatar_icon);
            const isSel = emp.id === value;
            return (
              <button
                key={emp.id}
                type="button"
                role="option"
                aria-selected={isSel}
                className={`app-select-option emp-select-option${isSel ? ' is-active' : ''}`}
                onClick={() => pick(emp)}
              >
                <Check size={13} className="app-select-check" />
                <span className="emp-select-avatar" style={{ color }} aria-hidden="true">
                  <Icon size={16} strokeWidth={1.9} />
                </span>
                <span className="emp-select-name">{emp.name}</span>
              </button>
            );
          })}
          {active.length === 0 && (
            <div className="app-select-empty">אין עובדים פעילים</div>
          )}
          {active.length > 0 && filtered.length === 0 && (
            <div className="app-select-empty">לא נמצא עובד בשם הזה</div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
