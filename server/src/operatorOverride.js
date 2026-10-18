// "Take Over Call (Operator Override)" from the dashboard: Retell has no API that
// transfers a live call directly, so the agent is told to run its operator_transfer tool.
import { config } from './config.js';
import { retell } from './retell.js';
import { getCall, updateCall } from './callsRepo.js';
import { timelineEvent } from './timeline.js';

export const OPERATOR_INSTRUCTION = 'A human operator has taken over this call. Follow the OPERATOR OVERRIDE rule now and call operator_transfer.';

const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });

export async function requestOperatorTransfer(id) {
  if (!retell) throw fail(503, 'RETELL_API_KEY is not configured');
  if (!config.operatorTransferNumber) throw fail(409, 'OPERATOR_TRANSFER_NUMBER is not set, so there is no operator line to transfer to');
  const row = await getCall(id);
  if (!row) throw fail(404, 'Call not found');

  let call;
  try {
    call = await retell.call.retrieve(row.retell_call_id);
  } catch (err) {
    if (err.status === 404) throw fail(409, 'This is not a live Retell call');
    throw err;
  }
  if (call.call_status !== 'ongoing') throw fail(409, 'The call has already ended');
  if (call.call_type === 'web_call') throw fail(409, 'Browser test calls cannot be transferred to a phone. Use a real phone call');

  await retell.call.updateLive(call.call_id, { call_control: { additional_context: OPERATOR_INSTRUCTION, trigger_response: true } });
  return updateCall(call.call_id, {}, [
    timelineEvent('Operator override', `Agent told to transfer the caller to ${config.operatorTransferNumber}`, 'Escalated to Human'),
  ]);
}
