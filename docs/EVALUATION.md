# Messbericht

Stand: 2026-11-18. Alle Werte stammen von dem Rechner, auf dem dieser Stand gebaut wurde:
Intel(R) Xeon(R) Processor @ 2.10GHz, 4 Kerne, keine Grafikkarte. Bildkodierer:
`onnx-community/siglip2-base-patch32-256-ONNX` (SigLIP 2, Apache-2.0). Jeder Wert lässt sich mit den genannten Befehlen auf dem
eigenen Rechner nachmessen; die Übung schreibt ihr Ergebnis nach `docs/measurements/exercise.json`.

## 1. Übung RHEIN-MOSEL

```bash
pnpm exercise:evaluate --speed 1
```

Das Drehbuch (`scenarios/rhein-mosel/scenario.json`) verteilt 31 frei lizenzierte
Aufnahmen (577 s) auf elf Quellen und setzt 13 Ereignisse mit festem Zeitpunkt. Die
Aufnahmen werden einmal ausgewertet und dann auf einer Uhr abgespielt, als träfen sie gerade ein.
Neun frei formulierte Wachen beobachten sie. Ein Ereignis gilt als erkannt, wenn die dafür
vorgesehene Wache an der betroffenen Quelle meldet.

| Größe | Wert |
| --- | --- |
| Erkannte Ereignisse | 13 von 13 |
| Erkennungsverzug, Median | 1,1 s |
| Erkennungsverzug, Spanne | 1,0 bis 1,2 s |
| Meldungen insgesamt | 15 |
| Fehlmeldungen | 1 |
| Gebildete Lagen | 11 |
| Uhr | Echtzeit (1×) |

| Ereignis | Quelle | Beginn | Meldung | Verzug |
| --- | --- | --- | --- | --- |
| Mosel tritt über die Ufer, Wiesen überflutet | UAS 1 · Moselbogen | T+01:20 | T+01:21 | 1,1 s |
| Bachlauf führt Sturzflut | Erkunder 1 · Güls | T+01:40 | T+01:41 | 1,1 s |
| Rheinvorland überflutet | UAS 2 · Rheinvorland | T+02:30 | T+02:31 | 1,2 s |
| Baum auf Fahrzeug gestürzt | Erkunder 2 · Lützel | T+02:40 | T+02:41 | 1,2 s |
| Verkehrsunfall auf der B 9 | UAS 3 · B 9 Nord | T+04:00 | T+04:01 | 1,0 s |
| Fahrbahn abgerutscht, Straße gesperrt | Erkunder 1 · Güls | T+04:20 | T+04:21 | 1,0 s |
| Unfall im Tunnel, Einsatzkräfte am Fahrzeug | Tunnelkamera · Ostportal | T+04:40 | T+04:41 | 1,0 s |
| Lastkraftwagen umgestürzt | Erkunder 2 · Lützel | T+05:20 | T+05:21 | 1,1 s |
| Baum auf Wohnhaus gestürzt | Bürgerhinweise · Eingang | T+06:00 | T+06:01 | 1,1 s |
| Gebäudebrand im Gewerbegebiet, starke Rauchentwicklung | UAS 4 · Rheinhafen | T+06:40 | T+06:41 | 1,2 s |
| Gebäude in Vollbrand | Erkunder 3 · Wallersheim | T+07:00 | T+07:01 | 1,2 s |
| Straße durch umgestürzten Baum blockiert | Erkunder 2 · Lützel | T+07:20 | T+07:21 | 1,2 s |
| Teileinsturz, Suche in Trümmern | Bürgerhinweise · Eingang | T+08:00 | T+08:01 | 1,0 s |

**Die Fehlmeldung.** Die Wache „Umgestürzter Lastkraftwagen“ meldet bei T+04:24 an Erkunder 1 die
abgerutschte Fahrbahn. Nach einem verworfenen und einem bestätigten Urteil und dem ausdrücklichen
Nachschärfen der Wache (Version 2) tritt die Fehlmeldung im folgenden Lauf nicht mehr auf; der
echte Unfall an Erkunder 2 wird weiter gemeldet (Sicherheit 0,98). Geprüft am 2026-11-18 über
die Schnittstelle des laufenden Knotens.

