// Polls Retell for this agent's recent calls and applies any lifecycle stages the
// database hasn't seen yet. Lets the dashboard work without a public webhook URL.
import { config } from './config.js';
import { retell } from './retell.js';
import { getByRetellId } from './callsRepo.js';
import { ANALYZED_EVENT, ENDED_EVENT, handleCallAnalyzed, handleCallEnded, handleCallStarted } from './callEvents.js';

const STAGES = ['none', 'started', 'ended', 'analyzed'];

function stageOf(row) {
  if (!row) return 'none';
  const events = (row.escalation_timeline || []).map((e) => e.event);
  if (events.includes(ANALYZED_EVENT)) return 'analyzed';
  if (events.includes(ENDED_EVENT)) return 'ended';
  return 'started';
}

const before = (stage, target) => STAGES.indexOf(stage) < STAGES.indexOf(target);

async function syncCall(item) {
  // 'registered' = token issued but nobody joined yet; skip so abandoned test calls don't linger.
  if (item.call_status !== 'ongoing' && item.call_status !== 'ended') return;
  const stage = stageOf(await getByRetellId(item.call_id));
  if (stage === 'analyzed') return;

  if (item.call_status === 'ongoing') {
    if (stage === 'none') await handleCallStarted(item);
    return;
  }

  // List results can be partial; fetch the full call (transcript, recording, analysis).
  const call = await retell.call.retrieve(item.call_id);
  if (before(stage, 'ended')) await handleCallEnded(call);
  if (call.call_analysis) await handleCallAnalyzed(call);
}

export function startRetellSync(intervalMs = 5000) {
  if (!retell || !config.retellAgentId) {
    console.warn('[sync] RETELL_SYNC is on but RETELL_API_KEY / RETELL_AGENT_ID are missing; not polling.');
    return;
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { items } = await retell.call.list({
        filter_criteria: { agent: [{ agent_id: config.retellAgentId }] },
        sort_order: 'descending',
        limit: 25,
      });
      // Oldest first, so rows (and their incident numbers) are created in call order.
      for (const item of [...items].reverse()) {
        try {
          await syncCall(item);
        } catch (err) {
          console.error(`[sync] call ${item.call_id} failed:`, err.message || err);
        }
      }
    } catch (err) {
      console.error('[sync] listing Retell calls failed:', err.message || err);
    } finally {
      running = false;
    }
  };
  tick();
  setInterval(tick, intervalMs);
  console.log(`[sync] Polling Retell for calls every ${intervalMs / 1000}s (no webhook needed).`);
}
