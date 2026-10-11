@echo off
setlocal
cd /d "%~dp0"
py -3 -m venv .venv
if errorlevel 1 goto failed
.venv\Scripts\python.exe -m pip install -r requirements.txt pyinstaller==6.16.0
if errorlevel 1 goto failed
.venv\Scripts\python.exe -m PyInstaller --noconfirm --clean --onefile --windowed --name PhoneTwinMonitor monitor.py
if errorlevel 1 goto failed
echo Created dist\PhoneTwinMonitor.exe
pause
exit /b 0
:failed
pause
exit /b 1
