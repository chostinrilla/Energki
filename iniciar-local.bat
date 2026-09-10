@echo off
REM Doble clic en este archivo para levantar el sitio en local con el backend funcionando.
REM Abre despues, en tu navegador: http://localhost:8888/HTMLS/dashboard.html
REM Para apagarlo, cierra esta ventana o presiona Ctrl+C.

cd /d "%~dp0"
echo Iniciando PRP Energki en local...
echo Abre en tu navegador: http://localhost:8888/HTMLS/dashboard.html
echo.
call npx netlify dev --port 8888
pause
