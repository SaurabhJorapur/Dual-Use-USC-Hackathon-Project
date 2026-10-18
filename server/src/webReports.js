// Low-network web reports: text reports from the offline-first form at /report/
// (client/src/pages/ReportPage.jsx). Each becomes an ordinary row in `calls`, so the
// dashboard, map and incident clustering treat it like a phone call, triaged by the same
// rules. A web report is identified by caller_phone = WEB_REPORT_PHONE and a
// `web_report_<uuid>` retell_call_id. That id doubles as the idempotency key: the browser
// generates the UUID once and reuses it for every retry, and retell_call_id is UNIQUE.
import { CATEGORIES, statusForUrgency, triageCall } from './triage.js';
import { buildFormalReport, incidentId } from './report.js';
import { timelineEvent } from './timeline.js';

export const WEB_REPORT_PHONE = 'low network report';
export const WEB_REPORT_PREFIX = 'web_report_';
export const MIN_TEXT = 5;
export const MAX_TEXT = 4000;
export const MAX_LOCATION = 255;
// Reports can sit in a phone's queue for a while; trust the device clock within these bounds.
const MAX_FUTURE_MS = 5 * 60_000;
const MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export const isWebReport = (row) => row?.caller_phone === WEB_REPORT_PHONE || Boolean(row?.retell_call_id?.startsWith(WEB_REPORT_PREFIX));
export const webReportKey = (id) => `${WEB_REPORT_PREFIX}${id.toLowerCase()}`;

const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });
const clean = (s) => s.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '').replace(/\n{3,}/g, '\n\n').trim();
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Validates and normalizes a submission. Throws a 400 error on bad input. */
export function parseWebReport(body, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Report must be a JSON object');
  const { id, text, category, location, latitude, longitude, submitted_at: submittedAt } = body;

  if (typeof id !== 'string' || !UUID.test(id)) throw badRequest('id must be a UUID');
  if (typeof text !== 'string') throw badRequest('text is required');
  const cleanText = clean(text);
  if (cleanText.length < MIN_TEXT) throw badRequest(`Describe what is happening (at least ${MIN_TEXT} characters)`);
  if (cleanText.length > MAX_TEXT) throw badRequest(`Report must be at most ${MAX_TEXT} characters`);

  // "Not sure" is sent as null: the triage below picks the category.
  let cleanCategory = null;
  if (category != null && category !== '') {
    cleanCategory = CATEGORIES.find((c) => c === category);
    if (!cleanCategory) throw badRequest('Unknown category');
  }

  let cleanLocation = null;
  if (location != null && location !== '') {
    if (typeof location !== 'string') throw badRequest('location must be text');
    cleanLocation = clean(location).replace(/\s+/g, ' ') || null;
    if (cleanLocation && cleanLocation.length > MAX_LOCATION) throw badRequest(`location must be at most ${MAX_LOCATION} characters`);
  }

  if ((latitude == null) !== (longitude == null)) throw badRequest('latitude and longitude must be sent together');
  const hasPoint = latitude != null;
  if (hasPoint && (!isNum(latitude) || !isNum(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180)) {
    throw badRequest('latitude/longitude are out of range');
  }

  const at = typeof submittedAt === 'string' ? Date.parse(submittedAt) : NaN;
  const clockOk = Number.isFinite(at) && at <= now + MAX_FUTURE_MS && at >= now - MAX_AGE_MS;

  return {
    id: id.toLowerCase(),
    text: cleanText,
    category: cleanCategory,
    location: cleanLocation,
    latitude: hasPoint ? Number(latitude.toFixed(6)) : null,
    longitude: hasPoint ? Number(longitude.toFixed(6)) : null,
    submittedAt: new Date(clockOk ? at : now).toISOString(),
    receivedAt: new Date(now).toISOString(),
    clockAdjusted: submittedAt != null && !clockOk,
  };
}

/** The report text as a one-line summary, cut at a word boundary. Nothing is added to it. */
export function summarize(text, max = 280) {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}

/**
 * Same triage as a phone call. The submitter's category stands in for the LLM's choice,
 * so the keyword safety net can still raise the report to Critical but never lower it.
 */
export function triageWebReport(report) {
  return triageCall({
    transcript: report.text,
    call_analysis: { custom_analysis_data: { category: report.category, summary: summarize(report.text), location: report.location } },
  });
}

function delayText(ms) {
  const min = Math.round(ms / 60_000);
  if (min < 2) return null;
  return min < 120 ? `${min} min` : `${Math.round(min / 60)} h`;
}

/** The `calls` row for a validated report, with triage applied so urgent reports surface at once. */
export function buildWebReportRow(report) {
  const triage = triageWebReport(report);
  const delay = delayText(Date.parse(report.receivedAt) - Date.parse(report.submittedAt));
  const received = [
    'Submitted through the low-network web report form',
    `submitter chose "${report.category || 'Not sure'}"`,
    delay && `written ${delay} before it reached the server`,
    report.clockAdjusted && 'device clock looked wrong, so the server time is used',
  ].filter(Boolean);
  const needsHuman = triage.urgency_level !== 'Standard';
  const row = {
    retell_call_id: webReportKey(report.id),
    caller_phone: WEB_REPORT_PHONE,
    category: triage.category,
    urgency_level: triage.urgency_level,
    status: statusForUrgency(triage.urgency_level),
    summary: triage.summary,
    location: triage.location,
    // The original report, verbatim. Shown on the dashboard as "Original report".
    transcript: report.text,
    // When the person wrote it (the incident time), not when the queue delivered it.
    created_at: report.submittedAt,
    escalation_timeline: [
      { ...timelineEvent('Web report received', received.join('; ')), at: report.receivedAt },
      timelineEvent(
        'Automated triage complete',
        `${triage.category} · ${triage.urgency_level}${needsHuman ? ' · needs dispatcher review: no automatic 911 transfer is made for web reports' : ''}`,
      ),
    ],
  };
  if (report.latitude != null) Object.assign(row, { latitude: report.latitude, longitude: report.longitude });
  return row;
}

/** The formal incident report, built like a phone call's, adjusted for a written report. */
export function buildWebFormalReport(row) {
  const base = buildFormalReport({ row });
  return {
    ...base,
    channel: 'web_report',
    extracted_entities: { ...base.extracted_entities, involved_parties: 'Not provided (anonymous web report)' },
    key_facts: [
      ...base.key_facts.filter((f) => !/^call disposition:/i.test(f)),
      'Submitted through the low-network web report form; no automated 911 transfer was made.',
    ],
    original_report: row.transcript,
  };
}

export function ackFor(row, reportId, created) {
  return {
    received: true,
    report_id: reportId,
    incident_id: incidentId(row.incident_number, row.created_at),
    duplicate: !created,
    processing: row.formal_report ? 'complete' : 'pending',
  };
}

/**
 * @param {object} deps
 * @param {(row: object) => Promise<{row: object, created: boolean}>} deps.insertIfAbsent
 *   Inserts unless a row with the same retell_call_id exists; returns the stored row.
 * @param {(row: object) => void} deps.queueProcessing Background geocoding, report and clustering.
 */
export function createWebReportService({ insertIfAbsent, queueProcessing }) {
  return async function submit(body, now = Date.now()) {
    const report = parseWebReport(body, now);
    const { row, created } = await insertIfAbsent(buildWebReportRow(report));
    // A retry of a report whose processing never finished (e.g. server restart) resumes it.
    if (created || !row.formal_report) queueProcessing(row);
    return { created, ack: ackFor(row, report.id, created) };
  };
}
