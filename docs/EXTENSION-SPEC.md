# Sub-Store 多扩展仓库与包格式规范

本文同时定义仓库级集合订阅源、插件 workspace、目录包和当前 Extension Host v1 的信任边界。

## 1. 三个层级

### 仓库

一个 Git 仓库可以包含多个插件，并通过一个 catalog 发布：

```text
repository/catalog.json
```

仓库级字段包括：

- `id`：集合源 ID；
- `name`、`description`：商店显示名称；
- `publisher`：集合源维护者；
- `sequence`：集合版本序号；
- `entries`：仓库内全部插件。

仓库 publisher 不是所有插件的作者，也不是任意可执行代码的信任证明。

### 插件 workspace

每个插件必须有唯一目录：

```text
extensions/<extension-id>/extension.config.json
```

目录名和配置中的 `id` 必须相同。根工具扫描这些配置，不从文件名或 GitHub owner 猜插件身份。

### 插件 package

每个插件必须有独立安装包：

```text
packages/<extension-id>/
```

包内的 manifest、receipt、package metadata、文件摘要和签名只属于该插件。多个插件不能共享一个 package key 或一个混合目录。

## 2. 扩展类型

### `trusted-official` executable extension

适用于需要动态前端或后端代码的官方插件：

- Node Host 加载 `backend/index.cjs`；
- 主前端加载 Vue IIFE 与 CSS；
- 注册路由、artifact source、导航或 Host services；
- 脚本 runtime 使用 Host 内嵌实现。

这类扩展必须同时满足：

1. Host allowlist 接受插件 ID 和 publisher；
2. Host 官方 catalog 授权精确 manifest digest；
3. Host 官方 catalog 授权精确 package digest；
4. package Ed25519 签名有效；
5. receipt、variant、ABI、entrypoint 和所有文件摘要闭合；
6. 当前 Host/runtime 兼容。

外部 GitHub 仓库只负责传输；`trusted-official-mirror` 不会成为第二个任意执行信任根。

### `content` extension

适用于数据、模板、元信息或其他不执行代码的第三方插件：

- `kind: content`；
- `containsExecutableCode: false`；
- 没有 backend/frontend entrypoint；
- receipt 不包含 executable entrypoint；
- `containsInstallHook: false`。

content 包可使用 `sha256-digest` 保证下载内容没有漂移。它是完整性校验，不是密码学发布者身份认证。

当前 Host 不支持任意第三方动态 Vue/Node 插件。未来若开放，应先实现 scoped publisher key、权限执行、隔离运行时、资源限额、撤销和升级策略。

## 3. 插件 ID 与作者

建议使用反向域名：

```text
com.example.my-extension
org.substore.config-generator
```

插件 ID 会用于：

- workspace 和 package 目录；
- storage namespace；
- route、surface 和 contribution namespace；
- catalog entry；
- receipt 与摘要闭包；
- 安装、启停、引用和卸载记录。

发布后不要改变 ID。manifest、receipt、package metadata、目录名和 catalog entry 中的 ID 必须一致。

作者分三层记录：

- `repository.config.json.publisher`：集合仓库维护者；
- manifest `publisher`：插件发布身份；
- `extension.config.json.repository.author`：商店展示作者。

三者可以相同，也可以不同，但必须显式声明，不从 URL 推断。

## 4. Manifest v1

content 扩展最小示例：

```json
{
  "schemaVersion": 1,
  "id": "com.example.my-extension",
  "kind": "content",
  "distribution": "store",
  "name": "My Extension",
  "description": "Example content extension",
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
  "contributes": {},
  "scriptExecutionLanes": {}
}
```

Host 会规范化 manifest。为了让 catalog manifest 与 package payload 逐字节一致，仓库中的源 manifest 应显式包含 `distribution`、空权限、空 contributions 和空 execution lanes，而不是依赖安装时补默认值。

### Permissions

Host 只接受已知权限。配置生成器当前使用：

- `storage.own`；
- `resources.read`；
- `network.fetch`；
- `artifact.produce`；
- `artifact-source.register`；
- `routes.namespaced`；
- `navigation.register`。

权限声明是准入契约，不等于获得全局对象。插件只能通过版本化 SDK 使用 Host 实际暴露的能力。

当前 scope 的细粒度执行仍不完整：例如 `resources.read` 与 `network.fetch` 主要按权限名准入。不要在第三方可执行插件开放前把这些声明描述成安全沙箱。

### Contributions

route、navigation、page action、command、setting、archive type 和 feature ID 必须以：

```text
<extension-id>.
```

开头，避免不同插件冲突。

## 5. Runtime variants

manifest 可以为 Node、Quantumult X、Loon、Surge、Stash、Shadowrocket 和 Egern 声明不同 variant。

- `node`：trusted-official 包可包含受验证的 executable entrypoint；content 包只能包含数据文件。
- `qx`、`loon`、`surge`：通常使用 `embedded-receipt`，实现随 Host 构建交付。
- `default-script-runtime`：没有专用 variant 时的脚本环境回退。

不要向脚本 runtime 交付 Node CJS。脚本宿主没有相同的 package store、模块加载、文件系统和生命周期能力。

