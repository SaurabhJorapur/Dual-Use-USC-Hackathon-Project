import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePredictInput } from './degradation.js';

test('accepts the documented payload', () => {
  assert.deepEqual(parsePredictInput({ latitude: 34.062, longitude: -118.307, area: 'Olympic' }), {
    area: 'Olympic',
    latitude: 34.062,
    longitude: -118.307,
  });
});

test('accepts an area alone or coordinates alone', () => {
  assert.equal(parsePredictInput({ area: '77th Street' }).area, '77th Street');
  assert.equal(parsePredictInput({ latitude: '34.02', longitude: '-118.28' }).area, null);
});

test('rejects missing location, half coordinates and bad areas', () => {
  const bad = [{}, { latitude: 34 }, { longitude: -118 }, { latitude: 'north', longitude: -118 }, { area: 'x'.repeat(41) }, { area: '<script>' }];
  for (const body of bad) assert.throws(() => parsePredictInput(body), (err) => err.statusCode === 400, JSON.stringify(body));
});
