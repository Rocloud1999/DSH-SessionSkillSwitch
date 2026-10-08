# DSH Session Skill Switch

DeepSeek Harness 的**可安装 Host + Web Client bundle**。在每次会话的第一个模型请求之前选择要启用的技能，不修改全局技能目录，也不要求搬动、复制或删除 `SKILL.md`。

包名：`@rocloud1999/dsh-session-skill-switch`，版本：`1.0.0`。

## 功能

- **常用 / 可选**：常用技能默认勾选，但可在本次会话取消；可选技能默认不勾选。没有分类的新技能一律作为可选。
- **原生配置界面**：输入框附近的“配置本次会话技能”入口；新空白会话首次读取目录后自动打开。支持搜索、逐项勾选、分类、恢复常用默认和全不选。
- **人类确认门禁**：未确认时 `agent/pre-step` 拒绝进入模型步骤；第一次实际获准进入模型步骤之前原子保存锁定标记，此后不能修改该会话的选择。
- **真正的目录过滤和加载校验**：未勾选的名字和描述不会由本插件添加到模型技能目录；原生 `skill` 工具的会话作用域实现会在读取正文前、读取正文后分别验证选择和原生调用限制。未启用的直接 `/skill-name` 调用也会被拒绝。
- **独立持久化**：分类属于当前 profile；选择属于具体会话。恢复会话不重新应用新的默认值。显式空选择不会被解释成“使用默认值”。
- **原生发现与优先级**：读取调用 Agent 的 `ctx.skills.snapshot({ cwd, scope, signal })`，保持项目、全局、打包和其他 provider 的原生解析与同名覆盖规则。不自己递归扫描目录。
- **生命周期**：相同目录不重复注入；压缩隐藏目录后重新建立过滤后的目录；卸载移除自己的注册，不改写全局注册表。

界面和斜杠命令调用同一组 Host 方法。确认和分类不注册为模型工具，模型不能通过本插件的工具自行扩大技能选择。

## 安装

需要支持本文末尾所列公共接口的 DeepSeek Harness profile。Web 使用原生 Plugins 页面；`plugin_manager` 工具通常在 Creator 模式可用。插件代码在 Host 进程中运行，安装时应审阅仓库。

### 从 GitHub 安装

在 Harness 的 **Plugins → 安装 bundle** 中填写：

```text
github:Rocloud1999/DSH-SessionSkillSwitch
```

也可在 Harness 的 Creator 会话中要求调用：

```json
{
  "action": "install_bundle",
  "target": "github:Rocloud1999/DSH-SessionSkillSwitch"
}
```

上面的对象是 **Harness 内的 `plugin_manager` 工具参数**，不是普通聊天消息或 shell 命令。需要稳定锁定版本时，Git spec 可以附带已审核的提交 SHA，而不是追踪分支。

安装结果必须检查 `application` 和 `warnings`。`applied` 才表示本次应用成功；`restart-required` 表示要重启 Harness。更新已安装的包也可能需要重启。不要仅凭包出现在列表中认定插件已经激活。

### 本地目录安装

```bash
git clone https://github.com/Rocloud1999/DSH-SessionSkillSwitch.git
cd DSH-SessionSkillSwitch
npm run verify
```

然后通过 Harness 的 Plugins 页面或 `plugin_manager` 的 `install_bundle`，把 `target` 设为这个目录的**绝对路径**。没有编译步骤，不需要先运行 `npm install`，也没有安装生命周期脚本。本插件复用 Harness 自带模块和浏览器里的 React。

安装后请**新建空白会话**，先选定工作目录和 Agent preset，再配置技能。已有模型历史的会话不能撤回先前读过的内容，因此不会被当作新的未污染会话继续配置。

## 使用

新建会话后，打开输入框附近的“会话技能”面板。把经常使用的技能分为常用，把较重或偶尔使用的技能保留为可选；再勾选本次需要的技能，点击“确认本次会话”，然后发送第一条消息。

分类下拉框修改 profile 中的持久默认分类，复选框只控制这次会话。已确认、但还没有进入第一个模型步骤的会话仍可修改；开始后复选框被锁定，分类仍可以为以后会话调整。

### 斜杠命令

用当前实际发现的技能名替换示例中的 `light` / `heavy`：

```text
/session-skills
/session-skills common light
/session-skills optional heavy
/session-skills confirm +heavy -light
```

`confirm` 以当前界面默认值或已确认的空白会话选择为基线，`+name` 开启、`-name` 关闭。要不启用任何技能，执行：

```text
/session-skills none
```

没有附加 `+/-` 参数的 `/session-skills confirm` 也是明确的人类确认，不会自动调用模型。UI/CLI 操作走原生人类命令平面；命令输入和输出是 log-only 事件，正常情况下不成为模型消息。没有 Web/交互命令平面的 headless 自动化不在这一版的使用范围内。

## 配置和存储

bundle 只插入 `rocloud1999-session-skill-switch` 这一行，不覆盖整个 preset，不禁用全局 `tool-skill`，不修改源技能文件。

