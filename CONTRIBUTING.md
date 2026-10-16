# Contributing to DSH Intelligent Router

Thanks for your interest in contributing! This document explains how to set up a development environment and how to get changes merged.

## Code of Conduct

By participating you agree to uphold the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development Setup

```bash
git clone https://github.com/XHToken/dsh-intelligent-router.git
cd dsh-intelligent-router
pnpm install            # pnpm >= 9 (repo pins pnpm@12.11.2)
pnpm run build          # tsup + client-bundle ModuleLoader wrap
pnpm run typecheck      # tsc --noEmit, must stay at 0 errors
pnpm run lint           # eslint (warnings tolerated, errors are not)
pnpm test:run           # vitest, all tests must pass
```

### Trying changes in a live DSH

```bash
pnpm build
cp -r dist/* ~/.dsh/profiles/web/node_modules/dsh-llm-router/dist/
cd ~/.dsh/profiles/web && ./node_modules/.bin/dsh web --port 3082
```

Start DSH with the **profile-local binary**, not `npx` — a duplicate module tree breaks settings writes ("profile reload requires the root Include entry").

## Project Conventions

- **Pure logic lives in `src/strategies.ts`** — ordering functions must stay pure and directly unit-testable; state lives in `MagpieRouter`.
- **Config schema uses [schemastery](https://github.com/deepseek-ai/schemastery)**, not zod: `.description()` (not `.describe()`), `z.union([z.const(...)])` (not `z.enum`), `z.dict()` (not `z.record`), `.volatile()` marks DSH-editable fields. There is no `.optional()` — fields are optional by default.
- **Logging** goes through `MagpieRouter#log(level, message)` which honors `advanced.logLevel`; avoid raw `console.log` on request paths.
- **Error classification** is safety-critical: anything ambiguous must classify as UNKNOWN (no fallback). Add tests when touching `shouldFallback`.

## Pull Request Process

1. Open or reference an issue for non-trivial changes.
2. Branch from `main`; keep commits focused.
3. Follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`).
4. Sign commits off (`git commit -s`) — DCO applies.
5. Ensure `typecheck`, `lint`, `test:run`, and `build` all pass; add tests for new behavior.
6. Update [README.md](README.md) / [CHANGELOG.md](CHANGELOG.md) when user-visible behavior changes.
7. CI must be green before merge.

## Reporting Bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md). Include your DSH version, Node version, route-group config, and the relevant slice of the DSH log.

## Security

Do **not** open public issues for vulnerabilities — see [SECURITY.md](SECURITY.md).
