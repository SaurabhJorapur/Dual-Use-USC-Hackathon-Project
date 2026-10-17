// Classifies a call into category / urgency / status. Prefers the structured
// post-call analysis Retell produces (see docs/retell-agent-setup.md) and falls
// back to keyword matching over the transcript so the dashboard always gets a
// valid row even if the LLM analysis is missing or malformed.

export const CATEGORIES = ['Public Safety', 'Potholes', 'Traffic Signals', 'Noise & Other'];
export const URGENCY_LEVELS = ['Critical', 'Urgent', 'Standard'];
export const STATUSES = ['Escalated to 911', 'Escalated to Human', 'AI Completed', 'In Progress'];

const CRITICAL_TERMS = [
  'gun', 'shot', 'shooting', 'shooter', 'knife', 'stab', 'stabbed', 'stabbing', 'weapon', 'robbery', 'robbed', 'robbing', 'break-in',
  'breaking in', 'intruder', 'assault', 'assaulted', 'attack', 'attacked', 'attacking', 'kidnap', 'kidnapped', 'fire', 'smoke', 'explosion',
  'not breathing', 'unconscious', 'unresponsive', 'bleeding', 'heart attack', 'overdose', 'crash', 'crashed', 'collision',
  'accident', 'hit and run', 'injured', 'trapped', 'carjacking', 'domestic violence',
];

const KEYWORDS = {
  'Public Safety': [...CRITICAL_TERMS, 'police', 'suspicious', 'theft', 'stolen', 'fight', 'threat', 'vandal'],
  Potholes: ['pothole', 'pot hole', 'sinkhole', 'crack in the road', 'road damage', 'pavement', 'asphalt', 'road surface'],
  'Traffic Signals': ['traffic light', 'traffic signal', 'signal', 'stop light', 'stoplight', 'red light', 'crosswalk', 'walk sign', 'stop sign', 'flashing'],
  'Noise & Other': ['noise', 'loud', 'music', 'party', 'barking', 'graffiti', 'trash', 'streetlight', 'street light', 'tree', 'abandoned'],
};

// Hazards that make a non-safety issue urgent (needs a human dispatcher soon).
const URGENT_TERMS = [
  'dangerous', 'hazard', 'all directions', 'completely out', 'not working at all', 'dark',
  'downed', 'down power line', 'power line', 'flooding', 'flood', 'blocking', 'swerving',
  'huge', 'deep', 'damaged my car', 'flat tire', 'school zone', 'highway', 'freeway',
];

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patternCache = new Map();

// Whole-word matching so "screenshot" doesn't hit "shot" or "fireworks" hit "fire".
function countMatches(text, terms) {
  return terms.reduce((n, term) => {
    let re = patternCache.get(term);
    if (!re) {
      re = new RegExp(`\\b${escapeRegex(term)}(?:s|es)?\\b`);
      patternCache.set(term, re);
    }
    return re.test(text) ? n + 1 : n;
  }, 0);
}

function pick(value, allowed) {
  if (typeof value !== 'string') return null;
  const match = allowed.find((a) => a.toLowerCase() === value.trim().toLowerCase());
  return match || null;
}

export function classifyText(text = '') {
  const t = text.toLowerCase();
  let category = 'Noise & Other';
  let best = 0;
  for (const cat of CATEGORIES) {
    const score = countMatches(t, KEYWORDS[cat]);
    if (score > best) {
      best = score;
      category = cat;
    }
  }

  let urgency = 'Standard';
  if (countMatches(t, CRITICAL_TERMS) > 0) {
    urgency = 'Critical';
    category = 'Public Safety';
  } else if (category === 'Public Safety' || countMatches(t, URGENT_TERMS) > 0) {
    urgency = 'Urgent';
  }
  return { category, urgency_level: urgency };
}

export function statusForUrgency(urgency) {
  if (urgency === 'Critical') return 'Escalated to 911';
  if (urgency === 'Urgent') return 'Escalated to Human';
  return 'AI Completed';
}

/**
 * @param {object} call Retell call object (from a webhook payload)
 * @returns {{category, urgency_level, status, summary, location, caller_name}}
 */
export function triageCall(call = {}) {
  const analysis = call.call_analysis || {};
  const custom = analysis.custom_analysis_data || {};
  const transcript = call.transcript || '';
  const fallback = classifyText(`${transcript} ${analysis.call_summary || ''}`);

  const category = pick(custom.category, CATEGORIES) || fallback.category;
  let urgency = pick(custom.urgency_level, URGENCY_LEVELS) || fallback.urgency_level;
  // Never let the LLM downgrade something the keyword safety net flags as Critical.
  if (fallback.urgency_level === 'Critical') urgency = 'Critical';

  const summary =
    (typeof custom.summary === 'string' && custom.summary.trim()) ||
    (typeof analysis.call_summary === 'string' && analysis.call_summary.trim()) ||
    (transcript ? transcript.slice(0, 280) : 'No summary available.');

  return {
    category: urgency === 'Critical' ? 'Public Safety' : category,
    urgency_level: urgency,
    status: statusForUrgency(urgency),
    summary,
    location: typeof custom.location === 'string' && custom.location.trim() ? custom.location.trim().slice(0, 255) : null,
    caller_name:
      typeof custom.caller_name === 'string' && custom.caller_name.trim() ? custom.caller_name.trim().slice(0, 100) : null,
  };
}
