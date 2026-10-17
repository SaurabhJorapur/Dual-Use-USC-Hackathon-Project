import Retell from 'retell-sdk';
import { config } from './config.js';

export const retell = config.retellApiKey ? new Retell({ apiKey: config.retellApiKey }) : null;

/**
 * Express middleware: rejects requests whose x-retell-signature doesn't match the raw body.
 * Requires express.json({ verify }) to have stashed req.rawBody.
 */
export async function verifyRetellSignature(req, res, next) {
  if (!config.verifyWebhooks) return next();
  if (!config.retellApiKey) {
    return res.status(500).json({ error: 'RETELL_API_KEY not configured' });
  }
  const signature = req.get('x-retell-signature');
  if (!signature || !req.rawBody) {
    return res.status(401).json({ error: 'Missing Retell signature' });
  }
  try {
    const valid = await Retell.verify(req.rawBody, config.retellApiKey, signature);
    if (!valid) return res.status(401).json({ error: 'Invalid Retell signature' });
    next();
  } catch (err) {
    console.error('[retell] signature verification failed:', err.message);
    res.status(401).json({ error: 'Invalid Retell signature' });
  }
}
