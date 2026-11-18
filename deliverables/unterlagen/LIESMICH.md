# Sicht – Unterlagenmappe

Die zehn Unterlagen zu Sicht als druckfertige PDF-Dateien im Format A4. Jede Datei entsteht aus
einer Markdown-Datei unter `docs/`; geändert wird dort, nicht im PDF. Auf dem Deckblatt steht der
Stand, in der Fußzeile der Titel und die Seitenzahl, am Ende die Liste der Quellen mit ihren
Adressen.

| Datei | Was es ist | Für wen |
| --- | --- | --- |
| `Sicht-Strategie.pdf` | These, Belege für das Problem, Stand des Produkts (gebaut, im Labor geprüft, geplant), Wettbewerb, Käufer und Beschaffung, Preis und Marktgröße, Markteintritt, Risiken, offene Punkte. Aus `docs/STRATEGY.md`. | Gründer, Investoren, Berater. Ein internes Papier: Es nennt Preislogik, Einschätzungen zu Wettbewerbern und ungeklärte Punkte. |
| `Sicht-Recht-und-Vorkehrungen.pdf` | Acht rechtliche Anforderungen und ihre Umsetzung im Quelltext, Grenzen der Maskierung, Einordnung nach der KI-Verordnung, die offene Rechtsgrundlage der Auswertung, Unterlagen für eine Datenschutz-Folgenabschätzung, Lizenzen der Modelle. Eine technische Zuordnung, keine Rechtsberatung. Aus `docs/COMPLIANCE.md`. | Behördliche Datenschutzbeauftragte, Rechtsamt, Aufsicht; die Rechtsanwältin oder der Rechtsanwalt, die das Papier vor einem Einsatz prüfen. |
| `Sicht-Fragen-und-Antworten.pdf` | Die harten Fragen aus Ministerium, Datenschutz, Einsatzleitung und Presse und von Investoren, jede mit einer Antwort. Aus `docs/FAQ.md`. | Wer Sicht vorstellt, zur Vorbereitung auf Gespräche. |
| `Sicht-Messbericht.pdf` | Was gemessen wurde, womit und unter welchen Bedingungen: die Übung RHEIN-MOSEL, die Auswertung von Aufzeichnungen und Direktbild, die Suche, das Gefahrenmodell, die Gegenprobe auf einem Windows-Rechner; dazu, was nicht gemessen ist. Aus `docs/EVALUATION.md`. | Technische Prüfer und Fachabteilungen; alle, die eine Zahl aus den anderen Unterlagen nachprüfen wollen. |
| `Sicht-Marke.pdf` | Name, Leitsatz, Wortschatz, Gestaltung und die Liste dessen, was über Sicht behauptet werden darf. Aus `docs/BRAND.md`. | Alle, die für Sicht schreiben oder gestalten. |
| `Sicht-Architektur.pdf` | Wie Sicht gebaut ist: Weg eines Bildes, Speicherformate, Suche, Protokoll mit Format und Prüfung, Rollen und Rechte, Verbundprotokoll, alle Wege der Schnittstelle, Vorkehrungen und offene Punkte. Aus `docs/ARCHITEKTUR.md`. | Technische Prüfer, IT einer Behörde, mögliche Partner für die Kopplung. |
| `Sicht-Sicherheitsdurchsicht.pdf` | Was eine unabhängige Durchsicht des Quelltexts gefunden hat: 21 Befunde mit Schwere, Stand und Nachweis, was in Ordnung befunden wurde, was offen bleibt. Aus `docs/SICHERHEIT.md`. | IT-Sicherheit und Datenschutz einer Behörde; Stellen, die einen Penetrationstest vorbereiten. |
| `Sicht-Stueckliste.pdf` | Woraus Sicht besteht: 143 Pakete mit Fassung und Lizenz, Modelle, Schrift und Daten mit Herkunft und Prüfsumme, der Abgleich mit bekannten Schwachstellen und was die Liste nicht leistet. Aus `docs/STUECKLISTE.md`; maschinenlesbar in `docs/stueckliste/sicht.cdx.json`. | Vergabestelle, IT-Sicherheit, Rechtsamt. |
| `Sicht-Barrierefreiheit.pdf` | Was an Konsole und Website geprüft wurde (automatisch nach den Regeln der WCAG 2.1 A und AA, Bedienung nur mit der Tastatur, Ansage neuer Meldungen), was gefunden und geändert wurde und was nicht geprüft ist. Kein BITV-Test. Aus `docs/BARRIEREFREIHEIT.md`. | Vergabestelle, Schwerbehindertenvertretung, Stellen, die einen BITV-Test vorbereiten. |
| `Sicht-Betrieb.pdf` | Was ein Knoten braucht (Kerne, Arbeitsspeicher, Platte), wie er eingerichtet, gesichert, wiederhergestellt, aktualisiert und überwacht wird, eine Tabelle der Störungen und was für einen Echtbetrieb fehlt. Sicherung, Umstieg und ein Dauerlauf sind nachgestellt. Aus `docs/BETRIEB.md`. | IT der Behörde, die einen Knoten betreibt. |

## Neu erzeugen

Im Wurzelverzeichnis des Repositorys:

```bash
node docs/unterlagen/build.cjs
```

Der Befehl liest die Markdown-Dateien in ihrem jetzigen Stand und schreibt alle zehn PDF-Dateien
neu. Eine einzelne Unterlage: `node docs/unterlagen/build.cjs strategy` (ebenso `compliance`,
`faq`, `evaluation`, `brand`, `architecture`, `security`, `bom`, `accessibility`, `operation`). Ein anderes Datum auf dem Deckblatt:
`node docs/unterlagen/build.cjs --stand "2. Dezember 2026"`.

Gebraucht werden Node und Playwright mit Chromium. Sind `pdftotext` und `pdfinfo` (Poppler)
vorhanden, prüft der Befehl jede Datei nach dem Druck: Jedes Wort, jede Überschrift und jede
Quelle der Vorlage steht im PDF, keine Seite endet mit einer Überschrift. Eine Zeile `PRÜFUNG`
in der Ausgabe nennt, was nicht stimmt; der Befehl endet dann mit Fehler.
