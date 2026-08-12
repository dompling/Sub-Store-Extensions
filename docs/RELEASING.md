# 多扩展集合发布指南

## 1. 推荐：GitHub Actions

Actions 中手动运行 `Publish extension`：

```text
选择 patch / minor / major
→ 从 catalog 生成版本并准备 sequence
→ typecheck
→ build
→ 生成 SHA-256 package
→ 生成全集合 catalog
→ test
→ 验证 package 与 catalog
→ git diff --check
→ 上传 build / dist / package 候选 artifact
→ 确认基础分支未发生并发更新
→ 把已验证发布提交快进到基础分支
→ 清理同版本遗留的 automation/publish-* 分支
```

输入目标 extension ID、基础分支和版本增量即可。workflow 使用 Node 22 与锁定的 pnpm，不需要私钥、发布者公钥或 GitHub Environment Secret。

验证通过后，它会直接把包含源码版本、package 和 catalog 的发布提交快进到所选基础分支。推送前会重新读取远端分支 SHA；如果基础分支在构建期间前进，workflow 会停止并要求重新运行，不会覆盖新的提交，也不会使用强制推送。

默认使用 workflow 的 `GITHUB_TOKEN` 和 `contents: write`。仓库设置应允许 workflow 写入仓库内容：

```text
Settings
→ Actions
→ General
→ Workflow permissions
→ Read and write permissions
```

不再依赖 `Allow GitHub Actions to create and approve pull requests`，也不会为每次发布创建新的候选分支或等待人工合并。

如果基础分支规则不允许 `github-actions[bot]` 直接更新，可以配置可选的 repository secret `RELEASE_PUBLISH_TOKEN`。使用 fine-grained personal access token 时至少授予目标仓库 `Contents: Read and write`，并确保 token 所属账号被分支规则允许更新目标分支。workflow 会优先使用该 secret，否则使用默认 `GITHUB_TOKEN`。

## 2. 发布单位

一次发布包含：

1. 插件 release：`extensions/<id>` 的版本和 `packages/<id>`；
2. 集合 release：`repository/catalog.json` 及完整 `repository/packages/`。

即使只更新一个插件，catalog 也必须保留其他 workspace 的 entry。

## 3. 发布前

已有扩展的 workspace `package.json` 和 manifest version 应保持为 catalog 当前已发布版本。不要在日常功能提交中手工升版；发布 workflow 会根据所选 patch、minor 或 major 增量同时更新二者。构建代码需要版本时，应从 manifest 注入；业务 JSON 必须通过 `extension.config.json` 的 `release.versionFiles` 显式声明，避免维护未受控的版本常量。

新行为仍需带上对应的最小回归测试。首次发布的扩展没有 catalog entry，workflow 会沿用脚手架中的初始版本。

检查：

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm extension:list
git status --short
```

不要提交 token、`.env`、临时日志或本机路径。

## 4. `release:prepare`

workflow 使用当前提交时间作为稳定 receipt 时间：

```bash
corepack pnpm release:prepare -- \
  --extension org.substore.config-generator \
  --bump patch \
  --installed-at 2026-08-11T07:09:03.000Z
```

该命令会：

- 确认 workspace、manifest 与 catalog 当前版本一致；
- 根据 catalog 自动计算 patch、minor 或 major 版本；
- 首次发布时沿用源码初始版本；
- 拒绝无效增量以及绕过 workflow 的手工版本漂移；
- 同步 workspace 与 manifest version；
- 把 repository `sequence` 提升到已发布 catalog 的下一位；
- 更新该插件 `package.createdAt`；
- 为 workflow 输出插件 ID、新旧版本、增量、时间、branch slug 和 sequence。

同一 release 重建时应使用同一时间，否则 receipt 和 payload digest 会改变。

## 5. 本地生成

配置生成器示例：

```bash
corepack pnpm release:prepare -- \
  --extension org.substore.config-generator \
  --bump patch \
  --installed-at "$(git show -s --format=%cI HEAD)"
