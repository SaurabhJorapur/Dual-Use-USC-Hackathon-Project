// IndexedDB-backed store for the report outbox (reportQueue.js). Writes resolve only once
// the transaction commits, so "saved on this device" is true when the UI says it.
// public/report-sw.js opens the same database: keep DB_NAME / STORE in sync with it.
export const DB_NAME = 'civicline-reports';
export const STORE = 'outbox';

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('This browser cannot store reports offline'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => {
      const db = req.result;
      // Let a newer version (another tab, the service worker) upgrade; reopen on next use.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Report storage is blocked by another open tab'));
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted'));
  });
}

export const idbStore = {
  put: (item) => run('readwrite', (s) => s.put(item)),
  getAll: () => run('readonly', (s) => s.getAll()),
  delete: (id) => run('readwrite', (s) => s.delete(id)),
};
