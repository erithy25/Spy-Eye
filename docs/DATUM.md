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

Jeder Beleg, jeder Schritt des Ablaufs und jede Begründung kommt vom Knoten auf Deutsch und auf
Englisch; die Konsole zeigt die Sprache, die eingestellt ist.

## Bedienung

| Reiter | Zeigt |
| --- | --- |
| ORTUNG | Weltkarte im Stil der Konsole mit allen Aufnahmen, Unsicherheitskreisen, Sonnen- und Schattenrichtung, Blickkegel; links die Liste mit Uhrzeit; in den Kartenwerkzeugen der Knopf „Einstellungen“ |
| BEFUND | Video, Himmelslinie, Belege mit Referenzbildern und Straßenbildern, Koordinaten und MGRS, Uhr mit Zeitfenstern und Sonnenauf- und -untergang, Polardiagramm des Sonnenstands, Kandidaten, Länder |
| RAUM | Begehbarer Raum aus dem Video (W A S D, Maus, Q E, Shift; der Himmel des Bildes bleibt beim Gehen als Kuppel stehen) und das Gelände um den Fundort mit Sonnenbahn, Horizont und Standpunkt zum Hineingehen |
| SUCHE | Freitextsuche über alle Aufnahmen |
| BESTAND | Videos und Ordner hochladen |
| MESSUNG | Abweichung jeder Ortung gegen die Grundwahrheit des Referenzbestands; am Ende der Abschnitt „Einstellungen der Ortung“ |
| PROTOKOLL | Verkettetes Protokoll aller Anmeldungen, Abfragen, Ortungen und Änderungen der Einstellungen |

- **Einstellungen der Ortung** (ORTUNG, „Einstellungen“, oder am Ende von MESSUNG): Abgleich mit
  Straßenbildern ein oder aus, Mapillary-Schlüssel, Zustand des Weltmodells (vorhanden oder
  nicht, Genauigkeit). Ändern darf nur die Leitung; die übrigen Rollen sehen die Einstellungen.
  Jede Änderung steht im Protokoll und gilt für die nächsten Ortungen.
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
Referenzbilder von Wikidata-Objekten mit Koordinate. Je Video zwölf Bilder, jedes als Ganzes und
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
