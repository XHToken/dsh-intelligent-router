> ℹ️ **设计文档**：本文为集成设计方案，部分内容（如 pace/weighted/intent 策略、独立意图分类器、中间件接线）为规划项，与最终实现不完全一致。实际实现以 [routing-strategies.md](routing-strategies.md) 与 [README.md](../README.md) 为准。

# Magpie LLM 路由集成方案

## 一、Magpie 架构深度解析

### 1.1 核心设计理念

**Magpie 的定位：**
- 本地 LLM API 网关（`127.0.0.1:3425`）
- 多协议翻译器（OpenAI Chat / Responses / Anthropic Messages / Gemini）
- 智能路由和故障转移
- 订阅账户管理

**关键特性：**
1. **统一接口** — 所有 Agent 使用同一个本地端点
2. **协议翻译** — 自动在不同 API 格式间转换
3. **智能路由** — 基于策略选择最优模型/账户
4. **自动降级** — 失败时自动切换到下一个候选
5. **配额管理** — 跟踪和限制账户使用量

### 1.2 路由组（Routing Groups）

Magpie 的核心创新是 **Routing Groups**：

```
group/daily-coding = [
  deepseek/deepseek-v4-pro,
  moonshot/kimi-k2.5,
  anthropic/claude-sonnet-5
]
```

**路由策略：**

| 策略 | 行为 |
|---|---|
| `smart` | 选择配额剩余时间最短的账户，减少重置时的浪费 |
| `order` | 按顺序使用，第一个失败才用下一个 |
| `rotate` | 每个 turn 轮换到下一个成员 |
| `usage` | 优先使用最少使用的成员 |
| `pace` | 使用每小时剩余配额最多的账户 |

**Intent Routing（意图路由）：**
- 使用小模型读取每个新 turn 的意图
- 测试代码 → 强模型
- 简单问题 → 便宜模型

### 1.3 Gateway 中间件系统

Magpie 的插件系统分为两类：

#### Provider Plugins（提供商插件）
- 运行在 Bun 运行时
- 负责登录、列出模型、处理请求
- 可以作为独立的提供商

#### Gateway Middleware（网关中间件）
- 运行在 Gateway 进程内（Go 的 moejs 引擎）
- JavaScript 编写的中间件
- 可以拦截和修改每个请求和响应

**中间件 Hook：**

```javascript
// onRequest - 请求前拦截
export function onRequest(body, ctx) {
  if (body.model === "fast") {
    return { ...body, model: "deepseek/deepseek-chat" };
  }
}

// onEvent - 流式事件中拦截
export function onEvent(event, ctx) {
  // 修改或过滤事件
  return modifiedEvent;
}

// onResponse - 完整响应后处理
export function onResponse(response, ctx) {
  // 记录指标、修改响应等
  return modifiedResponse;
}
```

**约束：**
- `onRequest` 和 `onResponse`：250ms 超时
- `onEvent`：50ms 超时
- 失败时保持原样（fail open）

### 1.4 账户和配额管理

**账户层次：**
```
Provider（提供商）
  └─ Account（账户，可以是 API key 或订阅）
      ├─ Key 1
      ├─ Key 2
      └─ Quota Windows（配额窗口）
          ├─ Daily limit
          ├─ Weekly limit
          └─ Monthly limit
```

**配额跟踪：**
- 每个 key/account 独立跟踪
- 5 小时滚动窗口（Claude/ChatGPT）
- 每日/每周/每月限制
- 自动在窗口续期前提醒

### 1.5 故障转移机制

**失败检测：**
- 401/403 → 认证失败，切换账户
- 429 → 限流，切换账户
- 5xx → 服务器错误，切换账户
- 超时 → 切换账户

**降级流程：**
1. 当前候选失败
2. 尝试路由组中的下一个成员
3. 如果所有成员都失败，返回错误
4. 记录失败原因和切换历史

---

## 二、Magpie 概念映射到 DeepSeek Harness

### 2.1 架构对比

| Magpie 概念 | DeepSeek Harness 对应 | 集成方式 |
|---|---|---|
| Gateway（网关） | `ctx.llm` 服务 | 作为 LLM 适配器注册 |
| Provider（提供商） | LLM Adapter | 实现 `LlmAdapter` 接口 |
| Routing Group（路由组） | Router Plugin | 策略引擎的核心 |
| Account（账户） | Credentials | 复用 `ctx.credentials` |
| Middleware（中间件） | Hook 系统 | 使用 `agent/*` 事件 |
| Quota（配额） | Token Meter | 集成 `ctx.tokenMeter` |
| Intent Routing（意图路由） | Task Analyzer | 任务分析器的增强版 |

