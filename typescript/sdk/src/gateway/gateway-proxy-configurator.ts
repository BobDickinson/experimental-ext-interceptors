// Copyright 2025 The MCP Interceptors Authors. All rights reserved.

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  SetLevelRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  type CallToolRequest,
  type GetPromptRequest,
  type Implementation,
  type ListPromptsRequest,
  type ListResourcesRequest,
  type ListToolsRequest,
  type ReadResourceRequest,
  type ServerCapabilities,
  type SubscribeRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { InterceptorChainRunner } from '../client/interceptor-chain-runner.js';
import { InterceptionEvents } from '../protocol/constants.js';
import type { InvokeInterceptorContext } from '../protocol/types.js';
import type { GatewayInterceptorClientProvider } from './gateway-interceptor-client-provider.js';
import type { GatewayMessageContext } from './gateway-message-context.js';
import { runProxiedRequest } from './proxy-request.js';

export interface GatewayProxyConfiguratorOptions {
  backendClient: Client;
  interceptorClientProvider: GatewayInterceptorClientProvider;
  events?: string[];
  timeoutMs?: number;
  defaultContext?: InvokeInterceptorContext;
  serverInfo?: Implementation;
}

function cloneBackendCapabilities(capabilities: ServerCapabilities): ServerCapabilities {
  const cloned = structuredClone(capabilities) as ServerCapabilities & { tasks?: unknown };
  delete cloned.tasks;
  return cloned;
}

function coerceParams<T extends { params?: unknown }>(
  request: T,
  mutated: unknown,
): NonNullable<T['params']> {
  if (typeof mutated === 'object' && mutated !== null) {
    return mutated as NonNullable<T['params']>;
  }
  return request.params as NonNullable<T['params']>;
}

function messageContextFromRequest(
  method: string,
  params: unknown,
  extra: { authInfo?: unknown; sessionId?: string; signal?: AbortSignal },
): GatewayMessageContext {
  return {
    method,
    params,
    authInfo: extra.authInfo,
    sessionId: extra.sessionId,
  };
}

export class GatewayProxyConfigurator {
  private readonly backend: Client;
  private readonly provider: GatewayInterceptorClientProvider;
  private readonly events?: string[];
  private readonly timeoutMs?: number;
  private readonly defaultContext?: InvokeInterceptorContext;
  private readonly serverInfo?: Implementation;

  constructor(options: GatewayProxyConfiguratorOptions) {
    this.backend = options.backendClient;
    this.provider = options.interceptorClientProvider;
    this.events = options.events;
    this.timeoutMs = options.timeoutMs;
    this.defaultContext = options.defaultContext;
    this.serverInfo = options.serverInfo;
  }

  configure(server: Server): void {
    const backendCaps = this.backend.getServerCapabilities();

    if (backendCaps) {
      server.registerCapabilities(cloneBackendCapabilities(backendCaps));
    }

    if (this.serverInfo) {
      // v1 Server info is fixed at construction; callers should pass the same override there.
    }

    if (backendCaps?.tools) {
      this.configureTools(server);
    }
    if (backendCaps?.prompts) {
      this.configurePrompts(server);
    }
    if (backendCaps?.resources) {
      this.configureResources(server, backendCaps);
    }
    if (backendCaps?.completions) {
      server.setRequestHandler(CompleteRequestSchema, (request, extra) =>
        this.backend.complete(request.params, { signal: extra.signal }),
      );
    }
    if (backendCaps?.logging) {
      server.setRequestHandler(SetLevelRequestSchema, async (request, extra) => {
        await this.backend.setLoggingLevel(request.params.level, { signal: extra.signal });
        return {};
      });
    }
  }

  private createChainRunner(interceptorClients: Client[]): InterceptorChainRunner {
    return new InterceptorChainRunner({
      interceptorClients,
      events: this.events,
      timeoutMs: this.timeoutMs,
      defaultContext: this.defaultContext,
    });
  }

