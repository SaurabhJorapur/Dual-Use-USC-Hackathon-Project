// Disaster Simulator generator: turns a free-text scenario + intensity (1–10) into a timed call timeline.
// Pure and seeded, so the same description and intensity always produce the same simulation.
import { DISASTER_TYPES, INTENSITY_WORDS, LA_BOUNDS, NEIGHBORHOODS, NORMAL, ROUTINE_TEMPLATES } from '../data/simulationData.js';

const DOWNTOWN = NEIGHBORHOODS[0];
const KM_PER_DEG_LAT = 111;
const KM_PER_DEG_LNG = 92; // at ~34°N
// Everyday split of call volume (normal-day pins and the baseline part of every bucket).
const NORMAL_WEIGHTS = {
  'Emergency / Active Danger': 0.1,
  'Public Safety & Hazards': 0.17,
  'Roads & Infrastructure': 0.3,
  'Utilities & Water': 0.14,
  'Code Enforcement & Sanitation': 0.29,
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (text, phrase) => new RegExp(`\\b${escapeRe(phrase)}(s|es|ing|ed)?\\b`).test(text);
const fill = (str, slots) => str.replace(/\{(\w+)\}/g, (_, k) => slots[k] ?? '');

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const gaussian = (rng) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

const INTENSITY_HINTS = [
  [/\b(catastrophic|devastating|apocalyptic|massive|worst)\b/, 10],
  [/\b(major|huge|enormous|historic)\b/, 9],
  [/\b(severe|extreme|intense|violent|deadly)\b/, 7],
  [/\b(strong|large|big|serious)\b/, 6],
  [/\b(moderate|medium)\b/, 5],
  [/\b(minor|small|light|slight|mild)\b/, 3],
  [/\b(normal|quiet|calm|routine|typical|regular)\b/, 1],
];

/** Reads the disaster type, area, intensity hint and start hour out of a free-text description. */
export function parseScenario(text) {
  const lower = ` ${String(text || '').toLowerCase()} `;

  let type = 'generic';
  let best = 0;
  for (const [key, def] of Object.entries(DISASTER_TYPES)) {
    const hits = def.keywords.filter((kw) => mentions(lower, kw)).length;
    if (hits > best) [type, best] = [key, hits];
  }

  // Longest phrase first, so "north hollywood" wins over "hollywood".
  const phrases = NEIGHBORHOODS.flatMap((n) => [n.name, ...n.aliases].map((p) => [p.toLowerCase(), n])).sort((a, b) => b[0].length - a[0].length);
  const area = phrases.find(([p]) => mentions(lower, p))?.[1] || null;

  let intensityHint = null;
  const magnitude = lower.match(/\b(?:m|magnitude)\s*(\d(?:\.\d)?)\b/);
  if (magnitude) intensityHint = clamp(Math.round((Number(magnitude[1]) - 3) * 2 + 1), 1, 10);
  else intensityHint = INTENSITY_HINTS.find(([re]) => re.test(lower))?.[1] ?? null;

  let startHour = null;
  const clock = lower.match(/\b(\d{1,2})(?::\d{2})?\s*(am|pm)\b/);
  if (clock) startHour = (Number(clock[1]) % 12) + (clock[2] === 'pm' ? 12 : 0);
  else if (/\bnoon\b/.test(lower)) startHour = 12;
  else if (/\bmidnight\b/.test(lower)) startHour = 0;
  if (startHour !== null && startHour > 23) startHour = null;

  return { type, area, intensityHint, startHour };
}

/** Normal calls per hour at a given hour of day: quiet overnight, busiest mid-afternoon. */
const hourlyBaseline = (hour) => 18 * (0.15 + 0.85 * Math.max(0, Math.sin((Math.PI * (((hour % 24) + 24) % 24 - 5)) / 18)));

const pad = (n) => String(n).padStart(2, '0');
const clockLabel = (minuteOfDay) => {
  const m = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};
export const clock12 = (minuteOfDay) => {
  const m = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${pad(m % 60)} ${h < 12 ? 'AM' : 'PM'}`;
};

/** Event shape over time (0 before the event, peaks at 1). */
function eventShape(curve, x, durationMin, size) {
  if (x < 0) return 0;
  if (curve === 'spike') return x < size ? 0.6 + (0.4 * x) / size : Math.exp(-(x - size) / (durationMin * 0.22));
  const rampLen = durationMin * 0.4;
  return x < rampLen ? Math.max(0.05, (x / rampLen) ** 1.5) : Math.exp(-(x - rampLen) / (durationMin * 0.25));
}

function nearestPlace(lat, lng) {
  let best = DOWNTOWN;
  let bestD = Infinity;
  for (const n of NEIGHBORHOODS) {
    const d = ((n.lat - lat) * KM_PER_DEG_LAT) ** 2 + ((n.lng - lng) * KM_PER_DEG_LNG) ** 2;
    if (d < bestD) [best, bestD] = [n, d];
  }
  return best.name;
}

/**
 * Builds a full simulation. `defaultHour` is used when the description names no time.
 * Returns the display payload plus `calls` (pins, each with `t` = minutes from the start) and
 * `surge_data` (call volume per bucket, including calls not drawn on the map).
 */
export function buildSimulation({ description = '', intensity = 5, defaultHour = 14 } = {}) {
  const level = clamp(Math.round(Number(intensity) || 1), 1, 10);
  const parsed = parseScenario(description);
  const def = DISASTER_TYPES[parsed.type];
  const normal = level === 1;
  const rng = mulberry32(hash(`${String(description).trim().toLowerCase()}|${level}`));

  const durationMin = def.durationHours * 60;
  const size = def.durationHours <= 6 ? 15 : 30;
  const bucketCount = durationMin / size;
  const eventMin = Math.round(bucketCount * 0.15) * size;
  const eventHour = parsed.startHour ?? defaultHour;
  const startMinuteOfDay = eventHour * 60 - eventMin;

  // Volume per bucket: everyday baseline plus the event's excess, scaled by intensity.
  const multipleTarget = normal ? 1 : 1 + (level - 1) ** 2 * 1.22;
  const baselineAt = (t) => Math.max(1, Math.round((hourlyBaseline((startMinuteOfDay + t) / 60) * size) / 60));
  const refBase = (18 * size) / 60;
  const ampBase = Math.max(baselineAt(eventMin), refBase * 0.3);
  const surge_data = [];
  for (let i = 0; i < bucketCount; i++) {
    const t = i * size;
    const baseline = baselineAt(t + size / 2);
    const excess = normal ? 0 : ampBase * (multipleTarget - 1) * eventShape(def.curve, t + size / 2 - eventMin, durationMin, size) * (0.85 + 0.3 * rng());
    const noise = normal ? 0.9 + 0.2 * rng() : 1;
    surge_data.push({ t, time: clockLabel(startMinuteOfDay + t), calls: Math.round(baseline * noise + excess), baseline, excess: Math.round(excess) });
  }

  // Pins: a sample of individual calls, timed to follow the volume curve.
  const pinCount = normal ? 8 : Math.min(75, 6 + level * 7);
  const backgroundCount = normal ? pinCount : Math.min(3, Math.ceil(pinCount * 0.06));
  const critShare = level <= 2 ? 0 : (0.35 * (level - 2)) / 8;
  const hazardShare = normal ? 0.15 : 0.35 + level * 0.01;
  const excessTotal = surge_data.reduce((s, b) => s + b.excess, 0);
  const center = parsed.area || DOWNTOWN;
  const sigmaKm = parsed.area ? 1.2 + level * 0.45 : 7 + level * 0.3;
  const routinePool = [...def.templates.filter((tp) => tp.severity === 'routine'), ...ROUTINE_TEMPLATES];

  const sampleEventTime = () => {
    let r = rng() * excessTotal;
    for (const b of surge_data) {
      r -= b.excess;
      if (r <= 0) return Math.max(eventMin + 1, b.t + rng() * size);
    }
    return eventMin + 1;
  };

  const raw = [];
  for (let i = 0; i < pinCount; i++) {
    const background = i < backgroundCount;
    let t;
    let template;
    let lat;
    let lng;
    if (background) {
      t = rng() * (normal ? durationMin : eventMin);
      template = normal ? pick(rng, ROUTINE_TEMPLATES) : pick(rng, ROUTINE_TEMPLATES.filter((tp) => tp.severity === 'routine'));
      const hood = pick(rng, NEIGHBORHOODS);
      lat = hood.lat + gaussian(rng) * (0.8 / KM_PER_DEG_LAT);
      lng = hood.lng + gaussian(rng) * (0.8 / KM_PER_DEG_LNG);
    } else {
      // The first event call is the triggering incident: always as bad as this intensity allows.
      const first = i === backgroundCount;
      t = first ? eventMin + 1 + rng() * 3 : sampleEventTime();
      const roll = rng();
      const severity = first ? (critShare > 0 ? 'critical' : 'hazard') : roll < critShare ? 'critical' : roll < critShare + hazardShare ? 'hazard' : 'routine';
      template = severity === 'routine' ? pick(rng, routinePool) : pick(rng, def.templates.filter((tp) => tp.severity === severity));
      const spread = sigmaKm * (severity === 'critical' ? 0.6 : 1) * (first ? 0.2 : 1);
      lat = center.lat + gaussian(rng) * (spread / KM_PER_DEG_LAT);
      lng = center.lng + gaussian(rng) * (spread / KM_PER_DEG_LNG);
    }
    lat = clamp(lat, LA_BOUNDS.minLat, LA_BOUNDS.maxLat);
    lng = clamp(lng, LA_BOUNDS.minLng, LA_BOUNDS.maxLng);
    const place = nearestPlace(lat, lng);
    raw.push({ t: Math.min(durationMin, Math.round(t * 10) / 10), severity: template.severity, category: template.category, title: template.title, detail: fill(template.detail, { place }), place, lat, lng });
  }
  const calls = raw
    .sort((a, b) => a.t - b.t)
    .map((c, i) => ({ id: `sim${i + 1}`, time: clock12(startMinuteOfDay + c.t), ...c }));

  const peak = surge_data.reduce((best, b) => (b.calls / b.baseline > best.calls / best.baseline ? b : best), surge_data[0]);
  const multiple = Math.max(1, Math.round(peak.calls / peak.baseline));
  const areaLabel = parsed.area ? parsed.area.name : 'Los Angeles';
  const intensityWord = INTENSITY_WORDS[level - 1];
  const slots = { area: areaLabel, intensityWord, multiple, units: Math.max(2, Math.round(level * 1.6)) };
  const text = normal ? NORMAL : def;
  const actionCount = normal ? NORMAL.actions.length : Math.min(def.actions.length, 2 + Math.ceil(level / 3));

  return {
    description,
    intensity: level,
    type: normal ? 'normal' : parsed.type,
    label: text.label,
    emoji: text.emoji,
    tone: text.tone,
    name: normal ? `Normal operations · ${areaLabel}` : `${intensityWord} ${def.label.toLowerCase()} · ${areaLabel}`,
    area: parsed.area ? { name: parsed.area.name, lat: parsed.area.lat, lng: parsed.area.lng } : null,
    banner_alert: fill(text.banner, slots),
    recommendation: fill(text.recommendation, slots),
    actions: text.actions.slice(0, actionCount).map((a) => fill(a, slots)),
    durationMin,
    bucketMin: size,
    eventMin,
    startMinuteOfDay,
    event_time: normal ? null : clockLabel(startMinuteOfDay + eventMin),
    peak: { time: peak.time, calls: peak.calls, multiple },
    categoryWeights: def.categoryWeights,
    surge_data,
    calls,
  };
}

/** What the dashboard shows at `minute` into the simulation: everything revealed so far. */
export function simulationSnapshot(sim, minute) {
  const m = clamp(minute, 0, sim.durationMin);
  const categories = Object.fromEntries(Object.keys(NORMAL_WEIGHTS).map((k) => [k, 0]));
  let callsSoFar = 0;
  let current = sim.surge_data[0];
  for (const b of sim.surge_data) {
    if (b.t > m) break;
    current = b;
    // The bucket in progress counts in proportion to how much of it has elapsed.
    const share = Math.min(1, (m - b.t) / sim.bucketMin);
    const base = (b.calls - b.excess) * share;
    const extra = b.excess * share;
    callsSoFar += base + extra;
    for (const k of Object.keys(categories)) categories[k] += base * NORMAL_WEIGHTS[k] + extra * (sim.categoryWeights[k] || 0);
  }
  const revealed = sim.calls.filter((c) => c.t <= m);
  return {
    minute: m,
    callsSoFar: Math.round(callsSoFar),
    categories: Object.fromEntries(Object.entries(categories).map(([k, v]) => [k, Math.round(v)])),
    revealed,
    criticalSoFar: revealed.filter((c) => c.severity === 'critical').length,
    multiple: Math.max(1, Math.round(current.calls / current.baseline)),
    currentTime: current.time,
    eventStarted: sim.event_time !== null && m >= sim.eventMin,
  };
}
