# 规则集工作台、订阅体检与跨插件联动测试规格

状态：实施前测试设计  
关联计划：[prd-rule-studio-subscription-doctor.md](/Users/dompling/WebstormProjects/GIT/Sub-Store-Extensions/.omx/plans/prd-rule-studio-subscription-doctor.md)

## 1. 测试原则

1. 先锁定旧行为，再接入 ResourceRef；URL、`SYSTEM`、`LAN` 和旧配置托管 artifact 不得回归。
2. parser、normalizer、serializer、analyzer 和 compatibility registry 以纯函数单测为主。
3. 插件生命周期、权限、provider 精确解析和三插件链路使用集成测试。
4. 所有被过滤或近似转换的输入都必须断言 diagnostic；禁止只断言输出“没报错”。
5. fixture 必须注明来源文档、采集日期和目标客户端；不凭印象编写格式。
6. 隐私测试按“输出中不存在敏感值”进行负向断言。
7. 性能测试使用固定合成数据和三次暖运行中位数，避免把网络耗时混入本地算法预算。

## 2. 测试层级和新增文件

### 2.1 Sub-Store backend

建议新增：

```text
src/test/extensions/resource-contracts.spec.js
src/test/extensions/resource-broker.spec.js
src/test/extensions/reference-graph.spec.js
```

扩展：

```text
src/test/extensions/host.spec.js
src/test/restful/sync.spec.js
src/test/extensions/config-hosting.spec.js
```

现有 Host 插件测试基线位于 [host.spec.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/test/extensions/host.spec.js:150)。

### 2.2 Sub-Store-Front-End

建议新增：

```text
tests/extensions/resource-source-contract.test.mjs
tests/extensions/resource-source-ui-contract.test.mjs
```

扩展：

```text
tests/extensions/navigation-entrypoints.test.mjs
```

### 2.3 Rule Studio

```text
extensions/org.substore.rule-studio/tests/
├── parser-detection.test.mjs
├── normalization.test.mjs
├── serializer.test.mjs
├── cache.test.mjs
├── resource-provider.test.mjs
├── lifecycle-reference.test.mjs
├── frontend-contract.test.mjs
├── package-contract.test.mjs
├── backend-bundle.test.mjs
├── performance.test.mjs
└── fixtures/{surge,qx,clash,loon}/
```

### 2.4 Config Generator

扩展现有：

```text
extensions/org.substore.config-generator/tests/backend-bundle.test.mjs
extensions/org.substore.config-generator/tests/surge-qx-regression.test.mjs
extensions/org.substore.config-generator/tests/rule-binding-presentation.test.mjs
extensions/org.substore.config-generator/tests/package-contract.test.mjs
```

现有 Clash 缓存下载和远程 URL 回归可从 [surge-qx-regression.test.mjs](/Users/dompling/WebstormProjects/GIT/Sub-Store-Extensions/extensions/org.substore.config-generator/tests/surge-qx-regression.test.mjs:730) 扩展。

### 2.5 Subscription Doctor

```text
extensions/org.substore.subscription-doctor/tests/
├── analyzer.test.mjs
├── compatibility.test.mjs
├── report-redaction.test.mjs
├── resource-consumer.test.mjs
├── retention.test.mjs
├── frontend-contract.test.mjs
├── package-contract.test.mjs
├── backend-bundle.test.mjs
├── performance.test.mjs
└── fixtures/nodes/
```

## 3. Resource contracts 单元测试

### RC-01：合法 ResourceRef

给定完整 `schema/providerId/providerContributionId/type/id/contract`，规范化结果保持身份字段不变。

### RC-02：缺失身份字段

分别缺失 providerId、providerContributionId、type、id、contract，返回 `RESOURCE_REF_INVALID`，错误 details 不包含 body 或凭据。只有没有 `schema/sourceRef` 的 legacy artifact 可走独立兼容路径，不能把缺失 contract 的 v1 ref 当作 legacy。

### RC-03：禁止不安全/空 ID

拒绝空白、控制字符和超长字段；允许中文资源名称只出现在 descriptor，不要求 ResourceRef id 可读。

### RC-04：契约 major

`substore.rule-set@1` 消费者遇到 `@2` 时返回 `RESOURCE_CONTRACT_INCOMPATIBLE`；同 major 的 additive provider 元数据不应失败。

