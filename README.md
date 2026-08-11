# 生活工作台 · Life Workbench

个人单用户生活管理 PWA：账单 / 习惯 / 待办 / 购物 / 媒体 / 速记 Inbox / 全局搜索 / 云端备份（Supabase + AES 加密）。

本仓库即 **GitHub Pages 站点根目录**，发布方式：从 `main` 分支的根目录（`/(root)`）直接发布，无需构建。

## 文件说明
- `index.html` —— 应用主程序（单文件，内联 CSS/JS）
- `sw.js` —— Service Worker（PWA 离线 / 安装），缓存版本 `life-workbench-v24`
- `.nojekyll` —— 关闭 Jekyll 处理，避免静态文件被误改

## 发布到 GitHub Pages（首次）
1. 在 GitHub 新建一个**公开**仓库（例如 `life-workbench-site`）。
2. 在本仓库目录执行：
   ```bash
   git remote add origin https://github.com/<你的用户名>/<仓库名>.git
   git branch -M main
   git push -u origin main
   ```
3. 仓库 **Settings → Pages → Build and deployment → Source** 选
   `Deploy from a branch`，Branch 选 `main` / `/(root)`，保存。
4. 几分钟后访问：`https://<你的用户名>.github.io/<仓库名>/`

> 提示：GitHub Pages 提供免费 HTTPS 与永久固定链接，不受沙箱生命周期影响。

## 后续更新
把最新的 `index.html`（以及 `sw.js`，若版本号变更）复制到本仓库根目录覆盖，然后：
```bash
git add -A
git commit -m "update"
git push
```
发布后，用户端**强制刷新一次**（或等待 SW 缓存过期）即可加载新版本。

## 与原 CloudStudio 部署的关系
CloudStudio 是临时沙箱（曾出现 `12803` 失效）。GitHub Pages 作为稳定的主链接；
如需，可在应用「设置」里把云端备份 / 恢复地址指向新链接对应的 Supabase 配置（备份数据独立于部署）。