### 2.2 集成架构

```
┌─────────────────────────────────────────────────────────────┐
│              DeepSeek Harness Plugin Layer                    │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         dsh-llm-magpie-router (主插件)                │  │
│  │                                                       │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────┐ │  │
│  │  │ Router Core │  │ Route Groups │  │ Middleware │ │  │
│  │  │ (路由核心)  │  │  (路由组)    │  │  (中间件)  │ │  │
│  │  └─────────────┘  └──────────────┘  └────────────┘ │  │
│  │         │                │                │          │  │
│  │         └────────────────┴────────────────┘          │  │
│  │                          │                            │  │
│  └──────────────────────────┼────────────────────────────┘  │
│                              │                               │
│  ┌──────────────────────────┼────────────────────────────┐  │
│  │                    ctx.llm (LLM Runtime)               │  │
│  │                           │                            │  │
│  │  ┌─────────────┐  ┌──────┴──────┐  ┌──────────────┐ │  │
│  │  │DeepSeek Adp │  │ Local Adp   │  │ Cloud Adp    │ │  │
│  │  └─────────────┘  └─────────────┘  └──────────────┘ │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Supporting Services                       │  │
│  │  • ctx.credentials (API keys, accounts)               │  │
│  │  • ctx.tokenMeter (usage tracking)                    │  │
│  │  • ctx.session (session state)                        │  │
│  │  • agent/* events (hooks)                             │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、详细集成实现

### 3.1 插件结构设计

```
packages/llm/llm-magpie-router/
├── src/
│   ├── index.ts                    # 插件入口
│   ├── router.ts                   # 核心路由器
│   ├── route-groups.ts             # 路由组管理
│   ├── routing-strategies.ts       # 路由策略实现
│   ├── intent-classifier.ts        # 意图分类器
│   ├── account-manager.ts          # 账户管理器
│   ├── quota-tracker.ts            # 配额跟踪器
│   ├── middleware.ts               # 中间件系统
│   ├── fallback.ts                 # 故障转移逻辑
│   └── types.ts                    # 类型定义
├── package.json
└── README.md
```

### 3.2 核心路由器实现

```typescript
// packages/llm/llm-magpie-router/src/router.ts

import { LlmAdapter, GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Context } from '@cordis'

export interface MagpieRouterConfig {
  // 路由组定义
  routeGroups: RouteGroup[]
  
  // 默认路由组
  defaultGroup: string
  
  // 意图路由配置
  intentRouting?: {
    enabled: boolean
    classifierModel: string  // 用于分类的小模型
    classifierProvider: string
  }
  
  // 配额管理
  quotaTracking: {
    enabled: boolean
    syncWithTokenMeter: boolean
  }
  
  // 中间件
  middleware?: Middleware[]
}

export interface RouteGroup {
  id: string
  name: string
  members: RouteGroupMember[]
  strategy: RoutingStrategy
  auto?: boolean  // 自动创建的组（如账户故障转移）
  hidden?: boolean  // 不在 UI 中显示
}

export interface RouteGroupMember {
  provider: string
  model: string
  accountId?: string  // 可选的账户标识
  priority?: number   // 优先级（用于 order 策略）
  weight?: number     // 权重（用于 weighted 策略）
}

export type RoutingStrategy = 
  | 'smart'      // 选择配额剩余时间最短的
  | 'order'      // 按顺序使用
  | 'rotate'     // 轮询
  | 'usage'      // 最少使用优先
  | 'pace'       // 按配额消耗速度
  | 'weighted'   // 加权随机
  | 'intent'     // 基于意图分类

export class MagpieRouter extends LlmAdapter {
  private groups: Map<string, RouteGroup>
  private quotaTracker: QuotaTracker
  private intentClassifier?: IntentClassifier
  private middlewareChain: MiddlewareChain
  
