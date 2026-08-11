# Sub-Store 扩展开发与包格式规范

本文描述当前 Extension Host v1 的实际能力。它既是配置生成器仓库的契约说明，也是开发新扩展时的起点。

## 1. 先选择扩展类型

### trusted-official executable extension

适用于需要以下能力的扩展：

- 在 Node Host 中加载后端 JavaScript entrypoint；
- 在 Sub-Store 主前端中加载 Vue bundle 与 CSS；
- 注册后端路由、artifact source、导航或深度 Host services；
- 在脚本 runtime 中由 Host 内嵌实现提供功能。

这类扩展必须经过 Host 代码级授权：固定 ID、publisher allowlist、官方 catalog package digest 和受信 Ed25519 key。独立 Git 仓库只改变源码与传输位置，不改变信任归属。

### community content extension

适用于数据、模板、元信息或其他不需要执行代码的扩展。它可以来自第三方 catalog，但必须满足 content-only contract：

- `containsExecutableCode: false`；
- 不包含前后端 entrypoint；
- receipt 不声明 executable implementation；
- `containsInstallHook: false`；
- 不使用官方保留 ID 或 publisher 身份。

当前 Host 不支持任意第三方动态前端/后端 JavaScript。要实现这类能力，未来需要真正的隔离运行时、权限执行层、资源限额和安全审核，而不是简单增加一个“信任所有代码”的开关。

## 2. 扩展身份

建议使用反向域名 ID：

```text
com.example.my-extension
org.substore.config-generator
```

ID 一经发布应保持稳定。它会用于：

- storage namespace；
- route/surface namespace；
- package directory；
- catalog entry；
- receipt 和签名 payload；
- 安装记录、引用图和卸载生命周期。

manifest、receipt、package metadata、URL 路由和目录根名中的 ID 必须一致。

## 3. Manifest

最低层级示意：

```json
{
  "schemaVersion": 1,
  "id": "com.example.my-extension",
  "kind": "community",
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

`trusted-official` 还必须声明与 Host allowlist 一致的 trust、verified publisher、implementation ABI、entrypoint 和 frontend assets。不要复制配置生成器的官方身份来创建第三方扩展；Host 会拒绝保留 ID 和未授权 publisher。

### Permissions

Host 只接受已知权限。配置生成器当前使用：

- `storage.own`；
- `resources.read`；
- `network.fetch`；
- `artifact.produce`；
- `artifact-source.register`；
- `routes.namespaced`；
- `navigation.register`。

权限声明只是准入契约，不应被当作绕过 SDK 边界的全局能力。扩展只能通过 Host services 使用实际能力。

### Contributions

可声明 feature、route、artifact source、navigation 和 page action。贡献 ID 应使用扩展命名空间，避免不同来源冲突。

## 4. Runtime variants

Sub-Store 可能运行在 Node、Quantumult X、Loon、Surge、Stash、Shadowrocket 或 Egern 中。manifest 可以为不同 runtime 声明 variant：

- `node`：允许 trusted-official package 包含受验证的 executable entrypoint；
- `qx`、`loon`、`surge` 等：通常是 `embedded-receipt`，代码由 Host 构建携带；
- `default-script-runtime`：脚本环境没有专用 variant 时的回退。

不要把 Node CJS bundle 塞给脚本 runtime。脚本宿主没有 Node package loader、磁盘 package store 或同等的进程隔离能力。

## 5. 目录包 v1

浏览器本地文件夹安装和 CLI 安装使用：

```text
Content-Type: application/vnd.substore.extension-directory+json
```

传输对象：

```json
{
  "schemaVersion": 1,
  "format": "substore-extension-directory-v1",
  "rootName": "org.substore.config-generator",
  "files": {
    "manifest.json": "{...}",
    "receipt.json": "{...}",
    "package.json": "{...}",
    "backend/index.cjs": "...",
    "frontend/index.js": "...",
    "frontend/style.css": "..."
  }
}
```

目录本身应为：

```text
<extension-id>/
├── manifest.json
├── receipt.json
├── package.json
├── backend/
│   └── index.cjs
└── frontend/
    ├── index.js
    └── style.css
