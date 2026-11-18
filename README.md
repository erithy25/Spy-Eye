# Sicht

**Keine Sicht ohne Aufsicht.**

Sicht macht das Videomaterial, das Behörden im Einsatz ohnehin erzeugen (Drohnen, Hubschrauber,
Pegel- und Verkehrskameras, Fahrzeuge, Erkundungstrupps), in Sekunden durchsuchbar und beobachtet
es selbständig auf Gefahrenlagen. Es identifiziert niemanden, führt keine Daten zusammen und hält
jede Abfrage in einem verketteten Protokoll fest. Sicht ist die Bildschicht für das zivile
Lagebild, kein Führungsinformationssystem.

Stand: Erprobung mit Übungsmaterial. Es gibt keine Behördenkunden, keine Zulassung, und der Name
ist nicht markenrechtlich geprüft. Was gebaut und gemessen ist, steht unten und in
[`docs/EVALUATION.md`](docs/EVALUATION.md); was fehlt, unter [Grenzen](#grenzen-dieses-stands).

Alles läuft auf eigener Hardware in einem Prozess: Bildmodell (ONNX Runtime), Verzeichnis, Suche,
Wachen, Protokoll, Karte. Keine Schlüssel, keine Datenbank, keine Cloud. Nach dem einmaligen Laden
der Modelle wird kein Netz gebraucht; Verbindungen entstehen nur dort, wo der Betreiber sie
einrichtet (Nachbarknoten im Verbund, angeschlossene Direktbilder).

## Was das System tut

| Bereich | Reiter | Aufgabe |
| --- | --- | --- |
| Übersicht | LAGE | Lagekarte aus eigenen Vektordaten mit UTMREF-Gitter, Quellen, Meldungen, Lagen, Übungsuhr, Lagebericht |
| Einsicht | SUCHE | Freitextsuche über alles Bildmaterial, deutsch oder englisch, mit Fundstelle im Bild |
| Vorsicht | WACHEN | Stehende Suchaufträge in Worten; melden, sobald ein Bild passt; ausdrückliches Nachschärfen aus Urteilen |
| Durchsicht | VORGÄNGE | Beweissicherung mit Prüfsumme des Originals, Siegel, druckbarer Bericht |
| Weitsicht | VERBUND | Abfrage über Behördengrenzen: nur die Frage reist, zurück kommen maskierte Vorschaubilder und ein Beleg |
| Aufsicht | PROTOKOLL | Verkettetes Protokoll, Prüfung der Kette, Stichprobe für die Kontrolle, Export |
| Rücksicht | durchgehend | Gesichtsmaskierung, Mandat mit Zweckbindung, Vier-Augen-Freigabe, Löschfrist, Anfrageprüfung |
| — | QUELLEN, WIRKUNG | Sensoren, Einspielen von Aufzeichnungen, Anschließen von Direktbildern; Messwerte des Knotens, Auswertung jeder Übung als druckbarer Messbericht |

## Vorführung mit drei Knoten

Voraussetzungen: Node ab 20.11, pnpm, `ffmpeg` im Suchpfad
(Windows: `winget install Gyan.FFmpeg`, macOS: `brew install ffmpeg`, Linux: `apt install ffmpeg`).
Die Befehle sind in PowerShell, bash und zsh dieselben.

```bash
pnpm install
```

```bash
pnpm build
```

```bash
pnpm exercise:fetch
```

```bash
pnpm demo:prepare
```

```bash
pnpm demo:check
```

```bash
pnpm demo
```

- `exercise:fetch` lädt 45 frei lizenzierte Aufnahmen (rund 300 MB) für die Übung und die beiden
  Nachbarknoten. Sie liegen nicht im Repository, weil ihre Lizenz die Nutzung, aber nicht die
  Weitergabe als Datei erlaubt.
- `demo:prepare` lädt beim ersten Mal die Modelle (rund 950 MB) nach `.models/` und wertet das
  gesamte Material aus (etwa zehn Minuten auf vier Kernen ohne Grafikkarte). Danach startet die
  Vorführung ohne Wartezeit und ohne Netz.
- `demo:check` prüft die vorbereitete Vorführung von Anfang bis Ende (Rechner, Material,
  Anmeldung, Suche, Verbund, Ablehnung, Protokoll) und endet mit „Ergebnis: bereit“.
- `demo:reset` stellt nach einem Probelauf den Stand von `demo:prepare` wieder her (Knoten vorher
  beenden).
- `demo` startet drei Knoten: Koblenz <http://127.0.0.1:8787>, Trier <http://127.0.0.1:8788>,
  Mainz <http://127.0.0.1:8789>.

Zugänge (Passwort `lagebild`): `lage` (Auswertung), `leitung` (Leitung), `aufsicht` (Aufsicht).
Der Ablauf einer Vorführung mit Sprechzeilen und Rückfallebenen steht in
[`docs/DEMO.md`](docs/DEMO.md).

## Ein einzelner Knoten mit eigenem Material

```bash
pnpm start
```

<http://127.0.0.1:8787> öffnen, als `leitung` anmelden, das Mandat „Erprobung“ wählen, im Reiter
QUELLEN Aufzeichnungen oder ganze Ordner ablegen. Neue Aufnahmen sind nach einem schnellen ersten
Durchgang sofort durchsuchbar; die dichte Auswertung läuft dahinter weiter. Für die Entwicklung
startet `pnpm dev` den Knoten (8787) und die Konsole mit Neuladen (5173).

### Als Container

```bash
docker build -t sicht .
```

```bash
docker run -p 8787:8787 -v sicht-data:/srv/data -v sicht-models:/srv/.models -v sicht-scenarios:/srv/scenarios sicht
```

Das Abbild enthält einen Knoten ohne Übungsmaterial und ohne Modelle; beides wird einmal in die
Datenträger geladen (Befehle im Kopf des [`Dockerfile`](Dockerfile)). Geprüft ist der Bau bis vor
die letzte Schicht und der Start desselben Aufbaus außerhalb eines Containers, nicht der Lauf im
Container selbst.

## Wie es arbeitet

```
Quelle ─► Bilder (ffmpeg) ─► Gesichter maskieren ─► Bildmerkmale (SigLIP 2) ─► Verzeichnis
                                                                                 │
                    Suche in Worten ◄──────────── Textmerkmale ◄─────────────────┤
                    Wachen (stehende Suche) ─► Meldung ─► Lage ─► Vorgang        │
                                                                                 ▼
           Protokoll: jede Anmeldung, Abfrage, Ablehnung, Freigabe, jedes Urteil, verkettet
```

- **Einspielen.** Ein Bild je Sekunde (einstellbar), dazu Ausschnitte, damit kleine Dinge erkennbar
  bleiben. Unveränderte Folgebilder werden übersprungen, Szenen an Schnitten und nach Ruhephasen
  getrennt. Gesichter werden vor dem Speichern verpixelt; das Original bleibt verschlossen. Jede
  Szene erhält Schlagworte aus einem festen Verzeichnis (Orte, Gegenstände, Fahrzeuge,
  Tätigkeiten, Schadenslagen); keines beschreibt Personen nach Geschlecht, Alter oder Kleidung.
- **Suche.** Die Anfrage wird in denselben Merkmalsraum übersetzt wie die Bilder und mit jedem
  Vektor verglichen. Ganzes Bild und Bildausschnitte werden an getrennten Schwellen gemessen, die
  sich je Anfrage am eigenen Bestand ausrichten. Vor dem
  Modell steht die Anfrageprüfung: Namen, Gesichter, Kennzeichen, Herkunft, Religion, körperliche
  Merkmale, Wiederfinden und Verfolgen werden abgelehnt und protokolliert.
- **Wachen.** Eine Wache ist eine gespeicherte Anfrage mit Ausschlüssen, Mindestsicherheit und
  Quellenarten. Sie sieht jedes eintreffende Bild. Urteile der Auswertenden werden gesammelt; erst
  das ausdrückliche Nachschärfen trainiert daraus eine neue, im Protokoll vermerkte Version.
- **Lagen.** Meldungen gleicher Art am selben Ort werden zusammengefasst; mehrere Quellen für
  dasselbe Ereignis werden als Bestätigung ausgewiesen.
- **Verbund.** Knoten tauschen signierte Fragen aus. Der antwortende Knoten prüft nach eigenen
  Regeln, protokolliert, und gibt höchstens zwölf maskierte Vorschaubilder mit einer Belegnummer
  zurück. Aufnahmen, Verzeichnis und Protokoll verlassen ihn nicht. Beide Seiten bezeugen den
  Protokollstand des anderen.
- **Direktbild.** Eine Quelle kann eine Stromadresse tragen. ffmpeg schneidet den Strom in kurze
  Abschnitte; jeder fertige Abschnitt geht denselben Weg wie eine hochgeladene Aufzeichnung. Eine
  laufende Meldung wird über Abschnitte hinweg fortgeschrieben. Anschließen darf nur die Leitung;
  Zugangsdaten in der Adresse bleiben auf dem Knoten.
- **Übung.** Ein Drehbuch verteilt Aufzeichnungen auf Quellen und setzt Ereignisse mit Zeitpunkt.
  Das System spielt sie auf einer Uhr ab und misst je Ereignis die Zeit bis zur Meldung.

## Gemessen

Auf vier Prozessorkernen ohne Grafikkarte; Bedingungen und Einschränkungen in
[`docs/EVALUATION.md`](docs/EVALUATION.md), nachmessbar mit `pnpm exercise:evaluate` und
`pnpm search:evaluate`.

| Größe | Wert |
| --- | --- |
| Übung RHEIN-MOSEL: erkannte Ereignisse | 13 von 13 |
| Erkennungsverzug | 1,1 s im Median, ab Eintreffen des ausgewerteten Bildes |
| Fehlmeldungen | 1 von 15 Meldungen; nach Verwerfen und Nachschärfen im Folgelauf keine |
| Auswertung von Aufzeichnungen | 3,3-fache Echtzeit, mit Maskierung |
| Erste Durchsuchbarkeit | 8 s für 44 Aufnahmen ab Beginn des Hochladens |
| Suche auf allgemeinem Material | 54 von 66 Anfragen beantwortet, erster Treffer bei 64 von 66 passend; 2 von 25 Anfragen nach nicht Vorhandenem mit Treffer |
| Dauer einer neuen Anfrage | 0,1 s im Median, davon 5 ms Vergleich mit 2 108 Vektoren |
| Gefahrenmodell auf AIDERv2 | 99,1 % auf der Testmenge; auf dem Übungsmaterial irrt es und löst deshalb keine Meldungen aus |

Die Wachen der Übung wurden am Übungsmaterial formuliert, die Schwellen der Suche an den
gemessenen Anfragen eingestellt. Die Werte zeigen das Betriebsverhalten, nicht die Güte auf
fremdem Einsatzmaterial.

## Grenzen dieses Stands

- **Direktbilder nur mit Nachlauf und nur im Labor geprüft.** Ein angeschlossener Strom (RTSP,
  HLS, RTMP, SRT, MPEG-TS) wird in Abschnitte von 20 Sekunden geschnitten und wie eine Aufzeichnung
  ausgewertet; Meldungen folgen etwa eine halbe Minute nach dem Ereignis. Geprüft ist das gegen
  eine simulierte Kamera (MPEG-TS über TCP), nicht gegen Geräte im Feld. Rechnerisch wertet ein
  Rechner mit vier Kernen etwa drei Ströme gleichzeitig aus; die Übung mit elf Quellen spielt
  deshalb vorab ausgewertetes Material ab.
- **Keine Anbindung an ein vorhandenes Führungssystem.** Es gibt Ausgaben als GeoJSON und CAP 1.2,
  aber keine erprobte Kopplung.
- **Anmeldung und Rechte sind für die Vorführung gebaut.** Drei feste Zugänge mit einem
  gemeinsamen Passwort; kein Anschluss an einen Verzeichnisdienst, keine Zwei-Faktor-Anmeldung.
- **Regeln, keine Unmöglichkeiten.** Die Anfrageprüfung ist eine nachvollziehbare Wortprüfung. Sie
  lässt sich mit Umschreibungen umgehen; dafür gibt es das Protokoll und die Stichprobe.
  Beschreibungen nach Geschlecht, Alter oder Kleidung sind unter einem Mandat möglich, das sie
  zulässt.
- **Kein Rechtsgutachten.** Ob eine Behörde Bildmaterial so auswerten darf, entscheidet ihre
  Rechtsgrundlage. [`docs/COMPLIANCE.md`](docs/COMPLIANCE.md) ordnet die Anforderungen den
  gebauten Vorkehrungen zu und nennt, was fehlt.
- **Größe.** Die Suche vergleicht mit jedem Vektor und ist für einige Millionen Vektoren je Knoten
  ausgelegt, nicht für mehr.

## Modelle, Daten, Lizenzen

| Bestandteil | Herkunft | Lizenz |
| --- | --- | --- |
| Bildkodierer SigLIP 2 base patch32-256 | Google, ONNX-Fassung `onnx-community/siglip2-base-patch32-256-ONNX` | Apache-2.0 |
| Gesichtserkenner YuNet (nur zum Maskieren) | OpenCV Zoo | MIT |
| Gefahrenmodell | eigene Gewichte, trainiert auf AIDERv2 | Daten CC BY 4.0 |
| Kartendaten | OpenStreetMap über OpenFreeMap, Schema OpenMapTiles | ODbL; CC BY 4.0 |
| Höhenlinien | abgeleitet aus Mapzen Terrain Tiles | siehe deren Quellenliste |
| Schrift JetBrains Mono | JetBrains | SIL OFL 1.1 |
| Übungsaufnahmen | Mixkit | Mixkit Stock Video Free License; werden geladen, nicht mitgeliefert |

Mit `MODEL_ID` lassen sich andere Kodierer wählen (`Xenova/clip-vit-base-patch32`, MIT;
`Xenova/siglip-base-patch16-224`, Apache-2.0). `Xenova/mobileclip_s2` ist ebenfalls wählbar, aber
nur für Forschungszwecke lizenziert und deshalb nicht voreingestellt. Ein Wechsel wertet den
Bestand neu aus; die Wachen der Übung sind auf den voreingestellten Kodierer abgestimmt.

## Befehle

| Befehl | Zweck |
| --- | --- |
| `pnpm demo` / `pnpm demo:prepare` | Vorführung mit drei Knoten starten / vorbereiten |
| `pnpm start` / `pnpm dev` | einzelner Knoten / Entwicklung |
| `pnpm exercise:fetch` | Übungsmaterial laden |
| `pnpm demo:check` | vorbereitete Vorführung prüfen; startet die Knoten dafür, wenn sie nicht laufen |
| `pnpm demo:reset` | nach einer Probe den vorbereiteten Ausgangsstand wiederherstellen, ohne neu auszuwerten |
| `pnpm exercise:evaluate` | Übung ohne Konsole abspielen und auswerten (`--speed 1\|2\|4\|8`) |
| `pnpm search:evaluate --dir <Ordner>` | Suche auf einem Ordner mit Aufnahmen und beschrifteten Anfragen messen |
| `pnpm models:download` | Modelle vorab laden |
| `pnpm selftest` | Rechner, Modell und ffmpeg prüfen, Geschwindigkeit messen |
| `pnpm test` / `pnpm typecheck` | Prüfungen |

## Einstellungen

| Variable | Voreinstellung | Bedeutung |
| --- | --- | --- |
| `PORT`, `HOST`, `DATA_DIR` | `8787`, `127.0.0.1`, `data` | einzelner Knoten |
| `SICHT_NODES_FILE` | — | Knotendatei wie `nodes.demo.json`; mehrere Knoten in einem Prozess |
| `SICHT_NODE_NAME`, `_OPERATOR`, `_REGION`, `_LAT`, `_LON` | Lagezentrum … | Angaben zum einzelnen Knoten |
| `SICHT_DEMO_PASSWORD` | `lagebild` | Passwort der Vorführzugänge |
| `SICHT_RETENTION_DAYS` | `60` | Löschfrist für Aufzeichnungen außerhalb von Vorgängen; `0` schaltet sie ab |
| `SICHT_OFFLINE` | — | `1` unterbindet das Nachladen von Modellen aus dem Netz; Verbund und Direktbilder sind Verbindungen, die der Betreiber selbst einrichtet |
| `SICHT_LIVE_SEGMENT_SEC` | `20` | Länge der Abschnitte, in die ein Direktbild geschnitten wird (5 bis 120) |
| `MODEL_ID`, `MODEL_DTYPE`, `MODEL_TEXT_DTYPE` | SigLIP 2, `fp32`, `fp16` | Kodierer und Genauigkeit |
| `ML_DEVICE` | `cpu` | `auto`, `dml` oder `cuda` versuchen eine Grafikkarte; sie wird nur verwendet, wenn sie das Ergebnis des Prozessors reproduziert |

## Aufbau des Repositorys

```
apps/server     Knoten: Einspielen, Modell, Verzeichnis, Suche, Wachen, Lagen, Vorgänge,
                Verbund, Protokoll, Schnittstelle (Fastify, TypeScript)
apps/web        Konsole (React, Vite); Karte aus apps/web/public/map
scenarios/      Drehbuch der Übung RHEIN-MOSEL
seeds/          Bestände der Nachbarknoten für die Vorführung
site/           Website (statisch, ohne Bauschritt)
docs/           Strategie, Marke, Rechtszuordnung, Fragen, Messbericht, Vorführung
deliverables/   Finanzmodell, Einseiter
media/brand/    Markenfilm: Drehbuch und Schnittwerkzeug
```

## Weitere Unterlagen

- [`UEBERGABE.md`](UEBERGABE.md) – was vorliegt, Start unter Windows, offene Entscheidungen
- [`docs/STRATEGY.md`](docs/STRATEGY.md) – These, Belege, Wettbewerb, Käufer, Geschäftsmodell, Risiken
- [`docs/BRAND.md`](docs/BRAND.md) – Name, Leitsatz, Wortschatz, Gestaltung, was behauptet werden darf
- [`docs/COMPLIANCE.md`](docs/COMPLIANCE.md) – rechtliche Anforderungen und gebaute Vorkehrungen
- [`docs/FAQ.md`](docs/FAQ.md) – harte Fragen, kurze Antworten
- [`docs/EVALUATION.md`](docs/EVALUATION.md) – Messbericht
- [`docs/DEMO.md`](docs/DEMO.md) – Ablauf der Vorführung; zum Ausdrucken
  [`deliverables/Sicht-Vorfuehrung-Ablauf.pdf`](deliverables/Sicht-Vorfuehrung-Ablauf.pdf)
- [`deliverables/`](deliverables) – Präsentation, Einseiter, Finanzmodell
- [`docs/research/`](docs/research) – Recherche mit Quellen
