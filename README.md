# Sub-Store Extensions

Sub-Store 的多扩展集合仓库。一个 Git 仓库可以维护多个彼此独立的插件，并发布一个仓库级集合订阅源。用户只需要添加一次：

当前滚动集合源：

```text
https://raw.githubusercontent.com/dompling/Sub-Store-Extensions/main/repository/catalog.json
```

正式版本发布后，建议把 `main` 换成不可变 tag 或 commit。

扩展商店会从这个 catalog 发现仓库中的全部插件，再按插件 ID 下载各自的安装包。正常安装不要求用户下载或上传文件夹；文件夹安装仅保留给本地开发、离线环境和故障恢复。

当前仓库已经包含：

- `org.substore.config-generator`：配置生成器，支持 Surge、Quantumult X、Clash 与 Loon；
- 多插件 workspace、构建、测试、组包和聚合 catalog 工具；
- 集合源添加、刷新、安装、重装和本地回退工具；
- 安全的 content 扩展脚手架；
- 配置生成器 v1.1.0 的已签名、可安装包。

## 仓库模型

```text
Sub-Store-Extensions/
├── extensions/
│   ├── org.substore.config-generator/   # 插件源码、配置、测试和公钥
│   └── <extension-id>/                  # 其他插件各占一个目录
├── packages/
│   ├── org.substore.config-generator/   # 插件独立目录包
│   └── <extension-id>/
├── repository/
│   ├── catalog.json                     # 整个仓库唯一的集合订阅源
│   └── packages/<id>/<version>/<variant>.json
├── scripts/                              # 全仓共享开发与发布工具
├── tests/                                # 仓库级、多插件回归
├── repository.config.json               # 集合源身份与发布者
├── pnpm-workspace.yaml
└── package.json
```

三层含义不要混淆：

- `extensions/<id>`：该插件的开发 workspace；
- `packages/<id>`：该插件可安装、可验证的独立交付物；
- `repository/catalog.json`：把所有插件聚合到同一个订阅源的索引。

仓库共享工具，不共享插件身份。每个插件仍拥有自己的 ID、版本、作者、manifest、receipt、包摘要和签名配置。

## 快速开始

需要 Node.js 20 或更高版本、Corepack 和仓库声明的 pnpm 版本。

```bash
corepack pnpm install
corepack pnpm extension:list
corepack pnpm check
```

不传 `--extension` 时，命令处理仓库里的全部插件；只处理一个插件时：

```bash
corepack pnpm build -- --extension org.substore.config-generator
corepack pnpm test -- --extension org.substore.config-generator
corepack pnpm package -- --extension org.substore.config-generator
```

## 创建新插件

安全的默认脚手架会创建 content-only 扩展：

```bash
corepack pnpm extension:create -- \
  --id com.example.my-extension \
  --name "My Extension" \
  --publisher-id com.example \
  --publisher-name "Example"

corepack pnpm install
corepack pnpm check
```

它会同时创建：

```text
extensions/com.example.my-extension/
packages/com.example.my-extension/
```

content 扩展使用插件独立的 SHA-256 完整性闭包，不包含可执行代码，也不需要私钥。若插件需要动态 Vue 页面或 Node 后端代码，不能把 `containsExecutableCode` 手工改成 `true`；必须单独设计 Host SDK 权限、插件签名密钥、官方授权和发布流程。详见 [扩展规范](docs/EXTENSION-SPEC.md)。

## 生成集合订阅源

```bash
corepack pnpm package
corepack pnpm repository
corepack pnpm verify
```

`repository` 每次都会重新聚合全部 `extensions/*` workspace，并清理已经删除插件遗留的 envelope。正式发布时提交整个 `repository/`，用户订阅其中唯一的 `catalog.json`。

本地预览集合源：

```bash
corepack pnpm repository:serve
```

默认地址：

```text
http://127.0.0.1:8765/catalog.json
```

## 从集合源安装

先启动本机 Sub-Store Node Host，然后添加一次仓库源：

```bash
corepack pnpm host:start
corepack pnpm source:add -- \
  --url http://127.0.0.1:8765/catalog.json \
  --name "Sub-Store Extensions (Local)"
```

安装集合中的指定插件：