### RC-05：旧字符串输出包装

旧 adapter 返回字符串后，Broker 包装为 `substore.resource-output@1`，`freshness.state=fresh`、diagnostics 为空、body 原样。

### RC-06：输出 envelope 校验

拒绝非字符串 body、未知 freshness state 和缺失 representation；diagnostics 中额外字段允许保留。

## 4. Resource Broker 与权限测试

### RB-01：相同 type 的多个 provider

注册两个 `type=rule-set` provider，各返回不同内容。用完整 ResourceRef 调用时必须命中指定 provider；调用顺序变化不影响结果。

### RB-02：旧 type-only 回退

只有一个旧 provider 时，真正没有 `sourceRef` 的旧 artifact 仍能生产；多个同 type provider 时返回 `RESOURCE_PROVIDER_AMBIGUOUS`，不得按注册顺序选择。含 `sourceRef` 的记录在 provider 不可用时直接失败，不得尝试 type-only。

### RB-03：manifest/runtime contribution 强校验

分别覆盖以下激活失败场景：runtime source 未在 manifest 声明、缺少/重复/非 namespaced ID、type 不一致、contract 不一致、runtime representation 超出 manifest、缺少 `artifact-source.register`、permission scope 不含该 type。失败后 adapter/contribution/route 不得残留；合法声明才能激活。

### RB-03B：legacy provider 隔离

未声明 `resource-broker@1` 的既有 artifact source 继续支持旧 Config Hosting 的 type-only 生产，但不出现在 `resources.list()`、不能构造 ResourceRef，也不受新 runtime contract 的破坏性强制升级。声明 Broker hard capability 的新 provider 则必须满足完整强校验。

### RB-04：resources.list scope

仅声明 `subscription` 的插件不能看到 collection、rule-set 或 config-project descriptor，返回列表中也不能泄露数量或名称。

### RB-05：resources.produce scope

声明 `subscription` 后尝试生产 rule-set，返回 403 `EXTENSION_PERMISSION_SCOPE_DENIED`。

### RB-06：resources.read scope

声明 `resources.read: subscription` 后尝试 `get()` collection descriptor，返回 403；list scope 与 read scope 分开执行。

### RB-07：未声明权限

没有 `resources.list` / `resources.read` / `resources.produce` 的插件分别调用 list/get/produce，返回 `EXTENSION_PERMISSION_DENIED`。

### RB-08：核心订阅 provider

以 `contract=substore.subscription@1` 的 subscription ref 生产 `substore-nodes-json`，返回 JSON 数组、application/json、resource output envelope；descriptor/ref 保留该 contract，且 descriptor 不含订阅 URL。

### RB-09：核心组合订阅 provider

`contract=substore.collection@1` 的 collection 经过既有 processor 后返回最终节点；descriptor/ref 保留该 contract，不存在名称返回 `RESOURCE_NOT_FOUND`。

### RB-10：不支持 representation

对 subscription 请求 rule-set representation，返回 `RESOURCE_REPRESENTATION_UNSUPPORTED`。

### RB-11：provider disabled

停用 provider 后，list/get 返回 disabled descriptor 或明确 lifecycle 状态，produce 返回 409；不得调用 adapter 计数器。

### RB-12：provider uninstall/reinstall

卸载后 ResourceRef 保留且生产失败；重装相同 ID 和 item ID 后生产恢复。

### RB-13：provider update 不调用旧闭包

先注册 v1 adapter，再模拟更新到 v2；下一次 produce 必须得到 v2 内容，v1 调用计数不增加。现有动态路由每次查当前 handler 的模式见 [registry.js](/Users/dompling/WebstormProjects/GIT/Sub-Store/backend/src/extensions/registry.js:195)。

### RB-14：provider updating

更新中返回 `RESOURCE_PROVIDER_UPDATING`，消费者可重试；不得回退到旧 runtime。

### RB-15：老 Host capability 门禁

缺少 `resource-broker@1` 时 Rule Studio、Subscription Doctor 和升级后的 Config Generator preflight 均返回 `EXTENSION_HARD_CAPABILITY_MISSING`；旧 Host 上已兼容安装的旧版 Config Generator 仍保持 URL/builtin 能力，repository 不向旧 Host 提供不兼容的新包。

### RB-16：parser lane

