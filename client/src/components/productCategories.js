/** Shared product catalog categories for Pricelist + POS filters. */
import {
  Coffee, PartyPopper, Dumbbell, Ticket, Mountain,
  DoorOpen, Users, Percent, Package,
} from 'lucide-react';

export const PRODUCT_CATEGORIES = [
  'קיוסק',
  'פעילויות',
  'אימונים אישיים',
  'כרטיסיות ומנויים',
  'ציוד טיפוס',
  'כניסה',
  'חוגים',
  'הנחות',
  'שונות',
];

/** Map legacy category names (from older pricelist data) to the new set. */
const CATEGORY_ALIASES = {
  כרטיסיה: 'כרטיסיות ומנויים',
  מנוי: 'כרטיסיות ומנויים',
  'שיעורים פרטיים': 'אימונים אישיים',
  'השכרת ציוד': 'ציוד טיפוס',
  אירועים: 'פעילויות',
  קייטנה: 'פעילויות',
  קורסים: 'אימונים אישיים',
};

export const CATEGORY_COLORS = {
  קיוסק: { bg: 'rgba(251,146,60,0.12)', text: '#FB923C' },
  פעילויות: { bg: 'rgba(52,211,153,0.1)', text: '#6EE7B7' },
  'אימונים אישיים': { bg: 'rgba(245,158,11,0.1)', text: '#FCD34D' },
  'כרטיסיות ומנויים': { bg: 'rgba(16,185,129,0.1)', text: '#34D399' },
  'ציוד טיפוס': { bg: 'rgba(249,115,22,0.1)', text: '#FB923C' },
  כניסה: { bg: 'rgba(99,102,241,0.12)', text: '#A5B4FC' },
  חוגים: { bg: 'rgba(168,85,247,0.1)', text: '#C084FC' },
  הנחות: { bg: 'rgba(239,68,68,0.08)', text: '#FCA5A5' },
  שונות: { bg: 'rgba(255,255,255,0.06)', text: 'var(--text-3)' },
};

export const DEFAULT_CATEGORY_COLOR = { bg: 'rgba(255,255,255,0.05)', text: 'var(--text-2)' };

export const CATEGORY_ICONS = {
  קיוסק: Coffee,
  פעילויות: PartyPopper,
  'אימונים אישיים': Dumbbell,
  'כרטיסיות ומנויים': Ticket,
  'ציוד טיפוס': Mountain,
  כניסה: DoorOpen,
  חוגים: Users,
  הנחות: Percent,
  שונות: Package,
};

export function normalizeCategoryName(cat) {
  const raw = String(cat || '').trim();
  if (!raw) return 'שונות';
  return CATEGORY_ALIASES[raw] || raw;
}

export function normalizeCategories(list) {
  const src = Array.isArray(list) ? list : list ? [list] : [];
  const out = [];
  const seen = new Set();
  for (const c of src) {
    const n = normalizeCategoryName(c);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out.length ? out : ['שונות'];
}

/** Compress an image file to a JPEG data-URL suitable for catalog storage. */
export function compressImageFile(file, { maxSide = 720, quality = 0.72 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('לא נבחר קובץ'));
      return;
    }
    const type = String(file.type || '').toLowerCase();
    if (type.includes('heic') || type.includes('heif') || /\.heic$|\.heif$/i.test(file.name || '')) {
      reject(new Error('פורמט התמונה לא נתמך — שמרו כ־JPG או PNG ונסו שוב'));
      return;
    }

    const finishFromBitmap = (bitmap) => {
      try {
        const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, w, h);
        if (typeof bitmap.close === 'function') bitmap.close();
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (err) {
        reject(new Error(err?.message || 'עיבוד התמונה נכשל'));
      }
    };

    if (typeof createImageBitmap === 'function') {
      createImageBitmap(file)
        .then(finishFromBitmap)
        .catch(() => {
          // Fall through to FileReader + Image
          readWithImage();
        });
      return;
    }

    readWithImage();

    function readWithImage() {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('קריאת הקובץ נכשלה'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('קובץ התמונה לא תקין או לא נתמך'));
        img.onload = () => {
          try {
            const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
            const w = Math.max(1, Math.round(img.width * scale));
            const h = Math.max(1, Math.round(img.height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', quality));
          } catch (err) {
            reject(new Error(err?.message || 'עיבוד התמונה נכשל'));
          }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    }
  });
}

/** Read image as data-URL without compression (fallback for stubborn files). */
export function readImageFileAsDataUrl(file, { maxBytes = 1_200_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('לא נבחר קובץ'));
      return;
    }
    if (file.size > maxBytes) {
      reject(new Error('התמונה גדולה מדי — נסו תמונה קטנה יותר'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('קריאת הקובץ נכשלה'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}
