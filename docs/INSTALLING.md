# 安装、卸载与重装

## 前提

- 真实前后端目录包安装只支持 Node runtime；
- Host backend 版本满足 manifest 的 `>=2.36.31`；
- 当前 package 是 Host 官方 catalog 授权的 `org.substore.config-generator@1.1.0`；
- 如 Host 启用了管理令牌，安装者持有令牌。

查看运行模式：

```bash
curl http://127.0.0.1:3000/api/extensions/runtime
```

常见值：

```text
runtime=node, managementMode=open
runtime=node, managementMode=token
runtime=qx/loon/surge/..., managementMode=read-only
```

`read-only` 表示当前运行平台没有 Node package store 和管理写能力，不代表配置生成器不可用；这些平台使用 Host 内嵌实现。

## 方式一：扩展管理 UI 选择文件夹

在扩展页面选择本地文件夹安装，选中：

```text
package/org.substore.config-generator
```

不要选择仓库根目录、`package/` 父目录或 `build/`。目录根下必须直接存在 `manifest.json`、`receipt.json` 和 extension `package.json`。

Host 会先 inspect，再写入 package store，激活经过验证的 entrypoint。任何额外文件、摘要漂移或不受信签名都会阻止安装。

## 方式二：CLI

默认 Host：

```bash
corepack pnpm install:local
```

指定 Host 与 token：

```bash
corepack pnpm install:local -- \
  --host http://127.0.0.1:3000 \
  --token '<admin-token>'
```

指定另一个已签名目录：

```bash
corepack pnpm install:local -- \
  --package-dir /absolute/path/to/org.substore.config-generator
```

脚本会在发送前本地验证文件列表、SHA-256、package/receipt/payload digest、frontend assets 与 Ed25519 签名。

## 重装并保留数据

```bash
corepack pnpm install:local -- --reinstall
```

流程：

1. inspect 新目录；
2. 如果已安装，卸载 executable code，`purgeData: false`；
3. 安装目录包；
4. 启用扩展。

配置项目和规则集使用 extension-owned storage，重装路径会保留数据。当前 transactional purge 尚未实现，不应依赖“卸载并清空全部数据”。

## 方式三：扩展源

先把 `repository/` 发布到 GitHub Raw 或 HTTPS 静态站点，然后添加：

```text
https://raw.githubusercontent.com/<owner>/<repo>/<tag-or-commit>/repository/catalog.json
```

刷新 source 后，从扩展详情安装。完整说明见 `docs/CATALOG.md`。

本地调试 source：

```bash
corepack pnpm repository:serve
```

添加：

```text
http://127.0.0.1:8765/catalog.json
```

非 loopback 地址必须使用 HTTPS。

## 启动 Host

如果仓库结构为：

```text
GIT/
├── Sub-Store/
├── Sub-Store-Front-End/
└── Sub-Store-Config-Generator/
```

可运行：

```bash
corepack pnpm host:start
```

该命令在 `../Sub-Store/backend` 启动 backend，并设置：

```text
SUB_STORE_EXTENSION_PACKAGE_SEED_PATH=<this-repository>/package
```

可通过 `SUB_STORE_BACKEND_DIR` 改写 backend 路径。

## 安装后验证

检查 installed/detail/health API 或扩展详情页，预期至少包含：

```text
selectedVariant=node
status=enabled
codeStatus=verified-package-active
```

然后访问：

```text
http://localhost:8888/extensions/config-generator
```

建议验证：列表、创建/编辑项目、导入、四个 target preview、下载、禁用后路由守卫、再次启用、保留数据重装。

## 常见错误

### `EXTENSION_LOCAL_PACKAGE_UNSUPPORTED`

当前不是 Node runtime。脚本宿主只能使用 embedded implementation。

### `EXTENSION_ADMIN_AUTH_REQUIRED` / `UNAUTHORIZED`

Host 开启了 token 模式；提供正确 bearer token。

### `EXTENSION_PACKAGE_FILE_DIGEST_MISMATCH`

目录中有未声明文件、缺失文件或文件内容与 metadata 不一致。重新构建并进入签名流程，不要手工改摘要。

### `EXTENSION_SOURCE_OFFICIAL_MIRROR_UNAUTHORIZED`

远程 source 的 manifest 或 package digest 未被当前 Host 官方 catalog 授权。升级 Host 或使用与 Host 同一 release 的 repository。

### `EXTENSION_UPDATE_UNSUPPORTED`

当前版本没有原地 update/rollback。使用保留数据的卸载与重装流程。
