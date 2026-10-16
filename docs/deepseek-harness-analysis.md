# DeepSeek Harness 源码分析与动态路由方案

## 一、平台架构总览

### 1.1 核心理念：Everything is a Plugin

DeepSeek Harness (`dsh`) 基于 **Cordis** 框架构建，采用"一切皆插件"的架构范式。其设计哲学源自论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)。

**关键特征：**
- 没有特权核心：所有功能（模型适配器、工具注册表、Session 日志、Agent 循环本身）都是可替换的插件
- 插件贡献服务（services）、类型化事件（typed events）和可逆效果（reversible effects）到共享上下文
- 注册是效果（effects），当插件卸载时自动回滚

### 1.2 仓库结构

```
deepseek-harness/
├── packages/              # 核心包目录
│   ├── core/              # 核心子系统
│   │   ├── session/       # 会话日志（append-only SessionEvent log）
│   │   ├── system-prompt/ # 提示词和工具模式组装
│   │   ├── tools/         # 工具注册和受保护的执行管道
│   │   ├── agent/         # Agent 接口和注册表
│   │   ├── agent-loop/    # 默认 Agent 循环驱动
│   │   └── scope/         # 按 Agent 范围注册的原始类型
│   ├── llm/               # LLM 相关包
│   │   ├── llm/           # 核心 LLM 服务（适配器层）
│   │   ├── llm-deepseek/  # DeepSeek 官方 API 适配器
│   │   ├── llm-pi-ai/     # 多提供商适配器（基于 pi-ai）
│   │   ├── llm-retry/     # 重试执行器
│   │   └── token-meter/   # Token 计量
│   ├── api/               # API 网关
│   │   ├── gateway/       # Typert API Gateway
│   │   └── remotes/       # 远程 API 聚合
│   ├── bundle/            # 发行包
│   │   ├── base/          # 基础层（所有 profile 共享）
│   │   ├── web-app/       # Web 应用
│   │   ├── headless/      # 一次性运行器
│   │   ├── sdk-app/       # SDK JSON-RPC 服务
│   │   └── acp-app/       # 自动化 ACP 服务
│   └── ...                # 其他插件包
├── docs/                  # 文档
│   ├── architecture.md    # 核心架构文档
│   ├── cookbook/          # 扩展指南
│   │   └── adding-an-llm-adapter.md  # 添加 LLM 适配器
│   └── subsystems/        # 子系统文档
└── apps/                  # 应用程序
    └── desktop/           # Electron 桌面应用
```

### 1.3 Profiles 与 Bundles

**Profile** 是启动时从有序层组合的插件树：
- `web` — Web UI + 浏览器应用
- `headless` — 一次性运行器，无服务器
- `sdk` — SDK JSON-RPC 服务器
- `sdk-minimal` — 最小 SDK（独立 bundle，不使用 dsh-base）
- `acp` — 仅自动化的 ACP 服务器

**Bundle** 是 Cordis 配置行和代码的分发格式，每一层都可被上层修补。

查看本机启动的插件树：
```sh
dsh --profile web --dump-config
```

### 1.4 核心包与 Context Key 映射

| Package | 职责 | Context Key |
|---|---|---|
| `core/session` | append-only 会话日志和内存存储 | `ctx.sessions` |
| `core/system-prompt` | 提示词和工具模式组装 | `ctx.systemPrompt` |
| `core/tools` | 范围化工具注册和受保护的执行管道 | `ctx.tools` |
| `core/agent` | Agent 接口、实时注册表、`agent/*` 事件 | `ctx.agents` |
| `core/agent-loop` | 实现 Agent 接口的默认驱动 | `ctx.agentLoop` |
| `llm/llm` | 消息和流词汇、适配器接口 | `ctx.llm` |

---

## 二、插件系统设计

### 2.1 Cordis 框架核心

Cordis 是 dsh 的插件内核，管理：
- **插件挂载**（Plugin Mounting）
- **依赖解析**（Dependency Resolution）
- **跨插件通信**（Inter-Plugin Communication）

每个插件通过 `package.json` 中的 `dsh` 字段声明：
- `dsh.profile` — 列出 profile 的 bundles
- `dsh.bundle` — 指向 bundle 的 patch 文件

### 2.2 Capability Seams（能力接缝）

**Seam** 是可交换的能力，有三个角色：
1. **Service Definition** — 声明接口
2. **Service Provider** — 实现接口
3. **Consumer** — 使用能力（通常是模型面向的工具）

一个 provider 的交换可以改变整个产品行为。例如，Filesystem 和 subprocess providers 共享一个执行世界，将它们指向远程沙盒会同时移动 Bash、PTY 和 LSP。

### 2.3 事件系统

事件是扩展点，选择正确的域是大多数变更的首要决策：

| 事件域 | 用途 |
|---|---|
| **Session events** | 持久化事实，写入日志并通过 `session/event` 广播 |
| **Agent events** (`agent/*`) | 携带实时 Agent：inbox、step、status、request、validation、continuation |
| **Capability events** | 将策略和适配器附加到 seam（`fs/*`、`tools/*`、`telemetry/*`） |

