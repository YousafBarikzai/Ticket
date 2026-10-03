import { css, layer, mq, prefers } from '../styles/css.js';

/**
 * `Skeleton` and `SkeletonText`: the bones every skeleton is built from.
 *
 * Timing, all in CSS so no timer runs and a server-rendered `loading.tsx`
 * needs no JavaScript (SPEC §1.9):
 *
 * - **Reveal after 200 ms.** Bones start transparent and fade in after a
 *   200 ms delay, so a response that arrives quickly never flashes a
 *   skeleton. The delay is not motion and stays under reduced motion; the
 *   fade itself collapses with the duration tokens.
 * - **Shimmer for about ten seconds.** A soft highlight sweeps across each
 *   bone six times (1.6 s each) and stops; by then the page shows "Still
 *   loading…" in words, and more motion would only say the same thing
 *   louder. It moves with `transform` alone, on a pseudo-element, so it is
 *   composited rather than repainted.
 * - **Static under reduced motion**, the operating system's or the product's.
 *
 * The bone is `surface.sunken` and the sweep is the PMO's band, `sunken →
 * hover → sunken` (v3 §2.13): a soft lighter stripe that starts and ends in
 * the bone's own colour, so its edges never show. Both are surface tokens,
 * so every theme — dark and high contrast included — gets a bone that reads
 * on its cards and canvas with no per-theme rule.
 */
export const skeletonStyles = layer(
  'components',
  css`
@keyframes itsm-skeleton-reveal {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes itsm-skeleton-sweep {
  from { transform: translateX(-100%); }
  to { transform: translateX(100%); }
}

.itsm-Skeleton {
  position: relative;
  display: block;
  flex-shrink: 0;
  max-inline-size: 100%;
  overflow: hidden;
  border-radius: var(--itsm-radius-sm);
  background: var(--itsm-colour-surface-sunken);
  animation: itsm-skeleton-reveal var(--itsm-duration-normal) var(--itsm-easing-standard) 200ms both;
}

.itsm-Skeleton::after {
  content: "";
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(90deg, var(--itsm-colour-surface-sunken) 0%, var(--itsm-colour-surface-hover) 40%, var(--itsm-colour-surface-sunken) 80%);
  animation: itsm-skeleton-sweep 1.6s linear 200ms 6;
}

.itsm-Skeleton[data-radius="md"] { border-radius: var(--itsm-radius-md); }
.itsm-Skeleton[data-radius="lg"] { border-radius: var(--itsm-radius-lg); }
.itsm-Skeleton[data-radius="xl"] { border-radius: var(--itsm-radius-xl); }
.itsm-Skeleton[data-radius="pill"] { border-radius: var(--itsm-radius-pill); }
.itsm-Skeleton[data-radius="full"] { border-radius: 50%; }

.itsm-SkeletonText {
  --_itsm-text-size: var(--itsm-text-body-size);
  --_itsm-text-line: var(--itsm-text-body-line);
  display: flex;
  flex-direction: column;
  gap: calc(var(--_itsm-text-line) - var(--_itsm-text-size) * 0.8);
  padding-block: calc((var(--_itsm-text-line) - var(--_itsm-text-size) * 0.8) / 2);
  inline-size: 100%;
}

.itsm-SkeletonText[data-size="callout"] {
  --_itsm-text-size: var(--itsm-text-callout-size);
  --_itsm-text-line: var(--itsm-text-callout-line);
}

.itsm-SkeletonText[data-size="footnote"] {
  --_itsm-text-size: var(--itsm-text-footnote-size);
  --_itsm-text-line: var(--itsm-text-footnote-line);
}

.itsm-SkeletonText__line {
  block-size: calc(var(--_itsm-text-size) * 0.8);
}

${mq.reducedMotion} {
  .itsm-Skeleton::after {
    display: none;
  }
}

${prefers.reducedMotion} .itsm-Skeleton::after {
  display: none;
}

${mq.forcedColors} {
  .itsm-Skeleton {
    forced-color-adjust: none;
    background: GrayText;
  }

  .itsm-Skeleton::after {
    display: none;
  }
}
`,
);
