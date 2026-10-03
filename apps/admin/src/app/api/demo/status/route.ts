import { bff } from '../../../../bff.js';

/** `GET /api/demo/status`: the demo bar's poll (SPEC v3 §4.5 T2, §4.6.4); 404 unless the demo is on here. */
export const GET = (request: Request): Promise<Response> => bff.demoStatus(request);