### 2.4 Turn 流程

```
turn/start
  claim next-step input + one queued message
  assemble prompt sections + tool schemas
  -> agent/pre-step (可拦截/重写/拒绝)
     reject | enter(messages, startsRequestSeries?)
     step/start
     agent/request -> prepareCall (cancellation commits neither)
     reconcile system/message
     append entered messages as user/message
     log request/header and request/context
     derive and freeze model history
     stream the bound prepared call -> llm/stream
       -> agent/assistant-stream start
       -> agent/assistant-stream chunk*
       -> assistant/message | assistant/attempt
       -> agent/assistant-stream end
     tool/call* -> tools/pre-execute -> tools/execute -> tools/post-execute -> tool/result*
     step/end
     tools owe another request -> claim -> next step
  -> agent/turn-stopping
turn/end
```

**关键拦截点：**
- `agent/pre-step` — 决定接受的输入，可重写或拒绝
- `agent/request` — 在 `prepareCall()` 之前，可拦截请求
- `agent/turn-stopping` — 串行事件，可停止 turn

---

## 三、LLM 适配器系统

### 3.1 适配器架构

LLM 服务 (`@deepseek-ai/dsh-llm`) 是提供商中立的调用层：
- 定义规范的消息、内容块和流块词汇
- 每个提供商适配器翻译自己的 wire 格式到该词汇
- 注册表是拓扑所有者

**核心文件：**
| 文件 | 职责 |
|---|---|
| `src/index.ts` | `LlmRuntime` 服务：适配器注册、可配置提供商目录、模型发现、调用准备 |
| `src/types.ts` | `StreamChunk` 协议、内容块映射、完成原因 |
| `src/message.ts` | 不可变消息构造函数 |
| `src/assembler.ts` | `BlockAssembler`：增量块到块的组装 |
| `src/call-config.ts` | 调用配置验证和请求冻结 |

### 3.2 添加 LLM 适配器

参考实现：
- `packages/llm/llm-deepseek` — 直接 HTTP，SSE 由 `eventsource-parser` 分帧
- `packages/llm/llm-pi-ai` — 包装 LLM 库

**适配器结构：**
```ts
class MyAdapter extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> { … }
}

export const name = 'llm-myprovider'
export const inject = ['llm']
export const Config = z.object({ apiKey: z.string(), … })

export function apply(ctx: Context, config: Config) {
  ctx.llm.registerAdapter(['my-provider'], new MyAdapter(…))
}
```

**协议义务：**
1. 在 `finish` 之前发送 `usage`；`finish` 之后不发送任何内容
2. Tool-call `arguments` 是原始 JSON 字符串端到端
3. 按首次出现的流顺序分配块 `index`
4. 错误有两种路径：从 `stream()` 抛出（传输/协议失败），或以 `finish {kind: 'error'}` 结束流（提供商内失败）
5. 遵守 `options.signal`（传递给 fetch / SDK）

### 3.3 模型发现与解析

```ts
// 列出模型
ctx.llm.listModels(provider)

// 解析模型能力
ctx.llm.resolveModel(provider, model)
// 返回：context window、output default、reasoning efforts、input modalities、system prompt update mode
```

### 3.4 调用准备与分发

```ts
// 准备调用
const prepared = await ctx.llm.prepareCall(config, signal, configure?)

// 分发流
for await (const chunk of ctx.llm.stream({
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  messages: [...],
})) {
  // chunks: block-start, text-delta, ..., usage, finish
}
```

---

## 四、动态路由方案设计

基于对 deepseek-harness 架构的深入分析，设计云端 LLM 和本地模型 API 的动态路由方案。

### 4.1 方案概述

```
┌─────────────────────────────────────────────────────────────────┐
│                    Dynamic LLM Router Plugin                     │
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │ Task Analyzer │───▶│ Route Policy │───▶│ Adapter Selector │  │
│  │  (任务分析器) │    │  (路由策略)   │    │  (适配器选择器)  │  │
│  └──────────────┘    └──────────────┘    └──────────────────┘  │
│         │                    │                      │            │
│         ▼                    ▼                      ▼            │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │ Token Counter │    │ Cost Estimator│   │ Health Monitor   │  │
│  │  (Token计数)  │    │ (成本估算)    │   │  (健康监控)      │  │
│  └──────────────┘    └──────────────┘    └──────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
         ┌────────────────────────────────────────┐
         │           LlmRuntime (ctx.llm)          │
         │                                         │
         │  ┌─────────────┐    ┌───────────────┐  │
         │  │ Cloud Adapter│    │ Local Adapter  │  │
         │  │ (DeepSeek等) │    │ (Ollama/vLLM) │  │
         │  └─────────────┘    └───────────────┘  │
         └────────────────────────────────────────┘
```

### 4.2 核心组件设计

#### 4.2.1 任务分析器 (Task Analyzer)

根据任务特征决定路由目标：

