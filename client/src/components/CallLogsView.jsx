import { useState } from 'react';
import { LoaderCircle, TriangleAlert } from 'lucide-react';
import Filters, { applyFilters } from './Filters';
import CallTable from './CallTable';
import ClusterDetail from './ClusterDetail';
import { logEntries } from '../lib/clusters';

export default function CallLogsView({ calls, clusters, onReloadClusters, loading, error, filters, onFilters, freshIds, now, selectedId, onSelect }) {
  const [openClusterId, setOpenClusterId] = useState(null);
  const visible = applyFilters(calls, filters);
  // Calls in the same incident cluster are listed once, as a single cluster entry.
  const entries = logEntries(visible, clusters);
  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-4 sm:p-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-semibold">Call Logs &amp; Records</h2>
          <p className="text-sm text-slate-500">Select a call for its transcript and formal incident report. Repeat calls about one incident are grouped as a cluster.</p>
        </div>
        <span className="text-sm tabular-nums text-slate-500">
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'} · {visible.length} of {calls.length} calls
        </span>
      </div>
      <Filters filters={filters} onChange={onFilters} calls={calls} />

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-inset ring-red-200">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
          Couldn't load calls: {error}. Is the API server running?
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden [&>div]:max-h-full">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> Loading calls…
          </div>
        ) : (
          <CallTable
            entries={entries}
            freshIds={freshIds}
            now={now}
            selectedId={selectedId}
            onSelect={onSelect}
            onOpenCluster={setOpenClusterId}
            emptyMessage={calls.length ? 'No calls match these filters.' : 'No calls yet. Place a test call or run `npm run seed` in /server.'}
          />
        )}
      </div>

      {openClusterId && (
        <ClusterDetail clusterId={openClusterId} clusters={clusters} now={now} onClose={() => setOpenClusterId(null)} onChanged={onReloadClusters} />
      )}
    </div>
  );
}
