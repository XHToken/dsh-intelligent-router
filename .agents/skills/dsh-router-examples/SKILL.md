---
name: dsh-router-examples
description: dsh-llm-router（dsh-intelligent-router）插件使用案例集。覆盖安装验证、路由组配置、AUTO 模型对话、策略与 Stays 缓存亲和、自动故障转移的完整可复现案例，每个案例含真实效果截屏、DSH 版本与依赖要求、执行步骤和最终效果验证。需要给用户演示插件效果、复现某个功能场景、或为新用户提供上手教程时使用。
metadata:
  version: "1.0.0"
  date: "2026-10-18"
  reference: "https://github.com/XHToken/dsh-intelligent-router"
---

# DSH LLM Router 使用案例

每个案例都是一条**可独立复现**的完整链路：前置依赖 → 执行步骤 → 效果截屏 → 最终效果验证点。

## 案例索引

| # | 案例 | 演示内容 | 关键证据 |
|---|---|---|---|
| 01 | [安装与验证](examples/01-install-verify/) | `dsh plugin add` 安装、Settings UI 加载、首次重启要求 | 内置插件页 / 设置页截屏 |
| 02 | [配置路由组](examples/02-configure-route-group/) | 添加成员、选策略、Stays、规则、保存持久化 | Settings UI / ✓ Saved 截屏 |
| 03 | [AUTO 模型路由对话](examples/03-auto-routing-chat/) | 选择 AUTO – Intelligent Router、请求被路由、缓存命中 | 模型选择器 / 对话结果截屏 |
| 04 | [策略与 Stays 缓存亲和](examples/04-strategies-stays/) | 4 种策略差异、turn/auto/session 亲和行为 | 策略图 / Cache hit 截屏 |
| 05 | [自动故障转移](examples/05-failover/) | 成员失败 → 自动切换下一候选、用户无感 | failover 前后截屏 |
| 06 | [Agent-Teams 多智能体 × AUTO 路由](../../../examples/agent-teams/) | `/agent-teams` 3 角色任务 DAG，成员全走 auto/AUTO，缓存命中逐轮走高（案例位于仓库根 `examples/agent-teams/`） | 7 张过程截屏（设计→审查→执行→交付→报告） |
| 07 | [Coding：生成→编译→启动→验证](../../../examples/coding/) | 单轮生成 Go HTTP 服务并写入工作区，一键编译/启动/curl 验证，约束遵守、缓存命中（案例位于仓库根 `examples/coding/`） | 5 张过程截屏（写文件→diff→三步全绿→汇总） |
| 08 | [文档流水线：PDF 识别→翻译→校对→审核](../../../examples/document-pipeline/) | 42 页 PDF 四阶段流水线，6 并行子智能体分块，凭据缺失自动回退，3.2M tok 缓存命中 85%+（案例位于仓库根 `examples/document-pipeline/`） | 11 张过程截屏（上传→提取→并行→diff→交付物） |
| 09 | [数据脱敏：字段分级→整文件匿名化](../../../examples/data-desensitization/) | 后台统计数据敏感字段分级，user_XXX/inst_XXX 一致性映射，统计语义保留（案例位于仓库根 `examples/data-desensitization/`） | 4 张过程截屏（理解→策略→预览→diff） |
| 10 | [图片理解与重新美化](../../../examples/image-redesign/) | 3 张手绘信息图视觉理解 → 现代化 HTML 整合页面，推理等级 **High**（案例位于仓库根 `examples/image-redesign/`） | 4 张过程截屏（上传→任务清单→设计方案→HTML 渲染） |

## 通用前置条件（所有案例共用）

- **DSH（DeepSeek Harness）**：`>= 0.2.0-rc.2`，**web profile**
- **运行时**：Node.js `>= 18`，pnpm（开发/源码构建时需要）
- **插件**：`dsh-llm-router`，安装后位于 `~/.dsh/profiles/web/node_modules/dsh-llm-router`
- **成员 provider**：在 DSH 中至少配置好 2 个可用 provider（案例中用 `ollama` 本地模型 + 云端模型组合）
- **启动方式**：必须用 profile 本地 bin，不要用 npx：

```bash
cd ~/.dsh/profiles/web && ./node_modules/.bin/dsh web --port 3082
```

⚠️ **首次安装后必须重启 DSH**：插件的 loader entry 与 client bundle 在服务启动时合成进 boot graph，运行中的进程不会感知新装的包；浏览器刷新无效（详见案例 01）。

## 如何执行案例

1. 按「通用前置条件」装好插件、配好 provider、启动 DSH
2. 进入对应案例目录，按 README 的「执行步骤」操作
3. 对照「最终效果验证」逐项检查；与案例目录内的参考截屏比对

## 相关技能

- 插件**开发与调试**（架构、schemastery、错误分类、构建部署）：`.agents/skills/dsh-plugin-dev/`
- 插件主 README：仓库根目录 `README.md`
