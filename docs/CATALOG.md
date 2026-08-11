# 扩展源、作者与 GitHub 托管

## 目录结构

```text
repository/
├── catalog.json
└── packages/
    └── org.substore.config-generator/
        └── 1.1.0/
            └── node.json
```

`catalog.json` 负责发现和展示，`node.json` 是包含 manifest、receipt、payload 与 signature 的安装 envelope。

## Catalog entry

配置生成器 entry 的关键字段：

```json
{
  "id": "org.substore.config-generator",
  "version": "1.1.0",
  "manifest": {},
  "distribution": "trusted-official-mirror",
  "packageUrls": {
    "node": "./packages/org.substore.config-generator/1.1.0/node.json"
  },
  "packageDigests": {
    "node": "c9dced66..."
  },
  "source": "sub-store-config-generator-repository",
  "sourceName": "Sub-Store Config Generator"
}
```

`packageUrls` 应优先使用相对 URL，便于整个 `repository/` 在 GitHub Raw、GitLab Pages、对象存储或本地 loopback server 中移动。

## 作者、发布者与来源

三个概念应分开：

- publisher：对扩展身份和签名负责的主体，来自 manifest；
- source author/operator：维护 catalog 或 mirror 的主体；
- source URL：用户实际添加的 catalog 地址。

对于 `trusted-official-mirror`，mirror 可以由独立 Git 仓库托管，但不能改写官方 publisher、manifest 或 package digest。Host 会把 mirror entry 与内置官方 catalog 比较。

第三方 community catalog 应在顶层和 entry 中提供清晰的 publisher/source name，UI 可以据此显示“来自谁、由谁发布、从哪里订阅”。来源信息不是信任证明；实际准入仍由 content-only contract 和摘要校验决定。

## GitHub Raw

远程仓库配置后，推荐 URL：

```text
https://raw.githubusercontent.com/<owner>/<repository>/<tag-or-commit>/repository/catalog.json
```

开发阶段可以使用：

```text
https://raw.githubusercontent.com/<owner>/<repository>/main/repository/catalog.json
```

发布阶段优先 tag/commit，因为它能把 catalog、package envelope 和 Git 历史固定到同一版本。

不要在 URL 中加入需要暴露的 GitHub token。私有仓库需要由受控代理或 Host credential handle 解决，不能把长期凭证写进扩展 source。

## 本地服务

```bash
corepack pnpm repository
corepack pnpm repository:serve
```

服务地址：

```text
http://127.0.0.1:8765/catalog.json
```

Server 只暴露 `repository/` 下的普通文件，拒绝路径逃逸。它适合 source 解析回归，不是生产服务器。

## Host 校验流程

添加 trusted official mirror 时，Host 会：

1. 规范化并检查 source URL；
2. 获取 catalog，限制重定向、响应大小和网络目标；
3. 确认 entry ID 没有与其他 source 冲突；
4. 确认 manifest 与 Host official manifest canonical equal；
5. 确认 package digest 得到 official catalog 授权；
6. 安装时重新下载 envelope；
7. 重新验证文件摘要、receipt 和 Ed25519 签名；
8. 验证 entrypoint 后才写入/激活 package。

因此 source operator 不能只改 `packageUrl` 或 `packageDigest` 来替换官方代码。

## 发布命令的边界

```bash
corepack pnpm repository
```

该命令从 `package/org.substore.config-generator` 读取现有签名包，确定性重建 catalog 和 envelope。它不会：

- 生成或读取私钥；
- 更新签名；
- 授权新的 manifest/package digest；
- 修改 Sub-Store Host 的 official catalog。

如果 package 已经变更但未正式签名，命令应在验证阶段失败，而不是产生一个看似可安装的 catalog。