  constructor(
    private ctx: Context,
    private config: MagpieRouterConfig
  ) {
    super()
    this.groups = new Map(config.routeGroups.map(g => [g.id, g]))
    this.quotaTracker = new QuotaTracker(ctx, config.quotaTracking)
    this.middlewareChain = new MiddlewareChain(config.middleware ?? [])
    
    if (config.intentRouting?.enabled) {
      this.intentClassifier = new IntentClassifier(
        ctx,
        config.intentRouting.classifierProvider,
        config.intentRouting.classifierModel
      )
    }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    // 1. 运行中间件 onRequest
    const modifiedOptions = await this.middlewareChain.runOnRequest(options)
    
    // 2. 确定使用的路由组
    const groupId = this.resolveGroup(modifiedOptions)
    const group = this.groups.get(groupId)
    
    if (!group) {
      throw new LlmError('GROUP_NOT_FOUND', `Route group ${groupId} not found`)
    }
    
    // 3. 如果是意图路由，先分类
    let selectedMember: RouteGroupMember | undefined
    if (group.strategy === 'intent' && this.intentClassifier) {
      const intent = await this.intentClassifier.classify(modifiedOptions.messages)
      selectedMember = this.selectByIntent(group, intent)
    }
    
    // 4. 故障转移循环
    const candidates = this.getCandidates(group, selectedMember)
    let lastError: Error | undefined
    
    for (const member of candidates) {
      try {
        // 检查配额
        if (this.config.quotaTracking.enabled) {
          const quotaStatus = await this.quotaTracker.check(member)
          if (!quotaStatus.available) {
            continue  // 跳过配额不足的候选
          }
        }
        
        // 尝试分发到该成员
        yield* this.dispatchToMember(member, modifiedOptions)
        
        // 成功，记录使用
        await this.quotaTracker.record(member, modifiedOptions)
        return
        
      } catch (error) {
        lastError = error
        
        // 判断是否应该尝试下一个候选
        if (!this.shouldFallback(error)) {
          throw error  // 不可恢复的错误，直接抛出
        }
        
        // 记录失败，继续下一个
        this.ctx.emit('router/fallback', {
          group: groupId,
          failedMember: member,
          error: error.message,
          timestamp: Date.now(),
        })
      }
    }
    
    // 所有候选都失败
    throw lastError ?? new LlmError('ALL_CANDIDATES_FAILED', 'All route candidates failed')
  }
  
  private resolveGroup(options: GenerateOptions): string {
    // 如果指定了 provider 且是 group/ 开头，直接使用该组
    if (options.provider?.startsWith('group/')) {
      return options.provider.substring(6)
    }
    
    // 否则使用默认组
    return this.config.defaultGroup
  }
  
  private getCandidates(
    group: RouteGroup,
    preSelected?: RouteGroupMember
  ): RouteGroupMember[] {
    if (preSelected) {
      return [preSelected]  // 意图路由已选择
    }
    
    switch (group.strategy) {
      case 'order':
        return this.orderCandidates(group)
      case 'rotate':
        return this.rotateCandidates(group)
      case 'usage':
        return this.usageCandidates(group)
      case 'smart':
        return this.smartCandidates(group)
      case 'pace':
        return this.paceCandidates(group)
      case 'weighted':
        return this.weightedCandidates(group)
      default:
        return group.members
    }
  }
  
  private orderCandidates(group: RouteGroup): RouteGroupMember[] {
    // 按优先级排序
    return [...group.members].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
  }
  
  private rotateCandidates(group: RouteGroup): RouteGroupMember[] {
    // 轮询：基于上次使用的索引
    const lastIndex = this.getLastUsedIndex(group.id)
    const rotated = [
      ...group.members.slice(lastIndex + 1),
      ...group.members.slice(0, lastIndex + 1)
    ]
    return rotated
  }
  
  private usageCandidates(group: RouteGroup): RouteGroupMember[] {
    // 最少使用优先
    const usageCounts = this.getUsageCounts(group.members)
    return [...group.members].sort((a, b) => 
      (usageCounts.get(a) ?? 0) - (usageCounts.get(b) ?? 0)
    )
  }
  
  private smartCandidates(group: RouteGroup): RouteGroupMember[] {
    // 选择配额剩余时间最短的账户
    const quotaRemaining = group.members.map(m => ({
      member: m,
      remaining: this.quotaTracker.getRemainingTime(m)
    }))
    
    return quotaRemaining
      .sort((a, b) => a.remaining - b.remaining)
      .map(q => q.member)
  }
  
