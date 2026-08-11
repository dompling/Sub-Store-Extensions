# 配置生成器扩展

```text
org.substore.config-generator
```

这是 `Sub-Store-Extensions` 集合中的独立 Node executable 扩展，支持生成和导入 Surge、Quantumult X、Clash 与 Loon 配置。它不属于 Host 内置功能；没有添加包含它的集合源时，不应被发现或按 ID 安装。

## 目录

```text
backend/                 生成器、导入器、校验和 Host adapter
frontend/                Vue 页面、组件、图标、locale 和 SDK 类型
tests/                   插件行为与 package 契约
extension.config.json    构建、SHA-256 package 和 catalog 配置
package.json             workspace 身份与版本
```

生成物：

```text
packages/org.substore.config-generator/
repository/packages/org.substore.config-generator/<version>/node.json
```

## 开发

从仓库根运行：

```bash
corepack pnpm typecheck -- --extension org.substore.config-generator
corepack pnpm test -- --extension org.substore.config-generator
corepack pnpm package -- --extension org.substore.config-generator
corepack pnpm repository
corepack pnpm verify
```

## Package 边界

- manifest `kind: executable`，runtime 只有 Node；
- backend entrypoint、frontend JS/CSS 都在文件摘要闭包；
- receipt 绑定 implementation ID、ABI、entrypoint 和 package digest；
- `sha256-digest` 检测内容漂移，不认证发布者；
- 添加集合源并点击安装，是用户对该来源代码的显式信任；
- executable 运行在 Host 主上下文中，不是沙箱；
- install hook 禁止。

frontend asset digest 会在 package 生成时从实际 build artifacts 更新，不要手工编辑。

## Runtime 与兼容性

- Node Host 从已安装 package 加载 backend/frontend；
- 输出 target 和运行 runtime 独立，Node 插件仍能生成四种客户端配置；
- 脚本 Host 不内嵌或远程执行本插件的 Node bundle；
- Host API、frontend API、backend version 或 ABI 不匹配时必须拒绝启用。

Clash/Loon 对目标不支持的策略组会选择近似类型并给出 warning；无可用成员时回退 `DIRECT`；不能映射的远程 RULE-SET 会 warning 后过滤；真实策略组循环仍会阻断预览。

完整流程见仓库根 [README](../../README.md) 和 [发布指南](../../docs/RELEASING.md)。
