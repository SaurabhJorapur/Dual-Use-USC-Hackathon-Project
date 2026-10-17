import { Router } from 'express';
import { verifyRetellSignature } from '../retell.js';
import { handleCallAnalyzed, handleCallEnded, handleCallStarted } from '../callEvents.js';

const router = Router();

const HANDLERS = {
  call_started: handleCallStarted,
  call_ended: handleCallEnded,
  call_analyzed: handleCallAnalyzed,
};

// Retell webhook: call_started -> call_ended -> call_analyzed
router.post('/retell', verifyRetellSignature, async (req, res) => {
  const { event, call } = req.body || {};
  if (!event || !call?.call_id) return res.status(400).json({ error: 'Invalid webhook payload' });

  try {
    // Other event types (e.g. transcript_updated) are acknowledged and ignored.
    await HANDLERS[event]?.(call);
    res.status(204).end();
  } catch (err) {
    console.error(`[webhook] ${event} for ${call.call_id} failed:`, err);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

export default router;
