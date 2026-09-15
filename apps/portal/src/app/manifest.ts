import type { MetadataRoute } from 'next';

/**
 * The web app manifest (doc 14 §5).
 *
 * `display: standalone` and a start URL of `/` so an installed portal opens on
 * the two things somebody came to do rather than on whichever page they
 * happened to install it from.
 *
 * One SVG icon rather than a set of PNGs. It is `maskable` as well as `any`,
 * which is what stops a platform launcher cropping the mark into a circle and
 * losing half of it — and it scales, which a 192-pixel PNG on a modern phone
 * does not.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Help — IT service desk',
    short_name: 'Help',
    description: 'Report something, ask for something, and see where it got to.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#1f4bd8',
    lang: 'en-GB',
    dir: 'ltr',
    orientation: 'portrait-primary',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
