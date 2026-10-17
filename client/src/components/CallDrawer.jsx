import { useEffect, useState } from 'react';
import { Clock, FileText, MapPin, Phone, User, X } from 'lucide-react';
import { CategoryIcon, StatusBadge, UrgencyBadge } from './Badges';
import { STATUS } from '../lib/constants';
import { api } from '../lib/api';
import { clockTime, formatPhone } from '../lib/format';

function Field({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="break-words text-sm text-slate-900">{children || <span className="text-slate-400">Not provided</span>}</p>
      </div>
    </div>
  );
}

function Transcript({ text }) {
  if (!text) return <p className="text-sm text-slate-400">Transcript not available yet.</p>;
  return (
    <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg bg-slate-50 p-3">
      {text.split('\n').filter(Boolean).map((line, i) => {
        const m = /^(Agent|User):\s*(.*)$/.exec(line);
        const isAgent = m?.[1] === 'Agent';
        return (
          <p key={i} className="text-sm">
            {m && <span className={`mr-1.5 font-semibold ${isAgent ? 'text-slate-500' : 'text-slate-900'}`}>{isAgent ? 'AI Agent' : 'Caller'}:</span>}
            <span className="text-slate-700">{m ? m[2] : line}</span>
          </p>
        );
      })}
    </div>
  );
}

function Timeline({ events }) {
  if (!events?.length) return <p className="text-sm text-slate-400">No events recorded.</p>;
  return (
    <ol className="relative space-y-4 border-l border-slate-200 pl-5">
      {events.map((e, i) => (
        <li key={i} className="relative">
          <span
            className={`absolute -left-[1.6rem] top-1 h-3 w-3 rounded-full ring-4 ring-white ${
              e.escalated_to === 'Escalated to 911' ? 'bg-red-500' : e.escalated_to ? 'bg-amber-500' : 'bg-slate-300'
            }`}
          />
          <p className="text-sm font-medium text-slate-900">{e.event}</p>
          {e.detail && <p className="text-sm text-slate-600">{e.detail}</p>}
          <p className="text-xs text-slate-400">{clockTime(e.at)}</p>
        </li>
      ))}
    </ol>
  );
}

export default function CallDrawer({ call, onClose, onUpdated }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setError(null);
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [call?.id, onClose]);

  if (!call) return null;

  const changeStatus = async (status) => {
    if (status === call.status) return;
    setSaving(true);
    setError(null);
    try {
      onUpdated(await api.updateStatus(call.id, status));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30 flex justify-end" role="dialog" aria-modal="true" aria-label="Call details">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-xl animate-slide-in flex-col bg-white shadow-xl">
        <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
          <CategoryIcon category={call.category} size="h-11 w-11" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <UrgencyBadge level={call.urgency_level} />
              <StatusBadge status={call.status} />
            </div>
            <h2 className="mt-1 text-base font-semibold">{call.category}</h2>
            <p className="text-xs text-slate-500">{new Date(call.created_at).toLocaleString()}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Summary</h3>
            <p className="text-sm leading-relaxed text-slate-900">{call.summary}</p>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <Field icon={MapPin} label="Location">{call.location}</Field>
            <Field icon={User} label="Caller">{call.caller_name}</Field>
            <Field icon={Phone} label="Phone">{formatPhone(call.caller_phone)}</Field>
            <Field icon={FileText} label="Retell call ID">
              <span className="font-mono text-xs">{call.retell_call_id}</span>
            </Field>
          </section>

          {call.audio_url && (
            <section>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Recording</h3>
              <audio controls src={call.audio_url} className="w-full" preload="none" />
            </section>
          )}

          <section>
            <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Clock className="h-3.5 w-3.5" aria-hidden /> Escalation timeline
            </h3>
            <Timeline events={call.escalation_timeline} />
          </section>

          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Transcript</h3>
            <Transcript text={call.transcript} />
          </section>
        </div>

        <div className="border-t border-slate-200 bg-slate-50 px-5 py-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Dispatcher action</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(STATUS).map(([status, meta]) => {
              const Icon = meta.icon;
              const current = status === call.status;
              return (
                <button
                  key={status}
                  disabled={saving || current}
                  onClick={() => changeStatus(status)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition ${
                    current ? `${meta.badge} cursor-default` : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-100 disabled:opacity-50'
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {status}
                </button>
              );
            })}
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
      </aside>
    </div>
  );
}
