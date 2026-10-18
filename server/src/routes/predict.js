import { Router } from 'express';
import { getRiskMap, parsePredictInput, predictDegradation } from '../degradation.js';

// Public safety risk model (crime + traffic collisions): live predictions and the precomputed hotspot map.
const router = Router();

router.post('/', async (req, res, next) => {
  try {
    res.json(await predictDegradation(parsePredictInput(req.body)));
  } catch (err) {
    next(err);
  }
});

router.get('/hotspots', (_req, res, next) => {
  try {
    res.json(getRiskMap());
  } catch (err) {
    next(err);
  }
});

export default router;
