import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, ArrowLeft, BrainCircuit, Radio, Siren, TriangleAlert } from 'lucide-react';
import L from '../lib/leaflet';
import { CATEGORIES } from '../lib/constants';
import { SCENARIOS, SCENARIO_ORDER } from '../data/simulationScenarios';

const CITY_CENTER = [34.0522, -118.2437];
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
const ESRI_ATTRIBUTION = 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors';

const SEVERITY = {
  critical: { label: 'Critical', hex: '#ef4444' },
  hazard: { label: 'Hazard', hex: '#f59e0b' },
  routine: { label: 'Routine', hex: '#38bdf8' },
};

const TONE = {
  emerald: { banner: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200', accent: '#34d399', button: 'bg-emerald-500 text-emerald-950' },
  red: { banner: 'border-red-500/60 bg-red-500/15 text-red-100', accent: '#f87171', button: 'bg-red-500 text-white' },
  blue: { banner: 'border-sky-500/60 bg-sky-500/15 text-sky-100', accent: '#38bdf8', button: 'bg-sky-500 text-sky-950' },
};

// Reuses the dashboard's .map-pin styles; critical pins get the pulsing ring.
const iconCache = new Map();
function severityIcon(severity) {
  if (!iconCache.has(severity)) {
    iconCache.set(
      severity,
      L.divIcon({
        className: '',
        html: `<span class="map-pin${severity === 'critical' ? ' map-pin--critical' : ''}" style="--pin:${SEVERITY[severity].hex}"></span>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
        popupAnchor: [0, -10],
      }),
    );
  }
  return iconCache.get(severity);
}

/** Re-frames the map whenever the scenario changes. */
function FitToMarkers({ markers }) {
  const map = useMap();
  useEffect(() => {
    if (markers.length > 1) map.flyToBounds(markers.map((m) => [m.lat, m.lng]), { padding: [60, 60], maxZoom: 13, duration: 0.8 });
  }, [map, markers]);
  return null;
}

function Stat({ label, value, sub, color }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-xl font-semibold tabular-nums" style={color ? { color } : undefined}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}

function SurgeChart({ scenario, accent }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
      <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
        <Activity className="h-3.5 w-3.5" aria-hidden /> Call surge
      </h3>
      <p className="mb-2 text-[11px] text-slate-500">Calls per interval vs. the normal baseline</p>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={scenario.surge_data} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id="surge-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accent} stopOpacity={0.55} />
                <stop offset="100%" stopColor={accent} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#1e293b" vertical={false} />
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip
              contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: '#e2e8f0' }}
              formatter={(value, name) => [value, name === 'calls' ? 'Calls' : 'Normal baseline']}
            />
            {scenario.event_time && <ReferenceLine x={scenario.event_time} stroke={accent} strokeDasharray="4 3" label={{ value: 'Event', fill: accent, fontSize: 10, position: 'top' }} />}
            <Area type="monotone" dataKey="baseline" stroke="#64748b" strokeDasharray="3 3" fill="none" isAnimationActive={false} />
            <Area type="monotone" dataKey="calls" stroke={accent} strokeWidth={2} fill="url(#surge-fill)" animationDuration={500} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function CategoryBars({ breakdown }) {
  const entries = Object.entries(breakdown);
  const max = Math.max(...entries.map(([, n]) => n));
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Category load</h3>
      <ul className="space-y-2">
        {entries.map(([category, count]) => (
          <li key={category}>
            <div className="flex justify-between text-xs">
              <span className="text-slate-300">{category}</span>
              <span className="tabular-nums text-slate-400">{count.toLocaleString()}</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${(count / max) * 100}%`, background: CATEGORIES[category]?.hex || '#64748b' }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Disaster Twin: replays pre-built crisis scenarios so judges can see how the city line responds. */
export default function SimulationPage({ onExit }) {
  const [key, setKey] = useState('normal');
  const scenario = SCENARIOS[key];
  const tone = TONE[scenario.tone];
  const simulating = key !== 'normal';

  const stats = useMemo(() => {
    const total = Object.values(scenario.category_breakdown).reduce((s, n) => s + n, 0);
    const peak = scenario.surge_data.reduce((best, p) => (p.calls > best.calls ? p : best), scenario.surge_data[0]);
    return {
      total,
      critical: scenario.map_markers.filter((m) => m.severity === 'critical').length,
      peak,
      multiple: Math.round(peak.calls / Math.max(1, peak.baseline)),
    };
  }, [scenario]);

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      {/* Header + scenario toolbar */}
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-950/90 px-4 py-3">
        <button onClick={onExit} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-slate-300 ring-1 ring-inset ring-slate-700 hover:bg-slate-800">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Dashboard
        </button>
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-tight">
            CivicLine Disaster Twin <span className="font-normal text-slate-400">/ Predictive Simulation Engine</span>
          </h1>
          <p className="text-xs text-slate-500">{scenario.name}</p>
        </div>
        {simulating && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-white">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> Simulation active
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-1 rounded-xl border border-slate-800 bg-slate-900 p-1" role="radiogroup" aria-label="Scenario">
          {SCENARIO_ORDER.map((k) => {
            const s = SCENARIOS[k];
            const active = k === key;
            return (
              <button
                key={k}
                role="radio"
                aria-checked={active}
                onClick={() => setKey(k)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${active ? `${TONE[s.tone].button} shadow` : 'text-slate-300 hover:bg-slate-800'}`}
              >
                <span aria-hidden>{s.emoji}</span> {s.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Alert + AI recommendation */}
      <div className="space-y-2 border-b border-slate-800 px-4 py-3">
        <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${tone.banner}`} role="alert">
          {simulating ? <Siren className="mt-0.5 h-4 w-4 shrink-0 animate-pulse" aria-hidden /> : <Radio className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
          {scenario.banner_alert}
        </div>
        <div className="flex items-start gap-3 rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2.5">
          <BrainCircuit className="mt-0.5 h-5 w-5 shrink-0 text-violet-300" aria-hidden />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-violet-300">AI command recommendation</p>
            <p className="text-sm font-semibold text-white">{scenario.recommendation}</p>
            <ul className="mt-1 grid gap-x-6 gap-y-0.5 text-xs text-violet-100/80 sm:grid-cols-2">
              {scenario.actions.map((a) => (
                <li key={a} className="flex gap-1.5">
                  <span className="text-violet-400">›</span> {a}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Split screen */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <aside className="flex shrink-0 flex-col gap-3 border-b border-slate-800 p-3 lg:w-[360px] lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Calls" value={stats.total.toLocaleString()} sub="this scenario" />
            <Stat label="Critical" value={stats.critical} sub="on the map" color={stats.critical ? '#f87171' : undefined} />
            <Stat label="Peak" value={`${stats.multiple}×`} sub={`${stats.peak.calls} at ${stats.peak.time}`} color={tone.accent} />
          </div>
          <SurgeChart scenario={scenario} accent={tone.accent} />
          <CategoryBars breakdown={scenario.category_breakdown} />
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
            <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            Simulated data: pre-built scenarios for demonstration. Incidents are fictional; locations are real.
          </p>
        </aside>

        <main className="relative isolate min-h-[60vh] flex-1">
          <MapContainer center={CITY_CENTER} zoom={11} zoomControl={false} className="h-full w-full" style={{ background: '#0b1120' }}>
            <TileLayer url={`${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`} attribution={ESRI_ATTRIBUTION} maxNativeZoom={16} maxZoom={19} />
            <TileLayer url={`${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`} maxNativeZoom={16} maxZoom={19} />
            <FitToMarkers markers={scenario.map_markers} />
            {scenario.map_markers.map((m) => (
              <Marker key={m.id} position={[m.lat, m.lng]} icon={severityIcon(m.severity)} zIndexOffset={m.severity === 'critical' ? 1000 : m.severity === 'hazard' ? 500 : 0}>
                <Popup closeButton={false}>
                  <div className="w-60 font-sans">
                    <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: SEVERITY[m.severity].hex }}>
                      {SEVERITY[m.severity].label} · {m.time}
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-slate-900">{m.title}</p>
                    <p className="mt-1 text-xs text-slate-600">{m.detail}</p>
                    <p className="mt-1.5 text-[11px] text-slate-400">{m.category} · simulated</p>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
          <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-2 text-[11px] text-slate-300 backdrop-blur">
            {Object.entries(SEVERITY).map(([k, s]) => (
              <p key={k} className="flex items-center gap-2 py-0.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.hex }} /> {s.label} ({scenario.map_markers.filter((m) => m.severity === k).length})
              </p>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
