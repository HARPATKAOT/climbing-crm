import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle, Search, RefreshCw, ChevronRight } from 'lucide-react';
import ConversationPanel from './ConversationPanel.jsx';
import { useLiveMessages } from '../hooks/useLiveMessages.js';

// WhatsApp-style inbox: every conversation in one list, newest first, with the
// customers still awaiting a reply pinned to the top. Selecting a row mounts the
// existing ConversationPanel — the chat itself is not reimplemented here.

// Safety refresh only — the live wait is what normally brings new messages in.
const REFRESH_MS = 30_000;
const NARROW_BREAKPOINT = 900;
const NARROW_QUERY = `(max-width: ${NARROW_BREAKPOINT - 1}px)`;

const CHANNEL_MARKS = {
  whatsapp: { label: 'וואטסאפ', color: '#25D366' },
  instagram: { label: 'אינסטגרם', color: '#E1306C' },
  messenger: { label: 'מסנג׳ר', color: '#0084FF' },
};

/** "14:32" today, "אתמול", "יום ג׳" this week, "12/03" beyond it. */
function formatWhen(iso) {
  const ts = Date.parse(iso || '');
  if (!Number.isFinite(ts)) return '';
  const date = new Date(ts);
  const now = new Date();
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const daysAgo = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (daysAgo <= 0) {
    return date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  }
  if (daysAgo === 1) return 'אתמול';
  if (daysAgo < 7) return date.toLocaleDateString('he-IL', { weekday: 'long' });
  return date.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
}

function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts.slice(0, 2).map((p) => p[0]).join('');
}

