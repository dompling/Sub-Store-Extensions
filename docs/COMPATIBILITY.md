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
- `smart` 通常可降级为 `url-test`；但 Quantumult X 官方仅为 `static`、`available`、`round-robin` 记录了 `resource-tag-regex` / `server-tag-regex`，因此带远程来源或节点正则的 `smart` / `url-test` 必须降级为 `available`，带相同筛选条件的 `dest-hash` 必须降级为 `round-robin`；
- Surge subnet/QX ssid 可在 Clash/Loon 中近似为 `select`；
- 无可用成员或来源时保留策略组并回退 `DIRECT`；
- 无法映射的 RULE-SET 给 warning 后过滤，不输出目标客户端无法解析的语法；
- 真实策略组引用循环始终阻断；
- `Clash` target 指 Clash Premium / Clash for Windows 方言，使用 `rule-providers` 与 `RULE-SET`；Mihomo 的扩展能力应作为独立 target 处理；
- Clash `proxy-provider.filter` 使用 Go 正则，不支持负向前瞻；Loon 官方 `NameRegex` 支持负向前瞻。自动 URL 订阅在 Clash 遇到这类表达式时，由配置生成器路由引用项目内策略组并让 Sub-Store 先执行 `Regex Filter`，再输出 Clash provider；无法经过该路由的来源会明确 warning 并退化为未筛选 provider；
- 目标无法客户端直接拉取时，可由 Host 下载、转换、缓存或物化；
- 用户独立配置与生成 section 合并时，显式用户配置优先且避免重复。

新增 target 至少需要 capability、generator、importer、validation/diagnostic、UI registry、远程来源策略和最小真实样例回归。

### 4.1 官方文档审查基线

配置语法不能只以“能被 INI/YAML 解析”为验收标准。当前适配器以以下官方资料为基线：

- Quantumult X：[`sample.conf`](https://github.com/crossutility/Quantumult-X/blob/af6fb594233ec4a3ec6d4ccb3601e9c36b75ea2d/sample.conf)、[`filter.snippet`](https://github.com/crossutility/Quantumult-X/blob/af6fb594233ec4a3ec6d4ccb3601e9c36b75ea2d/filter.snippet)、[`server.snippet`](https://github.com/crossutility/Quantumult-X/blob/af6fb594233ec4a3ec6d4ccb3601e9c36b75ea2d/server.snippet) 与 [`resource-parser.js`](https://github.com/crossutility/Quantumult-X/blob/af6fb594233ec4a3ec6d4ccb3601e9c36b75ea2d/resource-parser.js)；
- Loon：当前 [`LoonManual`](https://github.com/Loon0x00/LoonManual/tree/4311d0030fe3065d4664b403a32010f083b99273/docs/cn)；旧版 [`example.conf`](https://github.com/Loon0x00/LoonExampleConfig/blob/2425dec4993284fb576600cfd9dd7cd03ebdb3c0/example.conf) 只用于补充文本语法，不能覆盖较新的手册能力边界；
- Clash：目标方言为 Clash Premium / Clash for Windows，Mihomo 后续应作为独立 target。

已确认的边界：

- QX 本地规则原生支持 `IP-ASN`；`PROCESS-NAME`、端口、协议和逻辑规则没有出现在当前官方样例中，不应原样输出；
- QX `[filter_remote]` 的 `tag`、`force-policy`、`enabled` 均为可选字段，普通来源必须是 HTTP(S) URL，`FILTER_REGION` / `FILTER_LAN` 是带 `inserted-resource=true` 的特殊例外；
- Loon 当前规则手册支持 `IP-ASN` 的 `no-resolve`，并支持端口、协议、逻辑规则；共享编辑模型暂未建模的 Loon 专属规则应给 warning，不能伪装成其他规则；
- Loon `[Remote Rule]` 同时兼容手册简写 `URL, Policy` 和示例键值写法 `URL, policy=Policy, enabled=true`，生成器统一使用后者；
- Loon `NameRegex` 的负向前瞻由当前手册明确示范，可用于 `Other` 排除组；旧 `example.conf` 中的 `FilterKey = *HK` 与标准正则和当前手册冲突，不作为生成模板；
- Loon `ssid` 策略只出现在旧版官方示例，当前策略组手册已不再列出。导入和输出暂为兼容保留，但必须给版本边界 warning；新配置优先使用当前 Loon 网络触发能力。

### 4.2 无法完全保真的结构

- QX 和 Loon 都把本地规则与远程规则放在不同 section，跨 section 的原始交错顺序不能天然保持；
- Loon 明确采用“本地规则 > 插件规则 > 订阅规则”的优先级。需要严格保持共享规则顺序时，应由后端展开远程规则到 `[Rule]`；仅把缓存 URL 放入 `[Remote Rule]` 仍然保留 Loon 的原生优先级；
- QX `host-wildcard`、专属接口路由选项，以及 Loon 端口/协议/逻辑规则目前不属于共享可编辑规则子集。导入时必须给出明确诊断；在共享模型扩展前，不得静默猜测等价语义。

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
