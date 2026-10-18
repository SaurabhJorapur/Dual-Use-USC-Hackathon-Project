import { Landmark } from 'lucide-react';
import TestCallButton from './TestCallButton';

export default function Header() {
  return (
    <header className="z-20 shrink-0 border-b border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white">
            <Landmark className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">CivicLine Dispatch</h1>
            <p className="text-xs text-slate-500">Municipal command center · AI call triage</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <TestCallButton />
        </div>
      </div>
    </header>
  );
}
