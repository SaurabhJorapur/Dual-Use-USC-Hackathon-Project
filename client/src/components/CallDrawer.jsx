import { useEffect, useMemo, useState } from 'react';
import { Bot, Clock, FileText, Hand, Headset, MapPin, Phone, Repeat, TriangleAlert, User, X } from 'lucide-react';
import { CategoryIcon, StatusBadge, UrgencyBadge } from './Badges';
import IncidentReport from './IncidentReport';
import { STATUS } from '../lib/constants';
import { api } from '../lib/api';
import { clockTime, formatPhone, isWebReport } from '../lib/format';
import { detectAgentLoop, parseTranscript } from '../lib/agentLoop';

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

function AiModeBadge({ override, live }) {
  if (override) {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-amber-500 px-2 py-0.5 text-xs font-bold text-amber-950">
        ⚠️ Manual Dispatch Mode (Operator Active)
      </span>
    );
  }
  if (!live) return null;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-300">
      <Bot className="h-3.5 w-3.5" aria-hidden /> AI Active / Listening
    </span>
  );
}

function LoopBanner({ phrase, onTakeOver, onTransfer, onDismiss, transferring, transferred }) {
  return (
    <div role="alert" className="border-b-2 border-red-700 bg-red-600 px-5 py-3 text-white">
      <p className="flex items-center gap-2 text-sm font-bold">
        <Repeat className="h-4 w-4 shrink-0" aria-hidden />
        Agent Loop Detected — Manual Dispatch Advised
      </p>
      {phrase && <p className="mt-1 truncate text-xs text-red-100">Repeating: “{phrase}”</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button onClick={onTakeOver} className="inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-50">
          <Hand className="h-3.5 w-3.5" aria-hidden /> Operator Override
        </button>
        {!transferred && (
          <button
            onClick={onTransfer}
            disabled={transferring}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-800 px-2.5 py-1 text-xs font-semibold text-white ring-1 ring-inset ring-red-300 hover:bg-red-900 disabled:opacity-60"
          >
            <Headset className="h-3.5 w-3.5" aria-hidden /> Transfer to human dispatcher
          </button>
        )}
        <button onClick={onDismiss} className="ml-auto rounded-md px-2 py-1 text-xs text-red-100 hover:bg-red-700">
          Dismiss
        </button>
      </div>
    </div>
  );
}

export default function CallDrawer({ call, onClose, onUpdated, override = false, onOverride }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('report');
  const [notice, setNotice] = useState(null);
  const [loopFlagged, setLoopFlagged] = useState(false);
  const [loopDismissed, setLoopDismissed] = useState(false);
  const loop = useMemo(() => detectAgentLoop(parseTranscript(call?.transcript)), [call?.transcript]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    setNotice(null);
    setLoopFlagged(false);
    setLoopDismissed(false);
  }, [call?.id]);

  useEffect(() => {
    setError(null);
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [call?.id, onClose]);

  if (!call) return null;
  const web = isWebReport(call);
  // Web reports have no AI agent on the line, so there is nothing to take over.
  const aiCall = !web;
  const showLoop = aiCall && (loop.looping || loopFlagged) && !override && !loopDismissed;

  const setOverride = async (on) => {
    // A live call is handed to the operator's phone; a finished one only changes how it is shown.
    if (on && call.status === 'In Progress') {
      setSaving(true);
      setError(null);
      try {
        onUpdated(await api.takeOverCall(call.id));
      } catch (err) {
        setNotice(`Could not transfer the call: ${err.message}`);
        return;
      } finally {
        setSaving(false);
      }
      onOverride?.(call.id, true);
      setNotice('AI Agent muted. Operator has taken manual control of dispatch. Transferring the caller to the operator line…');
      return;
    }
    onOverride?.(call.id, on);
    setNotice(on ? 'Operator has taken manual control of dispatch.' : 'AI agent control resumed.');
  };

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
              {aiCall && <AiModeBadge override={override} live={call.status === 'In Progress'} />}
            </div>
            <h2 className="mt-1 text-base font-semibold">{call.category}</h2>
            <p className="text-xs text-slate-500">{new Date(call.created_at).toLocaleString()}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {showLoop && (
          <LoopBanner
            phrase={loop.phrase}
            onTakeOver={() => setOverride(true)}
            onTransfer={() => changeStatus('Escalated to Human')}
            onDismiss={() => setLoopDismissed(true)}
            transferring={saving}
            transferred={call.status === 'Escalated to Human'}
          />
        )}

        {aiCall && (
          <div className={`border-b px-5 py-3 ${override ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
            {override ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="flex flex-1 items-center gap-1.5 text-sm font-semibold text-amber-900">
                  <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden /> Operator is handling dispatch manually
                </p>
                <button
                  onClick={() => setOverride(false)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-100"
                >
                  <Bot className="h-4 w-4" aria-hidden /> Resume AI control
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setOverride(true)}
                  disabled={saving}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-bold text-amber-950 shadow-sm ring-2 ring-amber-600 hover:bg-amber-400 disabled:opacity-60"
                >
                  <Hand className="h-4 w-4" aria-hidden /> {saving ? 'Transferring…' : 'Take Over Call (Operator Override)'}
                </button>
                {!showLoop && (
                  <button
                    onClick={() => {
                      setLoopFlagged(true);
                      setLoopDismissed(false);
                    }}
                    className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  >
                    Flag agent loop
                  </button>
                )}
              </div>
            )}
            {notice && (
              <p role="status" className="mt-2 rounded-md bg-slate-900 px-3 py-2 text-sm text-white">
                {notice}
              </p>
            )}
          </div>
        )}

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Summary</h3>
            <p className="text-sm leading-relaxed text-slate-900">{call.summary}</p>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <Field icon={MapPin} label="Location">{call.location}</Field>
            <Field icon={User} label="Caller">{call.caller_name}</Field>
            <Field icon={Phone} label={web ? 'Source' : 'Phone'}>{formatPhone(call.caller_phone)}</Field>
            <Field icon={FileText} label={web ? 'Web report ID' : 'Retell call ID'}>
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
            <div className="mb-3 flex gap-1 border-b border-slate-200" role="tablist">
              {[
                ['report', 'Formal Incident Report'],
                ['transcript', web ? 'Original Report' : 'Raw Transcript'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                    tab === id ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === 'report' ? <IncidentReport report={call.formal_report} call={call} /> : <Transcript text={call.transcript} />}
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
