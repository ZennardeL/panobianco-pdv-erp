@echo off
title SERVIDOR PDV & ERP PANOBIANCO 24H
color 0A
echo =======================================================
echo    INICIANDO SERVIDOR DA LOJINHA PANOBIANCO 24H...
echo =======================================================
cd /d "%~dp0"
node server.js
pause
