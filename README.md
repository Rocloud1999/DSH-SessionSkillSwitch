# DSH-SessionSkillSwitch

DeepSeek Harness 会话级 Skill 选择器：把可发现的技能分为**常用**和**可选**，在第一次模型请求前确认本次会话的启用集合。

> **当前状态：策略核心原型，不是可直接安装的完整 Harness 插件。**
> 已实现纯策略模块和 28 项单元测试；原生配置界面、Host 服务、持久化、首次请求门禁和 Harness 加载链路接入尚未实现。不要把核心测试通过理解为插件已接入或已在真实 Harness 环境验证。

## 行为

| 分类 | 新会话默认值 | 本会话调整 | 未选中时 |
|---|---|---|---|
| 常用 `common` | 开启 | 可以关闭 | 不发布描述，拒绝经受控技能入口加载正文 |
| 可选 `optional` | 关闭 | 可以开启 | 不发布描述，拒绝经受控技能入口加载正文 |

**来源、分类、会话选择是三个独立维度。** 全局/项目目录决定来源；常用/可选决定新会话默认值；会话覆盖只影响本次会话，不修改技能文件或原来的全局分类。

未分类的新技能默认可选。确认后的会话保存不可变选择快照，不随分类变更自动扩大启用范围。“尚未确认”与“确认全部不启用”是不同状态。

## 运行测试

需要 Node.js 20 或以上；没有第三方依赖，不需要 `npm install`。

```bash
git clone https://github.com/Rocloud1999/DSH-SessionSkillSwitch.git
cd DSH-SessionSkillSwitch
npm test
```

## 配置示例

以下是本项目的数据结构，**不是 Harness 已有的配置字段**。技能名称仅为示例。

```json
{
  "defaultGroup": "optional",
  "groups": {
    "code-review": "common",
    "deep-research": "optional"
  }
}
```

某次会话覆盖：

```json
{
  "code-review": false,
  "deep-research": true
}
```

## 核心 API

`src/policy.mjs` 提供：

- `resolveGroups()`：合并全局分类与显式工作区分类覆盖。
- `createDraft()` / `confirmSelection()`：建立草稿，并校验目录版本后确认选择。
- `restoreSelection()`：校验并恢复 JSON 快照。
- `modelCatalog()` / `renderModelCatalog()`：只生成本会话允许向模型发布的名称与描述。
- `assertSkillAccess()`：统一校验模型调用和用户显式调用，并保留原生 invocation 限制。

配置界面必须读取完整注册表；不能把过滤后的模型目录作为配置界面的数据源。否则关闭的技能会从界面消失，用户无法重新选择。

`complete: false`、未确认状态和作用域不匹配会报错，不能回退到“启用所有技能”。Host 应先完成用户确认及原子持久化，再允许第一次模型请求。确认操作必须是用户操作，不能交给模型自行授权。

## 实现边界

本模块不访问文件系统、不持久化数据、不注册 Harness 服务，也不修改任何已安装插件。它没有安装清单，不能直接交给 `install_bundle`。

选择绑定技能的名称、提供方、来源、路径、描述和 invocation 标志。绑定字段变化会使原选择失效，避免同名技能被悄悄替换。正文没有做版本固定，仍应按 Harness 原有语义按需读取。

这是上下文发布和技能入口的选择策略，不是文件系统沙箱。拥有通用文件读取或 shell 权限的 agent 仍可能自行读取技能文件；隐藏描述也不保证停止提供方的全部初始化工作。已经进入旧会话上下文的说明不能通过后续开关撤回，因此本设计在首轮前确认，首轮后只读。

## 后续接入

详见 [Harness 接入说明](docs/INTEGRATION.zh-CN.md)。需要同时接入模型目录、`skill({ name })` 和 `/技能名` 显式调用；只做界面复选框或只禁用模型调用都不完整。

已核对的上游源码基线为 `deepseek-ai/deepseek-harness` 提交 `5badb15009ae1756c3afe0ae0cef1faafc290ccc`，不是对所有 Harness 版本的兼容承诺：

- [Skills 子系统](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/docs/subsystems/skills.md)
- [模型目录和加载工具](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/skill/tool-skill/src/index.ts)
- [插件实践](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md)

本项目未包含上游源码，尚未发布可安装插件或完成端到端验证。
