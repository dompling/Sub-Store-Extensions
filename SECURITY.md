# 安全策略

## 1. 当前模型：来源信任

用户主动添加集合源，表示信任该来源当前提供的扩展。Host 只有在用户点击安装后才下载和执行 executable package。

当前仓库中的扩展由同一维护方开发，因此使用轻量模型，不维护每插件私钥、发布者公钥白名单或 Host 内置 package 授权表。

SHA-256 负责发现传输或生成结果是否漂移，不能证明发布者身份，也不能把恶意代码变安全。

## 2. 必要校验

每个 package 仍必须检查：

- extension ID、版本、kind 和 publisher 字段一致；
- manifest、package、payload 和 receipt digest 闭合；
- 每个文件和 frontend asset SHA-256；
- variant、executable flag、ABI 和 entrypoint；
- 安全相对路径、大小写/Unicode 冲突和未声明文件；
- Host/runtime/API/backend 兼容性；
- `containsInstallHook: false`。

目录安装和 loopback catalog 不能绕过这些检查。

## 3. Executable 不是沙箱

`kind: executable` 的 Node backend 和 frontend surface 当前运行在 Host 主进程/主页面上下文，属于 Host 的可信计算基，不具备进程、iframe 或 capability sandbox。

因此：

- 不认识的来源不要添加；
- UI 应展示来源 URL、集合维护者和插件作者；
- 删除来源后不应继续从该来源发现、安装或更新；
- 未添加来源时，不应通过 ID、legacy adoption 或本地 seed 自动暴露扩展；
- permission 声明仍是契约和审计信息，不能宣称已经形成完整隔离。

## 4. Content 扩展

content 包必须满足：

```text
kind = content
containsExecutableCode = false
containsInstallHook = false
无 executable entrypoint
```

只改 `containsExecutableCode` 不能把 content 模板升级成 executable；manifest、workspace build、receipt 和 Host 兼容性必须形成完整一致的 executable 契约。

## 5. 远程来源与 SSRF

远程 source：

- 外部来源使用 HTTPS；
- URL 禁止 credentials；
- 重定向、catalog/package 大小和 entry 数量受限；
- 公网来源不得重定向到 loopback/private network；
- package URL 必须由 catalog URL 安全解析。

HTTP 只用于显式 loopback 开发：

```text
http://127.0.0.1:8765/catalog.json
```

正式来源优先使用固定 tag 或 commit Raw URL。

## 6. 本地开发入口

`corepack pnpm host:start` 默认不设置 `SUB_STORE_EXTENSION_PACKAGE_SEED_PATH`。这保证无集合源时不会因本仓库存在 `packages/` 而发现配置生成器。

需要测试 seed 时必须显式设置环境变量；需要本地目录安装时必须显式执行 `extension:install-local`。二者都不应成为生产发现路径。

## 7. 管理接口

对外部署必须配置：

```text
SUB_STORE_EXTENSION_ADMIN_TOKEN
```

或其哈希形式，并限制管理 API 的网络访问。不要在 shell 历史、日志、截图、issue 或提交中泄露真实 token。

## 8. 未来开放第三方作者

如果仓库或 Host 将来允许不受信作者发布 executable code，应在开放前设计并实现：

- 发布者签名与可撤销密钥；
- 来源/作者身份展示和变更审计；
- 权限强制；
- 进程或 iframe 隔离；
- CPU、内存、网络和存储限额；
- 更新、防回滚和紧急撤销。

这些能力尚未实现；不要把当前 SHA-256 integrity 字段当成签名系统。

## 9. 漏洞报告

报告请包括：

- Host、前端和插件版本；
- extension ID、source URL 和 distribution；
- manifest/package/payload digest；
- 最小复现和预期/实际行为；
- 是否涉及 token、路径穿越、SSRF、未声明文件或执行边界。

不要在公开 issue 中附真实管理 token 或仍可利用的生产 URL。
