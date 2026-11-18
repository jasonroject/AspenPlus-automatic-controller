@echo off
cd /d "%~dp0"
where python >nul 2>&1
if %errorlevel% equ 0 (
    python -X utf8 web_server.py
    goto :end
)
where py >nul 2>&1
if %errorlevel% equ 0 (
    py -3 -X utf8 web_server.py
    goto :end
)
echo Python was not found. Install Python and pywin32 first.
pause
exit /b 1
:end
if errorlevel 1 pause
