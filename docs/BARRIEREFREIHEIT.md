# Barrierefreiheit

Stand: 18. November 2026. Dieses Blatt sagt, was an Konsole und Website auf Barrierefreiheit
geprüft wurde, womit, mit welchem Ergebnis, was dafür geändert wurde und was nicht geprüft ist.
Es ist keine Erklärung zur Barrierefreiheit und kein Bericht einer Prüfstelle.

## Warum es zählt

Öffentliche Stellen müssen ihre Websites und Anwendungen barrierefrei gestalten, auch die
Angebote, mit denen ihre Beschäftigten arbeiten. Für den Bund regeln das § 12a des
Behindertengleichstellungsgesetzes und die BITV 2.0; die Länder haben eigene Regeln mit
demselben Maßstab, der Norm EN 301 549, die für Oberflächen im Browser auf die WCAG 2.1 in der
Stufe AA verweist. Wer einer Behörde Software anbietet, wird danach gefragt. Wie weit die
Pflicht für eine Fachanwendung im Stab reicht, klärt die beschaffende Stelle; diese Einordnung
ist nicht juristisch geprüft.

## Was geprüft wurde

| Prüfung | Womit | Umfang | Ergebnis |
| --- | --- | --- | --- |
| Automatisch, Regeln der WCAG 2.1 Stufe A und AA | axe-core 4.14.1 in Chromium (`tools/barrierefreiheit/pruefen.cjs`) | Konsole in 15 Zuständen: Anmeldung, Mandat, alle acht Reiter, Suche mit Treffern, Trefferblatt, abgelehnte Anfrage, englische Fassung. Website in drei Zuständen: deutsch und englisch breit, deutsch schmal | Vorher: sechs verletzte Regeln an 364 Elementen. Nachher: keine verletzte Regel |
| Bedienung ohne Maus | eigener Gang nur mit der Tastatur (`tools/barrierefreiheit/tastatur.cjs`) | 24 Schritte: anmelden, Mandat wählen, Übung starten, eine Lage wählen, die Karte vergrößern und verschieben, Reiter wechseln, Zeilen wählen, einen Protokolleintrag aufklappen, suchen, ein Trefferblatt öffnen und schließen | 24 von 24 Schritten gelingen, der Fokus ist jeweils sichtbar |
| Ansage neuer Meldungen | eigener Lauf, 30 Sekunden Übung in achtfacher Geschwindigkeit | der Bereich, den Bildschirmleser vorlesen | vier Meldungen angesagt, jede mit Art und Quelle |

Die 364 Elemente sind über alle Zustände gezählt; ein Element, das in mehreren Zuständen
vorkommt, zählt mehrfach.

## Was die Prüfung gefunden hat und was geändert wurde

| Regel | Elemente | Befund | Änderung |
| --- | --- | --- | --- |
| Kontrast (`color-contrast`) | 280 | Nebentexte in Dunkelgrau standen mit 2,7:1 auf dem Grund; verlangt sind 4,5:1 | Nebentexte jetzt 5,3:1, mittlere Texte 8,6:1. Das frühere Dunkelgrau bleibt für Linien und gesperrte Schaltflächen. Gilt für Konsole und Website |
| Name auf einem Element ohne Rolle (`aria-prohibited-attr`) | 53 | Das Zeichen für die Stufe einer Meldung, drei Balken, trug einen Namen, war aber nicht als Bild ausgezeichnet | als Bild mit Namen ausgezeichnet: Hinweis, Erheblich, Kritisch |
| Schaltfläche ohne Namen (`button-name`) | 27 | Bilder, die sich öffnen lassen, hatten keinen Namen | jede trägt die Bildbeschreibung oder »Bild öffnen« |
| Bereich zum Rollen ohne Tastaturzugang (`scrollable-region-focusable`) | 2 | Die Liste der Lagen ließ sich nur mit der Maus rollen | die Lagen sind einzeln erreichbar und wählbar |
| Sichtbarer Text fehlt im Namen (`label-content-name-mismatch`) | 1 | Die Schaltfläche »esc« hieß für Bildschirmleser nur »Schließen« | sie heißt, wie sie beschriftet ist; »Schließen« ist die Beschreibung |
| Auswahlfeld ohne Namen (`select-name`) | 1 | das Feld für die Zielquelle beim Hochladen | trägt den Namen »Zielquelle« |

