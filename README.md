# DSH Intelligent Router

> Intelligent LLM routing for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) — multi-model routing, automatic failover, cache-affinity staying, and a visual Settings UI.

[![CI](https://github.com/XHToken/dsh-intelligent-router/actions/workflows/ci.yml/badge.svg)](https://github.com/XHToken/dsh-intelligent-router/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-175%20passed-brightgreen)](https://github.com/XHToken/dsh-intelligent-router/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-0%20errors-blue)]()
[![License](https://img.shields.io/badge/license-XHToken%20community-green)](https://github.com/XHToken/community/blob/main/LICENSE)
[![DSH](https://img.shields.io/badge/DSH-%3E%3D0.2.0--rc.2-orange)](https://github.com/deepseek-ai/deepseek-harness)

The router registers itself as the **`auto`** provider in DSH. Pick **AUTO – Intelligent Router** as your model and every request is routed to the best member of your configured route group — with rules, strategies, failover, and prompt-cache-aware staying working under the hood.

> **Naming note**: this repository is *dsh-intelligent-router*; the published package and DSH plugin identifier remain **`dsh-llm-router`**.

---

## ✨ Features

### Routing
- **Route groups** — organize members (provider + model) and manage them from the Settings UI
- **4 routing strategies** — `order` (priority) · `smart` (task-size aware: local vs cloud) · `rotate` (round-robin) · `usage` (least-used first)
- **Rule engine** — `minTokens` / `hasImage` / `anyAgent` / `intent` conditions; the first matching rule pins its target model to the front of the candidate chain
- **Intent routing** — a lightweight classifier model (your choice) labels the message intent; rules route on it
- **Stays (cache affinity)** — `off` / `turn` / `auto` / `session` (default `session`): keeps the last successful member at the front while the vendor prompt cache is worth keeping, keyed per DSH session

### Reliability
- **Automatic failover** — three-tier error classification (TRANSIENT / PERMANENT / UNKNOWN), no false positives: auth and validation errors never burn retries; connection, rate-limit, and 5xx errors fall through to the next candidate
- **Quota guard** — members that exceed limits are skipped without consuming a retry

### Experience
- **Settings UI** (Magpie-style, zh/en) — model picker fed from DSH's configured models, strategy pills, rule builder, intent-classifier selection, save-time validation, live persistence via the DSH settings service
- **Observability** — per-group/per-member metrics, latency tracking, cost estimates, and `router/fallback` events (host side)

## 📋 Requirements

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) `>= 0.2.0-rc.2`
- Node.js `>= 18` (DSH runtime), pnpm for development

## 📦 Installation

```bash
# Via DSH (recommended)
dsh plugin --profile web add github:XHToken/dsh-intelligent-router

# Or build from source
git clone https://github.com/XHToken/dsh-intelligent-router.git
cd dsh-intelligent-router
pnpm install && pnpm build
cp -r dist/* ~/.dsh/profiles/web/node_modules/dsh-llm-router/dist/
cp cordis.patch.yml ~/.dsh/profiles/web/node_modules/dsh-llm-router/
```

> Start DSH from the profile directory with the **local binary** (`cd ~/.dsh/profiles/web && ./node_modules/.bin/dsh web --port 3082`). Launching via `npx` can load a duplicate module tree and break settings writes.

## 🚀 Quick Start

1. Start DSH and open **Settings → Built-in plugins → LLM Router**
2. Click **+ Add model** to pick members from your DSH-configured providers
3. Choose a strategy (default: `order`); optionally add rules
4. Click **Save** (persists immediately via the DSH settings service)
5. In chat, select **AUTO – Intelligent Router** — done

Use a specific group with provider `group/<groupId>`.

## 📐 How It Works

```
request (provider=auto)
  → refresh config (settings service, live)
  → resolve route group (default group or group/<id>)
  → evaluate rules top-down; first hit pins its target first
  → order candidates by strategy (order | smart | rotate | usage)
  → apply Stays: last successful member moves to front while fresh
  → delegate to each candidate via DSH ctx.llm.prepareCall
      success → return
      failure → classify: TRANSIENT → next candidate · PERMANENT/UNKNOWN → raise
```

The router makes **routing decisions only** — authentication, protocol adaptation, tool calls, and streaming are fully delegated to DSH's LLM system.

### Error Classification

| Class | Behavior | Conditions |
|---|---|---|
| TRANSIENT | ✅ fail over | `ECONNREFUSED`/`ECONNRESET`/`ETIMEDOUT`…, HTTP 429/5xx, `rate_limit`/`overloaded` |
| TRANSIENT (network text) | ✅ fail over | SDK connection failures that surface only as text ("Connection error.", "fetch failed", "socket hang up", `ENOTFOUND`…) |
| PERMANENT | ❌ raise | HTTP 400/401/403/404/422, `auth`, `invalid_api_key`, `model_not_found` |
| UNKNOWN | ❌ raise | anything else (safe default) |

Custom patterns via `fallback.recoverableErrors` override the built-in classification.

### Stays Modes

| Mode | Behavior |
|---|---|
| `session` (default) | Stay on the last successful member for the whole session |
| `auto` | Always within a turn; across turns while the vendor cache is fresh (~5 min, Anthropic prompt-cache TTL) |
| `turn` | Within a single turn only (~2 min window — DSH has no turn id, so this is a time approximation) |
| `off` | No affinity, pure strategy ordering |

Rules always beat affinity; a failed sticky member is dropped from affinity so it is never retried first; `rotate` + affinity = affinity wins.

## ⚙️ Configuration Reference

Persisted by the Settings UI into the profile's `cordis.patch.yml` (`id: llm-router`). A minimal example:

```yaml
- id: llm-router
  name: 'dsh-llm-router'
  config:
    enabled: true
    defaultGroup: 'default'
    routeGroups:
      - id: 'default'
        name: 'Default'
        strategy: 'order'          # order | smart | rotate | usage
        stays: 'session'           # off | turn | auto | session
        enabled: true
        members:
          - provider: 'ollama'
            model: 'llama3.2'
            priority: 1
            enabled: true
          - provider: 'deepseek-official'
            model: 'deepseek-v4-flash'
            priority: 2
            enabled: true
        classifierModel:            # used by intent rules
          provider: 'ollama'
          model: 'llama3.2'
        rules:
          - minTokens: 10000
            intent: '复杂问题'
            target: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
    fallback:
      enabled: true
      maxRetries: 3                 # total attempts per request
      retryDelay: 1000
    quotaTracking:
      enabled: true
```

See [cordis.patch.yml.example](cordis.patch.yml.example) for the full annotated schema.

## 🗂 Project Structure

```
src/
├── index.ts               # Host plugin entry (registerAdapter(["auto"]))
├── router.ts              # Core router (MagpieRouter): rules, strategies, failover, stays
├── strategies.ts          # Pure ordering functions (directly unit-tested)
├── settings-schema.ts     # Config schema (schemastery)
├── config-store.ts        # Settings namespace "llm-router" read/write
├── llm-client.ts          # Direct client (legacy fallback path only)
├── quota-tracker.ts       # Quota tracking
├── monitoring.ts          # Host-side metrics dashboard
├── cost-optimizer.ts      # Cost estimation
├── middleware.ts          # Middleware system (experimental, not wired)
├── client/index.tsx       # Settings UI (browser bundle)
├── settings-ui.tsx        # Settings components
└── types.ts               # Shared types
tests/                     # 175 unit tests (vitest)
docs/                      # Design documents
scripts/wrap-client-bundle.js  # ESM → DSH ModuleLoader post-build step
```

## 📚 Documentation

- [Routing Strategies & Rule Engine](docs/routing-strategies.md)
- [Magpie Integration Design](docs/magpie-integration.md)
- [Settings UI Design](docs/magpie-settings-ui.md)
- [DeepSeek Harness Architecture Analysis](docs/deepseek-harness-analysis.md)

## 🏗 Development

```bash
pnpm install
pnpm run build        # tsup + ModuleLoader wrap
pnpm run typecheck    # tsc --noEmit
pnpm run lint         # eslint
pnpm test:run         # vitest (175 tests)
```

## 🗺 Roadmap

- `pace` / `weighted` / `intent` strategies are declared in the schema but **not implemented** (they silently degrade to `order`) — implement or prune
- Stays windows (`turn` ≈ 2 min, `auto` ≈ 5 min) are hardcoded approximations — make configurable
- Quota limits are hardcoded (1M tokens/day, 1k requests/day) and never auto-reset — wire up `quotaTracking.limits`
- Monitoring data has no UI channel yet (panel shows mock data)
- Middleware system is implemented but not wired into the request path
- Prune the legacy dual call path (`route()` waterfall / `llm-client.ts`)

## 🤝 Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first. For security issues, see [SECURITY.md](SECURITY.md).

## 📄 License

Licensed under the [XHToken community license](https://github.com/XHToken/community/blob/main/LICENSE). See [LICENSE](LICENSE) for the full text.
