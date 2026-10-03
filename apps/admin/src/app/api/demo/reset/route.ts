import { bff } from '../../../../bff.js';

/** `POST /api/demo/reset`: *Reset demo data*, forwarded with the visit's token (SPEC v3 §4.5 T3–T6). */
export const POST = (request: Request): Promise<Response> => bff.demoReset(request);
