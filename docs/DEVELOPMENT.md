# 多扩展开发指南

## 1. 开发单位

本仓库不是“一个仓库一个插件”，而是一个插件集合。每个插件的开发边界是：

```text
extensions/<extension-id>/
├── extension.config.json
├── package.json
├── README.md
├── manifest 或业务源码
├── frontend/                 # 可选
├── backend/                  # 可选
├── content/                  # content 扩展使用
├── release/                  # 可选，仅公钥和公开发布材料
└── tests/
```

对应的安装包单独位于：

```text
packages/<extension-id>/
```

所有插件最终由根目录的：

```text
repository/catalog.json
```

聚合发布。共享的是工具链和订阅入口，不是插件 ID、作者、数据、权限或密钥。

## 2. 环境

- Node.js `>=20`；
- Corepack；
- pnpm `11.0.9`；
- 完整 Host 回归需要工作区中存在 `Sub-Store/backend`；
- 前端交互回归需要运行 `Sub-Store-Front-End`。

初始化：

```bash
corepack pnpm install
corepack pnpm extension:list
```

## 3. 创建新扩展

推荐从安全的 content-only 模板开始：

```bash
corepack pnpm extension:create -- \
  --id com.example.my-extension \
  --name "My Extension" \
  --description "Example content extension" \
  --version 0.1.0 \
  --publisher-id com.example \
  --publisher-name "Example"
```

生成结果：

```text
extensions/com.example.my-extension/
├── extension.config.json
├── manifest.json
├── package.json
├── README.md
└── content/extension.json

packages/com.example.my-extension/
├── manifest.json
├── receipt.json
├── package.json
└── content/extension.json
```

然后运行：

```bash
corepack pnpm install
corepack pnpm package -- --extension com.example.my-extension
corepack pnpm repository
corepack pnpm verify
```

脚手架生成的是 `kind: content`、`containsExecutableCode: false` 的插件。其 `sha256-digest` 只提供不可变完整性，不表示发布者身份认证，也不会获得前后端 JavaScript 执行权限。

如果需求必须动态执行 Vue 或 Node 代码，应先完成以下设计，再建立 executable workspace：

1. 明确 Host SDK ABI 和最小权限；
2. 为插件分配独立、受限的签名密钥；
3. 确认 Host 是否允许该插件 ID 和 publisher；
4. 设计构建、receipt、package 和 Host authorization request；
5. 增加停用、卸载、失败回滚和安全回归。

不要通过修改 content 模板的一个布尔值来获得执行权限；Host 会拒绝这种包。

## 4. `extension.config.json`

仓库工具通过这个文件发现插件。配置生成器示例包含前后端构建与 Ed25519 公钥；content 插件的最小结构是：

```json
{
  "schemaVersion": 1,
  "id": "com.example.my-extension",
  "manifest": "manifest.json",
  "packageDirectory": "packages/com.example.my-extension",
  "signature": {
    "algorithm": "sha256-digest",
    "keyId": "community-com.example.my-extension"
  },
  "package": {
    "variant": "node",
    "source": "community-repository",
    "createdAt": "2026-08-11T00:00:00.000Z"
  },
  "contentFiles": [
    {
      "source": "content/extension.json",
      "package": "content/extension.json"
    }
  ],
  "repository": {
    "distribution": "community",
    "author": {
      "id": "com.example",
      "name": "Example"
    }
  }
}
```

关键规则：

- 目录名、config ID、manifest ID、receipt ID 和 package ID 必须一致；
- `packageDirectory` 必须位于仓库根的 `packages/` 内；
- `repository.author` 是插件作者，不能用仓库 owner 猜测；
- `package.createdAt` 是可复现 package/receipt 的稳定时间，发新版本时显式更新；
- `contentFiles` 只允许安全相对目标路径；
- executable 插件的 `signature.publicKey` 必须是该插件明确使用的公开密钥，不包含私钥。

## 5. 命令选择规则

根命令默认处理全部插件：

```bash
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test
corepack pnpm package
```

只处理一个或多个指定插件：

```bash
corepack pnpm build -- --extension org.substore.config-generator

corepack pnpm test -- \
  --extension org.substore.config-generator \
  --extension com.example.my-extension
```

`repository` 与 `verify` 始终以整个集合为准。即使只修改一个插件，最终 catalog 仍必须包含仓库中的全部插件，不能发布一个意外丢失其他 entry 的局部 catalog。

