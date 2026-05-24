// Copyright 2025 The MCP Interceptors Authors. All rights reserved.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  registerInterceptorsOnServer,
  type RegisteredInterceptor,
} from '../../server/register-interceptors.js';

export async function connectInterceptorHost(
  interceptors: RegisteredInterceptor[],
): Promise<{
  client: Client;
  server: Server;
  close: () => Promise<void>;
}> {
  const server = new Server(
    { name: 'test-interceptor-host', version: '0.0.0' },
    { capabilities: {} },
  );

  registerInterceptorsOnServer(server, interceptors);

  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    server,
    close: async () => {
      await Promise.all([client.close(), server.close()]);
    },
  };
}

export async function connectEchoBackend(): Promise<{
  client: Client;
  server: Server;
  close: () => Promise<void>;
  lastCall: { name: string; arguments?: Record<string, unknown> };
}> {
  const lastCall = { name: '', arguments: undefined as Record<string, unknown> | undefined };

  const server = new Server(
    { name: 'echo-backend', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [{ name: 'echo', description: 'echo', inputSchema: { type: 'object' } }],
  }));

  server.setRequestHandler(CallToolRequestSchema, (request) => {
    lastCall.name = request.params.name;
    lastCall.arguments = request.params.arguments;
    return {
      content: [{ type: 'text', text: JSON.stringify(request.params.arguments ?? {}) }],
      structuredContent: request.params.arguments ?? {},
    };
  });

  const client = new Client({ name: 'gateway-client', version: '0.0.0' }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    server,
    lastCall,
    close: async () => {
      await Promise.all([client.close(), server.close()]);
    },
  };
}

/** Backend with tools, prompts, and subscribable resources for gateway / client E2E tests. */
export async function connectRichBackend(): Promise<{
  client: Client;
  server: Server;
  close: () => Promise<void>;
  lastToolCall: { name: string; arguments?: Record<string, unknown> };
  lastPromptGet: { name: string; arguments?: Record<string, string> };
  subscription: { uri: string };
}> {
  const lastToolCall = { name: '', arguments: undefined as Record<string, unknown> | undefined };
  const lastPromptGet = { name: '', arguments: undefined as Record<string, string> | undefined };
  const subscription = { uri: '' };

  const server = new Server(
    { name: 'rich-backend', version: '0.0.0' },
    {
      capabilities: {
        tools: {},
        prompts: {},
        resources: { subscribe: true },
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [{ name: 'echo', description: 'echo', inputSchema: { type: 'object' } }],
  }));

  server.setRequestHandler(CallToolRequestSchema, (request) => {
    lastToolCall.name = request.params.name;
    lastToolCall.arguments = request.params.arguments;
    const msg = request.params.arguments?.message;
    return {
      content: [{ type: 'text', text: `echo: ${String(msg ?? '')}` }],
    };
  });

  server.setRequestHandler(ListPromptsRequestSchema, () => ({
    prompts: [{ name: 'greet', description: 'greet' }],
  }));

  server.setRequestHandler(GetPromptRequestSchema, (request) => {
    lastPromptGet.name = request.params.name;
    lastPromptGet.arguments = request.params.arguments;
    return {
      messages: [
        {
          role: 'user' as const,
          content: { type: 'text' as const, text: `Hello ${request.params.name}` },
        },
      ],
    };
  });

  server.setRequestHandler(ListResourcesRequestSchema, () => ({
    resources: [{ uri: 'resource://original', name: 'original' }],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, (request) => ({
    contents: [{ uri: request.params.uri, text: 'content' }],
  }));

  server.setRequestHandler(SubscribeRequestSchema, (request) => {
    subscription.uri = request.params.uri;
    return {};
  });

  const client = new Client({ name: 'rich-backend-client', version: '0.0.0' }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    server,
    lastToolCall,
    lastPromptGet,
    subscription,
    close: async () => {
      await Promise.all([client.close(), server.close()]);
    },
  };
}
