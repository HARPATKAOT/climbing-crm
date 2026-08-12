/** Shared labels, icons and status helpers for training equipment UI. */

import { Footprints, Shirt, Sparkles } from 'lucide-react';

/** אותו אייקון לכל פריט בכל מסך — תיק הלקוח, מעקב הציוד ופרטי הקבוצה. */
export const EQUIPMENT_ICONS = {
  shoes: Footprints,
  shirt: Shirt,
  chalk_bag: Sparkles,
};

/**
 * צבע קבוע לכל סוג פריט, שלא משתנה לעולם — הוא מזהה את הפריט, לא את מצבו.
 * הצבע של הסטטוס נשאר לטקסט הסטטוס ולרקע הצ׳יפ, כך שסריקה מהירה של השורה
 * עונה על שתי שאלות נפרדות: איזה פריט זה, ובאיזה מצב הוא.
 */
export const EQUIPMENT_ICON_COLORS = {
  shoes: '#A3E635',
  shirt: '#22D3EE',
  chalk_bag: '#FBBF24',
};

export const EQUIPMENT_LABELS = {
  shoes: 'נעליים',
  shirt: 'חולצה',
  chalk_bag: 'מגנזיום',
};

export const EQUIPMENT_LABELS_FULL = {
  shoes: 'נעלי טיפוס',
  shirt: 'חולצת חוג',
  chalk_bag: 'שק מגנזיום ומגנזיום',
};

export const EQUIPMENT_ORDER = ['shoes', 'shirt', 'chalk_bag'];

/** Editable lifecycle tones in customer / staff UIs (excludes missing). */
export const EQUIPMENT_STATUS_TONES = ['unpaid', 'awaiting', 'given', 'own', 'declined'];

export const EQUIPMENT_OWN_LABELS = {
  shoes: 'נעליים מהבית',
  shirt: 'יש חולצה',
  chalk_bag: 'יש מגנזיום',
};

export const EQUIPMENT_DECLINED_LABELS = {
  shoes: 'לא מעוניין בנעליים',
  shirt: 'לא רוצים חולצה',
  chalk_bag: 'לא מעוניינים במגנזיום',
};

export const EQUIPMENT_GIVEN_LABELS = {
  shoes: 'נמסר',
  shirt: 'חולצה נמסרה',
  chalk_bag: 'מגנזיום נמסר',
};

export function equipmentItemTone(item) {
  if (!item) return 'missing';
  if (item.payment_status === 'own') return 'own';
  // נעליים הן חובה, ולכן „לא מעוניינים” אינו מצב חוקי עבורן. רשומות
  // ישנות שנשמרו כך נקראות כ„ממתין לתשלום” בכל המסכים.
  if (item.payment_status === 'declined') {
    return item.item_type === 'shoes' ? 'unpaid' : 'declined';
  }
  if (item.payment_status !== 'paid') return 'unpaid';
  if (item.fulfillment_status !== 'given') return 'awaiting';
  return 'given';
}

export function equipmentToneColor(tone) {
  if (tone === 'given') return '#4ade80';
  if (tone === 'awaiting') return '#38bdf8';
  if (tone === 'own') return '#fb923c';
  if (tone === 'declined') return '#c084fc';
  return '#fb7185';
}

export function equipmentToneBg(tone) {
  if (tone === 'given') return 'rgba(74, 222, 128, 0.18)';
  if (tone === 'awaiting') return 'rgba(56, 189, 248, 0.18)';
  if (tone === 'own') return 'rgba(251, 146, 60, 0.18)';
  if (tone === 'declined') return 'rgba(192, 132, 252, 0.18)';
  return 'rgba(251, 113, 133, 0.18)';
}

export function equipmentToneLabel(tone, itemType = null) {
  if (tone === 'given') {
    return (itemType && EQUIPMENT_GIVEN_LABELS[itemType]) || 'נמסר';
  }
  if (tone === 'awaiting') return 'שולם';
  if (tone === 'own') {
    return (itemType && EQUIPMENT_OWN_LABELS[itemType]) || 'מהבית';
  }
  if (tone === 'declined') {
    return (itemType && EQUIPMENT_DECLINED_LABELS[itemType]) || 'לא מעוניינים';
  }
  return 'ממתין לתשלום';
}

/**
 * ארבעה מצבים בלבד בגיליון הנוכחות, צבע אחד לכל משמעות. זה מכוון
 * להיות פחות מדויק מסטטוס הציוד המלא: המדריך צריך לדעת רק אם יש לו
 * פעולה לעשות, והפירוט המלא נמצא בחלון העריכה ובטאב הציוד.
 *
 * אותם צבעים משמשים גם באייקון הציוד בראש תיק הלקוח, כדי שמצב זהה
 * ייראה זהה בשני המסכים.
 */
export const EQUIPMENT_SHEET_TONE = {
  give: { color: '#FBBF24', bg: 'rgba(251,191,36,0.18)', border: 'AA', label: 'לתת עכשיו' },
  ready: { color: '#4ADE80', bg: 'rgba(74,222,128,0.16)', border: '55', label: 'תקין' },
  blocked: { color: '#FB7185', bg: 'rgba(251,113,133,0.16)', border: '55', label: 'ממתין לתשלום' },
  // אפור מלא ולא דהוי: „אין מה לעשות” הוא סטטוס, לא היעדר סטטוס.
  na: { color: '#94A3B8', bg: 'rgba(148,163,184,0.20)', border: '77', label: 'לא רלוונטי' },
};

