# Sub-Store Extensions

Sub-Store 的多扩展集合仓库。一个 Git 仓库可以维护多个彼此独立的插件，并通过同一个集合订阅源发布：

```text
https://raw.githubusercontent.com/dompling/Sub-Store-Extensions/main/repository/catalog.json
```

正式版本建议使用不可变 tag 或 commit URL。

当前包含 `org.substore.config-generator` 配置生成器，支持生成和导入 Surge、Quantumult X、Clash 与 Loon 配置。它是独立的 Node executable 扩展，不再内置于 Sub-Store Host；没有添加集合源时，商店和安装接口都不应发现它。

## 轻量信任模型

- 用户主动添加集合源，是对该来源的显式信任；
- 用户点击安装后，Host 才下载并执行 executable 扩展；
- SHA-256 校验 manifest、receipt、package、payload 和每个文件的一致性，但不证明发布者身份；
- Host 仍检查版本/API/ABI、入口、路径、未声明文件、executable flag 和 install hook；
- 当前 executable 扩展运行在 Node Host 主进程和主前端上下文中，不是安全沙箱；
- 如果未来允许不受信作者发布代码，再增加发布者签名、撤销和隔离运行时。

当前仓库中的扩展由同一维护方开发，因此不引入每插件私钥、发布者公钥白名单或 GitHub Environment Secret。

## 仓库结构

```text
Sub-Store-Extensions/
├── extensions/<id>/                    # 插件源码、配置和测试
├── packages/<id>/                      # 插件独立目录包
├── repository/
│   ├── catalog.json                    # 整个仓库唯一的集合订阅源
│   └── packages/<id>/<version>/<variant>.json
├── scripts/                            # 构建、组包、发布和本地管理工具
├── tests/                              # 仓库级契约测试
├── repository.config.json
└── package.json
```

三层边界：

- `extensions/<id>`：开发 workspace；
- `packages/<id>`：可安装交付物；
- `repository/catalog.json`：聚合全部插件的发现索引。

每个插件仍有独立 ID、版本、作者、manifest、receipt、文件摘要和数据命名空间。

## 快速开始

需要 Node.js 20 或更高版本、Corepack 和仓库声明的 pnpm 版本。

```bash
corepack pnpm install
corepack pnpm extension:list
corepack pnpm check
```

只处理配置生成器：

```bash
corepack pnpm typecheck -- --extension org.substore.config-generator
corepack pnpm test -- --extension org.substore.config-generator
corepack pnpm package -- --extension org.substore.config-generator
corepack pnpm repository
corepack pnpm verify
```

`package` 会从构建产物生成 SHA-256 package 闭包，并更新 frontend asset digest；不要手工修改生成后的 package、receipt 或 catalog。

## 创建新插件

默认脚手架生成 content-only 扩展：

```bash
corepack pnpm extension:create -- \
  --id com.example.my-extension \
  --name "My Extension" \
  --publisher-id com.example \
  --publisher-name "Example"
```

content 扩展不能执行前后端 JavaScript。需要 executable 能力时，应参考配置生成器建立独立 workspace，并明确 Host SDK、权限、Node entrypoint、ABI、生命周期和最小回归；不要只改一个布尔值。

## 集合源安装

先生成并启动本地集合源：

```bash
corepack pnpm package
corepack pnpm repository
corepack pnpm repository:serve
```

另一个终端启动 Host、添加来源并安装：

```bash
corepack pnpm host:start
corepack pnpm source:add -- \
  --url http://127.0.0.1:8765/catalog.json \
  --name "Sub-Store Extensions (Local)"
corepack pnpm extension:install -- \
  --extension org.substore.config-generator
```

`host:start` 默认不会把本仓库 `packages/` 注入 Host。这样可以真实验证：未添加来源时，配置生成器不可见且按 ID 安装返回 source not found。

确实需要调试历史 seed 机制时必须显式 opt-in：

```bash
SUB_STORE_EXTENSION_PACKAGE_SEED_PATH=packages corepack pnpm host:start
```

该开关只用于开发，不代表集合源安装成功。

## 本地目录安装

本地目录安装也是显式管理操作，只用于开发、离线或恢复：

```bash
corepack pnpm extension:install-local -- \
  --extension org.substore.config-generator \
  --reinstall
```

它不会成为默认发现来源，也不会绕过 manifest、receipt、SHA-256、路径、ABI、入口和 install-hook 检查。

## 发布

GitHub Actions 中的 `Publish extension` workflow 会：

```text
从 catalog 计算 patch / minor / major 版本
→ release:prepare
→ typecheck / build
→ package / repository
→ test / verify
→ git diff --check
→ 上传 build / dist / package 候选 artifact
→ 创建发布 PR
```

开发提交不需要手工修改版本或提交 `build/`、`dist/`。workflow 会把源码版本、可发布 package 和 catalog 变更一起放进 release PR；`build/`、`dist/` 只作为 Actions artifact 保存。workflow 不需要私钥或 GitHub Environment Secret。

自动创建 PR 还受仓库级 Actions 策略控制。推荐在 `Settings > Actions > General > Workflow permissions` 开启 `Allow GitHub Actions to create and approve pull requests`。若未开启，workflow 会保留已推送的 release 分支并在 job summary 输出手动创建 PR 的链接，不再让整个发布任务失败；也可以提供可选的 `RELEASE_PR_TOKEN` repository secret。详见 [发布指南](docs/RELEASING.md)。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `extension:list` | 列出全部插件 |
| `extension:create` | 创建 content 扩展 |
| `dev` | watch 构建 |
| `typecheck` | 前端类型检查 |
| `build` | 构建前后端产物 |
| `test` | 构建后运行插件和仓库测试 |
| `package` | 构建并生成 SHA-256 包 |
| `repository` | 生成全集合 catalog/envelope |
| `verify` | 验证源码、包、构建和集合一致性 |
| `check` | 执行完整本地门禁 |
| `source:add` / `source:refresh` | 管理集合源 |
| `extension:install` | 从已添加来源安装 |
| `extension:install-local` | 显式安装本地目录包 |

## 文档

- [开发指南](docs/DEVELOPMENT.md)
- [扩展规范](docs/EXTENSION-SPEC.md)
- [安装、卸载与重装](docs/INSTALLING.md)
- [集合订阅源](docs/CATALOG.md)
- [发布指南](docs/RELEASING.md)
- [兼容性](docs/COMPATIBILITY.md)
- [安全策略](SECURITY.md)

## License

[GPL-3.0](LICENSE)