## 6. 日常开发循环

### content 扩展

1. 修改 `extensions/<id>/content/*` 和 manifest；
2. 若版本变化，同步 workspace `package.json` 版本并更新 `package.createdAt`；
3. 运行 `package -- --extension <id>`，自动重建该插件的 digest-only 包；
4. 运行 `repository` 重新聚合集合源；
5. 运行 `verify`；
6. 从本地集合源安装验证。

### executable 扩展

1. 在自己的 workspace 内修改源码和测试；
2. 运行目标插件的 `typecheck`、`build`、`test`；
3. 不要覆盖当前已签名的 `packages/<id>`；
4. 产物字节变化后进入正式签名发布流程；
5. Host 授权新 manifest/package digest 后才允许安装。

配置生成器当前可复现构建摘要：

```text
backend/index.cjs
2102cd7f71f2cdb70aea206fb3f8f236673a5674037d725ff1bfcd3e82de3763

frontend/index.js
4c998eff193e05588e5600510a5080fe07cad24f0b87bb87f6ea83d1c87f685c

frontend/style.css
099ed896b683b1e71ecffb6d427c4071b4a12683f74a7be4477c91415d4ead32
```

## 7. Watch 与交互调试

监听全部可构建插件：

```bash
corepack pnpm dev
```

只监听配置生成器：

```bash
corepack pnpm dev -- --extension org.substore.config-generator
```

watch 只生成本地 `build/<id>`，不会绕过签名，也不会热替换 Host 当前 active package。完整交互测试必须使用受 Host 接受的包。

本地正式链路：

```bash
corepack pnpm repository
corepack pnpm repository:serve
corepack pnpm host:start
corepack pnpm source:add -- \
  --url http://127.0.0.1:8765/catalog.json \
  --name "Sub-Store Extensions (Local)"
corepack pnpm extension:install -- \
  --extension org.substore.config-generator \
  --reinstall
```

前端运行在：

```text
http://localhost:8888/extensions/config-generator
```

## 8. 配置生成器 SDK 边界

配置生成器是当前仓库的 trusted-official executable 示例。

前端：

- 从 Host 的 `__SUBSTORE_EXTENSION_FRONTEND_SDK_V1__` 共享 Vue、Pinia、Router、i18n 和 UI 组件；
- 输出一个 IIFE `frontend/index.js` 和一个 `frontend/style.css`；
- 浏览器加载前再次核对 SHA-256；
- 停用或卸载时移除动态路由、样式和 definition。

后端：

- bundle 导出 `extensionId`、`implementationAbi`、`activate(host)` 和 `deactivate(host)`；
- 只通过 Host services 使用存储、资源、网络、转换和缓存；
- 激活失败必须回滚 adapter 和 contribution；
- trusted-official bundle 属于 Host TCB，不是沙箱。

## 9. 本地化边界

配置生成器 v1.1.0 的 `configGenerator.*` 文案仍由 Sub-Store-Front-End 全局 locale 提供。当前 frontend SDK 尚未提供插件级 locale contribution，因此在不重新签名和同步 Host 前端的情况下，不应向包中临时增加另一套语言资源。

新扩展如果没有可执行 UI，应把用户可见文本作为 content 数据的一部分；未来 Host 增加 locale contribution 后再迁移到版本化语言契约。

## 10. 故障排查

### `Build output differs from the signed release`

源码或工具链生成的字节与已签名包不同。不要放宽检查；升级版本并进入签名发布流程。

### `EXTENSION_SOURCE_OFFICIAL_MIRROR_UNAUTHORIZED`

集合源中的 trusted-official manifest 或 package digest 没有得到当前 Host 官方 catalog 授权。确认仓库和 Host 使用的是同一 release。

### `EXTENSION_COMMUNITY_EXECUTION_FORBIDDEN`

community 插件声明了可执行代码、entrypoint 或 install hook。恢复为 content-only，或先完成独立信任和 Host 授权设计。

### `EXTENSION_ADMIN_AUTH_REQUIRED`

Host 已启用管理令牌。传入 `--token`，或设置 `SUB_STORE_EXTENSION_ADMIN_TOKEN`。

### catalog 中少了其他插件

不要手工编辑 `repository/catalog.json`。确认每个插件都存在 `extensions/<id>/extension.config.json`，然后重新运行：

```bash
corepack pnpm repository
corepack pnpm verify
```
