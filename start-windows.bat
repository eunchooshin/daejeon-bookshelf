@echo off
chcp 65001 > nul
cd /d "%~dp0"
start "" http://localhost:4173
py -m http.server 4173
if errorlevel 1 python -m http.server 4173
