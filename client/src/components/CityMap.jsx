import { useEffect, useMemo, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import { Flame, MapPinOff } from 'lucide-react';
import L from '../lib/leaflet';
import 'leaflet.heat';
import CallPopup from './CallPopup';
import CriticalBanner from './CriticalBanner';
import { CATEGORIES, DEFAULT_CATEGORY } from '../lib/constants';

export const CITY_CENTER = [34.0522, -118.2437];
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
const ESRI_ATTRIBUTION = 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors';
const HEAT_WEIGHT = { Critical: 1, Urgent: 0.6, Standard: 0.3 };
// Only the riskiest streetlight locations get a flame on the map (the Predictive page lists them all).
const MAP_MIN_RISK_SCORE = 80;
const FLAME_SVG = renderToStaticMarkup(<Flame size={16} strokeWidth={2.5} />);

const iconCache = new Map();
function pinIcon(call) {
  const color = (CATEGORIES[call.category] || CATEGORIES[DEFAULT_CATEGORY]).hex;
  const critical = call.urgency_level === 'Critical';
  const key = `${color}|${critical}`;
  if (!iconCache.has(key)) {
    iconCache.set(
      key,
      L.divIcon({
        className: '',
        html: `<span class="map-pin${critical ? ' map-pin--critical' : ''}" style="--pin:${color}"></span>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
        popupAnchor: [0, -10],
      }),
    );
  }
  return iconCache.get(key);
}

const hotspotIcon = L.divIcon({ className: '', html: `<span class="map-hotspot">${FLAME_SVG}</span>`, iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14] });

function HeatLayer({ points }) {
  const map = useMap();
  useEffect(() => {
    const layer = L.heatLayer(points, {
      radius: 30,
      blur: 24,
      maxZoom: 15,
      minOpacity: 0.35,
      gradient: { 0.25: '#60a5fa', 0.55: '#facc15', 0.8: '#f97316', 1: '#dc2626' },
    }).addTo(map);
    return () => map.removeLayer(layer);
  }, [map, points]);
  return null;
}

function FlyTo({ focus }) {
  const map = useMap();
  useEffect(() => {
    if (focus) map.flyTo([focus.lat, focus.lng], focus.zoom || 16, { duration: 0.8 });
  }, [map, focus]);
  return null;
}

/** Zooms to the mapped calls once, when they first load. */
function FitOnce({ points }) {
  const map = useMap();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (done || points.length < 2) return;
    map.fitBounds(points, { padding: [80, 80], maxZoom: 14 });
    setDone(true);
  }, [map, points, done]);
  return null;
}

function Toggle({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
    >
      {children}
    </button>
  );
}

function Legend() {
  const items = [
    ['#dc2626', 'Emergency / Active Danger'],
    ['#f59e0b', 'Public Safety & Hazards'],
    ['#2563eb', 'Roads, Water & Utilities'],
    ['#64748b', 'Code & Sanitation'],
  ];
  return (
    <div className="pointer-events-auto rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-[11px] text-slate-600 shadow-sm backdrop-blur">
      {items.map(([color, label]) => (
        <p key={label} className="flex items-center gap-2 py-0.5">
          <span className="h-2.5 w-2.5 rounded-full ring-2 ring-white" style={{ background: color, boxShadow: `0 0 0 1px ${color}` }} /> {label}
        </p>
      ))}
      <p className="flex items-center gap-2 py-0.5">
        <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-orange-500 text-white">
          <Flame className="h-2.5 w-2.5" aria-hidden />
        </span>
        Streetlight risk ≥ {MAP_MIN_RISK_SCORE}%
      </p>
    </div>
  );
}

export default function CityMap({ calls, now, hotspots, focus, onOpenCall }) {
  const [mode, setMode] = useState('pins');
  const [showHotspots, setShowHotspots] = useState(true);
  const mapped = useMemo(() => calls.filter((c) => c.latitude != null && c.longitude != null), [calls]);
  const heatPoints = useMemo(() => mapped.map((c) => [c.latitude, c.longitude, HEAT_WEIGHT[c.urgency_level] || 0.3]), [mapped]);
  const unmapped = calls.length - mapped.length;
  const mapHotspots = useMemo(() => hotspots.filter((h) => h.score >= MAP_MIN_RISK_SCORE), [hotspots]);

  return (
    <div className="relative h-full w-full">
      <MapContainer center={CITY_CENTER} zoom={12} zoomControl={false} className="h-full w-full" preferCanvas>
        {/* Esri Light Gray Canvas: a minimal basemap that needs no API key; labels are a separate layer. */}
        <TileLayer url={`${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`} attribution={ESRI_ATTRIBUTION} maxNativeZoom={16} maxZoom={19} />
        <TileLayer url={`${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`} maxNativeZoom={16} maxZoom={19} />
        <FitOnce points={heatPoints.map(([lat, lng]) => [lat, lng])} />
        <FlyTo focus={focus} />
        {mode === 'heat' && heatPoints.length > 0 && <HeatLayer points={heatPoints} />}
        {mode === 'pins' &&
          // Oldest first so the newest pins render on top
          [...mapped].reverse().map((call) => (
            <Marker key={call.id} position={[call.latitude, call.longitude]} icon={pinIcon(call)} zIndexOffset={call.urgency_level === 'Critical' ? 1000 : 0}>
              <Popup closeButton={false} minWidth={288}>
                <CallPopup call={call} now={now} onOpen={onOpenCall} />
              </Popup>
            </Marker>
          ))}
        {showHotspots &&
          mapHotspots.map((h) => (
            <Marker key={h.id} position={[h.lat, h.lng]} icon={hotspotIcon} zIndexOffset={500}>
              <Popup closeButton={false}>
                <div className="w-56 font-sans">
                  <p className="text-xs font-semibold uppercase tracking-wide text-orange-600">Streetlight degradation risk</p>
                  <p className="mt-0.5 text-sm font-semibold text-slate-900">
                    {h.label}
                    {h.zipcode ? <span className="font-normal text-slate-500"> · {h.zipcode}</span> : null}
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{h.score.toFixed(0)}%</p>
                  <p className="text-xs font-medium text-slate-700">High risk of streetlight failure within 90 days</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {h.density} reports in 2 yrs · last repair {h.days_since_last_patch} days before data cutoff
                  </p>
                </div>
              </Popup>
            </Marker>
          ))}
      </MapContainer>

      {/* Overlays sit above Leaflet's panes (z-index 400-700) */}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-[1000] flex flex-col items-start gap-2 sm:flex-row sm:items-start">
        <div className="pointer-events-auto w-full sm:max-w-md">
          <CriticalBanner calls={calls} now={now} onSelect={onOpenCall} />
        </div>
        <div className="pointer-events-auto ml-auto flex items-center gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm backdrop-blur">
          <Toggle active={mode === 'pins'} onClick={() => setMode('pins')}>
            Pins
          </Toggle>
          <Toggle active={mode === 'heat'} onClick={() => setMode('heat')}>
            Heat map
          </Toggle>
          <span className="mx-0.5 h-4 w-px bg-slate-200" />
          <Toggle active={showHotspots} onClick={() => setShowHotspots((v) => !v)}>
            <Flame className="mr-1 inline h-3 w-3" aria-hidden />
            Predictive
          </Toggle>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] flex flex-col items-start gap-2">
        {unmapped > 0 && (
          <span
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/95 px-2.5 py-1 text-[11px] text-slate-600 shadow-sm"
            title="These calls have no address yet; see Call Logs"
          >
            <MapPinOff className="h-3 w-3" aria-hidden /> {unmapped} {unmapped === 1 ? 'call' : 'calls'} without a location
          </span>
        )}
        <Legend />
      </div>
    </div>
  );
}