```bash
corepack pnpm extension:install -- \
  --extension org.substore.config-generator
```

卸载旧代码但保留用户数据，再从同一个集合源重新安装并启用：

```bash
corepack pnpm extension:install -- \
  --extension org.substore.config-generator \
  --reinstall
```

远程仓库使用固定 tag 或 commit 的 Raw URL：

```bash
corepack pnpm source:add
```

默认 URL 来自 `repository.config.json.catalogUrl`，当前即本仓库 GitHub collection catalog。也可用 `--url` 或 `SUB_STORE_EXTENSION_SOURCE_URL` 覆盖；正式 release 推荐固定 tag/commit。

完整流程见 [安装文档](docs/INSTALLING.md) 和 [集合源文档](docs/CATALOG.md)。

## 本地文件夹回退

本地开发或无法访问仓库源时，可以安装单个目录包：

```bash
corepack pnpm extension:install-local -- \
  --extension org.substore.config-generator \
  --reinstall
```

也可以在扩展管理 UI 中选择完整的：

```text
packages/org.substore.config-generator
```

本地文件夹只是传输方式，不会绕过 manifest、receipt、摘要、签名、Host 兼容性或可执行代码准入检查。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `extension:list` | 列出仓库内全部插件 |
| `extension:create` | 创建安全的 content 扩展 workspace 与初始包 |
| `dev` | watch 选中或全部可构建插件 |
| `typecheck` | 检查全部前端插件类型 |
| `build` | 构建全部插件前后端产物 |
| `test` | 构建后运行插件级与仓库级测试 |
| `package` | 组装插件包；content 包自动重建完整性闭包 |
| `repository` | 生成一个包含全部插件的 catalog 和 envelope |
| `verify` | 验证源码、包、构建产物和集合源一致性 |
| `check` | 提交前完整门禁 |
| `source:add` | 向 Host 添加仓库级集合订阅源 |
| `source:refresh` | 刷新已添加的集合订阅源 |
| `extension:install` | 从集合源安装并启用指定插件 |
| `extension:install-local` | 从本地目录包安装，作为回退方式 |

## 信任模型

- 一个 catalog 可以同时包含多个插件，但 catalog 的来源元数据不等于插件代码信任。
- `trusted-official-mirror` 可交付官方可执行包；Host 仍要求其 ID、publisher、manifest digest、package digest 和 Ed25519 签名与官方授权一致。
- `community` 目前只能交付 `kind: content` 且 `containsExecutableCode: false` 的完整性包。
- 每个可执行插件应有独立签名配置；不要让一个插件的私钥成为其他插件的通用执行授权。
- Node 可加载已验证的后端和前端 bundle；QX、Loon、Surge 等脚本 runtime 使用 Host 构建中内嵌的实现，不从第三方源执行 Node JavaScript。
- 安装 hook 当前一律禁止。
- 对外部署必须配置 `SUB_STORE_EXTENSION_ADMIN_TOKEN` 或其哈希形式。

详见 [安全策略](SECURITY.md)。

## 配置生成器当前签名版本

```text
Extension ID:  org.substore.config-generator
Version:       1.1.0
Package SHA:   c9dced66d67dc80e22587e719a71fe140c9036e71cfacee0c5c4735b962d7ba0
Payload SHA:   1a6a2c22e8243de10dd47e6bc1c5d48245503390c48f43ce0465caf03a55c280
Signing key:   substore-release-root-2026-08-config-generator-v4
```

修改配置生成器源码、manifest、receipt 或任意 bundle 字节都会使这个签名版本失效。不要手工改摘要；应按 [发布指南](docs/RELEASING.md) 生成新版本并同步 Host 授权。

## 文档

- [开发指南](docs/DEVELOPMENT.md)
- [扩展与仓库规范](docs/EXTENSION-SPEC.md)
- [安装、卸载与重装](docs/INSTALLING.md)
- [集合订阅源与 GitHub 托管](docs/CATALOG.md)
- [发布指南](docs/RELEASING.md)
- [兼容性](docs/COMPATIBILITY.md)
- [贡献指南](CONTRIBUTING.md)
- [安全策略](SECURITY.md)

## License

[GPL-3.0](LICENSE)