  private paceCandidates(group: RouteGroup): RouteGroupMember[] {
    // 选择每小时剩余配额最多的账户
    const hourlyQuota = group.members.map(m => ({
      member: m,
      quota: this.quotaTracker.getHourlyQuotaRemaining(m)
    }))
    
    return hourlyQuota
      .sort((a, b) => b.quota - a.quota)
      .map(q => q.member)
  }
  
  private weightedCandidates(group: RouteGroup): RouteGroupMember[] {
    // 加权随机
    const totalWeight = group.members.reduce((sum, m) => sum + (m.weight ?? 1), 0)
    const random = Math.random() * totalWeight
    let cumulative = 0
    
    for (const member of group.members) {
      cumulative += member.weight ?? 1
      if (random <= cumulative) {
        return [member, ...group.members.filter(m => m !== member)]
      }
    }
    
    return group.members
  }
  
  private async *dispatchToMember(
    member: RouteGroupMember,
    options: GenerateOptions
  ): AsyncIterable<StreamChunk> {
    const adapter = this.ctx.llm.getAdapter(member.provider)
    
    if (!adapter) {
      throw new LlmError('NO_ADAPTER', `Adapter for ${member.provider} not found`)
    }
    
    // 运行中间件包装
    const wrappedStream = this.middlewareChain.wrapStream(
      adapter.stream.bind(adapter),
      { ...options, provider: member.provider, model: member.model }
    )
    
    yield* wrappedStream
  }
  
  private shouldFallback(error: any): boolean {
    // 可恢复的错误类型
    const recoverableCodes = [
      'RATE_LIMIT',
      'AUTH',
      'QUOTA',
      'TIMEOUT',
      'SERVER_ERROR',
    ]
    
    return recoverableCodes.includes(error.code)
  }
  
  private selectByIntent(
    group: RouteGroup,
    intent: string
  ): RouteGroupMember | undefined {
    // 根据意图选择成员
    // 例如：intent === 'code-generation' 选择代码模型
    //      intent === 'simple-qa' 选择便宜模型
    
    const intentMapping = this.getIntentMapping(group)
    const member = intentMapping[intent]
    
    return member ? group.members.find(m => 
      m.provider === member.provider && m.model === member.model
    ) : undefined
  }
  
  private getLastUsedIndex(groupId: string): number {
    // 从持久化存储或内存中获取上次使用的索引
    return 0  // 简化实现
  }
  
  private getUsageCounts(members: RouteGroupMember[]): Map<RouteGroupMember, number> {
    // 获取每个成员的使用次数
    return new Map()  // 简化实现
  }
  
  private getIntentMapping(group: RouteGroup): Record<string, RouteGroupMember> {
    // 从配置中获取意图到成员的映射
    return {}  // 简化实现
  }
}
```

### 3.3 路由组管理

```typescript
// packages/llm/llm-magpie-router/src/route-groups.ts

export interface RouteGroupManager {
  create(group: Omit<RouteGroup, 'id'>): Promise<RouteGroup>
  update(id: string, updates: Partial<RouteGroup>): Promise<RouteGroup>
  delete(id: string): Promise<void>
  list(): RouteGroup[]
  get(id: string): RouteGroup | undefined
}

export class RouteGroupManagerImpl implements RouteGroupManager {
  private groups: Map<string, RouteGroup> = new Map()
  private nextId = 1
  
  async create(group: Omit<RouteGroup, 'id'>): Promise<RouteGroup> {
    const id = `group-${this.nextId++}`
    const newGroup: RouteGroup = { ...group, id }
    this.groups.set(id, newGroup)
    
    // 持久化到配置
    await this.persist()
    
    return newGroup
  }
  
  async update(id: string, updates: Partial<RouteGroup>): Promise<RouteGroup> {
    const existing = this.groups.get(id)
    if (!existing) {
      throw new Error(`Route group ${id} not found`)
    }
    
    const updated = { ...existing, ...updates }
    this.groups.set(id, updated)
    
    await this.persist()
    
    return updated
  }
  
  async delete(id: string): Promise<void> {
    this.groups.delete(id)
    await this.persist()
  }
  
  list(): RouteGroup[] {
    return Array.from(this.groups.values())
  }
  
  get(id: string): RouteGroup | undefined {
    return this.groups.get(id)
  }
  
  private async persist() {
    // 保存到配置文件或 Session 状态
    // 可以使用 ctx.settings 或自定义存储
  }
}
```

### 3.4 配额跟踪器

```typescript
// packages/llm/llm-magpie-router/src/quota-tracker.ts

