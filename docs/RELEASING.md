# 多扩展集合发布指南

## 1. 发布单位

一个 release 同时涉及两个层级：

1. 插件 release：某个 `extensions/<id>` 的新版本和独立 package；
2. 集合 release：根 `repository/catalog.json` 重新列出仓库里的全部插件。

即使本次只更新一个插件，最终 catalog 也不能只包含这个插件。发布命令始终聚合所有 workspace，并保持其他 entry 不丢失。

## 2. 通用前置检查

```bash
corepack pnpm install
corepack pnpm extension:list
git status --short
```

确认：

- 目标插件 ID、版本和作者正确；
- `extensions/<id>/package.json` 与 manifest version 一致；
- package 路径仍为 `packages/<id>`；
- 没有提交私钥、token、`.env` 或临时日志；
- 不相关插件的 package 没有被意外修改；
- 新行为已有插件级或仓库级回归测试。

## 3. Community content 插件

content 插件的完整性包可以在本仓库确定性生成，不需要私钥。

### 版本准备

同步：

- workspace `package.json` version；
- manifest version；
- content 中显式记录的 version；
- `extension.config.json.package.createdAt`。

`createdAt` 必须是本次 release 的稳定 ISO 时间。重复构建同一个 release 时不要自动改成当前时间，否则 receipt 和 payload digest 会漂移。

### 生成与验证

```bash
corepack pnpm package -- --extension com.example.my-extension
corepack pnpm repository
corepack pnpm verify
```

`package` 会：

1. 从 workspace manifest 和 `contentFiles` 读取源内容；
2. 计算每个文件摘要；
3. 计算 package digest；
4. 生成 receipt；
5. 计算 payload digest；
6. 写入 `sha256-digest` 完整性 metadata；
7. 更新 `packages/<id>`；
8. 组装并验证 `dist/packages/<id>`。

这种 digest 不授权执行代码。若 content manifest 或 variant 声明 executable flag，构建和 Host 安装都会失败。

## 4. Trusted-official executable 插件

配置生成器属于此类。仓库中只保存已签名 package、公钥和验证工具，不保存正式私钥。

### 构建

```bash
corepack pnpm typecheck -- --extension org.substore.config-generator
corepack pnpm build -- --extension org.substore.config-generator
corepack pnpm test -- --extension org.substore.config-generator
```

构建输出：

```text
build/org.substore.config-generator/backend/index.cjs
build/org.substore.config-generator/frontend/index.js
build/org.substore.config-generator/frontend/style.css
```

### 当前签名版本的验证

```bash
corepack pnpm package -- --extension org.substore.config-generator
```

这条命令不会生成新 Ed25519 签名。它把当前已签名 package 复制到 `dist/`，用本次 build 产物覆盖对应文件，然后验证整个签名闭包。如果源码字节变化，命令应失败；这是正确的发布信号。

### 新版本正式签名

当前仓库没有、也不应提供“现场生成正式私钥”的自动命令。新 executable release 必须在受保护发布环境完成：

1. 锁定依赖、Node/pnpm 和构建工具版本；
2. 构建 frontend IIFE/CSS 与自包含 Node CJS；
3. 把 frontend 文件摘要写入 manifest；
4. 规范化 manifest；
5. 生成 package projection 和 package digest；
6. 生成绑定 variant/ABI/entrypoint 的 receipt；
7. 生成 signed payload；
8. 从受保护 secret provider 或文件描述符读取该插件私钥；
9. 使用该插件独立的 Ed25519 key 签名；
10. 输出新的 `packages/<id>`；
11. 生成 Host authorization request；
12. 在 Sub-Store Host 官方 catalog 中授权新 manifest/package digest；
13. 用目标 Host 完成 source install 回归。

正式签名工具必须：

- 不在日志输出私钥；
- 不自动创建新的 release key；
- 不复用其他插件的私钥；
- 拒绝脏工作树、版本不一致、失败测试和摘要漂移；
- 记录 key ID、manifest digest、package digest、payload digest 和构建环境；
- 在 Host 授权完成前标记 release 为不可安装。

## 5. 配置生成器版本同步点

新版本至少核对：

```text
extensions/org.substore.config-generator/package.json
extensions/org.substore.config-generator/backend/src/extensions/config-generator/manifest.json
extensions/org.substore.config-generator/frontend/src/extensions/config-generator/runtime-entry.ts
manifest.frontend.embeddedBasePath
packages/org.substore.config-generator/
repository/packages/org.substore.config-generator/<version>/node.json
Sub-Store Host 官方 catalog authorization
Sub-Store-Front-End embedded publication（脚本 runtime 需要时）
```

当前配置生成器 locale 仍由 Host 前端提供，文案变化可能需要与 Sub-Store-Front-End 同步发布。

## 6. 生成集合 release

插件 package 准备完成后，显式递增：

```text
repository.config.json.sequence
```

然后：

```bash
corepack pnpm repository
corepack pnpm verify
```

生成器会：

- 扫描全部 extension workspace；
- 验证每个 package；
- 按插件 ID 稳定排序；
- 为每个插件生成独立 envelope；
- 清理 stale envelope；
- 生成一个 collection catalog；
- 保留每个 entry 自己的 author/publisher/digest。

不要手工编辑生成后的 catalog 或 envelope。任何手工改动都可能破坏摘要或让生成结果无法复现。

## 7. 本地候选回归

```bash
corepack pnpm check
corepack pnpm repository:serve
corepack pnpm host:start
corepack pnpm source:add
corepack pnpm source:refresh
corepack pnpm extension:install -- \
  --extension <extension-id> \
  --reinstall
```

验证：

- source 状态 ready/verified；
- catalog entry 数量等于 workspace 数量；
- 安装记录指向集合 sourceId/sourceName；
- 插件 enabled；
- compatibility compatible；
- health healthy；
- package integrity verified；
- 卸载保留数据后重装，原数据仍可读取；
- 其他插件 entry 和安装状态没有受影响。

## 8. GitHub 发布

完成门禁后提交：

```bash
git diff --check
git status --short
```

提交内容应包含：

- 目标插件源码、测试和版本；
- `packages/<id>`；
- 完整 `repository/catalog.json`；
- 完整 `repository/packages/`；
- 文档和 release record；
- Host authorization 关联信息（trusted-official 时）。

推送后使用固定 tag 或 commit URL：

```text
https://raw.githubusercontent.com/<owner>/<repo>/<tag-or-commit>/repository/catalog.json
```

必须再用这个真实远程 URL 完成一次 source add、install、enable、uninstall 和 reinstall 回归。GitHub Raw 文件只有 commit 并 push 后才存在；本地文件不能冒充远程回归。

## 9. 发布失败时

- build digest 变化：不要改旧签名，升级版本并重新签名；
- Host mirror unauthorized：先完成 Host catalog 授权；
- catalog 少 entry：恢复丢失 workspace 或重新生成全集合；
- stale envelope：运行 `repository`，不要手工删除单个文件后跳过 verify；
- remote digest mismatch：确认 catalog、envelope 和 package 来自同一 commit；
- 安装后不健康：停止发布，保留旧 tag，完成修复和新的不可变 release。
