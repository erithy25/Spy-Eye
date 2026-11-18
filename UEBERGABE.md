# Übergabe

Stand: 18. November 2026. Dieses Blatt sagt, was vorliegt, wie es auf einem Windows-Rechner in
Gang kommt und was vor dem Termin noch zu entscheiden ist. Einzelheiten stehen in den verlinkten
Unterlagen.

## DATUM: Ort und Uhrzeit aus Video

DATUM ist das neue Produkt in diesem Repository (Beschreibung, Verfahren, Messung, Grenzen:
[`docs/DATUM.md`](docs/DATUM.md)). Es baut auf der Plattform von Sicht auf, die weiter vorführbar
bleibt (Abschnitte 1 bis 6 unten).

**Starten unter Windows (PowerShell), im Ordner des Repositorys.** Das alte Fenster (Spy-Eye
oder Sicht) vorher mit Strg+C schließen: Alle benutzen Anschluss 8787.

```bash
git fetch origin
```

```bash
git checkout claude/video-dataset-keyword-search-8h6kxd
```

```bash
git pull
```

```bash
.\datum.cmd
```

- Der erste Lauf lädt Modelle (rund 1 GB), Vorschaubilder der Referenzgalerie und Höhendaten
  und wertet alles aus. Die 60 Referenzclips und die Vektoren der Galerie liegen im Repository
  bei; Wikimedia drosselt Abrufe, deshalb hängt der Start nicht mehr davon ab. Drosselt Wikimedia
  die Vorschaubilder, bricht dieser Teil nach drei Minuten Wartezeit ab und lädt den Rest beim
  nächsten Mal; die Ortung ist davon nicht betroffen. Das dauert je nach Rechner und Netz
  20 bis 40 Minuten (gemessen unter Linux auf vier Kernen: Ortung aller 60 Videos 5,7 Minuten;
  die Messung auf einem Windows-Rechner läuft in der CI); danach startet derselbe Befehl in unter
  einer Minute und ohne Netz.
- Beim ersten Start ist die Konsole sofort nach dem Download erreichbar; die 60 Videos werden
  dann im Hintergrund ausgewertet und geortet (15 bis 30 Minuten), die Karte füllt sich nach und
  nach. Für eine Vorführung vorher einmal `.\datum.cmd -NurPruefen` laufen lassen: Das wertet
  alles vollständig aus und prüft es, ohne zu starten.
- Anmeldung `leitung`, Passwort `lagebild`, Mandat „Erprobung“.
- Reiter ORTUNG: Weltkarte mit allen Videos. Eine Zeile wählen: Ort mit Kreis, Uhrzeit, Sonne,
  Schatten. BEFUND: alle Belege, Uhr, Sonnenstand. RAUM: in das Video hineingehen (W A S D,
  Maus) und das Gelände in 3D. MESSUNG: Abweichung jeder Ortung gegen die Wahrheit.
- Eigene Videos: im Reiter BESTAND ablegen; jede Aufnahme wird nach der Auswertung geortet
  (rund 5 s je Video nach der Auswertung der Bilder). Trägt die Datei GPS und Aufnahmezeit, gelten
  diese exakt.
- Präsentation: privates Dokument <https://claude.ai/artifact/Co1LMwmb6jBPNSHWqnVbDU>, als PDF
  [`deliverables/DATUM-Praesentation.pdf`](deliverables/DATUM-Praesentation.pdf), Sprechzettel
  [`deliverables/DATUM-Praesentation-Sprechzettel.md`](deliverables/DATUM-Praesentation-Sprechzettel.md).
- Produktfilm, 94 s: `deliverables/film/datum-produktfilm.mp4` (als Datei übergeben, nicht im
  Repository; Neubau mit `media/brand/tools/datum-take.cjs`, `datum_sequence.py` und
  `media/brand/build.sh`).
- Gemessen (Prüfhälfte, 30 Videos): bekannter Ort 27 % auf 1 km, 43 % auf 25 km; unbekannter Ort
  13 % auf 25 km, 60 % auf 2 500 km; die Wahrheit liegt in 67 bzw. 60 % der Fälle im angegebenen
  Kreis. Einzelheiten und Grenzen in [`docs/DATUM.md`](docs/DATUM.md).

## 1. Was vorliegt

