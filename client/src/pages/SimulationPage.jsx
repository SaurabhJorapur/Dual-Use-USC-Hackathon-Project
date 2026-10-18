import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, ArrowLeft, BrainCircuit, Pause, Play, Radio, RotateCcw, Siren, Sparkles, TriangleAlert } from 'lucide-react';
import L from '../lib/leaflet';
import { CATEGORIES } from '../lib/constants';
import { buildSimulation, clock12, parseScenario, simulationSnapshot } from '../lib/simulation';
import { countBadge } from '../lib/declutter';
import { PIN_ICON, pinHtml } from '../lib/mapPin';
import { INTENSITY_WORDS, PRESETS } from '../data/simulationData';
import { useSimulationClock } from '../hooks/useSimulationClock';
import { SHOW_ALL_ZOOM, useDeclutter } from '../hooks/useDeclutter';

const CITY_CENTER = [34.0522, -118.2437];
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
const ESRI_ATTRIBUTION = 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors';
const PLAYBACK_MS = 60000;
const SPEEDS = [1, 2, 4];
const FEED_LIMIT = 40;
const START_ZOOM = 11;

// Muted to match the dashboard's desaturated category colors.
const SEVERITY = {
  critical: { label: 'Critical', hex: '#b4544e' },
  hazard: { label: 'Hazard', hex: '#c4843f' },
  routine: { label: 'Routine', hex: '#5a7ca3' },
};

const TONE = {
  emerald: { banner: 'border-emerald-200 bg-emerald-50 text-emerald-900', accent: '#4f8a6e' },
  red: { banner: 'border-red-200 bg-red-50 text-red-900', accent: '#b4544e' },
  blue: { banner: 'border-sky-200 bg-sky-50 text-sky-900', accent: '#5a7ca3' },
  amber: { banner: 'border-amber-200 bg-amber-50 text-amber-900', accent: '#c4843f' },
  orange: { banner: 'border-orange-200 bg-orange-50 text-orange-900', accent: '#b8693f' },
};
const MONITORING = 'border-slate-200 bg-white text-slate-600';

// The dashboard's static teardrop pins; a pin standing for several nearby calls carries their count.
const iconCache = new Map();
function severityIcon(severity, count = 1) {
  const key = `${severity}:${count}`;
  if (!iconCache.has(key)) iconCache.set(key, L.divIcon({ className: '', html: pinHtml(SEVERITY[severity].hex, { extra: countBadge(count) }), ...PIN_ICON }));
  return iconCache.get(key);
}

// When zoomed out, the pin kept for a group of nearby calls is the most severe, then the newest.
const SEVERITY_RANK = { critical: 0, hazard: 1, routine: 2 };
const callLatLng = (c) => [c.lat, c.lng];
const outranks = (a, b) => SEVERITY_RANK[a.severity] < SEVERITY_RANK[b.severity] || (a.severity === b.severity && a.t > b.t);

/** Frames the whole scenario once when a new simulation starts (not on every new call). */
function FitToSimulation({ sim }) {
  const map = useMap();
  useEffect(() => {
    const points = sim.calls.map((c) => [c.lat, c.lng]);
    if (points.length > 1) map.flyToBounds(points, { padding: [60, 60], maxZoom: 13, duration: 0.8 });
  }, [map, sim]);
  return null;
}

