import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * `RouteProgress`: a 2 px accent line across the top of the window, above
 * the top bar. While a slow navigation waits it creeps towards 90 % on the
 * entrance curve (over a long, fixed stretch — a behaviour constant, not a
 * design duration: it must outlast most navigations without ever arriving);
 * when the page lands it runs out to the end and fades. `transform` and
 * `opacity` only. Under reduced motion it is a still line, shown and hidden.
 */
export const routeProgressStyles = layer(
  'components',
  css`
@keyframes itsm-RouteProgress-creep {
  from { transform: scaleX(0); }
  to { transform: scaleX(0.9); }
}

.itsm-RouteProgress {
  position: fixed;
  inset-block-start: 0;
  inset-inline: 0;
  z-index: var(--itsm-z-tooltip);
  block-size: var(--itsm-border-thick);
  background: var(--itsm-colour-accent);
  opacity: 0;
  pointer-events: none;
  transform: scaleX(0);
  transform-origin: 0 0;
}
.itsm-RouteProgress:dir(rtl) {
  transform-origin: 100% 0;
}
.itsm-RouteProgress[data-phase="running"] {
  opacity: 1;
  transform: scaleX(0.9);
  animation: itsm-RouteProgress-creep 8s var(--itsm-easing-entrance);
}
.itsm-RouteProgress[data-phase="finishing"] {
  opacity: 0;
  transform: scaleX(1);
  transition: transform var(--itsm-duration-fast) var(--itsm-easing-standard), opacity var(--itsm-duration-normal) var(--itsm-easing-exit) var(--itsm-duration-fast);
}

${mq.reducedMotion} {
  .itsm-RouteProgress[data-phase="running"] {
    transform: scaleX(1);
    animation: none;
  }
  .itsm-RouteProgress[data-phase="finishing"] {
    transition: none;
  }
}
${prefers.reducedMotion} .itsm-RouteProgress[data-phase="running"] {
  transform: scaleX(1);
  animation: none;
}
${prefers.reducedMotion} .itsm-RouteProgress[data-phase="finishing"] {
  transition: none;
}

${mq.forcedColors} {
  .itsm-RouteProgress {
    background: Highlight;
  }
}
`,
);
