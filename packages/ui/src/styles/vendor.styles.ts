/**
 * Overrides of third-party selectors — sonner's `[data-sonner-toast]`,
 * `react-remove-scroll`'s `body[data-scroll-locked]` — and nothing else.
 *
 * Unlayered on purpose, and so not wrapped with `layer()`. Those libraries
 * inject their own unlayered `<style>`, and an unlayered rule beats every
 * layered one: an override inside `itsm.components` would lose to the very
 * rule it was written to change. Kept to one module so the exception stays
 * small and visible.
 *
 * Empty until the overlays arrive with the libraries that need it.
 */
export const vendorStyles = '';
