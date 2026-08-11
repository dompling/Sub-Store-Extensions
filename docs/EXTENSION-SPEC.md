# Sub-Store 多扩展与包格式规范

本文定义集合仓库、插件 workspace、目录包和 Extension Host v1 的轻量边界。

## 1. 三个层级

### 集合仓库

```text
repository/catalog.json
```

包含集合 `id`、名称、维护者、`sequence` 和全部插件 entry。集合 publisher 只用于展示来源维护者。

### 插件 workspace

```text
extensions/<extension-id>/extension.config.json
```

目录名和 config ID 必须相同。工具不从 GitHub owner 或文件名推断作者。

### 插件 package

```text
packages/<extension-id>/
```

每个插件独立拥有 manifest、receipt、package metadata、文件与摘要；不能把多个插件混入一个目录包。

## 2. 扩展类型

### `content`

- `containsExecutableCode: false`；
- 没有 backend/frontend executable entrypoint；
- receipt 不声明 executable entrypoint；
- `containsInstallHook: false`。

### `executable`

- 当前只支持 Node package variant；
- variant 显式声明 `containsExecutableCode: true` 和 entrypoint；
- frontend assets 必须位于文件摘要闭包；
- receipt 绑定 implementation ID、ABI、entrypoint 和 frontend asset ID；
- 只能在兼容的 Node Host 安装和执行。

executable 扩展不是沙箱。添加来源并安装，表示用户信任该来源当前提供的代码。

## 3. 信任与完整性

当前仓库采用来源信任模型：

1. 未添加集合源时，插件不可发现，按 ID 安装应返回 source not found；
2. 添加来源是显式信任动作；
3. 点击安装后，Host 才下载 package；
4. SHA-256 检测 catalog、package、payload 和文件是否漂移；
5. Host 继续检查 runtime、API、ABI、入口、路径、未声明文件和 install hook。

`sha256-digest` 不是发布者身份认证，也不能证明 GitHub 帐号或域名的所有权。当前扩展由同一维护方开发，因此不维护每插件私钥或发布者公钥白名单。

如果未来开放给不受信作者，应在那时引入签名、密钥撤销、权限强制、进程/iframe 隔离、资源限额和升级回滚策略；不要把当前 Host 描述成插件安全沙箱。

## 4. 插件 ID、作者与版本

ID 使用反向域名：

```text
com.example.my-extension
org.substore.config-generator
```

ID 用于目录、storage namespace、route/contribution namespace、catalog、receipt 和生命周期记录。发布后不得改变。

作者分层：

- `repository.config.json.publisher`：集合维护者；
- manifest `publisher`：插件作者；
- catalog entry `author`：商店展示作者。

workspace `package.json`、manifest、receipt 和 catalog entry 的版本必须一致。

## 5. Manifest 最小契约

```json
{
  "schemaVersion": 1,
  "id": "com.example.my-extension",
  "kind": "content",
  "name": "My Extension",
  "version": "1.0.0",
  "publisher": {
    "id": "com.example",
    "name": "Example"
  },
  "host": {
    "apiVersion": "1.0.0",
    "backend": ">=2.36.31",
    "runtimes": ["node"]
  },
  "variants": {
    "node": {
      "delivery": "content",
      "implementationId": "com.example.my-extension@1/node",
      "implementationAbi": "content@1",
      "containsExecutableCode": false
    }
  },
  "permissions": [],
  "contributes": {}
}
```

贡献 ID 必须以 `<extension-id>.` 开头。Host/runtime/API/ABI 不兼容时必须拒绝安装或启用，不应静默降级到未验证实现。

## 6. Workspace 配置

`extension.config.json` 常用字段：

| 字段 | 含义 |
| --- | --- |
| `id` | 必须与目录和 manifest 一致 |
| `manifest` | workspace 内 manifest 路径 |
| `packageDirectory` | 固定为 `packages/<id>` |
| `signature.algorithm` | 当前固定 `sha256-digest`；字段名为 Host v1 兼容保留 |
| `package.variant` | 默认 `node` |
| `package.source` | 写入 package metadata 的来源 ID |
| `package.createdAt` | receipt 的稳定时间 |
| `contentFiles` | content 文件映射 |
| `backend` / `frontend` / `artifacts` | executable 构建和包文件映射 |
| `repository.distribution` | `community` 或 `source-executable` |
| `repository.author` | 商店展示作者 |

所有源路径和 package 目标路径必须留在允许目录中，禁止绝对路径、`..`、反斜杠、控制字符、大小写/Unicode 冲突和 metadata 保留文件名。

## 7. 目录包

```text
packages/<id>/
├── manifest.json
├── receipt.json
├── package.json
└── <declared files>
```

package projection：

```text
schemaVersion
+ manifest
+ selectedVariant / variant
+ containsExecutableCode
+ containsInstallHook
+ files
+ fileDigests
```

`packageDigest = SHA-256(canonicalJson(package projection))`。

receipt 绑定：

- extension ID、version、publisher；
- selected variant；
- manifest digest、package digest；
- implementation ID、ABI、frontend asset ID；
- executable entrypoint（仅 executable）；
- installedAt 和 receipt digest。

payload 在 package projection 上增加 `packageDigest` 和 receipt。`payloadDigest` 是 payload 的 SHA-256。

Host v1 envelope 继续使用：

```json
{
  "algorithm": "sha256-digest",
  "digest": "<payload SHA-256>",
  "value": "<same payload SHA-256>"
}
```

这里的 `signature` 字段是兼容名称，不代表非对称签名。

## 8. 文件闭包

Host 和仓库工具必须拒绝：

- 缺失或未声明文件；
- 文件摘要不一致；
- frontend asset digest 不一致；
- entrypoint 不在文件闭包；
- executable flag 与 manifest/receipt 不一致；
- install hook；
- 非普通文件或路径穿越；
- package/payload/receipt 摘要不闭合。

package v1 当前只处理受限 UTF-8 文本，不适合 native module 或任意二进制。

## 9. 集合 entry 与 envelope

catalog entry 至少包含：

```json
{
  "id": "org.substore.config-generator",
  "version": "1.2.0",
  "distribution": "source-executable",
  "packageUrls": {
    "node": "./packages/org.substore.config-generator/1.2.0/node.json"
  },
  "packageDigests": {
    "node": "<package SHA-256>"
  }
}
```

envelope 包含完整 manifest、receipt、payload、package digest 和 SHA-256 integrity 字段。catalog、envelope 和目录包必须来自同一次生成。

## 10. 生命周期与数据

- 安装代码和用户数据分离；
- 停用不删除代码或数据；
- 卸载默认删除代码、保留数据；
- 重装从已添加来源重新下载；
- 显式 purge 才删除插件数据；
- storage schema 变化必须提供兼容读取或迁移。

本地目录安装是显式开发/恢复操作，不是默认 discovery source。

## 11. 当前限制

- Node executable 在 Host 主进程/主前端上下文运行；
- permission scope 尚未形成完整安全隔离；
- install hook 禁止；
- 脚本 runtime 不执行远程 Node bundle；
- 集合签名、防回滚和不受信第三方代码隔离尚未实现。
