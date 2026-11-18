# Architektur

Wie Sicht gebaut ist, für alle, die es technisch prüfen: Weg eines Bildes, Speicherformate,
Protokoll, Rollen, Verbund, Schnittstelle. Jede Aussage nennt die Datei, in der sie nachzulesen
ist. Was gemessen wurde, steht in [`EVALUATION.md`](EVALUATION.md); welche rechtliche Anforderung
welcher Vorkehrung entspricht, in [`COMPLIANCE.md`](COMPLIANCE.md). Stand: 18. November 2026,
Fassung 0.5.0, Erprobungsstand.

## 1. Überblick

Ein Knoten ist ein Prozess auf einem Rechner der Behörde: ein Fastify-Server in TypeScript
(`apps/server`), der die Konsole (`apps/web`, React) als statische Dateien mit ausliefert. Er
braucht Node ab 20.11 und ffmpeg. Es gibt keine Datenbank und keinen zweiten Dienst: Zustand liegt
in Dateien unter einem Datenverzeichnis, das Verzeichnis der Bildmerkmale zusätzlich im
Arbeitsspeicher. Nach dem einmaligen Laden der Modelle (rund 950 MB) öffnet der Knoten von sich
aus keine Verbindung nach außen; `SICHT_OFFLINE=1` unterbindet auch das Nachladen.

```
                    ┌──────────────────────────── Knoten ────────────────────────────┐
 Datei, Ordner ───► │ Einspielen ─► Bilder ─► Maskieren ─► Merkmale ─► Verzeichnis   │
 Direktbild ──────► │   (ffmpeg)     1/s       (YuNet)     (SigLIP 2)   je Aufnahme  │
                    │                                                      │         │
 Konsole ─────────► │ Anfrageprüfung ─► Textmerkmal ─► Vergleich ◄─────────┤         │
 (Browser)          │ Wachen ─► Meldung ─► Lage ─► Vorgang                 │         │
                    │                                                      ▼         │
                    │ Protokoll: eine Datei, je Zeile ein Eintrag, über SHA-256      │
                    │ verkettet; geschrieben, bevor eine Antwort ausgeliefert wird   │
                    └──────────────┬─────────────────────────────────────────────────┘
                                   │ signierte Frage  ▲ maskierte Vorschau, Belegnummer
                                   ▼                  │
                              Nachbarknoten (eigene Regeln, eigenes Protokoll)
```

| Baustein | Datei | Aufgabe |
| --- | --- | --- |
| Start, mehrere Knoten in einem Prozess | `index.ts`, `runtime.ts`, `node.ts` | Einstellungen lesen, Modell einmal laden, je Knoten Speicher und Schnittstelle |
| Einspielen | `pipeline.ts`, `media/ffmpeg.ts`, `media/mp4.ts` | Bilder ziehen, Szenen trennen, maskieren, Merkmale rechnen, Schlagworte vergeben |
| Modell | `ml/model.ts`, `ml/preprocess.ts`, `ml/calibration.ts` | Bild- und Textkodierer (ONNX), Selbsttest, Schwellen |
| Maskierung | `ml/faces.ts` | Gesichter finden und verpixeln; keine Merkmale einer Person |
| Verzeichnis | `store.ts` | Aufnahmen, Bilder, Merkmale; Löschfrist |
| Suche | `search.ts`, `intel/scoring.ts`, `intel/guard.ts` | Anfrageprüfung, Vergleich, Sicherheit je Treffer |
| Wachen, Lagen, Vorgänge | `intel/watches.ts`, `intel/incidents.ts`, `intel/cases.ts` | stehende Suchaufträge, Zusammenfassen, Beweissicherung |
| Protokoll | `core/ledger.ts` | verkettete Einträge, Prüfung, Export |
| Rollen, Mandate | `core/auth.ts`, `core/mandates.ts` | Anmeldung, Rechte, Zweckbindung |
| Verbund | `intel/federation.ts` | signierte Fragen an Nachbarn, Bezeugen des Protokollstands |
| Direktbild | `intel/live.ts` | Strom in Abschnitte schneiden und einspielen |
| Übung | `intel/scenario.ts`, `intel/metrics.ts` | Drehbuch abspielen, Verzug je Ereignis messen |
| Schnittstelle | `routes.ts`, `events.ts` | HTTP und Ereignisstrom für die Konsole |

