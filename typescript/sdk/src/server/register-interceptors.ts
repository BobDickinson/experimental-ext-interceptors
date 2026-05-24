// Copyright 2025 The MCP Interceptors Authors. All rights reserved.

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { matchesEvent } from '../client/chain-orchestrator.js';
import type {
  Interceptor,
  InterceptorResult,
  InvokeInterceptorRequestParams,
  ListInterceptorsRequestParams,
} from '../protocol/types.js';
import {
  InterceptorResultSchema,
  InvokeInterceptorRequestSchema,
  ListInterceptorsRequestSchema,
  ListInterceptorsResultSchema,
} from '../protocol/zod-schemas.js';
import { registerInterceptorCapabilities } from './capabilities.js';

export type InterceptorHandler = (
  params: InvokeInterceptorRequestParams,
  signal?: AbortSignal,
) => InterceptorResult | Promise<InterceptorResult>;

export interface RegisteredInterceptor {
  descriptor: Interceptor;
  handler: InterceptorHandler;
}

export interface RegisterInterceptorsOptions {
  /** When true (default), merge `capabilities.interceptor` from registered hooks. */
  registerCapabilities?: boolean;
}

export function registerInterceptorsOnServer(
  server: Server,
  interceptors: RegisteredInterceptor[],
  options?: RegisterInterceptorsOptions,
): void {
  const registerCaps = options?.registerCapabilities !== false;
  const descriptors = interceptors.map((e) => e.descriptor);
  const byName = new Map(interceptors.map((e) => [e.descriptor.name, e]));

  if (registerCaps) {
    registerInterceptorCapabilities(server, descriptors);
  }

  server.setRequestHandler(ListInterceptorsRequestSchema, (request) => {
    const params = request.params as ListInterceptorsRequestParams | undefined;
    const eventFilter = params?.event;
    const listed: Interceptor[] = [];

    for (const entry of interceptors) {
      if (eventFilter) {
        const matchesAnyHook = entry.descriptor.hooks.some((hook) =>
          matchesEvent(hook.events, eventFilter),
        );
        if (!matchesAnyHook) {
          continue;
        }
      }
      listed.push(entry.descriptor);
    }

    return { interceptors: listed };
  });

  server.setRequestHandler(InvokeInterceptorRequestSchema, async (request) => {
    const params = request.params as InvokeInterceptorRequestParams;
    const entry = byName.get(params.name);
    if (!entry) {
      throw new Error(`Interceptor '${params.name}' not found`);
    }

    const signal =
      params.timeoutMs != null ? AbortSignal.timeout(params.timeoutMs) : undefined;

    try {
      const result = await entry.handler(params, signal);
      result.interceptor = entry.descriptor.name;
      result.phase = params.phase;
      return result as unknown as Record<string, unknown>;
    } catch (err) {
      if (signal?.aborted) {
        throw new Error(
          `Interceptor '${params.name}' timed out after ${params.timeoutMs}ms`,
        );
      }
      throw err;
    }
  });
}

/** @internal For tests validating handler registration schemas. */
export const interceptorWireSchemas = {
  ListInterceptorsRequestSchema,
  ListInterceptorsResultSchema,
  InvokeInterceptorRequestSchema,
  InterceptorResultSchema,
};
