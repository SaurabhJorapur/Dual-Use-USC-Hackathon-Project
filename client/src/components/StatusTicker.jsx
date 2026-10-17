import { CATEGORIES, DEFAULT_CATEGORY } from '../lib/constants';
import { timeAgo } from '../lib/format';

/** Low-profile bottom bar scrolling the latest call activity. Hover pauses it. */
export default function StatusTicker({ calls, now, freshIds, onSelect }) {
  const recent = calls.slice(0, 10);

  const items = (copy) =>
    recent.map((call) => {
      const meta = CATEGORIES[call.category] || CATEGORIES[DEFAULT_CATEGORY];
      return (
        <button
          key={`${copy}-${call.id}`}
          onClick={() => onSelect(call)}
          tabIndex={copy ? -1 : 0}
          aria-hidden={copy ? true : undefined}
          className={`inline-flex shrink-0 items-center gap-2 rounded px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-900 ${
            freshIds.has(call.id) ? 'animate-flash' : ''
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${call.urgency_level === 'Critical' ? 'animate-pulse' : ''}`} style={{ background: meta.hex }} />
          <span className="font-medium text-slate-800">{call.category}</span>
          <span className="max-w-[22rem] truncate">{call.summary}</span>
          <span className="text-slate-400">{timeAgo(call.created_at, now)}</span>
        </button>
      );
    });

  return (
    <footer className="flex h-9 shrink-0 items-center border-t border-slate-200 bg-white text-xs">
      <span className="flex h-full shrink-0 items-center gap-2 border-r border-slate-200 px-3 font-semibold uppercase tracking-wide text-slate-500">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        Live
      </span>
      <div className="relative min-w-0 flex-1 overflow-hidden">
        {recent.length ? (
          <div className="flex w-max animate-marquee gap-6 hover:[animation-play-state:paused] motion-reduce:animate-none">
            <div className="flex gap-6 pl-3">{items('')}</div>
            <div className="flex gap-6 pl-3">{items('copy')}</div>
          </div>
        ) : (
          <span className="px-3 text-slate-400">Waiting for calls…</span>
        )}
      </div>
    </footer>
  );
}
