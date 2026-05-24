// Copyright 2025 The MCP Interceptors Authors. All rights reserved.

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';
import { invokeInterceptor, listInterceptors } from '../client/client-extensions.js';
import {
  InvokeInterceptorRequestSchema,
  ListInterceptorsRequestSchema,
} from '../protocol/zod-schemas.js';
import type {
  Interceptor,
  InterceptorsCapability,
  InvokeInterceptorRequestParams,
  ListInterceptorsRequestParams,
} from '../protocol/types.js';
function readInterceptorCapability(client: Client): InterceptorsCapability | undefined {
  const caps = client.getServerCapabilities() as ServerCapabilities & {
    interceptor?: InterceptorsCapability;
  };
  return caps?.interceptor;
}

export class GatewayInterceptorProtocolBridge {
  private readonly interceptorClients: Client[];

  constructor(interceptorClients: Client[]) {
    this.interceptorClients = interceptorClients;
  }

  configure(server: Server): void {
    const allEvents = new Set<string>();
    let anyCapability = false;

    for (const client of this.interceptorClients) {
      const cap = readInterceptorCapability(client);
      if (!cap) {
        continue;
      }
      anyCapability = true;
      for (const ev of cap.supportedEvents) {
        allEvents.add(ev);
      }
    }

    if (anyCapability) {
      server.registerCapabilities({
        interceptor: {
          supportedEvents: [...allEvents],
        },
      } as ServerCapabilities);
    }

    server.setRequestHandler(ListInterceptorsRequestSchema, async (request) => {
      const params = request.params as ListInterceptorsRequestParams | undefined;
      const aggregated: Interceptor[] = [];

      for (const client of this.interceptorClients) {
        const result = await listInterceptors(client, params);
        aggregated.push(...result.interceptors);
      }

      return { interceptors: aggregated };
    });

    server.setRequestHandler(InvokeInterceptorRequestSchema, async (request) => {
      const params = request.params as InvokeInterceptorRequestParams;

      for (const client of this.interceptorClients) {
        try {
          const result = await invokeInterceptor(client, params);
          return result as unknown as Record<string, unknown>;
        } catch (err) {
          const code =
            typeof err === 'object' &&
            err !== null &&
            'code' in err &&
            (err as { code: unknown }).code === -32602;
          if (code) {
            continue;
          }
          throw err;
        }
      }

      throw new Error(`Interceptor '${params.name}' not found on any interceptor server`);
    });
  }
}