```ts
// packages/llm/llm-router/src/task-analyzer.ts

export interface TaskProfile {
  // 输入特征
  inputTokens: number           // 预估输入 token 数
  messageCount: number          // 消息数量
  hasImages: boolean            // 是否包含图像
  hasFiles: boolean             // 是否包含文件
  complexity: 'simple' | 'moderate' | 'complex'  // 复杂度

  // 工具调用特征
  toolCallCount: number         // 预期工具调用次数
  requiresCodeExecution: boolean // 是否需要代码执行

  // 上下文特征
  conversationDepth: number     // 对话深度
  systemPromptSize: number      // 系统提示词大小
}

export interface TaskAnalysis {
  profile: TaskProfile
  recommendedRoute: 'local' | 'cloud'
  confidence: number            // 路由信心 (0-1)
  reasons: string[]             // 路由原因
}

export class TaskAnalyzer {
  analyze(options: GenerateOptions, context: RoutingContext): TaskAnalysis {
    const profile = this.buildProfile(options, context)
    return this.makeDecision(profile)
  }

  private buildProfile(options: GenerateOptions, context: RoutingContext): TaskProfile {
    const messages = options.messages ?? []
    const inputTokens = this.estimateTokens(messages)

    return {
      inputTokens,
      messageCount: messages.length,
      hasImages: messages.some(m =>
        m.content.some(c => c.type === 'image')
      ),
      hasFiles: messages.some(m =>
        m.content.some(c => c.type === 'file')
      ),
      complexity: this.assessComplexity(options),
      toolCallCount: this.estimateToolCalls(options),
      requiresCodeExecution: this.detectCodeExecution(options),
      conversationDepth: this.calculateDepth(context),
      systemPromptSize: this.measureSystemPrompt(options),
    }
  }

  private makeDecision(profile: TaskProfile): TaskAnalysis {
    const reasons: string[] = []
    let localScore = 0
    let cloudScore = 0

    // 规则 1: 大上下文窗口优先云端
    if (profile.inputTokens > 32000) {
      cloudScore += 3
      reasons.push('Large context window required')
    }

    // 规则 2: 简单任务优先本地
    if (profile.complexity === 'simple' && profile.inputTokens < 4000) {
      localScore += 2
      reasons.push('Simple task suitable for local model')
    }

    // 规则 3: 多模态任务优先云端
    if (profile.hasImages || profile.hasFiles) {
      cloudScore += 2
      reasons.push('Multimodal content requires cloud model')
    }

    // 规则 4: 代码执行任务优先云端
    if (profile.requiresCodeExecution) {
      cloudScore += 2
      reasons.push('Code execution task prefers cloud')
    }

    // 规则 5: 长对话优先云端
    if (profile.conversationDepth > 20) {
      cloudScore += 1
      reasons.push('Long conversation history')
    }

    // 规则 6: 隐私敏感任务优先本地
    // (可通过配置标记特定 session 为隐私敏感)

    const totalScore = localScore + cloudScore
    const confidence = totalScore > 0
      ? Math.max(localScore, cloudScore) / totalScore
      : 0.5

    const recommendedRoute = cloudScore > localScore ? 'cloud' : 'local'

    return {
      profile,
      recommendedRoute,
      confidence,
      reasons,
    }
  }
}
```

#### 4.2.2 路由策略引擎 (Route Policy Engine)

可配置的策略系统：

```ts
// packages/llm/llm-router/src/route-policy.ts

export interface RoutePolicy {
  // 基础策略
  mode: 'auto' | 'local-first' | 'cloud-first' | 'cost-optimized' | 'performance-optimized'

  // 阈值配置
  thresholds: {
    maxLocalTokens: number       // 本地模型最大 token
    maxLocalMessages: number     // 本地模型最大消息数
    complexityThreshold: number  // 复杂度阈值
  }

  // 模型映射
  modelMapping: {
    local: string[]              // 本地可用模型列表
    cloud: string[]              // 云端可用模型列表
    fallback: string             // 降级模型
  }

  // 成本配置
  cost: {
    localCostPerToken: number    // 本地每 token 成本（电费+硬件折旧）
    cloudCostPerToken: number    // 云端每 token 成本
    maxBudgetPerRequest: number  // 单请求最大预算
  }

  // 性能配置
  performance: {
    maxLocalLatency: number      // 本地最大延迟 (ms)
    maxCloudLatency: number      // 云端最大延迟 (ms)
    preferLocalWhenFaster: boolean // 本地更快时优先
  }

  // 健康检查
  health: {
    enabled: boolean
    checkInterval: number        // 检查间隔 (ms)
    unhealthyThreshold: number   // 不健康阈值
  }

  // 隐私配置
  privacy: {
    forceLocalForSensitive: boolean  // 敏感数据强制本地
    sensitiveKeywords: string[]      // 敏感关键词列表
  }
}

export const DEFAULT_POLICY: RoutePolicy = {
  mode: 'auto',
  thresholds: {
    maxLocalTokens: 8000,
    maxLocalMessages: 10,
    complexityThreshold: 0.6,
  },
  modelMapping: {
    local: ['local-deepseek', 'local-llama'],
    cloud: ['deepseek-v4-flash', 'deepseek-v4'],
    fallback: 'deepseek-v4-flash',
  },
  cost: {
    localCostPerToken: 0.000001,
    cloudCostPerToken: 0.00001,
    maxBudgetPerRequest: 0.1,
  },
  performance: {
    maxLocalLatency: 5000,
    maxCloudLatency: 30000,
    preferLocalWhenFaster: true,
  },
  health: {
    enabled: true,
    checkInterval: 30000,
    unhealthyThreshold: 3,
  },
  privacy: {
    forceLocalForSensitive: true,
    sensitiveKeywords: ['password', 'secret', 'api_key', 'token'],
  },
}
```

