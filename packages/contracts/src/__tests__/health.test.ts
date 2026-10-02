import { describe, expect, it } from 'vitest';
import {
  HEALTH_VERDICTS,
  HEALTH_VERDICT_LABELS,
  HEALTH_VERDICT_LOOK,
  compareHealthVerdicts,
  healthVerdictForTone,
  healthVerdictLabel,
  isHealthVerdict,
  worstHealthVerdict,
} from '../health.js';
import type { HealthVerdict } from '../health.js';

describe('health verdicts', () => {
  it('has one vocabulary: On track, At risk, Off track', () => {
    expect(HEALTH_VERDICTS).toEqual(['on_track', 'at_risk', 'off_track']);
    expect(HEALTH_VERDICT_LABELS).toEqual({ on_track: 'On track', at_risk: 'At risk', off_track: 'Off track' });
    for (const verdict of HEALTH_VERDICTS) expect(healthVerdictLabel(verdict)).toBe(HEALTH_VERDICT_LABELS[verdict]);
  });

  it('never uses the words the designs had drifted into', () => {
    const labels = Object.values(HEALTH_VERDICT_LABELS).join(' ');
    for (const word of ['Breaching', 'Breached', 'Healthy', 'Degraded']) expect(labels).not.toContain(word);
  });

  it('pairs each verdict with its tone and glyph', () => {
    expect(HEALTH_VERDICT_LOOK).toEqual({
      on_track: { label: 'On track', tone: 'success', icon: 'circle-check' },
      at_risk: { label: 'At risk', tone: 'warning', icon: 'triangle-alert' },
      off_track: { label: 'Off track', tone: 'danger', icon: 'circle-x' },
    });
    expect(Object.isFrozen(HEALTH_VERDICT_LOOK.on_track)).toBe(true);
  });

  it('maps a dimension tone to its verdict and back', () => {
    for (const verdict of HEALTH_VERDICTS) {
      expect(healthVerdictForTone(HEALTH_VERDICT_LOOK[verdict].tone)).toBe(verdict);
    }
  });

  it('recognises only the three verdicts', () => {
    for (const verdict of HEALTH_VERDICTS) expect(isHealthVerdict(verdict)).toBe(true);
    for (const junk of ['On track', 'healthy', 'breached', '', null, undefined, 1, 'toString']) {
      expect(isHealthVerdict(junk)).toBe(false);
    }
  });

  it('judges a hero by its worst shown dimension', () => {
    expect(worstHealthVerdict(['on_track', 'at_risk', 'on_track'])).toBe('at_risk');
    expect(worstHealthVerdict(['at_risk', 'off_track', 'on_track'])).toBe('off_track');
    expect(worstHealthVerdict(['on_track'])).toBe('on_track');
    expect(worstHealthVerdict([null, 'on_track', undefined])).toBe('on_track');
    expect(worstHealthVerdict(new Set<HealthVerdict>(['at_risk']))).toBe('at_risk');
  });

  it('gives no verdict when no dimension is shown', () => {
    expect(worstHealthVerdict([])).toBeNull();
    expect(worstHealthVerdict([null, undefined])).toBeNull();
  });

  it('sorts best first', () => {
    const sorted = (['off_track', 'on_track', 'at_risk'] as HealthVerdict[]).sort(compareHealthVerdicts);
    expect(sorted).toEqual(['on_track', 'at_risk', 'off_track']);
  });
});
