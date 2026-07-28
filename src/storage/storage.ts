/**
 * chrome.storage.local access layer.
 *
 * - one in-memory cache, hydrated once per service-worker lifetime;
 * - mutations are serialised and acknowledged only after they are durable;
 * - every failure is surfaced to the caller instead of being mistaken for an
 *   empty store or a successful privacy-sensitive deletion.
 */
import { DEFAULT_SETTINGS, EMPTY_LEARNING, type LearningData, type Settings } from '../shared/types.js';
import { migrate, normaliseStored } from './migrations.js';
import { KEYS, type StoredShape } from './types.js';

let cache: { settings: Settings; learning: LearningData } | null = null;
let hydrating: Promise<void> | null = null;
let writeTail: Promise<void> = Promise.resolve();
const listeners = new Set<(state: { settings: Settings; learning: LearningData }) => void>();

/** Storage failures must never break typing; they are surfaced here instead. */
let lastError: string | null = null;
export function lastStorageError(): string | null {
  return lastError;
}

async function rawGet(): Promise<StoredShape> {
  try {
    const value = (await chrome.storage.local.get(null)) as StoredShape;
    lastError = null;
    return value;
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    throw new Error(`Could not read local extension storage: ${lastError}`);
  }
}

async function rawSet(patch: Record<string, unknown>): Promise<boolean> {
  try {
    await chrome.storage.local.set(patch);
    lastError = null;
    return true;
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    console.warn('[autocorrect] storage write failed:', lastError);
    return false;
  }
}

export async function hydrate(): Promise<{ settings: Settings; learning: LearningData }> {
  if (cache) return cache;
  if (!hydrating) {
    hydrating = (async () => {
      const store = await rawGet();
      const { patch } = migrate(store);
      if (
        Object.keys(patch).length > 0 &&
        !(await rawSet(patch))
      ) {
        throw new Error(lastError ?? 'Could not migrate local extension storage.');
      }
      const merged = { ...store, ...patch };
      cache = normaliseStored(merged);
    })();
  }
  try {
    await hydrating;
  } finally {
    hydrating = null;
  }
  return cache ?? { settings: { ...DEFAULT_SETTINGS }, learning: structuredClone(EMPTY_LEARNING) };
}

export function cached(): { settings: Settings; learning: LearningData } | null {
  return cache;
}

export async function getSettings(): Promise<Settings> {
  return (await hydrate()).settings;
}

export async function getLearning(): Promise<LearningData> {
  return (await hydrate()).learning;
}

function notify(): void {
  if (!cache) return;
  const snapshot = cache;
  for (const l of listeners) {
    try {
      l(snapshot);
    } catch (e) {
      console.warn('[autocorrect] storage listener failed:', e);
    }
  }
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  let result: Settings | undefined;
  const write = writeTail.then(async () => {
    const state = await hydrate();
    const candidate = { ...state.settings, ...patch };
    const settings = normaliseStored({
      [KEYS.settings]: candidate,
      [KEYS.learning]: state.learning,
    }).settings;
    if (!(await rawSet({ [KEYS.settings]: settings }))) {
      throw new Error(lastError ?? 'Could not save settings.');
    }
    state.settings = settings;
    cache = state;
    result = settings;
    notify();
  });
  writeTail = write.catch(() => {});
  await write;
  return result!;
}

/** Mutates learning data in place; the mutation runs against the live object. */
export async function mutateLearning<T>(fn: (data: LearningData) => T): Promise<T> {
  let result: T | undefined;
  const write = writeTail.then(async () => {
    const state = await hydrate();
    const learning = structuredClone(state.learning);
    result = fn(learning);
    const normalised = normaliseStored({
      [KEYS.settings]: state.settings,
      [KEYS.learning]: learning,
    }).learning;
    if (!(await rawSet({ [KEYS.learning]: normalised }))) {
      throw new Error(lastError ?? 'Could not save learned data.');
    }
    state.learning = normalised;
    cache = state;
    notify();
  });
  writeTail = write.catch(() => {});
  await write;
  return result as T;
}

export async function replaceAll(settings: Settings, learning: LearningData): Promise<void> {
  const settingsSnapshot = structuredClone(settings);
  const learningSnapshot = structuredClone(learning);
  const write = writeTail.then(async () => {
    const state = await hydrate();
    const normalised = normaliseStored({
      [KEYS.settings]: settingsSnapshot,
      [KEYS.learning]: learningSnapshot,
    });
    if (
      !(await rawSet({
        [KEYS.settings]: normalised.settings,
        [KEYS.learning]: normalised.learning,
      }))
    ) {
      throw new Error(lastError ?? 'Could not replace extension data.');
    }
    state.settings = normalised.settings;
    state.learning = normalised.learning;
    cache = state;
    notify();
  });
  writeTail = write.catch(() => {});
  await write;
}

export function onChange(fn: (state: { settings: Settings; learning: LearningData }) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* Direct key access for the session store, which manages its own keys. */
export async function getRaw<T>(key: string): Promise<T | undefined> {
  try {
    const out = await chrome.storage.local.get(key);
    lastError = null;
    return out[key] as T | undefined;
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    throw new Error(`Could not read local extension storage: ${lastError}`);
  }
}

export async function getAllRaw(): Promise<Record<string, unknown>> {
  return rawGet();
}

export async function setRaw(patch: Record<string, unknown>): Promise<boolean> {
  return rawSet(patch);
}

export async function removeRaw(keys: string | string[]): Promise<boolean> {
  try {
    await chrome.storage.local.remove(keys);
    lastError = null;
    return true;
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    return false;
  }
}

/** Test seam: clears the module cache so a fresh hydrate re-reads storage. */
export function __resetCacheForTests(): void {
  cache = null;
  hydrating = null;
  writeTail = Promise.resolve();
  listeners.clear();
}