| Was | Wo | Stand |
| --- | --- | --- |
| Konsole und Knoten (das Produkt) | dieses Repository; Start siehe Abschnitt 2 | läuft; unter Linux und Windows von Anfang bis Ende durchgespielt |
| Ablauf der Vorführung, 13 Minuten, mit Sprechzeilen und Rückfallebenen | [`docs/DEMO.md`](docs/DEMO.md); zum Ausdrucken [`deliverables/Sicht-Vorfuehrung-Ablauf.pdf`](deliverables/Sicht-Vorfuehrung-Ablauf.pdf) | fertig |
| Spickkarte für das Pult: eine Seite mit Klickfolge, Sätzen, Zahlen und Rückfallebenen, deutsch und englisch | [`deliverables/Sicht-Spickkarte.pdf`](deliverables/Sicht-Spickkarte.pdf), [`deliverables/Sicht-Cue-Card-EN.pdf`](deliverables/Sicht-Cue-Card-EN.pdf); Quellen in [`docs/ablauf/`](docs/ablauf/) | fertig; verdichtet aus dem Ablauf. Die englische Karte nennt die Beschriftungen der englischen Konsole; Protokolleinträge und Ereignistitel bleiben dort deutsch |
| Kurzvorstellung: ein Satz, 30 Sekunden, zwei Minuten, sechs Antworten in einem Atemzug | [`docs/vertrieb/KURZVORSTELLUNG.md`](docs/vertrieb/KURZVORSTELLUNG.md), deutsch und englisch | fertig |
| Präsentation, 20 Folien, deutsch | privates Dokument <https://claude.ai/artifact/NhPkBXmqP2jQbv2GZaDKyQ>; ohne Netz: [`deliverables/Sicht-Praesentation.pdf`](deliverables/Sicht-Praesentation.pdf); Sprechzettel daneben | fertig; Folie 19 nennt den Mittelbedarf des Basisfalls, aber keine Bitte um eine Summe |
| Präsentation, englisch | privates Dokument <https://claude.ai/artifact/KjH984UGPDCVaVUAiDBTR2>; ohne Netz: [`deliverables/Sicht-Presentation-EN.pdf`](deliverables/Sicht-Presentation-EN.pdf); Notizen daneben | fertig; kein Muttersprachler hat gegengelesen |
| Website, deutsch und englisch | private Seite <https://claude.ai/artifact/JarVGwmtbRpmb321zGdU9B>; Quelle in [`site/`](site/) | fertig; nicht öffentlich, mit `noindex`. Zeigt Markenfilm und Produktfilm, den Produktfilm in der Sprache der Seite |
| Einseiter, deutsch und englisch | [`deliverables/Sicht-Einseiter.pdf`](deliverables/Sicht-Einseiter.pdf), [`deliverables/Sicht-One-Pager-EN.pdf`](deliverables/Sicht-One-Pager-EN.pdf) | fertig |
| Finanzmodell, drei Szenarien | [`deliverables/Sicht-Finanzmodell.xlsx`](deliverables/Sicht-Finanzmodell.xlsx) | fertig; alle Werte sind Annahmen |
| Filme: Markenfilm (40 s und 67 s), englische Fassung (40 s), Produktfilm (137 s, Bildschirmaufnahme der Konsole im jetzigen Stand; auch mit englischen Tafeln und Einblendungen), Hochkant-Teaser (20 s, deutsch und englisch) | `deliverables/film/` (liegt nicht im Repository, wurde im Gespräch übergeben); Schnittwerkzeug und Drehbuch in [`media/brand/`](media/brand/) | fertig; Ton nur gemessen, nicht angehört |
| Unterlagenmappe als PDF: Strategie, Recht und Vorkehrungen, Fragen und Antworten, Messbericht, Marke, Architektur, Sicherheitsdurchsicht, Stückliste, Barrierefreiheit, Betrieb | [`deliverables/unterlagen/`](deliverables/unterlagen/); Quellen in [`docs/`](docs/) | fertig |
| Architektur und Sicherheitsdurchsicht | [`docs/ARCHITEKTUR.md`](docs/ARCHITEKTUR.md), [`docs/SICHERHEIT.md`](docs/SICHERHEIT.md) | fertig; 21 Befunde einer unabhängigen Durchsicht, die schweren behoben |
| Vertriebsvorlagen: Anschreiben, Angebot zur Erprobung | [`docs/vertrieb/`](docs/vertrieb/) | Vorlagen; eckige Klammern und Preis vor dem Versand füllen |
| Gesprächsleitfaden für die ersten zehn Behördengespräche: Fragen je Annahme, Stufen der Zusage, Auswertung gegen die Abbruchkriterien | [`docs/vertrieb/GESPRAECHSLEITFADEN.md`](docs/vertrieb/GESPRAECHSLEITFADEN.md); zum Ausdrucken [`deliverables/Sicht-Gespraechsleitfaden.pdf`](deliverables/Sicht-Gespraechsleitfaden.pdf) | Vorlage; die Schwellen der Auswertung sind ein Vorschlag, kein Erfahrungswert |
| Harte Fragen, kurze Antworten, englisch | [`docs/vertrieb/FAQ-EN.md`](docs/vertrieb/FAQ-EN.md) | Übersetzung einer Auswahl aus `docs/FAQ.md`; kein Muttersprachler hat gegengelesen |
| Stückliste: jedes Paket, jedes Modell und alle Daten mit Fassung, Prüfsumme und Lizenz | [`docs/STUECKLISTE.md`](docs/STUECKLISTE.md), maschinenlesbar [`docs/stueckliste/sicht.cdx.json`](docs/stueckliste/sicht.cdx.json), `pnpm sbom` | fertig; kein bekannter Befund in den ausgelieferten Paketen (Abgleich vom 18. November 2026) |
| Barrierefreiheit: automatische Prüfung nach WCAG 2.1 A und AA, Gang nur mit der Tastatur | [`docs/BARRIEREFREIHEIT.md`](docs/BARRIEREFREIHEIT.md), Werkzeuge in [`tools/barrierefreiheit/`](tools/barrierefreiheit/) | keine verletzte Regel in 18 Zuständen, 24 von 24 Schritten ohne Maus; kein BITV-Test, kein Test mit Bildschirmleser |
| Betriebsblatt für die IT: Bedarf, Einrichten, Sichern und Wiederherstellen, Aktualisieren, Überwachen, Störungen | [`docs/BETRIEB.md`](docs/BETRIEB.md) | fertig; Sicherung, Umstieg und ein Dauerlauf von 19 Minuten sind nachgestellt, ein Dauerbetrieb über Tage nicht |
| Prüfprogramme für das Protokoll, unabhängig von Sicht | [`tools/pruefen/`](tools/pruefen/), `pnpm ledger:verify <Datei>` | fertig; je eines in Node und Python |
| Wortmarke als Datei | [`brand/`](brand/) | fertig; Name markenrechtlich nicht geprüft |
| Messbericht mit Bedingungen und Einschränkungen | [`docs/EVALUATION.md`](docs/EVALUATION.md) | fertig; nachmessbar |

