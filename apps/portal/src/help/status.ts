import 'server-only';
import type { Portal, PublicStatus } from '@itsm/sdk';
import { bff } from '../bff.js';

/**
 * The tenant's public status page, read on the server for Home's incident
 * banner and service status, and for the known-issue check in "How can we
 * help?" (SPEC §6.3).
 *
 * Server-only because the page lives at the API's root (`/status/<slug>`),
 * outside the `/api/v1` the browser's proxy forwards. Bounded in time: the
 * page is a courtesy on top of Home, and Home must not wait on it — a slow
 * answer is treated as no answer, and said as "Couldn't check service
 * status" rather than as "all running".
 */

/** How long Home waits for the status page before drawing without it. */
export const STATUS_TIMEOUT_MS = 1500;

export interface StatusRead {
  /** Null when there is no public page (or it could not be read). */
  readonly status: PublicStatus | null;
  /** The read failed or timed out — different from "there is no page". */
  readonly failed: boolean;
}

export async function readStatus(api: Portal, slug: string | null | undefined, timeoutMs = STATUS_TIMEOUT_MS): Promise<StatusRead> {
  if (!slug) return { status: null, failed: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), timeoutMs);
  });
  try {
    const answer = await Promise.race([api.publicStatus(slug), late]);
    return answer === 'late' ? { status: null, failed: true } : { status: answer, failed: false };
  } catch {
    return { status: null, failed: true };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Where "Follow updates" goes: the public page, on the API's public origin
 * (`API_BASE_URL` is the public hostname in every deployment, because sign-in
 * redirects are expressed in it). A plain navigation, which the CSP allows.
 */
export function followUrlFor(status: PublicStatus | null): string | null {
  if (!status) return null;
  const path = status.page.path.startsWith('/') ? status.page.path : `/${status.page.path}`;
  try {
    return new URL(path, `${bff.config.apiBaseUrl}/`).toString();
  } catch {
    return null;
  }
}
