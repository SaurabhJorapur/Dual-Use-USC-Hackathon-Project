import { useMemo } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TrendingUp } from 'lucide-react';
import { hourlyBuckets, surgeInfo } from '../lib/stats';

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const b = payload[0].payload;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs shadow-sm">
      <p className="font-medium text-slate-900">
        {new Date(b.start).toLocaleTimeString(undefined, { hour: 'numeric' })} · {b.total} calls
      </p>
      {b.emergency > 0 && <p className="text-red-600">{b.emergency} emergency</p>}
    </div>
  );
}

/** Hourly call volume over the last 24h, with emergencies stacked on top. */
export default function SurgeChart({ calls, now }) {
  // Re-bucket when the hour changes, not every tick of `now`.
  const hour = Math.floor(now / 3_600_000);
  const buckets = useMemo(() => hourlyBuckets(calls, now), [calls, hour]); // eslint-disable-line react-hooks/exhaustive-deps
  const info = surgeInfo(buckets);

  return (
    <section>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Call surge · 24h</h2>
        {info.surging ? (
          <span className="inline-flex animate-pulse items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white">
            <TrendingUp className="h-3 w-3" aria-hidden /> Surge
          </span>
        ) : (
          <span className="text-[11px] text-slate-400">{info.total} calls</span>
        )}
      </div>
      <div className="h-28">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={buckets} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="surgeOther" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2563eb" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#2563eb" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="surgeEmergency" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#dc2626" stopOpacity={0.6} />
                <stop offset="100%" stopColor="#dc2626" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" interval={5} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={22} />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#cbd5e1' }} />
            <Area type="monotone" dataKey="other" stackId="1" stroke="#2563eb" strokeWidth={1.5} fill="url(#surgeOther)" isAnimationActive={false} />
            <Area type="monotone" dataKey="emergency" stackId="1" stroke="#dc2626" strokeWidth={1.5} fill="url(#surgeEmergency)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        Peak {info.peak.total ? `${info.peak.total} calls at ${new Date(info.peak.start).toLocaleTimeString(undefined, { hour: 'numeric' })}` : '—'} · avg{' '}
        {info.average.toFixed(1)}/h
      </p>
    </section>
  );
}
