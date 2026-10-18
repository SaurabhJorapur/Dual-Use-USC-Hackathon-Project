import { useCallback, useEffect, useRef, useState } from 'react';
import { createReportQueue, sendReport, startAutoFlush } from '../lib/reportQueue';
import { idbStore } from '../lib/idbStore';

const BASE = import.meta.env.VITE_API_URL || '';

// Only one tab flushes at a time; another tab holding the lock already covers the queue.
const lock = (fn) => (navigator.locks ? navigator.locks.request('crisis-report-flush', { ifAvailable: true }, (held) => held && fn()) : fn());

// Background Sync (Chromium only) lets the service worker send queued reports after the page closes.
async function requestBackgroundSync() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration('/report/');
    await reg?.sync?.register('send-reports');
  } catch {
    // Unsupported or denied: the page's own retries still apply.
  }
}

/**
 * The report outbox for the crisis report page.
 * @returns {{items, statuses, submit, retryNow, discard}} `statuses` maps report id -> latest queue event.
 */
export function useReportQueue() {
  const [items, setItems] = useState([]);
  const [statuses, setStatuses] = useState({});
  const ref = useRef(null);

  useEffect(() => {
    const refresh = () => queue.list().then(setItems, () => setItems([]));
    const queue = createReportQueue({
      store: idbStore,
      send: (payload) => sendReport(payload, { baseUrl: BASE }),
      onEvent: (event) => {
        setStatuses((s) => ({ ...s, [event.id]: event }));
        if (event.type === 'failed') requestBackgroundSync();
        refresh();
      },
    });
    const auto = startAutoFlush(queue, { win: window, doc: document, lock });
    const onMessage = (e) => e.data?.type === 'flush-reports' && auto.run(true);
    navigator.serviceWorker?.addEventListener('message', onMessage);
    ref.current = { queue, auto, refresh };
    refresh();
    return () => {
      auto.stop();
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    };
  }, []);

  /** Persists the report, then tries to send it. Rejects if it could not be saved locally. */
  const submit = useCallback(async (fields) => {
    const { queue, auto } = ref.current;
    const item = await queue.add(fields);
    requestBackgroundSync();
    auto.run(true);
    return item;
  }, []);

  const retryNow = useCallback(() => ref.current.auto.run(true), []);
  const discard = useCallback(async (id) => {
    await ref.current.queue.remove(id);
    ref.current.refresh();
  }, []);

  return { items, statuses, submit, retryNow, discard };
}
