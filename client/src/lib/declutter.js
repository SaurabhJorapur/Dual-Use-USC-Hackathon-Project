// Zoom-based map decluttering shared by the dashboard map and the Disaster Simulator.

/**
 * Buckets points into `cellPx` screen-pixel squares and keeps one per square: the item for which
 * `outranks(a, b)` holds against the others, with `count` = how many items it stands for.
 * `points` are `{ item, x, y }` with x/y already projected to pixels at the current zoom.
 */
export function declutterPins(points, cellPx, outranks) {
  const cells = new Map();
  for (const { item, x, y } of points) {
    const key = `${Math.floor(x / cellPx)}:${Math.floor(y / cellPx)}`;
    const cell = cells.get(key);
    if (!cell) cells.set(key, { item, count: 1 });
    else {
      cell.count += 1;
      if (outranks(item, cell.item)) cell.item = item;
    }
  }
  return [...cells.values()];
}

/** Small count bubble added to a divIcon's HTML when one pin stands for several. */
export const countBadge = (count) => (count > 1 ? `<span class="pin-count">${count}</span>` : '');
