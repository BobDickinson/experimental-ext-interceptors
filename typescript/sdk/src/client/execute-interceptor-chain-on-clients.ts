// Copyright 2025 The MCP Interceptors Authors. All rights reserved.

import { executeInterceptorChain } from './chain-orchestrator.js';
import { invokeInterceptor } from './client-extensions.js';
import type { InterceptorChainHost, MergeInterceptorChainEntriesOptions } from './interceptor-chain-entry.js';
import {
  clientByInterceptorName,
  interceptorsFromEntries,
  listInterceptorChainEntries,
  mergeInterceptorChainEntries,
} from './merge-interceptor-chain-entries.js';
import type { ExecuteChainRequestParams, InterceptorChainResult } from '../protocol/types.js';

export interface ExecuteInterceptorChainOnClientsOptions extends MergeInterceptorChainEntriesOptions {
  signal?: AbortSignal;
}

/**
 * SEP-aligned multi-host chain: discover on each client, merge, then run
 * {@link executeInterceptorChain} with routed `interceptor/invoke` calls.
 */
export async function executeInterceptorChainOnClients(
  hosts: InterceptorChainHost[],
  params: ExecuteChainRequestParams,
  options?: ExecuteInterceptorChainOnClientsOptions,
): Promise<InterceptorChainResult> {
  if (hosts.length === 0) {
    throw new Error('At least one interceptor host is required');
  }

  const listed = await listInterceptorChainEntries(hosts, { event: params.event });
  const entries = mergeInterceptorChainEntries(listed, {
    duplicateNamePolicy: options?.duplicateNamePolicy,
  });
  const clients = clientByInterceptorName(entries);

  return executeInterceptorChain(
    interceptorsFromEntries(entries),
    (invokeParams) => {
      const client = clients.get(invokeParams.name);
      if (!client) {
        throw new Error(`No host registered for interceptor '${invokeParams.name}'`);
      }
      return invokeInterceptor(client, invokeParams);
    },
    params,
    options?.signal,
  );
}
