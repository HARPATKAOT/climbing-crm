import React from 'react';
import { Info } from 'lucide-react';

/**
 * הסבר שנקרא רק כשמבקשים אותו.
 *
 * משפטי ההסבר בטפסים נכתבו כדי שמי שרואה מסך בפעם הראשונה יבין, אבל מי
 * שעובד כאן כל יום קורא אותם שוב ושוב — והם תופסים יותר מקום מהשדה שהם
 * מסבירים. הסימן הזה מחזיק את אותו טקסט בדיוק, ומראה אותו בריחוף או בלחיצה
 * (לחיצה, כי במסך מגע אין ריחוף).
 *
 * `label` הוא מה שנקרא בקורא מסך — לא כל הסבר הוא קצר מספיק לשמש גם כשם.
 */
export default function InfoHint({ children, label = 'מידע נוסף', align = 'start' }) {
  return (
    <span className={`info-hint info-hint--${align}`}>
      <button type="button" className="info-hint-button" aria-label={label}>
        <Info size={13} aria-hidden="true" />
      </button>
      <span className="info-hint-bubble" role="tooltip">{children}</span>
    </span>
  );
}
