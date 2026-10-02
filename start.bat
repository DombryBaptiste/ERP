@echo off
REM ============================================================
REM  PokeStock - lancement en un clic (Windows)
REM  1. Demarre l'API ASP.NET Core      -> http://localhost:5000
REM  2. Demarre Angular (ng serve)      -> http://localhost:4200
REM  3. Ouvre le navigateur
REM  Prerequis : .NET 8 SDK, Node.js 20.19+ ou 22+, MySQL demarre
REM ============================================================
chcp 65001 >nul
title PokeStock - Lancement
cd /d "%~dp0"
set NG_CLI_ANALYTICS=false

where dotnet >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] Le SDK .NET est introuvable. Installez .NET 8 SDK : https://dotnet.microsoft.com/download
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] Node.js est introuvable. Installez Node.js LTS : https://nodejs.org
  pause
  exit /b 1
)

REM ---- 1. Backend ----
echo [1/3] Demarrage de l'API sur http://localhost:5000 ...
start "PokeStock API" /D "%~dp0backend" cmd /k dotnet run

REM ---- 2. Frontend (installation des dependances au premier lancement) ----
if not exist "%~dp0frontend\node_modules" (
  echo [2/3] Premier lancement : installation des dependances npm, cela peut prendre quelques minutes...
  pushd "%~dp0frontend"
  call npm install
  popd
)
echo [2/3] Demarrage d'Angular sur http://localhost:4200 ...
start "PokeStock Web" /D "%~dp0frontend" cmd /k npm start

REM ---- 3. Attente d'Angular puis ouverture du navigateur ----
echo [3/3] Attente de la compilation Angular...
set /a tries=0
:wait_front
timeout /t 3 /nobreak >nul
set /a tries+=1
curl -s -o nul http://localhost:4200 >nul 2>nul
if not errorlevel 1 goto open_browser
if %tries% lss 60 goto wait_front
echo Angular met du temps a demarrer, ouverture du navigateur quand meme.

:open_browser
start "" http://localhost:4200
echo.
echo PokeStock est lance. Fermez les fenetres "PokeStock API" et "PokeStock Web" pour arreter.
timeout /t 5 >nul
exit /b 0
