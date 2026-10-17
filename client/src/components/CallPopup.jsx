import { ArrowRight, MapPin } from 'lucide-react';
import { CategoryIcon, StatusBadge, UrgencyBadge } from './Badges';
import { timeAgo } from '../lib/format';

/** Compact card shown when a map pin is clicked. */
export default function CallPopup({ call, now, onOpen }) {
  const lines = (call.transcript || '').split('\n').filter(Boolean).slice(0, 4);
  return (
    <div className="w-72 font-sans">
      <div className="flex items-start gap-2.5">
        <CategoryIcon category={call.category} size="h-8 w-8" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <UrgencyBadge level={call.urgency_level} />
            <span className="text-xs text-slate-400">{timeAgo(call.created_at, now)}</span>
          </div>
          <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">{call.category}</p>
        </div>
      </div>
      {call.location && (
        <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden /> {call.location}
        </p>
      )}
      <p className="mt-2 text-sm leading-snug text-slate-800">{call.summary}</p>
      {lines.length > 0 && (
        <div className="mt-2 space-y-0.5 rounded-md bg-slate-50 p-2 text-xs text-slate-600">
          {lines.map((line, i) => (
            <p key={i} className="line-clamp-2">
              {line.replace(/^User:/, 'Caller:').replace(/^Agent:/, 'AI:')}
            </p>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        <StatusBadge status={call.status} />
        <button
          onClick={() => onOpen(call)}
          className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800"
        >
          Full report <ArrowRight className="h-3 w-3" aria-hidden />
        </button>
      </div>
    </div>
  );
}
