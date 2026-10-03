import type { NextRequest } from 'next/server';
import { bff } from '../../../../bff.js';

/** The demo's one mint (§4.5 M rows): the `/demo` page's form posts here, never a link. 404 unless `DEMO_MODE=on`. */
export const POST = (request: NextRequest): Promise<Response> => bff.demoSignIn(request);
