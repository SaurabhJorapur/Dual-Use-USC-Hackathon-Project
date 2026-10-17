import { Router } from 'express';
import { config } from '../config.js';
import { retell } from '../retell.js';

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

export default router;
