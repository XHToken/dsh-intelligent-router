---
name: dsh-plugin-dev
description: dsh-llm-router（dsh-intelligent-router）插件开发技能。覆盖 DSH 插件架构、schemastery 配置、路由策略与 Stays 缓存亲和、错误分类与故障转移、Settings UI 集成、构建部署和调试验证。
metadata:
  version: "1.1.0"
  date: "2026-10-17"
  reference: "https://github.com/XHToken/dsh-intelligent-router"
---

# DSH LLM Router 插件开发

## 项目概览

dsh-llm-router（仓库名 dsh-intelligent-router）是一个 DeepSeek Harness (DSH) 插件，注册为 **`auto`** provider，提供：
- **4 种路由策略（已实现）**：`order`（按优先级）/ `smart`（按任务大小选本地或云端，阈值 4096 tokens）/ `rotate`（轮转）/ `usage`（最少使用优先）
  - ⚠️ `pace` / `weighted` / `intent` 在 schema 中声明但**未实现**，静默降级为 `order`
- **规则引擎**：`minTokens` / `hasImage` / `anyAgent` / `intent` 条件，首条命中置顶 target（`anyReasoning` 是占位，恒通过）；意图分类由 router 内联实现（`group.classifierModel` + 编号式 prompt）
- **Stays 缓存亲和**：`off` / `turn`（~2min 窗）/ `auto`（~5min，Anthropic cache TTL）/ `session`（默认，会话内不限时）；在策略排序之上把上一成功成员移到链首，键为 `sessionId`（无则回退 group.id）；rules 优先于亲和；亲和成员失败时记录被清除
- **自动故障转移**：TRANSIENT / PERMANENT / UNKNOWN 三级分类（含 SDK 连接错误文案匹配，如 "Connection error."）
- **AUTO 模型**：推理等级 **Low / High**（默认 low），经 `resolveModel` 的 `reasoning.efforts` 声明
- 配额跟踪、监控、成本优化（host 端，部分生效，见路线图）

主路径完全委托 DSH：`ctx.llm.prepareCall(provider, model).stream(options)`。`src/llm-client.ts` 是 legacy 直连客户端（仅 prepareCall 不可用时回退）；成员级 `apiKey/baseUrl/protocol/thinking` **仅 legacy 路径生效**。`middleware.ts`（未接线）、`intent-classifier.ts`（死代码）、`route-group-manager.ts`（未接入 host）为历史模块。

## 架构

```
src/
├── index.ts              # Host 插件入口：registerAdapter(["auto"]) + settings.configure
├── router.ts             # MagpieRouter：rules → 策略排序 → Stays 亲和 → 逐候选 delegateTo
├── strategies.ts         # 纯排序函数（orderCandidates/rotateOrder/usageOrder/smartOrder/affinityOrder）——必须保持纯、可直接单测
├── settings-schema.ts    # schemastery schema（routeGroups.volatile，stays.default("session")）
├── config-store.ts       # settings 命名空间 "llm-router" 读取（readConfigFromSettings）
├── llm-client.ts         # 直连 LLM 客户端（legacy 回退路径）
├── client/index.tsx      # 当前生效的 Settings UI（浏览器 bundle）
├── settings-ui.tsx       # Settings 组件库
├── quota-tracker.ts / monitoring.ts / cost-optimizer.ts  # host 端统计（部分生效）
└── types.ts / dsh-types.d.ts
```

状态全部在内存（`lastUsedIndex` / `usageCounts` / `lastAffinity` 等 Map），进程重启即丢。

## 关键规则

### 1. 配置 Schema 必须使用 schemastery（不是 zod）

```typescript
import z from "@deepseek-ai/schemastery";
```
- 无 `.optional()` — 字段默认可选
- 用 `.description()` 代替 `.describe()`
- 用 `z.union([z.const("a"), z.const("b")])` 代替 `z.enum([...])`
- 用 `z.dict(schema)` 代替 `z.record(schema)`
- 用 `.volatile()` 标记 DSH 可编辑字段（Settings UI 保存只写 volatile 字段）
- 无 `.min()/.max()` 对 string — 用 `.pattern()` 代替
- 枚举默认值：`.default("session")` 等（三层兜底之一：schema → 存储透传 → 消费层 `getStaysMode()` 白名单）