#### 4.2.3 动态路由器 (Dynamic Router)

实现 LlmAdapter 接口的路由器：

```ts
// packages/llm/llm-router/src/router.ts

import { LlmAdapter, GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Context } from '@cordis'

export interface RouterConfig {
  policy: RoutePolicy
  localAdapter: LlmAdapter
  cloudAdapter: LlmAdapter
}

export class DynamicRouter extends LlmAdapter {
  private analyzer: TaskAnalyzer
  private policyEngine: RoutePolicyEngine
  private healthMonitor: HealthMonitor
  private metrics: RoutingMetrics

  constructor(
    private ctx: Context,
    private config: RouterConfig
  ) {
    super()
    this.analyzer = new TaskAnalyzer()
    this.policyEngine = new RoutePolicyEngine(config.policy)
    this.healthMonitor = new HealthMonitor(config.policy.health)
    this.metrics = new RoutingMetrics()
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const analysis = this.analyzer.analyze(options, this.getContext())
    const decision = this.policyEngine.decide(analysis, this.healthMonitor.getStatus())

    // 记录路由决策
    this.metrics.record({
      taskId: options.sessionId,
      route: decision.route,
      confidence: analysis.confidence,
      estimatedTokens: analysis.profile.inputTokens,
      timestamp: Date.now(),
    })

    // 选择适配器
    const adapter = decision.route === 'local'
      ? this.config.localAdapter
      : this.config.cloudAdapter

    // 分发到选定的适配器
    try {
      yield* adapter.stream({
        ...options,
        provider: decision.provider,
        model: decision.model,
      })
    } catch (error) {
      // 降级处理
      if (this.shouldFallback(error, decision)) {
        yield* this.fallback(options, decision)
      } else {
        throw error
      }
    }
  }

  private shouldFallback(error: Error, decision: RoutingDecision): boolean {
    // 本地模型失败时降级到云端
    if (decision.route === 'local' && error.code === 'NO_ADAPTER') {
      return true
    }
    // 云端模型限流时降级到本地
    if (decision.route === 'cloud' && error.code === 'RATE_LIMIT') {
      return this.config.localAdapter !== null
    }
    return false
  }

  private async *fallback(
    options: GenerateOptions,
    originalDecision: RoutingDecision
  ): AsyncIterable<StreamChunk> {
    const fallbackAdapter = originalDecision.route === 'local'
      ? this.config.cloudAdapter
      : this.config.localAdapter

    this.metrics.recordFallback({
      originalRoute: originalDecision.route,
      fallbackRoute: originalDecision.route === 'local' ? 'cloud' : 'local',
      reason: 'adapter_failure',
    })

    yield* fallbackAdapter.stream(options)
  }
}
```

#### 4.2.4 健康监控器 (Health Monitor)

```ts
// packages/llm/llm-router/src/health-monitor.ts

export interface AdapterHealth {
  adapter: string
  status: 'healthy' | 'degraded' | 'unhealthy'
  latency: number              // 最近平均延迟 (ms)
  errorRate: number            // 错误率 (0-1)
  lastCheck: number            // 上次检查时间
  consecutiveFailures: number  // 连续失败次数
}

export class HealthMonitor {
  private health: Map<string, AdapterHealth> = new Map()
  private interval: NodeJS.Timeout | null = null

  constructor(private config: RoutePolicy['health']) {
    if (config.enabled) {
      this.startMonitoring()
    }
  }

  startMonitoring() {
    this.interval = setInterval(() => {
      this.checkAllAdapters()
    }, this.config.checkInterval)
  }

  async checkAdapter(adapter: LlmAdapter, name: string): Promise<AdapterHealth> {
    const start = Date.now()
    try {
      // 发送轻量级探测请求
      await adapter.stream({
        provider: name,
        model: 'health-check',
        messages: [{
          role: 'user',
          content: [{ type: 'text', text: 'ping' }]
        }],
        maxTokens: 1,
      })

      const latency = Date.now() - start
      const health: AdapterHealth = {
        adapter: name,
        status: 'healthy',
        latency,
        errorRate: 0,
        lastCheck: Date.now(),
        consecutiveFailures: 0,
      }
      this.health.set(name, health)
      return health
    } catch (error) {
      const existing = this.health.get(name)
      const failures = (existing?.consecutiveFailures ?? 0) + 1
      const health: AdapterHealth = {
        adapter: name,
        status: failures >= this.config.unhealthyThreshold ? 'unhealthy' : 'degraded',
        latency: existing?.latency ?? Number.MAX_SAFE_INTEGER,
        errorRate: failures / (existing?.consecutiveFailures ?? 0 + failures),
        lastCheck: Date.now(),
        consecutiveFailures: failures,
      }
      this.health.set(name, health)
      return health
    }
  }

  getStatus(): Map<string, AdapterHealth> {
    return new Map(this.health)
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval)
    }
  }
}
```

