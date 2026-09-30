/**
 * The design system's own copy: the words a component says on the caller's
 * behalf ("Close dialog", "Clear search"), in plain British English.
 *
 * Collected in one object so an application can change a phrase once through
 * `ItsmProvider messages` instead of at every call site, and so a later
 * translation has a single place to start. Strings only — a message that needs
 * a number is composed by the component, which keeps this serialisable, so a
 * server layout can pass it to the provider.
 *
 * Server-safe (no directive): a server component may import
 * `defaultMessages` to build the partial it passes.
 *
 * Adding a key is safe. Changing a default changes every screen that shows
 * it, and some are pinned by tests ("Close dialog", "No matching commands").
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
  readonly back: string;
  readonly dismiss: string;
  readonly copy: string;
  readonly copied: string;
  readonly showMore: string;
  readonly showLess: string;
  readonly search: string;
  readonly noMatchingCommands: string;
  readonly optional: string;
  readonly required: string;
  readonly saving: string;
  readonly saved: string;
  readonly selectionCleared: string;
  readonly needsConnection: string;
  readonly tryAgain: string;
  readonly signInAgain: string;
  readonly keyboardShortcuts: string;
  readonly skipToContent: string;
  readonly openInNewTab: string;
  readonly remove: string;
  readonly expand: string;
  readonly collapse: string;
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
  back: 'Back',
  dismiss: 'Dismiss',
  copy: 'Copy',
  copied: 'Copied',
  showMore: 'Show more',
  showLess: 'Show less',
  search: 'Search',
  noMatchingCommands: 'No matching commands',
  optional: '(optional)',
  required: 'Required',
  saving: 'Saving…',
  saved: 'Saved',
  selectionCleared: 'Selection cleared',
  needsConnection: 'Needs a connection',
  tryAgain: 'Try again',
  signInAgain: 'Sign in again',
  keyboardShortcuts: 'Keyboard shortcuts',
  skipToContent: 'Skip to content',
  openInNewTab: 'Open in new tab',
  remove: 'Remove',
  expand: 'Expand',
  collapse: 'Collapse',
};

/**
 * The provider's messages merged over the defaults, keeping only string
 * values: a partial that arrived as JSON from a server layout may carry
 * anything, and a component rendering `undefined` where "Close dialog" should
 * be is an unlabelled button.
 */
export function mergeMessages(overrides: Partial<UiMessages> | undefined): UiMessages {
  if (!overrides) return defaultMessages;
  const merged: Record<string, string> = { ...defaultMessages };
  for (const [key, value] of Object.entries(overrides)) {
    if (key in defaultMessages && typeof value === 'string' && value.trim() !== '') merged[key] = value;
  }
  return merged as unknown as UiMessages;
}
