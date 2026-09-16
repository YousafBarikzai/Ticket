import type { NextRequest } from 'next/server';
import { bff } from '../../../../bff.js';

export const POST = (request: NextRequest): Promise<Response> => bff.logout(request);
