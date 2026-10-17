import { Router } from 'express';
import { supabase } from '../supabase.js';
import { geocode } from '../geocode.js';

// Preemptive maintenance crews dispatched from the Predictive Maintenance view.
const router = Router();

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

router.get('/', async (_req, res, next) => {
  try {
    const { data, error } = await supabase.from('maintenance_dispatches').select('*').order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// Used by the calculator to locate a typed address/zip and count nearby reports.
router.get('/geocode', async (req, res, next) => {
  try {
    const point = await geocode(String(req.query.q || '').slice(0, 255));
    if (!point) return res.status(404).json({ error: 'Location not found in the Los Angeles area' });
    res.json(point);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { location, latitude, longitude, probability, inputs } = req.body || {};
    if (typeof location !== 'string' || !location.trim()) return res.status(400).json({ error: 'location is required' });
    if (!isNum(probability) || probability < 0 || probability > 100) return res.status(400).json({ error: 'probability must be 0-100' });

    const point = isNum(latitude) && isNum(longitude) ? { lat: latitude, lng: longitude } : await geocode(location);
    const { data, error } = await supabase
      .from('maintenance_dispatches')
      .insert({
        location: location.trim().slice(0, 255),
        latitude: point?.lat ?? null,
        longitude: point?.lng ?? null,
        probability: Math.round(probability),
        inputs: inputs && typeof inputs === 'object' ? inputs : {},
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
