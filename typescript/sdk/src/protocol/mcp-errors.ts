// Copyright 2025 The MCP Interceptors Authors. All rights reserved.

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

/** JSON-RPC invalid params (-32602), aligned with C# `InterceptorMessageFilter`. */
export function interceptorNotFoundError(interceptorName: string): McpError {
  return new McpError(ErrorCode.InvalidParams, `Interceptor '${interceptorName}' not found`);
}

/** SEP-2624 interceptor timeout: -32000 with `{ interceptor, timeoutMs, phase }` data. */
export function interceptorTimeoutError(
  interceptor: string,
  timeoutMs: number,
  phase: string,
): McpError {
  return new McpError(
    -32000,
    `Interceptor '${interceptor}' timed out after ${timeoutMs}ms`,
    { interceptor, timeoutMs, phase },
  );
}

export function isInvalidParamsError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === ErrorCode.InvalidParams
  );
}
