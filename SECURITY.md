# 安全策略

## 1. 集合源不是通用代码信任根

用户添加一次 `repository/catalog.json`，可以发现仓库里的多个插件，但“来源已添加”只说明 Host 接受了 catalog 格式和网络边界，不代表其中任何 JavaScript 都可以执行。

每个插件仍单独验证：

- extension ID 与 publisher；
- manifest digest；
- package digest；
- receipt closure；
- variant、ABI 和 entrypoint；
- 每个 payload 文件摘要；
- signature algorithm 与 key ID；
- Host/runtime 兼容性；
- executable/install-hook flag。

集合仓库 publisher、GitHub owner、域名和 entry author 都不能代替这些校验。

## 2. 可执行插件

`trusted-official` Node bundle 和原生前端 surface 属于 Sub-Store TCB，不是进程沙箱或浏览器隔离域。签名证明来源和完整性，但不会把恶意官方代码变安全。

配置生成器可执行包需要：

- Host allowlist 中的固定 ID/publisher；
- Host 官方签名 catalog 授权的 manifest/package digest；
- 插件 package 的 Ed25519 签名；
- receipt 与 package/payload digest 闭包；
- 入口文件和所有资源的 SHA-256；
- Node runtime 与匹配的 implementation ABI。

推荐每个可执行插件使用独立、可撤销、作用域明确的签名密钥。不要把一个插件的私钥作为整个仓库所有插件的通用授权，也不要把配置生成器的私钥交给第三方仓库维护者。

正式私钥不得进入：

- Git 历史；
- package 或 catalog；
- 构建日志；
- `.env` 示例；
- 浏览器前端；
- 普通开发机脚手架。

## 3. Community content 插件

第三方集合源当前只能安装 `kind: content` 的无执行代码包：

```text
containsExecutableCode = false
containsInstallHook = false
无 backend/frontend entrypoint
receipt 无 executable entrypoint
```

脚手架使用 `sha256-digest`，它提供不可变完整性，不证明发布者持有私钥。Host 必须以 `community-integrity` 而不是 `trusted-signature` 展示这类包。

任何 community 包只要声明可执行代码、install hook 或官方保留身份，都应 fail closed。

## 4. 远程来源与 SSRF

远程 source：

- 必须使用 HTTPS；
- URL 禁止用户名和密码；
- 重定向次数受限；
- 公网来源不得重定向到 loopback/private network；
- catalog 和 package 大小受限；
- entry 数量受限；
- package URL 必须由 catalog URL 安全解析。

HTTP 只用于显式 loopback 本地开发来源，例如：

```text
http://127.0.0.1:8765/catalog.json
```

GitHub 应优先使用固定 tag 或 commit 的 Raw URL。

## 5. 目录上传

本地文件夹安装只是 transport，不是 trust bypass。浏览器和后端都必须拒绝：

- 多个根目录；
- 绝对路径、`..`、反斜杠和控制字符；
- 符号链接语义；
- 大小写或 Unicode 归一化路径冲突；
- 未声明、重复或超限文件；
- 非 UTF-8 内容；
- manifest/receipt/package 不一致；
- 摘要、签名或 Host 授权失败。

安装后 Host 应从托管版本目录加载代码，而不是从用户选择的原始本机路径运行。

## 6. 管理接口

Node Host 支持：

```text
SUB_STORE_EXTENSION_ADMIN_TOKEN
SUB_STORE_EXTENSION_ADMIN_TOKEN_HASH
```

没有 token 时当前本地 Node Host 可能处于 open 管理模式。只要服务暴露到局域网、反向代理或公网，就必须配置令牌，并限制管理 API 的网络访问。

CLI 可通过：

```text
SUB_STORE_EXTENSION_ADMIN_TOKEN
```

或 `--token` 传入。不要在 shell 历史、日志、截图或提交中泄露真实 token。

## 7. 开发开关

`SUB_STORE_EXTENSION_ALLOW_DIGEST_ONLY=true` 只能用于受控开发测试。它不能：

- 把 community digest 变成发布者签名；
- 绕过 official ID/publisher allowlist；
- 授权新的 executable manifest/package digest；
- 用于生产部署。

普通扩展开发文档不应指导用户通过关闭校验来测试新可执行字节。

## 8. 已知边界

- permission scope 尚未全部细粒度执行；
- frontend API、SDK specifier 和 UI kit ABI 还不是所有路径上的硬隔离边界；
- trusted-official bundle 在 Node 主进程和主页面上下文运行；
- update、rollback 和 transactional data purge 尚未实现；
- catalog sequence/expiry 尚不是完整 TUF 防回滚设计；
- package v1 只支持受限 UTF-8 文本，不支持 native module 或任意二进制；
- QX、Loon、Surge 等脚本 runtime 使用 Host 内嵌实现，不能把远程 Node package 当作同等动态插件。

## 9. 漏洞报告

报告应包括：

- 受影响 Host、前端和插件版本；
- extension ID、source URL 和 distribution；
- manifest/package/payload digest；
- 复现步骤与最小恶意包；
- 预期与实际信任判定；
- 是否涉及 token、私钥、路径穿越、SSRF 或执行边界。

不要在公开 issue 中附上真实管理 token、私钥或仍可利用的生产 URL。维护者应优先撤销受影响 source/key、保留审计材料，并发布新的不可变修复版本。
