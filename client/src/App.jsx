import { useCallback, useMemo, useState } from 'react';
import { LoaderCircle, TriangleAlert } from 'lucide-react';
import Header from './components/Header';
import CriticalBanner from './components/CriticalBanner';
import StatsCards from './components/StatsCards';
import Filters, { EMPTY_FILTERS, applyFilters } from './components/Filters';
import CallList from './components/CallList';
import CallDrawer from './components/CallDrawer';
import { useCalls } from './hooks/useCalls';
import { useNow } from './hooks/useNow';

export default function App() {
  const { calls, loading, error, connection, freshIds, upsertLocal } = useCalls();
  const now = useNow();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState(null);

  const visible = useMemo(() => applyFilters(calls, filters), [calls, filters]);
  // Look up by id so the open drawer reflects realtime updates to that call
  const selected = calls.find((c) => c.id === selectedId) || null;
  const close = useCallback(() => setSelectedId(null), []);

  return (
    <div className="min-h-screen">
      <Header connection={connection} />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <CriticalBanner calls={calls} now={now} onSelect={(c) => setSelectedId(c.id)} />
        <StatsCards calls={calls} now={now} />

        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-semibold">Call log</h2>
            <span className="text-sm text-slate-500">
              {visible.length} of {calls.length} calls
            </span>
          </div>
          <Filters filters={filters} onChange={setFilters} />

          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-inset ring-red-200">
              <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
              Couldn't load calls: {error}. Is the API server running?
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> Loading calls…
            </div>
          ) : (
            <CallList
              calls={visible}
              freshIds={freshIds}
              now={now}
              selectedId={selectedId}
              onSelect={(c) => setSelectedId(c.id)}
              emptyMessage={calls.length ? 'No calls match these filters.' : 'No calls yet. Place a test call or run `npm run seed` in /server.'}
            />
          )}
        </section>
      </main>
      <CallDrawer call={selected} onClose={close} onUpdated={upsertLocal} />
    </div>
  );
}
