import { bff } from '../../../../bff.js';

/** `GET /api/demo/ip-check`: the caller's own salted bucket and nothing else, for the deploy probe (SPEC v3 §4.8). */
export const GET = (request: Request): Promise<Response> => bff.demoIpCheck(request);