corepack pnpm typecheck -- --extension org.substore.config-generator
corepack pnpm build -- --extension org.substore.config-generator
corepack pnpm package:assemble -- --extension org.substore.config-generator
corepack pnpm repository
corepack pnpm test:built -- --extension org.substore.config-generator
corepack pnpm verify
git diff --check
```

未执行升版、只验证当前已发布版本的日常开发可以使用较短路径：

```bash
corepack pnpm typecheck -- --extension org.substore.config-generator
corepack pnpm test -- --extension org.substore.config-generator
corepack pnpm package -- --extension org.substore.config-generator
corepack pnpm repository
corepack pnpm verify
```

执行过 `release:prepare` 后，必须先重建 package 和 catalog，再运行包含 package 契约的 `test:built`。也可以直接运行 `corepack pnpm check -- --extension <id>`；完整门禁采用相同顺序。

## 6. Package 生成内容

`package` / `package:assemble` 会：

1. 读取 content files 或 executable build artifacts；
2. 校验安全相对路径和声明闭包；
3. 计算每个文件 SHA-256；
4. 更新 frontend asset digest；
5. 生成 package projection 和 package digest；
6. 生成绑定 variant、ABI、entrypoint 的 receipt；
7. 生成 payload digest；
8. 写入 `sha256-digest` integrity metadata；
9. 写入并验证 `packages/<id>` 和 `dist/packages/<id>`。

SHA-256 能检测内容漂移，但不认证发布者。添加来源和安装是用户的显式信任决定。当前 executable 扩展不是沙箱。

## 7. 版本历史与 Git

扩展版本使用 SemVer，Git 只提供不可变发布指针：

```text
manifest version: 1.2.1
Git tag: org.substore.config-generator@1.2.1
```

集合仓库不能使用通用 `v1.2.1`，因为不同插件可能同时拥有该版本。workflow 在发布前确认 tag 不存在，再原子推送目标分支与 annotated tag；任一 ref 推送失败时都不应留下半次发布。

历史版本由两处同源记录：

- `repository/catalog.json` 中最新 entry 的 `releases[]`，供 Host 一次刷新获得；
- `repository/releases/<extension-id>.json`，作为插件独立版本台账。

每个 release 固定完整 manifest、相对 package URL、package digest、发布时间和安装状态。旧 package 必须继续保留在当前 `repository/packages/`；历史 `gitCommit` 或未来 `gitTag` 只记录来源证明。发布器拒绝同一 SemVer 对应不同 manifest、URL 或摘要。

## 8. 配置生成器同步点

```text
extensions/org.substore.config-generator/package.json
extensions/org.substore.config-generator/extension.config.json
extensions/org.substore.config-generator/backend/src/extensions/config-generator/manifest.json
build/org.substore.config-generator/
dist/packages/org.substore.config-generator/
packages/org.substore.config-generator/
repository/catalog.json
repository/packages/org.substore.config-generator/<version>/node.json
repository/releases/org.substore.config-generator.json
```

workflow 自动更新 workspace 与 manifest 版本；frontend runtime version 由 Vite 从 manifest 注入，不再单独维护。frontend bundle、CSS 和 locale 都随扩展 package 发布，不需要同步写入 Host 前端。Host 也不应内置配置生成器业务代码。

`build/` 和 `dist/` 被 Git 忽略，只上传为 Actions 候选 artifact。`packages/` 与 `repository/` 是 GitHub Raw 集合源的可安装内容，会和源码版本变更一起进入同一个发布提交。

## 9. 来源回归

本地候选：

```bash
corepack pnpm repository:serve
corepack pnpm host:start
```

先验证空来源：

- 商店/catalog/runtime manifest 不出现配置生成器；
- 按 ID 安装返回 `404 EXTENSION_SOURCE_NOT_FOUND`。

再添加来源：

```bash
corepack pnpm source:add -- \
  --url http://127.0.0.1:8765/catalog.json \
  --name "Sub-Store Extensions (Local)"
corepack pnpm source:refresh -- \
  --url http://127.0.0.1:8765/catalog.json
corepack pnpm extension:install -- \
  --extension org.substore.config-generator \
  --reinstall
```

验证发现、安装、启用、健康、卸载保留数据和重装。配置生成器还应验证 Clash/Loon preview 对不支持策略组和规则集进行 warning + fallback，而真实策略组循环仍返回校验错误。

`host:start` 默认不设置 package seed。不要用隐式本地 seed 冒充集合源安装成功。

## 10. 发布提交

workflow 生成并推送的发布提交包含：

- workflow 生成的 workspace 与 manifest 版本；
- 目标插件源码与测试；
- `packages/<id>`；
- 完整 `repository/catalog.json`；
- 完整 `repository/packages/`；
- 目标插件 `repository/releases/<id>.json`；
- `<extension-id>@<semver>` immutable tag；
- workflow 生成的 Lore 格式 commit message。

发布后使用固定 commit/tag Raw URL 再做一次 source add、install、enable、uninstall、reinstall。只有已提交并推送的 URL 才算远程回归。

## 11. 失败处理

- build output mismatch：重新生成 package，不手改摘要；
- source version differs from published：撤销手工升版，让 workflow 从 catalog 生成版本；
- push to base branch rejected：开启 Actions `Read and write permissions`；若目标分支规则仍阻止 bot，允许该 actor 更新分支或配置 `RELEASE_PUBLISH_TOKEN`；
- base branch advanced：有其他提交在发布构建期间进入目标分支，直接重新运行 workflow；
- release tag already exists：该 SemVer 已发布，不得覆盖；修复代码后发布新的 patch 版本；
- digest mismatch：确保 catalog、envelope、package 来自同一次生成；
- catalog 少 entry：恢复 workspace 后重建全集合；
- Host API/ABI incompatible：升级 Host 或提升扩展兼容要求；
- 安装后不健康：修复源码后重新运行发布 workflow，生成下一个修复版本。

如果未来开放不受信作者，再为那一阶段设计签名、撤销和隔离；当前发布流程不要提前携带未使用的密钥系统。
