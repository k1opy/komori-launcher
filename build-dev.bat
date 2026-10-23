@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Сборка DEV-установщика (только для тебя, не для игроков) ===
call npm install --no-audit --no-fund
call npm run dist:dev
if errorlevel 1 (echo. & echo Сборка не удалась - пришли скрин этого окна & pause & exit /b 1)
echo.
echo Готово: установщик лежит в папке dist
start "" "%~dp0dist"
pause
