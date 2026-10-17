# 独立仓库初始化

项目显示名：2D Delta。GitHub 仓库名：`2D-Delta`。初始化日期：2026-10-17。

## 来源

当前项目以 Emoji-Delta 的工作区快照初始化，包含尚未提交的美术接入。共复制 88 个源码、配置、图像、字体和文档文件；逐文件 SHA256 见 [source-snapshot.json](source-snapshot.json)。

复制时使用原项目已跟踪文件与未忽略的新文件列表，排除原 `.git`、被忽略的构建目录、依赖缓存、本地环境配置、凭据及浏览器档案。新仓库通过 `git init -b main` 初始化，初始提交没有父提交，不导入原历史，也不是 GitHub fork。

快照记录原始复制内容的哈希；后续名称、文档和开发工具调整通过新的提交记录。原审查、修复和资产生成文档保留历史事实与原始提示词。

## 提交阶段

1. `chore: initialize independent 2D Delta codebase`：导入已校验的源码与美术快照，创建全新根提交。
2. `chore: configure 2D Delta development workflow`：设置项目名称、README、完整 MVP 路线图、开发服务、配置检查及 CI。
3. 若初始化验证发现问题，单独提交必要修复并记录实际测试结果。

## 运行与验证

```powershell
npm run dev
npm run check
npm test
```

真实 Chrome 图像检查为 `npm run test:assets`，需要 Playwright 和 Chrome；浏览器不读取真实用户档案。

后续功能以 [ROADMAP.md](../../ROADMAP.md) 的完整 MVP 目标继续推进。本次初始化没有把账号取消、体力修复或 UI 重做标记为完成。
