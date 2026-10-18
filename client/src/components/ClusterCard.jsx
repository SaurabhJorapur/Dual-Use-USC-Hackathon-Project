import { Clock, MapPin, TrendingUp, Users } from 'lucide-react';
import { clusterTitle, issueType } from '../lib/clusters';
import { clockTime, timeAgo } from '../lib/format';

const STATUS_STYLE = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  escalated: 'bg-red-50 text-red-700 ring-red-200',
  resolved: 'bg-slate-100 text-slate-600 ring-slate-200',
  inactive: 'bg-slate-100 text-slate-500 ring-slate-200',
};

/**
 * One incident. `prominent` cards (top-ranked, rising fast or critical) are bigger, more
 * strongly tinted and marked with a dot, so the most important incident is the first thing the eye sees.
 */
export default function ClusterCard({ cluster, rising, active, prominent, now, onOpen }) {
  const { hex } = issueType(cluster.category);
  const status = cluster.status === 'resolved' ? 'resolved' : active ? cluster.status : 'inactive';
  const critical = cluster.max_urgency === 'Critical';

  return (
    <button
      onClick={() => onOpen(cluster.id)}
      className={`group relative flex w-full flex-col rounded-xl border bg-white p-4 text-left shadow-sm transition hover:shadow-md ${
        prominent ? 'sm:col-span-2 border-2' : 'border-slate-200'
      } ${active ? '' : 'opacity-75'}`}
      style={prominent ? { borderColor: hex, background: `linear-gradient(135deg, ${hex}14, #fff 55%)` } : undefined}
    >
      {prominent && active && <span className="absolute right-3 top-3 h-3 w-3 rounded-full" style={{ background: hex }} />}

      <div className="flex items-center gap-2 pr-6">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: hex }} />
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: hex }}>
          {issueType(cluster.category).short}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ring-1 ring-inset ${STATUS_STYLE[status]}`}>{status}</span>
        {critical && <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white">Critical</span>}
        {!critical && cluster.max_urgency === 'Urgent' && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Urgent</span>
        )}
      </div>

      <div className="mt-2 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className={`font-semibold text-slate-900 ${prominent ? 'text-lg' : 'text-sm'}`}>{clusterTitle(cluster)}</h3>
          <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden /> <span className="truncate">{cluster.location_label || 'Unknown location'}</span>
          </p>
        </div>
        <div className="text-right">
          <p className={`flex items-center justify-end gap-1 font-bold tabular-nums leading-none text-slate-900 ${prominent ? 'text-5xl' : 'text-3xl'}`}>
            {rising && active && <TrendingUp className={`${prominent ? 'h-6 w-6' : 'h-4 w-4'} text-red-500`} aria-label="Rising" />}
            {cluster.report_count}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">reports</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" aria-hidden /> Last reported {timeAgo(cluster.last_report_at, now)}
        </span>
        <span>First {clockTime(cluster.first_report_at)}</span>
        <span className="flex items-center gap-1">
          <Users className="h-3.5 w-3.5" aria-hidden /> {cluster.unique_callers} unique {cluster.unique_callers === 1 ? 'caller' : 'callers'}
        </span>
      </div>
    </button>
  );
}
