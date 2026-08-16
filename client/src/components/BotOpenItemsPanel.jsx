import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Headset, BellRing, Landmark } from 'lucide-react';

/**
 * מה הבוט השאיר פתוח.
 *
 * לבוט שלוש רשימות שאיש לא ראה: מי הועבר לצוות ועדיין ממתין, אילו מעקבים
 * עומדים לצאת, ומי ממתין לאישור של המתנ״ס. כל אחת מהן ישבה באוסף אחר ובשום
 * מסך — ולכן שני לקוחות חיכו יום שלם ואיש לא ידע. כאן הן יחד, לפי דחיפות.
 *
 * המסך קורא בלבד. סגירת פריט נעשית במקום שלה — בשיחה, בכרטיס — ולכן כל שורה
 * היא קישור לשם ולא כפתור „בוצע” שמסתיר את הבעיה מבלי לפתור אותה.
 */

const REFRESH_MS = 60_000;

const FOLLOWUP_REASONS = {
  customer_asked: 'הלקוח ביקש שנחזור',
  pending_signup: 'נשלח קישור הרשמה',
  general: 'מעקב',
};

/** "12 דקות" · "שעה וחצי" · "יומיים" — כמה זמן הוא כבר מחכה. */
function waitedFor(minutes) {
  const mins = Math.max(0, Math.round(Number(minutes) || 0));
  if (mins < 60) return `${mins} דק׳`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const rest = mins % 60;
    return rest ? `${hours}:${String(rest).padStart(2, '0')} שעות` : `${hours} שעות`;
  }
  const days = Math.floor(hours / 24);
  return days === 1 ? 'יממה' : `${days} ימים`;
}

function whenText(iso) {
  const ts = Date.parse(iso || '');
  if (!Number.isFinite(ts)) return '';
  return new Date(ts).toLocaleString('he-IL', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function Section({ icon: Icon, title, accent, count, hint, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Icon size={15} style={{ color: accent }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>{title}</span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: count ? accent : 'var(--text-3)',
            background: count ? `${accent}1f` : 'transparent',
            borderRadius: 9,
            padding: count ? '1px 7px' : 0,
          }}
        >
          {count}
        </span>
      </div>
      {hint && <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6 }}>{hint}</div>}
      {children}
    </div>
  );
}

function Row({ accent, onOpen, children }) {
  return (
    <div
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={onOpen ? (e) => { if (e.key === 'Enter') onOpen(); } : undefined}
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        padding: '9px 11px',
        border: '1px solid var(--border)',
        borderInlineStart: `3px solid ${accent}`,
        borderRadius: 10,
        cursor: onOpen ? 'pointer' : 'default',
      }}
    >
      {children}
    </div>
  );
}

function Empty({ text }) {
  return (
    <div style={{ fontSize: 11.5, color: 'var(--text-3)', padding: '6px 2px' }}>{text}</div>
  );
}