## 2. In Gang bringen (Windows, PowerShell)

Voraussetzungen: Node ab 20.11, pnpm, ffmpeg (`winget install Gyan.FFmpeg`, danach ein neues
Terminal öffnen), 8 GB Arbeitsspeicher. Beim ersten Mal werden rund 950 MB Modelle und rund
300 MB Übungsmaterial geladen; danach braucht nichts mehr ein Netz (nachgestellt unter Linux in
einer Umgebung ohne jede Verbindung: Die Schritte des Startbefehls, die Übung und die Suche
liefen durch). Die drei Knoten belegen beim
Start rund 3 GB Arbeitsspeicher und im Betrieb rund 1,7 GB; ein Dauerlauf über 19 Minuten mit
sieben Übungsläufen blieb dabei stabil (`docs/EVALUATION.md`, Abschnitt 7).

**Der kurze Weg.** Im Ordner des Repositorys den Stand dieses Zweigs holen und starten:

```bash
git fetch origin
```

```bash
git checkout claude/video-dataset-keyword-search-8h6kxd
```

```bash
git pull
```

```bash
.\vorfuehrung.cmd
```

Bricht `git pull` mit dem Hinweis auf lokale Änderungen ab (meist die Datei `pnpm-lock.yaml`,
die eine ältere pnpm-Fassung umgeschrieben hat): `git stash`, dann noch einmal `git pull`. Die
Vorführung benutzt eigene Ordner (`data-koblenz`, `data-trier`, `data-mainz`) und fasst den
Ordner `data` früherer Fassungen nicht an. Wer mit `pnpm start` das eigene Material von damals
weiterverwendet: Der Knoten erkennt Aufnahmen, die eine frühere Fassung ausgewertet hat, und
wertet sie beim Start im Hintergrund neu aus (drei bis vier Minuten für die 44 Aufnahmen der
ersten Fassung). Geprüft mit genau diesem Bestand: Schon während der Neuauswertung liefern
„Beach“, „Man with a cup“ und „Black car“ Treffer; für „Green bus“ meldet die Suche „Keine
Szene über der Schwelle“ und zeigt die Kandidaten darunter, weil in diesem Material kein grüner
Bus vorkommt.

