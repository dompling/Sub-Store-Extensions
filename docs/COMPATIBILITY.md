# 兼容性与运行环境

## 1. 三个维度

- 集合来源：`repository/catalog.json`，负责发现插件；
- Host runtime：决定能否安装和执行 package；
- 配置输出 target：Surge / Quantumult X / Clash / Loon，决定生成语法。

配置生成器当前是 Node-only executable 扩展。Node Host 可以生成 QX/Loon 等配置，但 QX/Loon/Surge 脚本 runtime 不会因此获得动态 Node package 执行能力。

## 2. 安装能力

| Host runtime | 集合发现 | 执行配置生成器 |
| --- | --- | --- |
| Node | 支持 HTTPS 与 loopback catalog | 安装并验证 `backend/index.cjs` 与 frontend assets |
| Quantumult X / Loon / Surge 等脚本 Host | 可由 Host 提供通用扩展元数据能力 | 不支持本插件的远程 Node executable variant |

脚本 Host 不应内嵌一份配置生成器副本，也不能把远程 Node CJS 当作同等动态插件。runtime 不兼容时应明确拒绝。

## 3. 输出兼容性

| Target | 生成 | 导入 | 预览 | 远程规则处理 |
| --- | ---: | ---: | ---: | --- |
| Surge | 支持 | 支持 | 支持 | RULE-SET 与 Surge rule list |
| Quantumult X | 支持 | 支持 | 支持 | remote filter；必要时转换/缓存 URL |
| Clash | 支持 | 支持 | 支持 | `rule-providers` 或 Host 缓存后 inline fallback |
| Loon | 支持 | 支持 | 支持 | Loon remote rule 语法或兼容 rule list |

## 4. Target capability 原则

- 中间模型由 target adapter 投影；
- 没有同名策略组时选择最接近的 fallback 并给 warning；
- `smart` 可降级为 `url-test`；Surge subnet/QX ssid 可在 Clash/Loon 中近似为 `select`；
- 无可用成员或来源时保留策略组并回退 `DIRECT`；
- 无法映射的 RULE-SET 给 warning 后过滤，不输出目标客户端无法解析的语法；
- 真实策略组引用循环始终阻断；
- Clash 使用 `rule-providers`，不是远程订阅链接；
- 目标无法客户端直接拉取时，可由 Host 下载、转换、缓存或物化；
- 用户独立配置与生成 section 合并时，显式用户配置优先且避免重复。

新增 target 至少需要 capability、generator、importer、validation/diagnostic、UI registry、远程来源策略和最小真实样例回归。

## 5. ABI

```text
Backend: config-generator@1
Frontend: config-generator-ui@1
Host/frontend API: 1.0.0
```

修改 SDK export、activate/deactivate、route payload、storage schema 或 frontend registration contract，可能需要提升 ABI 并提供迁移。

## 6. Storage 与 locale

- storage schema version：`1`；
- legacy key：`configGenerator`；
- 卸载默认保留数据；
- zh/en/ru locale 随 extension frontend package 注册，不依赖 Host 前端内置配置生成器文案。

## 7. 最低 Host

manifest 当前要求：

```text
Sub-Store backend >= 2.36.31
```

旧 Host 缺少 source manager、package store、frontend SDK 或 lifecycle 时必须拒绝安装，不应回退到隐式内置实现。
