#!/usr/bin/env node
/**
 * E2E for the plugin's own contract against a real DeepSeek Harness host:
 *   1. install the supported host (compatibility.json recommendedHost)
 *   2. fresh DSH_HOME → dsh plugin add (packed tgz)  [INSTALL]
 *   3. boot #1: server healthy + llm-router loader entry composed  [RUN]
 *   4. RESTART the host (client bundles compose only at startup)
 *   5. Settings UI contract:
 *      a. plugin side (hard): installed package ships the ModuleLoader-wrapped
 *         client bundle, dsh.client manifest, resolvable ./client export
 *      b. host side (adaptive): if the boot graph carries the plugin's client
 *         row, serve-check it and drive the browser to the Settings UI panel.
 *         Fresh profiles currently do not compose third-party client rows
 *         (host-side limitation — README: "Waiting for DSH support in the
 *         future"); then this phase reports SKIPPED instead of failing, and
 *         turns on by itself once DSH fixes composition.
 *   6. doctor passes on the profile
 *
 * Env: E2E_DSH_PKG_DIR, E2E_KEEP, E2E_SHOTS, E2E_DSH_VERSION
 */
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const PROFILE = 'e2e'
const HOST_VERSION = process.env.E2E_DSH_VERSION
  ?? JSON.parse(readFileSync(join(REPO, 'compatibility.json'), 'utf8')).recommendedHost

const steps = []
function step(name) { steps.push(name); console.log(`\n== ${name}`) }
function fail(message) {
  console.error(`E2E FAIL at [${steps.at(-1)}]: ${message}`)
  process.exit(1)
}
function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...options })
  if (result.error) fail(`${cmd} ${args.join(' ')}: ${result.error.message}`)
  return result
}
function freePort() {
  return new Promise((done) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => done(port)) })
  })
}
async function fetchWithJar(url) {
  const jar = new Map()
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const remember = (resp) => {
    for (const sc of resp.headers.getSetCookie?.() ?? []) {
      const pair = sc.split(';', 1)[0]
      const eq = pair.indexOf('=')
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
    }
  }
  let resp = await fetch(url, { redirect: 'manual' })
  remember(resp)
  let hops = 0
  while ([301, 302, 303, 307, 308].includes(resp.status) && hops++ < 5) {
    resp = await fetch(new URL(resp.headers.get('location'), url).href, {
      redirect: 'manual', headers: { cookie: cookieHeader() },
    })
    remember(resp)
  }
  return { resp, cookieHeader }
}

const home = mkdtempSync(join(tmpdir(), 'dsh-router-e2e-'))
const profileDir = join(home, 'profiles', PROFILE)
const shots = process.env.E2E_SHOTS ?? join(home, 'shots')
mkdirSync(shots, { recursive: true })
let server
const cleanup = (code) => {
  server?.kill('SIGTERM')
  console.log(`Screenshots: ${shots}`)
  if (process.env.E2E_KEEP) console.log(`E2E home kept: ${home}`)
  else rmSync(home, { recursive: true, force: true })
  process.exit(code)
}
process.on('SIGINT', () => cleanup(130))

// --- 1. host install ---------------------------------------------------------
step(`install host @deepseek-ai/dsh@${HOST_VERSION}`)
let dshBin
if (process.env.E2E_DSH_PKG_DIR) {
  dshBin = join(resolve(process.env.E2E_DSH_PKG_DIR), 'node_modules', '.bin', 'dsh')
  if (!existsSync(dshBin)) fail(`E2E_DSH_PKG_DIR has no node_modules/.bin/dsh: ${dshBin}`)
} else {
  const toolDir = join(home, 'dsh-tool')
  run('npm', ['install', '--prefix', toolDir, `@deepseek-ai/dsh@${HOST_VERSION}`], { stdio: 'inherit' })
  dshBin = join(toolDir, 'node_modules', '.bin', 'dsh')
}
const dshEnv = { ...process.env, DSH_HOME: home }
// Doctor's host root: the installation whose node_modules holds
// @deepseek-ai/dsh (dshBin = <root>/node_modules/.bin/dsh).
const hostRoot = dirname(dirname(dirname(dshBin)))

