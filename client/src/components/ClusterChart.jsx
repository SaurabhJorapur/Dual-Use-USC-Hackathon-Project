import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { UNCLUSTERED_HEX, chartData, clusterTitle } from '../lib/clusters';
import { timeAgo } from '../lib/format';

const RANGES = [
  { id: '1h', label: 'Last hour', ms: 60 * 60 * 1000 },
  { id: '24h', label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { id: '7d', label: 'Week', ms: 7 * 24 * 60 * 60 * 1000 },
];

function SegmentTooltip({ active, hovered, now }) {
  if (!active || !hovered) return null;
  if (hovered === 'unclustered') {
    return <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">Individual reports, not part of any cluster</div>;
  }
  const { cluster, count } = hovered;
  return (
    <div className="max-w-xs rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-slate-900">{clusterTitle(cluster)}</p>
      <p className="text-slate-600">
        {count} {count === 1 ? 'report' : 'reports'} in range · {cluster.report_count} total
      </p>
      <p className="text-slate-500">Last report {timeAgo(cluster.last_report_at, now)} · click to open</p>
    </div>
  );
}

/**
 * Types of inconvenience: one bar per category, stacked by cluster (shades of the category
 * color) with individual reports as a neutral segment on top, so each bar is the true total.
 */
export default function ClusterChart({ calls, clusters, now, onOpen }) {
  const [range, setRange] = useState('24h');
  const [hovered, setHovered] = useState(null);
  const since = now - RANGES.find((r) => r.id === range).ms;
  const { rows, segments } = useMemo(() => chartData(calls, clusters, since), [calls, clusters, since]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Types of inconvenience</h3>
          <p className="text-xs text-slate-500">Reports per category; each colored section is one incident cluster.</p>
        </div>
        <div className="flex rounded-lg border border-slate-200 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${range === r.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {rows.length ? (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -20 }} onMouseLeave={() => setHovered(null)}>
              <CartesianGrid vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} interval={0} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: '#f8fafc' }} content={<SegmentTooltip hovered={hovered} now={now} />} />
              {segments.map((s) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  stackId="reports"
                  fill={s.color}
                  stroke="#fff"
                  strokeWidth={1}
                  cursor="pointer"
                  isAnimationActive={false}
                  onMouseEnter={(entry) => setHovered({ cluster: s.cluster, count: entry[s.key] })}
                  onClick={() => onOpen(s.cluster.id)}
                />
              ))}
              <Bar
                dataKey="unclustered"
                stackId="reports"
                fill={UNCLUSTERED_HEX}
                stroke="#fff"
                strokeWidth={1}
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
                onMouseEnter={() => setHovered('unclustered')}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="py-10 text-center text-sm text-slate-400">No reports in this time range.</p>
      )}
    </section>
  );
}