## 2. Der Weg eines Bildes

1. **Annahme.** Eine Aufnahme kommt als Datei (auch viele auf einmal, bis 500 je Anfrage), aus
   dem Drehbuch einer Übung oder als fertiger Abschnitt eines Direktbilds. Sie erhält eine
   zufällige Kennung aus 16 Hexzeichen und ein eigenes Verzeichnis (`store.ts`).
2. **Erster Durchgang.** Für jede Aufnahme entsteht sofort ein Vorschaubild aus einem
   Schlüsselbild und ein erster Vektor, damit ein großer Stapel nach Sekunden durchsuchbar ist.
   Die Dauer einer MP4-Datei wird dafür aus ihrem Kopf gelesen, ohne ffmpeg zu starten
   (`media/mp4.ts`). Gemessen: 44 Aufnahmen durchsuchbar nach 7,6 s.
3. **Auswertung.** ffmpeg liefert ein Bild je Sekunde in 640 Pixel Breite (`FRAME_WIDTH`).
   Unveränderte Folgebilder werden übersprungen, Szenen an Schnitten und nach Ruhephasen getrennt.
4. **Maskierung und Freigabe.** ffmpeg schreibt jedes Bild unter einem Namen, den die
   Schnittstelle nie ausliefert (`NNNNNNN.x.jpg`). YuNet (OpenCV Zoo, MIT-Lizenz) sucht darin
   Gesichter. Erst danach erhält das Bild seinen abrufbaren Namen `NNNNNNN.jpg`: unverändert, wenn
   nichts gefunden wurde, sonst verpixelt; das unveränderte Bild liegt dann daneben als
   `NNNNNNN.o.jpg` und wird nur mit einer gültigen Freigabe ausgeliefert. Ohne geladenen Erkenner
   wird kein Bild freigegeben. Der Erkenner liefert Rechtecke, keine Merkmale; ein Modell, das
   Gesichter vergleicht, gibt es im System nicht (`pipeline.ts`, `releaseFrame`; `ml/faces.ts`).
5. **Merkmale.** Jedes Bild wird als Ganzes und in Ausschnitten kodiert: bei 16:9 das ganze Bild
   und drei überlappende Quadrate, also vier Vektoren je Bild (`ml/preprocess.ts`, `tileLayout`).
   Kodierer ist SigLIP 2 base patch32-256 (Google, Apache 2.0), 768 Dimensionen, über
   onnxruntime auf dem Prozessor. Beim Start prüft der Knoten den Kodierer an einer festen Probe:
   Verschiedene Bilder und Texte müssen verschiedene Vektoren ergeben, sonst startet er nicht.
   Die Ergebnisse einer Grafikkarte vergleicht er mit denen des Prozessors und rechnet auf dem
   Prozessor weiter, wenn sie abweichen (`ml/model.ts`).
6. **Schlagworte.** Jede Szene wird gegen 332 feste Begriffe gemessen (Orte, Gegenstände,
   Fahrzeuge, Tätigkeiten, Schadenslagen). Keiner beschreibt Personen nach Geschlecht, Alter,
   Kleidung oder Beruf (`ml/vocab.ts`, Test `test/vocabulary.test.ts`).
7. **Wachen.** Jedes neue Bild wird gegen alle Wachen gemessen, die für die Quellenart gelten.

## 3. Was auf der Platte liegt

Ein Datenverzeichnis je Knoten (`DATA_DIR`, in der Vorführung `data-koblenz`, `data-trier`,
`data-mainz`):

