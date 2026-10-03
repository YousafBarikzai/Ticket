import type { MetadataRoute } from 'next';
import { AREAS, PRODUCT_NAME } from '@itsm/contracts/areas';
import { colour } from '@itsm/ui/tokens';

/**
 * The web app manifest (doc 14 §5; SPEC §5.3, F33; v3 §3.1).
 *
 * An installed Service Desk opens on its Overview, the area's home, rather
 * than on whichever page it was installed from. The colours are the light
 * canvas token (the page's `theme-color` meta follows the colour scheme
 * where the platform supports it). No `orientation`: an agent on a tablet
 * turns it both ways. The name is the area's (D1): "Service Desk", with the
 * product beside it where there is room.
 *
 * Two icons: the mark as drawn everywhere else (`any`), and a full-bleed
 * version whose glyph sits inside the safe zone (`maskable`), so a launcher
 * that crops to a circle or a squircle keeps the whole glyph and shows no
 * transparent corners.
 *
 * The shortcuts are the things people open the app to do: see the queue at
 * a glance, see their work, and raise a ticket (`?new=1` opens the
 * new-ticket sheet over My work).
 */
export default function manifest(): MetadataRoute.Manifest {
  const area = AREAS.workbench;
  const canvas = colour.apple.surface.canvas;
  const icon = [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }];
  return {
    id: '/',
    name: `${area.name} — ${PRODUCT_NAME}`,
    short_name: area.name,
    description: 'Your tickets, your teams’ queues and the work in front of you.',
    start_url: area.home,
    scope: '/',
    display: 'standalone',
    background_color: canvas,
    theme_color: canvas,
    lang: 'en-GB',
    dir: 'ltr',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Overview', short_name: 'Overview', url: area.home, icons: icon },
      { name: 'My work', short_name: 'My work', url: '/inbox/mine', icons: icon },
      { name: 'New ticket', short_name: 'New ticket', url: '/inbox/mine?new=1', icons: icon },
    ],
  };
}