export interface QuotaTracker {
  check(member: RouteGroupMember): Promise<QuotaStatus>
  record(member: RouteGroupMember, options: GenerateOptions): Promise<void>
  getRemainingTime(member: RouteGroupMember): number
  getHourlyQuotaRemaining(member: RouteGroupMember): number
}

export interface QuotaStatus {
  available: boolean
  remaining: number
  limit: number
  resetTime: number
}

export class QuotaTrackerImpl implements QuotaTracker {
  private usage: Map<string, UsageRecord> = new Map()
  
  constructor(
    private ctx: Context,
    private config: { enabled: boolean; syncWithTokenMeter: boolean }
  ) {}
  
  async check(member: RouteGroupMember): Promise<QuotaStatus> {
    const key = this.getMemberKey(member)
    const record = this.usage.get(key) ?? {
      tokens: 0,
      requests: 0,
      lastReset: Date.now(),
    }
    
    // 从 ctx.credentials 或配置中获取配额限制
    const limits = await this.getQuotaLimits(member)
    
    // 检查是否超出限制
    const tokensAvailable = record.tokens < limits.maxTokens
    const requestsAvailable = record.requests < limits.maxRequests
    
    return {
      available: tokensAvailable && requestsAvailable,
      remaining: limits.maxTokens - record.tokens,
      limit: limits.maxTokens,
      resetTime: record.lastReset + limits.resetInterval,
    }
  }
  
  async record(member: RouteGroupMember, options: GenerateOptions): Promise<void> {
    const key = this.getMemberKey(member)
    const record = this.usage.get(key) ?? {
      tokens: 0,
      requests: 0,
      lastReset: Date.now(),
    }
    
    // 估算 token 使用量
    const estimatedTokens = this.estimateTokens(options)
    
    record.tokens += estimatedTokens
    record.requests += 1
    
    // 检查是否需要重置（基于时间窗口）
    const limits = await this.getQuotaLimits(member)
    if (Date.now() - record.lastReset > limits.resetInterval) {
      record.tokens = estimatedTokens
      record.requests = 1
      record.lastReset = Date.now()
    }
    
    this.usage.set(key, record)
    
    // 如果启用了与 TokenMeter 的同步
    if (this.config.syncWithTokenMeter) {
      this.ctx.tokenMeter.record({
        provider: member.provider,
        model: member.model,
        inputTokens: estimatedTokens.input,
        outputTokens: estimatedTokens.output,
      })
    }
  }
  
  getRemainingTime(member: RouteGroupMember): number {
    const key = this.getMemberKey(member)
    const record = this.usage.get(key)
    if (!record) return Infinity
    
    const limits = this.getQuotaLimitsSync(member)
    const elapsed = Date.now() - record.lastReset
    return Math.max(0, limits.resetInterval - elapsed)
  }
  
  getHourlyQuotaRemaining(member: RouteGroupMember): number {
    const key = this.getMemberKey(member)
    const record = this.usage.get(key)
    if (!record) return Infinity
    
    const limits = this.getQuotaLimitsSync(member)
    const hourlyUsage = this.calculateHourlyUsage(record)
    return Math.max(0, limits.hourlyLimit - hourlyUsage)
  }
  
  private getMemberKey(member: RouteGroupMember): string {
    return `${member.provider}:${member.model}:${member.accountId ?? 'default'}`
  }
  
  private async getQuotaLimits(member: RouteGroupMember): Promise<QuotaLimits> {
    // 从配置或 credentials 中获取
    return {
      maxTokens: 1000000,
      maxRequests: 1000,
      hourlyLimit: 100000,
      resetInterval: 24 * 60 * 60 * 1000,  // 24 小时
    }
  }
  
  private getQuotaLimitsSync(member: RouteGroupMember): QuotaLimits {
    // 同步版本
    return {
      maxTokens: 1000000,
      maxRequests: 1000,
      hourlyLimit: 100000,
      resetInterval: 24 * 60 * 60 * 1000,
    }
  }
  
  private estimateTokens(options: GenerateOptions): { input: number; output: number } {
    // 粗略估算
    const inputTokens = JSON.stringify(options.messages).length / 4
    const outputTokens = options.maxTokens ?? 2000
    return { input: inputTokens, output: outputTokens }
  }
  
  private calculateHourlyUsage(record: UsageRecord): number {
    // 简化实现：假设所有使用都在最近一小时内
    return record.tokens
  }
}

