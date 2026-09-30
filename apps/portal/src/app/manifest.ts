import type { MetadataRoute } from 'next';

/**
 * The web app manifest (doc 14 §5; SPEC §5.4, F33).
 *
 * An installed portal opens on Home — search first, and the requests that
 * need the person — rather than on whichever page it was installed from. The
 * colours are the light canvas token (the page's `theme-color` meta follows
 * the colour scheme where the platform supports it), not the old brand navy.
 * No `orientation`: a person reporting a broken monitor from a tablet turns
 * it whichever way they are holding it.
 *
 * Two icons: the mark as drawn everywhere else (`any`), and a full-bleed
 * version whose glyph sits inside the safe zone (`maskable`), so a launcher
 * that crops to a circle or a squircle keeps the whole glyph and shows no
 * transparent corners.
 *
 * The shortcuts are the two things people open the app to do: tell us about
 * something (the report page, which also works offline and queues), and see
 * where their requests have got to.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Help — IT service desk',
    short_name: 'Help',
    description: 'Report something, ask for something, and see where it got to.',
    start_url: '/',
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
      { name: 'New request', short_name: 'New request', url: '/report', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }] },
      { name: 'My requests', short_name: 'My requests', url: '/tickets', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }] },
    ],
  };
}
