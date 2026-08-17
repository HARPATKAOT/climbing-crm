import React, { useMemo, useState } from 'react';
import { ShieldBan, ChevronDown, ChevronLeft, Undo2, Save } from 'lucide-react';

const REASON_LABELS = {
  opted_out: 'ביקשו להסיר מדיוור שיווקי',
  list_unsubscribed: 'הסירו את עצמם מרשימת התפוצה',
  invalid_phone: 'מספר טלפון לא תקין',
  template_recency: 'קיבלו את התבנית הזו לאחרונה',
  frequency_cap: 'קיבלו הודעה שיווקית לאחרונה',
  repeated_failures: 'שליחות קודמות נכשלו שוב ושוב',
  missing_variables: 'חסר נתון שהתבנית צריכה',
  window_closed: 'חלון 24 השעות סגור',
  trainee_phone: 'טלפון של מתאמן (הדיוור מוגדר להורים)',
};

/**
 * «X נמענים הוסרו» — הפאנל שמראה בדיוק מי הוסר מהשליחה ולמה, ומאפשר
 * לבטל חסימה ספציפית במודע. הסרה מרשימת תפוצה ומספר שבור אינם ניתנים
 * לעקיפה. האכיפה עצמה בשרת; הפאנל רק מציג ומבקש.
 */
export default function BroadcastSuppressionPanel({
  plan,
  overrides = [],
  onToggleOverride,
  recencyDays,
  capHours,
  onChangeSettings,
  onSaveDefaults,
  savingDefaults = false,
}) {
  const [openReason, setOpenReason] = useState(null);

  const byReason = useMemo(() => {
    const map = new Map();
    for (const row of plan?.suppressed || []) {
      for (const reason of row.reasons) {
        if (!map.has(reason.code)) map.set(reason.code, []);
        map.get(reason.code).push({ ...row, activeReason: reason });
      }
    }
    return map;
  }, [plan]);

  const total = plan?.suppressedCount || 0;
  const overrideSet = new Set(overrides);

  return (
    <div className="card card-p">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <ShieldBan size={16} style={{ color: 'var(--amber)' }} />
        <span className="section-title" style={{ marginBottom: 0, fontSize: 13 }}>
          שכבת החסימות — {total > 0 ? `${total} נמענים הוסרו` : 'אף נמען לא הוסר'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: total ? 12 : 0 }}>
        <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          לא לשלוח שוב את אותה תבנית תוך (ימים)
          <input
            className="input input-sm"
            type="number"
            min="0"
            max="90"
            style={{ width: 90 }}
            value={recencyDays}
            onChange={(e) => onChangeSettings?.({ recencyDays: e.target.value })}
          />
        </label>
        <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          מרווח מכל הודעה שיווקית (שעות)
          <input
            className="input input-sm"
            type="number"
            min="0"
            max="720"
            style={{ width: 90 }}
            value={capHours}
            onChange={(e) => onChangeSettings?.({ capHours: e.target.value })}
          />
        </label>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={onSaveDefaults}
          disabled={savingDefaults}
          title="שמירת הערכים כברירת מחדל לכל דיוור"
        >
          <Save size={12} /> {savingDefaults ? 'שומר…' : 'קבע כברירת מחדל'}
        </button>
      </div>

      {total > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[...byReason.entries()].map(([code, rows]) => {
            const open = openReason === code;
            const overridable = rows[0]?.activeReason?.overridable;
            return (
              <div key={code} style={{ border: '1px solid var(--border)', borderRadius: 10 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  // .btn is nowrap — בעמודה צרה תווית הצד נשפכת מחוץ לכרטיס,
                  // אז מרשים שבירת שורה בתוך הכפתור.
                  style={{
                    width: '100%',
                    minWidth: 0,
                    height: 'auto',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    whiteSpace: 'normal',
                    textAlign: 'right',
                    padding: '8px 12px',
                    rowGap: 4,
                  }}
                  onClick={() => setOpenReason(open ? null : code)}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, minWidth: 0 }}>
                    {open ? <ChevronDown size={14} style={{ flexShrink: 0 }} /> : <ChevronLeft size={14} style={{ flexShrink: 0 }} />}
                    <span style={{ minWidth: 0 }}>{REASON_LABELS[code] || rows[0]?.activeReason?.label || code}</span>
                    <span className="badge badge-gray" style={{ flexShrink: 0 }}>{rows.length}</span>
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-3)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                    {overridable ? 'ניתן לעקיפה מודעת' : 'לא ניתן לעקיפה'}
                  </span>
                </button>
                {open && (
                  <div style={{ maxHeight: 220, overflowY: 'auto', padding: '4px 12px 10px' }}>
                    {rows.map((row) => {
                      const canOverride = row.overridable;
                      const overridden = overrideSet.has(row.id);
                      return (
                        <div
                          key={`${code}-${row.id}`}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            gap: 8, padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: 12,
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600 }}>{row.name || 'ללא שם'}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
                              <span dir="ltr">{row.phone}</span>
                              {row.activeReason?.detail ? ` · ${row.activeReason.detail}` : ''}
                              {row.studentName ? ` · הורה של ${row.studentName}` : ''}
                            </div>
                          </div>
                          {canOverride && (
                            <button
                              type="button"
                              className={`btn btn-xs ${overridden ? 'btn-primary' : 'btn-ghost'}`}
                              onClick={() => onToggleOverride?.(row.id)}
                              title={overridden ? 'החזרת החסימה' : 'שליחה למרות החסימה'}
                            >
                              <Undo2 size={11} /> {overridden ? 'יישלח בכל זאת' : 'בטל חסימה'}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
