import type { NextRequest } from 'next/server';
import { bff } from '../../../../bff.js';

/**
 * `/api/proxy/*` → the API (doc 14 §3).
 *
 * The whole of the browser's access to the platform passes through here, and
 * the handler deliberately contains no knowledge of what any endpoint does.
 * Its rules are in `@itsm/bff`, with a test naming each request they refuse.
 */
const HANDLER = async (request: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<Response> =>
  bff.proxy(request, (await context.params).path);

export const GET = HANDLER;
export const HEAD = HANDLER;
export const POST = HANDLER;
export const PUT = HANDLER;
export const PATCH = HANDLER;
export const DELETE = HANDLER;
