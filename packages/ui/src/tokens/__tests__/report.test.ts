import { describe, expect, it } from 'vitest';
import { contrastReport } from '../report.js';
import { themeNames } from '../tokens.js';

/**
 * `contrast:report` (SPEC-v3 §2.10): the audit printed for a person and for a
 * CI job summary. The audit itself is enforced by the contract tests; these
 * check the report says what the audit found.
 */
describe('the contrast report', () => {
  const report = contrastReport();

  it('counts every pair of every contract in every theme', () => {
    expect(report.pairs).toBe(1316);
    expect(report.failures).toBe(0);
    expect(report.text.split('\n')[0]).toBe('Contrast audit: 1316 pairs in 4 themes, 0 failing');
  });

  it('gives each theme its counts, its tightest passes and its surface separations', () => {
    for (const theme of themeNames) {
      expect(report.text).toContain(`${theme} (329 pairs)`);
    }
    expect(report.text).toContain('core 182 · hero 96 · avatar 8 · chart 33 · material 10');
    expect(report.text).toContain('tightest body: text.link on intent.danger.subtle 4.65 (≥ 4.5)');
    expect(report.text).toContain('separation: canvas / raised 1.07');
  });

  it('writes a Markdown summary with a row per theme', () => {
    expect(report.markdown.startsWith('## Contrast audit\n')).toBe(true);
    expect(report.markdown).toContain('| `apple` | 182 | 96 | 8 | 33 | 10 | 0 | 1.07 | 1.11 |');
    for (const theme of themeNames) expect(report.markdown).toContain(`### \`${theme}\`: tightest passes`);
    expect(report.markdown).not.toContain('**Failing**');
  });
});