Von der automatischen Prüfung nicht gemeldet, beim Gang mit der Tastatur gefunden und behoben:

- Zeilen in den Tabellen der Reiter WACHEN, VORGÄNGE, PROTOKOLL und QUELLEN, die Zugänge auf der
  Anmeldeseite und die Lagen in der Liste reagierten nur auf einen Klick. Sie sind jetzt mit der
  Tabulatortaste erreichbar und mit Eingabetaste oder Leertaste bedienbar; die gewählte Zeile
  ist für Bildschirmleser ausgezeichnet.
- Eine neue Meldung erschien nur im Bild. Sie wird jetzt zusätzlich in einem Bereich angesagt,
  den Bildschirmleser vorlesen, ohne dass die Person die Liste aufsuchen muss.
- Die Karte ließ sich nur mit der Maus bewegen. Sie ist jetzt mit der Tabulatortaste erreichbar;
  die Pfeiltasten verschieben sie, Plus und Minus vergrößern und verkleinern.

Unverändert und schon vorher vorhanden: sichtbarer Fokus an jedem bedienbaren Element; die
Stufe einer Meldung wird durch die Zahl der hellen Balken gezeigt, nicht durch Farbe; die
Oberfläche kommt ohne Farbe als Bedeutungsträger aus; Dialoge halten den Fokus und schließen
mit Escape; Website und Konsole achten auf die Einstellung »weniger Bewegung«; der Film der
Website hat keinen Sprecher, sein Inhalt steht als Text im Abschnitt danach.

## Was nicht geprüft ist

| Bereich | Offen | Warum es zählt |
| --- | --- | --- |
| Bildschirmleser | Niemand hat die Konsole mit NVDA, JAWS oder VoiceOver bedient. Geprüft sind Namen, Rollen und die Ansage, nicht, ob sich damit arbeiten lässt. | Eine automatische Prüfung findet erfahrungsgemäß nur einen Teil der Barrieren. |
| Prüfung nach BITV | Kein BITV-Test, keine Prüfstelle, keine Erklärung zur Barrierefreiheit. | Das ist der Nachweis, den eine Behörde verlangt. |
| Karte | Die Karte ist eine Zeichenfläche. Verschieben und vergrößern geht mit der Tastatur; ihre Marken lassen sich nur mit der Maus wählen, und ein Bildschirmleser erfährt nicht, was sie zeigt. Dieselben Quellen stehen darunter als Schaltflächen, die Lagen daneben als Liste. | Der Inhalt ist auf zweitem Weg erreichbar, das Kartenbild selbst nicht. |
| Vergrößerung und schmale Fenster | Die Konsole ist für Arbeitsplatzbildschirme gebaut. Vergrößerung auf 200 Prozent und Umbruch bei schmalem Fenster sind nicht geprüft. | WCAG 1.4.4 und 1.4.10. |
| Text über Bildern | Den Kontrast von Schrift über Bildern und über der Karte kann die automatische Prüfung nicht bestimmen; je Zustand bleiben bis zu 102 Elemente zur Prüfung von Hand. | Betrifft Beschriftungen auf der Karte und in Bildkacheln. |
| Unterlagen | Die PDF-Dateien und die Präsentationen sind nicht auf Barrierefreiheit geprüft. | Auch Dokumente fallen unter die Pflicht, wenn eine Behörde sie veröffentlicht. |
| Betroffene | Niemand, der auf Hilfsmittel angewiesen ist, hat Sicht benutzt. | Erst das zeigt, ob die Bedienung taugt. |

## Nachprüfen

Die Vorführung läuft im vorbereiteten Ausgangsstand (`pnpm demo`), für die Website dient ein
Dateiserver auf dem Ordner `site`. axe-core gehört nicht zu den Paketen von Sicht und wird für
die Prüfung daneben eingerichtet; die Schritte stehen am Kopf des Werkzeugs.

```bash
node tools/barrierefreiheit/pruefen.cjs all
```

```bash
node tools/barrierefreiheit/tastatur.cjs
```

Beide Befehle enden mit Fehler, wenn eine Regel verletzt ist oder ein Schritt ohne Maus nicht
gelingt.
