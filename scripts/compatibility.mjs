import { readFileSync } from 'node:fs'

export const policy = JSON.parse(readFileSync(new URL('../compatibility.json', import.meta.url), 'utf8'))

// Value imports of the host entry (src/index.ts) — kept independent from
// package.json so an accidentally deleted peer is caught by the doctor.
// React is supplied by the host's browser module table, not the server tree.
export const serverRuntimePeers = [
  '@deepseek-ai/schemastery',
]

export function validatePolicy(input) {
  if (input.schemaVersion !== 1 || input.previewTag !== 'next') throw new Error('Unsupported compatibility policy')
  const hosts = input.supportedHosts
  if (!Array.isArray(hosts) || hosts.length === 0) throw new Error('supportedHosts must list exact tested host targets')
  const versions = new Set()
  for (const host of hosts) {
    if (typeof host.version !== 'string' || !/^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/.test(host.version)
        || host.version.trim() !== host.version || versions.has(host.version)
        || !['recommended', 'preview', 'legacy'].includes(host.track)) {
      throw new Error('Host targets must be unique exact versions with an explicit track')
    }
    versions.add(host.version)
  }
  const recommended = hosts.filter(host => host.track === 'recommended')
  if (recommended.length !== 1 || recommended[0].version !== input.recommendedHost) throw new Error('Exactly one recommended host is required')
  if (/-(alpha|beta)\./.test(input.recommendedHost)) throw new Error('Alpha/beta hosts cannot be the ordinary-user recommendation')
  const candidates = input.sourceCandidates ?? []
  if (!Array.isArray(candidates)) throw new Error('sourceCandidates must be an array')
  for (const candidate of candidates) {
    if (typeof candidate.version !== 'string' || candidate.version.trim() !== candidate.version
        || !/^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/.test(candidate.version)
        || versions.has(candidate.version)
        || candidate.repository !== 'https://github.com/deepseek-ai/deepseek-harness'
        || typeof candidate.commit !== 'string' || candidate.commit.length !== 40 || !/^[a-f0-9]{40}$/.test(candidate.commit)
        || typeof candidate.evidence !== 'string' || !candidate.evidence.startsWith('docs/')) {
      throw new Error('Source candidates require a unique exact version, official repository, commit and evidence')
    }
    versions.add(candidate.version)
  }
  // Only published targets enter the npm download/CI matrix.
  return hosts.map(host => host.version)
}
