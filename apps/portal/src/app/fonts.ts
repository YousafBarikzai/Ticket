import localFont from 'next/font/local';

/**
 * Inter Variable and Plus Jakarta Sans, self-hosted (SPEC-v3 §2.7;
 * `packages/ui/fonts/README.md`).
 *
 * Inter is the UI face on every platform, first in the design system's `sans`
 * stack; Jakarta sets titles, KPI numerals and headlines through the
 * `display` stack. `next/font/local` copies the files into
 * `/_next/static/media` at build time — this origin, so `font-src 'self'`
 * holds — and each call exposes its family as a custom property that the
 * token stacks read (`--font-inter`, `--font-inter-ext`, `--font-jakarta`,
 * `--font-jakarta-ext`). All four classes go on `<html>`, where the stacks'
 * variables are resolved and where overlays portalled into `body` still
 * inherit them.
 *
 * Each family has two faces, split by `unicode-range` exactly as Fontsource
 * splits them. Latin is preloaded, because every page sets text in both
 * families above the fold (the page title is Jakarta) and a late swap is the
 * layout shift people notice; its metrics-matched Arial fallback keeps that
 * shift small while it loads. Latin Extended (accented names: Łukasz, Dvořák)
 * is fetched only when a page contains one of its characters.
 *
 * The options are literals because `next/font` reads them at build time and
 * accepts nothing else; the same ranges are written in every app.
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
