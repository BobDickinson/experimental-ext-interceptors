// Copyright 2025 The MCP Interceptors Authors. All rights reserved.
// Use of this source code is governed by a Apache-2.0
// license that can be found in the LICENSE file.

export type InterceptorType = 'validation' | 'mutation' | 'sink';

export type InterceptorPhase = 'request' | 'response';

/** SEP wire value for normal blocking / transforming behavior (default when omitted). */
export type InterceptorMode = 'enforce' | 'audit';

export type ValidationSeverity = 'info' | 'warn' | 'error';

export type InterceptorChainStatus =
  | 'success'
  | 'validation_failed'
  | 'mutation_failed'
  | 'timeout';

export interface InterceptorHook {
  events: string[];
  phase: InterceptorPhase;
}

export interface InterceptorCompatibility {
  minProtocol: string;
  maxProtocol?: string;
}

/** Per-phase mutation ordering hint (SEP-1763). Omitted sides default to 0. */
export interface PriorityHintByPhase {
  request?: number;
  response?: number;
}

/** Scalar applies to both phases; object selects per phase. */
export type PriorityHint = number | PriorityHintByPhase;

export interface Interceptor {
  name: string;
  version?: string;
  description?: string;
  type: InterceptorType;
  hooks: InterceptorHook[];
  mode?: InterceptorMode;
  failOpen?: boolean;
  priorityHint?: PriorityHint;
  compat?: InterceptorCompatibility;
  configSchema?: unknown;
  _meta?: Record<string, unknown>;
}

export interface ValidationMessage {
  path?: string;
  message: string;
  severity: ValidationSeverity;
}

export interface ValidationSuggestion {
  path: string;
  value?: unknown;
}

export interface InterceptorPrincipal {
  type: string;
  id?: string;
  claims?: Record<string, unknown>;
}

export interface InvokeInterceptorContext {
  principal?: InterceptorPrincipal;
  traceId?: string;
  spanId?: string;
  timestamp?: string;
  sessionId?: string;
}

export interface InterceptorResultBase {
  type: InterceptorType;
  interceptor?: string;
  phase: InterceptorPhase;
  durationMs?: number;
  info?: Record<string, unknown>;
}

export interface ValidationInterceptorResult extends InterceptorResultBase {
  type: 'validation';
  valid: boolean;
  severity?: ValidationSeverity;
  messages?: ValidationMessage[];
  suggestions?: ValidationSuggestion[];
}

export interface MutationInterceptorResult extends InterceptorResultBase {
  type: 'mutation';
  modified: boolean;
  payload?: unknown;
}

export interface SinkInterceptorResult extends InterceptorResultBase {
  type: 'sink';
  recorded: boolean;
  metrics?: Record<string, number>;
}

export type InterceptorResult =
  | ValidationInterceptorResult
  | MutationInterceptorResult
  | SinkInterceptorResult;

export interface ListInterceptorsRequestParams {
  cursor?: string;
  event?: string;
  _meta?: Record<string, unknown>;
}

export interface ListInterceptorsResult {
  interceptors: Interceptor[];
  nextCursor?: string;
}

export interface InvokeInterceptorRequestParams {
  name: string;
  event: string;
  phase: InterceptorPhase;
  payload: unknown;
  config?: unknown;
  timeoutMs?: number;
  context?: InvokeInterceptorContext;
  _meta?: Record<string, unknown>;
}

export interface ExecuteChainRequestParams {
  event: string;
  phase: InterceptorPhase;
  payload: unknown;
  /** Optional name filter (wire property: `interceptors`). */
  interceptors?: string[];
  config?: unknown;
  timeoutMs?: number;
  context?: InvokeInterceptorContext;
}

export interface ChainValidationSummary {
  errors: number;
  warnings: number;
  infos: number;
}

export interface ChainAbortInfo {
  interceptor: string;
  reason: string;
  type: string;
}

export interface InterceptorChainResult {
  status: InterceptorChainStatus;
  event?: string;
  phase: InterceptorPhase;
  results: InterceptorResult[];
  finalPayload?: unknown;
  validationSummary?: ChainValidationSummary;
  totalDurationMs: number;
  abortedAt?: ChainAbortInfo;
}

export interface InterceptorsCapability {
  supportedEvents: string[];
}
