// Assembles the structured formal incident report stored in calls.formal_report.
// Retell's post-call analysis can't return objects, so it returns flat fields
// (see scripts/setup-retell.js) and this module builds the document, deriving
// anything missing from the call row so every call gets a usable report.
import { EMERGENCY, HAZARDS } from './triage.js';

export const DISPATCH_OPTIONS = [
  '911 / Police Dispatch',
  '911 / Fire & EMS',
  'Public Works',
  'Water & Power',
  'Sanitation & Code Enforcement',
  'No Dispatch Required',
];

// Checked in order: fire first, then crimes, then medical-only incidents.
const FIRE = /\b(fire|smoke|explosion|burn)/i;
const POLICE = /\b(gun|weapon|knife|shoot|shot|stab|rob|break(?:ing)?[- ]in|intruder|assault|attack|hit[- ]and[- ]run|fled|suspect|stolen|theft|domestic|kidnap|threat)/i;
const MEDICAL = /\b(breath|breathe|unconscious|unresponsive|overdose|heart attack|bleeding|injur|medical|die|dying)/i;
const UTILITY = /\b(gas|power line|power|electric|water|sewer|hydrant|flood)/i;

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function incidentId(incidentNumber, createdAt) {
  const year = new Date(createdAt || Date.now()).getFullYear();
  return `INC-${year}-${String(incidentNumber ?? 0).padStart(4, '0')}`;
}

export function deriveDispatch(category, text = '') {
  if (category === EMERGENCY) {
    if (FIRE.test(text)) return '911 / Fire & EMS';
    if (POLICE.test(text)) return '911 / Police Dispatch';
    return MEDICAL.test(text) ? '911 / Fire & EMS' : '911 / Police Dispatch';
  }
  if (category === HAZARDS) return UTILITY.test(text) ? 'Water & Power' : 'Public Works';
  if (category === 'Utilities & Water') return 'Water & Power';
  if (category === 'Roads & Infrastructure') return 'Public Works';
  return 'Sanitation & Code Enforcement';
}

/** Splits an LLM "one fact per line" string (bullets, numbers or semicolons) into clean facts. */
export function parseFacts(value) {
  if (Array.isArray(value)) return value.map(str).filter(Boolean);
  const text = str(value);
  if (!text) return [];
  return text
    .split(/\n|;\s+/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 10);
}

