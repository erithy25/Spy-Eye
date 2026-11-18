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

Die Messung steht in `docs/measurements/datum-geolocation.json` und im Reiter MESSUNG; sie wird
mit `pnpm datum:evaluate` wiederholt. Abschnitt „Messwerte“ unten.

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
