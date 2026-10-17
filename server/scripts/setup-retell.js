// Creates (or updates) the Retell agent: prompt (from prompts/retell_system_prompt.md),
// emergency transfer and post-call analysis. Re-run whenever the prompt or transfer
// number changes. The server polls Retell for calls, so no public URL is needed.
//
// Usage: npm run setup:retell
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Retell from 'retell-sdk';
import { config } from '../src/config.js';
import { CATEGORIES, URGENCY_LEVELS } from '../src/triage.js';
import { DISPATCH_OPTIONS } from '../src/report.js';

const ROOT_ENV = fileURLToPath(new URL('../../.env', import.meta.url));
const MODEL = 'gpt-6-luna';
const VOICE_ID = 'retell-Cimo';
const AGENT_NAME = 'CivicLine Dispatch';

if (!config.retellApiKey) {
  console.error('RETELL_API_KEY is not set in .env');
  process.exit(1);
}

const retell = new Retell({ apiKey: config.retellApiKey });

// The prompt lives in prompts/retell_system_prompt.md; <<PLACEHOLDERS>> depend on the transfer number.
// (Not {{ }}: Retell treats that syntax as its own dynamic variables.)
const PROMPT_FILE = fileURLToPath(new URL('../../prompts/retell_system_prompt.md', import.meta.url));

// Emergency transfer target: a phone the operator controls. Never real 911.
const transferNumber = (process.env.DISPATCH_TRANSFER_NUMBER || '').trim();
if (transferNumber && !/^\+[1-9]\d{9,14}$/.test(transferNumber)) {
  console.error('DISPATCH_TRANSFER_NUMBER must be a full E.164 number like +12135551234 (short codes such as 911 are refused).');
  process.exit(1);
}
const hasTransfer = Boolean(transferNumber);

const fill = {
  // Only claim to connect the caller when a real transfer exists.
  EMERGENCY_SCRIPT: hasTransfer
    ? 'I am connecting you to an emergency dispatch team right now. Please stay on the line.'
    : 'This is an emergency. Please hang up and dial 911 now.',
  EMERGENCY_ACTION: hasTransfer
    ? 'Immediately call `escalate_call`. Do not say anything else before calling it.'
    : 'Do not ask any questions. If the caller keeps talking, calmly repeat the line above.',
};

const PROMPT = readFileSync(PROMPT_FILE, 'utf8').replace(/<<([A-Z_]+)>>/g, (m, key) => {
  if (!(key in fill)) throw new Error(`Unknown placeholder ${m} in ${PROMPT_FILE}`);
  return fill[key];
});

const endCall = { type: 'end_call', name: 'end_call', description: 'End the call once the report is complete or the caller says goodbye.' };

// Retell's built-in transfer: Retell places the call itself.
const escalateCall = {
  type: 'transfer_call',
  name: 'escalate_call',
  description: 'Immediately transfer the caller to emergency dispatch. Use the moment any life-safety danger is mentioned.',
  transfer_destination: { type: 'predefined', number: transferNumber },
  transfer_option: { type: 'cold_transfer', show_transferee_as_caller: true },
  speak_during_execution: false,
};

const llmParams = {
  model: MODEL,
  general_prompt: PROMPT,
  general_tools: [endCall, ...(hasTransfer ? [escalateCall] : [])],
  start_speaker: 'agent',
  begin_message: "City services line. I'm an AI assistant. If this is a life-threatening emergency, tell me right away. What would you like to report?",
};

