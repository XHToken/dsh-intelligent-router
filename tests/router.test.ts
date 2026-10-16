/**
 * Comprehensive unit tests for dsh-llm-router
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MagpieRouter } from '../src/router'
import { RouteGroupManager } from '../src/route-group-manager'
import type { RouteGroup, StreamChunk } from '../src/types'

// Mock LLMClient before importing router
const mockStream = vi.fn().mockImplementation(async function* () {
  yield { type: 'text-delta', text: 'Hello' }
  yield { type: 'finish', kind: 'success' }
})

vi.mock('../src/llm-client', () => {
  return {
    LLMClient: vi.fn().mockImplementation(() => ({
      stream: mockStream,
    })),
  }
})

// Mock context
const createMockContext = () => {
  const settings = {
    registerCard: vi.fn(),
    describe: vi.fn().mockReturnValue([]),
    get: vi.fn(),
  }
  return {
    llm: {
      getAdapter: vi.fn(),
      registerAdapter: vi.fn(),
      // prepareCall returns a fresh object each call so mockStream changes apply
      prepareCall: vi.fn().mockImplementation(async (config: any) => ({
        config: { provider: config?.provider ?? 'p1', model: config?.model ?? 'm1' },
        stream: mockStream,
      })),
      stream: mockStream,
    },
    settings,
    emit: vi.fn(),
    on: vi.fn(),
    // readConfigFromSettings resolves the settings service via ctx.get('settings')
    get: vi.fn((name: string) => (name === 'settings' ? settings : undefined)),
  }
}

describe('RouteGroupManager', () => {
  let manager: RouteGroupManager

  beforeEach(() => {
    manager = new RouteGroupManager()
  })

  describe('create', () => {
    it('should create a route group with auto-generated ID', () => {
      const group = manager.create({
        name: 'Test Group',
        members: [],
        strategy: 'order',
        enabled: true,
      })

      expect(group.id).toBeDefined()
      expect(group.name).toBe('Test Group')
      expect(group.strategy).toBe('order')
    })

    it('should create a route group with custom ID', () => {
      const group = manager.create({
        id: 'custom-id',
        name: 'Test Group',
        members: [],
        strategy: 'order',
        enabled: true,
      })

      expect(group.id).toBe('custom-id')
    })

    it('should throw error if ID already exists', () => {
      manager.create({
        id: 'test',
        name: 'Group 1',
        members: [],
        strategy: 'order',
        enabled: true,
      })

      expect(() => {
        manager.create({
          id: 'test',
          name: 'Group 2',
          members: [],
          strategy: 'order',
          enabled: true,
        })
      }).toThrow('already exists')
    })

    it('should validate required fields', () => {
      expect(() => {
        manager.create({
          id: 'test',
          name: '',
          members: [],
          strategy: 'order',
          enabled: true,
        })
      }).toThrow('name is required')
    })

    it('should validate members', () => {
      expect(() => {
        manager.create({
          id: 'test',
          name: 'Test',
          members: [{ provider: '', model: 'test', enabled: true }],
          strategy: 'order',
          enabled: true,
        })
      }).toThrow('provider is required')
    })
  })

  describe('get', () => {
    it('should get a route group by ID', () => {
      const created = manager.create({
        id: 'test',
        name: 'Test',
        members: [],
        strategy: 'order',
        enabled: true,
      })

      const retrieved = manager.get('test')
      expect(retrieved).toEqual(created)
    })

    it('should return undefined for non-existent ID', () => {
      expect(manager.get('non-existent')).toBeUndefined()
    })
  })

  describe('list', () => {
    it('should list all route groups', () => {
      manager.create({ id: 'g1', name: 'Group 1', members: [], strategy: 'order', enabled: true })
      manager.create({ id: 'g2', name: 'Group 2', members: [], strategy: 'rotate', enabled: true })

      const groups = manager.list()
      expect(groups).toHaveLength(2)
      expect(groups.map(g => g.id)).toContain('g1')
      expect(groups.map(g => g.id)).toContain('g2')
    })
  })

  describe('update', () => {
    it('should update a route group', () => {
      manager.create({
        id: 'test',
        name: 'Original',
        members: [],
        strategy: 'order',
        enabled: true,
      })

      const updated = manager.update('test', { name: 'Updated' })
      expect(updated.name).toBe('Updated')
      expect(updated.id).toBe('test') // ID should not change
    })

    it('should throw error for non-existent group', () => {
      expect(() => {
        manager.update('non-existent', { name: 'Test' })
      }).toThrow('not found')
    })
  })

  describe('delete', () => {
    it('should delete a route group', () => {
      manager.create({ id: 'test', name: 'Test', members: [], strategy: 'order', enabled: true })

      const deleted = manager.delete('test')
      expect(deleted).toBe(true)
      expect(manager.get('test')).toBeUndefined()
    })

    it('should return false for non-existent group', () => {
      expect(manager.delete('non-existent')).toBe(false)
    })
  })

  describe('addMember', () => {
    it('should add a member to a route group', () => {
      manager.create({ id: 'test', name: 'Test', members: [], strategy: 'order', enabled: true })

      const updated = manager.addMember('test', {
        provider: 'deepseek',
        model: 'deepseek-v4',
        enabled: true,
      })

      expect(updated.members).toHaveLength(1)
      expect(updated.members[0].provider).toBe('deepseek')
    })

    it('should throw error for non-existent group', () => {
      expect(() => {
        manager.addMember('non-existent', {
          provider: 'test',
          model: 'test',
          enabled: true,
        })
      }).toThrow('not found')
    })
  })

  describe('removeMember', () => {
    it('should remove a member from a route group', () => {
      manager.create({
        id: 'test',
        name: 'Test',
        members: [
          { provider: 'p1', model: 'm1', enabled: true },
          { provider: 'p2', model: 'm2', enabled: true },
        ],
        strategy: 'order',
        enabled: true,
      })

      const updated = manager.removeMember('test', 0)
      expect(updated.members).toHaveLength(1)
      expect(updated.members[0].provider).toBe('p2')
    })

    it('should throw error for invalid index', () => {
      manager.create({ id: 'test', name: 'Test', members: [], strategy: 'order', enabled: true })

      expect(() => {
        manager.removeMember('test', 0)
      }).toThrow('Invalid member index')
    })
  })

  describe('import/export', () => {
    it('should export all route groups', () => {
      manager.create({ id: 'g1', name: 'Group 1', members: [], strategy: 'order', enabled: true })
      manager.create({ id: 'g2', name: 'Group 2', members: [], strategy: 'rotate', enabled: true })

      const exported = manager.export()
      expect(exported).toHaveLength(2)
    })

    it('should import route groups', () => {
      const groups: RouteGroup[] = [
        { id: 'g1', name: 'Group 1', members: [], strategy: 'order', enabled: true },
        { id: 'g2', name: 'Group 2', members: [], strategy: 'rotate', enabled: true },
      ]

      manager.import(groups)
      expect(manager.list()).toHaveLength(2)
    })

    it('should replace existing groups when importing with replace=true', () => {
      manager.create({ id: 'old', name: 'Old', members: [], strategy: 'order', enabled: true })

      const groups: RouteGroup[] = [
        { id: 'new', name: 'New', members: [], strategy: 'order', enabled: true },
      ]

      manager.import(groups, true)
      expect(manager.list()).toHaveLength(1)
      expect(manager.get('new')).toBeDefined()
      expect(manager.get('old')).toBeUndefined()
    })
  })
})

describe('MagpieRouter', () => {
  let router: MagpieRouter
  let mockCtx: ReturnType<typeof createMockContext>

  beforeEach(() => {
    mockCtx = createMockContext()
    vi.clearAllMocks()
    // Reset the mock stream to return success by default
    mockStream.mockImplementation(async function* () {
      yield { type: 'text-delta', text: 'Hello' }
      yield { type: 'finish', kind: 'success' }
    })
  })

  describe('order strategy', () => {
    it('should route to first member by priority', async () => {
      router = new MagpieRouter(mockCtx as any, {
        routeGroups: [{
          id: 'test',
          name: 'Test',
          members: [
            { provider: 'p1', model: 'm1', priority: 2, enabled: true },
            { provider: 'p2', model: 'm2', priority: 1, enabled: true },
          ],
          strategy: 'order',
          enabled: true,
        }],
        defaultGroup: 'test',
        quotaTracking: { enabled: false, syncWithTokenMeter: false },
        fallback: { enabled: false, maxRetries: 0, retryDelay: 0, recoverableErrors: [] },
      })

      const chunks: StreamChunk[] = []
      for await (const chunk of router.stream({ messages: [] })) {
        chunks.push(chunk)
      }

      expect(chunks.length).toBeGreaterThan(0)
      // m2 has priority 1 → it must be the FIRST member dispatched (not m1/priority 2)
      const firstCall = mockCtx.llm.prepareCall.mock.calls[0]?.[0]
      expect(firstCall).toEqual(expect.objectContaining({ provider: 'p2', model: 'm2' }))
    })

    it('should skip disabled members', async () => {
      router = new MagpieRouter(mockCtx as any, {
        routeGroups: [{
          id: 'test',
          name: 'Test',
          members: [
            { provider: 'p1', model: 'm1', priority: 1, enabled: false },
            { provider: 'p2', model: 'm2', priority: 2, enabled: true },
          ],
          strategy: 'order',
          enabled: true,
        }],
        defaultGroup: 'test',
        quotaTracking: { enabled: false, syncWithTokenMeter: false },
        fallback: { enabled: false, maxRetries: 0, retryDelay: 0, recoverableErrors: [] },
      })

      const chunks: StreamChunk[] = []
      for await (const chunk of router.stream({ messages: [] })) {
        chunks.push(chunk)
      }

      // Should successfully stream with enabled member
      expect(chunks.length).toBeGreaterThan(0)
      // Disabled p1 must never be dispatched; p2 is the only attempt
      expect(mockCtx.llm.prepareCall).toHaveBeenCalledTimes(1)
      expect(mockCtx.llm.prepareCall.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({ provider: 'p2', model: 'm2' }),
      )
    })
  })

  describe('rotate strategy', () => {
    it('should rotate through members', async () => {
      router = new MagpieRouter(mockCtx as any, {
        routeGroups: [{
          id: 'test',
          name: 'Test',
          members: [
            { provider: 'p1', model: 'm1', enabled: true },
            { provider: 'p2', model: 'm2', enabled: true },
          ],
          strategy: 'rotate',
          enabled: true,
        }],
        defaultGroup: 'test',
        quotaTracking: { enabled: false, syncWithTokenMeter: false },
        fallback: { enabled: false, maxRetries: 0, retryDelay: 0, recoverableErrors: [] },
      })

      // First request
      const chunks1: StreamChunk[] = []
      for await (const chunk of router.stream({ messages: [] })) {
        chunks1.push(chunk)
      }
      expect(chunks1.length).toBeGreaterThan(0)

      // Second request
      const chunks2: StreamChunk[] = []
      for await (const chunk of router.stream({ messages: [] })) {
        chunks2.push(chunk)
      }
      expect(chunks2.length).toBeGreaterThan(0)

      // Third request (wraps around)
      const chunks3: StreamChunk[] = []
      for await (const chunk of router.stream({ messages: [] })) {
        chunks3.push(chunk)
      }
      expect(chunks3.length).toBeGreaterThan(0)
    })
  })

  describe('usage strategy', () => {
    it('should prioritize least-used members', async () => {
      router = new MagpieRouter(mockCtx as any, {
        routeGroups: [{
          id: 'test',
          name: 'Test',
          members: [
            { provider: 'p1', model: 'm1', enabled: true },
            { provider: 'p2', model: 'm2', enabled: true },
          ],
          strategy: 'usage',
          enabled: true,
        }],
        defaultGroup: 'test',
        quotaTracking: { enabled: false, syncWithTokenMeter: false },
        fallback: { enabled: false, maxRetries: 0, retryDelay: 0, recoverableErrors: [] },
      })

      // First request - should use p1 (both have 0 usage)
      const chunks1: StreamChunk[] = []
      for await (const chunk of router.stream({ messages: [] })) {
        chunks1.push(chunk)
      }
      expect(chunks1.length).toBeGreaterThan(0)

      // Second request - should use p2 (p1 has 1 usage, p2 has 0)
      const chunks2: StreamChunk[] = []
      for await (const chunk of router.stream({ messages: [] })) {
        chunks2.push(chunk)
      }
      expect(chunks2.length).toBeGreaterThan(0)

      // Third request - should use p1 again (both have 1 usage, back to first)
      const chunks3: StreamChunk[] = []
      for await (const chunk of router.stream({ messages: [] })) {
        chunks3.push(chunk)
      }
      expect(chunks3.length).toBeGreaterThan(0)
    })
  })

  describe('fallback', () => {
    it('should fallback to next member on failure', async () => {
      let callCount = 0
      mockStream.mockImplementation(async function* () {
        callCount++
        if (callCount === 1) {
          throw { code: 'SERVER_ERROR', message: 'Mock error' }
        }
        yield { type: 'text-delta', text: 'Success' }
        yield { type: 'finish', kind: 'success' }
      })

      router = new MagpieRouter(mockCtx as any, {
        routeGroups: [{
          id: 'test',
          name: 'Test',
          members: [
            { provider: 'p1', model: 'm1', priority: 1, enabled: true },
            { provider: 'p2', model: 'm2', priority: 2, enabled: true },
          ],
          strategy: 'order',
          enabled: true,
        }],
        defaultGroup: 'test',
        quotaTracking: { enabled: false, syncWithTokenMeter: false },
        fallback: {
          enabled: true,
          maxRetries: 3,
          retryDelay: 0,
          recoverableErrors: ['SERVER_ERROR'],
        },
      })

      const chunks: StreamChunk[] = []
      for await (const chunk of router.stream({ messages: [] })) {
        chunks.push(chunk)
      }

      expect(chunks.length).toBeGreaterThan(0)
      expect(callCount).toBe(2) // First failed, second succeeded
      expect(mockCtx.emit).toHaveBeenCalledWith('router/fallback', expect.any(Object))
    })

    it('should respect maxRetries', async () => {
      mockStream.mockImplementation(async function* () {
        throw { code: 'SERVER_ERROR', message: 'Mock error' }
      })

      router = new MagpieRouter(mockCtx as any, {
        routeGroups: [{
          id: 'test',
          name: 'Test',
          members: [
            { provider: 'p1', model: 'm1', priority: 1, enabled: true },
            { provider: 'p2', model: 'm2', priority: 2, enabled: true },
          ],
          strategy: 'order',
          enabled: true,
        }],
        defaultGroup: 'test',
        quotaTracking: { enabled: false, syncWithTokenMeter: false },
        fallback: {
          enabled: true,
          // cap BELOW candidate count (2) so the test fails if maxRetries is ignored
          maxRetries: 1,
          retryDelay: 0,
          recoverableErrors: ['SERVER_ERROR'],
        },
      })

      await expect(async () => {
        for await (const _ of router.stream({ messages: [] })) {}
      }).rejects.toThrow()
      expect(mockCtx.llm.prepareCall).toHaveBeenCalledTimes(1)
    })

    it('should not fallback for non-recoverable errors', async () => {
      mockStream.mockImplementation(async function* () {
        throw { code: 'INVALID_REQUEST', message: 'Bad request' }
      })

      router = new MagpieRouter(mockCtx as any, {
        routeGroups: [{
          id: 'test',
          name: 'Test',
          members: [
            { provider: 'p1', model: 'm1', priority: 1, enabled: true },
            { provider: 'p2', model: 'm2', priority: 2, enabled: true },
          ],
          strategy: 'order',
          enabled: true,
        }],
        defaultGroup: 'test',
        quotaTracking: { enabled: false, syncWithTokenMeter: false },
        fallback: {
          enabled: true,
          maxRetries: 3,
          retryDelay: 0,
          recoverableErrors: ['SERVER_ERROR'],
        },
      })

      await expect(async () => {
        for await (const _ of router.stream({ messages: [] })) {}
      }).rejects.toThrow()
    })
  })

  describe('metrics', () => {
    it('should track routing metrics', async () => {
      router = new MagpieRouter(mockCtx as any, {
        routeGroups: [{
          id: 'test',
          name: 'Test',
          members: [
            { provider: 'p1', model: 'm1', enabled: true },
          ],
          strategy: 'order',
          enabled: true,
        }],
        defaultGroup: 'test',
        quotaTracking: { enabled: false, syncWithTokenMeter: false },
        fallback: { enabled: false, maxRetries: 0, retryDelay: 0, recoverableErrors: [] },
      })

      const chunks: StreamChunk[] = []
      for await (const chunk of router.stream({ messages: [] })) {
        chunks.push(chunk)
      }

      const metrics = router.getMetrics()
      expect(metrics.totalRequests).toBe(1)
      expect(metrics.successfulRequests).toBe(1)
      expect(metrics.failedRequests).toBe(0)
      expect(metrics.perGroup['test']).toBe(1)
      expect(metrics.perMember['p1:m1']).toBe(1)
    })
  })

  describe('group resolution', () => {
    it('should use default group when provider is not specified', async () => {
      router = new MagpieRouter(mockCtx as any, {
        routeGroups: [{
          id: 'default',
          name: 'Default',
          members: [{ provider: 'p1', model: 'm1', enabled: true, apiKey: 'test-key' }],
          strategy: 'order',
          enabled: true,
        }],
        defaultGroup: 'default',
        quotaTracking: { enabled: false, syncWithTokenMeter: false },
        fallback: { enabled: false, maxRetries: 0, retryDelay: 0, recoverableErrors: [] },
      })

      const chunks: StreamChunk[] = []
      for await (const chunk of router.stream({ messages: [] })) {
        chunks.push(chunk)
      }

      expect(chunks.length).toBeGreaterThan(0)
    })

    it('should use specified group when provider starts with group/', async () => {
      router = new MagpieRouter(mockCtx as any, {
        routeGroups: [
          {
            id: 'g1',
            name: 'Group 1',
            members: [{ provider: 'p1', model: 'm1', enabled: true, apiKey: 'test-key' }],
            strategy: 'order',
            enabled: true,
          },
          {
            id: 'g2',
            name: 'Group 2',
            members: [{ provider: 'p2', model: 'm2', enabled: true, apiKey: 'test-key' }],
            strategy: 'order',
            enabled: true,
          },
        ],
        defaultGroup: 'g1',
        quotaTracking: { enabled: false, syncWithTokenMeter: false },
        fallback: { enabled: false, maxRetries: 0, retryDelay: 0, recoverableErrors: [] },
      })

      const chunks: StreamChunk[] = []
      for await (const chunk of router.stream({ provider: 'group/g2', messages: [] })) {
        chunks.push(chunk)
      }

      expect(chunks.length).toBeGreaterThan(0)
    })
  })
})

describe('Stays (cache affinity)', () => {
  const members2 = [
    { provider: 'p1', model: 'm1', priority: 1, enabled: true },
    { provider: 'p2', model: 'm2', priority: 2, enabled: true },
  ]

  const makeRouter = (ctx: any, stays?: string, fallbackEnabled = false) =>
    new MagpieRouter(ctx, {
      routeGroups: [{
        id: 'test',
        name: 'Test',
        members: JSON.parse(JSON.stringify(members2)),
        strategy: 'order',
        ...(stays === undefined ? {} : { stays }),
        enabled: true,
      }],
      defaultGroup: 'test',
      quotaTracking: { enabled: false, syncWithTokenMeter: false },
      fallback: fallbackEnabled
        ? { enabled: true, maxRetries: 3, retryDelay: 0, recoverableErrors: [] }
        : { enabled: false, maxRetries: 0, retryDelay: 0, recoverableErrors: [] },
    })

  const drain = async (gen: AsyncIterable<any>) => {
    for await (const _ of gen) { /* consume */ }
  }

  // Realistic network failure: Node fetch errors carry cause.code, which
  // shouldFallback classifies as TRANSIENT (delegateTo rethrows stream errors).
  const errorStream = async function* () {
    const err: any = new Error('fetch failed')
    err.cause = { code: 'ECONNREFUSED' }
    throw err
  }

  beforeEach(() => {
    mockStream.mockImplementation(async function* () {
      yield { type: 'text-delta', text: 'Hello' }
      yield { type: 'finish', kind: 'success' }
    })
  })

  it('records the successful member after failover; same sessionId sticks to it (stays=auto)', async () => {
    const ctx = createMockContext()
    const router = makeRouter(ctx, 'auto', true)

    // First call: p1 fails (ECONNREFUSED → transient), p2 succeeds
    mockStream.mockImplementationOnce(errorStream)
    await drain(router.stream({ sessionId: 's1', messages: [] } as any))
    expect((router as any).lastAffinity.get('test#s1')).toEqual(
      expect.objectContaining({ provider: 'p2', model: 'm2' }),
    )

    // Second call, same session: p2 (sticky) must be dispatched first
    await drain(router.stream({ sessionId: 's1', messages: [] } as any))
    const calls = (ctx.llm.prepareCall as any).mock.calls
    expect(calls[2]?.[0]).toEqual(expect.objectContaining({ provider: 'p2', model: 'm2' }))
  })

  it('different sessionId gets pure strategy order (no cross-session bleed)', async () => {
    const ctx = createMockContext()
    const router = makeRouter(ctx, 'auto', true)
    mockStream.mockImplementationOnce(errorStream)
    await drain(router.stream({ sessionId: 's1', messages: [] } as any))

    await drain(router.stream({ sessionId: 'other', messages: [] } as any))
    const calls = (ctx.llm.prepareCall as any).mock.calls
    const firstOfSecond = calls[2]?.[0]
    expect(firstOfSecond).toEqual(expect.objectContaining({ provider: 'p1', model: 'm1' }))
  })

  it('without sessionId, affinity keys on group id', async () => {
    const ctx = createMockContext()
    const router = makeRouter(ctx, 'auto')
    await drain(router.stream({ messages: [] } as any))
    expect((router as any).lastAffinity.get('test')).toEqual(
      expect.objectContaining({ provider: 'p1', model: 'm1' }),
    )
    await drain(router.stream({ messages: [] } as any))
    const calls = (ctx.llm.prepareCall as any).mock.calls
    expect(calls[1]?.[0]).toEqual(expect.objectContaining({ provider: 'p1', model: 'm1' }))
  })

  it('turn mode: expired record (121s) is ignored; session mode: same age still sticks', async () => {
    const staleTs = Date.now() - 121_000

    const ctxTurn = createMockContext()
    const routerTurn = makeRouter(ctxTurn, 'turn')
    ;(routerTurn as any).lastAffinity.set('test', { provider: 'p2', model: 'm2', ts: staleTs })
    await drain(routerTurn.stream({ messages: [] } as any))
    expect((ctxTurn.llm.prepareCall as any).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ provider: 'p1', model: 'm1' }), // pure order, record expired
    )

    const ctxSess = createMockContext()
    const routerSess = makeRouter(ctxSess, 'session')
    ;(routerSess as any).lastAffinity.set('test', { provider: 'p2', model: 'm2', ts: staleTs })
    await drain(routerSess.stream({ messages: [] } as any))
    expect((ctxSess.llm.prepareCall as any).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ provider: 'p2', model: 'm2' }), // session: unbounded
    )
  })

  it('stays=off never writes an affinity record', async () => {
    const ctx = createMockContext()
    const router = makeRouter(ctx, 'off')
    await drain(router.stream({ sessionId: 's1', messages: [] } as any))
    expect((router as any).lastAffinity.size).toBe(0)
  })

  it('failed sticky member clears the record; next call uses strategy order', async () => {
    const ctx = createMockContext()
    const router = makeRouter(ctx, 'session', true)
    ;(router as any).lastAffinity.set('test', { provider: 'p2', model: 'm2', ts: Date.now() })

    // Sticky p2 fails → record dropped mid-chain → p1 succeeds and becomes
    // the new sticky target. The broken member must no longer be sticky.
    mockStream.mockImplementationOnce(errorStream)
    await drain(router.stream({ messages: [] } as any))
    expect((router as any).lastAffinity.get('test')).toEqual(
      expect.objectContaining({ provider: 'p1', model: 'm1' }),
    )

    // Next call: p1 (sticky AND strategy order) — p2 never retried first
    await drain(router.stream({ messages: [] } as any))
    const calls = (ctx.llm.prepareCall as any).mock.calls
    expect(calls[2]?.[0]).toEqual(expect.objectContaining({ provider: 'p1', model: 'm1' }))
  })

  it('rule target wins over affinity (affinity member at most second)', async () => {
    const ctx = createMockContext()
    const router = new MagpieRouter(ctx as any, {
      routeGroups: [{
        id: 'test',
        name: 'Test',
        members: [
          { provider: 'p1', model: 'm1', priority: 1, enabled: true },
          { provider: 'p2', model: 'm2', priority: 2, enabled: true },
          { provider: 'p3', model: 'm3', priority: 3, enabled: true },
        ],
        strategy: 'order',
        stays: 'session',
        enabled: true,
        rules: [{ minTokens: 1, target: { provider: 'p3', model: 'm3' } }],
      }],
      defaultGroup: 'test',
      quotaTracking: { enabled: false, syncWithTokenMeter: false },
      fallback: { enabled: false, maxRetries: 0, retryDelay: 0, recoverableErrors: [] },
    })
    ;(router as any).lastAffinity.set('test', { provider: 'p2', model: 'm2', ts: Date.now() })

    await drain(router.stream({ messages: [{ role: 'user', content: 'x'.repeat(100) }] } as any))
    const firstCall = (ctx.llm.prepareCall as any).mock.calls[0]?.[0]
    expect(firstCall).toEqual(expect.objectContaining({ provider: 'p3', model: 'm3' }))
  })

  it('legacy config without stays field behaves as session (default)', async () => {
    const ctx = createMockContext()
    const router = makeRouter(ctx) // no stays key
    await drain(router.stream({ messages: [] } as any))
    await drain(router.stream({ messages: [] } as any))
    const calls = (ctx.llm.prepareCall as any).mock.calls
    expect(calls[1]?.[0]).toEqual(expect.objectContaining({ provider: 'p1', model: 'm1' }))
  })
})

