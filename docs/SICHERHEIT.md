# Sicherheitsdurchsicht

Stand: 18. November 2026, Fassung 0.5.0. Dieses Blatt hält fest, was eine unabhängige Durchsicht
des Knotens gefunden hat, was davon behoben ist und was offen bleibt. Es ersetzt keinen
Penetrationstest und keine Prüfung durch eine dafür zugelassene Stelle; es ist die Liste, mit der
eine solche Prüfung beginnen kann. Aufbau und Schnittstelle beschreibt
[`ARCHITEKTUR.md`](ARCHITEKTUR.md).

## Wie geprüft wurde

Ein zweiter Prüfer ohne Kenntnis der Entwicklung hat den gesamten Quelltext des Knotens
(`apps/server/src`) gelesen, jeden Weg der Schnittstelle mit seinem Recht aufgelistet und jeden
Befund am Quelltext belegt. Ausgeführt hat er nichts. Die Versprechen, an denen gemessen wurde:

1. Jede Abfrage, Ablehnung und Freigabe steht im Protokoll, bevor die Antwort hinausgeht.
2. Die Aufsicht sieht nie Bildmaterial.
3. Gesichter sind in jedem ausgelieferten Bild maskiert; das Original gibt es nur mit
   befristeter Freigabe durch eine zweite Person.
4. Ohne Mandat keine Auswertung.
5. Die Anfrageprüfung lehnt ab, was auf das Erkennen von Personen zielt.
6. Nachbarknoten erhalten nur maskierte Vorschaubilder und eine Belegnummer.
7. Ein Direktbild schließt nur die Leitung an.

Angenommene Angreifer: jemand im selben Netz ohne Zugang; eine angemeldete Person, die ihre Rolle
überschreiten will; ein böswilliger oder übernommener Nachbarknoten; eine präparierte Datei oder
Stromadresse. Die drei Vorführzugänge mit gemeinsamem Kennwort sind eine bekannte Grenze und
kein Befund.

## Befunde

21 Befunde: fünf schwere, elf mittlere, fünf leichte. Dazu drei, die beim Gegenprüfen der Rollen
vor der Durchsicht aufgefallen waren (A bis C).

