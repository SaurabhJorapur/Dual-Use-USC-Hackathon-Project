import { useState } from 'react';
import { BadgeCheck, Check, Copy, Printer, Send } from 'lucide-react';
import { CategoryIcon, UrgencyBadge } from './Badges';
import { isWebReport } from '../lib/format';

const formatDateTime = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown');
const formatTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
// Cluster reports (report.type === 'cluster') cover several calls and have no single source call.
const dateTimeText = (report, e) => (e.last_report ? `${formatDateTime(e.date_time)} – ${formatTime(e.last_report)}` : formatDateTime(e.date_time));
const sourceText = (report, call) => {
  if (report.type === 'cluster') return `${report.consolidated_calls.length} calls consolidated into one incident`;
  return isWebReport(call) ? `low-network web report ${call.retell_call_id}` : `call ${call.retell_call_id}`;
};

/** Plain-text rendering used by the Copy button. */
export function reportToText(report, call) {
  const e = report.extracted_entities || {};
  return [
    'MUNICIPAL INCIDENT REPORT',
    `Incident ID: ${report.incident_id}`,
    `Classification: ${report.classification?.category} (${report.classification?.urgency_level})`,
    `Dispatch Recommendation: ${report.dispatch_recommendation}`,
    '',
    'EXECUTIVE SUMMARY',
    report.executive_summary,
    '',
    'INCIDENT DETAILS',
    `Location: ${e.location}`,
    `Involved Parties: ${e.involved_parties}`,
    `Incident Type: ${e.incident_type}`,
    `Date/Time: ${dateTimeText(report, e)}`,
    '',
    'KEY FACTS',
    ...(report.key_facts || []).map((f) => `- ${f}`),
    ...(report.consolidated_calls
      ? ['', 'CALLS CONSOLIDATED', ...report.consolidated_calls.map((c) => `- ${c.incident_id} · ${formatDateTime(c.received_at)} · ${c.caller}: ${c.summary}`)]
      : []),
    '',
    `Source: AI-generated from ${sourceText(report, call)}. Verify before submission.`,
  ].join('\n');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API can be unavailable (insecure origin); fall back to a hidden textarea.
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 border-b border-slate-100 py-2 last:border-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-900">{children}</dd>
    </div>
  );
}

export default function IncidentReport({ report, call }) {
  const [copied, setCopied] = useState(false);

  if (!report) {
    return (
      <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">
        {isWebReport(call) ? 'Web report received; the incident report is being generated.' : 'Report will be generated when the call is analyzed.'}
      </p>
    );
  }

  const e = report.extracted_entities || {};
  const copy = async () => {
    await copyText(reportToText(report, call));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <article id="incident-report" className="rounded-lg border border-slate-300 bg-white shadow-sm">
      <header className="border-b-2 border-slate-900 px-5 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="inline-flex items-center gap-1 rounded bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-white">
              <BadgeCheck className="h-3 w-3" aria-hidden /> Official Incident Report
            </span>
            <h4 className="mt-2 font-serif text-lg font-semibold text-slate-900">
              Municipal Incident Report{report.type === 'cluster' ? ` · ${report.consolidated_calls.length} calls` : ''}
            </h4>
            <p className="font-mono text-sm text-slate-700">{report.incident_id}</p>
          </div>
          <div className="flex shrink-0 gap-1.5 print:hidden">
            <button
              onClick={copy}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
            >
              <Printer className="h-3.5 w-3.5" aria-hidden /> Print / PDF
            </button>
          </div>
        </div>
      </header>

      <div className="space-y-4 px-5 py-4">
        <section className="flex flex-wrap items-center gap-2">
          <CategoryIcon category={report.classification?.category} size="h-7 w-7" />
          <span className="text-sm font-medium text-slate-900">{report.classification?.category}</span>
          <UrgencyBadge level={report.classification?.urgency_level} />
          <span className="ml-auto inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200">
            <Send className="h-3 w-3" aria-hidden /> Route to: {report.dispatch_recommendation}
          </span>
        </section>

        <section>
          <h5 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Executive summary</h5>
          <p className="font-serif text-sm leading-relaxed text-slate-900">{report.executive_summary}</p>
        </section>

        <section>
          <h5 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Incident details</h5>
          <dl>
            <Row label="Location">{e.location}</Row>
            <Row label="Involved parties">{e.involved_parties}</Row>
            <Row label="Incident type">{e.incident_type}</Row>
            <Row label="Date / time">{dateTimeText(report, e)}</Row>
          </dl>
        </section>

        <section>
          <h5 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Key facts</h5>
          {report.key_facts?.length ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-900">
              {report.key_facts.map((fact, i) => (
                <li key={i}>{fact}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">No facts extracted.</p>
          )}
        </section>

        {report.consolidated_calls && (
          <section>
            <h5 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Calls consolidated ({report.consolidated_calls.length})</h5>
            <ol className="space-y-1.5 text-sm text-slate-900">
              {report.consolidated_calls.map((c) => (
                <li key={c.retell_call_id} className="grid grid-cols-[6.5rem_1fr] gap-2 border-b border-slate-100 pb-1.5 last:border-0">
                  <span className="font-mono text-xs text-slate-500">
                    {c.incident_id}
                    <br />
                    {formatTime(c.received_at)}
                  </span>
                  <span>
                    <span className="font-medium">{c.caller}:</span> {c.summary}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>

      <footer className="border-t border-slate-200 bg-slate-50 px-5 py-2 text-[11px] leading-relaxed text-slate-500">
        {report.source === 'ai' ? 'AI-generated from call audio' : isWebReport(call) ? 'Derived from written web report' : 'Derived from call record'} ·{' '}
        {report.type === 'cluster'
          ? `Consolidates ${report.consolidated_calls.length} calls`
          : `${isWebReport(call) ? 'Web report' : 'Call'} ${call.retell_call_id}`}{' '}
        · Generated{' '}
        {formatDateTime(report.generated_at)}. Verify before submission.
      </footer>
    </article>
  );
}
