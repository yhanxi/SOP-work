@echo off
setlocal
chcp 65001 >nul
pushd "%~dp0"
if errorlevel 1 exit /b 1
node scripts\serve.cjs --open
set "sop_launch_status=%errorlevel%"
popd
if not "%sop_launch_status%"=="0" pause
exit /b %sop_launch_status%
