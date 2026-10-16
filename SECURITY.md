# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

Please do **not** report security vulnerabilities through public GitHub issues.

Instead, use GitHub's **private vulnerability reporting** for this repository:
[Report a vulnerability](https://github.com/XHToken/dsh-intelligent-router/security/advisories/new)

Alternatively, open a public issue requesting a private channel if the advisory form is unavailable.

### What to include

- Description of the vulnerability and its potential impact
- Steps to reproduce (proof-of-concept code is welcome)
- Affected versions and components (e.g., `router.ts` failover logic, Settings UI persistence, client bundle)

### What to expect

- Acknowledgement within **3 business days**
- A fix plan and timeline for confirmed issues
- Public disclosure coordinated with you once a patched release is available
- Credit in the release notes and security advisory, unless you prefer otherwise

## Scope Notes

This plugin routes LLM traffic and persists configuration through the DSH settings service. Vulnerabilities in DeepSeek Harness itself or in upstream provider SDKs are out of scope for this project — please report those to the respective maintainers.