**Was der Verzug bedeutet und was nicht.**

- Er zählt ab dem Eintreffen des ausgewerteten Bildes. Bei einem Bild je Sekunde und zwei
  aufeinanderfolgenden Treffern bis zur Meldung liegt die Untergrenze bei rund einer Sekunde; der
  gemessene Wert ist also die Auslegung des Systems, kein Zufall.
- Die Rechenzeit der Auswertung ist nicht enthalten, weil die Übung vorab ausgewertetes Material
  abspielt. Sie beträgt auf diesem Rechner rund 0,3 s je Bild (Abschnitt 2). Für elf Quellen
  gleichzeitig mit einem Bild je Sekunde reicht dieser Rechner nicht; nötig wäre etwa das
  Dreieinhalbfache seiner Rechenleistung oder eine Grafikkarte. Bei einem angeschlossenen
  Direktbild kommt der Nachlauf eines Abschnitts hinzu (siehe „Direktbild“ in Abschnitt 2).
- Die Wachen der Übung wurden an diesem Material formuliert, so wie eine Auswerterin es mit der
  Vorschau „Am Bestand prüfen“ täte. Die Werte beschreiben das Betriebsverhalten auf bekanntem
  Material. Über die Güte auf fremdem Einsatzmaterial sagen sie nichts.
- Das Material ist Archivmaterial aus dem Netz und zeigt nicht die genannten Orte.

## 2. Auswertung von Aufzeichnungen

| Größe | Wert | Bedingungen |
| --- | --- | --- |
| Übungsmaterial | 577 s in 176 s, 3,3-fache Echtzeit | 1 Bild/s, 4 Ausschnitte je Bild, mit Gesichtsmaskierung |
| Bilder im Verzeichnis | 571 | unveränderte Folgebilder werden übersprungen |
| Maskierte Gesichter | 37 | YuNet, Schwelle 0,55 |
| Allgemeiner Datensatz, 44 Aufnahmen, 540 s, 87 MB | durchsuchbar 7,6 s nach Beginn des Hochladens; vollständig ausgewertet nach 169 s (3,2-fache Echtzeit) | Hochladen über die Schnittstelle, vier Aufnahmen gleichzeitig; ohne Hochladen (`pnpm search:evaluate`) 7,5 s |
| Bildkodierer allein | 34 ms je Bild | `pnpm selftest` |
| Textkodierer | 50 ms je Anfrage | halbe Genauigkeit (fp16), `pnpm selftest` |

Zum Vergleich auf demselben Rechner: MobileCLIP-S2 62 ms je Bild, CLIP ViT-B/32 26 ms je Bild.
MobileCLIP ist nur für Forschungszwecke lizenziert und deshalb nicht mehr voreingestellt.

### Direktbild

Geprüft gegen eine simulierte Kamera: eine Aufnahme eines Gebäudebrands, in Endlosschleife als
MPEG-TS über TCP gesendet; Abschnitte von 10 s (`SICHT_LIVE_SEGMENT_SEC=10`), eine Wache „Brand“.

| Größe | Wert |
| --- | --- |
| Verbunden nach dem Anschließen | innerhalb von 6 s |
| Erstes ausgewertetes Bild | nach 22 bis 29 s |
| Erste Meldung | 29 s nach dem Anschließen |
| Meldungen für das durchgehende Ereignis | 1, fortgeschrieben über sieben Abschnitte |
| Nach Abbruch des Stroms | Quelle „getrennt“ mit Grund, neue Verbindungsversuche in wachsenden Abständen |

Mit der Voreinstellung von 20 s je Abschnitt liegt der Nachlauf entsprechend höher, bei etwa
einer halben bis dreiviertel Minute. Nicht geprüft: echte Kameras, RTSP mit Anmeldung, schlechte
Verbindungen, mehrere Ströme gleichzeitig.

## 3. Suche

### Übungsmaterial und Verbund

| Größe | Wert | Bedingungen |
| --- | --- | --- |
| Verbundfrage an zwei Nachbarn | 20 bis 400 ms | alle Knoten auf einem Rechner |
| Deutsche Anfragen | „überflutete Wiese“ findet die überflutete Wiese an erster Stelle (Sicherheit 0,99) | Übungsmaterial |

### Allgemeines Material