function Stat({ label, value, sub, color }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-xl font-semibold tabular-nums" style={color ? { color } : undefined}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}

function SurgeChart({ data, eventTime, nowTime, accent }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3">
      <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <Activity className="h-3.5 w-3.5" aria-hidden /> Call surge
      </h3>
      <p className="mb-2 text-[11px] text-slate-500">Calls per interval vs. the normal baseline</p>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 12, left: 0 }}>
            <defs>
              <linearGradient id="surge-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accent} stopOpacity={0.55} />
                <stop offset="100%" stopColor={accent} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 10, fill: '#64748b' }}
              tickLine={{ stroke: '#cbd5e1' }}
              axisLine={{ stroke: '#cbd5e1' }}
              interval="preserveStartEnd"
              label={{ value: 'Time', position: 'insideBottom', offset: -10, fontSize: 10, fill: '#64748b' }}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#64748b' }}
              tickLine={{ stroke: '#cbd5e1' }}
              axisLine={{ stroke: '#cbd5e1' }}
              allowDecimals={false}
              width={40}
              label={{ value: 'Calls', angle: -90, position: 'insideLeft', offset: 10, style: { textAnchor: 'middle' }, fontSize: 10, fill: '#64748b' }}
            />
            <Tooltip
              contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: '#0f172a' }}
              formatter={(value, name) => [value, name === 'calls' ? 'Calls' : 'Normal baseline']}
            />
            {eventTime && <ReferenceLine x={eventTime} stroke={accent} strokeDasharray="4 3" label={{ value: 'Event', fill: accent, fontSize: 10, position: 'top' }} />}
            <ReferenceLine x={nowTime} stroke="#334155" strokeOpacity={0.4} />
            <Area type="monotone" dataKey="baseline" stroke="#94a3b8" strokeDasharray="3 3" fill="none" isAnimationActive={false} />
            <Area type="monotone" dataKey="calls" stroke={accent} strokeWidth={2} fill="url(#surge-fill)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function CategoryBars({ breakdown }) {
  const entries = Object.entries(breakdown);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Category load</h3>
      <ul className="space-y-2">
        {entries.map(([category, count]) => (
          <li key={category}>
            <div className="flex justify-between text-xs">
              <span className="text-slate-700">{category}</span>
              <span className="tabular-nums text-slate-500">{count.toLocaleString()}</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full transition-all duration-300" style={{ width: `${(count / max) * 100}%`, background: CATEGORIES[category]?.hex || '#64748b' }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CallFeed({ calls, total, onSelect }) {
  const latest = calls.slice(-FEED_LIMIT).reverse();
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3">
      <h3 className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
        <span className="flex items-center gap-1.5">
          <Radio className="h-3.5 w-3.5" aria-hidden /> Live call feed
        </span>
        <span className="font-normal normal-case tracking-normal text-slate-400">
          {calls.length} / {total} mapped
        </span>
      </h3>
      {latest.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-400">Waiting for calls…</p>
      ) : (
        <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
          {latest.map((c) => (
            <li key={c.id} className="sim-feed-item">
              <button onClick={() => onSelect(c)} className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-50">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: SEVERITY[c.severity].hex }} />
                <span className="min-w-0 flex-1">
                  <span className="flex justify-between gap-2 text-xs">
                    <span className="truncate font-medium text-slate-900">{c.title}</span>
                    <span className="shrink-0 tabular-nums text-slate-400">{c.time}</span>
                  </span>
                  <span className="block truncate text-[11px] text-slate-500">{c.place}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PlaybackBar({ clock, sim, snapshot }) {
  const { progress, playing, speed, play, pause, restart, seek, setSpeed } = clock;
  const fromEvent = Math.round(snapshot.minute - sim.eventMin);
  return (
    <div className="absolute inset-x-3 bottom-3 z-[1000] mx-auto flex max-w-2xl flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-slate-700 shadow-lg backdrop-blur">
      <button
        onClick={playing ? pause : play}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-white hover:bg-slate-700"
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4 translate-x-px" aria-hidden />}
      </button>
      <button onClick={restart} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Restart">
        <RotateCcw className="h-4 w-4" aria-hidden />
      </button>
      <input
        type="range"
        min={0}
        max={1000}
        value={Math.round(progress * 1000)}
        onChange={(e) => seek(Number(e.target.value) / 1000)}
        className="min-w-[8rem] flex-1 accent-slate-700"
        aria-label="Simulation time"
      />
      <span className="w-36 text-right text-xs tabular-nums">
        {clock12(sim.startMinuteOfDay + snapshot.minute)}
        {sim.event_time && (
          <span className="text-slate-500">
            {' '}
            · T{fromEvent < 0 ? '−' : '+'}
            {Math.abs(fromEvent)} min
          </span>
        )}
      </span>
      <div className="flex rounded-md bg-slate-100 p-0.5" role="radiogroup" aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            role="radio"
            aria-checked={speed === s}
            onClick={() => setSpeed(s)}
            className={`rounded px-2 py-0.5 text-xs font-semibold ${speed === s ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}

// The page opens on the first built-in scenario so there is something to watch right away.
const firstPreset = PRESETS[0];

/** Disaster Simulator: describe any scenario, pick an intensity, and watch the city line's calls play out. */
export default function SimulationPage({ onExit }) {
  const [description, setDescription] = useState(firstPreset.description);
  const [intensity, setIntensity] = useState(firstPreset.intensity);
  const [sim, setSim] = useState(() => buildSimulation({ description: firstPreset.description, intensity: firstPreset.intensity, defaultHour: new Date().getHours() }));
  const clock = useSimulationClock(PLAYBACK_MS);
  const [map, setMap] = useState(null);
  const markerRefs = useRef(new Map());

  const tone = TONE[sim.tone];
  const snapshot = useMemo(() => simulationSnapshot(sim, clock.progress * sim.durationMin), [sim, clock.progress]);
  const live = sim.type === 'normal' || snapshot.eventStarted;
  const chartData = useMemo(
    () => sim.surge_data.map((b) => ({ time: b.time, baseline: b.baseline, calls: b.t <= snapshot.minute ? b.calls : null })),
    [sim, snapshot.minute],
  );

  const pins = useDeclutter(map, snapshot.revealed, callLatLng, outranks);
  const hiddenPins = snapshot.revealed.length - pins.length;

  const { restart } = clock;
  useEffect(() => restart(), [sim, restart]);

  const run = (text = description, level = intensity) => {
    if (!text.trim()) return;
    setSim(buildSimulation({ description: text, intensity: level, defaultHour: new Date().getHours() }));
  };

  const onDescribe = (text) => {
    setDescription(text);
    const hint = parseScenario(text).intensityHint;
    if (hint !== null) setIntensity(hint);
  };

  const focusCall = (c) => {
    // Zoom to where every pin shows, so the clicked call has its own marker to open.
    map?.flyTo([c.lat, c.lng], Math.max(map.getZoom(), SHOW_ALL_ZOOM), { duration: 0.6 });
    setTimeout(() => markerRefs.current.get(c.id)?.openPopup(), 800);
  };

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-900">
      {/* Header + scenario builder */}
      <header className="space-y-2 border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={onExit} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-100">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Dashboard
          </button>
          <h1 className="min-w-0 text-base font-semibold tracking-tight">CityLine Disaster Simulator</h1>
        </div>

        <form
          className="flex flex-wrap items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <input
            value={description}
            onChange={(e) => onDescribe(e.target.value)}
            placeholder="Describe a scenario: what happens, where and when"
            className="min-w-[16rem] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
            aria-label="Scenario description"
          />
          <label className="flex items-center gap-2 text-xs text-slate-500">
            Intensity
            <input type="range" min={1} max={10} value={intensity} onChange={(e) => setIntensity(Number(e.target.value))} className="w-28 accent-slate-700" />
            <span className="w-28 text-sm font-semibold text-slate-900">
              {intensity} · {INTENSITY_WORDS[intensity - 1]}
            </span>
          </label>
          <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700">
            <Sparkles className="h-4 w-4" aria-hidden /> Run simulation
          </button>
        </form>
      </header>

      {/* Alert + AI recommendation: kicks in once the event starts */}
      <div className="space-y-2 border-b border-slate-200 px-4 py-3">
        <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${live ? tone.banner : MONITORING}`} role="alert">
          {live && sim.type !== 'normal' ? <Siren className="mt-0.5 h-4 w-4 shrink-0 animate-pulse" aria-hidden /> : <Radio className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
          {live ? sim.banner_alert : `Monitoring: call volume normal, no anomaly detected yet (event expected at ${clock12(sim.startMinuteOfDay + sim.eventMin)}).`}
        </div>
        <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
          <BrainCircuit className="mt-0.5 h-5 w-5 shrink-0 text-[#46658a]" aria-hidden />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[#46658a]">AI command recommendation</p>
            {live ? (
              <>
                <p className="text-sm font-semibold text-slate-900">{sim.recommendation}</p>
                <ul className="mt-1 grid gap-x-6 gap-y-0.5 text-xs text-slate-600 sm:grid-cols-2">
                  {sim.actions.map((a) => (
                    <li key={a} className="flex gap-1.5">
                      <span className="text-slate-400">›</span> {a}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-slate-500">Standing by. Maintain standard staffing until call patterns change.</p>
            )}
          </div>
        </div>
      </div>

      {/* Split screen */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <aside className="flex shrink-0 flex-col gap-3 border-b border-slate-200 bg-slate-50 p-3 lg:w-[360px] lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Calls" value={snapshot.callsSoFar.toLocaleString()} sub="so far" />
            <Stat label="Critical" value={snapshot.criticalSoFar} sub="on the map" color={snapshot.criticalSoFar ? '#b4544e' : undefined} />
            <Stat label="Volume" value={`${snapshot.multiple}×`} sub={`peak ${sim.peak.multiple}× at ${sim.peak.time}`} color={live ? tone.accent : undefined} />
          </div>
          <CallFeed calls={snapshot.revealed} total={sim.calls.length} onSelect={focusCall} />
          <SurgeChart data={chartData} eventTime={sim.event_time} nowTime={snapshot.currentTime} accent={tone.accent} />
          <CategoryBars breakdown={snapshot.categories} />
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-400">
            <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            Generated scenario: incidents are fictional; locations are real.
          </p>
        </aside>

        <main className="relative isolate min-h-[60vh] flex-1">
          <MapContainer ref={setMap} center={CITY_CENTER} zoom={START_ZOOM} zoomControl={false} className="h-full w-full">
            <TileLayer url={`${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`} attribution={ESRI_ATTRIBUTION} maxNativeZoom={16} maxZoom={19} />
            <TileLayer url={`${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`} maxNativeZoom={16} maxZoom={19} />
            <FitToSimulation sim={sim} />
            {pins.map(({ item: c, count }) => (
              <Marker
                key={c.id}
                ref={(m) => (m ? markerRefs.current.set(c.id, m) : markerRefs.current.delete(c.id))}
                position={[c.lat, c.lng]}
                icon={severityIcon(c.severity, count)}
                zIndexOffset={c.severity === 'critical' ? 1000 : c.severity === 'hazard' ? 500 : 0}
              >
                <Popup closeButton={false}>
                  <div className="w-60 font-sans">
                    <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: SEVERITY[c.severity].hex }}>
                      {SEVERITY[c.severity].label} · {c.time}
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-slate-900">{c.title}</p>
                    <p className="mt-1 text-xs text-slate-600">{c.detail}</p>
                    <p className="mt-1.5 text-[11px] text-slate-400">{c.category} · simulated</p>
                    {count > 1 && (
                      <p className="mt-1 text-[11px] font-medium text-slate-500">
                        +{count - 1} more {count === 2 ? 'call' : 'calls'} nearby. Zoom in to see them.
                      </p>
                    )}
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
          <div className="pointer-events-none absolute right-3 top-3 z-[1000] rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-[11px] text-slate-600 shadow-sm backdrop-blur">
            {Object.entries(SEVERITY).map(([k, s]) => (
              <p key={k} className="flex items-center gap-2 py-0.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.hex }} /> {s.label} ({snapshot.revealed.filter((c) => c.severity === k).length})
              </p>
            ))}
            {hiddenPins > 0 && <p className="mt-1 border-t border-slate-200 pt-1 text-slate-500">{hiddenPins} grouped · zoom in for all</p>}
          </div>
          <PlaybackBar clock={clock} sim={sim} snapshot={snapshot} />
        </main>
      </div>
    </div>
  );
}
