# 多扩展集合发布指南

## 1. 推荐：GitHub Actions

Actions 中手动运行 `Publish extension`：

```text
版本检查与 sequence 准备
→ typecheck
→ build
→ test
→ 生成 SHA-256 package
→ 生成并验证全集合 catalog
→ git diff --check
→ 上传候选 artifact
→ 创建发布 PR
```

输入目标 extension ID 和基础分支即可。workflow 使用 Node 22 与锁定的 pnpm，不需要私钥、发布者公钥或 GitHub Environment Secret。

它不会直接修改主分支：候选 package 和 catalog 会进入自动 release PR，合并后 GitHub Raw 集合地址才发布新版本。

## 2. 发布单位

一次发布包含：

1. 插件 release：`extensions/<id>` 的版本和 `packages/<id>`；
2. 集合 release：`repository/catalog.json` 及完整 `repository/packages/`。

即使只更新一个插件，catalog 也必须保留其他 workspace 的 entry。

## 3. 发布前

同步：

- workspace `package.json` version；
- manifest version；
- 业务数据中显式记录的 version（如有）；
- 新行为对应的最小回归。

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
  --installed-at 2026-08-11T07:09:03.000Z
```

该命令会：

- 拒绝无效、重复或降级版本；
- 确认 workspace 与 manifest version 一致；
- 把 repository `sequence` 提升到已发布 catalog 的下一位；
- 更新该插件 `package.createdAt`；
- 为 workflow 输出插件 ID、版本、时间、branch slug 和 sequence。

同一 release 重建时应使用同一时间，否则 receipt 和 payload digest 会改变。

## 5. 本地生成

配置生成器示例：

```bash
corepack pnpm typecheck -- --extension org.substore.config-generator
corepack pnpm build -- --extension org.substore.config-generator
corepack pnpm test:built -- --extension org.substore.config-generator
corepack pnpm package:assemble -- --extension org.substore.config-generator
corepack pnpm repository
corepack pnpm verify
git diff --check
```

也可以用较短的等价路径：

```bash
corepack pnpm typecheck -- --extension org.substore.config-generator
corepack pnpm test -- --extension org.substore.config-generator
corepack pnpm package -- --extension org.substore.config-generator
corepack pnpm repository
corepack pnpm verify
```

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

## 7. 配置生成器同步点

```text
extensions/org.substore.config-generator/package.json
extensions/org.substore.config-generator/extension.config.json
extensions/org.substore.config-generator/backend/src/extensions/config-generator/manifest.json
packages/org.substore.config-generator/
repository/catalog.json
repository/packages/org.substore.config-generator/<version>/node.json
```

frontend bundle、CSS 和 locale 都随扩展 package 发布，不需要同步写入 Host 前端。Host 也不应内置配置生成器业务代码。

## 8. 来源回归

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

## 9. 发布 PR

自动 PR 应包含：

- 目标插件源码、测试与版本；
- `packages/<id>`；
- 完整 `repository/catalog.json`；
- 完整 `repository/packages/`；
- workflow 生成的 Lore 格式 commit。

合并后使用固定 commit/tag Raw URL 再做一次 source add、install、enable、uninstall、reinstall。只有已提交并推送的 URL 才算远程回归。

## 10. 失败处理

- build output mismatch：重新生成 package，不手改摘要；
- digest mismatch：确保 catalog、envelope、package 来自同一次生成；
- catalog 少 entry：恢复 workspace 后重建全集合；
- Host API/ABI incompatible：升级 Host 或提升扩展兼容要求；
- 安装后不健康：不要合并 release PR，修复并重新生成候选版本。

如果未来开放不受信作者，再为那一阶段设计签名、撤销和隔离；当前发布流程不要提前携带未使用的密钥系统。
