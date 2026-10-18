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

// One incident per category: several callers reporting the same thing from the same block within
// an hour, so the clustering groups them (same category, within 150 m, under an hour apart).
// `startMin` is how long ago the first call came in: under an hour shows as Active, older as History.
const INCIDENTS = [
  {
    key: 'fire', category: 'Emergency / Active Danger', urgency: 'Critical', status: 'Escalated to 911',
    street: 'S Vermont Ave', lat: 34.0331, lng: -118.2917, startMin: 34, gapMin: 6,
    reports: [
      'Smoke and flames coming from the second floor of an apartment building; residents are evacuating.',
      'Apartment fire on Vermont, people on the balcony calling for help.',
      'Heavy black smoke from a building near Vermont and Adams; caller hears smoke alarms.',
      'Building on fire, a car parked in front is starting to catch.',
      'Second report of a structure fire; fire trucks not on scene yet.',
    ],
  },
  {
    key: 'branch', category: 'Public Safety & Hazards', urgency: 'Urgent', status: 'Escalated to Human',
    street: 'W Pico Blvd', lat: 34.0477, lng: -118.3437, startMin: 48, gapMin: 9,
    reports: [
      'Large tree branch down after the wind, blocking the eastbound lane.',
      'Cars swerving around a fallen branch in the road on Pico.',
      'Branch blocking a traffic lane and part of the crosswalk.',
      'Fallen limb in the street near the bus stop; nobody hurt yet.',
    ],
  },
  {
    key: 'signal', category: 'Roads & Infrastructure', urgency: 'Urgent', status: 'Escalated to Human',
    street: 'S Figueroa St', lat: 34.0187, lng: -118.2826, startMin: 40, gapMin: 7,
    reports: [
      'Traffic signal is out at Figueroa and Exposition, all directions dark.',
      'Stoplight not working at a busy intersection by the museum.',
      'Signal flashing then went dark; drivers treating it as a four-way stop.',
      'Traffic light out near the school crossing on Figueroa.',
      'Signal still out, traffic backing up on Exposition.',
      'Broken traffic light, pedestrians having trouble crossing.',
    ],
  },
  {
    key: 'watermain', category: 'Utilities & Water', urgency: 'Urgent', status: 'Escalated to Human',
    street: 'W Washington Blvd', lat: 34.0399, lng: -118.2671, startMin: 190, gapMin: 8,
    reports: [
      'Water gushing out of the street, looks like a water main break.',
      'Street flooding on Washington Blvd, water coming up through the asphalt.',
      'No water pressure in my building and the road outside is flooded.',
      'Water main break, the flooding is reaching the sidewalk.',
      'Big leak in the street near the storm drain, asphalt is buckling.',
      'Flooded intersection from a broken pipe; cars driving slowly through it.',
      'Water still pouring into the street from the main break.',
    ],
  },
  {
    key: 'dumping', category: 'Code Enforcement & Sanitation', urgency: 'Standard', status: 'AI Completed',
    street: 'E 7th St', lat: 34.0386, lng: -118.2447, startMin: 320, gapMin: 11,
    reports: [
      'Someone dumped mattresses and furniture on the sidewalk overnight.',
      'Pile of trash and old furniture blocking the sidewalk on 7th.',
      'Illegal dumping next to the alley, bags of construction debris.',
      'Couch and mattresses left on the curb, people walking in the street to get around.',
    ],
  },
];
INCIDENTS.forEach((inc, ii) => {
  inc.reports.forEach((summary, i) => {
    const ago = inc.startMin - i * inc.gapMin;
    demo.push({
      retell_call_id: `demo_incident_${inc.key}_${i}`, caller_phone: `+1323555${String(400 + ii * 10 + i).padStart(4, '0')}`, caller_name: null,
      category: inc.category, urgency_level: inc.urgency, status: inc.status, summary,
      location: `${1800 + i * 20} ${inc.street}`, created_at: minutesAgo(ago),
      // Within ~70 m of each other, well inside the 150 m cluster radius.
      latitude: inc.lat + ((i % 3) - 1) * 0.0003, longitude: inc.lng + ((i % 2) - 0.5) * 0.0004,
      transcript: `Agent: City services line. What would you like to report?\nUser: ${summary}`,
      escalation_timeline: [ev(ago, 'Call received'), ev(ago - 1, 'AI triage complete', `${inc.category} · ${inc.urgency}`)],
    });
  });
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
