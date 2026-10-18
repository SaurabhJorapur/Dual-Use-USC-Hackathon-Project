import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSimulation, parseScenario, simulationSnapshot } from './simulation.js';

const CATEGORIES = ['Emergency / Active Danger', 'Public Safety & Hazards', 'Roads & Infrastructure', 'Utilities & Water', 'Code Enforcement & Sanitation'];
const critical = (sim) => sim.calls.filter((c) => c.severity === 'critical').length;

test('parseScenario reads type, area, intensity and time', () => {
  assert.deepEqual(
    { ...parseScenario('Magnitude 6.8 earthquake downtown at 2am'), area: parseScenario('Magnitude 6.8 earthquake downtown at 2am').area.name },
    { type: 'earthquake', area: 'Downtown', intensityHint: 9, startHour: 2 },
  );
  assert.equal(parseScenario('Wildfire burning in the Palisades').area.name, 'Pacific Palisades');
  assert.equal(parseScenario('Chemical spill at the Port of LA').type, 'hazmat');
  assert.equal(parseScenario('flooding in North Hollywood').area.name, 'North Hollywood');
  assert.equal(parseScenario('severe heat wave').intensityHint, 7);
  assert.equal(parseScenario('heat at 5pm').startHour, 17);
  assert.equal(parseScenario('alien invasion').type, 'generic');
  assert.equal(parseScenario('alien invasion').area, null);
});

test('same input gives the same simulation', () => {
  const a = buildSimulation({ description: 'Flood in Van Nuys', intensity: 7 });
  const b = buildSimulation({ description: 'Flood in Van Nuys', intensity: 7 });
  assert.deepEqual(a, b);
});

test('calls are valid, in LA and inside the timeline', () => {
  for (const [description, intensity] of [['earthquake', 10], ['wildfire in Sylmar', 6], ['power outage', 3], ['zombie outbreak', 8], ['normal day', 1]]) {
    const sim = buildSimulation({ description, intensity });
    assert.ok(sim.calls.length > 0 && sim.banner_alert && sim.recommendation && sim.actions.length);
    for (const c of sim.calls) {
      assert.ok(CATEGORIES.includes(c.category), c.category);
      assert.ok(['critical', 'hazard', 'routine'].includes(c.severity));
      assert.ok(c.lat > 33.7 && c.lat < 34.35 && c.lng > -118.7 && c.lng < -118.1, `${c.id} in LA`);
      assert.ok(c.t >= 0 && c.t <= sim.durationMin);
    }
    assert.ok(sim.calls.every((c, i) => i === 0 || sim.calls[i - 1].t <= c.t), 'sorted by time');
  }
});

test('intensity scales calls, peak and critical share', () => {
  const low = buildSimulation({ description: 'Chemical spill at the Port of LA', intensity: 2 });
  const high = buildSimulation({ description: 'Chemical spill at the Port of LA', intensity: 9 });
  assert.ok(high.calls.length > low.calls.length * 2);
  assert.ok(high.peak.multiple > low.peak.multiple * 5);
  assert.equal(critical(low), 0);
  assert.ok(critical(high) > 5);

  const normal = buildSimulation({ description: 'earthquake', intensity: 1 });
  assert.equal(normal.type, 'normal');
  assert.equal(critical(normal), 0);
  assert.ok(Math.max(...normal.surge_data.map((b) => b.calls / b.baseline)) < 1.5);
});

test('snapshot reveals calls and volume over time', () => {
  const sim = buildSimulation({ description: 'earthquake in Koreatown', intensity: 8 });
  const start = simulationSnapshot(sim, 0);
  const mid = simulationSnapshot(sim, sim.durationMin / 2);
  const end = simulationSnapshot(sim, sim.durationMin);
  assert.equal(start.callsSoFar, 0);
  assert.equal(start.eventStarted, false);
  assert.ok(mid.eventStarted && mid.revealed.length < end.revealed.length);
  assert.equal(end.revealed.length, sim.calls.length);
  assert.equal(end.callsSoFar, sim.surge_data.reduce((s, b) => s + b.calls, 0));
});
