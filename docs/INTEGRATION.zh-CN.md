# Harness 接入与实机验收

## 当前交付

这份文档替代原先“仅策略核心”的接入计划。仓库现在包含可装载的 Host 入口 `index.js`、Web Client `client.js`、bundle patch、策略控制器、持久化、原生命令入口、作用域 loader、首步门禁、图标和双语元数据，不需要再由使用者补写适配器。

没有硬编码假 HTTP 端点，没有替换 app root，没有 monkey-patch `ctx.skills`，也没有改写全局技能目录。UI 通过原生 `ctx.remote.commands.execute(sessionId, line, [])` 调用人类命令，检查外层 `ok` 和内层 `value.result.kind`。

## 依赖的公共契约

核对源：`deepseek-ai/deepseek-harness`，检索基线 commit `5badb15009ae1756c3afe0ae0cef1faafc290ccc`。这是源码契约对齐标记，不是所有已发布版本的兼容性承诺。

| 契约 | 用途 | 上游源码位置 |
|---|---|---|
| `dsh.bundle.patch`、`dsh.client`、`window.__ModuleLoader__.load` | 安装与 Client 激活 | `packages/preset/agent-preset/skills/cordis-plugin-development/templates/decoration/` |
| `ctx.commands.register` | 只由人类触发的配置 | `packages/interaction/commands/src/` |
| `ctx.remote.commands.execute` | Web 调用 Host 命令 | `packages/client/ui-commands/src/client/service.ts` |
| `ctx.skills.snapshot/get({ cwd, scope, signal })` | 原生发现、完整性、作用域、加载 | `packages/skill/skill/src/` |
| `agent.ctx.tools.get/register` | 仅当前 Agent shadow 原生 loader | `packages/core/tools/src/` |
| `agent/created`、`agent/disposed`、`ctx.agents.list` | 现有及未来 Agent 生命周期 | `packages/core/agent/src/` |
| `agent/pre-step` + `{ prepend: true }` | 外层 admission wrapper | `packages/core/agent/src/runtime-types.ts`、`docs/cordis-api/events.md` |
| `agent.runMaintenance` | 确认阶段排斥模型启动竞态 | `packages/core/agent/src/runtime-types.ts` |
| `session.seq/eventAt/surface.nodes` | 已开始判断、可见目录重建 | `packages/session/` |
| `createUserMessage`、`renderSkillContent` | 原生消息和正文渲染 | `packages/llm/llm/`、`packages/skill/skill/` |
| `conversation.composer.dock` + `sessionId` | 原生会话面板入口 | `packages/client/ui-conversation/`、`packages/client/ui-session/` |
| `ctx.locale.register` + slot `locale` | 双语响应式文案 | `packages/client/ui-plan/src/client/index.ts` 示例 |

## 每个边界做什么

配置界面读取**未过滤的、原生解析后的完整目录**。原生 provider 的优先级和调用限制保持权威。确认 payload 带目录摘要、会话状态 revision、分类 revision 和显式选择列表；服务端重新发现并验证，不能用过时界面覆盖当前目录。

确认通过 `agent.runMaintenance` 执行，使后续唤醒输入等待保存结束。模型首步前，从磁盘恢复选择，取原生当前目录与已保存 binding 的交集。下游 pre-step 拒绝时不锁定；下游同意时，先保存锁定标记，再返回过滤后的消息。磁盘写入失败不会退回成默认全开。

每个 Agent 只 shadow 它原本已有的原生 `skill` 工具，保留其参数 schema、output renderer 和展示定义，换用检查选择的执行器。summary 校验在 `get()` 前，definition 校验在 `get()` 后。全局原生定义不变，其他会话不共享勾选。

外层 pre-step wrapper 清除下游这一步生成的标准 `skill-catalog` / `skill-invocation` 消息，换为已校验的目录和手动调用内容；消息仍通过正常 admission 进入持久历史，而不是在 `agent/request` 偷改请求。其他消息、拒绝决定、`startsRequestSeries` 和未知扩展字段保留。直接手动调用的原生下游消费者可能重复读取一次已允许的正文；最终被注入的是本插件重新校验的那份。

目录历史缓存只扫描新增事件，不在每一步重新扫描整个日志。没有变化不重复发布；压缩使旧目录不可见时重建当前过滤后的目录。首次空选择没有技能描述注入；从非空变为空时发布显式空替换。

停用时会移除本插件在 Agent context 上注册的 loader；资源同时受 Agent 和插件两方生命周期管理。挂起的操作接收插件 lifetime abort signal。

## 状态归属

`groups.json` 和每会话 JSON 是**本插件人类选择的持久状态**，不是新增 Session 事件类型。真正进入模型上下文的目录/正文仍是正常提交的原生用户角色上下文消息。原生命令自身也会产生 log-only 审计记录。

会话日志导出不会自动把 sidecar 状态打包进去。迁移必须备份插件数据目录；只有日志没有 sidecar 时拒绝恢复技能能力。此取舍避免杜撰不可兼容的新 Session 事件，但不是独立导出文件的完全自包含复现。

profile 分类以名字为键；会话绑定额外覆盖来源和元数据。正文编辑仍按需读取，不是内容哈希锁定。

## 本地验证结果与限制

`npm run verify`：81 项测试通过，Node 22.16.0；策略 28 项（原文件未修改）、控制器/存储 34 项、Host 适配器 16 项、Client/包结构 3 项。

测试没有执行实际 Harness 的 Cordis 运行时或真实 Web 页面。Host 测试替身按已阅读的公共 API 模拟作用域、环绕 waterfall、维护互斥和事件；因此不能把这些测试描述为“真实 Harness 端到端通过”。CI 是额外的环境回归，不替代下述实机验收。

## 安装后验收顺序

1. 在 Plugins 安装 bundle，检查 `application` / `warnings`；需要时重启。确认 bundle 和插件行显示“会话技能开关”及自有图标，没有默认模板元数据。确认 Client 插槽入口出现。
2. 新建空白会话，准备一个常用轻量技能和一个可选重型技能。面板应默认只勾选常用项；不确认直接发送时不应产生模型请求。确认后再发送，不依赖自动重发先前被拦截的输入。
3. 检查首个模型步骤的原生目录消息：只有勾选项，不包含可选项描述。再开一会话取消常用、启用可选，应互不影响。全部不选也必须是有效确认。
4. 让模型调用未选技能，检查拒绝且不返回正文；手动 `/name` 也同样拒绝。已选 user-only 技能只能手动调用，不能进入模型目录或通过模型 loader 提权。
5. 刷新页面、重启 Harness 并恢复同一个会话，确认选择仍然相同。修改 profile 分类不会改变已开始的会话；改动所选技能描述会让该绑定失效，而不是自动接受新版本。
6. 验证两个浏览器标签页并发配置时 stale 提示；验证技能 provider 故障时完整性提示。普通历史 fork 不应声称是干净会话，委派子 Agent 只能继承父选择交集。
7. 卸载/停用 bundle 后，确认入口、命令和 scoped loader 都被清理，原生机制恢复，未遗留监听器。

浏览器验收同时覆盖窄屏、键盘 Tab、Escape 关闭 dialog、明暗主题、中文/英文切换。dialog 使用原生顶层显示和焦点管理，样式引用 Host token；没有用静态 HTML 预览冒充真实 Harness UI 截图。
