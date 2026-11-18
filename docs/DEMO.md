# Vorführung: Ablauf, Vorbereitung, Rückfallebenen

Dauer der Vorführung am System: 12 bis 15 Minuten. Die Klickfolge mit den Sätzen dazu steht auf
einer Seite in `deliverables/Sicht-Spickkarte.pdf`. Alles läuft auf einem Rechner, ohne
Netzverbindung. Drei Knoten (Koblenz, Trier, Mainz) laufen in einem Prozess und sprechen nur über
das Verbundprotokoll miteinander, so wie Knoten auf drei Rechnern es täten.

## Am Vorabend (einmalig, mit Netz)

Unter Windows genügt ein Befehl; er prüft die Voraussetzungen, richtet ein, lädt das Material,
wertet es aus, prüft die drei Knoten und hört dort auf:

```bash
.\vorfuehrung.cmd -NurPruefen
```

Dieselben Schritte einzeln, auf jedem Betriebssystem:

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

`exercise:fetch` lädt 45 frei lizenzierte Aufnahmen (rund 300 MB). `demo:prepare` lädt beim ersten
Mal die Modelle (rund 950 MB) und wertet das gesamte Material aus; auf einem Rechner mit vier
Kernen ohne Grafikkarte dauert das etwa zehn Minuten. Der Befehl endet mit „Vorbereitet“. Danach
wird kein Netz mehr gebraucht.

`demo:check` fragt die drei Knoten, was in der Vorführung gefragt wird: Anmeldung, Mandat, eine
deutsche Suche, die Nachbarn im Verbund, eine Ablehnung, die Protokollkette. Laufen die Knoten
nicht, startet der Befehl sie für die Prüfung und beendet sie wieder. Jede Zeile endet mit OK oder
FEHLT und nennt bei FEHLT den nächsten Schritt; am Ende steht „Ergebnis: bereit“. Die Prüfung
meldet sich als `leitung` an und hinterlässt deshalb Einträge in den Protokollen, wie jede andere
Nutzung auch; `pnpm demo:reset` nimmt sie wieder zurück. Derselbe Ablauf wird auf einem
Windows-Rechner mit PowerShell durchgespielt (`.github/workflows/windows.yml`).

## Am Tag selbst

Unter Windows stellt derselbe Befehl ohne Zusatz den vorbereiteten Ausgangsstand wieder her,
prüft, startet die drei Knoten und öffnet den Browser:

```bash
.\vorfuehrung.cmd
```

Oder von Hand:

```bash
pnpm demo
```

| Knoten | Adresse | Zweck in der Vorführung |
| --- | --- | --- |
| Lagezentrum Koblenz | http://127.0.0.1:8787 | Hauptbildschirm |
| Lagezentrum Trier | http://127.0.0.1:8788 | zweites Fenster: zeigt die Fremdanfrage in seinem Protokoll |
| Lagezentrum Mainz | http://127.0.0.1:8789 | nur als Verbundpartner |

Zugänge auf allen Knoten, Passwort `lagebild`:

| Kennung | Rolle | darf |
| --- | --- | --- |
| `lage` | Auswertung | suchen, Wachen aufstellen, Meldungen sichten, Vorgänge führen |
| `leitung` | Leitung | zusätzlich Mandate erteilen, Vorgänge versiegeln, Maskierung freigeben, Protokoll einsehen |
| `aufsicht` | Aufsicht | Protokoll prüfen, Stichproben ziehen, Messwerte einsehen; kein Bildmaterial |

Vor Beginn prüfen (zwei Minuten):

1. Browser im Vollbild, Zoom 100 %, dunkles Fenster ohne Lesezeichenleiste.
2. In Koblenz als `leitung` anmelden, Mandat „Übung RHEIN-MOSEL“ wählen. Unten steht
   „31 Aufnahmen bereit“. Steht dort „Material wird ausgewertet“, ist `demo:prepare` nicht
   durchgelaufen: abwarten.