describe('failover classification: connection errors', () => {
  const drain = async (gen: AsyncIterable<any>) => {
    for await (const _ of gen) { /* consume */ }
  }

  const makeRouter = (ctx: any) =>
    new MagpieRouter(ctx, {
      routeGroups: [{
        id: 'test',
        name: 'Test',
        members: [
          { provider: 'ollama', model: 'llama3.2', priority: 1, enabled: true },
          { provider: 'deepseek', model: 'v4.1-flash', priority: 2, enabled: true },
        ],
        strategy: 'order',
        enabled: true,
      }],
      defaultGroup: 'test',
      quotaTracking: { enabled: false, syncWithTokenMeter: false },
      fallback: { enabled: true, maxRetries: 3, retryDelay: 0, recoverableErrors: [] },
    })

  it('SDK "Connection error." finish chunk triggers failover to next member', async () => {
    const ctx = createMockContext()
    const router = makeRouter(ctx)
    // ollama down → DSH normalizes APIConnectionError into an error finish chunk
    mockStream.mockImplementationOnce(async function* () {
      yield {
        type: 'finish',
        reason: { kind: 'error', failure: { message: 'Connection error.', code: 'UNKNOWN' } },
      }
    })
    const chunks: StreamChunk[] = []
    for await (const chunk of router.stream({ messages: [] })) {
      chunks.push(chunk)
    }
    // both members attempted, stream succeeded via deepseek
    const calls = (ctx.llm.prepareCall as any).mock.calls
    expect(calls.length).toBe(2)
    expect(calls[0][0]).toEqual(expect.objectContaining({ provider: 'ollama' }))
    expect(calls[1][0]).toEqual(expect.objectContaining({ provider: 'deepseek' }))
    expect((ctx.emit as any).mock.calls.some((c: any[]) => c[0] === 'router/fallback')).toBe(true)
  })

  it('permanent failures (auth) still do NOT fallback (no false positives)', async () => {
    const ctx = createMockContext()
    const router = makeRouter(ctx)
    mockStream.mockImplementationOnce(async function* () {
      yield {
        type: 'finish',
        reason: { kind: 'error', failure: { message: '401 Unauthorized', code: 'unauthorized' } },
      }
    })
    await expect(async () => {
      for await (const _ of router.stream({ messages: [] })) { /* consume */ }
    }).rejects.toThrow(/401 Unauthorized/)
    expect((ctx.llm.prepareCall as any).mock.calls.length).toBe(1)
  })

  it('shouldFallback classifies connection/network text as TRANSIENT', () => {
    const ctx = createMockContext()
    const router = makeRouter(ctx)
    const cfg = { enabled: true, maxRetries: 3, retryDelay: 0, recoverableErrors: [] }
    const sf = (e: any) => (router as any).shouldFallback(e, cfg)

    expect(sf({ message: 'Connection error.' })).toBe(true)
    expect(sf({ routeFailure: { message: 'Connection error.', code: 'UNKNOWN' } })).toBe(true)
    expect(sf({ message: 'route ollama/llama3.2 failed: Connection error.' })).toBe(true)
    expect(sf({ message: 'fetch failed', cause: { code: 'ECONNREFUSED' } })).toBe(true)
    expect(sf({ message: 'socket hang up' })).toBe(true)
    expect(sf({ message: 'getaddrinfo ENOTFOUND example.com' })).toBe(true)

    // permanent classes unchanged
    expect(sf({ code: 'unauthorized' })).toBe(false)
    expect(sf({ message: '401 Unauthorized' })).toBe(false)
    expect(sf({ message: 'invalid_api_key' })).toBe(false)
    expect(sf({ message: 'model_not_found' })).toBe(false)
    expect(sf({})).toBe(false)
  })

  it('custom recoverableErrors can also match routeFailure message', () => {
    const ctx = createMockContext()
    const router = makeRouter(ctx)
    const cfg = { enabled: true, maxRetries: 3, retryDelay: 0, recoverableErrors: ['OVERLOADED'] }
    const sf = (e: any) => (router as any).shouldFallback(e, cfg)
    expect(sf({ routeFailure: { message: 'Server overloaded, retry later' } })).toBe(true)
    expect(sf({ routeFailure: { message: 'Connection error.' } })).toBe(false) // custom list overrides built-ins
  })
})