interface UsageRecord {
  tokens: number
  requests: number
  lastReset: number
}

interface QuotaLimits {
  maxTokens: number
  maxRequests: number
  hourlyLimit: number
  resetInterval: number
}
```

### 3.5 意图分类器

```typescript
// packages/llm/llm-magpie-router/src/intent-classifier.ts

export class IntentClassifier {
  constructor(
    private ctx: Context,
    private provider: string,
    private model: string
  ) {}
  
  async classify(messages: Message[]): Promise<string> {
    // 使用小模型分类意图
    const adapter = this.ctx.llm.getAdapter(this.provider)
    if (!adapter) {
      return 'unknown'
    }
    
    const classificationPrompt = `分类以下用户请求的意图。返回以下类别之一：
- code-generation: 编写代码、修复 bug、代码审查
- simple-qa: 简单问题、快速回答
- reasoning: 复杂推理、分析、规划
- creative: 创意写作、头脑风暴
- unknown: 其他

用户请求：
${this.extractLastUserMessage(messages)}

意图类别：`

    try {
      let response = ''
      for await (const chunk of adapter.stream({
        provider: this.provider,
        model: this.model,
        messages: [{
          role: 'user',
          content: [{ type: 'text', text: classificationPrompt }]
        }],
        maxTokens: 50,
      })) {
        if (chunk.type === 'text-delta') {
          response += chunk.text
        }
      }
      
      // 解析响应
      const intent = response.trim().toLowerCase()
      const validIntents = ['code-generation', 'simple-qa', 'reasoning', 'creative', 'unknown']
      
      return validIntents.find(i => intent.includes(i)) ?? 'unknown'
    } catch (error) {
      return 'unknown'
    }
  }
  
  private extractLastUserMessage(messages: Message[]): string {
    const lastUser = [...messages].reverse().find(m => m.role === 'user')
    if (!lastUser) return ''
    
    return lastUser.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n')
      .substring(0, 500)  // 限制长度
  }
}
```

### 3.6 中间件系统

```typescript
// packages/llm/llm-magpie-router/src/middleware.ts

export interface Middleware {
  name: string
  onRequest?: (options: GenerateOptions, ctx: MiddlewareContext) => Promise<GenerateOptions | void>
  onEvent?: (event: StreamChunk, ctx: MiddlewareContext) => Promise<StreamChunk | null | void>
  onResponse?: (response: StreamChunk[], ctx: MiddlewareContext) => Promise<void>
}

export interface MiddlewareContext {
  group: RouteGroup
  member: RouteGroupMember
  state: Map<string, any>  // 中间件共享状态
  reject: (status: number, message: string) => never
}

export class MiddlewareChain {
  constructor(private middlewares: Middleware[]) {}
  
  async runOnRequest(options: GenerateOptions): Promise<GenerateOptions> {
    let current = options
    
    for (const mw of this.middlewares) {
      if (mw.onRequest) {
        const ctx = this.createContext(options)
        try {
          const result = await Promise.race([
            mw.onRequest(current, ctx),
            this.timeout(250)  // 250ms 超时
          ])
          
          if (result && typeof result === 'object') {
            current = result as GenerateOptions
          }
        } catch (error) {
          // 失败时保持原样（fail open）
          console.error(`Middleware ${mw.name} onRequest failed:`, error)
        }
      }
    }
    
    return current
  }
  
  wrapStream(
    streamFn: (options: GenerateOptions) => AsyncIterable<StreamChunk>,
    options: GenerateOptions
  ): AsyncIterable<StreamChunk> {
    const self = this
    
    return (async function* () {
      const ctx = self.createContext(options)
      const collected: StreamChunk[] = []
      
      for await (const event of streamFn(options)) {
        let current = event
        
        // 运行 onEvent 中间件
        for (const mw of self.middlewares) {
          if (mw.onEvent) {
            try {
              const result = await Promise.race([
                mw.onEvent(current, ctx),
                self.timeout(50)  // 50ms 超时
              ])
              
              if (result === null) {
                current = null as any  // 丢弃事件
                break
              } else if (result) {
                current = result
              }
            } catch (error) {
              console.error(`Middleware ${mw.name} onEvent failed:`, error)
            }
          }
        }
        
        if (current) {
          collected.push(current)
          yield current
        }
      }
      
      // 运行 onResponse 中间件
      for (const mw of self.middlewares) {
        if (mw.onResponse) {
          try {
            await Promise.race([
              mw.onResponse(collected, ctx),
              self.timeout(250)
            ])
          } catch (error) {
            console.error(`Middleware ${mw.name} onResponse failed:`, error)
          }
        }
      }
    })()
  }
  
