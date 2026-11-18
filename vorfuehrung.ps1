<#
  Sicht: Vorführung in einem Schritt (Windows, PowerShell ab 5.1).

    .\vorfuehrung.cmd                 prüft, bereitet vor, prüft, startet drei Knoten, öffnet den Browser
    .\vorfuehrung.cmd -NurPruefen     alles bis zur Prüfung, ohne zu starten
    .\vorfuehrung.cmd -OhneBrowser    startet, ohne den Browser zu öffnen

  Der erste Lauf lädt rund 950 MB Modelle und rund 300 MB Übungsmaterial und wertet das Material
  aus (fünf bis zehn Minuten). Jeder weitere Lauf stellt den vorbereiteten Ausgangsstand in einer
  Sekunde wieder her. Beenden: Strg+C in diesem Fenster.

  Die Schritte einzeln stehen in UEBERGABE.md; dieses Skript tut nichts anderes.
#>
param(
  [switch]$NurPruefen,
  [switch]$OhneBrowser
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

# Windows hält ein Konsolenprogramm an, sobald im Fenster Text markiert wird (QuickEdit): Der
# Knoten kann dann nicht weiterschreiben und beantwortet keine Anfrage mehr, der Browser lädt
# endlos. Für dieses Fenster wird QuickEdit deshalb ausgeschaltet (Einfügen mit Rechtsklick
# bleibt). Gelingt das nicht (anderes Terminal), läuft alles wie bisher.
try {
  Add-Type -Namespace DatumKonsole -Name Modus -ErrorAction Stop -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int nStdHandle);
[DllImport("kernel32.dll")] public static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);
[DllImport("kernel32.dll")] public static extern bool SetConsoleMode(IntPtr hConsoleHandle, uint dwMode);
'@
  $eingabe = [DatumKonsole.Modus]::GetStdHandle(-10)
  [uint32]$modus = 0
  if ([DatumKonsole.Modus]::GetConsoleMode($eingabe, [ref]$modus)) {
    # 0x40 = ENABLE_QUICK_EDIT_MODE aus, 0x80 = ENABLE_EXTENDED_FLAGS an (sonst wirkt das Ausschalten nicht).
    [void][DatumKonsole.Modus]::SetConsoleMode($eingabe, [uint32](($modus -band 0xFFFFFFBF) -bor 0x80))
  }
} catch {
  # Kein klassisches Konsolenfenster: nichts zu tun.
}

function Sage([string]$Text) { Write-Host $Text }
function Abbruch([string]$Text) {
  Write-Host ''
  Write-Host "ABBRUCH: $Text" -ForegroundColor White -BackgroundColor DarkGray
  exit 1
}

# Führt einen Befehl aus und bricht ab, wenn er scheitert. Programme melden ihr Scheitern über
# den Rückgabewert, nicht als Ausnahme; deshalb wird er nach jedem Aufruf geprüft.
function Schritt([string]$Titel, [scriptblock]$Befehl, [string]$Hilfe) {
  Write-Host ''
  Write-Host "== $Titel"
  & $Befehl
  if ($LASTEXITCODE -ne 0) {
    if ($Hilfe) { Abbruch "$Titel ist gescheitert. $Hilfe" }
    Abbruch "$Titel ist gescheitert (Rückgabewert $LASTEXITCODE). Die Meldung darüber nennt den Grund."
  }
}

Sage 'Sicht: Vorführung vorbereiten und starten'

# ---------------------------------------------------------------- Voraussetzungen
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Abbruch 'Node wurde nicht gefunden. Installieren mit:  winget install OpenJS.NodeJS.LTS   Danach ein neues Fenster öffnen.' }
$nodeVersion = (& node -p 'process.versions.node')
$teile = $nodeVersion.Split('.')
$major = [int]$teile[0]
$minor = [int]$teile[1]
if (($major -lt 20) -or (($major -eq 20) -and ($minor -lt 11))) {
  Abbruch "Node $nodeVersion ist zu alt; gebraucht wird 20.11 oder neuer. Aktualisieren mit:  winget upgrade OpenJS.NodeJS.LTS"
}

$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpm) { Abbruch 'pnpm wurde nicht gefunden. Installieren mit:  npm install -g pnpm   Danach ein neues Fenster öffnen.' }

$ffmpegName = 'ffmpeg'
if ($env:FFMPEG_PATH) { $ffmpegName = $env:FFMPEG_PATH }
$ffmpeg = Get-Command $ffmpegName -ErrorAction SilentlyContinue
if (-not $ffmpeg) { Abbruch 'ffmpeg wurde nicht gefunden. Installieren mit:  winget install Gyan.FFmpeg   Danach ein neues Fenster öffnen.' }