| Pfad | Inhalt | Format |
| --- | --- | --- |
| `ledger.jsonl` | Protokoll | ein JSON-Eintrag je Zeile, nur angehängt |
| `users.json`, `mandates.json`, `sources.json`, `watches.json`, `peers.json` | Zugänge (Kennwort als scrypt-Wert mit Salz), Mandate, Quellen, Wachen, Nachbarn mit gemeinsamem Schlüssel | JSON, über Zwischendatei und Umbenennen geschrieben |
| `cases/` | Vorgänge mit Beweisstücken, Vermerken, Siegel | JSON je Vorgang |
| `videos/<Kennung>/source.*` | die Aufnahme, unverändert | wie geliefert |
| `videos/<Kennung>/frames/NNNNNNN.jpg` | freigegebene Bilder, Gesichter maskiert | JPEG |
| `videos/<Kennung>/frames/NNNNNNN.x.jpg` | Bilder während der Auswertung, noch nicht freigegeben; nie abrufbar | JPEG |
| `videos/<Kennung>/frames/NNNNNNN.o.jpg` | Originale der Bilder, in denen etwas maskiert wurde | JPEG |
| `videos/<Kennung>/embeddings.f32` | Merkmale: Bilder × Ausschnitte × 768 Werte | Float32, zeilenweise |
| `videos/<Kennung>/meta.json` | Zeiten, Szenen, Schlagworte, maskierte Rechtecke, Modellkennung | JSON |
| `streams/` | Abschnitte laufender Direktbilder, bis sie eingespielt sind | MP4 |
| `incidents.json`, `exercise.json` | Lagen; Stand der Übung | JSON |

Nichts davon ist verschlüsselt; der Schutz der Platte ist Sache des Betreibers (siehe
Abschnitt 9). Aufnahmen werden nach `SICHT_RETENTION_DAYS` (60) gelöscht, sofern kein Vorgang
ein Bild aus ihnen hält. Die Modellkennung steht in `meta.json`; Merkmale eines anderen Kodierers
werden nicht gemischt, sondern neu gerechnet.

## 4. Suche

1. **Anfrageprüfung** (`intel/guard.ts`). Vor dem Modell steht eine Wortprüfung in Deutsch und
   Englisch. Sie lehnt ab: Namen und das Wiedererkennen bestimmter Personen, Gesichter,
   Kennzeichen, Verfolgen, Herkunft, Religion, Gesundheit und körperliche Merkmale.
   Beschreibungen nach Geschlecht, Altersgruppe oder Kleidung lässt sie nur unter einem Mandat zu,
   das sie ausdrücklich erlaubt. Jede Ablehnung wird mit der auslösenden Regel protokolliert. Es
   ist eine nachvollziehbare Regel, kein Klassifikator: Sie lässt sich umschreiben, und dafür
   gibt es Protokoll und Stichprobe.
2. **Textmerkmal.** Die Anfrage wird kodiert; die Hälfte des mittleren Textvektors wird abgezogen
   (`ml/centre.ts`), weil kurze Anfragen sonst alle ähnlich aussehen.
3. **Vergleich.** Skalarprodukt mit jedem Vektor des Verzeichnisses. Ganzes Bild und Ausschnitte
   werden an getrennten Schwellen gemessen, die sich je Anfrage am eigenen Bestand ausrichten
   (`ml/calibration.ts`, `search.ts`). Aus dem Abstand zur Schwelle wird die angezeigte Sicherheit.
4. **Eintrag vor Antwort.** Der Protokolleintrag mit Suchtext, Trefferzahl und den Kennungen der
   ersten Treffer wird geschrieben; erst danach geht die Antwort hinaus (`routes.ts`,
   `/api/search`).

Eine neue Anfrage kostet im Median 0,1 s, fast vollständig für das Kodieren des Textes; der
Vergleich mit 2 108 Vektoren dauert rund 5 ms. Das Verzeichnis ist eine vollständige Liste, kein
Näherungsindex: Mit einigen zehn Stunden Material ist das schnell genug, darüber hinaus nicht
gemessen.

## 5. Wachen, Meldungen, Lagen, Vorgänge

- **Wache** (`intel/watches.ts`): eine gespeicherte Beschreibung mit Ausschlüssen,
  Mindestsicherheit, Zahl aufeinanderfolgender Bilder bis zur Meldung, Ruhezeit und Quellenarten.
  Urteile über Meldungen (bestätigt, verworfen) werden gesammelt. Erst das ausdrückliche
  Nachschärfen rechnet daraus ein kleines logistisches Modell über den Bildmerkmalen und legt es
  als neue, nummerierte Fassung ab; der Schritt steht im Protokoll und lässt sich zurücknehmen
  (`ml/head.ts`, `BinaryHead`).
- **Gefahrenmodell** (`ml/head.ts`, `HazardHead`): ein lineares Modell über denselben Merkmalen,
  vorab auf AIDERv2 trainiert (99,1 % Makro-F1 auf der Testmenge). Auf dem Übungsmaterial irrt
  es, deshalb löst es keine Meldungen aus und steht als Zweitmeinung neben Meldungen aus
  Luftbildquellen.