// --- 2. INSTALL: pack → dsh plugin add ---------------------------------------
step('install plugin into fresh profile')
if (!existsSync(join(REPO, 'dist', 'index.js'))) fail('dist/ missing — run `pnpm build` first')
const pack = run('pnpm', ['pack', '--pack-destination', home], { cwd: REPO })
const tgzPath = resolve(REPO, pack.stdout.trim().split('\n').at(-1))
if (!existsSync(tgzPath)) fail(`pack output not found: ${tgzPath}`)
const add = run(dshBin, ['plugin', '--profile', PROFILE, 'add', tgzPath], { env: dshEnv, stdio: 'inherit' })
if (add.status !== 0) fail(`dsh plugin add exited ${add.status}`)
const installedDir = join(profileDir, 'node_modules', 'dsh-llm-router')
if (!existsSync(join(installedDir, 'package.json'))) fail('installed package missing')

// The default profile template carries only dsh-base; the web composition
// needs the dsh-web-app bundle.
const profileManifestPath = join(profileDir, 'package.json')
const profileManifest = JSON.parse(readFileSync(profileManifestPath, 'utf8'))
const bundles = profileManifest.dsh?.profile?.bundles ?? []
if (!bundles.includes('dsh-llm-router')) fail('plugin not registered in dsh.profile.bundles')
if (!bundles.includes('@deepseek-ai/dsh-web-app')) {
  profileManifest.dsh.profile.bundles = [...bundles, '@deepseek-ai/dsh-web-app']
  writeFileSync(profileManifestPath, JSON.stringify(profileManifest, null, 2) + '\n')
  console.log('added @deepseek-ai/dsh-web-app to profile bundles')
}