Gemessen mit `pnpm search:evaluate --dir dataset` auf dem allgemeinen Datensatz (44 Aufnahmen:
Alltag, Verkehr, Tiere, Essen) mit 91 beschrifteten Anfragen in Deutsch und Englisch
(`docs/measurements/search-queries.json`): 66 fragen nach etwas, das im Material vorkommt, 25
nach etwas, das nicht vorkommt. Eine Anfrage gilt als beantwortet, wenn eine dafür vorgesehene
Aufnahme über der Schwelle liegt. Ergebnis in `docs/measurements/search.json`.

| Größe | nach dem ersten Durchgang (ein Bild je Aufnahme) | nach der vollständigen Auswertung |
| --- | --- | --- |
| Beantwortete Anfragen | 53 von 66 | 54 von 66 |
| Erster Treffer passt | 64 von 66 | 64 von 66 |
| Passende Aufnahmen über der Schwelle | 68 von 104 | 71 von 104 |
| Unpassende Aufnahmen über der Schwelle | 5 | 2 |
| Anfragen nach nicht Vorhandenem mit Treffer | 2 von 25 | 2 von 25 |
| Dauer einer neuen Anfrage, Median | 124 ms | 104 ms |
| davon Vergleich mit dem Verzeichnis | 0,5 ms (44 Vektoren) | 4,7 ms (2 108 Vektoren) |

Die Dauer einer Anfrage ist fast ganz die Kodierung des Textes (drei Formulierungen je Anfrage);
eine wiederholte Anfrage kostet nur den Vergleich.

Was offen bleibt:

- Gegenstände, Tiere, Fahrzeuge und Handlungen findet die Suche zuverlässig, Orts- und
  Stimmungsbegriffe schwächer: „Küche“, „Büro“, „Wald“, „Regen“, „Straße bei Nacht“ und „Essen“
  bleiben unter der Schwelle, obwohl die passende Aufnahme meist an erster Stelle steht.
- Einzelne deutsche Wörter erreichen niedrigere Werte als ihre englischen Entsprechungen:
  „beach“ wird gefunden, „Strand“ steht an erster Stelle, aber unter der Schwelle.
- Verwandtes wird verwechselt: „Zebra“ meldet die Aufnahme mit Wildpferden.

Die Schwellen der Suche (`SEARCH_CALIBRATION` in `apps/server/src/ml/calibration.ts`) wurden an
genau diesen Anfragen und an 40 weiteren auf dem Übungsmaterial eingestellt. Die Zahlen
beschreiben deshalb das Verhalten auf bekanntem Material und sind kein Test auf fremdem. Mit der
vorherigen Einstellung (eine Schwelle für alle Ausschnitte, ohne Zentrierung der Anfrage)
waren es 37 beantwortete Anfragen nach dem ersten Durchgang und 50 nach der vollständigen
Auswertung, bei 61 passenden ersten Treffern. Die Wachen verwenden weiter ihre eigene, an der
Übung gemessene Schwelle.

## 4. Gefahrenmodell

Werkzeuge: `apps/server/src/scripts/hazard/embedDataset.ts` und `trainHead.ts`.

Ein linearer Klassifikator auf den Bildmerkmalen des Kodierers, trainiert auf AIDERv2
(Luftbilder; Klassen Einsturz, Brand, Überflutung, unauffällig; CC BY 4.0).

| Größe | Wert |
| --- | --- |
| Trainingsbilder / Testbilder | 13 399 / 1 654 |
| Trefferquote auf der Testmenge | 99,1 % (Makro-F1 0,991) |
| Ohne Training (Textvergleich) auf derselben Testmenge | 85,1 % (Makro-F1 0,852) |

**Übertragbarkeit.** Auf dem Übungsmaterial hält das Modell eine Luftaufnahme eines ruhigen
Flusses für eine Überflutung (Sicherheit 1,00) und ordnet überflutete Wiesen als unauffällig ein.
Auf Bodenaufnahmen ist es nicht anwendbar. Der Wert auf der Testmenge sagt deshalb wenig über den
Einsatz; Trainings- und Testmenge von AIDERv2 enthalten zudem sehr ähnliche Bilder. Folgerung im
Produkt: Das Modell löst keine Meldungen aus. Es steht als Zweitmeinung neben jeder Meldung aus
einer Luftbildquelle, und frei formulierte Wachen sind der Regelfall.

