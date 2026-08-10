@echo off
:: Batch Installer Vlinked Windows Service
echo ========================================================
echo   Installing Vlinked Agent Service (Lockscreen Mode)
echo ========================================================

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Error: Skrip ini harus dijalankan sebagai Administrator (Run as Administrator).
    pause
    exit /b 1
)

cd /d "%~dp0"

if exist winsw.exe (
    winsw.exe install vlinked-service.xml
    winsw.exe start vlinked-service.xml
    echo.
    echo Status: Vlinked Service berhasil terinstall dan berjalan di background OS!
) else (
    echo Menyiapkan Windows Service via sc.exe...
    sc create VlinkedService binPath= "\"%~dp0..\dist\win-unpacked\Vlinked.exe\" --headless" start= auto
    sc start VlinkedService
    echo.
    echo Status: VlinkedService berhasil dibuat via sc.exe!
)

pause
