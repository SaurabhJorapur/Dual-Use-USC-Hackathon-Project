import { ChevronRight, MapPin, Phone, User } from 'lucide-react';
import { CategoryIcon, StatusBadge, UrgencyBadge } from './Badges';
import { URGENCY } from '../lib/constants';
import { formatPhone, timeAgo } from '../lib/format';

export default function CallList({ calls, freshIds, now, onSelect, selectedId, emptyMessage }) {
  if (!calls.length) {
    return <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">{emptyMessage}</div>;
  }

  return (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
      {calls.map((call) => (
        <li key={call.id}>
          <button
            onClick={() => onSelect(call)}
            className={`group flex w-full items-start gap-3 border-l-4 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
              URGENCY[call.urgency_level]?.row
            } ${selectedId === call.id ? 'bg-slate-50' : ''} ${freshIds.has(call.id) ? 'animate-flash' : ''}`}
          >
            <CategoryIcon category={call.category} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <UrgencyBadge level={call.urgency_level} />
                <span className="text-sm font-medium text-slate-700">{call.category}</span>
                <span className="text-xs text-slate-400" title={new Date(call.created_at).toLocaleString()}>
                  · {timeAgo(call.created_at, now)}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-slate-900">{call.summary}</p>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                {call.location && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" aria-hidden />
                    {call.location}
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  {call.caller_name ? <User className="h-3.5 w-3.5" aria-hidden /> : <Phone className="h-3.5 w-3.5" aria-hidden />}
                  {call.caller_name ? `${call.caller_name} · ` : ''}
                  {formatPhone(call.caller_phone)}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 self-center">
              <span className="hidden sm:block">
                <StatusBadge status={call.status} />
              </span>
              <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500" aria-hidden />
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
