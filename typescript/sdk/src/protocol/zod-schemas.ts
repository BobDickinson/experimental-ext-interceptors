// Copyright 2025 The MCP Interceptors Authors. All rights reserved.
// Use of this source code is governed by a Apache-2.0
// license that can be found in the LICENSE file.

import * as z from 'zod/v4';
import { RequestSchema, ResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { InterceptorRequestMethods } from './constants.js';

const InterceptorPhaseSchema = z.enum(['request', 'response']);
const InterceptorTypeSchema = z.enum(['validation', 'mutation', 'sink']);
/** Accept C# SDK `"active"` on the wire and normalize to SEP `"enforce"`. */
const InterceptorModeSchema = z
  .enum(['enforce', 'audit', 'active'])
  .transform((mode): 'enforce' | 'audit' => (mode === 'active' ? 'enforce' : mode));
const ValidationSeveritySchema = z.enum(['info', 'warn', 'error']);

const PriorityHintByPhaseSchema = z.object({
  request: z.number().optional(),
  response: z.number().optional(),
});

const PriorityHintSchema = z.union([z.number(), PriorityHintByPhaseSchema]);

export const InterceptorHookSchema = z.object({
  events: z.array(z.string()),
  phase: InterceptorPhaseSchema,
});

export const InterceptorSchema = z.object({
  name: z.string(),
  version: z.string().optional(),
  description: z.string().optional(),
  type: InterceptorTypeSchema,
  hooks: z.array(InterceptorHookSchema),
  mode: InterceptorModeSchema.optional(),
  failOpen: z.boolean().optional(),
  priorityHint: PriorityHintSchema.optional(),
  compat: z
    .object({
      minProtocol: z.string(),
      maxProtocol: z.string().optional(),
    })
    .optional(),
  configSchema: z.unknown().optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
});

export const ListInterceptorsRequestSchema = RequestSchema.extend({
  method: z.literal(InterceptorRequestMethods.InterceptorsList),
  params: z
    .object({
      cursor: z.string().optional(),
      event: z.string().optional(),
      _meta: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

export const ListInterceptorsResultSchema = ResultSchema.extend({
  interceptors: z.array(InterceptorSchema),
  nextCursor: z.string().optional(),
});

export const InvokeInterceptorRequestSchema = RequestSchema.extend({
  method: z.literal(InterceptorRequestMethods.InterceptorInvoke),
  params: z.object({
    name: z.string(),
    event: z.string(),
    phase: InterceptorPhaseSchema,
    payload: z.unknown(),
    config: z.unknown().optional(),
    timeoutMs: z.number().optional(),
    context: z.unknown().optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  }),
});

const InterceptorResultBaseSchema = z.object({
  interceptor: z.string().optional(),
  phase: InterceptorPhaseSchema,
  durationMs: z.number().optional(),
  info: z.record(z.string(), z.unknown()).optional(),
});

export const ValidationInterceptorResultSchema = InterceptorResultBaseSchema.extend({
  type: z.literal('validation'),
  valid: z.boolean(),
  severity: ValidationSeveritySchema.optional(),
  messages: z
    .array(
      z.object({
        path: z.string().optional(),
        message: z.string(),
        severity: ValidationSeveritySchema,
      }),
    )
    .optional(),
  suggestions: z
    .array(
      z.object({
        path: z.string(),
        value: z.unknown().optional(),
      }),
    )
    .optional(),
});

export const MutationInterceptorResultSchema = InterceptorResultBaseSchema.extend({
  type: z.literal('mutation'),
  modified: z.boolean(),
  payload: z.unknown().optional(),
});

export const SinkInterceptorResultSchema = InterceptorResultBaseSchema.extend({
  type: z.literal('sink'),
  recorded: z.boolean(),
  metrics: z.record(z.string(), z.number()).optional(),
});

export const InterceptorResultSchema = z.discriminatedUnion('type', [
  ValidationInterceptorResultSchema,
  MutationInterceptorResultSchema,
  SinkInterceptorResultSchema,
]);
