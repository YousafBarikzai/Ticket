/**
 * Feedback and states: notices, problems, status screens, progress and
 * placeholders, and the connection indicator. Part of the root entry.
 *
 * `EmptyState`, `Skeleton` and `SkeletonText` live in `web/`, where the
 * applications import them from today.
 */
export { Banner, type BannerProps } from './Banner.js';
export { ConnectionStatus, type ConnectionAttentionItem, type ConnectionStatusProps } from './ConnectionStatus.js';
export { GlobalBanner, type GlobalBannerProps } from './GlobalBanner.js';
export { InlineAlert, type InlineAlertProps } from './InlineAlert.js';
export { Meter, type MeterProps } from './Meter.js';
export { ProblemState, type ProblemStateProps } from './ProblemState.js';
export { ProgressBar, type ProgressBarProps } from './ProgressBar.js';
export {
  SkeletonAvatar,
  SkeletonCard,
  SkeletonConversation,
  SkeletonList,
  SkeletonPage,
  SkeletonStat,
  SkeletonTable,
  type SkeletonAvatarProps,
  type SkeletonCardProps,
  type SkeletonConversationProps,
  type SkeletonListProps,
  type SkeletonPageProps,
  type SkeletonPageVariant,
  type SkeletonStatProps,
  type SkeletonTableProps,
} from './Skeletons.js';
export { Spinner, type SpinnerProps } from './Spinner.js';
export { StatusScreen, type StatusScreenProps } from './StatusScreen.js';
