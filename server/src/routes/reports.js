import { Router } from 'express';
import { supabase } from '../supabase.js';
import { getByRetellId, updateCall } from '../callsRepo.js';
import { timelineEvent } from '../timeline.js';
import { rateLimit } from '../rateLimit.js';
import { buildWebFormalReport, createWebReportService } from '../webReports.js';

// Public endpoint for the offline-first crisis report form (see webReports.js).
const router = Router();

async function insertIfAbsent(row) {
  const { data, error } = await supabase
    .from('calls')
    .upsert(row, { onConflict: 'retell_call_id', ignoreDuplicates: true })
    .select()
    .maybeSingle();
  if (error) throw error;
  if (data) return { row: data, created: true };
  // ignoreDuplicates returns no row: this id was already stored (a retry after a lost acknowledgement).
  const existing = await getByRetellId(row.retell_call_id);
  if (!existing) throw new Error(`Report ${row.retell_call_id} was neither inserted nor found`);
  return { row: existing, created: false };
}

async function processReport(row) {
  // Geocode a typed location unless the device sent coordinates. updateCall also queues clustering.
  const located = row.location && row.latitude == null ? await updateCall(row.retell_call_id, { location: row.location }) : row;
  await updateCall(row.retell_call_id, { formal_report: buildWebFormalReport(located) }, [timelineEvent('Incident report generated')]);
}

const inFlight = new Set();
function queueProcessing(row) {
  if (inFlight.has(row.retell_call_id)) return;
  inFlight.add(row.retell_call_id);
  processReport(row)
    .catch((err) => console.error(`[reports] processing ${row.retell_call_id} failed:`, err.message || err))
    .finally(() => inFlight.delete(row.retell_call_id));
}

const submit = createWebReportService({ insertIfAbsent, queueProcessing });

router.post(
  '/',
  rateLimit({ windowMs: 10 * 60_000, max: 60, message: 'Too many reports from this connection. Your report is saved and will be retried.' }),
  async (req, res, next) => {
    try {
      const { created, ack } = await submit(req.body);
      // Sent only after the row is stored, so the browser can safely drop its copy.
      res.status(created ? 201 : 200).json(ack);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
