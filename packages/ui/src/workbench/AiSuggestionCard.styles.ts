import { css, layer, mq } from '../styles/css.js';

/**
 * `AiSuggestionCard`. The `itsm-AiSuggestion__*` names are pinned by its tests.
 *
 * A card in the resting elevation, marked as the AI's by a sparkle in an
 * indigo tile (the info hue — never the accent blue, which means "you can
 * press this") and by its name. The answer reads in `body`; the reason sits
 * under it in secondary text, not italic; the evidence is a short list of
 * things to open — title as a link, kind and reference as a quiet meta line —
 * under a hairline. "Nothing to go on" is a tinted warning well, because it is
 * the most important thing the card can say. The actions sit at the end; once
 * an outcome is recorded they give way to it, with its icon.
 */
export const aiSuggestionCardStyles = layer(
  'components',
  css`
.itsm-AiSuggestion {
  container: itsm-suggestion / inline-size;
  display: flex;
  flex-direction: column;
  gap: var(--itsm-space-sm);
  padding: var(--itsm-space-md);
  border-radius: var(--itsm-radius-xl);
  background: var(--itsm-colour-surface-raised);
  box-shadow: var(--itsm-elevation-xs), var(--itsm-edge-highlight);
  color: var(--itsm-colour-text-primary);
}

.itsm-AiSuggestion__head {
  display: flex;
  align-items: center;
  gap: var(--itsm-space-xs);
  min-inline-size: 0;
}

.itsm-AiSuggestion__mark {
  display: inline-grid;
  flex: none;
  place-items: center;
  inline-size: var(--itsm-control-height-sm);
  block-size: var(--itsm-control-height-sm);
  border-radius: var(--itsm-radius-md);
  background: var(--itsm-colour-info-subtle);
  color: var(--itsm-colour-info-subtleText);
}

.itsm-AiSuggestion__title {
  flex: 1 1 auto;
  min-inline-size: 0;
  margin: 0;
  font-size: var(--itsm-text-body-size);
  line-height: var(--itsm-text-body-line);
  font-weight: var(--itsm-font-weight-semibold);
  letter-spacing: var(--itsm-text-body-tracking);
}

.itsm-AiSuggestion__confidence {
  flex: none;
}

.itsm-AiSuggestion__body {
  font-size: var(--itsm-text-body-size);
  line-height: var(--itsm-text-body-line);
  letter-spacing: var(--itsm-text-body-tracking);
  overflow-wrap: anywhere;
}

.itsm-AiSuggestion__body > * {
  margin-block: 0 var(--itsm-space-xs);
}

.itsm-AiSuggestion__body > :last-child {
  margin-block-end: 0;
}

.itsm-AiSuggestion__reason {
  margin: 0;
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
  color: var(--itsm-colour-text-secondary);
}

.itsm-AiSuggestion__evidence {
  padding-block-start: var(--itsm-space-sm);
  border-block-start: var(--itsm-hairline) solid var(--itsm-colour-border-subtle);
}

.itsm-AiSuggestion__evidenceTitle {
  margin: 0 0 var(--itsm-space-xs);
  font-size: var(--itsm-text-subheadline-size);
  line-height: var(--itsm-text-subheadline-line);
  font-weight: var(--itsm-text-subheadline-weight);
  letter-spacing: var(--itsm-text-subheadline-tracking);
  color: var(--itsm-colour-text-secondary);
}

.itsm-AiSuggestion__evidenceList {
  display: grid;
  gap: var(--itsm-space-sm);
  margin: 0;
  padding: 0;
  list-style: none;
}

.itsm-AiSuggestion__evidenceItem {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  grid-template-areas:
    "icon link link"
    ". kind ref"
    ". extract extract";
  align-items: baseline;
  column-gap: var(--itsm-space-xs);
  row-gap: var(--itsm-space-3xs);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  letter-spacing: var(--itsm-text-callout-tracking);
}

.itsm-AiSuggestion__evidenceIcon {
  grid-area: icon;
  align-self: center;
  color: var(--itsm-colour-text-muted);
}

.itsm-AiSuggestion__evidenceLink {
  grid-area: link;
  min-inline-size: 0;
  overflow-wrap: anywhere;
}

a.itsm-AiSuggestion__evidenceLink {
  border-radius: var(--itsm-radius-xs);
  color: var(--itsm-colour-text-link);
  text-decoration: none;
}

@media (hover: hover) {
  a.itsm-AiSuggestion__evidenceLink:hover {
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
}

.itsm-AiSuggestion__evidenceKind,
.itsm-AiSuggestion__evidenceRef {
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  color: var(--itsm-colour-text-muted);
}

.itsm-AiSuggestion__evidenceKind {
  grid-area: kind;
}

.itsm-AiSuggestion__evidenceRef {
  grid-area: ref;
  font-variant-numeric: tabular-nums slashed-zero;
  white-space: nowrap;
}

.itsm-AiSuggestion__evidenceExtract {
  grid-area: extract;
  margin: 0;
  font-size: var(--itsm-text-footnote-size);
  line-height: var(--itsm-text-footnote-line);
  color: var(--itsm-colour-text-secondary);
}

.itsm-AiSuggestion__noEvidence {
  display: flex;
  align-items: flex-start;
  gap: var(--itsm-space-xs);
  margin: 0;
  padding: var(--itsm-space-xs) var(--itsm-space-sm);
  border-radius: var(--itsm-radius-lg);
  background: var(--itsm-colour-warning-subtle);
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  color: var(--itsm-colour-text-primary);
}

.itsm-AiSuggestion__noEvidenceIcon {
  flex: none;
  margin-block-start: var(--itsm-space-3xs);
  color: var(--itsm-colour-warning-subtleText);
}

.itsm-AiSuggestion__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--itsm-space-xs);
  padding-block-start: var(--itsm-space-2xs);
}

.itsm-AiSuggestion__outcome {
  display: inline-flex;
  align-items: center;
  gap: var(--itsm-space-2xs);
  margin: 0;
  font-size: var(--itsm-text-callout-size);
  line-height: var(--itsm-text-callout-line);
  color: var(--itsm-colour-text-secondary);
}

.itsm-AiSuggestion__outcomeIcon {
  flex: none;
  color: var(--itsm-colour-text-muted);
}

.itsm-AiSuggestion__outcome[data-outcome="accepted"] .itsm-AiSuggestion__outcomeIcon,
.itsm-AiSuggestion__outcome[data-outcome="edited"] .itsm-AiSuggestion__outcomeIcon {
  color: var(--itsm-colour-success-subtleText);
}

@container itsm-suggestion (max-width: 20rem) {
  .itsm-AiSuggestion__head {
    flex-wrap: wrap;
  }
  .itsm-AiSuggestion__actions > * {
    flex: 1 1 auto;
  }
}

${mq.forcedColors} {
  .itsm-AiSuggestion {
    border: var(--itsm-hairline) solid CanvasText;
  }
  .itsm-AiSuggestion__noEvidence {
    border: var(--itsm-hairline) solid CanvasText;
  }
}
`,
);
