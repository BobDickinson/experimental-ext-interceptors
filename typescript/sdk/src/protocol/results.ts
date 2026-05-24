// Copyright 2025 The MCP Interceptors Authors. All rights reserved.
// Use of this source code is governed by a Apache-2.0
// license that can be found in the LICENSE file.

import type {
  InterceptorPhase,
  InterceptorResult,
  MutationInterceptorResult,
  SinkInterceptorResult,
  ValidationInterceptorResult,
  ValidationMessage,
  ValidationSeverity,
} from './types.js';

export function validationSuccess(phase: InterceptorPhase): ValidationInterceptorResult {
  return { type: 'validation', phase, valid: true };
}

export function validationFailure(
  phase: InterceptorPhase,
  ...messages: ValidationMessage[]
): ValidationInterceptorResult {
  return {
    type: 'validation',
    phase,
    valid: false,
    severity: 'error',
    messages,
  };
}

export function isValidationResult(r: InterceptorResult): r is ValidationInterceptorResult {
  return r.type === 'validation';
}

export function isMutationResult(r: InterceptorResult): r is MutationInterceptorResult {
  return r.type === 'mutation';
}

export function isSinkResult(r: InterceptorResult): r is SinkInterceptorResult {
  return r.type === 'sink';
}

/** Parse a wire JSON value into a discriminated interceptor result. */
export function parseInterceptorResult(value: unknown): InterceptorResult {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Interceptor result must be an object');
  }
  const obj = value as Record<string, unknown>;
  const type = obj.type;
  if (obj.phase !== 'request' && obj.phase !== 'response') {
    throw new Error(`Invalid interceptor result phase: ${String(obj.phase)}`);
  }
  const phase: InterceptorPhase = obj.phase;

  const base = {
    interceptor: typeof obj.interceptor === 'string' ? obj.interceptor : undefined,
    phase,
    durationMs: typeof obj.durationMs === 'number' ? obj.durationMs : undefined,
    info:
      typeof obj.info === 'object' && obj.info !== null
        ? (obj.info as Record<string, unknown>)
        : undefined,
  };

  switch (type) {
    case 'validation':
      return {
        ...base,
        type: 'validation',
        valid: Boolean(obj.valid),
        severity: parseSeverity(obj.severity),
        messages: parseMessages(obj.messages),
        suggestions: parseSuggestions(obj.suggestions),
      };
    case 'mutation':
      return {
        ...base,
        type: 'mutation',
        modified: Boolean(obj.modified),
        payload: obj.payload,
      };
    case 'sink':
      return {
        ...base,
        type: 'sink',
        recorded: Boolean(obj.recorded),
        metrics: parseMetrics(obj.metrics),
      };
    default:
      throw new Error(`Unknown interceptor result type: ${String(type)}`);
  }
}

function parseSeverity(value: unknown): ValidationSeverity | undefined {
  if (value === 'info' || value === 'warn' || value === 'error') {
    return value;
  }
  return undefined;
}

function parseMessages(value: unknown): ValidationMessage[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.map((m) => {
    if (typeof m !== 'object' || m === null) {
      throw new Error('Invalid validation message');
    }
    const msg = m as Record<string, unknown>;
    const severity = parseSeverity(msg.severity);
    if (!severity || typeof msg.message !== 'string') {
      throw new Error('Invalid validation message');
    }
    return {
      path: typeof msg.path === 'string' ? msg.path : undefined,
      message: msg.message,
      severity,
    };
  });
}

function parseSuggestions(
  value: unknown,
): import('./types.js').ValidationSuggestion[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.map((s) => {
    if (typeof s !== 'object' || s === null || typeof (s as { path?: unknown }).path !== 'string') {
      throw new Error('Invalid validation suggestion');
    }
    const sug = s as { path: string; value?: unknown };
    return { path: sug.path, value: sug.value };
  });
}

function parseMetrics(value: unknown): Record<string, number> | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'number') {
      out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
