@echo off
title Pixopik Motion Studio - After Effects Installer
echo Installing Pixopik Motion Studio for Adobe After Effects...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-ae-windows.ps1"
echo.
pause
