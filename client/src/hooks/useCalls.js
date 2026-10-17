import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';

const POLL_MS = 5000;
const FLASH_MS = 2500;

const byNewest = (a, b) => new Date(b.created_at) - new Date(a.created_at);

/**
 * Loads calls from the API, then keeps them live via Supabase Realtime
 * (or polling when Supabase isn't configured on the client).
 * connection: 'connecting' | 'live' | 'polling' | 'offline'
 */
export function useCalls() {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connection, setConnection] = useState(supabase ? 'connecting' : 'polling');
  const [freshIds, setFreshIds] = useState(() => new Set());
  const knownIds = useRef(null);

  const flash = useCallback((ids) => {
    if (!ids.length) return;
    setFreshIds((prev) => new Set([...prev, ...ids]));
    setTimeout(() => {
      setFreshIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    }, FLASH_MS);
  }, []);

  const load = useCallback(async () => {
    try {
      const rows = await api.listCalls();
      // Flash rows that appeared since the last load (skipped on first load)
      if (knownIds.current) flash(rows.filter((r) => !knownIds.current.has(r.id)).map((r) => r.id));
      knownIds.current = new Set(rows.map((r) => r.id));
      setCalls(rows);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [flash]);

  const upsertLocal = useCallback((row) => {
    setCalls((prev) => {
      const exists = prev.some((c) => c.id === row.id);
      const next = exists ? prev.map((c) => (c.id === row.id ? row : c)) : [row, ...prev];
      return next.sort(byNewest);
    });
    knownIds.current?.add(row.id);
  }, []);

  useEffect(() => {
    load();

    if (!supabase) {
      const timer = setInterval(load, POLL_MS);
      return () => clearInterval(timer);
    }

    const channel = supabase
      .channel('calls-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calls' }, (payload) => {
        if (payload.eventType === 'DELETE') {
          setCalls((prev) => prev.filter((c) => c.id !== payload.old.id));
          return;
        }
        upsertLocal(payload.new);
        flash([payload.new.id]);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setConnection('live');
          load(); // catch anything missed while (re)connecting
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setConnection('offline');
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [load, upsertLocal, flash]);

  return { calls, loading, error, connection, freshIds, refresh: load, upsertLocal };
}
