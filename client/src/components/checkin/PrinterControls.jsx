import React, { useState } from 'react';
import { Inbox, Printer, Usb } from 'lucide-react';
import {
  pairThermalPrinter, sendEscPosBase64, thermalSupported, printMode, setPrintMode, PRINT_MODES,
} from '../../utils/thermalPrinter.js';

/**
 * חיבור המדפסת התרמית ופתיחת המגירה — מהמסוף.
 *
 * החיבור הוא WebUSB: הדפדפן מדבר ישירות עם המדפסת, בלי דרייבר ובלי שרת
 * הדפסה. לכן הוא **לכל מחשב ולכל דפדפן בנפרד**, ונדרש פעם אחת בכל עמדה.
 * הכפתורים האלה חיו רק במסך הקופה; מי שעובד מהמסוף לא הגיע לשם, וכשלא היה
 * מה לשלוח אליו — פשוט לא קרה כלום, בלי הודעת שגיאה.
 *
 * `requestDevice` של הדפדפן חייב לרוץ מתוך לחיצה של אדם, ולכן הוא נקרא כאן
 * ישירות מה-onClick ולא אחרי המתנה כלשהי.
 */
export default function PrinterControls({ onMessage }) {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState(printMode);
  const osMode = mode === PRINT_MODES.OS;

  const switchMode = () => {
    const next = osMode ? PRINT_MODES.USB : PRINT_MODES.OS;
    setPrintMode(next);
    setMode(next);
    onMessage?.(next === PRINT_MODES.OS
      ? 'הדפסה דרך ווינדוס — המדפסת נשארת משותפת עם תוכנות אחרות. להדפסה בלי חלונית אישור, פתחו את המסוף מהקיצור „מסוף כניסה” בשולחן העבודה'
      : 'הדפסה ישירה למדפסת — דורשת שהמדפסת תהיה של המסוף בלבד');
  };

  // גם בלי WebUSB אפשר להדפיס דרך ווינדוס, ולכן הכפתורים לא נעלמים.
  if (!thermalSupported()) {
    return (
      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>הדפסה דרך ווינדוס</span>
    );
  }

  const pair = async () => {
    setBusy(true);
    try {
      const info = await pairThermalPrinter();
      onMessage?.(`המדפסת חוברה: ${info.productName || `${info.vendorId}:${info.productId}`}`);
    } catch (err) {
      onMessage?.(err.message || 'חיבור המדפסת נכשל', true);
    } finally {
      setBusy(false);
    }
  };

  const openDrawer = async () => {
    setBusy(true);
    try {
      // הרשאת USB נשאלת רק מתוך לחיצה, וכל `await` שלפניה מבטל אותה. אם עוד
      // לא חוברה מדפסת, הדפדפן היה עונה כאן «Must be handling a user gesture»
      // — הודעה שאי אפשר לפעול לפיה. עדיף לומר מה באמת חסר.
      const granted = await navigator.usb.getDevices();
      if (!granted.length) {
        throw new Error('המדפסת עוד לא חוברה למחשב הזה — לחצו קודם «חיבור מדפסת»');
      }
      const res = await fetch('/api/cash-register/receipt-bytes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drawerOnly: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.base64) throw new Error(data.error || 'בניית פקודת הפתיחה נכשלה');
      await sendEscPosBase64(data.base64);
      onMessage?.('המגירה נפתחה');
    } catch (err) {
      onMessage?.(err.message || 'פתיחת המגירה נכשלה', true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={switchMode}
        title={osMode
          ? 'כרגע מדפיסים דרך ווינדוס. לחיצה עוברת להדפסה ישירה (מהירה יותר, אבל תופסת את המדפסת)'
          : 'כרגע מדפיסים ישירות למדפסת. לחיצה עוברת להדפסה דרך ווינדוס, שמשאירה אותה משותפת'}
      >
        <Usb size={14} /> {osMode ? 'הדפסה: ווינדוס' : 'הדפסה: ישירה'}
      </button>
      {!osMode && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={pair}
          title="חיבור חד-פעמי של המדפסת התרמית למחשב הזה"
        >
          <Printer size={14} /> חיבור מדפסת
        </button>
      )}
      {!osMode && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={openDrawer}
          title="פתיחת מגירת הקופה"
        >
          <Inbox size={14} /> פתיחת מגירה
        </button>
      )}
    </>
  );
}
