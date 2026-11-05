# SOP 工作台

用于编写制造作业指导书的离线工具，提供浏览器工作台和 Windows 桌面软件。

- 公司名称、Logo、保密等级、页眉页脚和签字信息可编辑，默认使用通用空白模板。
- 封面、修改履历、流程图和工序页可编辑、移动与排序。只有工序页参与页码统计。
- 操作步骤和技术要求支持共用字号、字间距，文字和格式可以分别固定沿用。
- 画布支持照片、文字框、矩形、椭圆、菱形、三角形和箭头，以及样式记忆、连接跟随、对齐吸附和框选。
- 工艺流程图支持主工序、预装支线、汇入位置、跨列折线、关键工序标记及自定义步骤。
- 支持项目保存与恢复、DOCX 导入、可编辑 Word 导出和打印／PDF 预览。

## 下载与更新

软件安装包和更新文件发布在独立的 [SOP-work-releases 仓库](https://github.com/yhanxi/SOP-work-releases)。

首次使用请到[版本列表](https://github.com/yhanxi/SOP-work-releases/releases)，选择含 SOPStudio-Setup-VERSION-x64.exe 或完整 ZIP 的版本。安装版双击 EXE 安装，免安装版解压后运行 SOPStudio.exe。完整安装包与日常小更新的版本可能不同，安装后可通过「软件更新」升级到最新兼容版本。

日常更新使用签名 ASAR 程序包，由软件负责下载与安装。ASAR 文件无法作为安装程序直接运行。软件启动时可自动检查更新，也可手动检查；下载源支持自定义 HTTPS 备用目录。

## 项目与数据

项目保存为 .sop.json，包含文字、图片、画布对象、页序和设置。首次保存选择路径，之后 Ctrl+S 更新当前文件，Ctrl+Shift+S 另存为。自动恢复缓存用于意外退出后的恢复，建议同时保存正式项目文件。

项目和恢复缓存保存在使用者电脑上。更新功能联网检查版本及下载程序；编辑器没有项目上传或账号服务。通用模板中的公司名称、公司 Logo、编制、审核和批准信息默认留空。分享项目文件时，其中的公司信息、照片和签名内容也会一起分享。

## 排版和导出

每道工序固定一页。文字、图片和物料超出空间时需要手动调整，或新增工序页拆分内容。图文画布使用正文文字之外的剩余空间。

Word 导出保留独立的文字、表格、照片、标注及流程图形状。折线连接按独立线段导出。导入原稿随项目保留，普通导出按工作台的固定单页模板重新生成。复杂原稿、字体差异和手工排版应在 Word／WPS 中核对。

## 本地运行

浏览器工作台位于 outputs/SOP工作台/，没有后端运行依赖。使用 Node.js 22 或更高版本运行本地服务。

~~~sh
npm run dev
~~~

打开 http://127.0.0.1:4173 。云端容器可使用以下命令。

~~~sh
npm run dev -- --host 0.0.0.0 --port 4173
~~~

## 源码结构

| 路径 | 用途 |
| --- | --- |
| outputs/SOP工作台/app.js | 项目编辑、固定沿用、页面顺序及预览 |
| outputs/SOP工作台/object-workspace.js | 图文画布、流程图及连接关系 |
| outputs/SOP工作台/word.js | DOCX 导入和导出 |
| outputs/SOP工作台/native-shapes.js | Word 中独立可编辑的形状与连线 |
| outputs/SOP工作台/assets.js | 通用空白模板 |
| desktop/ | Electron 桌面外壳、文件保存和更新 |
| tests/ | 数据、浏览器及更新回归检查 |

## 验证

~~~sh
npm test
~~~

需要验证浏览器交互时，先安装 Playwright 及 Chromium，再运行相关测试。

~~~sh
npm install --no-save playwright
npx playwright install chromium
npm run test:browser
npm run test:storage
node tests/flow-layout-browser.cjs
~~~

也可设置 SOP_PLAYWRIGHT_MODULE 和 SOP_TEST_BROWSER，使用本机已有的 Playwright 和浏览器。

## Windows 打包

仓库的 GitHub Actions 提供手动触发的 Build Windows app 工作流。Windows 构建产物包含安装 EXE 和完整 ZIP。

本地 Windows 构建需要 Node.js、pnpm 和 Python，具体依赖版本见 desktop/package.json 与锁文件。

~~~sh
cd desktop
pnpm install --frozen-lockfile --ignore-scripts
node node_modules/electron/install.js
python prepare-renderer.py
node node_modules/electron-builder/out/cli/cli.js --win nsis zip --x64 --publish never
~~~

desktop/build-windows.py 是依赖本机 work/ 运行时与 NSIS 缓存的手工构建脚本。普通检出请使用上述 Electron Builder 或 Actions 工作流。

## 更新发布

更新清单使用 Ed25519 签名，客户端校验签名、SHA256、程序版本、平台和运行时。desktop/update-public.pem 是公开验证公钥。发布私钥由维护者在仓库外保存。

~~~sh
node desktop/make-update.cjs PATH_TO_APP_ASAR PATH_TO_PRIVATE_PEM OUTPUT_DIRECTORY
~~~

发布仓库保存 SOPStudio-VERSION-app.asar、SOP-update.json、latest.json 和校验文件。备用目录需提供相同的签名清单与程序文件。更新清单签名与 Windows 安装 EXE 的代码签名属于不同机制，目前安装 EXE 未配置 Windows 代码签名证书。

## 许可证

本项目采用 [MIT License](LICENSE)，版权声明为 Copyright (c) 2026 yhanxi。

JSZip 保留在 [JSZip-LICENSE.md](outputs/SOP工作台/vendor/JSZip-LICENSE.md) 中的许可声明。Electron 及其打包组件沿用各自的许可证。
