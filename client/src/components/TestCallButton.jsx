import { Mic, PhoneCall, PhoneOff, LoaderCircle } from 'lucide-react';
import { useWebCall } from '../hooks/useWebCall';

export default function TestCallButton() {
  const { status, agentTalking, error, start, stop } = useWebCall();

  if (status === 'live') {
    return (
      <button
        onClick={stop}
        className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700"
      >
        <Mic className={`h-4 w-4 ${agentTalking ? 'animate-pulse' : ''}`} aria-hidden />
        {agentTalking ? 'Agent speaking…' : 'Listening…'}
        <PhoneOff className="h-4 w-4" aria-hidden />
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end">
      <button
        onClick={start}
        disabled={status === 'connecting'}
        className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
      >
        {status === 'connecting' ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <PhoneCall className="h-4 w-4" aria-hidden />}
        {status === 'connecting' ? 'Connecting…' : 'Test call'}
      </button>
      {error && <span className="mt-1 max-w-[16rem] text-right text-xs text-red-600">{error}</span>}
    </div>
  );
}
