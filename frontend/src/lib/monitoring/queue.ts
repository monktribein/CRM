/**
 * Durable, encrypted queue of screenshots waiting to be uploaded.
 *
 * Images are encrypted with AES-GCM using a non-extractable key kept in this
 * browser's IndexedDB, so the raw image bytes are never written to disk in the
 * clear. This protects against casual inspection of the browser profile; it is
 * NOT protection against malware or scripts running on this origin, which can
 * use the key. Where IndexedDB or WebCrypto is unavailable (e.g. some private
 * windows) the queue falls back to memory and is lost when the tab closes.
 */

export interface QueuedCapture {
  captureId: string;
  userId: string;
  sessionId: string;
  capturedAt: string;
  mimeType: string;
  attempts: number;
  /** Epoch ms before which the item should not be retried. */
  nextAttemptAt: number;
  createdAt: number;
}

interface StoredCapture extends QueuedCapture {
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
}

const DB_NAME = "bn-monitoring";
const QUEUE = "queue";
const KEYS = "keys";

let dbPromise: Promise<IDBDatabase | null> | null = null;
let keyPromise: Promise<CryptoKey | null> | null = null;
const memory = new Map<string, StoredCapture>();

function req<T>(r: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore(QUEUE, { keyPath: "captureId" });
        open.result.createObjectStore(KEYS);
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => resolve(null);
      open.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function store(mode: IDBTransactionMode, name = QUEUE) {
  const db = await openDb();
  return db ? db.transaction(name, mode).objectStore(name) : null;
}

/** One AES-GCM key per browser profile; generated once and never exportable. */
function encryptionKey(): Promise<CryptoKey | null> {
  keyPromise ??= (async () => {
    if (!globalThis.crypto?.subtle) return null;
    try {
      const keys = await store("readonly", KEYS);
      const existing = keys ? ((await req(keys.get("aes"))) as CryptoKey | undefined) : undefined;
      if (existing) return existing;
      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      const rw = await store("readwrite", KEYS);
      if (rw) await req(rw.put(key, "aes"));
      return key;
    } catch {
      return null;
    }
  })();
  return keyPromise;
}

/** True when captures survive a closed tab (IndexedDB + WebCrypto available). */
export async function isDurable() {
  return !!(await openDb()) && !!(await encryptionKey());
}

export async function enqueue(item: Omit<QueuedCapture, "attempts" | "nextAttemptAt" | "createdAt">, image: Blob) {
  const key = await encryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = await image.arrayBuffer();
  const stored: StoredCapture = {
    ...item,
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: Date.now(),
    iv,
    data: key ? await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain) : plain,
  };
  const s = key ? await store("readwrite") : null;
  if (s) await req(s.put(stored));
  else memory.set(stored.captureId, stored);
}

async function all(): Promise<StoredCapture[]> {
  const s = await store("readonly");
  const durable = s ? ((await req(s.getAll())) as StoredCapture[]) : [];
  return [...durable, ...memory.values()];
}

export async function list(): Promise<QueuedCapture[]> {
  return (await all())
    .map((i): QueuedCapture => ({
      captureId: i.captureId,
      userId: i.userId,
      sessionId: i.sessionId,
      capturedAt: i.capturedAt,
      mimeType: i.mimeType,
      attempts: i.attempts,
      nextAttemptAt: i.nextAttemptAt,
      createdAt: i.createdAt,
    }))
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

export async function count(userId: string) {
  return (await list()).filter((i) => i.userId === userId).length;
}

/** Decrypts a queued capture for upload. */
export async function read(captureId: string): Promise<Blob | null> {
  const mem = memory.get(captureId);
  if (mem) return new Blob([mem.data], { type: mem.mimeType });
  const s = await store("readonly");
  const item = s ? ((await req(s.get(captureId))) as StoredCapture | undefined) : undefined;
  const key = await encryptionKey();
  if (!item || !key) return null;
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: item.iv }, key, item.data);
  return new Blob([plain], { type: item.mimeType });
}

export async function update(captureId: string, patch: Pick<QueuedCapture, "attempts" | "nextAttemptAt">) {
  const mem = memory.get(captureId);
  if (mem) {
    Object.assign(mem, patch);
    return;
  }
  const s = await store("readwrite");
  if (!s) return;
  const item = (await req(s.get(captureId))) as StoredCapture | undefined;
  if (item) await req(s.put({ ...item, ...patch }));
}

export async function remove(captureId: string) {
  memory.delete(captureId);
  const s = await store("readwrite");
  if (s) await req(s.delete(captureId));
}

/** Local retention: unsent captures older than this are discarded (for every account on this browser). */
export async function purgeOlderThan(maxAgeMs: number) {
  const cutoff = Date.now() - maxAgeMs;
  for (const item of await list()) if (item.createdAt < cutoff) await remove(item.captureId);
}

/** Exponential backoff with ±20% jitter: 15s, 30s, 1m … capped at 30 minutes. */
export function backoffMs(attempts: number) {
  const base = Math.min(30 * 60_000, 15_000 * 2 ** Math.max(0, attempts - 1));
  return Math.round(base * (0.8 + Math.random() * 0.4));
}
