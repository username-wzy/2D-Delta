# GitHub Pages 发布

GitHub Pages 通过 GitHub Actions 发布静态站点。推送 `main` 分支上的 `client/**`、`tools/map-editor.html`、根 `index.html` 或本工作流后会自动部署；也可在 Actions 手动运行 “Publish GitHub Pages”。

工作流从仓库组装发布目录，仅包含游戏客户端、地图编辑器和根入口。根页面会跳转到 `/2D-Delta/client/`，游戏地址为 [在线游戏](https://username-wzy.github.io/2D-Delta/)，地图编辑器为 [在线地图编辑器](https://username-wzy.github.io/2D-Delta/tools/map-editor.html)。

客户端以相对路径加载脚本、地图、图集和字体，因此可在 GitHub Pages 的仓库子路径中运行。存档仍保存在当前浏览器本地；localhost、GitHub Pages、不同浏览器/设备分别存储，不会互相同步。
