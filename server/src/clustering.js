// Incident clustering: groups matching calls (same category, ~150 m apart, < 1 hour
// between reports) into incidents for the Clusters page. Runs after a call is saved,
// off the request path, so it can never delay or change an escalation. Clusters live in
// their own tables (supabase/migrations/04_incident_clusters.sql); calls are untouched.
import { supabase } from './supabase.js';
import { buildClusterReport } from './report.js';

export const RADIUS_KM = 0.15;
export const WINDOW_MS = 60 * 60 * 1000;
export const CLUSTER_STATUSES = ['active', 'escalated', 'resolved'];
const URGENCY_RANK = ['Standard', 'Urgent', 'Critical'];
// Category pairs that can share a cluster. Each triage category already spans related
// issues (e.g. power outage and downed line), so none are needed today.
const RELATED = {};
const ANONYMOUS_CALLERS = new Set(['Web Call', 'Unknown', '']);

const time = (iso) => new Date(iso).getTime();

/** Great-circle distance in km. */
export function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export const sameIssue = (a, b) => a === b || (RELATED[a] || []).includes(b);
export const hasPoint = (call) => call?.latitude != null && call?.longitude != null;
const pointOf = (call) => ({ lat: call.latitude, lng: call.longitude });

/**
 * Does a call match a cluster (or another call)? `target` is { category, lat, lng, first, last }
 * with times in ms; a lone call has first === last.
 */
export function matches(call, target) {
  if (!hasPoint(call) || !sameIssue(call.category, target.category)) return false;
  const at = time(call.created_at);
  if (at < target.first - WINDOW_MS || at > target.last + WINDOW_MS) return false;
  return distanceKm(pointOf(call), target) <= RADIUS_KM;
}

export const callTarget = (call) => ({ category: call.category, ...pointOf(call), first: time(call.created_at), last: time(call.created_at) });
export const clusterTarget = (c) => ({ category: c.category, lat: c.center_lat, lng: c.center_lng, first: time(c.first_report_at), last: time(c.last_report_at) });