export default function BotOpenItemsPanel() {
  const navigate = useNavigate();
  const [data, setData] = useState({ waiting: [], followUps: [], centreChecks: [], summary: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const res = await fetch('/api/bot/open-items');
      // The screen ships with the client, and the API it reads ships separately.
      // Between the two deploys the route simply is not there yet, and saying so
      // is kinder than "טעינה נכשלה" on a screen that never worked before.
      if (res.status === 404) throw new Error('המסך יתמלא אחרי הפריסה הבאה של השרת');
      if (!res.ok) throw new Error('טעינה נכשלה');
      setData(await res.json());
      setError('');
    } catch (err) {
      setError(err.message || 'טעינה נכשלה');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // A queue read once and never again is how a customer waits an hour on an
  // open screen. It refreshes itself, quietly.
  useEffect(() => {
    const timer = setInterval(() => load({ quiet: true }), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const summary = data.summary || {};
  const openCard = (parentId) => {
    if (!parentId) return;
    navigate(`/leads?open=${encodeURIComponent(`parent:${parentId}`)}`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
          {summary.needsAttention
            ? `${summary.needsAttention} פריטים דורשים אדם עכשיו`
            : 'אין פריט שדורש אדם עכשיו'}
        </div>
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => load()}
          title="רענון"
          style={{ marginInlineStart: 'auto' }}
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {error && <div style={{ fontSize: 12, color: 'var(--red)' }}>{error}</div>}
      {loading && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>טוען…</div>}

      <Section
        icon={Headset}
        title="ממתינים לצוות"
        accent="#F87171"
        count={data.waiting?.length || 0}
        hint="הבוט אמר „מעביר לצוות” והטיפול עוד לא נסגר. יורדים מהרשימה בלחיצה על „סיום הטיפול” בכרטיס הלקוח."
      >
        {!data.waiting?.length ? (
          <Empty text="אף אחד לא ממתין." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.waiting.map((row) => (
              <Row key={row.parent_id || row.phone} accent="#F87171" onOpen={() => openCard(row.parent_id)}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--text-1)', fontWeight: 700 }}>
                    {row.name || 'לקוח ללא שם'}
                    {row.answered && (
                      <span style={{ fontWeight: 400, fontSize: 10.5, color: '#FBBF24' }}> · נענה, לא נסגר</span>
                    )}
                    {row.opted_out && (
                      <span style={{ fontWeight: 400, fontSize: 10.5, color: 'var(--text-3)' }}> · ביקש להפסיק את הבוט</span>
                    )}
                  </div>
                  {row.last_message && (
                    <div style={{
                      fontSize: 12,
                      color: 'var(--text-2)',
                      marginTop: 3,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      „{row.last_message}”
                    </div>
                  )}
                  <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 3 }}>
                    הועבר ב-{whenText(row.handed_at)}{row.phone ? ` · ${row.phone}` : ''}
                  </div>
                </div>
                <span style={{
                  flexShrink: 0,
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: row.waiting_minutes >= 60 ? '#F87171' : '#FBBF24',
                }}>
                  {waitedFor(row.waiting_minutes)}
                </span>
              </Row>
            ))}
          </div>
        )}
      </Section>

      <Section
        icon={BellRing}
        title="מעקבים שעומדים לצאת"
        accent="#FBBF24"
        count={data.followUps?.length || 0}
        hint="תזכורות שהבוט קבע לעצמו. „באיחור” פירושו שהמועד עבר וההודעה עוד לא יצאה — כלומר משהו בסריקה נתקע."
      >
        {!data.followUps?.length ? (
          <Empty text="אין מעקב פתוח." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.followUps.map((row) => (
              <Row key={row.id} accent={row.overdue ? '#FBBF24' : 'var(--border)'} onOpen={() => openCard(row.parent_id)}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--text-1)' }}>
                    {row.name || row.phone || 'לקוח'}
                    <span style={{ color: 'var(--text-3)' }}> · {FOLLOWUP_REASONS[row.reason] || 'מעקב'}</span>
                    {row.subject ? <span style={{ color: 'var(--text-2)' }}> — {row.subject}</span> : ''}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 3 }}>
                    {whenText(row.due_at)}
                    {row.needs_template ? ' · דורש תבנית מאושרת' : ' · בתוך חלון 24 השעות'}
                  </div>
                </div>
                {row.overdue && (
                  <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 700, color: '#FBBF24' }}>באיחור</span>
                )}
              </Row>
            ))}
          </div>
        )}
      </Section>

      <Section
        icon={Landmark}
        title="ממתינים לאישור המתנ״ס"
        accent="#60A5FA"
        count={data.centreChecks?.length || 0}
        hint="הורה מסר שההרשמה הושלמה, וכרמית עוד לא אישרה. עד אז המתאמן אינו מסומן „רשום”."
      >
        {!data.centreChecks?.length ? (
          <Empty text="אין ילד שממתין לאישור." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.centreChecks.map((row) => (
              <Row
                key={row.id}
                accent="#60A5FA"
                onOpen={row.student_id ? () => navigate(`/leads?open=${encodeURIComponent(row.student_id)}`) : undefined}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--text-1)', fontWeight: 700 }}>
                    {row.student_name || 'מתאמן'}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 3 }}>
                    {row.status_label}
                    {row.rounds ? ` · ${row.rounds} סבבים` : ''}
                  </div>
                </div>
                <span style={{ flexShrink: 0, fontSize: 11.5, color: 'var(--text-3)' }}>
                  {row.waiting_days ? `${row.waiting_days} ימים` : 'היום'}
                </span>
              </Row>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
