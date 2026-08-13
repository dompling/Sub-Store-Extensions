# 规则集工作台与订阅体检：产品需求、架构决策与实施计划

状态：已规划，尚未开始实现  
计划日期：2026-08-13  
目标仓库：`Sub-Store`、`Sub-Store-Front-End`、`Sub-Store-Extensions`
复审状态：APPROVED（独立架构复审通过）

## 1. 结论先行

本次选择的正式方案是：

```text
Host Resource Broker（统一资源层）
    + 版本化 ResourceRef
    + 可修复的派生引用索引
    + 资源归档 / tombstone 生命周期
    + 现有 artifact source 的精确身份
```

两款插件的完整链路为：

```text
规则集工作台
  └─ 提供 substore.rule-set@1 资源
       ↓ ResourceRef，由 Host 解析当前提供者
配置生成器
  └─ 绑定策略组、排序并投影到 Surge / QX / Clash / Loon
       ↓ config-project artifact source
配置托管
  └─ 生成、发布、同步

Sub-Store 核心订阅 / 组合订阅
  └─ 由 Host 注册只读资源
       ↓ ResourceRef + substore-nodes-json
订阅体检
  └─ 生成只读、脱敏的健康报告
```

本方案不建立插件私有 RPC，不读取其他插件目录或 storage，不引入消息队列、服务总线、Redis、独立进程或新框架。规则集工作台不是配置生成器的硬安装依赖；配置生成器在它未安装时仍保留现有 URL、`SYSTEM`、`LAN` 能力。

## 2. 当前代码事实与问题根因

### 2.1 已有的可复用基础

- 插件集合已经按“一仓库多插件、每插件独立 ID/目录/数据/权限”组织，适合直接新增两款 executable 插件：[DEVELOPMENT.md](/Users/dompling/WebstormProjects/GIT/Sub-Store-Extensions/docs/DEVELOPMENT.md:5)。
- 配置生成器已经注册 `config-project` artifact source，证明“插件提供产物、配置托管消费产物”的方向可行：[index.js](/Users/dompling/WebstormProjects/GIT/Sub-Store-Extensions/extensions/org.substore.config-generator/backend/src/extensions/config-generator/index.js:699)。
- 配置托管前端已经动态读取启用插件提供的来源，不需要为每款插件增加硬编码入口：[SyncEditor.vue](/Users/dompling/WebstormProjects/GIT/Sub-Store-Front-End/src/views/SyncEditor.vue:565)。
- 后端对内置订阅、组合订阅、文件和规则已经有统一生产函数；未知内置类型会交给插件 adapter：[sync.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/restful/sync.js:268)、[sync.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/restful/sync.js:947)。
- 插件路由每次请求都会重新检查当前生命周期状态，不会在停用或升级后继续调用旧处理器闭包：[registry.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/extensions/registry.js:176)。
- 卸载默认删除代码、保留数据，适合通过相同插件 ID 重装后恢复资源引用：[manager.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/extensions/manager.js:4225)、[EXTENSION-SPEC.md](/Users/dompling/WebstormProjects/GIT/Sub-Store-Extensions/docs/EXTENSION-SPEC.md:218)。

### 2.2 当前缺口

- Backend SDK 的资源服务目前只有 `listArtifacts()`，插件不能通过稳定接口发现和生产另一提供者的资源：[backend-sdk-v1.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/extensions/backend-sdk-v1.js:72)。
- artifact source 当前仅按 `type` 返回第一个匹配项；两个插件同时提供 `rule-set` 时会产生歧义：[registry.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/extensions/registry.js:60)。
- artifact source 尚未纳入 manifest contribution ID 的强校验，runtime 注册也主要只检查 `extensionId`；因此 contribution ID、type、contract、representation 和 permission scope 目前无法由 Host 保证：[contracts.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/extensions/contracts.js:88)、[manager.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/extensions/manager.js:2741)。
- Host 虽认识 `resources.list`、`resources.produce`、`references.manage-own` 等权限，但 `references.read-own` 尚不存在，且对应 capability 仍是不完整兼容层：[manager.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/extensions/manager.js:68)、[manager.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/extensions/manager.js:89)。
- Host 当前在 `initializeExtensionHost()` 内创建 SDK 后立即恢复/激活插件，而完整服务和 parser product 直到后续注册路由时才传入 `produceBuiltinArtifact`；Broker 若沿用这个顺序，激活时拿到的 SDK 会永久缺少 producer：[host.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/extensions/host.js:14)、[restful/index.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/restful/index.js:47)、[sub-store-1.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/products/sub-store-1.js:31)。
- SDK 目前只校验权限名称，不校验 permission scope：[backend-sdk-v1.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/extensions/backend-sdk-v1.js:9)。
- 配置生成器的规则集只能是 URL 或内置规则，无法保存插件资源引用：[contracts.d.ts](/Users/dompling/WebstormProjects/GIT/Sub-Store-Extensions/extensions/org.substore.config-generator/frontend/src/extensions/config-generator/contracts.d.ts:83)、[validation.js](/Users/dompling/WebstormProjects/GIT/Sub-Store-Extensions/extensions/org.substore.config-generator/backend/src/extensions/config-generator/validation.js:373)。
- 配置生成器的规则集仍保存在自己的 schema v1 storage 中：[store.js](/Users/dompling/WebstormProjects/GIT/Sub-Store-Extensions/extensions/org.substore.config-generator/backend/src/extensions/config-generator/store.js:3)。
- 配置托管的 TypeScript 类型仍把来源固定为四种，和运行时的动态插件来源不一致：[artifacts.d.ts](/Users/dompling/WebstormProjects/GIT/Sub-Store-Front-End/src/types/store/artifacts.d.ts:23)。
- 现有脚手架只创建 content 插件；两个新插件不能直接使用：[create-extension.mjs](/Users/dompling/WebstormProjects/GIT/Sub-Store-Extensions/scripts/create-extension.mjs:25)。

根因不是“系统完全没有插件联动”，而是现在只有“配置托管消费插件产物”这一条单向链路，缺少插件作为资源消费者时的稳定 Host 门面、精确提供者身份和引用生命周期。

## 3. 目标与非目标

### 3.1 本期目标

1. 在 `Sub-Store-Extensions` 新增：
   - `org.substore.rule-studio`（规则集工作台）
   - `org.substore.subscription-doctor`（订阅体检）
2. 规则集工作台能导入、规范化、诊断并输出 Surge、Quantumult X、Clash/Mihomo、Loon 规则集。
3. 配置生成器能发现任意实现 `substore.rule-set@1` 的插件资源，而不是硬编码规则集工作台。
4. 配置项目保存稳定资源引用；规则集改名、插件升级后引用仍有效。
5. 配置托管能直接发布规则集工作台产物，也能继续发布引用规则集工作台的配置项目。
6. 订阅体检能只读分析 Sub-Store 现有订阅和组合订阅，生成协议、重复、结构与四端兼容性报告。
7. 所有过滤、近似转换、缓存降级和资源不可用都产生结构化诊断，不静默丢失。
8. 保持轻量：不新增架构级服务和不必要依赖，不在后台自动轮询或定时体检。

### 3.2 明确非目标

- 不做插件之间的私有 HTTP RPC、跨插件源码 import、跨插件 storage 或安装目录读取。
- 不做通用事件总线、消息队列、服务网格、插件依赖求解器或自动连带安装。
- 不把 executable 插件描述成真正安全沙箱；它们仍与 Host 共享 Node/浏览器进程上下文，现状见 [DEVELOPMENT.md](/Users/dompling/WebstormProjects/GIT/Sub-Store-Extensions/docs/DEVELOPMENT.md:53)。
- 规则集工作台不保存策略组绑定，不生成完整客户端配置，不负责发布完整配置。
- 订阅体检首版不做真实代理延迟、带宽、UDP、流媒体解锁、拨号测试或自动修复。
- 订阅体检首版不修改原订阅、不生成衍生订阅、不做定时任务和通知。
- 不自动迁移并删除配置生成器现有 URL/builtin 规则集；旧数据继续原样可用。
- 不在本期给核心订阅/组合订阅全面迁移 UUID；核心资源 v1 暂时以当前名称作为 provider-defined ID，规则集工作台自身必须从第一版使用稳定 UUID。
- 不在本期引入通用公共“任意资源下载”路由。配置生成器继续拥有其配置内的规则集下载入口；规则集直接发布则复用配置托管。

