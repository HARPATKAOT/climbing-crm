import React, { useState } from 'react';
import { Inbox, Printer } from 'lucide-react';
import { pairThermalPrinter, sendEscPosBase64, thermalSupported } from '../../utils/thermalPrinter.js';

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
  if (!thermalSupported()) return null;

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
        disabled={busy}
        onClick={pair}
        title="חיבור חד-פעמי של המדפסת התרמית למחשב הזה"
      >
        <Printer size={14} /> חיבור מדפסת
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={busy}
        onClick={openDrawer}
        title="פתיחת מגירת הקופה"
      >
        <Inbox size={14} /> פתיחת מגירה
      </button>
    </>
  );
}