- **Lage** (`intel/incidents.ts`): Meldungen gleicher Art im Umkreis von 1,2 km und innerhalb
  von 20 Minuten werden zusammengefasst; mehrere Quellen zählen als Bestätigung. Ausgabe als
  GeoJSON und als CAP-1.2-Meldung.
- **Vorgang** (`intel/cases.ts`): hält Bilder mit der SHA-256-Prüfsumme des unmaskierten
  Originals, Vermerke und nach dem Versiegeln eine Prüfsumme über den ganzen Inhalt. Versiegeln
  ist der Leitung vorbehalten. Der druckbare Bericht zeigt die maskierten Bilder; die Rolle
  Aufsicht erhält ihn ohne Bilder.

## 6. Protokoll

Eine Datei, `ledger.jsonl`, nur angehängt (`core/ledger.ts`). Ein Eintrag:

```json
{"seq":30,"ts":"2026-11-18T05:56:11.214Z","actor":"leitung","role":"supervisor",
 "mandateId":"md_…","action":"search.query","summary":"Suche „überflutete Wiese“: 4 Treffer",
 "data":{"query":"überflutete Wiese","matched":4,"scenesSearched":33,"tookMs":118,
         "top":["…#12","…"],"federated":true,
         "peers":[{"peer":"trier","ok":true,"matched":1,"receipt":9}],"flags":[]},
 "prev":"01b53905d77b…","hash":"fce5cc41e093…"}
```

- `hash = SHA-256(prev + "\n" + kanonisch(Eintrag ohne prev und hash))`. Kanonisch heißt: JSON
  ohne Leerraum, die Schlüssel jedes Objekts sortiert. Der erste Eintrag verweist auf 64 Nullen.
- Schreibvorgänge laufen nacheinander durch eine Warteschlange; zwei gleichzeitige Anfragen
  können die Kette nicht gabeln.
- Beim Start wird die ganze Datei nachgerechnet. Stimmt sie nicht, startet der Knoten nicht.
- Prüfen lässt sich die Kette in der Konsole (PROTOKOLL, KETTE PRÜFEN) und unabhängig davon mit
  zwei Programmen ohne Abhängigkeiten, eines in Node und eines in Python
  ([`tools/pruefen/`](../tools/pruefen)); `pnpm ledger:verify <Datei>`.
- Die Prüfsummen tragen keinen Schlüssel. Wer die Datei besitzt, kann sie vollständig neu
  schreiben; bemerkt wird das am Abgleich mit einem Stand außerhalb des Knotens. Dafür halten
  Nachbarknoten den letzten Stand des anderen in ihrem eigenen Protokoll fest (Eintrag
  `ledger.witness`, je Nachbar höchstens alle 15 Minuten), und jeder Bericht nennt den Stand zum
  Zeitpunkt seiner Ausgabe.

Was protokolliert wird, zählt [`COMPLIANCE.md`](COMPLIANCE.md), Zeile 3, auf. Nicht protokolliert
wird der Abruf einzelner Bilder.

## 7. Rollen, Mandate, Sitzungen

Drei Rollen mit festen Rechten (`core/auth.ts`, `PERMISSIONS`):

| Recht | Auswertung (`lage`) | Leitung (`leitung`) | Aufsicht (`aufsicht`) |
| --- | --- | --- | --- |
| Suchen, Bilder sehen, Wachen aufstellen, Meldungen beurteilen | ja | ja | nein |
| Aufnahmen einspielen, Quellen anlegen, Übung steuern | ja | ja | nein |
| Vorgänge anlegen und füllen | ja | ja | nein |
| Vorgänge lesen, Wachen lesen, Verbund einsehen, Kennzahlen | ja | ja | ja, ohne Bilder |
| Vorgänge versiegeln | nein | ja | nein |
| Mandate erteilen und schließen | nein | ja | nein |
| Maskierung aufheben (als zweite Person freigeben) | nein | ja | nein |
| Direktbild anschließen und trennen | nein | ja | nein |
| Ganzes Protokoll lesen, exportieren, Stichprobe ziehen | nur eigene Einträge | ja | ja |
| Kette prüfen | ja | ja | ja |

