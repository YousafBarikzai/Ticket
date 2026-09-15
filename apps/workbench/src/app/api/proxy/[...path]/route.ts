import { NextResponse, type NextRequest } from 'next/server';
import { config } from '../../../../bff/config.js';
import { clearedAttributes, SESSION_COOKIE } from '../../../../bff/cookies.js';
import {
  assertMethodAllowed,
  assertSameOrigin,
  forwardRequestHeaders,
  forwardResponseHeaders,
  ProxyRefused,
  refusalBody,
  targetPathFor,
} from '../../../../bff/proxy.js';
import { newCorrelationId } from '../../../../bff/session.js';
import { currentSession } from '../../../../server/session.js';

/**
 * `/api/proxy/*` → the API (doc 14 §3).
 *
 * The whole of the browser's access to the platform passes through this
 * function, and it deliberately contains no knowledge of what any endpoint
 * does. Adding a rule here — "only agents may transition", "strip this field"
 * — would put a second authorisation model in front of the one the API
 * already enforces, and the second one is the one that drifts. The API is the
 * product; this is a pipe with a bouncer on it.
 */

const HANDLER = async (request: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<Response> => {
  const settings = config();
  const correlationId = request.headers.get('x-correlation-id') ?? newCorrelationId();

  try {
    assertMethodAllowed(request.method);
    assertSameOrigin(request.method, request.headers, settings.appOrigin);

    const { path } = await context.params;
    const target = targetPathFor(path);

    const session = await currentSession();
    if (!session) {
      // 401 rather than a redirect: the caller is `fetch` from a component,
      // and a redirect to an HTML sign-in page arrives as a JSON parse error.
      // The cookie is cleared on the way out so the browser stops sending an
      // identifier that names nothing.
      const response = NextResponse.json(
        { type: 'about:blank', title: 'Unauthorized', status: 401, detail: 'that session has ended', correlationId },
        { status: 401 },
      );
      response.cookies.set(SESSION_COOKIE, '', clearedAttributes());
      return response;
    }

    const url = `${settings.apiBaseUrl}${target}${request.nextUrl.search}`;
    const upstream = await fetch(url, {
      method: request.method,
      headers: forwardRequestHeaders(request.headers, session.accessToken, correlationId),
      // GET and HEAD carry no body, and passing one is a runtime error rather
      // than an empty request.
      ...(request.method === 'GET' || request.method === 'HEAD' ? {} : { body: await request.arrayBuffer() }),
      // A redirect from the API is a fact about the API, not something to
      // follow on the caller's behalf behind its back.
      redirect: 'manual',
      cache: 'no-store',
    });

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: forwardResponseHeaders(upstream.headers),
    });
  } catch (error) {
    if (error instanceof ProxyRefused) {
      return NextResponse.json(refusalBody(error, correlationId), { status: error.status });
    }
    // An API that is down is a 502 from here, not a 500: the workbench is
    // working, its dependency is not, and the two need different responses
    // from whoever is on call.
    return NextResponse.json(
      {
        type: 'about:blank',
        title: 'Bad Gateway',
        status: 502,
        detail: 'the API could not be reached',
        correlationId,
      },
      { status: 502 },
    );
  }
};

export const GET = HANDLER;
export const HEAD = HANDLER;
export const POST = HANDLER;
export const PUT = HANDLER;
export const PATCH = HANDLER;
export const DELETE = HANDLER;