### 4.3 插件注册

```ts
// packages/llm/llm-router/src/index.ts

import { z } from 'zod'
import type { Context } from '@cordis'
import { DynamicRouter } from './router'
import { DEFAULT_POLICY, RoutePolicy } from './route-policy'

export const name = 'llm-router'
export const inject = ['llm']

export const Config = z.object({
  policy: z.custom<RoutePolicy>().default(DEFAULT_POLICY),
  localProvider: z.string().default('local'),
  cloudProvider: z.string().default('deepseek-official'),
})

export type Config = z.infer<typeof Config>

export function apply(ctx: Context, config: Config) {
  // 获取本地和云端适配器
  const localAdapter = ctx.llm.getAdapter(config.localProvider)
  const cloudAdapter = ctx.llm.getAdapter(config.cloudProvider)

  // 创建动态路由器
  const router = new DynamicRouter(ctx, {
    policy: config.policy,
    localAdapter,
    cloudAdapter,
  })

  // 注册为 'auto' 提供商
  ctx.llm.registerAdapter(['auto'], router)

  // 注册路由决策事件
  ctx.on('agent/pre-step', async (event, next) => {
    // 可以在这里注入路由相关的上下文
    await next()
  })
}
```

### 4.4 配置示例

```yaml
# cordis.yml
- name: '@deepseek-ai/dsh-llm'

# 本地模型适配器
- name: '@deepseek-ai/dsh-llm-local'
  config:
    baseUrl: 'http://localhost:11434'  # Ollama
    model: 'deepseek-coder:6.7b'

# 云端模型适配器
- name: '@deepseek-ai/dsh-llm-deepseek-api-key'
  config:
    apiKeyEnv: DEEPSEEK_API_KEY

# 动态路由器
- name: '@deepseek-ai/dsh-llm-router'
  config:
    policy:
      mode: 'auto'
      thresholds:
        maxLocalTokens: 8000
        maxLocalMessages: 10
      modelMapping:
        local: ['local-deepseek']
        cloud: ['deepseek-v4-flash']
        fallback: 'deepseek-v4-flash'
      cost:
        localCostPerToken: 0.000001
        cloudCostPerToken: 0.00001
      health:
        enabled: true
        checkInterval: 30000
    localProvider: 'local'
    cloudProvider: 'deepseek-official'
```

---

## 五、/loop Hook 实现

### 5.1 Hook 机制概述

DeepSeek Harness 的 Hook 系统基于事件监听器，可以在 Agent 循环的各个阶段插入自定义逻辑。

**关键 Hook 点：**
- `agent/pre-step` — 在每步开始前，可重写或拒绝消息
- `agent/request` — 在模型请求前，可拦截和修改
- `agent/turn-stopping` — 在 turn 结束前，可停止 turn
- `agent/created` — Agent 创建时
- `agent/status` — 状态变化时

### 5.2 路由决策 Hook

```ts
// packages/llm/llm-router/src/hooks.ts

import type { Context } from '@cordis'
import type { Agent, UserMessage } from '@deepseek-ai/dsh-agent'

export function registerRoutingHooks(ctx: Context, router: DynamicRouter) {
  // Hook 1: 在每步开始前分析任务并做路由决策
  ctx.on('agent/pre-step', async (event, next) => {
    const agent = event.agent
    const messages = event.messages

    // 分析消息内容
    const analysis = router.analyzeMessages(messages)

    // 根据分析结果设置路由偏好
    if (analysis.shouldUseLocal) {
      // 注入上下文提示，告诉后续处理使用本地模型
      agent.inject({
        role: 'system',
        content: [{
          type: 'text',
          text: '[Route: local-model preferred for this step]'
        }]
      })
    }

    await next()
  })

  // Hook 2: 在请求前记录路由指标
  ctx.on('agent/request', async (event, next) => {
    const requestId = event.requestId
    const provider = event.provider

    router.metrics.recordRequest({
      requestId,
      provider,
      timestamp: Date.now(),
    })

    await next()
  })

  // Hook 3: 在 turn 结束时汇总路由统计
  ctx.on('agent/turn-stopping', async (event) => {
    const agent = event.agent
    const turnStats = router.metrics.getTurnStats(agent.id)

    // 记录 turn 级别的路由统计
    router.metrics.recordTurn({
      agentId: agent.id,
      localRequests: turnStats.localRequests,
      cloudRequests: turnStats.cloudRequests,
      totalTokens: turnStats.totalTokens,
      estimatedCost: turnStats.estimatedCost,
    })
  })
}
```

### 5.3 动态策略调整 Hook

