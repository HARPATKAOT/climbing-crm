export const DEFAULT_INBOUND_QUIET_MS = 7_000;
export const MIN_INBOUND_QUIET_MS = 7_000;
export const GREETING_INBOUND_QUIET_MS = 12_000;

const STANDALONE_GREETING_RE = /^(?:הי+|היי+|שלום|אהלן|הלו|בוקר\s+טוב|צהריים\s+טובים|ערב\s+טוב|מה\s+נשמע)[\s!?,.…👋🙏🙂😊]*$/iu;

export function normalizeInboundQuietMs(value, fallback = DEFAULT_INBOUND_QUIET_MS) {
  const parsed = Number(value);
  const safeFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : DEFAULT_INBOUND_QUIET_MS;
  if (!Number.isFinite(parsed)) {
    return Math.max(MIN_INBOUND_QUIET_MS, Math.min(30_000, safeFallback));
  }
  return Math.max(MIN_INBOUND_QUIET_MS, Math.min(30_000, Math.trunc(parsed)));
}

/**
 * A bare greeting is usually the first bubble, not the customer's whole turn.
 * Give it a little longer while keeping normal questions at the configured
 * seven-second minimum. This is a conversational rule, not a customer-specific
 * exception.
 */
export function inboundQuietMsForText(text, configuredMs = DEFAULT_INBOUND_QUIET_MS) {
  const base = normalizeInboundQuietMs(configuredMs);
  return STANDALONE_GREETING_RE.test(String(text || '').trim())
    ? Math.max(base, GREETING_INBOUND_QUIET_MS)
    : base;
}

function normalizeItem(item = {}) {
  return {
    ...item,
    text: String(item.text || '').trim(),
  };
}

export function combineInboundTexts(items = []) {
  return items
    .map((item) => String(item?.text || '').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Give the model one explicit turn instead of making several short WhatsApp
 * bubbles look like several unrelated questions.
 */
export function markInboundBurstForModel(text, count = 1) {
  const clean = String(text || '').trim();
  if (Number(count) <= 1) return clean;
  return [
    '[רצף הודעות מהלקוח — התייחס לכולן כפנייה אחת והשב פעם אחת, בקצרה ובצורה מסודרת]',
    clean,
  ].join('\n');
}

export function burstTextForModel(items = []) {
  return markInboundBurstForModel(combineInboundTexts(items), items.length);
}

/**
 * Per-contact debounce for inbound WhatsApp bubbles.
 *
 * Every new bubble resets the quiet timer. When it expires, only the newest
 * webhook handler becomes the leader; all older handlers return without
 * replying. The generation check also lets the leader stand down if another
 * bubble arrived while the model was still composing its answer.
 */
export class InboundBurstCoordinator {
  constructor({ setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.pending = new Map();
    this.generations = new Map();
  }

  push(key, item, { quietMs = DEFAULT_INBOUND_QUIET_MS } = {}) {
    const contactKey = String(key || '').trim();
    const normalized = normalizeItem(item);
    if (!contactKey) {
      return Promise.resolve({
        leader: true,
        superseded: false,
        generation: 0,
        items: [normalized],
        text: normalized.text,
        modelText: normalized.text,
      });
    }

    const generation = (this.generations.get(contactKey) || 0) + 1;
    this.generations.set(contactKey, generation);

    let entry = this.pending.get(contactKey);
    if (!entry) {
      entry = { items: [], waiters: [], timer: null, generation };
      this.pending.set(contactKey, entry);
    } else if (entry.timer) {
      this.clearTimer(entry.timer);
    }

    entry.items.push(normalized);
    entry.generation = generation;

    const result = new Promise((resolve) => {
      entry.waiters.push({ generation, resolve });
    });

    entry.timer = this.setTimer(
      () => this.flush(contactKey),
      normalizeInboundQuietMs(quietMs)
    );
    if (typeof entry.timer?.unref === 'function') entry.timer.unref();
    return result;
  }

  flush(key) {
    const contactKey = String(key || '').trim();
    const entry = this.pending.get(contactKey);
    if (!entry) return false;
    this.pending.delete(contactKey);

    const items = entry.items.slice();
    const text = combineInboundTexts(items);
    const modelText = burstTextForModel(items);
    for (const waiter of entry.waiters) {
      const leader = waiter.generation === entry.generation;
      waiter.resolve({
        leader,
        superseded: !leader,
        generation: entry.generation,
        items: leader ? items : [],
        text: leader ? text : '',
        modelText: leader ? modelText : '',
      });
    }
    return true;
  }

  isCurrent(key, generation) {
    const contactKey = String(key || '').trim();
    return (this.generations.get(contactKey) || 0) === Number(generation || 0);
  }

  clear() {
    for (const entry of this.pending.values()) {
      if (entry.timer) this.clearTimer(entry.timer);
      for (const waiter of entry.waiters) {
        waiter.resolve({
          leader: false,
          superseded: true,
          generation: entry.generation,
          items: [],
          text: '',
          modelText: '',
        });
      }
    }
    this.pending.clear();
    this.generations.clear();
  }
}
