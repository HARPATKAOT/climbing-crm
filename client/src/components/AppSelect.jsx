import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

function readLabel(node) {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(readLabel).join('');
  if (React.isValidElement(node)) return readLabel(node.props.children);
  return '';
}

function collectOptions(children, groupLabel = null) {
  const out = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === 'optgroup') {
      out.push(...collectOptions(child.props.children, child.props.label || null));
      return;
    }
    if (child.type !== 'option') return;
    out.push({
      value: child.props.value === undefined || child.props.value === null
        ? readLabel(child.props.children)
        : String(child.props.value),
      label: readLabel(child.props.children),
      disabled: !!child.props.disabled,
      group: groupLabel,
    });
  });
  return out;
}

/**
 * תפריט נפתח בסגנון המערכת — מחליף select מקורי של הדפדפן,
 * כי רשימת האפשרויות שם נצבעת לפי מערכת ההפעלה ולא לפי העיצוב שלנו.
 */
export default function AppSelect({
  value,
  defaultValue,
  onChange,
  className = '',
  style,
  disabled = false,
  required = false,
  name,
  id,
  children,
  multiple = false,
  size,
  title,
  'aria-label': ariaLabel,
}) {
  // multiple / size lists stay native — rare, and the custom menu is single-pick.
  if (multiple || (size && Number(size) > 1)) {
    return (
      <select
        className={className || 'input select'}
        style={style}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        disabled={disabled}
        required={required}
        name={name}
        id={id}
        multiple={multiple}
        size={size}
        title={title}
        aria-label={ariaLabel}
      >
        {children}
      </select>
    );
  }

  const options = useMemo(() => collectOptions(children), [children]);
  const isControlled = value !== undefined;
  const [inner, setInner] = useState(
    defaultValue !== undefined && defaultValue !== null ? String(defaultValue) : ''
  );
  const current = isControlled
    ? (value === undefined || value === null ? '' : String(value))
    : inner;

  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const [pos, setPos] = useState(null);

  const selected = options.find((o) => o.value === current);
  const display = selected?.label || '';

  useLayoutEffect(() => {
    if (!open || !btnRef.current) {
      setPos(null);
      return undefined;
    }
    const place = () => {
      const r = btnRef.current.getBoundingClientRect();
      const menuH = Math.min(260, options.length * 36 + 12);
      const spaceBelow = window.innerHeight - r.bottom;
      const openUp = spaceBelow < menuH + 8 && r.top > spaceBelow;
      setPos({
        top: openUp ? Math.max(8, r.top - menuH - 4) : r.bottom + 4,
        left: r.left,
        width: Math.max(r.width, 140),
        maxHeight: openUp ? Math.min(260, r.top - 12) : Math.min(260, spaceBelow - 8),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const emit = (next) => {
    if (!isControlled) setInner(next);
    if (!onChange) return;
    onChange({
      target: { value: next, name: name || '', type: 'select-one' },
      currentTarget: { value: next, name: name || '', type: 'select-one' },
      preventDefault() {},
      stopPropagation() {},
    });
  };

  const pick = (opt) => {
    if (opt.disabled) return;
    emit(opt.value);
    setOpen(false);
  };

  const menuItems = [];
  let prevGroup = null;
  options.forEach((opt, idx) => {
    if (opt.group && opt.group !== prevGroup) {
      menuItems.push({ kind: 'group', key: `g:${opt.group}`, label: opt.group });
      prevGroup = opt.group;
    }
    menuItems.push({ kind: 'option', key: `o:${idx}:${opt.value}`, opt });
  });

  const triggerClass = ['app-select-trigger', className || 'input select']
    .filter(Boolean)
    .join(' ');

  const wrapStyle = {};
  if (style && style.width != null) wrapStyle.width = style.width;
  if (style && style.flex != null) wrapStyle.flex = style.flex;
  if (style && style.flexGrow != null) wrapStyle.flexGrow = style.flexGrow;
  if (style && style.minWidth != null) wrapStyle.minWidth = style.minWidth;
  if (style && style.maxWidth != null) wrapStyle.maxWidth = style.maxWidth;

  return (
    <div className="app-select-wrap" ref={wrapRef} style={Object.keys(wrapStyle).length ? wrapStyle : undefined}>
      {/* שדה מוסתר לטפסי HTML / required מקורי */}
      <select
        className="app-select-native"
        tabIndex={-1}
        aria-hidden="true"
        name={name}
        id={id}
        required={required}
        disabled={disabled}
        value={current}
        onChange={() => {}}
      >
        {options.map((o) => (
          <option key={`${o.group || ''}:${o.value}`} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>

      <button
        ref={btnRef}
        type="button"
        className={triggerClass}
        style={style}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((v) => !v)}
      >
        <span className={`app-select-value${display ? '' : ' is-placeholder'}`}>
          {display || 'בחרו...'}
        </span>
        <ChevronDown size={15} className={`app-select-chevron${open ? ' is-open' : ''}`} />
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          className="app-select-menu"
          role="listbox"
          style={{
            top: pos.top,
            left: pos.left,
            width: pos.width,
            maxHeight: pos.maxHeight,
          }}
        >
          {menuItems.map((item) => (
            item.kind === 'group' ? (
              <div key={item.key} className="app-select-group">{item.label}</div>
            ) : (
              <button
                key={item.key}
                type="button"
                role="option"
                aria-selected={item.opt.value === current}
                disabled={item.opt.disabled}
                className={`app-select-option${item.opt.value === current ? ' is-active' : ''}`}
                onClick={() => pick(item.opt)}
              >
                <Check size={13} className="app-select-check" />
                <span>{item.opt.label}</span>
              </button>
            )
          ))}
          {options.length === 0 && (
            <div className="app-select-empty">אין אפשרויות</div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
