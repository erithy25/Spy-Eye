# Sicht — Rechtliche Anforderungen und technische Umsetzung

Stand: 18. November 2026.

Dieses Dokument ordnet rechtliche Anforderungen den Stellen im Quelltext zu, die sie umsetzen,
und benennt, was fehlt. Es ist eine technische Zuordnung und keine Rechtsberatung. Grundlage ist
`docs/research/legal.md`; die dort als nicht verifiziert gekennzeichneten Punkte sind es auch
hier. Randnummern des Urteils des Bundesverfassungsgerichts wurden maschinell ausgelesen und sind
vor jedem Zitat am Original zu prüfen. Vor einem Einsatz mit echten Daten gehört das Dokument in
die Hände einer Rechtsanwältin oder eines Rechtsanwalts und der oder des behördlichen
Datenschutzbeauftragten.

Pfade ohne Präfix liegen unter `apps/server/src`. Messwerte und ihre Bedingungen stehen in
`docs/EVALUATION.md`.

## 1. Acht Anforderungen

| Nr. | Anforderung | Rechtsquelle | Umsetzung heute | Quelltext | Was fehlt | Aufgabe der Behörde |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Keine biometrische Identifizierung, keine Einordnung von Menschen nach geschützten oder körperlichen Merkmalen | KI-Verordnung Art. 5 Abs. 1 Buchst. e, g, h; Erwägungsgründe 16 und 17; BVerfG, 16.02.2023, Rn. 87 | Es gibt keinen Abgleich von Gesichtern, Kennzeichen oder Personen und keine Referenzdatenbank. Prüfregeln lehnen auf Deutsch und Englisch Anfragen ab, die auf Identifizierung, Gesichter, das Wiederfinden oder Verfolgen einer bestimmten Person, auf Kennzeichen (eigene Regel), geschützte Merkmale, Personennamen oder Körpermerkmale zielen; die Ablehnung wird mit der auslösenden Regel protokolliert. Beschreibungen nach Geschlecht, Altersgruppe oder Kleidung sind nur unter einem Mandat möglich, das sie zulässt; neue Mandate sperren sie in der Voreinstellung, und zugelassene Suchen tragen im Protokoll eine Kennzeichnung. Im Verbund prüft der antwortende Knoten erneut nach eigenen Regeln. | `intel/guard.ts`, `routes.ts`, `core/mandates.ts`, `test/guard.test.ts` (8 Tests) | Die Regeln arbeiten mit Wortlisten und fangen nicht jede Umschreibung ab; „kein Wiederfinden, kein Verfolgen“ ist damit eine Regel mit Protokoll, keine technische Unmöglichkeit. Unter einem Mandat, das Personenbeschreibungen zulässt, wirkt die Suche über alle Quellen; der Suchraum eines Mandats ist technisch nicht begrenzt. Die beiden mitgelieferten Mandate (Erprobung, Übung) lassen Personenbeschreibungen zu. Der antwortende Knoten kennt diese Einstellung des anfragenden Mandats nicht und lässt Personenbeschreibungen in Fremdanfragen zu. Bei Wachen steht der Wortlaut im Protokoll, eine eigene Kennzeichnung fehlt. | Dienstanweisung, welche Personenbeschreibungen zu welchem Zweck zulässig sind; Mandate entsprechend einstellen |
| 2 | Jede Auswertung braucht einen Anlass und einen Suchbegriff; keine offene Mustersuche, keine Risikowerte für Personen, keine selbsttätigen Entscheidungen | BVerfG Rn. 93–94, 98, 107–109; KI-Verordnung Art. 5 Abs. 1 Buchst. d; Richtlinie (EU) 2016/680 Art. 11; DSGVO Art. 5 Abs. 1 Buchst. b | Suche, Wachen, Vorgänge und die Aufhebung der Maskierung setzen ein gültiges Mandat voraus (Bezeichnung, Rechtsgrundlage, Zweck, ausstellende Person, Gültigkeit). Suche und Wachen arbeiten mit einer festen Beschreibung in Worten. Das trainierte Gefahrenmodell löst in der Voreinstellung keine Meldungen aus; es steht als Zweitmeinung neben Meldungen aus Luftbildquellen. Das System vergibt keine Werte für Personen. Meldungen sind Vorschläge, die ein Mensch bestätigt oder verwirft; die CAP-Ausgabe trägt den Hinweis, dass der Stab bewerten muss. | `core/mandates.ts`, `routes.ts` (`needMandate`), `intel/watches.ts` (`secondOpinion`) | Eine Wache endet nicht mit ihrem Mandat und hat kein eigenes Ablaufdatum. Eine Wache auf eine Klasse des Gefahrenmodells lässt sich weiterhin von Hand aufstellen, obwohl das Modell auf fremdem Material irrt. Ein Mandat begrenzt weder Quellen noch Gebiet. Eine Wache prüft fortlaufend alles eingespielte Material; ob das noch als anlassbezogen gilt, ist die zentrale offene Rechtsfrage (Abschnitt 4). | Rechtsgrundlage je Mandat benennen; festlegen, wer Mandate ausstellt und schließt |
| 3 | Jede Abfrage wird mit Grund, Zeit, Person und Empfänger protokolliert; das Protokoll zeigt, was gefunden wurde | Richtlinie (EU) 2016/680 Art. 25; § 76 BDSG; KI-Verordnung Art. 12 und Art. 26 Abs. 6 (mindestens sechs Monate); Stellungnahme der BfDI vom 02.06.2026, S. 12 | Protokoll als Kette: Jeder Eintrag enthält die SHA-256-Prüfsumme seines Vorgängers. Erfasst werden Zeit, Person, Rolle, Mandat, Handlung, Suchtext, Trefferzahl, die Kennungen der ersten acht Treffer, beteiligte Verbundknoten mit Quittungsnummer, abgelehnte Anfragen mit der auslösenden Regel, die Kennzeichnung von Personenbeschreibungen, Urteile über Meldungen und jedes Nachschärfen einer Wache, Aufhebungen der Maskierung, Berichte, Ausgaben und Löschungen. Der antwortende Knoten protokolliert Fremdanfragen mit anfragender Person und Mandat. Die Kette lässt sich jederzeit prüfen; Knoten bezeugen gegenseitig ihren Stand, festgehalten je Partner höchstens alle 15 Minuten. Eine Antwort auf eine Suche wird erst ausgeliefert, nachdem ihr Eintrag geschrieben ist. | `core/ledger.ts`, `node.ts` (`record`), `intel/federation.ts`, `routes.ts`, `test/ledger.test.ts` | Der Abruf einzelner Bilder wird nicht protokolliert. Die Modellversion steht nicht im Eintrag. Es gibt keine Löschfrist für das Protokoll; § 76 Abs. 4 BDSG verlangt im Polizeibereich die Löschung zum Ende des Folgejahres, und eine Kette verträgt Löschung nur mit einem Abschlussverfahren, das fehlt. Keine qualifizierten Zeitstempel. Das Protokoll liegt als unverschlüsselte Datei beim Betreiber. | Aufbewahrungsfrist des Protokolls festlegen; Zugriff auf die Protokolldatei regeln |
| 4 | Zugriff nur für wenige geschulte Personen; getrennte Rollen; unabhängige Kontrolle auch durch Stichproben | BVerfG Rn. 109 und 117; § 64 BDSG; § 76 Abs. 3 BDSG; Richtlinie (EU) 2016/680 Art. 25 Abs. 3 | Drei Rollen. Auswertung: Suche, Wachen, Meldungen, Vorgänge. Leitung: zusätzlich Mandate, Freigaben, Verbund, vollständiges Protokoll. Aufsicht: Protokoll, Prüfung, Stichprobe, Mandate, Kennzahlen, aber weder Bilder noch Suche. Die Auswertung sieht nur die eigenen Protokolleinträge. Die Aufsicht zieht Zufallsstichproben über Abfragen; auch das wird protokolliert. Unmaskierte Bilder gibt es nur mit Freigabe einer zweiten Person. | `core/auth.ts` (`PERMISSIONS`), `routes.ts` (`/api/ledger/sample`, `/api/unmask`) | Keine Benutzerverwaltung: Es gibt drei Vorführkonten mit gemeinsamem Kennwort. Kein zweiter Anmeldefaktor, keine Anbindung an einen Verzeichnisdienst, Sitzungen nur im Arbeitsspeicher. Keine eigene Verwalterrolle ohne Abfragerecht. Die Freigabe erfolgt durch Eingabe der Zugangsdaten der zweiten Person in der Sitzung der ersten. | Berechtigte namentlich benennen; Schulung; Rhythmus der Stichproben festlegen |
| 5 | Kein zentraler Datenbestand; Zwecke und Herkunft der Daten bleiben getrennt | Stellungnahme der BfDI vom 02.06.2026, S. 14–18; BVerfG Leitsatz 2, Rn. 78 und 118 | Jeder Knoten hält eigene Aufnahmen, einen eigenen Index, eigene Nutzer und ein eigenes Protokoll. Im Verbund reist die Frage mit Mandat und anfragender Person. Zurück kommen höchstens zwölf maskierte Vorschaubilder von 360 Pixeln Breite mit Quelle, Zeit und Ort, keine Aufnahme und kein Index; der anfragende Server speichert sie nicht. Eine Quelle ist für Partner nur durchsuchbar, wenn sie einzeln freigegeben wurde; die Voreinstellung ist gesperrt. Anfragen sind signiert und nur fünf Minuten gültig. | `intel/federation.ts`, `routes.ts` (`/api/federation/search`), `search.ts` (`sharedOnly`), `intel/sources.ts` | Auch ein maskiertes Vorschaubild ist ein personenbezogenes Datum; seine Übermittlung braucht eine Rechtsgrundlage. Die Verbindung zwischen Knoten ist nicht verschlüsselt. Quellen tragen keine Kennzeichnung nach Rechtsgrundlage und Zweck, nur Art, Eigentümer und Freigabe. Gezeigt ist der Verbund mit drei Knoten auf einem Rechner, nicht über ein Netz. | Vereinbarung der beteiligten Behörden über den Verbund; Freigabe je Quelle entscheiden |
| 6 | Kein Weiterlernen im Betrieb; die Software ist dokumentiert und überprüfbar | BVerfG Rn. 100, 102 und 121; Art. 61a Abs. 5 des bayerischen Polizeiaufgabengesetzes; AG Reutlingen, 11.02.2026, 5 Gs 19/26 (zitiert nach der BfDI); KI-Verordnung Art. 9 und 15 | Die Modellgewichte sind unveränderlich. Rückmeldungen zu Meldungen werden nur gesammelt. Eine Wache ändert ihr Verhalten erst, wenn jemand sie ausdrücklich nachschärft; das erzeugt eine neue Version, wird protokolliert und lässt sich zurücksetzen. In der Übung gezeigt: Nach einem verworfenen und einem bestätigten Urteil bleibt die Fehlmeldung im Folgelauf aus. Zum Gefahrenmodell gehört je Bildkodierer eine Gewichtsdatei mit Datenblatt (Trainingsdaten, Lizenz, Güte je Klasse, Verwechslungen); es löst in der Voreinstellung keine Meldungen aus. Ein Selbsttest prüft beim Start, ob die Rechenumgebung dieselben Ergebnisse liefert wie die Vergleichsrechnung. | `intel/watches.ts` (`review`, `retrainNow`, `resetLearning`, `secondOpinion`), `ml/head.ts`, `runtime.ts`, `apps/server/assets/hazard-head.*.json`, `ml/model.ts`, `scripts/selftest.ts` | Modell- und Softwareversion je Protokolleintrag. Stückliste der Bestandteile und nachvollziehbarer Bauvorgang. Fehlerraten an Einsatzmaterial. Ein Verfahren, mit dem eine Behörde neue Modellstände an eigenem Material abnimmt; das Gefahrenmodell irrt schon auf dem Übungsmaterial. Über die Offenlegung des Quelltexts ist nicht entschieden. Das Nachschärfen verwendet Bilder der Behörde als Lernbeispiele; das ist eine eigene Rechtsfrage. | Festlegen, wer nachschärfen darf; neue Modellstände abnehmen |
| 7 | Anbieter im Europäischen Wirtschaftsraum; kein Zugriff aus Drittstaaten; Wechsel bleibt möglich | Entschließung der DSK vom 17.09.2025, Nr. 3; BT-Drs. 21/7079; 18 U.S.C. § 2713; BVerfG Rn. 100 | Der Knoten läuft auf Rechnern der Behörde. Nach dem einmaligen Laden der Modellgewichte arbeitet er ohne Netzverbindung (`SICHT_OFFLINE`). Der Quelltext enthält keine Rückmeldung an den Anbieter; nach außen gehen nur Verbundanfragen an eingetragene Partner. Ausgaben in offenen Formaten: GeoJSON, CAP 1.2, Protokoll als JSON-Zeilen, Berichte als HTML; Aufnahmen bleiben in ihrem Ursprungsformat. | `config.ts`, `ml/model.ts`, `ml/faces.ts`, `routes.ts` | Eine Gesellschaft als Anbieter besteht noch nicht. Der Bildkodierer stammt von Google und wird von einem Dienst aus den USA geladen: einmalig und ohne Abfluss von Daten. Seine Lizenz (Apache 2.0) erlaubt die gewerbliche Nutzung; was an der Lizenzkette noch zu prüfen ist, steht in Abschnitt 6. Das Format des Index ist nicht dokumentiert. Geladene Gewichte werden nicht gegen Prüfsummen geprüft. | Gewichte auf eigenem Weg beziehen und prüfen; Netz trennen |
| 8 | Datensparsamkeit, feste Löschfristen, Folgenabschätzung vor dem Einsatz | DSGVO Art. 5 Abs. 1 Buchst. c und e, Art. 25, Art. 35 Abs. 3 Buchst. c; § 60 Abs. 2 LBKG Rheinland-Pfalz (zwei Monate); § 46 BHKG Nordrhein-Westfalen; § 71 BDSG; Orientierungshilfe des TLfDI, S. 5 | Gesichter werden beim Einspielen erkannt und in allen angezeigten Bildern verpixelt. Das Original liegt getrennt und ist nur mit begründeter Freigabe einer zweiten Person für 15 Minuten abrufbar; dasselbe gilt für die Aufnahme, sobald sie maskierte Gesichter enthält. Aufnahmen werden nach einer Frist gelöscht (Voreinstellung 60 Tage), samt Bildern und Index; die Löschung wird protokolliert. Aufnahmen, die in einem Vorgang liegen, bleiben erhalten. | `ml/faces.ts`, `pipeline.ts` (`maskFaces`), `node.ts` (`enforceRetention`), `config.ts` (`SICHT_RETENTION_DAYS`), `routes.ts` (`/media/…`) | Siehe Abschnitt 2. Außerdem: eine Frist für alle Quellen statt je Quelle und Landesrecht; keine Betriebsart für Übungen mit echten Flügen, die Aufzeichnung unterbindet oder vollständig verpixelt (der vorhandene Übungsbetrieb spielt Archivmaterial ab); keine Vorlagen für Folgenabschätzung und Verzeichnis der Verarbeitungstätigkeiten. | Folgenabschätzung, Verzeichnis, Löschkonzept, Hinweise an Betroffene |

