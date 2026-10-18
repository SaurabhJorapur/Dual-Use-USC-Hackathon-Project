import { Layers } from 'lucide-react';
import { CategoryIcon, StatusBadge, UrgencyBadge } from './Badges';
import { URGENCY } from '../lib/constants';
import { timeAgo } from '../lib/format';

const CLUSTER_STATUS = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  escalated: 'bg-red-50 text-red-700 ring-red-200',
  resolved: 'bg-slate-100 text-slate-600 ring-slate-200',
};

/** One log row standing for every call in a cluster. */
function ClusterRow({ cluster, calls, freshIds, now, onOpen }) {
  const open = () => onOpen(cluster.id);
  const latest = calls[0];
  return (
    <tr
      onClick={open}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open())}
      tabIndex={0}
      className={`cursor-pointer border-l-4 bg-slate-50/70 align-top transition-colors hover:bg-slate-100 focus:bg-slate-100 focus:outline-none ${
        URGENCY[cluster.max_urgency]?.row
      } ${calls.some((c) => freshIds.has(c.id)) ? 'animate-flash' : ''}`}
    >
      <td className="whitespace-nowrap px-3 py-2.5">
        <span className="inline-flex items-center gap-1 rounded-md bg-slate-700 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
          <Layers className="h-3 w-3" aria-hidden /> Cluster
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-500" title={`Latest report ${new Date(cluster.last_report_at).toLocaleString()}`}>
        {timeAgo(cluster.last_report_at, now)}
      </td>
      <td className="px-3 py-2.5">
        <span className="flex items-center gap-2 text-slate-800">
          <CategoryIcon category={cluster.category} size="h-6 w-6" />
          <span className="max-w-[13rem] leading-tight">{cluster.category}</span>
        </span>
      </td>
      <td className="px-3 py-2.5">
        <UrgencyBadge level={cluster.max_urgency} />
      </td>
      <td className="px-3 py-2.5">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${CLUSTER_STATUS[cluster.status]}`}>{cluster.status}</span>
      </td>
      <td className="hidden max-w-[14rem] truncate px-3 py-2.5 text-slate-600 2xl:table-cell">{cluster.location_label || <span className="text-slate-300">—</span>}</td>
      <td className="px-3 py-2.5 text-slate-800">
        <span className="font-semibold">
          {cluster.report_count} calls about the same incident
        </span>
        <span className="text-slate-500">
          {' '}
          · {cluster.unique_callers} unique {cluster.unique_callers === 1 ? 'caller' : 'callers'}
        </span>
        {latest?.summary && <span className="mt-0.5 line-clamp-1 min-w-[14rem] text-slate-600">Latest: {latest.summary}</span>}
        {cluster.location_label && <span className="mt-0.5 block truncate text-xs text-slate-400 2xl:hidden">{cluster.location_label}</span>}
      </td>
    </tr>
  );
}

/** `entries` from logEntries(): individual calls, plus one row per cluster. */
export default function CallTable({ entries, freshIds, now, selectedId, onSelect, onOpenCluster, emptyMessage }) {
  if (!entries.length) {
    return <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">{emptyMessage}</div>;
  }
  const th = 'sticky top-0 z-10 bg-slate-50 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500';
  return (
    <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="border-b border-slate-200">
          <tr>
            <th className={th}>Incident</th>
            <th className={th}>Received</th>
            <th className={th}>Category</th>
            <th className={th}>Urgency</th>
            <th className={th}>Status</th>
            <th className={`${th} hidden 2xl:table-cell`}>Location</th>
            <th className={`${th} w-full`}>Summary</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {entries.map(({ type, call, cluster, calls }) =>
            type === 'cluster' ? (
              <ClusterRow key={cluster.id} cluster={cluster} calls={calls} freshIds={freshIds} now={now} onOpen={onOpenCluster} />
            ) : (
              <tr
                key={call.id}
                onClick={() => onSelect(call)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(call))}
                tabIndex={0}
                className={`cursor-pointer border-l-4 align-top transition-colors hover:bg-slate-50 focus:bg-slate-50 focus:outline-none ${URGENCY[call.urgency_level]?.row} ${
                  selectedId === call.id ? 'bg-slate-50' : ''
                } ${freshIds.has(call.id) ? 'animate-flash' : ''}`}
              >
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-slate-700">{call.formal_report?.incident_id || '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-500" title={new Date(call.created_at).toLocaleString()}>
                  {timeAgo(call.created_at, now)}
                </td>
                <td className="px-3 py-2.5">
                  <span className="flex items-center gap-2 text-slate-800">
                    <CategoryIcon category={call.category} size="h-6 w-6" />
                    <span className="max-w-[13rem] leading-tight">{call.category}</span>
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <UrgencyBadge level={call.urgency_level} />
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={call.status} />
                </td>
                <td className="hidden max-w-[14rem] truncate px-3 py-2.5 text-slate-600 2xl:table-cell">{call.location || <span className="text-slate-300">—</span>}</td>
                <td className="px-3 py-2.5 text-slate-800">
                  <span className="line-clamp-2 min-w-[14rem]">{call.summary}</span>
                  {call.location && <span className="mt-0.5 block truncate text-xs text-slate-400 2xl:hidden">{call.location}</span>}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
