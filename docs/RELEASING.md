# 发布指南

## 重要约束

本仓库包含当前 release 的公钥和签名产物，但不包含、也不应该包含签名私钥。

以下任意变化都会让当前签名失效：

- manifest 字段，包括 homepage、description、permissions、variants；
- version；
- backend/front-end 源码导致的 bundle 字节；
- CSS、内联图片或构建工具输出；
- receipt；
- 文件列表、路径或摘要；
- selected variant 或 executable flags。

`scripts/assemble-package.mjs` 只能把当前 metadata 与构建字节组合并验证，不能签发新版本。`scripts/publish-repository.mjs` 只能重建静态传输文档，也不能授权新 package digest。

## Release 准备

1. 确认功能与迁移策略完成。
2. 升级 root `package.json` 和 source manifest version。
3. 如需更新 homepage，使用已经配置好的新远程仓库地址。
4. 评审 permissions、runtime variants、frontend ABI、backend ABI 和 storage schema。
5. 运行类型检查、测试、Host 集成测试和桌面/移动端 UI 回归。
6. 使用固定 Node、pnpm、lockfile 和构建环境生成 release bundle。

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test:built
```

## 官方签名阶段

正式 release 系统需要完成：

1. 计算每个 payload 文件的 SHA-256；
2. 构造 canonical package projection；
3. 计算 package digest；
4. 生成与 manifest/variant/implementation lanes 匹配的 receipt；
5. 构造 signed payload；
6. 在受控环境用 Ed25519 release private key 签名；
7. 更新 package metadata；
8. 更新 Host 官方 signed catalog 中该 ID/version 的 manifest digest 和各 runtime package digest；
9. 将对应公钥/key ID 加入 Host trust root，或按密钥轮换流程发布；
10. 在干净环境使用 Host verifier 重新验证。

不要把一次性生成 key 的准备脚本当作生产签名系统。生产系统必须有稳定密钥托管、最小权限、审计、轮换、吊销、双人复核和可重现输入。

## 同步 Host 授权

配置生成器是 trusted-official executable extension。仅在本仓库生成一个有效 Ed25519 签名还不够；Sub-Store Host 还必须发布匹配的：

- allowlisted extension ID/publisher；
- official manifest digest；
- Node package digest；
- script runtime embedded implementation receipt/digest；
- trusted public key；
- frontend embedded/public asset 路径（若相关）。

这一步是故意的双重授权，防止独立 mirror 自行把另一份代码伪装为官方扩展。

## 生成交付物

完成签名 metadata 和 Host catalog 更新后：

```bash
corepack pnpm package:assemble
corepack pnpm repository
corepack pnpm verify
```

检查：

- `dist/package/<id>` 可通过本地目录安装；
- `repository/catalog.json` 的 relative package URL 正确；
- repository envelope payload 与目录包相同；
- package、payload、manifest、receipt 与 frontend asset digest 全部闭合；
- 没有私钥、临时密钥、token 或本地绝对路径进入 Git。

## 候选验证

至少执行：

- 新安装；
- 从旧版本保留数据重装；
- 启用/停用；
- Host 重启后重新激活；
- package 文件被篡改时失败关闭；
- source catalog 被篡改时失败关闭；
- token/open/read-only 三种管理模式；
- Node 与每个 embedded script runtime；
- Surge/QX/Clash/Loon 导入、预览与下载；
- zh/en/ru locale 协调版本。

## Git 与远程发布

1. 提交 source、signed package、repository 和 Host 授权变更。
2. 使用 Lore protocol 记录信任约束和测试证据。
3. 创建不可变 release tag。
4. 使用 tag 或 commit 的 GitHub Raw catalog URL。
5. 发布 checksum 和 key ID，保留构建日志与签名审计记录。

移动分支 `main` 可以用于开发 source，但生产订阅应优先固定 tag/commit。
