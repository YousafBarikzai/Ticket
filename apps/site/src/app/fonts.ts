import localFont from 'next/font/local';

/**
 * Inter Variable and Plus Jakarta Sans, self-hosted (SPEC v3 §6.1, §2.7, R1;
 * `packages/ui/fonts/README.md`).
 *
 * The same four faces, ranges and options as the three applications, so the
 * site sets type exactly as the product does: Inter for text, Jakarta for the
 * display, hero and title styles (the landing's headline, its section titles
 * and the preview's numerals).
 *
 * `next/font/local` copies the files into `/_next/static/media` at build time
 * — this origin, so `font-src 'self'` holds and no visitor's address reaches a
 * font CDN — and exposes each family as a custom property the token font
 * stacks read (`--font-inter`, `--font-inter-ext`, `--font-jakarta`,
 * `--font-jakarta-ext`). Both Latin faces are preloaded: the hero's `h1` is
 * Jakarta and is the page's largest paint, so a late swap would move the
 * fold (R1). Each has a metrics-matched Arial fallback to keep the swap from
 * shifting the page. The Latin Extended faces are fetched only when a page
 * contains one of their characters.
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

export const jakartaLatin = localFont({
  src: '../../../../packages/ui/fonts/PlusJakartaSans-latin-wght.woff2',
  weight: '200 800',
  style: 'normal',
  display: 'swap',
  variable: '--font-jakarta',
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

export const jakartaExt = localFont({
  src: '../../../../packages/ui/fonts/PlusJakartaSans-latin-ext-wght.woff2',
  weight: '200 800',
  style: 'normal',
  display: 'swap',
  variable: '--font-jakarta-ext',
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

/** The four families' class names, for `<html>`, where the token font stacks resolve them. */
export const fontClassNames = [interLatin.variable, interExt.variable, jakartaLatin.variable, jakartaExt.variable].join(' ');
