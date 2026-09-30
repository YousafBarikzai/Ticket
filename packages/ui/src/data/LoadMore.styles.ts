import { css, layer } from '../styles/css.js';

/**
 * `LoadMore`: the caption and the button, centred under the list.
 *
 * The caption is `footnote` in `text.secondary` with tabular figures ("Showing
 * 100 · more available"); a failed load adds its reason in
 * `danger.subtleText`. The caption can take focus (when the last page lands
 * and the button goes), so it has a ring like anything else but no outline
 * when focused by script.
 */
export const loadMoreStyles = layer(
  'components',
  css`
.itsm-LoadMore {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--itsm-space-xs);
  padding-block: var(--itsm-space-sm) var(--itsm-space-xs);
  text-align: center;
}
.itsm-LoadMore__status {
  margin: 0;
  border-radius: var(--itsm-radius-xs);
  color: var(--itsm-colour-text-secondary);
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  font-variant-numeric: tabular-nums;
}
.itsm-LoadMore__status:focus:not(:focus-visible) {
  outline: none;
  box-shadow: none;
}
.itsm-LoadMore__error {
  color: var(--itsm-colour-danger-subtleText);
}
.itsm-LoadMore__sentinel {
  inline-size: 100%;
  block-size: 1px;
}
`,
);
