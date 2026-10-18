// Offline-first outbox for the crisis report form. A report is written to a persistent
// store (IndexedDB in the browser, see idbStore.js) before any network attempt, retried
// with exponential backoff, and removed only once the server acknowledges that it stored
// that exact report id. The id is generated once and reused on every retry, so the server
// can drop duplicates when a request succeeded but its acknowledgement was lost.
// Framework-free so it runs under node --test.

export const MIN_TEXT = 5;
export const MAX_TEXT = 4000;
export const MAX_LOCATION = 255;
export const BASE_DELAY_MS = 5_000;
export const MAX_DELAY_MS = 5 * 60_000;
export const SEND_TIMEOUT_MS = 20_000;
// Only these mean "this payload will never be accepted"; anything else is worth retrying.
const PERMANENT_STATUSES = new Set([400, 413, 422]);

/** Field errors for the form, or null when the report can be queued. */
export function validateReport({ text = '', location = '' } = {}) {
  const errors = {};
  const t = text.trim();
  if (!t) errors.text = 'Describe what is happening.';
  else if (t.length < MIN_TEXT) errors.text = `Add a little more detail (at least ${MIN_TEXT} characters).`;
  else if (t.length > MAX_TEXT) errors.text = `Shorten the report to ${MAX_TEXT} characters or fewer.`;
  if (location.trim().length > MAX_LOCATION) errors.location = `Shorten the location to ${MAX_LOCATION} characters or fewer.`;
  return Object.keys(errors).length ? errors : null;
}

/** A queue item. `payload` is exactly what is POSTed, every time. */
export function newReport({ text, category, location, coords }, { now = Date.now(), uuid = () => crypto.randomUUID() } = {}) {
  const id = uuid();
  const payload = { id, text: text.trim(), submitted_at: new Date(now).toISOString() };
  if (category) payload.category = category;
  if (location?.trim()) payload.location = location.trim();
  if (coords) Object.assign(payload, { latitude: coords.latitude, longitude: coords.longitude });
  return { id, payload, state: 'queued', attempts: 0, next_attempt_at: 0, created_at: now, last_error: null };
}

/** Delay before the next attempt after `attempts` failures: 5 s, 10 s, 20 s … capped at 5 min, ±20% jitter. */
export function backoffDelay(attempts, random = Math.random) {
  const base = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1));
  return Math.min(MAX_DELAY_MS, Math.round(base * (0.8 + random() * 0.4)));
}