## 4. 架构决策记录（ADR）

### 4.1 Decision

通过 Host Resource Broker 完成跨插件资源发现、生产和生命周期检查；以现有 artifact source 为提供者注册机制，补足精确 contribution identity、版本化 ResourceRef、结果 envelope、资源归档语义和可修复的派生引用索引。

### 4.2 Drivers

1. 插件停用、卸载、更新、回滚后不能留下旧代码闭包或静默损坏引用。
2. 同一种资源类型未来可能由多个插件提供，必须消除 `type` first-match 歧义。
3. 项目定位轻量，优先补齐现有资源链路，不建设另一套插件 RPC 平台。

### 4.3 Alternatives considered

#### A. 插件直接调用另一个插件的 namespaced API

拒绝。消费者会依赖具体插件 ID、路由、payload 和实现 ABI；提供者停用或升级后难以保证行为，且无法统一做权限、引用和版本检查。

#### B. 插件读取另一个插件的 storage 或安装目录

拒绝。这会绕过 Host 边界，破坏卸载、回滚、包完整性和数据所有权。

#### C. 仅使用导出/导入复制

保留为将来的手动迁移能力，不作为正式联动。复制后的规则不会随来源 revision 更新，也无法正确表达 provider 状态。

#### D. 建设消息队列、服务总线或通用插件 RPC

拒绝。当前联动是查询/生产型资源调用，三项同步 API 已足够；通用总线增加持久化、重试、订阅和并发语义，超出轻量项目需要。

#### E. 用跨插件 storage + 引用图事务支持物理删除

拒绝作为 MVP。配置生成器项目保存在插件 storage，引用图保存在 Host store，新增跨存储事务会显著扩大 Host 边界。首版使用归档/tombstone：归档后不再出现在新选择列表，但已有 ResourceRef 仍可读取和生产；引用索引用于“被几个项目使用”的提示和修复，不作为物理删除安全性的唯一依据。

### 4.4 Why chosen

现有 registry、artifact source、配置托管发现和生命周期 guard 已经覆盖大部分基础。Resource Broker 只需把“按 type 找第一个”提升为“按 provider/contribution 精确解析”，并把 SDK 的只读资源门面补完整，改动最小且能自然支持后续第三方规则提供者、节点整理器和发布器。

### 4.5 Consequences

- 实施会跨三个仓库，而不是只新增两个插件目录。
- 资源契约版本和插件 semver 必须分离；插件升级不应让 `substore.rule-set@1` 引用失效。
- 配置生成器仍不依赖 Rule Studio 或任何具体规则插件；升级后的版本只依赖 Host 的通用 `resource-broker@1`，并在没有外部规则 provider 时继续使用 URL/builtin。
- 配置项目需要一个可从客户端访问的后端公开地址，才能把插件资源包装成 Surge/QX/Clash/Loon 远程规则 URL。
- 现有、且确实没有 `sourceRef` 的 type-only artifact 数据继续走 legacy 路径；所有新数据必须保存完整 ResourceRef 和明确 representation。
- 只要记录中存在 `sourceRef`，运行时就严格依赖 Broker；`type/source` 仅用于显示、备份和旧格式导出，绝不作为失败后的隐式回退。
- 第一版不提供规则集物理 purge；用户操作“删除”实际为可恢复归档。

### 4.6 Follow-ups

- 后续可在 ResourceDescriptor 上增加由 Host 解释的通用 `actions`，实现“从配置生成器打开资源所属插件的编辑页”，但本期不硬编码插件路由。
- 后续可让订阅体检注册只读的 `diagnosed-subscription` / `subscription-derived` 资源；第一版不修改或替代原订阅。
- 后续可为核心订阅和组合订阅引入稳定 UUID，并提供名称型 ResourceRef 的兼容迁移。

## 5. Host Resource Broker 契约

### 5.1 新 Host capability

新增明确 capability：

```text
resource-broker@1
```

原因：旧 Host 当前把 `resource-producer@1` 标记为 `compatibility-adapter`，安装检查仍视为可用：[manager.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/extensions/manager.js:2589)。使用新的 capability 名称，旧后端会在安装阶段拒绝依赖它的插件，而不是安装后才出现 `resources.produce is not a function`。

规则集工作台和订阅体检硬依赖 `resource-broker@1`；配置生成器升级后的版本也硬依赖该 capability。URL/builtin 的业务能力仍然独立于 Rule Studio 插件，但已升级的配置生成器本身需要 Broker 才能保证统一 SDK 形状、引用迁移和生命周期语义。旧 Host 继续安装其兼容版本，repository/Host preflight 不把新包发给不支持的后端。

### 5.2 `substore.resource-ref@1`

```ts
interface ResourceRefV1 {
  schema: 'substore.resource-ref@1'
  providerId: string
  providerContributionId: string
  type: string
  id: string
  contract: string
}
```

规则集工作台示例：

```json
{
  "schema": "substore.resource-ref@1",
  "providerId": "org.substore.rule-studio",
  "providerContributionId": "org.substore.rule-studio.rule-sets",
  "type": "rule-set",
  "id": "rs_7bce398f-86fc-4ad6-a97f-f0fddbc8f37e",
  "contract": "substore.rule-set@1"
}
```

核心订阅示例：

```json
{
  "schema": "substore.resource-ref@1",
  "providerId": "org.substore.core",
  "providerContributionId": "org.substore.core.subscriptions",
  "type": "subscription",
  "id": "Y2 自用",
  "contract": "substore.subscription@1"
}
```

规则：

- `providerId` 是插件/核心提供者身份。
- `providerContributionId` 是 manifest 中 namespaced artifact source ID。
- `type` 用于筛选和 permission scope，不能用于唯一解析提供者。
- `id` 由提供者解释。规则集工作台使用 Node `crypto.randomUUID()` 生成稳定 ID；改名不改 ID。
- `contract` 对所有 `schema=substore.resource-ref@1` 的新引用必填，用于 major 兼容检查。核心订阅使用 `substore.subscription@1`，核心组合订阅使用 `substore.collection@1`，规则集使用 `substore.rule-set@1`。
- 只有没有 `schema/sourceRef` 的真正 legacy type/source 数据可以缺少 contract；Host 不把它补成伪造的精确 ResourceRef。
- 新代码禁止仅保存 `{ type, name }` 作为跨插件引用。

### 5.3 `substore.resource-descriptor@1`

```ts
interface ResourceDescriptorV1 {
  schema: 'substore.resource-descriptor@1'
  ref: ResourceRefV1
  name: string
  displayName?: string
  description?: string
  revision?: string | number
  updatedAt?: number
  contracts: string[]
  representations: string[]
  lifecycle: {
    state: 'active' | 'archived'
    archivedAt?: number
  }
  availability: {
    status: 'available' | 'disabled' | 'missing' | 'incompatible' | 'updating'
    reasonCode?: string
  }
  metadata?: Record<string, string | number | boolean | null>
}
```

默认 `resources.list()` 只返回 `lifecycle.state=active` 的条目；消费者持有精确 ResourceRef 时，`resources.get()` 和 `resources.produce()` 仍可访问 archived 条目。这样用户不能把归档资源再绑定到新项目，但旧配置不会因为一次删除操作而断裂。列表和 descriptor 不得暴露完整订阅 URL、Authorization header、token、节点凭据、规则正文或插件 storage。

### 5.4 `substore.resource-output@1`

```ts
interface ResourceOutputV1 {
  schema: 'substore.resource-output@1'
  ref: ResourceRefV1
  representation: string
  body: string
  mediaType: string
  sourceRevision?: string | number
  etag?: string
  freshness: {
    state: 'fresh' | 'stale'
    fetchedAt?: number
    expiresAt?: number
  }
  diagnostics: DiagnosticV1[]
}
```

旧 artifact adapter 返回字符串时，Host 自动包装：

```ts
{
  schema: 'substore.resource-output@1',
  body: oldResult,
  mediaType: 'text/plain',
  freshness: { state: 'fresh' },
  diagnostics: []
}
```

配置托管旧路径只取 `body`，无需一次性重写所有生产逻辑。

### 5.5 `substore.diagnostic@1`