完整 Node 服务在 restore/activate 前把 producer 注入 Broker；测试插件在 `activate()` 中立即调用 service shape 检查时已经看到 list/get/produce。parser product 可注入核心 producer，但不安装第三方 Node executable；simple product 不声明完整 `resource-broker@1`，硬依赖它的 executable backend 不激活。不得因延迟注入出现 `undefined is not a function`。

## 5. Reference Graph 测试

### RG-01：replaceOwn

同一 owner 第二次 replace 后旧 targets 被完整替换，而不是累加。

### RG-02：owner 权限

插件 A 不能写 `owner.providerId=插件 B` 的边，返回 403。

### RG-03：incoming refs

Rule Studio 持有 `references.read-own` 时只能查询自身资源的 incoming；查询其他 provider 资源被拒绝。只有 `references.manage-own` 而没有 `read-own` 也不能读取 provider incoming。

### RG-04：配置项目重建

插件激活时先扫描全部项目并 replaceOwn。项目从资源 A 改为 B 后，A incoming 消失，B incoming 出现；删除项目后两者均无引用。

### RG-05：未使用的本地规则绑定

配置生成器存在 resource rule-set 记录但没有项目使用时，不产生 config-project incoming edge。

### RG-06：有引用时归档

存在 incoming 时 Rule Studio 的删除操作把资源置为 archived，并返回脱敏的使用数量/owner 摘要提示；默认 list 和新选择器不再显示该资源，但既有完整 ResourceRef 的 get/produce 继续成功，配置项目不被修改。

### RG-07：停用/卸载保留

provider 停用、卸载后引用存储仍在；重装后 incoming 仍可查询。

### RG-08：项目保存与引用更新之间失败

模拟项目 storage 已成功保存、随后 `replaceOwn()` 失败。项目不得回滚或损坏；状态标记引用索引需修复。下一次插件激活或显式 repair 扫描全部项目后，incoming 恢复正确。

### RG-09：引用存储损坏

schema 不支持或数据损坏时，incoming UI 显示“索引不可用/待修复”，归档和既有资源生产不被阻塞；repair 可从 owner 项目重建。第一版不存在物理 purge，因此不需要引用图承担强删除门禁。

## 6. Rule Studio parser 与规范化测试

### RS-P01：BOM、CRLF、空行和注释

四种换行/BOM 组合均不产生伪规则；注释按 source line 保留。

### RS-P02：Surge rule list

覆盖 DOMAIN、DOMAIN-SUFFIX、DOMAIN-KEYWORD、IP-CIDR、IP-CIDR6、GEOIP、PROCESS-NAME、URL-REGEX 和 `no-resolve`。

### RS-P03：QX remote filter

覆盖 QX 大小写、空格、策略尾字段和远程 filter 常见注释；策略尾字段被移除并产生 `SOURCE_POLICY_IGNORED`。

### RS-P04：Loon remote rule

覆盖 Loon 文档支持的规则、remote list 注释与不支持字段诊断。

### RS-P05：Clash classical YAML

解析 `payload` 数组，拒绝对象形状错误、HTML 错误页和空 payload。

### RS-P06：Clash classical text

逐行解析 text provider，处理引号、逗号和注释。

### RS-P07：Clash domain

`+.example.com`、`.example.com`、`example.com` 等 fixture 按文档转换，无法无损识别的形式产生 fallback/invalid。

### RS-P08：Clash ipcidr

IPv4/IPv6 CIDR 规范化；错误掩码 invalid。

### RS-P09：格式自动识别

每种 fixture 命中正确格式；低置信度内容标记“格式未确认”，允许用户手动纠正。

### RS-P10：未知/HTML/JSON 错误页

HTML、GitHub 404、API 错误 JSON 不得被当作有效逐行规则。

### RS-P11：多来源顺序

来源 A 后 B，合并顺序稳定；禁用来源不参与。

### RS-P12：去重

等价域名大小写和规范 CIDR 去重；PROCESS-PATH 大小写不被错误合并；保留第一条并诊断后续位置。

### RS-P13：输入不可变

parse/normalize/serialize 前后原始项目和 rules 深比较相等。

### RS-P14：限制

10 MiB+ 响应、20+ 启用来源、200,000+ 规则分别返回稳定限制错误，不进入失控解析。

## 7. Rule Studio serializer 与兼容性测试

