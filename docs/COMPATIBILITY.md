# 兼容性与运行环境

## 配置目标与 Host runtime 是两个维度

配置生成器的输出 target 是：

```text
Surge / Quantumult X / Clash / Loon
```

Sub-Store 自身的运行 runtime 可能是：

```text
Node / Quantumult X / Loon / Surge / Stash / Shadowrocket / Egern
```

例如，Node Host 可以生成 QX 配置；Loon 中运行的 Sub-Store 也可以使用 embedded implementation 生成 Clash 配置。不要把“运行在哪个客户端”和“输出哪种配置”混成一个 variant。

## 交付矩阵

| Host runtime | 后端实现来源 | 前端资产 | 管理能力 |
| --- | --- | --- | --- |
| Node | 已签名 `backend/index.cjs` | 已签名 extension frontend assets | 安装、启停、卸载、source 管理 |
| Quantumult X | Host 构建内 embedded implementation | Host 提供/内嵌 | read-only |
| Loon | Host 构建内 embedded implementation | Host 提供/内嵌 | read-only |
| Surge | Host 构建内 embedded implementation | Host 提供/内嵌 | read-only |
| Stash/Shadowrocket/Egern | `default-script-runtime` embedded implementation | Host 提供/内嵌 | read-only |

非 Node runtime 显示 `read-only` 的含义是不能动态管理 package，不是配置功能只读。

## Target capability 处理原则

配置生成器把内部模型作为中间表示，再由每个 target adapter 投影：

- 策略组类型通过 target capability registry 映射；
- 不存在的原生类型应选择语义最接近的安全 fallback，并产生诊断；
- 无法可靠表达的字段应过滤或降级，不能输出目标客户端无法解析的语法；
- 远程订阅来源由 target-specific adapter 转换；
- 远程规则集由 source resolver 转换，Clash 使用 `rule-providers`，QX/Loon/Surge 使用各自支持的远程规则语法；
- 需要物化的远程规则内容可以通过 Host cache 获取，避免把不兼容 URL 直接交给目标客户端；
- 独立配置文本与生成 section 使用 named-entry merge，用户显式配置优先并避免重复条目。

新增 target 时应同时提供：

1. capability 定义；
2. generator；
3. importer；
4. validation/diagnostic；
5. UI target registry；
6. 规则集与远程订阅 source 处理；
7. 回归样例。

## ABI

当前后端 implementation ABI：

```text
config-generator@1
```

当前前端 implementation ABI：

```text
config-generator-ui@1
```

Host API 和 frontend API：

```text
1.0.0
```

ABI 内的增量应向后兼容。删除/重命名 SDK export、改变 activate/deactivate 语义、改变 route payload 或 storage schema 都可能需要新 ABI 与迁移。

## Storage

当前 schema version：

```text
1
```

legacy key：

```text
configGenerator
```

卸载代码默认保留 extension data。新版本必须能读取旧 schema，或提供在新代码激活后执行的显式数据迁移；install hook 当前禁止。

## Locale

当前配置生成器仍依赖 Host 全局 `configGenerator.*` zh/en/ru 文案。Host 版本过旧或 locale 未同步时，UI 可能显示 key。下一代 locale contribution 完成前，扩展前端和 Host locale 必须协调发布。

## 最低后端版本

Manifest 当前要求：

```text
Sub-Store backend >= 2.36.31
```

旧 Host 缺少 directory package、frontend SDK、package store 或扩展 lifecycle 时应拒绝安装，不要静默退回到不受验证的旧加载方式。
