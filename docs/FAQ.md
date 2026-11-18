# Sicht — Harte Fragen, gerade Antworten

Stand: 18. November 2026. Belege und Einschränkungen zu jeder Antwort stehen in
`docs/STRATEGY.md` und `docs/COMPLIANCE.md`, die Messwerte mit ihren Bedingungen in
`docs/EVALUATION.md`. Preise und Marktzahlen sind Annahmen. Keine Antwort ist Rechtsberatung.

## Aus dem Ministerium

### Ist das nicht Palantir in klein?

Nein, und der Vergleich hilft niemandem. Palantir führt bei der Polizei Datenbestände über
Personen zusammen. Sicht führt nichts zusammen und kennt keine Personen: Es durchsucht die Bilder
einer Behörde nach Lagen und lässt sie dort, wo sie aufgenommen wurden. Fragt eine Behörde eine
andere, reist nur die Frage; zurück kommen maskierte Vorschaubilder mit einer Belegnummer. Richtig
ist aber auch: Palantir wurde 2020 im hessischen Corona-Krisenstab als Lagebild getestet und
bietet Zweckabfragen, Protokolle und einen Abgleich zwischen Instanzen. Eine Freitextsuche über
Video ist bei Palantir als Produkt nicht dokumentiert. Sicht tritt nicht als Ersatz an, sondern
als Bildschicht für Lagesysteme, die Behörden schon haben.

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

Fertig und im Browser in allen drei Rollen durchgespielt sind das Einspielen und Auswerten von
Videodateien, die Freitextsuche auf Deutsch und Englisch, Wachen mit Meldungen, Lagen und
ausdrücklichem Nachschärfen, die Gesichtsmaskierung mit Freigabe durch eine zweite Person,
Mandate, drei Rollen, das verkettete Protokoll mit Prüfung und Stichprobe, Vorgänge mit
Prüfsummen und Siegel, der Verbund zwischen drei Knoten auf einem Rechner, die Löschfrist, die
Lagekarte mit UTM-Gitter und die Ausgabe als GeoJSON und CAP. Gemessen ist eine eigene Übung mit
Archivmaterial: 13 von 13 Ereignissen gemeldet, Verzug 1,1 Sekunden im Median, eine Fehlmeldung
unter 15 Meldungen. Gebaut, aber nur im Labor geprüft sind Direktbilder: Ein Kamerastrom lässt
sich anschließen und wird mit etwa einer halben Minute Nachlauf ausgewertet; geprüft ist das
gegen eine simulierte Kamera, nicht im Feld. Nicht fertig sind die Erprobung mit echten Kameras,
eine erprobte Kopplung an ELD-BS oder CommandX, Benutzerverwaltung und Anmeldung jenseits dreier
Vorführkonten, die Verschlüsselung der Platte, die Verwaltung von Zertifikaten und ein
Löschkonzept für das Protokoll. Nicht gemessen ist
alles, was echtes Einsatzmaterial betrifft. Der Bildkodierer ist seit dem 18. November 2026
SigLIP 2 unter Apache 2.0; die frühere Lizenzfrage ist damit für den Kodierer erledigt.

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
Straße, Rauch, eine eingestürzte Wand, Menschen auf einem Dach. Es gleicht keine Gesichter ab und
liest keine Kennzeichen, führt keine Personendaten und verknüpft keine Datenbestände. Jede
Auswertung braucht ein Mandat mit Zweck und Rechtsgrundlage und steht in einem Protokoll, das
eine Aufsicht prüft, die selbst keine Bilder sieht. Ob das genügt, entscheidet nicht der
Hersteller.

### Kann man damit doch Personen suchen?

