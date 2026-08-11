# 兼容性与运行环境

## 1. 三个维度不要混淆

### 集合来源

```text
repository/catalog.json
```

负责发现多个插件。

### Sub-Store Host runtime

```text
Node / Quantumult X / Loon / Surge / Stash / Shadowrocket / Egern
```

决定插件代码如何交付和能否动态管理 package。

### 配置生成器输出 target

```text
Surge / Quantumult X / Clash / Loon
```

决定最终配置语法。Node Host 可以生成 QX 配置；Loon 中运行的 Sub-Store embedded implementation 也可以生成 Clash 配置。

## 2. 集合与安装能力

| Host runtime | 集合源发现 | package 代码来源 | 管理方式 |
| --- | --- | --- | --- |
| Node | 支持远程 HTTPS 与本地 loopback catalog | 已安装、已验证的目录包 | source 添加/刷新、安装、启停、卸载、重装 |
| Quantumult X | 使用 Host 提供的 catalog/receipt 能力 | 当前 Host 构建内 embedded implementation | 随 Host 版本装配，不动态执行远程 Node bundle |
| Loon | 同上 | 当前 Host 构建内 embedded implementation | 同上 |
| Surge | 同上 | 当前 Host 构建内 embedded implementation | 同上 |
| Stash/Shadowrocket/Egern | 使用 default script variant | 当前 Host 构建内 embedded implementation | 同上 |

脚本 runtime 没有 Node package store、CommonJS loader 和相同的生命周期 API。远程仓库可以传输 manifest/receipt/内容，但不能让这些宿主动态执行 `backend/index.cjs` 或第三方 Vue bundle。

当脚本 Host 没有匹配的 implementation ID/ABI 时，应提示升级 Sub-Store 构建，不能静默加载不受验证的远程代码。

## 3. 配置生成器输出兼容性

| Target | 生成 | 导入 | 预览 | 远程规则处理 |
| --- | ---: | ---: | ---: | --- |
| Surge | 支持 | 支持 | 支持 | RULE-SET 与 Surge rule list |
| Quantumult X | 支持 | 支持 | 支持 | remote filter，必要时转换/缓存为 QX 可接受 URL |
| Clash | 支持 | 支持 | 支持 | `rule-providers` |
| Loon | 支持 | 支持 | 支持 | Loon remote rule 语法 |

## 4. Target capability 原则

配置生成器使用中间模型，由每个 target adapter 投影：

- 策略组类型由 capability registry 映射；
- 目标没有同名功能时，选择语义最接近且安全的 fallback；
- fallback 必须产生 diagnostic，不能悄悄改变语义；
- 无法可靠表达的字段应过滤或降级，不能输出目标客户端无法解析的语法；
- 远程订阅来源由 target-specific adapter 转换；
- 远程规则集由 source resolver 处理；
- Clash 使用 `rule-providers`，不是把远程规则错误展开成不存在的“订阅链接”概念；
- 目标不支持直接远程规则时，可由 Host 获取并缓存内容，再提供兼容的物化 URL；
- 独立配置文本与生成 section 使用 named-entry merge，用户显式配置优先且避免重复。

新增 target 至少需要：

1. capability 定义；
2. generator；
3. importer；
4. validation 与 diagnostic；
5. UI target registry 和图标；
6. 远程订阅、规则集和缓存策略；
7. 策略组 fallback 测试；
8. 真实配置样例回归。

## 5. ABI

配置生成器当前后端 ABI：

```text
config-generator@1
```

前端 ABI：

```text
config-generator-ui@1
```

Host/frontend API：

```text
1.0.0
```

删除或重命名 SDK export、改变 activate/deactivate 语义、route payload、storage schema 或 frontend registration contract，可能需要新 ABI 和迁移。

## 6. Storage

配置生成器当前 schema version：

```text
1
```

legacy key：

```text
configGenerator
```

卸载代码默认保留数据。新版本必须读取旧 schema 或在激活后执行显式迁移；install hook 当前禁止。

## 7. Locale

配置生成器 v1.1.0 仍依赖 Host 全局 `configGenerator.*` zh/en/ru 文案。Host 版本过旧或 locale 未同步时，UI 可能显示 key。插件级 locale contribution 尚未完成前，扩展前端和 Host locale 需要协调发布。

## 8. 最低 Host

配置生成器 manifest 当前要求：

```text
Sub-Store backend >= 2.36.31
```

旧 Host 缺少 package store、source manager、frontend SDK 或扩展 lifecycle 时必须拒绝安装，不应退回不受验证的旧加载方式。
