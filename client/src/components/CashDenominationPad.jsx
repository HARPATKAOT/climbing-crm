import React, { useMemo } from 'react';
import { CASH_DENOMS, enrichCatalog, sumDenoms } from './cashDenoms.js';

export { CASH_DENOMS as DEFAULT_DENOMS, sumDenoms };

/**
 * ספירת מזומן: שורה אחת של שטרות ומטבעות, מהגדול (ימין) לקטן (שמאל).
 *
 * הרשת הקודמת — עשר שורות עם שדה מספר וכפתורי חיבור וחיסור — תפסה מסך שלם
 * ובעמודה צרה לא נראתה בכלל. הספירה בפועל היא יד שעוברת על השטרות, ולכן
 * קליק על השטר מוסיף אחד וקליק ימני מוריד; הכמות יושבת על השטר עצמו.
 *
 * שני גדלים: `sm` לדלפק, שבו הספירה היא צד של מכירה, ו-`lg` לפתיחת הקופה
 * ולסגירתה, שבהן הספירה היא כל המשימה וכדאי שהשטרות יהיו גדולים וברורים.
 */
function DenomChip({ d, qty, onBump }) {
  const title = `${d.label} ${d.unit}`;
  return (
    <button
      type="button"
      className={`cash-chip cash-chip--${d.kind}${qty > 0 ? ' is-active' : ''}`}
      style={{ '--accent': d.accent }}
      title={`${title} — קליק מוסיף, קליק ימני מוריד`}
      aria-label={`${title}, ${qty}`}
      onClick={() => onBump(1)}
      onContextMenu={(e) => { e.preventDefault(); if (qty > 0) onBump(-1); }}
    >
      <img
        src={d.image}
        alt={title}
        draggable={false}
        style={d.objectPosition ? { objectPosition: d.objectPosition } : undefined}
      />
      {qty > 0 && <span className="cash-chip-qty">{qty}</span>}
    </button>
  );
}

export default function CashDenominationPad({
  denominations = CASH_DENOMS,
  value = {},
  onChange,
  size = 'sm',
  showTotal = true,
}) {
  const catalog = useMemo(() => enrichCatalog(denominations), [denominations]);
  const total = useMemo(() => sumDenoms(value, catalog), [value, catalog]);

  const bump = (key, delta) => {
    const n = Math.max(0, Math.floor((Number(value[key]) || 0) + delta));
    onChange?.({ ...value, [key]: n });
  };

  // הקטלוג כבר מסודר מ-200 ומטה, וב-RTL הראשון הוא הימני — הגדול מימין.
  return (
    <div className={`cash-row cash-row--${size}`}>
      {catalog.map((d) => (
        <DenomChip
          key={d.key}
          d={d}
          qty={Number(value[d.key]) || 0}
          onBump={(delta) => bump(d.key, delta)}
        />
      ))}
      {showTotal && (
        <span className="cash-row-total">
          סה״כ ₪{total.toLocaleString('he-IL', { minimumFractionDigits: 2 })}
        </span>
      )}
    </div>
  );
}
