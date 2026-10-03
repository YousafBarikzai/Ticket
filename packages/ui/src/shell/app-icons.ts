/**
 * The glyph each area is drawn with — the same as `AREAS[…].icon` in
 * `@itsm/contracts/areas` — so the Service Desk looks the same wherever it is
 * offered: the area switcher's tiles, the brand mark, the palette.
 * Server-safe.
 */
import type { AppName } from '../theme/prefs.js';
import type { IconName } from '../types.js';

const icons: Readonly<Record<AppName, IconName>> = {
  admin: 'settings-2',
  workbench: 'inbox',
  portal: 'life-buoy',
};

export function appIcon(app: AppName): IconName {
  return icons[app];
}

/** An icon for a recent or pinned item, by what it is (`RecentItem.kind`). */
export function kindIcon(kind: string): IconName {
  switch (kind) {
    case 'ticket':
      return 'ticket';
    case 'rule':
      return 'automation';
    case 'workflow':
    case 'run':
      return 'workflow';
    case 'article':
      return 'knowledge';
    case 'person':
    case 'user':
      return 'user';
    case 'team':
      return 'people';
    case 'form':
      return 'forms';
    case 'service':
    case 'request-type':
      return 'catalogue';
    case 'ci':
    case 'asset':
      return 'assets';
    case 'view':
      return 'queue';
    default:
      return 'history';
  }
}
