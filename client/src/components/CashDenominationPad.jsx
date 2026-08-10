import React, { useMemo } from 'react';
import { Minus, Plus } from 'lucide-react';
import { CASH_DENOMS, enrichCatalog, sumDenoms } from './cashDenoms.js';

export { CASH_DENOMS as DEFAULT_DENOMS, sumDenoms };

function Stepper({ title, qty, onBump, onSet }) {
  return (
    <div className="cash-stepper" aria-label={title}>
      <button
        type="button"
        className="cash-step cash-step--plus"
        onClick={() => onBump(1)}
        aria-label="הוספה"
      >
        <Plus size={16} strokeWidth={2.5} />
      </button>
      <input
        className="cash-qty"
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        value={qty === 0 ? '' : qty}
        placeholder="0"
        onChange={(e) => onSet(e.target.value)}
        aria-label={`כמות ${title}`}
      />
      <button
        type="button"
        className="cash-step"
        onClick={() => onBump(-1)}
        disabled={qty <= 0}
        aria-label="הפחתה"
      >
        <Minus size={16} strokeWidth={2.5} />
      </button>
    </div>
  );
}

/** שורה אחת: תמונה · שם · סה״כ שורה · בוחר כמות מימין */
function DenomLine({ d, qty, onBump, onSet }) {
  const line = Math.round(qty * d.value * 100) / 100;
  const active = qty > 0;
  const title = `${d.label} ${d.unit}`;

  return (
    <div
      className={`cash-line cash-line--${d.kind}${active ? ' is-active' : ''}`}
      style={{ '--accent': d.accent, '--tint': d.tint }}
      title={`${title} — קליק שמאלי מוסיף, קליק ימני מוריד`}
    >
      {/* הספירה נעשית ביד על השטרות עצמם: קליק שמאלי על השטר מוסיף אחד,
          קליק ימני מוריד. הכפתורים והמספר נשארים למי שמעדיף אותם ולתיקון
          מהיר של כמות גדולה. */}
      <div
        className={`cash-line-img cash-line-img--${d.kind}`}
        role="button"
        tabIndex={0}
        aria-label={`${title} — הוספה`}
        style={{ cursor: 'pointer', userSelect: 'none' }}
        onClick={() => onBump(1)}
        onContextMenu={(e) => { e.preventDefault(); if (qty > 0) onBump(-1); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onBump(1); }
        }}
      >
        <img
          src={d.image}
          alt={title}
          draggable={false}
          style={d.objectPosition ? { objectPosition: d.objectPosition } : undefined}
        />
      </div>
      <Stepper title={title} qty={qty} onBump={onBump} onSet={onSet} />
      <div className="cash-line-sum">
        ₪{line.toLocaleString('he-IL', { minimumFractionDigits: 2 })}
      </div>
    </div>
  );
}

/**
 * שורה אחת דחוסה: כל השטרות והמטבעות זה ליד זה, מהגדול (ימין) לקטן (שמאל).
 *
 * בדלפק אין מקום לרשת של עשר שורות שגובהה כגובה המסך, וגם אין זמן: הספירה
 * נעשית תוך כדי שהלקוח עומד. קליק על השטר מוסיף אחד, קליק ימני מוריד, והמספר
 * יושב על השטר עצמו — בלי כפתורים ובלי שדות.
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
  variant = 'simple',
  showTotal = true,
}) {
  const catalog = useMemo(() => enrichCatalog(denominations), [denominations]);
  const total = useMemo(() => sumDenoms(value, catalog), [value, catalog]);

  const setQty = (key, raw) => {
    const n = Math.max(0, Math.floor(Number(raw) || 0));
    onChange?.({ ...value, [key]: n });
  };

  const bump = (key, delta) => {
    setQty(key, (Number(value[key]) || 0) + delta);
  };

  if (variant === 'row') {
    // הקטלוג כבר מסודר מ-200 ומטה, וב-RTL הראשון הוא הימני — הגדול מימין.
    return (
      <div className="cash-row">
        {catalog.map((d) => (
          <DenomChip key={d.key} d={d} qty={Number(value[d.key]) || 0} onBump={(delta) => bump(d.key, delta)} />
        ))}
        {showTotal && (
          <span className="cash-row-total">
            ₪{total.toLocaleString('he-IL', { minimumFractionDigits: 2 })}
          </span>
        )}
      </div>
    );
  }

  if (variant === 'stepper') {
    const notes = catalog.filter((d) => d.kind === 'note');
    const coins = catalog.filter((d) => d.kind === 'coin');

    const render = (d) => (
      <DenomLine
        key={d.key}
        d={d}
        qty={Number(value[d.key]) || 0}
        onBump={(delta) => bump(d.key, delta)}
        onSet={(raw) => setQty(d.key, raw)}
      />
    );

    return (
      <div className="cash-pad">
        <section className="cash-pad-section">
          <h3 className="cash-pad-heading">שטרות</h3>
          <div className="cash-line-grid">{notes.map(render)}</div>
        </section>

        <section className="cash-pad-section">
          <h3 className="cash-pad-heading">מטבעות</h3>
          <div className="cash-line-grid">{coins.map(render)}</div>
        </section>

        {showTotal && (
          <div className="cash-pad-total">
            סה״כ בספירה:{' '}
            <strong>
              ₪{total.toLocaleString('he-IL', { minimumFractionDigits: 2 })}
            </strong>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="cash-pad-simple">
      {catalog.map((d) => (
        <label key={d.key} className="cash-pad-simple-item">
          <span>{`${d.label} ${d.unit}`}</span>
          <input
            className="input"
            type="number"
            min={0}
            step={1}
            value={value[d.key] ?? ''}
            placeholder="0"
            onChange={(e) => setQty(d.key, e.target.value)}
          />
        </label>
      ))}
      {showTotal && (
        <div className="cash-pad-total">
          סה״כ בספירה:{' '}
          <strong>
            ₪{total.toLocaleString('he-IL', { minimumFractionDigits: 2 })}
          </strong>
        </div>
      )}
    </div>
  );
}