function ConversationRow({ conversation, active, onSelect }) {
  const mark = CHANNEL_MARKS[conversation.channel] || CHANNEL_MARKS.whatsapp;
  const outbound = conversation.direction === 'outbound';
  return (
    <button
      type="button"
      onClick={() => onSelect(conversation.parentId)}
      style={{
        display: 'flex',
        width: '100%',
        gap: 10,
        alignItems: 'center',
        padding: '10px 12px',
        border: 'none',
        borderBottom: '1px solid var(--border)',
        background: active ? 'rgba(129,140,248,0.12)' : 'transparent',
        cursor: 'pointer',
        textAlign: 'right',
        font: 'inherit',
        color: 'inherit',
      }}
    >
      <span
        style={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          flexShrink: 0,
          display: 'grid',
          placeItems: 'center',
          background: 'var(--bg-input)',
          border: `2px solid ${mark.color}`,
          fontSize: 13,
          fontWeight: 700,
          color: 'var(--text-2)',
        }}
        title={mark.label}
      >
        {initialsOf(conversation.name)}
      </span>

      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              fontWeight: 700,
              fontSize: 13,
              color: 'var(--text-1)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {conversation.name}
          </span>
          <span style={{ marginRight: 'auto', fontSize: 11, color: conversation.awaiting ? '#FBBF24' : 'var(--text-3)', flexShrink: 0 }}>
            {formatWhen(conversation.lastMessageAt)}
          </span>
        </span>

        <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <span
            style={{
              fontSize: 12,
              color: 'var(--text-3)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
            }}
          >
            {outbound && <span style={{ color: 'var(--text-3)' }}>{conversation.isAi ? '🤖 ' : '↩ '}</span>}
            {conversation.fromStudentName && (
              <span style={{ color: 'var(--text-2)' }}>{conversation.fromStudentName}: </span>
            )}
            {conversation.preview}
          </span>
          {conversation.unread > 0 && (
            <span
              style={{
                flexShrink: 0,
                minWidth: 18,
                height: 18,
                padding: '0 5px',
                borderRadius: 9,
                background: '#25D366',
                color: '#04160B',
                fontSize: 11,
                fontWeight: 700,
                display: 'grid',
                placeItems: 'center',
              }}
            >
              {conversation.unread}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

export default function ConversationInbox({ parents = [], onHandled }) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [onlyAwaiting, setOnlyAwaiting] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  // One pane at a time on a phone, both side by side on a desktop. matchMedia
  // rather than a resize listener: it reports the right answer on first paint.
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches
  );
  // The list poll keeps an old closure — read the live selection from a ref.
  const selectedIdRef = useRef(null);

  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = (event) => setIsNarrow(event.matches);
    setIsNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const res = await fetch('/api/conversations');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'טעינת השיחות נכשלה');
      const list = Array.isArray(json.conversations) ? json.conversations : [];
      setConversations(list);
      setError('');
      // On a wide screen the reading pane should never sit empty. On a phone the
      // list is the whole screen, so opening a chat is left to the reader.
      if (!selectedIdRef.current && list.length && !window.matchMedia(NARROW_QUERY).matches) {
        selectedIdRef.current = list[0].parentId;
        setSelectedId(list[0].parentId);
      }
    } catch (err) {
      setError(err.message || 'טעינת השיחות נכשלה');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The queue used to re-read every conversation every few seconds. It now
  // waits for the next stored message, so a new enquiry appears at once.
  useLiveMessages(() => load({ quiet: true }), { safetyMs: REFRESH_MS });

  const selectConversation = (parentId) => {
    selectedIdRef.current = parentId;
    setSelectedId(parentId);
  };

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (onlyAwaiting && !c.awaiting) return false;
      if (!term) return true;
      return (
        String(c.name || '').toLowerCase().includes(term)
        || String(c.phone || '').includes(term)
        || String(c.preview || '').toLowerCase().includes(term)
      );
    });
  }, [conversations, search, onlyAwaiting]);

  const awaitingCount = conversations.filter((c) => c.awaiting).length;

  // The panel needs the live customer card (it watches last_inbound_* to refresh).
  const selectedParent = useMemo(() => {
    if (!selectedId) return null;
    const known = parents.find((p) => String(p.id) === String(selectedId));
    if (known) return known;
    const row = conversations.find((c) => c.parentId === selectedId);
    return row ? { id: row.parentId, name: row.name, phone: row.phone } : null;
  }, [selectedId, parents, conversations]);

  const showList = !isNarrow || !selectedId;
  const showPanel = !isNarrow || !!selectedId;

  return (
    <div
      className="card"
      style={{
        display: 'flex',
        height: 'calc(100vh - 220px)',
        minHeight: 420,
        overflow: 'hidden',
        padding: 0,
      }}
    >
      {showList && (
        <div
          style={{
            width: isNarrow ? '100%' : 320,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            borderLeft: isNarrow ? 'none' : '1px solid var(--border)',
            minHeight: 0,
          }}
        >
          <div style={{ padding: 10, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="input-icon-wrap">
              <Search className="input-icon" size={15} />
              <input
                className="input"
                placeholder="חיפוש בשיחות..."
                style={{ width: '100%', paddingRight: 34 }}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="tab-bar tab-bar-inline" style={{ alignItems: 'center' }}>
              <button
                type="button"
                className={`tab-pill ${onlyAwaiting ? '' : 'active'}`}
                onClick={() => setOnlyAwaiting(false)}
              >
                הכל ({conversations.length})
              </button>
              <button
                type="button"
                className={`tab-pill ${onlyAwaiting ? 'active' : ''}`}
                onClick={() => setOnlyAwaiting(true)}
              >
                ממתינים ({awaitingCount})
              </button>
              <button
                type="button"
                className="tab-pill tab-pill-icon"
                style={{ marginInlineStart: 'auto' }}
                onClick={() => load()}
                title="רענון"
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {error && (
              <div className="alert alert-danger" style={{ margin: 10 }}>
                {error}
              </div>
            )}
            {loading && !conversations.length && (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
                טוען שיחות...
              </div>
            )}
            {!loading && !visible.length && (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
                <MessageCircle size={26} style={{ opacity: 0.4, marginBottom: 8 }} />
                <div>{search || onlyAwaiting ? 'אין שיחות שתואמות לסינון' : 'עדיין אין שיחות'}</div>
              </div>
            )}
            {visible.map((conversation) => (
              <ConversationRow
                key={conversation.parentId}
                conversation={conversation}
                active={conversation.parentId === selectedId}
                onSelect={selectConversation}
              />
            ))}
          </div>
        </div>
      )}

      {showPanel && (
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-root)' }}>
          {isNarrow && selectedId && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ margin: 8, alignSelf: 'flex-start' }}
              onClick={() => selectConversation(null)}
            >
              <ChevronRight size={15} /> כל השיחות
            </button>
          )}
          {selectedParent ? (
            <ConversationPanel
              key={selectedParent.id}
              parent={selectedParent}
              fillHeight
              onHandled={(updatedParents, handledAt) => {
                onHandled?.(updatedParents, handledAt);
                load({ quiet: true });
              }}
            />
          ) : (
            <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
              <MessageCircle size={34} style={{ opacity: 0.35, marginBottom: 10 }} />
              <div>בחר שיחה מהרשימה</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
