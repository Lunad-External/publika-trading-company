@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0download-images.ps1"
pause