export class DeliveryError extends Error {
  constructor(message, { retryable = true, retryAfterMs } = {}) {
    super(message);
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * POSTs one report. Resolves with the acknowledgement only if the server confirms this id;
 * a 200 with anything else (e.g. a captive-portal login page) is not a delivery.
 */
export async function sendReport(payload, { baseUrl = '', fetchImpl = globalThis.fetch, timeoutMs = SEND_TIMEOUT_MS } = {}) {
  let res;
  try {
    res = await fetchImpl(`${baseUrl}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new DeliveryError(err?.name === 'TimeoutError' ? 'The server took too long to answer' : 'No connection to the server');
  }
  const body = await res.json().catch(() => null);
  if (res.ok) {
    if (body?.received === true && body.report_id === payload.id) return body;
    throw new DeliveryError('The server response could not be confirmed');
  }
  const retryAfter = Number(res.headers?.get?.('Retry-After'));
  throw new DeliveryError(body?.error || `Server error (${res.status})`, {
    retryable: !PERMANENT_STATUSES.has(res.status),
    retryAfterMs: retryAfter > 0 ? retryAfter * 1000 : undefined,
  });
}

/**
 * @param {object} opts
 * @param {{put, getAll, delete}} opts.store Persistent store of queue items (promise-based).
 * @param {(payload) => Promise<object>} opts.send Resolves with the server's acknowledgement.
 * @param {(event: {type, id, ack?, error?, item?}) => void} [opts.onEvent]
 *   type is 'saved' | 'sending' | 'received' | 'failed' | 'rejected'.
 */
export function createReportQueue({ store, send, onEvent = () => {}, now = Date.now, random = Math.random, uuid }) {
  const emit = (event) => {
    try {
      onEvent(event);
    } catch (err) {
      console.error('[reports] listener failed', err);
    }
  };

  async function list() {
    const items = await store.getAll();
    return items.sort((a, b) => a.created_at - b.created_at);
  }

  /** Persists a new report. Throws if it could not be saved; nothing is sent in that case. */
  async function add(fields) {
    const item = newReport(fields, { now: now(), ...(uuid ? { uuid } : {}) });
    await store.put(item);
    emit({ type: 'saved', id: item.id, item });
    return item;
  }

  /** @returns {Promise<boolean>} false when delivery failed in a way worth retrying later. */
  async function deliver(item) {
    emit({ type: 'sending', id: item.id });
    let ack;
    try {
      ack = await send(item.payload);
    } catch (err) {
      if (err?.retryable === false) {
        // Kept, never dropped silently: the page shows it and the person decides.
        await store.put({ ...item, state: 'rejected', last_error: err.message });
        emit({ type: 'rejected', id: item.id, error: err.message });
        return true;
      }
      const attempts = item.attempts + 1;
      const delay = Math.max(backoffDelay(attempts, random), err?.retryAfterMs || 0);
      await store.put({ ...item, attempts, next_attempt_at: now() + delay, last_error: err?.message || 'Delivery failed' });
      emit({ type: 'failed', id: item.id, error: err?.message });
      return false;
    }
    try {
      await store.delete(item.id);
    } catch (err) {
      // The server has it. If the local copy lingers, the next retry is acknowledged as a duplicate.
      console.error('[reports] could not remove delivered report', err);
    }
    emit({ type: 'received', id: item.id, ack });
    return true;
  }

  async function pass(force) {
    for (const item of await list()) {
      if (item.state === 'rejected' || (!force && item.next_attempt_at > now())) continue;
      // Stop at the first failure: the connection is probably down, don't burn through the rest.
      if (!(await deliver(item))) return;
    }
  }

  // Single flight: concurrent calls share one run, and a call made mid-run triggers one more
  // pass afterwards so reports added meanwhile aren't left waiting. No item is ever sent twice at once.
  let running = null;
  let again = false;
  let againForce = false;
  function flush({ force = false } = {}) {
    if (running) {
      again = true;
      againForce ||= force;
      return running;
    }
    running = (async () => {
      let f = force;
      do {
        again = false;
        await pass(f);
        f = againForce;
        againForce = false;
      } while (again);
    })().finally(() => {
      running = null;
    });
    return running;
  }

  /** Deletes a report the person chose to discard (only offered for rejected reports). */
  async function remove(id) {
    await store.delete(id);
  }

  return { add, flush, list, remove, now };
}

/**
 * Best-effort retries while the page is open: on start, when the browser reports it is back
 * online, when the page becomes visible again, and on a timer for the next due report.
 * navigator.onLine === false reliably means no network, but true proves nothing, so only
 * the server's acknowledgement counts as delivery.
 */
export function startAutoFlush(queue, {
  win = globalThis,
  doc = globalThis.document,
  isOnline = () => win.navigator?.onLine !== false,
  lock = (fn) => fn(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  idleRecheckMs = 30_000,
} = {}) {
  let timer = null;
  let stopped = false;
  let last = Promise.resolve();

  async function schedule() {
    if (stopped) return;
    let items = [];
    try {
      items = (await queue.list()).filter((i) => i.state !== 'rejected');
    } catch {
      // Store unreadable right now; try again later.
    }
    if (!items.length || stopped) return;
    const due = Math.min(...items.map((i) => i.next_attempt_at));
    const wait = isOnline() ? Math.max(1000, due - queue.now()) : idleRecheckMs;
    clearTimer(timer);
    timer = setTimer(() => run(false), wait);
  }

  function run(force = true) {
    clearTimer(timer);
    last = (async () => {
      try {
        if (isOnline()) await lock(() => queue.flush({ force }));
      } catch (err) {
        console.error('[reports] flush failed', err);
      }
      await schedule();
    })();
    return last;
  }

  const onOnline = () => run(true);
  const onVisible = () => doc?.visibilityState === 'visible' && run(true);
  win.addEventListener?.('online', onOnline);
  doc?.addEventListener?.('visibilitychange', onVisible);
  run(true);

  return {
    run,
    settled: () => last,
    stop() {
      stopped = true;
      clearTimer(timer);
      win.removeEventListener?.('online', onOnline);
      doc?.removeEventListener?.('visibilitychange', onVisible);
    },
  };
}

/** One position for the report, only when the person asks. Rounded to ~1 m. */
export function getPosition(geo = globalThis.navigator?.geolocation, { timeoutMs = 15_000 } = {}) {
  const messages = {
    1: 'Location permission was denied. You can type a location instead.',
    2: 'Your location could not be found. You can type a location instead.',
    3: 'Finding your location took too long. You can type a location instead.',
  };
  return new Promise((resolve, reject) => {
    if (!geo?.getCurrentPosition) {
      reject(new Error('Location is not available on this device. You can type a location instead.'));
      return;
    }
    geo.getCurrentPosition(
      ({ coords }) =>
        resolve({
          latitude: Number(coords.latitude.toFixed(5)),
          longitude: Number(coords.longitude.toFixed(5)),
          accuracy: Math.round(coords.accuracy),
        }),
      (err) => reject(new Error(messages[err?.code] || messages[2])),
      // GPS works without a data connection; network-based location doesn't.
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 5 * 60_000 },
    );
  });
}
