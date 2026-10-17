import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';

const POLL_MS = 5000;
const WEEK = 7 * 24 * 60 * 60 * 1000;

/** Incident clusters from the last week, kept live via Supabase Realtime or polling. */
export function useClusters() {
  const [clusters, setClusters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setClusters(await api.listClusters(new Date(Date.now() - WEEK).toISOString()));
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    if (!supabase) {
      const timer = setInterval(load, POLL_MS);
      return () => clearInterval(timer);
    }
    const channel = supabase
      .channel('clusters-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'incident_clusters' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'incident_cluster_members' }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  return { clusters, loading, error, reload: load };
}
