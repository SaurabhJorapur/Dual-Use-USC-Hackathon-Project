// Inserts demo calls so the dashboard has data before any real calls come in.
// Usage: npm run seed            (add demo rows)
//        npm run seed -- --clear (remove demo rows)
import { assertConfig } from './config.js';

assertConfig();
const { supabase } = await import('./supabase.js');
const { buildFormalReport } = await import('./report.js');
const { geocode } = await import('./geocode.js');

const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
const ev = (m, event, detail) => ({ at: minutesAgo(m), event, ...(detail ? { detail } : {}) });

const demo = [
  {
    retell_call_id: 'demo_robbery_001', caller_phone: '+12135550142', caller_name: 'Maria Lopez',
    category: 'Emergency / Active Danger', urgency_level: 'Critical', status: 'Escalated to 911',
    summary: 'Caller witnessing an armed robbery in progress at a convenience store. Suspect has a handgun; two employees inside.',
    location: '3401 S Figueroa St, Los Angeles', created_at: minutesAgo(4),
    transcript: 'Agent: City services line, what are you reporting?\nUser: There is a guy with a gun robbing the 7-Eleven right now!\nAgent: I am escalating this to 911 immediately. Are you somewhere safe?\nUser: Yes, I am across the street.',
    escalation_timeline: [ev(4, 'Call received'), ev(4, 'Emergency detected by AI agent', 'Armed robbery'), ev(3, 'Escalated to 911 dispatch', 'Location: 3401 S Figueroa St')],
  },
  {
    retell_call_id: 'demo_accident_002', caller_phone: '+13105550177', caller_name: 'James Park',
    category: 'Emergency / Active Danger', urgency_level: 'Critical', status: 'Escalated to 911',
    summary: 'Two-car collision with one driver unresponsive. Vehicles blocking the northbound lanes.',
    location: 'Vermont Ave & W Jefferson Blvd', created_at: minutesAgo(18),
    escalation_timeline: [ev(18, 'Call received'), ev(18, 'Emergency detected by AI agent', 'Traffic collision with injuries'), ev(17, 'Escalated to 911 dispatch')],
  },
  {
    retell_call_id: 'demo_signal_003', caller_phone: '+12135550199', caller_name: null,
    category: 'Public Safety & Hazards', urgency_level: 'Urgent', status: 'Escalated to Human',
    summary: 'Traffic signals completely dark in all directions at a busy intersection during rush hour.',
    location: 'Exposition Blvd & Hoover St', created_at: minutesAgo(42),
    escalation_timeline: [ev(42, 'Call received'), ev(40, 'AI triage complete', 'Public Safety & Hazards · Urgent'), ev(40, 'Escalated to human dispatcher', 'Hazard to drivers and pedestrians')],
  },
  {
    retell_call_id: 'demo_pothole_004', caller_phone: '+13235550123', caller_name: 'Dev Patel',
    category: 'Roads & Infrastructure', urgency_level: 'Standard', status: 'AI Completed',
    summary: 'Medium-sized pothole in the right lane near the bus stop. Caller requested a repair ticket.',
    location: '1200 W 37th Pl', created_at: minutesAgo(95),
    escalation_timeline: [ev(95, 'Call received'), ev(93, 'Service request logged', 'Roads & Infrastructure at 1200 W 37th Pl'), ev(92, 'AI triage complete', 'Roads & Infrastructure · Standard')],
  },
  {
    retell_call_id: 'demo_noise_005', caller_phone: '+12135550111', caller_name: 'Sam Rivera',
    category: 'Code Enforcement & Sanitation', urgency_level: 'Standard', status: 'AI Completed',
    summary: 'Ongoing loud music from a neighboring property after midnight on a weeknight.',
    location: '2715 Portland St', created_at: minutesAgo(180),
    escalation_timeline: [ev(180, 'Call received'), ev(178, 'Service request logged', 'Code Enforcement & Sanitation at 2715 Portland St')],
  },
  {
    retell_call_id: 'demo_pothole_006', caller_phone: '+13105550165', caller_name: null,
    category: 'Public Safety & Hazards', urgency_level: 'Urgent', status: 'Escalated to Human',
    summary: 'Large, deep pothole on a freeway on-ramp; caller reports a flat tire and other cars swerving.',
    location: 'I-110 N on-ramp at Adams Blvd', created_at: minutesAgo(260),
    escalation_timeline: [ev(260, 'Call received'), ev(258, 'AI triage complete', 'Public Safety & Hazards · Urgent'), ev(258, 'Escalated to human dispatcher')],
  },
];

