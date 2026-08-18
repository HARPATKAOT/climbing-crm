import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { roleIcon, roleColor } from '../utils/roleIcons.js';

/**
 * מה האירוע צריך, לפני שיודעים מי יבוא.
 *
 * „משמרת פתיחה צריכה מפעיל קיר ועוזר מדריך” הוא מידע שקיים הרבה לפני שיש שמות,
 * והוא מה שהופך את טופס ההרשמה למשמרות לשימושי: הצוות רואה מקומות פנויים לפי
 * תפקיד וכל אחד לוקח מה שהוא מוסמך אליו. בלי זה הטופס יכול היה לשאול רק על
 * תפקיד אחד בכל פעם.
 *
 * נשמר בנפרד מהאירוע ובלחיצה, ולא כחלק משמירת הטופס, כי זו הגדרה תפעולית
 * שמנהל משנה גם בלי לגעת בשאר פרטי האירוע.
 */
export default function StaffNeedsEditor({
  endpoint = '',
  roleOptions = [],
  draftNeeds = null,
  onDraftChange = null,
  title = 'מה האירוע צריך',
  emptyLabel = 'לפי סוג הפעילות',
}) {
  // אירוע שעוד לא נשמר אין לו מזהה לכתוב אליו, ולכן הוא עובד על הטיוטה שבטופס
  // ונשמר יחד איתו. אחרת היה צריך לשמור, לפתוח מחדש, ורק אז להגיד מה צריך —
  // וזה בדיוק הרגע שבו יודעים את זה.
  const isDraft = !endpoint;
  const [stored, setStored] = useState(isDraft ? [] : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const needs = isDraft ? (draftNeeds || []) : stored;

  useEffect(() => {
    if (isDraft) return undefined;
    let cancelled = false;
    fetch(endpoint)
      .then((r) => (r.ok ? r.json() : { needs: [] }))
      .then((body) => { if (!cancelled) setStored(body.needs || []); })
      .catch(() => { if (!cancelled) setStored([]); });
    return () => { cancelled = true; };
  }, [endpoint, isDraft]);

  const save = async (next) => {
    if (isDraft) {
      onDraftChange?.(next);
      return;
    }
    setStored(next);
    setBusy(true);
    setError('');
    try {
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ needs: next }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error || 'השמירה נכשלה');
      }
    } catch {
      setError('שגיאת רשת');
    } finally {
      setBusy(false);
    }
  };

  const countOf = (role) => (needs || []).find((n) => n.role === role)?.count || 0;

  /** לחיצה על תפקיד מוסיפה מקום; לחיצה נוספת מוסיפה עוד, עד שמאפסים. */
  const bump = (role, by) => {
    const current = countOf(role);
    const next = Math.max(0, Math.min(20, current + by));
    const without = (needs || []).filter((n) => n.role !== role);
    save(next === 0 ? without : [...without, { role, count: next }]);
  };

  if (needs === null) return null;
  const total = needs.reduce((sum, n) => sum + n.count, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ fontSize: 12, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span>{title}</span>
        {total > 0
          ? <span className="badge badge-amber">דרושים {total}</span>
          : <span style={{ opacity: 0.75 }}>{emptyLabel}</span>}
        {busy && <Loader2 size={12} className="spin" />}
        {error && <span style={{ color: 'var(--red)' }}>{error}</span>}
      </div>
      <div className="choice-row">
        {roleOptions.map(({ role, key }) => {
          const count = countOf(role);
          const Icon = roleIcon(role, key);
          return (
            <button
              type="button"
              key={role}
              className={`choice-pill ${count > 0 ? 'active' : ''}`}
              // הצבע והאייקון של התפקיד, ולא גוון אחיד: אותו „הפעלת קיר” נראה
              // כאן בדיוק כמו בכרטיס העובד וברשימת השיבוצים, וזה מה שמאפשר
              // לזהות אותו בלי לקרוא.
              style={{ '--choice-accent': roleColor(role, key) }}
              title={count > 0 ? 'לחיצה מוסיפה עוד מקום; לחיצה ימנית מורידה' : 'לחיצה מוסיפה מקום'}
              onClick={() => bump(role, 1)}
              onContextMenu={(e) => { e.preventDefault(); bump(role, -1); }}
            >
              <Icon size={13} aria-hidden="true" />
              {role}{count > 0 ? ` ×${count}` : ''}
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
        המקומות האלה מוצעים לצוות בטופס ההרשמה למשמרות, וכל אחד בוחר תפקיד שהוא מוסמך אליו.
      </div>
    </div>
  );
}

