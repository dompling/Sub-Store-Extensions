# 安全策略

## 安全边界

配置生成器包含可以进入 Sub-Store Node 主进程和主前端运行时的代码，因此它不是普通的“下载后直接执行”社区插件。生产安装必须同时满足：

- 扩展 ID 和 publisher 在 Host 的 trusted-official allowlist 中；
- manifest 与 Host 官方 catalog 授权的 manifest digest 一致；
- Node package digest 与官方 catalog 授权值一致；
- receipt、variant、implementation ABI 和 entrypoint 一致；
- 所有 package 文件均在 file digest map 中，且没有额外文件、符号链接或不安全路径；
- package payload 通过 Host 信任的 Ed25519 公钥验证；
- frontend entry/style 的摘要与 manifest 一致；
- install hook 为 `false`。

`repository/` 是传输渠道，不是新的信任根。即使 GitHub Raw 或静态站点被篡改，Host 也应在加载代码前失败关闭。

## 管理接口

Node Host 的扩展管理 API 有三种模式：

- `open`：没有配置管理令牌，只适合本机或受信任网络；
- `token`：配置了 `SUB_STORE_EXTENSION_ADMIN_TOKEN` 或 `SUB_STORE_EXTENSION_ADMIN_TOKEN_HASH`；
- `read-only`：非 Node runtime，不能执行安装、启用、停用或卸载。

公开部署必须启用 token 模式，并通过反向代理限制管理 API 的网络可达范围。不要在日志、shell history、URL query 或 Git 仓库中保存明文令牌。

## 本地开发

`SUB_STORE_EXTENSION_ALLOW_DIGEST_ONLY=true` 不是通用的任意代码执行开关。官方可执行包仍需要满足 Host catalog 的 ID、manifest 和 package digest 授权。不要修改 Host 让这个变量跳过 official catalog、publisher 或 entrypoint 检查。

当前仓库只保存验证公钥。正式签名私钥不得进入仓库、CI 普通变量、构建产物或开发者共享目录。发布签名应在受控、可审计的 release 环境完成。

## 第三方扩展源

社区 source 只能提供 content-only package，不能声明：

- 后端或前端 executable entrypoint；
- executable files；
- install hook；
- reserved official extension ID；
- official publisher 身份。

非 loopback source 必须使用 HTTPS。即使来源是 GitHub，也建议把 catalog URL 固定到 tag 或 commit，而不是长期依赖可移动的 `main`。

## 报告漏洞

请不要在公开 issue 中披露可被利用的签名绕过、路径穿越、管理认证绕过、SSRF、任意代码执行或敏感数据泄露细节。配置远程仓库后，请通过仓库的私有安全报告渠道联系维护者，并提供：

- 受影响版本和 runtime；
- 最小复现；
- 预期与实际信任判断；
- 是否需要用户交互或管理令牌；
- 已知缓解措施。

在修复发布前，不要公开可执行 payload 或私钥材料。
