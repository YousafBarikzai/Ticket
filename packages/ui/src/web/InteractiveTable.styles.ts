import { css, layer } from '../styles/css.js';

/**
 * `InteractiveTable` (deprecated): no rules of its own any more. It renders a
 * `DataTable`, whose module styles it; the old `.itsm-Table__sort` header
 * button went with the old implementation, and nothing else drew it.
 *
 * The module stays registered until Stage 5 deletes the wrapper, so the
 * registry and the files on disk keep matching.
 */
export const interactiveTableStyles = layer('components', css``);
