# 2D Delta

俯视角 2D 搜打撤游戏。以当前 Emoji-Delta 工作区为起点独立初始化，采用全新的 Git 历史，后续在本仓库开发单机 MVP。

## 启动

需要 Node.js 22 或更新版本，前端没有需要安装的 npm 依赖：

```powershell
npm run dev
```

打开 [游戏页面](http://127.0.0.1:5173/client/)、[美术资产预览](http://127.0.0.1:5173/client/asset-preview.html) 或 [地图编辑器](http://127.0.0.1:5173/tools/map-editor.html)。服务仅监听本机回环地址，Ctrl+C 停止。

也可以沿用 Python 3：

```powershell
python -m http.server 8080 --bind 127.0.0.1
```

使用 Python 时地址端口为 8080。开发服务不会启动 C# 服务端，也不会自动发布网站。

## 当前基线

- 已有特工选择、商店、仓库、装备、战斗、搜索、撤离与本地结算的单机流程。
- 6 名特工、7 类敌人、8 把枪和 16 件装备/容器共用 4 张透明 PNG 图集；场景、贵重品和提示保留部分 Emoji。
- 当前仍包含原本的本地用户名/密码界面，取消账号流程属于下一步工作，不需要 GitHub 账号来游玩。
- 浏览器没有接入多人联机；`server/` 是保留的旧独立服务端代码，`docs/` 中的多人需求仅作为历史资料。
- 当前玩法参数仍以原实现为准，Delta Force 风格的机制与首页/UI 改造将分阶段实现，不能把初始化等同于 MVP 已完成。
- 存档保存在浏览器站点存储中，协议、主机或端口变化后不会自动迁移。初始化没有复制用户浏览器数据。

操作：WASD 移动，Shift 冲刺，鼠标瞄准与开火，R 换弹，1/2 切枪，F 交互，Tab 背包，4 药品，G 手雷，H 附近物品。

## 检查

```powershell
npm run check
npm test
```

`check` 检查 JavaScript 语法、模块引用、配置关联、PNG 文件与当前文档链接；`test` 执行原客户端的 17 组行为回归，使用 DOM、存储、音效和绘制替身。

真实 Chrome 资产检查需要可解析的 Playwright 包和已安装的 Chrome：

```powershell
npm run test:assets
```

Playwright 位于共享依赖目录时，先设置当前进程的 `NODE_PATH`。浏览器脚本使用隔离档案与临时回环服务，结束后自动关闭。结果与截图保存在 `docs/assets-2026-10-17/`。

GitHub Actions 对推送与拉取请求执行 `npm run check` 和 `npm test`。前端检查不依赖 .NET。

## 目录

| 路径 | 内容 |
|---|---|
| [client/](client/) | 游戏页面、Canvas、输入、AI、经济、配置和地图 |
| [client/assets/](client/assets/) | 4 张透明图集、生成提示词与说明 |
| [tools/](tools/) | 地图编辑器、开发服务及项目检查脚本 |
| [docs/](docs/) | 原有审查、回归证据与初始化记录 |
| [server/](server/) | 原独立 .NET 8 服务端；单机 MVP 不需要运行 |

[ROADMAP.md](ROADMAP.md) 记录完整 MVP 范围；[AGENT.md](AGENT.md) 记录协作要求；[初始化记录](docs/initialization/README.md) 说明来源与提交方式。历史验证文档中的日期、名称和测试范围保持原样。

后续每个独立阶段都提交代码、记录验证结果，再推进下一阶段。