```ts
// 根据运行时指标动态调整路由策略
export function registerAdaptiveHooks(ctx: Context, router: DynamicRouter) {
  // 监控本地模型性能
  let localLatencySum = 0
  let localRequestCount = 0

  ctx.on('llm/stream', async (event, next) => {
    if (event.provider === 'local') {
      const start = Date.now()

      // 包装流以测量延迟
      const originalStream = event.stream
      event.stream = (async function* () {
        for await (const chunk of originalStream) {
          yield chunk
        }
        localLatencySum += Date.now() - start
        localRequestCount++

        // 如果本地模型平均延迟过高，调整策略
        if (localRequestCount >= 10) {
          const avgLatency = localLatencySum / localRequestCount
          if (avgLatency > router.config.performance.maxLocalLatency) {
            router.policyEngine.adjustPreference('cloud')
          }
          // 重置计数器
          localLatencySum = 0
          localRequestCount = 0
        }
      })()
    }

    await next()
  })
}
```

### 5.4 Session 级别的路由配置

```ts
// 允许特定 Session 使用不同的路由策略
export function registerSessionHooks(ctx: Context, router: DynamicRouter) {
  ctx.on('session/created', async (event) => {
    const sessionId = event.session.id
    const meta = event.session.meta

    // 检查 Session 元数据中的路由配置
    if (meta?.routePreference) {
      router.setSessionPolicy(sessionId, {
        forceRoute: meta.routePreference,  // 'local' | 'cloud'
        reason: meta.routeReason ?? 'session-config',
      })
    }

    // 检查隐私标记
    if (meta?.sensitive) {
      router.setSessionPolicy(sessionId, {
        forceRoute: 'local',
        reason: 'privacy-sensitive',
      })
    }
  })
}
```

---

## 六、任务大小判断策略详解

### 6.1 多维度评估模型

```ts
// 任务大小评估的完整维度
export interface TaskSizing {
  // 1. Token 维度
  tokenDimension: {
    inputTokens: number        // 输入 token 数
    outputTokensEstimate: number // 预估输出 token 数
    contextWindowSize: number  // 需要的上下文窗口
  }

  // 2. 复杂度维度
  complexityDimension: {
    reasoningDepth: number     // 推理深度 (1-5)
    toolCallChain: number      // 工具调用链长度
    domainSpecificity: number  // 领域特异性 (0-1)
  }

  // 3. 多模态维度
  multimodalDimension: {
    imageCount: number         // 图像数量
    imageSize: number          // 图像总大小 (bytes)
    hasAudio: boolean          // 是否有音频
    hasVideo: boolean          // 是否有视频
  }

  // 4. 上下文维度
  contextDimension: {
    conversationTurns: number  // 对话轮数
    toolHistorySize: number    // 工具历史大小
    fileAttachments: number    // 文件附件数量
  }
}

// 综合评分公式
export function calculateTaskScore(sizing: TaskSizing): number {
  // 归一化各维度
  const tokenScore = Math.min(sizing.tokenDimension.inputTokens / 32000, 1)
  const complexityScore = sizing.complexityDimension.reasoningDepth / 5
  const multimodalScore = sizing.multimodalDimension.imageCount > 0 ? 1 : 0
  const contextScore = Math.min(sizing.contextDimension.conversationTurns / 20, 1)

  // 加权综合
  const weights = {
    token: 0.3,
    complexity: 0.3,
    multimodal: 0.2,
    context: 0.2,
  }

  return (
    tokenScore * weights.token +
    complexityScore * weights.complexity +
    multimodalScore * weights.multimodal +
    contextScore * weights.context
  )
}
```

### 6.2 路由决策矩阵

| 场景 | 任务特征 | 路由决策 | 原因 |
|---|---|---|---|
| 简单问答 | < 1K tokens, 无工具调用 | **本地** | 低延迟，节省成本 |
| 代码补全 | < 4K tokens, 单文件上下文 | **本地** | 快速响应，代码模型够用 |
| 复杂推理 | > 16K tokens, 多步推理 | **云端** | 需要强大推理能力 |
| 长对话 | > 20 轮对话 | **云端** | 需要大上下文窗口 |
| 图像分析 | 包含图像输入 | **云端** | 需要多模态能力 |
| 隐私敏感 | 标记为 sensitive | **本地** | 数据不出本地 |
| 高并发 | 系统负载高 | **云端** | 分散计算压力 |
| 离线模式 | 无网络连接 | **本地** | 唯一选择 |

### 6.3 动态阈值调整

```ts
// 基于历史数据动态调整路由阈值
export class AdaptiveThresholds {
  private history: RoutingResult[] = []
  private thresholds: RouteThresholds

  update(result: RoutingResult) {
    this.history.push(result)

    // 每 100 次请求重新计算阈值
    if (this.history.length % 100 === 0) {
      this.recalculateThresholds()
    }
  }

  private recalculateThresholds() {
    const recentHistory = this.history.slice(-100)

    // 分析本地模型的成功率和延迟
    const localResults = recentHistory.filter(r => r.route === 'local')
    const localSuccessRate = localResults.filter(r => r.success).length / localResults.length
    const localAvgLatency = localResults.reduce((sum, r) => sum + r.latency, 0) / localResults.length

    // 如果本地模型表现良好，提高本地处理的阈值
    if (localSuccessRate > 0.9 && localAvgLatency < 3000) {
      this.thresholds.maxLocalTokens *= 1.1
      this.thresholds.maxLocalMessages *= 1.1
    }

    // 如果本地模型表现不佳，降低阈值
    if (localSuccessRate < 0.8 || localAvgLatency > 8000) {
      this.thresholds.maxLocalTokens *= 0.9
      this.thresholds.maxLocalMessages *= 0.9
    }
  }
}
```

