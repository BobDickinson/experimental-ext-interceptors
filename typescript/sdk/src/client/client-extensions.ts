// Copyright 2025 The MCP Interceptors Authors. All rights reserved.
// Use of this source code is governed by a Apache-2.0
// license that can be found in the LICENSE file.

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { executeInterceptorChainOnClients } from './execute-interceptor-chain-on-clients.js';
import { InterceptorRequestMethods } from '../protocol/constants.js';
import {
  InterceptorResultSchema,
  ListInterceptorsResultSchema,
} from '../protocol/zod-schemas.js';
import type {
  ExecuteChainRequestParams,
  InterceptorChainResult,
  InterceptorResult,
  InvokeInterceptorRequestParams,
  ListInterceptorsRequestParams,
  ListInterceptorsResult,
} from '../protocol/types.js';

export interface InterceptorRequestOptions {
  signal?: AbortSignal;
  /** Wire-level timeout for this request; defaults to the MCP SDK default. */
  timeoutMs?: number;
}

export async function listInterceptors(
  client: Client,
  params?: ListInterceptorsRequestParams,
  options?: InterceptorRequestOptions,
): Promise<ListInterceptorsResult> {
  return client.request(
    {
      method: InterceptorRequestMethods.InterceptorsList,
      params: (params ?? {}) as unknown as Record<string, unknown>,
    },
    ListInterceptorsResultSchema,
    { signal: options?.signal, timeout: options?.timeoutMs },
  );
}

export async function invokeInterceptor(
  client: Client,
  params: InvokeInterceptorRequestParams,
  options?: InterceptorRequestOptions,
): Promise<InterceptorResult> {
  return client.request(
    {
      method: InterceptorRequestMethods.InterceptorInvoke,
      params: params as unknown as Record<string, unknown>,
    },
    InterceptorResultSchema,
    { signal: options?.signal, timeout: options?.timeoutMs ?? params.timeoutMs },
  );
}

export async function executeInterceptorChainOnClient(
  client: Client,
  params: ExecuteChainRequestParams,
  signal?: AbortSignal,
): Promise<InterceptorChainResult> {
  return executeInterceptorChainOnClients([{ client }], params, { signal });
}
