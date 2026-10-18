import { useRef, useState } from 'react';
import { CircleCheck, CloudOff, LoaderCircle, LocateFixed, Save, Send, TriangleAlert, X } from 'lucide-react';
import { CATEGORIES } from '../lib/constants';
import { MAX_LOCATION, MAX_TEXT, getPosition, validateReport } from '../lib/reportQueue';
import { useReportQueue } from '../hooks/useReportQueue';

// Offline-first crisis report form (served at /report/). A plain form, not a chat: the report
// is saved on the device first, then sent; see lib/reportQueue.js for the delivery rules.

const STATUS = {
  saved: { icon: Save, text: 'Saved on this device — waiting to send' },
  sending: { icon: LoaderCircle, text: 'Sending report…', spin: true },
  received: { icon: CircleCheck, text: 'Report received' },
  failed: { icon: CloudOff, text: 'Could not confirm delivery — saved here and will retry' },
  rejected: { icon: TriangleAlert, text: 'The server could not accept this report. It is kept on this device below.' },
};

const field = 'block w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 aria-[invalid=true]:border-red-600';
const label = 'block text-sm font-medium text-slate-900';
const quiet = 'text-sm font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';
const time = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function Outbox({ items, onRetry, onDiscard }) {
  if (!items.length) return null;
  const waiting = items.filter((i) => i.state !== 'rejected').length;
  const rejected = items.length - waiting;
  return (
    <details className="mt-5 border-y border-slate-200 py-3 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-slate-700 [&::-webkit-details-marker]:hidden">
        <CloudOff className="h-4 w-4 shrink-0" aria-hidden />
        <span className="flex-1">
          {waiting > 0 && `${waiting} report${waiting === 1 ? '' : 's'} saved on this device, waiting to send`}
          {waiting > 0 && rejected > 0 && ' · '}
          {rejected > 0 && `${rejected} not accepted`}
        </span>
        <span className="text-slate-500 underline underline-offset-2">Details</span>
      </summary>
      <ul className="mt-3 space-y-3">
        {items.map((item) => (
          <li key={item.id} className="border-l-2 border-slate-300 pl-3">
            <p className="line-clamp-2 text-slate-900">{item.payload.text}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Saved {time(item.created_at)}
              {item.state === 'rejected'
                ? ` · Not accepted: ${item.last_error}`
                : item.attempts > 0 && ` · ${item.attempts} attempt${item.attempts === 1 ? '' : 's'} · ${item.last_error}`}
            </p>
            {item.state === 'rejected' && (
              <button type="button" onClick={() => onDiscard(item.id)} className={`${quiet} mt-1 text-xs`}>
                Discard this report
              </button>
            )}
          </li>
        ))}
      </ul>
      {waiting > 0 && (
        <button type="button" onClick={onRetry} className={`${quiet} mt-3`}>
          Try sending now
        </button>
      )}
    </details>
  );
}

