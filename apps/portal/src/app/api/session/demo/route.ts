import type { NextRequest } from 'next/server';
import { bff } from '../../../../bff.js';

/**
 * `POST /api/session/demo` (SPEC v3 §4.5 rows M1–M7): the `/demo` page's form
 * posts here, and only here does a demo visit begin. Never a 200 — a 303 on
 * to the visit or back to `/demo` with a reason, or a problem (404 while the
 * demo is off here, 403 for a post from another origin).
 */
export const POST = (request: NextRequest): Promise<Response> => bff.demoSignIn(request);
