/**
 * The curated icon registry: every icon the product may draw, by name.
 *
 * A closed list rather than "any lucide icon" for three reasons. `IconName`
 * is a string union, so a server component can name an icon in serialisable
 * props (`icon: 'inbox'`) and a typo is a type error rather than an empty
 * square. The registry is the whole icon cost of a client bundle, so it stays
 * small on purpose. And one list is what keeps a concept drawn the same way
 * across three applications.
 *
 * Keys are the product's names: a concept for navigation and domain icons
 * (`queue`, `sla`, `compose`), the lucide file name for generic controls and
 * states (`chevron-down`, `triangle-alert`). Values are the lucide 1.48 file
 * names under `lucide/dist/esm/icons/`, which is where the icon data is
 * deep-imported from — never the package root, which would pull in every icon.
 * Several lucide names are aliases (`Trash2` is `trash`, `Building2` is
 * `building-complex`); the value is always the file that exists.
 *
 * Stub (SPEC §1.8, §4.1): the names are the contract other packages build
 * against; the values become deep imports of the icon node data with the
 * foundations package. Adding a name is safe; renaming or removing one breaks
 * every caller that spells it.
 */
export const iconRegistry = {
  // Navigation and product areas.
  home: 'house',
  inbox: 'inbox',
  ticket: 'ticket',
  queue: 'list-todo',
  automation: 'zap',
  workflow: 'workflow',
  approvals: 'circle-check-big',
  insights: 'chart-no-axes-combined',
  ai: 'sparkles',
  integrations: 'plug',
  cmdb: 'boxes',
  catalogue: 'layout-grid',
  knowledge: 'book-open',
  profile: 'circle-user',
  people: 'users',
  security: 'shield-check',
  audit: 'scroll-text',
  settings: 'settings',
  platform: 'building-complex',
  sla: 'timer',
  compose: 'square-pen',
  forms: 'file-text',
  fields: 'text-cursor-input',
  workforce: 'calendar-clock',
  assets: 'laptop',
  apps: 'layout-grid',
  help: 'circle-question-mark',

  // Objects and content.
  external: 'arrow-up-right',
  grip: 'grip-vertical',
  sparkles: 'sparkles',
  lock: 'lock',
  paperclip: 'paperclip',
  reply: 'reply',
  note: 'sticky-note',
  timer: 'timer',
  file: 'file',
  tag: 'tag',
  user: 'user',
  key: 'key-round',
  send: 'send',
  star: 'star',
  history: 'rotate-ccw-clock',
  calendar: 'calendar',

  // Controls.
  search: 'search',
  bell: 'bell',
  plus: 'plus',
  minus: 'minus',
  x: 'x',
  check: 'check',
  dot: 'dot',
  menu: 'menu',
  'chevron-down': 'chevron-down',
  'chevron-up': 'chevron-up',
  'chevron-left': 'chevron-left',
  'chevron-right': 'chevron-right',
  'arrow-up': 'arrow-up',
  'arrow-down': 'arrow-down',
  'arrow-left': 'arrow-left',
  'arrow-right': 'arrow-right',
  'arrow-up-down': 'arrow-up-down',
  ellipsis: 'ellipsis',
  'list-filter': 'list-filter',
  'columns-3': 'columns-3',
  'rows-3': 'rows-3',
  'panel-left': 'panel-left',
  'panel-right': 'panel-right',
  pin: 'pin',
  copy: 'copy',
  'external-link': 'external-link',
  'undo-2': 'undo-2',
  pencil: 'pencil',
  trash: 'trash',
  download: 'download',
  upload: 'upload',
  'refresh-cw': 'refresh-cw',
  keyboard: 'keyboard',
  'log-out': 'log-out',
  eye: 'eye',
  'eye-off': 'eye-off',
  play: 'play',
  pause: 'circle-pause',
  stop: 'square',

  // States.
  'circle-check': 'circle-check',
  'triangle-alert': 'triangle-alert',
  'circle-alert': 'circle-alert',
  info: 'info',
  'loader-circle': 'loader-circle',
  clock: 'clock',
  'wifi-off': 'wifi-off',
  'cloud-off': 'cloud-off',
  ban: 'ban',
  'trending-up': 'trending-up',
  'trending-down': 'trending-down',

  // Channels: generic glyphs, always beside a text label, never brand logos.
  globe: 'globe',
  mail: 'mail',
  'message-square': 'message-square',
  'message-circle': 'message-circle',
  phone: 'phone',
  smartphone: 'smartphone',
  webhook: 'webhook',
  bot: 'bot',

  // Appearance.
  sun: 'sun',
  moon: 'moon',
  monitor: 'monitor',
  contrast: 'contrast',

  // Brand mark glyphs.
  'layers-2': 'layers-2',
  'settings-2': 'settings-2',
  'life-buoy': 'life-buoy',
} as const;

/** A name from the registry. Serialisable, so it may cross from a server component to a client one. */
export type IconName = keyof typeof iconRegistry;

/** Every registered name, for tests and for validating names that arrive as data. */
export const iconNames = Object.keys(iconRegistry) as readonly IconName[];

/** Whether an arbitrary string is a registered icon name. */
export function isIconName(value: string): value is IconName {
  return Object.prototype.hasOwnProperty.call(iconRegistry, value);
}