Sage "  Node $nodeVersion, pnpm $(& pnpm --version), ffmpeg vorhanden"

# Belegte Anschlüsse: Die Knoten einer früheren Vorführung laufen noch.
$belegt = @()
foreach ($port in 8787, 8788, 8789) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $client.Connect('127.0.0.1', $port)
    $belegt += $port
  } catch {
    # frei
  } finally {
    $client.Close()
  }
}
if ($belegt.Count -gt 0) {
  # Antwortet dort ein Knoten von Sicht, läuft schon eine Vorführung. Sonst hält etwas anderes
  # den Anschluss, am ehesten eine frühere Fassung dieses Programms.
  $istSicht = $false
  try {
    $antwort = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$($belegt[0])/api/public/info" -TimeoutSec 3
    if ($antwort.Content -match '"version"') { $istSicht = $true }
  } catch {
    $istSicht = $false
  }
  if ($istSicht) {
    Abbruch "Die Anschlüsse $($belegt -join ', ') sind belegt: Eine Vorführung läuft schon. Dort weiterarbeiten (http://127.0.0.1:8787) oder sie mit Strg+C in ihrem Fenster beenden und diesen Befehl wiederholen."
  }
  Abbruch "Die Anschlüsse $($belegt -join ', ') sind belegt, aber dort antwortet kein Knoten von Sicht. Vermutlich läuft noch eine frühere Fassung (Spy-Eye) oder ein anderes Programm. Dessen Fenster mit Strg+C beenden und diesen Befehl wiederholen."
}

# ---------------------------------------------------------------- einrichten
Schritt 'Pakete einrichten (pnpm install)' { pnpm install } 'Häufigster Grund: keine Verbindung zum Netz.'
Schritt 'Bauen (pnpm build)' { pnpm build }

# ---------------------------------------------------------------- vorbereiten oder zurücksetzen
$vorbereitet = Test-Path -Path (Join-Path $PSScriptRoot 'data-koblenz\.prepared\manifest.json')
if ($vorbereitet) {
  Schritt 'Ausgangsstand wiederherstellen (pnpm demo:reset)' { pnpm demo:reset }
} else {
  Schritt 'Übungsmaterial laden (pnpm exercise:fetch)' { pnpm exercise:fetch } 'Häufigster Grund: keine Verbindung zum Netz.'
  Schritt 'Material auswerten (pnpm demo:prepare), fünf bis zehn Minuten' { pnpm demo:prepare }
}

# ---------------------------------------------------------------- prüfen
Schritt 'Prüfen (pnpm demo:check)' { pnpm demo:check } 'Jede Zeile mit FEHLT nennt den nächsten Schritt.'
# Die Prüfung meldet sich an und stellt Fragen; das steht danach im Protokoll. Die Vorführung
# beginnt vom vorbereiteten Stand ohne diese Einträge.
Schritt 'Ausgangsstand herstellen (pnpm demo:reset)' { pnpm demo:reset }

if ($NurPruefen) {
  Sage ''
  Sage 'Bereit. Start der Vorführung:  .\vorfuehrung.cmd'
  exit 0
}

# ---------------------------------------------------------------- starten
Sage ''
Sage 'Die Vorführung startet. Hauptbildschirm: http://127.0.0.1:8787'
Sage 'Anmeldung: leitung   Passwort: lagebild   Mandat: Übung RHEIN-MOSEL'
Sage 'Beenden: Strg+C in diesem Fenster. Danach stellt derselbe Befehl den Ausgangsstand wieder her.'

if (-not $OhneBrowser) {
  # Öffnet den Browser, sobald der erste Knoten antwortet. Gelingt das nicht, startet die
  # Vorführung trotzdem; die Adresse steht oben.
  try {
  Start-Job -ScriptBlock {
    for ($i = 0; $i -lt 180; $i++) {
      try {
        Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/api/public/info' -TimeoutSec 2 | Out-Null
        Start-Process 'http://127.0.0.1:8787'
        break
      } catch {
        Start-Sleep -Seconds 1
      }
    }
  } | Out-Null
  } catch {
    Sage 'Der Browser ließ sich nicht selbsttätig öffnen. Bitte http://127.0.0.1:8787 von Hand aufrufen.'
  }
}

pnpm demo
exit $LASTEXITCODE