export default function ReportPage() {
  const { items, statuses, submit, retryNow, discard } = useReportQueue();
  const [text, setText] = useState('');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');
  const [coords, setCoords] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState(null);
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastId, setLastId] = useState(null);
  const busy = useRef(false);
  const textRef = useRef(null);
  const locationRef = useRef(null);

  const locate = async () => {
    setLocating(true);
    setLocateError(null);
    try {
      setCoords(await getPosition());
    } catch (err) {
      setLocateError(err.message);
    } finally {
      setLocating(false);
    }
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (busy.current) return; // double clicks / Enter repeats
    const invalid = validateReport({ text, location });
    setErrors(invalid || {});
    if (invalid) {
      (invalid.text ? textRef : locationRef).current?.focus();
      return;
    }
    busy.current = true;
    setSaving(true);
    setSaveError(false);
    try {
      const item = await submit({ text, category, location, coords });
      // Safe to clear: the report is committed to this device and has its own status below.
      setLastId(item.id);
      setText('');
      setCategory('');
      setLocation('');
      setCoords(null);
    } catch (err) {
      console.error('[reports] could not save report', err);
      setSaveError(true);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const status = lastId && statuses[lastId];
  const meta = status && STATUS[status.type];
  const StatusIcon = meta?.icon;
  const remaining = MAX_TEXT - text.trim().length;

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto max-w-xl px-4 py-6 sm:py-12">
        <p className="text-sm font-semibold text-slate-500">CityLine</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Submit a Crisis Report</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Describe what is happening. Your report will be saved on this device if the connection drops and sent when connectivity returns.
        </p>
        <p className="mt-3 border-l-2 border-red-600 pl-3 text-sm leading-relaxed text-slate-700">
          <strong className="font-semibold text-slate-900">In immediate danger?</strong> Call 911 if you can. This form does not contact emergency
          services.
        </p>

        <Outbox items={items} onRetry={retryNow} onDiscard={discard} />

        <form onSubmit={onSubmit} noValidate className="mt-6 space-y-5">
          <div>
            <label htmlFor="report-text" className={label}>
              What is happening?
            </label>
            <textarea
              id="report-text"
              ref={textRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              maxLength={MAX_TEXT + 500}
              required
              aria-invalid={Boolean(errors.text)}
              aria-describedby="report-text-hint"
              placeholder="e.g. Water is pouring out of the street at 5th and Main and rising fast."
              className={`${field} mt-1.5 resize-y`}
            />
            <p id="report-text-hint" className={`mt-1 text-xs ${errors.text ? 'text-red-700' : 'text-slate-500'}`}>
              {errors.text || (remaining < 500 ? `${remaining} characters left` : 'Include what you see, where, and whether anyone is hurt.')}
            </p>
          </div>

          <div>
            <label htmlFor="report-category" className={label}>
              Type of issue <span className="font-normal text-slate-500">(optional)</span>
            </label>
            <select id="report-category" value={category} onChange={(e) => setCategory(e.target.value)} className={`${field} mt-1.5`}>
              <option value="">Not sure</option>
              {Object.keys(CATEGORIES).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="report-location" className={label}>
              Location <span className="font-normal text-slate-500">(optional)</span>
            </label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <input
                id="report-location"
                ref={locationRef}
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                maxLength={MAX_LOCATION + 50}
                autoComplete="street-address"
                aria-invalid={Boolean(errors.location)}
                aria-describedby="report-location-hint"
                placeholder="Address, intersection or landmark"
                className={`${field} min-w-0 flex-[1_1_12rem]`}
              />
              <button
                type="button"
                onClick={locate}
                disabled={locating}
                className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-60"
              >
                {locating ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <LocateFixed className="h-4 w-4" aria-hidden />}
                Use my location
              </button>
            </div>
            <div id="report-location-hint" className="mt-1 text-xs" aria-live="polite">
              {errors.location && <p className="text-red-700">{errors.location}</p>}
              {locating && <p className="text-slate-500">Finding your location…</p>}
              {locateError && <p className="text-slate-700">{locateError}</p>}
              {coords && (
                <p className="flex items-center gap-2 text-slate-700">
                  Device location attached (±{coords.accuracy} m)
                  <button type="button" onClick={() => setCoords(null)} className={`${quiet} inline-flex items-center gap-0.5 text-xs`}>
                    <X className="h-3 w-3" aria-hidden /> Remove
                  </button>
                </p>
              )}
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-5 text-base font-semibold text-white hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-60 sm:w-auto"
            >
              <Send className="h-4 w-4" aria-hidden />
              Submit report
            </button>

            <div role="status" aria-live="polite" className="mt-3 min-h-[1.5rem] text-sm">
              {meta && (
                <p className="flex items-start gap-2 text-slate-800">
                  <StatusIcon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.spin ? 'animate-spin' : ''}`} aria-hidden />
                  <span>
                    {meta.text}
                    {status.type === 'received' && status.ack?.incident_id && <span className="text-slate-500"> · Reference {status.ack.incident_id}</span>}
                    {status.type === 'rejected' && status.error && <span className="text-slate-500"> ({status.error})</span>}
                  </span>
                </p>
              )}
            </div>
            {saveError && (
              <p role="alert" className="mt-2 flex items-start gap-2 text-sm text-red-700">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                This report could not be saved on this device, so it has not been queued. Your text is still above: try again, or copy it
                somewhere safe.
              </p>
            )}
          </div>
        </form>

        <p className="mt-10 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-500">
          Saved reports are sent while this page is open and has a connection, and when you come back to it. Some browsers can also send them
          in the background, but that is not guaranteed. A report is only marked received once the city&apos;s server confirms it. This page
          cannot send anything while your device has no connection at all.
        </p>
      </main>
    </div>
  );
}
