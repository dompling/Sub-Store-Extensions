# 规则集配置插件

```text
org.substore.rule-studio
```

规则集配置是 `Sub-Store-Extensions` 集合中的独立 Node executable 插件，用于导入、规范化、诊断并输出 Surge、Quantumult X、Clash/Mihomo 和 Loon 规则集。

除了手动 URL、粘贴和文件导入，插件还提供可缓存的规则库目录选择器。规则库在列表页左上角统一启停，编辑页只浏览已经启用的目录。首个内置目录是 `blackmatrix7/ios_rule_script` 的 Surge 规则集：插件只索引 GitHub 子目录中的 `.list` 文件，用户选中后才按现有远程来源流程读取具体规则内容。

插件只负责规则资源本身：远程获取、格式识别、转换、缓存和诊断。策略组绑定、规则排序和完整代理配置仍由配置生成器负责。跨插件联动必须使用 Host Resource Broker 和稳定 `ResourceRef`，不得读取其他插件的存储、安装目录或私有路由。

## 开发

从仓库根运行：

```bash
corepack pnpm typecheck -- --extension org.substore.rule-studio
corepack pnpm test -- --extension org.substore.rule-studio
corepack pnpm package -- --extension org.substore.rule-studio
```

首版只复用集合仓库已固定的 `yaml` 依赖。用户界面通过 Vue runtime package 加载，后端通过版本化 Host SDK 获取 storage、network、cache、resource broker 和引用摘要。

## 生命周期

- 项目从创建起使用稳定 UUID，重命名不会改变资源引用；
- “删除”是可恢复归档，不提供物理 purge；
- 归档项目在列表的独立次级区域展示，精确 `ResourceRef` 仍可生产；
- 停用或卸载由 Host 生命周期门禁处理；用户数据按集合规范保留；
- 远程失败时只允许使用未超过最大 stale 时限的 last-known-good 内容。
