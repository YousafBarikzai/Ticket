import { DEMO_LOCAL_KEYS } from '@itsm/contracts/demo';
import { clearLocalData, type ClearOptions, type ClearReport } from './clear.js';

/**
 * `@itsm/pwa/demo` — forgetting a demo visit's local data when the shared demo
 * is rebuilt (A3 §6.10, critique S11).
 *
 * A demo generation is a whole new tenant: new ticket ids, new people, new
 * everything. What this browser kept from the last one — the pages and API
 * answers in the offline caches, a queued reply, a draft, the recents and pins
 * that point at records that no longer exist — is now wrong, and a queued
 * write replayed against the new generation could land on a different ticket
 * with the same number. So when the demo bar meets a newer generation, the
 * application clears the visit's data with the same machinery as sign-out
 * (`clearLocalData`, with its own keys) and records the generation, so the
 * "Demo data was reset" notice is said once and not on every page.
 *
 * Its own subpath, loaded with `import()` only when a generation changes: it
 * reads the demo contracts, which no first load should carry.
 */

type GenerationStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Whether a key is one of the demo bar's own records, which a clear must keep. */
export function isDemoLocalKey(key: string): boolean {
  return key === DEMO_LOCAL_KEYS.lastGeneration || key === DEMO_LOCAL_KEYS.noticeSeen;
}

function pageStorage(): GenerationStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Merely reading the property throws where storage is blocked.
    return null;
  }
}

/** The generation this browser last saw, or `null` (never, or unreadable). */
export function readDemoGeneration(storage: GenerationStorage | null = pageStorage()): number | null {
  try {
    const raw = storage?.getItem(DEMO_LOCAL_KEYS.lastGeneration);
    if (raw === null || raw === undefined) return null;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Records the generation; false when it could not be (blocked or full storage, or not a generation). */
export function storeDemoGeneration(generation: number, storage: GenerationStorage | null = pageStorage()): boolean {
  if (!Number.isSafeInteger(generation) || generation < 1 || !storage) return false;
  try {
    storage.setItem(DEMO_LOCAL_KEYS.lastGeneration, String(generation));
    return true;
  } catch {
    return false;
  }
}

export interface ClearDemoOptions extends ClearOptions {
  /** The generation now live: recorded after the clear. */
  readonly generation: number;
  /** Where the generation is recorded. Defaults to `localStorage`. */
  readonly generationStorage?: GenerationStorage | null;
}

/**
 * `clearLocalData({ alsoKeys })` — the personal caches, the outbox, drafts and
 * the application's own keys — then records `generation`
 * (`localStorage['itsm-demo:last-gen']`). The bar's own two records are never
 * cleared, whatever `alsoKeys` says. Never throws: a blocked storage or a
 * failed cache read still records what it can, and the visitor's next page
 * simply tries again.
 */
export async function clearDemoLocalData(options: ClearDemoOptions): Promise<ClearReport> {
  const { generation, generationStorage, alsoKeys, ...clear } = options;
  const report = await clearLocalData({
    ...clear,
    alsoKeys: (key) => !isDemoLocalKey(key) && alsoKeys?.(key) === true,
  }).catch((): ClearReport => ({ caches: 0, outbox: 0, keys: 0 }));
  storeDemoGeneration(generation, generationStorage === undefined ? pageStorage() : generationStorage);
  return report;
}
