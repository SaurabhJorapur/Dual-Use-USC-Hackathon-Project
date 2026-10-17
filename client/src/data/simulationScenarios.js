// Disaster Twin: pre-built, deterministic scenario payloads for the simulation page.
// Static on purpose: switching scenarios is instant and the demo is identical every time.
// All incidents are fictional; locations are real Los Angeles places.

export const SEVERITIES = ['critical', 'hazard', 'routine'];

const marker = (id, severity, category, title, lat, lng, time, detail) => ({ id, severity, category, title, lat, lng, time, detail });

export const SCENARIOS = {
  normal: {
    key: 'normal',
    label: 'Live Normal Operations',
    emoji: '🟢',
    name: 'Normal Operations (Tuesday, 2:00 PM)',
    tone: 'emerald',
    banner_alert: 'All systems nominal. Call volume within the expected range for this time of day.',
    recommendation: 'Maintain standard staffing: 6 dispatchers on shift, routine crews on scheduled work orders.',
    actions: ['Continue scheduled pothole and streetlight work orders', 'No pre-positioning required', 'Next weather check-in at 6:00 PM'],
    map_markers: [
      marker('n1', 'hazard', 'Public Safety & Hazards', 'Traffic signal flashing red', 34.0622, -118.3088, '1:42 PM', 'Wilshire Blvd & Western Ave; officers not required, signal crew notified.'),
      marker('n2', 'routine', 'Roads & Infrastructure', 'Pothole in right lane', 34.0251, -118.2851, '1:15 PM', 'Figueroa St near Exposition Park; repair ticket logged.'),
      marker('n3', 'routine', 'Roads & Infrastructure', 'Streetlight out', 34.0983, -118.3267, '12:58 PM', 'Hollywood Blvd; Bureau of Street Lighting ticket created.'),
      marker('n4', 'routine', 'Code Enforcement & Sanitation', 'Illegal dumping', 34.0389, -118.2234, '12:31 PM', 'Mattress and furniture on sidewalk, Boyle Heights.'),
      marker('n5', 'routine', 'Utilities & Water', 'Minor water leak', 34.1478, -118.4415, '11:47 AM', 'Leak at meter box, Sherman Oaks; DWP notified.'),
      marker('n6', 'routine', 'Code Enforcement & Sanitation', 'Graffiti removal request', 34.0045, -118.3312, '11:20 AM', 'Retaining wall, Leimert Park.'),
      marker('n7', 'routine', 'Code Enforcement & Sanitation', 'Noise complaint', 34.0901, -118.2768, '10:55 AM', 'Construction before permitted hours, Silver Lake.'),
    ],
    surge_data: [
      ['00:00', 4, 5], ['02:00', 3, 3], ['04:00', 3, 3], ['06:00', 8, 9], ['08:00', 22, 20], ['10:00', 31, 29],
      ['12:00', 34, 33], ['14:00', 30, 32], ['16:00', 36, 35], ['18:00', 28, 30], ['20:00', 17, 18], ['22:00', 9, 10],
    ].map(([time, calls, baseline]) => ({ time, calls, baseline })),
    event_time: null,
    category_breakdown: {
      'Emergency / Active Danger': 14,
      'Public Safety & Hazards': 22,
      'Roads & Infrastructure': 41,
      'Utilities & Water': 18,
      'Code Enforcement & Sanitation': 37,
    },
  },

  earthquake: {
    key: 'earthquake',
    label: 'Magnitude 6.8 Earthquake',
    emoji: '🔴',
    name: 'Magnitude 6.8 Earthquake (2:00 AM)',
    tone: 'red',
    banner_alert:
      'M6.8 earthquake centered 4 mi NE of Downtown LA at 2:00 AM. Call volume at 100× normal. Structure collapses, gas fires and freeway damage reported citywide.',
    recommendation: 'Activate EOC Level 1. Deploy USAR Task Forces 1 and 2 to Koreatown and Westlake; pre-position 6 engine companies on the Eastside gas-leak corridor.',
    actions: [
      'Close the I-10 / I-110 interchange; reroute traffic via surface streets',
      'Request DWP and SoCalGas emergency shutoff crews for Boyle Heights and Highland Park',
      'Open shelters at the Convention Center and Pan Pacific Park',
      'Stage 12 additional dispatchers; route Standard calls to the AI line only',
    ],
    map_markers: [
      marker('q1', 'critical', 'Emergency / Active Danger', 'Soft-story building collapse', 34.0618, -118.3005, '2:03 AM', '3-story apartment collapsed onto carport, Koreatown. Multiple residents reported trapped.'),
      marker('q2', 'critical', 'Emergency / Active Danger', 'Gas main rupture and fire', 34.0335, -118.205, '2:06 AM', 'Ruptured gas main ignited, Boyle Heights; two homes involved.'),
      marker('q3', 'critical', 'Public Safety & Hazards', 'Freeway overpass damage', 34.036, -118.273, '2:08 AM', 'Visible cracking on the I-10 / I-110 interchange connector; vehicles stopped on the deck.'),
      marker('q4', 'critical', 'Emergency / Active Danger', 'Residential structure fire', 34.0985, -118.329, '2:11 AM', 'Apartment fire after the shaking, Hollywood; residents evacuating.'),
      marker('q5', 'critical', 'Emergency / Active Danger', 'Occupants trapped in elevator and stairwell', 34.056, -118.278, '2:12 AM', 'Mid-rise in Westlake; stairwell partially blocked by debris.'),
      marker('q6', 'hazard', 'Utilities & Water', 'Downed power lines', 34.078, -118.2606, '2:05 AM', 'Live lines across Sunset Blvd, Echo Park; area dark.'),
      marker('q7', 'hazard', 'Utilities & Water', 'Water main break', 34.087, -118.27, '2:09 AM', '30-inch main break flooding Silver Lake Blvd.'),
      marker('q8', 'hazard', 'Roads & Infrastructure', 'Ruptured pavement', 34.062, -118.309, '2:14 AM', 'Wilshire Blvd buckled across all lanes near Western Ave.'),
      marker('q9', 'hazard', 'Public Safety & Hazards', 'Traffic signals dark', 34.048, -118.255, '2:04 AM', 'Signals out across Downtown; 40+ intersections without power.'),
      marker('q10', 'hazard', 'Public Safety & Hazards', 'Landslide onto roadway', 34.0995, -118.214, '2:17 AM', 'Hillside slipped onto Mt. Washington Dr; one lane blocked.'),
      marker('q11', 'hazard', 'Utilities & Water', 'Strong gas odor reports', 34.1115, -118.1925, '2:15 AM', '14 callers report gas odor across Highland Park.'),
      marker('q12', 'hazard', 'Public Safety & Hazards', 'Facade and glass debris', 34.0505, -118.256, '2:10 AM', 'Glass panels fallen onto sidewalk, Financial District.'),
      marker('q13', 'routine', 'Code Enforcement & Sanitation', 'Car alarms and noise', 34.044, -118.251, '2:20 AM', 'Dozens of car alarms; no injuries reported.'),
      marker('q14', 'routine', 'Roads & Infrastructure', 'Cracked sidewalk', 34.008, -118.332, '2:31 AM', 'New sidewalk cracks, Leimert Park; no hazard to traffic.'),
      marker('q15', 'routine', 'Code Enforcement & Sanitation', 'Debris pickup request', 34.045, -118.35, '2:40 AM', 'Broken masonry in the alley, Mid-City.'),
    ],
    surge_data: [
      ['00:00', 6, 6], ['00:30', 5, 5], ['01:00', 5, 5], ['01:30', 4, 4], ['02:00', 188, 4], ['02:30', 412, 4], ['03:00', 356, 4],
      ['03:30', 271, 4], ['04:00', 214, 4], ['04:30', 176, 5], ['05:00', 149, 6], ['05:30', 131, 7], ['06:00', 122, 9], ['06:30', 118, 12],
      ['07:00', 109, 16], ['07:30', 97, 19], ['08:00', 92, 22],
    ].map(([time, calls, baseline]) => ({ time, calls, baseline })),
    event_time: '02:00',
    category_breakdown: {
      'Emergency / Active Danger': 612,
      'Public Safety & Hazards': 534,
      'Roads & Infrastructure': 288,
      'Utilities & Water': 471,
      'Code Enforcement & Sanitation': 96,
    },
  },

  flood: {
    key: 'flood',
    label: 'Atmospheric River Flood',
    emoji: '🔵',
    name: 'Atmospheric River Flash Flood (5:00 PM)',
    tone: 'blue',
    banner_alert:
      'Flash Flood Warning: 3.4 in of rain in 6 hours. LA River at Glendale Narrows nearing flood stage. Swift-water rescues and mudslides reported.',
    recommendation: 'Pre-position 4 water rescue units near the 110 corridor and 2 at the Sepulveda Basin; place Public Works sandbag crews in the Silver Lake and Palisades hillsides.',
    actions: [
      'Close the Arroyo Seco Parkway and 110 underpasses at Slauson and Florence',
      'Issue an evacuation warning for burn-scar hillsides in Pacific Palisades',
      'Stage DWP crews in Van Nuys for the outage cluster',
      'Push a reverse-911 "turn around, don\'t drown" alert to the LA River corridor',
    ],
    map_markers: [
      marker('f1', 'critical', 'Emergency / Active Danger', 'Swift-water rescue in LA River', 34.125, -118.269, '4:52 PM', 'Person in the channel at Glendale Narrows; rescue unit en route.'),
      marker('f2', 'critical', 'Emergency / Active Danger', 'Motorists stranded in underpass', 33.989, -118.281, '4:58 PM', 'Three cars submerged to the windows in the 110 underpass at Slauson.'),
      marker('f3', 'critical', 'Public Safety & Hazards', 'Mudslide threatening homes', 34.048, -118.526, '5:04 PM', 'Burn-scar hillside sliding toward homes, Pacific Palisades.'),
      marker('f4', 'critical', 'Emergency / Active Danger', 'Swift water in Sepulveda Basin', 34.176, -118.485, '5:07 PM', 'Unhoused encampment cut off by rising water.'),
      marker('f5', 'critical', 'Emergency / Active Danger', 'Vehicle swept off roadway', 34.217, -118.37, '5:11 PM', 'Car swept into a flooded wash, Sun Valley; occupant on the roof.'),
      marker('f6', 'hazard', 'Public Safety & Hazards', 'Downed trees blocking road', 34.109, -118.288, '4:40 PM', 'Two eucalyptus trees across Los Feliz Blvd.'),
      marker('f7', 'hazard', 'Utilities & Water', 'Power outage cluster', 34.1866, -118.449, '4:47 PM', '~8,000 customers without power, Van Nuys.'),
      marker('f8', 'hazard', 'Roads & Infrastructure', 'Sinkhole opening', 34.143, -118.396, '5:01 PM', 'Sinkhole widening on Ventura Blvd, Studio City.'),
      marker('f9', 'hazard', 'Utilities & Water', 'Storm drain overflow', 33.96, -118.278, '4:55 PM', 'Drains overwhelmed; water entering homes, South LA.'),
      marker('f10', 'hazard', 'Public Safety & Hazards', 'Rockfall on Sunset Blvd', 34.039, -118.555, '5:09 PM', 'Boulders in the westbound lanes near PCH.'),
      marker('f11', 'hazard', 'Roads & Infrastructure', 'Flooded parkway', 34.095, -118.205, '5:02 PM', 'Arroyo Seco Parkway under 2 ft of water at Avenue 43.'),
      marker('f12', 'routine', 'Roads & Infrastructure', 'Pothole surge', 34.04, -118.36, '4:20 PM', '27 new pothole reports in Mid-City since noon.'),
      marker('f13', 'routine', 'Utilities & Water', 'Clogged catch basin', 34.063, -118.445, '4:33 PM', 'Leaves blocking the catch basin, Westwood.'),
      marker('f14', 'routine', 'Code Enforcement & Sanitation', 'Missed trash pickup', 34.228, -118.536, '3:58 PM', 'Bins blown over and missed, Northridge.'),
    ],
    surge_data: [
      ['08:00', 21, 20], ['09:00', 26, 27], ['10:00', 34, 29], ['11:00', 45, 32], ['12:00', 61, 33], ['13:00', 82, 33], ['14:00', 117, 32],
      ['15:00', 164, 33], ['16:00', 221, 35], ['17:00', 268, 35], ['18:00', 247, 30], ['19:00', 198, 24], ['20:00', 151, 18],
      ['21:00', 109, 13], ['22:00', 74, 10],
    ].map(([time, calls, baseline]) => ({ time, calls, baseline })),
    event_time: '14:00',
    category_breakdown: {
      'Emergency / Active Danger': 238,
      'Public Safety & Hazards': 402,
      'Roads & Infrastructure': 515,
      'Utilities & Water': 389,
      'Code Enforcement & Sanitation': 71,
    },
  },
};

export const SCENARIO_ORDER = ['normal', 'earthquake', 'flood'];
