import { css, layer } from '../styles/css.js';

/**
 * `OlderNewer`: *Newer* and *Older* as a joined pair at the end of the audit
 * list, with *Newest* ahead of them once there is a newer page to skip. The
 * pair keeps its place when one end is disabled, so the other never jumps.
 */
export const olderNewerStyles = layer(
  'components',
  css`
.itsm-OlderNewer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--itsm-space-xs);
  padding-block: var(--itsm-space-sm) var(--itsm-space-xs);
}
.itsm-OlderNewer__pair {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
}
`,
);
