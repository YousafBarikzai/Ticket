# Inter Variable (self-hosted)

The design system's text face on every platform that is not Apple's. On a Mac,
iPhone or iPad the stack's `-apple-system` resolves to San Francisco first and
these files are never used for text (redesign spec §1.7).

| File | Source file in `@fontsource-variable/inter@5.3.0` | Size | Loaded |
|---|---|---|---|
| `InterVariable-latin-opsz.woff2` | `files/inter-latin-opsz-normal.woff2` | 72,920 B | preloaded |
| `InterVariable-latin-ext-opsz.woff2` | `files/inter-latin-ext-opsz-normal.woff2` | 133,336 B | on demand, by `unicode-range` |

Both are the `opsz` + `wght` variable cut, upright only: weights 100–900 in one
file, and the optical-size axis switches to Inter Display's shapes at large
sizes, much as San Francisco does. There is no italic; the product sets none.

The files are copied and renamed, not installed: the package is not a
dependency. The tarball's integrity was checked against the registry's
(`sha512-OupL48va4JNofb97w6NYeF9S7W/kHNKM0Er8Dem5nqi4jeOLrVJDoE8tZEpnMJmtkvNbB1EIPPwHcdkF6b1oUA==`)
before they were extracted. SHA-256 of the files as committed:

```
2c295d99e26dcf357d4d01bcf270fd6924b600c9a13dd8c363ef114f4c6976fa  InterVariable-latin-opsz.woff2
5e6d4fe9d9f4bff8b2a2469d25ab19576bb85331e22c6ed51398e16f95d56a9c  InterVariable-latin-ext-opsz.woff2
```

## How the apps load them

Each app's `src/app/fonts.ts` calls `next/font/local` twice, with paths relative
to that file (`../../../../packages/ui/fonts/…`). `next/font` copies the files
into `/_next/static/media` at build time, so they are served from the app's own
origin — `font-src 'self'` holds and no `public/` directory is needed. The two
faces set `--font-inter` and `--font-inter-ext` on `<html>`, which the token
stack reads with a plain `"Inter"` fallback.

The `unicode-range` values in `fonts.ts` are Fontsource's for these two subsets.
`next/font` only accepts literals in its options, so they are written out in
each app rather than imported from here; change them in all three together.

## Licence

SIL Open Font License 1.1 — see `OFL.txt`, copied from the package's `LICENSE`.
The licence permits bundling and redistribution with software; it does not
permit selling the fonts on their own.

## Updating

Download the new `@fontsource-variable/inter` tarball, check its `dist.integrity`
against the registry, copy the two `*-opsz-normal.woff2` files over these under
the same names, update the sizes and hashes above, and build one app with
`next build --webpack` to confirm `next/font/local` still resolves them.
