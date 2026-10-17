import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePredictInput } from './degradation.js';

test('accepts the documented payload', () => {
  assert.deepEqual(parsePredictInput({ zipcode: '90007', latitude: 34.022, longitude: -118.285, days_since_repair: 120 }), {
    zipcode: '90007',
    latitude: 34.022,
    longitude: -118.285,
    days_since_repair: 120,
  });
});

test('accepts a zip code alone or coordinates alone', () => {
  assert.equal(parsePredictInput({ zipcode: 90007, days_since_repair: '30' }).zipcode, '90007');
  assert.equal(parsePredictInput({ latitude: '34.02', longitude: '-118.28', days_since_repair: 0 }).zipcode, null);
});

test('rejects missing location, half coordinates, bad zip and bad days', () => {
  const bad = [
    { days_since_repair: 10 },
    { latitude: 34, days_since_repair: 10 },
    { zipcode: '9000', days_since_repair: 10 },
    { zipcode: '90007' },
    { zipcode: '90007', days_since_repair: -1 },
    { zipcode: '90007', days_since_repair: 'soon' },
  ];
  for (const body of bad) assert.throws(() => parsePredictInput(body), (err) => err.statusCode === 400, JSON.stringify(body));
});