**Oder frisch in einem neuen Ordner**, wenn `git pull` weiter hängt oder der alte Ordner
unberührt bleiben soll:

```bash
git clone -b claude/video-dataset-keyword-search-8h6kxd https://github.com/erithy25/Spy-Eye.git Sicht
```

```bash
cd Sicht
```

```bash
.\vorfuehrung.cmd
```

Das ist der Weg, den der Prüflauf auf dem Windows-Rechner von GitHub als „frischer Rechner“
durchspielt. Er lädt Modelle und Übungsmaterial in den neuen Ordner (zusammen rund 1,3 GB) und
dauert dort sieben bis neun Minuten.

Der Befehl prüft die Voraussetzungen und nennt, was fehlt; richtet ein und baut; lädt beim ersten
Mal das Material und wertet es aus (fünf bis zehn Minuten); stellt bei jedem weiteren Mal den
vorbereiteten Ausgangsstand in einer Sekunde wieder her; prüft die drei Knoten; startet sie und
öffnet den Browser. Am Vorabend genügt `.\vorfuehrung.cmd -NurPruefen`: alles bis zur Prüfung,
ohne zu starten. Derselbe Befehl läuft auf einem Windows-Rechner von GitHub in jedem Prüflauf mit.

- Hauptbildschirm: <http://127.0.0.1:8787>, Anmeldung `leitung`, Passwort `lagebild`, Mandat
  „Übung RHEIN-MOSEL“.
- Beenden: Strg+C im Fenster. Nach einer Probe einfach `.\vorfuehrung.cmd` wiederholen.
- Meldet der Befehl, die Anschlüsse seien belegt und dort antworte kein Knoten von Sicht, läuft
  noch die erste Fassung (Spy-Eye) oder ein anderes Programm auf Anschluss 8787: dessen Fenster
  mit Strg+C beenden und den Befehl wiederholen.
- Browser: Chrome oder Edge. Alle Durchgänge liefen in Chromium; in Firefox und Safari ist die
  Konsole nicht geprüft. Eine Durchsicht des Quelltexts fand keine Funktion, die nur Chromium
  kennt; ausgeführt wurde die Konsole dort trotzdem nie. Der Befehl öffnet den Standardbrowser:
  Ist das ein anderer, die Adresse von Hand in Chrome oder Edge öffnen.
- Bildschirm: geprüft von 1280 × 720 bis 1920 × 1080. Bei 1280 Breite kürzt die rechte Spalte der
  Lage lange Titel; für die Vorführung sind 1440 Breite oder mehr besser (Vollbild mit F11).
  Maßgeblich ist die Breite im Browser, nicht die des Bildschirms: Ein Bildschirm mit 1920
  Bildpunkten hat bei der Anzeigeskalierung 150 Prozent von Windows nur 1280. Dann den Zoom des
  Browsers mit Strg und Minus auf 90 oder 80 Prozent stellen; sonst bleibt er bei 100 Prozent.
  Unter 1280 Breite (nachgesehen bei 1097 und 1152) bleibt alles bedienbar und nichts läuft
  über, aber Mandat und Rolle in der Kopfzeile sind nicht mehr lesbar, und die Spalte der
  Meldungen zeigt nur ein bis zwei Meldungen.
- Ohne `ML_DEVICE` starten. Die Auswertung läuft auf dem Prozessor; eine Grafikkarte wird nur
  verwendet, wenn sie nachweislich dasselbe rechnet.
- Die Kette ohne Sicht nachrechnen, falls jemand fragt:
  `pnpm ledger:verify data-koblenz/ledger.jsonl`.

**Dieselben Schritte einzeln**, falls der kurze Weg an einer Stelle hängt:

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

- `demo:prepare` endet mit „Vorbereitet“; ein zweiter Aufruf ändert den Ausgangsstand nicht.
- `demo:check` endet mit „Ergebnis: bereit“. Steht dort etwas anderes, nennt jede Zeile mit
  FEHLT den nächsten Schritt.
