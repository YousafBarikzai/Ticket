import type { z } from 'zod';

/**
 * A route declaration. Declared once here, used to register the Fastify route,
 * generate OpenAPI, generate the SDK and generate the permission-matrix tests.
 *
 * `permission` is documentation metadata only. Enforcement happens in the
 * service layer (specification §7; docs/architecture/08 §4).
 */
export interface RouteDefinition<
  P extends z.ZodTypeAny = z.ZodTypeAny,
  Q extends z.ZodTypeAny = z.ZodTypeAny,
  B extends z.ZodTypeAny = z.ZodTypeAny,
  R extends z.ZodTypeAny = z.ZodTypeAny,
> {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  operationId: string;
  summary: string;
  tags: string[];
  module: string;
  /** Permission key the service layer will require, for docs and generated tests. */
  permission?: string;
  /** `public` skips authentication (signed-token or status endpoints). */
  auth?: 'required' | 'public' | 'platform';
  params?: P;
  query?: Q;
  body?: B;
  response: R;
  status?: number;
  idempotent?: boolean;
  requiresIfMatch?: boolean;
  errors?: number[];
}

export function defineRoute<P extends z.ZodTypeAny, Q extends z.ZodTypeAny, B extends z.ZodTypeAny, R extends z.ZodTypeAny>(
  def: RouteDefinition<P, Q, B, R>,
): RouteDefinition<P, Q, B, R> {
  return def;
}

export type RouteBody<D> = D extends RouteDefinition<z.ZodTypeAny, z.ZodTypeAny, infer B, z.ZodTypeAny> ? z.infer<B> : never;
export type RouteResponse<D> = D extends RouteDefinition<z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny, infer R> ? z.infer<R> : never;