- **Mandat** (`core/mandates.ts`): Titel, Rechtsgrundlage, Zweck, ausstellende Stelle,
  Gültigkeit, Kennzeichnung als Übung, und ob Personenbeschreibungen zulässig sind. Ohne ein
  gültiges Mandat in der Sitzung gibt es keine Suche, keine neue Wache und keinen neuen Vorgang;
  die Schnittstelle antwortet mit 409.
- **Aufheben der Maskierung**: Die anfragende Person nennt den Grund (mindestens zwölf Zeichen),
  eine zweite Person mit leitender Rolle gibt mit ihren Zugangsdaten frei; niemand gibt sich
  selbst frei. Die Freigabe gilt 15 Minuten für eine Aufnahme und steht im Protokoll.
- **Anmeldung**: Kennwörter als scrypt-Wert mit eigenem Salz, Vergleich in konstanter Zeit.
  Sitzungskennung aus 24 Zufallsbytes in einem Cookie (`HttpOnly`, `SameSite=Lax`, mit
  `SICHT_COOKIE_SECURE=1` auch `Secure`), gültig zwölf Stunden ohne Anfrage und höchstens 24
  Stunden nach der Anmeldung, nur im Arbeitsspeicher. Nach fünf Fehlversuchen in Folge sind
  Kennung und Absenderadresse eine Minute gesperrt; dasselbe gilt für das Kennwort der
  freigebenden Person.
- **Stand**: Es gibt drei Vorführzugänge mit einem gemeinsamen Kennwort, keine
  Benutzerverwaltung, keinen zweiten Faktor, keine Anbindung an einen Verzeichnisdienst.

## 8. Verbund

Jede Behörde betreibt ihren Knoten. Zwei Knoten, die einander kennen, teilen einen Schlüssel
(`peers.json`). Eine Anfrage an den Nachbarn ist ein HTTP-POST mit vier Kopfzeilen
(`intel/federation.ts`):

```
x-sicht-node:       Kennung des fragenden Knotens
x-sicht-timestamp:  Zeit in Millisekunden
x-sicht-nonce:      Einmalwert, 24 Hexzeichen
x-sicht-signature:  HMAC-SHA-256(Schlüssel, timestamp "\n" nonce "\n" Absender "\n"
                    Empfänger "\n" Pfad "\n" Inhalt), hexadezimal
```

Der empfangende Knoten prüft die Signatur über den unveränderten Inhalt in konstanter Zeit, für
sich als Empfänger und für den Pfad, auf dem die Anfrage ankam, und lässt höchstens fünf Minuten
Abweichung der Uhr zu. Jede Signatur gilt einmal: Eine wiederholte, eine an den Absender
zurückgespielte und eine auf einen anderen Pfad umgelenkte Anfrage werden abgewiesen.

| Weg | Inhalt der Frage | Antwort |
| --- | --- | --- |
| `POST /api/federation/hello` | eigener Protokollstand | Name, Protokollstand, Zahl freigegebener Quellen und Bilder |
| `POST /api/federation/search` | Frage in Worten, anfragende Person mit Rolle und Stelle, Mandat mit Rechtsgrundlage und Zweck, eigener Protokollstand | höchstens zwölf maskierte Vorschaubilder (360 Pixel breit) mit Quelle, Ort, Zeit, Sicherheit; die Nummer des Protokolleintrags; eigener Protokollstand |

Der antwortende Knoten wendet seine eigene Anfrageprüfung an, durchsucht nur Quellen, die seine
Leitung für den Verbund freigegeben hat, und schreibt seinen Protokolleintrag
(`federation.inbound` oder `federation.refused`), bevor er antwortet. Personenbeschreibungen
beantwortet er für Nachbarn nicht, gleich was deren Mandat erlaubt: Das ist eine Angabe, die er
nicht prüfen kann. Angaben des Nachbarn übernimmt er nur als Text begrenzter Länge; der genannte
Knoten muss der unterschreibende sein. Je Nachbar beantwortet er höchstens 60 Fragen in zehn
Minuten. Aufnahmen, Verzeichnis und Protokoll verlassen ihn nicht. Beide Seiten halten den
Protokollstand des anderen fest.

Der fragende Knoten übernimmt aus einer Antwort höchstens zwölf Treffer, deren Vorschaubild ein
eingebettetes JPEG ist, prüft jedes Feld und lehnt Antworten über 2 MB und Weiterleitungen ab.

