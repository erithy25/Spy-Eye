# Sicht — Website

Statische Seite ohne Framework und ohne Build-Schritt. Deutsch ist die Fassung in `index.html`,
Englisch steht in `i18n.js`. Die Seite lädt nichts von außen: Schrift, Kartendaten, Bilder, Film
und Skripte liegen in diesem Ordner, alle Verweise sind relativ. Der Ordner lässt sich deshalb
unter jedem Pfad ausliefern; Einstieg ist `index.html`.

## Ansehen

`index.html` im Browser öffnen genügt. Wer lieber über einen lokalen Server geht:

```bash
python3 -m http.server 4321 --directory site
```

Dann <http://127.0.0.1:4321/>. Englisch direkt: `?lang=en`.

## Dateien

| Datei | Inhalt |
| --- | --- |
| `index.html` | Aufbau und deutscher Text |
| `i18n.js` | englischer Text (Schlüssel = `data-i18n`), Beschriftungen der Karte |
| `styles.css` | Gestaltung nach `docs/BRAND.md` |
| `main.js` | Sprachumschaltung, Bildrahmen und ihre große Ansicht, Menü, Karte im Kopfbereich |
| `assets/map/hero.js` | Kartendaten des Kopfbereichs, erzeugt aus den Kacheln der Konsole |
| `assets/fonts/` | JetBrains Mono (SIL OFL 1.1, Lizenztext in `OFL.txt`) |
| `assets/screens/` | Bildschirmaufnahmen der Konsole als WebP, siehe unten |
| `assets/film/` | Markenfilm (`sicht-markenfilm.mp4`, 2,8 MB, 40 s) und sein Standbild (`poster.webp`) |
| `tools/build-screens.mjs` | leitet die Bilder der Seite aus den Bildschirmaufnahmen ab |
| `tools/build-hero-map.mjs` | erzeugt `assets/map/hero.js` neu |

`README.md`, `tools/` und `assets/screens/LIESMICH.txt` braucht die ausgelieferte Seite nicht.

## Bildschirmaufnahmen

Quelle sind die Aufnahmen der Konsole in `docs/screens/` (2880 × 1800, 16 : 10). Die Seite
verwendet daraus abgeleitete WebP-Dateien:

| Datei | Verwendung |
| --- | --- |
| `<name>.webp` | ganze Aufnahme in voller Größe, für die große Ansicht |
| `<name>-1440.webp` | halbe Größe, für die Rahmen der sieben Reiter (`srcset` wählt je Bildschirm) |
| `<name>-960.webp` | für die kleinen Rahmen „Detail“ |
| `<name>-ausschnitt.webp`, `-ausschnitt-half.webp` | Ausschnitt, wo nur ein Teil des Bildschirms zählt (Maskierung, Freigabe, Original, Ablehnung) |

Neu erzeugen, nachdem sich Aufnahmen geändert haben:

```bash
node site/tools/build-screens.mjs
```

Das Werkzeug liest PNG-Dateien mit den Namen aus `docs/screens/` (anderer Ordner als erstes
Argument) und braucht `sharp`, das mit dem Server dieses Repositorys installiert wird. Welche
Aufnahmen und Ausschnitte es schreibt, steht am Anfang der Datei. Die vorliegenden WebP-Dateien
wurden aus den Aufnahmen in voller Farbtiefe erzeugt; `docs/screens/` enthält dieselben
Aufnahmen farbreduziert, das Werkzeug nimmt beide. Fehlt ein Bild, zeigt sein Rahmen eine
Passmarke und lässt sich nicht vergrößern.

Jeder Rahmen mit Bild öffnet eine große Ansicht (Mausklick oder Eingabetaste): Pfeiltasten
blättern durch alle Aufnahmen, Escape oder ein Klick neben das Bild schließt. Auf kleinen
Bildschirmen ist die große Ansicht breiter als der Bildschirm und lässt sich seitlich schieben.
Ohne JavaScript öffnet der Rahmen die Bilddatei selbst.

Die Bildunterschriften sagen, was zu sehen ist. Wer eine Aufnahme ersetzt, prüft die
Unterschrift dazu in `index.html` und `i18n.js`. Die Aufnahme zum Reiter WIRKUNG stammt aus
einem Lauf mit achtfacher Übungsuhr und weicht deshalb von der Tabelle „Gemessen“ ab; die
Unterschrift nennt die Abweichungen. Eine Aufnahme aus einem Lauf in Echtzeit macht diesen
Hinweis überflüssig.

## Film

`assets/film/sicht-markenfilm.mp4` ist die Fassung `media/brand/sicht-markenfilm-v1-web.mp4`
(1280 × 720, H.264/AAC). Er steht einmal auf der Seite, unter dem Kopfbereich, mit
Bedienelementen und ohne selbsttätigen Start. Das Standbild neu erzeugen:

```bash
ffmpeg -ss 15.5 -i site/assets/film/sicht-markenfilm.mp4 -frames:v 1 -c:v libwebp -quality 82 site/assets/film/poster.webp
```

## Kontakt

Der Aufruf „Vorführung anfragen“ erscheint erst, wenn am `<body>` ein Ziel eingetragen ist:

```html
<body data-contact="name@beispiel.de">
```

Erlaubt sind eine E-Mail-Adresse oder eine Adresse, die mit `https://` beginnt. Ohne Eintrag
wird der Aufruf nicht gezeigt.

## Karte neu erzeugen

Die Kartendaten stammen aus `apps/web/public/map` (Zoomstufe 12 um Koblenz, dazu die
Nebenstraßen der Stufe 13):

```bash
node site/tools/build-hero-map.mjs
```

Kartendaten © OpenStreetMap-Mitwirkende (ODbL), Schema OpenMapTiles, Höhendaten Mapzen.

## Was die Seite behauptet

Nur, was in `docs/BRAND.md`, `docs/EVALUATION.md` und der `README.md` des Repositorys als belegt
steht: die Messwerte mit ihren beiden Einschränkungen, die Grenzen in der Fassung von
`docs/BRAND.md`, die „Grenzen dieses Stands“ und den Ablauf der Vorführung aus `docs/DEMO.md`.
Ändert sich eine dieser Quellen, ändert sich die Seite mit, deutsch und englisch. Die Ablehnungen
im Abschnitt „Grenzen“ sind Wortlaut aus `apps/server/src/intel/guard.ts`. Die drei Belege im
Abschnitt „Problem“ sind an den verlinkten Quellen wörtlich nachgeprüft. Die Seite ist mit
`noindex` ausgezeichnet, weil der Name noch nicht geprüft ist.
