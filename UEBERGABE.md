# Übergabe

Stand: 18. November 2026. Dieses Blatt sagt, was vorliegt, wie es auf einem Windows-Rechner in
Gang kommt und was vor dem Termin noch zu entscheiden ist. Einzelheiten stehen in den verlinkten
Unterlagen.

## 1. Was vorliegt

| Was | Wo | Stand |
| --- | --- | --- |
| Konsole und Knoten (das Produkt) | dieses Repository; Start siehe Abschnitt 2 | läuft; unter Linux und Windows von Anfang bis Ende durchgespielt |
| Ablauf der Vorführung, 13 Minuten, mit Sprechzeilen und Rückfallebenen | [`docs/DEMO.md`](docs/DEMO.md); zum Ausdrucken [`deliverables/Sicht-Vorfuehrung-Ablauf.pdf`](deliverables/Sicht-Vorfuehrung-Ablauf.pdf) | fertig |
| Kurzvorstellung: ein Satz, 30 Sekunden, zwei Minuten, sechs Antworten in einem Atemzug | [`docs/vertrieb/KURZVORSTELLUNG.md`](docs/vertrieb/KURZVORSTELLUNG.md), deutsch und englisch | fertig |
| Präsentation, 20 Folien, deutsch | privates Dokument <https://claude.ai/artifact/NhPkBXmqP2jQbv2GZaDKyQ>; ohne Netz: [`deliverables/Sicht-Praesentation.pdf`](deliverables/Sicht-Praesentation.pdf); Sprechzettel daneben | fertig; Folie 19 nennt den Mittelbedarf des Basisfalls, aber keine Bitte um eine Summe |
| Präsentation, englisch | privates Dokument <https://claude.ai/artifact/KjH984UGPDCVaVUAiDBTR2>; ohne Netz: [`deliverables/Sicht-Presentation-EN.pdf`](deliverables/Sicht-Presentation-EN.pdf); Notizen daneben | fertig; kein Muttersprachler hat gegengelesen |
| Website, deutsch und englisch | private Seite <https://claude.ai/artifact/JarVGwmtbRpmb321zGdU9B>; Quelle in [`site/`](site/) | fertig; nicht öffentlich, mit `noindex` |
| Einseiter, deutsch und englisch | [`deliverables/Sicht-Einseiter.pdf`](deliverables/Sicht-Einseiter.pdf), [`deliverables/Sicht-One-Pager-EN.pdf`](deliverables/Sicht-One-Pager-EN.pdf) | fertig |
| Finanzmodell, drei Szenarien | [`deliverables/Sicht-Finanzmodell.xlsx`](deliverables/Sicht-Finanzmodell.xlsx) | fertig; alle Werte sind Annahmen |
| Filme: Markenfilm (40 s und 67 s), englische Fassung (40 s), Produktfilm (143 s, Bildschirmaufnahme), Hochkant-Teaser (20 s, deutsch und englisch) | `deliverables/film/` (liegt nicht im Repository, wurde im Gespräch übergeben); Schnittwerkzeug und Drehbuch in [`media/brand/`](media/brand/) | fertig; Ton nur gemessen, nicht angehört |
| Unterlagenmappe als PDF: Strategie, Recht und Vorkehrungen, Fragen und Antworten, Messbericht, Marke, Architektur, Sicherheitsdurchsicht | [`deliverables/unterlagen/`](deliverables/unterlagen/); Quellen in [`docs/`](docs/) | fertig |
| Architektur und Sicherheitsdurchsicht | [`docs/ARCHITEKTUR.md`](docs/ARCHITEKTUR.md), [`docs/SICHERHEIT.md`](docs/SICHERHEIT.md) | fertig; 21 Befunde einer unabhängigen Durchsicht, die schweren behoben |
| Vertriebsvorlagen: Anschreiben, Angebot zur Erprobung | [`docs/vertrieb/`](docs/vertrieb/) | Vorlagen; eckige Klammern und Preis vor dem Versand füllen |
| Prüfprogramme für das Protokoll, unabhängig von Sicht | [`tools/pruefen/`](tools/pruefen/), `pnpm ledger:verify <Datei>` | fertig; je eines in Node und Python |
| Wortmarke als Datei | [`brand/`](brand/) | fertig; Name markenrechtlich nicht geprüft |
| Messbericht mit Bedingungen und Einschränkungen | [`docs/EVALUATION.md`](docs/EVALUATION.md) | fertig; nachmessbar |

## 2. In Gang bringen (Windows, PowerShell)

