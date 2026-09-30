import { css, layer } from './css.js';

/**
 * The keyframes, in one place because they are shared: `itsm-rise` moves both
 * the dialog and the toast, and a second copy under the same name would win or
 * lose by load order.
 *
 * Most durations come from the components, through the duration tokens, and
 * the token layer collapses those to 1ms under reduced motion — so nothing here
 * needs its own reduced-motion rule. The two loops are the exception:
 * `itsm-spin` turns the activity indicator and `itsm-pulse` is what it (and
 * anything else that shows "busy") does instead under reduced motion. A loop
 * runs on its own literal period, which the token collapse cannot reach, so
 * each user swaps `itsm-spin` for `itsm-pulse` in its own reduced-motion rule
 * — a collapsed 1 ms turn would be a strobe, not stillness.
 */
export const motionStyles = layer(
  'base',
  css`
@keyframes itsm-spin { to { transform: rotate(360deg); } }
@keyframes itsm-shimmer { from { background-position: 100% 0; } to { background-position: 0 0; } }
@keyframes itsm-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes itsm-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes itsm-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
`,
);
