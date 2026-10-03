import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import { uiStylesheet } from '@itsm/ui/styles';

/**
 * The design system's stylesheet as a file of its own, exactly as the
 * applications serve it (`apps/portal/src/app/itsm-ui.css/route.ts`).
 *
 * Served from this origin, so `style-src 'self'` covers it, and linked from
 * the root layout as `/itsm-ui.css?v=<uiStylesheetVersion>`. The version is a
 * hash of the sheet, so the URL changes whenever a byte of it does and the
 * response can be cached for a year as immutable.
 *
 * Compressed here, because nothing else does it. Next compresses the pages it
 * renders, but it copies a route handler's headers onto the response with
 * `appendHeader`, which leaves `content-type` an array, and its compression
 * middleware reads an array as "not compressible". As a prerendered static
 * route the sheet went out as it is — about 735 kB on a prospect's first
 * visit, where Brotli sends under a tenth of that. So the route reads
 * `accept-encoding` itself and answers in Brotli, else gzip, else plain text.
 * Reading the request makes the route dynamic; each encoding is compressed
 * once per process and kept, and `vary: accept-encoding` stops a shared cache
 * from handing one client's encoding to another.
 */
export const dynamic = 'force-dynamic';

type Encoding = 'br' | 'gzip';

const compressed: Partial<Record<Encoding, Promise<Buffer>>> = {};

function compress(encoding: Encoding): Promise<Buffer> {
  const sheet = Buffer.from(uiStylesheet(), 'utf8');
  if (encoding === 'gzip') return promisify(gzip)(sheet, { level: 9 });
  return promisify(brotliCompress)(sheet, {
    params: {
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
      // 10, not 11: within 2 % of the smallest file at a third of the time.
      [constants.BROTLI_PARAM_QUALITY]: 10,
      [constants.BROTLI_PARAM_SIZE_HINT]: sheet.length,
    },
  });
}

/** Brotli when the client takes it, then gzip, else none (`q=0` refuses a coding, `*` stands for the rest). */
function negotiate(acceptEncoding: string | null): Encoding | null {
  const weights = new Map<string, number>();
  for (const part of (acceptEncoding ?? '').toLowerCase().split(',')) {
    const [coding = '', ...params] = part.split(';').map((piece) => piece.trim());
    const q = params.find((param) => param.startsWith('q='));
    if (coding) weights.set(coding, q === undefined ? 1 : Number(q.slice(2)) || 0);
  }
  const takes = (coding: Encoding) => (weights.get(coding) ?? weights.get('*') ?? 0) > 0;
  return takes('br') ? 'br' : takes('gzip') ? 'gzip' : null;
}

export async function GET(request: Request): Promise<Response> {
  const headers = {
    'content-type': 'text/css; charset=utf-8',
    'cache-control': 'public, max-age=31536000, immutable',
    vary: 'accept-encoding',
  };
  const encoding = negotiate(request.headers.get('accept-encoding'));
  if (encoding) {
    try {
      const body = await (compressed[encoding] ??= compress(encoding));
      return new Response(new Uint8Array(body), { headers: { ...headers, 'content-encoding': encoding } });
    } catch {
      // A sheet that cannot be compressed is still a sheet: send it plain.
    }
  }
  return new Response(uiStylesheet(), { headers });
}