- Nach einer Probe: Knoten mit Strg+C beenden, `pnpm demo:reset`, dann wieder `pnpm demo`.

Zwei Rechner im Verbund, mit oder ohne Verschlüsselung: Die Vorlage ist `nodes.beispiel.json`,
die Schritte stehen im [`README.md`](README.md) unter „Zwei Rechner im Verbund“. Für die
Vorführung ist das nicht nötig; sie läuft mit drei Knoten auf einem Rechner.

Für eigenes Material statt der Übung: `pnpm start`, anmelden, Mandat „Erprobung“, im Reiter
QUELLEN Dateien oder einen Ordner ablegen, im Reiter SUCHE fragen. Bilder erscheinen erst, wenn
sie auf Gesichter geprüft sind; eine Aufnahme lässt sich abspielen, sobald sie vollständig
ausgewertet ist und kein Gesicht gefunden wurde, sonst nur mit Freigabe.

## 3. Vorschlag für den Termin

Ein Vorschlag, kein erprobter Ablauf. Die Folien 06 bis 11 zeigen als Bild, was die Vorführung
am System zeigt; wer vorführt, überspringt sie und hat sie als Rückfallebene.

| Ab Minute | Was | Womit |
| --- | --- | --- |
| 0 | Markenfilm, 40 Sekunden, ohne Ansage | `sicht-markenfilm-v1.mp4` |
| 1 | Folien 01 bis 05: der Fall, das Muster, der Zeitpunkt, was Sicht ist | Präsentation, Sprechzettel |
| 8 | Vorführung am System, 13 Minuten | Spickkarte |
| 21 | Folien 12 bis 14: Messwerte mit ihren Einschränkungen, Grenzen, Wettbewerb | Präsentation |
| 27 | Folien 15 bis 19: Käufer, Geschäftsmodell, Fünfjahresfall, Risiken, Stand und Bitte | Präsentation |
| 35 | Fragen | `docs/FAQ.md`, englisch `docs/vertrieb/FAQ-EN.md` |

- **In 20 Minuten:** Film; Folien 01, 02 und 05; von der Spickkarte nur die Zeilen 1:30 bis 7:00
  (Übung, erste Meldung, Fehlmeldung, Suche im Verbund, abgelehnte Anfragen), dafür vorher
  anmelden und das Mandat wählen; Folien 12, 13 und 19; Fragen.
- **Vor einer Behörde:** Die Folien 16 bis 18 weglassen und die Zeit der Vorführung geben. Das
  Gespräch beginnt besser mit Fragen als mit Folien: `docs/vertrieb/GESPRAECHSLEITFADEN.md`.
- **Vor Geldgebern:** Die Folien 14 bis 18 nicht kürzen. Der kleine Kernmarkt und der eine
  Landesrahmenvertrag, an dem der Basisfall hängt, gehören selbst angesprochen, bevor jemand
  fragt.
- **Läuft das System nicht:** den Produktfilm zeigen (137 Sekunden) und mit den Folien 06 bis 11
  erläutern.

## 4. Vor dem Termin entscheiden

1. **Finanzierung.** Folie 19 nennt den Mittelbedarf des Basisfalls bis 2031, rund 3,2 Mio. €
   (Annahme), lässt aber offen, ob und worum gebeten wird.
2. **Kontakt.** Die Website zeigt den Aufruf „Vorführung anfragen“ erst, wenn in
   `site/index.html` am `<body>` eine Adresse eingetragen ist (`data-contact`).
3. **Name.** „Sicht“ ist markenrechtlich nicht geprüft (DPMA, EUIPO). Bis dahin intern verwenden;
   die Website ist deshalb nicht öffentlich.
4. **Wer spricht mit wem.** Die Strategie nennt als ersten Schritt eine bezahlte Erprobung bei
   einem Kreis mit eigener Drohneneinheit und ein Abbruchkriterium Ende März 2027.
5. **Sichtbarkeit des Repositorys.** Am 18. November 2026 war es bei GitHub öffentlich. Damit
   sind nicht nur der Quelltext, sondern auch Strategie, Finanzannahmen, Vertriebsvorlagen und
   die Sicherheitsdurchsicht mit ihren offenen Punkten für jeden lesbar, ebenso der Name. Vor
   dem Termin entscheiden: privat stellen (GitHub: Settings, General, Danger Zone, Change
   repository visibility) oder bewusst offen lassen und die Geschäftsunterlagen in ein privates
   Repository auslagern. Für einen offenen Quelltext spricht, dass Aufsichtsbehörden
   überprüfbare Systeme bevorzugen; für offene Geschäftsunterlagen spricht nichts.

