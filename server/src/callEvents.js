// Applies Retell call lifecycle stages (started, ended, analyzed) to the calls table.
// Driven by retellSync, which polls Retell for them.
import { ensureCall, updateCall } from './callsRepo.js';
import { callerText, classifyText, statusForUrgency, triageCall } from './triage.js';
import { timelineEvent } from './timeline.js';
import { buildFormalReport } from './report.js';
import { config } from './config.js';

export const ENDED_EVENT = 'Call ended';
export const ANALYZED_EVENT = 'AI triage complete';
const TRANSFER_REASONS = ['call_transfer', 'transfer_bridged'];

// The agent has two transfers: escalate_call (emergency) and operator_transfer (dashboard takeover).
function transferEvent(call) {
  const toOperator = config.operatorTransferNumber && call.transfer_destination?.includes(config.operatorTransferNumber);
  return toOperator
    ? timelineEvent('Transferred to operator', 'Operator override from the dashboard', 'Escalated to Human')
    : timelineEvent('Transferred to emergency dispatch', 'Agent ran escalate_call', 'Escalated to 911');
}

export async function handleCallStarted(call) {
  await ensureCall(call);
}

export async function handleCallEnded(call) {
  await ensureCall(call);
  // Provisional triage from the transcript; refined once the analysis arrives.
  const { category, urgency_level } = classifyText(callerText(call.transcript || ''));
    const transferred = TRANSFER_REASONS.includes(call.disconnection_reason);
  const events = [timelineEvent(ENDED_EVENT, call.disconnection_reason ? `Reason: ${call.disconnection_reason.replace(/_/g, ' ')}` : undefined)];
  if (transferred) events.unshift(transferEvent(call));
  const row = await updateCall(
    call.call_id,
    {
      category,
      urgency_level,
      status: statusForUrgency(urgency_level),
      transcript: call.transcript || null,
      audio_url: call.recording_url || null,
    },
    events,
  );
  // Provisional report; replaced by the AI version once the analysis arrives.
  await updateCall(call.call_id, { formal_report: buildFormalReport({ row }) });
}

export async function handleCallAnalyzed(call) {
  await ensureCall(call);
  const triage = triageCall(call);
  const patch = { ...triage };
  if (call.transcript) patch.transcript = call.transcript;
  if (call.recording_url) patch.audio_url = call.recording_url;
  const row = await updateCall(call.call_id, patch, [timelineEvent(ANALYZED_EVENT, `${triage.category} · ${triage.urgency_level}`)]);
  await updateCall(call.call_id, { formal_report: buildFormalReport({ row, call }) });
}