| Nr. | Schwere | Befund | Stand | Nachweis |
| --- | --- | --- | --- | --- |
| 1 | schwer | Während eine Aufnahme ausgewertet wurde, lagen ihre Bilder schon unter dem abrufbaren Namen, bevor sie maskiert waren. | behoben | ffmpeg schreibt unter einem Namen, den die Schnittstelle nie ausliefert; ein Bild erhält seinen abrufbaren Namen erst nach der Gesichtsprüfung (`pipeline.ts`, `releaseFrame`). Ohne Gesichtserkenner wird nichts freigegeben. Geprüft in einem Lauf mit 44 Aufnahmen (einmalig, nicht Teil der automatischen Prüfungen): 332 Abrufversuche auf Bilder, die ffmpeg geschrieben hatte und die noch nicht freigegeben waren, wurden alle abgewiesen. |
| 2 | schwer | Die Aufzeichnung selbst war ohne Freigabe abrufbar, solange die Zahl maskierter Gesichter null war, also auch vor und während der Auswertung. | behoben | Ohne Freigabe nur nach vollständiger Auswertung mit laufendem Erkenner und ohne Fund (`routes.ts`, `/media/:id/source`). Im selben Lauf: 2 813 Abrufversuche auf noch nicht vollständig geprüfte Aufzeichnungen, alle abgewiesen; danach 21 Aufzeichnungen ohne Fund frei, 23 mit maskierten Gesichtern nur mit Freigabe. |
| 3 | schwer | Die Anfrageprüfung las den Text anders als das Modell: Vollbreite Buchstaben, Ligaturen und unsichtbare Zeichen umgingen jede Regel; ein Bindestrich verbarg Namen und Merkmale. | behoben | Die Prüfung faltet den Text so wie das Modell, prüft zweimal (mit und ohne Bindestrich), trennt an Binnenmajuskeln und lehnt andere Schriften als die lateinische ab (`intel/guard.ts`, 13 Tests). |
| 4 | schwer | Zwei Wege fragten das Verzeichnis ab, ohne einen Eintrag zu schreiben: das Prüfen einer Wache am Bestand und das Zeigen einer Fundstelle zu einem freien Text. | behoben | Beide schreiben einen Eintrag, auch bei Ablehnung; die Stichprobe der Aufsicht zieht aus ihnen mit (`routes.ts`). |
| 5 | schwer unter Node 24 | Ein Zeilentrenner (U+2028) in einem Namen oder Suchtext machte die Protokolldatei für neuere Laufzeiten unlesbar; der Knoten wäre nicht mehr gestartet. Auslösbar ohne Anmeldung. | behoben | Die Trenner werden als Escape geschrieben, die Datei wird nur am Zeilenvorschub geteilt (`core/ledger.ts`, Tests). |
| 6 | mittel | Angaben eines Nachbarknotens gingen in beliebiger Länge ins Protokoll. | behoben | Jede Angabe wird als Text begrenzter Länge übernommen (`routes.ts`). |
| 7 | mittel | Antworten eines Nachbarknotens erreichten den Browser ungeprüft; statt eines Vorschaubilds ließ sich eine Adresse unterschieben, die der Browser mit der Sitzung der auswertenden Person abruft. | behoben | Übernommen werden höchstens zwölf Treffer mit eingebettetem JPEG und geprüften Feldern; Antworten über 2 MB und Weiterleitungen werden abgelehnt (`intel/federation.ts`, `acceptHits`, Tests). Eine Abfrage lässt sich nicht als Bild laden (`core/origin.ts`). |
| 8 | mittel | Die Signatur im Verbund deckte nur Zeit und Inhalt: Eine Anfrage ließ sich wiederholen oder an den Absender zurückschicken. | behoben | Signiert werden Zeit, Einmalwert, Absender, Empfänger, Pfad und Inhalt; jede Signatur gilt einmal (`intel/federation.ts`, Tests). |
| 9 | mittel | Der antwortende Knoten glaubte dem fragenden, dass dessen Mandat Personenbeschreibungen erlaubt, und nahm leere Angaben an; keine Mengenbegrenzung. | behoben | Personenbeschreibungen werden für Nachbarn nicht beantwortet; Frage, Mandat mit Rechtsgrundlage und Person sind Pflicht; der genannte Knoten muss der unterschreibende sein; 60 Fragen je Nachbar in zehn Minuten, danach Ablehnung mit Eintrag. |
| 10 | mittel | Freigabe durch die zweite Person: beliebig viele Kennwortversuche, kein Eintrag beim Versuch der Selbstfreigabe, Freigabe vor dem Eintrag. | behoben | Fehlversuche zählen wie bei der Anmeldung und sperren nach fünf; jeder abgelehnte Versuch steht im Protokoll; erst der Eintrag, dann die Freigabe. |
| 11 | mittel | Rechte und Wege stimmten nicht überein: Die Auswertung konnte eine Quelle für den Verbund freigeben und eine Aufnahme löschen, aus der ein Vorgang ein Bild hält. | behoben | Freigeben für den Verbund nur mit dem Recht der Leitung; Aufnahmen mit Beweisstück bleiben (`routes.ts`). Offen: Jede Rolle darf die Kette prüfen; das ist beabsichtigt, aber nicht begrenzt. |
| 12 | mittel | Eine Datei kann Platte, Speicher oder Warteschlange erschöpfen. | teilweise | Höchstens 250 000 Bilder je Aufnahme, höchstens sechs Ausschnitte entlang der langen Seite. Offen: Mengenbegrenzung je Person, Prüfung des freien Platzes, Zeitgrenzen für Anfragen; ein offener Upload hält die Auswertung an. |
| 13 | mittel | Scheitert ein Schreibvorgang im Hintergrund, endete der Prozess oder der Fehler ging verloren. | teilweise | Fehler im Hintergrund werden gemeldet, ohne den Prozess zu beenden; ein Browser, der nicht mehr liest, wird getrennt. Offen: Der Eintrag zu einer Meldung wird nach dem Anzeigen geschrieben, nicht davor. |
| 14 | mittel | Die Anmeldeseite nannte das Kennwort der Vorführzugänge auch dann, wenn der Betreiber ein eigenes gesetzt hatte. | behoben | Genannt wird nur das veröffentlichte Kennwort der Vorführung (`core/auth.ts`). |
| 15 | mittel | Direktbild: Die Meldung von ffmpeg zu einem gescheiterten Strom zeigte allen Rollen die Adresse samt Zugangsdaten; Schlüssel in RTMP-Adressen standen im Protokoll; eine Adresse konnte den Knoten auf Verbindungen warten lassen. | teilweise | Adressen in Meldungen werden bereinigt, RTMP-Schlüssel entfernt, wartende Adressen abgelehnt (`intel/live.ts`, Tests). Offen: Ein Strom über HTTP kann auf interne Adressen weiterleiten; je Protokoll ist nichts eingeschränkt. Anschließen darf weiterhin nur die Leitung. |
| 16 | mittel | Keine Prüfung der Herkunft einer Anfrage: Ein Verweis auf einer fremden Seite oder in einer Nachricht konnte im Namen einer angemeldeten Person eine Abfrage auslösen. | behoben | Anfragen, die eine fremde Seite auslöst, werden abgelehnt; eine Abfrage lässt sich nicht als Seite oder Bild öffnen (`core/origin.ts`, Tests, im Browser geprüft). Mit `SICHT_COOKIE_SECURE=1` trägt das Cookie `Secure`. |
| 17 | leicht | Protokoll: Die Prüfung verglich die Datei nicht mit dem Stand, den der Knoten hält; Liste, Stichprobe und Kennzahlen sehen nur die letzten 4 000 Einträge. | teilweise | Die Prüfung meldet eine abgeschnittene oder ausgetauschte Datei (`core/ledger.ts`, Tests). Offen: das Fenster von 4 000 Einträgen. |
| 18 | leicht | Die Zeit eines Beweisstücks kommt vom Browser, nicht aus der Aufnahme. | offen | Die Prüfsumme des Bildes ist davon unabhängig. |
| 19 | leicht | Nachschärfen kann eine Wache auf ein bestimmtes Aussehen ziehen, an der Anfrageprüfung vorbei. | offen | Gegenmittel heute: Nachschärfen ist ein ausdrücklicher, protokollierter Schritt mit nummerierter Fassung und lässt sich zurücknehmen. |
| 20 | leicht | Sitzungen ohne feste Höchstdauer; Bilder blieben eine Stunde im Zwischenspeicher des Browsers, auch für die nächste Person am selben Gerät. | behoben | Höchstens 24 Stunden je Anmeldung; Bilder werden bei jeder Verwendung neu geprüft (`core/auth.ts`, `routes.ts`). |
| 21 | leicht | ffmpeg las hochgeladene Dateien ohne Einschränkung der Protokolle; ein leerer Verbundschlüssel wurde angenommen; Fehlermeldungen nannten Pfade des Rechners. | behoben | Hochgeladene Dateien werden nur als lokale Datei gelesen; der Verbundschlüssel braucht mindestens 16 Zeichen; Pfade werden aus Meldungen entfernt. |
| A | schwer | Der Bericht eines Vorgangs bettete Bilder ein und war für die Aufsicht abrufbar. | behoben | Die Aufsicht erhält den Bericht ohne Bilder; die Vorgangsansicht fordert für sie keine an (`intel/report.ts`, Test). |
| B | mittel | Versiegeln war nicht der Leitung vorbehalten, obwohl das Recht dafür bestand. | behoben | `routes.ts`, im Browser geprüft. |
| C | leicht | Ein ungültig kodiertes Cookie führte zu einem Serverfehler. | behoben | `node.ts`. |