Ja, in Grenzen, und das ist gewollt: „Person auf einem Dach“ und „Person im Wasser“ sind
Rettungslagen. Abgelehnt werden Anfragen nach Namen, Gesichtern und Kennzeichen, nach Herkunft,
Religion und anderen geschützten Merkmalen, nach Körpermerkmalen wie Haarfarbe oder Tätowierung
und Anfragen, eine bestimmte Person wiederzufinden oder zu verfolgen. Beschreibungen nach
Geschlecht, Alter oder Kleidung sind nur unter einem Mandat möglich, das sie ausdrücklich zulässt,
etwa bei einer Vermisstensuche; solche Suchen stehen gekennzeichnet im Protokoll. Unter einem
solchen Mandat ließe sich eine Person in auffälliger Jacke über mehrere Quellen wiederfinden. Das
verhindert keine technische Schranke, sondern die Regel, das Protokoll und die Stichprobe der
Aufsicht. Die Prüfung arbeitet mit Wortlisten und lässt sich mit Umschreibungen umgehen; die
Begrenzung des Suchraums je Mandat steht aus.

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
anderen fest, sodass niemand sein Protokoll unbemerkt neu schreiben kann. Nachrechnen lässt sich
die Kette auch ohne Sicht: Dem Export liegen zwei kurze Prüfprogramme bei, eines in Node und eines
in Python, die eine Aufsicht selbst lesen und auf einem eigenen Rechner einsetzen kann. Zwei Lücken: Der Abruf
einzelner Bilder wird nicht protokolliert, und wer Zugriff auf den Rechner hat, kann die
Protokolldatei löschen.

### Was verlässt im Verbund unser Haus?

Wenn Sie fragen: Ihre Frage, Ihr Mandat und der Name der fragenden Person. Wenn Sie gefragt
werden: höchstens zwölf verkleinerte, maskierte Vorschaubilder mit Ort und Zeit und die Nummer
Ihres Protokolleintrags als Beleg, und nur aus Quellen, die Sie einzeln freigegeben haben.
Aufnahmen und Index bleiben bei Ihnen; Ihr Knoten prüft die fremde Frage nach Ihren eigenen
Regeln und protokolliert sie. Auch ein Vorschaubild ist ein personenbezogenes Datum, die
Übermittlung braucht also eine Grundlage. Die Verbindung zwischen Knoten ist signiert;
verschlüsselt ist sie, wenn beide Seiten ein Zertifikat hinterlegt haben, was bisher nur im Labor
geprüft ist.

### Lernt das System aus unseren Daten?

Nicht von selbst. Die Modellgewichte ändern sich im Betrieb nicht. Bestätigen oder verwerfen Ihre
Leute Meldungen, wird das gesammelt; eine Wache ändert sich erst, wenn jemand sie ausdrücklich
nachschärft. Das erzeugt eine neue Version, steht im Protokoll und lässt sich zurücknehmen. In der
eigenen Übung genügten ein verworfenes und ein bestätigtes Urteil, damit eine Fehlmeldung nach
dem Nachschärfen ausblieb. Ihre Bilder verlassen dabei den Knoten nicht.

### Ist das ein Hochrisiko-System nach der KI-Verordnung?

Das hängt vom Einsatz ab. Als Suche und Lageinformation für einen Stab spricht einiges dagegen.
Sobald Meldungen bestimmen, welche Einsatzkräfte wohin entsandt werden, greift Anhang III Nr. 5
Buchstabe d. Die Pflichten für solche Systeme gelten nach heutigem Stand ab Dezember 2027; diese
Frist ist vor Gebrauch zu prüfen. Wir führen die Unterlagen so, als gälte die Einstufung.
Verbotene Praktiken sind nicht berührt, weil es keinen biometrischen Abgleich und keine Bewertung
von Personen gibt.

## Aus der Einsatzleitung

### Was passiert bei Fehlalarmen?

Eine Meldung ist ein Vorschlag mit Bild, Quelle, Ort und Zeit. Ihre Auswertung bestätigt oder
verwirft sie. Je Wache lassen sich Schwelle, Mindestdauer und Abklingzeit einstellen, und
gleichartige Meldungen am selben Ort werden zu einer Lage gebündelt, damit die Anzeige nicht
vollläuft. In der eigenen Übung mit Archivmaterial war eine von 15 Meldungen falsch: Eine
abgerutschte Fahrbahn wurde als umgestürzter Lastkraftwagen gemeldet. Nach einem verworfenen und
einem bestätigten Urteil und dem ausdrücklichen Nachschärfen der Wache blieb sie im nächsten Lauf
aus. Wie viele Fehlmeldungen im Einsatz je Stunde anfallen, wissen wir nicht; das zeigt erst eine
Erprobung.

