# DATUM

**Jedes Bild hat einen Ort und eine Uhrzeit.**

DATUM bestimmt aus einem Video, wo und wann es aufgenommen wurde: Ort mit Unsicherheitskreis,
Uhrzeit als Zeitfenster, Sonnenstand und Schattenrichtung, Blickrichtung, wo der Geländehorizont
sie verrät. Aus einem einzelnen Bild baut es einen begehbaren Raum; das Gelände um den Fundort
zeigt es in 3D mit der Sonne zur geschätzten Zeit. Alles läuft auf einem Rechner ohne
Grafikkarte. Was aus dem Netz stammt (Referenzbilder, Höhendaten, Kartendaten, Modelle), wird
einmal geladen und liegt danach auf der Platte. Zur Laufzeit fragt der Knoten das Netz nur für
eines, und nur solange es eingeschaltet ist: Der Abgleich mit Straßenbildern sucht bei freien
Bilddiensten nach Bildern rund um einen erkannten Ort (Abschnitt
[Abgleich mit Straßenbildern](#abgleich-mit-straßenbildern)). Vom Video selbst verlässt dabei
nichts den Knoten.

Stand: Erprobung mit einem Referenzbestand aus Wikimedia Commons. Keine Kunden, keine Zulassung,
der Name ist markenrechtlich nicht geprüft. Die 60 Referenzclips (mit Urheber und Lizenz je Datei in
`datasets/datum/clips/LIZENZEN.md`) und die Vektoren der Galerie liegen dem Repository bei; der
erste Start hängt nicht von Wikimedia ab, das Abrufe drosselt.

## Was für wen

Nachrichtendienste, Strafverfolgung und das Militär sichten Videos aus sozialen Netzen, um zu
klären, wo und wann etwas geschah: ein Einschlag, eine Truppenbewegung, eine Kundgebung, ein
angebliches Beweisvideo. Heute ortet das ein Mensch von Hand, oft in Stunden je Video. DATUM
nimmt diese Arbeit nicht ab, aber es legt in Sekunden eine begründete Schätzung mit Belegen
vor, die ein Analyst prüft. Palantir führt vorhandene Daten zusammen; DATUM erzeugt neue Daten
(Ort und Zeit) aus Pixeln und liefert sie in solche Systeme.

## Was DATUM tut, Schritt für Schritt

| Schritt | Verfahren | Ergebnis |
| --- | --- | --- |
| Schnellortung | Gleich nach dem Hochladen zwölf Bilder direkt aus der Datei ziehen und mit Metadaten, Wiedererkennung, Weltmodell, Länderschätzung, Licht und Sonne orten, noch vor der vollständigen Auswertung | erste Ortung mit Uhrzeit nach Sekunden, ohne Räume, Horizont und Straßenbilder; die vollständige Ortung ersetzt sie |
| Metadaten | Tags der Datei lesen (ISO 6709 Ort, Aufnahmezeit, Gerät); Zeitstempel von Umwandlungen werden verworfen | Ort und Zeit exakt, wenn vorhanden |
| Wiedererkennung | Zwölf Bilder des Videos, jedes als Ganzes und in drei quadratischen Ausschnitten, gegen eine Galerie von Referenzbildern mit Koordinaten (Wikidata P18 + P625) vergleichen; die nächsten Nachbarn stimmen mit geodätischen Kernen (2, 25, 250 km) über ihren Ort ab; der Radius richtet sich nach der Belegstufe | Kandidatenorte mit Radius |
| Weltmodell | GeoCLIP vergleicht die zwölf Bilder mit 100 000 Orten auf der Erde. Legt es mindestens 5 % seiner Wahrscheinlichkeit in den Umkreis von 200 km um die Antwort der Galerie, bleibt diese stehen; sonst ersetzt sein bester Ort sie. Seine wahrscheinlichsten Gegenden kommen zu den Kandidaten | Region überall auf der Erde, auch ohne Referenzbild |
| Länderschätzung | Das Text-Bild-Modell wird ohne Training gefragt, aus welchem Land die Bilder aussehen; das gewichtet die Kandidaten und trägt die Antwort allein, wenn kein Referenzbild passt | Wahrscheinlichkeit je Land |
| Straßenbilder | Nur in der vollständigen Ortung und nur nach einer klaren Wiedererkennung: freie Straßenbilder im Umkreis von 3 km (Panoramax, mit Schlüssel auch Mapillary) mit den Bildern des Videos vergleichen; es zählt nur ein Bild, das sich deutlich von den übrigen derselben Gegend abhebt | Ort auf das passende Straßenbild gerückt, wo es eines gibt; sonst unverändert |
| Licht | Tag, Dämmerung, Nacht, tief- oder hochstehende Sonne aus Bildmerkmalen und Bildstatistik | Band der Sonnenhöhe |
| Jahreszeit | Schnee, kahle Bäume, Blüte, Laub; auf der Südhalbkugel gespiegelt | Monatsbereich |
| Sonne | Sonnenstandsrechnung (NOAA) für Ort und Datum, Zeiten, in denen die Sonne im gemessenen Band steht; Zeitzone aus Land und Länge | Uhrzeitfenster in Ortszeit, Sonnenbahn, Schattenrichtung |
| Raum | Tiefenschätzung (Depth Anything V2 Small) für drei Schlüsselbilder; Himmel, Boden und Neigung der Kamera; Abstände aus der Annahme einer Augenhöhe von 1,6 m | begehbarer Raum, Himmelslinie |
| Horizont | Aus Höhendaten berechneter Horizont am Kandidatenort gegen die Himmelslinie des Videos; gewertet nur, wenn der Horizont im Bildausschnitt mindestens 1° Relief hat und die beste Richtung sich deutlich von den übrigen abhebt | Blickrichtung und Bildwinkel, wenn das Gelände markant ist und der Ort stimmt |
| Abschnitte | Nur in der vollständigen Ortung: die Szenen der Auswertung als Fenster, jedes für sich mit Galerie, Länderschätzung und Weltmodell geortet, sichere Antworten zu Orten zusammengefasst; jeder Abschnitt mit Ort bekommt Uhrzeit und Sonnenstand aus seinen eigenen Bildern, die längsten einen eigenen Raum (Abschnitt [Mehrere Orte in einer Aufnahme](#mehrere-orte-in-einer-aufnahme)) | eine Zeitleiste mit einem Abschnitt je Ort, wenn die Bilder mindestens zwei Orte zeigen oder (seit Fassung 12) einen erkannten Ort und mindestens einen unbestimmten Abschnitt, mit Uhrzeit je Abschnitt mit Ort und grober Region für unbestimmte Abschnitte, wo sie gemessen trägt; sonst unverändert |

Jeder Beleg, jeder Schritt des Ablaufs und jede Begründung kommt vom Knoten auf Deutsch und auf
Englisch; die Konsole zeigt die Sprache, die eingestellt ist.

## Bedienung

| Reiter | Zeigt |
| --- | --- |
| ORTUNG | Weltkarte im Stil der Konsole mit allen Aufnahmen, Unsicherheitskreisen, Sonnen- und Schattenrichtung, Blickkegel; links die Liste mit Uhrzeit (bei mehreren Orten „7 Orte“, bei einem erkannten Ort mit unbestimmten Abschnitten „1 erkannter Ort · 1 unbestimmt“); eine gewählte Aufnahme mehrerer Orte zeigt ihre Orte nummeriert und den Weg in zeitlicher Folge; in den Kartenwerkzeugen der Knopf „Einstellungen“ |
| BEFUND | Video, bei mehreren Orten oder einem erkannten Ort mit unbestimmten Abschnitten darunter die Zeitleiste der Abschnitte (ein Klick springt im Video an den Anfang und zeigt Ort, Radius, Uhrzeit und Schlüsselbild, bei einem unbestimmten Abschnitt die grobe Region, wo es eine gibt; beim Abspielen folgt die Wahl dem Video; die Karte zeigt alle Orte nummeriert und verbunden; Uhr und Sonnenstand folgen dem gewählten Abschnitt und nennen ihn, der Kopf bleibt bei der Ortung), Himmelslinie, Belege mit Referenzbildern und Straßenbildern, Koordinaten und MGRS, Uhr mit Zeitfenstern und Sonnenauf- und -untergang, Polardiagramm des Sonnenstands, Kandidaten, Länder |
| RAUM | Begehbarer Raum aus dem Video (W A S D, Maus, Q E, Shift; der Himmel des Bildes bleibt beim Gehen als Kuppel stehen; unten links Sonnenhöhe und Schattenlänge zur geschätzten Zeit) und das Gelände um den Fundort mit Sonnenbahn, Horizont und Standpunkt zum Hineingehen; bei einer Aufnahme mit Zeitleiste der Raum des in BEFUND gewählten Abschnitts, darüber die Zeitleiste zum Wechseln |
| SUCHE | Freitextsuche über alle Aufnahmen |
| BESTAND | Videos und Ordner hochladen |
| MESSUNG | Abweichung jeder Ortung gegen die Grundwahrheit des Referenzbestands; am Ende der Abschnitt „Einstellungen der Ortung“ |
| PROTOKOLL | Verkettetes Protokoll aller Anmeldungen, Abfragen, Ortungen und Änderungen der Einstellungen |

- **Einstellungen der Ortung** (ORTUNG, „Einstellungen“, oder am Ende von MESSUNG): Abgleich mit
  Straßenbildern ein oder aus, Mapillary-Schlüssel, Zustand des Weltmodells (vorhanden oder
  nicht, Genauigkeit). Ändern darf nur die Leitung; die übrigen Rollen sehen die Einstellungen.
  Jede Änderung steht im Protokoll und gilt für die nächsten Ortungen.
- **Neu orten** (BEFUND) rechnet eine Aufnahme mit der aktuellen Fassung neu; die bisherige
  Ortung bleibt in ORTUNG sichtbar („Neuortung steht an“, dann „wird neu geortet …“), bis die
  neue fertig ist. Wird der Knoten vorher beendet, steht das auf der Platte (`datum/redo` neben
  `fix.json`), und der nächste Start rechnet sie neu. Dasselbe gilt, wenn die Auswertung einen
  Index neu aufbaut (anderes Modell, unlesbare Vektoren): Die Ortung aus dem alten Index wird
  vermerkt, sobald der Knoten das beim Start feststellt. Scheitert die Neuberechnung (nicht durch
  das Beenden), entfällt der Vermerk, und die gespeicherte Ortung gilt weiter, statt bei jedem
  Start erneut zu scheitern.
- **Prüfverweise auf Google**: „In Street View prüfen“ und „In Google Maps öffnen“ stehen im
  Kopf des BEFUNDS unter dem Ort, in der ORTUNG und an jedem Kandidaten (Abschnitt
  [Google Street View und Google Maps](#google-street-view-und-google-maps)).

## Weltmodell (GeoCLIP)

Die Galerie erkennt nur, was ihr ähnlich sieht. Für alles andere schätzt das Weltmodell eine
Region, überall auf der Erde. GeoCLIP (Vivanco Cepeda, Nayak, Shah, NeurIPS 2023; Code und
Gewichte unter der MIT-Lizenz) vergleicht ein Bild mit 100 000 Orten der Erde und gibt jedem Ort
eine Wahrscheinlichkeit. Der Knoten verwendet die ONNX-Fassung `Xenova/geoclip-large-patch14` in
der auf int8 verkleinerten Form.

- **Laden.** `pnpm datum:fetch` und `pnpm models:download` laden die Dateien einmal aus einer
  festgelegten Fassung, prüfen Größe und SHA-256 jeder Datei und berechnen danach einmal die
  Ortsgalerie des Modells (die 100 000 Orte als Vektoren). Zur Laufzeit wird nichts
  nachgeladen. Scheitert das Laden, meldet der Befehl es, und der Knoten ortet ohne Weltmodell.
  `pnpm datum:check` zeigt, ob Modell und Ortsgalerie vorliegen.
- **Erster Start ohne Ortsgalerie.** Der Knoten berechnet sie einmal im Hintergrund (rund 40 s).
  Die Schnellortung wartet darauf nicht. Ortungen aus dieser Zeit bleiben sichtbar, gelten als
  vorläufig (`pnpm datum:check` zählt sie als noch nicht geortet) und werden neu berechnet,
  sobald die Ortsgalerie fertig ist.
- **Zusammenspiel mit der Galerie.** Legt das Weltmodell mindestens 5 % seiner
  Wahrscheinlichkeit in den Umkreis von 200 km um die Antwort der Galerie, bleibt diese stehen
  und gilt als bestätigt. Sonst ersetzt sein bester Ort die Antwort. Jede Ortung trägt einen
  Beleg „Weltmodell“, der sagt, was es geschätzt hat und ob es bestätigt oder ersetzt hat.
- **Kreis.** 25 km, wenn mindestens 20 % seiner Wahrscheinlichkeit im Umkreis von 25 km um den
  besten Ort liegen; sonst 1 500 km. Die Konsole schreibt dazu „Weltmodell: Region ± N km“.
- **Sicherheitsangabe.** Antwortet das Weltmodell, gilt ein eigenes Modell der Sicherheit, das
  an der Abstimmungshälfte eingestellt ist; ohne Weltmodell gilt das bisherige der Galerie.
- **Rechnen.** Modell und Vergleich mit den 100 000 Orten laufen in einem eigenen Thread, einmal
  je Video in der Schnellortung; die vollständige Ortung übernimmt diese Antwort.
- **Abschalten.** `DATUM_WORLDMODEL=0` schaltet es für den ganzen Knoten ab. Fehlen die
  Gewichte, läuft die Ortung ohne Weltmodell durch und sagt im Ablauf, warum.

Was es bringt, steht unter [Was gemessen ist](#was-gemessen-ist): Bei Orten ohne Referenzbild
liegen auf der Prüfhälfte 93 statt 60 % der Videos auf 2 500 km genau, das Land stimmt in 60
statt 33 %. Vorbehalt: Die Referenzvideos zeigen bekannte Bauwerke, deren Fotos vermutlich in den
Flickr-Trainingsdaten von GeoCLIP liegen. Anonymes Straßenmaterial wird schlechter abschneiden;
gemessen ist das nicht.

## Mehrere Orte in einer Aufnahme

Reise-, Dashcam- und Drohnenvideos oder Zusammenschnitte zeigen nacheinander mehrere Orte. Die
Ortung aus zwölf Bildern der ganzen Datei mischt sie zu einem Punkt: Ein 20 Minuten langer
Zusammenschnitt aus 101 Referenzclips (60 Orte) ergab „Moskau ± 1 km“ ohne jeden Hinweis. Seit
Fassung 10 ortet die vollständige Ortung jede Aufnahme zusätzlich Abschnitt für Abschnitt
(`apps/server/src/datum/segments.ts`).

- **Fenster.** Die Szenen der Auswertung (höchstens 30 s), Szenen unter 4 s an die Nachbarszene
  angehängt, der sie am ähnlichsten sieht; höchstens 160 Fenster.
- **Ortung je Fenster.** Dieselbe Entscheidung wie für eine ganze Aufnahme: bis zu acht Bilder
  des Fensters, ganz und in Ausschnitten, gegen die Galerie (in ihrem Thread, in Teilen ganzer
  Fenster von höchstens 256 Zeilen: eine Suche über alle Fenster dauerte auf einem belasteten
  Rechner fast eine Minute, und nach 60 s ohne Antwort wird der Suchthread beendet), eine eigene
  Länderschätzung und das Weltmodell auf bis zu drei Bildern je Fenster,
  höchstens 120 Bildern je Aufnahme (bei 104 Fenstern ein oder zwei je Fenster). Die Tags der
  Datei zählen hier nicht.
- **Orte.** Sicher ist ein Fenster, wenn ein Referenzbild klar heraussticht oder die Galerie mit
  einer Sicherheit von mindestens 0,8 antwortet. Die Antwort des Weltmodells allein reicht nie: Auf
  4-s-Fenstern der Referenzclips lag sie nur in 23 % (gerade Nummern) und 15 % (ungerade) der Fälle
  auf 25 km genau, die sicheren Galerieantworten in 72 % und 71 %. Sichere Fenster näher als 25 km
  sind ein Ort, auch über eine Kette solcher Fenster, gleich welches das sicherste ist. Orte, deren
  sicherste Fenster das Weltmodell beider derselben Gegend zurechnet (beide legen mindestens 5 %
  ihrer Wahrscheinlichkeit in 200 km um die Antwort des anderen), sind ebenfalls einer, außer bei
  zwei klar herausstechenden Wiedererkennungen; ein so zusammengefasster Ort kann mehrere sein,
  die Zahl der Orte heißt dann „mindestens“. Ein Ort braucht mindestens 5 s sicherer Fenster. Ein
  unsicheres Fenster zählt nur zwischen zwei Fenstern desselben Orts zu ihm, und nur wenn seine
  eigene Antwort einem der beiden nicht widerspricht; sonst bleibt es „unbestimmt“ und wird keinem
  Ort zugeschlagen.
- **Ergebnis.** Bei mindestens zwei Orten trägt die Ortung die Abschnitte (`Fix.segments`;
  die Liste nur ihre Kurzform `segmentSummary`), seit Fassung 12 auch bei einem erkannten Ort und
  unbestimmten Abschnitten (siehe
  [Ein erkannter Ort und unbestimmte Abschnitte](#ein-erkannter-ort-und-unbestimmte-abschnitte)).
  Oben steht dann der Ort des längsten Abschnitts mit Ort, es sei denn, die Ortung der ganzen
  Datei liegt keine 25 km davon entfernt; bei einem erkannten Ort nur, wo seine Abschnitte (ohne
  die am verworfenen Ort, siehe unten) mindestens ein Fünftel der Aufnahme umfassen, sonst bleibt
  die Ortung der ganzen Datei oben und kein Abschnitt ist der gezeigte. Ein Beleg
  sagt es: „Die Aufnahme zeigt mindestens 15 Orte; oben der Abschnitt 11:19–11:43“
  („mindestens“, solange Abschnitte unbestimmt sind oder ein Ort zusammengefasst ist). Hat das
  Weltmodell für die ganze Datei die Antwort der Galerie verworfen, steht ein Abschnitt an diesem
  Ort nicht oben, sondern der längste übrige (bei einem erkannten Ort, der nur dort Abschnitte hat,
  die Ortung der ganzen Datei): Die Deutschlandreise der Gegenprobe (Bhf. Eschborn,
  in einem Abschnitt für den Bahnhof Norderstedt Mitte ± 3 km gehalten, 408 km daneben) hätte sonst
  diesen falschen Ort mit 3 km Radius als Ergebnis gezeigt. Uhrzeit und Sonnenstand, die drei
  Räume der Ortung und der Horizont kommen aus dem gezeigten Abschnitt (Uhrzeit und Sonnenstand
  seit Fassung 11, siehe [Uhrzeit und Sonne je Abschnitt](#uhrzeit-und-sonne-je-abschnitt)), wo die
  Ortung keinen zeigt, aus der ganzen Datei. Ersetzt sein Ort die Ortung der ganzen Datei, sind die Kandidaten die
  Orte der Aufnahme, die Länder die der Abschnitte (nach ihrer Zeit), die Belege der ganzen Datei
  (Referenzbilder, Weltmodell, Länderschätzung) heißen „Ganze Datei (gemischt)“ und zählen nicht,
  und Straßenbilder werden nicht gefragt (ihr Vergleich nähme Bilder der ganzen Datei). Eine
  Aufnahme aus einem einzigen Abschnitt bleibt, wie sie war; der Ablauf nennt nur den Schritt
  „Abschnitte geprüft“.
- **GPS in der Datei.** Die Position gilt für die ganze Datei; es gibt keine Abschnitte. Zeigen
  die Bilder trotzdem mehrere Orte, sagt ein Beleg ohne Gewicht: „Die Bilder zeigen 2 verschiedene
  Orte“.
- **Fassung 11** macht die Abschnitte vollständig: eine Uhrzeit je Abschnitt mit Ort, eine grobe
  Region für unbestimmte Abschnitte, wo sie gemessen trägt, und eigene Räume für die längsten
  Abschnitte (die drei Abschnitte unten).
- **Fassung 12** gibt auch einer Aufnahme mit einem erkannten Ort und unbestimmten Abschnitten die
  Zeitleiste; ihr Ort steht oben, wo er mindestens ein Fünftel der Aufnahme umfasst (siehe [Ein
  erkannter Ort und unbestimmte Abschnitte](#ein-erkannter-ort-und-unbestimmte-abschnitte)).

### Gemessen an Zusammenschnitten

Am 19. November 2026 mit `segments.ts`, wie es im Knoten läuft (die Galerie enthält Referenzbilder
der Orte), über die von der Analyse gespeicherten Bilder und Vektoren. Vier Zusammenschnitte aus den
Referenzclips (auf 854 × 480 Bildpunkte und 30 Bilder/s umgerechnet): der 20-Minuten-Schnitt und
drei kürzere, deren Orte nach einer festen Regel aus der Reihenfolge des Manifests gewählt sind
(jeder Clip in Schleife auf 20 bis 60 s; eine Schleife wiederholt dieselben Bilder). Eine Grenze
zählt als gefunden, wenn eine Abschnittsgrenze höchstens 3 s neben dem echten Wechsel liegt; der
Fehler eines Abschnitts ist der Abstand seines Orts zum Ort des Stücks, das ihn am längsten füllt.

| Aufnahme | Stücke (Orte) | Abschnitte: mit Ort / unbestimmt | Orte | Wechsel gefunden | Grenzen ohne Wechsel | Grenzfehler (Median) | Abschnitte mit Ort ≤ 25 / 200 / 750 km | Median | Zeit mit Ort | Zeit ≤ 25 km |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 20 Minuten (19:46) | 101 (60) | 32 / 25 | ≥ 15 | 54 von 100 | 2 | 0,27 s | 25 / 26 / 29 von 32 | 1,0 km | 33 % | 25 % |
| 10 Orte (5:00) | 10 (10) | 6 / 4 | ≥ 4 | 5 von 9 | 4 | 0 s | 3 / 3 / 6 von 6 | 102 km | 35 % | 30 % |
| Rückkehr (3:40) | 6 (5) | 3 / 2 | ≥ 2 | 3 von 5 | 1 | 0 s | 3 / 3 / 3 von 3 | 5,9 km | 64 % | 52 % |
| 3 Orte (2:00) | 3 (3) | 2 / 0 | ≥ 2 | 1 von 2 | 0 | 0 s | 1 / 1 / 1 von 2 | 0 und 1 232 km | 100 % | 67 % |
| 20 Minuten, Ort ohne Referenzbild | 101 (60) | 25 / 20 | ≥ 12 | 42 von 100 | 2 | 0,2 s | 9 / 12 / 19 von 25 | 215 km | 25 % | 8 % |

- Wo die Zeitleiste einen Ort nennt, stimmt er meist (20 Minuten: 25 von 32 Abschnitten auf 25 km).
  Zwei Drittel des 20-Minuten-Schnitts bleiben unbestimmt: In zwölf Sekunden ohne erkanntes
  Bauwerk gibt es keine sichere Antwort, und das Weltmodell auf einem Bild ist zu oft falsch.
- Grenzen fallen auf Szenenschnitte und liegen daher meist auf die Sekunde richtig. Verfehlt wird
  ein Wechsel, wenn unbestimmte Fenster zu einem Abschnitt zusammenfallen oder zwei ähnliche Orte
  ohne Schnitt aufeinander folgen (zwei Bahnhöfe). Die „Grenzen ohne Wechsel“ bei 10 Orte sind
  unbestimmte Fenster mitten in einem Ort.
- „3 Orte“: Das Kyffhäuserdenkmal erkennt die Galerie als Ort bei Chester; das Weltmodell beider
  Fenster sieht Großbritannien, so fällt es mit dem Glenfinnan-Viadukt zu einem Abschnitt (0:00–1:20,
  Ort Glenfinnan) zusammen. Beim 20-Minuten-Schnitt fassen die 15 Orte unter anderem Moskau mit dem
  Kiewer Höhlenkloster und dem Bahnhof Ulaanbaatar (beide von der Galerie für Moskauer Bauwerke
  gehalten) sowie Berlin mit Magdeburg zusammen.
- Ohne Referenzbild des Orts in der Galerie sinkt die Genauigkeit der Abschnitte deutlich (9 von 25
  auf 25 km). Für unbekanntes Material ist das die ehrlichere Zahl.
- **Falsche Teilungen.** Über alle 60 Referenzclips (je ein Ort): keine Aufnahme geteilt, mit den
  Szenen als Fenstern (58 Clips haben nur eines) wie mit festen 4-s-Fenstern (drei je Clip), jeweils
  mit und ohne Referenzbild des Orts in der Galerie. Härter geprüft, mit Orten schon ab einem
  einzigen 4-s-Fenster: 0 (ohne Referenzbild 1); ohne den Abgleich über das Weltmodell wären es 3
  (ohne Referenzbild 6), etwa Borobudur als Mendut-Tempel und als Angkor Thom. Im Knoten selbst,
  alle 60 Referenzclips mit Fassung 10 neu geortet: keine Ortung mit Abschnitten.
- Messdatei: `docs/measurements/datum-segments.json`.
- **Zeit.** 20-Minuten-Schnitt hochgeladen, auf einem Rechner, den ein anderer Lauf mit einer Last
  von 6 bis 9 auf vier Kernen teilte: Schnellortung 13,1 s, Auswertung 564 s, vollständige Ortung
  97,9 s, davon Abschnitte 92,4 s (Weltmodell auf 120 Bildern 90,1 s; die Galeriesuche über 104
  Fenster, 37 bis 59 s, läuft daneben). Ohne Abschnitte brauchte die vollständige Ortung derselben
  Datei 11,1 s; die Abschnitte kosten also etwa anderthalb Minuten. Ein Referenzclip (ein oder
  zwei Fenster): im Median 1,7 s, höchstens 3,8 s.
- **Vorbehalte.** Alle Zusammenschnitte bestehen aus denselben 60 Clips, an denen DATUM eingestellt
  ist; die Regel für sichere Fenster ist mit Blick auf die Fenster des 20-Minuten-Schnitts
  entstanden, die Schwelle 0,8 auf den Fenstern der geraden Nummern geprüft und auf den ungeraden
  bestätigt. Echtes Reise- oder Dashcam-Material ist nicht gemessen; ohne bekannte Bauwerke wird
  der Anteil unbestimmter Abschnitte größer sein.

### Uhrzeit und Sonne je Abschnitt

- **Rechnung.** Jeder Abschnitt mit Ort bekommt Uhrzeit und Sonnenstand aus bis zu acht seiner
  eigenen Bilder (Bildstatistik und Bildvektoren der Auswertung; die Beschreibungen für Licht und
  Jahreszeit bettet das Text-Bild-Modell einmal je Prozess ein) an seinem eigenen Ort, in dessen
  Zeitzone. Ein unbestimmter Abschnitt hat keinen Ort und daher keine Uhrzeit.
- **Oben.** Die Uhrzeit der Ortung ist die des gezeigten Abschnitts, aus denselben Bildern; ihr
  Beleg nennt ihn („Sonnenhöhe 3–90° (Abschnitt 11:19–11:43)“). Die Schätzung aus den zwölf Bildern
  der ganzen Datei mischt das Licht aller Orte; sie bleibt als Beleg „Ganze Datei (gemischt)“ ohne
  Gewicht. Das gilt auch, wenn die Ortung der ganzen Datei mit dem Abschnitt übereinstimmt: ihre
  Bilder stammen trotzdem von allen Orten. Zeigt die Ortung keinen Abschnitt (seit Fassung 12: ein
  erkannter Ort unter einem Fünftel der Aufnahme oder nur am verworfenen Ort, siehe [Ein erkannter
  Ort und unbestimmte Abschnitte](#ein-erkannter-ort-und-unbestimmte-abschnitte)), ist ihre Uhrzeit
  die der ganzen Datei, mit gewichtetem Beleg wie ohne Abschnitte; die Abschnitte mit Ort haben
  trotzdem ihre eigene.
- **Aufnahmezeit in der Datei.** Sie gilt für die ganze Datei und entscheidet auch je Abschnitt:
  derselbe Zeitpunkt, in der Ortszeit jedes Abschnitts und mit dem Sonnenstand an seinem Ort. Ihr
  Beleg steht einmal da, „Aufnahmezeit aus den Metadaten“: Er sagt, dass sie für die ganze Datei und
  jeden Abschnitt gilt und mit dem Licht des gezeigten Abschnitts verglichen ist. Eine Kopie „Ganze
  Datei (gemischt)“ gibt es dann nicht; sie hätte die Zeit nur wiederholt und am gemischten Licht
  aller Orte geprüft.
- **Konsole.** Der Kopf des BEFUNDS bleibt eine Aussage über die Ortung: Ort, Uhrzeit und
  Konfidenz des gezeigten Abschnitts, auch wenn ein anderer gewählt ist. Uhr und Polardiagramm
  folgen dem gewählten Abschnitt und nennen ihn darüber („Abschnitt 8 · 2:27–2:39 · Eiffelturm,
  Paris“); die Zeile unter der Zeitleiste nennt sein Zeitfenster. Ein Abschnitt mit Ort, dessen
  Schätzung fehlschlug (ein Bild unlesbar), heißt „Uhrzeit ––:–– · nicht bestimmbar“, nicht „ohne
  Ort“. Ortungen vor Fassung 11 haben keine Uhrzeit je Abschnitt: Die Zeile unter der Zeitleiste
  nennt dann keine, und die Uhr zeigt die der Ortung. Die Blickrichtung aus dem Horizont gehört zum
  gezeigten Abschnitt und erscheint nur bei ihm.
- **Zeitzone bei weitem Kreis.** Ein Ort mit mehr als ±1 500 km (die knappe Wiedererkennung mit
  ±7 500 km) legt keine Zeitzone fest: Ortszeit und UTC-Versatz gelten für den angenommenen Punkt.
  Kopf, Zeitleiste, die Ergebniskarte in ORTUNG und die Leiste in RAUM schreiben „Zeitzone unsicher“
  neben die Uhrzeit; der Hinweis beim Darüberfahren nennt den Radius. Das gilt auch für eine
  Antwort auf Landesebene über ±1 500 km (Deutschland ±1 790 km): Ihr Kreis reicht über mehrere
  Zeitzonen. Beim gezeigten Abschnitt zählt der Radius der Ortung, deren Uhrzeit er trägt. Gemessen im End-to-End-Lauf: Kiew, als Moskau ±7 500 km
  erkannt, bekam Moskauer Zeit (im März eine Stunde neben der Kiewer).
- **Gespeichert** wird die Uhrzeit eines Abschnitts ohne die Begründungszeilen (die trägt die
  Uhrzeit oben) und mit der Sonnenbahn in 30-Minuten-Schritten auf 0,1° (oben 10 Minuten).

Gemessen am 19. November 2026 auf einem eigenen Knoten, während auf dem Rechner keine andere
Auswertung lief, mit den Zusammenschnitten von oben und der Gegenprobe (frisch hochgeladen und
ausgewertet); die Uhrzeit der ganzen Datei ist die der Fassung 10 auf denselben Auswertungen.

| Aufnahme | Abschnitte mit Ort | Zeitzonen | Fenstermitte anders als die der ganzen Datei (Median, höchstens) | derselbe Clip in mehreren Abschnitten: gleiche Uhrzeit |
| --- | --- | --- | --- | --- |
| 20 Minuten | 32 | 12 | 2 h 25 min, 6 h 45 min; ≥ 1 h in 26 von 32 | 8 von 9 Clips |
| 10 Orte | 6 | 4 | 1 h 23 min, 6 h 15 min | 1 von 1 (drei Abschnitte) |
| Rückkehr | 3 | 2 | 2 h 8 min, 2 h 33 min | 1 von 1 |
| 3 Orte | 2 | 2 | 1 h 15 min, 2 h 23 min | – |
| Deutschlandreise | 3 | 1 | 13 min, 2 h 5 min | – |
| Kontinente | 3 | 3 | 10 h 30 min, 10 h 35 min | – |

- Die eine Abweichung: der Bahnhof Ulaanbaatar, zweimal im Schnitt und beide Male für einen anderen
  Moskauer Bahnhof gehalten (beides falsch), 07:25–09:55 und 07:20–09:55: gleiches Licht, ein paar
  Kilometer anderer Ort.
- Oben stand beim 20-Minuten-Schnitt bisher 07:15–14:15 (Sonnenhöhe 12–35°, aus Bildern aller
  Orte), jetzt 07:55–15:30 (3–90°, aus dem Abschnitt Quellbrunnen); bei „10 Orte“ bisher 07:45–12:55
  (Tag), jetzt 05:30–09:25 (Dämmerung, aus dem Abschnitt Arc de Triomphe).
- Gleiche Uhrzeit für denselben Clip prüft die Stetigkeit der Rechnung (dieselben Bilder geben
  dasselbe), nicht ihre Treffsicherheit: Die Clips tragen keine Aufnahmezeit, eine Grundwahrheit der
  Uhrzeit gibt es nicht (siehe [Was gemessen ist](#was-gemessen-ist)).
- Kosten: 3,1 und 3,7 s für die 32 Abschnitte des 20-Minuten-Schnitts (zwei Läufe), statt 0,1 s
  für die Schätzung der ganzen Datei allein.

### Grobe Region für unbestimmte Abschnitte

- **Regel.** Ein unbestimmtes Fenster, dessen Galerieantwort und bester Ort des Weltmodells
  höchstens 1 500 km auseinanderliegen, nennt eine grobe Region: die Mitte der beiden mit 1 500 km
  Radius, benannt nach den Teilen der Welt, die der Kreis hält (Unterregionen der UN, Russland
  östlich von 60° Ost und Tschukotka jenseits von 180° „Nordasien“; `apps/server/src/datum/regions.ts`,
  `regionAround`): gezählt nach den Einwohnern der verzeichneten Städte im Kreis, ein Teil, wenn
  mindestens 90 % von ihnen darin leben, sonst die zwei mit den meisten. Aufeinanderfolgende Fenster
  derselben Region sind ein Eintrag; ein Fenster ohne Region beendet ihn. Unter der Zeitleiste:
  „grobe Region: eher Westeuropa oder Osteuropa, ± 1.500 km“, mit seiner Zeit davor, wenn er nur
  einen Teil des Abschnitts deckt.
- **Kein Ort.** Eine grobe Region zählt nicht zu den Orten („mindestens 15 Orte“ bleibt), wird nie
  das Ergebnis und gibt keine Uhrzeit; der Abschnitt bleibt gestrichelt und „unbestimmt“. Der Beleg
  der Abschnitte sagt, für wie viele unbestimmte Abschnitte die Zeitleiste eine grobe Region nennt.
- **Warum diese Regel.** Die eigene Antwort eines unbestimmten Fensters (meist der beste Ort des
  Weltmodells) lag mit keinem Radius bis 5 000 km in 80 % der Fälle nah genug an der Wahrheit
  (71 % bei 5 000 km). Wo Galerie und Weltmodell, die die Bilder verschieden sehen, auf dieselbe
  Gegend zeigen, trägt es.

Kalibriert an den unbestimmten Fenstern der vier Zusammenschnitte (die Fenster, die der Knoten
entscheidet; Referenzbilder der Orte in der Galerie, wie der Knoten läuft), geprüft an denselben
ohne Referenzbild der Orte und an den 60 Einzelclips in festen 4-s-Fenstern. „Wahrheit im Kreis“
heißt: der Ort des Stücks, das das Fenster am längsten füllt, liegt höchstens 1 500 km von der
Mitte entfernt; „Sekunden“ zählt jede Sekunde der gezeigten Regionen gegen den Ort in dieser
Sekunde.

| Fenster | unbestimmt | eigene Antwort, Wahrheit ≤ 1 500 / 2 500 / 5 000 km | mit grober Region | Wahrheit im Kreis | Sekunden | unbestimmte Abschnitte mit Region |
| --- | --- | --- | --- | --- | --- | --- |
| Zusammenschnitte (Kalibrierung) | 84 (1 072 s) | 56 / 65 / 71 % | 34 (451 s, 42 % der unbestimmten Zeit) | 32 von 34 (94 %) | 423 von 451 (94 %) | 21 von 31 |
| davon 20 Minuten | 70 (798 s) | 57 / 63 / 70 % | 30 (346 s) | 28 von 30 | 318 von 346 | 19 von 25 |
| Zusammenschnitte, ohne Referenzbild der Orte | 99 (1 285 s) | 62 / 70 / 76 % | 42 (570 s, 44 %) | 40 von 42 (95 %) | 544 von 570 (95 %) | 19 von 27 |
| Einzelclips, 4-s-Fenster | 116 | 68 / 72 / 74 % | 45 | 41 von 45 (91 %) | – | – |
| Einzelclips, 4-s-Fenster, ohne Referenzbild | 131 | 71 / 74 / 76 % | 53 | 48 von 53 (91 %) | – | – |
| Gegenprobe (Berlin-Tour, Deutschlandreise, Kontinente) | 9 (110 s) | 33 / 67 / 67 % | 2 (36 s) | 2 von 2 | 36 von 36 | 2 von 7 |

- **Wahl des Radius.** Geprüft wurden 500, 750, 1 000, 1 500, 2 000, 2 500, 3 000 und 5 000 km, jeweils
  als Höchstabstand zwischen Galerie und Weltmodell und als Radius. Auf den Zusammenschnitten der
  Kalibrierung: 67 % (6 Fenster), 88 % (16), 95 % (20), 94 % (34), 94 % (36), 94 % (36), 94 % (36),
  89 % (38). 750 km hätte die 80 % auch auf den Prüfsätzen knapp gehalten (85, 81 und 82 %, 26 bis
  33 Fenster), bei halb so vielen Fenstern; 1 500 km hält sie überall mit Abstand (91 bis 95 %) und
  nennt doppelt so viele. Gewählt: 1 500 km.
- **Der Name.** Ein Kreis von 1 500 km reicht über drei bis fünf Teile der Welt; die Wahrheit im
  Kreis sagt nichts über seinen Namen. Gemessen ist darum auch, wie oft der Teil der Welt der
  Wahrheit unter den genannten ist (die Regionen der Zusammenschnitte, wie sie der Knoten zeigt,
  mit `coarseRegions` aus den Fenstern derselben Auswertungen neu gebildet; Messdatei, `names`):

  | Regionen | benannt nach | gezeigt | Wahrheit im Kreis | Teil der Wahrheit genannt | Sekunden: im Kreis / genannt |
  | --- | --- | --- | --- | --- | --- |
  | mit Referenzbild der Orte | Mitte (bisher) | 33 | 31 (94 %) | 19 (58 %) | 459 / 318 von 487 (94 / 65 %) |
  | mit Referenzbild der Orte | Kreis | 32 (2 mit einem Namen) | 30 (94 %) | 28 (88 %) | 459 / 435 von 487 (94 / 89 %) |
  | ohne Referenzbild der Orte | Mitte (bisher) | 36 | 35 (97 %) | 24 (67 %) | 580 / 446 von 606 (96 / 74 %) |
  | ohne Referenzbild der Orte | Kreis | 36 (5 mit einem Namen) | 35 (97 %) | 33 (92 %) | 580 / 556 von 606 (96 / 92 %) |

  Nach der Mitte allein hießen Hof, Rieben und Spitterfall (Deutschland) in einigen Regionen „eher
  Osteuropa“, der Bahnhof Tartu „Osteuropa“ statt Nordeuropa und die Al-Fattah-Moschee (Ägypten)
  „Westasien“; nach dem Kreis heißen sie „Westeuropa oder Osteuropa“, „Nordeuropa oder Osteuropa“
  und „Westasien oder Nordafrika“. Daneben liegt weiter der Skanderbeg-Platz in Tirana (Südeuropa):
  „Osteuropa oder Westasien“. Der Kreis bleibt derselbe; der Name trifft seltener als er (88 und
  92 % der Regionen gegen 94 und 97 %).
- **Vorbehalte.** 34 Fenster sind wenig: Das 95-%-Intervall für 32 von 34 reicht von 81 bis 98 %.
  Alle Sätze bestehen aus denselben 60 Clips bekannter Bauwerke, die vermutlich in den
  Trainingsdaten von GeoCLIP liegen; auf anonymem Material wird die Regel seltener greifen und
  seltener stimmen. Die Teile der Welt sind die der UN: Tschechien und Polen heißen dort Osteuropa.
  Die Regel für den Namen ist an denselben Regionen gewählt, an denen sie gemessen ist (90 % von
  50, 60, 70, 80 und 90 %, nach Einwohnern, Zahl der Städte oder Fläche; mit 90 % stehen fast
  immer zwei Namen).

### Räume je Abschnitt

- **Welche.** Der gezeigte Abschnitt hat die drei Räume der Ortung. Von den übrigen Abschnitten mit
  Ort bekommen die längsten einen begehbaren Raum aus ihrem Schlüsselbild, höchstens zwölf je
  Aufnahme (`FixSegment.keyframe.spaceUrl`). Zeigt die Ortung keinen Abschnitt (Fassung 12), sind
  ihre drei Räume die der ganzen Datei, und jeder Abschnitt mit Ort zählt zu den übrigen.
- **RAUM** betritt den in BEFUND gewählten Abschnitt mit seinem Sonnenstand. Unten links stehen
  Sonnenhöhe und Schattenlänge zur geschätzten Zeit („Sonne 32° · Schatten 1 : 1,6 · Richtung im
  Bild unbekannt“): Sie gelten, wohin die Kamera auch blickte. Die Sonne am Himmel und die Richtung
  des Schattens zeichnet der Raum nur mit einer Blickrichtung aus dem Horizont, und die gibt es nur
  für den gezeigten Abschnitt. Über dem Raum steht die Zeitleiste, ein Klick wechselt den
  Abschnitt (auch in BEFUND); ein Abschnitt ohne Raum nennt die Abschnitte mit Raum. „Gelände“ zeigt
  das Gelände am Ort des gewählten Abschnitts mit seiner Sonnenbahn, ohne Geländehorizont; Aufgang
  und Untergang stehen dort zu den Zeiten der Uhr in BEFUND (an der Sonnenbahn dazwischen, deren
  Punkte bei einem Abschnitt 30 Minuten auseinanderliegen). Wird im Gelände ein Abschnitt ohne Ort
  gewählt, zeigt RAUM die Ansicht aus dem Video mit dem Hinweis und den Abschnitten mit Raum; beim
  nächsten Abschnitt mit Ort ist das Gelände wieder da.
- **Gemessen** (20-Minuten-Schnitt, Knoten wie oben): 12 weitere Räume für 32 Abschnitte mit Ort in
  4,1 und 5,1 s (zwei Läufe, 0,3 bis 0,5 s je Raum); die übrigen Aufnahmen 1 bis 5 Räume in 0,4 bis
  2,4 s. In der Konsole öffnet RAUM nach der Wahl des Abschnitts 8 (Eiffelturm) dessen Raum (Bild
  153), nach der Wahl des gezeigten Abschnitts die Räume der Ortung, in beiden Sprachen und bei
  1600 × 960 und 1366 × 768 Bildpunkten. Die vollständige Ortung des 20-Minuten-Schnitts dauerte mit
  Uhrzeiten und Räumen je Abschnitt 98,3 und 105,7 s, mit Fassung 10 auf demselben Knoten 93,4 s
  (der Schritt „Abschnitte“ allein schwankte zwischen 80,6 und 85,8 s). Die Ortung als JSON wuchs von
  48 auf 140 kB (Sonnenbahnen 73 kB, Uhrzeiten 14 kB, grobe Regionen 5 kB); die Liste der Ortungen
  und die Ereignisse an die Konsole tragen die Sonnenbahnen der Abschnitte nicht. Jeder Raum belegt
  104 kB auf der Platte, zwölf weitere also 1,2 MB je Aufnahme.
- **Horizont je Abschnitt, gemessen und nicht übernommen.** Für die 12 Abschnitte mit Raum des
  20-Minuten-Schnitts kostete der Horizontabgleich, wie ihn der gezeigte Abschnitt bekommt (25
  Punkte um den Ort, nur bei höchstens 15 km Radius, sonst nur das Profil), zusammen 16,4 s Rechnung
  im Hauptthread (sechs Abgleiche zu je 1,6 bis 3,4 s) und ergab eine Blickrichtung
  (Glenfinnan-Viadukt, mittlere Abweichung 0,16°). Das ist rund doppelt so viel wie Räume und
  Uhrzeiten zusammen (7,2 und 8,8 s); der Horizont bleibt beim gezeigten Abschnitt.
- Messdatei: `docs/measurements/datum-segments-complete.json`.

### Ein erkannter Ort und unbestimmte Abschnitte

Bis Fassung 11 bekam nur eine Aufnahme mit mindestens zwei erkannten Orten eine Zeitleiste. Eine
mit einem erkannten Ort und unbestimmten Abschnitten galt als ein Ort, und oben stand die Ortung
der ganzen Datei, deren zwölf Bilder alle Teile mischen: Im End-to-End-Lauf zeigte „Stadt-Land“
(24 s Cork, dann 24 s Dorfkirche Rieben und Elstertalbrücke) nur „Gallileo, Frankfurt ± 1 500 km“,
253 km vom nächsten wahren Ort; dass die erste Hälfte in Irland spielt, sagte nur die Zeile
„2 Abschnitte, ein Ort (1 unbestimmt)“ im Ablauf. Seit Fassung 12 (`segmentVerdict` in
`apps/server/src/datum/segments.ts`):

- **Zeitleiste.** Ein erkannter Ort und mindestens ein unbestimmter Abschnitt tragen die Abschnitte
  wie mehrere Orte: jeder Abschnitt mit Ort mit eigener Uhrzeit, eigenem Sonnenstand und eigenem
  Raum, die unbestimmten mit ihren groben Regionen. Ein zweiter Ort wird nicht behauptet: die
  Ergebniskarte in ORTUNG und der Kopf des BEFUNDS sagen „1 erkannter Ort, ein Abschnitt
  unbestimmt“ („2 Abschnitte unbestimmt“), die Liste in ORTUNG und die Zeitleiste kürzer
  „1 erkannter Ort · 1 unbestimmt“, nie „mindestens 1 Orte“; die Route der Karte in ORTUNG bleibt
  Aufnahmen mit mindestens zwei Orten vorbehalten. Die Zeile unter dem Namen in der Liste und unter
  dem Ort im Kopf bricht zwischen ihren Teilen um, statt abgeschnitten zu werden (die Liste ist bei
  jeder Fenstergröße 263 Bildpunkte breit); in der Liste steht die Abweichung zur Grundwahrheit
  vor der Zahl der Orte.
- **Oben der Abschnitt**, wenn die Abschnitte des Orts zusammen mindestens ein Fünftel der Aufnahme
  umfassen (`SegmentParams.leadShare` = 0,2) und er nicht der Ort ist, den das Weltmodell für die
  ganze Datei verworfen hat. Abschnitte an diesem verworfenen Ort zählen beim Anteil nicht mit: Sie
  können nicht oben stehen, und 40 s am verworfenen Ort machen 3 s Köln in 100 s nicht zu 43 % der
  Aufnahme. Dann gilt, was für mehrere Orte gilt: Uhrzeit, Sonnenstand, die drei
  Räume und der Horizont kommen aus dem Abschnitt, die Ortung der ganzen Datei bleibt nur, wo sie
  keine 25 km von ihm liegt; ersetzt er sie, heißen ihre Belege „Ganze Datei (gemischt)“ ohne
  Gewicht („deren Bilder auch die unbestimmten Abschnitte einschließen“), und Straßenbilder werden
  nicht gefragt. Ersetzt er sie, tragen Kandidat und Land den Anteil des Orts an der ganzen
  Aufnahme, nicht an der Zeit mit Ort (Stadt-Land: Deutschland 25 %, nicht 100 %). Bleibt sie,
  bleiben auch ihre Kandidaten, ihre Länder und ihre Belege mit Gewicht: Ein Anteil an der Aufnahme
  neben ihrer Länderschätzung gäbe demselben Land zwei Zahlen (ein Eiffelturm mit 40 s unsicherer
  Fenster in 60 s: „Frankreich 33 %“ neben der Schätzung der ganzen Datei). Der Beleg: „Die
  Aufnahme zeigt einen erkannten Ort; ein Abschnitt unbestimmt; oben der Abschnitt 0:36–0:48 … der
  Abschnitt umfasst 25 % der Aufnahme (ab 20 % steht ein Ort oben). Er ersetzt die Ortung aus der
  ganzen Datei, deren Bilder auch die unbestimmten Abschnitte einschließen.“ Liegen Abschnitte am
  verworfenen Ort, sagt er, wovon der Anteil ist: „ohne den Abschnitt an dem Ort, den das Weltmodell
  für die ganze Datei verworfen hat, umfasst der Ort 20 % der Aufnahme“.
- **Sonst oben die ganze Datei**: Ort, Uhrzeit, Räume, Kandidaten, Länder und Straßenbildabgleich
  bleiben die der ganzen Datei. Der Beleg (Gewicht 0, ohne Bildnummer: er nennt keinen Abschnitt
  als den gezeigten) sagt, warum: „Der Abschnitt mit Ort (1:00–1:12: Yi-Sun-sin-Brücke, Yeosu)
  umfasst nur 13 % der Aufnahme, weniger als die 20 %, ab denen ein Ort oben steht“, oder dass er
  den verworfenen Ort nennt. Ein Anteil knapp unter der Schwelle heißt nie „20 %“ (12 s von 60,5 s:
  „nur 19 %“); einer, der sie nur in der Rechengenauigkeit verfehlt (7,2 von 36 s), zählt als ein
  Fünftel. Anteile heißen nie „0 %“ oder „100 %“, solange es einen Abschnitt mit Ort und einen
  unbestimmten gibt: 10 s Köln in 45 Minuten (0,4 %) umfassen „nur 1 %“, 1 196 von 1 200 s
  (99,7 %) „99 %“. In der Evidenz des BEFUNDS steht dieser Beleg trotz Gewicht 0 vorn, gleich nach einer
  Angabe aus der Datei mit Gewicht (GPS, Aufnahmezeit): Er erklärt, warum oben die ganze Datei
  steht, und gehört nicht unter die Referenzbilder.
- **Konsole, wenn die Ortung keinen Abschnitt zeigt.** „aus der ganzen Datei“ steht gleich nach
  dem Radius, also beim Ort und vor der Zahl der Orte: in der Ergebniskarte und der Liste in
  ORTUNG, im Kopf des BEFUNDS und in RAUM, sonst läse sich „1 erkannter Ort“ als der Ort darüber.
  BEFUND öffnet die Zeitleiste am Anfang der Aufnahme. Die Karte zeigt den Ort der ganzen Datei mit
  Kreis, Sonnen- und Schattenrichtung, Blickkegel und Linie zur Grundwahrheit neben den Abschnitten;
  sein Zeichen ist hervorgehoben, solange ein unbestimmter Abschnitt gewählt ist. Liegen er und die
  Abschnitte so weit auseinander, dass die Karte den ganzen Globus zeigt (mehr als 2 500 km), sind
  Kreis und Strahlen dort nur wenige Bildpunkte lang; ihre Beschriftungen („± 1.500 km“, „☉ 256°“,
  „Schatten“) fielen übereinander und unter das Schild des Orts und entfallen dann
  (`wholeFileShapes`); Kreis und Strahlen bleiben. Der Radius steht im Kopf, Sonnen- und
  Schattenrichtung der ganzen Datei zeigt das Polardiagramm bei einem unbestimmten Abschnitt
  (Prüfdatei „reise-96s“ aus dem End-to-End-Lauf: die Weltreise ohne ihr Busan-Stück, gefolgt von
  einem 12-s-Clip der Busan Harbor Bridge; Medina und Busan, 8 430 km). Näher, wie bei Stadt-Land
  mit 253 km, bleiben die Beschriftungen. Bei einem unbestimmten Abschnitt zeigen Uhr und
  Polardiagramm die Uhrzeit des Kopfes und sagen es („Abschnitt 1 · 0:00–0:36 · Ort unbestimmt ·
  Uhrzeit aus der ganzen Datei“); seine Bilder sind unter denen, aus denen sie geschätzt ist, eine
  eigene hat er nicht. Ein Abschnitt mit Ort zeigt
  seine eigene. In RAUM bietet jeder Abschnitt die Räume der ganzen Datei an, deren Bilder in ihm
  liegen, so dass jeder betreten werden kann. Ein unbestimmter Abschnitt bietet sie mit Ort und
  Uhrzeit der ganzen Datei an; ein Abschnitt mit Ort zuerst seinen eigenen Raum (sein Ort, seine
  Uhrzeit), dann sie (beim Darüberfahren „aus der ganzen Datei“, mit Ort, Uhrzeit und Blickrichtung
  der ganzen Datei). Ein unbestimmter Abschnitt ohne einen davon heißt in RAUM „Ort unbestimmt“,
  ohne Gelände.
- **GPS in der Datei:** unverändert keine Abschnitte; der Ablauf sagt „2 Abschnitte, ein Ort
  (1 unbestimmt), GPS der Datei gilt“.

**Gemessen** am 19. November 2026: Fenster, Abschnitte und grobe Regionen mit `segments.ts` der
Fassung 11 aus den gespeicherten Auswertungen neu gerechnet, die Ortung der ganzen Datei auf dem Weg
der Engine (zwölf Bilder der Datei, Weltmodell, Galerie; auf 13 von 13 Aufnahmen gleich der des
Knotens), mit Referenzbild der Orte in der Galerie und ohne („ohne Ref.“). Maß: je Sekunde der
Abstand des Orts oben zum wahren Ort dieser Sekunde, gemittelt über die Aufnahme. Betroffen sind
7 Fälle: von den 60 Referenzclips nur datum-004 (Rheinbrücke Leverkusen, zwei Fenster; 58 Clips
haben ein Fenster, datum-044 zwei ohne Ort), mit wie ohne Referenzbild; von den Zusammenschnitten
nur „3 Orte“ ohne Ref. (die übrigen zeigen mindestens zwei Orte oder sind ein Abschnitt); von den
End-to-End-Dateien Stadt-Land, ohne Ref. auch die Weltreise (zweimal: „Weltreise-Zeit“ ist
dasselbe Video).

| Fall | Anteil des Orts | oben bis Fassung 11 | oben mit Fassung 12 | km je Sekunde (Mittel) 11 → 12 | Abschnitt immer oben |
| --- | --- | --- | --- | --- | --- |
| datum-004, mit und ohne Ref. | 42 % | Deutschherrnbrücke, Frankfurt | Zoobrücke, Köln | 160 → 9 | 9 |
| Stadt-Land | 25 % | Gallileo, Frankfurt | Elstertalbrücke, Hof ± 7 500 km | 765 → 768 (Median 382 → 192) | 768 |
| Stadt-Land ohne Ref. | 25 % | St. Marien, Osnabrück | Deutschherrnbrücke, Frankfurt | 734 → 765 | 765 |
| Weltreise (und -Zeit) ohne Ref. | 13 % | Medina | Medina | 6 936 → 6 936 | 9 667 |
| 3 Orte ohne Ref. | 28 % (am verworfenen Ort) | Vereinigtes Königreich | Vereinigtes Königreich | 2 155 → 2 155 | 2 155 |

- **Über die 7 Fälle** im Mittel 2 550 km bis Fassung 11, 2 511 km mit Fassung 12; auf 25 km genau
  5 → 37 % der Sekunden, auf 200 km 33 → 40 %. Besser in 2 Fällen (datum-004), schlechter in 2
  (Stadt-Land +3 km, ohne Ref. +31 km), gleich in 3. Bei Stadt-Land liegt die Elstertalbrücke für
  0:36–0:48 0 km und für Rieben 192 statt 382 km neben der Wahrheit, für die Hälfte in Cork aber
  1 440 statt 1 212 km; die Zeitleiste nennt dafür „Nordeuropa oder Westeuropa“.
- **Die Zeitleiste stimmt:** Wo sie einen Ort nennt, liegt die Wahrheit in seinem Kreis (91 von
  91 s), wo sie eine grobe Region nennt, in ihr (176 von 176 s); 165 s bleiben ohne Angabe. Nur die
  Zeitleiste, mit dem Ort oben wie bisher, hätte den Ort oben in allen 7 Fällen gelassen; Kopf und
  Zeitleiste hätten bei Stadt-Land zwei 253 km entfernte Orte genannt, ohne ein Wort dazu.
- **Warum ein Fünftel.** Den Abschnitt immer oben zu zeigen, wie bei mehreren Orten, setzte 12 s
  einer Brücke in Yeosu über eine Weltreise von 96 s: im Mittel 2 731 km je Sekunde schlechter,
  über die 7 Fälle 3 292 km. Geprüfte Bedingungen statt des Anteils trafen dieselben Fälle wie
  „immer“ (Radius der ganzen Datei mindestens 1 500 km, unbestimmt mindestens ein Drittel der
  Aufnahme), kosteten ohne zu helfen (Radius der ganzen Datei nicht kleiner als der des Abschnitts:
  2 besser, 3 schlechter; unbestimmt mindestens 12 s: 0 besser, 4 schlechter; keine grobe Region am
  Ort: 0 besser, 2 schlechter) oder ruhten auf nichts (nur die Stufen „stark“ und „erkannt“: Die
  Stufe „erkannt“ ist mit ± 7 500 km weiter kalibriert als „ähnlich“ mit ± 1 500 km). Jeder Anteil
  über 12,5 % bis 25 % ergibt dieselben Ergebnisse; 0,2 liegt zwischen den beiden Aufnahmen, die
  entscheiden (Weltreise ohne Ref., Stadt-Land), und ruht allein auf ihnen. Der nächste
  End-to-End-Lauf soll ihn nachprüfen.
- **Im Knoten** (eine Kopie der Fassung 12 auf eigenem Port, Stadt-Land hochgeladen): oben
  „Elstertalbrücke, Hof ± 7 500 km“, Uhrzeit „Morgen“ aus 0:36–0:48, die drei Räume aus
  0:38–0:45, Kandidat und Land mit 25 %; mit auf 0,3 gesetzter Schwelle neu geortet (25 % < 30 %)
  oben wieder „Gallileo, Frankfurt“ mit Uhrzeit und Räumen der ganzen Datei, der Abschnitt mit Ort
  mit eigener Uhrzeit und eigenem Raum. Die Konsole las sich in beiden Fällen in Deutsch und
  Englisch wie oben beschrieben.
- Messdatei: `docs/measurements/datum-segments-one-place.json`.

### Grenzen der Abschnitte

- Orte näher als 25 km gelten als einer (Eiffelturm und Triumphbogen, Mexiko-Stadt). Orte, die das
  Weltmodell derselben Gegend zurechnet, ebenfalls, auch wenn sie Hunderte Kilometer auseinander
  liegen: Das schützt vor falschen Teilungen und kostet Orte. Der Beleg sagt dann „mindestens“ und
  wie viele Orte so zusammengefasst sind; zwei klar herausstechende Wiedererkennungen (Glenfinnan
  und Rhuddlan Castle, 418 km) fasst das Weltmodell nicht zusammen. Auf den gemessenen Fenstern
  ändert keine dieser Regeln (Kette, Ausnahme, Vergleich mit den Nachbarankern) die Zahlen oben;
  bei „3 Orte“ steht nun „mindestens 2“, denn Kyffhäuser und Glenfinnan sind ein zusammengefasster
  Ort.
- Uhrzeit und Sonnenstand gibt es je Abschnitt mit Ort, Blickrichtung und Geländehorizont nur
  für den gezeigten Abschnitt, Räume für höchstens 13 Abschnitte (den gezeigten mit drei, die zwölf
  längsten übrigen mit je einem). Zeigt die Ortung keinen Abschnitt (Fassung 12), haben die zwölf
  längsten Abschnitte mit Ort je einen eigenen Raum, und die drei Räume der ganzen Datei mit ihrer
  Blickrichtung und ihrem Horizont bietet der Abschnitt an, in dem ihr Bild liegt: höchstens 15
  Abschnitte mit Raum, auch unbestimmte. Unbestimmte Abschnitte haben keine Uhrzeit; eine grobe Region
  nennen sie nur, wo Galerie und Weltmodell übereinstimmen (42 % der unbestimmten Zeit der
  Zusammenschnitte), und sie ist mit 1 500 km eine Angabe über einen Teil der Welt, keine Ortung.
- Ein erkannter Ort mit unbestimmten Abschnitten steht nur oben, wenn er mindestens ein Fünftel der
  Aufnahme umfasst (ohne seine Abschnitte am verworfenen Ort). Darunter steht oben die Ortung der
  ganzen Datei, die alle Teile mischt (Weltreise ohne Ref.: Medina, im Mittel 6 936 km neben der
  Wahrheit); dass die Aufnahme mehr zeigt, sagen dann Zeitleiste, Beleg und „aus der ganzen Datei“
  in ORTUNG, im Kopf des BEFUNDS und in RAUM. Darüber steht oben der
  Abschnitt, auch wenn die unbestimmten Abschnitte weit entfernt spielen: Stadt-Land zeigt die
  Elstertalbrücke, 1 440 km neben der Hälfte in Cork. Die Schwelle 0,2 ruht auf zwei verschiedenen
  Aufnahmen. Mit GPS in der Datei gibt es keine Zeitleiste und für einen einzigen erkannten Ort
  keinen eigenen Beleg; die Referenzbilder der ganzen Datei nennen ihren Abstand zum GPS.
- Unbestimmte Abschnitte fassen weit entfernte Orte zusammen (Weltreise: Tschechien und Italien in
  einem Abschnitt; Stadt-Land: Rieben im Abschnitt mit Cork, weil das erste Fenster 0 bis 30 s
  reicht), weil benachbarte Fenster ohne Antwort zu einem Abschnitt werden.
- Ohne Weltmodell (abgeschaltet oder seine Ortsgalerie wird noch berechnet) entscheiden die
  Fenster allein mit der Galerie; die Schwelle 0,8 ist für das Zusammenspiel mit dem Weltmodell
  gemessen. Eine lange Aufnahme (mehr als sechs Szenen) fragt das Weltmodell nicht weiter, sobald
  eine Arbeit vorgeht: im Hintergrund jede für die Aufnahme einer Person (dann endet auch die
  Galeriesuche, die übrigen Fenster bleiben unbestimmt), sonst die Schnellortung eines neuen
  Uploads. Die Galeriesuche der Aufnahme einer Person läuft zu Ende (bei 160 Fenstern unter Last
  bis etwa eine Minute); so lange wartet eine Schnellortung noch.

## Abgleich mit Straßenbildern

Nach einer klaren Wiedererkennung (ein Referenzbild sticht aus den übrigen Treffern heraus, Kreis
3 km) holt die vollständige Ortung freie Straßenbilder im Umkreis von 3 km um den Ort, rechnet sie
mit demselben Bildmodell ein wie die Bilder des Videos und vergleicht jedes mit jedem. Ein
Straßenbild zählt nur, wenn es sich deutlich vom typischen Bild derselben Gegend abhebt. Dann
rückt der Ort an dieses Bild, die Methode heißt „Abgleich mit Straßenbildern“, und die
passenden Bilder stehen vorn in den Belegen, mit Ähnlichkeit, Abstand zum Ort, Namensnennung und
„Quelle öffnen“. Ohne Treffer bleibt der Ort, wie er ist, und ein Beleg ohne Gewicht sagt, warum.

- **Dienste.** Panoramax, ohne Schlüssel; dicht vor allem in Europa, am dichtesten in
  Frankreich, anderswo dünn. Mapillary, weltweit, nur mit einem kostenlosen Schlüssel
  ([Mapillary-Schlüssel](#mapillary-schlüssel)). Bilder ohne Lizenz oder mit einer nicht
  kommerziellen Lizenz werden übergangen.
- **Wann nicht.** Nie in der Schnellortung. Nicht bei GPS in der Datei, nicht bei einer Länder-
  oder Kontinentantwort, nicht bei einer knappen Wiedererkennung und nicht bei einer Antwort des
  Weltmodells (die beiden letzten sind gemessen und abgelehnt, siehe unten). Nicht mit
  `SICHT_OFFLINE=1`.
- **Zeit.** Höchstens 20 s je Ortung; spätestens 0,5 s danach bricht der Knoten die Stufe ab und
  rechnet ohne sie weiter. Sie läuft neben dem Aufbau der Räume; die Ortung wartet nur, wenn sie
  länger braucht als diese. Über 40 Aufrufe dauerte sie 0,7 bis 14,1 s; die 20 s wurden nie
  erreicht.
- **Störungen.** Ist ein Dienst nicht erreichbar, antwortet er mit 429 oder gar nicht, wird die
  Ortung trotzdem fertig: Der Beleg sagt „nicht abrufbar“, der Ort bleibt.

### Gemessen

Am Referenzbestand, mit den Antworten, die der Knoten selbst gibt, wenn die Galerie Referenzbilder
der Orte enthält (so läuft der Knoten voreingestellt). Nur Panoramax: Auf dem Messrechner lag kein
Mapillary-Schlüssel vor, Mapillary ist nicht gemessen.

| Antwort der Galerie | Antworten | Wahrheit im Umkreis von 3 km | genug Straßenbilder | Treffer | falsch festgelegt |
| --- | --- | --- | --- | --- | --- |
| klare Wiedererkennung (wird abgeglichen) | 8 | 8 | 5 | 1 | 0 |
| knappe Wiedererkennung (wird nicht abgeglichen) | 3 | – | – | 1 | 1 |

- Der eine Treffer: Berliner Fernsehturm, von 0,99 km auf 0,32 km neben der Wahrheit.
- Die knappe Wiedererkennung wird nicht abgeglichen, weil ihr einziger Treffer falsch war: Für
  den Bahnhof Berlin-Lichterfelde hatte die Galerie einen ähnlichen Bahnhof 20,5 km entfernt
  gewählt und ehrlich ±7 500 km angegeben. Der Abgleich hätte ihn dort mit 1 km Kreis und einer
  Sicherheit von 0,73 festgelegt. Derselbe falsche Treffer tritt auch auf, wenn das Referenzbild
  des Ortes aus der Galerie genommen ist. Der Maßstab war höchstens ein falscher Treffer auf zehn.
- Antworten des Weltmodells werden nicht abgeglichen. Gemessen wurde der Abgleich 3 km um seinen
  besten Ort, wenn mindestens 20 % seiner Wahrscheinlichkeit im Umkreis von 25 km lagen:
  Abstimmungshälfte 4 Antworten, 2 mit genug Bildern, 1 Treffer (Cusco, 0,49 km neben der
  Wahrheit), kein falscher; Prüfhälfte 5 Antworten, 3 mit genug Bildern, 1 Treffer, und der war
  falsch (İstiklal: 1,91 km neben der Wahrheit mit 1 km Kreis, wo das Weltmodell allein 0,96 km
  daneben lag, mit 25 km Kreis). Beide Treffer rückten den Punkt von der Wahrheit weg und
  verengten nur den Kreis. Die Regel zum Einschalten (mindestens zehn Treffer auf der
  Abstimmungshälfte) wurde verschärft, nachdem die Prüfhälfte gesehen war; das steht in der
  Messdatei (`looserCriterion`).
- Von Anfang bis Ende im Knoten (Arc de Triomphe, Paris, klare Wiedererkennung): 65 Bilder von
  Panoramax verglichen, kein Treffer (Abstand des besten Bildes 0,09, nötig 0,10), Stufe 7,8 s.
- Ein Treffer bei fünf Orten mit genug Bildern ist eine Beobachtung, keine belastbare Quote.

Messdateien: `docs/measurements/datum-streetlevel-open.json`,
`docs/measurements/datum-streetlevel-worldmodel.json`, `docs/measurements/datum-streetlevel-e2e.json`;
nachmessbar mit `pnpm --filter @sicht/server datum:streetlevel --worldmodel` (mit `--mode open` für
den Fall mit Referenzbildern in der Galerie).

### Abschalten

- In der Konsole: ORTUNG, „Einstellungen“ (oder MESSUNG, „Einstellungen der Ortung“), Schalter
  „Straßenbildvergleich“. Nur die Leitung kann ihn umlegen; der Eintrag im Protokoll lautet
  „Straßenbildvergleich ausgeschaltet“.
- Für eine Installation, die niemanden fragen darf: `DATUM_STREETLEVEL=0` in der Umgebung
  (ebenso `false`, `off`, `no`, `nein`, `aus`). Das gilt, gleich was in der Konsole steht; die
  Konsole zeigt dann „durch die Umgebung abgeschaltet“.
- `SICHT_OFFLINE=1` schaltet den Abgleich ebenfalls ab.

### Datenschutz

- **Vom Video verlässt nichts den Knoten**: keine Datei, kein Bild, kein Vektor, kein
  Dateiname. Die Straßenbilder kommen zum Knoten, verglichen wird dort.
- **Wer was erfährt.** Panoramax (der Suchdienst `api.panoramax.xyz` und die Server der
  Instanzen, von denen die Bilder kommen) erfährt ein Gebiet von einigen Kilometern um den
  erkannten Ort und die Netzadresse des Knotens. Mapillary erfährt dasselbe und über den
  Schlüssel das Konto, dem er gehört. Daraus lässt sich ablesen, dass von diesem Anschluss aus
  diese Gegend untersucht wird. Die Kennung der Anfragen ist allgemein (`DATUM/0.5`) und nennt
  keine Person.
- **Bilder über den Knoten.** Die Konsole lädt Straßenbilder nur über den Knoten
  (`/api/datum/fixes/<id>/street/<n>`), nie direkt vom Dienst; der Browser der Auswertenden
  spricht die Dienste nicht an. Der Knoten hält die Bilder nur im Arbeitsspeicher (höchstens 64
  Bilder oder 20 MB, eine Stunde) und legt sie nie auf der Platte ab. Auf der Platte bleiben nur
  die Vektoren der verglichenen Bilder (`.cache/datum/streetlevel/`), damit derselbe Ort nicht neu
  gerechnet wird, und in der Ortung Kennung, Lage, Adresse und Namensnennung der besten Bilder.
- **Abruf nur, was in einer Ortung steht.** Der Knoten holt nur Bildadressen, die er selbst in
  einer Ortung gespeichert hat, nur über HTTPS von öffentlichen Adressen, mit höchstens zwei
  Weiterleitungen, höchstens 3 MB und nur JPEG, PNG oder WebP.
- **„Quelle öffnen“** öffnet die Seite des Bildes beim Dienst erst auf Klick, im Browser der
  Person.

### Namensnennung

Jedes Straßenbild trägt Urheber, Lizenz und Dienst, etwa „© Name, CC BY-SA 4.0, Panoramax“. Die
Konsole zeigt diese Zeile immer unter dem Bild, auch vergrößert. Panoramax-Bilder stehen meist
unter CC BY-SA 4.0 oder der Licence Ouverte 2.0, Mapillary-Bilder unter CC BY-SA 4.0. Ein
Urhebername, der eine E-Mail-Adresse enthält, wird bei Panoramax durch den Namen der Instanz
ersetzt und bei Mapillary weggelassen.

### Mapillary-Schlüssel

Ohne Schlüssel fragt der Knoten nur Panoramax. Für Mapillary genügt ein kostenloser
Client-Token:

1. Auf mapillary.com anmelden (ein kostenloses Konto genügt).
2. Dashboard → Developers → eine Anwendung registrieren.
3. Den „Client Token“ der Anwendung kopieren (er beginnt mit `MLY|`).
4. In der Konsole als `leitung`: ORTUNG → „Einstellungen“ → „Mapillary-Schlüssel“, einfügen,
   „Hinterlegen“. Oder den Knoten mit der Umgebungsvariable `MAPILLARY_TOKEN` starten; dann ist
   das Feld in der Konsole gesperrt und zeigt „aus der Umgebung“.

Der Knoten legt einen hinterlegten Schlüssel in `<Datenordner>/datum/mapillary-key` ab, wo das
Betriebssystem es kennt nur für den Besitzer lesbar. Der Schlüssel erscheint in keiner Antwort,
keinem Protokolleintrag (dort steht nur „Mapillary-Schlüssel hinterlegt“ oder „entfernt“), keiner
Zeile des Logs und keiner Fehlermeldung; die Konsole zeigt nur, ob einer da ist. Er gehört nie
ins Repository, in eine Knotendatei oder in ein Startskript, das eingecheckt wird; `.gitignore`
schließt `mapillary-key` aus. „Entfernen“ in der Konsole löscht ihn.

## Google Street View und Google Maps

Google kommt nur als Verweis vor, den eine Person anklickt. „In Street View prüfen“ und „In
Google Maps öffnen“ öffnen Google in einem neuen Fenster des Browsers und übergeben dabei die
Koordinaten. Erst mit diesem Klick erfährt Google den Ort. Der Knoten ruft keine Bilder von Google
ab und gleicht nichts automatisch mit Bildern von Google ab: Die Nutzungsbedingungen der Google
Maps Platform verbieten das.

## Geschwindigkeit

Ziel: eine erste Ortung innerhalb etwa einer Minute nach dem Hochladen, die vollständige in
kürzerer Zeit, als das Video lang ist. Gemessen mit einem 20 Minuten langen Video (ein Referenzclip
in Schleife) auf einem eigenen Knoten mit vier Kernen ohne Grafikkarte. Der Rechner war dabei
durch andere Arbeiten belastet (Last 2,5 bis 6,2 auf vier Kernen); alle Zeiten sind Obergrenzen.

| Lauf | Schnellortung nach dem Hochladen | vollständige Ortung nach dem Hochladen |
| --- | --- | --- |
| mit Weltmodell, frisch gestarteter Knoten | 11,7 s (Wiederholung 11,0 s) | 285 s |
| ohne Weltmodell, frisch gestarteter Knoten | 7,7 s | – |
| mit Weltmodell, zweites Video | 7,2 s | – |
| ohne Weltmodell, zweites Video | 4,1 s | – |
| mit Weltmodell und Straßenbildern, Arc de Triomphe | 10,8 s | 280,5 s |
| mit Weltmodell, Fernsehturm (Straßenbilder nach der Regel nicht gefragt) | 7,0 s | 287,3 s |

- **Schnellortung.** Das Weltmodell beginnt, sobald die zwölf Bilder gelesen sind, und läuft
  neben dem Bildmodell. Es verlängert die Schnellortung um etwa 3 s; selbst rechnet es 5,2 bis
  5,7 s in seinem Thread.
- **Vollständige Ortung.** Fast die ganze Zeit bis dahin braucht die Auswertung des Videos (Arc
  de Triomphe: 258 s). Die Ortung danach dauerte 3,0 s ohne Straßenbilder, davon 0 ms für das
  Weltmodell, dessen Antwort aus der Schnellortung übernommen wird. Mit Straßenbildern (Arc de
  Triomphe) 10,8 s, davon die Straßenbildstufe 7,8 s; die Ortung wartete 6,1 s länger als auf
  die Räume.
- **Ein früherer Lauf** derselben Messung, von außen abgebrochen: Schnellortung 16,1 s,
  vollständige Ortung 368,1 s, Straßenbildstufe 13,8 s; eine Antwort 503 von Panoramax wurde
  übergangen, ohne die Ortung zu stören.
- **Threads.** Bildmodell, Gesichtserkenner und Tiefenmodell rechnen in eigenen Threads, einer
  nach dem anderen und jeder mit allen Kernen. Das Weltmodell rechnet in einem eigenen Thread
  mit der Hälfte der Kerne (2 von 4; `DATUM_GEOCLIP_THREADS` ändert das), damit höchstens das
  1,5-Fache der Kerne beschäftigt ist. Mit 4 Threads war es allein kaum schneller (2,74 statt
  2,96 s für zwölf Bilder) und bremste das Bildmodell stärker; neben den Ausschnitten des
  Bildmodells waren beide mit 2 Threads nach 4,9 s fertig statt nach 6,2 s nacheinander. Der
  Hauptthread ist je Antwort des Weltmodells 0,6 bis 1,9 ms beschäftigt.
- **Antwortzeit des Knotens** während der Messung mit Straßenbildern (eine Abfrage alle 200 ms,
  2 790 Abfragen, keine fehlgeschlagen): Median 1,3 ms, 95 % bis 7,0 ms, 99 % bis 35,6 ms. Die
  größten Ausreißer, 300 bis 490 ms und einmal 871,8 ms, fielen in die Schnellortung, in jedem
  Lauf, auch ohne Weltmodell: Galeriesuche und Entpacken der Bilder liefen bei diesen Messungen
  im Hauptthread. Zwischen Schnellortung und vollständiger Ortung, mit der Straßenbildstufe,
  lag der höchste Wert bei 261,7 ms. Die Galeriesuche läuft inzwischen in einem eigenen Thread;
  nachgemessen ist das hier nicht.
- **Fassung 7 des Verfahrens** (Weltmodell). Ortungen einer älteren Fassung rechnet der Knoten
  beim nächsten Start im Hintergrund neu, je Ortung etwa 5 bis 15 s. Die alte Ortung bleibt
  sichtbar, bis die neue da ist. Ist der Abgleich mit Straßenbildern eingeschaltet, fragt der
  Knoten dabei bei jeder Ortung mit klarer Wiedererkennung einmal Panoramax, höchstens 20 s lang.
- Die Galerie liegt als mitgelieferte Vektoren bei und lädt in unter einer Sekunde.

## Grauzone und Grenzen der Nutzung

DATUM ortet Aufnahmen, nicht Personen. Derselbe Dienst kann aber auch den Ort einer Person
verraten, die gefilmt hat. Deshalb bleibt aus der Vorgängerplattform: Jede Auswertung braucht
ein Mandat mit Zweck, jede Abfrage steht im Protokoll, Gesichter werden beim Einspielen
maskiert, Gesichtserkennung gibt es nicht. Ein Vertrag mit einer Behörde muss den Einsatz gegen
Journalistinnen, Oppositionelle und Filmende ohne Rechtsgrundlage ausschließen, und die
Lieferung an Staaten ohne Rechtsstaat. Die Ausfuhr von Überwachungstechnik aus der EU kann
genehmigungspflichtig sein (EU-Dual-Use-Verordnung); das ist vor jeder Lieferung zu prüfen.

Der Abgleich mit Straßenbildern verrät freien Bilddiensten, welche Gegend untersucht wird
(Abschnitt [Datenschutz](#datenschutz)). Wo schon das nicht sein darf, bleibt er abgeschaltet.

## Was gemessen ist

Referenzbestand: 60 Videos aus Wikimedia Commons in 30 Ländern (16 aus Deutschland), deren
Wikidata-Objekt eine Koordinate trägt. Die Videos gehen unter neutralen Namen (`datum-001.mp4`)
in den Knoten; der Ort wird erst nach der Ortung zum Vergleich dazugelegt. Galerie: 6 393
Referenzbilder von Wikidata-Objekten mit Koordinate. Jeder Ort trägt seinen deutschen und seinen
englischen Namen aus Wikidata (`labelDe`, `labelEn` in `gallery.json` und `manifest.json`;
`pnpm datum:fetch` holt fehlende einmal nach, `pnpm datum:labels` allein), damit eine Ortung
„Nowodewitschi-Kloster, Moskau“ und „Novodevichy Convent, Moscow“ heißt, statt die Sprachen zu
mischen. Je Video zwölf Bilder, jedes als Ganzes und
in drei quadratischen Ausschnitten (so legt die Analyse sie ohnehin ab). Die Schwellen und Radien
der Ortung wurden nur an der einen Hälfte der Videos eingestellt (Abstimmungshälfte, gerade
Nummern); die andere Hälfte (Prüfhälfte, ungerade Nummern) wurde nur gemessen. Gemessen am
18. November 2026 mit `pnpm datum:evaluate --params default` (die Parameter der Galerie so, wie
der Knoten sie verwendet; das Weltmodell in int8 über seinen eigenen Thread). Einzelwerte in
`docs/measurements/datum-geolocation.json`, Zusammenfassung mit Zeiten in
`docs/measurements/datum-worldmodel.json`.

| Fall | Hälfte | Median | ≤ 1 km | ≤ 25 km | ≤ 200 km | ≤ 750 km | ≤ 2 500 km | Land richtig |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ort ohne Referenzbild, nur Galerie | Prüfhälfte (30) | 936,9 km | 0 % | 13 % | 23 % | 43 % | 60 % | 33 % |
| Ort ohne Referenzbild, mit Weltmodell | Prüfhälfte (30) | 267,8 km | 10 % | 33 % | 43 % | 77 % | 93 % | 60 % |
| Ort ohne Referenzbild, nur Galerie | Abstimmungshälfte (30) | 739,8 km | 0 % | 17 % | 27 % | 50 % | 60 % | 43 % |
| Ort ohne Referenzbild, mit Weltmodell | Abstimmungshälfte (30) | 164,6 km | 13 % | 33 % | 53 % | 63 % | 87 % | 53 % |
| Referenzbild des Ortes in der Galerie, nur Galerie | Prüfhälfte (30) | 433,6 km | 27 % | 43 % | 47 % | 53 % | 67 % | 37 % |
| Referenzbild des Ortes in der Galerie, mit Weltmodell | Prüfhälfte (30) | 20,5 km | 27 % | 53 % | 57 % | 77 % | 93 % | 57 % |
| Referenzbild des Ortes in der Galerie, nur Galerie | Abstimmungshälfte (30) | 267,6 km | 23 % | 37 % | 43 % | 63 % | 70 % | 43 % |
| Referenzbild des Ortes in der Galerie, mit Weltmodell | Abstimmungshälfte (30) | 116,7 km | 23 % | 40 % | 53 % | 67 % | 87 % | 53 % |

Frühere Stufen, Prüfhälfte (30):

| Fall | Median | ≤ 1 km | ≤ 25 km | ≤ 200 km | ≤ 750 km | ≤ 2 500 km | Land richtig |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Nur Länderschätzung, ohne Galerie | 1 445 km | 0 % | 0 % | 13 % | 40 % | 57 % | 37 % |
| Sechs ganze Bilder ohne Ausschnitte, Referenzbild in der Galerie | 233 km | 40 % | 47 % | 50 % | 60 % | 80 % | 43 % |
| Sechs ganze Bilder ohne Ausschnitte, Ort unbekannt | 751 km | 0 % | 17 % | 27 % | 47 % | 70 % | 37 % |

Einordnung:
- Das Weltmodell trägt dort, wo die Galerie nichts kennt. Bei Orten ohne Referenzbild stieg auf
  der Prüfhälfte der Anteil auf 2 500 km genau von 60 auf 93 %, auf 25 km genau von 13 auf 33 %,
  das richtige Land von 33 auf 60 %. Auf 1 km genau bleibt es selten (10 %).
- Vorbehalt: Die Referenzvideos zeigen bekannte Bauwerke, deren Fotos vermutlich in den
  Flickr-Trainingsdaten von GeoCLIP liegen. Auf anonymem Straßenmaterial, in Innenräumen oder in
  Landschaften ohne Wahrzeichen wird es schlechter abschneiden; gemessen ist das nicht.
- Die Wiedererkennung trägt weiter die genauen Ortungen. Liegt ein Bild desselben Bauwerks in der
  Galerie, ortet DATUM gut ein Viertel der Videos auf einen Kilometer genau, mit und ohne
  Weltmodell.
- Die Wahrheit liegt jetzt häufiger im angegebenen Kreis. Der Radius hängt von der Belegstufe ab
  und ist auf der Abstimmungshälfte so gewählt, dass die Wahrheit in 70 % der Fälle im Kreis
  liegt. Mit Weltmodell lag sie auf der Prüfhälfte in beiden Fällen in 90 % im Kreis (nur
  Galerie: 67 % bei bekannten, 60 % bei unbekannten Orten). Ehrlich heißt hier groß: 3 km nur,
  wenn ein Referenzbild klar aus den übrigen Treffern heraussticht; 25 km bei einer gebündelten
  Antwort des Weltmodells; sonst 1 500 km; 7 500 km bei einer knapperen Wiedererkennung, weil
  gerade diese oft ein ähnliches Bauwerk auf einem anderen Kontinent ist; bei einer Länderantwort
  das Dreifache der Landesgröße.
- Wie die Kreise des Weltmodells gewählt sind: Die gebündelte Stufe (mindestens 20 % der
  Wahrscheinlichkeit im Umkreis von 25 km) hatte auf der Abstimmungshälfte nur 5 Fälle mit
  Abweichungen von 0,06, 0,08, 0,42, 0,42 und 888 km; 1 km und 25 km deckten beide 80 % ab, bei
  Gleichstand gilt 25 km. Die übrige Stufe bleibt bei 1 500 km und deckt 67,7 % ihrer 31 Fälle
  ab; die 70-%-Regel allein hätte 2 000 km ergeben.
- Die Sicherheitsangabe ist auf der Prüfhälfte vorsichtig: im Mittel 0,79 bei einer Trefferquote
  von 0,90 (auf der Abstimmungshälfte beide 0,783). Der logarithmische Verlust auf der Prüfhälfte
  fiel von 0,59 auf 0,32.
- 30 Videos je Hälfte sind wenig; die Anteile schwanken um rund neun Prozentpunkte. Die
  Gewinne bei Orten ohne Referenzbild auf 25 km, 2 500 km und beim Land sind größer als diese
  Schwankung; bei bekannten Orten auf 25 km (43 auf 53 %) liegt der Gewinn in ihrer Größe, auf
  1 km gibt es keinen.
- Die Ausschnitte haben die Treffsicherheit nicht messbar verbessert. Auf der Abstimmungshälfte
  stieg das Abstimmungsmaß (Mittel der fünf Trefferquoten über beide Fälle) von 0,377 auf 0,403,
  auf der Prüfhälfte fielen die Werte (bekannter Ort auf 1 km genau: 27 statt 40 %). Beides liegt
  innerhalb der Schwankung von 30 Videos; nach der Regel der Messung gilt das Verfahren, das auf
  der Abstimmungshälfte vorn lag, und die Prüfhälfte steht hier so, wie sie gemessen wurde.
- Geprüft und verworfen: eine breitere Galerie. 11 552 weitere Bilder von Wikidata-Objekten aus
  aller Welt (nach Bekanntheit und Klasse gewählt, über die Kontinente verteilt, unabhängig von
  den Orten der Videos; zusammen 17 945) senkten das Abstimmungsmaß von 0,403 auf 0,283. Mehr
  ähnlich aussehende Bauwerke verdrängen das richtige, etwa die Krimbrücke durch eine Brücke in
  Indien (Kosinus 0,88 gegen 0,84). Nur Bauwerke: 0,313, nur Orte und Landschaften: 0,357. Die
  Galerie bleibt bei 6 393 Bildern; `fetchDataset.ts --extend` wiederholt den Versuch.
- `pnpm datum:evaluate` ohne `--params default` stimmt die Parameter der Galerie neu ab und
  trifft dabei nicht die Werte, mit denen der Knoten läuft (Prüfhälfte, Ort ohne Referenzbild,
  nur Galerie: 0, 7, 17, 43, 67 %). Die Werte oben sind mit `--params default` gemessen; die neu
  abgestimmten wurden nicht übernommen.
- Die Länderschätzung allein trifft das Land in 38 % der Fälle (unter den ersten fünf Ländern in
  67 %).
- Zum Vergleich ohne Anspruch auf Gleichwertigkeit: Veröffentlichte Verfahren mit großen
  Galerien und eigens trainierten Modellen erreichen auf öffentlichen Prüfsätzen deutlich
  höhere Werte. DATUM arbeitet mit einem allgemeinen Bild-Text-Modell, 6 393 Referenzbildern und
  dem veröffentlichten GeoCLIP ohne eigenes Training.
- Der Knoten ortet mit denselben Bildern wie die Messung: zwölf Bilder aus der Mitte gleich
  langer Abschnitte, je als Ganzes und in drei Ausschnitten. Mit den Bildern der Analyse (ab
  Sekunde 0 im Takt der Auswertung) wich er früher in 13 von 60 Fällen ab; seit der Umstellung
  stimmten Knoten und Messung vor dem Weltmodell in allen 60 Fällen überein. Für das Weltmodell
  ist an 3 Videos geprüft, dass die Vektoren der Bilder des Knotens bitgleich mit denen der
  Messung sind.
- Die Uhrzeit hat keine Grundwahrheit: Die Videos aus Commons tragen nach der Umwandlung keine
  Aufnahmezeit mehr. Geprüft ist die Rechnung (Sonnenstand gegen veröffentlichte Werte auf die
  Minute, Zeitzonen, Fenster aus der Sonnenhöhe), nicht die Treffsicherheit bei echten Videos.
  Tag und Nacht unterscheidet die Lichtschätzung zuverlässig, die Sonnenhöhe nur grob.
- Geprüft und verworfen: die Lichtrichtung aus der Schattierung der rekonstruierten Flächen. Auf
  künstlichen Szenen trifft sie die Richtung auf 12°, auf echten Bildern meldete sie bei bedecktem
  Himmel in 16 von 28 Fällen Sonne. Sie fließt deshalb nicht in die Uhrzeit ein
  (`apps/server/src/datum/shading.ts` bleibt mit seinen Tests als Versuch im Repository).

## Grenzen

- „Überall auf der Erde“ heißt: eine Region überall, keine Straße überall. Ohne Referenzbild lag
  der Median auf der Prüfhälfte bei 267,8 km, ein Drittel der Videos auf 25 km genau. Der Kreis
  des Weltmodells ist entsprechend groß (25 oder 1 500 km).
- Straßengenau wird es nur, wo es freie Straßenbilder gibt und der Ort sich von seiner Umgebung
  abhebt, und nur nach einer klaren Wiedererkennung. Panoramax ist außerhalb Europas dünn;
  Mapillary braucht einen Schlüssel und ist nicht gemessen. Im Referenzbestand: ein Treffer bei
  fünf Orten mit genug Bildern.
- Die Wiedererkennung findet nur, was der Galerie ähnlich sieht. Ein Ort ohne Wahrzeichen wird
  vom Weltmodell auf eine Region geschätzt, ohne Weltmodell höchstens auf ein Land oder einen
  Kontinent.
- Die Messung zeigt bekannte Bauwerke, die vermutlich in den Trainingsdaten von GeoCLIP liegen.
  Anonymes Material wird schlechter abschneiden.
- Die Uhrzeit folgt aus der Sonnenhöhe; Vormittag und Nachmittag sind daraus allein nicht zu
  unterscheiden, die Konsole zeigt dann beide Fenster.
- Der Raum ist aus einem Bild geschätzt: geometrisch plausibel, nicht vermessen. Was im Bild
  verdeckt ist, fehlt im Raum.
- Die Horizontprüfung braucht markantes Gelände und Höhendaten am Ort; im Flachland greift sie
  nicht. Sie bestätigt nicht den Ort, sondern setzt ihn voraus: Liegt die Ortung falsch, ist auch
  die Blickrichtung falsch. In Städten enthalten die Höhendaten teilweise Gebäude, dort kann die
  Prüfung auf Dachlinien ansprechen. Eine frühere Fassung meldete über flachem Gelände
  Blickrichtungen ohne Aussagekraft (acht Treffer im Referenzbestand, davon fünf in Städten oder
  am falschen Ort); seit der Reliefschwelle bleiben drei im Bergland und zwei in Städten.
- Höhendaten und Kartendetails liegen für die Regionen des Referenzbestands vor, sonst nur grob
  (Welt in Zoomstufe 4).
- Die Grundwahrheit ist die Koordinate des Wikidata-Objekts (etwa der Mittelpunkt eines
  Bauwerks), nicht der Standort der Kamera; Abweichungen unter einem Kilometer sind daher nicht
  aussagekräftig.
- Alle Zeiten stammen von einem geteilten, belasteten Rechner und sind Obergrenzen. Ein
  Dauerbetrieb mit vielen gleichzeitigen Videos ist nicht gemessen.