3. Zweites Browserfenster: Trier, als `leitung` angemeldet, Reiter PROTOKOLL.
4. Nach einem Probelauf den Ausgangsstand wiederherstellen: die Knoten beenden (Strg+C),
   `pnpm demo:reset`, dann `pnpm demo` (unter Windows erledigt `.\vorfuehrung.cmd` beides). Das
   dauert eine Sekunde und nimmt alles zurück, was die
   Probe hinterlassen hat: Meldungen, Urteile, die nachgeschärfte Wache, Vorgänge und
   Protokolleinträge. Das Material wird nicht neu ausgewertet. Ohne Zurücksetzen träte die
   Fehlmeldung in der Vorführung nicht mehr auf, weil die Wache schon in Version 2 arbeitet.

## Ablauf

Die Übungsuhr läuft mit vierfacher Geschwindigkeit: zehn Minuten Übungszeit in zweieinhalb Minuten.
Wer mehr Zeit zum Erklären braucht, drückt PAUSE; die Uhr und alle Quellen halten an.

| Min. | Handlung | Kernaussage |
| --- | --- | --- |
| 0:00 | Anmeldemaske zeigen. Als `leitung` anmelden. | „Jede Anmeldung steht im Protokoll. Unten links läuft die Prüfsumme mit.“ |
| 0:30 | Mandatswahl: „Übung RHEIN-MOSEL“. | „Ohne Zweck keine Auswertung. Das Mandat nennt Rechtsgrundlage und Zweck; jede Abfrage wird ihm zugeordnet.“ |
| 1:00 | LAGE. Karte zeigen, mit dem Mauszeiger über die Stadt fahren. | „Die Karte ist selbst gezeichnet, aus OpenStreetMap-Daten, ohne Kartendienst. Unten links die UTMREF-Koordinate, wie auf jeder Einsatzkarte.“ |
| 1:30 | „Übung starten“ bei 4×. | „Elf Quellen: vier Drohnen, drei Festkameras, drei Erkundungstrupps, ein Hinweisportal. Das Material ist frei lizenziertes Archivmaterial und zeigt nicht Koblenz.“ |
| 2:00 | Bei T+01:22 erscheint „Überflutung“ an UAS 1. Auf die Meldung klicken. | „Niemand hat dieses Bild angesehen. Die Wache ‚Überflutung‘ ist ein Satz in Worten, kein trainiertes Modell. Zwei Sekunden nach dem ersten Bild steht die Meldung auf der Karte.“ |
| 2:30 | Im Blatt: Fokus zeigt, worauf die Wache reagiert. BESTÄTIGEN. | „Das Urteil wird protokolliert. Es verändert die Wache nicht von selbst.“ |
| 3:00 | Zurück zur Karte. Meldungen laufen ein (Sturzflut, Baum auf Fahrzeug, Unfall). Rechts unten bilden sich Lagen. | „Meldungen gleicher Art am selben Ort werden zu einer Lage. Zwei Quellen für dieselbe Überflutung: Das steht da als ‚2 Quellen‘.“ |
| 4:00 | Bei T+04:24 meldet „Umgestürzter Lastkraftwagen“ an Erkunder 1. Bild öffnen: Es ist die abgerutschte Fahrbahn. VERWERFEN. | „Eine Fehlmeldung. Wir zeigen sie, statt sie zu verstecken.“ |
| 4:30 | Bei T+05:22 echte Meldung „Umgestürzter Lastkraftwagen“ an Erkunder 2: BESTÄTIGEN. Dann WACHEN, diese Wache wählen, NACHSCHÄRFEN. | „Aus zwei Urteilen entsteht Version 2. Der Schritt ist ausdrücklich, steht im Protokoll und lässt sich zurücknehmen. Kein stilles Weiterlernen im Betrieb.“ |
| 5:30 | SUCHE. Haken „im Verbund fragen“. Eingeben: `überflutete Wiese`. | „Freitext, auf Deutsch. Kein Schlagwortkatalog. Rechts antworten Trier und Mainz: mit maskierten Vorschaubildern und einer Belegnummer. Ihre Aufnahmen haben sie nicht herausgegeben.“ |
| 6:30 | Zweites Fenster (Trier, PROTOKOLL): der Eintrag „Fremdanfrage von Lagezentrum Koblenz“. | „Der Nachbar hat die Frage nach seinen eigenen Regeln geprüft und protokolliert. Nur die Frage ist gereist.“ |
| 7:00 | Zurück in Koblenz. Eingeben: `Gesicht von Herrn Müller`, dann `Kennzeichen KO AB 123`. | „Abgelehnt, mit Regel, im Protokoll. Das System sucht Lagen, keine Menschen.“ |
| 8:00 | Ersten Treffer von `überflutete Wiese` öffnen, ZUM VORGANG, neuer Vorgang „Überflutung Moselbogen“, Vermerk, SICHERN. | „Das Bild wird mit der Prüfsumme des Originals gesichert und ist von der Löschfrist ausgenommen.“ |
| 9:00 | VORGÄNGE: VERSIEGELN, dann BERICHT. | „Ein versiegelter Vorgang ist unveränderlich. Der Bericht ist druckbar und nennt Siegel und Protokollstand.“ |
| 10:00 | LAGE: an Erkunder 1 das Bild mit dem Fachberater öffnen. Gesicht ist verpixelt. ORIGINAL ANFORDERN und den Dialog zeigen. | „Gesichter sind in jedem Bild maskiert. Das Original gibt es nur mit Grund und mit Freigabe durch eine zweite Person, für 15 Minuten.“ |
| 11:00 | PROTOKOLL: KETTE PRÜFEN. Dann STICHPROBE ZIEHEN. | „Jeder Eintrag enthält die Prüfsumme seines Vorgängers. Die Aufsicht zieht Stichproben, ohne selbst Bilder sehen zu können.“ |
| 12:00 | WIRKUNG, dann MESSBERICHT öffnen. | „Der Zweck ist messbar: 13 Ereignisse im Drehbuch, 13 erkannt, eine Fehlmeldung. In Echtzeit liegt der Verzug im Median bei 1,1 Sekunden; mit der hier beschleunigten Uhr zeigt die Anzeige zwei bis drei. Diese Zahlen erzeugt das System selbst, bei jeder Übung, als druckbaren Messbericht mit Protokollstand. Die Behörde muss uns nichts glauben; sie misst nach.“ |
| 13:00 | LAGE: LAGEBERICHT öffnen. | „Am Ende steht ein Lagebericht, der sich drucken oder als GeoJSON und CAP an bestehende Systeme übergeben lässt.“ |