  private createContext(options: GenerateOptions): MiddlewareContext {
    return {
      group: {} as RouteGroup,  // 需要从路由器传入
      member: {} as RouteGroupMember,
      state: new Map(),
      reject: (status, message) => {
        throw new LlmError('MIDDLEWARE_REJECTED', `Middleware rejected: ${message}`, { status })
      },
    }
  }
  
  private timeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Timeout')), ms)
    })
  }
}
```

### 3.7 插件入口

```typescript
// packages/llm/llm-magpie-router/src/index.ts

import { z } from 'zod'
import type { Context } from '@cordis'
import { MagpieRouter } from './router'
import { RouteGroupManagerImpl } from './route-groups'

export const name = 'llm-magpie-router'
export const inject = ['llm', 'credentials?', 'tokenMeter?']

export const Config = z.object({
  routeGroups: z.array(z.object({
    id: z.string(),
    name: z.string(),
    members: z.array(z.object({
      provider: z.string(),
      model: z.string(),
      accountId: z.string().optional(),
      priority: z.number().optional(),
      weight: z.number().optional(),
    })),
    strategy: z.enum(['smart', 'order', 'rotate', 'usage', 'pace', 'weighted', 'intent']),
    auto: z.boolean().optional(),
    hidden: z.boolean().optional(),
  })),
  defaultGroup: z.string(),
  intentRouting: z.object({
    enabled: z.boolean(),
    classifierModel: z.string(),
    classifierProvider: z.string(),
  }).optional(),
  quotaTracking: z.object({
    enabled: z.boolean(),
    syncWithTokenMeter: z.boolean(),
  }),
  middleware: z.array(z.any()).optional(),
})

export type Config = z.infer<typeof Config>

export function apply(ctx: Context, config: Config) {
  // 创建路由器
  const router = new MagpieRouter(ctx, config)
  
  // 注册为 'magpie' 提供商
  ctx.llm.registerAdapter(['magpie'], router)
  
  // 注册路由组管理服务
  const groupManager = new RouteGroupManagerImpl()
  ctx.provide('routeGroups', groupManager)
  
  // 注册 Hook
  registerHooks(ctx, router)
}

function registerHooks(ctx: Context, router: MagpieRouter) {
  // 在 agent/pre-step 中记录路由决策
  ctx.on('agent/pre-step', async (event, next) => {
    const startTime = Date.now()
    
    await next()
    
    // 记录决策时间
    const duration = Date.now() - startTime
    ctx.emit('router/decision-time', { duration })
  })
  
  // 在 agent/request 中记录实际使用的模型
  ctx.on('agent/request', async (event, next) => {
    await next()
    
    ctx.emit('router/request-routed', {
      provider: event.provider,
      model: event.model,
      sessionId: event.sessionId,
    })
  })
  
  // 监听故障转移事件
  ctx.on('router/fallback', async (event) => {
    console.log(`Router fallback: ${event.group} -> ${event.failedMember}`, event.error)
  })
}
```

---

## 四、配置示例

### 4.1 基础配置

```yaml
# .dsh/cordis.yml
plugins:
  # DeepSeek 云端适配器
  - name: '@deepseek-ai/dsh-llm-deepseek-api-key'
    config:
      apiKeyEnv: DEEPSEEK_API_KEY
  
  # 本地 Ollama 适配器
  - name: '@deepseek-ai/dsh-llm-ollama'
    config:
      baseUrl: 'http://localhost:11434'
  
  # Magpie 路由器
  - name: '@deepseek-ai/dsh-llm-magpie-router'
    config:
      routeGroups:
        - id: 'daily-coding'
          name: '日常编码'
          members:
            - provider: 'deepseek-official'
              model: 'deepseek-v4-pro'
              priority: 1
            - provider: 'ollama'
              model: 'deepseek-coder:6.7b'
              priority: 2
          strategy: 'order'
        
        - id: 'smart-routing'
          name: '智能路由'
          members:
            - provider: 'deepseek-official'
              model: 'deepseek-v4-flash'
            - provider: 'ollama'
              model: 'llama3:8b'
          strategy: 'smart'
        
        - id: 'intent-based'
          name: '意图路由'
          members:
            - provider: 'deepseek-official'
              model: 'deepseek-v4-pro'
            - provider: 'deepseek-official'
              model: 'deepseek-v4-flash'
          strategy: 'intent'
      
      defaultGroup: 'daily-coding'
      
      intentRouting:
        enabled: true
        classifierProvider: 'ollama'
        classifierModel: 'llama3:8b'
      
      quotaTracking:
        enabled: true
        syncWithTokenMeter: true
