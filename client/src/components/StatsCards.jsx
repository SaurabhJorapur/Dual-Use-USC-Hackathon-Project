import { Activity, Bot, Headset, Siren } from 'lucide-react';
import { CATEGORIES } from '../lib/constants';

function Stat({ icon: Icon, label, value, sub, accent }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <Icon className={`h-4 w-4 ${accent}`} aria-hidden />
      </div>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export default function StatsCards({ calls, now }) {
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const today = calls.filter((c) => new Date(c.created_at).getTime() >= dayAgo);
  const count = (list, key, val) => list.filter((c) => c[key] === val).length;

  const finished = today.filter((c) => c.status !== 'In Progress');
  const aiDone = count(today, 'status', 'AI Completed');
  const aiRate = finished.length ? Math.round((aiDone / finished.length) * 100) : 0;

  const byCategory = Object.keys(CATEGORIES).map((cat) => ({ cat, n: count(today, 'category', cat) }));
  const max = Math.max(1, ...byCategory.map((c) => c.n));

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,22rem)]">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat icon={Activity} label="Calls (24h)" value={today.length} sub={`${count(today, 'status', 'In Progress')} in progress`} accent="text-slate-400" />
        <Stat icon={Siren} label="Escalated to 911" value={count(today, 'status', 'Escalated to 911')} sub={`${count(today, 'urgency_level', 'Critical')} critical`} accent="text-red-500" />
        <Stat icon={Headset} label="Human dispatch" value={count(today, 'status', 'Escalated to Human')} sub={`${count(today, 'urgency_level', 'Urgent')} urgent`} accent="text-amber-500" />
        <Stat icon={Bot} label="Resolved by AI" value={aiDone} sub={`${aiRate}% of completed calls`} accent="text-emerald-500" />
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-medium text-slate-500">By category (24h)</p>
        <ul className="mt-3 space-y-2.5">
          {byCategory.map(({ cat, n }) => (
            <li key={cat} className="grid grid-cols-[7.5rem_1fr_2rem] items-center gap-2 text-sm">
              <span className="truncate text-slate-700">{cat}</span>
              <span className="h-2 overflow-hidden rounded-full bg-slate-100">
                <span className={`block h-full rounded-full ${CATEGORIES[cat].bar}`} style={{ width: `${(n / max) * 100}%` }} />
              </span>
              <span className="text-right tabular-nums text-slate-600">{n}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
