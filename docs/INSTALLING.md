# 集合源安装、卸载与重装

## 1. 推荐方式：添加一次仓库集合源

用户安装的是仓库级订阅源，不是某个插件专用 catalog。远程地址应为：

当前仓库默认地址：

```text
https://raw.githubusercontent.com/dompling/Sub-Store-Extensions/main/repository/catalog.json
```

正式 release 推荐把 `main` 换成不可变 tag 或 commit。

添加后，扩展商店展示 catalog 的全部 entry。用户选择其中一个插件时，Host 再读取：

```text
repository/packages/<extension-id>/<version>/<variant>.json
```

完整流程：

```text
添加一次 collection catalog
→ Host 校验并保存 source
→ 商店展示仓库内全部插件
→ 用户选择插件 ID
→ Host 下载该插件独立 envelope
→ 校验 manifest/package/receipt/signature
→ 安装为 disabled 或由管理流程显式启用
```

## 2. 本地集合源回归

在本仓库启动静态服务：

```bash
corepack pnpm repository
corepack pnpm repository:serve
```

默认 catalog：

```text
http://127.0.0.1:8765/catalog.json
```

另一个终端启动 Sub-Store Node Host：

```bash
corepack pnpm host:start
```

添加集合源：

```bash
corepack pnpm source:add -- \
  --url http://127.0.0.1:8765/catalog.json \
  --name "Sub-Store Extensions (Local)"
```

输出应包含集合源名称、URL 和发现的插件数量，例如：

```text
Added collection source Sub-Store Extensions
http://127.0.0.1:8765/catalog.json
1 extensions
```

以后内容变化只需刷新：

```bash
corepack pnpm source:refresh -- \
  --url http://127.0.0.1:8765/catalog.json
```

## 3. 从集合源安装插件

```bash
corepack pnpm extension:install -- \
  --extension org.substore.config-generator
```

CLI 会：

1. 确认仓库中只有一个选中的插件；
2. 调用 Host 的 source install API；
3. 从 catalog entry 的 package URL 获取 envelope；
4. 安装完成后显式 enable；
5. 报告实际安装版本。

如果配置了管理令牌：

```bash
corepack pnpm extension:install -- \
  --extension org.substore.config-generator \
  --host http://127.0.0.1:3000 \
  --token '<admin-token>'
```

也可设置：

```text
SUB_STORE_HOST_URL
SUB_STORE_EXTENSION_ADMIN_TOKEN
```

不要把真实 token 提交到 `.env.example` 或 Git。

## 4. 远程 GitHub 集合源

添加固定 tag 或 commit：

本仓库已经把远程 collection URL 写入 `repository.config.json`，因此正常安装只需：

```bash
corepack pnpm source:add
```

其他 fork 或固定 release 可以覆盖：

```bash
corepack pnpm source:add -- \
  --url https://raw.githubusercontent.com/<owner>/<repo>/<tag-or-commit>/repository/catalog.json \
  --name "Sub-Store Extensions"
```

也可设置：

```text
SUB_STORE_EXTENSION_SOURCE_URL
```

推荐固定 tag/commit，而不是长期使用可变分支。GitHub blob 页面 URL 会增加不必要的重定向和 HTML 风险，优先直接使用 `raw.githubusercontent.com`。

远程来源必须 HTTPS；HTTP 只允许显式 loopback 本地开发来源。URL 不得携带用户名或密码。

## 5. 商店 UI

在扩展页面的“添加扩展”入口添加订阅源：

1. 选择“订阅源”；
2. 输入仓库的 `repository/catalog.json` URL；
3. 保存后等待 source 状态变为 ready；
4. 返回扩展商店查看该仓库的所有插件；
5. 进入插件详情并安装。

商店应分别显示：

- 集合源名称与 publisher；
- 插件自己的 author/publisher；
- 插件版本与 distribution；
- 安装、启用、完整性和兼容性状态。

不要把仓库 owner 自动显示成每个插件作者。

## 6. 重装并保留数据

当前 Host 没有原生 update/rollback API。推荐的升级与重新安装流程是：

```bash
corepack pnpm source:refresh

corepack pnpm extension:install -- \
  --extension org.substore.config-generator \
  --reinstall
```

`--reinstall` 会先卸载代码并传入：

```json
{ "purgeData": false }
```

因此插件代码目录会删除，但用户配置数据默认保留；随后从集合源重新安装并启用。配置生成器应能继续读取原项目和规则集。

安装后至少核对：

```text
sourceId/sourceName 指向集合源
installationStatus = installed
enabled = true
codeStatus = verified-package-active 或 embedded-active
compatibilityStatus = compatible
health.status = healthy
packageIntegrity.status = verified（有目录包时）
```

## 7. 本地文件夹安装：开发与恢复回退

如果集合源不可用，Node Host 可以安装一个完整目录包：

```bash
corepack pnpm extension:install-local -- \
  --extension org.substore.config-generator \
  --reinstall
```

配置生成器目录：

```text
packages/org.substore.config-generator/
├── manifest.json
├── receipt.json
├── package.json
├── backend/index.cjs
├── frontend/index.js
└── frontend/style.css
```

UI 中应选择最外层的 `org.substore.config-generator` 文件夹，不是单个 JSON 或 JS 文件。

目录上传会把 UTF-8 文件投影发送给后端；后端仍会重新校验：

- 根目录与 extension ID；
- 安全相对路径；
- manifest/receipt/package 闭包；
- package 和 payload digest；
- Ed25519 或允许的 content digest；
- 每个文件摘要；
- variant、ABI、entrypoint 和 Host 兼容性；
- 未声明文件和 install hook。

文件夹安装不会绕过信任模型，也不会把本机绝对路径交给服务器执行。

## 8. 不同 runtime

### Node

- 正常方式：集合源 package envelope；
- 回退方式：本地目录包；
- trusted-official 插件可运行已验证的 backend/frontend bundle。

### Quantumult X、Loon、Surge 等脚本 Host

- 安装 manifest/receipt/state；
- 运行当前 Sub-Store 构建内嵌的 implementation；
- 不从 GitHub catalog 下载并执行 Node CJS 或任意第三方 Vue bundle；
- 当前构建没有匹配 implementation ABI 时，应提示升级 Host。

## 9. 常见错误

### `EXTENSION_SOURCE_OFFICIAL_MIRROR_UNAUTHORIZED`

远程 trusted-official entry 与 Host 内置授权的 ID、publisher、manifest digest 或 package digest 不一致。使用与当前 Host 对应的 release，不要手工改 catalog。

### `EXTENSION_COMMUNITY_EXECUTION_FORBIDDEN`

community entry 包含 executable code、entrypoint 或 install hook。community 源只能安装 content 扩展。

### `EXTENSION_SOURCE_PACKAGE_MISMATCH`

catalog 声明的 digest 与下载 envelope 重新计算结果不同。重新生成并完整提交 `repository/`，不要只替换其中一个文件。

### `EXTENSION_ADMIN_AUTH_REQUIRED` / `UNAUTHORIZED`

Host 启用了管理令牌。传入正确 token。对外部署不应退回 open 管理模式。

### `EXTENSION_LOCAL_PACKAGE_UNSUPPORTED`

当前 runtime 不支持目录包安装。使用 Node Host，或在脚本 runtime 中使用 Host 内嵌实现。

### `EXTENSION_UPDATE_UNSUPPORTED`

原生 update 尚未实现。使用“刷新 source → 卸载保留数据 → 安装 → 启用 → 健康检查”。
