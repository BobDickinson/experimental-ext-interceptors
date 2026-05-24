# MCP Interceptors TypeScript SDK — Design and Implementation

## Introduction

This document is the **authoritative design reference** for the TypeScript Interceptor SDK shipped from `/typescript/sdk` as **`mcp-ext-interceptors`**. It defines what the package does, how it is structured, and how it integrates with the official MCP TypeScript SDK.

Readers should use this document to implement or review the SDK. Normative interceptor protocol behavior is defined in [SEP-1763](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1763) ([`docs/sep.md`](../../docs/sep.md) in this repository). Behavioral parity with the in-repo **C# Interceptor SDK** ([`csharp/sdk`](../../csharp/sdk)) is a primary goal.

The plan distinguishes two relationships to the MCP TypeScript SDK:

| Role | What | Where |
|------|------|--------|
| **Runtime dependency** | Code this package **imports at build and run time** | npm **`@modelcontextprotocol/sdk` v1.x** (`Client`, `Server` / `McpServer`, transports, protocol types) |
| **Structural reference** | How a mature MCP TypeScript SDK **organizes** client, server, protocol, tests, and public exports | Sibling repo **`typescript-sdk`** on **main** ([`../typescript-sdk`](../../typescript-sdk) when checked out beside this repo)—**not** a dependency |

Implementation targets **v1** today while following **v2-shaped** module boundaries inside a **single** published package, so a later move to `@modelcontextprotocol/client` and `@modelcontextprotocol/server` is mostly adapter rewrites rather than a redesign.

---

## 1. Scope and requirements

### 1.1 Product scope

- Implement the interceptor protocol from [SEP-1763](/docs/sep.md): wire methods, execution semantics, capability advertisement, and SDK conveniences (chain orchestration, hosting interceptors on an **interceptor host**, client helpers, and a **transparent gateway**).
- Provide **client**, **server**, and **gateway** APIs in one npm package, comparable in depth to the C# Interceptor SDK in this repository.
- Include **integration tests** where a client built with this SDK talks to a server built with this SDK over an in-process or equivalent transport, covering list, invoke, and chain execution.
- Ship **runnable examples** under `examples/`, modeled on the C# SDK’s [`csharp/sdk/samples`](../../csharp/sdk/samples) (see §10)—not part of the published npm artifact.

### 1.2 Package and tooling

- **Location:** `/typescript/sdk`, package name **`mcp-ext-interceptors`**.
- **Preserve** existing project configuration unless there is a strong, documented reason to change it: Node **≥20**, ESM, **`tsc`** → `dist/`, **Vitest**, **ESLint**, single root **`exports`** entry.
- **Publishing:** One npm package with logical modules under `src/` (`protocol`, `client`, `server`, `gateway`), not a multi-package monorepo like upstream `typescript-sdk`.
- **Dependencies:** **`peerDependencies`** on `@modelcontextprotocol/sdk` **^1.x**; matching **`devDependencies`** on the same range for reproducible CI and local tests.

### 1.3 MCP TypeScript SDK strategy

**Runtime (v1):** Import and use only **`@modelcontextprotocol/sdk`**. Do not depend on v2 workspace packages (`@modelcontextprotocol/client`, `@modelcontextprotocol/server`, `@modelcontextprotocol/core`). Use the MCP SDK for JSON-RPC sessions, transports, `Client` / `Server` / `McpServer`, and standard MCP types—do not reimplement core protocol plumbing.

**Structure (v2 reference):** When making layout, naming, export, or handler-registration choices, align with conventions on **`typescript-sdk` main**: separate client vs server concerns, curated public `index` exports, Vitest layout, and explicit registration of non-spec JSON-RPC methods. Reconcile with that repo as it evolves; do not vendor or link it as a dependency.

**Forward portability:** Keep interceptor-specific logic free of v1 types in `src/protocol` and `src/client/chain-orchestrator.ts`. Confine v1-only typing and handler registration to **`src/server/register-interceptors.ts`**, **`src/server/capabilities.ts`**, and **`src/client/client-extensions.ts`**. Avoid subclassing MCP SDK types in public interceptor APIs.

**Later migration:** When v2 MCP packages are stable for consumers, change `peerDependencies` and those adapter modules to `@modelcontextprotocol/client` + `@modelcontextprotocol/server`. SEP DTOs, chain ordering, and gateway orchestration concepts should remain unchanged.

### 1.4 Capability advertisement (TypeScript default)

**Interceptor hosts** advertise support per the SEP: **`capabilities.interceptor`** with **`supportedEvents`**. The C# SDK in this repo uses **`ServerCapabilities.Extensions["interceptors"]`** instead; that difference is **documented for interoperability** (see §3) but **not** the TypeScript default wire shape.

---

## 2. Interceptor model

Per SEP-1763 (with terminology clarified for this SDK):

### 2.1 Primitive vs hosts