function mode(values) {
  const counts = new Map();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

/** Aggregate fields for a cluster from its member calls. */
export function clusterStats(calls) {
  const located = calls.filter(hasPoint);
  const times = calls.map((c) => time(c.created_at));
  const phones = calls.map((c) => (c.caller_phone || '').trim());
  // Anonymous web/unknown callers can't be told apart, so each counts as distinct.
  const unique = new Set(phones.filter((p) => !ANONYMOUS_CALLERS.has(p))).size + phones.filter((p) => ANONYMOUS_CALLERS.has(p)).length;
  return {
    report_count: calls.length,
    unique_callers: unique,
    first_report_at: new Date(Math.min(...times)).toISOString(),
    last_report_at: new Date(Math.max(...times)).toISOString(),
    max_urgency: calls.reduce((max, c) => (URGENCY_RANK.indexOf(c.urgency_level) > URGENCY_RANK.indexOf(max) ? c.urgency_level : max), 'Standard'),
    center_lat: located.reduce((s, c) => s + c.latitude, 0) / located.length,
    center_lng: located.reduce((s, c) => s + c.longitude, 0) / located.length,
    location_label: mode(calls.map((c) => c.location?.trim()))?.slice(0, 255) || null,
  };
}

/** A cluster takes on its most urgent report; resolved and manual escalations stick. */
export function nextStatus(current, maxUrgency) {
  if (current === 'resolved' || current === 'escalated') return current;
  return maxUrgency === 'Critical' || maxUrgency === 'Urgent' ? 'escalated' : 'active';
}

// ---------- Database ----------

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const MISSING_TABLE = new Set(['PGRST205', '42P01']);
let missingSince = 0;

function check(error) {
  if (!error) return;
  if (MISSING_TABLE.has(error.code)) {
    missingSince = Date.now();
    throw httpError(503, 'Clustering tables missing: run supabase/migrations/04_incident_clusters.sql');
  }
  throw error;
}

async function membershipOf(callId) {
  const { data, error } = await supabase.from('incident_cluster_members').select('cluster_id').eq('call_id', callId).maybeSingle();
  check(error);
  return data?.cluster_id || null;
}

async function memberCalls(clusterId) {
  const { data: links, error } = await supabase.from('incident_cluster_members').select('call_id').eq('cluster_id', clusterId);
  check(error);
  if (!links.length) return [];
  const { data, error: callsError } = await supabase.from('calls').select('*').in('id', links.map((l) => l.call_id)).order('created_at');
  check(callsError);
  return data;
}

async function getClusterRow(id) {
  const { data, error } = await supabase.from('incident_clusters').select('*').eq('id', id).maybeSingle();
  check(error);
  return data;
}

/** Recomputes a cluster from its members; dissolves it below two reports. */
async function refresh(clusterId) {
  const [cluster, calls] = await Promise.all([getClusterRow(clusterId), memberCalls(clusterId)]);
  if (!cluster) return null;
  if (calls.filter(hasPoint).length < 2) {
    const { error } = await supabase.from('incident_clusters').delete().eq('id', clusterId);
    check(error);
    return null;
  }
  const stats = clusterStats(calls);
  const { data, error } = await supabase
    .from('incident_clusters')
    .update({ ...stats, status: nextStatus(cluster.status, stats.max_urgency), updated_at: new Date().toISOString() })
    .eq('id', clusterId)
    .select()
    .single();
  check(error);
  return data;
}

async function addMembers(clusterId, callIds) {
  const { error } = await supabase.from('incident_cluster_members').upsert(callIds.map((call_id) => ({ call_id, cluster_id: clusterId })));
  check(error);
}

/** Active clusters of the same issue type whose time window could include this call. */
async function findCluster(call) {
  const at = time(call.created_at);
  const { data, error } = await supabase
    .from('incident_clusters')
    .select('*')
    .eq('category', call.category)
    .neq('status', 'resolved')
    .gte('last_report_at', new Date(at - WINDOW_MS).toISOString())
    .lte('first_report_at', new Date(at + WINDOW_MS).toISOString());
  check(error);
  return data
    .filter((c) => matches(call, clusterTarget(c)))
    .sort((a, b) => time(b.last_report_at) - time(a.last_report_at) || distanceKm(pointOf(call), clusterTarget(a)) - distanceKm(pointOf(call), clusterTarget(b)))[0];
}

/** The newest unclustered call that matches, to pair with. */
async function findPartner(call) {
  const at = time(call.created_at);
  const { data, error } = await supabase
    .from('calls')
    .select('*')
    .eq('category', call.category)
    .neq('id', call.id)
    .not('latitude', 'is', null)
    .gte('created_at', new Date(at - WINDOW_MS).toISOString())
    .lte('created_at', new Date(at + WINDOW_MS).toISOString())
    .order('created_at', { ascending: false });
  check(error);
  const nearby = data.filter((other) => matches(call, callTarget(other)));
  if (!nearby.length) return null;
  const { data: taken, error: takenError } = await supabase.from('incident_cluster_members').select('call_id').in('call_id', nearby.map((c) => c.id));
  check(takenError);
  const clustered = new Set(taken.map((t) => t.call_id));
  return nearby.find((c) => !clustered.has(c.id)) || null;
}

/** Places one call: refresh its cluster, join a matching one, pair with a lone call, or leave it alone. */
export async function assignCall(call) {
  const current = await membershipOf(call.id);
  if (current) {
    const cluster = await getClusterRow(current);
    if (cluster && sameIssue(cluster.category, call.category) && hasPoint(call)) return refresh(current);
    await removeMember(current, call.id); // category or location changed: re-place it below
  }
  if (!hasPoint(call)) return null;

  const cluster = await findCluster(call);
  if (cluster) {
    await addMembers(cluster.id, [call.id]);
    return refresh(cluster.id);
  }

  const partner = await findPartner(call);
  if (!partner) return null;
  const stats = clusterStats([partner, call]);
  const { data, error } = await supabase
    .from('incident_clusters')
    .insert({ category: call.category, ...stats, status: nextStatus('active', stats.max_urgency) })
    .select()
    .single();
  check(error);
  await addMembers(data.id, [partner.id, call.id]);
  return refresh(data.id);
}

let queue = Promise.resolve();

/**
 * Fire-and-forget hook for callsRepo.updateCall. Serialized so two calls arriving together
 * don't both start a cluster; failures are logged, never thrown to the caller.
 */
export function queueClustering(call) {
  if (!call?.id) return;
  if (missingSince && Date.now() - missingSince < 60_000) return; // migration 04 not applied yet
  queue = queue
    .then(() => assignCall(call))
    .catch((err) => {
      if (err.statusCode === 503) console.warn(`[clusters] ${err.message}`);
      else console.error(`[clusters] call ${call.id} failed:`, err.message || err);
    });
}

const note = (text, kind = 'note', extra = {}) => ({ at: new Date().toISOString(), kind, text, ...extra });

export async function listClusters({ since } = {}) {
  const from = since ? new Date(since) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime())) throw httpError(400, 'since must be a date');
  const { data, error } = await supabase.from('incident_clusters').select('*').gte('last_report_at', from.toISOString()).order('last_report_at', { ascending: false });
  check(error);
  if (!data.length) return [];
  const { data: links, error: linkError } = await supabase.from('incident_cluster_members').select('call_id, cluster_id').in('cluster_id', data.map((c) => c.id));
  check(linkError);
  return data.map((c) => ({ ...c, member_ids: links.filter((l) => l.cluster_id === c.id).map((l) => l.call_id) }));
}

