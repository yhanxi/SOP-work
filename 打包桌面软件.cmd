@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "SOP_BUILD_PYTHON=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if exist "%SOP_BUILD_PYTHON%" (
  "%SOP_BUILD_PYTHON%" "desktop\build-windows.py"
) else (
  python "desktop\build-windows.py"
)
if errorlevel 1 (
  echo 打包失败，请查看上方错误。
) else (
  echo 安装包已生成在 outputs\软件安装包。
)
pause
