# Betrieb

Stand: 18. November 2026. Dieses Blatt richtet sich an die IT einer Behörde, die einen Knoten
betreibt: was er braucht, wie er eingerichtet, gesichert, aktualisiert und überwacht wird. Es
beschreibt den Erprobungsstand. Was hier als geprüft steht, wurde auf einem Rechner mit vier
Kernen ohne Grafikkarte nachgestellt; was für einen Echtbetrieb fehlt, steht am Ende.

## 1. Was ein Knoten braucht

| Bedarf | Wert | Woher die Zahl kommt |
| --- | --- | --- |
| Rechenkerne | vier genügen für Aufzeichnungen; rechnerisch drei Direktbilder gleichzeitig | Auswertung in 3,3-facher Echtzeit, `docs/EVALUATION.md` |
| Arbeitsspeicher | rund 3 GB beim Start, rund 1,7 GB im Betrieb; unabhängig davon, ob ein oder drei Knoten im Prozess laufen | gemessen: ein Knoten 2,97 GB Spitze und 1,64 GB nach anderthalb Minuten; drei Knoten 3,0 GB Spitze und 1,73 GB über 17 Minuten |
| Platte, einmalig | rund 950 MB Modelle | Ordner `.models` |
| Platte, laufend | die Aufzeichnung selbst und dazu rund 3,3 MB je Minute Material | Übung: 577 s Material, 196 MB Aufzeichnungen, 25 MB Bilder, 7 MB Verzeichnis, bei einem Bild je Sekunde |
| Software | Node ab 20.11, pnpm, ffmpeg | `README.md` |
| Netz | nach dem Laden der Modelle keines | nachgestellt auf einem vorbereiteten Rechner ohne jede Verbindung: Einrichten, Bauen, Prüfung, Start, Übung und Suche liefen durch (`docs/EVALUATION.md`, Abschnitt 7); `SICHT_OFFLINE=1` unterbindet zusätzlich jedes Nachladen |
| Betriebssystem | Windows mit PowerShell 5.1 und Linux sind durchgespielt | `.github/workflows/windows.yml`, `docs/EVALUATION.md`; macOS ist nicht geprüft |

Eine Grafikkarte wird nur verwendet, wenn sie beim Start dasselbe rechnet wie der Prozessor
(`ML_DEVICE`); sonst rechnet der Knoten auf dem Prozessor weiter.

## 2. Einrichten

Ein einzelner Knoten:

```bash
pnpm install
```

```bash
pnpm build
```

```bash
pnpm start
```

Eingestellt wird über Umgebungsvariablen; die vollständige Liste steht im `README.md` unter
„Einstellungen“. Für einen Betrieb außerhalb der Vorführung zählen diese:

| Einstellung | Wozu |
| --- | --- |
| `SICHT_DEMO_PASSWORD` | Das veröffentlichte Passwort `lagebild` ersetzen. Mit einem eigenen Passwort zeigt die Anmeldeseite keinen Hinweis mehr darauf. |
| `HOST`, `PORT` | Voreingestellt lauscht der Knoten nur auf `127.0.0.1`. Wer ihn im Netz erreichbar macht, setzt auch ein Zertifikat. |
| `SICHT_TLS_CERT`, `SICHT_TLS_KEY` | Zertifikat und Schlüssel als PEM-Datei; der Knoten spricht dann HTTPS. Geprüft mit selbst ausgestelltem Zertifikat. |
| `SICHT_RETENTION_DAYS` | Löschfrist für Aufzeichnungen außerhalb von Vorgängen, voreingestellt 60 Tage. |
| `SICHT_MIN_FREE_MB` | Unter dieser Grenze nimmt der Knoten keine Aufzeichnungen an, voreingestellt 1 GB. |
| `SICHT_STREAM_HOSTS` | Adressen, von denen Direktbilder kommen dürfen. Ohne Angabe gilt jede Adresse. |
| `SICHT_OFFLINE` | `1`, sobald die Modelle geladen sind: Der Knoten lädt dann nichts mehr nach. |
| `DATA_DIR` | Ort des Datenordners. Er enthält alles, was den Knoten ausmacht (Abschnitt 3). |

