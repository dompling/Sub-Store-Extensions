# 贡献指南

## 开发原则

1. 一个仓库可以包含多个插件，但一个插件必须对应一个 `extensions/<id>` workspace、一个 `packages/<id>` 和一个独立 catalog entry。
2. 共享构建工具和集合订阅源，不共享插件身份、作者、权限、数据 namespace 或可执行代码信任。
3. 优先复用现有脚本和 SDK 契约，不把插件重新耦合到 Sub-Store 私有源码路径。
4. 不为方便开发关闭 manifest、receipt、摘要、签名或 Host official authorization。
5. 行为变更先增加回归测试；清理和重构先锁定现有行为。
6. 不新增依赖，除非现有工具无法完成且已明确评审。
7. 保持 diff 小、可审查、可回滚。

## 新增插件

content-only 插件：

```bash
corepack pnpm extension:create -- \
  --id com.example.my-extension \
  --name "My Extension" \
  --publisher-id com.example \
  --publisher-name "Example"
```

然后：

```bash
corepack pnpm install
corepack pnpm package -- --extension com.example.my-extension
corepack pnpm repository
corepack pnpm verify
```

需要 executable frontend/backend 的插件不要从 content 模板直接改 flag。先提交架构与安全设计，至少说明：

- Host SDK 与 ABI；
- 权限和生命周期；
- 插件独立签名密钥；
- official authorization；
- 脚本 runtime fallback；
- 卸载、保留数据、失败回滚和兼容性测试。

## 修改现有插件

只处理一个插件：

```bash
corepack pnpm typecheck -- --extension <id>
corepack pnpm build -- --extension <id>
corepack pnpm test -- --extension <id>
corepack pnpm package -- --extension <id>
```

提交前仍运行全仓：

```bash
corepack pnpm check
git diff --check
```

原因是 catalog、共享脚本和 workspace discovery 是集合级能力；单插件通过不能证明其他插件没有从最终 catalog 中丢失。

## 版本与交付物

content 插件发布时同步：

- workspace package version；
- manifest version；
- content 中的版本字段；
- `extension.config.json.package.createdAt`；
- `packages/<id>`；
- 完整 `repository/`。

trusted-official executable 插件发生字节变化时，必须生成新版本和正式签名，并同步 Sub-Store Host catalog 授权。不要修改旧 package 中的 digest 或 signature 来让测试通过。

版本号和 Git 的对应关系：

- manifest/workspace 使用 SemVer；
- 发布 tag 使用 `<extension-id>@<semver>`，避免集合仓库中不同插件的 `v1.0.0` 冲突；
- `repository/releases/<id>.json` 是该插件的版本台账；
- `repository/catalog.json` 保留最新 entry，并复制同一份 `releases[]` 供 Host 一次读取；
- 旧版本 manifest、package URL、摘要和可安装状态发布后不可修改；需要修复时发布新版本。

不要根据用户输入的版本号动态拼接下载 URL，也不要在 Host 运行时扫描 GitHub commits。Git tag/commit 负责不可变来源证明，catalog/ledger 才是通用安装协议。

## 作者与来源

新增 entry 必须显式填写：

- manifest publisher；
- `repository.author`；
- distribution。

不要从 GitHub owner、仓库 publisher 或 URL 猜作者。集合仓库可以收录不同作者的多个插件。

## 测试要求

`corepack pnpm check` 应覆盖：

- 所有声明前端的 Vue/TypeScript 检查；
- 所有声明前后端的构建；
- 插件级行为测试；
- 仓库级双插件 catalog 聚合测试；
- 重复 ID 与路径穿越拒绝；
- stale envelope 清理；
- content package digest 闭包；
- trusted package 签名和构建摘要；
- catalog entry 与 workspace 数量一致。

涉及 UI 时，还需在 Sub-Store-Front-End 检查桌面、移动和不同内容长度。涉及 Host 生命周期时，还需从集合 source 完成安装、启用、停用、卸载和重装。

## Commit

提交信息遵循 Lore protocol。首行说明为什么，正文记录约束、舍弃方案、风险和验证证据。例如：

```text
Allow one trusted source to distribute multiple extensions

The repository now preserves per-extension identity while publishing one
aggregate catalog that users subscribe to once.

Constraint: Executable extensions remain authorized by the Host trust root
Rejected: One Git repository per extension | duplicates tooling and source management
Confidence: high
Scope-risk: moderate
Directive: Keep package identity and signing material isolated per extension
Tested: all-workspace build, catalog aggregation, source install lifecycle
Not-tested: GitHub Raw installation until a remote is configured
```
