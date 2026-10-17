import { Bot, Construction, Droplets, Headset, Loader, Siren, Trash, TriangleAlert } from 'lucide-react';

// Ordered by priority. `pill` is the active state of the category filter pills; `hex` colors map pins and charts.
export const CATEGORIES = {
  'Emergency / Active Danger': { hex: '#dc2626', icon: Siren, color: 'text-red-600 bg-red-50', bar: 'bg-red-500', pill: 'bg-red-600 text-white ring-red-600' },
  'Public Safety & Hazards': { hex: '#f59e0b', icon: TriangleAlert, color: 'text-amber-700 bg-amber-50', bar: 'bg-amber-400', pill: 'bg-amber-400 text-amber-950 ring-amber-400' },
  'Roads & Infrastructure': { hex: '#2563eb', icon: Construction, color: 'text-blue-700 bg-blue-50', bar: 'bg-blue-500', pill: 'bg-blue-600 text-white ring-blue-600' },
  'Utilities & Water': { hex: '#0284c7', icon: Droplets, color: 'text-sky-700 bg-sky-50', bar: 'bg-sky-500', pill: 'bg-sky-600 text-white ring-sky-600' },
  'Code Enforcement & Sanitation': { hex: '#64748b', icon: Trash, color: 'text-slate-600 bg-slate-100', bar: 'bg-slate-400', pill: 'bg-slate-600 text-white ring-slate-600' },
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
