/**
 * Integration smoke test: v1 MCP SDK server registration for interceptors/list and SEP capabilities.
 */
import { describe, it, expect } from 'vitest';
import * as z from 'zod/v4';
import { Client } from '@modelcontextprotocol/sdk/client';
import { Server } from '@modelcontextprotocol/sdk/server';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory';
import {
  RequestSchema,
  ResultSchema,
  type ServerCapabilities,
} from '@modelcontextprotocol/sdk/types';

const InterceptorsListRequestSchema = RequestSchema.extend({
  method: z.literal('interceptors/list'),
  params: z
    .object({
      event: z.string().optional(),
    })
    .optional(),
});

const InterceptorsListResultSchema = ResultSchema.extend({
  interceptors: z.array(
    z.object({
      name: z.string(),
      type: z.literal('validation'),
    }),
  ),
});

describe('MCP SDK v1 server wiring', () => {
  it('handles interceptors/list and advertises capabilities.interceptor on the server', async () => {
    const server = new Server(
      { name: 'spike-interceptor-server', version: '0.0.0' },
      { capabilities: {} },
    );

    server.registerCapabilities({
      interceptor: {
        supportedEvents: ['tools/call'],
      },
    } as ServerCapabilities);

    server.setRequestHandler(InterceptorsListRequestSchema, () => ({
      interceptors: [{ name: 'test-validator', type: 'validation' as const }],
    }));

    const client = new Client(
      { name: 'spike-client', version: '0.0.0' },
      { capabilities: {} },
    );

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    // Server retains SEP capability after merge (source of truth for what we advertise).
    type CapsWithInterceptor = ServerCapabilities & {
      interceptor?: { supportedEvents: string[] };
    };
    // v1 Server.getCapabilities() is untyped in @modelcontextprotocol/sdk
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- extension field not in ServerCapabilitiesSchema
    const serverCaps = server.getCapabilities() as CapsWithInterceptor;
    expect(serverCaps).toMatchObject({
      interceptor: { supportedEvents: ['tools/call'] },
    });

    // v1 Client parses initialize with ServerCapabilitiesSchema (no `interceptor` field).
    const caps = client.getServerCapabilities();
    expect(caps?.interceptor).toBeUndefined();

    const listResult = await client.request(
      { method: 'interceptors/list', params: {} },
      InterceptorsListResultSchema,
    );

    expect(listResult.interceptors).toHaveLength(1);
    expect(listResult.interceptors[0]?.name).toBe('test-validator');

    await Promise.all([client.close(), server.close()]);
  });
});