export async function getCluster(id) {
  const cluster = await getClusterRow(id);
  if (!cluster) return null;
  const calls = await memberCalls(id);
  // One official report for the whole incident, rebuilt as reports join or leave.
  const formal_report = calls.length ? buildClusterReport(cluster, calls) : null;
  return { ...cluster, member_ids: calls.map((c) => c.id), calls, formal_report };
}

async function patchCluster(id, patch) {
  const { data, error } = await supabase.from('incident_clusters').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().maybeSingle();
  check(error);
  return data;
}

/** Dispatcher action on the whole cluster. Member calls' own statuses are not changed. */
export async function setClusterStatus(id, status, text) {
  if (!CLUSTER_STATUSES.includes(status)) throw httpError(400, `status must be one of ${CLUSTER_STATUSES.join(', ')}`);
  const cluster = await getClusterRow(id);
  if (!cluster) return null;
  const label = { active: 'Reopened', escalated: 'Escalated to a human dispatcher', resolved: 'Marked resolved' }[status];
  return patchCluster(id, { status, notes: [...cluster.notes, note(text ? `${label}: ${text}` : label, 'status', { status })] });
}

export async function addNote(id, text) {
  if (typeof text !== 'string' || !text.trim()) throw httpError(400, 'note is required');
  const cluster = await getClusterRow(id);
  if (!cluster) return null;
  return patchCluster(id, { notes: [...cluster.notes, note(text.trim().slice(0, 1000))] });
}

/** Split: takes one call out of a cluster (which dissolves if fewer than two remain). */
export async function removeMember(clusterId, callId) {
  const { error } = await supabase.from('incident_cluster_members').delete().eq('cluster_id', clusterId).eq('call_id', callId);
  check(error);
  return refresh(clusterId);
}

/** Merge: moves every call from `sourceId` into `targetId` (same issue type only). */
export async function mergeClusters(sourceId, targetId) {
  if (sourceId === targetId) throw httpError(400, 'Cannot merge a cluster into itself');
  const [source, target] = await Promise.all([getClusterRow(sourceId), getClusterRow(targetId)]);
  if (!source || !target) throw httpError(404, 'Cluster not found');
  if (!sameIssue(source.category, target.category)) throw httpError(400, 'Only clusters of the same issue type can be merged');
  const { error } = await supabase.from('incident_cluster_members').update({ cluster_id: targetId }).eq('cluster_id', sourceId);
  check(error);
  await patchCluster(targetId, {
    notes: [...target.notes, ...source.notes, note(`Merged ${source.report_count} reports from ${source.location_label || 'another cluster'}`, 'merge')],
  });
  const { error: deleteError } = await supabase.from('incident_clusters').delete().eq('id', sourceId);
  check(deleteError);
  return refresh(targetId);
}

/** Re-clusters every existing call in time order (after migration 04, or to rebuild). */
export async function backfillClusters() {
  const { data, error } = await supabase.from('calls').select('*').order('created_at');
  check(error);
  for (const call of data) await assignCall(call);
  return data.length;
}
