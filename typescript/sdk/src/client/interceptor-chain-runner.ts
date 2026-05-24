// Copyright 2025 The MCP Interceptors Authors. All rights reserved.

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { throwChainFailure } from '../protocol/errors.js';
import type {
  ExecuteChainRequestParams,
  InterceptorChainResult,
  InterceptorPhase,
  InvokeInterceptorContext,
} from '../protocol/types.js';
import { executeInterceptorChainOnClients } from './execute-interceptor-chain-on-clients.js';
import type { DuplicateInterceptorNamePolicy } from './interceptor-chain-entry.js';

export interface InterceptorChainRunnerOptions {
  interceptorClients: Client[];
  /** When set, only these lifecycle events are intercepted. */
  events?: string[];
  timeoutMs?: number;
  defaultContext?: InvokeInterceptorContext;
  /** Passed to multi-host chain merge when more than one interceptor client is configured. */
  duplicateNamePolicy?: DuplicateInterceptorNamePolicy;
}

export class InterceptorChainRunner {
  private readonly clients: Client[];
  private readonly events: string[] | undefined;
  private readonly timeoutMs: number | undefined;
  private readonly defaultContext: InvokeInterceptorContext | undefined;
  private readonly duplicateNamePolicy: DuplicateInterceptorNamePolicy | undefined;

  constructor(options: InterceptorChainRunnerOptions) {
    this.clients = options.interceptorClients;
    this.events = options.events;
    this.timeoutMs = options.timeoutMs;
    this.defaultContext = options.defaultContext;
    this.duplicateNamePolicy = options.duplicateNamePolicy;
  }

  shouldIntercept(eventName: string): boolean {
    if (!this.events || this.events.length === 0) {
      return true;
    }
    return this.events.includes(eventName);
  }

  async runChainPhase(
    eventName: string,
    phase: InterceptorPhase,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<{ payload: unknown; chainResult: InterceptorChainResult }> {
    const currentPayload = payload;

    const chainParams: ExecuteChainRequestParams = {
      event: eventName,
      phase,
      payload: currentPayload,
      timeoutMs: this.timeoutMs,
      context: this.defaultContext,
    };

    const chainResult = await executeInterceptorChainOnClients(
      this.clients.map((client, index) => ({ client, label: `host-${index}` })),
      chainParams,
      { signal, duplicateNamePolicy: this.duplicateNamePolicy },
    );

    if (chainResult.status !== 'success') {
      return { payload: currentPayload, chainResult };
    }

    return {
      payload: chainResult.finalPayload ?? currentPayload,
      chainResult,
    };
  }

  async runChainPhaseOrThrow(
    operation: string,
    eventName: string,
    phase: InterceptorPhase,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const { payload: processed, chainResult } = await this.runChainPhase(
      eventName,
      phase,
      payload,
      signal,
    );
    if (chainResult.status !== 'success') {
      throwChainFailure(operation, phase, chainResult.status, chainResult);
    }
    return processed;
  }
}
