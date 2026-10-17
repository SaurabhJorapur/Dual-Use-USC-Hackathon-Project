// Creates (or updates) the Retell agent wired to this server: prompt, custom
// functions, webhook and post-call analysis. Re-run whenever the public URL changes.
//
// Usage: npm run setup:retell -- https://your-public-url.example.com
//        npm run setup:retell                (no public URL: server polls Retell instead,
//                                             no mid-call functions)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Retell from 'retell-sdk';
import { config } from '../src/config.js';
import { CATEGORIES, URGENCY_LEVELS } from '../src/triage.js';

const ROOT_ENV = fileURLToPath(new URL('../../.env', import.meta.url));
const MODEL = 'gpt-6-luna';
const VOICE_ID = 'retell-Cimo';
const AGENT_NAME = 'CivicLine Dispatch';

const baseUrl = (process.argv[2] || '').replace(/\/+$/, '');
if (baseUrl && !/^https:\/\//.test(baseUrl)) {
  console.error('Usage: npm run setup:retell [-- https://your-public-url]  (URL must be https and reachable by Retell)');
  process.exit(1);
}
const hasUrl = Boolean(baseUrl);
if (!config.retellApiKey) {
  console.error('RETELL_API_KEY is not set in .env');
  process.exit(1);
}

const retell = new Retell({ apiKey: config.retellApiKey });

// Without a public URL the agent has no custom functions, so the prompt asks it to
// collect details instead; triage then comes from post-call analysis.
const act = hasUrl
  ? {
      emergency: '- Call `escalate_emergency` IMMEDIATELY with what you know. Do not wait for full details.',
      emergencySay: 'Say: "I am flagging this for emergency dispatch right now. If anyone is in immediate danger, please hang up and dial 911."',
      emergencyLocation: 'Call `escalate_emergency` again if you learn the location afterwards.',
      hazard: '- Collect the location, then call `request_human` with the reason.',
      hazardTell: 'Tell the caller a city dispatcher has been alerted and will follow up urgently.',
      report: '- Call `log_service_request` once you have the information.\n   - Read back the reference number it returns, thank the caller, and end the call.',
      failure: '- If a tool fails, tell the caller:',
    }
  : {
      emergency: '- Treat it as top priority. Do not collect non-essential details.',
      // Nothing alerts anyone mid-call in this mode, so never imply help is on the way.
      emergencySay: 'Say: "Please hang up and dial 911 now if anyone is in immediate danger. I am also recording this for city dispatch."',
      emergencyLocation: '',
      hazard: '- Collect the location and a short description.',
      hazardTell: 'Tell the caller the report is being flagged as urgent for a city dispatcher to review. If anyone is in danger, they should dial 911.',
      report: '- Confirm the details back to the caller, tell them the report has been recorded for the city, thank them, and end the call.',
      failure: '- If you cannot help, tell the caller:',
    };

const PROMPT = `# Role
You are a calm, clear, and empathetic City Assistant for the City Administration. Your job is to answer non-emergency municipal reports while immediately spotting life-threatening emergencies. You are an AI assistant; say so if asked.

# Triage Rules
Decide within your first one or two turns which category the call is. If unsure, treat it as an emergency.

1. Emergency (active crime, robbery, weapons, violence, crash with injuries, fire, someone not breathing or trapped):
   ${act.emergency}
   - ${act.emergencySay}
   - Ask for the exact location if you don't have it, and whether the caller is safe.${act.emergencyLocation ? ` ${act.emergencyLocation}` : ''}
   - Keep sentences short and calm.

2. Urgent hazard (downed power lines, gas smell, traffic signals out at a busy intersection, large pothole on a highway, flooding):
   ${act.hazard}
   - ${act.hazardTell}

3. Non-urgent report (pothole, broken traffic light, noise complaint, graffiti, streetlight):
   - Collect the specific street location (address or cross streets), a short description, and optionally the caller's name.
   ${act.report}

# Strict Safety Boundaries
- Do NOT improvise medical, legal, or tactical advice.
- If a caller is in danger, repeat: "Are you in a safe place right now?"
${act.failure} "We cannot reach a human operator right now. If this is a life-threatening emergency, please hang up and dial 911 immediately."`;

const str = (description) => ({ type: 'string', description });

const endCall = { type: 'end_call', name: 'end_call', description: 'End the call once the report is complete or the caller says goodbye.' };

const customTools = [
  {
    type: 'custom',
    name: 'escalate_emergency',
    url: `${baseUrl}/api/retell/functions/escalate_emergency`,
    description: 'Flag a life-threatening emergency for 911 dispatch. Call immediately when an emergency is detected.',
    parameters: {
      type: 'object',
      properties: {
        emergency_type: str('Short label, e.g. "armed robbery", "car crash with injuries", "fire"'),
        location: str('Address, cross streets or landmark, if known'),
        details: str('One-sentence description of what is happening'),
        caller_name: str("Caller's name, if given"),
      },
      required: ['emergency_type'],
    },
    speak_during_execution: false,
    speak_after_execution: true,
  },
  {
    type: 'custom',
    name: 'request_human',
    url: `${baseUrl}/api/retell/functions/request_human`,
    description: 'Alert a human city dispatcher about an urgent, non-life-threatening hazard.',
    parameters: {
      type: 'object',
      properties: { reason: str('Why a human is needed, including the location') },
      required: ['reason'],
    },
    speak_during_execution: false,
    speak_after_execution: true,
  },
  {
    type: 'custom',
    name: 'log_service_request',
    url: `${baseUrl}/api/retell/functions/log_service_request`,
    description: 'Log a non-urgent city service request. Returns a reference number to read back to the caller.',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: CATEGORIES.filter((c) => c !== 'Public Safety'), description: 'Type of issue' },
        location: str('Street address or cross streets'),
        description: str('Short description of the issue'),
        caller_name: str("Caller's name, if given"),
      },
      required: ['category', 'location', 'description'],
    },
    speak_during_execution: true,
    execution_message_description: 'Let me log that for you.',
    speak_after_execution: true,
  },
];

const llmParams = {
  model: MODEL,
  general_prompt: PROMPT,
  general_tools: hasUrl ? [endCall, ...customTools] : [endCall],
  start_speaker: 'agent',
  begin_message: "City services line. I'm an AI assistant. If this is a life-threatening emergency, tell me right away. What would you like to report?",
};

const agentParams = {
  agent_name: AGENT_NAME,
  voice_id: VOICE_ID,
  language: 'en-US',
  webhook_url: hasUrl ? `${baseUrl}/webhooks/retell` : null,
  webhook_events: hasUrl ? ['call_started', 'call_ended', 'call_analyzed'] : null,
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
// With a webhook, Retell pushes events; without one, the server polls Retell for calls.
setEnv('RETELL_SYNC', hasUrl ? 'false' : 'true');

console.log(`\nPublished version ${agent.version}`);
if (hasUrl) {
  console.log(`  Webhook:   ${agentParams.webhook_url}
  Functions: ${baseUrl}/api/retell/functions/{escalate_emergency,request_human,log_service_request}`);
} else {
  console.log(`  No public URL: no webhook or mid-call functions. The server will poll Retell for calls
  (RETELL_SYNC=true). Rerun with a URL later to enable live escalations.`);
}
console.log('\nRestart the server so it picks up the changes, then use "Test call" on the dashboard.');
