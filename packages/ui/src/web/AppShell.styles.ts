import { css, layer, mq } from '../styles/css.js';

/**
 * `AppShell`.
 *
 * In the patterns layer, above the components it is built from: the menu
 * toggle is an `IconButton` that the shell hides on wide screens, and that has
 * to win over `IconButton`'s own `display` however either selector is written.
 *
 * A navigation link rises by the small lift on hover and focus, and not at
 * all under reduced motion.
 */
export const appShellStyles = layer(
  'patterns',
  css`
.itsm-AppShell__navLink:hover,
.itsm-AppShell__navLink:focus-visible {
  transform: translateY(calc(-1 * var(--itsm-lift-sm)));
}

${mq.reducedMotion} {
  .itsm-AppShell__navLink {
    transition: none;
  }
  .itsm-AppShell__navLink:hover,
  .itsm-AppShell__navLink:focus-visible {
    transform: none;
  }
}

.itsm-AppShell { min-block-size: 100dvh; display: flex; flex-direction: column; background: var(--itsm-colour-surface-canvas); color: var(--itsm-colour-text-primary); }
.itsm-AppShell__skipLink {
  position: absolute;
  inset-inline-start: var(--itsm-space-xs);
  inset-block-start: var(--itsm-space-xs);
  z-index: var(--itsm-z-tooltip);
  padding: var(--itsm-space-xs) var(--itsm-space-sm);
  background: var(--itsm-colour-brand-solid);
  color: var(--itsm-colour-brand-solidText);
  border-radius: var(--itsm-radius-md);
  transform: translateY(-200%);
}
.itsm-AppShell__skipLink:focus { transform: none; }
.itsm-AppShell__header {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-sm);
  padding: var(--itsm-space-xs) var(--itsm-space-md);
  min-block-size: var(--itsm-control-height-lg);
  background: var(--itsm-colour-surface-raised);
  border-block-end: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  position: sticky;
  inset-block-start: 0;
  z-index: var(--itsm-z-sticky);
}
.itsm-AppShell__brand { display: flex; align-items: center; gap: var(--itsm-space-xs); font-weight: var(--itsm-font-weight-semibold); }
.itsm-AppShell__headerEnd { margin-inline-start: auto; display: flex; align-items: center; gap: var(--itsm-space-xs); }
.itsm-AppShell__main { display: flex; flex: 1; min-block-size: 0; }
.itsm-AppShell__nav {
  inline-size: 15rem;
  flex: none;
  padding: var(--itsm-space-sm);
  border-inline-end: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  background: var(--itsm-colour-surface-raised);
  overflow-y: auto;
}
.itsm-AppShell__navList { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--itsm-space-3xs); }
.itsm-AppShell__navLink {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  padding: var(--itsm-space-2xs) var(--itsm-space-xs);
  border-radius: var(--itsm-radius-md);
  color: var(--itsm-colour-text-secondary);
  text-decoration: none;
  font-size: var(--itsm-font-size-md);
}
.itsm-AppShell__navLink:hover { background: var(--itsm-colour-surface-hover); color: var(--itsm-colour-text-primary); }
.itsm-AppShell__navLink[aria-current="page"] { background: var(--itsm-colour-surface-selected); color: var(--itsm-colour-brand-subtleText); font-weight: var(--itsm-font-weight-semibold); }
.itsm-AppShell__navBadge { margin-inline-start: auto; }
.itsm-AppShell__content { flex: 1; min-inline-size: 0; padding: var(--itsm-space-lg); }
.itsm-AppShell__aside { inline-size: 20rem; flex: none; padding: var(--itsm-space-md); border-inline-start: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle); background: var(--itsm-colour-surface-raised); overflow-y: auto; }

.itsm-AppShell__navToggle { display: none; }

${mq.belowMd} {
  .itsm-AppShell__main { flex-direction: column; }
  .itsm-AppShell__nav { inline-size: 100%; border-inline-end: 0; border-block-end: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle); }
  .itsm-AppShell__nav[data-open="false"] { display: none; }
  .itsm-AppShell__aside { inline-size: 100%; border-inline-start: 0; }
  .itsm-AppShell__navToggle { display: inline-flex; }
  .itsm-AppShell__content { padding: var(--itsm-space-md); }
}
`,
);
