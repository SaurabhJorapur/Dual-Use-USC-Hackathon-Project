// Pure helpers for the sidebar charts. No React or browser APIs, so they're unit-testable with node --test.
const HOUR = 60 * 60 * 1000;
const EMERGENCY = 'Emergency / Active Danger';

/** 24 hourly buckets ending with the current hour: [{ start, label, emergency, other, total }]. */
export function hourlyBuckets(calls, now = Date.now()) {
  const end = new Date(now);
  end.setMinutes(0, 0, 0);
  const first = end.getTime() - 23 * HOUR;
  const buckets = Array.from({ length: 24 }, (_, i) => {
    const start = first + i * HOUR;
    const h = new Date(start).getHours();
    return { start, label: `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`, emergency: 0, other: 0, total: 0 };
  });
  for (const call of calls) {
    const i = Math.floor((new Date(call.created_at).getTime() - first) / HOUR);
    if (i < 0 || i > 23) continue;
    buckets[i][call.category === EMERGENCY ? 'emergency' : 'other']++;
    buckets[i].total++;
  }
  return buckets;
}

/** Surge = the current hour has at least 3 calls and is over 2x the 24h hourly average. */
export function surgeInfo(buckets) {
  const total = buckets.reduce((n, b) => n + b.total, 0);
  const average = total / buckets.length;
  const peak = buckets.reduce((best, b) => (b.total > best.total ? b : best), buckets[0]);
  const current = buckets[buckets.length - 1].total;
  return { total, average, peak, current, surging: current >= 3 && current > 2 * average };
}

export function categoryCounts(calls, categories) {
  const counts = Object.fromEntries(categories.map((c) => [c, 0]));
  for (const call of calls) if (call.category in counts) counts[call.category]++;
  return counts;
}
