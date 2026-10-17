import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, ChevronDown, Clock, GitMerge, Headset, LoaderCircle, MapPin, MessageSquarePlus, RotateCcw, Scissors, Users, X } from 'lucide-react';
import { UrgencyBadge } from './Badges';
import IncidentReport from './IncidentReport';
import { api } from '../lib/api';
import { clusterTitle, isActive, issueType } from '../lib/clusters';
import { clockTime, formatPhone, timeAgo } from '../lib/format';

function Transcript({ text }) {
  if (!text) return <p className="text-xs text-slate-400">Transcript not available.</p>;
  return (
    <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg bg-slate-50 p-3">
      {text.split('\n').filter(Boolean).map((line, i) => {
        const m = /^(Agent|User):\s*(.*)$/.exec(line);
        return (
          <p key={i} className="text-xs text-slate-700">
            {m && <span className="mr-1 font-semibold text-slate-900">{m[1] === 'Agent' ? 'AI Agent' : 'Caller'}:</span>}
            {m ? m[2] : line}
          </p>
        );
      })}
    </div>
  );
}

function MemberCall({ call, onRemove, busy }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-slate-500">
            {clockTime(call.created_at)} · {call.caller_name || formatPhone(call.caller_phone)}
          </p>
          <p className="mt-0.5 text-sm text-slate-900">{call.summary}</p>
          {call.location && <p className="mt-0.5 text-xs text-slate-500">{call.location}</p>}
        </div>
        <UrgencyBadge level={call.urgency_level} />
      </div>
      {call.audio_url && <audio controls src={call.audio_url} preload="none" className="mt-2 h-8 w-full" />}
      <div className="mt-2 flex items-center justify-between">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900">
          <ChevronDown className={`h-3.5 w-3.5 transition ${open ? 'rotate-180' : ''}`} aria-hidden /> Transcript
        </button>
        <button
          onClick={() => onRemove(call)}
          disabled={busy}
          className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-red-600 disabled:opacity-50"
          title="Not the same incident: split this report out"
        >
          <Scissors className="h-3.5 w-3.5" aria-hidden /> Remove from cluster
        </button>
      </div>
      {open && (
        <div className="mt-2">
          <Transcript text={call.transcript} />
        </div>
      )}
    </li>
  );
}