Die ausführliche Liste mit 26 Einzelanforderungen steht in `docs/research/legal.md`, Abschnitt 8.

## 2. Was die Maskierung leistet und was nicht

- Maskierte Bilder bleiben personenbezogene Daten. Der Thüringer Landesbeauftragte zählt neben
  dem Gesicht auch „Kleidung, Gangbild, Figur, Haarfarbe, mitgeführte Gegenstände, aber auch
  Fahrzeugkennzeichen, Gebäude, Anschriften“ dazu
  ([Orientierungshilfe Flugdrohnen, S. 5](https://www.tlfdi.de/fileadmin/tlfdi/datenschutz/Kommunales/2103_Orientierungshilfe_Drohnen.pdf)).
  Die Maskierung ist Datensparsamkeit in der Anzeige, keine Anonymisierung.
- Das unmaskierte Original bleibt gespeichert, als Einzelbild und als Aufnahme. Wer Zugriff auf
  das Dateisystem des Knotens hat, umgeht die Freigabe.
- Der Erkenner (YuNet) arbeitet mit einer festen Schwelle von 0,55. Kleine, abgewandte oder
  verdeckte Gesichter übersieht er; die Quote ist nicht gemessen. In den 31 Aufnahmen der Übung
  wurden 37 Gesichter maskiert; wie viele übersehen wurden, ist nicht gezählt.
- Der Erkenner findet Gesichter, um sie zu verpixeln. Er vergleicht sie nicht; gespeichert wird
  je Bild nur die Lage der verpixelten Flächen, kein Merkmal eines Gesichts.
- Kennzeichen werden nicht maskiert. Sie werden auch nicht gelesen; Anfragen nach Kennzeichen
  lehnt die Anfrageprüfung ab.
- Lässt sich der Erkenner nicht laden, verarbeitet der Knoten weiter und zeigt Bilder
  unmaskiert. Er meldet das beim Start und in den Kennzahlen, hält aber nicht an
  (`pipeline.ts`, `maskFaces`). Für den Einsatz mit echten Daten muss das umgekehrt sein.

## 3. KI-Verordnung: Einordnung

Rechtsstand nach `docs/research/legal.md`: Verordnung (EU) 2024/1689 in der Fassung der
Verordnung (EU) 2026/1744. **Die Änderungen durch die Verordnung (EU) 2026/1744 und alle daraus
folgenden Fristen sind vor jedem Zitat am Amtsblatt zu prüfen.**

| Frage | Einordnung | Vorbehalt |
| --- | --- | --- |
| Verbotene Praktiken (Art. 5) | Buchst. e und h greifen nicht, weil es keinen Abgleich mit einer Referenzdatenbank gibt. Buchst. d greift nicht, weil keine Personen bewertet werden. Buchst. g wird durch die Prüfregeln ausgeschlossen. | Die Fernidentifizierung ist nach ihrer Funktion bestimmt, unabhängig von der Technik (Erwägungsgrund 17). Jeder künftige Abgleich körperlicher Merkmale wäre neu zu bewerten. Der Ausschluss nach Buchst. g ist ein Filter, keine Eigenschaft der Bauweise. |
| Anhang III Nr. 1, Biometrie | Nicht einschlägig, solange Anforderung 1 aus Abschnitt 1 eingehalten ist: keine Fernidentifizierung, keine Einordnung nach sensiblen Merkmalen, keine Emotionserkennung. | Anfragen, die Menschen nach Geschlecht oder Alter beschreiben, liegen nahe an der biometrischen Kategorisierung (Erwägungsgrund 16). Sie und Beschreibungen nach Kleidung verlangen deshalb ein Mandat, das sie zulässt. |
| Anhang III Nr. 5 Buchst. d, Notrufe und Entsendung von Einsatzkräften | Einschlägig, wenn die Meldungen bestimmen, welche Einsatzkräfte wohin und in welcher Reihenfolge entsandt werden. Sicht meldet an den Stab und entsendet nichts. | Wo die Grenze zwischen Lageinformation und Priorisierung liegt, ist ungeklärt. Die Leitlinien der Kommission zur Einstufung lagen im Mai 2026 als Entwurf vor; ihr Endstand ist nicht geprüft. |
| Anhang III Nr. 2, kritische Infrastruktur | Einschlägig, wenn Sicht als Sicherheitsbauteil im Betrieb von Verkehr, Wasser, Gas, Wärme oder Strom dient. Betrifft den Nachbarmarkt der Betreiber, nicht den Bevölkerungsschutz. | — |
| Anhang III Nr. 6, Strafverfolgung | Einschlägig bei Verkauf an die Polizei. Dieser Markt ist ausgeschlossen (`docs/STRATEGY.md`, Abschnitt 10). | Vorgänge sichern Bilder mit Prüfsummen. Sie bewerten keine Beweise; Nr. 6 Buchst. c ist dennoch im Blick zu behalten, sobald eine Staatsanwaltschaft die Berichte nutzt. |
| Ausnahme nach Art. 6 Abs. 3 | Denkbar für die reine Suche als vorbereitende Aufgabe. Sie verlangt eine dokumentierte Bewertung und eine Registrierung. | Gilt nie bei Profiling natürlicher Personen. |
| Fristen | Verbote seit 2. Februar 2025. Pflichten für Hochrisiko-Systeme nach Anhang III ab 2. Dezember 2027. Systeme für Behörden, die vorher in Verkehr gebracht wurden: bis 2. August 2030. | Vor Zitat prüfen. |
| Ausnahmen des Art. 2 | Weder die Ausnahme für nationale Sicherheit (Abs. 3) noch offene Modellgewichte (Abs. 12) befreien von Hochrisiko-Pflichten. | Pflichten für Modelle mit allgemeinem Verwendungszweck (Kapitel V) wurden für das eingesetzte Bildmodell nicht untersucht. |

Folgen einer Einstufung als Hochrisiko-System:

- Für den Anbieter: Risikomanagement über die Lebensdauer (Art. 9), Anforderungen an Testdaten
  (Art. 10), technische Unterlagen, selbsttätige Aufzeichnung (Art. 12), menschliche Aufsicht
  (Art. 14), erklärte Genauigkeit und Robustheit (Art. 15), Qualitätsmanagement,
  Konformitätsbewertung, Registrierung (Art. 16, 49).
- Für die Behörde: Betrieb nach Gebrauchsanweisung, geschulte Aufsichtspersonen, Aufbewahrung der
  Aufzeichnungen für mindestens sechs Monate, Registrierung der Nutzung (Art. 26),
  Grundrechte-Folgenabschätzung vor dem ersten Einsatz (Art. 27).

Stand von Sicht dazu: Aufzeichnung und menschliche Aufsicht sind angelegt (Protokoll;
Bestätigen, Verwerfen und Abschalten einer Wache). Ein Datenblatt gibt es für das Gefahrenmodell,
einen Messbericht aus einer Übung mit Archivmaterial in `docs/EVALUATION.md`. Es fehlen
Risikomanagement, Qualitätsmanagement, Genauigkeitsangaben an Daten aus dem Einsatz und
Prüfungen der Robustheit; dass das Gefahrenmodell schon auf dem Übungsmaterial irrt, zeigt, wie
wenig ein Benchmarkwert darüber sagt.

Empfehlung: eine Zweckbestimmung schreiben, die Einsatzpriorisierung und Strafverfolgung
ausschließt, und die technischen Unterlagen trotzdem so führen, als gälte die Einstufung.

## 4. Die offene Flanke: Rechtsgrundlage der Auswertung

| Kunde | Maßgebliches Recht | Lage |
| --- | --- | --- |
| Katastrophenschutzbehörden, Feuerwehren, Hilfsorganisationen | DSGVO und Landesrecht | Rheinland-Pfalz regelt in § 60 LBKG den Drohneneinsatz, die Aufzeichnung und die Löschung nach spätestens zwei Monaten ([LBKG, Fassung vom 17.06.2025](https://lfbk.rlp.de/fileadmin/lfbk/Service/Dokumente/LBKG_Ausgabe_17Juni2025.pdf)). Zur automatisierten Auswertung der Aufnahmen sagt die Vorschrift nichts. Nordrhein-Westfalen verweist auf § 46 BHKG und sieht keinen Gesetzgebungsbedarf ([Landtag NRW, Drs. 18/10805](https://www.landtag.nrw.de/portal/WWW/dokumentenarchiv/Dokument/MMD18-10805.pdf)). In Thüringen kommen die Aufgabennormen mit Art. 6 Abs. 1 Buchst. e DSGVO in Betracht, bei Flutlagen auch Buchst. d. Die übrigen Länder wurden nicht untersucht. |
| Polizei | Richtlinie (EU) 2016/680, BDSG Teil 3, Polizeigesetze | Kein Zielmarkt. Die Maßstäbe des Bundesverfassungsgerichts und der BfDI stammen aber aus diesem Bereich und werden auf jede Bildauswertung des Staates angelegt werden. |
| Private Betreiber kritischer Anlagen | DSGVO, Art. 6 Abs. 1 Buchst. f | Nicht untersucht. |

Drei Punkte, die eine Behörde vor dem Einsatz klären muss:

1. Trägt die Aufgabennorm des Landes neben der Aufzeichnung auch die automatisierte Auswertung?
   Die Aussage der BfDI, die massenhafte KI-Analyse von Videodateien sei kein einfacher
   Abgleich, betrifft Polizeigesetze; ihre Übertragung auf den Bevölkerungsschutz ist eine
   Lesart dieser Recherche, keine Aussage der Quelle.
2. Übungen: Nach § 60 Abs. 2 LBKG dürfen Wohngrundstücke und öffentliche Flächen in Übungen nur
   mit Einwilligung überflogen werden, oder wenn es unvermeidbar ist und Vorkehrungen getroffen
   sind, insbesondere ohne Aufzeichnung. Eine Erprobung gehört deshalb auf abgesperrtes Gelände.
3. Wachen: Eine stehende Suche über laufendes Material steht der anlasslosen Auswertung näher
   als eine einzelne Suche. Wachen sollten an ein laufendes Einsatzmandat, ein Gebiet und ein
   Ablaufdatum gebunden sein. Die Bindung an ein Mandat ist angelegt, endet aber nicht mit ihm;
   Gebiet und Ablaufdatum fehlen.

## 5. Was eine Datenschutz-Folgenabschätzung von uns braucht

| Unterlage | Stand |
| --- | --- |
| Beschreibung des Systems und der Datenflüsse: Einspielen, Einzelbilder, Maskierung, Vektoren, Suche, Wachen, Verbund | Liegt als Quelltext, im README (Abschnitt „Wie es arbeitet“) und in `docs/STRATEGY.md`, Abschnitt 3, vor; ein eigenes Dokument für Behörden fehlt |
| Speicherorte und Formate: Aufnahme, Einzelbilder maskiert und im Original, Index, Protokoll, Vorgänge | Im Quelltext (`store.ts`); Beschreibung fehlt |
| Herkunft, Lizenz und Trainingsdaten der Modelle | Bildkodierer SigLIP 2: Apache 2.0 (Abschnitt 6); Angaben des Herstellers zu seinen Trainingsdaten wurden nicht ausgewertet. Gefahrenmodell: Datenblatt vorhanden (AIDERv2, CC BY 4.0). Gesichtserkenner YuNet: MIT-Lizenz |
| Fehlerraten: übersehene Ereignisse, Fehlmeldungen, übersehene Gesichter | Übung mit Archivmaterial: 13 von 13 Ereignissen gemeldet, 1 Fehlmeldung unter 15 Meldungen; die Wachen wurden an diesem Material formuliert (`docs/EVALUATION.md`). Gefahrenmodell: 99,1 % an einem öffentlichen Datensatz, auf dem Übungsmaterial fehlerhaft. Übersehene Gesichter: nicht gemessen. Nichts davon an Einsatzmaterial |
| Aufbau des Protokolls und Verfahren seiner Prüfung | Vorhanden (`core/ledger.ts`); Löschkonzept fehlt |
| Rollen und Rechte | Vorhanden (`core/auth.ts`); Benutzerverwaltung fehlt |
| Löschfristen und ihr technischer Vollzug | Vorhanden für Aufnahmen; für Protokoll und Vorgänge fehlt eine Regel |
| Ablauf des Verbunds: was übermittelt wird, was der Partner sieht, was protokolliert wird | Vorhanden (`intel/federation.ts`); Verschlüsselung fehlt |
| Technische und organisatorische Maßnahmen: Verschlüsselung, Anmeldung, Härtung, Netztrennung | Fehlen weitgehend; kein Grundschutz-Profil |
| Grenzen der Maskierung | Abschnitt 2 dieses Dokuments |
| Liste der Restrisiken mit Gegenmaßnahmen | Fehlt als eigenes Dokument; Ansätze in `docs/STRATEGY.md`, Abschnitt 9 |

Die Folgenabschätzung selbst, die Rechtsgrundlage, das Löschkonzept, die Information der
Betroffenen (etwa Hinweise an Fahrzeugen im Einsatzraum) und die Beteiligung der oder des
Datenschutzbeauftragten sind Aufgaben der Behörde. Sicht liefert dazu Unterlagen, keine
Entscheidung.

## 6. Lizenzen der Modelle

Stand der Quellen: abgerufen am 18. November 2026. Die Zuordnung ersetzt keine rechtliche Prüfung
der Lizenzkette.

| Bestandteil | Lizenz | Quelle | Folge |
| --- | --- | --- | --- |
| SigLIP 2 base patch32-256, voreingestellter Bildkodierer | Apache 2.0 | [Modellseite von Google](https://huggingface.co/google/siglip2-base-patch32-256) | Gewerblich verwendbar. Gemessen und kalibriert (`docs/EVALUATION.md`); versteht deutsche und englische Anfragen |
| ONNX-Fassung des Kodierers, wie sie geladen wird | Keine eigene Lizenzangabe; die Seite verweist auf das Ursprungsmodell | [onnx-community/siglip2-base-patch32-256-ONNX](https://huggingface.co/onnx-community/siglip2-base-patch32-256-ONNX) | Zu prüfen, ob für die Umwandlung zusätzliche Bedingungen gelten. Ausweg: die Umwandlung selbst vornehmen |
| MobileCLIP-S2 und MobileCLIP-S0, wählbar, nicht voreingestellt | Forschungslizenz von Apple: Nutzung „exclusively for Research Purposes“; ausgeschlossen sind „commercial exploitation, product development or use in any commercial product or service“ | [Lizenz bei den Gewichten](https://huggingface.co/apple/MobileCLIP-S2/blob/main/LICENSE); [Quelltextarchiv, Abschnitt License](https://github.com/apple/ml-mobileclip) | Nach dem Wortlaut nicht für ein Produkt verwendbar. In Auslieferungen und in Vorführungen gegenüber Dritten nicht einsetzen. Bis zum 18. November 2026 war MobileCLIP-S2 voreingestellt |
| SigLIP base patch16-224 | Apache 2.0 | [Modellseite](https://huggingface.co/google/siglip-base-patch16-224) | Verwendbar; im Quelltext wählbar, nicht vermessen |
| CLIP ViT-B/32 | MIT | [Modellseite der ONNX-Fassung](https://huggingface.co/Xenova/clip-vit-base-patch32) | Verwendbar; im Quelltext wählbar. Geschwindigkeit gemessen (26 ms je Bild); die Wachen der Übung sind nicht darauf abgestimmt |
| Gefahrenmodell von Sicht | Eigene Gewichte, je Bildkodierer eine Datei; Trainingsdaten AIDERv2 unter CC BY 4.0 | `apps/server/assets/hazard-head.*.json`; [Datensatz bei Zenodo](https://zenodo.org/records/10891054) | Ist an den Bildkodierer gebunden und wird nach einem Wechsel neu trainiert (für SigLIP 2 geschehen). CC BY 4.0 verlangt die Namensnennung; zu prüfen, ob sie in Produkt und Unterlagen ausreicht |
| Gesichtserkenner YuNet | MIT | [OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) | Verwendbar; Urheber- und Lizenzvermerk sind mitzuliefern |

## 7. Vor Verwendung zu prüfen

- Alle mit „nicht verifiziert“ gekennzeichneten Stellen in `docs/research/legal.md`, insbesondere
  der Wortlaut des § 25a HSOG, die neue Befugnis in Nordrhein-Westfalen und der Stand der
  Bundesgesetzentwürfe 21/6131, 21/6132 und 21/6806.
- Die Verordnung (EU) 2026/1744 und die Leitlinien der Kommission zur Einstufung von
  Hochrisiko-Systemen.
- Die Rechtsgrundlagen der übrigen Länder für Bildaufzeichnungen im Bevölkerungsschutz und jede
  ausdrückliche Regel zur automatisierten Auswertung.
- Regeln für Verkehrs- und Infrastrukturkameras als Quellen.
- Der Wortlaut der EVB-IT und die Frage, welcher Vertragstyp passt.
- Die Lizenzkette der Modelle: Bedingungen der ONNX-Fassung des Bildkodierers, Lizenzvermerk für
  YuNet (MIT), Namensnennung für AIDERv2 (CC BY 4.0).