Mehrere Knoten in einem Prozess und der Verbund zwischen Rechnern werden in einer Knotendatei
beschrieben; die Vorlage ist `nodes.beispiel.json`, die Schritte stehen im `README.md` unter
„Zwei Rechner im Verbund“.

## 3. Was im Datenordner liegt

| Eintrag | Inhalt |
| --- | --- |
| `videos/` | je Aufzeichnung ein Ordner: die Datei, die freigegebenen Bilder, das Verzeichnis der Bildmerkmale, Angaben zur Auswertung |
| `ledger.jsonl` | das verkettete Protokoll, eine Zeile je Eintrag |
| `sources.json`, `watches.json`, `mandates.json`, `users.json`, `peers.json` | Quellen, Wachen, Mandate, Zugänge, Nachbarknoten |
| `alerts.json`, `incidents.json`, `cases/` | Meldungen, Lagen, Vorgänge mit ihren Beweisstücken |
| `streams/` | Zwischenablage für Abschnitte laufender Direktbilder |
| `cache/` | abgeleitete Tabellen; werden bei Bedarf neu erzeugt |

Die Formate stehen in `docs/ARCHITEKTUR.md`, Abschnitt 3. Außerhalb dieses Ordners hält der
Knoten nichts, was zu sichern wäre; die Modelle in `.models` lassen sich neu laden.

## 4. Sichern und wiederherstellen

1. Den Knoten mit Strg+C beenden. Er schreibt seinen Stand fertig und endet nach höchstens vier
   Sekunden.
2. Den Datenordner kopieren.
3. Zum Wiederherstellen den Ordner zurückkopieren oder mit `DATA_DIR` auf die Kopie zeigen und
   starten.

Geprüft mit zwei Beständen: Die Kopie eines Knotens nach sieben Übungsläufen (326 Einträge im
Protokoll) und die Kopie eines Knotens mit 44 eigenen Aufzeichnungen wurden an anderem Ort
gestartet. Das unabhängige Prüfprogramm meldet für beide Kopien „Kette unversehrt“, der Knoten
selbst ebenso; Anmeldung, Mandat und Suche arbeiten auf der Kopie wie auf dem Original.

Nicht geprüft ist das Kopieren, während der Knoten läuft; es kann einen halb geschriebenen Stand
erfassen und gehört deshalb nicht in eine Sicherung.

Das Protokoll gehört zusätzlich regelmäßig aus dem Haus: Im Reiter PROTOKOLL gibt EXPORT die
Datei aus, und `pnpm ledger:verify <Datei>` rechnet sie ohne Sicht nach. Wer eine ältere
Sicherung zurückspielt, hat danach ein kürzeres Protokoll, als die Nachbarknoten bezeugt haben;
im Verbund fällt das auf, und das ist beabsichtigt.

## 5. Aktualisieren

```bash
git pull
```

```bash
pnpm install
```

```bash
pnpm build
```

Danach neu starten. Der Datenordner bleibt, wie er ist. Wechselt mit einer Fassung der
Bildkodierer, erkennt der Knoten Aufzeichnungen, die mit dem früheren ausgewertet wurden, und
wertet sie beim Start im Hintergrund neu aus. Geprüft mit dem Bestand der ersten Fassung: 44
Aufzeichnungen, drei bis vier Minuten; die Suche antwortet schon währenddessen.

Vor dem Aktualisieren sichern. Ändern sich Pakete, verlangt ein Test eine neue Stückliste
(`pnpm sbom`).

## 6. Überwachen

| Was | Wie |
| --- | --- |
| Lebenszeichen | `GET /api/public/info` antwortet ohne Anmeldung mit Namen und Fassung des Knotens |
| Auswertung, Suchdauer, Maskierung, Löschfrist | Reiter WIRKUNG |
| Protokoll | Schaltfläche KETTE PRÜFEN im Reiter PROTOKOLL oder `pnpm ledger:verify <Datei>`; die Prüfung von 325 Einträgen dauert 15 ms |
| Freier Platz | Der Knoten prüft ihn vor dem Hochladen. Laufende Direktbilder prüft er nicht: die Platte gehört in die Überwachung des Rechners |
| Meldungen des Knotens | Standardausgabe des Prozesses; eigene Logdateien schreibt er nicht. Fehler bei Arbeiten im Hintergrund stehen dort mit dem Vorsatz „Fehler im Hintergrund“ |

