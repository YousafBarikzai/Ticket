/**
 * `@itsm/ui` — the design system's root entry (ADR-0005, MOD-16-E1).
 *
 * Curated rather than `export *`, because what the root carries is what every
 * page that imports a button pays for. It holds the everyday components — the
 * actions, inputs, feedback and display pieces a server-rendered page reaches
 * for — and none of the heavy ones. Overlays, data tables, charts and the
 * application frame have their own subpaths (`@itsm/ui/overlays`, `/data`,
 * `/charts`, `/shell`), and so do the tokens, the stylesheet, the theme and
 * the accessibility primitives. Three rules hold here:
 *
 *   1. Nothing exported from this file may import Radix, TanStack or sonner.
 *      A root component that needs an overlay loads it lazily, on intent.
 *   2. It does not re-export `@itsm/contracts`. That package is the whole API
 *      contract with its zod schemas; a portal page that wanted a `Badge` used
 *      to download all of it. Form types come from `@itsm/ui/forms` or
 *      `@itsm/contracts/forms`.
 *   3. Everything an application imports from the root today stays importable
 *      until no application does — the deprecated block at the end.
 *
 * The package is `"sideEffects": false`, which lets a bundler drop what a page
 * does not use. Next does that for an import from a *server* component only
 * when the app lists `@itsm/ui` in `experimental.optimizePackageImports`:
 * without it, the pass that collects client references takes every
 * `'use client'` module this file re-exports, and every route ships all of
 * them. The stylesheet has its own server-safe subpath for the same reason.
 */

/* ---------------------------------------------------------------- Foundations */
export { cx, type ClassValue } from './web/cx.js';
export { VisuallyHidden, type VisuallyHiddenProps } from './web/VisuallyHidden.js';
export type { IntentName, ThemeName } from './tokens/tokens.js';
// The shared, serialisable vocabulary of the component signatures (SPEC §4.0).
// `ButtonVariant` is exported with `Button` below.
export type {
  ActionSpec,
  ConfirmSpec,
  Crumb,
  EmptySpec,
  IconName,
  Illustration,
  LinkComponent,
  Plural,
  Problem,
  Size,
  Tone,
} from './types.js';

/* ------------------------------------------------------------ Provider, hooks */
export {
  ItsmProvider,
  defaultMessages,
  // For sign-out: `clearLocalData({ alsoKeys: isRecentsKey })` forgets a person's recents and pins.
  isRecentsKey,
  notify,
  useItsm,
  useNow,
  usePins,
  useRecents,
  useRecordRecent,
  useRegisterCommands,
  useUrlState,
  type CommandProvider,
  type ItsmContextValue,
  type ItsmFeatures,
  type ItsmProviderProps,
  type ItsmRouter,
  type Notify,
  type NotifyOptions,
  type NotifyProgress,
  type NotifyPromiseMessages,
  type NotifyTone,
  type Pins,
  type RecentItem,
  type UiMessages,
  type UrlCodec,
  type UrlStateOptions,
  type UrlStateSetter,
} from './provider/index.js';
export { announce, type AnnounceOptions, type Politeness } from './a11y/announcer.js';
export { useHotkey, type HotkeyContext, type HotkeyOptions } from './a11y/hotkeys.js';
export {
  useCollectionKeyboard,
  type ActivateHow,
  type CollectionKeyboard,
  type CollectionKeyboardOptions,
} from './a11y/collection-keyboard.js';
export { Region, useRegions, type RegionProps, type Regions } from './a11y/regions.js';
export { useLiveAnnouncer, type LiveAnnouncerOptions } from './a11y/live.js';

/* ---------------------------------------------------------------------- Icons */
export { BrandMark, Icon, type BrandMarkProps, type IconProps } from './icons/index.js';

/* -------------------------------------------------------------------- Actions */
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './web/Button.js';
export { IconButton, type IconButtonProps } from './web/IconButton.js';
export { InfoTipTrigger, type InfoTipContent, type InfoTipTriggerProps } from './web/InfoTipTrigger.js';
export { Kbd, type KbdProps } from './web/Kbd.js';

/* --------------------------------------------------------------------- Inputs */
export { Input, type InputProps } from './web/Input.js';
export { Textarea, type TextareaProps } from './web/Textarea.js';
export { Select, type SelectOption, type SelectOptionGroup, type SelectProps } from './web/Select.js';
export { Checkbox, type CheckboxProps } from './web/Checkbox.js';
export { RadioGroup, type RadioGroupProps, type RadioOption } from './web/RadioGroup.js';
export { Switch, type SwitchConfirm, type SwitchProps } from './web/Switch.js';
export { Tabs, type TabItem, type TabsProps } from './web/Tabs.js';
export {
  CheckboxGroup,
  DurationField,
  FilterPills,
  NumberField,
  SearchField,
  SegmentedControl,
  TimeField,
  type CheckboxGroupOption,
  type CheckboxGroupProps,
  type DurationFieldProps,
  type FilterPillOption,
  type FilterPillsProps,
  type NumberFieldProps,
  type SearchFieldProps,
  type SegmentedControlProps,
  type SegmentedOption,
  type TimeFieldProps,
} from './controls/index.js';

