# DATUM

**Jedes Bild hat einen Ort und eine Uhrzeit.**

DATUM bestimmt aus einem Video, wo und wann es aufgenommen wurde: Ort mit Unsicherheitskreis,
Uhrzeit als Zeitfenster, Sonnenstand und Schattenrichtung, Blickrichtung, wo der Geländehorizont
sie verrät. Aus einem einzelnen Bild baut es einen begehbaren Raum; das Gelände um den Fundort
zeigt es in 3D mit der Sonne zur geschätzten Zeit. Alles läuft auf einem Rechner ohne
Grafikkarte und ohne Dienst im Netz. Was aus dem Netz stammt (Referenzbilder, Höhendaten,
Kartendaten, Modelle), wird einmal geladen und liegt danach auf der Platte.

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
| Metadaten | Tags der Datei lesen (ISO 6709 Ort, Aufnahmezeit, Gerät); Zeitstempel von Umwandlungen werden verworfen | Ort und Zeit exakt, wenn vorhanden |
| Wiedererkennung | Zwölf Bilder des Videos, jedes als Ganzes und in drei quadratischen Ausschnitten, gegen eine Galerie von Referenzbildern mit Koordinaten (Wikidata P18 + P625) vergleichen; die nächsten Nachbarn stimmen mit geodätischen Kernen (2, 25, 250 km) über ihren Ort ab; der Radius richtet sich nach der Belegstufe | Kandidatenorte mit Radius |
| Länderschätzung | Das Text-Bild-Modell wird ohne Training gefragt, aus welchem Land die Bilder aussehen; das gewichtet die Kandidaten und trägt die Antwort allein, wenn kein Referenzbild passt | Wahrscheinlichkeit je Land |
| Licht | Tag, Dämmerung, Nacht, tief- oder hochstehende Sonne aus Bildmerkmalen und Bildstatistik | Band der Sonnenhöhe |
| Jahreszeit | Schnee, kahle Bäume, Blüte, Laub; auf der Südhalbkugel gespiegelt | Monatsbereich |
| Sonne | Sonnenstandsrechnung (NOAA) für Ort und Datum, Zeiten, in denen die Sonne im gemessenen Band steht; Zeitzone aus Land und Länge | Uhrzeitfenster in Ortszeit, Sonnenbahn, Schattenrichtung |
| Raum | Tiefenschätzung (Depth Anything V2 Small) für drei Schlüsselbilder; Himmel, Boden und Neigung der Kamera; Abstände aus der Annahme einer Augenhöhe von 1,6 m | begehbarer Raum, Himmelslinie |
| Horizont | Aus Höhendaten berechneter Horizont am Kandidatenort gegen die Himmelslinie des Videos; gewertet nur, wenn der Horizont im Bildausschnitt mindestens 1° Relief hat und die beste Richtung sich deutlich von den übrigen abhebt | Blickrichtung und Bildwinkel, wenn das Gelände markant ist und der Ort stimmt |

## Bedienung

| Reiter | Zeigt |
| --- | --- |
| ORTUNG | Weltkarte im Stil der Konsole mit allen Aufnahmen, Unsicherheitskreisen, Sonnen- und Schattenrichtung, Blickkegel; links die Liste mit Uhrzeit |
| BEFUND | Video, Himmelslinie, Belege mit Referenzbildern, Koordinaten und MGRS, Uhr mit Zeitfenstern und Sonnenauf- und -untergang, Polardiagramm des Sonnenstands, Kandidaten, Länder |
| RAUM | Begehbarer Raum aus dem Video (W A S D, Maus, Q E, Shift; der Himmel des Bildes bleibt beim Gehen als Kuppel stehen) und das Gelände um den Fundort mit Sonnenbahn, Horizont und Standpunkt zum Hineingehen |
| SUCHE | Freitextsuche über alle Aufnahmen |
| BESTAND | Videos und Ordner hochladen |
| MESSUNG | Abweichung jeder Ortung gegen die Grundwahrheit des Referenzbestands |
| PROTOKOLL | Verkettetes Protokoll aller Anmeldungen, Abfragen und Ortungen |

## Grauzone und Grenzen der Nutzung

DATUM ortet Aufnahmen, nicht Personen. Derselbe Dienst kann aber auch den Ort einer Person
verraten, die gefilmt hat. Deshalb bleibt aus der Vorgängerplattform: Jede Auswertung braucht
ein Mandat mit Zweck, jede Abfrage steht im Protokoll, Gesichter werden beim Einspielen
maskiert, Gesichtserkennung gibt es nicht. Ein Vertrag mit einer Behörde muss den Einsatz gegen
Journalistinnen, Oppositionelle und Filmende ohne Rechtsgrundlage ausschließen, und die
Lieferung an Staaten ohne Rechtsstaat. Die Ausfuhr von Überwachungstechnik aus der EU kann
genehmigungspflichtig sein (EU-Dual-Use-Verordnung); das ist vor jeder Lieferung zu prüfen.

## Was gemessen ist

Referenzbestand: 60 Videos aus Wikimedia Commons in 30 Ländern (16 aus Deutschland), deren
Wikidata-Objekt eine Koordinate trägt. Die Videos gehen unter neutralen Namen (`datum-001.mp4`)
in den Knoten; der Ort wird erst nach der Ortung zum Vergleich dazugelegt. Galerie: 6 393
Referenzbilder von Wikidata-Objekten mit Koordinate. Je Video zwölf Bilder, jedes als Ganzes und
in drei quadratischen Ausschnitten (so legt die Analyse sie ohnehin ab). Die Schwellen und Radien
der Ortung wurden nur an der einen Hälfte der Videos eingestellt (Abstimmungshälfte); die andere
Hälfte (Prüfhälfte) wurde nur gemessen. Gemessen am 18. November 2026 mit `pnpm datum:evaluate`,
Einzelwerte in `docs/measurements/datum-geolocation.json`.

