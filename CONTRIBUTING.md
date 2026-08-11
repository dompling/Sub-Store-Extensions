# 贡献指南

## 开发原则

1. 保持扩展与 Host 的边界清晰。业务实现放在本仓库；Host API、信任策略、路由挂载和运行时生命周期由 Sub-Store Host 拥有。
2. 优先复用现有 core、target capability 和 SDK 门面，不直接导入兄弟仓库的私有源码。
3. 不为方便开发而关闭摘要、receipt、签名或官方 catalog 授权检查。
4. 不新增依赖，除非现有工具链确实无法完成需求并且变更经过明确评审。
5. 修改行为时先增加或更新回归测试；修复应覆盖最小复现和失败回滚路径。
6. 保持 manifest、root package version、签名目录包和 repository catalog 的版本一致。

## 环境准备

```bash
corepack pnpm install
corepack pnpm check
```

pnpm 11 默认阻止依赖生命周期脚本。本仓库只允许经过审查的 `esbuild`、`vue-demi` 与 `@parcel/watcher` 运行安装脚本，配置位于 `pnpm-workspace.yaml`。不要把它改成允许所有依赖执行脚本。

## 推荐开发流程

1. 从失败测试或明确验收场景开始。
2. 修改 `frontend/src/extensions/config-generator`、`backend/src/extensions/config-generator` 或相应独立依赖。
3. 运行 `corepack pnpm typecheck`。
4. 运行目标测试；完成前运行 `corepack pnpm check`。
5. 检查 `package/` 是否被意外修改。普通功能开发不应直接改写已签名文件。
6. 如果产物字节发生变化，按 `docs/RELEASING.md` 准备正式新版本，不要手工更新摘要或伪造签名。

## 代码边界

Node bundle 的入口是：

```text
backend/src/extensions/config-generator/package-entry.js
```

前端 bundle 的入口是：

```text
frontend/src/extensions/config-generator/runtime-entry.ts
```

前端只能通过 `@/extensions/frontend-sdk-v1` 使用 Host 能力。该模块在构建时被 externalize 到 Host 提供的 `__SUBSTORE_EXTENSION_FRONTEND_SDK_V1__`，不能把第二套 Vue、Pinia、Router 或 i18n runtime 打入 bundle。

后端通过 `sdk.js` 获取 Host services。不要直接读取 Sub-Store 全局 storage、内部 registry 或 Node 主进程对象。为了让 bundle 独立构建，配置生成器使用到的 YAML 门面和 MD5 实现已经复制到本仓库的明确边界中。

`embedded.js` 是非 Node runtime 在 Sub-Store Host 中装配时使用的桥接源码，不属于独立 Node package entry 的导入图。脚本 runtime 的完整发布仍需要与 Host 构建协调。

## 测试要求

`corepack pnpm check` 必须完成：

- Vue/TypeScript 类型检查；
- 前端 IIFE 与 CSS 构建；
- Node CJS bundle 构建；
- RULE-SET 名称行为回归；
- 后端 activate/deactivate 与失败回滚测试；
- 包目录、导入图、版本和文件清单契约测试；
- 已签名目录包、静态 catalog、Ed25519 签名与三个构建摘要验证。

涉及配置转换时，还应在 Sub-Store Host 仓库运行相应 target generator/importer 和 Extension Host 集成测试。涉及 UI 时，还应在 Sub-Store-Front-End 中检查桌面端和移动端布局。

## Commit

提交信息使用项目的 Lore protocol：首行说明“为什么”，正文记录约束、舍弃方案、风险和验证证据。例如：

```text
Preserve the executable trust boundary while externalizing development

The extension now owns its deterministic build and verification workflow,
while the Host remains the authority for executable package admission.

Constraint: Executable packages require the Sub-Store official trust root
Rejected: Accept arbitrary community JavaScript | no sandboxed runtime exists
Confidence: high
Scope-risk: moderate
Tested: typecheck, build, tests, signed package verification
Not-tested: remote installation before a repository URL exists
```
