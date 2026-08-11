# 集合源安装、卸载与重装

## 1. 正常安装路径

用户添加的是仓库级 catalog：

```text
https://raw.githubusercontent.com/dompling/Sub-Store-Extensions/main/repository/catalog.json
```

正式 release 建议改为固定 tag 或 commit。

```text
添加 collection catalog
→ Host 校验并保存 source
→ 商店展示 catalog entries
→ 用户选择插件并点击安装
→ Host 下载该插件 envelope
→ 校验 manifest/package/receipt/SHA-256/ABI/entrypoint
→ 安装并显式启用
```

没有添加来源时，配置生成器不应出现在商店中，按 ID 安装应返回 `404 EXTENSION_SOURCE_NOT_FOUND`。

## 2. 本地集合源回归

```bash
corepack pnpm package
corepack pnpm repository
corepack pnpm repository:serve
```

默认 catalog：

```text
http://127.0.0.1:8765/catalog.json
```

另一个终端：

```bash
corepack pnpm host:start
corepack pnpm source:add -- \
  --url http://127.0.0.1:8765/catalog.json \
  --name "Sub-Store Extensions (Local)"
corepack pnpm extension:install -- \
  --extension org.substore.config-generator
```

内容更新后：

```bash
corepack pnpm source:refresh -- \
  --url http://127.0.0.1:8765/catalog.json
```

`host:start` 默认不注入本仓库 `packages/`。若无来源也能发现插件，检查是否显式设置过：

```text
SUB_STORE_EXTENSION_PACKAGE_SEED_PATH
```

该变量只用于开发 seed 回归，不是正常安装路径。

## 3. 远程 GitHub 来源

使用 `repository.config.json` 默认 URL：

```bash
corepack pnpm source:add
```

或覆盖为 fork/tag/commit：

```bash
corepack pnpm source:add -- \
  --url https://raw.githubusercontent.com/<owner>/<repo>/<tag-or-commit>/repository/catalog.json \
  --name "Sub-Store Extensions"
```

外部来源必须 HTTPS；HTTP 只用于 loopback。URL 不得携带 credentials。

## 4. 商店 UI

扩展页面中：

1. 添加订阅源；
2. 输入 `repository/catalog.json` URL；
3. 等待 source ready；
4. 查看来源提供的插件；
5. 进入详情并安装。

UI 应分别展示集合来源 URL/publisher 和插件 author/version/distribution。添加来源是显式信任动作；SHA-256 只保证下载内容与 catalog 一致，不认证作者身份。

## 5. 重装并保留数据

```bash
corepack pnpm source:refresh
corepack pnpm extension:install -- \
  --extension org.substore.config-generator \
  --reinstall
```

`--reinstall` 先卸载代码并保留数据，再从同一来源安装和启用。配置生成器的项目和规则集应继续可读。

安装后至少核对：

```text
sourceId/sourceName 指向集合源
installationStatus = installed
enabled = true
compatibilityStatus = compatible
health.status = healthy
packageIntegrity.status = verified
```

## 6. 本地目录安装

只用于显式开发、离线或恢复：

```bash
corepack pnpm extension:install-local -- \
  --extension org.substore.config-generator \
  --reinstall
```

选择完整目录：

```text
packages/org.substore.config-generator/
├── manifest.json
├── receipt.json
├── package.json
├── backend/index.cjs
├── frontend/index.js
└── frontend/style.css
```

Host 仍会检查：

- 根目录、extension ID 和安全相对路径；
- manifest/receipt/package 闭包；
- package、payload 和每个文件 SHA-256；
- frontend assets、variant、ABI、entrypoint；
- executable/install-hook flag；
- 未声明文件和 Host 兼容性。

目录安装不会成为默认 discovery source，也不会从用户原始绝对路径直接运行代码。

## 7. Runtime

配置生成器 package 当前只支持 Node Host。它可以生成 Surge、Quantumult X、Clash 和 Loon 配置，但这不表示相应脚本 runtime 能动态执行它的 Node bundle。

非 Node runtime 应拒绝该 executable variant，而不是使用 Host 内嵌的配置生成器副本。

## 8. 常见错误

### `EXTENSION_SOURCE_NOT_FOUND`

没有已添加并刷新成功的来源包含目标插件。先添加来源。

### `EXTENSION_SOURCE_PACKAGE_MISMATCH`

catalog 与 envelope/package digest 不一致。重新生成并完整发布 `repository/`。

### `EXTENSION_ADMIN_AUTH_REQUIRED` / `UNAUTHORIZED`

传入正确 token。对外部署不应使用开放管理模式。

### `EXTENSION_LOCAL_PACKAGE_UNSUPPORTED`

当前 runtime 不支持目录包安装。使用 Node Host。

### `EXTENSION_UPDATE_UNSUPPORTED`

若目标 Host 尚无原生 update，使用“刷新 source → 卸载保留数据 → 安装 → 启用 → 健康检查”。
