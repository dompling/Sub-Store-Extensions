# 配置生成器扩展

插件 ID：

```text
org.substore.config-generator
```

这是 `Sub-Store-Extensions` 集合仓库中的一个独立 trusted-official executable 插件。它不是仓库本身；仓库以后可以继续增加其他 `extensions/<id>` workspace，并通过同一个 `repository/catalog.json` 发布。

## 目录

```text
backend/                 Surge/QX/Clash/Loon 生成、导入与 Host adapter
frontend/                Vue 页面、组件、图标和 frontend SDK 类型门面
tests/                   插件级行为与 package 契约测试
release/                 只包含公开验证密钥
extension.config.json    构建、package、签名和 catalog 配置
package.json             workspace 身份与版本
```

已签名安装包位于仓库根：

```text
packages/org.substore.config-generator
```

集合 envelope 位于：

```text
repository/packages/org.substore.config-generator/1.1.0/node.json
```

## 开发

从仓库根运行：

```bash
corepack pnpm typecheck -- --extension org.substore.config-generator
corepack pnpm build -- --extension org.substore.config-generator
corepack pnpm test -- --extension org.substore.config-generator
corepack pnpm package -- --extension org.substore.config-generator
```

最后仍需运行全仓门禁：

```bash
corepack pnpm check
```

## 信任边界

配置生成器 Node 包包含可执行后端和原生前端资源，因此必须同时通过 Host allowlist、官方 manifest/package digest 授权、Ed25519 签名、receipt、文件摘要和 ABI 校验。

当前公钥：

```text
release/config-generator-public-key.pem
```

仓库不包含正式私钥。不要用 content 插件的 `sha256-digest` 替代配置生成器的官方签名，也不要把这把插件密钥扩展成其他插件的通用授权。

## Runtime

- Node：从已安装、已验证 package 加载 backend/frontend bundle；
- Quantumult X、Loon、Surge、Stash、Shadowrocket、Egern：使用 Sub-Store Host 构建内嵌的匹配 implementation，不远程执行 Node bundle。

完整开发、安装和发布流程见仓库根 [README](../../README.md) 与 [发布指南](../../docs/RELEASING.md)。
