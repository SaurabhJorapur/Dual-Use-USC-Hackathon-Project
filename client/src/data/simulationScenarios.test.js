import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, SCENARIO_ORDER, SEVERITIES } from './simulationScenarios.js';

const CATEGORIES = ['Emergency / Active Danger', 'Public Safety & Hazards', 'Roads & Infrastructure', 'Utilities & Water', 'Code Enforcement & Sanitation'];

test('every scenario has the full payload', () => {
  assert.deepEqual(SCENARIO_ORDER, ['normal', 'earthquake', 'flood']);
  for (const key of SCENARIO_ORDER) {
    const s = SCENARIOS[key];
    for (const field of ['name', 'banner_alert', 'recommendation']) assert.ok(typeof s[field] === 'string' && s[field].length > 10, `${key}.${field}`);
    assert.deepEqual(Object.keys(s.category_breakdown).sort(), [...CATEGORIES].sort(), `${key} categories`);
    assert.ok(s.surge_data.length >= 8 && s.surge_data.every((p) => p.time && Number.isFinite(p.calls) && Number.isFinite(p.baseline)), `${key} surge`);
    if (s.event_time) assert.ok(s.surge_data.some((p) => p.time === s.event_time), `${key} event_time is on the axis`);
  }
});

test('markers are valid and inside Los Angeles', () => {
  const ids = new Set();
  for (const key of SCENARIO_ORDER) {
    for (const m of SCENARIOS[key].map_markers) {
      assert.ok(!ids.has(m.id), `unique id ${m.id}`);
      ids.add(m.id);
      assert.ok(SEVERITIES.includes(m.severity), `${m.id} severity`);
      assert.ok(CATEGORIES.includes(m.category), `${m.id} category`);
      assert.ok(m.lat > 33.7 && m.lat < 34.35 && m.lng > -118.7 && m.lng < -118.1, `${m.id} in LA`);
      assert.ok(m.title && m.detail && m.time, `${m.id} text`);
    }
  }
});

test('disasters spike well above their baseline; normal does not', () => {
  const peakMultiple = (s) => Math.max(...s.surge_data.map((p) => p.calls / Math.max(1, p.baseline)));
  assert.ok(peakMultiple(SCENARIOS.earthquake) > 20);
  assert.ok(peakMultiple(SCENARIOS.flood) > 5);
  assert.ok(peakMultiple(SCENARIOS.normal) < 1.5);
  assert.ok(SCENARIOS.earthquake.map_markers.some((m) => m.severity === 'critical'));
});
