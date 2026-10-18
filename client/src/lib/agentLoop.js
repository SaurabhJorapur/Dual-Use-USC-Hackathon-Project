// Flags an AI agent stuck repeating itself, so the dispatcher can step in.

// Short acknowledgements ("Okay.", "Got it.") repeat naturally and are not loops.
const MIN_WORDS = 4;
// Word overlap at which two turns count as the same prompt (tolerates small rephrasing).
const SAME_TURN = 0.8;
// How many earlier agent turns the latest is compared with: 2 catches A A and A B A.
const LOOKBACK = 2;

const words = (text) =>
  (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

function overlap(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  let shared = 0;
  for (const w of sa) if (sb.has(w)) shared += 1;
  return shared / (sa.size + sb.size - shared);
}

/** Parses a stored "Agent: …\nUser: …" transcript into Retell-style turns. */
export function parseTranscript(text) {
  return (text || '')
    .split('\n')
    .map((line) => /^(Agent|User):\s*(.*)$/.exec(line.trim()))
    .filter(Boolean)
    .map(([, who, content]) => ({ role: who === 'Agent' ? 'agent' : 'user', content }));
}

/**
 * @param {{ role: string, content: string }[]} turns Retell utterances, oldest first.
 * @returns {{ looping: boolean, phrase?: string }} phrase is the repeated agent line.
 */
export function detectAgentLoop(turns) {
  const agent = (turns || []).filter((t) => t.role === 'agent' && t.content?.trim());
  const last = agent.at(-1);
  if (!last) return { looping: false };
  const lastWords = words(last.content);
  if (lastWords.length < MIN_WORDS) return { looping: false };
  const repeated = agent.slice(-1 - LOOKBACK, -1).some((t) => overlap(words(t.content), lastWords) >= SAME_TURN);
  return repeated ? { looping: true, phrase: last.content.trim() } : { looping: false };
}
