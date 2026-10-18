import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMERGENCY, HAZARDS } from './triage.js';
import {
  MAX_TEXT, WEB_REPORT_PHONE, buildWebFormalReport, buildWebReportRow, createWebReportService, isWebReport, parseWebReport, summarize, triageWebReport,
} from './webReports.js';
import { rateLimit } from './rateLimit.js';

const NOW = new Date('2026-10-17T12:00:00Z').getTime();
const ID = '3f2b8c1e-9a4d-4e6f-b1c2-7d8e9f0a1b2c';
const body = (extra = {}) => ({ id: ID, text: 'There is a pothole on Main Street', submitted_at: new Date(NOW - 60_000).toISOString(), ...extra });

/** In-memory stand-in for the calls table, keyed like the real UNIQUE retell_call_id. */
function fakeDb() {
  const rows = new Map();
  let seq = 0;
  const processed = [];
  return {
    rows,
    processed,
    insertIfAbsent: async (row) => {
      if (rows.has(row.retell_call_id)) return { row: rows.get(row.retell_call_id), created: false };
      const stored = { id: `row-${++seq}`, incident_number: seq, formal_report: null, ...row };
      rows.set(row.retell_call_id, stored);
      return { row: stored, created: true };
    },
    queueProcessing: (row) => processed.push(row.retell_call_id),
  };
}

test('valid report is accepted, normalized and stored with the web report sentinel', async () => {
  const db = fakeDb();
  const submit = createWebReportService(db);
  const { created, ack } = await submit(body({ text: '  Pothole\r\n\r\n\r\n\r\non Main  ', location: ' Main St  &  5th ', latitude: 34.0123456789, longitude: -118.3 }), NOW);
  assert.equal(created, true);
  assert.deepEqual({ received: ack.received, report_id: ack.report_id, duplicate: ack.duplicate, processing: ack.processing }, {
    received: true, report_id: ID, duplicate: false, processing: 'pending',
  });
  assert.match(ack.incident_id, /^INC-2026-\d{4}$/);
  const row = [...db.rows.values()][0];
  assert.equal(row.caller_phone, 'low network report');
  assert.equal(row.caller_phone, WEB_REPORT_PHONE);
  assert.equal(row.retell_call_id, `web_report_${ID}`);
  assert.equal(row.transcript, 'Pothole\n\non Main', 'original text preserved (trimmed, blank lines collapsed)');
  assert.equal(row.location, 'Main St & 5th');
  assert.equal(row.latitude, 34.012346);
  assert.equal(row.created_at, new Date(NOW - 60_000).toISOString(), 'incident time is when it was written');
  assert.deepEqual(db.processed, [row.retell_call_id], 'AI processing queued after the row is stored');
  assert.ok(isWebReport(row));
});

test('retrying the same id (lost acknowledgement) does not create a duplicate', async () => {
  const db = fakeDb();
  const submit = createWebReportService(db);
  const first = await submit(body(), NOW);
  const second = await submit(body(), NOW + 30_000);
  assert.equal(db.rows.size, 1);
  assert.equal(second.created, false);
  assert.equal(second.ack.duplicate, true);
  assert.equal(second.ack.incident_id, first.ack.incident_id);
  // Processing hadn't finished (no formal report yet), so the retry re-queues it.
  assert.equal(db.processed.length, 2);
  [...db.rows.values()][0].formal_report = { done: true };
  await submit(body(), NOW + 60_000);
  assert.equal(db.processed.length, 2, 'finished reports are not reprocessed');
  // Uppercase UUIDs map to the same key.
  await submit(body({ id: ID.toUpperCase() }), NOW);
  assert.equal(db.rows.size, 1);
});

test('invalid or oversized payloads are rejected with 400', () => {
  const cases = {
    'not an object': null,
    array: [],
    'missing id': body({ id: undefined }),
    'bad id': body({ id: 'abc' }),
    'missing text': body({ text: undefined }),
    'text not a string': body({ text: 42 }),
    'too short': body({ text: ' hi ' }),
    'too long': body({ text: 'x'.repeat(MAX_TEXT + 1) }),
    'unknown category': body({ category: 'Potholes' }),
    'location too long': body({ location: 'y'.repeat(256) }),
    'location not text': body({ location: { street: 'Main' } }),
    'half a coordinate': body({ latitude: 34 }),
    'coordinate out of range': body({ latitude: 95, longitude: -118 }),
    'coordinate not a number': body({ latitude: '34', longitude: '-118' }),
  };
  for (const [name, input] of Object.entries(cases)) {
    assert.throws(() => parseWebReport(input, NOW), (err) => err.statusCode === 400, name);
  }
});

