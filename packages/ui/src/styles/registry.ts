/**
 * Every style module, in the order the stylesheet emits them.
 *
 * Order still matters inside a layer. Two rules of equal specificity that set
 * the same property on the same element are settled by which comes later, so
 * the order here is the order the single stylesheet had before it was split,
 * and a module whose rules depend on another's (`Textarea` on the control box
 * in `Input`) comes after it. Layers settle everything across that line: the
 * reset and base modules could be listed anywhere and still lose to every
 * component, and `AppShell`, in the patterns layer, beats the components it is
 * built from wherever it sits.
 *
 * `module` is the file's path under `packages/ui/src`. `stylesheet-vars.test.ts`
 * compares these paths with the `*.styles.ts` files on disk, so a module that
 * exists but was never registered — its rules silently absent from every
 * app — fails a test instead of a person noticing.
 */
import { aiSuggestionCardStyles } from '../workbench/AiSuggestionCard.styles.js';
import { slaClockStyles } from '../workbench/SlaClock.styles.js';
import { formRendererStyles } from '../forms/FormRenderer.styles.js';
import { appShellStyles } from '../web/AppShell.styles.js';
import { avatarStyles } from '../web/Avatar.styles.js';
import { badgeStyles } from '../web/Badge.styles.js';
import { buttonStyles } from '../web/Button.styles.js';
import { cardStyles } from '../web/Card.styles.js';
import { checkboxStyles } from '../web/Checkbox.styles.js';
import { comboboxStyles } from '../web/Combobox.styles.js';
import { commandPaletteStyles } from '../web/CommandPalette.styles.js';
import { datePickerStyles } from '../web/DatePicker.styles.js';
import { dialogStyles } from '../web/Dialog.styles.js';
import { emptyStateStyles } from '../web/EmptyState.styles.js';
import { formFieldStyles } from '../web/FormField.styles.js';
import { iconButtonStyles } from '../web/IconButton.styles.js';
import { inputStyles } from '../web/Input.styles.js';
import { interactiveTableStyles } from '../web/InteractiveTable.styles.js';
import { metricStyles } from '../web/Metric.styles.js';
import { radioGroupStyles } from '../web/RadioGroup.styles.js';
import { richTextStyles } from '../web/RichText.styles.js';
import { selectStyles } from '../web/Select.styles.js';
import { skeletonStyles } from '../web/Skeleton.styles.js';
import { switchStyles } from '../web/Switch.styles.js';
import { tableStyles } from '../web/Table.styles.js';
import { tabsStyles } from '../web/Tabs.styles.js';
import { textareaStyles } from '../web/Textarea.styles.js';
import { tileStyles } from '../web/Tile.styles.js';
import { timelineStyles } from '../web/Timeline.styles.js';
import { toastStyles } from '../web/Toast.styles.js';
import { tooltipStyles } from '../web/Tooltip.styles.js';
import { areaChartStyles } from '../charts/AreaChart.styles.js';
import { barChartStyles } from '../charts/BarChart.styles.js';
import { chartFigureStyles } from '../charts/ChartFigure.styles.js';
import { donutChartStyles } from '../charts/DonutChart.styles.js';
import { lineChartStyles } from '../charts/LineChart.styles.js';
import { progressRingStyles } from '../charts/ProgressRing.styles.js';
import { sparklineStyles } from '../charts/Sparkline.styles.js';
import { statCardStyles } from '../charts/StatCard.styles.js';
import { statGridStyles } from '../charts/StatGrid.styles.js';
import { checkboxGroupStyles } from '../controls/CheckboxGroup.styles.js';
import { durationFieldStyles } from '../controls/DurationField.styles.js';
import { numberFieldStyles } from '../controls/NumberField.styles.js';
import { searchFieldStyles } from '../controls/SearchField.styles.js';
import { segmentedControlStyles } from '../controls/SegmentedControl.styles.js';
import { timeFieldStyles } from '../controls/TimeField.styles.js';
import { bulkActionBarStyles } from '../data/BulkActionBar.styles.js';
import { dataTableStyles } from '../data/DataTable.styles.js';
import { filterBarStyles } from '../data/FilterBar.styles.js';
import { filterChipStyles } from '../data/FilterChip.styles.js';
import { loadMoreStyles } from '../data/LoadMore.styles.js';
import { olderNewerStyles } from '../data/OlderNewer.styles.js';
import { viewMenuStyles } from '../data/ViewMenu.styles.js';
import { activityFeedStyles } from '../display/ActivityFeed.styles.js';
import { avatarStackStyles } from '../display/AvatarStack.styles.js';
import { descriptionListStyles } from '../display/DescriptionList.styles.js';
import { disclosureStyles } from '../display/Disclosure.styles.js';
import { fileChipStyles } from '../display/FileChip.styles.js';
import { proseStyles } from '../display/Prose.styles.js';
import { statusPillStyles } from '../display/StatusPill.styles.js';
import { stepperStyles } from '../display/Stepper.styles.js';
import { surfaceStyles } from '../display/Surface.styles.js';
import { bannerStyles } from '../feedback/Banner.styles.js';
import { connectionStatusStyles } from '../feedback/ConnectionStatus.styles.js';
import { globalBannerStyles } from '../feedback/GlobalBanner.styles.js';
import { inlineAlertStyles } from '../feedback/InlineAlert.styles.js';
import { meterStyles } from '../feedback/Meter.styles.js';
import { problemStateStyles } from '../feedback/ProblemState.styles.js';
import { progressBarStyles } from '../feedback/ProgressBar.styles.js';
import { skeletonsStyles } from '../feedback/Skeletons.styles.js';
import { spinnerStyles } from '../feedback/Spinner.styles.js';
import { illustrationStyles } from '../feedback/Illustration.styles.js';
import { statusScreenStyles } from '../feedback/StatusScreen.styles.js';
import { relativeTimeStyles } from '../format/RelativeTime.styles.js';
import { formStyles } from '../formkit/Form.styles.js';
import { formErrorSummaryStyles } from '../formkit/FormErrorSummary.styles.js';
import { formSectionStyles } from '../formkit/FormSection.styles.js';
import { inlineEditStyles } from '../formkit/InlineEdit.styles.js';
import { brandMarkStyles } from '../icons/BrandMark.styles.js';
import { iconStyles } from '../icons/Icon.styles.js';
import { confirmDialogStyles } from '../overlays/ConfirmDialog.styles.js';
import { conflictDialogStyles } from '../overlays/ConflictDialog.styles.js';
import { contextMenuStyles } from '../overlays/ContextMenu.styles.js';
import { dateRangePickerStyles } from '../overlays/DateRangePicker.styles.js';
import { menuStyles } from '../overlays/Menu.styles.js';
import { personPickerStyles } from '../overlays/PersonPicker.styles.js';
import { popoverStyles } from '../overlays/Popover.styles.js';
import { sheetStyles } from '../overlays/Sheet.styles.js';
import { splitButtonStyles } from '../overlays/SplitButton.styles.js';
import { toasterStyles } from '../overlays/Toaster.styles.js';
import { bottomDockStyles } from '../shell/BottomDock.styles.js';
import { breadcrumbsStyles } from '../shell/Breadcrumbs.styles.js';
import { hierNavStyles } from '../shell/HierNav.styles.js';
import { notificationCenterStyles } from '../shell/NotificationCenter.styles.js';
import { pageHeaderStyles } from '../shell/PageHeader.styles.js';
import { routeFocusStyles } from '../shell/RouteFocus.styles.js';
import { routeProgressStyles } from '../shell/RouteProgress.styles.js';
import { searchTriggerStyles } from '../shell/SearchTrigger.styles.js';
import { shortcutsDialogStyles } from '../shell/ShortcutsDialog.styles.js';
import { skipLinksStyles } from '../shell/SkipLinks.styles.js';
import { splitViewStyles } from '../shell/SplitView.styles.js';
import { tabBarStyles } from '../shell/TabBar.styles.js';
import { tabNavStyles } from '../shell/TabNav.styles.js';
import { topBarStyles } from '../shell/TopBar.styles.js';
import { userMenuStyles } from '../shell/UserMenu.styles.js';
import { kbdStyles } from '../web/Kbd.styles.js';
import { regionStyles } from '../a11y/Region.styles.js';
import { baseStyles } from './base.styles.js';
import { interactiveStyles } from './interactive.styles.js';
import { motionStyles } from './motion.styles.js';
import { resetStyles } from './reset.styles.js';
import { utilityStyles } from './utilities.styles.js';
import { vendorStyles } from './vendor.styles.js';