  private async runProxied<T>(
    context: GatewayMessageContext,
    operation: string,
    eventName: string,
    requestParams: unknown,
    forward: (mutatedParams: unknown, signal?: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const resolved = await this.provider.resolve(context, eventName, signal);
    try {
      return await runProxiedRequest({
        operation,
        eventName,
        requestParams,
        chainRunner: this.createChainRunner(resolved.clients),
        signal,
        forward,
      });
    } finally {
      await resolved.dispose();
    }
  }

  private configureTools(server: Server): void {
    server.setRequestHandler(ListToolsRequestSchema, async (request, extra) =>
      this.runProxied(
        messageContextFromRequest('tools/list', request.params ?? {}, extra),
        'tools/list',
        InterceptionEvents.ToolsList,
        request.params ?? {},
        (params, sig) =>
          this.backend.listTools(params as ListToolsRequest['params'], { signal: sig }),
        extra.signal,
      ),
    );

    server.setRequestHandler(CallToolRequestSchema, async (request, extra) =>
      this.runProxied(
        messageContextFromRequest('tools/call', request.params, extra),
        'tools/call',
        InterceptionEvents.ToolsCall,
        request.params,
        (params, sig) =>
          this.backend.callTool(
            coerceParams(request, params) as CallToolRequest['params'],
            undefined,
            { signal: sig },
          ),
        extra.signal,
      ),
    );
  }

  private configurePrompts(server: Server): void {
    server.setRequestHandler(ListPromptsRequestSchema, async (request, extra) =>
      this.runProxied(
        messageContextFromRequest('prompts/list', request.params ?? {}, extra),
        'prompts/list',
        InterceptionEvents.PromptsList,
        request.params ?? {},
        (params, sig) =>
          this.backend.listPrompts(params as ListPromptsRequest['params'], { signal: sig }),
        extra.signal,
      ),
    );

    server.setRequestHandler(GetPromptRequestSchema, async (request, extra) =>
      this.runProxied(
        messageContextFromRequest('prompts/get', request.params, extra),
        'prompts/get',
        InterceptionEvents.PromptsGet,
        request.params,
        (params, sig) =>
          this.backend.getPrompt(
            coerceParams(request, params) as GetPromptRequest['params'],
            { signal: sig },
          ),
        extra.signal,
      ),
    );
  }

  private configureResources(server: Server, backendCaps: ServerCapabilities): void {
    server.setRequestHandler(ListResourcesRequestSchema, async (request, extra) =>
      this.runProxied(
        messageContextFromRequest('resources/list', request.params ?? {}, extra),
        'resources/list',
        InterceptionEvents.ResourcesList,
        request.params ?? {},
        (params, sig) =>
          this.backend.listResources(params as ListResourcesRequest['params'], { signal: sig }),
        extra.signal,
      ),
    );

    server.setRequestHandler(ReadResourceRequestSchema, async (request, extra) =>
      this.runProxied(
        messageContextFromRequest('resources/read', request.params, extra),
        'resources/read',
        InterceptionEvents.ResourcesRead,
        request.params,
        (params, sig) =>
          this.backend.readResource(
            coerceParams(request, params) as ReadResourceRequest['params'],
            { signal: sig },
          ),
        extra.signal,
      ),
    );

    server.setRequestHandler(ListResourceTemplatesRequestSchema, (request, extra) =>
      this.backend.listResourceTemplates(request.params, { signal: extra.signal }),
    );

    if (backendCaps.resources?.subscribe) {
      server.setRequestHandler(SubscribeRequestSchema, async (request, extra) => {
        await this.runProxied(
          messageContextFromRequest('resources/subscribe', request.params, extra),
          'resources/subscribe',
          InterceptionEvents.ResourcesSubscribe,
          request.params,
          async (params, sig) => {
            await this.backend.subscribeResource(
              coerceParams(request, params) as SubscribeRequest['params'],
              { signal: sig },
            );
            return {};
          },
          extra.signal,
        );
        return {};
      });

      server.setRequestHandler(UnsubscribeRequestSchema, async (request, extra) => {
        await this.backend.unsubscribeResource(request.params, { signal: extra.signal });
        return {};
      });
    }
  }
}