### 2. Config 值读取需要 .get()

```typescript
function resolveConfig<T>(value: any): T {
  if (typeof value?.get === "function") return value.get();
  return value;
}
```

### 3. Client Bundle 必须是单文件 + ModuleLoader 格式

```typescript
// tsup.config.ts
export default defineConfig({
  splitting: false,  // 关键！不能分块
  external: ['@deepseek-ai/dsh', '@deepseek-ai/schemastery', '@cordis/core', 'react', 'react-dom'],
});
```
构建后 `scripts/wrap-client-bundle.js` 把 ESM 转成 `window.__ModuleLoader__.load({ id: "dsh-llm-router", factory })`（正则改写 import/export，副作用 CSS import 是已知隐患）。

### 4. package.json exports 必须用 "default"

```json
{ "exports": { "./client": { "types": "./src/client/index.ts", "default": "./dist/client/index.js" } } }
```

### 5. Settings 集成与持久化

```typescript
// index.ts (host) —— 与第一方插件逐字一致的模式
ctx.inject(["settings"], (child) => {
  child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
});
```
UI 保存走 `remote.settings.update("llm-router", config, revision)`（乐观并发），最终由 ConfigEditor 覆盖写 profile `cordis.patch.yml` 的 `id: llm-router` 条目。⚠️ 必须用 **profile 本地 bin** 启动 DSH，否则报 `profile reload requires the root Include entry`（npx 会加载重复模块树，WeakMap 隔离导致）。

### 6. 错误分类（shouldFallback）——安全关键

```typescript
// 分类顺序：自定义 recoverableErrors → cause.code（ECONN*）→ HTTP status
// → error.code → message 中的 HTTP 状态 → 网络文案模式 → UNKNOWN（不 fallback）
// 网络文案层捕捉 SDK 连接失败（只有 message 没有 code 的情况）：
// "connection error" / "fetch failed" / "socket hang up" / ENOTFOUND ...
// 匹配范围覆盖 error.code/message/cause/routeFailure 全部文本字段
```
- `delegateTo` 抛错时必须透传 failure 的 `code`/`status`（否则分类丢信号）
- **歧义一律 UNKNOWN（不 fallback）**；auth/4xx 验证类绝不 fallback
- 修改此处必须补测试

### 7. 日志

热路径用 `this.log(level, message)`（尊重 `advanced.logLevel`），不要裸 `console.log`。per-request 决策（Rule matched / stays hit）用 `debug` 级。

### 8. maxRetries 语义

`maxRetries: 3` = **总共尝试 3 次**（含首次），不是 1+3。

## 构建与部署

```bash
pnpm install && pnpm run build     # tsup + wrap-client-bundle
pnpm run typecheck                 # 必须 0 错误
pnpm run lint                      # 0 错误（警告容忍）
pnpm test:run                      # 175 测试

# 部署到 DSH profile
cp -r dist/* ~/.dsh/profiles/web/node_modules/dsh-llm-router/dist/

# 重启 DSH —— 必须用本地 bin，不要用 npx！
lsof -ti:3082 | xargs kill -9
cd ~/.dsh/profiles/web && ./node_modules/.bin/dsh web --port 3082
```

## 调试验证

```bash
# 日志（logLevel=debug 可见 stays hit / Rule matched）
tail -100 /tmp/dsh.log | grep "dsh-llm-router"

# token
grep "token=" /tmp/dsh.log

# UI 验证：Settings → Built-in plugins → LLM Router（Stays pills / Save → "✓ Saved"）
```

## 常见错误与修复