### Was, wenn das System etwas übersieht?

Das wird vorkommen. In der eigenen Übung wurden alle 13 Ereignisse des Drehbuchs gemeldet, aber
die Wachen waren an diesem Material formuliert; über fremdes Material, Nacht, Regen oder eine
verschmutzte Linse sagt das nichts. Das trainierte Gefahrenmodell erreicht an seinem öffentlichen
Datensatz 99,1 Prozent und irrt trotzdem schon auf dem Übungsmaterial: Es hält einen ruhigen
Fluss für eine Überflutung. Es löst deshalb in der Voreinstellung keine Meldungen aus, sondern
steht als Zweitmeinung neben Meldungen aus Luftbildquellen. Sicht ist ein zusätzliches Augenpaar
und kein Ersatz für die Erkundung. Eine ausbleibende Meldung ist keine Entwarnung, und so sollte
es in Ihrer Dienstanweisung stehen.

### Wer haftet?

Die Entscheidung trifft der Stab, und für hoheitliches Handeln haftet im Grundsatz der Staat
(Art. 34 GG, § 839 BGB). Der Hersteller haftet nach Vertrag und Gesetz für Mängel der Software.
Sicht löst keine Maßnahme selbst aus: Jede Meldung braucht eine Bestätigung, und die Ausgabe an
Warnsysteme trägt den Hinweis, dass der Stab bewerten muss. Die genaue Verteilung gehört in den
Vertrag und vor Ihre Rechtsabteilung.

### Läuft das im Einsatz ohne Netz, und auf welcher Hardware?

Ja. Nach dem einmaligen Laden der Modellgewichte (rund 950 MB) arbeitet ein Knoten ohne
Netzverbindung. Gemessen ist: Ein Rechner mit vier Prozessorkernen und ohne Grafikkarte wertet
Aufzeichnungen bei einem Bild je Sekunde 3,3-mal so schnell aus, wie das Material entsteht, die
Maskierung eingeschlossen; rechnerisch reicht das für etwa drei Ströme zugleich. Diese Zahl ist
gerechnet, nicht gemessen: Geprüft ist ein einzelnes Direktbild von einer simulierten Kamera. Für
elf Quellen gleichzeitig bräuchte es etwa das Dreieinhalbfache dieser Rechenleistung oder eine
Grafikkarte. Für den Verbund braucht es eine Verbindung zwischen den Knoten, für ein Direktbild
eine zur Kamera.

### Wie kommen unsere Drohnenbilder hinein?

Als Videodatei, einzeln oder als Ordner, oder als Direktbild. Im Test waren 44 Aufnahmen 8
Sekunden nach Beginn des Hochladens grob durchsuchbar; die genaue Auswertung lief im Hintergrund
weiter und war nach knapp drei Minuten abgeschlossen. Für ein Direktbild trägt die Leitung
die Adresse des Stroms ein (RTSP, HLS, RTMP, SRT oder MPEG-TS). Der Knoten schneidet den Strom in
Abschnitte von 20 Sekunden und wertet jeden wie eine Aufzeichnung aus; Meldungen folgen etwa eine
halbe Minute nach dem Ereignis. Geprüft ist das gegen eine simulierte Kamera, nicht gegen Geräte
im Feld. Ob sich die Übertragung Ihrer Drohne so anschließen lässt, zeigt erst die Erprobung mit
echten Kameras; sie ist für Februar 2027 vorgesehen.

## Aus der Presse

### Woher stammt das Modell, und läuft es wirklich ohne Internet?