```ts
interface DiagnosticV1 {
  schema: 'substore.diagnostic@1'
  severity: 'info' | 'warning' | 'error'
  code: string
  message: string
  path?: string
  sourceLine?: number
  details?: Record<string, unknown>
}
```

跨端转换必须使用以下结果等级：

```text
exact     等价表达
fallback  使用安全近似，明确说明语义差异
filtered  没有合理表达，从目标输出删除并产生 diagnostic
invalid   源内容本身非法
```

### 5.6 SDK 最小 API

在 Backend SDK v1 上做向后兼容的 additive 扩展，保留 `resources.listArtifacts()`：

```ts
resources.list({
  types?: string[]
  contracts?: string[]
  providerIds?: string[]
}): Promise<ResourceDescriptorV1[]>

resources.get(ref: ResourceRefV1): Promise<ResourceDescriptorV1>

resources.produce(
  ref: ResourceRefV1,
  options: {
    representation: string
    target?: string
    freshnessPolicy?: 'fresh' | 'allow-stale' | 'cache-only'
  }
): Promise<ResourceOutputV1>
```

不增加事件订阅、远程调用发现、后台队列或任意方法调用。

### 5.7 权限与 scope

- `resources.list`：只能列出 permission scope 中声明的资源类型。
- `resources.read`：只能读取 permission scope 中声明的 resource descriptor；`resources.get()` 使用该权限。
- `resources.produce`：只能生产 permission scope 中声明的资源类型。
- `references.manage-own`：只能写入 `owner.providerId === 当前插件 ID` 的引用边。
- `references.read-own`：只能查询 `target.providerId === 当前插件 ID` 的 incoming refs；不能读取其他提供者的引用关系。
- scope 使用规范的单数资源类型：`subscription`、`collection`、`rule-set`、`config-project`；Host 可兼容已有 plural scope，但新 manifest 统一使用单数。

scope 是 API 约束、误用防护和权限提示，不宣称能防住同进程中的恶意 executable 插件。

### 5.8 精确 provider 解析与旧数据兼容

artifact source runtime adapter 增加：

```ts
{
  id: 'org.substore.rule-studio.rule-sets',
  type: 'rule-set',
  contract: 'substore.rule-set@1',
  representations: [...],
  list(),
  get(id),
  produce(...)
}
```

Host 解析与注册规则：

1. 只要调用输入含 `sourceRef` / ResourceRef，就必须严格使用 `providerId + providerContributionId + type`；provider 缺失、停用、contract 不兼容或 Host 缺少 Broker 时直接失败，禁止回退到 type-only。
2. 只有真正没有 `sourceRef` 的历史 artifact 才允许 legacy type-only 路径；若当前存在多个同 type provider，返回 `RESOURCE_PROVIDER_AMBIGUOUS`，不得按注册顺序取第一个。
3. manifest 的 `contributes.artifactSources[]` 必须纳入 namespaced ID 和重复 ID 校验。
4. runtime artifact source 必须显式携带 `id/type/contract/representations`；不再根据“唯一同 type contribution”猜测缺失 ID。为了兼容旧插件，旧 Host adapter 只可继续走 legacy type-only 路径，不能生成新的精确 ResourceRef。
5. 激活时 Host 验证 runtime contribution 已在 manifest 声明、ID/type/contract 一致、runtime representations 是 manifest 声明集合的子集或完全一致，并验证插件已申请 `artifact-source.register` 且 scope 包含对应 type。
6. 未声明 contribution、ID 重复、permission scope 不符、type/contract 不一致或 representation 越权均使激活失败；激活回滚必须注销本次已注册的 adapter/contribution。
7. 每次 `produce` 动态解析当前 adapter；不得把 provider 函数长期缓存到消费者插件中。

兼容门禁采用显式新旧通道，而不是一次性破坏现有已安装插件：

- manifest 声明 hard capability `resource-broker@1` 的 provider 必须满足上述完整严格契约，才能进入 Broker 和生成 ResourceRef。
- 未声明该 capability 的既有 provider 可以继续注册为 `legacy-artifact-source`，维持旧配置托管 type-only 行为，但不出现在 `resources.list()`，也不能被新 artifact 保存为 sourceRef。
- 升级后的 Config Generator 同时更新 manifest/runtime `config-project` contribution 的 `id/contract/representations`；Host 升级后、插件尚未升级的短窗口仍可按 legacy 路径使用，不会导致已有配置托管项目突然失效。

### 5.9 Broker 初始化顺序与 product lane

Broker 必须在插件 restore/activate 之前完整构造，而不是在注册扩展 HTTP 路由时补 producer：

```ts
initializeExtensionHost({
  executionLane: 'parser',
  produceBuiltinArtifact
})
```

执行约束：

- 本期两款新插件和升级后的 Config Generator 正式支持目标是完整 Node 后端；manifest 保持 `runtime: node`，安装、启用、更新和管理都由完整 Node Host 完成。
- 完整 Node 服务在调用 `initializeExtensionHost()` 时就注入 `produceBuiltinArtifact`；`createServices()` 冻结 SDK 前 Broker 已具备 list/get/produce。
- `sub-store-1` parser product 可同步注入核心 producer，供现有内置/嵌入式 parser 路径复用，但它不因此获得安装第三方 Node executable 的能力。
- Host capability 按当前 product/lane 投影。只有实际注入 producer 的进程声明完整 `resource-broker@1`；`sub-store-0` simple product 不宣称拥有完整 Broker，也不负责激活硬依赖 Broker 的 executable 后端。
- `sub-store-0` simple product 可继续承载其现有内置简单路由，但不宣称完整 Broker，也不激活 hard-require `resource-broker@1` 的 Node executable；Rule Studio 的解析/生产、Config Generator 的生成、Subscription Doctor 的体检，以及所有 `resources.produce()` 调用固定在完整 Node Host 的 parser lane。
- 完整 Node 单进程服务同时承载 simple/parser routes，但 Broker 只构造一次并在激活前注入完整 producer。
- repository preflight、manifest lane 声明和 Host capability 必须一致；不允许安装阶段显示兼容、进入页面后才发现 producer 不存在。

### 5.10 核心资源提供者

Host 注册两个只读提供者：

```text
org.substore.core.subscriptions  → substore.subscription@1
org.substore.core.collections    → substore.collection@1
```

支持表示：

```text
substore-nodes-json
```

实现复用现有 `produceBuiltinArtifact()`，使用 `platform: 'JSON'`、`produceType: 'internal'` 和 `noFlow: true`，再序列化为 JSON 字符串；不让插件读取 `SUBS_KEY`、`COLLECTIONS_KEY` 或原始数据库根对象。现有 producer 会返回内部节点列表的行为可从 [proxy-utils/index.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/core/proxy-utils/index.js:412) 和 [sync.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/restful/sync.js:500) 复用。

第一版的核心资源体检定义为“最终有效资源体检”：检查经过 Sub-Store 现有下载、解析和 processor 后的节点结果。它不承诺逐个展示隐藏的多 URL 原始正文或被核心 parser 静默拒绝的每一行；这些需要将 parser diagnostics 正式化后再扩展，不能让插件绕过核心直接读取敏感配置。

### 5.11 可修复的派生引用索引

新增：

```ts
references.replaceOwn({ owner: ResourceRefV1, targets: ResourceRefV1[] })
references.listIncoming(target: ResourceRefV1)
```

约束：

- 配置生成器激活时、项目/规则集 CRUD 后扫描全部项目，重建 `config-project → rule-set` 引用；提供内部“重建自身引用索引”操作供故障修复和升级迁移调用。
- 删除配置项目时将 owner targets 替换为空。
- Rule Studio 使用 `references.read-own` 展示 incoming 数量和脱敏使用方；归档时若存在引用，必须明确提示“现有配置继续可用，但不能再新建引用”。
- 项目 storage 保存与 `references.replaceOwn()` 是两次独立写入，因此引用索引被定义为可重建的派生数据，不承诺跨 storage 事务一致性，也不能作为物理删除的唯一安全条件。
- 第一版的“删除”只把项目标记为 `archived`；普通列表和新建选择器隐藏它，已有精确 ResourceRef 仍可 get/produce，并可从归档列表恢复。
- 第一版不开放物理 purge，不级联删除，不自动修改配置项目。
- 插件停用或卸载时引用图保留；重装同 ID 后恢复。
- 引用存储使用独立 schema v1；单次 `replaceOwn()` 对 Host store 原子写入，但不宣称和插件私有 storage 组成同一事务。

