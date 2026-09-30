/**
 * Where a `Disclosure` with a `persistKey` keeps its state on this device.
 * Server-safe (plain functions), so sign-out cleanup and tests can use the
 * rule without importing the client component that applies it.
 */

/** The storage key for a disclosure's remembered state. */
export function disclosureStorageKey(persistKey: string): string {
  return `itsm-disclosure:${persistKey}`;
}

/** Whether a storage key belongs to a remembered disclosure, for clearing local data on sign-out. */
export function isDisclosureKey(key: string): boolean {
  return key.startsWith('itsm-disclosure:');
}
