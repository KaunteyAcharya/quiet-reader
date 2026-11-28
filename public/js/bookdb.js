// Book files live in this browser's IndexedDB — they are never uploaded anywhere.
let dbp;
function open() {
  return (dbp ||= new Promise((resolve, reject) => {
    const r = indexedDB.open('quiet-books', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('files'); r.result.createObjectStore('covers'); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => { dbp = null; reject(r.error); };
  }));
}
async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage full or blocked'));
  });
}
export const putFile = (id, blob) => run('files', 'readwrite', (s) => s.put(blob, id));
export const getFile = (id) => run('files', 'readonly', (s) => s.get(id));
export const putCover = (id, blob) => run('covers', 'readwrite', (s) => s.put(blob, id));
export const getCover = (id) => run('covers', 'readonly', (s) => s.get(id));
export async function delBook(id) {
  await run('files', 'readwrite', (s) => s.delete(id)).catch(() => {});
  await run('covers', 'readwrite', (s) => s.delete(id)).catch(() => {});
}
export async function storageInfo() {
  try {
    const e = await navigator.storage.estimate();
    return { used: e.usage || 0, quota: e.quota || 0 };
  } catch {
    return null;
  }
}
export async function keepForever() {
  try { return await navigator.storage?.persist?.(); } catch { return false; }
}
