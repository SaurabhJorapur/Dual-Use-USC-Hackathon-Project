import { Siren } from 'lucide-react';

const WINDOW_MS = 30 * 60 * 1000;

export default function CriticalBanner({ calls, now, onSelect }) {
  const active = calls.filter((c) => c.urgency_level === 'Critical' && now - new Date(c.created_at).getTime() < WINDOW_MS);
  if (!active.length) return null;
  const latest = active[0];
  return (
    <button
      onClick={() => onSelect(latest)}
      className="flex w-full items-center gap-3 rounded-xl bg-red-600 px-4 py-3 text-left text-white shadow-sm hover:bg-red-700"
    >
      <Siren className="h-6 w-6 shrink-0 animate-pulse" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          {active.length} critical {active.length === 1 ? 'incident' : 'incidents'} in the last 30 minutes
        </p>
        <p className="truncate text-sm text-red-100">
          Latest: {latest.summary}
          {latest.location ? ` (${latest.location})` : ''}
        </p>
      </div>
      <span className="hidden text-xs font-medium text-red-100 sm:block">View →</span>
    </button>
  );
}