---

## 七、本地与远端调用策略确定机制

### 7.1 策略层次

```
┌─────────────────────────────────────────┐
│           Strategy Layer 4: User Override           │
│   (用户显式指定 provider/model)                      │
├─────────────────────────────────────────┤
│           Strategy Layer 3: Session Policy          │
│   (Session 级别的隐私/性能配置)                      │
├─────────────────────────────────────────┤
│           Strategy Layer 2: Adaptive Policy         │
│   (基于运行时指标的动态调整)                         │
├─────────────────────────────────────────┤
│           Strategy Layer 1: Static Policy           │
│   (配置文件中定义的静态规则)                          │
└─────────────────────────────────────────┘
```

### 7.2 策略决策流程

```ts
export class StratifiedPolicyEngine {
  decide(
    analysis: TaskAnalysis,
    context: RoutingContext
  ): RoutingDecision {
    // Layer 4: 用户显式覆盖
    if (context.userOverride) {
      return {
        route: context.userOverride.route,
        provider: context.userOverride.provider,
        model: context.userOverride.model,
        reason: 'user-override',
      }
    }

    // Layer 3: Session 策略
    const sessionPolicy = this.getSessionPolicy(context.sessionId)
    if (sessionPolicy?.forceRoute) {
      return {
        route: sessionPolicy.forceRoute,
        provider: this.getProviderForRoute(sessionPolicy.forceRoute),
        model: this.getModelForRoute(sessionPolicy.forceRoute),
        reason: sessionPolicy.reason,
      }
    }

    // Layer 2: 自适应策略
    const adaptiveDecision = this.adaptiveEngine.decide(analysis, context)
    if (adaptiveDecision.confidence > 0.8) {
      return adaptiveDecision
    }

    // Layer 1: 静态策略
    return this.staticEngine.decide(analysis, context)
  }
}
```

### 7.3 成本估算模型

```ts
export class CostEstimator {
  // 本地模型成本（电费 + 硬件折旧）
  estimateLocalCost(tokens: number, estimatedTime: number): number {
    const powerConsumptionWatts = 300  // GPU 功耗
    const electricityCostPerKwh = 0.12  // 每度电成本
    const hardwareDepreciationPerHour = 0.5  // 硬件折旧/小时

    const energyCost = (powerConsumptionWatts / 1000) *
      (estimatedTime / 3600) * electricityCostPerKwh
    const hardwareCost = (estimatedTime / 3600) * hardwareDepreciationPerHour

    return energyCost + hardwareCost
  }

  // 云端模型成本
  estimateCloudCost(inputTokens: number, outputTokens: number): number {
    const inputCost = inputTokens * 0.00000014  // $0.14/M tokens
    const outputCost = outputTokens * 0.00000028  // $0.28/M tokens
    return inputCost + outputCost
  }

  // 比较并决策
  compareAndDecide(
    inputTokens: number,
    estimatedOutputTokens: number,
    estimatedLocalTime: number
  ): 'local' | 'cloud' {
    const localCost = this.estimateLocalCost(inputTokens, estimatedLocalTime)
    const cloudCost = this.estimateCloudCost(inputTokens, estimatedOutputTokens)

    return localCost < cloudCost ? 'local' : 'cloud'
  }
}
```

---

## 八、完整配置示例

### 8.1 开发环境配置

```yaml
# .dsh/cordis.yml (开发环境)
profiles:
  - name: dev
    bundles:
      - '@deepseek-ai/dsh-base'

plugins:
  # 本地 Ollama 适配器
  - name: '@deepseek-ai/dsh-llm-ollama'
    config:
      baseUrl: 'http://localhost:11434'
      models:
        - 'deepseek-coder:6.7b'
        - 'llama3:8b'

  # DeepSeek 云端适配器
  - name: '@deepseek-ai/dsh-llm-deepseek-api-key'
    config:
      apiKeyEnv: DEEPSEEK_API_KEY

  # 动态路由器
  - name: '@deepseek-ai/dsh-llm-router'
    config:
      policy:
        mode: 'local-first'  # 开发环境优先本地
        thresholds:
          maxLocalTokens: 16000  # 本地开发可以处理更大上下文
          maxLocalMessages: 20
        modelMapping:
          local: ['ollama/deepseek-coder']
          cloud: ['deepseek-v4-flash']
          fallback: 'deepseek-v4-flash'
        cost:
          localCostPerToken: 0.000001
          cloudCostPerToken: 0.00001
          maxBudgetPerRequest: 0.05  # 开发环境控制成本
        health:
          enabled: true
          checkInterval: 60000  # 每分钟检查一次
      localProvider: 'ollama'
      cloudProvider: 'deepseek-official'
```

### 8.2 生产环境配置

