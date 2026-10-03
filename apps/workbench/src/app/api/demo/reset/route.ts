import type { NextRequest } from 'next/server';
import { bff } from '../../../../bff.js';

/** "Reset demo data" (§4.6.4, T3–T6): forwarded to the API with the visit's token, same-origin only. */
export const POST = (request: NextRequest): Promise<Response> => bff.demoReset(request);
