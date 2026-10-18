// Classifies a call into category / urgency / status. Prefers the structured
// post-call analysis Retell produces (see docs/retell-agent-setup.md) and falls
// back to keyword matching over the transcript so the dashboard always gets a
// valid row even if the LLM analysis is missing or malformed.

export const EMERGENCY = 'Emergency / Active Danger';
export const HAZARDS = 'Public Safety & Hazards';
export const CATEGORIES = [EMERGENCY, HAZARDS, 'Roads & Infrastructure', 'Utilities & Water', 'Code Enforcement & Sanitation'];
export const DEFAULT_CATEGORY = 'Code Enforcement & Sanitation';
export const URGENCY_LEVELS = ['Critical', 'Urgent', 'Standard'];
export const STATUSES = ['Escalated to 911', 'Escalated to Human', 'AI Completed', 'In Progress'];

const CRITICAL_TERMS = [
  'gun', 'shot', 'shooting', 'shooter', 'knife', 'stab', 'stabbed', 'stabbing', 'weapon', 'robbery', 'robbed', 'robbing', 'break-in',
  'breaking in', 'intruder', 'assault', 'assaulted', 'attack', 'attacked', 'attacking', 'kidnap', 'kidnapped', 'fire', 'smoke', 'explosion',
  'not breathing', "can't breathe", 'cannot breathe', 'unconscious', 'unresponsive', 'bleeding', 'heart attack', 'overdose', 'crash', 'crashed', 'collision',
  'accident', 'hit and run', 'injured', 'trapped', 'carjacking', 'domestic violence', 'going to die', 'gonna die', 'about to die',
];

// Phrases containing a critical word that aren't emergencies by themselves,
// rewritten so the non-critical part still counts toward its category.
const BENIGN_PHRASES = { 'fire hydrant': 'hydrant' };

// The caller taking the danger back. Joke/false-alarm phrases count on their own; "I'm safe"
// style phrases only after a critical term (otherwise they are ordinary small talk).
const JOKE_RETRACTIONS = [
  'false alarm', 'just joking', 'was joking', 'only joking', 'just kidding', 'was kidding', 'only kidding',
  'not real', 'was lying', 'kinda lying', 'messing with you', 'prank',
];
const RETRACTIONS = [
  ...JOKE_RETRACTIONS, 'never mind', 'nevermind', "i'm good now", "i'm okay", "i'm ok", "i'm fine", "i'm safe", 'i am safe',
  'nobody is hurt', 'no one is hurt', 'everyone is okay', 'everyone is safe',
];

// Property crime with the suspect gone (a stolen bin) is a city matter, not a 911 emergency.
const KEYWORDS = {
  [EMERGENCY]: [...CRITICAL_TERMS, 'fight', 'threat'],
  [HAZARDS]: [
    'downed', 'power line', 'gas leak', 'smell gas', 'gas smell', 'hydrant', 'blocked intersection', 'blocking',
    'blocking traffic', 'blocking the road', 'lane', 'branch', 'fallen branch', 'downed sign', 'suspicious',
    'hazard', 'dangerous', 'sinkhole', 'debris',
  ],
  'Roads & Infrastructure': [
    'pothole', 'pot hole', 'crack in the road', 'road damage', 'pavement', 'asphalt', 'road surface', 'traffic light',
    'traffic signal', 'signal', 'stop light', 'stoplight', 'red light', 'crosswalk', 'walk sign', 'stop sign', 'street sign',
    'sign', 'sidewalk', 'streetlight', 'street light', 'bridge',
  ],
  'Utilities & Water': [
    'water main', 'water leak', 'burst pipe', 'sewer', 'sewage', 'backup', 'power outage', 'outage', 'no power',
    'blackout', 'fallen tree', 'tree', 'water pressure', 'no water', 'flooding', 'flood', 'flooded',
  ],
  'Code Enforcement & Sanitation': [
    'illegal dumping', 'dumping', 'noise', 'loud', 'music', 'party', 'barking', 'abandoned', 'abandoned vehicle',
    'trash', 'garbage', 'missed pickup', 'graffiti', 'litter', 'vandal', 'vandalism', 'stolen', 'stole', 'theft',
    'bin', 'trash can', 'garbage can', 'recycling', 'green waste', 'property maintenance', 'overgrown',
  ],
};

// Hazards that make a non-emergency issue urgent (needs a human dispatcher soon).
const URGENT_TERMS = [
  'dangerous', 'hazard', 'all directions', 'completely out', 'not working at all', 'dark',
  'downed', 'power line', 'gas leak', 'smell gas', 'flooding', 'flood', 'blocking', 'swerving',
  'huge', 'deep', 'massive', 'damaged my car', 'flat tire', 'popped', 'tire', 'blew out', 'blocking traffic',
  'school', 'school zone', 'highway', 'freeway',
];

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patternCache = new Map();

// Whole-word matching so "screenshot" doesn't hit "shot" or "fireworks" hit "fire".
function termPattern(term) {
  let re = patternCache.get(term);
  if (!re) {
    re = new RegExp(`\\b${escapeRegex(term)}(?:s|es)?\\b`, 'g');
    patternCache.set(term, re);
  }
  re.lastIndex = 0;
  return re;
}

