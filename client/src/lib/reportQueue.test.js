import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DeliveryError, MAX_DELAY_MS, backoffDelay, createReportQueue, getPosition, newReport, sendReport, startAutoFlush, validateReport,
} from './reportQueue.js';

/** Map-backed store that records the order of operations; can be told to fail. */
function memoryStore(log = []) {
  const items = new Map();
  return {
    items,
    log,
    failPut: false,
    async put(item) {
      if (this.failPut) throw new Error('QuotaExceededError');
      log.push(`put:${item.id}`);
      items.set(item.id, structuredClone(item));
    },
    async getAll() {
      return [...items.values()].map((i) => structuredClone(i));
    },
    async delete(id) {
      log.push(`delete:${id}`);
      items.delete(id);
    },
  };
}

/** Stand-in for the server: stores by id (idempotent), can drop the network or the acknowledgement. */
function fakeServer(log = []) {
  const stored = new Map();
  const server = {
    stored,
    mode: 'ok', // 'ok' | 'offline' | 'lose-ack' | 'reject'
    calls: 0,
    inFlight: 0,
    maxInFlight: 0,
    async send(payload) {
      server.calls++;
      server.inFlight++;
      server.maxInFlight = Math.max(server.maxInFlight, server.inFlight);
      log.push(`send:${payload.id}`);
      await new Promise((r) => setImmediate(r));
      server.inFlight--;
      if (server.mode === 'offline') throw new DeliveryError('No connection to the server');
      if (server.mode === 'reject') throw new DeliveryError('Bad report', { retryable: false });
      const duplicate = stored.has(payload.id);
      if (!duplicate) stored.set(payload.id, payload);
      if (server.mode === 'lose-ack') throw new DeliveryError('The server took too long to answer');
      return { received: true, report_id: payload.id, duplicate };
    },
  };
  return server;
}

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

function setup({ now = () => 1_000_000 } = {}) {
  const log = [];
  const store = memoryStore(log);
  const server = fakeServer(log);
  const events = [];
  const queue = createReportQueue({ store, send: server.send, onEvent: (e) => events.push(e), now, random: () => 0.5, uuid });
  return { log, store, server, events, queue };
}

test('a report is saved locally before any network attempt', async () => {
  const { log, queue } = setup();
  const item = await queue.add({ text: 'Tree down across Main St' });
  assert.deepEqual(log, [`put:${item.id}`], 'add() only persists');
  await queue.flush();
  assert.deepEqual(log, [`put:${item.id}`, `send:${item.id}`, `delete:${item.id}`]);
});

test('offline submission stays queued and reports the saved state', async () => {
  const { server, events, queue, store } = setup();
  server.mode = 'offline';
  const item = await queue.add({ text: 'Water is flooding the street' });
  assert.deepEqual(events.map((e) => e.type), ['saved']);
  await queue.flush();
  assert.deepEqual(events.map((e) => e.type), ['saved', 'sending', 'failed']);
  const [kept] = await store.getAll();
  assert.equal(kept.id, item.id);
  assert.equal(kept.attempts, 1);
  assert.equal(kept.next_attempt_at, 1_000_000 + 5_000);
  assert.equal(kept.payload.id, item.id, 'same id kept for retries');
});

test('successful acknowledgement removes the queued item', async () => {
  const { server, events, queue, store } = setup();
  await queue.add({ text: 'Streetlight out on 5th' });
  await queue.flush();
  assert.equal(store.items.size, 0);
  assert.equal(server.stored.size, 1);
  assert.equal(events.at(-1).type, 'received');
});

test('a lost acknowledgement followed by a retry does not duplicate the report', async () => {
  const { server, queue, store } = setup();
  await queue.add({ text: 'Gas smell near the school' });
  server.mode = 'lose-ack';
  await queue.flush();
  assert.equal(server.stored.size, 1, 'server stored it');
  assert.equal(store.items.size, 1, 'but the client could not confirm, so it keeps it');
  server.mode = 'ok';
  await queue.flush({ force: true });
  assert.equal(server.stored.size, 1, 'retry reused the id: still one report');
  assert.equal(store.items.size, 0);
});

test('backoff: retries wait unless forced, and grow to a capped maximum', async () => {
  let t = 1_000_000;
  const { server, queue } = setup({ now: () => t });
  server.mode = 'offline';
  await queue.add({ text: 'Signal out at Vermont' });
  await queue.flush();
  await queue.flush();
  assert.equal(server.calls, 1, 'not due yet');
  t += 5_000;
  await queue.flush();
  assert.equal(server.calls, 2);
  await queue.flush({ force: true });
  assert.equal(server.calls, 3);
  assert.equal(backoffDelay(1, () => 0.5), 5_000);
  assert.equal(backoffDelay(3, () => 0.5), 20_000);
  assert.equal(backoffDelay(50, () => 1), MAX_DELAY_MS);
});

test('multiple items are sent one at a time, each exactly once, even with overlapping flushes', async () => {
  const { server, queue, store } = setup();
  for (let i = 0; i < 4; i++) await queue.add({ text: `Report number ${i}` });
  await Promise.all([queue.flush(), queue.flush(), queue.flush({ force: true })]);
  assert.equal(server.maxInFlight, 1);
  assert.equal(server.calls, 4);
  assert.equal(server.stored.size, 4);
  assert.equal(store.items.size, 0);
});

test('a report added during a flush is picked up by the same run', async () => {
  const { server, queue } = setup();
  await queue.add({ text: 'First report here' });
  const running = queue.flush();
  await queue.add({ text: 'Second report here' });
  queue.flush();
  await running;
  assert.equal(server.stored.size, 2);
});

