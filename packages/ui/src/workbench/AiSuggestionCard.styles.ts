import { css, layer } from '../styles/css.js';

/**
 * `AiSuggestionCard`. The `itsm-AiSuggestion__*` names are pinned by its tests.
 */
export const aiSuggestionCardStyles = layer(
  'components',
  css`
.itsm-AiSuggestion {
  display: block;
  background: var(--itsm-colour-surface-raised);
  border: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle);
  border-inline-start: var(--itsm-border-thick) solid var(--itsm-colour-info-border);
  border-radius: var(--itsm-radius-lg);
  padding: var(--itsm-space-md);
  color: var(--itsm-colour-text-primary);
}
.itsm-AiSuggestion__head { display: flex; align-items: center; justify-content: space-between; gap: var(--itsm-space-sm); }
.itsm-AiSuggestion__title { margin: 0; font-size: var(--itsm-font-size-md); font-weight: var(--itsm-font-weight-semibold); }
.itsm-AiSuggestion__body { margin-block: var(--itsm-space-sm); }
.itsm-AiSuggestion__reason { margin: 0; font-size: var(--itsm-font-size-sm); color: var(--itsm-colour-text-muted); font-style: italic; }
.itsm-AiSuggestion__evidence { margin-block-start: var(--itsm-space-md); border-block-start: var(--itsm-border-hair) solid var(--itsm-colour-border-subtle); padding-block-start: var(--itsm-space-sm); }
.itsm-AiSuggestion__evidenceTitle { margin: 0 0 var(--itsm-space-xs); font-size: var(--itsm-font-size-sm); font-weight: var(--itsm-font-weight-semibold); color: var(--itsm-colour-text-secondary); }
.itsm-AiSuggestion__evidenceList { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--itsm-space-xs); }
.itsm-AiSuggestion__evidenceItem { font-size: var(--itsm-font-size-sm); display: grid; grid-template-columns: auto 1fr auto; gap: var(--itsm-space-xs); align-items: baseline; }
.itsm-AiSuggestion__evidenceKind { color: var(--itsm-colour-text-muted); font-size: var(--itsm-font-size-xs); text-transform: uppercase; letter-spacing: 0.04em; }
.itsm-AiSuggestion__evidenceRef { color: var(--itsm-colour-text-muted); font-variant-numeric: tabular-nums; }
.itsm-AiSuggestion__evidenceExtract { grid-column: 1 / -1; margin: 0; color: var(--itsm-colour-text-muted); }
.itsm-AiSuggestion__noEvidence { margin: 0; font-size: var(--itsm-font-size-sm); color: var(--itsm-colour-warning-subtleText); }
.itsm-AiSuggestion__actions { display: flex; gap: var(--itsm-space-xs); margin-block-start: var(--itsm-space-md); }
.itsm-AiSuggestion__outcome { margin: var(--itsm-space-md) 0 0; font-size: var(--itsm-font-size-sm); color: var(--itsm-colour-text-muted); }
`,
);
