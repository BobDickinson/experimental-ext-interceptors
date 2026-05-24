// Copyright 2025 The MCP Interceptors Authors. All rights reserved.

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { McpInterceptorServerConnectionOptions } from './mcp-interceptor-server-connection-options.js';
import { connectInterceptorClient } from './connect-interceptor-client.js';
import { GatewayResolvedInterceptorClients } from './gateway-resolved-interceptor-clients.js';

export class GatewayInterceptorClientPool {
  private readonly cache = new Map<string, Promise<Client>>();

  async resolveClients(
    connections: McpInterceptorServerConnectionOptions[],
    signal?: AbortSignal,
  ): Promise<GatewayResolvedInterceptorClients> {
    if (connections.length === 0) {
      return new GatewayResolvedInterceptorClients([]);
    }

    const clients: Client[] = [];
    const owned: Client[] = [];

    for (const connection of connections) {
      if (!connection.transport) {
        throw new Error('transport is required on interceptor server connection options');
      }

      const connectionId = connection.connectionId?.trim();
      if (!connectionId) {
        const client = await connectInterceptorClient(connection, signal);
        clients.push(client);
        owned.push(client);
        continue;
      }

      let pending = this.cache.get(connectionId);
      if (!pending) {
        pending = connectInterceptorClient(connection, signal);
        this.cache.set(connectionId, pending);
        pending.catch(() => {
          this.cache.delete(connectionId);
        });
      }

      try {
        clients.push(await pending);
      } catch (error) {
        this.cache.delete(connectionId);
        throw error;
      }
    }

    return new GatewayResolvedInterceptorClients(
      clients,
      owned.map((client) => ({
        dispose: () => client.close(),
      })),
    );
  }

  async dispose(): Promise<void> {
    const pending = [...this.cache.values()];
    this.cache.clear();
    const clients = await Promise.all(
      pending.map(async (p) => {
        try {
          return await p;
        } catch {
          return undefined;
        }
      }),
    );
    await Promise.all(clients.filter((c): c is Client => c !== undefined).map((c) => c.close()));
  }
}