| Fall | Hälfte | Median | ≤ 1 km | ≤ 25 km | ≤ 200 km | ≤ 750 km | ≤ 2 500 km | Land richtig |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Referenzbild des Ortes in der Galerie | Prüfhälfte (30) | 434 km | 27 % | 43 % | 47 % | 53 % | 67 % | 37 % |
| Referenzbild des Ortes in der Galerie | alle (60) | 283 km | 25 % | 40 % | 45 % | 58 % | 68 % | 40 % |
| Ort ohne Referenzbild (unbekannt) | Prüfhälfte (30) | 937 km | 0 % | 13 % | 23 % | 43 % | 60 % | 33 % |
| Ort ohne Referenzbild (unbekannt) | alle (60) | 937 km | 0 % | 15 % | 25 % | 47 % | 60 % | 38 % |
| Nur Länderschätzung, ohne Galerie | Prüfhälfte (30) | 1 445 km | 0 % | 0 % | 13 % | 40 % | 57 % | 37 % |
| Vorher: sechs ganze Bilder, Referenzbild in der Galerie | Prüfhälfte (30) | 233 km | 40 % | 47 % | 50 % | 60 % | 80 % | 43 % |
| Vorher: sechs ganze Bilder, Ort unbekannt | Prüfhälfte (30) | 751 km | 0 % | 17 % | 27 % | 47 % | 70 % | 37 % |

Einordnung:
- Die Wiedererkennung trägt. Liegt ein Bild desselben Bauwerks in der Galerie, ortet DATUM gut
  ein Viertel der Videos auf einen Kilometer genau. Fehlt es, bleibt eine Schätzung auf Land- und
  Kontinentebene, die besser ist als die Länderschätzung allein.
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
- Die Zuverlässigkeitsangabe stimmt jetzt, ist aber grob. Der Radius hängt von der Belegstufe ab
  und ist auf der Abstimmungshälfte so gewählt, dass die Wahrheit in 70 % der Fälle im Kreis
  liegt. Auf der Prüfhälfte lag sie bei bekannten Orten in 67 %, bei unbekannten in 60 % im Kreis
  (vorher 43 % und 17 %). Ehrlich heißt hier groß: 3 km nur, wenn ein Referenzbild klar aus den
  übrigen Treffern heraussticht; sonst 1 500 km; 7 500 km bei einer knapperen Wiedererkennung,
  weil gerade diese oft ein ähnliches Bauwerk auf einem anderen Kontinent ist; bei einer
  Länderantwort das Dreifache der Landesgröße.
- Die Länderschätzung allein trifft das Land in 38 % der Fälle (unter den ersten fünf Ländern in
  67 %).
- 30 Videos je Hälfte sind wenig; die Anteile schwanken um rund neun Prozentpunkte.
- Zum Vergleich ohne Anspruch auf Gleichwertigkeit: Veröffentlichte Verfahren mit großen
  Galerien und eigens trainierten Modellen erreichen auf öffentlichen Prüfsätzen deutlich
  höhere Werte. DATUM arbeitet mit einem allgemeinen Bild-Text-Modell und 6 393 Referenzbildern.
- Der Knoten ortet mit denselben Bildern wie die Messung: zwölf Bilder aus der Mitte gleich
  langer Abschnitte, je als Ganzes und in drei Ausschnitten. Mit den Bildern der Analyse (ab
  Sekunde 0 im Takt der Auswertung) wich er in 13 von 60 Fällen ab, im Median 754 statt 283 km;
  in knappen Fällen entscheidet die Auswahl der Bilder (Krimbrücke: richtiges Bauwerk 0,840
  gegen eine ähnliche Brücke 0,832). Seit der Umstellung stimmen Knoten und Messung in allen 60
  Fällen überein (`pnpm datum:check`: Median 299 km, 24 von 60 innerhalb 25 km).
- Rechenzeit im Knoten: im Median 5,4 s je Video (90 % unter 7,4 s) auf vier Kernen ohne
  Grafikkarte. Davon 3,2 s für das Ziehen und Einrechnen der zwölf Bilder mit Ausschnitten,
  0,6 s für den Vergleich der 48 Ausschnitte mit der Galerie, je 0,4 s für drei Räume. Die
  Galerie liegt als mitgelieferte Vektoren bei und lädt in unter einer Sekunde.
- Die Uhrzeit hat keine Grundwahrheit: Die Videos aus Commons tragen nach der Umwandlung keine
  Aufnahmezeit mehr. Geprüft ist die Rechnung (Sonnenstand gegen veröffentlichte Werte auf die
  Minute, Zeitzonen, Fenster aus der Sonnenhöhe), nicht die Treffsicherheit bei echten Videos.
  Tag und Nacht unterscheidet die Lichtschätzung zuverlässig, die Sonnenhöhe nur grob.
- Geprüft und verworfen: die Lichtrichtung aus der Schattierung der rekonstruierten Flächen. Auf
  künstlichen Szenen trifft sie die Richtung auf 12°, auf echten Bildern meldete sie bei bedecktem
  Himmel in 16 von 28 Fällen Sonne. Sie fließt deshalb nicht in die Uhrzeit ein
  (`apps/server/src/datum/shading.ts` bleibt mit seinen Tests als Versuch im Repository).

## Grenzen

- Die Wiedererkennung findet nur, was der Galerie ähnlich sieht. Ein unbekannter Ort ohne
  Wahrzeichen wird höchstens auf ein Land oder einen Kontinent geschätzt.
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