## 6. `extension.config.json`

该文件只服务于仓库工具，不直接发送给 Host。常用字段：

| 字段 | 含义 |
| --- | --- |
| `id` | 插件唯一 ID，必须等于目录名 |
| `manifest` | workspace 内源 manifest 路径 |
| `packageDirectory` | 必须是 `packages/<id>` |
| `signature` | 该插件独立的签名算法、公钥或 key ID |
| `backend` | 可选，Node bundle 源根、入口和输出 |
| `frontend` | 可选，Vite、tsconfig 和输出清单 |
| `artifacts` | 构建产物到 package 文件的映射 |
| `contentFiles` | content 源文件到 package 文件的映射 |
| `package` | content 包 variant、稳定时间和来源标记 |
| `repository` | distribution 与插件作者 |

可执行插件示例见：

```text
extensions/org.substore.config-generator/extension.config.json
```

## 7. 目录包 v1

一个安装包目录为：

```text
<extension-id>/
├── manifest.json
├── receipt.json
├── package.json
└── <declared payload files>
```

配置生成器包含：

```text
backend/index.cjs
frontend/index.js
frontend/style.css
```

content 扩展可以包含：

```text
content/extension.json
content/templates.json
```

浏览器目录上传协议：

```text
Content-Type: application/vnd.substore.extension-directory+json
```

```json
{
  "schemaVersion": 1,
  "format": "substore-extension-directory-v1",
  "rootName": "com.example.my-extension",
  "files": {
    "manifest.json": "{...}",
    "receipt.json": "{...}",
    "package.json": "{...}",
    "content/extension.json": "{...}"
  }
}
```

v1 只支持 UTF-8 文本。禁止绝对路径、`..`、反斜杠、控制字符、大小写或 Unicode 归一化冲突、符号链接和未声明文件。

## 8. Package digest

`package.json` 是 Sub-Store package metadata，不是 npm package manifest。package digest 对以下 projection 的 canonical JSON 做 SHA-256：

```text
schemaVersion
manifest
selectedVariant
variant
containsExecutableCode
containsInstallHook
files
fileDigests
```

然后 receipt 绑定 package digest。最终 signed payload 为：

```text
projection
+ packageDigest
+ receipt
```

因此修改 manifest、receipt、文件、variant、flag 或文件列表都会改变 payload digest。不能通过只更新一个 SHA 字段得到有效包。

### Ed25519

用于 Host 明确授权的 executable package。私钥不能提交到本仓库；这里只保存对应公钥和签名结果。推荐每个可执行插件使用独立、可撤销、作用域明确的发布密钥。

### `sha256-digest`

用于 community content package 的完整性闭包。`value` 等于 payload digest。它不会证明某个 GitHub 用户或域名持有私钥，也不能授权执行代码。

## 9. Receipt

receipt 将包绑定到运行实现，包含：

- extension ID、version 与 publisher；
- selected variant；
- manifest/package digest；
- implementation ID、ABI、frontend asset ID；
- executable entrypoint（仅 executable package）；
- execution lanes；
- 稳定的 package 时间；
- receipt digest。

Host 会重新计算 receipt，不信任上传值。community receipt 不得声明 executable entrypoint。

## 10. 仓库 catalog

每个 entry 至少包含：

```json
{
  "id": "com.example.my-extension",
  "version": "1.0.0",
  "manifest": {},
  "distribution": "community",
  "packageUrls": {
    "node": "./packages/com.example.my-extension/1.0.0/node.json"
  },
  "packageDigests": {
    "node": "<sha256>"
  },
  "source": "org.substore.extensions",
  "sourceName": "Sub-Store Extensions",
  "author": {
    "id": "com.example",
    "name": "Example"
  }
}
```

根工具会：

- 扫描全部 `extensions/*/extension.config.json`；
- 拒绝重复插件 ID；
- 按 ID 稳定排序；
- 为每个插件生成独立 envelope；
- 清理已删除插件的 stale envelope；
- 生成一个包含全部 entry 的 `catalog.json`；
- 校验 catalog entry 数量等于 workspace 数量。

## 11. 生命周期

当前 Host 支持：

- 添加、刷新和删除集合源；
- 从 source 安装官方镜像或 content 包；
- 本地目录 inspect/install；
- enable、disable；
- uninstall code 并默认保留数据；
- 重装后恢复保留数据；
- health 与 package integrity 检查。

当前原生 `update`、`rollback` 和 transactional data purge API 尚未实现，会返回 `501`。升级流程应明确使用：

```text
卸载代码并保留数据
→ 刷新集合源
→ 从同一 source 安装新版本
→ 启用
→ 健康检查
```

## 12. 创建插件检查表

1. 选择 content-only 或申请 executable trust；
2. 分配稳定且非保留的 ID；
3. 创建独立 `extensions/<id>`；
4. 创建独立 `packages/<id>`；
5. 显式声明 publisher 和 author；
6. 定义最小权限、contributions 和 runtime variants；
7. 为该插件单独生成摘要或签名；
8. 增加插件级测试；
9. 运行仓库级双插件 catalog 回归；
10. 通过集合源完成安装、启停、卸载和重装验证。
