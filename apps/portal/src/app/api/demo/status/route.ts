import type { NextRequest } from 'next/server';
import { bff } from '../../../../bff.js';

/**
 * `GET /api/demo/status` (SPEC v3 §4.5 T1–T2, §4.6.4): what the demo bar's
 * watch polls — the state, the generation, the reset clock and the cooldown,
 * never a tenant, a user or a token. `no-store`; 404 while the demo is off.
 */
export const dynamic = 'force-dynamic';

export const GET = (request: NextRequest): Promise<Response> => bff.demoStatus(request);