每个目标至少覆盖 exact、fallback、filtered、invalid 四类。

### RS-S01：Surge golden output

输出无策略组绑定，只包含规则正文；注释和 `no-resolve` 按 Surge 规则集语义处理。

### RS-S02：QX golden output

输出适合 `filter_remote` 的内容；Surge 专属规则若无安全对应则 filtered，并保留 sourceLine。

### RS-S03：Loon golden output

输出 Loon remote rule list；不支持的 QX/Clash 专属项明确诊断。

### RS-S04：Clash classical YAML/text

YAML 解析后 payload 与预期数组一致；text 每行一条，不包含 `RULE-SET,provider,policy` 配置层语句。

### RS-S05：Clash domain behavior

纯域名模型允许 domain；混入 CIDR/PROCESS 时请求 domain 返回 unsupported。

### RS-S06：Clash ipcidr behavior

纯 CIDR 模型允许 ipcidr；混入域名时请求 ipcidr 返回 unsupported。

### RS-S07：空输出

所有规则 invalid/filtered 时 produce 失败，artifact source 和配置托管不得得到空字符串成功结果。

### RS-S08：Unicode 和注释

中文注释、emoji、非 ASCII 域名输入不导致 serializer 崩溃；IDN 行为有固定 fixture。

## 8. Rule Studio 缓存测试

### RS-C01：fresh hit

首次 200 后，在 fresh TTL 内第二次调用不触发 network.get。

### RS-C02：ETag 304

过 fresh TTL 请求带 If-None-Match；304 更新时间但复用 body，freshness=fresh。

### RS-C03：Last-Modified

无 ETag 时使用 If-Modified-Since。

### RS-C04：内容更新

200 新内容通过解析后替换 LKG，sourceRevision/digest 改变。

### RS-C05：新内容解析失败

旧 LKG 未超过 7 天时返回旧 body、freshness=stale、diagnostic 包含 `RESOURCE_CONTENT_INVALID`；不得覆盖旧 digest。

### RS-C06：网络失败 + stale

超时/502 且存在 LKG 时返回 stale 和 `RESOURCE_STALE`。

### RS-C07：网络失败 + no cache

返回 `RESOURCE_UPSTREAM_FETCH_FAILED` 或 timeout；不创建空 cache。

### RS-C08：超过 max stale

旧缓存 7 天后不得继续使用。

### RS-C09：URL 隐私

缓存 key、日志和 error details 不含 token query；断言明文 secret 不存在。

### RS-C10：provider disabled

即使缓存存在，停用插件后 Host produce 仍失败，adapter/cache 不被调用。

## 9. Rule Studio CRUD、生命周期与包测试

### RS-L01：稳定 ID

创建使用 UUID；重命名只增加 project revision，不改变 id。

### RS-L02：乐观并发

使用旧 revision 更新返回 `RESOURCE_REVISION_CONFLICT`。

### RS-L03：storage migration

schema v1 初始化、重复初始化幂等；未知未来 schema fail closed，不改写原值。

### RS-L04：停用/启用

停用注销 contribution/routes；启用恢复同一资源数据。

### RS-L05：卸载/重装

卸载保留 store；重装相同 ID 后 list/get/produce 恢复。

### RS-L06：归档/恢复

删除 active 项目后变成 archived、revision 增加且 sources/cache 不被清空；默认 list 不出现，归档列表可见，既有 ResourceRef 仍可 get/produce。恢复后同一 ID 重新出现在默认 list。不存在物理 purge route/action。

### RS-L07：package closure

manifest、workspace package、catalog 版本一致；backend/frontend asset digest 一致；包中无未声明文件。

### RS-L08：Host-private import

backend bundle 不含 `@/`、Host registry、数据库 key 或跨插件 import；只允许已声明 external `yaml`。

## 10. Config Generator 旧行为回归

### CG-R01：仅安装配置生成器

Host 支持 Resource Broker、但没有安装任何外部 `substore.rule-set@1` provider 时，项目列表、URL 规则、SYSTEM、LAN、Surge/QX/Clash/Loon 预览全部通过。

### CG-R02：storage v1 读取

现有 `{version:1, projects, ruleSets}` 无人工操作即可加载和保存为兼容 v2。

### CG-R03：URL 映射

现有 Surge URL 到 QX/Clash/Loon 的已支持映射结果不变。