Host 目前明确因为引用清理未事务化而禁止 purge：[manager.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/extensions/manager.js:4898)。本期只完成上述两项最小能力，不顺带开放通用 purge。

## 6. 规则集工作台产品方案

### 6.1 插件身份

```text
ID：org.substore.rule-studio
名称：规则集工作台
初始版本：0.1.0
kind：executable
runtime：node
资源契约：substore.rule-set@1
artifact source：org.substore.rule-studio.rule-sets
```

### 6.2 职责边界

负责：

- 规则内容获取、格式识别、解析、规范化和诊断。
- 多来源顺序合并与精确去重。
- Surge、QX、Clash/Mihomo、Loon 目标规则集序列化。
- HTTP 缓存、ETag、Last-Modified、last-known-good 和 stale 标记。
- 差异预览、复制和文件导出。
- 注册 `rule-set` 资源和可被配置托管选择的 artifact source。

不负责：

- `Advertising → REJECT` 等策略组绑定。
- 配置项目中的规则顺序、规则备注和 `no-resolve` 绑定选项。
- 完整客户端配置、订阅节点或配置发布。

### 6.3 数据模型

```ts
interface RuleStudioStoreV1 {
  schemaVersion: 1
  projects: RuleSetProjectV1[]
}

interface RuleSetProjectV1 {
  id: string
  name: string
  description?: string
  lifecycle: {
    state: 'active' | 'archived'
    archivedAt?: number
  }
  sources: RuleSetSourceV1[]
  options: {
    deduplicate: true
    preserveComments: boolean
  }
  revision: number
  createdAt: number
  updatedAt: number
  lastSummary?: RuleSetSummaryV1
}

type RuleSetSourceV1 =
  | {
      id: string
      kind: 'url'
      name?: string
      url: string
      enabled: boolean
      format: RuleSetFormat | 'auto'
    }
  | {
      id: string
      kind: 'inline'
      name?: string
      content: string
      enabled: boolean
      format: RuleSetFormat | 'auto'
    }
```

URL 仅接受绝对 HTTP(S)。storage 保存用户输入和小型摘要；远程完整正文、规范化大数组和目标输出放入插件前缀缓存，不重复写进主 store。归档只改变 lifecycle 和 revision，不清空 sources/cache；恢复后继续使用同一稳定 ID。

### 6.4 统一规则模型

```ts
interface NormalizedRuleV1 {
  type:
    | 'domain'
    | 'domain-suffix'
    | 'domain-keyword'
    | 'ip-cidr'
    | 'ip-cidr6'
    | 'geoip'
    | 'ip-asn'
    | 'process-name'
    | 'process-path'
    | 'url-regex'
    | 'user-agent'
    | 'dst-port'
    | 'src-port'
    | 'src-ip-cidr'
    | 'protocol'
    | 'network'
    | 'logical'
    | 'unsupported'
  value: string
  operands?: string[]
  options?: string[]
  comment?: string
  source: {
    sourceId: string
    line: number
    raw: string
    format: string
  }
}
```

规范化规则：

- 域名小写；CIDR 使用规范形式；路径和正则保留大小写。
- 去重 key 使用 `type + normalized value/operands + semantic options`，保留第一次出现位置并为后续重复项产生 diagnostic。
- 输入中若包含策略名称，规则工作台不保存该策略绑定，产生 `SOURCE_POLICY_IGNORED` 提示。
- 注释在目标支持时保留；无法保留时产生 info/warning，不影响有效规则。
- parser/serializer 采用纯函数，不修改输入对象。

### 6.5 输入与输出

首版输入：

- HTTP(S) URL。
- 手动粘贴文本。
- 本地文件由前端读取成文本后走同一 inline 导入，不给后端开放任意文件系统读取。

识别格式：

- Surge rule list。
- Quantumult X remote filter。
- Loon remote rule list。
- Clash/Mihomo `classical` provider（YAML/text）。
- Clash/Mihomo `domain` provider。
- Clash/Mihomo `ipcidr` provider。

资源 representations：

```text
normalized-json
surge-rule-list
qx-filter
clash-classical-yaml
clash-classical-text
clash-domain-yaml
clash-ipcidr-yaml
loon-rule-list
```

Clash 行为判断：

- 混合规则默认 `classical`。
- 仅含域名类规则时允许 `domain`。
- 仅含 CIDR 类规则时允许 `ipcidr`。
- 用户请求的 behavior 与内容矛盾时返回 `RESOURCE_REPRESENTATION_UNSUPPORTED`，不生成看似成功但客户端无法解析的 provider。

### 6.6 缓存与失败策略

缓存 key：

```text
rule-set:<project-id>:<project-revision>:<source-id>:<parser-version>:<representation>
```

URL 不进入明文 key，使用 SHA-256 digest。缓存值保存正文/规范化结果、ETag、Last-Modified、fetchedAt、freshUntil、staleUntil 和内容 digest。

默认值：

| 项目 | 默认值 |
|---|---:|
| 单个远程响应最大值 | 10 MiB |
| 单项目启用来源上限 | 20 |
| 规范化规则上限 | 200,000 |
| HTTP 超时 | 15 秒 |
| 并发下载上限 | 4 |
| fresh TTL | 1 小时 |
| max stale | 7 天 |

行为：

- fresh cache 命中：直接返回。
- 过 fresh TTL：使用 ETag/Last-Modified 重新验证。
- 网络失败且存在未超过 max stale 的 last-known-good：返回 stale output，并产生 `RESOURCE_STALE`。
- 新内容可下载但解析失败：不覆盖 last-known-good；返回 stale output 和 `RESOURCE_CONTENT_INVALID` warning。
- 从未成功且当前失败：整体生产失败。
- 任一启用来源既无 fresh/stale 内容又失败：项目生产失败；首版不静默跳过该来源。
- 目标过滤后零条有效规则：生产失败，不发布空文件。
- 插件停用或卸载：Host 生命周期优先，不能绕过 provider 状态直接返回缓存。

### 6.7 UI

列表页：

- 延续现有插件和配置生成器的卡片语言，不使用宽表格。
- 顶部动作：搜索、添加、刷新；更多动作收进单一展开菜单。
- 项目卡显示名称、来源数、有效规则数、warning/error 数和上次更新时间。

编辑页：

- 基本信息、来源、规范化、输出预览四个区块。
- 编辑已有项目时所有可折叠区块默认收起，新增项目只展开基本信息和第一个来源。
- 来源支持拖拽排序；每个来源显示识别格式、缓存状态和错误状态。
- 输出预览以四端 tabs 展示；诊断使用底部弹层或独立详情，不在主页面堆满字段。
- 保存按钮固定在安全区域底部。

响应式标准：

- 320、375、768 和桌面宽度无页面级横向滚动。
- 点击区域不小于 44×44px。
- 大规则集预览分页/分段，不把 200,000 行一次渲染进 DOM。
- 深色模式下 exact/fallback/filtered/invalid 可区分，不能只依赖颜色。

### 6.8 Manifest 权限

```json
[
  { "name": "storage.own" },
  {
    "name": "network.fetch",
    "scope": ["user-configured-https", "user-configured-http"]
  },
  { "name": "artifact-source.register", "scope": ["rule-set"] },
  { "name": "references.read-own", "scope": ["rule-set"] },
  { "name": "routes.namespaced" },
  { "name": "navigation.register" }
]
```

硬依赖：`resource-broker@1`、`artifact-source-registry@1`、`route-gateway@1`。不声明配置生成器插件 ID 依赖。

Rule Studio 不申请 `references.manage-own`，只用 `references.read-own` 查询自身规则集的 incoming 索引；`references.manage-own` 只授予需要写 owner edges 的 Config Generator。

## 7. 配置生成器联动方案

### 7.1 数据模型升级

`RemoteRuleSet.source` 增加：

```ts
type RemoteRuleSetSource =
  | { kind: 'url'; url: string; target?: ConfigGeneratorTarget }
  | { kind: 'builtin'; value: 'SYSTEM' | 'LAN' }
  | {
      kind: 'resource'
      ref: ResourceRefV1
      expectedContract: 'substore.rule-set@1'
      lastKnownName?: string
    }
```

配置项目增加共享交付地址：

```ts
interface ConfigProject {
  delivery?: {
    publicBaseUrl?: string
  }
}
```

