// Inserts demo calls so the dashboard has data before any real calls come in.
// Usage: npm run seed            (add demo rows)
//        npm run seed -- --clear (remove demo rows)
import { assertConfig } from './config.js';

assertConfig();
const { supabase } = await import('./supabase.js');

const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
const ev = (m, event, detail) => ({ at: minutesAgo(m), event, ...(detail ? { detail } : {}) });

const demo = [
  {
    retell_call_id: 'demo_robbery_001', caller_phone: '+12135550142', caller_name: 'Maria Lopez',
    category: 'Public Safety', urgency_level: 'Critical', status: 'Escalated to 911',
    summary: 'Caller witnessing an armed robbery in progress at a convenience store. Suspect has a handgun; two employees inside.',
    location: '3401 S Figueroa St, Los Angeles', created_at: minutesAgo(4),
    transcript: 'Agent: City services line, what are you reporting?\nUser: There is a guy with a gun robbing the 7-Eleven right now!\nAgent: I am escalating this to 911 immediately. Are you somewhere safe?\nUser: Yes, I am across the street.',
    escalation_timeline: [ev(4, 'Call received'), ev(4, 'Emergency detected by AI agent', 'Armed robbery'), ev(3, 'Escalated to 911 dispatch', 'Location: 3401 S Figueroa St')],
  },
  {
    retell_call_id: 'demo_accident_002', caller_phone: '+13105550177', caller_name: 'James Park',
    category: 'Public Safety', urgency_level: 'Critical', status: 'Escalated to 911',
    summary: 'Two-car collision with one driver unresponsive. Vehicles blocking the northbound lanes.',
    location: 'Vermont Ave & W Jefferson Blvd', created_at: minutesAgo(18),
    escalation_timeline: [ev(18, 'Call received'), ev(18, 'Emergency detected by AI agent', 'Traffic collision with injuries'), ev(17, 'Escalated to 911 dispatch')],
  },
  {
    retell_call_id: 'demo_signal_003', caller_phone: '+12135550199', caller_name: null,
    category: 'Traffic Signals', urgency_level: 'Urgent', status: 'Escalated to Human',
    summary: 'Traffic signals completely dark in all directions at a busy intersection during rush hour.',
    location: 'Exposition Blvd & Hoover St', created_at: minutesAgo(42),
    escalation_timeline: [ev(42, 'Call received'), ev(40, 'AI triage complete', 'Traffic Signals · Urgent'), ev(40, 'Escalated to human dispatcher', 'Hazard to drivers and pedestrians')],
  },
  {
    retell_call_id: 'demo_pothole_004', caller_phone: '+13235550123', caller_name: 'Dev Patel',
    category: 'Potholes', urgency_level: 'Standard', status: 'AI Completed',
    summary: 'Medium-sized pothole in the right lane near the bus stop. Caller requested a repair ticket.',
    location: '1200 W 37th Pl', created_at: minutesAgo(95),
    escalation_timeline: [ev(95, 'Call received'), ev(93, 'Service request logged', 'Potholes at 1200 W 37th Pl'), ev(92, 'AI triage complete', 'Potholes · Standard')],
  },
  {
    retell_call_id: 'demo_noise_005', caller_phone: '+12135550111', caller_name: 'Sam Rivera',
    category: 'Noise & Other', urgency_level: 'Standard', status: 'AI Completed',
    summary: 'Ongoing loud music from a neighboring property after midnight on a weeknight.',
    location: '2715 Portland St', created_at: minutesAgo(180),
    escalation_timeline: [ev(180, 'Call received'), ev(178, 'Service request logged', 'Noise & Other at 2715 Portland St')],
  },
  {
    retell_call_id: 'demo_pothole_006', caller_phone: '+13105550165', caller_name: null,
    category: 'Potholes', urgency_level: 'Urgent', status: 'Escalated to Human',
    summary: 'Large, deep pothole on a freeway on-ramp; caller reports a flat tire and other cars swerving.',
    location: 'I-110 N on-ramp at Adams Blvd', created_at: minutesAgo(260),
    escalation_timeline: [ev(260, 'Call received'), ev(258, 'AI triage complete', 'Potholes · Urgent'), ev(258, 'Escalated to human dispatcher')],
  },
];

if (process.argv.includes('--clear')) {
  const { error } = await supabase.from('calls').delete().like('retell_call_id', 'demo_%');
  if (error) throw error;
  console.log('Removed demo calls.');
} else {
  const { error } = await supabase.from('calls').upsert(demo, { onConflict: 'retell_call_id' });
  if (error) throw error;
  console.log(`Seeded ${demo.length} demo calls.`);
}