test('control characters are stripped and an untrustworthy device clock falls back to server time', () => {
  const r = parseWebReport(body({ text: 'Water\u0000 main\u0007 burst', submitted_at: '2099-01-01T00:00:00Z' }), NOW);
  assert.equal(r.text, 'Water main burst');
  assert.equal(r.submittedAt, new Date(NOW).toISOString());
  assert.equal(r.clockAdjusted, true);
  assert.equal(parseWebReport(body({ submitted_at: 'garbage' }), NOW).submittedAt, new Date(NOW).toISOString());
  assert.equal(parseWebReport(body({ category: '' }), NOW).category, null, '"Not sure" sends no category');
});

test('triage uses the existing categories and urgency rules', () => {
  const t = (text, category = null) => triageWebReport(parseWebReport(body({ text, category }), NOW));
  assert.deepEqual(t('There is a pothole on Main Street'), { ...t('There is a pothole on Main Street'), category: 'Roads & Infrastructure', urgency_level: 'Standard', status: 'AI Completed' });
  assert.equal(t('I smell gas, there is a gas leak').category, HAZARDS);
  assert.equal(t('I smell gas, there is a gas leak').urgency_level, 'Urgent');
  // The submitter's category is used when the keywords don't force something more severe.
  assert.equal(t('Something is wrong with the thing outside', 'Utilities & Water').category, 'Utilities & Water');
});

test('critical safety indicators cannot be downgraded by the submitted category', () => {
  for (const text of ['Someone has a gun outside the store', 'The building is on fire', 'Bad car crash, a man is bleeding']) {
    const r = triageWebReport(parseWebReport(body({ text, category: 'Code Enforcement & Sanitation' }), NOW));
    assert.equal(r.urgency_level, 'Critical', text);
    assert.equal(r.category, EMERGENCY, text);
    assert.equal(r.status, 'Escalated to 911', text);
  }
});

test('row timeline says no automatic 911 transfer was made and keeps unknowns unknown', () => {
  const row = buildWebReportRow(parseWebReport(body({ text: 'Someone was stabbed on the corner', submitted_at: new Date(NOW - 45 * 60_000).toISOString() }), NOW));
  assert.equal(row.caller_name, undefined, 'no invented caller');
  assert.equal(row.location, null, 'no invented location');
  assert.equal(row.latitude, undefined, 'no invented coordinates');
  const [received, triage] = row.escalation_timeline;
  assert.match(received.detail, /written 45 min before it reached the server/);
  assert.match(triage.detail, /no automatic 911 transfer/);
  assert.ok(!row.escalation_timeline.some((e) => e.escalated_to), 'not recorded as an actual escalation');
});

test('formal report preserves the original text and marks the web channel', () => {
  const row = { ...buildWebReportRow(parseWebReport(body({ text: 'Water main burst. Street is flooding.' }), NOW)), incident_number: 7 };
  const report = buildWebFormalReport(row);
  assert.equal(report.channel, 'web_report');
  assert.equal(report.original_report, 'Water main burst. Street is flooding.');
  assert.equal(report.extracted_entities.location, 'Not provided');
  assert.match(report.extracted_entities.involved_parties, /anonymous web report/);
  assert.ok(!report.key_facts.some((f) => /^call disposition/i.test(f)));
  assert.ok(report.key_facts.some((f) => /no automated 911 transfer/.test(f)));
  assert.equal(report.source, 'derived');
});

test('summarize cuts long text at a word boundary without adding words', () => {
  assert.equal(summarize('short text'), 'short text');
  const s = summarize('word '.repeat(100));
  assert.ok(s.length <= 280 && s.endsWith('word…'));
});

test('rateLimit allows a burst then answers 429 with Retry-After', () => {
  let t = 0;
  const limit = rateLimit({ windowMs: 1000, max: 2, now: () => t });
  const run = () => {
    const res = { headers: {}, code: 200, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, json() { return this; } };
    let passed = false;
    limit({ ip: '1.2.3.4' }, res, () => { passed = true; });
    return { passed, res };
  };
  assert.equal(run().passed, true);
  assert.equal(run().passed, true);
  const blocked = run();
  assert.equal(blocked.passed, false);
  assert.equal(blocked.res.code, 429);
  assert.equal(blocked.res.headers['Retry-After'], '1');
  t = 1001;
  assert.equal(run().passed, true, 'window slides');
});
