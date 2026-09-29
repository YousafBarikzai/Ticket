import { uiStylesheet } from '@itsm/ui/styles';

/**
 * The design system's stylesheet, as a file of its own (redesign spec §3.4).
 *
 * Served from this app's origin, so `style-src 'self'` covers it, and linked
 * from the root layout as `/itsm-ui.css?v=<uiStylesheetVersion>`. The version
 * is a hash of the sheet, so the URL changes whenever a byte of it does, and
 * the response can be cached for a year as immutable: a browser fetches it
 * once per release rather than once per page, which an inlined `<style>` in
 * every HTML response could never be. The query string itself is ignored
 * here — it exists only to make the URL new.
 *
 * `force-static`: the sheet depends on nothing but the package's source, so
 * it is rendered once at build time and served as a file.
 */
export const dynamic = 'force-static';

export function GET(): Response {
  return new Response(uiStylesheet(), {
    headers: {
      'content-type': 'text/css; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}