它用于把资源型规则包装成客户端可访问的配置生成器下载 URL。UI 在首次选择 resource source 时以当前 Host 地址自动填充；后端必须验证为绝对 HTTP(S)。现有 `outputs.clash.publicBaseUrl` 和远程订阅来源的地址继续作为兼容 fallback，不立即迁移或删除。

配置生成器 storage 升至 schema v2：

- v1 URL/builtin 原样读取。
- v2 支持 resource source 和 delivery。
- 不强制把旧 URL 导入规则集工作台。
- migration 为纯函数、幂等，不修改用户输入 URL。

### 7.2 发现与选择 UI

规则来源选择器按 contract 动态分组：

```text
本地来源
├─ URL
├─ SYSTEM
└─ LAN

插件资源
├─ 规则集工作台
│  ├─ 广告拦截
│  └─ OpenAI
└─ 其他实现 substore.rule-set@1 的插件
```

配置生成器不硬编码 `org.substore.rule-studio`。它从 `/api/extensions/artifact-sources` 获取 `id/contract/representations/items/status`，现有前端 API 已有但未实际使用：[api.ts](/Users/dompling/WebstormProjects/GIT/Sub-Store-Extensions/extensions/org.substore.config-generator/frontend/src/extensions/config-generator/api.ts:60)。

保存后：

- 真实身份来自 ResourceRef。
- `lastKnownName` 只在 provider 不可用时展示，不参与重新匹配。
- provider 未安装/停用时保留已有表单和引用，显示明确状态，不静默切回 URL。
- 第一版只提供“打开插件详情”；不硬编码资源编辑路由。

### 7.3 生成时的轻量投影

增加共享 helper，例如：

```text
backend/src/extensions/config-generator/core/resource-rule-set.js
```

生成流程：

1. 扫描当前目标实际使用的 resource rule sets。
2. 通过 `resources.get()` 检查 provider/contract/representation。
3. 通过 `resources.produce()` 生成当前目标内容，收集 diagnostics 和 freshness。
4. 计算配置生成器自身的下载 URL：

   ```text
   /download/config-project/:project/rule-set/:binding/:target
   ```

5. 只在本次生成内把 resource source 投影成目标所属的临时 URL source；不修改持久化项目。
6. 将已生产的 body 以 URL 为 key 放入本次 generation context。Clash generator 请求下载内容时直接命中该内存映射，不递归请求自己的 HTTP 路由。
7. Surge/QX/Loon 继续使用现有远程规则序列化；Clash 继续使用现有 sanitize/provider 逻辑。

这能最大化复用当前 `resolveRuleSetSource()` 和四端 generator，避免在配置生成器内再实现一套规则 parser/serializer。当前规则集解析中心在 [rule-set-source-resolver.js](/Users/dompling/WebstormProjects/GIT/Sub-Store-Extensions/extensions/org.substore.config-generator/backend/src/extensions/config-generator/core/rule-set-source-resolver.js:258)，Clash 已有配置内规则缓存 URL：[generator.js](/Users/dompling/WebstormProjects/GIT/Sub-Store-Extensions/extensions/org.substore.config-generator/backend/src/extensions/config-generator/targets/clash/generator.js:114)。

目标 representation 映射：

| 配置目标 | Resource representation |
|---|---|
| Surge | `surge-rule-list` |
| QX | `qx-filter` |
| Loon | `loon-rule-list` |
| Clash classical/yaml | `clash-classical-yaml` |
| Clash classical/text | `clash-classical-text` |
| Clash domain | `clash-domain-yaml` |
| Clash ipcidr | `clash-ipcidr-yaml` |

下载路由从“仅 Clash”扩展为四个目标。URL/builtin 旧行为不变；resource source 则调用 Broker。当前路由的 Clash-only 门禁位于 [index.js](/Users/dompling/WebstormProjects/GIT/Sub-Store-Extensions/extensions/org.substore.config-generator/backend/src/extensions/config-generator/index.js:573)。

### 7.4 职责保持

配置生成器仍负责：

- 规则绑定哪个策略组。
- 规则顺序、备注、启用状态、`no-resolve`。
- Clash provider key、format、behavior。
- 独立配置融合和最终配置输出。

规则集工作台只提供规则内容和兼容性诊断。它不保存 `Advertising → REJECT` 等配置项目语义。

### 7.5 生命周期行为

| 场景 | 行为 |
|---|---|
| 规则集改名 | ResourceRef 不变；下次列表更新显示名 |
| 规则集更新 | 下次预览/生成使用最新 sourceRevision |
| 插件停用 | 项目和引用保留；生成返回 `RESOURCE_PROVIDER_DISABLED` |
| 插件卸载 | 项目和引用保留；显示需要重装 |
| 相同插件 ID 重装 | ResourceRef 自动恢复 |
| 用户删除规则集 | 转为 archived；新选择器隐藏，已有 ResourceRef 继续生产，可从归档列表恢复 |
| contract major 不支持 | 返回 `RESOURCE_CONTRACT_INCOMPATIBLE` |
| provider 返回 stale | 配置继续生成，但预览明确显示 stale warning |
| provider 无输出 | 生成失败；配置托管不得覆盖上一次成功内容 |

## 8. 订阅体检产品方案

### 8.1 插件身份

```text
ID：org.substore.subscription-doctor
名称：订阅体检
初始版本：0.1.0
kind：executable
runtime：node
```

### 8.2 MVP 输入与范围

首版输入：

- Sub-Store 现有订阅。
- Sub-Store 现有组合订阅。

通过：

```ts
resources.list({ types: ['subscription', 'collection'] })
resources.produce(ref, {
  representation: 'substore-nodes-json',
  freshnessPolicy: 'fresh'
})
```

首版不支持直接粘贴任意订阅或临时 URL 的完整节点解析，因为插件不应复制 Sub-Store 的全部 proxy parser，也不应读取核心数据库/私有解析模块。将来若 Host 增加受控的 transient source contract，再按同一分析管线接入。

### 8.3 检查内容

- 资源是否存在、provider 是否可用、生产是否成功和总耗时。
- 有效节点总数、协议分布。
- 缺少规范化后的必填字段。
- 空名称、异常端口、无效服务地址格式。
- 精确重复节点。
- 重名但内容不同的节点。
- Surge、QX、Clash/Mihomo、Loon 兼容性矩阵：exact/fallback/filtered/unknown。
- 和同一 ResourceRef 上一次报告比较：节点数、协议数、重复数、四端兼容数变化。
- 导出脱敏 JSON 和 Markdown 报告。

重复指纹在内存中使用：

```text
SHA-256(protocol + server + port + credential identity + transport/TLS core fields)
```

报告只保存 hash 和摘要，不保存 server、UUID、密码、私钥或完整节点正文。

### 8.4 数据模型

```ts
interface SubscriptionDoctorStoreV1 {
  schemaVersion: 1
  reports: SubscriptionHealthReportV1[]
}

interface SubscriptionHealthReportV1 {
  id: string
  sourceRef: ResourceRefV1
  lastKnownName?: string
  sourceRevision?: string | number
  checkedAt: number
  durationMs: number
  status: 'healthy' | 'warning' | 'error'
  counts: {
    total: number
    invalid: number
    duplicate: number
    duplicateName: number
  }
  protocols: Record<string, number>
  targets: Record<
    'surge' | 'qx' | 'clash' | 'loon',
    { exact: number; fallback: number; filtered: number; unknown: number }
  >
  diagnostics: DiagnosticV1[]
  snapshotHash: string
}
```

轻量保留策略：

- 最多保存最近 20 份报告。
- 不保存完整节点数组。
- 同一来源的 diff 使用最近一份报告。
- 删除报告同时清理插件自身相关索引；公共资源缓存仍由 Host/提供者管理。

### 8.5 兼容性判断

插件维护一个小型、版本化、纯函数 compatibility registry，输入为 Host 规范化节点对象，输出四端状态和 diagnostic。

原则：

- 每个判断必须有官方文档 fixture 或项目现有 producer 回归作为依据。
- 未识别的新协议/字段显示 `unknown`，不能默认兼容。
- 只有存在明确且安全的降级时标记 fallback。
- 不调用真实代理，不读取或回传凭据。

### 8.6 UI

首页保持极简：

- 来源选择器。
- 最近一次结果摘要（如存在）。
- 主按钮“开始体检”。

