@echo off
echo ========================================
echo   Aspen Plus Batch Runner GUI
echo ========================================
echo.
echo Starting GUI...
echo.

cd /d "%~dp0"

REM Try different Python launcher commands
where python >nul 2>&1
if %errorlevel% equ 0 (
    python -X utf8 batch_gui.py
    goto :end
)

where py >nul 2>&1
if %errorlevel% equ 0 (
    py -X utf8 batch_gui.py
    goto :end
)

where python3 >nul 2>&1
if %errorlevel% equ 0 (
    python3 -X utf8 batch_gui.py
    goto :end
)

echo.
echo [ERROR] Python not found!
echo.
echo Please make sure Python 3.x is installed and added to PATH.
echo.
echo Or run directly from the command line:
echo   python -X utf8 batch_gui.py
echo.
pause
goto :end

:end
if errorlevel 1 (
    echo.
    echo Program exited with an error!
    echo.
    pause
)