/** סדר התצוגה במקרא — מהדחוף לחסר משמעות. */
export const EQUIPMENT_SHEET_TONE_ORDER = ['give', 'blocked', 'ready', 'na'];

export function equipmentSheetTone(item) {
  if (!item) return 'na';
  // נגזר מ-equipmentItemTone כדי שיהיה מקור אמת אחד — שם כבר מנורמל
  // „לא מעוניינים” על נעליים ל„ממתין לתשלום”.
  const tone = equipmentItemTone(item);
  // „מהבית” = הילד מצויד, בדיוק כמו פריט שנמסר.
  if (tone === 'own' || tone === 'given') return 'ready';
  // „לא מעוניינים” הוא המצב היחיד שבו אין פריט ואין מה לעשות בנידון.
  if (tone === 'declined') return 'na';
  if (tone === 'unpaid') return 'blocked';
  // נעליים לא נמסרות מהמחסן — מי ששילם פשוט לוקח זוג.
  return item.item_type === 'shoes' ? 'ready' : 'give';
}

/**
 * מצב הציוד של מתאמן כולו, בצבע אחד — לאייקון הסיכום בראש התיק.
 * החמור ביותר קובע: מי שחייב כסף אדום, מי ששילם ומחכה למסירה כתום,
 * וירוק רק כשאין שום פעולה פתוחה. בלי פריטים בכלל אין מה לצבוע.
 */
export function equipmentOverallTone(items = []) {
  const tones = items.map(equipmentSheetTone).filter((t) => t !== 'na');
  if (!tones.length) return null;
  if (tones.includes('blocked')) return 'blocked';
  if (tones.includes('give')) return 'give';
  return 'ready';
}

/**
 * מי מותר לסמן ידנית ומי לא.
 *
 * „שולם” נקבע רק כשמתקבל תשלום בדף התשלום, ו„נמסר” נפתח רק אחרי שיש תשלום.
 * בלי זה אפשר להעביר פריט ישר מ„ממתין לתשלום” ל„נמסר” ולעקוף סליקה.
 * השרת אוכף את אותו כלל — זה כאן רק כדי להסביר למשתמש למה הכפתור סגור.
 *
 * @returns {{allowed: boolean, reason: string}}
 */
export function equipmentToneTransition(targetTone, item) {
  const current = equipmentItemTone(item);
  if (targetTone === current) return { allowed: false, reason: 'זה הסטטוס הנוכחי' };
  if (targetTone === 'awaiting') {
    // חזרה מ„נמסר” ל„שולם” היא ביטול מסירה בלבד — התשלום עצמו נשאר.
    return current === 'given'
      ? { allowed: true, reason: '' }
      : { allowed: false, reason: 'הסטטוס מתעדכן לבד כשמתקבל תשלום בדף התשלום' };
  }
  if (targetTone === 'given') {
    return current === 'awaiting'
      ? { allowed: true, reason: '' }
      : { allowed: false, reason: 'אפשר לסמן מסירה רק אחרי תשלום' };
  }
  return { allowed: true, reason: '' };
}

/**
 * Apply a target tone via existing equipment endpoints.
 */
export async function applyEquipmentTone(
  itemId,
  targetTone,
  { currentItem, allowManualPaid = false } = {}
) {
  const id = encodeURIComponent(itemId);
  const put = async (body) => {
    const res = await fetch(`/api/equipment/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'עדכון הציוד נכשל');
    return data;
  };
  const post = async (path) => {
    const res = await fetch(`/api/equipment/${id}/${path}`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'עדכון הציוד נכשל');
    return data;
  };

  const current = currentItem ? equipmentItemTone(currentItem) : null;
  if (current === targetTone) return currentItem;

  if (targetTone === 'own') {
    return post('mark-own');
  }

  if (targetTone === 'declined') {
    return post('mark-declined');
  }

  if (targetTone === 'unpaid') {
    if (current === 'own' || current === 'declined') {
      return post('mark-unpaid');
    }
    if (currentItem?.fulfillment_status === 'given') {
      await post('mark-pending');
    }
    return put({ payment_status: 'unpaid' });
  }

  if (targetTone === 'awaiting') {
    // מ„נמסר” אפשר לחזור ל„שולם” — התשלום עצמו לא משתנה.
    if (currentItem?.payment_status === 'paid') {
      return post('mark-pending');
    }
    // סימון ידני של תשלום שהתקבל מחוץ לדף התשלום. השרת אוכף שוב שהמבקש
    // הוא מנהל, ולכן הדגל הזה הוא נוחות בממשק ולא הרשאה.
    if (allowManualPaid) {
      return put({ payment_status: 'paid' });
    }
    throw new Error('הסטטוס „שולם” מתעדכן רק כשמתקבל תשלום בדף התשלום');
  }

  if (targetTone === 'given') {
    if (currentItem?.payment_status !== 'paid') {
      throw new Error('אפשר לסמן מסירה רק אחרי תשלום');
    }
    return post('mark-given');
  }

  throw new Error('סטטוס לא תקין');
}

export function formatRentalRange(item) {
  if (!item?.rental_starts_at && !item?.rental_ends_at) return '';
  const fmt = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' });
  };
  const start = fmt(item.rental_starts_at);
  const end = fmt(item.rental_ends_at);
  if (start && end) return `${start} – ${end}`;
  return end || start;
}
