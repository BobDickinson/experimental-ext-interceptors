// Copyright 2025 The MCP Interceptors Authors. All rights reserved.

import { validationSuccess } from '../protocol/results.js';
import type {
  InterceptorResult,
  InterceptorType,
  InvokeInterceptorRequestParams,
} from '../protocol/types.js';
import {
  buildInterceptorDescriptor,
  type InterceptorDefinitionOptions,
} from './interceptor-definition.js';
import type { RegisteredInterceptor } from './register-interceptors.js';

export type InterceptorHandlerFn = (...args: unknown[]) =>
  | InterceptorResult
  | Promise<InterceptorResult>
  | boolean
  | Promise<boolean>;

/**
 * Build a {@link RegisteredInterceptor} from a handler function and definition options
 * (TypeScript equivalent of C# `[McpServerInterceptor]` + `ReflectionMcpServerInterceptor`).
 */
export function defineInterceptor(
  options: InterceptorDefinitionOptions,
  fn: InterceptorHandlerFn,
): RegisteredInterceptor {
  return {
    descriptor: buildInterceptorDescriptor(options),
    handler: (params, signal) => invokeHandlerFunction(fn, options.type, params, signal),
  };
}

export async function invokeHandlerFunction(
  fn: InterceptorHandlerFn,
  interceptorType: InterceptorType,
  request: InvokeInterceptorRequestParams,
  signal?: AbortSignal,
): Promise<InterceptorResult> {
  const args = bindHandlerArguments(fn, request, signal);
  let result: unknown = fn(...args);

  if (result && typeof (result as Promise<unknown>).then === 'function') {
    result = await (result as Promise<unknown>);
  }

  return normalizeHandlerResult(result, request.phase, interceptorType);
}

function bindHandlerArguments(
  fn: InterceptorHandlerFn,
  request: InvokeInterceptorRequestParams,
  signal?: AbortSignal,
): unknown[] {
  const params = new Map<string, unknown>([
    ['payload', request.payload],
    ['config', request.config],
    ['event', request.event],
    ['eventname', request.event],
    ['phase', request.phase],
    ['context', request.context],
    ['cancellationtoken', signal],
    ['ct', signal],
  ]);

  const paramNames = getParameterNames(fn);
  if (paramNames.length > 0) {
    return paramNames.map((name) => {
      const key = name.toLowerCase();
      if (params.has(key)) {
        return params.get(key);
      }
      return undefined;
    });
  }

  // Positional fallback (arity-based)
  const arity = fn.length;
  const positional: unknown[] = [request.payload];
  if (arity >= 2) {
    positional.push(request.event);
  }
  if (arity >= 3) {
    positional.push(request.phase);
  }
  if (arity >= 4) {
    positional.push(request.context);
  }
  if (arity >= 5) {
    positional.push(signal);
  }
  return positional.slice(0, arity);
}

function getParameterNames(fn: InterceptorHandlerFn): string[] {
  const src = fn.toString();
  const match = src.match(/^[^(]*\(([^)]*)\)/);
  if (!match?.[1]?.trim()) {
    return [];
  }
  return match[1]
    .split(',')
    .map((p) => p.trim().split(/\s/)[0]?.replace(/[?[\]]/g, '') ?? '')
    .filter((n) => n.length > 0 && n !== '');
}

function normalizeHandlerResult(
  result: unknown,
  phase: InvokeInterceptorRequestParams['phase'],
  interceptorType: InterceptorType,
): InterceptorResult {
  if (typeof result === 'boolean') {
    if (interceptorType !== 'validation') {
      throw new Error(`Boolean return is only supported for validation interceptors`);
    }
    return result
      ? validationSuccess(phase)
      : {
          type: 'validation',
          phase,
          valid: false,
          severity: 'error',
          messages: [{ message: 'Validation failed', severity: 'error' }],
        };
  }

  if (typeof result !== 'object' || result === null || !('type' in result)) {
    throw new Error(
      `Interceptor handler must return InterceptorResult or boolean, got ${typeof result}`,
    );
  }

  const typed = result as InterceptorResult;
  typed.phase = phase;
  return typed;
}