## Geprüft und in Ordnung befunden

- Kein Weg liefert der Aufsicht Bilder: Alle Bildwege verlangen das Recht `media`; Zustand,
  Ereignisstrom und Vorgänge tragen nur Adressen und Schlagworte.
- Unmaskierte Bilder: kein Schalter in der Adresse; Berichte, Ausgaben, Beweisstücke und
  Vorschaubilder für Nachbarn lesen das maskierte Bild.
- Freigabe: an Person und Aufnahme gebunden, 15 Minuten, nur durch eine leitende Person, nie
  durch die anfragende selbst.
- Pfade: Dateinamen aus Uploads sind nur Anzeigetext; gespeichert wird unter einer vom Knoten
  vergebenen Kennung; jede Kennung in einem Pfad wird gegen ein festes Muster geprüft.
- ffmpeg wird ohne Shell mit einer Liste von Argumenten gestartet; die Adresse eines Stroms ist
  ein einzelnes Argument.
- Berichte und CAP-Meldungen geben jeden fremden Text als Text aus; die Konsole setzt kein
  ungeprüftes Markup.
- Sitzung: 192 Bit Zufall, nur im Cookie, serverseitig beendbar; Kennwörter als scrypt-Wert,
  Vergleich in konstanter Zeit, Sperre nach fünf Fehlversuchen.