function derivedFacts(row) {
  const facts = (row.summary || '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s && s !== 'Call in progress…');
  if (row.location) facts.push(`Reported location: ${row.location}.`);
  if (row.status && row.status !== 'In Progress') facts.push(`Call disposition: ${row.status}.`);
  return facts.slice(0, 8);
}

/**
 * @param {object} args
 * @param {object} args.row  The calls row (needs incident_number, created_at, category, urgency_level, summary...)
 * @param {object} [args.call] Retell call object, when post-call analysis is available
 */
export function buildFormalReport({ row, call } = {}) {
  const custom = call?.call_analysis?.custom_analysis_data || {};
  const aiFacts = parseFacts(custom.key_facts);
  const dispatch = DISPATCH_OPTIONS.find((d) => d.toLowerCase() === str(custom.dispatch_recommendation)?.toLowerCase());
  const source = str(custom.executive_summary) || aiFacts.length ? 'ai' : 'derived';
  const text = `${row.summary || ''} ${call?.transcript || row.transcript || ''}`;

  return {
    incident_id: incidentId(row.incident_number, row.created_at),
    classification: { category: row.category, urgency_level: row.urgency_level },
    dispatch_recommendation: dispatch || deriveDispatch(row.category, text),
    executive_summary: str(custom.executive_summary) || row.summary || 'No summary available.',
    extracted_entities: {
      location: row.location || str(custom.location) || 'Not provided',
      involved_parties: str(custom.involved_parties) || (row.caller_name ? `Caller: ${row.caller_name}` : 'Caller (unidentified)'),
      incident_type: str(custom.incident_type) || row.category,
      date_time: row.created_at,
    },
    key_facts: aiFacts.length ? aiFacts : derivedFacts(row),
    generated_at: new Date().toISOString(),
    source,
  };
}

const TIME_ZONE = 'America/Los_Angeles';
const clock = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' });

// Most urgent first, for routing a consolidated incident to every agency its calls point to.
const DISPATCH_PRIORITY = ['911 / Fire & EMS', '911 / Police Dispatch', 'Water & Power', 'Public Works', 'Sanitation & Code Enforcement', 'No Dispatch Required'];
// Per-call boilerplate that the cluster report states once, for the whole incident.
const PER_CALL_FACT = /^(reported location|call disposition):/i;

function mostCommon(values) {
  const counts = new Map();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

/**
 * One official report for an incident cluster, consolidating its member calls (oldest
 * first). It takes the earliest call's incident number, so the incident keeps the ID it
 * was first reported under, and lists every call it supersedes.
 */
export function buildClusterReport(cluster, calls) {
  const sorted = [...calls].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const reports = sorted.map((c) => c.formal_report || buildFormalReport({ row: c }));
  const first = sorted[0];
  const n = sorted.length;
  const text = sorted.map((c) => `${c.summary || ''} ${c.transcript || ''}`).join(' ');

  const named = [...new Set(sorted.map((c) => c.caller_name).filter(Boolean))];
  const unnamed = cluster.unique_callers - named.length;
  const parties = [named.length ? `Callers: ${named.join(', ')}` : null, unnamed > 0 ? `${unnamed} unidentified caller${unnamed === 1 ? '' : 's'}` : null]
    .filter(Boolean)
    .join('; ');
  const otherParties = mostCommon(reports.map((r) => r.extracted_entities?.involved_parties).filter((p) => p && !/^caller/i.test(p)));

  const seen = new Set();
  const facts = [];
  for (const fact of reports.flatMap((r) => r.key_facts || []).filter((f) => !PER_CALL_FACT.test(f))) {
    const key = fact.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      facts.push(fact);
    }
  }
  const span = `between ${clock(cluster.first_report_at)} and ${clock(cluster.last_report_at)}`;
  const locations = [...new Set(sorted.map((c) => c.location).filter(Boolean))];

  const incidentType = mostCommon(reports.map((r) => r.extracted_entities?.incident_type)) || cluster.category;
  const what = incidentType === cluster.category ? 'the same incident' : `the same incident (${incidentType.toLowerCase()})`;
  const lead = `${n} calls from ${cluster.unique_callers} unique caller${cluster.unique_callers === 1 ? '' : 's'} reported ${what} at ${cluster.location_label || 'the same location'} ${span}.`;
  const routes = [...new Set(reports.map((r) => r.dispatch_recommendation).filter((d) => DISPATCH_PRIORITY.includes(d)))]
    .filter((d, _, all) => d !== 'No Dispatch Required' || all.length === 1)
    .sort((a, b) => DISPATCH_PRIORITY.indexOf(a) - DISPATCH_PRIORITY.indexOf(b));

  return {
    incident_id: incidentId(first.incident_number, first.created_at),
    type: 'cluster',
    classification: { category: cluster.category, urgency_level: cluster.max_urgency },
    dispatch_recommendation: routes.join(' + ') || deriveDispatch(cluster.category, text),
    executive_summary: `${lead} ${reports[0].executive_summary}`.trim(),
    extracted_entities: {
      location: cluster.location_label || first.location || 'Not provided',
      involved_parties: [parties, otherParties].filter(Boolean).join('; ') || 'Callers (unidentified)',
      incident_type: incidentType,
      date_time: cluster.first_report_at,
      last_report: cluster.last_report_at,
    },
    key_facts: [
      `${n} calls received ${span} from ${cluster.unique_callers} unique caller${cluster.unique_callers === 1 ? '' : 's'}.`,
      `Reported location${locations.length > 1 ? 's' : ''}: ${locations.join('; ') || 'not provided'}.`,
      ...facts,
    ].slice(0, 14),
    consolidated_calls: sorted.map((c, i) => ({
      incident_id: reports[i].incident_id,
      retell_call_id: c.retell_call_id,
      received_at: c.created_at,
      caller: c.caller_name || 'Unidentified caller',
      summary: c.summary,
    })),
    generated_at: new Date().toISOString(),
    source: reports.some((r) => r.source === 'ai') ? 'ai' : 'derived',
  };
}
