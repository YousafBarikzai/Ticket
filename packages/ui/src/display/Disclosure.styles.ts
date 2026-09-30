import { css, layer, mq } from '../styles/css.js';

/**
 * `Disclosure`: a summary row with a chevron that turns a quarter as the
 * content opens beneath it, aligned with the summary's text.
 *
 * The summary is a ghost control: its hover and pressed fills are the alpha
 * `fill.*` tokens, which never sit under audited text on their own, and its
 * box reaches a little past the text on either side (a negative margin) so
 * the words line up with the content around the disclosure while the target
 * stays generous. It is at least a medium control tall (40 px on a touch
 * screen).
 *
 * Opening slides where the browser can animate to `auto` height —
 * `interpolate-size` with the `::details-content` part — and is a plain
 * appearance elsewhere. Under reduced motion the durations are 1 ms, so it
 * appears there too.
 */
export const disclosureStyles = layer(
  'components',
  css`
.itsm-Disclosure {
  min-inline-size: 0;
}

.itsm-Disclosure__summary {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  box-sizing: border-box;
  min-block-size: var(--itsm-control-height-md);
  margin-inline: calc(-1 * var(--itsm-space-xs));
  padding: var(--itsm-space-2xs) var(--itsm-space-xs);
  border-radius: var(--itsm-radius-md);
  color: var(--itsm-colour-text-primary);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  font-weight: var(--itsm-font-weight-medium);
  cursor: pointer;
  list-style: none;
  user-select: none;
  transition: background-color var(--itsm-duration-fast) var(--itsm-easing-standard);
}

.itsm-Disclosure__summary::-webkit-details-marker {
  display: none;
}

.itsm-Disclosure__summary:hover {
  background: var(--itsm-colour-fill-hover);
}

.itsm-Disclosure__summary:active {
  background: var(--itsm-colour-fill-pressed);
}

.itsm-Disclosure__chevron {
  color: var(--itsm-colour-text-muted);
  transition: transform var(--itsm-duration-normal) var(--itsm-easing-emphasised);
}

.itsm-Disclosure[open] > .itsm-Disclosure__summary .itsm-Disclosure__chevron {
  transform: rotate(90deg);
}

.itsm-Disclosure__label {
  flex: 1;
  min-inline-size: 0;
}

.itsm-Disclosure__content {
  padding-block: var(--itsm-space-xs) var(--itsm-space-2xs);
  padding-inline-start: calc(var(--itsm-icon-sm) + var(--itsm-space-xs));
  color: var(--itsm-colour-text-primary);
}

@supports (interpolate-size: allow-keywords) and selector(::details-content) {
  .itsm-Disclosure {
    interpolate-size: allow-keywords;
  }
  .itsm-Disclosure::details-content {
    block-size: 0;
    overflow-y: clip;
    transition:
      block-size var(--itsm-duration-normal) var(--itsm-easing-emphasised),
      content-visibility var(--itsm-duration-normal) var(--itsm-easing-emphasised) allow-discrete;
  }
  .itsm-Disclosure[open]::details-content {
    block-size: auto;
  }
}

${mq.forcedColors} {
  .itsm-Disclosure__summary:hover {
    outline: var(--itsm-hairline) solid CanvasText;
  }
}
`,
);
