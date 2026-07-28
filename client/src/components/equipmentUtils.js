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
  if (item.payment_status === 'declined') return 'declined';
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
 * Apply a target tone via existing equipment endpoints.
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
    let row = currentItem;
    if (row?.payment_status === 'own' || row?.payment_status === 'declined') {
      row = await post('mark-unpaid');
    }
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
    if (row?.payment_status === 'own' || row?.payment_status === 'declined') {
      row = await post('mark-unpaid');
    }
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
