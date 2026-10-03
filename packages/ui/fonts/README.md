# Self-hosted fonts: Inter Variable and Plus Jakarta Sans

Two faces, both self-hosted (SPEC-v3 §2.7, D4):

- **Inter** is the UI face on every platform, first in the token `sans` stack.
  v2 put `-apple-system` first, so a Mac rendered San Francisco while it
  downloaded Inter anyway; v3 sets Inter everywhere, which is also what the
  product screenshots (taken on Linux) show.
- **Plus Jakarta Sans** is the display face: page, section and card titles, KPI
  numerals, hero verdicts and landing headlines, at 16px and above only. It
  leads the token `display` stack and falls back to Inter.

| File | Source file | Size | Loaded |
|---|---|---|---|
| `InterVariable-latin-opsz.woff2` | `@fontsource-variable/inter@5.3.0` `files/inter-latin-opsz-normal.woff2` | 72,920 B | preloaded |
| `InterVariable-latin-ext-opsz.woff2` | `@fontsource-variable/inter@5.3.0` `files/inter-latin-ext-opsz-normal.woff2` | 133,336 B | on demand, by `unicode-range` |
| `PlusJakartaSans-latin-wght.woff2` | `@fontsource-variable/plus-jakarta-sans@5.3.0` `files/plus-jakarta-sans-latin-wght-normal.woff2` | 27,348 B | preloaded |
| `PlusJakartaSans-latin-ext-wght.woff2` | `@fontsource-variable/plus-jakarta-sans@5.3.0` `files/plus-jakarta-sans-latin-ext-wght-normal.woff2` | 21,728 B | on demand, by `unicode-range` |

The Inter files are the `opsz` + `wght` variable cut, upright only: weights
100–900 in one file, and the optical-size axis switches to Inter Display's
shapes at large sizes, much as San Francisco does. The Jakarta files are the
`wght` variable cut, upright only, weights 200–800. There is no italic; the
product sets none.

Jakarta renders above the fold on every route of every app (top-bar titles,
portal headings, KPI numerals, sign-in headlines), so its latin face is
preloaded in each app's root layout like Inter's: +27,348 B per origin on a
first visit, then cached, and no JavaScript. Its latin-ext face loads only when
a Jakarta-set element contains a latin-ext character ("Łukasz").

The files are copied and renamed, not installed: neither package is a
dependency. Each tarball's integrity was checked against the registry's before
the files were extracted:

```
@fontsource-variable/inter@5.3.0               sha512-OupL48va4JNofb97w6NYeF9S7W/kHNKM0Er8Dem5nqi4jeOLrVJDoE8tZEpnMJmtkvNbB1EIPPwHcdkF6b1oUA==
@fontsource-variable/plus-jakarta-sans@5.3.0   sha512-/l/4r0yyWK9JzAlmA0LiYgGgmJe/Gswt4jTJEzr5QhJfwMbvJZDmYWyW0M4X7yCK69BajMVlV/Lx8g7WDc1+sw==
```

SHA-256 of the files as committed:

```
2c295d99e26dcf357d4d01bcf270fd6924b600c9a13dd8c363ef114f4c6976fa  InterVariable-latin-opsz.woff2
5e6d4fe9d9f4bff8b2a2469d25ab19576bb85331e22c6ed51398e16f95d56a9c  InterVariable-latin-ext-opsz.woff2
153fc85b70298beeb1d61a5f723331649e7f23bb77302a66e61cb3e2fbdb5e79  PlusJakartaSans-latin-wght.woff2
38e3b8fd8045048eb311d90170a4429ed2c8f405852dc3d91b5af8452758703f  PlusJakartaSans-latin-ext-wght.woff2
```

## How the apps load them

Each app's `src/app/fonts.ts` calls `next/font/local` four times, with paths
relative to that file (`../../../../packages/ui/fonts/…`). `next/font` copies
the files into `/_next/static/media` at build time, so they are served from the
app's own origin — `font-src 'self'` holds and no `public/` directory is
needed. The four faces set `--font-inter`, `--font-inter-ext`, `--font-jakarta`
and `--font-jakarta-ext` on `<html>` (the root layout puts all four classes
there, so overlays portalled into `body` inherit them), and the token stacks
read them with a plain family-name fallback.

The `unicode-range` values in `fonts.ts` are Fontsource's for these subsets
(the same two ranges for both families). `next/font` only accepts literals in
its options, so they are written out in each app rather than imported from
here; change them in all of them together.

Jakarta's narrow word space (0.170em against Inter's 0.281em) is corrected by
the type tokens, not here: every display style carries `word-spacing`
(`tokens/__tests__/type.test.ts`).

## Licence

Both families are under the SIL Open Font License 1.1: Inter's licence is
`OFL.txt` and Plus Jakarta Sans's is `OFL-PlusJakartaSans.txt`, each copied
from its package's `LICENSE`. The licence permits bundling and redistribution
with software; it does not permit selling the fonts on their own.

## Updating

Download the new Fontsource tarball, check its `dist.integrity` against the
registry, copy the files named above over these under the same names, update
the sizes and hashes here, and build one app with `next build --webpack` to
confirm `next/font/local` still resolves them.
