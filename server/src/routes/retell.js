import { Router } from 'express';
import { config } from '../config.js';
import { retell, verifyRetellSignature } from '../retell.js';
import { ensureCall, updateCall } from '../callsRepo.js';
import { CATEGORIES } from '../triage.js';
import { timelineEvent } from '../timeline.js';

const router = Router();

// Creates a browser-based test call so the agent can be demoed from the dashboard.
router.post('/web-call', async (_req, res) => {
  if (!retell || !config.retellAgentId) {
    return res.status(503).json({ error: 'RETELL_API_KEY and RETELL_AGENT_ID must be configured' });
  }
  try {
    const webCall = await retell.call.createWebCall({ agent_id: config.retellAgentId });
    // The browser SDK must be told the transport: it can't infer it from the token and
    // defaults to LiveKit, which rejects gateway tokens.
    res.json({
      access_token: webCall.access_token,
      call_id: webCall.call_id,
      transport: webCall.transport,
      ice_servers: webCall.ice_servers,
    });
  } catch (err) {
    console.error('[retell] createWebCall failed:', err.message);
    res.status(502).json({ error: 'Failed to create Retell web call' });
  }
});

// Custom functions invoked by the Retell agent mid-call. Retell sends
// { name, call, args } and reads the response body back to the LLM.
router.post('/functions/:name', verifyRetellSignature, async (req, res) => {
  const { call, args = {} } = req.body || {};
  if (!call?.call_id) return res.status(400).json({ error: 'Missing call context' });

  try {
    await ensureCall(call);

    switch (req.params.name) {
      case 'escalate_emergency': {
        await updateCall(
          call.call_id,
          {
            category: 'Public Safety',
            urgency_level: 'Critical',
            status: 'Escalated to 911',
            location: args.location || null,
            caller_name: args.caller_name || null,
            summary: args.details ? `EMERGENCY: ${args.details}` : 'Emergency reported, escalated to 911.',
          },
          [
            timelineEvent('Emergency detected by AI agent', args.emergency_type || undefined),
            timelineEvent('Escalated to 911 dispatch', args.location ? `Location: ${args.location}` : 'Location not yet confirmed', 'Escalated to 911'),
          ],
        );
        return res.json({
          result: 'Emergency recorded and flagged for 911 dispatch. Tell the caller help is being sent, keep them safe, and transfer them to the emergency line now.',
        });
      }

      case 'request_human': {
        await updateCall(
          call.call_id,
          { urgency_level: 'Urgent', status: 'Escalated to Human' },
          [timelineEvent('Escalated to human dispatcher', args.reason || undefined, 'Escalated to Human')],
        );
        return res.json({ result: 'A human dispatcher has been flagged. Let the caller know you are transferring them.' });
      }

      case 'log_service_request': {
        const category = CATEGORIES.includes(args.category) ? args.category : 'Noise & Other';
        const updated = await updateCall(
          call.call_id,
          {
            category,
            location: args.location || null,
            caller_name: args.caller_name || null,
            ...(args.description ? { summary: args.description } : {}),
          },
          [timelineEvent('Service request logged', `${category}${args.location ? ` at ${args.location}` : ''}`)],
        );
        const ticket = `SR-${updated.id.slice(0, 8).toUpperCase()}`;
        return res.json({ result: `Service request logged with reference number ${ticket.split('').join(' ')}. Read it back to the caller.`, ticket });
      }

      default:
        return res.status(404).json({ error: `Unknown function "${req.params.name}"` });
    }
  } catch (err) {
    console.error(`[retell] function ${req.params.name} failed:`, err);
    res.status(500).json({ result: 'There was a problem saving that. Apologize and continue collecting details.' });
  }
});

export default router;
