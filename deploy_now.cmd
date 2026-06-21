@echo off
REM Tiện ích chạy deploy_prod.py từ Windows. Sẽ tự hỏi mật khẩu VPS.
cd /d "%~dp0"
echo === OKR Automation - Deploy production ===
echo Folder: %CD%
echo.
where python >nul 2>nul
if errorlevel 1 (
  echo [LOI] Khong tim thay python trong PATH. Vui long cai Python 3.10+ va paramiko.
  pause
  exit /b 1
)
python -c "import paramiko" 2>nul
if errorlevel 1 (
  echo Cai paramiko...
  python -m pip install paramiko
)
python deploy_prod.py %*
echo.
echo === Hoan tat. Mo trinh duyet va vao http://xdk-pvcfc.com de kiem tra. ===
pause
