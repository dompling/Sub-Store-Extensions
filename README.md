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
│   ├── releases/<id>.json              # 每个插件独立的不可变版本台账
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
corepack pnpm typecheck
node --test tests/*.test.mjs
```

只联调配置生成器：

```bash
corepack pnpm dev:install -- --extension org.substore.config-generator
```

`dev:install` 会构建临时 SHA-256 package、保留扩展数据地重装并启用，且不修改正式 `packages/` 或 `repository/`。正式发布由 workflow 先生成版本，再调用 `release:build` 生成可提交的 package、catalog 和 release ledger；不要手工修改这些生成物。

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
corepack pnpm package -- --extension org.substore.config-generator
corepack pnpm repository -- --extension org.substore.config-generator
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

日常 Host 联调使用一条命令构建、保留数据重装并启用：

```bash
corepack pnpm dev:install -- --extension org.substore.config-generator
```

临时 package 在安装后自动清理，不会写入正式发布目录。已有完整目录包时仍可使用 `extension:install-local -- --extension <id> --reinstall`。两种方式都不会成为默认发现来源，也不会绕过 manifest、receipt、SHA-256、路径、ABI、入口和 install-hook 检查。

## 发布

GitHub Actions 中的 `Publish extensions` workflow 会在 `main` 每次 push 后先做一次轻量选择：尚未进入 catalog 的扩展会自动首次发布；已发布扩展逐个比较 `extensions/<id>` 与自己的最新不可变 release tag，只发布真正发生变化的扩展。所有扩展都已发布且目录没有差异时，普通根目录或文档提交会直接成功退出。

```text
找出全部未首次发布的扩展，以及存在未发布目录变化的已发布扩展
→ 自动为已发布扩展生成 patch 版本
→ 批量 release:prepare
→ 一次 release:build（typecheck / build / package / repository / test / verify）
→ git diff --check
→ 上传 build / dist / package 候选 artifact
→ 确认目标分支未发生并发更新
→ 创建一个包含全部目标扩展的发布提交
→ 原子推送发布提交和全部 `<extension-id>@<semver>` tag
→ 删除这些版本遗留的 automation/publish-* 分支
```

只修改 `org.substore.config-generator` 就只升级它；同一批未发布提交同时修改 `org.substore.rule-studio` 和 `org.substore.subscription-doctor`，则两个扩展在同一个原子发布事务中一起升级。任一扩展构建或测试失败时整批都不会发布，不会留下只更新了一半的 catalog。

自动发布固定使用 patch。需要 minor 或 major 时仍可手动运行 workflow，选择单个扩展和增量。开发提交不需要手工修改版本或提交 `build/`、`dist/`；`build/`、`dist/` 只作为 Actions artifact 保存。workflow 不需要私钥或 GitHub Environment Secret。

扩展显示版本仍使用 SemVer（例如 `1.2.1`），Git tag 是这个版本的不可变发布指针，而不是另一个版本号。因为一个仓库包含多个插件，tag 必须带插件 ID，例如 `org.substore.config-generator@1.2.1`。`catalog.json` 的顶层 entry 继续表示最新版本，以兼容旧 Host；`entry.releases[]` 和 `repository/releases/<id>.json` 保存可选历史版本。重复发布同一个版本但摘要或 manifest 不同会直接失败。

默认使用具有 `contents: write` 的 `GITHUB_TOKEN`。如果基础分支保护规则禁止 Actions 直接更新，可提供可选的 `RELEASE_PUBLISH_TOKEN` repository secret，由一个被允许更新该分支的 fine-grained token 提供 `Contents: Read and write` 权限。详见 [发布指南](docs/RELEASING.md)。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `extension:list` | 列出全部插件 |
| `extension:create` | 创建 content 扩展 |
| `dev` | watch 构建 |
| `dev:install` | 构建临时包并保留数据重装到本地 Host |
| `typecheck` | 前端类型检查 |
| `build` | 构建前后端产物 |
| `test` | 构建后运行源码/构建测试，不写正式发布目录 |
| `test:built` | 对已组装 package 追加发布产物一致性测试 |
| `package` | 构建并生成 SHA-256 包 |
| `repository` | 更新选定扩展并保留集合中的其他发布 |
| `verify` | 验证全集合历史，并核对选定扩展的本地产物 |
| `release:prepare-batch` | 为 workflow 批量生成扩展版本和 release metadata |
| `release:build` | 一次生成并验证选定扩展的发布候选 |
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
