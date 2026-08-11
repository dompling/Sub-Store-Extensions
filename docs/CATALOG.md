# 集合订阅源与 GitHub 托管

## 1. 一个仓库，一个集合入口

本仓库发布一个聚合 catalog：

```text
repository/catalog.json
```

它可以包含多个插件。用户添加一次来源，商店即可发现该 catalog 当前列出的插件；插件仍各自拥有 ID、版本、作者和 package。

当前滚动地址：

```text
https://raw.githubusercontent.com/dompling/Sub-Store-Extensions/main/repository/catalog.json
```

正式部署建议使用 tag 或 commit URL，避免同一 URL 的内容无提示变化。

## 2. 目录结构

```text
repository/
├── catalog.json
└── packages/
    └── <extension-id>/<version>/<variant>.json
```

catalog 负责发现，variant envelope 负责交付完整 package payload。

## 3. 生成

```bash
corepack pnpm package
corepack pnpm repository
corepack pnpm verify
```

`repository` 会：

- 扫描全部 `extensions/*/extension.config.json`；
- 验证每个 `packages/<id>`；
- 按 ID 稳定排序；
- 重建全部 envelope；
- 删除 stale envelope；
- 生成一个全集合 catalog。

不能只发布当前插件的局部 catalog，也不要手工编辑生成物。

## 4. Catalog entry

示例：

```json
{
  "id": "org.substore.config-generator",
  "version": "1.2.0",
  "manifest": {},
  "distribution": "source-executable",
  "packageUrl": "./packages/org.substore.config-generator/1.2.0/node.json",
  "packageUrls": {
    "node": "./packages/org.substore.config-generator/1.2.0/node.json"
  },
  "packageDigest": "<sha256>",
  "packageDigests": {
    "node": "<sha256>"
  },
  "source": "org.substore.extensions",
  "author": {
    "id": "org.substore",
    "name": "Sub-Store"
  }
}
```

`distribution` 表示交付类别：

- `community`：content-only；
- `source-executable`：由用户已信任的来源交付 Node executable package。

它不是发布者身份证明。

## 5. 来源就是显式信任边界

当前轻量模型下：

- 添加来源前，Host 不应暴露该来源中的插件；
- 添加来源后，Host 才缓存 catalog entry；
- 用户点击安装后，Host 才下载 package；
- 删除来源后，已安装记录可保留，但该来源不再提供新的发现、安装或更新；
- SHA-256 只保证 catalog 声明和下载内容一致，不认证作者身份。

因此来源 UI 应清楚展示 URL、来源名称、集合 publisher 和每个 entry 的 author。用户不认识的来源不应添加。

## 6. 本地来源

```bash
corepack pnpm repository:serve
```

默认地址：

```text
http://127.0.0.1:8765/catalog.json
```

然后显式添加：

```bash
corepack pnpm source:add -- \
  --url http://127.0.0.1:8765/catalog.json \
  --name "Sub-Store Extensions (Local)"
```

HTTP 只用于 loopback 开发。外部来源应使用 HTTPS。

`corepack pnpm host:start` 默认不注入 `packages/` seed；本地 package 不能在未添加来源时自动出现在商店。需要测试 seed 时必须显式设置 `SUB_STORE_EXTENSION_PACKAGE_SEED_PATH`。

## 7. GitHub 发布

GitHub Actions 的 `Publish extension` workflow 会根据当前 catalog 版本自动计算 patch、minor 或 major 版本，生成 build、dist、package、全集合 catalog 和 artifact，并创建 release PR。它不需要私钥或 Environment Secret。

发布 PR 应包含：

- 目标插件源码与版本；
- `packages/<id>`；
- 完整 `repository/catalog.json`；
- 完整 `repository/packages/`；
- 必要测试和文档。

`build/` 和 `dist/` 是 runner 中的临时、可下载 artifact，不进入 Git；`packages/` 和 `repository/` 是 GitHub Raw 集合源的一部分，必须进入 release PR。

合并后再用真实 GitHub Raw URL 做 source add / refresh / install 回归。

## 8. Host 校验

集合阶段：

- schema、entry 数量和大小上限；
- source/package URL、协议、重定向和网络边界；
- manifest ID、kind、variant；
- immutable package digest。

下载阶段：

- catalog entry 与 envelope manifest 相同；
- package、payload、receipt 和文件摘要闭合；
- frontend asset、entrypoint 与 executable flag 一致；
- 路径安全且没有未声明文件；
- install hook 禁止；
- runtime、Host API、backend version 和 ABI 兼容。

添加来源成功不代表所有插件都一定兼容当前 Host。

## 9. 常见错误

### 未添加来源也能看到插件

检查 Host 启动环境是否设置了 `SUB_STORE_EXTENSION_PACKAGE_SEED_PATH`，以及 Host 是否残留 legacy adoption 数据。正常启动默认不得 seed 本仓库 package。

### `EXTENSION_SOURCE_NOT_FOUND`

目标插件不在任何已添加并刷新成功的来源中。先添加/刷新集合源。

### digest mismatch

catalog、envelope 和 package 不属于同一次生成。重新运行 `package`、`repository`、`verify`，并完整发布相关目录。

### catalog 少插件

确认每个 workspace 都有 `extension.config.json`，再重新生成全集合。