```yaml
# .dsh/cordis.yml (生产环境)
profiles:
  - name: production
    bundles:
      - '@deepseek-ai/dsh-base'

plugins:
  # 本地 vLLM 集群
  - name: '@deepseek-ai/dsh-llm-vllm'
    config:
      baseUrl: 'http://vllm-cluster.internal:8000'
      models:
        - 'deepseek-coder-33b'
        - 'deepseek-v2-lite'

  # DeepSeek 云端 API
  - name: '@deepseek-ai/dsh-llm-deepseek-api-key'
    config:
      apiKeyEnv: DEEPSEEK_API_KEY
      baseUrl: 'https://api.deepseek.com'

  # 动态路由器（生产配置）
  - name: '@deepseek-ai/dsh-llm-router'
    config:
      policy:
        mode: 'cost-optimized'  # 生产环境优化成本
        thresholds:
          maxLocalTokens: 32000  # 本地集群可以处理更大上下文
          maxLocalMessages: 50
          complexityThreshold: 0.7
        modelMapping:
          local: ['vllm/deepseek-coder-33b']
          cloud: ['deepseek-v4']  # 生产使用更强模型
          fallback: 'deepseek-v4-flash'
        cost:
          localCostPerToken: 0.000002  # 集群成本更高
          cloudCostPerToken: 0.00001
          maxBudgetPerRequest: 1.0
        performance:
          maxLocalLatency: 3000
          maxCloudLatency: 15000
          preferLocalWhenFaster: true
        health:
          enabled: true
          checkInterval: 30000
        privacy:
          forceLocalForSensitive: true
          sensitiveKeywords: ['password', 'secret', 'api_key', 'ssn', 'credit_card']
      localProvider: 'vllm'
      cloudProvider: 'deepseek-official'
```

---

## 九、监控与可观测性

### 9.1 路由指标

```ts
export interface RoutingMetrics {
  // 请求级指标
  requests: {
    total: number
    local: number
    cloud: number
    fallback: number
  }

  // Token 指标
  tokens: {
    localInput: number
    localOutput: number
    cloudInput: number
    cloudOutput: number
  }

  // 成本指标
  cost: {
    local: number
    cloud: number
    total: number
  }

  // 性能指标
  latency: {
    localP50: number
    localP95: number
    localP99: number
    cloudP50: number
    cloudP95: number
    cloudP99: number
  }

  // 质量指标
  quality: {
    localSuccessRate: number
    cloudSuccessRate: number
    fallbackRate: number
    avgConfidence: number
  }
}
```

### 9.2 日志示例

```json
{
  "timestamp": "2026-10-13T10:30:00Z",
  "event": "routing-decision",
  "sessionId": "session-abc123",
  "taskId": "task-xyz789",
  "analysis": {
    "inputTokens": 2500,
    "messageCount": 5,
    "complexity": "moderate",
    "hasImages": false
  },
  "decision": {
    "route": "local",
    "provider": "ollama",
    "model": "deepseek-coder:6.7b",
    "confidence": 0.85,
    "reasons": ["simple-task", "low-token-count", "cost-optimized"]
  },
  "outcome": {
    "success": true,
    "latency": 1200,
    "tokensUsed": { "input": 2500, "output": 800 },
    "estimatedCost": 0.000003
  }
}
```

---

## 十、总结

### 10.1 架构优势

1. **插件化设计** — 基于 Cordis 的 everything-is-a-plugin 架构，路由逻辑完全可替换
2. **提供商中立** — LLM 服务层抽象了所有提供商差异，路由器只需实现统一接口
3. **事件驱动** — 通过 `agent/*` 事件系统，可以在不修改核心代码的情况下注入路由逻辑
4. **可观测性** — 内置的指标收集和日志系统，支持路由决策的审计和优化

### 10.2 关键实现要点

1. **任务分析器** — 多维度评估任务特征（token 数、复杂度、多模态、上下文深度）
2. **策略引擎** — 分层策略系统（用户覆盖 > Session 策略 > 自适应策略 > 静态策略）
3. **健康监控** — 实时监控本地和云端模型的健康状态，自动故障转移
4. **成本优化** — 基于实际成本（电费+折旧 vs API 费用）做经济决策
5. **降级机制** — 本地失败自动降级云端，云端限流自动降级本地

### 10.3 扩展方向

1. **ML 路由模型** — 使用历史数据训练路由决策模型
2. **多本地模型** — 支持多个本地模型（代码模型、通用模型、小模型）的智能选择
3. **混合执行** — 大任务拆分，部分本地处理，部分云端处理
4. **联邦学习** — 本地模型定期从云端同步更新

---

## 参考资源

- [DeepSeek Harness GitHub](https://github.com/deepseek-ai/deepseek-harness)
- [架构文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)
- [LLM 流子系统](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/llm-streaming.md)
- [添加 LLM 适配器指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-an-llm-adapter.md)
- [Agent Loop 文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent-loop/README.md)
- [Cordis 框架](https://github.com/cordiverse/cordis)
- [论文：时空可组合性编程范式](https://arxiv.org/abs/2608.25512)
