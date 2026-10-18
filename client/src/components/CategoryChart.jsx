import { useState } from 'react';
import { CATEGORIES } from '../lib/constants';
import { categoryCounts } from '../lib/stats';

const DAY = 24 * 60 * 60 * 1000;

/** Category breakdown; clicking a row toggles the shared category filter. */
export default function CategoryChart({ calls, now, activeCategory, onSelectCategory }) {
  const [range, setRange] = useState('all');
  const inRange = range === 'day' ? calls.filter((c) => now - new Date(c.created_at).getTime() < DAY) : calls;
  const counts = categoryCounts(inRange, Object.keys(CATEGORIES));
  const total = inRange.length;

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Category distribution</h2>
        <div className="flex rounded-md bg-slate-100 p-0.5 text-[11px] font-medium">
          {[
            ['day', '24h'],
            ['all', 'All'],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setRange(id)}
              className={`rounded px-2 py-0.5 transition-colors ${range === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <ul className="space-y-0.5">
        {Object.entries(CATEGORIES).map(([cat, meta]) => {
          const Icon = meta.icon;
          const n = counts[cat];
          const pct = total ? Math.round((n / total) * 100) : 0;
          const active = activeCategory === cat;
          return (
            <li key={cat}>
              <button
                onClick={() => onSelectCategory(active ? '' : cat)}
                aria-pressed={active}
                title={active ? 'Show all categories' : `Show only ${cat}`}
                className={`w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-slate-50 ${active ? 'bg-slate-100 ring-1 ring-inset ring-slate-300' : ''} ${
                  activeCategory && !active ? 'opacity-50' : ''
                }`}
              >
                <span className="flex items-center gap-2 text-sm">
                  <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: meta.hex }} aria-hidden />
                  <span className={`min-w-0 flex-1 truncate ${active ? 'font-medium text-slate-900' : 'text-slate-700'}`}>{cat}</span>
                  <span className="tabular-nums text-slate-900">{n}</span>
                  <span className="w-8 text-right text-xs tabular-nums text-slate-400">{pct}%</span>
                </span>
                <span className="mt-1 block h-1 overflow-hidden rounded-full bg-slate-100">
                  <span className="block h-full rounded-full transition-all" style={{ width: `${pct}%`, background: meta.hex }} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
