// Builds formal incident reports for calls that don't have one yet (e.g. calls
// made before reports existed). Uses Retell's post-call analysis when the call
// is still available there, otherwise derives the report from the stored row.
//
// Also geocodes calls that have a location but no map coordinates yet.
//
// Usage: npm run backfill:reports            (only calls without a report)
//        npm run backfill:reports -- --all   (regenerate every report)
import { assertConfig } from '../src/config.js';

assertConfig();
const { supabase } = await import('../src/supabase.js');
const { retell } = await import('../src/retell.js');
const { buildFormalReport } = await import('../src/report.js');
const { buildWebFormalReport, isWebReport } = await import('../src/webReports.js');
const { coordinatesFor } = await import('../src/callsRepo.js');

const all = process.argv.includes('--all');
const { data: everything, error } = await supabase.from('calls').select('*');
if (error) throw error;

let geocoded = 0;
for (const row of everything) {
  if (row.latitude != null || !row.location) continue;
  const coords = await coordinatesFor(row, row.location);
  if (!coords.latitude) continue;
  const { error: geoError } = await supabase.from('calls').update(coords).eq('id', row.id);
  if (geoError) throw geoError;
  geocoded++;
}
if (geocoded) console.log(`Geocoded ${geocoded} call location(s).`);

const rows = all ? everything : everything.filter((r) => r.formal_report == null);
let ai = 0;
for (const row of rows) {
  if (isWebReport(row)) {
    const { error: updateError } = await supabase.from('calls').update({ formal_report: buildWebFormalReport(row) }).eq('id', row.id);
    if (updateError) throw updateError;
    continue;
  }
  let call;
  if (retell && !row.retell_call_id.startsWith('demo_')) {
    call = await retell.call.retrieve(row.retell_call_id).catch(() => undefined);
  }
  const report = buildFormalReport({ row, call });
  if (report.source === 'ai') ai++;
  const { error: updateError } = await supabase.from('calls').update({ formal_report: report }).eq('id', row.id);
  if (updateError) throw updateError;
}
console.log(`Backfilled ${rows.length} report(s) (${ai} from AI analysis, ${rows.length - ai} derived).`);
