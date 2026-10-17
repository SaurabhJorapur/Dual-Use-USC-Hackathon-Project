import { Activity, FileText, Layers, Map as MapIcon, Radar, Siren } from 'lucide-react';
import CategoryChart from './CategoryChart';
import SurgeChart from './SurgeChart';

const VIEWS = [
  { id: 'map', label: 'Live City Map', icon: MapIcon },
  { id: 'logs', label: 'Call Logs & Records', icon: FileText },
  { id: 'clusters', label: 'Incident Clusters', icon: Layers },
  { id: 'simulation', label: 'Disaster Twin Simulator 🔮', icon: Radar },
];

const DAY = 24 * 60 * 60 * 1000;

export default function Sidebar({ view, onView, calls, now, activeCategory, onSelectCategory, badges = {} }) {
  const today = calls.filter((c) => now - new Date(c.created_at).getTime() < DAY);
  const escalated = today.filter((c) => c.status === 'Escalated to 911').length;
  const live = calls.filter((c) => c.status === 'In Progress').length;

  return (
    <aside className="flex shrink-0 flex-col gap-5 overflow-y-auto border-b border-slate-200 bg-white p-4 lg:w-[340px] lg:border-b-0 lg:border-r">
      <nav className="space-y-1" aria-label="Views">
        {VIEWS.map(({ id, label, icon: Icon }) => {
          const active = view === id;
          return (
            <button
              key={id}
              onClick={() => onView(id)}
              aria-current={active ? 'page' : undefined}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden />
              <span className="flex-1 text-left">{label}</span>
              {badges[id] ? (
                <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${active ? 'bg-white/20' : 'bg-slate-100 text-slate-600'}`}>{badges[id]}</span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Calls 24h', value: today.length, icon: Activity, color: 'text-slate-400' },
          { label: 'To 911', value: escalated, icon: Siren, color: 'text-red-500' },
          { label: 'Live now', value: live, icon: Activity, color: 'text-emerald-500' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-lg border border-slate-200 px-2.5 py-2">
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              {label} <Icon className={`h-3 w-3 ${color}`} aria-hidden />
            </div>
            <p className="text-lg font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <CategoryChart calls={calls} now={now} activeCategory={activeCategory} onSelectCategory={onSelectCategory} />
      <SurgeChart calls={calls} now={now} />
    </aside>
  );
}
