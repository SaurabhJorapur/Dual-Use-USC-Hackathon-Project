import { CATEGORIES, STATUS, URGENCY } from '../lib/constants';

export function UrgencyBadge({ level }) {
  const meta = URGENCY[level] || URGENCY.Standard;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${meta.badge}`}>
      {level === 'Critical' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />}
      {level}
    </span>
  );
}

export function StatusBadge({ status }) {
  const meta = STATUS[status] || STATUS['In Progress'];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${meta.badge}`}>
      <Icon className={`h-3.5 w-3.5 ${status === 'In Progress' ? 'animate-spin' : ''}`} aria-hidden />
      {status}
    </span>
  );
}

export function CategoryIcon({ category, size = 'h-9 w-9' }) {
  const meta = CATEGORIES[category] || CATEGORIES['Noise & Other'];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-lg ${size} ${meta.color}`} title={category}>
      <Icon className="h-[55%] w-[55%]" aria-hidden />
    </span>
  );
}
