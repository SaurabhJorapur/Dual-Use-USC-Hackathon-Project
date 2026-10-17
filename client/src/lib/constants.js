import { Bot, Construction, Headset, Loader, ShieldAlert, Siren, TrafficCone, Volume2 } from 'lucide-react';

export const CATEGORIES = {
  'Public Safety': { icon: ShieldAlert, color: 'text-red-600 bg-red-50', bar: 'bg-red-500' },
  Potholes: { icon: Construction, color: 'text-amber-700 bg-amber-50', bar: 'bg-amber-500' },
  'Traffic Signals': { icon: TrafficCone, color: 'text-orange-600 bg-orange-50', bar: 'bg-orange-500' },
  'Noise & Other': { icon: Volume2, color: 'text-indigo-600 bg-indigo-50', bar: 'bg-indigo-500' },
};

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
