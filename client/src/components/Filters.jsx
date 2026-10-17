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

export default function Filters({ filters, onChange }) {
  const set = (key) => (value) => onChange({ ...filters, [key]: value });
  const active = Object.values(filters).some(Boolean);
  return (
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
        <Select label="Categories" value={filters.category} onChange={set('category')} options={Object.keys(CATEGORIES)} />
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
