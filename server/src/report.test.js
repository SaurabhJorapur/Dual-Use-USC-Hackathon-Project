import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildClusterReport, buildFormalReport, deriveDispatch, incidentId, parseFacts } from './report.js';

const row = {
  incident_number: 42,
  created_at: '2026-10-17T06:16:40Z',
  category: 'Emergency / Active Danger',
  urgency_level: 'Critical',
  status: 'Escalated to 911',
  summary: 'Caller reported a hit-and-run. Driver fled northbound.',
  location: 'Vermont Ave & Jefferson Blvd',
  caller_name: null,
};

test('incident ID uses year and zero-padded number', () => {
  assert.equal(incidentId(42, '2026-10-17T06:16:40Z'), 'INC-2026-0042');
  assert.equal(incidentId(12345, '2026-01-01T12:00:00Z'), 'INC-2026-12345');
});

test('parseFacts handles lines, bullets, numbering and semicolons', () => {
  assert.deepEqual(parseFacts('- Car was red\n2. Driver fled\n• Two people inside'), ['Car was red', 'Driver fled', 'Two people inside']);
  assert.deepEqual(parseFacts('Gun seen; caller is safe'), ['Gun seen', 'caller is safe']);
  assert.deepEqual(parseFacts(''), []);
});

test('dispatch fallback routes by category and keywords', () => {
  assert.equal(deriveDispatch('Emergency / Active Danger', 'man with a gun'), '911 / Police Dispatch');
  assert.equal(deriveDispatch('Emergency / Active Danger', 'house fire with smoke'), '911 / Fire & EMS');
  assert.equal(deriveDispatch('Emergency / Active Danger', 'hit-and-run; unclear whether anyone was injured'), '911 / Police Dispatch');
  assert.equal(deriveDispatch('Emergency / Active Danger', "my father can't breathe"), '911 / Fire & EMS');
  assert.equal(deriveDispatch('Public Safety & Hazards', 'downed power line'), 'Water & Power');
  assert.equal(deriveDispatch('Roads & Infrastructure', 'pothole'), 'Public Works');
  assert.equal(deriveDispatch('Code Enforcement & Sanitation', 'graffiti'), 'Sanitation & Code Enforcement');
});

test('derived report when no AI analysis is available', () => {
  const r = buildFormalReport({ row });
  assert.equal(r.source, 'derived');
  assert.equal(r.incident_id, 'INC-2026-0042');
  assert.equal(r.dispatch_recommendation, '911 / Police Dispatch');
  assert.equal(r.executive_summary, row.summary);
  assert.equal(r.extracted_entities.location, row.location);
  assert.equal(r.extracted_entities.involved_parties, 'Caller (unidentified)');
  assert.ok(r.key_facts.includes('Driver fled northbound.'));
  assert.ok(r.key_facts.some((f) => f.includes(row.location)));
});

test('AI analysis fields take precedence', () => {
  const r = buildFormalReport({
    row,
    call: {
      call_analysis: {
        custom_analysis_data: {
          executive_summary: 'At approximately 06:16, the caller reported a hit-and-run collision.',
          dispatch_recommendation: '911 / fire & ems',
          incident_type: 'Hit-and-run collision',
          involved_parties: 'Caller; one fleeing driver',
          key_facts: 'Vehicle fled northbound\nNo injuries confirmed',
        },
      },
    },
  });
  assert.equal(r.source, 'ai');
  assert.equal(r.dispatch_recommendation, '911 / Fire & EMS');
  assert.equal(r.extracted_entities.incident_type, 'Hit-and-run collision');
  assert.deepEqual(r.key_facts, ['Vehicle fled northbound', 'No injuries confirmed']);
});

test('unknown dispatch value falls back to derived routing', () => {
  const r = buildFormalReport({ row, call: { call_analysis: { custom_analysis_data: { dispatch_recommendation: 'Ghostbusters' } } } });
  assert.equal(r.dispatch_recommendation, '911 / Police Dispatch');
});

test('cluster report consolidates member calls into one incident', () => {
  const call = (n, minute, extra = {}) => ({
    incident_number: n,
    retell_call_id: `c${n}`,
    created_at: `2026-10-17T18:${String(minute).padStart(2, '0')}:00Z`,
    category: 'Emergency / Active Danger',
    urgency_level: 'Critical',
    location: 'S Figueroa St & W Adams Blvd',
    summary: `Crash report ${n}.`,
    formal_report: {
      incident_id: `INC-2026-00${n}`,
      dispatch_recommendation: '911 / Fire & EMS',
      executive_summary: `Summary ${n}.`,
      extracted_entities: { incident_type: 'Traffic collision', involved_parties: 'Two vehicles; one injured driver' },
      key_facts: ['One car is on its side.', `Fact ${n}.`],
      source: 'ai',
    },
    ...extra,
  });
  const calls = [call(43, 30, { caller_name: 'Marcus Lee' }), call(41, 24, { caller_name: 'Angela Torres' }), call(42, 27)];
  const cluster = {
    category: 'Emergency / Active Danger', max_urgency: 'Critical', unique_callers: 3, location_label: 'S Figueroa St & W Adams Blvd',
    first_report_at: '2026-10-17T18:24:00Z', last_report_at: '2026-10-17T18:30:00Z',
  };
  const r = buildClusterReport(cluster, calls);
  assert.equal(r.incident_id, 'INC-2026-0041', 'takes the earliest call\'s incident number');
  assert.equal(r.type, 'cluster');
  assert.equal(r.dispatch_recommendation, '911 / Fire & EMS');
  assert.match(r.executive_summary, /^3 calls from 3 unique callers reported the same incident \(traffic collision\)/);
  assert.match(r.executive_summary, /Summary 41\.$/);
  assert.match(r.extracted_entities.involved_parties, /Callers: Angela Torres, Marcus Lee; 1 unidentified caller; Two vehicles/);
  assert.equal(r.key_facts.filter((f) => f === 'One car is on its side.').length, 1, 'duplicate facts merged');
  assert.deepEqual(r.consolidated_calls.map((c) => c.incident_id), ['INC-2026-0041', 'INC-2026-0042', 'INC-2026-0043']);
  assert.equal(r.source, 'ai');

  // Calls routed to different agencies: the incident goes to all of them, most urgent first.
  const mixed = [call(51, 10), call(52, 12), call(53, 14)];
  mixed[0].formal_report = { ...mixed[0].formal_report, dispatch_recommendation: '911 / Police Dispatch', key_facts: ['Reported location: Main St.', 'Call disposition: Escalated to 911.'] };
  const m = buildClusterReport(cluster, mixed);
  assert.equal(m.dispatch_recommendation, '911 / Fire & EMS + 911 / Police Dispatch');
  assert.ok(!m.key_facts.some((f) => /^call disposition/i.test(f)), 'per-call boilerplate dropped');
  assert.equal(m.key_facts.filter((f) => /^reported location/i.test(f)).length, 1);
});