```

v1 只接受 UTF-8 文本文件。路径必须是安全相对路径，禁止绝对路径、反斜杠、`..`、控制字符、大小写/Unicode 冲突和符号链接。当前 Host 对文件数、单文件和总包大小也有上限；不要依赖目录上传传输大型二进制资产，前端小图标应在构建时内联。

## 6. Package metadata 与摘要闭包

`package.json` 不是 npm package manifest，而是 Sub-Store extension package metadata。它声明：

- selected variant；
- variant contract；
- executable/install-hook flags；
- 每个 payload 文件的 SHA-256；
- package digest；
- signed payload digest；
- signature algorithm、key ID 与签名值。

Package digest 对以下 projection 做 canonical JSON 后计算 SHA-256：

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

Signed payload 在 projection 之外还包含：

```text
packageDigest
receipt
```

因此修改 manifest、receipt、文件内容、文件列表、variant 或 flag 都会改变最终签名 payload。仅更新一个 SHA 字段不能得到有效包。

## 7. Receipt

Receipt 将 package 与具体 runtime implementation 绑定，至少包含：

- extension ID 和 version；
- publisher；
- selected variant；
- manifest/package digest；
- implementation ID、ABI、frontend asset ID；
- executable entrypoint（仅 executable variant）；
- script execution lanes；
- receipt digest。

Host 会把 receipt 与 manifest 和 catalog 重新计算比较，而不是信任上传值。

## 8. 前端 API

trusted-official 前端 extension 应输出单个 IIFE entry 和 CSS，并通过 Host 的 frontend SDK v1 获取：

- Vue runtime；
- Pinia helpers；
- Router 与 i18n；
- NutUI Dialog/Toast；
- Host stores/hooks；
- Host UI components。

构建时应 externalize Host SDK，避免两个 Vue runtime。扩展只注册自己 namespace 下的 routes 与 surfaces；Host 决定是否加载、挂载和卸载。

## 9. 后端 API

Node executable entry 导出：

```js
export const extensionId = 'com.example.my-extension';
export const implementationAbi = 'my-extension@1';
export function activate(host) {}
export function deactivate(host) {}
```

激活前至少检查：

- `host.apiVersion`；
- `host.extensionId`；
- `host.services`。

激活失败必须回滚全部 adapter/contribution 注册和 SDK binding。停用必须可重复并释放所有运行时引用。

## 10. Lifecycle

当前 Host 支持：

- inspect local directory package；
- install from official/community catalog；
- install local directory；
- enable；
- disable；
- uninstall code while retaining data；
- manage and refresh extension sources。

当前 Host 的 update、rollback 和 transactional data purge API 会返回 `501`。升级现阶段应使用：

```text
卸载代码并保留数据 -> 安装新授权包 -> 启用 -> 健康检查
```

不要声称已有自动 rollback；安装脚本应明确保留数据并报告失败。

## 11. 创建新扩展的检查表

1. 确定是 content-only 还是需要 executable trust。
2. 分配稳定、非保留的反向域名 ID。
3. 定义最小 permissions 与 contributions。
4. 为每个 runtime 选择 variant；不要假设 Node 包能在脚本宿主运行。
5. 将 Host 访问收口到 SDK/ABI，不导入 Host 私有源码。
6. 创建确定性构建、类型检查和测试。
7. 生成 manifest、receipt、package metadata 和 catalog。
8. 对 content package 生成完整摘要闭包；对 executable package 进入官方审核和签名。
9. 测试安装、启用、停用、保留数据卸载和重装。
10. 固定 release tag/commit 的 catalog URL，并记录 publisher/author/source provenance。
