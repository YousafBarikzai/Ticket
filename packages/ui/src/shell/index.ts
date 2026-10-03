/**
 * `@itsm/ui/shell` — the application frame: shell, navigation and the command
 * palette.
 *
 * Its own subpath because the frame is the heaviest thing a page mounts and
 * the only thing that adapts to the viewport rather than its container. The
 * parts that need the overlay library (menus, the navigation sheet, the
 * notification panel, the shortcuts dialog) load it on intent, so a page pays
 * for it only when someone reaches for one.
 */
export { BottomDock, type BottomDockProps } from './BottomDock.js';
export { Breadcrumbs, type BreadcrumbsProps } from './Breadcrumbs.js';
export { useFullScreenFlow } from './flow.js';
export { HierNav, type HierNavItem, type HierNavProps } from './HierNav.js';
export { currentItemId, hrefPath, matchScore } from './match.js';
export type { AppSwitcherItem, NavBadge, NavItem, NavMatch, NavModel, NavSection, ShellBrand } from './nav.js';
export {
  EMERGENCY_EVENT,
  NotificationCenter,
  type NotificationCenterProps,
  type NotificationItem,
} from './NotificationCenter.js';
export { PageHeader, type PageHeaderProps } from './PageHeader.js';
export { RouteFocus } from './RouteFocus.js';
export { RouteProgress, useRoutePending, type RouteProgressProps } from './RouteProgress.js';
export { SearchTrigger, type SearchTriggerProps } from './SearchTrigger.js';
export { ShortcutsDialog, type ShortcutsDialogProps } from './ShortcutsDialog.js';
export { setShortcutsDialogOpen } from './shortcuts.js';
export { SkipLinks, type SkipLinksProps } from './SkipLinks.js';
export { SplitView, type SplitPane, type SplitViewProps } from './SplitView.js';
export { SYSTEM_BAR_BUSY_LABEL, SystemBar, SystemBarBadge, type SystemBarBadgeProps, type SystemBarBadgeSpec, type SystemBarProps, type SystemBarState } from './SystemBar.js';
export { TabBar, type TabBarProps } from './TabBar.js';
export { TabNav, type TabNavItem, type TabNavProps } from './TabNav.js';
export { TopBar, type TopBarProps } from './TopBar.js';
export { TopNavShell, type TopNavShellProps } from './TopNavShell.js';
export { UserMenu, type UserMenuProps, type UserMenuSignOut } from './UserMenu.js';

// The in-house components, rebuilt in place.
export { AppShell, type AppShellFrameProps, type AppShellNavItem, type AppShellProps } from '../web/AppShell.js';
export { CommandPalette, rankCommands, type CommandItem, type CommandPaletteProps } from '../web/CommandPalette.js';
export type { CommandProvider } from '../provider/commands.js';
