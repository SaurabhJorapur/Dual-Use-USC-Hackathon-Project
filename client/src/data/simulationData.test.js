import test from 'node:test';
import assert from 'node:assert/strict';
import { DISASTER_TYPES, NEIGHBORHOODS, PRESETS, ROUTINE_TEMPLATES, SEVERITIES } from './simulationData.js';

const CATEGORIES = ['Emergency / Active Danger', 'Public Safety & Hazards', 'Roads & Infrastructure', 'Utilities & Water', 'Code Enforcement & Sanitation'];

test('every disaster type is complete', () => {
  for (const [key, def] of Object.entries(DISASTER_TYPES)) {
    for (const tp of [...def.templates, ...ROUTINE_TEMPLATES]) {
      assert.ok(SEVERITIES.includes(tp.severity), `${key}: ${tp.title}`);
      assert.ok(CATEGORIES.includes(tp.category), `${key}: ${tp.title}`);
    }
    assert.ok(def.templates.some((tp) => tp.severity === 'critical') && def.templates.some((tp) => tp.severity === 'hazard'), key);
    assert.ok(Math.abs(Object.values(def.categoryWeights).reduce((s, w) => s + w, 0) - 1) < 1e-9, `${key} weights sum to 1`);
    assert.ok(def.banner && def.recommendation && def.actions.length >= 4, key);
  }
});

test('neighborhoods are in LA and presets are in range', () => {
  for (const n of NEIGHBORHOODS) assert.ok(n.lat > 33.7 && n.lat < 34.35 && n.lng > -118.7 && n.lng < -118.1, n.name);
  for (const p of PRESETS) assert.ok(p.intensity >= 1 && p.intensity <= 10 && p.description);
});
