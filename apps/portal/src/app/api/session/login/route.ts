import type { NextRequest } from 'next/server';
import { bff } from '../../../../bff.js';

export const GET = (request: NextRequest): Promise<Response> => bff.login(request);
