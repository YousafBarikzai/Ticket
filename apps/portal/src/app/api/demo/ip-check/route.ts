import type { NextRequest } from 'next/server';
import { bff } from '../../../../bff.js';

/**
 * `GET /api/demo/ip-check` (SPEC v3 §4.8): the caller's own salted address
 * bucket, which the post-deploy probe compares across requests to prove the
 * deployment sees real client addresses. Nothing else; `no-store`.
 */
export const dynamic = 'force-dynamic';

export const GET = (request: NextRequest): Promise<Response> => bff.demoIpCheck(request);