- Protokoll: Schreibvorgänge laufen nacheinander; ein gescheiterter lässt Stand und Zähler
  unberührt; die Prüfung rechnet Folge, Verweis und Prüfsumme jeder Zeile nach.
- Die Muster der Anfrageprüfung laufen nicht in überlange Rechenzeit; Eingaben sind auf 300
  Zeichen begrenzt.
- Voreinstellung: Der Knoten lauscht nur auf `127.0.0.1`.

## Was offen bleibt

| Bereich | Offen | Warum es zählt |
| --- | --- | --- |
| Transport | Der Knoten spricht selbst kein TLS. | Zwischen Rechnern gehört ein TLS-Abschluss davor, der die Kopfzeile `Host` unverändert durchreicht; erst dann sind Sitzung und Verbundschlüssel auf der Leitung geschützt. |
| Zugänge | Drei feste Zugänge, kein zweiter Faktor, kein Verzeichnisdienst. | Die Rollentrennung ist gebaut, die Bindung an benannte Personen nicht. |
| Daten auf der Platte | Nichts ist verschlüsselt; das Protokoll liegt auf dem Rechner, auf dem es entsteht. | Wer den Rechner hat, hat Aufnahmen, Originale, Schlüssel und kann das Protokoll löschen. Der Abgleich mit bezeugten Ständen zeigt das, verhindert es aber nicht. |
| Verbund | Schlüssel ohne Wechsel, keine Zertifikate; nur auf einem Rechner erprobt. | Vor einem Verbund über ein Netz. |
| Last | Keine Mengenbegrenzung je Person, keine Prüfung des freien Platzes. | Eine angemeldete Person kann den Knoten lahmlegen. |
| Direktbild | Keine Einschränkung der Ziele, zu denen ffmpeg sich verbindet. | Betrifft nur die Leitung, bleibt aber ein Weg ins interne Netz. |
| Abhängigkeiten | Keine Prüfung der eingesetzten Pakete auf bekannte Schwachstellen. | Gehört vor jeden Betrieb. |
| Prüfung | Kein Penetrationstest, keine Prüfung der Konsole über die Suche nach ungeprüftem Markup hinaus. | Dieses Blatt ist eine Durchsicht des Quelltexts, kein Angriff auf ein laufendes System. |
