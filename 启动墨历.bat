@echo off
title 墨历启动器
cd /d "%~dp0"
set "PATH=%SystemRoot%\System32;%PATH%"

rem ============================================================
rem  墨历 · Markdown 简历工作台 —— 一键启动脚本
rem  双击运行：首次自动安装依赖，之后启动本地服务并打开浏览器
rem  停止服务：关闭弹出的「墨历服务」命令行窗口即可
rem ============================================================

rem --- 1. 定位 Node.js / npm（兼容 nvm 与默认安装位置）---
set "NPM_DIR="
where npm >nul 2>nul
if not errorlevel 1 goto have_npm_path
for /d %%D in ("%APPDATA%\nvm\v*") do set "NPM_DIR=%%~D"
if defined NPM_DIR goto have_npm_path
if exist "C:\Program Files\nodejs\npm.cmd" set "NPM_DIR=C:\Program Files\nodejs"
if defined NPM_DIR goto have_npm_path
echo [错误] 未找到 Node.js / npm，请先安装 Node.js 后重试。
echo        下载地址：https://nodejs.org/zh-cn
pause
exit /b 1

:have_npm_path
if defined NPM_DIR set "PATH=%NPM_DIR%;%PATH%"

rem --- 2. 首次运行：安装依赖 ---
if exist "node_modules\" goto check_run
echo [首次运行] 正在安装依赖，约 1-2 分钟，请稍候...
call npm install
if errorlevel 1 goto install_fail
goto check_run

:install_fail
echo [错误] 依赖安装失败，请检查网络后重新运行本脚本。
pause
exit /b 1

rem --- 3. 已在运行：直接打开页面 ---
:check_run
curl -s -o nul -m 2 http://localhost:5173/ >nul 2>nul
if not errorlevel 1 goto open_only

rem --- 4. 启动本地服务，Vite 就绪后自动打开浏览器 ---
echo 正在启动墨历（http://localhost:5173）...
echo 服务窗口保持开启即持续运行；关闭该窗口即可停止服务。
start "墨历服务" cmd /k npm run dev -- --open
exit /b 0

:open_only
echo 检测到墨历服务已在运行，正在打开页面...
start "" http://localhost:5173/
timeout /t 2 >nul
exit /b 0
