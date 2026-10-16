# 路由策略设计说明

## 架构

```
┌─────────────────────────────────────────────────┐
│  LLM Router 插件（本插件）                        │
│                                                   │
│  职责：路由决策                                    │
│  - 评估 Rules（条件匹配）                         │
│  - 按策略排序候选模型                              │
│  - 故障转移（错误分类）                           │
│                                                   │
│  不做：直接调用大模型 API                          │
└──────────────────────┬──────────────────────────┘
                       │ ctx.llm.prepareCall(provider, model)
                       ▼
┌─────────────────────────────────────────────────┐
│  DSH LLM 系统（底层）                             │
│                                                   │
│  职责：模型调用                                    │
│  - 认证（API Key / OAuth）                       │
│  - 协议适配（OpenAI/Anthropic/Ollama）           │
│  - Tool calls 处理                               │
│  - 流式响应                                      │
│  - 重试 / 限流                                   │
└─────────────────────────────────────────────────┘
```

**关键原则**：Router 只做路由决策，所有大模型调用完全委托给 DSH 的 `ctx.llm.prepareCall()`。

---

## 执行流程

```
请求进入 stream(options)
    │
    ├─ 1. 刷新配置 refreshFromConfig()
    │     └─ 从 schemastery live 引用读取最新配置
    │        （Settings UI Save → 实时生效）
    │
    ├─ 2. 确定路由组
    │     ├─ provider="group/xxx" → 指定组
    │     ├─ model 匹配 → 所在组
    │     └─ 默认 → default 组
    │
    ├─ 3. 边界检查
    │     └─ 无模型配置 → 透传 DSH 默认模型
    │
    ├─ 4. 评估 Rules（所有策略通用）
    │     ├─ 计算 tokens（字符数 / 4）
    │     ├─ 检查 hasImage
    │     ├─ 检查 anyAgent
    │     ├─ 意图分类（classifierModel）
    │     └─ 从上往下匹配 → 第一条命中 → target 排第一
    │
    ├─ 5. 按策略排序候选
    │     ├─ smart    → 任务大小决定本地/云端优先
    │     ├─ order    → 按 priority 排序
    │     ├─ rotate   → 轮转
    │     └─ usage    → 最少使用优先
    │
    ├─ 6. 逐个尝试
    │     ├─ 配额检查（超限跳过，不消耗重试）
    │     ├─ ctx.llm.prepareCall(provider, model)
    │     ├─ 成功 → 返回
    │     └─ 失败 → 错误分类
    │           ├─ TRANSIENT → 下一个候选
    │           └─ PERMANENT/UNKNOWN → 抛出错误
    │
    └─ 7. 全部失败 → 抛出最后错误
```

---

## 4 种策略

### 1. Smart（智能路由）

**目标**：根据任务大小自动选择本地/云端模型

```typescript
estimatedTokens = 消息总字符数 / 4

if tokens < 4096（小任务）:
  本地模型优先（ollama）→ 云端模型
else（大任务）:
  云端模型优先 → 本地模型

同层级内：按 priority 排序
```

**适用场景**：
- 小任务（简单问答）→ ollama/SparkLLM（免费、低延迟）
- 大任务（复杂推理）→ deepseek-v4.1-flash / qwen3.7-plus（强能力）

**示例**：
```
"你好"（≈2 tokens）→ ollama/SparkLLM
"写一个完整的 React 应用"（≈8000 tokens）→ deepseek-v4.1-flash
```

### 2. In order（按顺序）

**目标**：按优先级顺序尝试，失败自动切换

```typescript
candidates.sort(by priority ascending)
尝试 priority 1 → 失败 → priority 2 → 失败 → priority 3
```

**适用场景**：主备模式，主模型挂了自动切备用模型

**示例**：
```
priority 1: ollama/SparkLLM     （首选，免费）
priority 2: deepseek-v4.1-flash （备用）
priority 3: qwen3.7-plus        （兜底）
```

### 3. In turn（轮流）

**目标**：每次请求轮换到下一个模型

```typescript
nextIndex = (lastIndex + 1) % members.length
请求 1 → 模型 A
请求 2 → 模型 B
请求 3 → 模型 C
请求 4 → 模型 A（循环）
```

**适用场景**：负载均衡、A/B 测试

### 4. Least used（最少使用）

**目标**：优先使用请求次数最少的模型

```typescript
candidates.sort(by usageCount ascending)
每次成功调用后 usageCount++
```

**适用场景**：多账号配额均衡、成本控制

---

## Rules 评估引擎

Rules 在策略排序**之前**执行，命中则覆盖排序。

### 条件

| 条件 | 说明 | 判断方式 |
|---|---|---|
| `minTokens` | 消息 ≥ N tokens | 字符数 / 4 |
| `hasImage` | 消息包含图片 | content 中 type=image |
| `anyReasoning` | 需要推理 | 预留（当前总为 true） |
| `anyAgent` | Agent/工具调用 | options.agent 或 toolUse |
| `intent` | 意图匹配 | classifierModel 分类 |

### 匹配规则

```
从上往下检查每条规则
所有条件都满足 → 命中
第一条命中的规则 → target 模型排到候选第一位
其余模型作为 fallback 排在后面
无规则命中 → 按策略排序
```

### 意图分类

```typescript
// 使用 classifierModel 调用 DSH LLM
preparedCall = ctx.llm.prepareCall(classifier.provider, classifier.model)

// Prompt 格式
"Given numbered kinds: 1. 复杂问题 2. 简单问题
 The user's message: <message>...</message>
 Answer with the number only."

// 响应解析：提取第一个数字 → 映射到意图
```

---

## 错误分类（故障转移）

| 分类 | 行为 | 条件 |
|---|---|---|
| **TRANSIENT** | ✅ fallback 下一个 | ECONNREFUSED, ECONNRESET, ETIMEDOUT, EAI_AGAIN, HTTP 429/500/502/503/504/529, rate_limit, overloaded |
| **PERMANENT** | ❌ 不 fallback | HTTP 400/401/403/404/422, auth, invalid_api_key, model_not_found |
| **UNKNOWN** | ❌ 不 fallback | 其他所有（安全默认） |

**无误伤保证**：
- "network configuration error" → UNKNOWN → 不 fallback
- "quota tracking enabled" → UNKNOWN → 不 fallback
- "401 Unauthorized" → PERMANENT → 不 fallback

---

## 配置示例

```yaml
# cordis.patch.yml
config:
  defaultGroup: 'default'
  routeGroups:
    - id: 'default'
      strategy: 'smart'
      members:
        - provider: 'ollama'
          model: 'SparkLLM/Spark-X2.5-1.7B'
          protocol: 'openai-completions'
        - provider: 'deepseekv41flash'
          model: 'deepseek-v4.1-flash'
          protocol: 'openai-responses'
        - provider: 'qwen37plus'
          model: 'qwen3.7-plus'
          protocol: 'anthropic-messages'
      rules:
        - minTokens: 10000
          intent: '复杂问题'
          target: { provider: 'deepseekv41flash', model: 'deepseek-v4.1-flash' }
        - intent: '简单问题'
          target: { provider: 'ollama', model: 'SparkLLM/Spark-X2.5-1.7B' }
      classifierModel: { provider: 'ollama', model: 'SparkLLM/Spark-X2.5-1.7B' }
  fallback:
    enabled: true
    maxRetries: 3
    retryDelay: 1000
```
