import test from 'node:test';
import assert from 'node:assert/strict';
import { hourlyBuckets, surgeInfo } from './stats.js';

const NOW = new Date('2026-10-17T12:30:00Z').getTime();
const ago = (h) => new Date(NOW - h * 3600_000).toISOString();

test('hourlyBuckets and surgeInfo', () => {
  const calls = [
    { category: 'Emergency / Active Danger', created_at: ago(0.1) },
    { category: 'Roads & Infrastructure', created_at: ago(0.2) },
    { category: 'Roads & Infrastructure', created_at: ago(0.3) },
    { category: 'Roads & Infrastructure', created_at: ago(5) },
    { category: 'Roads & Infrastructure', created_at: ago(30) }, // outside window
  ];
  const buckets = hourlyBuckets(calls, NOW);
  assert.equal(buckets.length, 24);
  assert.deepEqual(buckets[23], { ...buckets[23], emergency: 1, other: 2, total: 3 });
  const info = surgeInfo(buckets);
  assert.equal(info.total, 4);
  assert.equal(info.surging, true);
});