结果页：

1. 总评和四个核心数字。
2. 四端兼容性概览。
3. 错误、警告、重复、协议分组。
4. 与上次结果的变化。
5. 搜索/严重级别筛选和脱敏导出。

大列表分页/分段；不一次渲染 10,000 节点详情。原始节点详情不进入持久报告；当前运行需要展示时使用脱敏弹层。

### 8.7 Manifest 权限

```json
[
  { "name": "storage.own" },
  { "name": "resources.list", "scope": ["subscription", "collection"] },
  { "name": "resources.read", "scope": ["subscription", "collection"] },
  { "name": "resources.produce", "scope": ["subscription", "collection"] },
  { "name": "routes.namespaced" },
  { "name": "navigation.register" }
]
```

首版不需要 `network.fetch`，因为只消费 Host 已有资源；这比再次获取并暴露订阅 URL 更符合最小权限。

## 9. 配置托管联动

### 9.1 数据模型

在保留旧字段的同时增加：

```ts
interface Artifact {
  sourceRef?: ResourceRefV1
  representation?: string
  type: string
  source: string
}
```

- 新增动态插件来源时保存 `sourceRef + representation`；`type/source` 同时保留用于 UI 显示、备份和旧格式导出，但不参与新记录的运行时 provider 回退。
- `representation` 必须是保存时 descriptor 已声明的具体值。Surge/QX/Loon 即使当前各只有一个表示，也保存明确值；Clash 的 classical YAML/text、domain、ipcidr 必须由用户明确选择。
- 旧 artifact 没有 `sourceRef` 时继续 type-only 路径。
- 只要 artifact 含 `sourceRef`，生产就严格按 `sourceRef + representation` 解析；Broker 不可用、provider 不可用或表示不兼容时 fail closed，绝不回退 `type/source`。
- legacy artifact 没有 `sourceRef` 且当前出现多个同 type provider 时，返回 `RESOURCE_PROVIDER_AMBIGUOUS`，要求用户重新选择明确来源。
- ArtifactType 从固定联合类型调整为可扩展 string + 已知类型辅助，不让 TypeScript 阻止 `rule-set` 等插件来源。

### 9.2 UI

- picker 使用 contribution ID 区分相同 type 的多个 provider。
- 已安装且启用的 Rule Studio 显示其规则集条目。
- 目标/格式选择来自 descriptor 的 `representations`；UI 可按平台分组和为唯一项自动选择，但最终保存的始终是具体 representation，不对 `rule-set` 写死。
- provider 停用/卸载后，已有 artifact 仍展示 last-known source，并显示不可用状态。
- 配置托管失败时保留上一次成功 URL/内容；不能上传空输出或错误页。

## 10. 错误语义

| HTTP | code | 含义 |
|---:|---|---|
| 400 | `RESOURCE_REF_INVALID` | ResourceRef 缺失或格式错误 |
| 400 | `RESOURCE_REPRESENTATION_UNSUPPORTED` | 请求的目标表示不受支持 |
| 403 | `EXTENSION_PERMISSION_DENIED` | 未声明权限 |
| 403 | `EXTENSION_PERMISSION_SCOPE_DENIED` | 权限 scope 不包含资源类型 |
| 404 | `RESOURCE_NOT_FOUND` | provider 存在但 item 不存在 |
| 409 | `RESOURCE_PROVIDER_NOT_INSTALLED` | 提供插件未安装 |
| 409 | `RESOURCE_PROVIDER_DISABLED` | 提供插件已停用 |
| 409 | `RESOURCE_PROVIDER_UPDATING` | 提供插件正在更新 |
| 409 | `RESOURCE_PROVIDER_AMBIGUOUS` | legacy type-only 记录匹配到多个 provider |
| 409 | `RESOURCE_CONTRACT_INCOMPATIBLE` | contract major 不兼容 |
| 409 | `RESOURCE_REVISION_CONFLICT` | 乐观更新 revision 冲突 |
| 413 | `RESOURCE_CONTENT_TOO_LARGE` | 输入超过限制 |
| 422 | `RESOURCE_CONTENT_INVALID` | 内容可获取但无法产生有效资源 |
| 502 | `RESOURCE_UPSTREAM_FETCH_FAILED` | 上游请求失败且无可用缓存 |
| 504 | `RESOURCE_UPSTREAM_TIMEOUT` | 上游超时且无可用缓存 |

`fallback`、`filtered`、stale、注释丢失等不直接抛异常，而是通过 diagnostics 返回；过滤后没有任何有效输出时升级为生产失败。

## 11. 隐私与安全边界

- 日志不得打印完整 URL query、Authorization、订阅正文、节点密码、UUID、私钥。
- UI 默认掩码 token、用户名、密码和私有 URL query。
- 缓存 key 使用 URL/凭据摘要，不使用明文。
- 订阅体检报告默认脱敏，且不保存完整节点对象。
- 插件不向第三方分析服务上传内容。
- ResourceDescriptor 不暴露原始资源配置。
- 错误 envelope 不返回堆栈和敏感 payload。
- executable 插件仍是显式信任代码；permission scope 不能替代未来的进程/沙箱隔离。

## 12. 文件级实施计划

### Phase 0：executable 脚手架和开发边界

仓库：`Sub-Store-Extensions`

1. 扩展 [create-extension.mjs](/Users/dompling/WebstormProjects/GIT/Sub-Store-Extensions/scripts/create-extension.mjs:25)，增加 `--kind executable` 的最小模板，或拆出同一脚本内的 executable builder。
2. 模板生成 manifest、package-entry、SDK binder、Vue runtime-entry、routes、API/store、基础测试和构建配置；不复制配置生成器业务代码。
3. 更新 [DEVELOPMENT.md](/Users/dompling/WebstormProjects/GIT/Sub-Store-Extensions/docs/DEVELOPMENT.md:117)，写明 executable 创建、开发、单插件测试、打包和本地 Host 联调命令。
4. 给脚手架增加 Node test，锁定目录身份、manifest ID、packageDirectory 和不覆盖已有目录。

### Phase 1：Host Resource Broker 与引用图

仓库：`Sub-Store/backend`

1. 新增 `src/extensions/resource-contracts.js`：ResourceRef、descriptor、output、diagnostic 的纯验证/规范化函数。
2. 新增 `src/extensions/resource-broker.js`：
   - 注册核心 subscription/collection descriptors。
   - 精确解析插件 contribution。
   - 实现 list/get/produce 和旧字符串结果包装。
   - 每次调用重新解析当前 provider 生命周期。
3. 修改 [registry.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/extensions/registry.js:60)：
   - adapter identity 使用 contribution ID。
   - `listArtifactSources()` 返回 `id/contract/representations/revision`。
   - type-only 兼容函数只服务没有 sourceRef 的历史数据，并在多 provider 时返回 `RESOURCE_PROVIDER_AMBIGUOUS`。
4. 修改 [backend-sdk-v1.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/extensions/backend-sdk-v1.js:46)：
   - 增加 resources.list/get/produce。
   - 增加 permission scope 校验。
   - 增加 references.replaceOwn/listIncoming，并分别执行 `references.manage-own` / `references.read-own`。
5. 修改 [contracts.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/extensions/contracts.js:88)：把 `artifactSources` 纳入 namespaced/duplicate contribution 校验，并验证 id/type/contract/representations 的 manifest 形状。
6. 修改 [manager.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/extensions/manager.js:2741) 和 registry 注册边界：runtime artifact source 必须匹配 manifest 声明及 permission scope；未声明、重复、type/contract/representation 不一致时激活失败并回滚。
7. 修改 [host.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/extensions/host.js:14)：在 restore/activate 前构造完整 Broker 并通过 Host binding 注入 SDK，不让插件 import REST/private module。
8. 修改完整服务和 parser product 的初始化调用，直接传入 `executionLane: 'parser'` 和 `produceBuiltinArtifact`：[restful/index.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/restful/index.js:46)、[sub-store-1.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/products/sub-store-1.js:29)。`sub-store-0` 不声明完整 `resource-broker@1`，也不激活硬依赖该 capability 的 executable backend：[sub-store-0.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/products/sub-store-0.js:38)。
9. 新增引用索引 schema v1 和单次 replaceOwn 原子写；明确它是可由 owner 重建的派生索引，保留停用/卸载数据，不开放 purge。
10. 在 [manager.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/extensions/manager.js:89) 按实际 product/lane 投影 `resource-broker@1` available capability；不把现有 incomplete capability 假装 complete。
11. 修改 [sync.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/restful/sync.js:947)：有 sourceRef 时严格精确生产；无 sourceRef 的 legacy 数据才走 type-only，并处理多 provider 歧义。

