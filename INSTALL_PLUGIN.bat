@echo off
setlocal
echo =========================================================
echo   Pixopik Motion Studio PRO v1.3 Installer
echo   (After Effects Plugin + Clean Chrome Ghost Extension)
echo =========================================================

for %%V in (9 10 11 12) do (
  reg add "HKCU\Software\Adobe\CSXS.%%V" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
)

set "SRC=%~dp0cep-plugin"
set "DST=%APPDATA%\Adobe\CEP\extensions\com.thepixopik.aftereffects.mcp"

if exist "%DST%" rmdir /s /q "%DST%"
mkdir "%DST%"
xcopy /E /I /Y "%SRC%\*" "%DST%\" >nul

set "CHR_SRC=%~dp0chrome-extension"
set "CHR_DST=%USERPROFILE%\Videos\PixopikRecordings\Pixopik_Chrome_Extension"
if exist "%CHR_SRC%" (
  if exist "%CHR_DST%" rmdir /s /q "%CHR_DST%"
  mkdir "%CHR_DST%"
  xcopy /E /I /Y "%CHR_SRC%\*" "%CHR_DST%\" >nul
)

echo.
echo [SUCCESS] 1. After Effects Plugin v1.3 installed!
echo [SUCCESS] 2. Chrome Presenter Extension copied to:
echo              %CHR_DST%
echo.
echo One-Time Chrome Extension Setup (10 seconds):
echo   1. Open Chrome and type: chrome://extensions
echo   2. Turn ON "Developer mode" (top-right)
echo   3. Click "Load unpacked" and select:
echo      %CHR_DST%
echo.
pause
