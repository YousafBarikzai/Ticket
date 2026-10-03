import type { NextRequest } from 'next/server';
import { bff } from '../../../../bff.js';

/**
 * `POST /api/demo/reset` (SPEC v3 §4.5 T3–T6): the demo bar's "Reset demo
 * data", forwarded to the API with the visit's token. Only a demo session from
 * this origin may ask; the API's answer (202, 409, 429, 503) passes through.
 */
export const POST = (request: NextRequest): Promise<Response> => bff.demoReset(request);
