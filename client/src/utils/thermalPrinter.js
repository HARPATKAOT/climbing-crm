/**
 * WebUSB ESC/POS sender for SNBC BTP-R880NP II (+ drawer on DK port).
 * Falls back gracefully when WebUSB is unavailable.
 */

const STORAGE_KEY = 'kirboaz_thermal_usb';

function loadFilter() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

function saveFilter(device) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ vendorId: device.vendorId, productId: device.productId })
    );
  } catch {
    /* ignore */
  }
}

export function thermalSupported() {
  return typeof navigator !== 'undefined' && !!navigator.usb;
}

async function openDevice() {
  if (!thermalSupported()) throw new Error('הדפדפן לא תומך בחיבור ישיר למדפסת — השתמשו בכרום');
  const saved = loadFilter();
  let devices = await navigator.usb.getDevices();
  let device = devices.find(
    (d) => !saved || (d.vendorId === saved.vendorId && d.productId === saved.productId)
  );
  if (!device) {
    device = await navigator.usb.requestDevice({
      filters: saved ? [saved] : [{ classCode: 7 }], // 7 = printer class; also allow empty for pick
    }).catch(async () =>
      navigator.usb.requestDevice({ filters: [] })
    );
  }
  if (!device) throw new Error('לא נבחרה מדפסת');
  saveFilter(device);
  if (!device.opened) {
    try {
      await device.open();
    } catch (err) {
      // „Access denied” בווינדוס אינו חוסר הרשאה בדפדפן אלא בעלות: דרייבר
      // המדפסת של המערכת, או טאב אחר של המסוף, כבר מחזיק את ההתקן. אלה שתי
      // תקלות שונות לגמרי עם שני פתרונות שונים, והודעת הדפדפן לא מבחינה.
      if (/access denied|SecurityError|NotAllowedError/i.test(err?.message || err?.name || '')) {
        throw new Error(
          'המדפסת תפוסה על ידי תוכנה אחרת. סגרו טאבים אחרים של המסוף באותו מחשב '
          + 'ונסו שוב; אם זה חוזר, דרייבר המדפסת של ווינדוס מחזיק אותה וצריך '
          + 'להעביר אותה ל-WinUSB'
        );
      }
      throw err;
    }
  }
  if (device.configuration === null) await device.selectConfiguration(1);
  const iface = device.configuration.interfaces.find((i) =>
    i.alternates.some((a) => a.interfaceClass === 7 || a.endpoints.some((e) => e.direction === 'out'))
  ) || device.configuration.interfaces[0];
  if (!iface) throw new Error('לא נמצא ממשק למדפסת');
  await device.claimInterface(iface.interfaceNumber);
  const alt = iface.alternates[0];
  const endpoint = alt.endpoints.find((e) => e.direction === 'out');
  if (!endpoint) throw new Error('לא נמצא ערוץ שליחה למדפסת');
  return { device, interfaceNumber: iface.interfaceNumber, endpointNumber: endpoint.endpointNumber };
}

export async function sendEscPosBase64(base64) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const { device, interfaceNumber, endpointNumber } = await openDevice();
  try {
    // `transferOut` אינו זורק כשהמדפסת מסרבת — הוא מחזיר סטטוס. בלי הבדיקה
    // הזאת שליחה שנבלעה נראית כמו הצלחה, ואיש לא מבין למה שום דבר לא יצא.
    const result = await device.transferOut(endpointNumber, bytes);
    if (result?.status && result.status !== 'ok') {
      throw new Error(
        result.status === 'stall'
          ? 'המדפסת דחתה את השליחה — כבו והדליקו אותה ונסו שוב'
          : `המדפסת החזירה סטטוס ${result.status}`
      );
    }
  } finally {
    // שחרור מלא ולא רק של הממשק: טאב שמחזיק את ההתקן פתוח חוסם כל טאב אחר
    // באותו מחשב, וזו בדיוק „Access denied” שאי אפשר להסביר.
    try {
      await device.releaseInterface(interfaceNumber);
    } catch {
      /* ignore */
    }
    try {
      await device.close();
    } catch {
      /* ignore */
    }
  }
  return { ok: true };
}

export async function pairThermalPrinter() {
  if (!thermalSupported()) throw new Error('הדפדפן לא תומך בחיבור ישיר למדפסת');
  const device = await navigator.usb.requestDevice({ filters: [] });
  saveFilter(device);
  return { vendorId: device.vendorId, productId: device.productId, productName: device.productName };
}

export async function printReceiptFromSale(receiptBytes) {
  if (!receiptBytes?.base64) throw new Error('אין נתוני הדפסה');
  return sendEscPosBase64(receiptBytes.base64);
}

export function openInvoiceFallback(docUrl) {
  if (!docUrl) return false;
  window.open(docUrl, '_blank', 'noopener,noreferrer');
  return true;
}
