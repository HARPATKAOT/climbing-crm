import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, User, Users, X } from 'lucide-react';
import { buildLeadEntries, matchesLeadSearch } from '../utils/leadUtils.js';

const MAX_RESULTS = 8;

export default function GlobalSearch({ students = [], parents = [], onOpen }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef(null);

  const results = useMemo(() => {
    const trimmed = query.trim().toLocaleLowerCase('he');
    if (!trimmed) return [];
    const seen = new Set();
    // A global search should find every customer, archived included — it's the
    // one place staff can reach someone who isn't on any working list anymore.
    return buildLeadEntries(students, parents, { includeArchived: true })
      .filter((entry) => matchesLeadSearch(entry, trimmed))
      .filter((entry) => {
        const key = String(entry.key);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_RESULTS);
  }, [parents, query, students]);

  useEffect(() => {
    const closeOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const choose = (entry) => {
    onOpen?.(entry.key);
    setQuery('');
    setOpen(false);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!results.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      choose(results[activeIndex]);
    }
  };

  return (
    <div className="global-search" ref={rootRef}>
      <div className="search-box">
        <Search className="search-box-icon" size={16} />
        <input
          className="search-input"
          placeholder="חיפוש לקוח..."
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-expanded={open}
          aria-controls="global-search-results"
          aria-activedescendant={open && results[activeIndex] ? `global-search-${activeIndex}` : undefined}
        />
        {query && (
          <button
            type="button"
            className="global-search-clear"
            onClick={() => setQuery('')}
            aria-label="ניקוי חיפוש"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {open && query.trim() && (
        <div className="global-search-results" id="global-search-results" role="listbox">
          {results.length === 0 ? (
            <div className="global-search-empty">לא נמצאו לקוחות</div>
          ) : results.map((entry, index) => {
            const parentOnly = entry.student?._parentOnly;
            const title = entry.student?.name || entry.parent?.name || 'לקוח ללא שם';
            const subtitle = parentOnly
              ? [entry.parent?.phone, entry.parent?.email].filter(Boolean).join(' · ')
              : [entry.parent?.name, entry.parent?.phone].filter(Boolean).join(' · ');
            const Icon = parentOnly ? User : Users;
            return (
              <button
                type="button"
                id={`global-search-${index}`}
                key={entry.key}
                className={`global-search-result ${index === activeIndex ? 'active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(entry)}
                role="option"
                aria-selected={index === activeIndex}
              >
                <span className="global-search-result-icon"><Icon size={16} /></span>
                <span className="global-search-result-copy">
                  <strong>{title}</strong>
                  {subtitle && <small>{subtitle}</small>}
                </span>
                {parentOnly && <span className="badge badge-amber">ללא מתאמן</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
