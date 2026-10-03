import type { NextRequest } from 'next/server';
import { bff } from '../../../../bff.js';

/** Per request, never prerendered: the answer is the demo's state now, or this caller's own bucket. */
export const dynamic = 'force-dynamic';

/** The caller's own salted address bucket and nothing else (§4.5, A3 §8.1), for the deploy's `ip-check` probe. */
export const GET = (request: NextRequest): Promise<Response> => bff.demoIpCheck(request);