export interface RegisteredStyles {
  /** The module's path under `packages/ui/src`. */
  readonly module: string;
  /** Its rules, already wrapped in their layer; empty for a module with none yet. */
  readonly css: string;
}

export const styleRegistry: readonly RegisteredStyles[] = [
  { module: 'styles/reset.styles.ts', css: resetStyles },
  { module: 'styles/base.styles.ts', css: baseStyles },
  { module: 'styles/motion.styles.ts', css: motionStyles },

  // Components.
  { module: 'styles/interactive.styles.ts', css: interactiveStyles },

  // New primitives the components below are built from (an icon in a button,
  // a surface under a card), first so the components can adjust them at equal
  // specificity.
  { module: 'icons/Icon.styles.ts', css: iconStyles },
  { module: 'icons/BrandMark.styles.ts', css: brandMarkStyles },
  { module: 'web/Kbd.styles.ts', css: kbdStyles },
  { module: 'a11y/Region.styles.ts', css: regionStyles },
  { module: 'display/Surface.styles.ts', css: surfaceStyles },
  { module: 'feedback/Spinner.styles.ts', css: spinnerStyles },
  { module: 'feedback/Illustration.styles.ts', css: illustrationStyles },

  // The existing components, in the old stylesheet's order.
  { module: 'web/Tile.styles.ts', css: tileStyles },
  { module: 'web/Metric.styles.ts', css: metricStyles },
  { module: 'web/Button.styles.ts', css: buttonStyles },
  { module: 'web/IconButton.styles.ts', css: iconButtonStyles },
  { module: 'web/FormField.styles.ts', css: formFieldStyles },
  { module: 'forms/FormRenderer.styles.ts', css: formRendererStyles },
  { module: 'web/Input.styles.ts', css: inputStyles },
  { module: 'web/Textarea.styles.ts', css: textareaStyles },
  { module: 'web/Select.styles.ts', css: selectStyles },
  { module: 'web/Checkbox.styles.ts', css: checkboxStyles },
  { module: 'web/RadioGroup.styles.ts', css: radioGroupStyles },
  { module: 'web/Switch.styles.ts', css: switchStyles },
  { module: 'web/Combobox.styles.ts', css: comboboxStyles },
  { module: 'web/DatePicker.styles.ts', css: datePickerStyles },
  { module: 'web/Badge.styles.ts', css: badgeStyles },
  { module: 'web/Avatar.styles.ts', css: avatarStyles },
  { module: 'web/Card.styles.ts', css: cardStyles },
  { module: 'web/Table.styles.ts', css: tableStyles },
  { module: 'web/InteractiveTable.styles.ts', css: interactiveTableStyles },
  { module: 'web/Skeleton.styles.ts', css: skeletonStyles },
  { module: 'web/EmptyState.styles.ts', css: emptyStateStyles },
  { module: 'web/Tabs.styles.ts', css: tabsStyles },
  { module: 'web/Dialog.styles.ts', css: dialogStyles },
  { module: 'web/Toast.styles.ts', css: toastStyles },
  { module: 'web/Tooltip.styles.ts', css: tooltipStyles },
  { module: 'web/Timeline.styles.ts', css: timelineStyles },
  { module: 'web/CommandPalette.styles.ts', css: commandPaletteStyles },
  { module: 'web/RichText.styles.ts', css: richTextStyles },
  { module: 'workbench/AiSuggestionCard.styles.ts', css: aiSuggestionCardStyles },
  { module: 'workbench/SlaClock.styles.ts', css: slaClockStyles },

  // The new components, after the existing ones they are composed from, by
  // group: inputs, forms, feedback, display, overlays, data, charts, frame.
  { module: 'format/RelativeTime.styles.ts', css: relativeTimeStyles },
  { module: 'controls/SegmentedControl.styles.ts', css: segmentedControlStyles },
  { module: 'controls/SearchField.styles.ts', css: searchFieldStyles },
  { module: 'controls/NumberField.styles.ts', css: numberFieldStyles },
  { module: 'controls/DurationField.styles.ts', css: durationFieldStyles },
  { module: 'controls/TimeField.styles.ts', css: timeFieldStyles },
  { module: 'controls/CheckboxGroup.styles.ts', css: checkboxGroupStyles },
  { module: 'formkit/Form.styles.ts', css: formStyles },
  { module: 'formkit/FormSection.styles.ts', css: formSectionStyles },
  { module: 'formkit/FormErrorSummary.styles.ts', css: formErrorSummaryStyles },
  { module: 'formkit/InlineEdit.styles.ts', css: inlineEditStyles },
  { module: 'feedback/Banner.styles.ts', css: bannerStyles },
  { module: 'feedback/InlineAlert.styles.ts', css: inlineAlertStyles },
  { module: 'feedback/GlobalBanner.styles.ts', css: globalBannerStyles },
  { module: 'feedback/ProblemState.styles.ts', css: problemStateStyles },
  { module: 'feedback/StatusScreen.styles.ts', css: statusScreenStyles },
  { module: 'feedback/ProgressBar.styles.ts', css: progressBarStyles },
  { module: 'feedback/Meter.styles.ts', css: meterStyles },
  { module: 'feedback/ConnectionStatus.styles.ts', css: connectionStatusStyles },
  { module: 'feedback/Skeletons.styles.ts', css: skeletonsStyles },
  { module: 'display/StatusPill.styles.ts', css: statusPillStyles },
  { module: 'display/AvatarStack.styles.ts', css: avatarStackStyles },
  { module: 'display/DescriptionList.styles.ts', css: descriptionListStyles },
  { module: 'display/Disclosure.styles.ts', css: disclosureStyles },
  { module: 'display/Prose.styles.ts', css: proseStyles },
  { module: 'display/Stepper.styles.ts', css: stepperStyles },
  { module: 'display/FileChip.styles.ts', css: fileChipStyles },
  { module: 'display/ActivityFeed.styles.ts', css: activityFeedStyles },
  { module: 'overlays/Menu.styles.ts', css: menuStyles },
  { module: 'overlays/ContextMenu.styles.ts', css: contextMenuStyles },
  { module: 'overlays/Popover.styles.ts', css: popoverStyles },
  { module: 'overlays/Sheet.styles.ts', css: sheetStyles },
  { module: 'overlays/ConfirmDialog.styles.ts', css: confirmDialogStyles },
  { module: 'overlays/ConflictDialog.styles.ts', css: conflictDialogStyles },
  { module: 'overlays/Toaster.styles.ts', css: toasterStyles },
  { module: 'overlays/PersonPicker.styles.ts', css: personPickerStyles },
  { module: 'overlays/DateRangePicker.styles.ts', css: dateRangePickerStyles },
  { module: 'overlays/SplitButton.styles.ts', css: splitButtonStyles },
  { module: 'data/FilterChip.styles.ts', css: filterChipStyles },
  { module: 'data/BulkActionBar.styles.ts', css: bulkActionBarStyles },
  { module: 'data/LoadMore.styles.ts', css: loadMoreStyles },
  { module: 'data/OlderNewer.styles.ts', css: olderNewerStyles },
  { module: 'data/ViewMenu.styles.ts', css: viewMenuStyles },
  { module: 'charts/StatCard.styles.ts', css: statCardStyles },
  { module: 'charts/StatGrid.styles.ts', css: statGridStyles },
  { module: 'charts/Sparkline.styles.ts', css: sparklineStyles },
  { module: 'charts/LineChart.styles.ts', css: lineChartStyles },
  { module: 'charts/AreaChart.styles.ts', css: areaChartStyles },
  { module: 'charts/BarChart.styles.ts', css: barChartStyles },
  { module: 'charts/DonutChart.styles.ts', css: donutChartStyles },
  { module: 'charts/ProgressRing.styles.ts', css: progressRingStyles },
  { module: 'charts/ChartFigure.styles.ts', css: chartFigureStyles },
  { module: 'shell/TopBar.styles.ts', css: topBarStyles },
  { module: 'shell/TabBar.styles.ts', css: tabBarStyles },
  { module: 'shell/BottomDock.styles.ts', css: bottomDockStyles },
  { module: 'shell/SplitView.styles.ts', css: splitViewStyles },
  { module: 'shell/SearchTrigger.styles.ts', css: searchTriggerStyles },
  { module: 'shell/UserMenu.styles.ts', css: userMenuStyles },
  { module: 'shell/NotificationCenter.styles.ts', css: notificationCenterStyles },
  { module: 'shell/Breadcrumbs.styles.ts', css: breadcrumbsStyles },
  { module: 'shell/TabNav.styles.ts', css: tabNavStyles },
  { module: 'shell/HierNav.styles.ts', css: hierNavStyles },
  { module: 'shell/RouteProgress.styles.ts', css: routeProgressStyles },
  { module: 'shell/RouteFocus.styles.ts', css: routeFocusStyles },
  { module: 'shell/SkipLinks.styles.ts', css: skipLinksStyles },
  { module: 'shell/ShortcutsDialog.styles.ts', css: shortcutsDialogStyles },

  // Patterns: composites built from the components above.
  { module: 'web/AppShell.styles.ts', css: appShellStyles },
  { module: 'data/FilterBar.styles.ts', css: filterBarStyles },
  { module: 'data/DataTable.styles.ts', css: dataTableStyles },
  { module: 'shell/PageHeader.styles.ts', css: pageHeaderStyles },

  { module: 'styles/utilities.styles.ts', css: utilityStyles },

  // Unlayered, and last: third-party overrides only (see the module).
  { module: 'styles/vendor.styles.ts', css: vendorStyles },
];