- An **interceptor** is an MCP **primitive** (governance logic for context operations)—analogous to tools, resources, and prompts, but with a different invocation model (see SEP).
- Interceptors are **discoverable** and **invocable** via JSON-RPC (`interceptors/list`, `interceptor/invoke`) on an **interceptor host**: an MCP-protocol **endpoint** that speaks the normal MCP session stack (`initialize`, JSON-RPC, transports) and advertises **`capabilities.interceptor`**. The SEP says interceptors are “hosted on MCP servers”; here **interceptor host** means that protocol role without implying the host is your **application MCP server**.
- An **application (backend) MCP server** is the server clients usually connect to for **tools**, **resources**, **prompts**, and related lifecycle events. It is a **different role** from an interceptor host. Deployments often use **client → interceptor host(s) → backend server** (see C# **`McpInterceptorGateway`** and SEP sidecar/proxy narrative). An interceptor host may expose **only** interceptor methods plus minimal MCP plumbing, or colocate interceptors with a backend—still two concerns: **governance primitives** vs **agent-facing capabilities**.
- **Validators** return pass/fail with severity and messages. **Mutators** return possibly modified payloads. **Sinks** are observe-only and non-blocking; the C# SDK treats **`sink`** as a first-class `InterceptorType`.
- Interceptors attach to **lifecycle events** (e.g. `tools/call`, `resources/read`, `prompts/get`, `llm/completion`) and a **phase** (`request`, `response`, or both).

### 2.2 Chain execution

- **Chain execution** calls **`interceptors/list`** on one or more interceptor hosts, then **`interceptor/invoke`** on the host that registered each interceptor, following the SEP trust-boundary-aware ordering:
  - **Request (sending):** mutations (sequential by ascending `priorityHint`, name tie-break) → validations (parallel) → sinks (fire-and-forget).
  - **Response (receiving):** validations (parallel) → sinks (fire-and-forget) → mutations (sequential).
- **`mode`:** `enforce` vs `audit` (shadow validation / mutation). **`failOpen`:** whether failures allow the message to proceed (per SEP rules).

If the SEP text conflicts with itself, follow **normative** sections of [`docs/sep.md`](../../docs/sep.md) for wire methods and payloads. Where the SEP is silent or ambiguous, match behavior of the **C# reference** (e.g. **`interceptors/list`**, not `interceptor/list`).

---

## 3. Wire protocol and capabilities

### 3.1 JSON-RPC methods

| Method | Params | Result |
|--------|--------|--------|
| `interceptors/list` | Optional `{ event?: string }` | `{ interceptors: Interceptor[] }` |
| `interceptor/invoke` | `name`, `event`, `phase`, `payload`, optional `config`, `context`, `timeoutMs` | Polymorphic result: `validation` \| `mutation` \| `sink` |

### 3.2 Interceptor host capability (`initialize`)

Per the SEP, interceptor hosts include:

```json
{
  "capabilities": {
    "interceptor": {
      "supportedEvents": ["tools/call", "..."]
    }
  }
}
```

**C# interoperability:** The C# Interceptor SDK advertises the same logical data under **`capabilities.extensions["interceptors"]`** via the C# MCP SDK extension API. Mixed deployments may need dual-read logic or bridges; see package **README** (Capabilities section).

**Discovery with v1 `@modelcontextprotocol/sdk` Client:** The server should set capability via `registerCapabilities` (see §5). The stock v1 **`Client`** parses `initialize` with `ServerCapabilitiesSchema`, which does **not** include `interceptor`, so **`getServerCapabilities().interceptor` is undefined** even when the server advertised it on the wire. Clients using this interceptor SDK should treat **`interceptors/list`** (or handling a standard JSON-RPC error when unsupported) as the reliable discovery path—not typed `interceptor` on parsed server capabilities.

---

## 4. Reference material in this repository

### 4.1 C# Interceptor SDK

Primary behavioral reference for parity:

| Area | C# concept |
|------|------------|
| Wire methods | `interceptors/list`, `interceptor/invoke` |
| Protocol DTOs | `Protocol/*` — descriptors, invoke/chain params, polymorphic `InterceptorResult`, events, phases, LLM payloads |
| Client | `McpClientInterceptorExtensions`, `InterceptorChainOrchestrator`, `InterceptingMcpClient` |
| Server | `InterceptorMessageFilter`, `McpServerInterceptorBuilderExtensions`, `ReflectionMcpServerInterceptor` |
| Gateway | `McpInterceptorGateway`, `InterceptorChainRunner`, transparent proxy + optional SEP passthrough |
| Init capability | `Extensions["interceptors"]` (not SEP’s top-level `interceptor` field) |

TypeScript uses **`Server.setRequestHandler`** for extension methods where C# uses incoming **message filters**, because the v1 TypeScript SDK exposes handler registration publicly.

### 4.2 TypeScript package today

The SDK is **implemented** end-to-end: protocol types, client extensions and chain orchestration (including multi-host merge), interceptor host registration, reflection helpers, transparent gateway, runnable examples, and package **README**. **73 Vitest tests**; `npm run build`, `npm test`, and `npm run lint` are green.

Build: `tsc -p tsconfig.build.json` → `dist/`; lint uses `tsconfig.eslint.json` (includes test files).

**Optional / deferred:** golden JSON protocol fixtures vs C# `ProtocolTypesSerializationTests.cs`; full C# gateway test matrix parity (~33 cases in C#; TypeScript gateway integration has 13 cases in `mcp-interceptor-gateway.test.ts`).

### 4.3 Known gaps vs C# (intentional or subset)

| Area | C# | TypeScript today |
|------|-----|------------------|
| Init capability wire shape | `extensions["interceptors"]` | SEP `capabilities.interceptor` (documented; README) |
| Server registration | `InterceptorMessageFilter` on incoming messages | `Server.setRequestHandler` for extension methods (§4.1) |
| Builder / host helpers | `IMcpServerBuilder`, filter pipeline | `registerInterceptorsOnServer` only (no separate `interceptor-host.ts` helper) |
| `InterceptingMcpClient` tests | Broad gateway-overlap scenarios | One E2E: `tools/call` request mutation; API covers list/prompts/resources/subscribe |
| `McpInterceptorGateway` | ASP.NET `WithInterceptorGateway` builder extensions | `createAsync`, `interceptorServerConnections`, `interceptorServerConnectionResolver`, `dispose` (no DI builder) |
| Gateway tests | `McpInterceptorGatewayTests` + `GatewayComponentsTests` | 13 gateway integration tests (subset of full C# matrix) |
| Validation over transparent proxy | In-process exception types | JSON-RPC `McpError` to connecting clients (not `McpInterceptorValidationException`) |
| `serverInfo` override | `McpServerOptions.ServerInfo` | `McpInterceptorGatewayOptions.serverInfo` documented; v1 `Server` identity is fixed at `new Server(...)` construction |
| `GatewayChainSample` | Two stdio interceptor clients + nested `InterceptingMcpClient` | `examples/gateway-chain` is a **simplified** walkthrough; use `McpInterceptorGateway` with `interceptorClients: [first, second]` for ordered multi-host chains |
| LLM completion | Protocol + samples | `LlmCompletion*` **types** only; no `llm/completion` client/gateway wiring |
| Examples packaging | Per-sample `.csproj` | `interceptor-server` and `interceptor-client` have `package.json`; other examples are single `src/index.ts` + root `npm run example:*` |

### 4.3.1 Differences from the C# SDK (intentional)

#### Interceptor `mode`: `enforce` (TypeScript / SEP) vs `active` (C#)

| | Wire / API value | Meaning |
|---|------------------|--------|
| **SEP-1763** | `enforce` \| `audit` | `enforce` = normal blocking and mutation application; `audit` = shadow / non-blocking |
| **C# Interceptor SDK** | `active` \| `audit` | `InterceptorMode.Active` serializes as `"active"` (same semantics as SEP `enforce`) |
| **TypeScript SDK** | `enforce` \| `audit` | Matches the SEP on the wire and in `InterceptorMode` |

**Why TypeScript uses `enforce`:** The normative spec ([`docs/sep.md`](../../docs/sep.md)) names the default mode **`enforce`**. The in-repo C# SDK predates or diverges from that string and uses **`active`** instead. TypeScript defaults to **SEP-shaped** protocol types in this package (same rationale as `capabilities.interceptor` vs C# `extensions["interceptors"]`).

**Interop:** When parsing descriptors from a C# interceptor host, Zod accepts **`mode: "active"`** and normalizes it to **`enforce`** before chain execution. New TypeScript hosts and samples should emit **`enforce`** or omit `mode` (orchestrator treats omitted as enforcing). Do not emit `active` from TypeScript servers.

**C# team:** Aligning C# to `enforce` would match the SEP and this SDK; until then, mixed deployments should expect TS clients to accept `active` on read only.

#### `priorityHint` per phase (SEP) vs scalar only (C#)

| | `priorityHint` shape | Mutation ordering |
|---|----------------------|-------------------|
| **SEP-1763** | `number` **or** `{ request?: number; response?: number }` | `resolvePriority(interceptor, phase)`; missing side → `0`; validations ignore priority |
| **C# Interceptor SDK** | `int?` only | `.OrderBy(i => i.PriorityHint ?? 0)` — same value for both phases |
| **TypeScript SDK** | `PriorityHint` union + Zod parse | `resolvePriority()` in `chain-orchestrator` when sorting mutations |

**Why TypeScript implements the object form:** The SEP allows different mutation order on request vs response (e.g. redact early on request, sanitize late on response). Scalar `priorityHint` still works unchanged. **`resolvePriority`** is exported from the package for hosts/tools that need the same rule.

**C# team:** Add a `PriorityHint` DTO or `JsonElement` on `Interceptor`, implement the same `resolvePriority` in `InterceptorChainOrchestrator`, and optionally extend `McpServerInterceptorAttribute` if reflection should set per-phase values.

### 4.4 MCP TypeScript SDK v2 (`typescript-sdk`) as structural reference

Sibling repository **`../typescript-sdk`** (official MCP TypeScript SDK **v2** on **main**). Use it only for **conventions**, not as a runtime dependency.

Relevant patterns to mirror:

- **Modules:** `protocol`-like types in `src/protocol`; client patterns in `src/client`; server patterns in `src/server`; gateway in `src/gateway`.
- **Public API:** Named exports only from the package entry; no wildcard re-exports; new exports are API commitments (see `packages/client/src/index.ts` and `packages/server/src/index.ts`).
- **Custom methods (v2 shape):** `setRequestHandler('method', { params, result }, handler)` on `Protocol` / `Server`—the target shape when migrating off v1.
- **Tooling reference:** Vitest workspace, TypeScript 5.9.x, ESLint 9—upgrade this package’s Vitest only when there is clear benefit.

Upstream publishes **multiple** packages (`@modelcontextprotocol/client`, `@modelcontextprotocol/server`, private `@modelcontextprotocol/core`). This interceptor package stays **one** artifact with v2-**shaped** folders inside `src/`.

---

## 5. Integration with `@modelcontextprotocol/sdk` (v1)

Pinned baseline for design decisions: **v1.29.x** (representative of **^1.x**).

### 5.1 Surfaces used

| Concern | v1 API | Interceptor usage |
|---------|--------|-------------------|
| Client | `Client`, transports (`InMemoryTransport`, stdio, HTTP/SSE as needed) | Extension requests; `InterceptingMcpClient` to backend + interceptor hosts |
| Interceptor host | `Server`, `McpServer` (`mcpServer.server` for registration) | `interceptors/list`, `interceptor/invoke`; capability merge on `initialize` |
| Types | `RequestSchema`, `ResultSchema`, MCP tool/resource/prompt types | Payloads and Zod schemas for extension methods |
| Out of scope | — | JSON-RPC framing, session lifecycle, core MCP method dispatch |

Import subpaths: `@modelcontextprotocol/sdk/client`, `/server`, `/inMemory`, `/types` (as supported by the package exports map).

### 5.2 Registering extension methods on the server

v1 **`Server.setRequestHandler`** takes a **Zod request schema** (with a **`method` literal**), not v2’s three-argument `(method, { params, result }, handler)` form.

```ts
import * as z from 'zod/v4';
import { RequestSchema, ResultSchema } from '@modelcontextprotocol/sdk/types';
import { Server } from '@modelcontextprotocol/sdk/server';

const InterceptorsListRequestSchema = RequestSchema.extend({
  method: z.literal('interceptors/list'),
  params: z.object({ event: z.string().optional() }).optional(),
});

const InterceptorsListResultSchema = ResultSchema.extend({
  interceptors: z.array(/* Interceptor descriptor schema */),
});

server.setRequestHandler(InterceptorsListRequestSchema, async (request) => {
  return { interceptors: [] };
});
```

Apply the same pattern for **`interceptor/invoke`** with params and result schemas aligned to SEP and `src/protocol` types.

**Capability checks:** v1 `assertRequestHandlerCapability` only validates known spec methods. **`interceptors/list`** and **`interceptor/invoke`** are outside that switch and require **no** extra capability flag for handler registration to succeed.

Implement registration in **`src/server/register-interceptors.ts`** only.

### 5.3 Advertising `capabilities.interceptor`

```ts
import type { ServerCapabilities } from '@modelcontextprotocol/sdk/types';

server.registerCapabilities({
  interceptor: { supportedEvents: ['tools/call'] },
} as ServerCapabilities);
```

`mergeCapabilities` shallow-merges into internal server state; **`initialize`** returns `getCapabilities()` unchanged, so **`interceptor` appears on the wire**. The v1 TypeScript type for `ServerCapabilities` omits `interceptor`; confine the assertion to **`src/server/capabilities.ts`**.

Do **not** use `extensions.interceptors` as the default—that matches C# but not the SEP shape chosen for TypeScript.

### 5.4 Client extension requests

```ts
await client.request(
  { method: 'interceptors/list', params: {} },
  InterceptorsListResultSchema,
);
```

Implement in **`src/client/client-extensions.ts`**. Deserialize into types from **`src/protocol`**.

### 5.5 Migration to v2 MCP packages (expected touch points)

When switching runtime dependency to `@modelcontextprotocol/client` + `@modelcontextprotocol/server`:

1. `package.json` peer (and dev) dependencies and import paths.
2. **`src/server/register-interceptors.ts`** — adopt `setRequestHandler(method, { params, result }, handler)`.
3. **`src/server/capabilities.ts`** — re-check capability types and merge APIs in v2 core.
4. **`src/client/client-extensions.ts`** — client `request` typing and imports.
5. Test transport imports.

**Unchanged across migration:** `src/protocol/*`, `src/client/chain-orchestrator.ts`, gateway orchestration design, SEP ordering semantics.

---

## 6. Package layout

Single `package.json`, single published `"."` export (optional subpath exports only with deliberate `package.json` change):

```text
src/
  index.ts                      # public barrel (named exports only)
  protocol/
    constants.ts, types.ts, results.ts, zod-schemas.ts, errors.ts, llm-payload.ts
  client/
    client-extensions.ts        # list / invoke / executeChainOnClient
    chain-orchestrator.ts       # SEP chain ordering (no MCP SDK imports)
    interceptor-chain-runner.ts           # multi-host chain runner (client + gateway)
    execute-interceptor-chain-on-clients.ts
    merge-interceptor-chain-entries.ts
    intercepting-client.ts                # InterceptingMcpClient
  server/
    register-interceptors.ts
    capabilities.ts
    interceptor-definition.ts
    reflection.ts               # defineInterceptor
  gateway/
    mcp-interceptor-gateway.ts
    gateway-proxy-configurator.ts
    gateway-protocol-bridge.ts  # optional exposeInterceptorProtocol
    proxy-request.ts
  __tests__/
    fixtures/hosts.ts           # connectInterceptorHost, connectEchoBackend
    integration/                # client-extensions, intercepting-client, mcp-interceptor-gateway
    v1-server-wiring.test.ts
```

Cross-language naming:

| C# (`ExecuteChainAsync`) | TypeScript |
|--------------------------|------------|
| Orchestrator only | `executeInterceptorChain(interceptors, invoker, params, signal?)` |
| `McpClient` + list + invoke | `executeInterceptorChainOnClient(client, params, signal?)` |

Also: `listInterceptors`, `invokeInterceptor`.

**Tests** (Vitest; co-located with sources where practical):

- Unit: `src/protocol/protocol.test.ts`, `src/client/chain-orchestrator.test.ts`, `src/server/reflection.test.ts`, `src/server/register-interceptors.test.ts`
- Integration / E2E: `src/__tests__/integration/*.test.ts`, `src/__tests__/v1-server-wiring.test.ts`
- Shared fixtures: `src/__tests__/fixtures/hosts.ts` (`connectInterceptorHost`, `connectEchoBackend`)

Optional future layout: `__tests__/protocol/` golden JSON; rename fixtures to `buildInterceptorHost` / `buildTestBackend` aliases.

**Examples** (under `examples/`, not published in npm `"files"`; see §10):

```text
examples/
  interceptor-server/     # package.json; ↔ InterceptorServerSample
  interceptor-client/     # package.json; ↔ InterceptorClientSample
  gateway/src/            # ↔ GatewaySample (InterceptingMcpClient)
  transparent-proxy/src/  # ↔ TransparentProxySample (McpInterceptorGateway stdio)
  gateway-chain/src/      # ↔ GatewayChainSample (simplified; see §4.3)
```

All runnable examples import `../../../dist/index.js` after `npm run build`. Root `package.json` scripts: `example:interceptor-server`, `example:interceptor-client`, `example:gateway`, `example:transparent-proxy`, `example:gateway-chain` (uses `tsx`).

---

## 7. Public API

### 7.1 Protocol

- Types and constants aligned with SEP and C# `Protocol/`.
- **`InterceptorResult`:** discriminated union on `type: "validation" | "mutation" | "sink"` with safe parsing from JSON.

### 7.2 Client

- **`listInterceptors(client, params?)`**, **`invokeInterceptor(client, params)`** — wire calls on MCP `Client`.
- **`executeInterceptorChain(interceptors, invoker, params, signal?)`** — pure orchestrator; `invoker` typically calls `interceptor/invoke`.
- **`executeInterceptorChainOnClient(client, params, signal?)`** — discovers via `interceptors/list`, then orchestrates invokes (C# `ExecuteChainAsync`).
- **`executeInterceptorChainOnClients(clients, params, signal?)`** — multi-host list, merge, and chain (SEP merge semantics).
- **`InterceptingMcpClient`** wrapping backend + interceptor clients; same operation set as C# where applicable: `callTool`, `listTools`, `listPrompts`, `getPrompt`, `listResources`, `readResource`, `subscribeResource`, `listInterceptors`.

### 7.3 Interceptor host (server-side)

- Build an **interceptor host** using the MCP SDK’s `Server` / `McpServer`—a real MCP protocol endpoint, typically **not** the same process or role as the application backend that serves tools/resources.
- In-process interceptor registry (name → handler).
- **`registerInterceptorsOnServer(server, interceptors, options?)`**: installs wire handlers on that host, merges **`capabilities.interceptor`** from registered hooks’ events.

### 7.4 Gateway

- **`McpInterceptorGateway`** — transparent MCP proxy: MCP **server** toward clients, MCP **client(s)** toward the **application backend** and **interceptor host(s)**.
- **`configureServer(server)`** — mirror backend capabilities; register proxy handlers (tools, prompts, resources, completions/logging passthrough). Call **before** `server.connect()`.
- **`registerNotificationForwarding(proxyServer)`** — forward backend `list_changed` notifications when advertised.
- **`exposeInterceptorProtocol`** — optional aggregated `interceptors/list` / `interceptor/invoke` on the proxy via `GatewayInterceptorProtocolBridge`.
- Reuses **`InterceptorChainRunner`** (`executeInterceptorChainOnClients` with merged chain).

Callers supply **already-connected** `Client` instances (stdio spawn is sample responsibility; see §10).

---

## 8. Parity with C# SDK

| Capability | C# | TypeScript | Notes |
|------------|-----|------------|-------|
| `interceptors/list` | Yes | Yes | |
| `interceptor/invoke` | Yes | Yes | |
| Polymorphic results + JSON round-trip | Yes | Yes | Golden JSON vs C# deferred |
| Chain semantics (order, audit, failOpen, timeout) | Yes | Yes | |
| Multi-host chain merge | Yes (see §11) | Yes | `executeInterceptorChainOnClients` |
| Client list / invoke / executeChain | Yes | Yes | |
| `capabilities.interceptor` on initialize (SEP) | No (`extensions["interceptors"]`) | Yes | TS default wire shape |
| `InterceptingMcpClient` operations | Yes | Yes | API parity; E2E tests mainly `tools/call` |
| Server registration ergonomics | Yes (`IMcpServerBuilder`) | Yes | `setRequestHandler`, not message filter |
| Reflection-style interceptors | Yes | Yes | `defineInterceptor` |
| LLM completion payload types | Yes (protocol) | Yes | Types only; no live `llm/completion` wiring |
| Transparent gateway + optional SEP exposure | Yes | Yes | Subset of C# gateway tests (§4.3) |
| Runnable examples (core set, §10) | Yes (`samples/`) | Yes | `gateway-chain` simplified vs C# |

---

## 9. Testing

Testing mirrors the C# Interceptor SDK test project: every shipped module has targeted tests, shared fixtures avoid copy-paste host setup, and **integration** tests use **`InMemoryTransport`** (or equivalent) for real JSON-RPC sessions—not only isolated pure functions.

### 9.1 Layers

| Layer | Transport / MCP session | Purpose |
|-------|-------------------------|---------|
| **Unit** | None | Pure logic: protocol parsing, chain ordering, capability merge helpers, registry mapping, result discrimination. Fast; no `Client`/`Server` lifecycle unless a one-line stub is unavoidable. |
| **Integration** | `InMemoryTransport` (paired client + server) | Wire handlers, `initialize` + capabilities on the wire, `listInterceptors` / `invokeInterceptor` against a real interceptor host built with this SDK. |
| **End-to-end (within Vitest)** | Multiple transports or gateway wiring | Full paths the product cares about: e.g. `InterceptingMcpClient` → interceptor host(s) → stub **backend**; gateway proxy forwarding and chain injection. Still in-process; not a separate test runner. |

**End-to-end** = multi-role flows (client + host + backend). **Integration** = client ↔ single host.

### 9.2 Shared fixtures (`src/__tests__/fixtures/hosts.ts`)

- **`connectInterceptorHost(interceptors)`** — in-memory interceptor host via `registerInterceptorsOnServer`; returns `{ client, server, close }`.
- **`connectEchoBackend()`** — minimal backend with `tools/list` + `tools/call` echo; exposes `lastCall` for assertions.
- **Sample interceptors** — defined inline in tests (validator / mutator / sink) with predictable names and return shapes.
- **Golden JSON** — not implemented; deferred (optional alignment with C# `ProtocolTypesSerializationTests.cs`).

Integration and gateway tests use these helpers so registration and capability setup stay consistent.

### 9.3 Coverage by module

| Module / API | Unit | Integration / E2E | C# reference |
|--------------|------|---------------------|--------------|
| `protocol/` (types, zod, `InterceptorResult` parsers) | Round-trip and omit-null JSON; enum/string wire shapes | — | `ProtocolTypesSerializationTests.cs` |
| `client/chain-orchestrator.ts` | Ordering, parallel validation, audit, failOpen, timeout, abort; fake invoker (no MCP) | Chain invoked via real `invokeInterceptor` callbacks in integration tests | `InterceptorChainOrchestratorTests.cs` |
| `client/client-extensions.ts` | — | `listInterceptors` / `invokeInterceptor` / `executeInterceptorChainOnClient` against fixture host | (orchestrator + client extensions) |
| `client/intercepting-client.ts` | — | E2E: `tools/call` request mutation reaches backend (expand to other operations optional) | `McpInterceptorGatewayTests.cs` (overlapping scenarios) |
| `server/register-interceptors.ts` | Registry → handler dispatch, error paths | `interceptors/list` filter by `event`; `interceptor/invoke` returns correct polymorphic result | — |
| `server/capabilities.ts` | `supportedEvents` derived from registered hooks | `initialize` / `getCapabilities()` includes `capabilities.interceptor` on wire | — |
| `server/reflection.ts` | Metadata extraction, invalid registration | Invoke reflected handler over transport | `ReflectionMcpServerInterceptorTests.cs` |
| `client/execute-interceptor-chain-on-clients.ts` | Merge, duplicate-name policy | Multi-host priority and routing | — |
| `gateway/` | `proxy-request.ts` chain wrapper | 13 tests in `mcp-interceptor-gateway.test.ts` | Subset of `GatewayComponentsTests.cs`, `McpInterceptorGatewayTests.cs` |

### 9.4 Minimum scenarios (not exhaustive)

**Protocol:** descriptor and invoke/chain param round-trips; validation / mutation / sink result unions; list result shape.

**Client:** list returns registered interceptors; invoke returns each result type; executeChain applies order and aggregates failures; extensions send correct JSON-RPC method names.

**Server:** host advertises `capabilities.interceptor`; list respects optional `event` filter; invoke dispatches to the right handler; unknown name / bad phase errors.

**Integration (client ↔ host):** connect with `InMemoryTransport`; full list + invoke for at least one validator and one mutator.

**End-to-end:** `InterceptingMcpClient` with fixture backend + host—covered for `tools/call`; other wrapped operations are API-complete but not all covered by dedicated E2E tests yet.

**Gateway:** `tools/list` and `tools/call` forwarding, chain mutation, validation abort (as `McpError` over JSON-RPC), `exposeInterceptorProtocol` list aggregation, multi-host merge scenarios.

**Current total:** 73 Vitest tests. CI runs all tests on every change.

---

## 10. Examples (samples)

Runnable examples mirror the **C# Interceptor SDK** layout in [`csharp/sdk/samples`](../../csharp/sdk/samples) and the walkthroughs in [`csharp/sdk/README.md`](../../csharp/sdk/README.md). They teach the same deployment patterns (interceptor host, direct client API, gateway, transparent proxy, chained gateways). **Scenario parity** with C# is the goal—not line-by-line ports.

### 10.1 Principles

- **Not published:** Examples live under `typescript/sdk/examples/` and are not included in the npm package `"files"` / `"exports"` for `mcp-ext-interceptors`. `interceptor-server` and `interceptor-client` include `"private": true` `package.json` files; `gateway`, `transparent-proxy`, and `gateway-chain` are single-entry scripts run from the SDK root.
- **Complement tests:** Vitest fixtures and integration tests (§9) remain the regression source of truth. Examples are copy-paste-friendly docs for humans; reuse the same interceptor names and behaviors as `src/__tests__/fixtures/` where practical.
- **Complement README:** Package `README.md` keeps short snippets; examples show **stdio spawn** wiring like the C# samples (parent process launches child; JSON-RPC over the child’s stdin/stdout).
- **C# reference column:** When implementing an example, read the matching C# `Program.cs` and treat it as the behavioral spec.

### 10.2 Implemented examples

| TypeScript example | C# sample | Script | What it demonstrates |
|--------------------|-----------|--------|----------------------|
| `examples/interceptor-server/` | `InterceptorServerSample` | `example:interceptor-server` | Stdio **interceptor host** (PII validator, email redactor, request-logger sink) |
| `examples/interceptor-client/` | `InterceptorClientSample` | `example:interceptor-client` | **Client** API; spawns interceptor-server via `StdioClientTransport` |
| `examples/gateway/` | `GatewaySample` | `example:gateway` | `InterceptingMcpClient` → interceptor host → `@modelcontextprotocol/server-everything` |
| `examples/transparent-proxy/` | `TransparentProxySample` | `example:transparent-proxy` | Stdio **`McpInterceptorGateway`**; parent spawns backend + interceptor host |
| `examples/gateway-chain/` | `GatewayChainSample` | `example:gateway-chain` | **Simplified:** documents multi-host ordering via `interceptorClients: [first, second]` on `McpInterceptorGateway` (C# runs two stdio interceptor processes + nested `InterceptingMcpClient`) |

### 10.3 Out of scope

| C# sample | Decision |
|-----------|----------|
| `AvatarMoodInterceptorSample` | **Not planned.** Pedagogy for `llm/completion` **sink** interceptors with live Anthropic calls and console UI—not MCP wiring. A TS port would add API keys, network, and non-CI dependencies without teaching the SDK’s core client/host/gateway paths. Sink behavior is covered in tests; optional tiny in-process sink demo only if needed later. |
| `ConfigDrivenGatewaySample` | **Optional.** C# treats `mcp-interceptors.json` as **sample-only** config, not a library format. Add a TS example only if we want the same “compose gateway from JSON” illustration; not required for parity with the five core samples above. |

### 10.4 Stdio transport (match C#)

| Role | Who spawns whom | Transport |
|------|-----------------|-----------|
| **Interceptor host** | Spawned as child | Stdio server (`WithStdioServerTransport` / equivalent). |
| **Client / gateway sample** | Parent process | `StdioClientTransport` with `command` + `args` (e.g. `node` / `tsx` + path to `interceptor-server`), same as C# `dotnet run --project …`. |
| **Transparent proxy** | Host app spawns proxy; proxy spawns peers | Stdio server toward host; stdio clients toward backend and interceptor host(s). |

**ConfigDrivenGateway** (C#, optional for TS): outbound legs may use Streamable HTTP; gateway exposes stdio to the connecting host.

### 10.5 Implementation notes

- **Dependencies:** Examples depend on `mcp-ext-interceptors` (workspace/`file:`), `@modelcontextprotocol/sdk`, and Node stdio transports—no example-only dependency on the C# SDK.
- **Scripts:** Root `package.json` exposes `npm run example:*` for all five samples; spawning examples embed child `command`/`args` like C#.
- **Shared interceptors:** Prefer importing or duplicating minimal handler definitions from test fixtures so examples and tests do not diverge.
- **Gateway examples:** Spawn `interceptor-server` and stub backend via stdio client transport inside the gateway/proxy process—the same as C# `StdioClientTransport` + `dotnet run --project …`.

---

## 11. Multi-host chain merge (C# port notes)

This section documents multi-host chain behavior in the TypeScript SDK so the **C# Interceptor SDK** team can implement the same pattern if desired. It is not a breaking change to the wire protocol; it aligns client-side chain utilities with **SEP-1763 chain execution** ([`docs/sep.md`](../../docs/sep.md) § Chain Execution).

### 11.1 Problem

The SEP defines chain orchestration across **N MCP servers**:

1. **Discover** — `interceptors/list` on one or more servers  
2. **Merge & sort** — one combined chain (`priorityHint` ascending, name tie-break for mutations)  
3. **Order by trust boundary** — request: mutations → validations → sinks; response: validations → sinks → mutations  
4. **Execute** — `interceptor/invoke` on the **host that owns** each interceptor  

Both reference SDKs already implement step 3–4 for a **single flat interceptor list** (`InterceptorChainOrchestrator` / `executeInterceptorChain`).  

Previously, **multi-host** callers used `InterceptorChainRunner`, which ran a **full** `ExecuteChainAsync` **per host in series**. That preserves tiered pipelines but does **not** merge mutations globally by `priorityHint` across hosts (e.g. a mutator at `-1000` on host B must run before a mutator at `0` on host A per the SEP).

### 11.2 TypeScript implementation

| Piece | Role |
|-------|------|
| `executeInterceptorChain` | Unchanged — SEP execution model for one descriptor list + `invoker` |
| `executeInterceptorChainOnClient` | Unchanged surface — delegates to multi-host helper with one client |
| **`executeInterceptorChainOnClients`** | **New** — list each host → merge entries → `executeInterceptorChain` with routed `invoke` |
| `listInterceptorChainEntries` / `mergeInterceptorChainEntries` | **New** — discover + duplicate-name policy |
| `InterceptorChainRunner` | **Updated** — uses `executeInterceptorChainOnClients` instead of per-host full chains |

**Duplicate interceptor names across hosts**

- Default: **`duplicateNamePolicy: 'error'`** — throw `DuplicateInterceptorNameError` listing name and host labels (invoke routing is ambiguous because `interceptor/invoke` only carries `name`).  
- Optional: **`'first-wins'`** — keep first entry in host array order (documented for tests / explicit tiering only).  
- Deployment guidance: use **globally unique** interceptor names when using merged chains.

### 11.3 SEP compliance

- Normative chain steps 1–5 are implemented in the **multi-host entry point**; the orchestrator still enforces type/phase semantics (mutations sequential by `priorityHint`, validations parallel, sinks non-blocking).  
- No new JSON-RPC methods; still `interceptors/list` + `interceptor/invoke` per owning server.  
- `ChainEntry.server` in the SEP maps to `InterceptorChainEntry.client` (implementation-specific connection type).

**Not changed:** chain `config` map forwarding, or wildcard event matching — same gaps as before (§4.3). Per-phase `priorityHint` is implemented in TypeScript (§4.3.1); C# still scalar-only.

### 11.4 Suggested C# port

1. Add `InterceptorChainEntry` (descriptor + `McpClient` + host label) and `ExecuteChainOnClientsAsync(IReadOnlyList<InterceptorChainHost> hosts, ExecuteChainRequestParams request, …)`.  
2. Implement merge + `DuplicateInterceptorNameException` (default throw on duplicate `Name`).  
3. Call existing `InterceptorChainOrchestrator.ExecuteAsync` with an invoker that dispatches `InvokeInterceptorAsync` to the correct client.  
4. Switch `InterceptorChainRunner` to use the new API (or document runner as “sequential per-host” if retaining old behavior behind a flag).  
5. Add tests: global `PriorityHint` across two hosts; duplicate name error; optional `first-wins`.

### 11.5 When to keep sequential per-host chains

If product intent is **tiered hosts** (“always run security host chain, then logging host chain”) rather than **one global mutation order**, expose that as an explicit option (e.g. `ChainMergeMode.Merged` vs `PerHostSequential`) rather than overloading merge semantics. The SEP default for the chain **utility** is merge; tiered ordering is a deployment pattern clients can opt into.