### CG-R04：Clash provider URL

现有 URL rule-set 仍使用当前配置项目缓存 URL，保持 [surge-qx-regression.test.mjs](/Users/dompling/WebstormProjects/GIT/Sub-Store-Extensions/extensions/org.substore.config-generator/tests/surge-qx-regression.test.mjs:773) 的语义。

### CG-R05：RULE-SET 名称和备注

未命名规则不被强制写回 title；QX/Loon 备注、空行和规则顺序保持现有 regression。

## 11. Config Generator ResourceRef 联动测试

### CG-I01：contract 驱动发现

两个插件分别提供 `substore.rule-set@1`，选择器都出现并按 provider 分组；不匹配 contract 的 `rule-set` source 不出现。

### CG-I02：保存完整 ResourceRef

保存后包含 providerId、providerContributionId、type、id、contract、lastKnownName；不保存 provider 私有 route/storage path。

### CG-I03：规则改名

Rule Studio displayName 改变后项目 ref 不变，下次加载显示新名称。

### CG-I04：规则 revision 更新

不编辑配置项目，第二次预览请求到新 sourceRevision 和新 body。

### CG-I05：Surge 远程 URL

resource source 投影为 `/download/config-project/.../Surge`，远端路由返回 Surge rule list，配置中策略绑定仍由 Config Generator 写入。

### CG-I06：QX 远程 URL

生成 `filter_remote` URL，下载返回 QX filter；tag/force-policy/opt-parser 属于配置生成器，不进入 Rule Studio body。

### CG-I07：Loon 远程 URL

生成绝对 HTTP(S) remote rule URL；下载返回 Loon rule list；无 publicBaseUrl 时 validation 明确失败。

### CG-I08：Clash classical

预生产 body 放入 generation context，Clash generator 不发起对自身下载路由的网络请求；输出 provider URL、behavior、format 正确。

### CG-I09：Clash domain/ipcidr

targetOptions 映射正确 representation；内容与 behavior 冲突时预览失败并显示 provider diagnostic。

### CG-I10：diagnostics 聚合

Rule Studio fallback/filtered/stale diagnostics 出现在配置预览 warnings，包含绑定路径但不泄露正文。

### CG-I11：provider disabled/uninstalled

项目仍可 GET/编辑；预览和下载返回稳定 provider 错误；不从项目移除规则。

### CG-I12：reinstall

相同 provider/item ID 重装后无需编辑项目即恢复。

### CG-I13：公共地址

自动填当前 Host；localhost/127.0.0.1 在跨设备用法产生 warning；非 HTTP(S) 拒绝。

### CG-I14：配置托管生产

配置托管调用 config-project adapter 时同样通过 Broker 生产规则；失败不覆盖上次成功 artifact URL。

### CG-I15：引用重建

一个项目使用两个 resource rule sets 时生成两条 edge；移除一个绑定后只保留另一个。

### CG-I16：归档规则继续使用

Rule Studio 归档已绑定规则后，Config Generator 的“新增来源”列表不再展示它；现有项目仍回显 archived 状态并能生成。用户切换为其他来源后，旧归档资源不会被名称或 type 自动重新匹配。

## 12. Subscription Doctor analyzer 测试

### SD-A01：空资源列表

首页显示空状态，不显示本地/URL 后门，不报 500。

### SD-A02：正常订阅

生成总数、协议分布、四端矩阵和 healthy 状态。

### SD-A03：组合订阅

分析最终 processor 后节点，不修改 collection/subscription。

### SD-A04：空有效节点

核心生产返回无有效节点时，体检结果为 error 或受控失败，不映射成插件内部 500。

### SD-A05：缺字段

每个支持协议至少一个正常 fixture 和一个缺关键字段 fixture，path 指向安全字段名。

### SD-A06：异常端口/地址

0、负数、>65535、空 host 和明显无效 host 分别诊断；不执行 DNS 探测。

### SD-A07：精确重复

名称不同但连接指纹相同，计入 duplicate，不计入 duplicateName。

### SD-A08：重名

名称相同、连接指纹不同，计入 duplicateName。

### SD-A09：凭据参与内存指纹

相同 server/port 但不同 credential 不误判重复；持久报告中不存在 credential 原文。

### SD-A10：未知协议

