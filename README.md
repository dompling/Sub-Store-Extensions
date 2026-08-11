# Sub-Store Config Generator Extension

Sub-Store 配置生成器的独立源码与交付仓库。它负责生成和导入 Surge、Quantumult X、Clash 与 Loon 配置，并通过 Sub-Store Extension Host 提供前端页面、后端路由和配置项目产物。

这个仓库已经具备完整的独立开发闭环：源码、类型检查、前后端构建、回归测试、已签名目录包校验、本地安装工具和可托管的静态扩展源都在同一个 Git 仓库中。

> “独立扩展仓库”不等于“任意第三方 JavaScript 可以进入 Host”。配置生成器仍是 `trusted-official` 可执行扩展。Sub-Store Host 会校验官方扩展 ID、发布者、清单摘要、包摘要、Ed25519 签名、receipt 和每个文件摘要。普通社区扩展目前只能是无执行代码的 content extension。

## 快速开始

需要 Node.js 20 或更高版本；仓库推荐使用 `.node-version` 中的版本和 `packageManager` 声明的 pnpm。

```bash
corepack pnpm install
corepack pnpm check
```

常用开发命令：

```bash
# 同时监听前端扩展和 Node 后端 bundle
corepack pnpm dev

# 单独检查或构建
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test

# 组装并验证当前已签名目录包
corepack pnpm package
corepack pnpm repository
corepack pnpm verify

# 启动兄弟目录中的 Sub-Store Node 后端，并把本仓库 package/ 设为种子目录
corepack pnpm host:start
```

`pnpm dev` 只负责快速重建，不会绕过扩展签名，也不会热替换 Host 中已经安装的代码。交互式 Host 验证必须安装一个受 Host 授权的目录包；修改 manifest、版本或任意 bundle 字节后，当前 v1.1.0 签名立即失效，必须进入正式签名发布流程。

## 本地安装

Node Host 运行在默认的 `http://127.0.0.1:3000` 时：

```bash
corepack pnpm install:local
```

卸载现有代码但保留配置数据，然后重新安装并启用：

```bash
corepack pnpm install:local -- --reinstall
```

如果 Host 配置了管理令牌：

```bash
corepack pnpm install:local -- \
  --host http://127.0.0.1:3000 \
  --token '<admin-token>' \
  --reinstall
```

也可以在扩展管理界面选择文件夹：

```text
package/org.substore.config-generator
```

完整说明见 [安装文档](docs/INSTALLING.md)。

## 仓库结构

```text
backend/                 配置生成器后端源码和独立化后的私有依赖
frontend/                配置生成器前端源码、SDK 类型门面和构建配置
package/                 当前已签名、可安装的目录包；不要手工修改
repository/              可放在 GitHub Raw 或任意 HTTPS 静态站点的扩展源
release/                 仅用于验证的官方公钥，不包含私钥
scripts/                 构建、组包、校验、安装和本地服务工具
tests/                   独立仓库回归与包契约测试
docs/                    扩展开发、规范、安装、发布和兼容性文档
build/                   本地构建产物，不提交
dist/                    本地组装结果，不提交
```

`package/` 和 `repository/` 是已签名版本的交付物；`build/` 与 `dist/` 是可删除、可重建的本地产物。`pnpm verify` 会确认构建结果与当前签名版本逐字节一致。

## 信任模型摘要

- Node runtime：安装并执行 `backend/index.cjs`，加载 `frontend/index.js` 与 `frontend/style.css`。
- Quantumult X、Loon、Surge 及其他脚本 runtime：使用 Sub-Store Host 构建时包含的 embedded implementation，不从扩展源下载并执行 Node bundle。
- `trusted-official-mirror`：可以从独立 GitHub/HTTPS 仓库交付官方包，但不会引入第二个信任根。
- community source：可以提供内容型扩展，不能声明前后端可执行代码、entrypoint 或 install hook。
- 安装 hook：当前一律禁止。
- 管理 API：Node Host 未设置令牌时是 `open`；对外部署必须配置 `SUB_STORE_EXTENSION_ADMIN_TOKEN` 或其哈希形式。

更完整的格式和生命周期见 [扩展规范](docs/EXTENSION-SPEC.md) 与 [安全说明](SECURITY.md)。

## 当前版本

```text
Extension ID:  org.substore.config-generator
Version:       1.1.0
Package SHA:   c9dced66d67dc80e22587e719a71fe140c9036e71cfacee0c5c4735b962d7ba0
Payload SHA:   1a6a2c22e8243de10dd47e6bc1c5d48245503390c48f43ce0465caf03a55c280
Signing key:   substore-release-root-2026-08-config-generator-v4
```

当前签名清单的 `homepage` 仍指向 Sub-Store 主仓库。修改它也会改变 manifest digest，因此应在下一次正式签名发布时再更新为本仓库的远程地址。

## 文档导航

- [开发指南](docs/DEVELOPMENT.md)
- [新扩展与包格式规范](docs/EXTENSION-SPEC.md)
- [安装与重装](docs/INSTALLING.md)
- [扩展源与 GitHub Raw](docs/CATALOG.md)
- [正式发布流程](docs/RELEASING.md)
- [运行环境兼容性](docs/COMPATIBILITY.md)
- [贡献指南](CONTRIBUTING.md)
- [安全策略](SECURITY.md)

## License

[GPL-3.0](LICENSE)
