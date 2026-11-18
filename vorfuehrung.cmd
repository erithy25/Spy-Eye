@echo off
rem Sicht: Vorfuehrung in einem Schritt. Ruft vorfuehrung.ps1 auf, ohne dass die
rem Ausfuehrungsrichtlinie von PowerShell geaendert werden muss.
rem   vorfuehrung.cmd              pruefen, vorbereiten, starten
rem   vorfuehrung.cmd -NurPruefen  alles bis zur Pruefung, ohne zu starten
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0vorfuehrung.ps1" %*
exit /b %ERRORLEVEL%