保留 protocol count，四端状态 unknown，不能默认 exact。

### SD-A11：四端 compatibility

每个已支持协议覆盖 exact/fallback/filtered；规则由官方文档 fixture 锁定。

### SD-A12：资源错误

404、provider disabled、timeout、upstream error 转换为稳定 report/error envelope，不返回 stack。

### SD-A13：diff

同一 ResourceRef 两次报告准确计算增减；不同 ResourceRef 不互相比较。

### SD-A14：保留上限

写入第 21 份报告后只保留最近 20 份；排序稳定。

### SD-A15：只读契约

Host fixture 记录 store.write 调用；除插件 own storage 外，订阅/组合订阅 key 从未被写入。

## 13. Subscription Doctor 隐私测试

准备包含以下 sentinel：

```text
SECRET_TOKEN_123
PASSWORD_456
UUID_789
PRIVATE_KEY_ABC
https://example.com/sub?token=QUERY_SECRET
```

分别断言 sentinel 不出现在：

- persisted store。
- JSON report 默认导出。
- Markdown report 默认导出。
- structured error details。
- 日志 mock。
- snapshotHash 之外的显示字段。

允许当前内存分析对象短暂持有规范化凭据，但测试完成后不写入报告；不做远程上传。

## 14. 配置托管与前端契约测试

### CH-01：sourceRef round trip

创建、读取、编辑 artifact 后 ResourceRef 和具体 representation 不丢字段；旧 type/source 同步保留为兼容元数据。删除/停用 provider 后不得用这些旧字段回退生产。

### CH-02：同 type provider picker

两个 `rule-set` source 使用不同 contribution ID，选择第二个后提交值仍是第二个。

### CH-03：representations 驱动

只显示 descriptor 声明的 representation；不支持项不进入选择器。Surge/QX/Loon 唯一项可以自动选，但保存后仍有具体 representation；Clash classical YAML/text、domain、ipcidr 必须能分别选择并持久化。

### CH-04：provider unavailable

已有 artifact 的显示名称保留并标记 unavailable；页面仍能打开和删除/改来源。

### CH-05：失败不覆盖

生产失败时 artifact 原 `url/updated` 保留或按既有失败语义保持，不上传空内容。

### CH-06：动态 type 类型检查

前端 `build` 通过，`rule-set` 等 string 类型不需要每次修改 ArtifactType union。

### CH-07：representation 稳定性

先保存 `clash-domain-yaml` artifact，再让 provider 新增或调整其他 representation 顺序；旧 artifact 继续使用 `clash-domain-yaml`，不得按当前默认或第一项漂移。

## 15. UI 视觉与交互矩阵

在 320×568、375×812、768×1024、1440×900 和深色模式执行：

| 页面 | 核心断言 |
|---|---|
| Rule Studio 列表 | 卡片不溢出；搜索/添加/刷新可点击；空状态简洁 |
| Rule Studio 编辑 | 编辑时折叠默认收起；来源拖拽手柄可用；底部保存不遮内容 |
| Rule Studio 预览 | 四端 tabs 可横向滚动但页面不横向滚动；诊断可打开/关闭 |
| Config Generator RULE-SET | URL/builtin/resource 三类选择清晰；provider unavailable 状态可读 |
| Subscription Doctor 首页 | 首屏只有来源、上次摘要和开始按钮 |
| Subscription Doctor 结果 | 摘要优先；筛选、搜索、diff 和导出不挤压布局 |
| Config Hosting picker | 相同 type provider 显示可区分，已选 sourceRef 正确回显 |

交互断言：

- 所有图标按钮有 aria-label/title。
- 点击区 ≥44×44px。
- 返回键、浏览器返回、弹层 overlay 和关闭按钮行为一致。
- 加载、空、错误、stale、disabled 均有独立状态。
- exact/fallback/filtered/invalid 不只依赖颜色。

## 16. 性能与轻量化测试

### PERF-01：100,000 条规则

固定 seed 生成 100,000 条混合规则（含 20% 重复），预热一次后运行三次；parse+normalize+dedupe 中位数 ≤5 秒。记录而非隐藏峰值 heap；目标 <256 MiB。

### PERF-02：10,000 节点

固定 seed 生成 10,000 个规范化节点，analyze+compatibility+fingerprint 三次暖运行中位数 ≤3 秒。

