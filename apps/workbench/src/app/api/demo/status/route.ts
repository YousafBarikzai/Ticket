import type { NextRequest } from 'next/server';
import { bff } from '../../../../bff.js';

/** Per request, never prerendered: the answer is the demo's state now, or this caller's own bucket. */
export const dynamic = 'force-dynamic';

/** What the demo bar polls (§4.6.4, T2): the demo's state and clock, `no-store`. 404 unless `DEMO_MODE=on`. */
export const GET = (request: NextRequest): Promise<Response> => bff.demoStatus(request);