Die Freigabe vollständig zeigen: Niemand kann sich selbst freigeben. In einem zweiten
Browserprofil als `lage` anmelden, dort ORIGINAL ANFORDERN, als freigebende Person `leitung` mit
deren Passwort eintragen. Das Bild erscheint unmaskiert, der Eintrag steht im Protokoll.

Die Prüfung ohne Sicht zeigen, wenn jemand fragt, wer die Kontrolle kontrolliert (eine Minute):
in einem zweiten Terminal `pnpm ledger:verify data-koblenz/ledger.jsonl`. Das Programm steht in
`tools/pruefen/`, braucht nichts außer Node und teilt mit dem Knoten keine Zeile. Es nennt die
Zahl der Einträge und den letzten Stand; derselbe Stand steht in der Konsole im Reiter PROTOKOLL
unter LETZTER STAND. Dazu der Satz: „Ihre Aufsicht muss uns nicht glauben. Sie rechnet nach, mit
hundert Zeilen, die sie selbst lesen kann.“ Mit der Datei aus EXPORT geht es ebenso; daneben
liegt dasselbe Programm in Python.

## Was man nicht behaupten darf

- Es gibt keine Behördenkunden, keine Pilotierung, keine Zertifizierung.
- Die Messwerte stammen aus einer Übung mit Archivmaterial. Die Wachen der Übung wurden an diesem
  Material formuliert. Die Zahlen beschreiben das Betriebsverhalten, nicht die Güte auf fremdem
  Material.
- Die Übung spielt vorab ausgewertete Aufzeichnungen auf einer Uhr ab. Direktbilder lassen sich
  anschließen (QUELLEN, „Quelle anlegen“, Adresse des Stroms) und werden mit etwa einer halben
  Minute Nachlauf ausgewertet; geprüft ist das nur gegen eine simulierte Kamera, nicht im Feld.
- Das trainierte Gefahrenmodell erreicht 99,1 % auf seinem Benchmark und irrt auf dem
  Übungsmaterial. Deshalb löst es keine Meldungen aus, sondern steht als Zweitmeinung daneben.
- „Kein Personen-Tracking“ ist eine Regel mit Protokoll, keine technische Unmöglichkeit.
- Der Name Sicht ist nicht markenrechtlich geprüft.