初始分类可通过 Host Config 的 `commonSkills` / `optionalSkills` 设置。两者不允许重叠，名字必须是合法的原生 skill name。已经通过界面保存的分类优先于这些初始默认值。

```yaml
- id: rocloud1999-session-skill-switch
  config:
    commonSkills: [light]
    optionalSkills: [heavy]
    catalogDescriptionMaxLength: 500
```

`stateDir` 可设为一个专用的绝对目录。未指定时，数据写入：

```text
$DSH_PROFILE_DIR/plugin-data/session-skill-switch/
```

没有 `DSH_PROFILE_DIR` 时，依次回退到 `$DSH_HOME/plugin-data/session-skill-switch/`、`~/.dsh/plugin-data/session-skill-switch/`。分类存为 `groups.json`，每次会话存为 `session-<sha256(sessionId)>.json`。会话文件只保存选择、元数据绑定和锁定状态，不保存技能正文。读写由 Host 完成，不使用浏览器 `localStorage`。

文件写入采用独占锁、临时文件、文件 fsync 和原子重命名；支持目录 fsync 的平台还同步目录。目录/文件分别请求 `0700` / `0600` 权限（Windows 最终由 ACL 决定）。并发修改采用 revision 检测，不静默覆盖别的窗口。非法 JSON、未知版本、损坏状态和不完整发现都不会回退为“全部启用”。

分类按解析后的技能**名字**保存；不同项目中同名技能共用默认分类，但每次选择会额外绑定 provider、source、path、description 和调用策略，因此不会把已确认的同名技能悄悄替换成另一个来源。正文按原生机制按需重读，不做内容版本锁定。

备份/迁移 profile 时应同时备份此数据目录。只有会话日志、没有对应插件状态的恢复会话会被阻止，绝不会默认扩大技能范围。数据丢失时优先恢复备份，否则新建会话。

## 重要边界

**它控制的是 Harness 标准技能目录和 `skill` 加载路径，不是文件权限沙箱。** 已有读文件或 shell 权限的模型、可信 Host 插件，仍可能通过别的工具读取磁盘文件或日志。它不会删掉过去的提示词、已加载的正文或模型已经知道的内容，也不承诺抵御任意恶意同进程插件。

普通历史 fork 带有之前的上下文，因此不能被重新配置为“干净会话”。原生 `origin: subagent` 的委派子 Agent 则只继承父会话已锁定选择与子目录的交集，不继承新发现的常用技能；普通新会话不采用这种继承。

如果所选技能的 provider / 路径 / 描述 / 调用策略改变，该技能会从当前可用目录移除，调用被拒绝；它的新版本需要在新会话重新选择。发现不完整时拒绝新的模型步骤，保留已有历史，不注入未经确认的替代目录。

某个 preset 原本没有可见的 `skill` 工具时，本插件不会凭空增加该工具。另一个插件竞争替换本插件的作用域加载器时会报 `COMPETING_SKILL_LOADER`，而不是静默放行。先选择 preset 再开始配置；修改服务隔离或自定义技能消费者的部署需单独验证。

插件停用/卸载后，Harness 会恢复原来的技能机制；本插件不再提供过滤或门禁。状态文件保留，便于重新安装时恢复。不要把“停用插件”当作“全部关闭技能”。

## 故障恢复

`STALE_STATE` / `STALE_DRAFT`：刷新面板，检查新的目录和选择，然后重新确认。`INCOMPLETE_CATALOG`：先排查上游 provider，恢复完整发现后重试。`SESSION_STARTED` / legacy 提示：新建空白会话。

`STATE_BUSY`：先重试。若进程崩溃留下 `*.lock`，退出使用该 profile 的**所有 Harness 进程**、备份整个数据目录、确认没有写入者后，仅删除对应的 `*.lock`。不要删除会话 JSON 来尝试解锁已开始的会话。

## 开发与验证

```bash
npm run verify
npm pack --dry-run
npm pack
```

本版本在 Node.js 22.16.0 下通过 **81 项本地自动化测试**，其中 28 项为原有策略回归测试。新增测试覆盖真实控制器与文件存储、Host 适配器契约、Client 懒加载注册和包资源；原有测试文件保持不变。CI 配置包含 Linux/Windows、Node 22/24，是否通过以仓库实际运行结果为准。

**验证范围如实说明：** Host 适配器测试使用内存 Cordis/Agent 测试替身；Client 测试没有运行真实浏览器。代码依据 `deepseek-ai/deepseek-harness` 源码接口（检索基线 `5badb15009ae1756c3afe0ae0cef1faafc290ccc`）实现，但没有在用户的实际 Harness 实例里完成安装、页面点击或真实模型端到端验收。可安装 bundle 已齐备，这与“所有 Harness 版本都已通过实机测试”不是同一结论。

具体接入和实机验收步骤见 [docs/INTEGRATION.zh-CN.md](docs/INTEGRATION.zh-CN.md)。许可证为 MIT；SVG 图标为本仓库原创。