Eingerichtet wird ein Nachbar in der Knotendatei: als Kennung eines Knotens im selben Prozess
(die Vorführung) oder mit Name und Adresse eines Knotens auf einem anderen Rechner
(`intel/peerConfig.ts`, Vorlage `nodes.beispiel.json`). Den Schlüssel eines Paars leiten beide
Seiten aus einem gemeinsamen Geheimnis und ihren beiden Kennungen ab, oder er wird für das Paar
angegeben.

Offen: Es gibt keinen Schlüsselwechsel und keine Zertifikate; der Verbund ist über drei Knoten
in einem Prozess und zwischen zwei getrennt gestarteten Knoten auf einem Rechner erprobt, nicht
über ein echtes Netz. Die Angaben zu Person und Mandat stammen
vom fragenden Knoten; der antwortende vertraut ihnen so weit, wie er dem Schlüssel traut.

## 9. Schnittstelle

Alles, was die Konsole kann, läuft über diese Wege (`routes.ts`). Angemeldet wird mit
`POST /api/login`; jede weitere Anfrage trägt das Sitzungs-Cookie. „+ Mandat“ heißt: zusätzlich
ein gültiges Mandat in der Sitzung.

| Weg | Recht |
| --- | --- |
| `GET /api/public/info` · `POST /api/login` | ohne Anmeldung |
| `POST /api/logout` · `GET /api/session` · `GET /api/state` · `GET /api/events` | angemeldet |
| `GET /api/mandates` · `POST /api/session/mandate` | `mandate.read` |
| `POST /api/mandates` · `POST /api/mandates/:id/close` | `mandate.write` |
| `POST /api/videos` · `DELETE /api/videos/:id` · `POST /api/videos/:id/retry` | `source.write` |
| `POST /api/sources` · `PATCH`/`DELETE /api/sources/:id` | `source.write`; eine Stromadresse zusätzlich `source.live`, die Freigabe für den Verbund `federation.write` |
| `GET /api/videos/:id/scenes` · `…/scenes/:index/frames` · `GET /api/embedding-map` · `GET /api/intel` | `media` |
| `GET /media/:id/frames/:file` | `media` |
| `GET /media/:id/original/:file` | `media` und eine gültige Freigabe für die Aufnahme |
| `GET /media/:id/source` | `media`; ohne Freigabe nur, wenn die Aufnahme vollständig ausgewertet ist und kein Gesicht gefunden wurde |
| `GET /api/search` · `GET /api/explain` | `search` + Mandat |
| `POST /api/unmask` | `media` + Mandat, dazu die Zugangsdaten der freigebenden Person |
| `GET /api/watches` | `watch.read` |
| `POST /api/watches` · `POST /api/watches/preview` | `watch.write` + Mandat |
| `PATCH`/`DELETE /api/watches/:id` · `…/retrain` · `…/reset` | `watch.write` |
| `POST /api/alerts/:id/review` · `POST /api/incidents/:id/status` | `alert.triage` |
| `GET /api/cases` · `GET /api/cases/:id/report` | `case.read`; der Bericht enthält Bilder nur mit `media` |
| `POST /api/cases` | `case.write` + Mandat |
| `POST /api/cases/:id/items` · `DELETE …/items/:itemId` · `POST …/notes` | `case.write` |
| `POST /api/cases/:id/seal` | `case.seal` |
| `GET /api/report/situation` · `GET /api/export/incidents.geojson` · `GET /api/export/incidents/:id/cap` | `search` |
| `GET /api/report/measurement` · `GET /api/metrics` | `metrics.read` |
| `GET /api/ledger` | angemeldet; ohne `ledger.read` nur die eigenen Einträge |
| `POST /api/ledger/verify` | angemeldet |
| `GET /api/ledger/export` · `GET /api/ledger/sample` | `ledger.read` |
| `POST /api/exercise/:action` | `scenario.control` |
| `GET /api/peers` | `federation.read` |
| `POST /api/federation/hello` · `POST /api/federation/search` | Signatur eines bekannten Nachbarknotens |

Der Ereignisstrom `GET /api/events` (Server-Sent Events) meldet der Konsole Zustandsänderungen;
er enthält keine Bilder.

## 10. Vorkehrungen und offene Punkte der Technik

