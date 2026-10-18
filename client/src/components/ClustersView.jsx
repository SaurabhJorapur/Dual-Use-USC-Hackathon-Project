import { useMemo, useState } from 'react';
import { Layers, Radar, TriangleAlert } from 'lucide-react';
import ClusterCard from './ClusterCard';
import ClusterChart from './ClusterChart';
import ClusterDetail from './ClusterDetail';
import { ISSUE_TYPES, OTHER_ISSUE, UNCLUSTERED_HEX, detectSurges, isActive, isRising, issueType, rankScore } from '../lib/clusters';

const HOUR = 60 * 60 * 1000;
const RANGES = { '1h': HOUR, '24h': 24 * HOUR, '7d': 7 * 24 * HOUR };
const EMPTY_FILTERS = { category: '', urgency: '', status: '', range: '24h', sort: 'rank' };
const SORTS = {
  rank: (now) => (a, b) => rankScore(b, now) - rankScore(a, now),
  count: () => (a, b) => b.report_count - a.report_count,
  recency: () => (a, b) => new Date(b.last_report_at) - new Date(a.last_report_at),
};

const selectClass = 'rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 focus:border-slate-400 focus:outline-none';

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600">
      {[...Object.values(ISSUE_TYPES), OTHER_ISSUE].map((t) => (
        <span key={t.legend} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.hex }} /> {t.legend}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: UNCLUSTERED_HEX }} /> Individual reports
      </span>
      <span className="text-slate-400">· Color = issue type; size and the count show how big and serious it is.</span>
    </div>
  );
}

function SurgeBanner({ surges }) {
  if (!surges.length) return null;
  return (
    <div className="space-y-2">
      {surges.map((s) => (
        <div key={s.cell} className="flex items-start gap-3 rounded-xl border-2 border-red-300 bg-red-50 p-4 shadow-sm">
          <span className="relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-600 text-white">
            <Radar className="relative h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-red-900">Surge detected near {s.label}</p>
            <p className="text-sm text-red-800">
              {s.count} reports in the last 30 minutes within ~1 km. This area normally sees {s.baseline} at this time of day.
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {s.categories.map((c) => (
                <span key={c} className="flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-red-200">
                  <span className="h-2 w-2 rounded-full" style={{ background: issueType(c).hex }} /> {issueType(c).short}
                </span>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Incident clustering: matching calls grouped into incidents, ranked, charted and watched for surges. */
export default function ClustersView({ calls, clusters, loading, error, onReload, now }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [openId, setOpenId] = useState(null);
  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));

  const timesById = useMemo(() => {
    const created = new Map(calls.map((c) => [c.id, new Date(c.created_at).getTime()]));
    return new Map(clusters.map((c) => [c.id, c.member_ids.map((id) => created.get(id)).filter(Boolean)]));
  }, [calls, clusters]);
  const surges = useMemo(() => detectSurges(calls, now), [calls, now]);

  const shown = useMemo(() => {
    const since = now - RANGES[filters.range];
    return clusters
      .filter((c) => new Date(c.last_report_at).getTime() >= since)
      .filter((c) => !filters.category || c.category === filters.category)
      .filter((c) => !filters.urgency || c.max_urgency === filters.urgency)
      .filter((c) => {
        if (!filters.status) return true;
        if (filters.status === 'history') return !isActive(c, now);
        return c.status === filters.status && (filters.status === 'resolved' || isActive(c, now));
      })
      .sort(SORTS[filters.sort](now));
  }, [clusters, filters, now]);
  const active = shown.filter((c) => isActive(c, now));
  const history = shown.filter((c) => !isActive(c, now));
  const filtered = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

  const card = (c, i) => {
    const rising = isRising(timesById.get(c.id) || [], now);
    const live = isActive(c, now);
    return (
      <ClusterCard
        key={c.id}
        cluster={c}
        rising={rising}
        active={live}
        prominent={live && (i === 0 || c.max_urgency === 'Critical' || (rising && c.report_count >= 5))}
        now={now}
        onOpen={setOpenId}
      />
    );
  };

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Layers className="h-5 w-5 text-slate-500" aria-hidden /> Incident Clusters
          </h2>
          <p className="text-sm text-slate-500">
            Matching calls (same issue, about the same place, under an hour apart) grouped into one incident with a count.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <SurgeBanner surges={surges} />
        <Legend />

        {error && (
          <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
            <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden /> Couldn't load clusters: {error}
          </p>
        )}

        <ClusterChart calls={calls} clusters={clusters} now={now} onOpen={setOpenId} />

        <div className="flex flex-wrap items-center gap-2">
          <select value={filters.category} onChange={set('category')} className={selectClass} aria-label="Issue type">
            <option value="">All issue types</option>
            {Object.entries(ISSUE_TYPES).map(([cat, t]) => (
              <option key={cat} value={cat}>
                {t.legend}
              </option>
            ))}
          </select>
          <select value={filters.urgency} onChange={set('urgency')} className={selectClass} aria-label="Urgency">
            <option value="">Any urgency</option>
            <option>Critical</option>
            <option>Urgent</option>
            <option>Standard</option>
          </select>
          <select value={filters.status} onChange={set('status')} className={selectClass} aria-label="Status">
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="escalated">Escalated</option>
            <option value="resolved">Resolved</option>
            <option value="history">History (inactive)</option>
          </select>
          <select value={filters.range} onChange={set('range')} className={selectClass} aria-label="Time range">
            <option value="1h">Last hour</option>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last week</option>
          </select>
          <select value={filters.sort} onChange={set('sort')} className={selectClass} aria-label="Sort">
            <option value="rank">Sort: priority</option>
            <option value="count">Sort: report count</option>
            <option value="recency">Sort: most recent</option>
          </select>
          {filtered && (
            <button onClick={() => setFilters(EMPTY_FILTERS)} className="text-sm font-medium text-slate-500 hover:text-slate-900">
              Reset
            </button>
          )}
        </div>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Active incidents · {active.length}</h3>
          {active.length ? (
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">{active.map(card)}</div>
          ) : (
            <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
              {loading ? 'Loading clusters…' : 'No active incidents. A cluster forms when a second matching call arrives.'}
            </p>
          )}
        </section>

        {history.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">History · {history.length}</h3>
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">{history.map((c) => card(c, -1))}</div>
          </section>
        )}
      </div>

      {openId && <ClusterDetail clusterId={openId} clusters={clusters} now={now} onClose={() => setOpenId(null)} onChanged={onReload} />}
    </div>
  );
}
