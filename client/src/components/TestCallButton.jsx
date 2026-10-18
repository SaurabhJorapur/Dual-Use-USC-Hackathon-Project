import { Hand, Mic, PhoneCall, PhoneOff, LoaderCircle, Repeat } from 'lucide-react';
import { useWebCall } from '../hooks/useWebCall';

export default function TestCallButton() {
  const { status, agentTalking, error, loop, start, stop } = useWebCall();

  if (status === 'live') {
    return (
      <div className="relative flex flex-col items-end">
        <button
          onClick={stop}
          className="inline-flex items-center gap-2 rounded-full bg-red-700 px-4 py-3 text-sm font-semibold text-white shadow-lg ring-1 ring-black/5 hover:bg-red-800"
        >
          <Mic className={`h-4 w-4 ${agentTalking ? 'animate-pulse' : ''}`} aria-hidden />
          {agentTalking ? 'Agent speaking…' : 'Listening…'}
          <PhoneOff className="h-4 w-4" aria-hidden />
        </button>
        {loop.looping && (
          <div role="alert" className="absolute bottom-full right-0 z-40 mb-2 w-80 rounded-lg bg-red-600 p-3 text-white shadow-lg ring-2 ring-red-800">
            <p className="flex items-center gap-2 text-sm font-bold">
              <Repeat className="h-4 w-4 shrink-0" aria-hidden /> Agent Loop Detected — Manual Dispatch Advised
            </p>
            <p className="mt-1 truncate text-xs text-red-100">Repeating: “{loop.phrase}”</p>
            <button onClick={stop} className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-50">
              <Hand className="h-3.5 w-3.5" aria-hidden /> Operator Override: end AI call
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {error && <span className="max-w-[16rem] rounded-md bg-white px-2 py-1 text-right text-xs text-red-600 shadow-sm">{error}</span>}
      <button
        onClick={start}
        disabled={status === 'connecting'}
        className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-lg ring-1 ring-black/5 hover:bg-slate-800 disabled:opacity-60"
      >
        {status === 'connecting' ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <PhoneCall className="h-4 w-4" aria-hidden />}
        {status === 'connecting' ? 'Connecting…' : 'Test call'}
      </button>
    </div>
  );
}