const agentParams = {
  agent_name: AGENT_NAME,
  voice_id: VOICE_ID,
  language: 'en-US',
  // No webhook: the server polls Retell. Null also clears a URL left over from an older setup.
  webhook_url: null,
  webhook_events: null,
  post_call_analysis_data: [
    { type: 'enum', name: 'category', description: 'The type of issue the caller reported.', choices: CATEGORIES },
    {
      type: 'enum',
      name: 'urgency_level',
      description: 'Critical = threat to life or safety needing 911. Urgent = immediate hazard needing a human dispatcher. Standard = routine service request.',
      choices: URGENCY_LEVELS,
    },
    { type: 'string', name: 'summary', description: 'One or two sentence summary for a city dispatcher.' },
    { type: 'string', name: 'location', description: 'Location of the incident as stated by the caller. Empty if not given.' },
    { type: 'string', name: 'caller_name', description: "The caller's name, if given. Empty if not given." },
    // Formal incident report fields (assembled into calls.formal_report by server/src/report.js)
    {
      type: 'string',
      name: 'executive_summary',
      description: 'A formal 2-3 sentence summary in official municipal incident report tone (third person, past tense, no speculation).',
    },
    {
      type: 'enum',
      name: 'dispatch_recommendation',
      description: 'The agency that should handle this incident.',
      choices: DISPATCH_OPTIONS,
    },
    { type: 'string', name: 'incident_type', description: 'Specific incident type, e.g. "Armed robbery in progress", "Pothole", "Water main break".' },
    { type: 'string', name: 'involved_parties', description: 'People or vehicles involved as described by the caller (e.g. "Caller; one armed male suspect"). "Caller only" if none.' },
    {
      type: 'string',
      name: 'key_facts',
      description: 'Verified facts stated in the call, one per line, no bullets. Only facts the caller actually said.',
    },
  ],
};

/** Sets KEY=value in the root .env, optionally leaving a comment above it. */
function setEnv(key, value, note) {
  const env = readFileSync(ROOT_ENV, 'utf8');
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  const line = `${note ? `# ${note}\n` : ''}${key}=${value}`;
  writeFileSync(ROOT_ENV, pattern.test(env) ? env.replace(pattern, line) : `${env.trimEnd()}\n${line}\n`);
}

async function existingRetellLlmAgent() {
  if (!config.retellAgentId) return null;
  try {
    const agent = await retell.agent.retrieve(config.retellAgentId);
    return agent.response_engine?.type === 'retell-llm' ? agent : null;
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

let agent = await existingRetellLlmAgent();
if (agent) {
  // Published versions are immutable: branch a new draft, edit it, then publish below.
  if (agent.is_published) {
    await retell.agent.createVersion(agent.agent_id, { base_version: agent.version });
    agent = await retell.agent.retrieve(agent.agent_id);
  }
  const { llm_id, version: llmVersion } = agent.response_engine;
  await retell.llm.update(llm_id, { ...llmParams, ...(llmVersion != null ? { version: llmVersion } : {}) });
  agent = await retell.agent.update(agent.agent_id, { ...agentParams, version: agent.version });
  console.log(`Updated agent ${agent.agent_id}`);
} else {
  const llm = await retell.llm.create(llmParams);
  agent = await retell.agent.create({ ...agentParams, response_engine: { type: 'retell-llm', llm_id: llm.llm_id } });
  setEnv('RETELL_AGENT_ID', agent.agent_id, config.retellAgentId ? `Previous agent (left untouched): ${config.retellAgentId}` : undefined);
  console.log(`Created agent ${agent.agent_id} and saved it as RETELL_AGENT_ID in .env`);
  if (config.retellAgentId) console.log(`(Previous agent ${config.retellAgentId} was not modified.)`);
}

try {
  await retell.agent.publish(agent.agent_id, { version: agent.version, version_title: `Setup ${new Date().toISOString()}` });
} catch (err) {
  // Publish succeeds with an empty body, which this SDK version fails to parse as JSON.
  if (!(err instanceof SyntaxError)) throw err;
}

console.log(`\nPublished version ${agent.version}`);

// Phone numbers are pinned to an agent version; move ours to the one just published.
const numbers = await retell.phoneNumber.list();
for (const number of Array.isArray(numbers) ? numbers : numbers.items || []) {
  const patch = {};
  for (const key of ['inbound_agents', 'outbound_agents']) {
    const routes = number[key] || [];
    if (!routes.some((r) => r.agent_id === agent.agent_id)) continue;
    patch[key] = routes.map((r) => (r.agent_id === agent.agent_id ? { ...r, agent_version: agent.version } : r));
  }
  if (!Object.keys(patch).length) continue;
  await retell.phoneNumber.update(number.phone_number, patch);
  console.log(`  Phone ${number.phone_number} → version ${agent.version}`);
}
console.log(hasTransfer
  ? `  Emergency transfer (escalate_call): ${transferNumber}`
  : '  No DISPATCH_TRANSFER_NUMBER: emergencies get "hang up and dial 911" instead of a transfer.');
console.log('\nRestart the server so it picks up the changes, then use "Test call" on the dashboard.');
