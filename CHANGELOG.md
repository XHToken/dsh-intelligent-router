# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-17

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
- **Provider surface**: registers as the `auto` provider exposing `AUTO – Intelligent Router`
- 175 unit tests (vitest), TypeScript strict typecheck, ESLint, GitHub Actions CI

### Known Limitations
- `pace` / `weighted` / `intent` strategies are schema-declared but not implemented (degrade to `order`)
- Stays windows are hardcoded approximations (turn ≈ 2 min, auto ≈ 5 min)
- Quota limits are hardcoded and never auto-reset
- Monitoring dashboard UI shows mock data (host metrics have no UI channel yet)
- Middleware system is not wired into the request path
