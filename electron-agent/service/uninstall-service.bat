@echo off
:: Batch Uninstaller Vlinked Windows Service
echo ========================================================
echo   Uninstalling Vlinked Agent Windows Service
echo ========================================================

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Error: Skrip ini harus dijalankan sebagai Administrator (Run as Administrator).
    pause
    exit /b 1
)

cd /d "%~dp0"

if exist winsw.exe (
    winsw.exe stop vlinked-service.xml
    winsw.exe uninstall vlinked-service.xml
    echo.
    echo Status: Vlinked Service berhasil di-uninstall!
) else (
    sc stop VlinkedService
    sc delete VlinkedService
    echo.
    echo Status: VlinkedService berhasil dihapus dari Windows Service Manager!
)

pause