Der Bildkodierer ist SigLIP 2 (base, patch32-256) von Google unter der Lizenz Apache 2.0
([Modellseite](https://huggingface.co/google/siglip2-base-patch32-256)), der Gesichtserkenner
YuNet aus dem OpenCV-Projekt (MIT); das Gefahrenmodell wurde selbst auf dem öffentlichen Datensatz
AIDERv2 trainiert. Die Gewichte werden einmal geladen und laufen danach auf dem Rechner der
Behörde; der Quelltext enthält keine Rückmeldung an den Hersteller oder an Dritte. Der Kodierer
versteht deutsche und englische Anfragen. Dazu gehört gesagt: Bis zum 18. November 2026 war
MobileCLIP von Apple voreingestellt, das nur für Forschungszwecke freigegeben ist
([Lizenz](https://huggingface.co/apple/MobileCLIP-S2/blob/main/LICENSE)). Deshalb wurde
umgestellt und alles neu gemessen. Offen ist die schriftliche Prüfung der Lizenzkette, etwa der
ONNX-Fassung, in der der Kodierer geladen wird.

### Warum sollte man glauben, dass Sie Gesichtserkennung nicht später nachrüsten?

Glauben muss man es nicht, man kann es prüfen. Im Quelltext gibt es keinen Abgleich von Personen
und keine Datenbank dafür, und das Protokoll hält fest, mit welcher Softwareversion ein Knoten
startet. Verlässlicher als ein Versprechen sind drei Dinge, die noch ausstehen: eine vertragliche
Zusage gegenüber jeder Behörde, Einsicht in den Quelltext für deren Prüfer und der Ausschluss der
Polizei als Kunde. Über die Offenlegung des Quelltexts ist noch nicht entschieden.

### Hat jemand die Software auf Sicherheit geprüft?

Den Quelltext, ja; ein laufendes System noch niemand von außen. Ein zweiter Prüfer hat den ganzen
Knoten gelesen und 21 Befunde belegt, fünf davon schwer: Bilder waren während der Auswertung
kurz abrufbar, bevor sie maskiert waren; die Anfrageprüfung ließ sich mit Sonderzeichen umgehen;
zwei Abfragewege schrieben keinen Protokolleintrag. Diese fünf und die meisten übrigen sind
behoben und durch Tests oder einen Lauf belegt. Offen sind unter anderem die unverschlüsselte
Platte, die Verwaltung von Zertifikaten und Grenzen gegen Überlastung.
Die vollständige Liste mit Stand steht in `docs/SICHERHEIT.md`. Ein Penetrationstest durch eine
dafür zugelassene Stelle steht aus und gehört vor jeden Betrieb mit echten Daten.

### Ist die Software barrierefrei?

Geprüft, nicht bescheinigt. Eine automatische Prüfung nach den Regeln der WCAG 2.1 in den
Stufen A und AA findet in 15 Zuständen der Konsole und auf der Website keine verletzte Regel
mehr; vorher waren es sechs, vor allem zu schwacher Kontrast der Nebentexte. Anmelden, Übung
starten, Lage wählen, suchen und ein Bild öffnen gelingen ohne Maus, und neue Meldungen werden
für Bildschirmleser angesagt. Nicht geprüft: die Bedienung mit einem Bildschirmleser, die
Vergrößerung auf 200 Prozent, die Unterlagen. Die Marken der Karte lassen sich nur mit der
Maus wählen; ihr Inhalt steht daneben als Liste. Ein BITV-Test durch eine Prüfstelle steht aus. Einzelheiten
in `docs/BARRIEREFREIHEIT.md`.

### Was braucht der Rechner, und wie wird gesichert?

Vier Rechenkerne, 8 GB Arbeitsspeicher (der Knoten belegt beim Start rund 3 GB, im Betrieb rund
1,7 GB), rund 950 MB für die Modelle und je Minute Material rund 3,3 MB zusätzlich zur
Aufzeichnung selbst. Gesichert wird, indem der Knoten beendet und sein Datenordner kopiert wird;
die Kopie eines Knotens wurde an anderem Ort gestartet, das Protokoll war unversehrt, die Suche
arbeitete. Ein Dauerlauf über 19 Minuten mit sieben Übungsläufen blieb im Speicher stabil. Ein
Dauerbetrieb über Tage ist nicht gemessen, und einen Dienst mit selbsttätigem Neustart gibt es
noch nicht. Einzelheiten in `docs/BETRIEB.md`.

### Woraus besteht die Software, und unter welchen Lizenzen?

Aus 143 Paketen, drei Modellen, einer Schrift und Kartendaten; jedes Teil steht mit Fassung,
Prüfsumme und Lizenz in der Stückliste (`docs/STUECKLISTE.md`, maschinenlesbar im Format
CycloneDX). Kein Paket steht unter GPL oder AGPL; die Bildbibliothek libvips steht unter der
LGPL und wird als eigene Datei geladen. Der Abgleich mit bekannten Schwachstellen vom
18. November 2026 nennt keinen Befund in den ausgelieferten Paketen. Das ist eine
Momentaufnahme und keine rechtliche Prüfung der Lizenzen.

### Wurde das je im Ernstfall erprobt?

Nein. Es gibt keinen Behördenkunden, keine Erprobung mit einer Behörde und keinen Einsatz.
Gemessen sind eine eigene Übung mit Archivaufnahmen aus dem Netz und ein öffentlicher Datensatz,
geprüft ist ein Direktbild von einer simulierten Kamera; der Messbericht nennt, was die Werte
bedeuten und was nicht. Die erste Erprobung in einer Übung mit einer Behörde ist für das zweite
Quartal 2027 vorgesehen, wenn eine Behörde zusagt.

### Sie verweisen auf das Ahrtal. Ist das redlich?

Belegt ist: Ein Polizeihubschrauber filmte am 14. Juli 2021 zwischen 22:14 und 22:43 Uhr
überflutete Orte und Menschen, die Lichtzeichen gaben. Die Videos wurden nicht ordnungsgemäß
verbucht; Untersuchungsausschuss und Staatsanwaltschaft erfuhren erst im September 2022 von
ihnen. Niemand kann sagen, dass Sicht in dieser Nacht ein Leben gerettet hätte. Standbilder
erreichten das Ministerium noch in der Nacht und lösten nach dem Sondervotum der Opposition
nichts aus. Technik hilft nur dort, wo jemand zuständig ist und handelt.

## Von Investoren

### Gibt es das schon?

Die Teile ja, die Verbindung nach unserer Recherche nicht. Freitextsuche über Video liefern mehr
als zehn Anbieter; ein landesweites Lagebild für den Bevölkerungsschutz läuft in
Baden-Württemberg; die Stadt Kaohsiung beobachtet ihre Kameras mit Bild-Sprach-Modellen auf
Überflutung, Feuer und Straßenschäden. Kein gefundener Anbieter verbindet Freitextsuche, den
Zuschnitt auf den Bevölkerungsschutz und einen Verbund ohne Identifizierung und ist damit bei
einem Staat oder Land im Einsatz. Bei keinem fand sich der Grundsatz, dass im Verbund nur die
Frage reist und das Bild bleibt, wo es aufgenommen wurde. Das ist das Ergebnis einer zeitlich
begrenzten Suche in öffentlichen Quellen und kein Beweis; die Anbieter und Quellen stehen in
`docs/STRATEGY.md`, Abschnitt 4.

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
oder im Ausland; beides ist ungeprüft. Rechnet man die kritischen Anlagen hinzu und die
Europäische Union nach Einwohnern hoch, ergeben sich rechnerisch 470 bis 650 Mio. € im Jahr.
Eine Bewertung von einer Milliarde verlangte davon 10 bis 21 Prozent und das 35- bis 52-Fache
des Basisfalls. Das ist eine Rechnung mit fünf unbelegten Bedingungen (`docs/STRATEGY.md`,
Abschnitt 7), keine Prognose.

### Was schützt Sie vor Nachahmern?

Wenig Technik, etwas Zeit. Die Freitextsuche über Video bieten mehr als zehn Hersteller, und die
Modelle sind frei verfügbar. Eigen ist die Verbindung aus dem Zuschnitt auf den
Bevölkerungsschutz, dem Verzicht auf jede Identifizierung und einem Verbund ohne gemeinsamen
Datenbestand; auch das kann ein größerer Anbieter nachbauen. Ein Vorsprung entsteht nur durch die
erste gemessene Erprobung, die erste Kopplung an ein Bestandssystem und das Vertrauen einer
Datenschutzaufsicht. Alle drei stehen aus.
