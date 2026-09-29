/**
 * The design system's own copy: the words a component says on the caller's
 * behalf ("Close dialog", "Clear search"), in plain British English.
 *
 * Collected in one object so an application can change a phrase once through
 * `ItsmProvider messages` instead of every call site, and so a later
 * translation has a single place to start. Strings only — a message that needs
 * a number is composed by the component, which keeps this serialisable.
 *
 * Stub (SPEC §4.1): the first keys; the foundations package owns the list and
 * adds the ones each component needs as it is written.
 */
export interface UiMessages {
  readonly close: string;
  readonly closeDialog: string;
  readonly clear: string;
  readonly clearSearch: string;
  readonly loading: string;
  readonly stillLoading: string;
  readonly moreOptions: string;
  readonly notSet: string;
  readonly notAvailable: string;
  readonly retry: string;
  readonly undo: string;
  readonly cancel: string;
  readonly notifications: string;
}

export const defaultMessages: UiMessages = {
  close: 'Close',
  closeDialog: 'Close dialog',
  clear: 'Clear',
  clearSearch: 'Clear search',
  loading: 'Loading…',
  stillLoading: 'Still loading…',
  moreOptions: 'More options',
  notSet: 'Not set',
  notAvailable: 'Not available',
  retry: 'Retry',
  undo: 'Undo',
  cancel: 'Cancel',
  notifications: 'Notifications',
};
