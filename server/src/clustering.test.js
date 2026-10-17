import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callTarget, clusterStats, distanceKm, matches, nextStatus } from './clustering.js';

const T0 = new Date('2026-10-17T12:00:00Z').getTime();
const at = (min) => new Date(T0 + min * 60_000).toISOString();
// ~0.001 deg latitude is ~111 m
const call = (min, dLat = 0, extra = {}) => ({
  id: `c${min}${dLat}`, category: 'Public Safety & Hazards', latitude: 34.0 + dLat, longitude: -118.3, created_at: at(min),
  caller_phone: `+1213555${String(min).padStart(4, '0')}`, urgency_level: 'Standard', location: 'Main St & 5th St', ...extra,
});

test('matches requires same category, within 150 m and under an hour apart', () => {
  const base = callTarget(call(0));
  assert.equal(matches(call(30, 0.001), base), true);
  assert.equal(matches(call(30, 0.002), base), false, '~222 m away');
  assert.equal(matches(call(61), base), false, 'over an hour later');
  assert.equal(matches(call(-30), base), true, 'earlier arrivals within the hour still match');
  assert.equal(matches(call(10, 0, { category: 'Roads & Infrastructure' }), base), false);
  assert.equal(matches(call(10, 0, { latitude: null }), base), false);
});

test('a cluster stays alive while each report is within an hour of the latest', () => {
  const cluster = { category: 'Public Safety & Hazards', lat: 34.0, lng: -118.3, first: T0, last: T0 + 50 * 60_000 };
  assert.equal(matches(call(105), cluster), true, '55 min after the latest report');
  assert.equal(matches(call(115), cluster), false);
});

test('clusterStats counts reports, unique callers, time span, max urgency and center', () => {
  const calls = [
    call(0, 0),
    call(5, 0.001, { caller_phone: '+12135550000' }), // same person as call(0)
    call(9, 0.0005, { urgency_level: 'Critical', caller_phone: 'Web Call' }),
    call(12, 0, { caller_phone: 'Web Call', location: 'Main & 5th' }),
  ];
  const s = clusterStats(calls);
  assert.equal(s.report_count, 4);
  assert.equal(s.unique_callers, 3, 'repeat caller counted once, each anonymous web call counted');
  assert.equal(s.first_report_at, at(0));
  assert.equal(s.last_report_at, at(12));
  assert.equal(s.max_urgency, 'Critical');
  assert.ok(Math.abs(s.center_lat - 34.000375) < 1e-9);
  assert.equal(s.location_label, 'Main St & 5th St');
});

test('nextStatus lifts to escalated on urgent reports and keeps manual states', () => {
  assert.equal(nextStatus('active', 'Standard'), 'active');
  assert.equal(nextStatus('active', 'Critical'), 'escalated');
  assert.equal(nextStatus('active', 'Urgent'), 'escalated');
  assert.equal(nextStatus('resolved', 'Critical'), 'resolved');
  assert.equal(nextStatus('escalated', 'Standard'), 'escalated');
});

test('distanceKm', () => {
  assert.ok(Math.abs(distanceKm({ lat: 34, lng: -118.3 }, { lat: 34.001, lng: -118.3 }) - 0.111) < 0.002);
});
