// Copyright 2025 The MCP Interceptors Authors. All rights reserved.
// Use of this source code is governed by a Apache-2.0
// license that can be found in the LICENSE file.

import { InterceptionEvents } from '../protocol/constants.js';
import { resolvePriority } from '../protocol/resolve-priority.js';
import {
  isMutationResult,
  isValidationResult,
} from '../protocol/results.js';
import type {
  ChainAbortInfo,
  ChainValidationSummary,
  ExecuteChainRequestParams,
  Interceptor,
  InterceptorChainResult,
  InterceptorChainStatus,
  InterceptorResult,
  InvokeInterceptorRequestParams,
  SinkInterceptorResult,
} from '../protocol/types.js';

export type InterceptorInvoker = (
  params: InvokeInterceptorRequestParams,
  signal?: AbortSignal,
) => Promise<InterceptorResult>;

export function matchesEvent(hookEvents: string[], requestEvent: string): boolean {
  for (const ev of hookEvents) {
    if (ev === InterceptionEvents.All || ev === requestEvent) {
      return true;
    }
  }
  return false;
}

function filterInterceptors(
  interceptors: Interceptor[],
  chainParams: ExecuteChainRequestParams,
): Interceptor[] {
  const nameFilter = chainParams.interceptors;
  const out: Interceptor[] = [];

  for (const descriptor of interceptors) {
    if (nameFilter && nameFilter.length > 0 && !nameFilter.includes(descriptor.name)) {
      continue;
    }

    let matchesHook = false;
    for (const hook of descriptor.hooks) {
      if (hook.phase !== chainParams.phase) {
        continue;
      }
      if (matchesEvent(hook.events, chainParams.event)) {
        matchesHook = true;
        break;
      }
    }
    if (matchesHook) {
      out.push(descriptor);
    }
  }

  return out;
}

function createInvokeParams(
  descriptor: Interceptor,
  chainParams: ExecuteChainRequestParams,
  currentPayload: unknown,
): InvokeInterceptorRequestParams {
  return {
    name: descriptor.name,
    event: chainParams.event,
    phase: chainParams.phase,
    payload: currentPayload,
    context: chainParams.context,
    timeoutMs: chainParams.timeoutMs,
  };
}

function clonePayload(payload: unknown): unknown {
  if (payload === undefined) {
    return payload;
  }
  return structuredClone(payload);
}

function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) {
    return true;
  }
  return err instanceof Error && err.name === 'TimeoutError';
}

function chainSignal(outer?: AbortSignal, timeoutMs?: number): AbortSignal | undefined {
  if (timeoutMs == null && outer == null) {
    return undefined;
  }
  if (timeoutMs == null) {
    return outer;
  }
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (outer == null) {
    return timeoutSignal;
  }
  return AbortSignal.any([outer, timeoutSignal]);
}

export async function executeInterceptorChain(
  interceptors: Interceptor[],
  invoker: InterceptorInvoker,
  chainParams: ExecuteChainRequestParams,
  signal?: AbortSignal,
): Promise<InterceptorChainResult> {
  const started = Date.now();
  const results: InterceptorResult[] = [];
  const summary: ChainValidationSummary = { errors: 0, warnings: 0, infos: 0 };
  let currentPayload = chainParams.payload;
  let abortInfo: ChainAbortInfo | undefined;
  let status: InterceptorChainStatus = 'success';

  const applicable = filterInterceptors(interceptors, chainParams);
  const mutations = applicable
    .filter((i) => i.type === 'mutation')
    .sort(
      (a, b) =>
        resolvePriority(a, chainParams.phase) - resolvePriority(b, chainParams.phase) ||
        a.name.localeCompare(b.name),
    );
  const validations = applicable.filter((i) => i.type === 'validation');
  const sinks = applicable.filter((i) => i.type === 'sink');

  const ct = chainSignal(signal, chainParams.timeoutMs);

  try {
    if (chainParams.phase === 'request') {
      const mut = await executeMutations(mutations, invoker, chainParams, currentPayload, results, ct);
      currentPayload = mut.payload;
      status = mut.status;
      abortInfo = mut.abortInfo;
      if (status !== 'success') {
        return finish();
      }

      const val = await executeValidations(validations, invoker, chainParams, currentPayload, results, summary, ct);
      status = val.status;
      abortInfo = val.abortInfo;
      if (status !== 'success') {
        return finish();
      }

      await executeSinks(sinks, invoker, chainParams, currentPayload, results, ct);
    } else {
      const val = await executeValidations(validations, invoker, chainParams, currentPayload, results, summary, ct);
      status = val.status;
      abortInfo = val.abortInfo;
      if (status !== 'success') {
        return finish();
      }

      await executeSinks(sinks, invoker, chainParams, currentPayload, results, ct);

      const mut = await executeMutations(mutations, invoker, chainParams, currentPayload, results, ct);
      currentPayload = mut.payload;
      status = mut.status;
      abortInfo = mut.abortInfo;
    }
  } catch (err) {
    if (isAbortError(err, ct)) {
      status = 'timeout';
    } else {
      throw err;
    }
  }

  return finish();

  function finish(): InterceptorChainResult {
    return {
      status,
      event: chainParams.event,
      phase: chainParams.phase,
      results,
      finalPayload: currentPayload,
      validationSummary: summary,
      totalDurationMs: Date.now() - started,
      abortedAt: abortInfo,
    };
  }
}