## Rückfallebenen

| Störung | Abhilfe |
| --- | --- |
| Anmeldung schlägt fehl | Passwort ist `lagebild`. Nach einem Neustart sind alle Sitzungen beendet: neu anmelden. |
| „Übungsmaterial fehlt“ | `pnpm exercise:fetch`, danach `pnpm demo:prepare`. |
| Das Laden der Modelle bricht ab | Den Befehl wiederholen; Fehlendes wird nachgeladen. Meldet der Knoten danach „Modell konnte nicht geladen werden“, den Ordner `.models` löschen und mit Netz neu starten. |
| Übung steht auf „Material wird ausgewertet“ | abwarten; der Balken zeigt den Stand. Ohne Vorbereitung dauert es rund zehn Minuten. |
| Verbund zeigt „nicht erreichbar“ | Die Knoten melden sich alle paar Sekunden; kurz warten. Wurde mit `pnpm start` statt `pnpm demo` gestartet, gibt es keine Nachbarn. |
| „Anschluss … ist bereits belegt“ | Die Knoten laufen schon in einem anderen Fenster: dort weiterarbeiten oder es mit Strg+C beenden und neu starten. Nennt die Meldung eine frühere Fassung (Spy-Eye) oder ein anderes Programm, dessen Fenster mit Strg+C beenden und neu starten. |
| Keine Fehlmeldung beim Lastkraftwagen | Die Wache ist von einer Probe schon nachgeschärft: Knoten beenden, `pnpm demo:reset`, `pnpm demo`. |
| Eine weitere Fehlmeldung | Kommt je nach Rechner vor, weil Videodekoder Bilder geringfügig verschieden liefern: öffnen, VERWERFEN, weiter. Der Messbericht weist sie aus. |
| Seite versehentlich neu geladen oder Reiter geschlossen | Die Adresse wieder öffnen: Die Anmeldung bleibt, die Übung läuft weiter (nachgestellt). |
| Der Rechner hing einige Sekunden | Nichts tun: Die Uhr der Übung holt auf, die Meldungen kommen nach (nachgestellt mit 20 Sekunden). |
| Das Fenster der Knoten wurde geschlossen | `.\vorfuehrung.cmd` wiederholen; der Befehl stellt den Ausgangsstand her (nachgestellt mit einem harten Ende mitten in der Übung). Neu anmelden. |
| Kein Netz am Ort | Auf einem vorbereiteten Rechner ohne Belang: Start, Übung und Suche laufen ohne Verbindung (nachgestellt unter Linux). |
| Unsicher, ob alles bereit ist | `pnpm demo:check` in einem zweiten Terminal; jede Zeile endet mit OK oder FEHLT. |
| Rechner zu langsam für 4× | 2× wählen; die Uhr bestimmt nur das Tempo, nicht das Ergebnis. |
| Alles steht | Der Film `sicht-produktfilm.mp4` zeigt denselben Ablauf in zwei Minuten. |

## Fragen, die kommen werden

Antworten stehen in `docs/FAQ.md`. Die drei häufigsten:

1. **„Ist das Palantir in klein?“** Nein. Sicht führt keine Daten zusammen und erstellt keine
   Profile. Es macht eigenes Bildmaterial durchsuchbar und lässt die Daten bei der Behörde, die sie
   aufgenommen hat.
2. **„Kann man damit Personen suchen?“** Namen, Gesichter, Kennzeichen, Herkunft und körperliche
   Merkmale werden abgelehnt. Beschreibungen nach Geschlecht, Alter oder Kleidung sind nur unter
   einem Mandat möglich, das sie ausdrücklich zulässt, etwa bei einer Vermisstensuche, und stehen
   gekennzeichnet im Protokoll.
3. **„Was ist fertig?“** Einspielen, Maskieren, Suchen, Wachen, Lagen, Vorgänge, Verbund,
   Protokoll und Messung laufen; Direktbilder laufen mit Nachlauf und sind nur im Labor geprüft.
   Nicht fertig: Erprobung mit echten Kameras, Anbindung an ein vorhandenes Führungssystem,
   Anmeldung über den Verzeichnisdienst einer Behörde, Betrieb mit mehr als einigen zehn Stunden
   Material, Zulassung.
