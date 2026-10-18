import { Bot, Construction, Droplets, Headset, Loader, Siren, Trash, TriangleAlert } from 'lucide-react';

// Ordered by priority. Official municipal colors (red, amber, yellow, blue, gray), desaturated so
// the dashboard reads calm. `pill` is the active state of the category filter pills; `hex` colors map pins and charts.
export const CATEGORIES = {
  'Emergency / Active Danger': { hex: '#b4544e', icon: Siren, color: 'text-[#9a4540] bg-[#b4544e]/10', bar: 'bg-[#b4544e]', pill: 'bg-[#b4544e] text-white ring-[#b4544e]' },
  'Public Safety & Hazards': { hex: '#c4843f', icon: TriangleAlert, color: 'text-[#9c6630] bg-[#c4843f]/10', bar: 'bg-[#c4843f]', pill: 'bg-[#c4843f] text-white ring-[#c4843f]' },
  'Roads & Infrastructure': { hex: '#b5a04a', icon: Construction, color: 'text-[#857532] bg-[#b5a04a]/15', bar: 'bg-[#b5a04a]', pill: 'bg-[#b5a04a] text-slate-900 ring-[#b5a04a]' },
  'Utilities & Water': { hex: '#5a7ca3', icon: Droplets, color: 'text-[#46658a] bg-[#5a7ca3]/10', bar: 'bg-[#5a7ca3]', pill: 'bg-[#5a7ca3] text-white ring-[#5a7ca3]' },
  'Code Enforcement & Sanitation': { hex: '#7d8796', icon: Trash, color: 'text-slate-600 bg-slate-100', bar: 'bg-[#7d8796]', pill: 'bg-[#7d8796] text-white ring-[#7d8796]' },
};

export const DEFAULT_CATEGORY = 'Code Enforcement & Sanitation';

export const URGENCY = {
  Critical: { badge: 'bg-red-600 text-white', dot: 'bg-red-600', row: 'border-l-red-600' },
  Urgent: { badge: 'bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-300', dot: 'bg-amber-500', row: 'border-l-amber-400' },
  Standard: { badge: 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200', dot: 'bg-slate-400', row: 'border-l-transparent' },
};

export const STATUS = {
  'Escalated to 911': { icon: Siren, badge: 'text-red-700 bg-red-50 ring-red-200' },
  'Escalated to Human': { icon: Headset, badge: 'text-amber-800 bg-amber-50 ring-amber-200' },
  'AI Completed': { icon: Bot, badge: 'text-emerald-700 bg-emerald-50 ring-emerald-200' },
  'In Progress': { icon: Loader, badge: 'text-sky-700 bg-sky-50 ring-sky-200' },
};