## 5. Was belegt ist und was nicht

| Belegt, in diesem Repository nachmessbar | Nicht belegt |
| --- | --- |
| Übung: 13 von 13 Ereignissen erkannt, Verzug 1,1 s im Median, eine Fehlmeldung (`pnpm exercise:evaluate`) | Güte auf echtem Einsatzmaterial deutscher Behörden |
| Suche auf allgemeinem Material: 54 von 66 Anfragen beantwortet, erster Treffer bei 64 von 66 passend (`pnpm search:evaluate`) | Nachfrage: Es gibt kein Gespräch mit einer Behörde und keine Zusage |
| 44 Aufnahmen durchsuchbar 8 s nach Beginn des Hochladens über die Schnittstelle, 10 s über den Browser; Auswertung in 3,3-facher Echtzeit auf vier Kernen ohne Grafikkarte | Rechtsgrundlage: kein Gutachten; `docs/COMPLIANCE.md` ordnet zu, ersetzt es nicht |
| Der ganze Vorführweg unter Windows PowerShell (`.github/workflows/windows.yml`) | Direktbilder echter Kameras: nur gegen eine simulierte Kamera geprüft |
| Verbund über drei Knoten auf einem Rechner; dazu zwei getrennt gestartete und getrennt eingerichtete Knoten, die einander mit Adresse kennen, auch über HTTPS mit selbst ausgestelltem Zertifikat | Verbund über ein echtes Netz, mehr als drei Knoten |
| Während der Auswertung von 44 Aufnahmen war kein unmaskiertes Bild und keine ungeprüfte Aufzeichnung abrufbar (`docs/SICHERHEIT.md`) | Sicherheit eines laufenden Systems gegen einen Angreifer: Es gab eine Durchsicht des Quelltexts, keinen Penetrationstest |
| 88 automatische Prüfungen (`pnpm test`), darunter zwei unabhängige Prüfprogramme für das Protokoll | Wie viele Gesichter der Erkenner übersieht |
| Dauerlauf über 19 Minuten mit sieben Übungsläufen: Speicher stabil, kein Fehler, Protokoll unversehrt; Kopie eines Datenordners startet und sucht; ein vorbereiteter Rechner kommt ohne Netz aus | Dauerbetrieb über Tage und unter Last |
| Konsole und Website verletzen keine automatisch prüfbare Regel der WCAG 2.1 A und AA; die Konsole lässt sich ohne Maus bedienen (`docs/BARRIEREFREIHEIT.md`) | Barrierefreiheit nach BITV: kein Test einer Prüfstelle, kein Test mit Bildschirmleser, Marken der Karte nur mit der Maus |

Die Wachen der Übung wurden am Übungsmaterial formuliert, die Schwellen der Suche an den
gemessenen Anfragen eingestellt. Diese Einschränkung gehört zu jeder Nennung der Zahlen.

## 6. Die schwächsten Stellen des Geschäftsfalls

- **Der Kernmarkt ist klein.** Bei vollständiger Abdeckung zu den angenommenen Listenpreisen
  rund 25,5 Mio. € im Jahr. Das trägt ein profitables Fachunternehmen, aber keine
  Wagnisfinanzierung, die auf ein Vielfaches zielt.
- **Bestandsanbieter können die Funktion ergänzen.** Freitextsuche über Video bieten mehrere
  Hersteller; neu ist die Verbindung aus Verbund ohne Datenabfluss, Zweckbindung und Protokoll.
  Das ist heute eine Bauweise, kein Schutzrecht.
- **Lange Vertriebswege.** Neun bis achtzehn Monate bis zur ersten bezahlten Erprobung sind
  realistisch.
- **Ein Gründer ohne Herkunft aus der Stabsarbeit.** Eine Mitgründung oder ein Beirat aus Stab
  oder Leitstelle ist vor dem ersten Behördengespräch mehr wert als weitere Funktionen.

Ausführlich: [`docs/STRATEGY.md`](docs/STRATEGY.md), Abschnitte Wettbewerb, Käufer und Risiken.
