@echo off
chcp 65001 >nul
cd /d "%~dp0"
python -m pip install -q edge-tts
python scripts\edge_voice.py %*
pause
