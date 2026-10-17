import { supabase } from './supabase.js';
import { geocode } from './geocode.js';
import { timelineEvent } from './timeline.js';
import { queueClustering } from './clustering.js';
import { DEFAULT_CATEGORY, EMERGENCY, STATUSES, URGENCY_LEVELS } from './triage.js';

// Higher index = more severe. Used so a later event never downgrades an escalation.
const STATUS_RANK = ['In Progress', 'AI Completed', 'Escalated to Human', 'Escalated to 911'];
const URGENCY_RANK = ['Standard', 'Urgent', 'Critical'];

export function mostSevere(rank, a, b) {
  return rank.indexOf(a) >= rank.indexOf(b) ? a : b;
}

export function callerPhone(call = {}) {
  if (call.from_number) return call.from_number;
  return call.call_type === 'web_call' ? 'Web Call' : 'Unknown';
}

export async function getByRetellId(retellCallId) {
  const { data, error } = await supabase.from('calls').select('*').eq('retell_call_id', retellCallId).maybeSingle();
  if (error) throw error;
  return data;
}

/** Creates the placeholder "In Progress" row for a call if it doesn't exist yet. */
export async function ensureCall(call) {
  const existing = await getByRetellId(call.call_id);
  if (existing) return existing;

  const row = {
    retell_call_id: call.call_id,
    caller_phone: callerPhone(call),
    category: DEFAULT_CATEGORY,
    urgency_level: 'Standard',
    status: 'In Progress',
    summary: 'Call in progress…',
    escalation_timeline: [timelineEvent('Call received', `Inbound ${call.call_type === 'web_call' ? 'web' : 'phone'} call answered by AI agent`)],
  };
  if (call.start_timestamp) row.created_at = new Date(call.start_timestamp).toISOString();

  const { data, error } = await supabase
    .from('calls')
    .upsert(row, { onConflict: 'retell_call_id', ignoreDuplicates: true })
    .select()
    .maybeSingle();
  if (error) throw error;
  // ignoreDuplicates returns no row if another request won the race
  return data || getByRetellId(call.call_id);
}

/**
 * Map coordinates for a new or changed location. Skipped when the row has no latitude
 * column (migration 03 not applied) so calls keep working without the map.
 */
export async function coordinatesFor(row, location) {
  if (!location || !('latitude' in row)) return {};
  if (row.latitude != null && row.location === location) return {};
  const point = await geocode(location);
  return point ? { latitude: point.lat, longitude: point.lng } : {};
}

/** Most severe explicit escalation recorded on the call's timeline, if any. */
export function escalationFloor(timeline = []) {
  return timeline.reduce((floor, e) => (e.escalated_to ? mostSevere(STATUS_RANK, e.escalated_to, floor) : floor), null);
}

const URGENCY_FOR_STATUS = { 'Escalated to 911': 'Critical', 'Escalated to Human': 'Urgent' };

/**
 * Applies a partial update and appends timeline events. Automated triage is free to
 * revise category/urgency, but never below an explicit escalation on the timeline.
 */
export async function updateCall(retellCallId, patch, events = []) {
  const current = await getByRetellId(retellCallId);
  if (!current) throw new Error(`Call ${retellCallId} not found`);

  const timeline = [...(current.escalation_timeline || []), ...events];
  const next = { ...patch };
  const floor = escalationFloor(timeline);
  if (floor) {
    next.status = mostSevere(STATUS_RANK, next.status || current.status, floor);
    next.urgency_level = mostSevere(URGENCY_RANK, next.urgency_level || current.urgency_level, URGENCY_FOR_STATUS[floor]);
    if (floor === 'Escalated to 911') next.category = EMERGENCY;
  }
  // Don't overwrite details captured mid-call with nulls
  for (const key of ['location', 'caller_name']) {
    if (next[key] == null) delete next[key];
  }
  if (events.length) next.escalation_timeline = timeline;
  Object.assign(next, await coordinatesFor(current, next.location));

  const { data, error } = await supabase.from('calls').update(next).eq('id', current.id).select().single();
  if (error) throw error;
  // Group into incidents in the background: never awaited, so escalations aren't delayed.
  queueClustering(data);
  return data;
}

export async function listCalls({ category, urgency, status, search, limit = 200 } = {}) {
  let query = supabase.from('calls').select('*').order('created_at', { ascending: false }).limit(Math.min(Number(limit) || 200, 500));
  if (category) query = query.eq('category', category);
  if (urgency) query = query.eq('urgency_level', urgency);
  if (status) query = query.eq('status', status);
  if (search) {
    const term = search.replace(/[%,()]/g, ' ').trim();
    if (term) query = query.or(`summary.ilike.%${term}%,location.ilike.%${term}%,caller_name.ilike.%${term}%,caller_phone.ilike.%${term}%`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getCall(id) {
  const { data, error } = await supabase.from('calls').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

/** Dispatcher override from the dashboard: sets status directly (may de-escalate). */
export async function setStatus(id, status, note) {
  if (!STATUSES.includes(status)) throw Object.assign(new Error('Invalid status'), { statusCode: 400 });
  const current = await getCall(id);
  if (!current) return null;
  const patch = {
    status,
    escalation_timeline: [
      ...(current.escalation_timeline || []),
      timelineEvent(
        `Status changed to "${status}"`,
        note || 'Updated by dispatcher from dashboard',
        status.startsWith('Escalated') ? status : undefined,
      ),
    ],
  };
  if (status === 'Escalated to 911') patch.urgency_level = 'Critical';
  const { data, error } = await supabase.from('calls').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function getStats() {
  const { data, error } = await supabase.from('calls').select('category, urgency_level, status, created_at');
  if (error) throw error;
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const stats = {
    total: data.length,
    last24h: 0,
    byUrgency: Object.fromEntries(URGENCY_LEVELS.map((u) => [u, 0])),
    byStatus: Object.fromEntries(STATUSES.map((s) => [s, 0])),
    byCategory: {},
  };
  for (const row of data) {
    if (new Date(row.created_at).getTime() >= since) stats.last24h++;
    stats.byUrgency[row.urgency_level]++;
    stats.byStatus[row.status]++;
    stats.byCategory[row.category] = (stats.byCategory[row.category] || 0) + 1;
  }
  return stats;
}
