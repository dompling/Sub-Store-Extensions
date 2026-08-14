# 订阅体检

通过 Sub-Store Resource Broker 只读分析已有订阅与组合订阅的最终有效节点，优先展示会阻断使用的结构问题、重复项、重名及对应处理建议。

插件有意保持轻量：不复制节点解析器、不直接请求订阅 URL、不修改原资源、不做延迟、可达性或解锁测试，也不保存节点正文或凭据。协议分布和脱敏报告属于折叠的次级信息；Surge、Quantumult X、Clash/Mihomo 和 Loon 的最终兼容性以配置生成器的真实目标预览为准。

## 开发命令

```bash
corepack pnpm typecheck -- --extension org.substore.subscription-doctor
corepack pnpm test -- --extension org.substore.subscription-doctor
corepack pnpm package -- --extension org.substore.subscription-doctor
```