/** Every call in a cluster, plus actions on the whole cluster. */
export default function ClusterDetail({ clusterId, clusters, now, onClose, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [mergeInto, setMergeInto] = useState('');
  const [tab, setTab] = useState('report');
  const summary = clusters.find((c) => c.id === clusterId);

  const load = useCallback(async () => {
    try {
      setDetail(await api.getCluster(clusterId));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [clusterId]);

  // Reload when the cluster changes (new reports arrive while it's open).
  useEffect(() => {
    load();
  }, [load, summary?.updated_at, summary?.report_count]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const act = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      await onChanged();
      if (result?.dissolved) return onClose();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const cluster = detail || summary;
  const active = cluster ? isActive(cluster, now) : true;
  const mergeTargets = cluster ? clusters.filter((c) => c.id !== cluster.id && c.category === cluster.category) : [];

  // Portaled to <body>: the pages that open this drawer sit inside <main className="isolate">, whose
  // stacking context would otherwise put the header and status ticker on top of it.
  return createPortal(
    <div className="fixed inset-0 z-30 flex justify-end" role="dialog" aria-modal="true" aria-label="Cluster details">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">
        {!cluster ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
            {error || <LoaderCircle className="h-5 w-5 animate-spin" aria-label="Loading" />}
          </div>
        ) : (
          <>
            <div className="border-b border-slate-100 p-5" style={{ background: `linear-gradient(135deg, ${issueType(cluster.category).hex}12, #fff 60%)` }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: issueType(cluster.category).hex }}>
                    {issueType(cluster.category).legend} · <span className="capitalize">{cluster.status}</span>
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-slate-900">{clusterTitle(cluster)}</h2>
                </div>
                <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-2">
                <p className="text-4xl font-bold tabular-nums text-slate-900">
                  {cluster.report_count} <span className="text-sm font-medium text-slate-500">reports</span>
                </p>
                <div className="space-y-0.5 text-xs text-slate-600">
                  <p className="flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" aria-hidden /> {cluster.unique_callers} unique callers
                  </p>
                  <p className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" aria-hidden /> {clockTime(cluster.first_report_at)} – {clockTime(cluster.last_report_at)} (last {timeAgo(cluster.last_report_at, now)})
                  </p>
                  <p className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" aria-hidden /> {cluster.location_label || 'Unknown location'}
                  </p>
                </div>
                <UrgencyBadge level={cluster.max_urgency} />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {cluster.status !== 'escalated' && cluster.status !== 'resolved' && (
                  <button
                    disabled={busy}
                    onClick={() => act(() => api.setClusterStatus(cluster.id, 'escalated'))}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
                  >
                    <Headset className="h-4 w-4" aria-hidden /> Escalate to human
                  </button>
                )}
                {cluster.status !== 'resolved' && (
                  <button
                    disabled={busy}
                    onClick={() => act(() => api.setClusterStatus(cluster.id, 'resolved'))}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-4 w-4" aria-hidden /> Mark resolved
                  </button>
                )}
                {/* Back to Active from History: resolved clusters reopen as active, quiet ones keep their status. */}
                {!active && (
                  <button
                    disabled={busy}
                    onClick={() => act(() => api.setClusterStatus(cluster.id, cluster.status === 'resolved' ? 'active' : cluster.status))}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden /> Reopen
                  </button>
                )}
                {busy && <LoaderCircle className="h-5 w-5 animate-spin self-center text-slate-400" aria-label="Saving" />}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                {active ? 'Active' : 'In History'}. Reopening or escalating keeps a cluster in Active until it's resolved. Cluster actions don't change the
                individual calls' statuses.
              </p>
              {error && <p className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700">{error}</p>}
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              <section>
                <div className="mb-3 flex gap-1 rounded-lg bg-slate-100 p-1" role="tablist">
                  {[
                    ['report', 'Incident report'],
                    ['calls', `Calls (${cluster.report_count})`],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      role="tab"
                      aria-selected={tab === id}
                      onClick={() => setTab(id)}
                      className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${tab === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {!detail ? (
                  <LoaderCircle className="h-5 w-5 animate-spin text-slate-400" aria-label="Loading" />
                ) : tab === 'report' ? (
                  // One official report for the whole incident, replacing the per-call reports.
                  <IncidentReport report={detail.formal_report} call={null} />
                ) : (
                  <ul className="space-y-2">
                    {detail.calls.map((call) => (
                      <MemberCall key={call.id} call={call} busy={busy} onRemove={(c) => act(() => api.removeClusterMember(cluster.id, c.id))} />
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</h3>
                {cluster.notes?.length ? (
                  <ul className="mb-2 space-y-1.5">
                    {cluster.notes.map((n, i) => (
                      <li key={i} className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
                        <span className="mr-2 text-xs text-slate-400">{clockTime(n.at)}</span>
                        {n.text}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="flex gap-2">
                  <input
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && noteText.trim() && act(() => api.addClusterNote(cluster.id, noteText).then(() => setNoteText('')))}
                    placeholder="Add a note for dispatchers"
                    className="min-w-0 flex-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                  <button
                    disabled={busy || !noteText.trim()}
                    onClick={() => act(() => api.addClusterNote(cluster.id, noteText).then(() => setNoteText('')))}
                    className="inline-flex items-center gap-1 rounded-md px-2.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <MessageSquarePlus className="h-4 w-4" aria-hidden /> Add
                  </button>
                </div>
              </section>

              {mergeTargets.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Same incident as another cluster?</h3>
                  <div className="flex gap-2">
                    <select
                      value={mergeInto}
                      onChange={(e) => setMergeInto(e.target.value)}
                      className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-slate-400 focus:outline-none"
                    >
                      <option value="">Choose a cluster to merge into…</option>
                      {mergeTargets.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.location_label || 'Unknown location'} · {c.report_count} reports · last {timeAgo(c.last_report_at, now)}
                        </option>
                      ))}
                    </select>
                    <button
                      disabled={busy || !mergeInto}
                      onClick={() => act(async () => {
                        await api.mergeCluster(cluster.id, mergeInto);
                        return { dissolved: true }; // this cluster no longer exists
                      })}
                      className="inline-flex items-center gap-1 rounded-md px-2.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <GitMerge className="h-4 w-4" aria-hidden /> Merge
                    </button>
                  </div>
                </section>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
