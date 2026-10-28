# SOP-work

方便快速编写 SOP 的工具。保留既有表格版式，支持公司名称与 Logo 设置、固定内容沿用、正文页任意排序、自动分页和页码更新、项目导入导出、可编辑 Word 导出及 PDF 预览。浏览器版和 Windows 桌面版使用同一份编辑代码。

## 在 SOP-work 云端环境继续开发

选择已配置的 **SOP-work** 环境和本仓库 `main` 分支。仓库根目录使用 Node.js 22 及以上版本；浏览器编辑器没有需要安装的运行依赖。

```sh
npm test
npm run dev -- --host 0.0.0.0 --port 4173
```

默认页面为 `http://localhost:4173`。如云端环境支持端口预览，打开 4173 端口即可。环境需要填写初始化命令时可使用 `bash scripts/cloud-setup.sh`，只执行源码与通用资源检查。

本次迁入的是通用工具源码，项目默认公司信息为空。原公司 SOP、Logo、现场照片、测试项目、本地缓存和旧安装包保留在原电脑，未上传仓库。已有内容通过工具的“保存项目”和“导入”继续使用。

## 本地使用与编辑

直接打开 `outputs/SOP工作台/index.html`，或执行上面的预览命令。主要文件：

| 路径 | 用途 |
| --- | --- |
| `outputs/SOP工作台/app.js` | 编写、固定沿用、分页、排序、预览和本地保存 |
| `outputs/SOP工作台/word.js` | DOCX 导入、原生文字与表格导出、公司 Logo |
| `outputs/SOP工作台/native-shapes.js` | 独立可编辑的箭头、圈选、文字框和流程图 |
| `outputs/SOP工作台/style.css` | 编辑器界面及 SOP 打印版式 |
| `outputs/SOP工作台/assets.js` | 通用空白项目与版式骨架 |
| `desktop/` | Windows 桌面窗口、保存对话框及 PDF 导出 |
| `scripts/` | 跨平台预览和云端检查 |

在“固定格式”中修改公司名称、上传/移除 Logo、调整保密文字及页脚，预览和导出同步更新。新建项目沿用当前设置。正文页可拖动或通过“移动到…”移动、交换；封面、修改履历和流程图保留原顺序。

Word 中的文字、表格、图片、标注和流程图保持可编辑；PDF 用于定稿浏览。项目自动保存在当前设备及来源下的本地存储中，定期使用“保存项目”导出 `.sop.json` 备份。迁入仓库不包含本机浏览器里的自动保存数据。

## 验证

`npm test` 无需额外依赖，检查 JavaScript 语法、通用资源、版式中的原稿信息清理和页面脚本引用。

涉及内容、排序或 Word 导出的改动，可安装 Playwright 后运行浏览器冒烟测试：

```sh
npm install --no-save playwright@1.62.1
npx playwright install chromium
npm run test:browser
```

也可通过 `SOP_PLAYWRIGHT_MODULE` 指向环境已有的 Playwright 模块，通过 `SOP_TEST_BROWSER` 指定已有浏览器程序。测试使用独立浏览器上下文，覆盖公司/Logo、正文排序与页码、Word 往返和自动保存。

## Windows 软件打包

仓库 Actions 中提供手动触发的 **Build Windows app** 工作流，在 Windows 构建器上生成安装 EXE 和免安装 ZIP；完成后从该次运行的 `SOPStudio-Windows-x64` artifact 下载。工作流不会自动发布 Release，不包含真实 SOP 内容。

在普通 Windows 开发机上也可以执行：

```sh
cd desktop
pnpm install --frozen-lockfile --ignore-scripts
node node_modules/electron/install.js
python prepare-renderer.py
node node_modules/electron-builder/out/cli/cli.js --win nsis zip --x64 --publish never
```

使用 pnpm 11.25.0、Node.js 24 和 Python 3.13。构建输出在 `outputs/软件安装包/`，运行软件无需另装这些开发工具。

`desktop/build-windows.py` 与根目录“打包桌面软件.cmd”保留原电脑上的手工构建路径，需要原本地 `work/` 内的公开运行时及 NSIS 工具缓存；新的云端或普通 Windows 检出请使用上述工作流。当前未配置数字签名证书。
