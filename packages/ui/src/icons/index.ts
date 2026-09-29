/**
 * `@itsm/ui/icons` — the icon registry, `Icon` and `BrandMark`.
 *
 * Server-safe throughout: the icons are drawn on the server from lucide's
 * node data, imported by deep path so a page pays only for the registry.
 */
export { Icon, type IconProps } from './Icon.js';
export { BrandMark, type BrandMarkProps } from './BrandMark.js';
export { iconNames, iconRegistry, isIconName, type IconName } from './registry.js';
