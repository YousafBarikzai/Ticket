import { css, layer } from '../styles/css.js';

/**
 * `Metric` and `MetricGrid` (deprecated wrappers). They render a `StatCard`
 * and a `StatGrid`, whose style modules draw them; nothing here is specific
 * to the old names, so the module stays empty until Stage 5 removes it.
 */
export const metricStyles = layer('components', css``);
