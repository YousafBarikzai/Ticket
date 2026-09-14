/**
 * Live-region announcer.
 *
 * Changes that happen away from the user's focus — a toast, a filtered result
 * count, a background save — have to be spoken, or they do not exist for a
 * screen-reader user (WCAG 2.2 SC 4.1.3). One pair of regions is shared by the
 * whole application: creating a region at announcement time does not work,
 * because assistive technology only watches regions that were in the DOM
 * before the text changed.
 */

export type Politeness = 'polite' | 'assertive';

interface RegionPair {
  polite: HTMLElement;
  assertive: HTMLElement;
}

let regions: RegionPair | null = null;
const pending = new Map<Politeness, ReturnType<typeof setTimeout>>();

/** Off-screen but not `display: none`, which would remove it from the accessibility tree. */
function applyVisuallyHiddenStyle(element: HTMLElement): void {
  Object.assign(element.style, {
    position: 'absolute',
    width: '1px',
    height: '1px',
    margin: '-1px',
    padding: '0',
    border: '0',
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
  });
}

function createRegion(doc: Document, politeness: Politeness): HTMLElement {
  const element = doc.createElement('div');
  element.setAttribute('data-itsm-live-region', politeness);
  element.setAttribute('aria-live', politeness);
  element.setAttribute('aria-atomic', 'true');
  // role=status/alert gives older screen readers the same behaviour as aria-live.
  element.setAttribute('role', politeness === 'assertive' ? 'alert' : 'status');
  applyVisuallyHiddenStyle(element);
  doc.body.appendChild(element);
  return element;
}

function ensureRegions(doc: Document): RegionPair | null {
  if (regions && regions.polite.isConnected && regions.assertive.isConnected) return regions;
  regions = { polite: createRegion(doc, 'polite'), assertive: createRegion(doc, 'assertive') };
  return regions;
}

/** Call once from the application shell so the regions exist before the first announcement. */
export function installAnnouncer(doc: Document | undefined = globalThis.document): void {
  if (!doc) return;
  ensureRegions(doc);
}

export interface AnnounceOptions {
  readonly politeness?: Politeness;
  /**
   * Milliseconds before the region is emptied again. Leaving text in a region
   * makes some screen readers repeat it when the user navigates back to it.
   */
  readonly clearAfterMs?: number;
}

/**
 * Announces a message. The region is cleared first and filled on the next
 * task: setting the same string twice is not a DOM mutation, so the second
 * announcement would be silent.
 */
export function announce(message: string, options: AnnounceOptions = {}): void {
  const doc = globalThis.document as Document | undefined;
  if (!doc || !message.trim()) return;
  const politeness = options.politeness ?? 'polite';
  const pair = ensureRegions(doc);
  if (!pair) return;
  const region = politeness === 'assertive' ? pair.assertive : pair.polite;

  const queued = pending.get(politeness);
  if (queued) clearTimeout(queued);
  region.textContent = '';

  const timer = setTimeout(() => {
    region.textContent = message;
    pending.delete(politeness);
    if (options.clearAfterMs !== undefined) {
      setTimeout(() => {
        if (region.textContent === message) region.textContent = '';
      }, options.clearAfterMs);
    }
  }, 30);
  pending.set(politeness, timer);
}

/** The current text of a region. Exposed for tests and for debugging live-region bugs. */
export function announcerText(politeness: Politeness = 'polite'): string {
  const doc = globalThis.document as Document | undefined;
  const region = doc?.querySelector(`[data-itsm-live-region="${politeness}"]`);
  return region?.textContent ?? '';
}

/** Removes the regions. Tests use it between cases; applications never need it. */
export function destroyAnnouncer(): void {
  for (const timer of pending.values()) clearTimeout(timer);
  pending.clear();
  regions?.polite.remove();
  regions?.assertive.remove();
  regions = null;
}
