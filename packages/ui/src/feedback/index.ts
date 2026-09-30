/**
 * Feedback and states: notices, problems, status screens, progress and
 * placeholders, and the connection indicator. Part of the root entry.
 *
 * `EmptyState`, `Skeleton` and `SkeletonText` live in `web/`, where the
 * applications import them from today.
 *
 * Beyond the SPEC §4.5 components, this folder exports the pieces other
 * design-system groups build on — the line illustrations, the problem copy
 * (so a card, a table and a toast describe the same failure the same way)
 * and the connection summary. They are not re-exported from the root entry.
 */
export { Banner, type BannerProps } from './Banner.js';
export {
  ConnectionStatus,
  summariseConnection,
  type ConnectionAttentionItem,
  type ConnectionStatusProps,
} from './ConnectionStatus.js';
export { GlobalBanner, type GlobalBannerProps } from './GlobalBanner.js';
export { illustrationNames, StateIllustration, type IllustrationTone, type StateIllustrationProps } from './Illustration.js';
export { InlineAlert, type InlineAlertProps } from './InlineAlert.js';
export { Meter, meterLevel, type MeterLevel, type MeterProps } from './Meter.js';
export {
  describeProblem,
  formatWait,
  isRetryableStatus,
  permissionKeyFrom,
  waitSentence,
  type ProblemDescription,
  type ProblemKind,
  type ProblemRemedy,
} from './problem.js';
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
export { isDismissalKey } from './dismissal.js';
