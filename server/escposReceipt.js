/**
 * Build ESC/POS byte buffers for SNBC BTP-R880NP II (Epson-compatible).
 * The browser sends these over WebUSB; the server only builds the payload.
 */

function encodeHebrewOrAscii(text) {
  // ESC/POS Hebrew code pages vary by firmware. Prefer UTF-8 where supported,
  // and fall back to ASCII-safe transliteration of digits/currency for totals.
  const s = String(text || '');
  try {
    return Buffer.from(s, 'utf8');
  } catch {
    return Buffer.from(s.replace(/[^\x20-\x7E\n]/g, '?'), 'ascii');
  }
}

function line(text = '') {
  return Buffer.concat([encodeHebrewOrAscii(text), Buffer.from([0x0a])]);
}

/** Open cash drawer via DK port (ESC p m t1 t2). */
export function drawerKickCommand({ pin = 0, onMs = 50, offMs = 50 } = {}) {
  const t1 = Math.max(0, Math.min(255, Math.round(onMs / 2)));
  const t2 = Math.max(0, Math.min(255, Math.round(offMs / 2)));
  return Buffer.from([0x1b, 0x70, pin & 0xff, t1, t2]);
}

/**
 * @returns {{ base64: string, byteLength: number }}
 */
export function buildSaleReceipt({
  businessName = 'קיר בועז',
  sale,
  changeGiven = 0,
  openDrawer = true,
} = {}) {
  const chunks = [];
  chunks.push(Buffer.from([0x1b, 0x40])); // init
  chunks.push(Buffer.from([0x1b, 0x61, 0x01])); // center
  chunks.push(Buffer.from([0x1d, 0x21, 0x11])); // double size
  chunks.push(line(businessName));
  chunks.push(Buffer.from([0x1d, 0x21, 0x00]));
  chunks.push(Buffer.from([0x1b, 0x61, 0x00])); // left
  chunks.push(line('-------------------------------'));
  chunks.push(line(`מסמך: ${sale?.icount_doc_number || sale?.id || ''}`));
  chunks.push(line(`לקוח: ${sale?.customer_name || ''}`));
  chunks.push(line(new Date(sale?.created_at || Date.now()).toLocaleString('he-IL')));
  chunks.push(line('-------------------------------'));
  for (const item of sale?.items || []) {
    const name = item.name || item.description || 'פריט';
    const qty = Number(item.quantity) || 1;
    const price = Number(item.unitprice ?? item.price) || 0;
    chunks.push(line(`${name}`));
    chunks.push(line(`  ${qty} x ${price.toFixed(2)} = ${(qty * price).toFixed(2)}`));
  }
  chunks.push(line('-------------------------------'));
  chunks.push(Buffer.from([0x1d, 0x21, 0x01]));
  chunks.push(line(`סהכ: ${Number(sale?.total || 0).toFixed(2)} שח`));
  chunks.push(Buffer.from([0x1d, 0x21, 0x00]));
  if (sale?.payment_method === 'cash') {
    const tendered = Number(sale?.tendered_amount);
    if (Number.isFinite(tendered)) chunks.push(line(`התקבל: ${tendered.toFixed(2)} שח`));
    if (Number(changeGiven) > 0) chunks.push(line(`עודף: ${Number(changeGiven).toFixed(2)} שח`));
  }
  chunks.push(line(''));
  chunks.push(Buffer.from([0x1b, 0x61, 0x01]));
  chunks.push(line('תודה!'));
  chunks.push(Buffer.from([0x1b, 0x61, 0x00]));
  chunks.push(Buffer.from([0x1d, 0x56, 0x41, 0x10])); // partial cut
  if (openDrawer) chunks.push(drawerKickCommand());

  const buf = Buffer.concat(chunks);
  return { base64: buf.toString('base64'), byteLength: buf.length };
}

export function buildDrawerOnlyPayload() {
  const buf = Buffer.concat([Buffer.from([0x1b, 0x40]), drawerKickCommand()]);
  return { base64: buf.toString('base64'), byteLength: buf.length };
}
