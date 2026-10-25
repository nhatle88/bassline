// Song library in IndexedDB (sheet pages + chords + your bass line), so a sheet
// only needs to be read once. Everything stays on this device.
// Pages live in their own store so autosaving an edit doesn't rewrite the images.

const DB = 'bassline';
let dbPromise = null;

function db() {
  dbPromise ??= new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('songs', { keyPath: 'id' });
      req.result.createObjectStore('pages');
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  return dbPromise;
}

async function run(storeName, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    tx.oncomplete = () => res(req?.result);
    tx.onerror = () => rej(tx.error);
  });
}

export const saveSong = (rec) => run('songs', 'readwrite', (s) => s.put(rec));
export const getSong = (id) => run('songs', 'readonly', (s) => s.get(id));
export const savePages = (id, pages) => run('pages', 'readwrite', (s) => s.put(pages, id));
export const getPages = async (id) => (await run('pages', 'readonly', (s) => s.get(id))) || [];
export async function deleteSong(id) {
  await run('songs', 'readwrite', (s) => s.delete(id));
  await run('pages', 'readwrite', (s) => s.delete(id));
}
export async function listSongs() {
  const all = (await run('songs', 'readonly', (s) => s.getAll())) || [];
  return all.sort((a, b) => b.updated - a.updated);
}

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