| 错误 | 原因 | 修复 |
|---|---|---|
| `profile reload requires the root Include entry` | npx 启动导致重复 dsh-app-boot 模块树 | 用 profile 本地 bin 启动 DSH |
| `This turn failed: Connection error` 无 failover | SDK 连接错误只有 message 无 code | shouldFallback 网络文案层 + delegateTo 透传 code/status（已修复，勿回退） |
| `require missed the module table` | 分块构建 | splitting: false |
| `Cannot use import statement` | 非 ModuleLoader 格式 | 运行 wrap-client-bundle.js |
| `received undefined for apply` | factory 未返回 | 添加 return module.exports |
| `pending (waiting for service)` | inject 声明了不存在的服务 | 移除或改为可选 |
| `z.enum is not a function` | 使用 zod API | 迁移到 schemastery |
| `routeGroups.map is not a function` | Config 引用未 .get() | 使用 resolveConfig |
| slot 名称报错 | slot 未声明 | 使用正确的 slot 名称 |

## 兼容性与自检（compatibility.json / doctor）

**宿主兼容性的真正执行方不是 compatibility.json**：DSH 在 `dsh plugin add` 前与启动时用插件 `peerDependencies`（`@deepseek-ai/dsh`）比对运行时版本，不兼容直接拒绝/跳过。包内 `compatibility.json`（schema 同 `@nanmicoder/dsh-agent-teams`）当前是**声明 + 自检契约**：DSH 0.2.0-rc.2 宿主不消费它，由本插件 `scripts/compatibility.mjs` + `scripts/doctor.mjs` 消费，供未来宿主/安装器读取。

```jsonc
// compatibility.json —— validatePolicy 契约：
// schemaVersion=1 · previewTag="next" · 恰好一条 track=recommended 且等于 recommendedHost
// · alpha/beta 不得为 recommended · track ∈ recommended|preview|legacy · 版本为精确 semver（rc 可）
{ "schemaVersion": 1, "recommendedHost": "0.2.0-rc.2", "previewTag": "next",
  "supportedHosts": [{ "version": "0.2.0-rc.2", "track": "recommended" }] }
```

- **新增已验证宿主版本**：往 `supportedHosts` 加 `{ version, track }`；只有**实际跑过**的版本才能入表（不预填未验证的 legacy）。单测在 `tests/compatibility.test.ts`（19 用例覆盖契约边界）
- **doctor 用法**：`pnpm doctor`（对 cwd）或安装后 `dsh-llm-router-doctor --host-root <dir> --profile-root <dir> [--json]`。只查 manifest，不执行任何包、不读凭据
- **doctor 检查项**：宿主版本在 allowlist / 已装插件版本与 policy 包一致 / DSH 包版本混用 / 插件子树缺失依赖与 `serverRuntimePeers`（`scripts/compatibility.mjs` 维护，与 package.json peers 独立，防误删）/ 同名包版本冲突
- **作用域注意**：missing 检测只在**插件子树 + profile 直接依赖**内进行，不对宿主整树做 missing/重复身份扫描——pnpm 双层 node_modules（共享层 + profile 层 hoisting）会产生同版本多路径的误报；重复身份按**版本是否分叉**判定（同版本多路径 = 正常 hoisting）
- **profile 层另有同名文件**：`~/.dsh/profiles/<p>/compatibility.json` 是宿主侧**豁免表**（`pkg@ver → [dsh 版本]`，`dsh plugin allow-version ... --accept-risk` 写入），与包内这个不是一回事

## 测试约定

- 纯逻辑放 `src/strategies.ts` 直接 import 测试（**禁止**测试内复制逻辑的镜像测试，已清理过此类漂移）
- router 行为用 `createMockContext()`（mock settings/llm.prepareCall/emit）；旧时间戳经 `(router as any).lastAffinity` 注入
- `tests/integration.test.ts` 依赖 dist 产物——CI 中 build 必须先于 test

## 参考

- 开源仓库: https://github.com/XHToken/dsh-intelligent-router
- DSH 官方仓库: https://github.com/deepseek-ai/deepseek-harness
- Magpie 设计参考: https://github.com/yetone/magpie
