import localFont from 'next/font/local';

/**
 * Inter Variable, self-hosted (SPEC v3 §6.1, R1; `packages/ui/fonts/README.md`).
 *
 * The same two faces, ranges and options as the three applications, so the
 * site sets type exactly as the product does. Inter only in this wave: Plus
 * Jakarta Sans arrives with the landing page (WP-50), which is the first page
 * here with a display headline to set in it.
 *
 * `next/font/local` copies the files into `/_next/static/media` at build time
 * — this origin, so `font-src 'self'` holds and no visitor's address reaches a
 * font CDN — and exposes each family as a custom property the token font
 * stack reads (`--font-inter`, `--font-inter-ext`). Latin is preloaded, with
 * a metrics-matched Arial fallback to keep the swap from moving the page;
 * Latin Extended is fetched only when a page contains one of its characters.
 *
 * The options are literals because `next/font` reads them at build time and
 * accepts nothing else.
 */
export const interLatin = localFont({
  src: '../../../../packages/ui/fonts/InterVariable-latin-opsz.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-inter',
  preload: true,
  adjustFontFallback: 'Arial',
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
    },
  ],
});

export const interExt = localFont({
  src: '../../../../packages/ui/fonts/InterVariable-latin-ext-opsz.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-inter-ext',
  preload: false,
  adjustFontFallback: false,
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
    },
  ],
});
