import { Search, X } from 'lucide-react';
import { CATEGORIES, STATUS, URGENCY } from '../lib/constants';

function Select({ label, value, onChange, options }) {
  return (
    <label className="flex-1 sm:flex-none">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
      >
        <option value="">All {label.toLowerCase()}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export const EMPTY_FILTERS = { search: '', category: '', urgency: '', status: '' };

function CategoryPills({ value, onChange, counts }) {
  const pill = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors';
  const idle = 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50';
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
      <button onClick={() => onChange('')} aria-pressed={!value} className={`${pill} ${!value ? 'bg-slate-900 text-white ring-slate-900' : idle}`}>
        All <span className="tabular-nums opacity-70">{counts.all}</span>
      </button>
      {Object.entries(CATEGORIES).map(([cat, meta]) => {
        const Icon = meta.icon;
        const active = value === cat;
        return (
          <button key={cat} onClick={() => onChange(active ? '' : cat)} aria-pressed={active} className={`${pill} ${active ? meta.pill : idle}`}>
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {cat}
            <span className="tabular-nums opacity-70">{counts[cat] || 0}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function Filters({ filters, onChange, calls = [] }) {
  const set = (key) => (value) => onChange({ ...filters, [key]: value });
  const active = Object.values(filters).some(Boolean);
  const counts = calls.reduce((acc, c) => ({ ...acc, [c.category]: (acc[c.category] || 0) + 1 }), { all: calls.length });
  return (
    <div className="space-y-3">
    <CategoryPills value={filters.category} onChange={set('category')} counts={counts} />
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <label className="relative flex-1 sm:min-w-[16rem]">
        <span className="sr-only">Search calls</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          type="search"
          value={filters.search}
          onChange={(e) => set('search')(e.target.value)}
          placeholder="Search summary, location, caller…"
          className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Select label="Urgency" value={filters.urgency} onChange={set('urgency')} options={Object.keys(URGENCY)} />
        <Select label="Statuses" value={filters.status} onChange={set('status')} options={Object.keys(STATUS)} />
        {active && (
          <button
            onClick={() => onChange(EMPTY_FILTERS)}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" aria-hidden /> Clear
          </button>
        )}
      </div>
    </div>
    </div>
  );
}

export function applyFilters(calls, { search, category, urgency, status }) {
  const q = search.trim().toLowerCase();
  return calls.filter(
    (c) =>
      (!category || c.category === category) &&
      (!urgency || c.urgency_level === urgency) &&
      (!status || c.status === status) &&
      (!q || [c.summary, c.location, c.caller_name, c.caller_phone].some((v) => v?.toLowerCase().includes(q))),
  );
}