function countMatches(text, terms) {
  return terms.reduce((n, term) => (termPattern(term).test(text) ? n + 1 : n), 0);
}

/** Position of the last match of any term, or -1. */
function lastMatch(text, terms) {
  let last = -1;
  for (const term of terms) {
    for (const m of text.matchAll(termPattern(term))) last = Math.max(last, m.index);
  }
  return last;
}

/**
 * Only what the caller said: the agent's own lines ("you sound in danger") must not
 * escalate a call. Joined with spaces because Retell splits one sentence across turns
 * ("User: I'm about" / "Agent: …" / "User: to die"). Unlabelled text (web reports) is returned as is.
 */
export function callerText(transcript = '') {
  const lines = transcript.split('\n');
  if (!lines.some((l) => /^(Agent|User):/.test(l))) return transcript;
  return lines
    .filter((l) => l.startsWith('User:'))
    .map((l) => l.slice('User:'.length).trim())
    .join(' ');
}

function pick(value, allowed) {
  if (typeof value !== 'string') return null;
  const match = allowed.find((a) => a.toLowerCase() === value.trim().toLowerCase());
  return match || null;
}

/**
 * Keyword triage of the caller's words. `retracted: true` (only present when set) means
 * the caller took back a danger claim after making it ("never mind, I was joking").
 */
export function classifyText(text = '') {
  let t = text.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ');
  for (const [phrase, replacement] of Object.entries(BENIGN_PHRASES)) t = t.replaceAll(phrase, replacement);

  // A retraction only counts if no danger is mentioned after it ("never mind, he has a gun").
  const lastCritical = lastMatch(t, CRITICAL_TERMS);
  const retracted = lastMatch(t, lastCritical >= 0 ? RETRACTIONS : JOKE_RETRACTIONS) > lastCritical;

  let category = DEFAULT_CATEGORY;
  let best = 0;
  for (const cat of CATEGORIES) {
    if (retracted && cat === EMERGENCY) continue;
    const score = countMatches(t, KEYWORDS[cat]);
    if (score > best) {
      best = score;
      category = cat;
    }
  }

  let urgency = 'Standard';
  if (!retracted && lastCritical >= 0) {
    urgency = 'Critical';
    category = EMERGENCY;
  } else if (category === EMERGENCY || category === HAZARDS || countMatches(t, URGENT_TERMS) > 0) {
    urgency = 'Urgent';
  }
  return retracted ? { ...couple(category, urgency), retracted } : couple(category, urgency);
}

const URGENCY_RANK = ['Standard', 'Urgent', 'Critical'];

/**
 * Keeps category and urgency consistent: Critical always files under Emergency,
 * Emergency is always Critical, and Hazards are at least Urgent.
 */
export function couple(category, urgency) {
  if (urgency === 'Critical' || category === EMERGENCY) return { category: EMERGENCY, urgency_level: 'Critical' };
  if (category === HAZARDS && URGENCY_RANK.indexOf(urgency) < URGENCY_RANK.indexOf('Urgent')) {
    return { category, urgency_level: 'Urgent' };
  }
  return { category, urgency_level: urgency };
}

export function statusForUrgency(urgency) {
  if (urgency === 'Critical') return 'Escalated to 911';
  if (urgency === 'Urgent') return 'Escalated to Human';
  return 'AI Completed';
}

/**
 * @param {object} call Retell call object (from retell.call.retrieve)
 * @returns {{category, urgency_level, status, summary, location, caller_name}}
 */
export function triageCall(call = {}) {
  const analysis = call.call_analysis || {};
  const custom = analysis.custom_analysis_data || {};
  const transcript = call.transcript || '';
  // The summary is the LLM's paraphrase; only fall back to it when there is no transcript.
  const fallback = classifyText(transcript ? callerText(transcript) : analysis.call_summary || '');

  let urgency = pick(custom.urgency_level, URGENCY_LEVELS) || fallback.urgency_level;
  let llmCategory = pick(custom.category, CATEGORIES);
  if (fallback.retracted) {
    // The caller took the danger back and said they're safe: nothing to dispatch.
    if (urgency === 'Critical') urgency = 'Standard';
    if (llmCategory === EMERGENCY) llmCategory = null;
  } else if (fallback.urgency_level === 'Critical') {
    // Never let the LLM downgrade something the keyword safety net flags as Critical.
    urgency = 'Critical';
  }
  const { category, urgency_level } = couple(llmCategory || fallback.category, urgency);

  const summary =
    (typeof custom.summary === 'string' && custom.summary.trim()) ||
    (typeof analysis.call_summary === 'string' && analysis.call_summary.trim()) ||
    (transcript ? transcript.slice(0, 280) : 'No summary available.');

  return {
    category,
    urgency_level,
    status: statusForUrgency(urgency_level),
    summary,
    location: typeof custom.location === 'string' && custom.location.trim() ? custom.location.trim().slice(0, 255) : null,
    caller_name:
      typeof custom.caller_name === 'string' && custom.caller_name.trim() ? custom.caller_name.trim().slice(0, 100) : null,
  };
}
