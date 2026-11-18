# DATUM

**Jedes Bild hat einen Ort und eine Uhrzeit.**

DATUM bestimmt aus einem Video, wo und wann es aufgenommen wurde: Ort mit Unsicherheitskreis,
Uhrzeit als Zeitfenster, Sonnenstand und Schattenrichtung, Blickrichtung, wo der Geländehorizont
sie verrät. Aus einem einzelnen Bild baut es einen begehbaren Raum; das Gelände um den Fundort
zeigt es in 3D mit der Sonne zur geschätzten Zeit. Alles läuft auf einem Rechner ohne
Grafikkarte und ohne Dienst im Netz. Was aus dem Netz stammt (Referenzbilder, Höhendaten,
Kartendaten, Modelle), wird einmal geladen und liegt danach auf der Platte.

Stand: Erprobung mit einem Referenzbestand aus Wikimedia Commons. Keine Kunden, keine Zulassung,
der Name ist markenrechtlich nicht geprüft.

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
| Wiedererkennung | Acht Bilder des Videos gegen eine Galerie von Referenzbildern mit Koordinaten (Wikidata P18 + P625) vergleichen; die nächsten Nachbarn stimmen mit geodätischen Kernen (2, 25, 250 km) über ihren Ort ab | Kandidatenorte mit Radius |
| Länderschätzung | Das Text-Bild-Modell wird ohne Training gefragt, aus welchem Land die Bilder aussehen; das gewichtet die Kandidaten und trägt die Antwort allein, wenn kein Referenzbild passt | Wahrscheinlichkeit je Land |
| Licht | Tag, Dämmerung, Nacht, tief- oder hochstehende Sonne aus Bildmerkmalen und Bildstatistik | Band der Sonnenhöhe |
| Jahreszeit | Schnee, kahle Bäume, Blüte, Laub; auf der Südhalbkugel gespiegelt | Monatsbereich |
| Sonne | Sonnenstandsrechnung (NOAA) für Ort und Datum, Zeiten, in denen die Sonne im gemessenen Band steht; Zeitzone aus Land und Länge | Uhrzeitfenster in Ortszeit, Sonnenbahn, Schattenrichtung |
| Raum | Tiefenschätzung (Depth Anything V2 Small) für drei Schlüsselbilder; Himmel, Boden und Neigung der Kamera; Abstände aus der Annahme einer Augenhöhe von 1,6 m | begehbarer Raum, Himmelslinie |
| Horizont | Aus Höhendaten berechneter Horizont am Kandidatenort gegen die Himmelslinie des Videos | Blickrichtung und Bildwinkel, wenn das Gelände markant ist |

## Bedienung

| Reiter | Zeigt |
| --- | --- |
| ORTUNG | Weltkarte im Stil der Konsole mit allen Aufnahmen, Unsicherheitskreisen, Sonnen- und Schattenrichtung, Blickkegel; links die Liste mit Uhrzeit |
| BEFUND | Video, Himmelslinie, Belege mit Referenzbildern, Koordinaten und MGRS, Uhr mit Zeitfenstern und Sonnenauf- und -untergang, Polardiagramm des Sonnenstands, Kandidaten, Länder |
| RAUM | Begehbarer Raum aus dem Video (W A S D, Maus, Q E, Shift) und das Gelände um den Fundort mit Sonnenbahn, Horizont und Standpunkt zum Hineingehen |
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
Referenzbilder von Wikidata-Objekten mit Koordinate. Je Video sechs Bilder. Die Schwellen der
Ortung wurden nur an der einen Hälfte der Videos eingestellt (Abstimmungshälfte); die andere
Hälfte (Prüfhälfte) wurde nur gemessen. Gemessen am 18. November 2026 mit `pnpm datum:evaluate`,
Einzelwerte in `docs/measurements/datum-geolocation.json`.

| Fall | Hälfte | Median | ≤ 1 km | ≤ 25 km | ≤ 200 km | ≤ 750 km | ≤ 2 500 km | Land richtig |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Referenzbild des Ortes in der Galerie | Prüfhälfte (30) | 233 km | 40 % | 47 % | 50 % | 60 % | 80 % | 43 % |
| Referenzbild des Ortes in der Galerie | alle (60) | 310 km | 27 % | 37 % | 45 % | 57 % | 77 % | 38 % |
| Ort ohne Referenzbild (unbekannt) | Prüfhälfte (30) | 751 km | 0 % | 17 % | 27 % | 47 % | 70 % | 37 % |
| Ort ohne Referenzbild (unbekannt) | alle (60) | 735 km | 0 % | 17 % | 28 % | 50 % | 70 % | 35 % |
| Nur Länderschätzung, ohne Galerie | Prüfhälfte (30) | 1 253 km | 0 % | 0 % | 13 % | 43 % | 60 % | 37 % |

Einordnung:
- Die Wiedererkennung trägt. Liegt ein Bild desselben Bauwerks in der Galerie, ortet DATUM
  vier von zehn Videos der Prüfhälfte auf einen Kilometer genau. Fehlt es, bleibt eine Schätzung
  auf Land- und Kontinentebene, die besser ist als die Länderschätzung allein.
- Die Länderschätzung allein trifft das Land in 38 % der Fälle (unter den ersten fünf Ländern in
  65 %).
- Die Zuverlässigkeitsangabe ist ehrlich, aber grob: Bei unbekannten Orten lag die Wahrheit in
  18 % der Fälle im angegebenen Kreis (angegeben im Mittel 27 %), bei bekannten in 43 %.
- 30 Videos je Hälfte sind wenig; die Anteile schwanken um rund neun Prozentpunkte.
- Zum Vergleich ohne Anspruch auf Gleichwertigkeit: Veröffentlichte Verfahren mit großen
  Galerien und eigens trainierten Modellen erreichen auf öffentlichen Prüfsätzen deutlich
  höhere Werte. DATUM arbeitet mit einem allgemeinen Bild-Text-Modell und 6 393 Referenzbildern.
- Rechenzeit: 1,3 s je Video für die Ortung (Bilder und Vergleich), mit Raum, Horizont und Zeit
  rund 2 s; die Galerie wird einmal eingerechnet und lädt danach in 0,4 s.
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
- Die Horizontprüfung braucht markantes Gelände und Höhendaten am Ort; in Städten und im
  Flachland greift sie selten.
- Höhendaten und Kartendetails liegen für die Regionen des Referenzbestands vor, sonst nur grob
  (Welt in Zoomstufe 4).
- Die Grundwahrheit ist die Koordinate des Wikidata-Objekts (etwa der Mittelpunkt eines
  Bauwerks), nicht der Standort der Kamera; Abweichungen unter einem Kilometer sind daher nicht
  aussagekräftig.
