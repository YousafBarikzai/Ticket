import localFont from 'next/font/local';

/**
 * Inter Variable, self-hosted (redesign spec §1.7; `packages/ui/fonts/README.md`).
 *
 * The design system's font stack puts the platform's own face first, so on
 * Apple devices these are never used for text; everywhere else they are what
 * the product is set in. `next/font/local` copies the files into
 * `/_next/static/media` at build time — this origin, so `font-src 'self'`
 * holds — and each call exposes its family as a custom property that the
 * token stack reads (`--font-inter`, `--font-inter-ext`). Both classes go on
 * `<html>`, where the stack's variables are resolved.
 *
 * Two faces, split by `unicode-range` exactly as Fontsource splits them.
 * Latin is preloaded, because every page needs it and a late swap is the
 * layout shift people notice; its metrics-matched Arial fallback keeps that
 * shift small while it loads. Latin Extended (accented names: Łukasz, Dvořák)
 * is fetched only when a page contains one of its characters.
 *
 * The options are literals because `next/font` reads them at build time and
 * accepts nothing else; the same ranges are written in all three apps.
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
