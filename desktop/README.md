# 桌面版

`main.cjs` 提供隔离桌面窗口、Word/项目文件保存对话框及 PDF 导出。`preload.cjs` 只暴露 PDF 和关闭前保存接口。正文编辑代码仍在 `../outputs/SOP工作台/`，修改后运行 `python prepare-renderer.py` 更新桌面渲染资源。

`blank-assets.js` 是通用空白资源，应与浏览器版 `assets.js` 保持相同。`prepare-assets.py` 用于重新整理通用模板与图标，只有修改模板骨架时才需要运行；该脚本需要 lxml 和 Pillow。

云端 Windows 构建见根目录 README 和 `.github/workflows/windows.yml`。Linux 云端环境用于编辑、检查和浏览器预览，Windows 安装包在 Windows runner 上构建。

用户数据与安装目录分离。卸载保留用户数据；自动保存只保存最近一份项目，重要内容仍应导出 `.sop.json` 备份。源码迁移不会自动同步浏览器或桌面端的历史项目。
