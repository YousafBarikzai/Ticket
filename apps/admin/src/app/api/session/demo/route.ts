import { bff } from '../../../../bff.js';

/** `POST /api/session/demo`: the `/demo` form's target, which opens the demo visit (SPEC v3 §4.5 M rows). */
export const POST = (request: Request): Promise<Response> => bff.demoSignIn(request);