```

### 4.2 高级配置（多账户故障转移）

```yaml
plugins:
  - name: '@deepseek-ai/dsh-llm-magpie-router'
    config:
      routeGroups:
        # 多账户故障转移组
        - id: 'claude-accounts'
          name: 'Claude 账户池'
          members:
            - provider: 'anthropic'
              model: 'claude-sonnet-5'
              accountId: 'account-1'
            - provider: 'anthropic'
              model: 'claude-sonnet-5'
              accountId: 'account-2'
            - provider: 'anthropic'
              model: 'claude-sonnet-5'
              accountId: 'account-3'
          strategy: 'smart'  # 选择配额剩余时间最短的
          auto: true  # 自动创建的故障转移组
      
      defaultGroup: 'claude-accounts'
      
      quotaTracking:
        enabled: true
        syncWithTokenMeter: true
```

---

## 五、与 Magpie 的对比

### 5.1 功能对比

| 功能 | Magpie | dsh-llm-magpie-router | 说明 |
|---|---|---|---|
| 路由组 | ✅ | ✅ | 完全支持 |
| 多策略路由 | ✅ | ✅ | smart/order/rotate/usage/pace/weighted/intent |
| 意图路由 | ✅ | ✅ | 使用小模型分类 |
| 故障转移 | ✅ | ✅ | 自动切换到下一个候选 |
| 配额管理 | ✅ | ✅ | 集成 TokenMeter |
| 中间件 | ✅ | ✅ | onRequest/onEvent/onResponse |
| 协议翻译 | ✅ | ❌ | 不需要，DSH 已统一 |
| 订阅账户 | ✅ | ⚠️ | 部分支持（通过 credentials） |
| UI 界面 | ✅ | ❌ | 需要通过 DSH Web UI 扩展 |

### 5.2 集成优势

1. **无缝集成** — 直接作为 LLM 适配器注册，无需修改核心代码
2. **复用现有服务** — 使用 `ctx.credentials`、`ctx.tokenMeter` 等
3. **事件驱动** — 通过 `agent/*` 事件实现 Hook 功能
4. **插件化** — 符合 DSH 的 everything-is-a-plugin 理念
5. **可扩展** — 可以轻松添加新的路由策略和中间件

---

## 六、实施路线图

### Phase 1: 核心路由（2-3 天）
- [ ] 实现基础路由器
- [ ] 实现路由组管理
- [ ] 实现 order/rotate/usage 策略
- [ ] 基础故障转移

### Phase 2: 高级策略（2-3 天）
- [ ] 实现 smart/pace 策略（配额感知）
- [ ] 实现 weighted 策略
- [ ] 配额跟踪器
- [ ] 与 TokenMeter 集成

### Phase 3: 意图路由（2-3 天）
- [ ] 意图分类器
- [ ] 意图到模型的映射
- [ ] 分类结果缓存

### Phase 4: 中间件系统（1-2 天）
- [ ] 中间件链
- [ ] onRequest/onEvent/onResponse Hook
- [ ] 超时和错误处理

### Phase 5: 测试和优化（2-3 天）
- [ ] 单元测试
- [ ] 集成测试
- [ ] 性能优化
- [ ] 文档

**总计：9-14 天**

---

## 七、总结

通过将 Magpie 的路由概念集成到 DeepSeek Harness，我们获得了：

1. **智能路由** — 基于策略、配额、意图的动态路由
2. **高可用性** — 自动故障转移和多账户支持
3. **成本优化** — 智能选择最经济的模型/账户
4. **灵活扩展** — 中间件系统支持自定义逻辑
5. **无缝集成** — 完全符合 DSH 的插件架构

这个方案既保留了 Magpie 的核心创新（路由组、智能策略、意图路由），又充分利用了 DeepSeek Harness 的现有基础设施（LLM 服务、凭证管理、Token 计量），实现了两者的优势互补。
