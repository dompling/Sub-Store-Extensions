# 开发指南

## 目标

本仓库让配置生成器能够脱离 Sub-Store 前后端 monorepo 独立完成：

1. 前后端源码修改；
2. 前端 Host SDK 类型检查；
3. 前端 IIFE/CSS 和 Node CJS bundle 构建；
4. 回归测试；
5. 目录包组装、签名和 catalog 一致性验证；
6. 本地目录安装与静态扩展源发布。

它不会绕过 Host 的可执行代码信任模型。独立开发与生产授权是两个不同阶段。

## 环境

- Node.js `>=20`，推荐 `.node-version` 指定版本；
- Corepack；
- pnpm `11.0.9`；
- 如需完整交互验证，兄弟目录中应有 `Sub-Store` 和 `Sub-Store-Front-End`。

安装：

```bash
corepack pnpm install
```

如果系统全局 `pnpm` 版本较旧，始终使用 `corepack pnpm`。仓库的 lockfile 和 package manager 声明确保不同开发机使用相同依赖解析。

## 日常命令

| 命令 | 用途 |
| --- | --- |
| `corepack pnpm dev` | 同时 watch 前端 extension library 和后端 CJS bundle |
| `corepack pnpm typecheck` | 检查 Vue SFC、TypeScript 和 Host SDK 类型门面 |
| `corepack pnpm build:frontend` | 生成 `build/frontend/index.js` 与 `style.css` |
| `corepack pnpm build:backend` | 生成 `build/backend/index.cjs` |
| `corepack pnpm build` | 顺序构建前后端 |
| `corepack pnpm test` | 构建后运行独立仓库测试 |
| `corepack pnpm package` | 构建并尝试组装 `dist/package/...`；摘要变化会失败 |
| `corepack pnpm repository` | 从当前已签名目录包确定性生成静态 catalog/envelope |
| `corepack pnpm verify` | 校验签名包、build、dist 和 repository 的一致性 |
| `corepack pnpm check` | 完整提交前门禁 |
| `corepack pnpm install:local` | 调用 Node Host 管理 API 安装并启用目录包 |
| `corepack pnpm host:start` | 启动兄弟目录 Node Host，并使用本仓库 `package/` 作为种子目录 |

## 推荐循环

### 纯业务逻辑

1. 在 `backend/src/extensions/config-generator/core` 或 `targets/<target>` 修改逻辑。
2. 增加 Node test；如需直接测试未 bundle 的 ESM 源码，可使用现有构建工具转换，或从 bundle 暴露的 Host 行为进行测试。
3. 运行 `typecheck`、`build:backend` 和目标测试。
4. 完成前运行 `check`。

### 前端页面

1. 修改 `frontend/src/extensions/config-generator`。
2. 只通过 `@/extensions/frontend-sdk-v1` 访问 Host runtime。
3. 运行 `typecheck` 和 `build:frontend`。
4. 检查 CSS 是否仍由单一 `style.css` 输出，图标是否被内联，bundle 是否没有第二套 Vue/Pinia。
5. 在获得正式签名的测试包后，再执行 Host 中的桌面和移动端交互回归。

### 完整 Host 验证

当前 v1.1.0 的已签名字节可直接安装：

```bash
corepack pnpm host:start
corepack pnpm install:local -- --reinstall
```

如果本机前端 Host 尚未运行，可在兄弟目录启动：

```bash
cd ../Sub-Store-Front-End
corepack pnpm dev
```

然后访问：

```text
http://localhost:8888/extensions/config-generator
```

注意：修改源码后产生的新 bundle 不能继续使用 v1.1.0 签名。`dev` watch 会快速暴露构建问题，但不会把未授权代码热替换到 Host。需要交互验证新字节时，应申请开发/候选 release 签名，而不是手工覆盖 active package。

## 前端 SDK 门面

`frontend/types/frontend-sdk-v1.ts` 是编译期类型视图，实际运行对象由 Host 全局变量提供：

```text
__SUBSTORE_EXTENSION_FRONTEND_SDK_V1__
```

Vite 把 `vue` 与 `@/extensions/frontend-sdk-v1` 都映射到该全局对象，目的是共享 Host 的 Vue、Pinia、Router、i18n 和 UI 组件实例。类型门面中的 `undefined` 仅用于编译，绝不会进入 bundle。

Host stores 被有意视为 opaque。扩展应使用 SDK 暴露的稳定字段，避免复制完整 Host 私有 store 类型形成假耦合。需要新增能力时，应先设计 SDK 的可兼容增量，再同步 Host 和扩展。

## 后端 SDK 门面

`backend/src/extensions/config-generator/sdk.js` 只代理 Host 显式提供的 services：

- extension-owned storage；
- resource/artifact 查询；
- guarded network fetch；
- response transform；
- cache；
- backend request task；
- REST response/error helpers。

`package-entry.js` 导出稳定的 `activate(host)`、`deactivate(host)`、`extensionId` 和 `implementationAbi`。激活失败时必须注销 contribution、adapter 并解绑 services；对应回归测试位于 `tests/backend-bundle.test.mjs`。

## 可复现构建

当前已签名版本的三个摘要是：

```text
backend/index.cjs
2102cd7f71f2cdb70aea206fb3f8f236673a5674037d725ff1bfcd3e82de3763

frontend/index.js
4c998eff193e05588e5600510a5080fe07cad24f0b87bb87f6ea83d1c87f685c

frontend/style.css
099ed896b683b1e71ecffb6d427c4071b4a12683f74a7be4477c91415d4ead32
```

`pnpm verify` 和 package contract test 会比较实际 build 与签名 metadata。依赖版本、minifier、Sass、Vue compiler、Node/esbuild 行为或源码发生变化都可能改变字节；这是正常的发布信号，不应通过放宽校验来“修复”。

## 本地化的已知边界

当前 `configGenerator.*` 的 zh/en/ru 文案仍由 Sub-Store-Front-End 全局 locale 提供。这是 v1.1.0 的兼容性依赖，不应在不重新签名的情况下给 package/ 增加 locale 文件。

后续理想方案是由 Host SDK 增加 locale contribution，再由扩展 manifest 声明自己的语言资源。完成该能力前，修改或新增文案需要与 Host 前端版本协同发布。

## 故障排查

### `ERR_PNPM_IGNORED_BUILDS`

确认使用 pnpm 11，并保留 `pnpm-workspace.yaml` 中精确的 `allowBuilds`。不要使用 `--all` 将未知依赖加入白名单。

### `Build output differs from the signed release`

源码或工具链生成了新字节。开发阶段这是预期现象；要分发或安装，必须升级版本并完成官方签名与 Host catalog 授权。

### `EXTENSION_ADMIN_AUTH_REQUIRED`

Host 已进入 token 管理模式。给 `install:local` 传 `--token`，或设置 `SUB_STORE_EXTENSION_ADMIN_TOKEN` 环境变量。

### `EXTENSION_SOURCE_OFFICIAL_MIRROR_UNAUTHORIZED`

远程 catalog 的 manifest、ID、publisher 或 package digest 不等于 Host 内置的官方授权。确认使用同一 release 的 `repository/` 文件，不能只改 catalog 文本来发布新代码。
