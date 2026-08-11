# 多扩展开发指南

## 1. 开发边界

本仓库是一个插件集合，不是“一个仓库一个插件”。每个插件独占：

```text
extensions/<extension-id>/
├── extension.config.json
├── package.json
├── README.md
├── manifest 与业务源码
└── tests/
```

生成物分别位于：

```text
packages/<extension-id>/
repository/packages/<extension-id>/<version>/<variant>.json
```

根 `repository/catalog.json` 聚合全部插件。共享的是工具和订阅入口，不共享插件 ID、作者、数据或权限。

## 2. 环境

- Node.js `>=20`；发布和本仓库回归使用 Node 22；
- Corepack；
- pnpm `11.0.9`；
- 本地 Host 联调需要相邻的 `Sub-Store/backend`。

```bash
corepack pnpm install
corepack pnpm extension:list
```

## 3. 两种扩展

### content

默认脚手架生成 `kind: content`、`containsExecutableCode: false`：

```bash
corepack pnpm extension:create -- \
  --id com.example.my-extension \
  --name "My Extension" \
  --publisher-id com.example \
  --publisher-name "Example"
```

content 包只能携带 UTF-8 数据文件，不能声明 backend/frontend entrypoint 或 install hook。

### executable

需要 Vue 页面或 Node 后端时使用 `kind: executable`。至少明确：

1. Node entrypoint 和 frontend assets；
2. Host API、frontend API 和 implementation ABI；
3. 最小权限与 services 边界；
4. activate/deactivate、失败回滚、卸载和重装；
5. package 文件闭包及兼容性回归。

executable 当前运行在 Host 主进程/主页面上下文，不是沙箱。用户添加来源并安装，是执行该来源代码的显式信任动作。

## 4. `extension.config.json`

content 示例：

```json
{
  "schemaVersion": 1,
  "id": "com.example.my-extension",
  "manifest": "manifest.json",
  "packageDirectory": "packages/com.example.my-extension",
  "signature": {
    "algorithm": "sha256-digest"
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

executable 使用同一个 `sha256-digest` 完整性闭包，并通过 `backend`、`frontend` 和 `artifacts` 声明构建输入。配置生成器可作为参考。

关键规则：

- 目录名、config ID、manifest ID、receipt ID 和 catalog entry ID 必须一致；
- `packageDirectory` 固定为 `packages/<id>`；
- `repository.author` 来自插件作者，不能用 GitHub owner 猜测；
- `package.createdAt` 是 receipt 的稳定时间，同一个 release 重建时保持一致；
- `contentFiles`、`artifacts` 和 entrypoint 必须是安全相对路径；
- install hook 当前禁止；
- schema 中沿用 `signature` 字段名兼容 Host v1，但 `sha256-digest` 只表示完整性，不是发布者签名。

## 5. 日常循环

处理单个插件：

```bash
corepack pnpm typecheck -- --extension org.substore.config-generator
corepack pnpm test -- --extension org.substore.config-generator
corepack pnpm package -- --extension org.substore.config-generator
```

更新整个集合：

```bash
corepack pnpm repository
corepack pnpm verify
```

`repository` 和 `verify` 总是以全集合为准，避免只发布一个插件时意外丢掉其他 entry。

`package` 会：

1. 构建 executable artifacts，或读取 contentFiles；
2. 更新 frontend asset digest；
3. 生成 package projection、receipt、package/payload/file SHA-256；
4. 写入 `packages/<id>`；
5. 复制并验证 `dist/packages/<id>`。

不要手工编辑这些生成物。

## 6. Watch 与 Host 联调

```bash
corepack pnpm dev -- --extension org.substore.config-generator
```

watch 只更新 `build/<id>`，不会替换 Host 已安装代码。

真实来源链路：

```bash
corepack pnpm package
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

`host:start` 默认不设置 `SUB_STORE_EXTENSION_PACKAGE_SEED_PATH`。因此无来源时，不应出现配置生成器。若只为调试 seed 行为，可显式运行：

```bash
SUB_STORE_EXTENSION_PACKAGE_SEED_PATH=packages corepack pnpm host:start
```

本地目录安装同样必须显式执行 `extension:install-local`，不能作为默认发现或自动安装机制。

## 7. 配置生成器边界

配置生成器是 Node-only executable 扩展：

- backend bundle 导出稳定的 activate/deactivate 契约；
- frontend 通过 Host frontend SDK 注册路由、样式和 locale；
- 所有 Surge/QX/Clash/Loon 生成器都随 extension package 发布；
- 脚本 runtime 不内嵌这套实现，也不从远程执行 Node CJS；
- 未安装扩展时，Host 不应注册配置生成器路由或 UI。

## 8. 故障排查

### `Build output differs from the packaged release`

重新运行目标插件的 `package`，不要手工修改摘要。

### `EXTENSION_SOURCE_NOT_FOUND`

Host 没有添加包含该插件的集合源。先添加/刷新来源，再安装。这是预期门禁。

### package digest / payload digest mismatch

catalog、envelope 或目录包不是同一次生成结果。重新运行 `package`、`repository`、`verify` 并完整发布 `repository/`。

### `EXTENSION_ADMIN_AUTH_REQUIRED`

Host 启用了管理令牌。传入 `--token`，或设置 `SUB_STORE_EXTENSION_ADMIN_TOKEN`。
