# Harness 插件接入说明

> 这是完整插件的实现设计，尚未接入目标 Harness。文中的新配置字段、界面和会话选择服务属于本项目设计，不代表上游已有对应 API。

## 当前交付

已实现 `src/policy.mjs` 和 `test/policy.test.mjs`。本模块只计算分类、选择快照、模型可见目录和技能入口访问决定，不注册服务、不持久化、不安装插件。

上游核对基线：`deepseek-ai/deepseek-harness` 提交 `5badb15009ae1756c3afe0ae0cef1faafc290ccc`。源码来源见根目录 README。最终接入应以实际安装版本的服务、事件和 Client slot 检查结果为准。

## 用户体验与状态

在空白会话首条消息发送前增加“本次会话 Skills”入口。常用技能默认勾选，可选技能默认不勾选；提供搜索、来源标签、全部不启用、恢复分类默认值和“确认并开始”。

“设为常用/可选”改变以后新会话的默认值；本次复选框只改变会话草稿，两者不得互相覆盖。配置面板始终读取完整技能注册表，而不是过滤后的模型目录。

这里的“会话开始前”指第一次模型请求前，不要求在生成 sessionId 前完成。先建立空白会话记录，再按稳定 sessionId 保存草稿和选择，可避免启动请求先于配置保存。

推荐流程：

```text
完整发现 -> 显示分类与本次选择 -> 用户确认
        -> 重读目录并校验版本 -> 原子持久化选择快照
        -> 放行第一次模型请求
```

未确认与明确确认空集合必须区分。目录变化、发现不完整、保存失败均不得回退为“启用全部技能”。会话开始后选择只读，因为已经发给模型的说明无法通过后续开关撤回。

界面应通过目标版本真实存在的原生 Client slot 集成，不能依赖全局 DOM 修改或独立 HTML 代替。此交付没有声称存在未经核验的 composer slot。

## 核心模块使用示例

以下示例可作为 `.mjs` 文件在仓库根目录运行，不调用 Harness：

```js
import {
  resolveGroups, createDraft, confirmSelection, restoreSelection,
  modelCatalog, renderModelCatalog, assertSkillAccess,
} from './src/policy.mjs';

const scope = { sessionId: 'example-session', workspaceKey: 'example-workspace' };
const policy = resolveGroups({
  defaultGroup: 'optional',
  groups: { 'code-review': 'common', 'deep-research': 'optional' },
});
const catalog = [
  {
    name: 'code-review', description: 'Review code changes.',
    source: 'user-dsh', provider: 'filesystem',
    invocation: { modelInvocable: true, userInvocable: true },
  },
  {
    name: 'deep-research', description: 'Perform extended research.',
    source: 'user-dsh', provider: 'filesystem',
    invocation: { modelInvocable: true, userInvocable: true },
  },
];
const draft = createDraft({
  ...scope, catalog, complete: true, policy,
  overrides: { 'code-review': false, 'deep-research': true },
});
const snapshot = confirmSelection({ draft, catalog, complete: true });

// JSON round-trip demonstrates the format, not actual durable persistence.
const restored = restoreSelection(JSON.parse(JSON.stringify(snapshot)));
const entries = modelCatalog({ snapshot: restored, scope, catalog, complete: true });
console.log(renderModelCatalog(entries));
assertSkillAccess({ snapshot: restored, scope, skill: catalog[1], caller: 'model' });
```

实际 Host 必须验证调用者身份、原子保存快照，并在保存成功前阻止模型请求。`confirmSelection()` 是纯函数，没有认证能力。模型不能通过工具自行扩大允许集合。

## 必须接入的三个边界

### 1. 模型描述目录

文件：`packages/skill/tool-skill/src/index.ts`。

当前 consumer 从注册表 snapshot 中筛选 `isModelInvocable`，再生成目录条目和摘要。会话选择必须在 `catalogSourceEntries()`、digest 计算、`renderCatalogMessage()` / `renderCatalogUpdate()` 之前生效。

初始目录、目录变更后的替换消息、上下文压缩后的目录重建都必须使用同一会话选择。不能只在首轮过滤，也不能让未选技能的名称或描述通过其他提示词字段、工具 schema、错误信息重新发布。

保持原实现的工具可见性、名称排序、描述归一化、转义、长度限制和历史目录去重。`source.entries` 应与已发布的目录一致。

### 2. 模型 `skill({ name })` 调用

同一文件中的 `skillTool.execute()`。