### Phase 2：Host 前端动态资源契约

仓库：`Sub-Store-Front-End`

1. 在 [contracts.ts](/Users/dompling/WebstormProjects/GIT/Sub-Store-Front-End/src/extensions/contracts.ts:196) 增加 ResourceRef、contract、representations、descriptor item revision/availability 类型。
2. 修改 [artifacts.d.ts](/Users/dompling/WebstormProjects/GIT/Sub-Store-Front-End/src/types/store/artifacts.d.ts:23)，增加 `sourceRef/representation` 并允许动态 type；前端 Artifact 类型与内置 config-hosting adapter 的持久化/校验模型同步升级，不能只改 UI 类型。
3. 修改 [SyncEditor.vue](/Users/dompling/WebstormProjects/GIT/Sub-Store-Front-End/src/views/SyncEditor.vue:475)：picker 以 contribution ID 作为第一层真实值，显示 owner 名称和状态，保存 sourceRef；表示选择保存具体 representation，Clash 多格式不得只保存平台名。
4. 保留旧 artifact 编辑、显示和提交路径。
5. 增加 frontend extension contract 测试，锁定多个同 type provider 不冲突。

### Phase 3：规则集工作台 MVP

仓库：`Sub-Store-Extensions`

新增目录：

```text
extensions/org.substore.rule-studio/
├── extension.config.json
├── package.json
├── README.md
├── backend/src/extensions/rule-studio/
│   ├── manifest.json
│   ├── package-entry.js
│   ├── sdk.js
│   ├── store.js
│   ├── index.js
│   ├── adapter.js
│   ├── domain/
│   ├── parser/
│   ├── normalize/
│   ├── targets/{surge,qx,clash,loon}.js
│   └── cache/remote-source.js
├── frontend/src/extensions/rule-studio/
│   ├── runtime-entry.ts
│   ├── routes.ts
│   ├── api.ts
│   ├── store.ts
│   ├── pages/
│   └── components/
└── tests/
    ├── fixtures/{surge,qx,clash,loon}/
    └── *.test.mjs
```

1. 用 executable scaffold 创建目录，手工校正最小权限和 ABI。
2. 先实现纯函数 parser/normalizer/serializer，并用官方文档 fixture 锁定行为。
3. 实现 source cache、last-known-good 和 diagnostics。
4. 实现 CRUD、预览、强制刷新和导出 routes；解析/生产 route 标记 parser lane。
5. 注册 `org.substore.rule-studio.rule-sets` artifact source/resource provider。
6. 实现列表、编辑、输出预览和诊断 UI。
7. “删除”实现为 archived tombstone；默认列表隐藏、归档列表可恢复、精确 ResourceRef 继续生产，并用 references.listIncoming 显示使用提示。
8. 只复用仓库已固定的 `yaml` 2.9.0；不新增其他 runtime dependency。

### Phase 4：配置生成器接入 ResourceRef

仓库：`Sub-Store-Extensions`

1. 修改 [contracts.d.ts](/Users/dompling/WebstormProjects/GIT/Sub-Store-Extensions/extensions/org.substore.config-generator/frontend/src/extensions/config-generator/contracts.d.ts:83) 和 store schema。
2. 修改 [RuleSetActionForm.vue](/Users/dompling/WebstormProjects/GIT/Sub-Store-Extensions/extensions/org.substore.config-generator/frontend/src/extensions/config-generator/components/editor/RuleSetActionForm.vue:38)，加入 contract 驱动的资源选择器和 unavailable 状态。
3. 修改 [manifest.json](/Users/dompling/WebstormProjects/GIT/Sub-Store-Extensions/extensions/org.substore.config-generator/backend/src/extensions/config-generator/manifest.json:57)，增加 `resource-broker@1` hard capability、resources scopes 和 `references.manage-own`；不增加 Rule Studio 插件依赖。Rule Studio 单独使用 `references.read-own`。
4. 修改 [sdk.js](/Users/dompling/WebstormProjects/GIT/Sub-Store-Extensions/extensions/org.substore.config-generator/backend/src/extensions/config-generator/sdk.js:34)，绑定 resources.list/get/produce 与 references。
5. 修改 [validation.js](/Users/dompling/WebstormProjects/GIT/Sub-Store-Extensions/extensions/org.substore.config-generator/backend/src/extensions/config-generator/validation.js:373)，验证 ResourceRef、contract 和 publicBaseUrl。
6. 新增 `core/resource-rule-set.js`，完成异步预生产、诊断聚合、临时 URL 投影和 generation-context body map。
7. 修改 [index.js](/Users/dompling/WebstormProjects/GIT/Sub-Store-Extensions/extensions/org.substore.config-generator/backend/src/extensions/config-generator/index.js:573)，将配置内规则集下载扩展至四端；resource source 走 Broker，URL source 保留原逻辑。
8. 在插件激活和项目/rule set CRUD 后重建项目到资源的引用边；提供内部 repair 操作，引用索引写失败不回滚已成功的项目保存，但必须记录可诊断状态并在下次激活修复。
9. 保持四端 generator 的既有 URL/builtin 回归；尽量只消费投影结果，不让 generator 了解 provider 私有实现。

### Phase 5：订阅体检 MVP

仓库：`Sub-Store-Extensions`

新增目录：

```text
extensions/org.substore.subscription-doctor/
├── extension.config.json
├── package.json
├── README.md
├── backend/src/extensions/subscription-doctor/
│   ├── manifest.json
│   ├── package-entry.js
│   ├── sdk.js
│   ├── store.js
│   ├── index.js
│   ├── analyzer/
│   ├── compatibility/
│   └── report/
├── frontend/src/extensions/subscription-doctor/
│   ├── runtime-entry.ts
│   ├── routes.ts
│   ├── api.ts
│   ├── store.ts
│   ├── pages/
│   └── components/
└── tests/
```

1. 通过 Broker 列出 subscription/collection，不使用 `useSubsStore` 作为业务协议。
2. 通过 `substore-nodes-json` 获取本次有效节点快照。
3. 实现纯函数结构检查、指纹、重名、协议分布和四端兼容矩阵。
4. 保存脱敏摘要和最近 20 份报告。
5. 实现极简首页、结果页、筛选、diff 和脱敏导出。
6. 首版 manifest 不申请 network 或任何写核心资源权限。

### Phase 6：配置托管、发布与全链路回归

三个仓库：

1. 配置托管保存 `sourceRef + representation`，精确生产 Rule Studio artifact；存在 sourceRef 时禁止 type/source fallback。
2. 验证 `Rule Studio → Config Generator → Config Hosting`。
3. 验证 Rule Studio 直接被 Config Hosting 发布。
4. 验证 Subscription Doctor 只读消费核心资源。
5. 为两个插件生成 package、catalog entry、版本历史和 repository。
6. 从远程集合源安装，不使用本地上传包作为发布验收。
7. 验证更新、回滚、停用、卸载保留数据、重装恢复。

## 13. 验收标准

### 13.1 架构

- 两个同 type provider 同时注册时，新 ResourceRef 总能命中指定 contribution；无 first-match 随机性。
- legacy artifact 没有 sourceRef 且存在多个同 type provider 时返回 `RESOURCE_PROVIDER_AMBIGUOUS`；任何含 sourceRef 的记录都不会回退 type-only。
- manifest/runtime artifact source 的 ID、type、contract、representations 与 permission scope 在激活边界强校验；不合法插件不会留下半注册 runtime。
- 任一业务插件均不读取其他插件 storage、目录或私有路由。
- 旧 type/source artifact 和配置生成器 v1 URL/builtin 项目无需人工迁移即可继续工作。
- 老后端不支持 `resource-broker@1` 时，新版 Rule Studio、Subscription Doctor 和新版 Config Generator 在安装/启用前被版本门禁拒绝；旧版 Config Generator 仍可留在旧 Host 上使用 URL/builtin。
- 完整 Node Host 在插件激活前注入 producer；parser product 只复用核心 producer，simple/parser product 不虚报第三方 Node executable 的运行能力，整个流程不出现延迟注入或 `undefined is not a function`。

