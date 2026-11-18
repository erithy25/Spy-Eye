# Sicht — Harte Fragen, gerade Antworten

Stand: 18. November 2026. Belege und Einschränkungen zu jeder Antwort stehen in
`docs/STRATEGY.md` und `docs/COMPLIANCE.md`. Preise und Marktzahlen sind Annahmen. Keine Antwort
ist Rechtsberatung.

## Aus dem Ministerium

### Ist das nicht Palantir in klein?

Nein, und der Vergleich hilft niemandem. Palantir führt bei der Polizei Datenbestände über
Personen zusammen. Sicht führt nichts zusammen und kennt keine Personen: Es durchsucht die Bilder
einer Behörde nach Lagen und lässt sie dort, wo sie aufgenommen wurden. Richtig ist aber auch:
Palantir wurde 2020 im hessischen Corona-Krisenstab als Lagebild getestet und bietet
Zweckabfragen, Protokolle und einen Abgleich zwischen Instanzen. Eine Freitextsuche über Video
ist bei Palantir als Produkt nicht dokumentiert. Sicht tritt nicht als Ersatz an, sondern als
Bildschicht für Lagesysteme, die Behörden schon haben.

### Bund und Länder bauen ein digitales Lagebild. Wozu braucht es Sicht?

Das digitale Lagebild führt Meldungen zusammen; 2026 entstand eine Pilotanwendung, 2027 wird über
den gemeinsamen Wirkbetrieb entschieden
([BT-Drs. 21/7120, Antwort 56](https://dserver.bundestag.de/btd/21/071/2107120.pdf)). Was auf den
Bildern von Drohnen, Hubschraubern und Kameras zu sehen ist, muss heute ein Mensch ansehen und
von Hand melden. Sicht liefert diesen Teil als Meldung mit Ort und Zeit. Ob das Lagebild des
Bundes eine solche Zulieferung vorsieht, wissen wir nicht; Hersteller und Technik der
Pilotanwendung sind nicht veröffentlicht.

### Was kostet es?

Alle Preise sind Annahmen und kein Angebot. Eine Erprobung über drei Monate kostet 25 000 € fest,
die Lizenz für den Knoten eines Kreises 48 000 € im Jahr, ein Landesknoten 120 000 € und die
Verbundlizenz eines Landes 180 000 € im Jahr, die Einführung einmalig 15 000 € je Knoten. Hinzu
kommen der Rechner, den die Behörde stellt, und ihr eigener Aufwand für Datenschutzprüfung und
Schulung. Betriebskosten beim Anbieter gibt es nicht, weil dort nichts läuft.

### Was ist heute fertig, was nicht?

Fertig und von Hand geprüft sind das Einspielen und Auswerten von Videodateien, die
Freitextsuche, Wachen mit Meldungen und Lagen, die Gesichtsmaskierung mit Freigabe durch eine
zweite Person, Mandate, drei Rollen, das verkettete Protokoll, Vorgänge mit Prüfsummen, der
Verbund zwischen Knoten, die Löschfrist und die Ausgabe als GeoJSON und CAP. Nicht fertig sind
die Anbindung laufender Bildströme, eine erprobte Kopplung an ELD-BS oder CommandX, die
Benutzerverwaltung, die Verschlüsselung und ein Löschkonzept für das Protokoll. Nicht gemessen
ist alles, was echtes Einsatzmaterial betrifft. Das eingesetzte Bildmodell steht außerdem unter
einer Forschungslizenz; für den Einsatz wird es ersetzt und neu vermessen.

### Wie passt das zu unserer Stabssoftware?

Sicht ersetzt sie nicht. Lagen lassen sich als GeoJSON und einzeln als CAP-1.2-Meldung ausgeben,
mit Koordinaten und Meldegitter. Eine erprobte Kopplung an ELD-BS, CommandX oder ArcGIS gibt es
noch nicht; sie ist der erste Entwicklungsschritt nach der Bedarfsklärung. Bis dahin ist die
Rolle als Bildschicht eine Absicht.

### Auf welcher Rechtsgrundlage dürfen wir das einsetzen?

Das klären Sie mit Ihrer Datenschutzaufsicht, und die Antwort ist nicht sicher. Rheinland-Pfalz
regelt in § 60 LBKG, wann Drohnen aufzeichnen dürfen und dass Aufnahmen nach spätestens zwei
Monaten zu löschen sind; zur automatisierten Auswertung sagt die Vorschrift nichts.
Nordrhein-Westfalen verweist auf § 46 BHKG. Die Bundesdatenschutzbeauftragte hat zu
Polizeigesetzen festgehalten, dass die massenhafte KI-Analyse von Videodateien kein einfacher
Abgleich ist. Wir empfehlen den Einstieg in einer Übung auf abgesperrtem Gelände und ein
Gutachten je Land.

## Aus dem Datenschutz

### Ist das Überwachung?

Sicht wertet Bilder aus, auf denen Menschen zu sehen sein können. Das ist ein Eingriff, und so
ist das System gebaut. Es beobachtet keine Personen, sondern sucht nach Lagen: Wasser auf einer
Straße, Rauch, eine eingestürzte Wand, Menschen auf einem Dach. Es erkennt kein Gesicht und kein
Kennzeichen, führt keine Personendaten und verknüpft keine Datenbestände. Jede Auswertung braucht
ein Mandat mit Zweck und Rechtsgrundlage und steht in einem Protokoll, das eine Aufsicht prüft,
die selbst keine Bilder sieht. Ob das genügt, entscheidet nicht der Hersteller.

### Kann man damit doch Personen suchen?

Ja, in Grenzen, und das ist gewollt: „Person auf einem Dach“ und „Person im Wasser“ sind
Rettungslagen. Abgelehnt werden Anfragen nach Namen, nach Herkunft, Religion und anderen
geschützten Merkmalen sowie nach Körpermerkmalen wie Haarfarbe oder Tätowierung; Beschreibungen
nach Geschlecht oder Alter lassen sich je Mandat sperren. Zulässig bleiben Kleidung, Ausrüstung
und Situation. Damit ließe sich eine Person in auffälliger Jacke über mehrere Quellen
wiederfinden. Das verhindert heute keine technische Schranke, sondern die Regel, das Protokoll
und die Stichprobe der Aufsicht; die Begrenzung des Suchraums je Mandat steht aus.

### Reicht die Gesichtsmaskierung als Anonymisierung?

Nein. Auch ohne Gesicht bleiben Kleidung, Statur, Fahrzeuge und Gebäude einer Person zuordenbar;
so sieht es etwa der Thüringer Landesbeauftragte für den Datenschutz. Die Maskierung verringert,
was Nutzer zu sehen bekommen. Das Original bleibt gespeichert und ist nur mit begründeter
Freigabe einer zweiten Person für 15 Minuten abrufbar. Wie viele Gesichter der Erkenner
übersieht, ist nicht gemessen.

### Wer kontrolliert, was abgefragt wird?

Jede Suche, jede abgelehnte Anfrage, jede Freigabe und jede Ausgabe steht mit Person, Mandat und
Zeit im Protokoll. Die Einträge sind über Prüfsummen verkettet; wer einen ändert oder entfernt,
bricht die Kette an dieser Stelle. Die Rolle Aufsicht prüft die Kette und zieht
Zufallsstichproben, sieht aber keine Bilder. Im Verbund halten die Partner den Protokollstand der
anderen fest, sodass niemand sein Protokoll unbemerkt neu schreiben kann. Zwei Lücken: Der Abruf
einzelner Bilder wird nicht protokolliert, und wer Zugriff auf den Rechner hat, kann die
Protokolldatei löschen.

### Was verlässt im Verbund unser Haus?

Wenn Sie fragen: Ihre Frage, Ihr Mandat und der Name der fragenden Person. Wenn Sie gefragt
werden: höchstens zwölf verkleinerte, maskierte Vorschaubilder mit Ort und Zeit, und nur aus
Quellen, die Sie einzeln freigegeben haben. Aufnahmen und Index bleiben bei Ihnen; Ihr Knoten
prüft die fremde Frage nach Ihren eigenen Regeln und protokolliert sie. Auch ein Vorschaubild ist
ein personenbezogenes Datum, die Übermittlung braucht also eine Grundlage. Die Verbindung
zwischen Knoten ist bisher signiert, aber nicht verschlüsselt.

### Lernt das System aus unseren Daten?

Nicht von selbst. Die Modellgewichte ändern sich im Betrieb nicht. Bestätigen oder verwerfen Ihre
Leute Meldungen, wird das gesammelt; eine Wache ändert sich erst, wenn jemand sie ausdrücklich
nachschärft. Das erzeugt eine neue Version, steht im Protokoll und lässt sich zurücknehmen. Ihre
Bilder verlassen dabei den Knoten nicht.

### Ist das ein Hochrisiko-System nach der KI-Verordnung?

Das hängt vom Einsatz ab. Als Suche und Lageinformation für einen Stab spricht einiges dagegen.
Sobald Meldungen bestimmen, welche Einsatzkräfte wohin entsandt werden, greift Anhang III Nr. 5
Buchstabe d. Die Pflichten für solche Systeme gelten nach heutigem Stand ab Dezember 2027; diese
Frist ist vor Gebrauch zu prüfen. Wir führen die Unterlagen so, als gälte die Einstufung.
Verbotene Praktiken sind nicht berührt, weil es keinen biometrischen Abgleich und keine Bewertung
von Personen gibt.

## Aus der Einsatzleitung

### Was passiert bei Fehlalarmen?

Eine Meldung ist ein Vorschlag mit Bild, Quelle, Ort und Zeit. Ihr Lagedienst bestätigt oder
verwirft sie. Je Wache lassen sich Schwelle, Mindestdauer und Abklingzeit einstellen, und mehrere
Meldungen am selben Ort werden zu einer Lage gebündelt, damit die Anzeige nicht vollläuft. Wie
viele Fehlmeldungen im Einsatz je Stunde anfallen, wissen wir nicht; das zeigt erst eine
Erprobung.

### Was, wenn das System etwas übersieht?

Das wird vorkommen. Das Gefahrenmodell erreicht an einem öffentlichen Datensatz 99,1 Prozent;
der Wert gilt für ähnliche Luftbilder, nicht für Nacht, Regen oder eine verschmutzte Linse. Sicht
ist ein zusätzliches Augenpaar und kein Ersatz für die Erkundung. Eine ausbleibende Meldung ist
keine Entwarnung, und so sollte es in Ihrer Dienstanweisung stehen.

### Wer haftet?

Die Entscheidung trifft der Stab, und für hoheitliches Handeln haftet im Grundsatz der Staat
(Art. 34 GG, § 839 BGB). Der Hersteller haftet nach Vertrag und Gesetz für Mängel der Software.
Sicht löst keine Maßnahme selbst aus: Jede Meldung braucht eine Bestätigung, und die Ausgabe an
Warnsysteme trägt den Hinweis, dass der Stab bewerten muss. Die genaue Verteilung gehört in den
Vertrag und vor Ihre Rechtsabteilung.

### Läuft das im Einsatz ohne Netz, und auf welcher Hardware?

Ja. Nach dem einmaligen Laden der Modellgewichte arbeitet ein Knoten ohne Netzverbindung.
Gemessen ist: Ein Rechner mit vier Prozessorkernen und ohne Grafikkarte wertet bei einem Bild je
Sekunde rund dreimal so schnell aus, wie das Material entsteht; rechnerisch reicht das für drei
Quellen zugleich. Der Wert stammt vom bisherigen Bildmodell und ist nach dem Modellwechsel neu zu
messen. Für den Verbund braucht es eine Verbindung zwischen den Knoten.

### Wie kommen unsere Drohnenbilder hinein?

Heute als Videodatei, einzeln oder als Ordner. Im Test waren 44 Aufnahmen nach knapp sechs
Sekunden grob durchsuchbar; die genaue Auswertung lief im Hintergrund weiter. Die laufende
Übertragung einer Drohne oder Kamera lässt sich noch nicht anbinden. Das ist der wichtigste
fehlende Baustein und für Februar 2027 geplant.

## Aus der Presse

### Woher stammt das Modell, und läuft es wirklich ohne Internet?

Das Bildmodell ist MobileCLIP-S2 von Apple, der Gesichtserkenner YuNet aus dem OpenCV-Projekt;
das Gefahrenmodell wurde selbst auf dem öffentlichen Datensatz AIDERv2 trainiert. Die Gewichte
werden einmal geladen und laufen danach auf dem Rechner der Behörde; der Quelltext enthält keine
Rückmeldung an den Hersteller oder an Dritte. Ein Problem gehört dazu gesagt: Apple gibt
MobileCLIP nur für Forschungszwecke frei
([Lizenz](https://huggingface.co/apple/MobileCLIP-S2/blob/main/LICENSE)). Für den Einsatz wird
auf ein frei lizenziertes Modell umgestellt; SigLIP unter Apache 2.0 und CLIP unter MIT sind
bereits wählbar. Danach werden alle Werte neu gemessen.

### Warum sollte man glauben, dass Sie Gesichtserkennung nicht später nachrüsten?

Glauben muss man es nicht, man kann es prüfen. Im Quelltext gibt es keinen Abgleich von Personen
und keine Datenbank dafür, und das Protokoll hält fest, mit welcher Softwareversion ein Knoten
startet. Verlässlicher als ein Versprechen sind drei Dinge, die noch ausstehen: eine vertragliche
Zusage gegenüber jeder Behörde, Einsicht in den Quelltext für deren Prüfer und der Ausschluss der
Polizei als Kunde. Über die Offenlegung des Quelltexts ist noch nicht entschieden.

### Wurde das je im Ernstfall erprobt?

Nein. Es gibt keinen Behördenkunden, keine Erprobung in einer Übung und keinen Einsatz. Alle
Messwerte stammen von Archivaufnahmen und einem öffentlichen Datensatz. Die erste Erprobung in
einer Übung ist für das zweite Quartal 2027 vorgesehen, wenn eine Behörde zusagt.

### Sie verweisen auf das Ahrtal. Ist das redlich?

Belegt ist: Ein Polizeihubschrauber filmte am 14. Juli 2021 zwischen 22:14 und 22:43 Uhr
überflutete Orte und Menschen, die Lichtzeichen gaben. Die Videos wurden nicht ordnungsgemäß
verbucht; Untersuchungsausschuss und Staatsanwaltschaft erfuhren erst im September 2022 von
ihnen. Niemand kann sagen, dass Sicht in dieser Nacht ein Leben gerettet hätte. Standbilder
erreichten das Ministerium noch in der Nacht und lösten nach dem Sondervotum der Opposition
nichts aus. Technik hilft nur dort, wo jemand zuständig ist und handelt.

## Von Investoren

### Warum nicht Fraunhofer?

Das Fraunhofer IOSB hat das Lagesystem des Landes Baden-Württemberg gebaut, wertet Drohnenbilder
für Einsatzkräfte aus und könnte die Freitextsuche ergänzen. Soweit öffentlich sichtbar, fehlen
dort bisher die Suche mit freien Begriffen statt fester Klassen und ein Verbund, in dem nur die
Frage reist. Ein Forschungsinstitut liefert zudem selten ein Produkt mit Preisliste, Einführung
und Pflege für vierhundert Kreise. Deshalb ist das IOSB zugleich der naheliegende Partner und der
Wettbewerber, der Sicht am schnellsten überflüssig machen kann.

### Wie groß ist der Markt?

Klein. 400 Kreise, 16 Länder und zehn Bundesstellen ergeben zu den angenommenen Listenpreisen
rund 25 Mio. € im Jahr bei vollständiger Abdeckung; erreichbar in fünf Jahren sind nach den
Annahmen knapp 10 Mio. €. Im Basisfall des Finanzmodells stehen 2031 rund 2,3 Mio. € Umsatz und
bis dahin ein Mittelbedarf von 3,2 Mio. €. Größer wird es nur mit Betreibern kritischer Anlagen
oder im Ausland; beides ist ungeprüft.

### Was schützt Sie vor Nachahmern?

Wenig Technik, etwas Zeit. Die Freitextsuche über Video bieten mehr als zehn Hersteller, und die
Modelle sind frei verfügbar. Eigen ist die Verbindung aus dem Zuschnitt auf den
Bevölkerungsschutz, dem Verzicht auf jede Identifizierung und einem Verbund ohne gemeinsamen
Datenbestand; auch das kann ein größerer Anbieter nachbauen. Ein Vorsprung entsteht nur durch die
erste gemessene Erprobung, die erste Kopplung an ein Bestandssystem und das Vertrauen einer
Datenschutzaufsicht. Alle drei stehen aus.