### PERF-03：报告大小

10,000 节点报告持久化 JSON <1 MiB，且不包含节点正文。

### PERF-04：无后台工作

插件激活后不创建 interval、cron 或自动网络请求；只有用户进入/刷新/生产/体检时执行。

### PERF-05：依赖闭包

Rule Studio backend graph 只允许 Node built-ins 和仓库已有 `yaml`；Subscription Doctor backend graph只允许 Node built-ins。前端 externalize Host Vue/Pinia/UI kit，不打包第二份 framework runtime。

## 17. 发布、更新与回滚 E2E

### E2E-01：远程集合安装

从 `repository/catalog.json` 添加远程源，安装两个新插件；不使用本地上传包。

### E2E-02：规则集直发

Rule Studio 创建规则集 → Config Hosting 选择 rule-set → 选择并保存具体 representation → 生成/上传成功。Clash 至少分别验证 classical 和 domain，确认不是仅靠 platform 猜测。

### E2E-03：完整配置链路

Rule Studio 创建资源 → Config Generator 绑定策略 → 四端预览 → Config Hosting 发布 config-project。

### E2E-04：内容更新

修改远程规则内容/inline 内容 → Rule Studio sourceRevision 变化 → Config Generator 无需编辑即可得到新内容。

### E2E-05：stale

上游临时失败 → LKG 生效 → 配置生成成功并展示 stale；超过 max stale 后失败且不覆盖上次发布。

### E2E-06：订阅体检

选择真实订阅和组合订阅，各生成一次报告，第二次产生 diff；导出文件通过 sentinel 检查。

### E2E-07：停用/启用

停用 Rule Studio 后配置项目保留但生成失败；重新启用恢复。

### E2E-08：卸载/重装

卸载 Rule Studio 保留数据和 refs；从相同远程源重装后资源、配置项目和引用恢复。

### E2E-09：升级

安装 0.1.0 → 发布 0.1.1 → UI 显示更新 → 更新后 ResourceRef 和 storage 可读，使用新 runtime。

### E2E-10：回滚

从 0.1.1 回滚 0.1.0；若 storage schema 仍兼容则恢复，若不兼容必须在激活前明确阻止且不改写数据。

### E2E-11：多个 provider

安装测试 rule-set provider 和 Rule Studio；Config Generator/Config Hosting 均精确选择，不受注册顺序影响。

### E2E-12：归档、引用修复与恢复

配置项目绑定规则 → 归档规则 → 配置仍可预览/发布且新选择器隐藏该规则 → 人为模拟一次引用 replace 失败 → 重启/激活 Config Generator 自动修复 incoming → 恢复规则后同一 ID 重新可选。

### E2E-13：lane/capability 门禁

分别启动完整 Node、parser product 和 simple product：完整 Node 可安装/激活并在激活前具备 producer；parser product 只验证内置核心 producer；simple/parser product 均不把第三方 Node executable 标记为可安装运行。远程 catalog/preflight 显示结果与实际 runtime/lane 能力一致。

## 18. 必须通过的命令

```bash
cd /Users/dompling/WebstormProjects/GIT/Sub-Store/backend
corepack pnpm test
corepack pnpm bundle:esbuild

cd /Users/dompling/WebstormProjects/GIT/Sub-Store-Front-End
corepack pnpm test:extensions
corepack pnpm build

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
corepack pnpm repository
corepack pnpm verify
corepack pnpm check
```

## 19. Release gate

只有同时满足以下条件才可发布：

- 三仓库自动测试与构建全部通过。
- 四端官方 fixture 的 golden output 已人工抽查。
- 三插件完整 E2E 通过。
- 停用、归档/恢复、卸载、重装、更新、回滚通过。
- manifest/runtime contribution 非法 fixture 全部在激活边界失败且无残留注册。
- sourceRef fail-closed、legacy provider 歧义、representation round-trip 和新增 representation 稳定性通过。
- full/parser/simple 三种 product 初始化与 capability 门禁通过。
- privacy sentinel 在所有持久化/导出/错误/日志中均不存在。
- 320/375/768/桌面及深色视觉回归通过。
- repository、package、catalog digest 来自同一次生成并通过 verify。
- 已记录已知限制：核心资源 v1 name-keyed、Subscription Doctor 首版只分析最终有效资源、executable 非安全沙箱。
