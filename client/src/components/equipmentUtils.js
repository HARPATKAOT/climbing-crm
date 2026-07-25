/** Shared labels and status helpers for training equipment UI. */

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
export const EQUIPMENT_STATUS_TONES = ['unpaid', 'awaiting', 'given'];

export function equipmentItemTone(item) {
  if (!item) return 'missing';
  if (item.payment_status !== 'paid') return 'unpaid';
  if (item.fulfillment_status !== 'given') return 'awaiting';
  return 'given';
}

export function equipmentToneColor(tone) {
  if (tone === 'given') return '#4ade80';
  if (tone === 'awaiting') return '#38bdf8';
  return '#fb7185';
}

export function equipmentToneBg(tone) {
  if (tone === 'given') return 'rgba(74, 222, 128, 0.18)';
  if (tone === 'awaiting') return 'rgba(56, 189, 248, 0.18)';
  return 'rgba(251, 113, 133, 0.18)';
}

export function equipmentToneLabel(tone) {
  if (tone === 'given') return 'נמסר';
  if (tone === 'awaiting') return 'שולם';
  return 'ממתין לתשלום';
}

/**
 * Apply a target tone via existing equipment endpoints.
 * unpaid → PUT payment unpaid; awaiting → PUT paid (+ mark-pending if needed); given → paid then mark-given.
 */
export async function applyEquipmentTone(itemId, targetTone, { currentItem } = {}) {
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

  if (targetTone === 'unpaid') {
    if (currentItem?.fulfillment_status === 'given') {
      await post('mark-pending');
    }
    return put({ payment_status: 'unpaid' });
  }

  if (targetTone === 'awaiting') {
    let row = currentItem;
    if (row?.payment_status !== 'paid') {
      row = await put({ payment_status: 'paid' });
    }
    if (row?.fulfillment_status === 'given') {
      row = await post('mark-pending');
    }
    return row;
  }

  if (targetTone === 'given') {
    let row = currentItem;
    if (row?.payment_status !== 'paid') {
      row = await put({ payment_status: 'paid' });
    }
    if (row?.fulfillment_status !== 'given') {
      row = await post('mark-given');
    }
    return row;
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
