import type { MetadataRoute } from 'next';

/**
 * The web app manifest (doc 14 §5; SPEC §5.3, F33).
 *
 * An installed workbench opens on the inbox — the view the agent was last in,
 * by way of `/inbox` — rather than on whichever page it was installed from.
 * The colours are the light canvas token (the page's `theme-color` meta
 * follows the colour scheme where the platform supports it). No
 * `orientation`: an agent on a tablet turns it both ways.
 *
 * Two icons: the mark as drawn everywhere else (`any`), and a full-bleed
 * version whose glyph sits inside the safe zone (`maskable`), so a launcher
 * that crops to a circle or a squircle keeps the whole glyph and shows no
 * transparent corners.
 *
 * The shortcuts are the two things people open the app to do: see their
 * work, and raise a ticket (`?new=1` opens the new-ticket sheet over My work).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Workbench — IT service desk',
    short_name: 'Workbench',
    description: 'Your tickets, your teams’ queues and the work in front of you.',
    start_url: '/inbox',
    scope: '/',
    display: 'standalone',
    background_color: '#F5F5F7',
    theme_color: '#F5F5F7',
    lang: 'en-GB',
    dir: 'ltr',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'My work', short_name: 'My work', url: '/inbox/mine', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }] },
      { name: 'New ticket', short_name: 'New ticket', url: '/inbox/mine?new=1', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }] },
    ],
  };
}