// --- 3. RUN: boot #1, host-side composition ----------------------------------
async function boot(label, port) {
  server = spawn(dshBin, ['web', '--port', String(port), '--no-open'], {
    cwd: profileDir, env: dshEnv, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logPath = join(home, `dsh-web-${label}.log`)
  const chunks = []
  server.stdout.on('data', (c) => { chunks.push(c); appendFileSync(logPath, c) })
  server.stderr.on('data', (c) => { chunks.push(c); appendFileSync(logPath, c) })
  const tokenUrl = await new Promise((done) => {
    const timer = setTimeout(() => done(undefined), 90_000)
    const scan = setInterval(() => {
      const match = Buffer.concat(chunks).toString('utf8').match(/https?:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+/)
      if (match) { clearTimeout(timer); clearInterval(scan); done(match[0]) }
    }, 300)
  })
  if (!tokenUrl) fail(`[${label}] no token URL within 90s (log: ${logPath})`)
  return { port, tokenUrl, kill: () => new Promise((r) => { server.once('exit', r); server.kill('SIGTERM') }) }
}

step('boot #1 — run & host-side composition')
const boot1 = await boot('first', await freePort())
console.log(`first boot: ${boot1.tokenUrl}`)
const dump = run(dshBin, ['--profile', PROFILE, '--dump-config'], { env: dshEnv })
if (dump.status !== 0) fail(`dump-config exited ${dump.status}`)
if (!/- id: llm-router\n\s+name: dsh-llm-router/.test(dump.stdout)) fail('llm-router loader entry absent from composed config')
console.log('loader entry composed: id=llm-router name=dsh-llm-router')
await boot1.kill()
server = undefined

// --- 4. RESTART ----------------------------------------------------------------
step('boot #2 — restart')
const { port, tokenUrl } = await boot('second', await freePort())
console.log(`second boot: ${tokenUrl}`)

// --- 5a. Settings UI — plugin-side contract (hard) ----------------------------
step('settings UI: plugin-side bundle contract')
const installedManifest = JSON.parse(readFileSync(join(installedDir, 'package.json'), 'utf8'))
const clientDecl = installedManifest.dsh?.client
if (clientDecl?.platform !== 'web') fail('dsh.client.platform !== "web" in installed manifest')
if (!Array.isArray(clientDecl.inject) || clientDecl.inject.length === 0) fail('dsh.client.inject missing')
const clientExport = installedManifest.exports?.['./client']
const clientRel = typeof clientExport === 'string' ? clientExport : clientExport?.default
if (!clientRel) fail('exports["./client"] missing')
const clientBundle = join(installedDir, clientRel.replace(/^\.\//, ''))
if (!existsSync(clientBundle)) fail(`client bundle not shipped: ${clientRel}`)
const bundleSrc = readFileSync(clientBundle, 'utf8')
if (!bundleSrc.includes('window.__ModuleLoader__.load') || !bundleSrc.includes('id: "dsh-llm-router"')) {
  fail('client bundle is not ModuleLoader-wrapped')
}
if (!existsSync(join(installedDir, 'cordis.patch.yml'))) fail('cordis.patch.yml not shipped')
console.log(`client bundle OK (${(bundleSrc.length / 1024).toFixed(1)} KiB, ModuleLoader-wrapped)`)

// --- 5b. Settings UI — host-side delivery + browser (adaptive) ----------------
step('settings UI: host-side delivery (adaptive)')
const { resp: page, cookieHeader } = await fetchWithJar(tokenUrl)
if (!page.ok) fail(`index fetch ${page.status}`)
const html = await page.text()
const comboMatch = html.match(/plugins\/\?\?dsh-llm-router\/client\.js(?:&amp;|&)rev=([0-9a-f]+)/)
if (!comboMatch) {
  console.log('SKIPPED: boot graph carries no dsh-llm-router client row.')
  console.log('Fresh profiles currently do not compose third-party client rows')
  console.log('(host-side limitation — README: "Waiting for DSH support in the future").')
  console.log('Plugin-side bundle contract verified above; this phase re-activates')
  console.log('automatically (serve check + browser panel render) once DSH composes the row.')
} else {
  const combo = await fetch(`http://127.0.0.1:${port}/plugins/??dsh-llm-router/client.js&rev=${comboMatch[1]}`, {
    headers: { cookie: cookieHeader() },
  })
  if (!combo.ok) fail(`combo route ${combo.status}`)
  const served = await combo.text()
  if (!served.includes('window.__ModuleLoader__.load')) fail('served bundle is not ModuleLoader-wrapped')
  console.log(`client bundle served: ${(served.length / 1024).toFixed(1)} KiB`)

  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  const tab = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await tab.goto(tokenUrl, { waitUntil: 'networkidle', timeout: 60_000 })
  await tab.screenshot({ path: join(shots, '01-app-loaded.png') })
  const byText = (text) => tab.getByText(text, { exact: false }).first()
  await byText('Settings').click({ timeout: 30_000 })
  await tab.waitForTimeout(1500)
  await tab.screenshot({ path: join(shots, '02-settings.png') })
  await byText('Built-in plugins').click({ timeout: 30_000 })
  await tab.waitForTimeout(1500)
  await tab.screenshot({ path: join(shots, '03-built-in-plugins.png') })
  await byText('LLM Router').click({ timeout: 30_000 })
  await tab.waitForTimeout(1500)
  const panel = await tab.getByText('Intelligent LLM routing', { exact: false }).count()
    || await tab.getByText('LLM 路由器', { exact: false }).count()
  await tab.screenshot({ path: join(shots, '04-llm-router-panel.png'), fullPage: true })
  await browser.close()
  if (!panel) fail('LLM Router settings panel did not render')
  console.log('Settings UI panel rendered')
}

// --- 6. doctor ------------------------------------------------------------------
step('doctor passes on the profile')
const doctor = run(process.execPath, [join(REPO, 'scripts', 'doctor.mjs'),
  '--host-root', hostRoot, '--profile-root', profileDir], { env: dshEnv })
console.log(doctor.stdout)
if (doctor.status !== 0) fail(`doctor exited ${doctor.status}`)

console.log('\nE2E PASS: install → run → restart → Settings UI contract → doctor')
cleanup(0)
