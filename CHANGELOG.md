# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-19

Initial public release.

### Added
- **Routing core**: route groups with 4 strategies — `order`, `smart` (task-size aware local/cloud selection), `rotate`, `usage`
- **Rule engine**: `minTokens` / `hasImage` / `anyAgent` / `intent` conditions with first-match pinning
- **Intent routing**: lightweight classifier-model labeling via DSH `prepareCall`
- **Stays cache-affinity mode** (`off` / `turn` / `auto` / `session`, default `session`): keeps the last successful member at the front of the candidate chain while the vendor prompt cache is fresh, keyed per DSH session
- **Automatic failover** with three-tier error classification (TRANSIENT / PERMANENT / UNKNOWN), including network-text detection for SDK connection errors ("Connection error.", fetch failures)
- **Settings UI** (Magpie-style, zh/en): model picker, strategy pills, Stays selector, rule builder, intent-classifier selection, save-time validation, persistence via the DSH settings service
- **Observability**: per-group/per-member metrics, latency, cost estimates, `router/fallback` events
- **Quota tracking** (host-side daily limits)
- **Provider surface**: registers as the `auto` provider exposing `AUTO – Intelligent Router` with reasoning efforts **Low / High** (default low)
- **Developer skill** (`.agents/skills/dsh-plugin-dev`): plugin development guide covering DSH plugin architecture, schemastery config, routing strategies & Stays, error classification, Settings UI integration, build/deploy and debugging
- **`compatibility.json`** declaring the supported DSH hosts (`0.2.0-rc.2` recommended) — the version source of truth for installers and hosts
- **Doctor self-check** (`dsh-llm-router-doctor` / `pnpm doctor`): verify a DSH installation — host version against the supported list, plugin presence, dependency coherence — without executing any package
- **Usage examples** with real screenshots: installation & verification, route-group configuration, AUTO routing chat, strategies & Stays, automatic failover, plus real-world scenarios — [agent-teams multi-agent collaboration](examples/agent-teams/), [coding (generate → build → run → verify)](examples/coding/), [document pipeline (PDF recognition → translation → proofreading → audit)](examples/document-pipeline/), [data anonymization](examples/data-desensitization/), [image redesign](examples/image-redesign/)
- **License**: [Apache-2.0](https://github.com/XHToken/community/blob/main/LICENSE) (XHToken community license)
- 194 unit tests (vitest), TypeScript strict typecheck, ESLint (0 warnings), GitHub Actions CI + E2E

### Known Limitations
- `pace` / `weighted` / `intent` strategies are schema-declared but not implemented (degrade to `order`)
- Stays windows are hardcoded approximations (turn ≈ 2 min, auto ≈ 5 min)
- Quota limits are hardcoded and never auto-reset
- Monitoring dashboard UI shows mock data (host metrics have no UI channel yet)
- Middleware system is not wired into the request path
- **First-time install requires a DSH restart**: the loader entry and Settings UI client bundle are composed into the boot graph at server startup; a running DSH does not notice newly installed packages (browser reload is not enough)
- **Fresh DSH profiles do not compose third-party client rows into the boot graph** (host-side limitation — README: "Waiting for DSH support in the future"); the `auto` provider and Settings UI load in profiles that have composed the plugin once
