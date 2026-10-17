import test from 'node:test';
import assert from 'node:assert/strict';
import { chartData, detectSurges, isActive, isRising, logEntries, rankScore, shade } from './clusters.js';

const NOW = new Date('2026-10-17T18:00:00Z').getTime();
const ago = (min) => new Date(NOW - min * 60_000).toISOString();
const cluster = (extra) => ({ id: 'a', report_count: 5, max_urgency: 'Standard', status: 'active', last_report_at: ago(2), member_ids: [], ...extra });

test('rankScore: recent beats quiet at equal count, urgency lifts, count matters', () => {
  assert.ok(rankScore(cluster({ last_report_at: ago(2) }), NOW) > rankScore(cluster({ last_report_at: ago(50) }), NOW));
  assert.ok(rankScore(cluster({ max_urgency: 'Critical', last_report_at: ago(50) }), NOW) > rankScore(cluster({ last_report_at: ago(2) }), NOW));
  assert.ok(rankScore(cluster({ report_count: 50 }), NOW) > rankScore(cluster({ report_count: 5 }), NOW));
});

test('isActive: within the hour and not resolved', () => {
  assert.equal(isActive(cluster({ last_report_at: ago(59) }), NOW), true);
  assert.equal(isActive(cluster({ last_report_at: ago(61) }), NOW), false);
  assert.equal(isActive(cluster({ status: 'resolved' }), NOW), false);
});

test('isActive: a dispatcher reopen or escalation holds a quiet cluster in Active until resolved', () => {
  const quiet = { last_report_at: ago(300) };
  const action = (status) => ({ kind: 'status', status, at: ago(1), text: status });
  assert.equal(isActive(cluster({ ...quiet, notes: [action('active')] }), NOW), true, 'reopened');
  assert.equal(isActive(cluster({ ...quiet, status: 'escalated', notes: [action('escalated')] }), NOW), true, 'escalated by hand');
  assert.equal(isActive(cluster({ ...quiet, status: 'escalated' }), NOW), false, 'auto-escalated clusters still go quiet');
  assert.equal(isActive(cluster({ ...quiet, notes: [action('active'), { kind: 'note', text: 'x' }] }), NOW), true, 'plain notes do not count');
  assert.equal(isActive(cluster({ ...quiet, notes: [{ kind: 'status', text: 'Reopened' }] }), NOW), true, 'older notes without a status field');
});

test('isRising', () => {
  const t = (min) => NOW - min * 60_000;
  assert.equal(isRising([t(40), t(10), t(12)], NOW), true);
  assert.equal(isRising([t(40), t(3)], NOW), true);
  assert.equal(isRising([t(40), t(30)], NOW), false);
});

test('logEntries: a cluster is one entry at its newest call, other calls stay individual', () => {
  const calls = ['1', '2', '3', '4', '5'].map((id) => ({ id })); // newest first
  const clusters = [cluster({ id: 'x', member_ids: ['2', '4', '5'] })];
  const entries = logEntries(calls, clusters);
  assert.deepEqual(entries.map((e) => e.id), ['1', 'cluster-x', '3']);
  assert.deepEqual(entries[1].calls.map((c) => c.id), ['2', '4', '5']);
  assert.equal(logEntries(calls, []).length, 5);
});

test('shade varies a color and keeps it valid hex', () => {
  assert.equal(shade('#dc2626', 0), '#dc2626');
  assert.notEqual(shade('#dc2626', 1), '#dc2626');
  assert.match(shade('#dc2626', 2), /^#[0-9a-f]{6}$/);
});

test('chartData: bars equal the true report count, clusters stacked, loose reports unclustered', () => {
  const calls = [
    ...['1', '2', '3'].map((id) => ({ id, category: 'Public Safety & Hazards', created_at: ago(10) })),
    { id: '4', category: 'Public Safety & Hazards', created_at: ago(20) },
    { id: '5', category: 'Roads & Infrastructure', created_at: ago(5) },
    { id: '6', category: 'Roads & Infrastructure', created_at: ago(60 * 48) }, // outside range
  ];
  const clusters = [{ id: 'x', member_ids: ['1', '2', '3'] }];
  const { rows, segments } = chartData(calls, clusters, NOW - 24 * 3600_000);
  const hazards = rows.find((r) => r.category === 'Public Safety & Hazards');
  assert.equal(hazards.total, 4);
  assert.equal(hazards.cluster_x, 3);
  assert.equal(hazards.unclustered, 1);
  assert.equal(rows.find((r) => r.category === 'Roads & Infrastructure').total, 1);
  assert.equal(segments.length, 1);
});

test('detectSurges flags a sudden mixed-issue spike, not an area that is always busy', () => {
  const at = (min, lat, category = 'Utilities & Water') => ({ category, latitude: lat, longitude: -118.3001, created_at: ago(min), location: 'Main & 5th' });
  const spike = [at(2, 34.0001), at(5, 34.0002, 'Public Safety & Hazards'), at(9, 34.0003, 'Emergency / Active Danger'), at(20, 34.0004)];
  const surges = detectSurges(spike, NOW);
  assert.equal(surges.length, 1);
  assert.equal(surges[0].count, 4);
  assert.equal(surges[0].categories.length, 3);

  // Same spike in a cell that normally sees ~3 reports in this window every day: not a surge.
  const busy = Array.from({ length: 14 }, (_, d) => [1, 2, 3].map((k) => at((d + 1) * 1440 + k * 5, 34.0005))).flat();
  assert.equal(detectSurges([...spike, ...busy], NOW).length, 0);
  assert.equal(detectSurges(spike.slice(0, 3), NOW).length, 0, 'needs at least 4 reports');
});