Voraussetzungen: Node ab 20.11, pnpm, ffmpeg (`winget install Gyan.FFmpeg`, danach ein neues
Terminal öffnen). Beim ersten Mal werden rund 950 MB Modelle und rund 300 MB Übungsmaterial
geladen; danach braucht nichts mehr ein Netz.

```bash
git pull
```

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

- `demo:prepare` wertet das Material aus (fünf bis zehn Minuten) und endet mit „Vorbereitet“.
- `demo:check` endet mit „Ergebnis: bereit“. Steht dort etwas anderes, nennt jede Zeile mit
  FEHLT den nächsten Schritt.
- `demo` startet drei Knoten. Hauptbildschirm: <http://127.0.0.1:8787>, Anmeldung `leitung`,
  Passwort `lagebild`, Mandat „Übung RHEIN-MOSEL“.
- Nach einer Probe: Knoten mit Strg+C beenden, `pnpm demo:reset`, dann wieder `pnpm demo`. Das
  stellt den Ausgangsstand in einer Sekunde wieder her.
- Ohne `ML_DEVICE` starten. Die Auswertung läuft auf dem Prozessor; eine Grafikkarte wird nur
  verwendet, wenn sie nachweislich dasselbe rechnet.
- Nach jedem `git pull` wieder `pnpm install` und `pnpm build`, dann `pnpm demo:check`. Neu
  vorbereiten (`pnpm demo:prepare`) ist nur nötig, wenn die Prüfung es sagt; ein früher
  vorbereiteter Stand bleibt verwendbar.
- Die Kette ohne Sicht nachrechnen, falls jemand fragt:
  `pnpm ledger:verify data-koblenz/ledger.jsonl`.

Für eigenes Material statt der Übung: `pnpm start`, anmelden, Mandat „Erprobung“, im Reiter
QUELLEN Dateien oder einen Ordner ablegen, im Reiter SUCHE fragen.

## 3. Vor dem Termin entscheiden

1. **Finanzierung.** Folie 19 nennt den Mittelbedarf des Basisfalls bis 2031, rund 3,2 Mio. €
   (Annahme), lässt aber offen, ob und worum gebeten wird.
2. **Kontakt.** Die Website zeigt den Aufruf „Vorführung anfragen“ erst, wenn in
   `site/index.html` am `<body>` eine Adresse eingetragen ist (`data-contact`).
3. **Name.** „Sicht“ ist markenrechtlich nicht geprüft (DPMA, EUIPO). Bis dahin intern verwenden;
   die Website ist deshalb nicht öffentlich.
4. **Wer spricht mit wem.** Die Strategie nennt als ersten Schritt eine bezahlte Erprobung bei
   einem Kreis mit eigener Drohneneinheit und ein Abbruchkriterium Ende März 2027.

## 4. Was belegt ist und was nicht

| Belegt, in diesem Repository nachmessbar | Nicht belegt |
| --- | --- |
| Übung: 13 von 13 Ereignissen erkannt, Verzug 1,1 s im Median, eine Fehlmeldung (`pnpm exercise:evaluate`) | Güte auf echtem Einsatzmaterial deutscher Behörden |
| Suche auf allgemeinem Material: 54 von 66 Anfragen beantwortet, erster Treffer bei 64 von 66 passend (`pnpm search:evaluate`) | Nachfrage: Es gibt kein Gespräch mit einer Behörde und keine Zusage |
| 44 Aufnahmen durchsuchbar 8 s nach Beginn des Hochladens; Auswertung in 3,3-facher Echtzeit auf vier Kernen ohne Grafikkarte | Rechtsgrundlage: kein Gutachten; `docs/COMPLIANCE.md` ordnet zu, ersetzt es nicht |
| Der ganze Vorführweg unter Windows PowerShell (`.github/workflows/windows.yml`) | Direktbilder echter Kameras: nur gegen eine simulierte Kamera geprüft |
| Verbund über drei Knoten auf einem Rechner | Verbund über ein echtes Netz, mehr als drei Knoten |
| Während der Auswertung von 44 Aufnahmen war kein unmaskiertes Bild und keine ungeprüfte Aufzeichnung abrufbar (`docs/SICHERHEIT.md`) | Sicherheit eines laufenden Systems gegen einen Angreifer: Es gab eine Durchsicht des Quelltexts, keinen Penetrationstest |
| 77 automatische Prüfungen (`pnpm test`), darunter zwei unabhängige Prüfprogramme für das Protokoll | Wie viele Gesichter der Erkenner übersieht |

Die Wachen der Übung wurden am Übungsmaterial formuliert, die Schwellen der Suche an den
gemessenen Anfragen eingestellt. Diese Einschränkung gehört zu jeder Nennung der Zahlen.

## 5. Die schwächsten Stellen des Geschäftsfalls

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
