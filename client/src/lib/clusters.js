// Incident clusters page: colors, ranking, trends, the stacked chart and surge detection.
// No React or browser APIs here, so it's unit-testable with node --test.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
export const ACTIVE_WINDOW_MS = HOUR;

// One color per issue type, used by the cards, chart and legend on this page only.
export const ISSUE_TYPES = {
  'Emergency / Active Danger': { short: 'Emergency', legend: 'Emergency / safety', hex: '#dc2626' },
  'Public Safety & Hazards': { short: 'Hazard', legend: 'Traffic signals & road hazards', hex: '#ea580c' },
  'Roads & Infrastructure': { short: 'Road damage', legend: 'Potholes & road damage', hex: '#ca8a04' },
  'Utilities & Water': { short: 'Utility outage', legend: 'Power, water & utilities', hex: '#2563eb' },
  'Code Enforcement & Sanitation': { short: 'Noise / code issue', legend: 'Noise, disturbances & sanitation', hex: '#7c3aed' },
};
export const OTHER_ISSUE = { short: 'Report', legend: 'Other / uncategorized', hex: '#64748b' };
export const UNCLUSTERED_HEX = '#cbd5e1';
export const issueType = (category) => ISSUE_TYPES[category] || OTHER_ISSUE;

const URGENCY_BOOST = { Critical: 40, Urgent: 20, Standard: 0 };
const ms = (iso) => new Date(iso).getTime();

/** True when the latest dispatcher status action was a reopen or escalation (not a resolve). */
export function heldOpen(cluster) {
  const action = [...(cluster.notes || [])].reverse().find((n) => n.kind === 'status');
  if (!action) return false;
  return action.status ? action.status !== 'resolved' : !/^marked resolved/i.test(action.text);
}

/**
 * Active while reports keep arriving within the hour, or while a dispatcher has reopened or
 * escalated it (that holds it in Active until it's resolved). Everything else is History.
 */
export const isActive = (cluster, now = Date.now()) =>
  cluster.status !== 'resolved' && (now - ms(cluster.last_report_at) < ACTIVE_WINDOW_MS || heldOpen(cluster));


export const clusterTitle = (cluster) => `${issueType(cluster.category).short} at ${cluster.location_label || 'unknown location'}`;

/** Frequency + recency + urgency. Recency halves roughly every 14 minutes. */
export function rankScore(cluster, now = Date.now()) {
  const minutesSince = Math.max(0, (now - ms(cluster.last_report_at)) / MINUTE);
  return Math.log2(cluster.report_count + 1) * 10 + 30 * Math.exp(-minutesSince / 20) + (URGENCY_BOOST[cluster.max_urgency] || 0);
}

/** Still growing: two or more reports in the last 15 minutes, or one in the last 5. */
export function isRising(times, now = Date.now()) {
  const recent = times.filter((t) => now - t <= 15 * MINUTE).length;
  return recent >= 2 || times.some((t) => now - t <= 5 * MINUTE);
}

/**
 * Call log entries: calls in a cluster collapse into one cluster entry, placed where its
 * newest listed call would be. `calls` are already filtered and sorted newest first.
 */
export function logEntries(calls, clusters) {
  const clusterOf = new Map();
  for (const c of clusters) for (const id of c.member_ids || []) clusterOf.set(id, c);
  const entries = [];
  const seen = new Map();
  for (const call of calls) {
    const cluster = clusterOf.get(call.id);
    if (!cluster) {
      entries.push({ type: 'call', id: call.id, call });
    } else if (seen.has(cluster.id)) {
      seen.get(cluster.id).calls.push(call);
    } else {
      const entry = { type: 'cluster', id: `cluster-${cluster.id}`, cluster, calls: [call] };
      seen.set(cluster.id, entry);
      entries.push(entry);
    }
  }
  return entries;
}

/** Slight lighter/darker variants of a color so neighboring chart segments are distinguishable. */
export function shade(hex, i) {
  const amounts = [0, 0.22, -0.18, 0.38, -0.3, 0.5];
  const amount = amounts[i % amounts.length];
  const channels = [1, 3, 5].map((p) => parseInt(hex.slice(p, p + 2), 16));
  const mixed = channels.map((c) => Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount)));
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Stacked bar rows: one per category, one key per cluster, and an `unclustered` key on top,
 * counting only calls since `since` so each bar equals the true number of reports.
 */
export function chartData(calls, clusters, since = 0) {
  const clusterOf = new Map();
  for (const c of clusters) for (const id of c.member_ids || []) clusterOf.set(id, c);
  const inRange = calls.filter((c) => ms(c.created_at) >= since);
  const categories = [...Object.keys(ISSUE_TYPES), ...new Set(inRange.map((c) => c.category).filter((c) => !ISSUE_TYPES[c]))];

  const segments = [];
  const rows = categories.map((category) => {
    const row = { category, label: issueType(category).short, total: 0, unclustered: 0 };
    const counts = new Map();
    for (const call of inRange.filter((c) => c.category === category)) {
      row.total++;
      const cluster = clusterOf.get(call.id);
      if (cluster) counts.set(cluster, (counts.get(cluster) || 0) + 1);
      else row.unclustered++;
    }
    [...counts].sort((a, b) => b[1] - a[1]).forEach(([cluster, count], i) => {
      const key = `cluster_${cluster.id}`;
      row[key] = count;
      segments.push({ key, cluster, category, color: shade(issueType(category).hex, i) });
    });
    return row;
  });
  return { rows: rows.filter((r) => r.total > 0), segments };
}

const CELL_DEG = 0.01; // ~1 km
const cellOf = (c) => `${Math.floor(c.latitude / CELL_DEG)},${Math.floor(c.longitude / CELL_DEG)}`;

/**
 * Areas where reports in the last 30 minutes far exceed that area's normal rate for this
 * time of day (same 30-minute window on each of the prior 14 days). Issue types can differ.
 */
export function detectSurges(calls, now = Date.now(), { windowMs = 30 * MINUTE, days = 14, minReports = 4, factor = 3 } = {}) {
  const located = calls.filter((c) => c.latitude != null && c.longitude != null);
  const current = new Map();
  for (const c of located) {
    if (now - ms(c.created_at) > windowMs || ms(c.created_at) > now) continue;
    const key = cellOf(c);
    current.set(key, [...(current.get(key) || []), c]);
  }

  const history = new Map();
  for (const c of located) {
    const age = now - ms(c.created_at);
    const day = Math.floor(age / DAY);
    if (day < 1 || day > days || age - day * DAY > windowMs) continue; // same time-of-day window, prior days
    history.set(cellOf(c), (history.get(cellOf(c)) || 0) + 1);
  }

  const surges = [];
  for (const [cell, reports] of current) {
    const baseline = (history.get(cell) || 0) / days;
    if (reports.length < minReports || reports.length < factor * baseline + 1) continue;
    const locations = reports.map((r) => r.location).filter(Boolean);
    surges.push({
      cell,
      count: reports.length,
      baseline: Math.round(baseline * 10) / 10,
      lat: reports.reduce((s, r) => s + r.latitude, 0) / reports.length,
      lng: reports.reduce((s, r) => s + r.longitude, 0) / reports.length,
      categories: [...new Set(reports.map((r) => r.category))],
      label: locations.sort((a, b) => locations.filter((l) => l === b).length - locations.filter((l) => l === a).length)[0] || 'Unknown area',
      calls: reports,
    });
  }
  return surges.sort((a, b) => b.count - a.count);
}
