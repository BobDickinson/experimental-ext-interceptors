// Copyright 2025 The MCP Interceptors Authors. All rights reserved.

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

/** JSON-RPC invalid params (-32602), aligned with C# `InterceptorMessageFilter`. */
export function interceptorNotFoundError(interceptorName: string): McpError {
  return new McpError(ErrorCode.InvalidParams, `Interceptor '${interceptorName}' not found`);
}

export function isInvalidParamsError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === ErrorCode.InvalidParams
  );
}