/* ------------------------------------------------------------------- Form kit */
// The field context, for an application control that should label and
// describe itself from the `FormField` around it the way the built-in ones do.
export {
  CharacterCount,
  FormField,
  mergeFieldProps,
  useFieldControl,
  type CharacterCountProps,
  type FieldControlProps,
  type FormFieldProps,
} from './web/FormField.js';
export {
  DraftNotice,
  DraftStatus,
  Form,
  FormActions,
  FormErrorSummary,
  FormSection,
  InlineEdit,
  focusField,
  useDraft,
  useFormState,
  type DraftController,
  type DraftNoticeProps,
  type DraftStatusProps,
  type FormActionsProps,
  type FormAutosave,
  type FormErrorSummaryError,
  type FormErrorSummaryProps,
  type FormProps,
  type FormSectionProps,
  type FormState,
  type FormSubmitResult,
  type InlineEditOption,
  type InlineEditProps,
  type InlineEditResult,
  type UseDraftOptions,
} from './formkit/index.js';

/* ------------------------------------------------------------------- Feedback */
export { EmptyState, type EmptyStateProps } from './web/EmptyState.js';
export { Skeleton, SkeletonText, type SkeletonProps, type SkeletonTextProps } from './web/Skeleton.js';
// Each from its own module, not through `./feedback/index.js`: Next's barrel
// optimisation (`optimizePackageImports`) follows one level of re-export, so a
// server component importing `StatusScreen` through the feedback barrel made
// every client component that barrel re-exports — the connection pill, the
// global banner — part of the route's first load.
export { AutoSubmitForm, type AutoSubmitFormProps } from './feedback/AutoSubmitForm.js';
export { Banner, type BannerProps } from './feedback/Banner.js';
export { ConnectionStatus, type ConnectionAttentionItem, type ConnectionStatusProps } from './feedback/ConnectionStatus.js';
export { GlobalBanner, type GlobalBannerProps } from './feedback/GlobalBanner.js';
export { InlineAlert, type InlineAlertProps } from './feedback/InlineAlert.js';
export { Meter, type MeterProps } from './feedback/Meter.js';
export { ProblemState, type ProblemStateProps } from './feedback/ProblemState.js';
export { ProgressBar, type ProgressBarProps } from './feedback/ProgressBar.js';
export {
  SkeletonAvatar,
  SkeletonCard,
  SkeletonChartCard,
  SkeletonConversation,
  SkeletonList,
  SkeletonPage,
  SkeletonStat,
  SkeletonTable,
  type SkeletonAvatarProps,
  type SkeletonCardProps,
  type SkeletonChartCardProps,
  type SkeletonConversationProps,
  type SkeletonListProps,
  type SkeletonPageProps,
  type SkeletonPageVariant,
  type SkeletonStatProps,
  type SkeletonTableProps,
} from './feedback/Skeletons.js';
export { Spinner, type SpinnerProps } from './feedback/Spinner.js';
export { StatusScreen, type StatusScreenProps } from './feedback/StatusScreen.js';
// The one mapping from an API problem to words, for a toast or an inline
// message that should say what `ProblemState` would.
export { describeProblem, type ProblemDescription } from './feedback/problem.js';
// For sign-out: `clearLocalData({ alsoKeys })` forgets the notices a person dismissed on this device.
export { isDismissalKey } from './feedback/dismissal.js';

