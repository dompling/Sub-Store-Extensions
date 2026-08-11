# 集合订阅源、作者与 GitHub 托管

## 1. 一个仓库只有一个正常订阅入口

本仓库采用 collection catalog：

```text
repository/catalog.json
```

用户不需要分别订阅：

```text
extensions/plugin-a/catalog.json
extensions/plugin-b/catalog.json
```

正确模型是：

```text
一个 Git 仓库
→ 一个 repository/catalog.json
→ 多个 catalog entries
→ 每个 entry 指向自己的 package envelope
```

这让用户只管理一次来源，同时保证插件包、作者、版本和签名彼此独立。

## 2. 静态目录

```text
repository/
├── catalog.json
└── packages/
    ├── org.substore.config-generator/
    │   └── 1.1.0/
    │       └── node.json
    └── com.example.my-extension/
        └── 1.0.0/
            └── node.json
```

生成：

```bash
corepack pnpm package
corepack pnpm repository
corepack pnpm verify
```

`repository` 会扫描全部插件 workspace，不接受“只发布当前插件”的局部 catalog。它会删除旧的 `repository/packages/` 后重新写入当前集合，避免已经删除插件的 envelope 残留。

## 3. 顶层 catalog

示意：

```json
{
  "schemaVersion": 1,
  "id": "org.substore.extensions",
  "name": "Sub-Store Extensions",
  "description": "Sub-Store 扩展集合订阅源",
  "sequence": 1,
  "generatedAt": "2026-08-10T00:00:00.000Z",
  "publisher": {
    "id": "org.substore",
    "name": "Sub-Store"
  },
  "entries": []
}
```

字段含义：

- `id`：来源稳定 ID；
- `name`：扩展页面显示的集合源名称；
- `description`：集合说明；
- `sequence`：发布方显式递增的集合序号；
- `generatedAt`：集合内最新 package 稳定时间；
- `publisher`：仓库维护者；
- `entries`：该仓库全部可发现插件。

当前 `sequence` 和 `generatedAt` 用于解析、展示和审计，但尚不是完整 TUF/防回滚体系。不要把它们描述成已实现的供应链时间证明。

## 4. Catalog entry

每个插件 entry 独立：

```json
{
  "id": "org.substore.config-generator",
  "version": "1.1.0",
  "manifest": {},
  "distribution": "trusted-official-mirror",
  "packageUrl": "./packages/org.substore.config-generator/1.1.0/node.json",
  "packageUrls": {
    "node": "./packages/org.substore.config-generator/1.1.0/node.json"
  },
  "packageDigest": "c9dced66...",
  "packageDigests": {
    "node": "c9dced66..."
  },
  "source": "org.substore.extensions",
  "sourceName": "Sub-Store Extensions",
  "author": {
    "id": "org.substore",
    "name": "Sub-Store"
  }
}
```

`packageUrl` 可以相对 catalog URL。Host 会按最终 catalog URL 解析为绝对地址。

每个 package digest 必须是该 envelope 对应 package projection 的不可变 SHA-256。catalog、envelope 或实际 payload 任意一处不一致都会拒绝安装。

## 5. 作者、发布者与来源

三个概念必须分开：

| 字段 | 表示 |
| --- | --- |
| catalog `publisher` | 谁维护这个集合仓库 |
| manifest `publisher` | 谁发布这个插件身份 |
| entry `author` | 商店向用户展示的插件作者 |
| entry `source/sourceName` | 插件从哪个集合源被发现 |

Host 不应该根据 GitHub owner、域名、URL 路径或顶层 publisher 自动推断插件作者。第三方仓库可以收录多个不同作者的插件。

来源 publisher 也不等于可执行代码信任：

- community content 包依靠 immutable digest 保证完整性；
- trusted-official mirror 仍依赖 Host 内置官方授权和 Ed25519 签名；
- 未来第三方 executable publisher 需要 scoped key/certificate，而不是复用 catalog publisher 字段。

## 6. GitHub Raw

正式 URL：

当前仓库滚动地址：

```text
https://raw.githubusercontent.com/dompling/Sub-Store-Extensions/main/repository/catalog.json
```

不可变 release 地址：

```text
https://raw.githubusercontent.com/dompling/Sub-Store-Extensions/<tag-or-commit>/repository/catalog.json
```

推荐：

- 对外版本使用 immutable tag 或 commit；
- release 前确认 catalog 与所有相对 package URL 都实际存在；
- GitHub Actions 只上传公开构建物，私钥来自受保护 secret provider；
- 不把私钥、管理 token 或 `.env` 提交到仓库；
- 不只提交 catalog 而漏掉 `repository/packages/`。

分支 URL 适合开发订阅，但可能随 force-push 或后续提交变化，不应被当作不可变 release。

## 7. 本地服务

```bash
corepack pnpm repository:serve
```

默认：

```text
http://127.0.0.1:8765/catalog.json
```

然后：

```bash
corepack pnpm source:add -- \
  --url http://127.0.0.1:8765/catalog.json \
  --name "Sub-Store Extensions (Local)"
corepack pnpm extension:install -- \
  --extension org.substore.config-generator \
  --reinstall
```

HTTP 仅允许 loopback 本地来源。远程来源必须 HTTPS，并且不能从公网重定向进入 loopback/private network。

## 8. Host 校验

### 集合源

Host 会检查：

- schema 与 entry 数量上限；
- source URL、重定向、协议和网络边界；
- manifest 是否可规范化；
- ID、kind、variant 与 package URL；
- immutable package digest；
- trusted-official mirror 是否得到本机官方 catalog 授权。

### 下载插件

Host 会继续检查：

- catalog entry 与 envelope manifest 相同；
- package digest、payload digest 和 receipt 闭合；
- 每个文件摘要；
- executable/install-hook flag；
- signature algorithm 与 trusted key；
- runtime、Host API、backend version 和 implementation ABI；
- community 包确实 content-only。

添加集合源成功不代表其中每个插件都一定能安装；具体插件仍需通过自己的兼容性和信任门禁。

## 9. 当前限制

- catalog 最大约 4 MiB；
- 最多约 128 个 entry；
- 最多 3 次重定向；
- 外部来源只允许 HTTPS；
- loopback 开发来源可使用 HTTP；
- URL 禁止 credentials；
- 原生自动更新、rollback 和 data purge 尚未实现；
- community executable code 尚未开放。

具体数值由 Host 版本控制；发布文档应以目标 Host 的实际常量为准。
