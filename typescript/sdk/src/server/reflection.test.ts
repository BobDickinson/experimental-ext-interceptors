// Copyright 2025 The MCP Interceptors Authors. All rights reserved.

import { describe, it, expect } from 'vitest';
import { InterceptionEvents } from '../protocol/constants.js';
import { validationSuccess } from '../protocol/results.js';
import { buildInterceptorDescriptor } from './interceptor-definition.js';
import { defineInterceptor, invokeHandlerFunction } from './reflection.js';

describe('defineInterceptor / reflection', () => {
  it('builds descriptor metadata from options', () => {
    const d = buildInterceptorDescriptor({
      name: 'bool-validator',
      type: 'validation',
      events: [InterceptionEvents.ToolsCall],
      phase: 'request',
    });
    expect(d.name).toBe('bool-validator');
    expect(d.hooks).toHaveLength(1);
    expect(d.hooks[0]?.events).toContain(InterceptionEvents.ToolsCall);
  });

  it('expands phase both to request and response hooks', () => {
    const d = buildInterceptorDescriptor({
      name: 'sink',
      type: 'sink',
      phase: 'both',
    });
    expect(d.hooks).toHaveLength(2);
    expect(d.hooks.map((h) => h.phase)).toEqual(['request', 'response']);
  });

  it('wraps boolean return as validation result', async () => {
    const reg = defineInterceptor(
      { name: 'bool-validator', type: 'validation', events: [InterceptionEvents.ToolsCall] },
      (payload: unknown) => (payload as { valid?: boolean }).valid === true,
    );

    const ok = await reg.handler({
      name: 'bool-validator',
      event: InterceptionEvents.ToolsCall,
      phase: 'request',
      payload: { valid: true },
    });
    expect(ok.type).toBe('validation');
    if (ok.type === 'validation') {
      expect(ok.valid).toBe(true);
    }

    const bad = await reg.handler({
      name: 'bool-validator',
      event: InterceptionEvents.ToolsCall,
      phase: 'request',
      payload: { valid: false },
    });
    if (bad.type === 'validation') {
      expect(bad.valid).toBe(false);
    }
  });

  it('binds named parameters (payload, event, phase)', async () => {
    const result = await invokeHandlerFunction(
      (payload: unknown, event: string, phase: 'request' | 'response') =>
        validationSuccess(phase),
      'validation',
      {
        name: 'x',
        event: InterceptionEvents.ToolsCall,
        phase: 'request',
        payload: {},
      },
    );
    expect(result.type).toBe('validation');
  });

  it('supports async handlers', async () => {
    const reg = defineInterceptor(
      { name: 'async-val', type: 'validation' },
      async () => {
        await Promise.resolve();
        return validationSuccess('request');
      },
    );
    const result = await reg.handler({
      name: 'async-val',
      event: InterceptionEvents.ToolsCall,
      phase: 'request',
      payload: {},
    });
    expect(result.type).toBe('validation');
  });
});
