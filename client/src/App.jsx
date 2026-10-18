import { useCallback, useEffect, useMemo, useState } from 'react';
import Sidebar from './components/Sidebar';
import CityMap from './components/CityMap';
import CallLogsView from './components/CallLogsView';
import ClustersView from './components/ClustersView';
import SimulationPage from './pages/SimulationPage';
import StatusTicker from './components/StatusTicker';
import CallDrawer from './components/CallDrawer';
import TestCallButton from './components/TestCallButton';
import { EMPTY_FILTERS } from './components/Filters';
import { useCalls } from './hooks/useCalls';
import { useNow } from './hooks/useNow';
import { useRiskMap } from './hooks/useRiskMap';
import { useClusters } from './hooks/useClusters';

// Pages that also have their own address.
const HASH_VIEWS = { '#/clusters': 'clusters', '#/simulation': 'simulation' };
const VIEW_HASHES = Object.fromEntries(Object.entries(HASH_VIEWS).map(([hash, view]) => [view, hash]));

export default function App() {
  const { calls, loading, error, freshIds, upsertLocal } = useCalls();
  const { hotspots } = useRiskMap();
  // Shared by the clusters page and the call logs (which list a cluster as one entry).
  const { clusters, loading: clustersLoading, error: clustersError, reload: reloadClusters } = useClusters();
  const now = useNow();
  const [view, setView] = useState(() => HASH_VIEWS[window.location.hash] || 'map');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState(null);
  const [focus, setFocus] = useState(null);
  // Calls an operator has taken over from the AI agent. Dashboard-local: kept until reload.
  const [overrides, setOverrides] = useState(() => new Set());
  const setOverride = useCallback((id, on) => {
    setOverrides((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  // The sidebar's category filter drives the map; the logs view adds search/urgency/status on top.
  const mapCalls = useMemo(() => (filters.category ? calls.filter((c) => c.category === filters.category) : calls), [calls, filters.category]);
  // Look up by id so the open drawer reflects realtime updates to that call
  const selected = calls.find((c) => c.id === selectedId) || null;
  const close = useCallback(() => setSelectedId(null), []);
  const openCall = useCallback((call) => setSelectedId(call.id), []);

  useEffect(() => {
    const onHash = () => HASH_VIEWS[window.location.hash] && setView(HASH_VIEWS[window.location.hash]);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    const hash = VIEW_HASHES[view] || '';
    if (window.location.hash !== hash) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
  }, [view]);

  const selectFromTicker = useCallback(
    (call) => {
      if (view === 'map' && call.latitude != null) setFocus({ lat: call.latitude, lng: call.longitude, zoom: 15, at: Date.now() });
      setSelectedId(call.id);
    },
    [view],
  );

  // The Disaster Simulator is a full-screen page of its own; the dashboard below is unchanged.
  if (view === 'simulation') return <SimulationPage onExit={() => setView('map')} />;

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <Sidebar
          view={view}
          onView={setView}
          calls={calls}
          now={now}
          activeCategory={filters.category}
          onSelectCategory={(category) => setFilters((f) => ({ ...f, category }))}
          badges={{ logs: calls.length }}
        />
        {/* `isolate` keeps Leaflet's high z-index panes below the call drawer */}
        <main className="relative isolate min-h-[70vh] min-w-0 flex-1 lg:min-h-0">
          {view === 'map' && (
            <CityMap
              calls={mapCalls}
              now={now}
              hotspots={hotspots}
              focus={focus}
              onOpenCall={openCall}
            />
          )}
          {view === 'logs' && (
            <CallLogsView
              calls={calls}
              clusters={clusters}
              onReloadClusters={reloadClusters}
              loading={loading}
              error={error}
              filters={filters}
              onFilters={setFilters}
              freshIds={freshIds}
              now={now}
              selectedId={selectedId}
              onSelect={openCall}
            />
          )}
          {view === 'clusters' && (
            <ClustersView calls={calls} clusters={clusters} loading={clustersLoading} error={clustersError} onReload={reloadClusters} now={now} />
          )}
        </main>
      </div>
      <StatusTicker calls={calls} now={now} freshIds={freshIds} onSelect={selectFromTicker} />
      {/* Floating above the ticker; below the call drawer (z-30) so it never covers dispatcher actions. */}
      <div className="fixed bottom-14 right-4 z-20">
        <TestCallButton />
      </div>
      <CallDrawer call={selected} onClose={close} onUpdated={upsertLocal} override={selected ? overrides.has(selected.id) : false} onOverride={setOverride} />
    </div>
  );
}