// Clustered road/utility reports over the past weeks, so the map has predictive
// hotspots and the surge chart has a shape. Coordinates are given, not geocoded.
const CLUSTERS = [
  { street: 'S Vermont Ave', lat: 34.0333, lng: -118.2915, issue: 'Pothole', category: 'Roads & Infrastructure' },
  { street: 'W Washington Blvd', lat: 34.0398, lng: -118.2668, issue: 'Water main leak', category: 'Utilities & Water' },
];
const REPORTS = {
  Pothole: ['Pothole reopened in the same lane that was patched last spring.', 'Crumbling asphalt and a growing pothole near the crosswalk.', 'Cracked pavement forming a deep pothole by the curb.'],
  'Water main leak': ['Water bubbling up through the pavement; road surface is sinking.', 'Recurring leak near a storm drain, asphalt is buckling.', 'Low water pressure and pooling water at the corner.'],
};
CLUSTERS.forEach((c, ci) => {
  for (let i = 0; i < 7; i++) {
    // Spread across ~60 days, with the newest few in the last day for the surge chart.
    const ago = i < 3 ? 60 * (2 + i * 5 + ci * 3) : 60 * 24 * (3 + i * 8 + ci);
    demo.push({
      retell_call_id: `demo_cluster_${ci}_${i}`, caller_phone: `+1213555${String(300 + ci * 10 + i).padStart(4, '0')}`, caller_name: null,
      category: c.category, urgency_level: 'Standard', status: 'AI Completed',
      summary: REPORTS[c.issue][i % 3],
      location: `${1400 + i * 60} ${c.street}`, created_at: minutesAgo(ago),
      latitude: c.lat + ((i % 3) - 1) * 0.0012, longitude: c.lng + ((i % 2) - 0.5) * 0.0016,
      escalation_timeline: [ev(ago, 'Call received'), ev(ago - 2, 'Service request logged', c.category)],
    });
  }
});

if (process.argv.includes('--clear')) {
  const { error } = await supabase.from('calls').delete().like('retell_call_id', 'demo_%');
  if (error) throw error;
  console.log('Removed demo calls.');
} else {
  // Map coordinates need migration 03; seed without them if it hasn't been applied.
  const { error: geoMissing } = await supabase.from('calls').select('latitude').limit(1);
  for (const call of demo) {
    if (geoMissing) {
      delete call.latitude;
      delete call.longitude;
    } else if (call.latitude == null && call.location) {
      const point = await geocode(call.location);
      if (point) Object.assign(call, { latitude: point.lat, longitude: point.lng });
    }
  }
  if (geoMissing) console.warn('calls.latitude is missing; run supabase/migrations/03_geo_and_maintenance.sql for map pins.');
  const { data: rows, error } = await supabase.from('calls').upsert(demo, { onConflict: 'retell_call_id' }).select();
  if (error) throw error;
  // Reports need the DB-assigned incident_number, so build them after the insert.
  for (const row of rows) {
    const { error: reportError } = await supabase.from('calls').update({ formal_report: buildFormalReport({ row }) }).eq('id', row.id);
    if (reportError) throw reportError;
  }
  console.log(`Seeded ${demo.length} demo calls.`);
}