## 5. Schutzregeln und Protokoll

```bash
pnpm test
```

27 automatische Prüfungen: Die Anfrageprüfung lehnt Namen, Gesichter, Kennzeichen, geschützte und
körperliche Merkmale, Wiederfinden und Verfolgen ab und lässt Lagebeschreibungen durch; die
Protokollkette erkennt geänderte und entfernte Einträge; Koordinaten werden gegen bekannte
UTMREF-Werte geprüft; Meldungen werden nur bei gleicher Art, Nähe und Zeit zu einer Lage; der
Verbund weist veränderte, fremd signierte und veraltete Anfragen ab; als Direktbild gelten nur
Netzadressen, und ihre Zugangsdaten erscheinen nie in der Anzeige. Im Browser geprüft (Abläufe als Leitung, Auswertung und Aufsicht):
Maskierung, Vier-Augen-Freigabe, Beweissicherung mit Siegel, Verbundfrage mit Beleg, Stichprobe.

## 6. Gegenprobe auf einem Windows-Rechner

Der Weg, den eine Vorführung nimmt, wird auf einem zweiten Rechner automatisch durchgespielt
(`.github/workflows/windows.yml`): ein Windows-Rechner von GitHub mit vier Rechenkernen und
16 GB, Windows PowerShell 5.1, Node 22, ffmpeg 9.0.2. Lauf vom 18. November 2026:

| Schritt | Ergebnis |
| --- | --- |
| `pnpm install`, `typecheck`, `test`, `build` | bestanden |
| `pnpm selftest` | Rechner, ffmpeg und Bildkodierer in Ordnung |
| `pnpm exercise:fetch` | 45 Aufnahmen geladen |
| `pnpm demo:prepare` | drei Knoten vorbereitet in 6 min 39 s |
| `pnpm demo:check` | „Ergebnis: bereit“ |
| `pnpm demo:reset`, danach `pnpm demo:check` | zurückgesetzt, wieder „bereit“ |
| `pnpm exercise:evaluate --speed 8` | 13 von 13 Ereignissen, 15 Meldungen, 1 Fehlmeldung, Verzug im Median 3,1 s bei achtfacher Uhr |

Die Erkennung stimmt mit dem Lauf auf dem Entwicklungsrechner überein (dort bei achtfacher Uhr
2,4 s im Median; der Windows-Rechner ist langsamer).

**Was die Gegenprobe gezeigt hat.** Die ersten beiden Läufe fielen anders aus: Eine Suche auf dem
Knoten Mainz lag genau auf der Schwelle (Sicherheit 0,50 statt 0,53), und die Übung brachte drei
Fehlmeldungen statt einer, die erste acht Sekunden nach Beginn. Ursache ist der Videodekoder: Ein
neueres ffmpeg liefert die Bilder um Nuancen anders, die Ähnlichkeitswerte verschieben sich um
wenige Tausendstel, und Schwellen, die knapp liegen, kippen. Die Wache „Verkehrsunfall“ (ein
einziges Wort als Beschreibung, knapper Abstand) beobachtet deshalb nur noch Luftbildquellen, wo
ihr Ereignis stattfindet; die Suche bekam getrennte Schwellen (Abschnitt 3). Für einen Betrieb
heißt das: Schwellen gehören auf dem Rechner und am Material der Behörde eingestellt. Dafür gibt
es die Vorschau „Am Bestand prüfen“ beim Aufstellen einer Wache und den Messbericht je Übung.

## 7. Was nicht gemessen ist

- Güte auf echtem Einsatzmaterial deutscher Behörden.
- Verhalten bei Nacht, Regen auf der Linse, Wärmebild.
- Betrieb mit mehr als einigen zehn Stunden Material in einem Knoten. Die Suche vergleicht jede
  Anfrage mit jedem Vektor; das ist bis in die Größenordnung einiger Millionen Vektoren schnell
  genug und darüber nicht ausgelegt.
- Direktbilder von echten Kameras und die Last vieler gleichzeitiger Ströme.
- Verbund über ein echtes Netz mit mehr als drei Knoten.