Eine unabhängige Durchsicht des Quelltexts mit 21 Befunden, ihrem Stand und dem, was offen
bleibt, steht in [`SICHERHEIT.md`](SICHERHEIT.md). Hier die Kurzfassung.

Gebaut:

- Der Knoten lauscht in der Voreinstellung nur auf `127.0.0.1`.
- Jede Antwort trägt eine strenge Inhaltsrichtlinie (nur eigene Herkunft, keine eingebetteten
  Rahmen), `X-Content-Type-Options`, `Referrer-Policy: no-referrer`.
- Kennungen von Aufnahmen und Bildnamen werden gegen feste Muster geprüft, bevor ein Pfad
  entsteht; ausgeliefert wird nur aus dem Verzeichnis der Aufnahmen.
- Text aus Anfragen, Mandaten und von Nachbarknoten wird in Berichten als Text ausgegeben, nicht
  als Markup.
- Anfragen an die Schnittstelle, die ein Browser von einer fremden Seite aus auslöst, werden
  abgelehnt, und eine Abfrage lässt sich weder als Seite noch als Bild öffnen: Niemand erzeugt
  über einen untergeschobenen Verweis Abfragen im Namen einer angemeldeten Person
  (`core/origin.ts`).
- Hochgeladene Dateien liest ffmpeg nur als lokale Datei; je Aufnahme entstehen höchstens
  250 000 Bilder.
- Bilder werden vom Browser nicht ohne erneute Prüfung des Rechts aus seinem Zwischenspeicher
  gezeigt.
- Zugangsdaten in der Adresse eines Direktbilds bleiben auf dem Knoten und stehen weder im
  Protokoll noch in der Konsole.

Offen, vor einem Betrieb zu lösen:

- Transportverschlüsselung ist nicht die Voreinstellung. Mit Zertifikat und Schlüssel
  (`SICHT_TLS_CERT`, `SICHT_TLS_KEY`) spricht der Knoten HTTPS, auch gegenüber Nachbarn; geprüft
  mit einem selbst ausgestellten Zertifikat, auch im Verbund zweier getrennter Knoten. Steht
  stattdessen ein TLS-Abschluss davor, muss er die Kopfzeile `Host` unverändert durchreichen, und
  `SICHT_COOKIE_SECURE=1` setzt `Secure` am Sitzungs-Cookie. Offen: Verwaltung und Wechsel der
  Zertifikate, gegenseitige Zertifikate zwischen Knoten.
- Keine Verschlüsselung der Daten auf der Platte, keine Trennung des Protokolls vom Rechner, auf
  dem es entsteht.
- Drei feste Zugänge, kein zweiter Faktor, Sitzungen nur im Arbeitsspeicher.
- Der gemeinsame Schlüssel des Verbunds steht in der Vorführung in `nodes.demo.json` und ist für
  nichts anderes gedacht.
- Kein Abschlussverfahren, das alte Protokollteile löscht und die Kette erhält.
- Kein Näherungsindex; die Suche ist über einige zehn Stunden Material hinaus nicht gemessen.
- Das Abbild für Container ist bis zur letzten Schicht gebaut, aber nicht in einem Container
  gestartet worden.

## 11. Abhängigkeiten und Lizenzen

| Teil | Herkunft | Lizenz |
| --- | --- | --- |
| Bild- und Textkodierer SigLIP 2 base patch32-256 | Google, ONNX-Fassung der onnx-community | Apache 2.0 |
| Gesichtserkenner YuNet (nur zum Maskieren) | OpenCV Zoo | MIT |
| Gefahrenmodell | eigenes lineares Modell, trainiert auf AIDERv2 | Gewichte eigen; Bedingungen des Datensatzes siehe `COMPLIANCE.md` |
| onnxruntime-node, @huggingface/transformers, sharp, Fastify, React | jeweilige Projekte | MIT oder Apache 2.0 |
| ffmpeg | vom Betreiber installiert | LGPL/GPL je nach Bauart |
| Karte | OpenStreetMap-Mitwirkende, selbst gezeichnet | ODbL für die Daten |
| Schrift JetBrains Mono | JetBrains | SIL OFL 1.1 |

Die vollständige Aufstellung mit Fundstellen steht im Abschnitt „Modelle, Daten, Lizenzen“ der
[`README.md`](../README.md) und in [`COMPLIANCE.md`](COMPLIANCE.md).
