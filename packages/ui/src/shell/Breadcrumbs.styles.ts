import { css, layer, mq } from '../styles/css.js';

/**
 * `Breadcrumbs`: `subheadline` in `text.secondary`, the page itself in
 * `text.primary`; chevrons in `text.muted`, drawn, not spoken. Each crumb
 * truncates rather than wrapping the trail onto a second line.
 *
 * A container: under 480 px of its own width a long trail folds its middle
 * into "…". On a phone the whole trail is replaced by "‹ Parent" in the link
 * colour, the way back iOS offers.
 */
export const breadcrumbsStyles = layer(
  'components',
  css`
.itsm-Breadcrumbs {
  container-type: inline-size;
  min-inline-size: 0;
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
}
.itsm-Breadcrumbs__list {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  min-inline-size: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}
.itsm-Breadcrumbs__item {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  min-inline-size: 0;
}
.itsm-Breadcrumbs__item:last-child {
  flex: 0 1 auto;
}
.itsm-Breadcrumbs__link,
.itsm-Breadcrumbs__current {
  max-inline-size: 16rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.itsm-Breadcrumbs__link {
  border-radius: var(--itsm-radius-xs);
  color: var(--itsm-colour-text-secondary);
  text-decoration: none;
  transition: color var(--itsm-duration-fast) var(--itsm-easing-standard);
}
.itsm-Breadcrumbs__link:hover {
  color: var(--itsm-colour-text-primary);
  text-decoration: underline;
  text-underline-offset: 0.2em;
}
.itsm-Breadcrumbs__current {
  color: var(--itsm-colour-text-primary);
  font-weight: var(--itsm-font-weight-medium);
}
.itsm-Breadcrumbs__separator {
  flex: none;
  color: var(--itsm-colour-text-muted);
}

.itsm-Breadcrumbs__more {
  display: none;
  align-items: center;
  gap: var(--itsm-space-2xs);
}
.itsm-Breadcrumbs__moreButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: var(--itsm-control-height-sm);
  block-size: var(--itsm-space-ml);
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: var(--itsm-radius-sm);
  background: var(--itsm-colour-fill-secondary);
  color: var(--itsm-colour-text-secondary);
  cursor: pointer;
}
.itsm-Breadcrumbs__moreButton:hover {
  color: var(--itsm-colour-text-primary);
}

@container (max-width: 30rem) {
  .itsm-Breadcrumbs[data-foldable] .itsm-Breadcrumbs__item[data-fold] {
    display: none;
  }
  .itsm-Breadcrumbs[data-foldable] .itsm-Breadcrumbs__more {
    display: inline-flex;
  }
}

.itsm-Breadcrumbs__parent {
  display: none;
  align-items: center;
  gap: var(--itsm-space-3xs);
  max-inline-size: 100%;
  color: var(--itsm-colour-text-link);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  font-weight: var(--itsm-font-weight-medium);
  text-decoration: none;
}
.itsm-Breadcrumbs__parent > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

${mq.belowMd} {
  .itsm-Breadcrumbs:has(.itsm-Breadcrumbs__parent) .itsm-Breadcrumbs__list {
    display: none;
  }
  .itsm-Breadcrumbs__parent {
    display: inline-flex;
  }
}
`,
);
