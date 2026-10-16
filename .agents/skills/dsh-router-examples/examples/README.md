# 案例集

按上手顺序排列：01 安装 → 02 配置 → 03 使用 → 04 进阶（策略/Stays）→ 05 可靠性（故障转移）→ 06 联动（agent-teams 多智能体）→ 07 实战（coding 全链路）。

| 目录 | 案例 | 所需前置 |
|---|---|---|
| [01-install-verify/](01-install-verify/) | 安装与验证 | DSH web profile |
| [02-configure-route-group/](02-configure-route-group/) | 配置路由组 | 案例 01 |
| [03-auto-routing-chat/](03-auto-routing-chat/) | AUTO 模型路由对话 | 案例 02 |
| [04-strategies-stays/](04-strategies-stays/) | 策略与 Stays 缓存亲和 | 案例 02 |
| [05-failover/](05-failover/) | 自动故障转移 | 案例 03 |
| [agent-teams/](../../../../examples/agent-teams/)（仓库根） | Agent-Teams 多智能体 × AUTO 路由 | 案例 02 + `@nanmicoder/dsh-agent-teams` |
| [coding/](../../../../examples/coding/)（仓库根） | Coding：生成→编译→启动→验证 | 案例 02 + 对应语言工具链（本例 Go） |
| [document-pipeline/](../../../../examples/document-pipeline/)（仓库根） | 文档流水线：PDF 识别→翻译→校对→审核 | 案例 02 + 附件上传；iFlytek 凭据可选（缺失自动回退） |
| [data-desensitization/](../../../../examples/data-desensitization/)（仓库根） | 数据脱敏：字段分级→整文件匿名化 | 案例 02 + 附件上传（TXT/CSV/JSON 等结构化文本） |
| [image-redesign/](../../../../examples/image-redesign/)（仓库根） | 图片理解与重新美化（HTML） | 案例 02 + 多图上传；AUTO 推理等级 High |

**通用依赖（每个案例相同，各 README 不再重复展开）：**

- DeepSeek Harness `>= 0.2.0-rc.2`（web profile）
- Node.js `>= 18`；pnpm 仅源码构建时需要
- 插件 `dsh-llm-router`：`dsh plugin --profile web add github:XHToken/dsh-intelligent-router`
- DSH 中至少 2 个已配置的 provider（案例使用 `ollama` 本地 + `qwen37plus` 云端组合）
- 用 profile 本地 bin 启动：`cd ~/.dsh/profiles/web && ./node_modules/.bin/dsh web --port 3082`