Ein Dauerlauf als Anhalt: Drei Knoten liefen 19 Minuten durch, die Übung wurde dabei sechsmal
in achtfacher Geschwindigkeit und einmal in Echtzeit gespielt, ein Browser blieb auf der Lage,
alle vier bis zehn Sekunden kam eine Suchanfrage. Jeder Lauf brachte dieselben 15 Meldungen und
11 Lagen. Der Arbeitsspeicher blieb zwischen 1 725 und 1 734 MB, die Zahl der offenen Dateien
bei 38; die Suche antwortete im Median nach 5 bis 8 ms, der Abruf der Lage nach 2 ms; der
Browser meldete keinen Fehler, und das Protokoll war am Ende unversehrt. Neunzehn Minuten sind
kein Dauerbetrieb über Tage; der steht aus.

## 7. Störungen

| Anzeichen | Ursache | Abhilfe |
| --- | --- | --- |
| „Anschluss … ist bereits belegt“ | Der Knoten läuft schon, oder ein anderes Programm hält den Anschluss | das andere Fenster mit Strg+C beenden; oder `PORT` ändern |
| „ffmpeg wurde nicht gefunden“ | ffmpeg fehlt im Suchpfad | installieren, neues Terminal öffnen; oder `FFMPEG_PATH` setzen |
| Das Laden der Modelle wurde unterbrochen | Netz weg oder Fenster geschlossen | den Befehl wiederholen: Der Knoten lädt nur fertige Dateien in den Ordner und holt Fehlendes nach (nachgestellt: nach einem Abbruch war er beim zweiten Start nach 28 s bereit). Liegen gebliebene Dateien mit `.tmp.` im Namen in `.models` dürfen gelöscht werden |
| „Modell konnte nicht geladen werden … Protobuf parsing failed“ | eine Modelldatei ist beschädigt | den Ordner `.models` löschen und mit Netz neu starten |
| Hochladen wird mit dem Hinweis auf freien Platz abgelehnt | weniger als `SICHT_MIN_FREE_MB` frei | Platz schaffen; die Löschfrist prüfen |
| Ein Direktbild bleibt „getrennt“ mit dem Hinweis auf den Betreiber | die Adresse steht nicht in `SICHT_STREAM_HOSTS` | Liste ergänzen und neu starten |
| Die Prüfung der Kette meldet eine Stelle | die Datei wurde verändert, gekürzt oder ausgetauscht | nicht weiterarbeiten; Export und bezeugte Stände der Nachbarn vergleichen |
| Suche findet nach einer Aktualisierung zunächst wenig | der Bestand wird neu ausgewertet | abwarten; der Reiter QUELLEN zeigt den Fortschritt |
| Die Vorführung ist nicht im Ausgangsstand | eine Probe hat Urteile und Vorgänge hinterlassen | `pnpm demo:reset`, unter Windows `.\vorfuehrung.cmd` |

## 8. Was für einen Echtbetrieb fehlt

- Der Knoten ist ein Programm im Vordergrund. Einen Dienst mit Neustart nach einem Absturz gibt
  es nicht; unter Windows und Linux lässt er sich mit Bordmitteln einrichten, erprobt ist das
  nicht.
- Drei feste Zugänge mit einem gemeinsamen Passwort, kein zweiter Faktor, kein Verzeichnisdienst.
- Nichts auf der Platte ist verschlüsselt; das übernimmt bis dahin das Betriebssystem.
- Zertifikate werden gelesen, nicht verwaltet: kein Wechsel im Betrieb, keine gegenseitigen
  Zertifikate im Verbund.
- Keine Sicherung im laufenden Betrieb, kein zweiter Knoten, der übernimmt.
- Kennzahlen stehen im Reiter WIRKUNG, nicht an einer Schnittstelle für ein Überwachungssystem.
- Ein Dauerbetrieb über Tage und unter Last ist nicht gemessen.

Die Befunde der Sicherheitsdurchsicht und ihr Stand stehen in `docs/SICHERHEIT.md`.