### 13.2 规则集工作台

- 四端官方样例均能解析到统一模型并输出目标格式。
- 每条被省略或近似转换的规则都有 exact/fallback/filtered/invalid 结果。
- 改名不改变 resource ID；规则更新改变 sourceRevision。
- stale cache 使用时 UI 和 output diagnostics 都明确标记。
- 删除操作归档资源；归档条目不出现在新选择列表，已有引用继续生成，恢复后 ID 不变；第一版不存在物理 purge。
- 100,000 条合成规则的解析、规范化和去重在普通开发机 Node 20/22 上三次暖运行中位数不超过 5 秒，且不把全部规则渲染进 DOM。

### 13.3 配置生成器联动

- 未安装规则集工作台时，URL、SYSTEM、LAN 和四端输出保持原回归。
- 安装任意 `substore.rule-set@1` provider 后，选择器自动出现。
- Rule Studio 更新后，不修改配置项目即可生成新内容。
- provider 停用/卸载后项目仍可编辑，生成明确失败，不静默漏掉 RULE-SET。
- Surge、QX、Clash、Loon 使用配置生成器可访问的远程规则 URL；Clash 预览不递归请求自身 URL。
- provider diagnostics 合并到配置预览。
- 配置托管 direct rule-set artifact 保存具体 representation；Clash classical/domain/ipcidr 不依赖平台名猜测，新增 representation 不改变既有 artifact 行为。

### 13.4 订阅体检

- 只能列出 permission scope 中的订阅和组合订阅。
- 不修改原资源，不保存完整节点或凭据。
- 10,000 节点分析在普通开发机三次暖运行中位数不超过 3 秒。
- 重复和重名分别统计；未知协议显示 unknown。
- 报告 JSON/Markdown 默认不包含 server、password、UUID、private key、token 和完整 URL query。

### 13.5 UI

- 320、375、768 和桌面宽度均无页面级横向滚动。
- 主操作点击区不小于 44×44px。
- 编辑页折叠默认行为、返回、弹层关闭和深色模式与现有插件 UI 一致。
- 大列表采用分页/分段/虚拟化，不冻结主线程。

### 13.6 轻量化

- 不新增消息队列、服务总线、数据库、独立服务或后台轮询。
- Rule Studio 除仓库已有 `yaml` 外不增加 runtime dependency；Subscription Doctor 不增加 runtime dependency。
- 报告最多 20 份且不保存节点正文。
- Resource Broker 公共 API 只包含 list/get/produce；引用 API 只包含 replaceOwn/listIncoming，权限只增加 `references.read-own`，不引入跨 storage 事务。

## 14. 风险与缓解

| 风险 | 缓解 |
|---|---|
| Resource Broker 逐渐变成任意插件 RPC | API 仅接受 ResourceRef 和固定 envelope，不允许调用任意 provider 方法 |
| 多 provider 同 type 导致旧数据歧义 | 新数据强制 contribution ID；旧数据仅在唯一匹配时兼容，多匹配返回 `RESOURCE_PROVIDER_AMBIGUOUS` |
| 配置生成器公开地址不可达 | UI 自动填当前 Host，保存时验证 HTTP(S)，loopback 跨设备场景明确警告 |
| 四端规则语义不完全一致 | contract 要求 diagnostics；无安全映射则 filtered，不静默伪装 exact |
| stale 内容长期掩盖上游失败 | max stale 7 天，output 标记 freshness，超过后硬失败 |
| 规则集删除破坏配置 | MVP 只归档不 purge；已有 ResourceRef 继续可生产，引用索引仅做提示和修复 |
| core subscription 名称改变导致历史 ref 失效 | v1 明确 name-keyed；报告保留 lastKnownName，后续单独迁移稳定 UUID |
| executable 插件接触敏感数据 | 最小权限、descriptor 不暴露正文、日志/报告脱敏；不虚假宣传沙箱 |
| Host 分产品 lane 中 producer 不可用 | 完整 Node Host 在 restore/activate 前注入 producer并按 runtime/lane 投影 capability；simple/parser product 不安装第三方 Node executable |
| runtime contribution 冒充 manifest source | 激活边界强校验 ID/type/contract/representations/permission scope，失败回滚注册 |
| 新插件体积和维护面扩大 | 共用 executable scaffold、纯函数模块、小型依赖和独立测试，不复制 Host 私有 parser |

## 15. 完整验证命令

实现阶段按以下顺序执行，任一失败必须修复后再进入下游：

### Sub-Store backend

```bash
cd /Users/dompling/WebstormProjects/GIT/Sub-Store/backend
corepack pnpm test
corepack pnpm bundle:esbuild
```

### Sub-Store-Front-End

```bash
cd /Users/dompling/WebstormProjects/GIT/Sub-Store-Front-End
corepack pnpm test:extensions
corepack pnpm build
```

### 单插件与配置生成器

```bash
cd /Users/dompling/WebstormProjects/GIT/Sub-Store-Extensions
corepack pnpm typecheck -- --extension org.substore.rule-studio
corepack pnpm test -- --extension org.substore.rule-studio
corepack pnpm package -- --extension org.substore.rule-studio

corepack pnpm typecheck -- --extension org.substore.subscription-doctor
corepack pnpm test -- --extension org.substore.subscription-doctor
corepack pnpm package -- --extension org.substore.subscription-doctor

corepack pnpm typecheck -- --extension org.substore.config-generator
corepack pnpm test -- --extension org.substore.config-generator
corepack pnpm package -- --extension org.substore.config-generator
```

### 集合发布闭包

```bash
cd /Users/dompling/WebstormProjects/GIT/Sub-Store-Extensions
corepack pnpm repository
corepack pnpm verify
corepack pnpm check
```

### 本地全链路

1. 从本地 repository server 或远程 GitHub catalog 添加集合源。
2. 安装并启用规则集工作台、配置生成器、订阅体检。
3. 导入一个真实四端规则集，创建 ResourceRef 配置项目并生成四端预览。
4. 用配置托管分别发布规则集和配置项目。
5. 运行订阅/组合订阅体检并导出脱敏报告。
6. 更新 Rule Studio 内容，确认配置项目无需编辑即使用新 revision。
7. 依次测试停用、卸载、重装、更新、回滚和引用恢复。
8. 在 320/375/768/桌面宽度与深色模式做视觉回归。

## 16. 实施顺序与提交边界

建议保持以下可独立回滚的提交：

1. Host Resource Broker contracts、scope 和 tests。
2. Host reference index、core providers 和 config-hosting sourceRef/representation。
3. executable scaffold 与开发文档。
4. Rule Studio parser/serializer/cache 后端。
5. Rule Studio UI、resource provider 和 package。
6. Config Generator ResourceRef/storage v2/四端联动。
7. Subscription Doctor analyzer/UI/package。
8. 三仓库集成回归、catalog 和发布材料。

每个提交使用工作区要求的 Lore commit 格式，正文记录被拒绝的直连方案、兼容约束、验证结果和未覆盖项。

## 17. 计划复审后的收口项

- 将跨插件联动统一为 contract 驱动，而不是硬编码 Rule Studio ID。
- 增加新的 `resource-broker@1` capability，避免旧 Host 把 incomplete adapter 误判成完整支持。
- Broker 在插件激活前构造，并按 runtime/product/lane 真实能力发布 capability。
- artifact source 的 manifest/runtime identity 与权限由 Host 激活边界强校验。
- 复用配置生成器已有规则下载入口，不新增通用公共资源下载 API。
- Subscription Doctor MVP 收窄为现有 Sub-Store 资源的最终有效结果体检，不复制核心 proxy parser。
- 配置托管明确保存 representation；Clash 多种 rule-provider 格式不通过 platform 猜测。
- 所有新 ResourceRef 强制携带 contract；核心 subscription/collection 使用明确的 `@1` 契约，major 不兼容时 fail closed。
- 用归档/tombstone 保护已有引用，引用图改为可修复派生索引，不宣称跨 storage 强事务。
- 只要数据含 sourceRef 就 fail closed，type/source 只服务真正的 legacy 数据；多 provider 时 legacy 路径报歧义。
- 将轻量化变成可验证约束：最小 API、无后台任务、无新增架构服务、有限报告保留和依赖预算。