/* -------------------------------------------------------------------- Display */
export { Badge, type BadgeProps } from './web/Badge.js';
export { Avatar, initials, type AvatarKind, type AvatarProps, type AvatarSize, type PresenceStatus } from './web/Avatar.js';
export { Card, type CardProps } from './web/Card.js';
export { Tile, TileGrid, type TileGridProps, type TileProps } from './web/Tile.js';
export {
  Table,
  // The name the redesign's catalogue uses for it, beside `DataTable`. Same component.
  Table as StaticTable,
  type SortDirection,
  type TableColumn,
  type TableProps,
  type TableRowHandles,
  type TableSort,
} from './web/Table.js';
export { RichText, asRichBlocks, type RichTextProps } from './web/RichText.js';
export {
  Timeline,
  relativeTime,
  type TimelineActor,
  type TimelineEvent,
  type TimelineFilter,
  type TimelineKind,
  type TimelineProps,
} from './web/Timeline.js';
export { RelativeTime, type RelativeTimeProps } from './format/RelativeTime.js';
export {
  ActivityFeed,
  APPROVAL_STATE_LOOK,
  approvalStateLook,
  AttentionList,
  AttentionRowActions,
  AvatarStack,
  // A ticket channel as a glyph and a word ("email" → Email, mail), for charts and lists that name channels.
  channelInfo,
  COMPONENT_STATE_LOOK,
  Count,
  DashboardGrid,
  DeltaPill,
  DescriptionList,
  Disclosure,
  FileChip,
  GridItem,
  HeroCard,
  HeroWhy,
  IconTile,
  isDisclosureKey,
  KanbanCard,
  KanbanColumn,
  MAJOR_INCIDENT_LOOK,
  PRIORITY_LOOK,
  PriorityChip,
  priorityLook,
  PROBLEM_STATE_LOOK,
  Prose,
  SectionHeader,
  SignalBars,
  SLA_STATE_LOOK,
  STATUS_CATEGORY_LOOK,
  StatusPill,
  Stepper,
  Surface,
  TICKET_STATE_LOOK,
  ticketStateLook,
  ticketTypeLook,
  TYPE_LOOK,
  type ActivityActor,
  type ActivityFeedProps,
  type ActivityItem,
  type ApprovalStateKey,
  type AttentionItem,
  type AttentionListProps,
  type AttentionRowActionsProps,
  type AttentionSeverity,
  type AttentionTab,
  type AvatarStackPerson,
  type AvatarStackProps,
  type ChannelInfo,
  type ComponentStateKey,
  type CountProps,
  type DashboardGridProps,
  type DeltaPillProps,
  type DescriptionItem,
  type DescriptionListProps,
  type DisclosureProps,
  type FileChipProps,
  type FileChipState,
  type GridItemProps,
  type GridSpan,
  type HeroAside,
  type HeroCardProps,
  type HeroChip,
  type HeroDimension,
  type HeroProgress,
  type HeroTone,
  type HeroTrend,
  type HeroVerdict,
  type HeroWhyItem,
  type HeroWhyProps,
  type IconTileProps,
  type IconTileSize,
  type KanbanCardProps,
  type KanbanColumnProps,
  type KanbanDropState,
  type KanbanStripe,
  type PriorityChipProps,
  type PriorityKey,
  type PriorityLook,
  type ProblemStateKey,
  type ProseProps,
  type SectionHeaderProps,
  type SignalBarsProps,
  type SlaStateKey,
  type StateLook,
  type StatusCategoryKey,
  type StatusPillProps,
  type StepStatus,
  type StepperProps,
  type StepperStep,
  type SurfaceProps,
  type TicketStateKey,
  type TicketTypeKey,
} from './display/index.js';

/* ----------------------------------------------------------------- Deprecated
 *
 * Imported from the root by an application today, and moving to a subpath:
 * the theme to `@itsm/ui/theme`, the stylesheet to `@itsm/ui/styles`, the token
 * maps to `@itsm/ui/tokens`, the rest to the subpath named beside it. Removed
 * from here once nothing imports them from the root.
 */
export {
  ThemeProvider,
  useTheme,
  type ThemeContextValue,
  type ThemeProviderProps,
  type ThemeSetting,
} from './theme/ThemeProvider.js';
export { uiStylesheet } from './styles/index.js';
export { structuralVariables, themeVariables } from './tokens/css.js';
// Moving to `@itsm/ui/charts`.
export { Metric, MetricGrid, type MetricProps } from './web/Metric.js';
// Moving to `@itsm/ui/data`.
export { InteractiveTable, type InteractiveTableProps } from './web/InteractiveTable.js';
// Moving to `@itsm/ui/shell`.
export { AppShell, type AppShellNavItem, type AppShellProps } from './web/AppShell.js';
export { CommandPalette, rankCommands, type CommandItem, type CommandPaletteProps } from './web/CommandPalette.js';
// Moving to `@itsm/ui/forms`.
export { FormRenderer, type FormRendererProps, type UserOption } from './forms/FormRenderer.js';
// Moving to `@itsm/ui/workbench`.
export { SlaClock, describeRemaining, type SlaClockProps, type SlaState } from './workbench/SlaClock.js';
export {
  AiSuggestionCard,
  type AiSuggestionCardProps,
  type ConfidenceBand,
  type SuggestionEvidence,
  type SuggestionOutcome,
} from './workbench/AiSuggestionCard.js';
