import { css, layer } from '../styles/css.js';

/**
 * `ConflictDialog`: the changes as a short list of sentences on the sunken
 * surface — who, which field, the value they left, when — with the person's
 * own value underneath in `text.secondary`. Values are `text.primary` at
 * weight 600 so the eye finds the difference first; the time is muted and
 * tabular.
 */
export const conflictDialogStyles = layer(
  'components',
  css`
.itsm-ConflictDialog__changes {
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-2xs);
  margin: 0;
  padding: 0;
  list-style: none;
}
.itsm-ConflictDialog__change {
  padding: var(--itsm-space-sm) var(--itsm-space-md);
  border-radius: var(--itsm-radius-lg);
  background: var(--itsm-colour-surface-sunken);
}
.itsm-ConflictDialog__change:first-child { border-start-start-radius: var(--itsm-radius-xl); border-start-end-radius: var(--itsm-radius-xl); }
.itsm-ConflictDialog__change:last-child { border-end-start-radius: var(--itsm-radius-xl); border-end-end-radius: var(--itsm-radius-xl); }
.itsm-ConflictDialog__summary,
.itsm-ConflictDialog__mine {
  margin: 0;
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  color: var(--itsm-colour-text-secondary);
}
.itsm-ConflictDialog__mine { margin-block-start: var(--itsm-space-3xs); }
.itsm-ConflictDialog__who,
.itsm-ConflictDialog__field { color: var(--itsm-colour-text-primary); font-weight: var(--itsm-font-weight-medium); }
.itsm-ConflictDialog__value { color: var(--itsm-colour-text-primary); font-weight: var(--itsm-font-weight-semibold); overflow-wrap: anywhere; }
.itsm-ConflictDialog__when { color: var(--itsm-colour-text-muted); font-variant-numeric: tabular-nums; }
.itsm-ConflictDialog__error { margin-block-start: var(--itsm-space-md); }
`,
);
