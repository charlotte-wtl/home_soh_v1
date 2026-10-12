// IndexedDB — the on-device store. Every change is saved here first; GitHub
// sync (sync.js) mirrors it in the background and is never a precondition.

const DB_NAME = "home_soh";
const DB_VERSION = 1;
const META = "meta";

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(META)) req.result.createObjectStore(META, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const req = fn(db.transaction(META, mode).objectStore(META));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

export const getMeta = (key) => run("readonly", (s) => s.get(key)).then((r) => (r ? r.value : undefined));
export const setMeta = (key, value) => run("readwrite", (s) => s.put({ key, value })).then(() => value);
export const deleteMeta = (key) => run("readwrite", (s) => s.delete(key));
