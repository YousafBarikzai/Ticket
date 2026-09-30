/**
 * `@itsm/ui/format` — `Intl` formatting for dates, durations and counts, and
 * `RelativeTime`.
 *
 * The helpers are server-safe; `RelativeTime` is a client component (it ticks),
 * which a server component may still render with its serialisable props.
 */
export {
  formatBadgeCount,
  formatBytes,
  formatCompact,
  formatCount,
  formatDateTime,
  formatList,
  formatNumber,
  formatPercent,
  formatRelative,
  type DateInput,
  type DateTimeStyle,
  type FormatDateTimeOptions,
  type FormatListOptions,
  type FormatNumberOptions,
  type FormatRelativeOptions,
} from './format.js';
export {
  formatDuration,
  parseDuration,
  type DurationUnit,
  type FormatDurationOptions,
  type ParseDurationOptions,
} from './duration.js';
export { RelativeTime, type RelativeTimeProps } from './RelativeTime.js';
