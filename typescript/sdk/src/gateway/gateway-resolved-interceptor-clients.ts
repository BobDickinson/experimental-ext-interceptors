// Copyright 2025 The MCP Interceptors Authors. All rights reserved.

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

export class GatewayResolvedInterceptorClients {
  readonly clients: Client[];
  private readonly ownedDisposables: Array<{ dispose(): Promise<void> }>;

  constructor(
    clients: Client[],
    ownedDisposables: Array<{ dispose(): Promise<void> }> = [],
  ) {
    this.clients = clients;
    this.ownedDisposables = ownedDisposables;
  }

  async dispose(): Promise<void> {
    for (const disposable of this.ownedDisposables) {
      await disposable.dispose();
    }
  }
}
