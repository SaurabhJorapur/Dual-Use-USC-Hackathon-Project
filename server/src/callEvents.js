// Applies Retell call lifecycle events to the calls table. Shared by the webhook
// route (Retell pushes events) and retellSync (we poll Retell for them).
import { ensureCall, updateCall } from './callsRepo.js';
import { classifyText, statusForUrgency, triageCall } from './triage.js';
import { timelineEvent } from './timeline.js';
import { buildFormalReport } from './report.js';

export const ENDED_EVENT = 'Call ended';
export const ANALYZED_EVENT = 'AI triage complete';
const TRANSFER_REASONS = ['call_transfer', 'transfer_bridged'];

export async function handleCallStarted(call) {
  await ensureCall(call);
}

export async function handleCallEnded(call) {
  await ensureCall(call);
  // Provisional triage from the transcript; refined once the analysis arrives.
  const { category, urgency_level } = classifyText(call.transcript || '');
  // The only transfer the agent has is escalate_call, the emergency dispatch transfer.
  const transferred = TRANSFER_REASONS.includes(call.disconnection_reason);
  const events = [timelineEvent(ENDED_EVENT, call.disconnection_reason ? `Reason: ${call.disconnection_reason.replace(/_/g, ' ')}` : undefined)];
  if (transferred) events.unshift(timelineEvent('Transferred to emergency dispatch', 'Agent ran escalate_call', 'Escalated to 911'));
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