async function executeMutations(
  mutations: Interceptor[],
  invoker: InterceptorInvoker,
  chainParams: ExecuteChainRequestParams,
  initialPayload: unknown,
  results: InterceptorResult[],
  signal?: AbortSignal,
): Promise<{ payload: unknown; status: InterceptorChainStatus; abortInfo?: ChainAbortInfo }> {
  let currentPayload = initialPayload;

  for (const descriptor of mutations) {
    const isAudit = descriptor.mode === 'audit';
    const failOpen = descriptor.failOpen === true;

    try {
      const invokeParams = createInvokeParams(descriptor, chainParams, currentPayload);
      const sw = Date.now();
      const result = await invoker(invokeParams, signal);
      result.interceptor = descriptor.name;
      result.durationMs = Date.now() - sw;
      results.push(result);

      if (!isAudit && isValidationResult(result)) {
        if (!result.valid && result.severity === 'error') {
          return {
            payload: currentPayload,
            status: 'validation_failed',
            abortInfo: {
              interceptor: descriptor.name,
              reason: result.messages?.[0]?.message ?? 'Validation failed',
              type: 'validation',
            },
          };
        }
        continue;
      }

      if (!isAudit && isMutationResult(result) && result.modified && result.payload !== undefined) {
        currentPayload = clonePayload(result.payload);
      }
    } catch (err) {
      if (isAbortError(err, signal)) {
        throw err;
      }
      if (isAudit || failOpen) {
        continue;
      }
      return {
        payload: currentPayload,
        status: 'mutation_failed',
        abortInfo: {
          interceptor: descriptor.name,
          reason: err instanceof Error ? err.message : String(err),
          type: 'mutation',
        },
      };
    }
  }

  return { payload: currentPayload, status: 'success' };
}

async function executeValidations(
  validations: Interceptor[],
  invoker: InterceptorInvoker,
  chainParams: ExecuteChainRequestParams,
  currentPayload: unknown,
  results: InterceptorResult[],
  summary: ChainValidationSummary,
  signal?: AbortSignal,
): Promise<{ status: InterceptorChainStatus; abortInfo?: ChainAbortInfo }> {
  const completed = await Promise.all(
    validations.map(async (descriptor) => {
      try {
        const invokeParams = createInvokeParams(descriptor, chainParams, currentPayload);
        const sw = Date.now();
        const result = await invoker(invokeParams, signal);
        result.interceptor = descriptor.name;
        result.durationMs = Date.now() - sw;
        return { descriptor, result, error: null as Error | null };
      } catch (err) {
        if (isAbortError(err, signal)) {
          throw err;
        }
        return {
          descriptor,
          result: null as InterceptorResult | null,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    }),
  );

  for (const { descriptor, result, error } of completed) {
    const isAudit = descriptor.mode === 'audit';
    const failOpen = descriptor.failOpen === true;

    if (error) {
      if (isAudit || failOpen) {
        continue;
      }
      return {
        status: 'validation_failed',
        abortInfo: {
          interceptor: descriptor.name,
          reason: error.message,
          type: 'validation',
        },
      };
    }

    if (!result) {
      continue;
    }
    results.push(result);

    if (isValidationResult(result)) {
      if (result.messages) {
        for (const msg of result.messages) {
          switch (msg.severity) {
            case 'error':
              summary.errors++;
              break;
            case 'warn':
              summary.warnings++;
              break;
            case 'info':
              summary.infos++;
              break;
          }
        }
      }

      if (!isAudit && !result.valid && result.severity === 'error') {
        return {
          status: 'validation_failed',
          abortInfo: {
            interceptor: descriptor.name,
            reason: result.messages?.[0]?.message ?? 'Validation failed',
            type: 'validation',
          },
        };
      }
    }
  }

  return { status: 'success' };
}

async function executeSinks(
  sinks: Interceptor[],
  invoker: InterceptorInvoker,
  chainParams: ExecuteChainRequestParams,
  currentPayload: unknown,
  results: InterceptorResult[],
  signal?: AbortSignal,
): Promise<void> {
  const completed = await Promise.all(
    sinks.map(async (descriptor) => {
      try {
        const invokeParams = createInvokeParams(descriptor, chainParams, currentPayload);
        const sw = Date.now();
        const result = await invoker(invokeParams, signal);
        result.interceptor = descriptor.name;
        result.durationMs = Date.now() - sw;
        return result;
      } catch {
        const fallback: SinkInterceptorResult = {
          type: 'sink',
          phase: chainParams.phase,
          interceptor: descriptor.name,
          recorded: false,
        };
        return fallback;
      }
    }),
  );

  results.push(...completed);
}
