import test from 'node:test';
import assert from 'node:assert/strict';
import { declutterPins } from './declutter.js';

test('declutterPins keeps the top-ranked item per screen cell', () => {
  const higher = (a, b) => a.rank > b.rank;
  const pins = declutterPins(
    [
      { item: { id: 'a', rank: 1 }, x: 10, y: 10 },
      { item: { id: 'b', rank: 5 }, x: 20, y: 30 },
      { item: { id: 'c', rank: 3 }, x: 39, y: 1 },
      { item: { id: 'd', rank: 0 }, x: 100, y: 10 },
    ],
    40,
    higher,
  );
  assert.deepEqual(
    pins.map((p) => [p.item.id, p.count]),
    [['b', 3], ['d', 1]],
  );
});