先从已解析的注册表取得 summary，在读取正文前调用 `assertSkillAccess()`；加载 definition 后、返回任何正文前再校验一次。保留原生 `modelInvocable` 限制：选择开关不能扩大 provider 原本禁止的调用模式。

需要同时做前后校验，不能先把正文交给模型再返回禁用错误。

### 3. 用户 `/技能名` 显式调用

同一文件中扫描 `invokedSkillNames(messages)` 的 `agent/pre-step` 监听器。

该入口会直接读取技能并注入正文，因此只过滤模型目录或只设置 `modelInvocable: false` 不能完整关闭技能。需要在正文读取前后检查会话选择，并保留 `userInvocable` 限制。

未选技能应向用户说明“本次会话未开启”，不能偷偷加入本次集合。用户自己输入的技能名不属于插件发布的描述，不能因此擅自改写用户原文。

## 来源与作用域

使用原生注册表已经解析好同名优先级的目录，不自行重新实现目录扫描或优先级。保持全局、项目和 preset 层的原有语义。

live agent 查询应沿用 `{ cwd: agent.session.header.cwd, signal, scope: agent }`。冷会话应沿用已有 session/preset 解析路径；未传 scope 的全局查询不能替代完整的会话视图。

本核心要求调用方提供稳定的 `workspaceKey`，但不推断真实工作区或 preset 身份。适配器负责定义作用域键；切换工作区或 preset 后，不应继续使用旧草稿或绕过匹配检查。

## 两种交付路线

### 独立 bundle：受控替换原 skill consumer

保留 `dsh-skill` 注册表及 provider，禁用原 `dsh-tool-skill` consumer，启用带会话选择策略的替代 consumer。必须读取目标安装组合中的真实行 ID，不能假定它就是包名。

不能同时注册两个同名 skill 工具并依赖加载顺序。仅增加另一个 provider 也不能移除其他 provider 已贡献的技能。

此路线无需修改上游仓库，但必须按已验证版本发布，并跟踪 consumer 的生命周期、历史目录和显式调用行为变更。

### 中立扩展点：小型上游补丁加插件

在原 consumer 的三个边界统一调用一个可选的会话选择服务；未启用该服务时维持原行为。业务配置、UI 和持久化仍由插件实现。

这是建议新增的扩展能力，不是声称上游已有 `skills/filter` 或 `session/before-start` 等事件。接口名称需要在目标源码内定义、类型检查和记录。

长期维护可优先考虑此路线；不能假装只安装一个未接线的策略模块就已生效。

不建议等待完整目录生成后再通过任意顺序的 `agent/pre-step` 监听器做字符串删除；这会依赖 waterfall 顺序，还可能遗漏持久化历史里的旧目录。

## 持久化与生命周期

会话草稿可进入插件自己的存储。正式选择需可恢复，并与会话的 resume、fork、导出和删除生命周期一致。

优先使用目标版本支持的会话记录和存储机制。不要凭空给 session.header 增加不会被正确持久化的字段，也不要直接 append 未支持的新 event.type。sidecar 方案必须定义缺失记录时的失败方式，不能缺失即全量启用。

恢复旧会话不重新套用当前全局默认值。没有历史选择快照的旧会话不能保证过去未展示过可选描述，严格模式应新建配置会话。

fork 必须显式复制选择并绑定新 sessionId，然后校验目标作用域。子 agent 应继承父会话允许集合的交集，而不是因缺少配置而重新开启全部常用技能。无界面启动需要显式允许集合或已确认模板。

## 非目标与安全边界

技能选择不等于工具权限、文件系统隔离、提供方卸载或停止所有后台初始化。通用文件读取和 shell 工具仍可能读取技能文件；严格禁止读取需要额外权限控制。

本核心绑定目录元数据，不固定技能正文或资源版本。需要严格版本固定时，应另加正文/资源哈希和受控读取，不应在未实现时宣称版本已经锁定。

## 尚未完成的端到端验收

- 在真实 Harness UI 中完成分类、本次选择及确认，第一步模型请求确实晚于持久化成功。
- 检查完整请求上下文：未选技能描述不通过初始目录、替换目录、压缩重建或其他字段进入模型。
- 同时验证模型工具调用和用户显式调用，禁用技能正文在拒绝前不被发送。
- 验证两个会话并行、全部不选、重启恢复、fork、子 agent、工作区/preset 切换和目录变更。
- 验证安装、卸载、升级和旧会话兼容性；声明实际支持的 Harness 版本。

核心的 28 项单元测试不替代这些集成验收。此版本没有原生 UI、Host 适配器、安装包或真实 Harness 端到端测试结果。
