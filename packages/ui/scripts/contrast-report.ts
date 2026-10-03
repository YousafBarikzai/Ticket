/**
 * `pnpm --filter @itsm/ui contrast:report`: the contrast audit, printed.
 *
 * The unit tests enforce the audit; this is what a person reads before they
 * change a colour, and what CI writes to the job summary when
 * `$GITHUB_STEP_SUMMARY` is set: per theme, the pairs each contract checks,
 * any failures, the tightest passes of each kind and the surface separations
 * (`src/tokens/report.ts`). It exits non-zero only if a pair fails, which the
 * unit tests would already have caught.
 */
import { appendFileSync } from 'node:fs';
import { contrastReport } from '../src/tokens/report.js';

const report = contrastReport();
process.stdout.write(report.text);

const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) appendFileSync(summary, report.markdown);

if (report.failures > 0) process.exitCode = 1;
