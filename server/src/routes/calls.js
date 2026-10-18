import { Router } from 'express';
import { getCall, getStats, listCalls, setStatus } from '../callsRepo.js';
import { requestOperatorTransfer } from '../operatorOverride.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    res.json(await listCalls(req.query));
  } catch (err) {
    next(err);
  }
});

router.get('/stats', async (_req, res, next) => {
  try {
    res.json(await getStats());
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const call = await getCall(req.params.id);
    if (!call) return res.status(404).json({ error: 'Call not found' });
    res.json(call);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    const call = await setStatus(req.params.id, req.body?.status, req.body?.note);
    if (!call) return res.status(404).json({ error: 'Call not found' });
    res.json(call);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/takeover', async (req, res, next) => {
  try {
    res.json(await requestOperatorTransfer(req.params.id));
  } catch (err) {
    next(err);
  }
});

export default router;