test('local storage failure throws and never claims the report was saved or sent', async () => {
  const { store, server, events, queue } = setup();
  store.failPut = true;
  await assert.rejects(queue.add({ text: 'Fire in the alley' }), /Quota/);
  assert.deepEqual(events, []);
  assert.equal(server.calls, 0);
});

test('a permanently rejected report is kept and flagged, not discarded', async () => {
  const { server, queue, store, events } = setup();
  server.mode = 'reject';
  const item = await queue.add({ text: 'Something odd here' });
  await queue.flush();
  const [kept] = await store.getAll();
  assert.equal(kept.state, 'rejected');
  assert.equal(kept.last_error, 'Bad report');
  assert.equal(events.at(-1).type, 'rejected');
  server.mode = 'ok';
  await queue.flush({ force: true });
  assert.equal(server.calls, 1, 'rejected reports are not resent automatically');
  await queue.remove(item.id);
  assert.equal(store.items.size, 0);
});

test('an online event triggers a retry', async () => {
  const { server, queue, store } = setup();
  const win = new EventTarget();
  let online = false;
  server.mode = 'offline';
  await queue.add({ text: 'Power line down on Elm' });
  const auto = startAutoFlush(queue, { win, doc: null, isOnline: () => online, setTimer: () => 0, clearTimer: () => {} });
  await auto.settled();
  assert.equal(server.calls, 0, 'navigator says offline: no attempt');
  online = true;
  server.mode = 'ok';
  win.dispatchEvent(new Event('online'));
  await auto.settled();
  assert.equal(server.calls, 1);
  assert.equal(store.items.size, 0);
  auto.stop();
});

test('returning to the page retries, and a timer is set for the next due report', async () => {
  const { server, queue } = setup();
  const doc = new EventTarget();
  doc.visibilityState = 'hidden';
  const timers = [];
  server.mode = 'offline';
  await queue.add({ text: 'Sinkhole on Figueroa' });
  const auto = startAutoFlush(queue, { win: new EventTarget(), doc, isOnline: () => true, setTimer: (_fn, ms) => timers.push(ms), clearTimer: () => {} });
  await auto.settled();
  assert.equal(server.calls, 1, 'flushes when the page opens');
  assert.equal(timers.at(-1), 5_000, 'retry scheduled for the backoff delay');
  doc.visibilityState = 'visible';
  doc.dispatchEvent(new Event('visibilitychange'));
  await auto.settled();
  assert.equal(server.calls, 2);
  auto.stop();
});

test('sendReport only accepts an acknowledgement for the same id', async () => {
  const payload = newReport({ text: 'Pothole on 3rd' }, { uuid, now: 0 }).payload;
  const respond = (status, body, headers = {}) => async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k] ?? null },
    json: async () => {
      if (body === undefined) throw new SyntaxError('Unexpected token <');
      return body;
    },
  });
  const ack = await sendReport(payload, { fetchImpl: respond(201, { received: true, report_id: payload.id }) });
  assert.equal(ack.report_id, payload.id);

  const fail = async (fetchImpl) => sendReport(payload, { fetchImpl }).then(() => null, (e) => e);
  const portal = await fail(respond(200, undefined));
  assert.equal(portal.retryable, true, 'captive portal HTML is not a delivery');
  assert.equal((await fail(respond(200, { received: true, report_id: 'other' }))).retryable, true);
  assert.equal((await fail(respond(503, { error: 'down' }))).retryable, true);
  const limited = await fail(respond(429, { error: 'slow down' }, { 'Retry-After': '30' }));
  assert.equal(limited.retryAfterMs, 30_000);
  assert.equal((await fail(respond(400, { error: 'bad' }))).retryable, false);
  assert.equal((await fail(respond(413, null))).retryable, false);
  const offline = await fail(async () => {
    throw new TypeError('Failed to fetch');
  });
  assert.equal(offline.retryable, true);
});

test('form validation', () => {
  assert.ok(validateReport({ text: '' }).text);
  assert.ok(validateReport({ text: '  hi ' }).text);
  assert.ok(validateReport({ text: 'x'.repeat(4001) }).text);
  assert.ok(validateReport({ text: 'Tree down on Main', location: 'y'.repeat(256) }).location);
  assert.equal(validateReport({ text: 'Tree down on Main' }), null, 'location is optional');
});

test('payload includes only provided optional fields', () => {
  const plain = newReport({ text: ' Tree down ', category: '', location: '  ' }, { uuid, now: 0 }).payload;
  assert.deepEqual(Object.keys(plain).sort(), ['id', 'submitted_at', 'text']);
  assert.equal(plain.text, 'Tree down');
  const full = newReport({ text: 'Tree down', category: 'Utilities & Water', location: 'Main St', coords: { latitude: 34.1, longitude: -118.2, accuracy: 10 } }, { uuid, now: 0 }).payload;
  assert.deepEqual(full, { id: full.id, text: 'Tree down', submitted_at: new Date(0).toISOString(), category: 'Utilities & Water', location: 'Main St', latitude: 34.1, longitude: -118.2 });
});

test('getPosition is optional and explains failures', async () => {
  await assert.rejects(getPosition(undefined), /not available/);
  await assert.rejects(getPosition({ getCurrentPosition: (_ok, err) => err({ code: 1 }) }), /denied/);
  const pos = await getPosition({ getCurrentPosition: (ok) => ok({ coords: { latitude: 34.0522349, longitude: -118.2436849, accuracy: 12.4 } }) });
  assert.deepEqual(pos, { latitude: 34.05223, longitude: -118.24368, accuracy: 12 });
});
