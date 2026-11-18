<#
  DATUM: Ortung aus Video, Start in einem Schritt (Windows, PowerShell ab 5.1).

    .\datum.cmd                 prüft, lädt den Referenzbestand, wertet ihn aus, startet, öffnet den Browser
    .\datum.cmd -NurPruefen     alles bis zur Prüfung, ohne zu starten
    .\datum.cmd -OhneBrowser    startet, ohne den Browser zu öffnen

  Der erste Lauf lädt die Modelle (rund 1 GB), den Referenzbestand (Videos, Referenzbilder,
  Höhendaten) und wertet alles aus; das dauert je nach Rechner und Netz 20 bis 40 Minuten.
  Jeder weitere Lauf startet in unter einer Minute und braucht kein Netz.
  Beenden: Strg+C in diesem Fenster.
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

Sage 'DATUM: Ortung aus Video vorbereiten und starten'

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

# Welcher Stand gestartet wird: Commit und Zweig. Steht hier nicht der erwartete Stand, ist
# "git pull" nicht durchgelaufen (zum Beispiel wegen lokaler Änderungen) oder ein anderer Zweig
# ist ausgecheckt.
$stand = (& git -C $PSScriptRoot log -1 --format='%h vom %cd' --date=format:'%d.%m.%Y %H:%M' 2>$null)
$zweig = (& git -C $PSScriptRoot rev-parse --abbrev-ref HEAD 2>$null)
if ($stand) { Sage "  Stand $stand (Zweig $zweig)" }

# Belegte Anschlüsse: Die Knoten einer früheren Vorführung laufen noch.
$belegt = @()
foreach ($port in 8787) {
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
  # Antwortet dort ein Knoten, läuft schon eine Vorführung (DATUM oder Sicht). Sonst hält etwas
  # anderes den Anschluss, am ehesten eine frühere Fassung dieses Programms.
  $istSicht = $false
  try {
    $antwort = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$($belegt[0])/api/public/info" -TimeoutSec 3
    if ($antwort.Content -match '"version"') { $istSicht = $true }
  } catch {
    $istSicht = $false
  }
  if ($istSicht) {
    # Eine frühere Fassung dieses Programms läuft noch, oft in einem vergessenen oder
    # geschlossenen Fenster. Sie würde weiter den alten Stand ausliefern; sie wird deshalb
    # beendet, damit der neue Stand startet.
    $prozesse = @()
    try {
      $prozesse = @(Get-NetTCPConnection -LocalPort $belegt[0] -State Listen -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique)
    } catch {
      $prozesse = @()
    }
    if ($prozesse.Count -eq 0) {
      Abbruch "Der Anschluss $($belegt -join ', ') ist belegt: Ein Knoten läuft schon (DATUM oder die Sicht-Vorführung). Ihn mit Strg+C in seinem Fenster beenden und diesen Befehl wiederholen."
    }
    foreach ($id in $prozesse) {
      Sage "  Eine laufende frühere Fassung (Prozess $id auf Anschluss $($belegt[0])) wird beendet, damit der neue Stand startet."
      Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
    $belegt = @()
  }
}
if ($belegt.Count -gt 0) {
  Abbruch "Der Anschluss $($belegt -join ', ') ist belegt, aber dort antwortet kein Knoten. Vermutlich läuft noch eine frühere Fassung (Spy-Eye) oder ein anderes Programm. Dessen Fenster mit Strg+C beenden und diesen Befehl wiederholen."
}

# ---------------------------------------------------------------- einrichten
Schritt 'Pakete einrichten (pnpm install)' { pnpm install } 'Häufigster Grund: keine Verbindung zum Netz.'
Schritt 'Bauen (pnpm build)' { pnpm build }

# ---------------------------------------------------------------- vorbereiten
$vorbereitet = Test-Path -Path (Join-Path $PSScriptRoot 'data-datum\.prepared\manifest.json')
$imHintergrund = $false
if (-not $vorbereitet) {
  Schritt 'Referenzbestand laden (pnpm datum:fetch): Vorschaubilder, Höhendaten' { pnpm datum:fetch } 'Häufigster Grund: keine Verbindung zum Netz. Der Befehl setzt beim nächsten Mal dort fort, wo er stehen blieb.'
  if ($NurPruefen) {
    Schritt 'Auswerten und orten (pnpm datum:prepare), 15 bis 30 Minuten' { pnpm datum:prepare }
  } else {
    # Erster Start: Der Knoten startet sofort und wertet die 60 Videos selbst im Hintergrund aus;
    # die Konsole ist gleich erreichbar und die Karte füllt sich, statt 15 bis 30 Minuten vor
    # einer nicht erreichbaren Seite zu warten.
    $imHintergrund = $true
  }
}

# ---------------------------------------------------------------- prüfen
if (-not $imHintergrund) {
  Schritt 'Prüfen (pnpm datum:check)' { pnpm datum:check } 'Jede Zeile mit FEHLT nennt den nächsten Schritt.'
}

if ($NurPruefen) {
  Sage ''
  Sage 'Bereit. Start:  .\datum.cmd'
  exit 0
}

# ---------------------------------------------------------------- starten
Sage ''
Sage 'DATUM startet. Adresse: http://127.0.0.1:8787'
Sage 'Anmeldung: leitung   Passwort: lagebild   Mandat: Erprobung'
if ($imHintergrund) {
  Sage 'Erster Start: Die 60 Videos werden jetzt im Hintergrund ausgewertet und geortet (15 bis 30 Minuten).'
  Sage 'Die Konsole ist sofort erreichbar; die Karte im Reiter ORTUNG füllt sich nach und nach.'
}
Sage 'Beenden: Strg+C in diesem Fenster.'

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

pnpm datum
exit $LASTEXITCODE
