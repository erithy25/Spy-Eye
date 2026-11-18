@echo off
rem DATUM: Ortung aus Video in einem Schritt. Ruft datum.ps1 auf, ohne dass die
rem Ausfuehrungsrichtlinie von PowerShell geaendert werden muss.
rem   datum.cmd              pruefen, vorbereiten, starten
rem   datum.cmd -NurPruefen  alles bis zur Pruefung, ohne zu starten
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0datum.ps1" %*
exit /b %ERRORLEVEL%
