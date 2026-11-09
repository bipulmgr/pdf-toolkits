/**
 * Browser-only persistence. Nothing ever leaves the device.
 *  - localStorage: small preferences (last-used options per tool, theme).
 *  - IndexedDB: recent output files ("My files"), because localStorage is
 *    limited to ~5 MB of strings and cannot hold binary PDFs efficiently.
 */

const PREF_KEY = 'pdftk:prefs';

export function getPrefs(toolId: string): Record<string, unknown> {
  try {
    const all = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    return all[toolId] || {};
  } catch {
    return {};
  }
}

export function setPrefs(toolId: string, values: Record<string, unknown>): void {
  try {
    const all = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    // Never persist secrets.
    const clean = Object.fromEntries(Object.entries(values).filter(([k]) => !/password/i.test(k)));
    all[toolId] = clean;
    localStorage.setItem(PREF_KEY, JSON.stringify(all));
  } catch {
    /* storage may be unavailable (private mode) */
  }
}

export function getSetting(key: string): string | null {
  try { return localStorage.getItem('pdftk:' + key); } catch { return null; }
}
export function setSetting(key: string, value: string): void {
  try { localStorage.setItem('pdftk:' + key, value); } catch { /* ignore */ }
}

export interface StoredFile {
  id: string;
  name: string;
  type: string;
  size: number;
  tool: string;
  created: number;
  blob: Blob;
}

const DB_NAME = 'pdftk';
const STORE = 'files';
const MAX_FILES = 30;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function listFiles(): Promise<StoredFile[]> {
  try {
    const all = await tx<StoredFile[]>('readonly', (s) => s.getAll() as IDBRequest<StoredFile[]>);
    return all.sort((a, b) => b.created - a.created);
  } catch {
    return [];
  }
}

export async function saveFile(name: string, blob: Blob, tool: string): Promise<void> {
  try {
    const rec: StoredFile = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name, type: blob.type, size: blob.size, tool, created: Date.now(), blob,
    };
    await tx('readwrite', (s) => s.put(rec));
    const all = await listFiles();
    for (const old of all.slice(MAX_FILES)) await deleteFile(old.id);
  } catch {
    /* quota exceeded or unavailable – history is a convenience only */
  }
}

export async function deleteFile(id: string): Promise<void> {
  try { await tx('readwrite', (s) => s.delete(id)); } catch { /* ignore */ }
}

export async function clearFiles(): Promise<void> {
  try { await tx('readwrite', (s) => s.clear()); } catch { /* ignore */ }
}
