import { Landmark, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import TestCallButton from './TestCallButton';

const CONNECTION = {
  live: { label: 'Live', className: 'text-emerald-700 bg-emerald-50 ring-emerald-200', icon: Wifi, pulse: true },
  connecting: { label: 'Connecting…', className: 'text-slate-600 bg-slate-100 ring-slate-200', icon: Wifi },
  polling: { label: 'Auto-refresh', className: 'text-sky-700 bg-sky-50 ring-sky-200', icon: RefreshCw },
  offline: { label: 'Reconnecting', className: 'text-red-700 bg-red-50 ring-red-200', icon: WifiOff },
};

export default function Header({ connection }) {
  const conn = CONNECTION[connection] || CONNECTION.connecting;
  const ConnIcon = conn.icon;
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
            <Landmark className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">CivicLine Dispatch</h1>
            <p className="text-xs text-slate-500">AI call triage · City services &amp; emergencies</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${conn.className}`}>
            {conn.pulse ? (
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
            ) : (
              <ConnIcon className="h-3.5 w-3.5" aria-hidden />
            )}
            {conn.label}
          </span>
          <TestCallButton />
        </div>
      </div>
    </header>
  );
}
