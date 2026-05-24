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

export async function listInterceptors(
  client: Client,
  params?: ListInterceptorsRequestParams,
): Promise<ListInterceptorsResult> {
  return client.request(
    {
      method: InterceptorRequestMethods.InterceptorsList,
      params: (params ?? {}) as unknown as Record<string, unknown>,
    },
    ListInterceptorsResultSchema,
  );
}

export async function invokeInterceptor(
  client: Client,
  params: InvokeInterceptorRequestParams,
): Promise<InterceptorResult> {
  return client.request(
    {
      method: InterceptorRequestMethods.InterceptorInvoke,
      params: params as unknown as Record<string, unknown>,
    },
    InterceptorResultSchema,
  );
}

export async function executeInterceptorChainOnClient(
  client: Client,
  params: ExecuteChainRequestParams,
  signal?: AbortSignal,
): Promise<InterceptorChainResult> {
  return executeInterceptorChainOnClients([{ client }], params, { signal });
}
