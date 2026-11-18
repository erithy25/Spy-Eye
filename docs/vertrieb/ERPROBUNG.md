# Angebot: Erprobung von Sicht in einer Übung

Vorlage. Eckige Klammern sind vor dem Versand zu füllen. Preise sind Annahmen aus dem
Finanzmodell (`deliverables/Sicht-Finanzmodell.xlsx`) und vor dem Versand festzulegen. Dieses
Blatt ist kein Vertragstext; es beschreibt, was beide Seiten voneinander erwarten können.

[Anbieter] · [Behörde] · Stand [Datum]

## 1. Gegenstand

Die Behörde erprobt drei Monate lang die Software Sicht an eigenem Bildmaterial aus einer Übung.
Am Ende steht ein Messbericht mit den Zahlen der Behörde. Auf seiner Grundlage entscheidet sie,
ob sie weitermacht.

Sicht macht Aufzeichnungen von Drohnen, Kameras und Erkundungstrupps durchsuchbar (Suche in
freien Worten, deutsch oder englisch) und beobachtet sie mit stehenden Suchaufträgen (Wachen)
auf Schadenslagen. Sicht ist im Erprobungsstand; es gibt keine Zulassung und keinen Echtbetrieb.

## 2. Ablauf

| Woche | Schritt | Wer | Ergebnis |
| --- | --- | --- | --- |
| vor Beginn | Unterlagen zur Datenschutz-Folgenabschätzung; Abstimmung mit der oder dem Datenschutzbeauftragten | Anbieter liefert, Behörde prüft | schriftliche Zustimmung oder Auflagen |
| 1 | Einrichten: ein Rechner der Behörde, Einspielen von Material einer vergangenen Übung, Schulung von drei bis fünf Personen (ein Tag) | Anbieter vor Ort | Knoten läuft, Zugänge und Mandat sind angelegt |
| 2 bis 6 | Arbeiten am Bestand: suchen, Wachen in eigenen Worten formulieren und am Bestand prüfen | Behörde, Anbieter erreichbar | Wachen der Behörde |
| 7 bis 10 | Übung auf abgesperrtem Gelände ohne unbeteiligte Personen; Einspielen der Aufzeichnungen, wahlweise eines Direktbilds | Behörde übt, Anbieter begleitet | Meldungen, Urteile der Auswertenden, Protokoll |
| 11 bis 12 | Auswertung und Nachbesprechung mit dem Stab | gemeinsam | Messbericht |

## 3. Was gemessen wird

| Größe | Bedeutung |
| --- | --- |
| Erkennungsverzug | Sekunden vom ersten Bild eines Ereignisses bis zur Meldung auf der Lagekarte, je Ereignis |
| Übersehene Ereignisse | Ereignisse der Übung, die keine Wache gemeldet hat |
| Fehlmeldungen | Meldungen ohne Ereignis, mit dem Urteil der Auswertenden |
| Sichtungsquote | Anteil der eingegangenen Aufzeichnungen, die vollständig ausgewertet sind |
| Protokollierte Abfragen | Zahl der Abfragen und der abgelehnten Anfragen; Stichprobe durch die Aufsichtsrolle |
| Urteil des Stabs | Hat die Meldung geholfen, gestört oder gefehlt? Kurze Befragung nach der Übung |

Die Software erzeugt den Bericht selbst (Reiter WIRKUNG, Messbericht). Die Behörde legt die
Ereignisse der Übung fest; der Anbieter kennt sie vorher nicht.

## 4. Leistungen des Anbieters

- Einrichtung des Knotens und Schulung, ein Tag vor Ort.
- Unterlagen für die Datenschutz-Folgenabschätzung: Beschreibung der Verarbeitung, der
  Schutzvorkehrungen und der Grenzen (`docs/COMPLIANCE.md`).
- Begleitung der Übung und Auswertung.
- Behebung von Fehlern der Software während der Erprobung.
- Messbericht und Nachbesprechung.

## 5. Mitwirkung der Behörde

- Ein Rechner im eigenen Haus. Gemessen wurde auf einem Rechner mit vier Prozessorkernen und
  16 GB Arbeitsspeicher ohne Grafikkarte: Aufzeichnungen werden dort mit etwa dreifacher
  Echtzeit ausgewertet; rechnerisch reicht das für etwa drei gleichzeitige Direktbilder.
- Aufzeichnungen aus eigenen Übungen in gängigen Videoformaten.
- Drei bis fünf Personen für die Rollen Auswertung, Leitung und Aufsicht.
- Eine Übung im Erprobungszeitraum und ein Drehbuch mit ihren Ereignissen.
- Eine Ansprechperson und die Abstimmung mit der oder dem Datenschutzbeauftragten.

## 6. Datenschutz und Grenzen

- Das Material bleibt auf dem Rechner der Behörde. Nach der Einrichtung braucht der Knoten keine
  Netzverbindung; es gibt keine Rückmeldung an den Anbieter.
- Gesichter werden beim Einspielen unkenntlich gemacht. Das Original gibt es nur mit Begründung
  und Freigabe durch eine zweite Person, befristet auf 15 Minuten.
- Anfragen nach bestimmten Personen, Gesichtern, Kennzeichen, Herkunft oder körperlichen
  Merkmalen lehnt die Software ab und protokolliert die Ablehnung. Das ist eine Regel mit
  Protokoll, keine technische Unmöglichkeit.
- Jede Auswertung braucht ein Mandat mit Zweck und Rechtsgrundlage. Für die Erprobung legt die
  Behörde es selbst an.
- Erprobt wird in einer Übung auf abgesperrtem Gelände. Echtlagen und Aufnahmen unbeteiligter
  Personen sind nicht Gegenstand.
- Nach Ende der Erprobung löscht die Behörde den Knoten oder behält ihn; der Anbieter hat keine
  Kopie des Materials.
- Ob eine Behörde Bildmaterial außerhalb von Übungen so auswerten darf, entscheidet ihre
  Rechtsgrundlage. Dieses Angebot ersetzt kein Rechtsgutachten.

## 7. Was die Erprobung nicht ist

- Kein Echtbetrieb und keine Anbindung an das Führungssystem der Behörde. Meldungen lassen sich
  als GeoJSON und als CAP-1.2-Meldung ausgeben; eine erprobte Kopplung gibt es nicht.
- Kein Versprechen über die Güte am Material der Behörde. Die bisherigen Messwerte stammen aus
  frei lizenziertem Archivmaterial; die Erprobung dient dazu, die eigenen zu erheben.
- Direktbilder sind gebaut und gegen eine simulierte Kamera geprüft, nicht gegen Geräte im
  Feld. Wird ein Direktbild erprobt, ist das ein Versuch im Versuch.

## 8. Preis

| Leistung | Preis |
| --- | --- |
| Erprobung wie beschrieben, drei Monate | [25 000 € netto, fest] |
| Reisekosten | [enthalten / nach Aufwand] |

Zur Einordnung, ohne Verpflichtung: Eine Knotenlizenz für einen Kreis mit Pflege ist mit
[48 000 € netto je Jahr] angesetzt.

## 9. Abbruch

Jede Seite kann die Erprobung jederzeit beenden. Die Behörde zahlt dann [anteilig bis zum Ende
des laufenden Abschnitts aus Abschnitt 2]. Das Material und der Rechner bleiben bei der Behörde.
