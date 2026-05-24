// Copyright 2025 The MCP Interceptors Authors. All rights reserved.

import { describe, it, expect } from 'vitest';
import { InterceptionEvents } from '../protocol/constants.js';
import { validationSuccess } from '../protocol/results.js';
import { listInterceptors, invokeInterceptor } from '../client/client-extensions.js';
import { collectSupportedEvents } from './capabilities.js';
import { connectInterceptorHost } from '../__tests__/fixtures/hosts.js';
import type { RegisteredInterceptor } from './register-interceptors.js';

const toolsValidator: RegisteredInterceptor = {
  descriptor: {
    name: 'tools-only',
    type: 'validation',
    hooks: [{ events: [InterceptionEvents.ToolsCall], phase: 'request' }],
  },
  handler: () => validationSuccess('request'),
};

const promptsValidator: RegisteredInterceptor = {
  descriptor: {
    name: 'prompts-only',
    type: 'validation',
    hooks: [{ events: [InterceptionEvents.PromptsGet], phase: 'request' }],
  },
  handler: () => validationSuccess('request'),
};

describe('registerInterceptorsOnServer', () => {
  it('advertises capabilities.interceptor from hook events', () => {
    const events = collectSupportedEvents([
      toolsValidator.descriptor,
      promptsValidator.descriptor,
    ]);
    expect(events).toContain(InterceptionEvents.ToolsCall);
    expect(events).toContain(InterceptionEvents.PromptsGet);
  });

  it('lists and filters by event', async () => {
    const { client, server, close } = await connectInterceptorHost([
      toolsValidator,
      promptsValidator,
    ]);

    type Caps = { interceptor?: { supportedEvents: string[] } };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const caps = server.getCapabilities() as Caps;
    expect(caps.interceptor?.supportedEvents).toContain(InterceptionEvents.ToolsCall);

    const all = await listInterceptors(client);
    expect(all.interceptors).toHaveLength(2);

    const toolsOnly = await listInterceptors(client, { event: InterceptionEvents.ToolsCall });
    expect(toolsOnly.interceptors).toHaveLength(1);
    expect(toolsOnly.interceptors[0]?.name).toBe('tools-only');

    await close();
  });

  it('invokes registered handler', async () => {
    const { client, close } = await connectInterceptorHost([
      {
        descriptor: {
          name: 'echo-val',
          type: 'validation',
          hooks: [{ events: [InterceptionEvents.All], phase: 'request' }],
        },
        handler: (params) => ({
          type: 'validation',
          phase: params.phase,
          valid: true,
        }),
      },
    ]);

    const result = await invokeInterceptor(client, {
      name: 'echo-val',
      event: InterceptionEvents.ToolsCall,
      phase: 'request',
      payload: { test: 1 },
    });

    expect(result.type).toBe('validation');
    expect(result.interceptor).toBe('echo-val');

    await close();
  });

  it('invoke throws when interceptor name is unknown', async () => {
    const { client, close } = await connectInterceptorHost([toolsValidator]);

    await expect(
      invokeInterceptor(client, {
        name: 'missing',
        event: InterceptionEvents.ToolsCall,
        phase: 'request',
        payload: {},
      }),
    ).rejects.toThrow(/not found/i);

    await close();
  });

  it('invoke times out slow handlers', async () => {
    const slow: RegisteredInterceptor = {
      descriptor: {
        name: 'slow',
        type: 'validation',
        hooks: [{ events: [InterceptionEvents.All], phase: 'request' }],
      },
      handler: async (_params, signal) => {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 500);
          signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new Error('aborted'));
            },
            { once: true },
          );
        });
        return validationSuccess('request');
      },
    };

    const { client, close } = await connectInterceptorHost([slow]);

    await expect(
      invokeInterceptor(client, {
        name: 'slow',
        event: InterceptionEvents.ToolsCall,
        phase: 'request',
        payload: {},
        timeoutMs: 40,
      }),
    ).rejects.toThrow(/timed out/i);

    await close();
  });
});
