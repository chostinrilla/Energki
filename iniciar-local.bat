@echo off
REM Doble clic en este archivo para levantar el sitio en local con el backend funcionando.
REM Abre despues, en tu navegador: http://localhost:8888/HTMLS/dashboard.html
REM
REM Para probarlo desde OTRA computadora (misma red o cualquier otra, sin
REM hacer push ni gastar créditos de Netlify):
REM 1. La PRIMERA vez, inicia sesión de Netlify desde la terminal (abre el
REM    navegador para autorizar, es un solo paso): npx netlify login
REM 2. Corre este archivo. Va a imprimir una URL pública tipo
REM    https://algo-al-azar.netlify.live — ábrela desde la OTRA computadora
REM    (funciona aunque no esté en la misma red/Wi-Fi). Se apaga sola cuando
REM    cierras esta ventana.
REM
REM Alternativa si la otra compu SÍ está en la misma red Wi-Fi y no quieres
REM iniciar sesión: cambia --live por nada (deja solo --port 8888) y desde la
REM otra compu abre http://TU_IP_LOCAL:8888/HTMLS/dashboard.html (tu IP la ves
REM con "ipconfig", busca "Dirección IPv4" del adaptador Wi-Fi/Ethernet real).
REM Esto solo funciona si el router no aísla los dispositivos entre sí.
REM
REM Para apagarlo, cierra esta ventana o presiona Ctrl+C.

cd /d "%~dp0"
echo Iniciando PRP Energki en local...
echo Local:  http://localhost:8888/HTMLS/dashboard.html
echo Publico (para otra compu): mira mas abajo la URL "netlify.live" que va a aparecer.
echo.
call npx netlify dev --port 8888 --live
pause
