// Copyright 2025 The MCP Interceptors Authors. All rights reserved.

import type { Interceptor, InterceptorPhase } from './types.js';

/**
 * Resolves mutation `priorityHint` for the chain phase (SEP priority resolution).
 * Validation interceptors ignore priority; only call this when sorting mutations.
 */
export function resolvePriority(
  interceptor: Pick<Interceptor, 'priorityHint'>,
  phase: InterceptorPhase,
): number {
  const hint = interceptor.priorityHint;
  if (hint === undefined) {
    return 0;
  }
  if (typeof hint === 'number') {
    return hint;
  }
  return hint[phase] ?? 0;
}
